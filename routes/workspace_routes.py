"""Unified Workspace state API.

Durable first-slice storage for the workspace surfaces described in
``docs/superpowers/specs/2026-06-10-unified-workspace-design.md``.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional
import uuid
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from core.atomic_io import atomic_write_json
from core.constants import BASE_DIR, DATA_DIR
from src.auth_helpers import effective_user, require_user
from src import obsidian_knowledge


WORKSPACE_FILE = os.path.join(DATA_DIR, "workspace.json")
OBSIDIAN_VAULT_ROOT = os.path.join(DATA_DIR, "obsidian-vault")
_WORKSPACE_LOCK = threading.RLock()
_PREVIEW_LOCK = threading.RLock()
_PREVIEW_PROCS: Dict[str, Dict[str, Any]] = {}
SINGLE_USER_KEY = "__single__"
COUNCIL_BUILD_ROOT = os.path.join(DATA_DIR, "council-builds")
PREVIEW_HOST = "127.0.0.1"
PREVIEW_START_TIMEOUT_SECONDS = 12
logger = logging.getLogger(__name__)

DEFAULT_WORKSPACE = {
    "requests": [],
    "ideas": [],
    "council": [],
    "executions": [],
    "verifications": [],
}
ALLOWED_KINDS = set(DEFAULT_WORKSPACE.keys())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_workspace() -> Dict[str, List[Dict[str, Any]]]:
    return deepcopy(DEFAULT_WORKSPACE)


def _user_key(request: Request) -> str:
    user = effective_user(request)
    return user or SINGLE_USER_KEY


def _load_all() -> Dict[str, Any]:
    try:
        with open(WORKSPACE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (FileNotFoundError, ValueError):
        return {"_users": {}}

    if isinstance(raw, dict) and "_users" in raw and isinstance(raw["_users"], dict):
        return raw

    if isinstance(raw, dict):
        return {"_users": {SINGLE_USER_KEY: _normalize_workspace(raw)}}

    return {"_users": {}}


def _save_all(data: Dict[str, Any]) -> None:
    atomic_write_json(WORKSPACE_FILE, data, indent=2)


def _normalize_workspace(raw: Any) -> Dict[str, List[Dict[str, Any]]]:
    workspace = _empty_workspace()
    if not isinstance(raw, dict):
        return workspace
    for key in ALLOWED_KINDS:
        items = raw.get(key)
        if isinstance(items, list):
            workspace[key] = [item for item in items if isinstance(item, dict)]
    return workspace


def _get_workspace(data: Dict[str, Any], user_key: str) -> Dict[str, List[Dict[str, Any]]]:
    users = data.setdefault("_users", {})
    workspace = _normalize_workspace(users.get(user_key))
    users[user_key] = workspace
    return workspace


class WorkspaceItem(BaseModel):
    id: Optional[str] = None
    title: str = ""
    body: str = ""
    status: str = "open"
    source: str = "manual"
    tags: List[str] = Field(default_factory=list)
    links: Dict[str, Any] = Field(default_factory=dict)
    evidence: str = ""


class WorkspaceItemUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    links: Optional[Dict[str, Any]] = None
    evidence: Optional[str] = None


def _item_to_dict(item: WorkspaceItem) -> Dict[str, Any]:
    now = _now()
    return {
        "id": item.id or str(uuid.uuid4()),
        "title": item.title.strip() or "Untitled",
        "body": item.body.strip(),
        "status": item.status.strip() or "open",
        "source": item.source.strip() or "manual",
        "tags": [str(tag).strip() for tag in item.tags if str(tag).strip()],
        "links": item.links,
        "evidence": item.evidence.strip(),
        "created_at": now,
        "updated_at": now,
    }


def _collection(workspace: Dict[str, List[Dict[str, Any]]], kind: str) -> List[Dict[str, Any]]:
    if kind not in ALLOWED_KINDS:
        raise HTTPException(404, "Unknown workspace collection")
    return workspace[kind]


def _log_workspace_event(user_key: str, event_type: str, kind: str, item: Dict[str, Any], *, summary: str = "") -> None:
    try:
        obsidian_knowledge.log_event(
            user_key=user_key,
            event_type=event_type,
            title=f"{kind}: {item.get('title') or 'Untitled'}",
            summary=summary or str(item.get("body") or item.get("evidence") or ""),
            category="workspace",
            genre="event",
            source="workspace",
            source_id=str(item.get("id") or ""),
            status=str(item.get("status") or "logged"),
            tags=["odysseus/workspace", kind, *(item.get("tags") or [])],
            links={
                "workspace_kind": kind,
                "workspace_id": item.get("id"),
                "item_links": item.get("links") or {},
            },
            evidence=str(item.get("evidence") or ""),
            content=str(item.get("body") or ""),
            vault_root=OBSIDIAN_VAULT_ROOT,
            create_curation=event_type in {"workspace.evidence_added", "workspace.status_changed"},
        )
    except Exception:
        logger.debug("workspace Obsidian logging failed", exc_info=True)


def _normalize_html_artifact(html: str) -> str:
    if not re.search(r'data-odysseus-(?:project|fuel)-(?:review|sketch)="1"', html):
        return html
    return html.replace(
        'function render(){localStorage.fuelPriceState=JSON.stringify(Object.fromEntries(Object.entries(els).map(([k,e])=>[k,e.value])));',
        'function render(){try{localStorage.fuelPriceState=JSON.stringify(Object.fromEntries(Object.entries(els).map(([k,e])=>[k,e.value])))}catch(e){}',
    )


def _extract_html_artifact(value: str, kind: str) -> str:
    text = str(value or "")
    matches = list(re.finditer(r"```(?:html|HTML)[ \t]*\r?\n([\s\S]*?)```", text))
    candidates = [match.group(1).strip() for match in matches if match.group(1).strip()]
    if kind == "council":
        for candidate in reversed(candidates):
            if re.search(r'data-odysseus-(?:project|fuel)-review="1"', candidate):
                return _normalize_html_artifact(candidate)
    elif kind == "ideas":
        for candidate in reversed(candidates):
            if re.search(r'data-odysseus-(?:project|fuel)-sketch="1"', candidate):
                return _normalize_html_artifact(candidate)
    if candidates:
        return _normalize_html_artifact(candidates[-1])
    doc_match = re.search(r"<!doctype html|<html[\s>]", text, re.IGNORECASE)
    if doc_match:
        return _normalize_html_artifact(text[doc_match.start() :].strip())
    return ""


def _preview_key(user_key: str, kind: str, item_id: str) -> str:
    return f"{user_key}:{kind}:{item_id}"


def _set_item_preview(user_key: str, kind: str, item_id: str, preview: Dict[str, Any]) -> None:
    with _WORKSPACE_LOCK:
        data = _load_all()
        workspace = _get_workspace(data, user_key)
        collection = _collection(workspace, kind)
        for item in collection:
            if item.get("id") == item_id:
                links = item.setdefault("links", {})
                if not isinstance(links, dict):
                    links = {}
                    item["links"] = links
                links["preview"] = preview
                item["updated_at"] = _now()
                _save_all(data)
                return


def _get_item_preview(user_key: str, kind: str, item_id: str) -> Dict[str, Any]:
    with _WORKSPACE_LOCK:
        data = _load_all()
        workspace = _get_workspace(data, user_key)
        collection = _collection(workspace, kind)
        item = next((entry for entry in collection if entry.get("id") == item_id), None)
    if not item:
        raise HTTPException(404, "Workspace item not found")
    preview = item.get("links", {}).get("preview") if isinstance(item.get("links"), dict) else None
    if not isinstance(preview, dict) or preview.get("status") != "running":
        raise HTTPException(404, "Workspace item has no running local preview")
    return preview


def _resolve_council_build_dir(raw: Any) -> str:
    value = str(raw or "").strip().replace("\\", "/")
    if not value:
        raise HTTPException(400, "Workspace item has no Council build directory")
    if value.startswith("data/council-builds/"):
        candidate = os.path.join(COUNCIL_BUILD_ROOT, value.split("data/council-builds/", 1)[1])
    elif os.path.isabs(value):
        candidate = value
    else:
        candidate = os.path.join(BASE_DIR, value)

    root = os.path.realpath(COUNCIL_BUILD_ROOT)
    resolved = os.path.realpath(candidate)
    try:
        if os.path.commonpath([root, resolved]) != root:
            raise ValueError
    except ValueError:
        raise HTTPException(400, "Preview can only run from data/council-builds")
    if not os.path.isdir(resolved):
        raise HTTPException(400, "Council build directory does not exist")
    return resolved


def _find_preview_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((PREVIEW_HOST, 0))
        return int(sock.getsockname()[1])


def _read_json_file(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _command_display(command: List[str]) -> str:
    try:
        return subprocess.list2cmdline(command)
    except Exception:
        return " ".join(command)


def _node_runner() -> Optional[str]:
    return shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")


def _package_uses(package: Dict[str, Any], needle: str) -> bool:
    needle = needle.lower()
    scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
    deps = package.get("dependencies") if isinstance(package.get("dependencies"), dict) else {}
    dev_deps = package.get("devDependencies") if isinstance(package.get("devDependencies"), dict) else {}
    haystack = "\n".join([*(str(v) for v in scripts.values()), *deps.keys(), *dev_deps.keys()]).lower()
    return needle in haystack


def _infer_preview_command(build_dir: str, port: int) -> Dict[str, Any]:
    package_path = os.path.join(build_dir, "package.json")
    package = _read_json_file(package_path) if os.path.exists(package_path) else None
    if package:
        npm = _node_runner()
        if not npm:
            raise HTTPException(400, "Node/npm is not available for this package preview")
        scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
        command: Optional[List[str]] = None
        if "dev" in scripts:
            if _package_uses(package, "next"):
                command = [npm, "run", "dev", "--", "-H", PREVIEW_HOST, "-p", str(port)]
            elif _package_uses(package, "vite") or _package_uses(package, "astro") or _package_uses(package, "webpack"):
                command = [npm, "run", "dev", "--", "--host", PREVIEW_HOST, "--port", str(port)]
            else:
                command = [npm, "run", "dev"]
        elif "start" in scripts:
            if _package_uses(package, "next"):
                command = [npm, "run", "start", "--", "-H", PREVIEW_HOST, "-p", str(port)]
            elif _package_uses(package, "vite"):
                command = [npm, "run", "start", "--", "--host", PREVIEW_HOST, "--port", str(port)]
            else:
                command = [npm, "run", "start"]
        elif "serve" in scripts:
            command = [npm, "run", "serve", "--", "--host", PREVIEW_HOST, "--port", str(port)]
        if command:
            return {
                "command": command,
                "url": f"http://{PREVIEW_HOST}:{port}/",
                "runtime": "node-package",
            }

    for relative in ("index.html", os.path.join("public", "index.html"), os.path.join("dist", "index.html"), os.path.join("build", "index.html")):
        html_path = os.path.join(build_dir, relative)
        if os.path.exists(html_path):
            directory = os.path.dirname(html_path)
            return {
                "command": [sys.executable, "-m", "http.server", str(port), "--bind", PREVIEW_HOST, "--directory", directory],
                "url": f"http://{PREVIEW_HOST}:{port}/",
                "runtime": "static-html",
            }

    for module_name in ("app", "main", "server"):
        py_path = os.path.join(build_dir, f"{module_name}.py")
        if not os.path.exists(py_path):
            continue
        try:
            contents = open(py_path, "r", encoding="utf-8").read()
        except OSError:
            contents = ""
        if "FastAPI(" in contents:
            return {
                "command": [sys.executable, "-m", "uvicorn", f"{module_name}:app", "--host", PREVIEW_HOST, "--port", str(port)],
                "url": f"http://{PREVIEW_HOST}:{port}/",
                "runtime": "python-fastapi",
            }
        if "Flask(" in contents:
            return {
                "command": [sys.executable, "-m", "flask", "--app", module_name, "run", "--host", PREVIEW_HOST, "--port", str(port)],
                "url": f"http://{PREVIEW_HOST}:{port}/",
                "runtime": "python-flask",
            }

    raise HTTPException(400, "No supported local preview entrypoint found in the Council build directory")


def _preview_log_tail(log_path: str, limit: int = 2400) -> str:
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - limit))
            return handle.read().decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _popen_preview(command: List[str], build_dir: str, port: int, log_path: str) -> subprocess.Popen:
    env = os.environ.copy()
    env.update({
        "PORT": str(port),
        "HOST": PREVIEW_HOST,
        "HOSTNAME": PREVIEW_HOST,
        "BROWSER": "none",
        "CI": "1",
        "NODE_ENV": env.get("NODE_ENV", "development"),
    })
    kwargs: Dict[str, Any] = {
        "cwd": build_dir,
        "stdin": subprocess.DEVNULL,
        "env": env,
    }
    if os.name == "nt":
        kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    else:
        kwargs["start_new_session"] = True
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    log_handle = open(log_path, "ab", buffering=0)
    try:
        return subprocess.Popen(command, stdout=log_handle, stderr=subprocess.STDOUT, **kwargs)
    finally:
        log_handle.close()


def _terminate_preview_proc(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.terminate()
        else:
            os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        proc.terminate()
    try:
        proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
        proc.kill()


def _url_is_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status < 500
    except urllib.error.HTTPError as exc:
        return exc.code < 500
    except Exception:
        return False


def _wait_for_preview(url: str, proc: subprocess.Popen, log_path: str) -> Optional[str]:
    deadline = time.time() + PREVIEW_START_TIMEOUT_SECONDS
    while time.time() < deadline:
        if proc.poll() is not None:
            return _preview_log_tail(log_path) or f"Preview process exited with code {proc.returncode}"
        if _url_is_ready(url):
            return None
        time.sleep(0.35)
    return _preview_log_tail(log_path) or "Preview server did not respond before the startup timeout"


def _start_local_preview(user_key: str, kind: str, item_id: str, item: Dict[str, Any]) -> Dict[str, Any]:
    links = item.get("links") if isinstance(item.get("links"), dict) else {}
    build_dir = _resolve_council_build_dir(links.get("build_dir") or links.get("build_dir_container"))
    key = _preview_key(user_key, kind, item_id)
    with _PREVIEW_LOCK:
        existing = _PREVIEW_PROCS.get(key)
        if existing and existing.get("proc") and existing["proc"].poll() is None:
            return {
                key: value
                for key, value in existing.items()
                if key != "proc"
            }
        if existing and existing.get("proc"):
            _terminate_preview_proc(existing["proc"])
        port = _find_preview_port()
        spec = _infer_preview_command(build_dir, port)
        log_path = os.path.join(DATA_DIR, "workspace-previews", f"{item_id}.log")
        command = spec["command"]
        proc = _popen_preview(command, build_dir, port, log_path)
        internal_url = spec["url"]
        public_url = f"/api/workspace/preview/{kind}/{item_id}/proxy/"
        error = _wait_for_preview(internal_url, proc, log_path)
        if error:
            _terminate_preview_proc(proc)
            preview = {
                "status": "failed",
                "url": "",
                "internal_url": internal_url,
                "error": error,
                "runtime": spec["runtime"],
                "command": _command_display(command),
                "port": port,
                "log_path": os.path.relpath(log_path, BASE_DIR).replace("\\", "/"),
                "updated_at": _now(),
            }
            _set_item_preview(user_key, kind, item_id, preview)
            raise HTTPException(400, error)
        preview = {
            "status": "running",
            "url": public_url,
            "internal_url": internal_url,
            "runtime": spec["runtime"],
            "command": _command_display(command),
            "port": port,
            "pid": proc.pid,
            "build_dir": os.path.relpath(build_dir, BASE_DIR).replace("\\", "/"),
            "log_path": os.path.relpath(log_path, BASE_DIR).replace("\\", "/"),
            "started_at": _now(),
        }
        _PREVIEW_PROCS[key] = {**preview, "proc": proc}
        _set_item_preview(user_key, kind, item_id, preview)
        return preview


def _stop_local_preview(user_key: str, kind: str, item_id: str) -> Dict[str, Any]:
    key = _preview_key(user_key, kind, item_id)
    with _PREVIEW_LOCK:
        existing = _PREVIEW_PROCS.pop(key, None)
        if existing and existing.get("proc"):
            _terminate_preview_proc(existing["proc"])
    preview = {
        "status": "stopped",
        "url": "",
        "updated_at": _now(),
    }
    _set_item_preview(user_key, kind, item_id, preview)
    return preview


async def _proxy_local_preview_request(preview: Dict[str, Any], path: str, request: Request) -> Response:
    port = int(preview.get("port") or 0)
    if port <= 0:
        raise HTTPException(404, "Local preview has no bound port")
    path = path or ""
    target = f"http://{PREVIEW_HOST}:{port}/{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    body = await request.body()
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in {"accept", "content-type", "user-agent"}
    }
    proxy_request = urllib.request.Request(
        target,
        data=body if body else None,
        method=request.method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
            content = upstream.read()
            status = upstream.status
            content_type = upstream.headers.get("content-type")
    except urllib.error.HTTPError as exc:
        content = exc.read()
        status = exc.code
        content_type = exc.headers.get("content-type")
    except Exception as exc:
        raise HTTPException(502, f"Local preview proxy failed: {exc}")
    return Response(content=content, status_code=status, media_type=content_type)


def setup_workspace_routes():
    router = APIRouter(prefix="/api/workspace", tags=["workspace"])

    @router.get("")
    async def get_workspace(request: Request):
        require_user(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = deepcopy(_get_workspace(data, _user_key(request)))
        return workspace

    @router.get("/artifact/{kind}/{item_id}", response_class=HTMLResponse)
    async def get_workspace_artifact(kind: str, item_id: str, request: Request):
        require_user(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, _user_key(request))
            collection = _collection(workspace, kind)
            item = next((entry for entry in collection if entry.get("id") == item_id), None)
        if not item:
            raise HTTPException(404, "Workspace item not found")
        html = _extract_html_artifact(item.get("body") or item.get("evidence") or "", kind)
        if not html:
            raise HTTPException(404, "Workspace item has no HTML artifact")
        return HTMLResponse(
            html,
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": (
                    "default-src 'none'; "
                    "script-src 'unsafe-inline'; "
                    "style-src 'unsafe-inline'; "
                    "img-src data: blob:; "
                    "connect-src 'none'; "
                    "form-action 'none'; "
                    "base-uri 'none'"
                ),
            },
        )

    @router.post("/preview/{kind}/{item_id}/start")
    async def start_workspace_preview(kind: str, item_id: str, request: Request):
        require_user(request)
        user_key = _user_key(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, user_key)
            collection = _collection(workspace, kind)
            item = deepcopy(next((entry for entry in collection if entry.get("id") == item_id), None))
        if not item:
            raise HTTPException(404, "Workspace item not found")
        if item.get("status") == "blocked" or "qa-blocked" in (item.get("tags") or []):
            raise HTTPException(400, "Blocked QA artifacts cannot be previewed")
        preview = _start_local_preview(user_key, kind, item_id, item)
        _log_workspace_event(user_key, "idea_loop.preview_started", kind, item, summary=f"Local preview started: {preview.get('url')}")
        return preview

    @router.post("/preview/{kind}/{item_id}/stop")
    async def stop_workspace_preview(kind: str, item_id: str, request: Request):
        require_user(request)
        user_key = _user_key(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, user_key)
            collection = _collection(workspace, kind)
            item = next((entry for entry in collection if entry.get("id") == item_id), None)
        if not item:
            raise HTTPException(404, "Workspace item not found")
        result = _stop_local_preview(user_key, kind, item_id)
        _log_workspace_event(user_key, "idea_loop.preview_stopped", kind, item, summary="Local preview stopped.")
        return result

    @router.api_route("/preview/{kind}/{item_id}/proxy/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def proxy_workspace_preview(kind: str, item_id: str, path: str, request: Request):
        require_user(request)
        preview = _get_item_preview(_user_key(request), kind, item_id)
        return await _proxy_local_preview_request(preview, path, request)

    @router.post("/{kind}")
    async def create_workspace_item(kind: str, item: WorkspaceItem, request: Request):
        require_user(request)
        user_key = _user_key(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, user_key)
            collection = _collection(workspace, kind)
            new_item = _item_to_dict(item)
            collection.insert(0, new_item)
            _save_all(data)
        _log_workspace_event(user_key, "workspace.item_created", kind, new_item)
        return new_item

    @router.put("/{kind}/{item_id}")
    async def update_workspace_item(kind: str, item_id: str, patch: WorkspaceItemUpdate, request: Request):
        require_user(request)
        user_key = _user_key(request)
        updated_item = None
        event_types: List[str] = []
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, user_key)
            collection = _collection(workspace, kind)
            for item in collection:
                if item.get("id") == item_id:
                    old_status = item.get("status")
                    old_evidence = item.get("evidence")
                    old_links = deepcopy(item.get("links") or {})
                    updates = patch.model_dump(exclude_unset=True)
                    for key, value in updates.items():
                        if key in {"title", "body", "status", "source", "evidence"} and isinstance(value, str):
                            value = value.strip()
                        if key == "tags" and isinstance(value, list):
                            value = [str(tag).strip() for tag in value if str(tag).strip()]
                        item[key] = value
                    item["updated_at"] = _now()
                    _save_all(data)
                    updated_item = deepcopy(item)
                    event_types.append("workspace.item_updated")
                    if old_status != item.get("status"):
                        event_types.append("workspace.status_changed")
                    if old_evidence != item.get("evidence") and item.get("evidence"):
                        event_types.append("workspace.evidence_added")
                    if old_links != (item.get("links") or {}):
                        event_types.append("workspace.link_added")
                    break
        if updated_item:
            for event_type in event_types:
                _log_workspace_event(user_key, event_type, kind, updated_item)
            return updated_item
        raise HTTPException(404, "Workspace item not found")

    @router.delete("/{kind}/{item_id}")
    async def delete_workspace_item(kind: str, item_id: str, request: Request):
        require_user(request)
        user_key = _user_key(request)
        deleted_item = None
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, user_key)
            collection = _collection(workspace, kind)
            deleted_item = deepcopy(next((item for item in collection if item.get("id") == item_id), None))
            before = len(collection)
            workspace[kind] = [item for item in collection if item.get("id") != item_id]
            if len(workspace[kind]) == before:
                raise HTTPException(404, "Workspace item not found")
            _save_all(data)
        if deleted_item:
            _log_workspace_event(user_key, "workspace.item_deleted", kind, deleted_item)
        return {"ok": True}

    return router
