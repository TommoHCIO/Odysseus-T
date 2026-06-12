"""Canonical Obsidian knowledge logging for Odysseus.

The vault is intentionally plain Markdown. Raw knowledge is append-only in
daily journals; curated knowledge can be proposed into pending notes.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Dict, Iterable, List, Optional
import uuid

from core.constants import DATA_DIR


OBSIDIAN_VAULT_ROOT = os.path.join(DATA_DIR, "obsidian-vault")
SINGLE_USER_KEY = "__single__"
MAX_FIELD_CHARS = 6000
MAX_CONTENT_CHARS = 12000

CORE_GENRES = {
    "event",
    "problem",
    "verified-solution",
    "preference",
    "decision",
    "requirement",
    "constraint",
    "artifact",
    "code-change",
    "test-evidence",
    "browser-evidence",
    "error",
    "incident",
    "runbook",
    "deployment-note",
    "research-finding",
    "source-reference",
    "user-profile",
    "project-context",
    "risk",
    "todo",
    "lesson-learned",
    "unresolved-question",
    "automation-rule",
    "security-note",
    "integration-note",
    "environment-state",
    "performance-note",
    "regression",
    "workaround",
    "design-note",
}

KNOWN_EVENT_TYPES = {
    "chat.user_message", "chat.assistant_response", "chat.session_created", "chat.session_renamed",
    "chat.session_archived", "chat.attachment_used", "chat.context_injected", "chat.incognito_skipped",
    "chat.model_changed", "chat.user_correction",
    "council.run_started", "council.agent_turn", "council.debate_point", "council.challenge",
    "council.consensus_update", "council.consensus_reached", "council.consensus_failed",
    "council.idea_created", "council.sketch_created", "council.review_created", "council.qa_passed",
    "council.qa_blocked", "council.tool_used", "council.revision_requested",
    "council.final_recommendation",
    "idea_loop.request_created", "idea_loop.idea_approved", "idea_loop.sketch_approved",
    "idea_loop.review_approved", "idea_loop.card_updated", "idea_loop.card_deleted",
    "idea_loop.artifact_attached", "idea_loop.preview_started", "idea_loop.preview_failed",
    "idea_loop.preview_stopped",
    "workspace.item_created", "workspace.item_updated", "workspace.item_deleted",
    "workspace.status_changed", "workspace.evidence_added", "workspace.link_added",
    "workspace.sync_to_obsidian", "workspace.graph_link_created",
    "agent.run_started", "agent.run_completed", "agent.run_failed", "agent.context_injected", "agent.tool_plan",
    "agent.tool_call", "agent.tool_result", "agent.retry", "agent.blocked", "agent.recovered",
    "agent.final_answer",
    "tool.shell_command", "tool.shell_result", "tool.browser_action", "tool.browser_screenshot",
    "tool.file_read", "tool.file_write", "tool.apply_patch", "tool.test_run", "tool.build_run",
    "tool.lint_run", "tool.git_status", "tool.git_commit", "tool.git_push",
    "code.problem_found", "code.fix_applied", "code.regression_found", "code.regression_fixed",
    "code.refactor_decision", "code.architecture_decision", "code.api_contract",
    "code.schema_change", "code.migration_note", "code.dependency_change",
    "research.query", "research.source_found", "research.source_rejected", "research.finding",
    "research.summary", "research.citation", "research.followup_question",
    "memory.preference_detected", "memory.fact_detected", "memory.goal_detected",
    "memory.project_context_detected", "memory.promoted", "memory.rejected", "memory.audit_result",
    "memory.conflict_detected",
    "settings.preference_changed", "settings.tool_enabled", "settings.tool_disabled",
    "settings.model_preference_changed", "settings.theme_changed", "settings.auth_changed",
    "documents.created", "documents.updated", "documents.deleted", "documents.summary",
    "documents.exported", "documents.ai_edit",
    "notes.created", "notes.updated", "notes.completed", "notes.reminder_set",
    "tasks.created", "tasks.completed", "calendar.event_created", "calendar.event_updated",
    "calendar.reminder_fired",
    "email.received", "email.sent", "email.reply_drafted", "email.summary",
    "email.urgency_detected", "contacts.created", "contacts.updated",
    "media.image_generated", "media.image_edited", "media.gallery_saved", "media.vision_result",
    "media.ocr_result",
    "models.model_downloaded", "models.model_served", "models.model_failed",
    "models.endpoint_added", "models.endpoint_failed", "cookbook.recipe_run",
    "mcp.server_added", "mcp.server_started", "mcp.server_failed", "mcp.tool_discovered",
    "mcp.tool_failed", "webhook.received", "webhook.triggered",
    "security.login", "security.logout", "security.permission_denied", "security.secret_redacted",
    "security.suspicious_input", "security.auth_error",
    "system.startup", "system.shutdown", "system.health_check", "system.docker_log",
    "system.error_log", "system.performance_warning", "system.dependency_error",
    "artifact.package_created", "artifact.local_preview_created", "artifact.qa_evidence",
    "artifact.deployment_note", "artifact.user_documentation", "artifact.operational_documentation",
    "knowledge.problem", "knowledge.solution", "knowledge.verified_fix", "knowledge.preference",
    "knowledge.lesson", "knowledge.runbook", "knowledge.decision", "knowledge.open_question",
    "knowledge.risk", "knowledge.constraint", "knowledge.acceptance_criteria", "knowledge.reference",
}

EVENT_NAME_TO_TYPE = {
    "message_sent": "chat.user_message",
    "session_created": "chat.session_created",
    "memory_added": "memory.promoted",
    "skill_added": "mcp.tool_discovered",
}

CURATION_TYPES = {
    "knowledge.problem",
    "knowledge.solution",
    "knowledge.verified_fix",
    "knowledge.preference",
    "knowledge.lesson",
    "knowledge.runbook",
    "knowledge.decision",
    "knowledge.open_question",
    "knowledge.risk",
    "knowledge.constraint",
    "knowledge.acceptance_criteria",
    "knowledge.reference",
    "code.fix_applied",
    "code.regression_fixed",
    "council.qa_passed",
}

_SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}"),
    re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd|cookie|authorization)\b\s*[:=]\s*['\"]?[^'\"\s,}]{6,}"),
    re.compile(r"\b(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_=-]{12,}\b", re.IGNORECASE),
    re.compile(r"\b[A-Za-z0-9+/]{32,}={0,2}\b"),
]


def safe_user_dir(user_key: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", user_key or SINGLE_USER_KEY).strip("._")
    return safe[:80] or SINGLE_USER_KEY


def vault_root_for_user(user_key: str, vault_root: Optional[str] = None) -> Path:
    root = Path(vault_root or OBSIDIAN_VAULT_ROOT) / safe_user_dir(user_key or SINGLE_USER_KEY)
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _frontmatter_list(values: Iterable[Any]) -> str:
    return "[" + ", ".join(_json(str(value)) for value in values if str(value).strip()) + "]"


def _frontmatter_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return _json(str(value or ""))


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return (slug or "untitled")[:70].strip("-") or "untitled"


def _truncate(value: str, limit: int = MAX_FIELD_CHARS) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n\n[...truncated {len(text) - limit} chars...]"


def redact_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            key_text = str(key)
            if re.search(r"(?i)(api[_-]?key|token|secret|password|passwd|cookie|authorization)", key_text):
                redacted[key_text] = "[REDACTED]"
            else:
                redacted[key_text] = redact_secrets(item)
        return redacted
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return [redact_secrets(item) for item in value]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda m: f"{m.group(1)}[REDACTED]" if m.lastindex else "[REDACTED]", text)
    return text


def normalize_event_type(event_type: str) -> str:
    value = str(event_type or "").strip().lower()
    if value in EVENT_NAME_TO_TYPE:
        value = EVENT_NAME_TO_TYPE[value]
    if value in KNOWN_EVENT_TYPES:
        return value
    return "unclassified.event"


def infer_category(event_type: str, category: Optional[str] = None) -> str:
    if category and re.match(r"^[a-z0-9_-]+$", str(category).strip().lower()):
        return str(category).strip().lower()
    if "." in event_type:
        return event_type.split(".", 1)[0]
    return "unclassified"


def normalize_genre(genre: Optional[str], event_type: str) -> str:
    value = str(genre or "").strip().lower()
    if value in CORE_GENRES:
        return value
    if event_type.startswith("knowledge.preference") or event_type == "memory.preference_detected":
        return "preference"
    if event_type in {"knowledge.verified_fix", "code.fix_applied", "code.regression_fixed"}:
        return "verified-solution"
    if event_type.endswith("_failed") or event_type in {"system.error_log", "security.auth_error"}:
        return "error"
    if event_type.startswith("artifact."):
        return "artifact"
    if event_type.startswith("research."):
        return "research-finding"
    return "event"


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def _append_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _journal_path(root: Path, now: datetime) -> Path:
    return root / "Odysseus" / "Journal" / f"{now:%Y}" / f"{now:%m}" / f"{now:%Y-%m-%d}.md"


def _ensure_journal(path: Path, now: datetime) -> None:
    if path.exists():
        return
    content = "\n".join([
        "---",
        f"title: {_frontmatter_scalar(f'Odysseus Journal {now:%Y-%m-%d}')}",
        "category: journal",
        "genre: event",
        "type: odysseus.daily_journal",
        "source: obsidian",
        f"source_id: {_frontmatter_scalar(now.strftime('%Y-%m-%d'))}",
        "confidence: 1",
        "status: active",
        f"created_at: {_frontmatter_scalar(now.isoformat())}",
        "tags: [\"odysseus/journal\", \"odysseus/canonical\"]",
        "entities: []",
        "related: []",
        "---",
        "",
        f"# Odysseus Journal {now:%Y-%m-%d}",
        "",
    ])
    _atomic_write_text(path, content)


def _event_block(
    *,
    event_id: str,
    timestamp: str,
    title: str,
    summary: str,
    metadata: Dict[str, Any],
    content: str,
    evidence: str,
) -> str:
    lines = [
        "",
        f"## {timestamp[11:19]} {title} ^{event_id}",
        "",
        f"- Category: `{metadata['category']}`",
        f"- Genre: `{metadata['genre']}`",
        f"- Type: `{metadata['type']}`",
        f"- Source: `{metadata['source']}`",
        f"- Source ID: `{metadata['source_id']}`",
        f"- Status: `{metadata['status']}`",
        f"- Confidence: `{metadata['confidence']}`",
        f"- Tags: {', '.join(f'#{tag}' for tag in metadata['tags']) if metadata['tags'] else '_none_'}",
        "",
        "### Summary",
        "",
        summary or "_No summary supplied._",
        "",
    ]
    if content:
        lines.extend(["### Content", "", _truncate(content, MAX_CONTENT_CHARS), ""])
    if evidence:
        lines.extend(["### Evidence", "", _truncate(evidence), ""])
    lines.extend([
        "### Properties",
        "",
        "```json",
        json.dumps(metadata, indent=2, ensure_ascii=False),
        "```",
        "",
    ])
    return "\n".join(lines)


def _curation_path(root: Path, genre: str, title: str, event_id: str) -> Path:
    return root / "Odysseus" / "Curation" / "Pending" / f"{_slug(genre)}-{_slug(title)}-{event_id[-6:]}.md"


def _write_curation_note(root: Path, metadata: Dict[str, Any], title: str, summary: str, content: str, evidence: str) -> Optional[str]:
    if metadata["type"] not in CURATION_TYPES and metadata["genre"] not in {
        "problem",
        "verified-solution",
        "preference",
        "decision",
        "runbook",
        "lesson-learned",
        "risk",
        "constraint",
        "unresolved-question",
    }:
        return None
    path = _curation_path(root, metadata["genre"], title, metadata["event_id"])
    note = "\n".join([
        "---",
        f"title: {_frontmatter_scalar(title)}",
        f"category: {_frontmatter_scalar(metadata['category'])}",
        f"genre: {_frontmatter_scalar(metadata['genre'])}",
        f"type: {_frontmatter_scalar(metadata['type'])}",
        f"source: {_frontmatter_scalar(metadata['source'])}",
        f"source_id: {_frontmatter_scalar(metadata['source_id'])}",
        f"confidence: {_frontmatter_scalar(metadata['confidence'])}",
        "status: pending",
        f"created_at: {_frontmatter_scalar(metadata['created_at'])}",
        f"tags: {_frontmatter_list(metadata['tags'] + ['odysseus/curation', 'pending'])}",
        f"entities: {_frontmatter_list(metadata['entities'])}",
        f"related: {_frontmatter_list(metadata['related'])}",
        f"journal_event: {_frontmatter_scalar(metadata['anchor_ref'])}",
        "odysseus_managed: true",
        "---",
        "",
        f"# {title}",
        "",
        "## Summary",
        "",
        summary or "_No summary supplied._",
        "",
        "## Proposed Knowledge",
        "",
        _truncate(content or summary or evidence or "", MAX_CONTENT_CHARS),
        "",
    ])
    if evidence:
        note += "\n## Evidence\n\n" + _truncate(evidence) + "\n"
    _atomic_write_text(path, note)
    return path.relative_to(root).as_posix()


def log_event(
    *,
    user_key: str = SINGLE_USER_KEY,
    event_type: str,
    title: str = "",
    summary: str = "",
    category: Optional[str] = None,
    genre: Optional[str] = None,
    source: str = "app",
    source_id: str = "",
    confidence: float = 1.0,
    status: str = "logged",
    tags: Optional[List[str]] = None,
    entities: Optional[List[str]] = None,
    related: Optional[List[str]] = None,
    links: Optional[Dict[str, Any]] = None,
    evidence: str = "",
    content: str = "",
    vault_root: Optional[str] = None,
    create_curation: bool = True,
) -> Dict[str, Any]:
    now = _now()
    event_id = f"ody-{now:%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
    normalized_type = normalize_event_type(event_type)
    clean_tags = sorted(set(str(tag).strip().lstrip("#") for tag in (tags or []) if str(tag).strip()), key=str.lower)
    clean_entities = sorted(set(str(entity).strip() for entity in (entities or []) if str(entity).strip()), key=str.lower)
    clean_related = sorted(set(str(item).strip() for item in (related or []) if str(item).strip()), key=str.lower)

    redacted_links = redact_secrets(links or {})
    redacted_summary = _truncate(str(redact_secrets(summary or "")))
    redacted_content = _truncate(str(redact_secrets(content or "")), MAX_CONTENT_CHARS)
    redacted_evidence = _truncate(str(redact_secrets(evidence or "")))
    redacted_title = _truncate(str(redact_secrets(title or normalized_type.replace(".", " ").title())), 180)

    metadata = {
        "event_id": event_id,
        "created_at": now.isoformat(),
        "category": infer_category(normalized_type, category),
        "genre": normalize_genre(genre, normalized_type),
        "type": normalized_type,
        "requested_type": str(event_type or ""),
        "source": str(redact_secrets(source or "app")),
        "source_id": str(redact_secrets(source_id or "")),
        "confidence": max(0, min(float(confidence or 0), 1)),
        "status": str(redact_secrets(status or "logged")),
        "tags": clean_tags,
        "entities": clean_entities,
        "related": clean_related,
        "links": redacted_links,
    }
    root = vault_root_for_user(user_key, vault_root=vault_root)
    journal_path = _journal_path(root, now)
    _ensure_journal(journal_path, now)
    metadata["note_path"] = journal_path.relative_to(root).as_posix()
    metadata["anchor"] = event_id
    metadata["anchor_ref"] = f"{metadata['note_path']}#{event_id}"
    block = _event_block(
        event_id=event_id,
        timestamp=now.isoformat(),
        title=redacted_title,
        summary=redacted_summary,
        metadata=metadata,
        content=redacted_content,
        evidence=redacted_evidence,
    )
    _append_text(journal_path, block)
    curation_path = None
    if create_curation:
        curation_path = _write_curation_note(root, metadata, redacted_title, redacted_summary, redacted_content, redacted_evidence)
    return {
        "ok": True,
        "event_id": event_id,
        "type": normalized_type,
        "requested_type": metadata["requested_type"],
        "note_path": metadata["note_path"],
        "anchor": event_id,
        "anchor_ref": metadata["anchor_ref"],
        "curation_path": curation_path,
    }


def log_app_event(owner: Optional[str], event_name: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = metadata or {}
    event_type = EVENT_NAME_TO_TYPE.get(event_name, event_name)
    return log_event(
        user_key=owner or SINGLE_USER_KEY,
        event_type=event_type,
        title=str(payload.get("title") or event_type.replace(".", " ").title()),
        summary=str(payload.get("summary") or payload.get("message") or ""),
        source=str(payload.get("source") or "event_bus"),
        source_id=str(payload.get("source_id") or payload.get("session_id") or ""),
        tags=[str(event_name).replace("_", "-"), "odysseus/event"],
        links={key: value for key, value in payload.items() if key not in {"title", "summary", "message"}},
        content=str(payload.get("content") or payload.get("message") or ""),
        create_curation=False,
    )


def _read_markdown_notes(root: Path) -> List[Path]:
    if not root.exists():
        return []
    return sorted(root.rglob("*.md"), key=lambda path: path.relative_to(root).as_posix().lower())


def search_knowledge(user_key: str, query: str, *, limit: int = 10, vault_root: Optional[str] = None) -> Dict[str, Any]:
    terms = [term.lower() for term in re.findall(r"[A-Za-z0-9_/-]{2,}", query or "")]
    root = vault_root_for_user(user_key, vault_root=vault_root)
    results = []
    for path in _read_markdown_notes(root):
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        haystack = f"{rel}\n{text}".lower()
        score = 0
        reasons = []
        for term in terms:
            count = haystack.count(term)
            if count:
                score += count
                reasons.append(term)
        if not terms:
            score = 1
        if score:
            if "/Knowledge/" in rel:
                score += 50
            elif "/Curation/Pending/" in rel:
                score += 25
            elif "/Journal/" in rel:
                score += 5
            snippet = text[:900].strip()
            results.append({
                "path": rel,
                "title": _extract_title(text, Path(rel).stem),
                "score": score,
                "reason": ", ".join(sorted(set(reasons))) if reasons else "recent note",
                "snippet": snippet,
            })
    results.sort(key=lambda item: (-item["score"], item["path"]))
    return {"query": query, "results": results[: max(1, min(int(limit or 10), 50))]}


def _extract_title(text: str, fallback: str) -> str:
    match = re.search(r"^title:\s*(.+?)\s*$", text, re.MULTILINE)
    if match:
        return match.group(1).strip().strip("'\"")
    match = re.search(r"^#\s+(.+?)\s*$", text, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return fallback.replace("-", " ").replace("_", " ")


def taxonomy() -> Dict[str, Any]:
    return {
        "genres": sorted(CORE_GENRES),
        "event_types": sorted(KNOWN_EVENT_TYPES),
        "unclassified_type": "unclassified.event",
    }
