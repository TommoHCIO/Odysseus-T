import json
import logging
import os
import re
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


logger = logging.getLogger(__name__)

SINGLE_USER_KEY = "__single__"
MEMORY_NOTE_TYPE = "memory.entry"
MEMORY_MIGRATION_NAME = "brain-to-obsidian.json"

CATEGORY_TO_GENRE = {
    "identity": "user-profile",
    "preference": "preference",
    "project": "project-context",
    "goal": "requirement",
    "task": "todo",
    "contact": "user-profile",
    "fact": "source-reference",
}


def tokenize(text: str) -> List[str]:
    """Simple tokenizer that splits on whitespace and removes punctuation."""
    return [word.strip('.,!?";') for word in text.split()]


def get_text_similarity(text1: str, text2: str) -> float:
    """Calculate Jaccard similarity between two texts."""
    if not text1 or not text2:
        return 0.0
    tokens1 = set(tokenize(text1.lower()))
    tokens2 = set(tokenize(text2.lower()))
    if not tokens1 and not tokens2:
        return 1.0
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    return len(intersection) / len(union)


def _safe_user_dir(user_key: Optional[str]) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", user_key or SINGLE_USER_KEY).strip("._")
    return safe[:80] or SINGLE_USER_KEY


def _slug(value: str, fallback: str = "memory") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return (slug or fallback)[:70].strip("-") or fallback


def _frontmatter_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value or ""), ensure_ascii=False)


def _frontmatter_list(values: Iterable[Any]) -> str:
    out = []
    for value in values or []:
        text = str(value or "").strip()
        if text:
            out.append(json.dumps(text, ensure_ascii=False))
    return "[" + ", ".join(out) + "]"


def _parse_scalar(value: str) -> Any:
    raw = str(value or "").strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
        return [part.strip().strip("\"'") for part in inner.split(",") if part.strip()]
    lowered = raw.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none", "~"}:
        return None
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
        try:
            return json.loads(raw)
        except Exception:
            return raw[1:-1]
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


def _parse_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    text = str(content or "")
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    raw = text[3:end].lstrip("\n")
    body = text[end + 4 :].lstrip("\n")
    meta: Dict[str, Any] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        if key:
            meta[key] = _parse_scalar(value)
    return meta, body


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


def _extract_section(body: str, heading: str) -> str:
    pattern = re.compile(rf"^##\s+{re.escape(heading)}\s*$", re.I | re.M)
    match = pattern.search(body or "")
    if not match:
        return ""
    start = match.end()
    next_heading = re.search(r"^##\s+", body[start:], re.M)
    end = start + next_heading.start() if next_heading else len(body)
    return body[start:end].strip()


class MemoryManager:
    """Obsidian-backed compatibility implementation for durable knowledge."""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.memory_file = os.path.join(data_dir, "memory.json")
        self.obsidian_root = Path(data_dir) / "obsidian-vault"
        self.ensure_file_exists()
        self.migrate_legacy_memory()

    # ------------------------------------------------------------------
    # Legacy command helpers
    # ------------------------------------------------------------------

    def extract_memory_from_chat(self, chat_history: List[Dict], session_id: str = None) -> List[Dict]:
        memories = []
        for msg in chat_history:
            if msg.get("role") != "assistant":
                continue
            for line in str(msg.get("content", "")).split("\n"):
                line = line.strip()
                if re.match(r"^[-*]|\d+\.", line):
                    text_match = re.match(r"^(?:[-*]|\d+\.)\s*(.*)", line)
                    if text_match and text_match.group(1).strip():
                        memories.append({
                            "text": text_match.group(1).strip(),
                            "timestamp": int(datetime.now().timestamp()),
                            "session_id": session_id,
                        })
        return memories

    def process_inline_memory_command(self, message: str) -> Tuple[bool, str]:
        pattern = r"^(?:remember|memorize|save|note|store)[:\-]?\s+(.+)$"
        match = re.match(pattern, message.strip(), re.IGNORECASE)
        return (True, match.group(1).strip()) if match else (False, "")

    # ------------------------------------------------------------------
    # Files and migration
    # ------------------------------------------------------------------

    def ensure_file_exists(self):
        if not os.path.exists(self.memory_file):
            os.makedirs(os.path.dirname(self.memory_file), exist_ok=True)
            with open(self.memory_file, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)

    def _vault_root_for_owner(self, owner: Optional[str]) -> Path:
        root = self.obsidian_root / _safe_user_dir(owner)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _migration_path(self, owner: Optional[str]) -> Path:
        return self._vault_root_for_owner(owner) / "Odysseus" / "System" / "Migrations" / MEMORY_MIGRATION_NAME

    def _memory_notes(self) -> List[Tuple[Path, Dict[str, Any], str]]:
        notes = []
        if not self.obsidian_root.exists():
            return notes
        for user_root in sorted(path for path in self.obsidian_root.iterdir() if path.is_dir()):
            knowledge = user_root / "Odysseus" / "Knowledge"
            if not knowledge.exists():
                continue
            for path in sorted(knowledge.rglob("*.md")):
                try:
                    content = path.read_text(encoding="utf-8", errors="replace")
                    meta, body = _parse_frontmatter(content)
                except Exception:
                    continue
                if meta.get("type") == MEMORY_NOTE_TYPE or meta.get("memory_id"):
                    notes.append((path, meta, body))
        return notes

    def _known_memory_ids(self) -> set:
        return {str(meta.get("memory_id") or "") for _path, meta, _body in self._memory_notes() if meta.get("memory_id")}

    def migrate_legacy_memory(self) -> Dict[str, Any]:
        """Import data/memory.json into Obsidian notes without deleting it."""
        try:
            with open(self.memory_file, "r", encoding="utf-8") as f:
                legacy = json.load(f)
        except Exception:
            legacy = []
        if not isinstance(legacy, list):
            legacy = []

        known = self._known_memory_ids()
        imported_by_owner: Dict[str, int] = {}
        for raw in legacy:
            if not isinstance(raw, dict) or not str(raw.get("text") or "").strip():
                continue
            entry = dict(raw)
            if not entry.get("id"):
                entry["id"] = str(uuid.uuid4())
            if entry["id"] in known:
                continue
            self._write_entry(entry)
            known.add(entry["id"])
            key = _safe_user_dir(entry.get("owner"))
            imported_by_owner[key] = imported_by_owner.get(key, 0) + 1

        marker_rows = imported_by_owner or {SINGLE_USER_KEY: 0}
        for owner_key, count in marker_rows.items():
            marker = self._migration_path(None if owner_key == SINGLE_USER_KEY else owner_key)
            _atomic_write_text(marker, json.dumps({
                "migration": "brain-to-obsidian",
                "source": "data/memory.json",
                "imported": count,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "legacy_preserved": True,
            }, indent=2))

        return {"imported": sum(imported_by_owner.values()), "owners": imported_by_owner}

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def _genre_for_category(self, category: str) -> str:
        return CATEGORY_TO_GENRE.get(str(category or "").strip().lower(), "source-reference")

    def _entry_path(self, entry: Dict[str, Any]) -> Path:
        owner = entry.get("owner")
        category = str(entry.get("category") or "fact").strip().lower()
        genre = self._genre_for_category(category)
        mid = str(entry.get("id") or uuid.uuid4())
        title_slug = _slug(str(entry.get("text") or "")[:80])
        return self._vault_root_for_owner(owner) / "Odysseus" / "Knowledge" / genre / f"memory-{title_slug}-{mid[:8]}.md"

    def _existing_path_for_id(self, memory_id: str) -> Optional[Path]:
        for path, meta, _body in self._memory_notes():
            if str(meta.get("memory_id") or "") == str(memory_id):
                return path
        return None

    def _note_title(self, entry: Dict[str, Any]) -> str:
        text = str(entry.get("text") or "").strip()
        if not text:
            return "Memory"
        return text[:72] + ("..." if len(text) > 72 else "")

    def _entry_markdown(self, entry: Dict[str, Any]) -> str:
        now = datetime.now(timezone.utc).isoformat()
        mid = str(entry.get("id") or uuid.uuid4())
        category = str(entry.get("category") or "fact").strip().lower() or "fact"
        genre = self._genre_for_category(category)
        timestamp = int(entry.get("timestamp") or time.time())
        created = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        tags = ["odysseus/knowledge", "memory", category, genre]
        if entry.get("pinned"):
            tags.append("pinned")
        lines = [
            "---",
            f"title: {_frontmatter_scalar(self._note_title(entry))}",
            "category: knowledge",
            f"genre: {_frontmatter_scalar(genre)}",
            f"type: {_frontmatter_scalar(MEMORY_NOTE_TYPE)}",
            f"memory_id: {_frontmatter_scalar(mid)}",
            f"memory_category: {_frontmatter_scalar(category)}",
            f"source: {_frontmatter_scalar(entry.get('source') or 'user')}",
            f"source_id: {_frontmatter_scalar(entry.get('session_id') or entry.get('source_id') or '')}",
            f"confidence: {_frontmatter_scalar(entry.get('confidence', 1.0))}",
            f"status: {_frontmatter_scalar(entry.get('status') or 'active')}",
            f"created_at: {_frontmatter_scalar(created)}",
            f"updated_at: {_frontmatter_scalar(now)}",
            f"owner: {_frontmatter_scalar(entry.get('owner') or '')}",
            f"pinned: {_frontmatter_scalar(bool(entry.get('pinned')))}",
            f"uses: {_frontmatter_scalar(int(entry.get('uses', 0) or 0))}",
            f"tags: {_frontmatter_list(tags)}",
            "entities: []",
            f"related: {_frontmatter_list(entry.get('related') or [])}",
            "odysseus_managed: true",
            "---",
            "",
            f"# {self._note_title(entry)}",
            "",
            "## Memory",
            "",
            str(entry.get("text") or "").strip(),
            "",
        ]
        if entry.get("session_id"):
            lines.extend(["## Source", "", f"Session: `{entry.get('session_id')}`", ""])
        return "\n".join(lines).rstrip() + "\n"

    def _entry_from_note(self, path: Path, meta: Dict[str, Any], body: str) -> Optional[Dict[str, Any]]:
        mid = str(meta.get("memory_id") or "").strip()
        text = _extract_section(body, "Memory") or str(meta.get("title") or "").strip()
        if not mid or not text:
            return None
        created_raw = str(meta.get("created_at") or "")
        try:
            timestamp = int(datetime.fromisoformat(created_raw.replace("Z", "+00:00")).timestamp())
        except Exception:
            timestamp = int(path.stat().st_mtime)
        owner = str(meta.get("owner") or "").strip() or None
        entry = {
            "id": mid,
            "text": text,
            "timestamp": timestamp,
            "source": str(meta.get("source") or "obsidian"),
            "category": str(meta.get("memory_category") or meta.get("genre") or "fact"),
            "uses": int(meta.get("uses") or 0),
            "pinned": bool(meta.get("pinned")),
            "status": str(meta.get("status") or "active"),
            "note_path": path.as_posix(),
        }
        if owner:
            entry["owner"] = owner
        source_id = str(meta.get("source_id") or "").strip()
        if source_id:
            entry["session_id"] = source_id
        return entry

    def _write_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        if not entry.get("id"):
            entry["id"] = str(uuid.uuid4())
        if not entry.get("timestamp"):
            entry["timestamp"] = int(time.time())
        if not entry.get("source"):
            entry["source"] = "user"
        if not entry.get("category"):
            entry["category"] = "fact"
        if "uses" not in entry:
            entry["uses"] = 0
        path = self._existing_path_for_id(str(entry["id"])) or self._entry_path(entry)
        _atomic_write_text(path, self._entry_markdown(entry))
        return entry

    def _archive_missing(self, active_ids: set) -> None:
        now = datetime.now(timezone.utc).isoformat()
        for path, meta, body in self._memory_notes():
            mid = str(meta.get("memory_id") or "")
            if not mid or mid in active_ids:
                continue
            if str(meta.get("status") or "").lower() in {"archived", "deleted"}:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            if re.search(r"^status:\s*.+$", content, re.M):
                content = re.sub(r"^status:\s*.+$", "status: archived", content, count=1, flags=re.M)
            else:
                content = content.replace("---\n", "---\nstatus: archived\n", 1)
            if re.search(r"^archived_at:\s*.+$", content, re.M):
                content = re.sub(r"^archived_at:\s*.+$", f"archived_at: {_frontmatter_scalar(now)}", content, count=1, flags=re.M)
            else:
                content = content.replace("---\n", f"---\narchived_at: {_frontmatter_scalar(now)}\n", 1)
            _atomic_write_text(path, content)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_all(self) -> List[Dict]:
        self.migrate_legacy_memory()
        entries = []
        for path, meta, body in self._memory_notes():
            entry = self._entry_from_note(path, meta, body)
            if not entry:
                continue
            if str(entry.get("status") or "active").lower() in {"archived", "deleted"}:
                continue
            entries.append(entry)
        entries.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return entries

    def load(self, owner: str = None) -> List[Dict]:
        entries = self.load_all()
        if owner is None:
            return entries
        return [e for e in entries if e.get("owner") == owner]

    def save(self, entries: List[Dict]):
        if not isinstance(entries, list):
            entries = []
        normalized = []
        active_ids = set()
        for raw in entries:
            if not isinstance(raw, dict):
                continue
            entry = dict(raw)
            if not str(entry.get("text") or "").strip():
                continue
            written = self._write_entry(entry)
            normalized.append(written)
            active_ids.add(str(written["id"]))
        self._archive_missing(active_ids)

    def add_entry(self, text: str, source: str = "user", category: str = "fact", owner: str = None) -> Dict:
        if not text.strip():
            raise ValueError("Memory text cannot be empty")
        entry = {
            "id": str(uuid.uuid4()),
            "text": text.strip(),
            "timestamp": int(time.time()),
            "source": source,
            "category": category,
            "uses": 0,
            "status": "active",
        }
        if owner:
            entry["owner"] = owner
        return entry

    def increment_uses(self, ids: List[str]) -> None:
        if not ids:
            return
        id_set = set(ids)
        entries = self.load_all()
        changed = False
        for entry in entries:
            if entry.get("id") in id_set:
                entry["uses"] = int(entry.get("uses", 0) or 0) + 1
                changed = True
        if changed:
            self.save(entries)

    def find_duplicates(self, text: str, entries: List[Dict] = None) -> List[Dict]:
        if entries is None:
            entries = self.load()
        text_lower = text.strip().lower()
        return [entry for entry in entries if entry.get("text", "").lower() == text_lower]

    def categorize_memory_by_relevance(self, message: str, memories: list):
        categories = {"contacts": [], "preferences": [], "facts": [], "tasks": []}
        msg_lower = message.lower()
        for mem in memories:
            text_lower = mem["text"].lower()
            if any(word in text_lower for word in ["phone", "email", "address", "lives", "works"]):
                if any(word in msg_lower for word in ["contact", "phone", "address", "email"]):
                    categories["contacts"].append(mem)
            elif any(word in text_lower for word in ["likes", "dislikes", "prefers", "favorite"]):
                if any(word in msg_lower for word in ["like", "prefer", "favorite", "want"]):
                    categories["preferences"].append(mem)
            elif any(word in text_lower for word in ["todo", "task", "remind", "meeting"]):
                if any(word in msg_lower for word in ["todo", "task", "schedule", "remind"]):
                    categories["tasks"].append(mem)
            elif get_text_similarity(message, mem["text"]) > 0.4:
                categories["facts"].append(mem)
        return categories

    def get_relevant_memories(self, query: str, memories: list, threshold: float = 0.05, max_items: int = 8):
        if not memories or not query.strip():
            return []
        identity_words = ["name", "who", "i", "am", "called", "identity", "myself", "me", "my"]
        contact_words = ["phone", "email", "address", "contact", "number", "where", "located", "reach"]
        preference_words = ["like", "prefer", "favorite", "want", "love", "hate", "dislike", "enjoy", "interested"]
        task_words = ["todo", "task", "remind", "meeting", "appointment", "schedule", "deadline"]
        fact_words = ["what", "when", "where", "how", "why", "explain", "describe", "information", "know"]
        query_lower = query.lower()
        query_type = None
        if any(word in query_lower for word in identity_words):
            query_type = "identity"
        elif any(word in query_lower for word in contact_words):
            query_type = "contact"
        elif any(word in query_lower for word in preference_words):
            query_type = "preference"
        elif any(word in query_lower for word in task_words):
            query_type = "task"
        elif any(word in query_lower for word in fact_words):
            query_type = "fact"

        relevant = []
        identity_memories = []
        other_memories = []
        for memory in memories:
            memory_text = memory["text"].lower()
            is_identity = any([
                re.search(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b", memory["text"]),
                any(word in memory_text for word in ["name is", "i'm", "i am", "called", "my name", "named", "call me"]),
            ])
            if is_identity:
                identity_memories.append(memory)
            else:
                other_memories.append(memory)

        if query_type == "identity" and identity_memories:
            for memory in identity_memories:
                relevant.append((0.9, memory))

        for memory in other_memories:
            memory_text = memory["text"].lower()
            memory_tokens = set(tokenize(memory_text))
            query_tokens = set(tokenize(query_lower))
            if not query_tokens or not memory_tokens:
                continue
            final_score = len(query_tokens & memory_tokens) / len(query_tokens | memory_tokens)
            if query_type == "contact" and any(word in memory_text for word in ["@gmail.com", "@", ".com", "phone", "number", "address", "http", "www", "tel:"]):
                final_score *= 1.4
            elif query_type == "preference" and any(word in memory_text for word in ["like", "love", "hate", "dislike", "prefer", "favorite", "enjoy", "interested"]):
                final_score *= 1.3
            elif query_type == "task" and any(word in memory_text for word in ["todo", "task", "remind", "meeting", "appointment", "schedule", "deadline", "need to"]):
                final_score *= 1.3
            if query.lower() in memory["text"].lower():
                final_score = max(final_score, 0.8)
            if final_score >= threshold:
                relevant.append((final_score, memory))
        relevant.sort(key=lambda x: x[0], reverse=True)
        return [mem for _, mem in relevant[:max_items]]
