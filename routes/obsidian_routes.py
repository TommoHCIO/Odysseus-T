"""Local Obsidian-style Markdown vault API.

This is separate from ``vault_routes.py`` which manages Bitwarden/Vaultwarden
password vault state. The Obsidian vault is plain Markdown under ``data/``.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from core.constants import DATA_DIR
from src.auth_helpers import effective_user, require_user
from src import obsidian_knowledge


OBSIDIAN_VAULT_ROOT = os.path.join(DATA_DIR, "obsidian-vault")
SINGLE_USER_KEY = "__single__"

_FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)")
_WIKILINK_RE = re.compile(r"!?\[\[([^\]\n]+)\]\]")
_INLINE_TAG_RE = re.compile(r"(?<![\w/])#([A-Za-z0-9][A-Za-z0-9_/-]*)")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
_TASK_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$", re.MULTILINE)


class ObsidianNoteWrite(BaseModel):
    content: str = ""


class ObsidianLogRequest(BaseModel):
    event_type: str
    title: str = ""
    summary: str = ""
    category: Optional[str] = None
    genre: Optional[str] = None
    source: str = "api"
    source_id: str = ""
    confidence: float = 1.0
    status: str = "logged"
    tags: List[str] = []
    entities: List[str] = []
    related: List[str] = []
    links: Dict[str, Any] = {}
    evidence: str = ""
    content: str = ""
    create_curation: bool = True


class ObsidianCurationAction(BaseModel):
    path: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_key(request: Request) -> str:
    return effective_user(request) or SINGLE_USER_KEY


def _safe_user_dir(user_key: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", user_key or SINGLE_USER_KEY).strip("._")
    return safe[:80] or SINGLE_USER_KEY


def _vault_root(request: Request) -> Path:
    root = Path(OBSIDIAN_VAULT_ROOT) / _safe_user_dir(_user_key(request))
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _clean_note_path(note_path: str) -> str:
    value = str(note_path or "").replace("\\", "/").strip().strip("/")
    if not value:
        raise HTTPException(400, "Note path is required")
    parts = []
    for raw_part in value.split("/"):
        part = raw_part.strip()
        if not part or part in {".", ".."}:
            raise HTTPException(400, "Invalid note path")
        if any(ord(ch) < 32 for ch in part):
            raise HTTPException(400, "Invalid note path")
        parts.append(part)
    clean = "/".join(parts)
    if not clean.lower().endswith(".md"):
        clean = f"{clean}.md"
    return clean


def _note_file(root: Path, note_path: str) -> Tuple[Path, str]:
    clean = _clean_note_path(note_path)
    target = (root / clean).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(400, "Invalid note path")
    return target, clean


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(tmp_name, path)
    finally:
        try:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
        except OSError:
            pass


def _parse_scalar(value: str) -> Any:
    raw = value.strip()
    if not raw:
        return ""
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_strip_quotes(part.strip()) for part in inner.split(",") if part.strip()]
    lowered = raw.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return _strip_quotes(raw)


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _parse_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    text = str(content or "")
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: Dict[str, Any] = {}
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        if key:
            meta[key] = _parse_scalar(value)
    return meta, text[match.end() :]


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip().lstrip("#") for item in value if str(item).strip()]
    return [part.strip().lstrip("#") for part in str(value).split(",") if part.strip()]


def _title_from_content(path: str, frontmatter: Dict[str, Any], body: str) -> str:
    if str(frontmatter.get("title") or "").strip():
        return str(frontmatter["title"]).strip()
    match = re.search(r"^#\s+(.+?)\s*$", body, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return Path(path).stem.replace("-", " ").replace("_", " ").strip() or "Untitled"


def _extract_wikilinks(content: str) -> List[Dict[str, str]]:
    links = []
    seen = set()
    for match in _WIKILINK_RE.finditer(content or ""):
        raw = match.group(1).strip()
        target = raw.split("|", 1)[0].split("#", 1)[0].split("^", 1)[0].strip()
        alias = raw.split("|", 1)[1].strip() if "|" in raw else ""
        if not target or "://" in target:
            continue
        key = target.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append({"target": target, "alias": alias})
    return links


def _extract_headings(body: str) -> List[Dict[str, Any]]:
    return [
        {"level": len(match.group(1)), "text": match.group(2).strip()}
        for match in _HEADING_RE.finditer(body or "")
    ]


def _extract_tasks(body: str) -> List[Dict[str, Any]]:
    return [
        {"done": match.group(1).lower() == "x", "text": match.group(2).strip()}
        for match in _TASK_RE.finditer(body or "")
    ]


def _canonical_link_target(target: str) -> str:
    value = str(target or "").replace("\\", "/").strip().strip("/")
    if not value:
        return ""
    if not value.lower().endswith(".md"):
        value = f"{value}.md"
    return value


def _note_summary(root: Path, file_path: Path) -> Dict[str, Any]:
    rel = file_path.relative_to(root).as_posix()
    content = file_path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = _parse_frontmatter(content)
    frontmatter_tags = _as_list(frontmatter.get("tags"))
    inline_tags = [tag for tag in _INLINE_TAG_RE.findall(body) if tag]
    tags = sorted(set(frontmatter_tags + inline_tags), key=str.lower)
    stat = file_path.stat()
    return {
        "path": rel,
        "title": _title_from_content(rel, frontmatter, body),
        "frontmatter": frontmatter,
        "aliases": _as_list(frontmatter.get("aliases") or frontmatter.get("alias")),
        "tags": tags,
        "wikilinks": _extract_wikilinks(content),
        "backlinks": [],
        "outgoing_paths": [],
        "headings": _extract_headings(body),
        "tasks": _extract_tasks(body),
        "size": stat.st_size,
        "updated_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def _list_note_files(root: Path) -> List[Path]:
    if not root.exists():
        return []
    return sorted(
        (path for path in root.rglob("*.md") if path.is_file()),
        key=lambda path: path.relative_to(root).as_posix().lower(),
    )


def _resolve_link(target: str, path_map: Dict[str, str], stem_map: Dict[str, str]) -> str:
    canonical = _canonical_link_target(target)
    lowered = canonical.lower()
    if lowered in path_map:
        return path_map[lowered]
    if "/" not in canonical:
        stem = Path(canonical).stem.lower()
        if stem in stem_map:
            return stem_map[stem]
    return canonical


def _index_vault(root: Path) -> Dict[str, Any]:
    notes = [_note_summary(root, path) for path in _list_note_files(root)]
    path_map = {note["path"].lower(): note["path"] for note in notes}
    stem_map: Dict[str, str] = {}
    for note in notes:
        stem_map.setdefault(Path(note["path"]).stem.lower(), note["path"])

    note_by_path = {note["path"]: note for note in notes}
    edges = []
    missing_nodes: Dict[str, Dict[str, Any]] = {}

    for note in notes:
        outgoing = []
        for link in note["wikilinks"]:
            target_path = _resolve_link(link["target"], path_map, stem_map)
            if not target_path:
                continue
            outgoing.append(target_path)
            target_id = target_path if target_path in note_by_path else f"missing:{target_path}"
            if target_path not in note_by_path:
                missing_nodes[target_id] = {
                    "id": target_id,
                    "path": target_path,
                    "title": Path(target_path).stem.replace("-", " ").replace("_", " "),
                    "kind": "missing",
                    "tags": [],
                }
            else:
                note_by_path[target_path].setdefault("backlinks", []).append(note["path"])
            edges.append({"from": note["path"], "to": target_id, "type": "wikilink"})
        note["outgoing_paths"] = sorted(set(outgoing), key=str.lower)

    for note in notes:
        note["backlinks"] = sorted(set(note.get("backlinks") or []), key=str.lower)

    nodes = [
        {
            "id": note["path"],
            "path": note["path"],
            "title": note["title"],
            "kind": "note",
            "tags": note["tags"],
        }
        for note in notes
    ]
    nodes.extend(missing_nodes.values())
    return {"notes": notes, "graph": {"nodes": nodes, "edges": edges}}


def _frontmatter_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(str(value), ensure_ascii=False)


def _frontmatter_list(values: List[str]) -> str:
    return "[" + ", ".join(json.dumps(str(value), ensure_ascii=False) for value in values if str(value).strip()) + "]"


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return (slug or "untitled")[:70].strip("-") or "untitled"


def _workspace_note_path(kind: str, item: Dict[str, Any]) -> str:
    item_id = str(item.get("id") or "")[:8] or "item"
    return f"Workspace/{kind}/{_slug(item.get('title') or kind)}-{item_id}.md"


def _workspace_item_markdown(kind: str, item: Dict[str, Any]) -> str:
    tags = ["odysseus/workspace", kind]
    tags.extend(str(tag).strip() for tag in item.get("tags") or [] if str(tag).strip())
    unique_tags = sorted(set(tags), key=str.lower)
    lines = [
        "---",
        f"title: {_frontmatter_scalar(item.get('title') or 'Untitled')}",
        "type: workspace-item",
        f"collection: {_frontmatter_scalar(kind)}",
        f"status: {_frontmatter_scalar(item.get('status') or 'open')}",
        f"source: {_frontmatter_scalar(item.get('source') or 'workspace')}",
        f"source_id: {_frontmatter_scalar(item.get('id') or '')}",
        "odysseus_managed: true",
        f"synced_at: {_frontmatter_scalar(_now())}",
        f"tags: {_frontmatter_list(unique_tags)}",
        "---",
        "",
        f"# {item.get('title') or 'Untitled'}",
        "",
        f"Status: `{item.get('status') or 'open'}`",
        f"Collection: `{kind}`",
        "",
        str(item.get("body") or "").strip() or "_No body captured._",
    ]
    evidence = str(item.get("evidence") or "").strip()
    if evidence:
        lines.extend(["", "## Evidence", "", evidence])
    links = item.get("links")
    if isinstance(links, dict) and links:
        lines.extend(["", "## Links", "", "```json", json.dumps(links, indent=2, ensure_ascii=False), "```"])
    return "\n".join(lines).rstrip() + "\n"


def _pending_curation_notes(root: Path) -> List[Dict[str, Any]]:
    pending = root / "Odysseus" / "Curation" / "Pending"
    if not pending.exists():
        return []
    notes = []
    for path in sorted(pending.rglob("*.md"), key=lambda p: p.relative_to(root).as_posix().lower()):
        try:
            notes.append(_note_summary(root, path))
        except Exception:
            continue
    return notes


def _curation_target(root: Path, note_path: str, status: str) -> Tuple[Path, str]:
    path, clean = _note_file(root, note_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Curation note not found")
    if not clean.startswith("Odysseus/Curation/Pending/"):
        raise HTTPException(400, "Only pending curation notes can be changed")
    content = path.read_text(encoding="utf-8", errors="replace")
    meta, _ = _parse_frontmatter(content)
    genre = str(meta.get("genre") or "event").strip() or "event"
    if status == "approved":
        target = root / "Odysseus" / "Knowledge" / _slug(genre) / path.name
    else:
        target = root / "Odysseus" / "Curation" / "Rejected" / path.name
    if re.search(r"^status:\s*.+$", content, re.MULTILINE):
        content = re.sub(r"^status:\s*.+$", f"status: {status}", content, count=1, flags=re.MULTILINE)
    def _replace_tags(match):
        values = re.findall(r'"([^"]+)"|([^,\[\]\s]+)', match.group(1))
        tags = [quoted or bare for quoted, bare in values]
        tags = [tag for tag in tags if tag not in {"pending", "approved", "rejected"}]
        tags.append(status)
        return "tags: " + _frontmatter_list(tags)

    content = re.sub(r"^tags:\s*\[(.*?)\]\s*$", _replace_tags, content, count=1, flags=re.MULTILINE)
    target.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(path, content)
    shutil.move(str(path), str(target))
    return target, target.relative_to(root).as_posix()


def setup_obsidian_routes():
    router = APIRouter(prefix="/api/obsidian", tags=["obsidian"])

    @router.get("")
    async def get_obsidian_index(request: Request):
        require_user(request)
        root = _vault_root(request)
        indexed = _index_vault(root)
        return {"root": str(root), **indexed}

    @router.get("/taxonomy")
    async def get_obsidian_taxonomy(request: Request):
        require_user(request)
        return obsidian_knowledge.taxonomy()

    @router.post("/log")
    async def log_obsidian_event(payload: ObsidianLogRequest, request: Request):
        require_user(request)
        return obsidian_knowledge.log_event(
            user_key=_user_key(request),
            event_type=payload.event_type,
            title=payload.title,
            summary=payload.summary,
            category=payload.category,
            genre=payload.genre,
            source=payload.source,
            source_id=payload.source_id,
            confidence=payload.confidence,
            status=payload.status,
            tags=payload.tags,
            entities=payload.entities,
            related=payload.related,
            links=payload.links,
            evidence=payload.evidence,
            content=payload.content,
            vault_root=OBSIDIAN_VAULT_ROOT,
            create_curation=payload.create_curation,
        )

    @router.get("/search")
    async def search_obsidian_knowledge(
        request: Request,
        q: str = Query(default=""),
        limit: int = Query(default=10, ge=1, le=50),
    ):
        require_user(request)
        return obsidian_knowledge.search_knowledge(
            _user_key(request),
            q,
            limit=limit,
            vault_root=OBSIDIAN_VAULT_ROOT,
        )

    @router.get("/curation/pending")
    async def get_pending_curation(request: Request):
        require_user(request)
        return {"notes": _pending_curation_notes(_vault_root(request))}

    @router.post("/curation/approve")
    async def approve_curation(payload: ObsidianCurationAction, request: Request):
        require_user(request)
        root = _vault_root(request)
        target, rel = _curation_target(root, payload.path, "approved")
        return {"ok": True, "path": rel, "title": _note_summary(root, target).get("title") or target.stem}

    @router.post("/curation/reject")
    async def reject_curation(payload: ObsidianCurationAction, request: Request):
        require_user(request)
        root = _vault_root(request)
        target, rel = _curation_target(root, payload.path, "rejected")
        return {"ok": True, "path": rel, "title": _note_summary(root, target).get("title") or target.stem}

    @router.get("/notes/{note_path:path}")
    async def get_obsidian_note(note_path: str, request: Request):
        require_user(request)
        root = _vault_root(request)
        path, clean = _note_file(root, note_path)
        if not path.exists() or not path.is_file():
            raise HTTPException(404, "Note not found")
        summary = _note_summary(root, path)
        indexed = _index_vault(root)
        for note in indexed["notes"]:
            if note["path"] == clean:
                summary["backlinks"] = note["backlinks"]
                summary["outgoing_paths"] = note["outgoing_paths"]
                break
        return {**summary, "content": path.read_text(encoding="utf-8", errors="replace")}

    @router.put("/notes/{note_path:path}")
    async def write_obsidian_note(note_path: str, payload: ObsidianNoteWrite, request: Request):
        require_user(request)
        root = _vault_root(request)
        path, _ = _note_file(root, note_path)
        _atomic_write_text(path, payload.content)
        return await get_obsidian_note(path.relative_to(root).as_posix(), request)

    @router.delete("/notes/{note_path:path}")
    async def delete_obsidian_note(note_path: str, request: Request):
        require_user(request)
        root = _vault_root(request)
        path, _ = _note_file(root, note_path)
        if not path.exists() or not path.is_file():
            raise HTTPException(404, "Note not found")
        path.unlink()
        return {"ok": True}

    @router.post("/workspace/sync")
    async def sync_workspace_to_obsidian(request: Request):
        require_user(request)
        from routes import workspace_routes

        root = _vault_root(request)
        user_key = _user_key(request)
        created = 0
        updated = 0
        skipped = 0
        notes = []
        with workspace_routes._WORKSPACE_LOCK:
            data = workspace_routes._load_all()
            workspace = workspace_routes._get_workspace(data, user_key)
            workspace_snapshot = {
                kind: list(workspace.get(kind) or [])
                for kind in workspace_routes.ALLOWED_KINDS
            }

        for kind, items in workspace_snapshot.items():
            for item in items:
                note_path = _workspace_note_path(kind, item)
                path, clean = _note_file(root, note_path)
                if path.exists():
                    existing_meta, _ = _parse_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
                    if not existing_meta.get("odysseus_managed"):
                        skipped += 1
                        notes.append({"path": clean, "status": "skipped-unmanaged"})
                        continue
                    status = "updated"
                    updated += 1
                else:
                    status = "created"
                    created += 1
                _atomic_write_text(path, _workspace_item_markdown(kind, item))
                notes.append({"path": clean, "status": status})

        obsidian_knowledge.log_event(
            user_key=user_key,
            event_type="workspace.sync_to_obsidian",
            title="Workspace synced to Obsidian",
            summary=f"Created {created}, updated {updated}, skipped {skipped} workspace note(s).",
            category="workspace",
            genre="event",
            source="obsidian",
            source_id="workspace-sync",
            tags=["odysseus/workspace", "odysseus/sync"],
            links={"notes": notes},
            vault_root=OBSIDIAN_VAULT_ROOT,
            create_curation=False,
        )

        return {
            "ok": True,
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "notes": notes,
        }

    return router
