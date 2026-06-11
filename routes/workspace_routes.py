"""Unified Workspace state API.

Durable first-slice storage for the workspace surfaces described in
``docs/superpowers/specs/2026-06-10-unified-workspace-design.md``.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import re
import threading
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from core.atomic_io import atomic_write_json
from core.constants import DATA_DIR
from src.auth_helpers import effective_user, require_user


WORKSPACE_FILE = os.path.join(DATA_DIR, "workspace.json")
_WORKSPACE_LOCK = threading.RLock()
SINGLE_USER_KEY = "__single__"

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

    @router.post("/{kind}")
    async def create_workspace_item(kind: str, item: WorkspaceItem, request: Request):
        require_user(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, _user_key(request))
            collection = _collection(workspace, kind)
            new_item = _item_to_dict(item)
            collection.insert(0, new_item)
            _save_all(data)
        return new_item

    @router.put("/{kind}/{item_id}")
    async def update_workspace_item(kind: str, item_id: str, patch: WorkspaceItemUpdate, request: Request):
        require_user(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, _user_key(request))
            collection = _collection(workspace, kind)
            for item in collection:
                if item.get("id") == item_id:
                    updates = patch.model_dump(exclude_unset=True)
                    for key, value in updates.items():
                        if key in {"title", "body", "status", "source", "evidence"} and isinstance(value, str):
                            value = value.strip()
                        if key == "tags" and isinstance(value, list):
                            value = [str(tag).strip() for tag in value if str(tag).strip()]
                        item[key] = value
                    item["updated_at"] = _now()
                    _save_all(data)
                    return item
        raise HTTPException(404, "Workspace item not found")

    @router.delete("/{kind}/{item_id}")
    async def delete_workspace_item(kind: str, item_id: str, request: Request):
        require_user(request)
        with _WORKSPACE_LOCK:
            data = _load_all()
            workspace = _get_workspace(data, _user_key(request))
            collection = _collection(workspace, kind)
            before = len(collection)
            workspace[kind] = [item for item in collection if item.get("id") != item_id]
            if len(workspace[kind]) == before:
                raise HTTPException(404, "Workspace item not found")
            _save_all(data)
        return {"ok": True}

    return router
