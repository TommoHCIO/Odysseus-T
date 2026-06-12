# services/memory/skills.py
"""Skills storage layer.

Canonical skills live as Obsidian Markdown under
`data/obsidian-vault/<owner>/Odysseus/Skills/<category>/<name>/SKILL.md`.
Legacy `data/skills/**/SKILL.md` files are import-only rollback artifacts.
Each skill keeps the SKILL.md body shape (When to Use / Procedure / Pitfalls /
Verification), while usage and audit metadata now live in YAML frontmatter.

Ownership: skills declare `owner: <username>` in frontmatter. Single-user
deployments can leave that blank.

This module also retains a JSON fallback for any legacy `data/skills.json`
entries — they're surfaced as read-only `Skill` objects so old data still
loads while a user migrates them to disk.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .skill_format import Skill, slugify

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Token / similarity helpers (kept for the relevance fallback)
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> set:
    return {w.strip('.,!?";:()[]') for w in (text or "").lower().split() if len(w) > 1}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _to_float(x, default: float = 0.0) -> float:
    """Coerce a possibly hand-edited frontmatter value to float without
    raising — a blank or non-numeric `confidence:` in a SKILL.md must not
    blow up retrieval or eviction."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# SkillsManager
# ---------------------------------------------------------------------------


class SkillsManager:
    """Read/write SKILL.md files, with Obsidian as the canonical app store."""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.legacy_skills_root = os.path.join(data_dir, "skills")
        self.skills_root = self.legacy_skills_root
        self.obsidian_vault_root = os.path.join(data_dir, "obsidian-vault")
        self.usage_file = os.path.join(self.legacy_skills_root, "_usage.json")
        self.legacy_file = os.path.join(data_dir, "skills.json")  # back-compat
        self.use_obsidian_storage = os.path.exists(self._storage_marker())
        os.makedirs(self.legacy_skills_root, exist_ok=True)

    # ----------------------------------------------------------------------
    # Path helpers
    # ----------------------------------------------------------------------

    @staticmethod
    def _safe_user_dir(owner: Optional[str]) -> str:
        import re
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", owner or "__single__").strip("._")
        return safe[:80] or "__single__"

    def _storage_marker(self) -> str:
        return os.path.join(self.obsidian_vault_root, "_system", "brain-to-obsidian-skills.json")

    def _obsidian_skills_root(self, owner: Optional[str]) -> str:
        return os.path.join(
            self.obsidian_vault_root,
            self._safe_user_dir(owner),
            "Odysseus",
            "Skills",
        )

    def _skill_dir(self, category: str, name: str, owner: Optional[str] = None) -> str:
        cat = slugify(category or "general", fallback="general")
        nm = slugify(name, fallback="skill")
        root = self._obsidian_skills_root(owner) if self.use_obsidian_storage else self.legacy_skills_root
        return os.path.join(root, cat, nm)

    def _skill_file(self, category: str, name: str, owner: Optional[str] = None) -> str:
        return os.path.join(self._skill_dir(category, name, owner=owner), "SKILL.md")

    # ----------------------------------------------------------------------
    # Usage sidecar
    # ----------------------------------------------------------------------

    def _load_usage(self) -> Dict[str, Dict]:
        if not os.path.exists(self.usage_file):
            return {}
        try:
            with open(self.usage_file, encoding="utf-8") as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def _save_usage(self, usage: Dict[str, Dict]) -> None:
        try:
            from core.atomic_io import atomic_write_json
            atomic_write_json(self.usage_file, usage, indent=2)
        except Exception:
            tmp = self.usage_file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(usage, f, indent=2)
            os.replace(tmp, self.usage_file)

    def set_audit(self, name: str, verdict: str, by_teacher: bool = False,
                  worker_model: str = "", teacher_model: str = "") -> None:
        """Record the last test/audit result in SKILL.md frontmatter."""
        import time as _t
        updates = {
            "audit_verdict": verdict,
            "audit_by_teacher": bool(by_teacher),
            "audited_at": _t.time(),
        }
        if worker_model:
            updates["audit_worker_model"] = worker_model
        if teacher_model:
            updates["audit_teacher_model"] = teacher_model
        owners = {s.get("owner") for s in self.load_all() if s.get("name") == name}
        for owner in owners or {None}:
            self.update_skill(name, updates, owner=owner)

    def set_necessity(self, name: str, necessary: bool,
                      redundant_with=None, reason: str = "") -> None:
        """Record the advisory 'is this skill necessary?' judgment in SKILL.md."""
        necessity = {
            "necessary": bool(necessary),
            "redundant_with": list(redundant_with or []),
            "reason": str(reason or ""),
        }
        owners = {s.get("owner") for s in self.load_all() if s.get("name") == name}
        for owner in owners or {None}:
            self.update_skill(name, {"necessity": necessity}, owner=owner)

    # ----------------------------------------------------------------------
    # Disk scan
    # ----------------------------------------------------------------------

    def _iter_skill_files(self) -> Iterable[str]:
        roots = []
        if self.use_obsidian_storage:
            roots.extend(
                os.path.join(user_root, "Odysseus", "Skills")
                for user_root in sorted(str(p) for p in Path(self.obsidian_vault_root).glob("*") if p.is_dir())
            )
        else:
            roots.append(self.legacy_skills_root)
        for scan_root in roots:
            if not os.path.isdir(scan_root):
                continue
            for root, _dirs, files in os.walk(scan_root, followlinks=False):
                if "SKILL.md" in files:
                    yield os.path.join(root, "SKILL.md")

    def _iter_legacy_skill_files(self) -> Iterable[str]:
        if not os.path.isdir(self.legacy_skills_root):
            return
        for root, _dirs, files in os.walk(self.legacy_skills_root, followlinks=False):
            if "SKILL.md" in files:
                yield os.path.join(root, "SKILL.md")

    def _read_skill(self, path: str) -> Optional[Skill]:
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
            return Skill.from_markdown(text, path=path)
        except Exception as e:
            logger.warning(f"Failed to parse {path}: {e}")
            return None

    def _write_skill(self, sk: Skill) -> str:
        path = self._skill_file(sk.category or "general", sk.name, owner=sk.owner)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        from core.atomic_io import atomic_write_text
        atomic_write_text(path, sk.to_markdown())
        sk.path = path
        return path

    def migrate_legacy_skills(self) -> Dict[str, int]:
        """Copy legacy data/skills SKILL.md files into Odysseus/Skills."""
        usage = self._load_usage()
        imported = 0
        skipped = 0
        previous = self.use_obsidian_storage
        try:
            self.use_obsidian_storage = True
            for path in list(self._iter_legacy_skill_files()):
                sk = self._read_skill(path)
                if not sk:
                    skipped += 1
                    continue
                u = usage.get(sk.name) or {}
                sk.uses = int(u.get("uses", sk.uses or 0) or 0)
                sk.last_used = u.get("last_used", sk.last_used)
                sk.audit_verdict = u.get("audit_verdict", sk.audit_verdict)
                sk.audit_by_teacher = bool(u.get("audit_by_teacher", sk.audit_by_teacher))
                sk.audit_worker_model = u.get("audit_worker_model", sk.audit_worker_model)
                sk.audit_teacher_model = u.get("audit_teacher_model", sk.audit_teacher_model)
                sk.audited_at = u.get("audited_at", sk.audited_at)
                sk.necessity = u.get("necessity", sk.necessity)
                target = self._skill_file(sk.category, sk.name, owner=sk.owner)
                if os.path.exists(target):
                    skipped += 1
                    continue
                self._write_skill(sk)
                imported += 1
        finally:
            self.use_obsidian_storage = previous
        marker = self._storage_marker()
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        from core.atomic_io import atomic_write_json
        atomic_write_json(marker, {
            "migration": "brain-to-obsidian-skills",
            "source": "data/skills",
            "imported": imported,
            "skipped": skipped,
            "updated_at": int(time.time()),
            "legacy_preserved": True,
        }, indent=2)
        self.use_obsidian_storage = True
        return {"imported": imported, "skipped": skipped}

    def backfill_owner(self, primary_owner: str, valid_owners: Optional[set[str]] = None) -> int:
        """Assign legacy/unclaimed skill files to the primary owner.

        Skills are disk-backed, so the DB legacy-owner migration cannot fix
        them. If strict owner filtering is enabled and SKILL.md files have no
        owner or an owner from a deleted/test account, the UI appears empty even
        though files still exist. This mirrors the DB legacy-owner sweep.
        """
        primary_owner = (primary_owner or "").strip()
        if not primary_owner:
            return 0
        valid_owners = set(valid_owners or [])
        changed = 0
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk:
                continue
            owner = (sk.owner or "").strip()
            if owner == primary_owner:
                continue
            if owner and owner in valid_owners:
                continue
            sk.owner = primary_owner
            try:
                self._write_skill(sk)
                changed += 1
            except Exception as e:
                logger.warning("Failed to backfill owner for skill %s: %s", sk.name, e)
        return changed

    # ----------------------------------------------------------------------
    # Public API — keeps the old method names so callers don't break
    # ----------------------------------------------------------------------

    def load_all(self) -> List[Dict]:
        """Return every skill as a plain dict, plus any legacy JSON entries."""
        usage = self._load_usage()
        out: List[Dict] = []
        seen_keys: set[tuple] = set()
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk:
                continue
            d = sk.to_dict()
            if not self.use_obsidian_storage:
                u = usage.get(sk.name) or {}
                d["uses"] = int(u.get("uses", d.get("uses") or 0) or 0)
                d["last_used"] = u.get("last_used", d.get("last_used"))
                d["audit_verdict"] = u.get("audit_verdict", d.get("audit_verdict"))
                d["audit_by_teacher"] = bool(u.get("audit_by_teacher", d.get("audit_by_teacher")))
                d["audit_worker_model"] = u.get("audit_worker_model", d.get("audit_worker_model"))
                d["audit_teacher_model"] = u.get("audit_teacher_model", d.get("audit_teacher_model"))
                d["audited_at"] = u.get("audited_at", d.get("audited_at"))
                d["necessity"] = u.get("necessity", d.get("necessity"))
            out.append(d)
            seen_keys.add((sk.owner or "", sk.name))
        # Legacy JSON entries — surfaced as draft, not editable from new flow
        if os.path.exists(self.legacy_file):
            try:
                with open(self.legacy_file, encoding="utf-8") as f:
                    legacy = json.load(f)
                if isinstance(legacy, list):
                    for row in legacy:
                        if not isinstance(row, dict):
                            continue
                        name = slugify(row.get("title") or row.get("id") or "skill")
                        if (row.get("owner") or "", name) in seen_keys:
                            continue
                        out.append({
                            "id": row.get("id") or name,
                            "name": name,
                            "description": row.get("title", ""),
                            "version": "0.0.1",
                            "category": "legacy",
                            "tags": row.get("tags") or [],
                            "status": row.get("status") or "draft",
                            "confidence": row.get("confidence", 0.5),
                            "source": row.get("source", "imported"),
                            "owner": row.get("owner"),
                            "when_to_use": row.get("problem", ""),
                            "procedure": row.get("steps") or [],
                            "pitfalls": [],
                            "verification": [],
                            "body_extra": row.get("solution", ""),
                            "title": row.get("title", ""),
                            "problem": row.get("problem", ""),
                            "solution": row.get("solution", ""),
                            "steps": row.get("steps") or [],
                            "uses": row.get("uses", 0),
                            "last_used": row.get("last_used"),
                            "_legacy": True,
                        })
            except Exception:
                pass
        return out

    def save(self, entries: List[Dict]) -> None:
        """Compatibility bulk save used by backup import."""
        if not isinstance(entries, list):
            return
        for row in entries:
            if not isinstance(row, dict):
                continue
            name = row.get("name") or row.get("id") or row.get("title")
            if not name:
                continue
            owner = row.get("owner")
            existing = next(
                (s for s in self.load(owner=owner) if s.get("name") == slugify(name) or s.get("id") == name),
                None,
            )
            if existing:
                self.update_skill(existing["name"], row, owner=owner)
            else:
                self.add_skill(
                    name=name,
                    description=row.get("description") or row.get("title") or "",
                    category=row.get("category") or "general",
                    tags=row.get("tags") or [],
                    platforms=row.get("platforms") or [],
                    requires_toolsets=row.get("requires_toolsets") or [],
                    fallback_for_toolsets=row.get("fallback_for_toolsets") or [],
                    when_to_use=row.get("when_to_use") or row.get("problem") or "",
                    procedure=row.get("procedure") or row.get("steps") or [],
                    pitfalls=row.get("pitfalls") or [],
                    verification=row.get("verification") or [],
                    status=row.get("status") or "draft",
                    version=row.get("version") or "1.0.0",
                    confidence=row.get("confidence", 0.8),
                    source=row.get("source", "imported"),
                    teacher_model=row.get("teacher_model"),
                    owner=owner,
                    title=row.get("title") or "",
                    problem=row.get("problem") or "",
                    solution=row.get("solution") or row.get("body_extra") or "",
                    steps=row.get("steps") or [],
                )

    def load(self, owner: Optional[str] = None) -> List[Dict]:
        entries = self.load_all()
        if owner is None:
            return entries
        # SECURITY: strict ownership filter. The previous predicate also
        # included skills with NO owner field (`not s.get("owner")`), which
        # leaked legacy / un-stamped skills to every authenticated user.
        # Hide them now; the owner needs to be backfilled on disk if those
        # skills should be visible to a specific user.
        return [s for s in entries if s.get("owner") == owner]

    # ----------------------------------------------------------------------
    # CRUD — disk-backed
    # ----------------------------------------------------------------------

    def add_skill(
        self,
        title: str = "",
        problem: str = "",
        solution: str = "",
        steps: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        source: str = "learned",
        teacher_model: Optional[str] = None,
        confidence: float = 0.8,
        session_id: Optional[str] = None,
        owner: Optional[str] = None,
        # New-schema fields (optional; fall back to old shape if absent)
        name: Optional[str] = None,
        description: Optional[str] = None,
        category: str = "general",
        when_to_use: Optional[str] = None,
        procedure: Optional[List[str]] = None,
        pitfalls: Optional[List[str]] = None,
        verification: Optional[List[str]] = None,
        platforms: Optional[List[str]] = None,
        requires_toolsets: Optional[List[str]] = None,
        fallback_for_toolsets: Optional[List[str]] = None,
        status: str = "draft",
        version: str = "1.0.0",
    ) -> Dict:
        # Normalize name
        nm = slugify(name or title or description or "skill")

        # Free dedup-at-creation (always, no API): for LLM-authored skills,
        # skip if a near-identical skill already exists (Jaccard over
        # name+description+when_to_use+procedure). User-authored skills are
        # never auto-skipped — a human asked for it. The every-X AI audit
        # handles the fuzzier near-duplicates this cheap check won't catch.
        _all = self.load_all()
        if source != "user":
            cand = _tokenize(" ".join([
                nm, (description or title or ""),
                (when_to_use if when_to_use is not None else (problem or "")),
                " ".join(procedure if procedure is not None else (steps or [])),
            ]))
            if cand:
                for s in _all:
                    ex = _tokenize(" ".join([
                        s.get("name", ""), s.get("description", ""),
                        s.get("when_to_use", ""),
                        " ".join(s.get("procedure", []) or []),
                    ]))
                    if _jaccard(cand, ex) >= 0.82:
                        # Near-identical — don't grow the library; bump the
                        # existing skill's usage and return it so the caller
                        # knows it already exists.
                        try:
                            self.record_use(s["name"])
                        except Exception:
                            pass
                        return {**s, "_deduped": True, "_duplicate_of": s.get("name")}

        # Avoid clobbering an existing skill with the same name
        existing = {s["name"] for s in _all}
        base = nm
        i = 2
        while nm in existing:
            nm = f"{base}-{i}"
            i += 1

        sk = Skill(
            name=nm,
            description=(description or title or "").strip(),
            version=version,
            category=category or "general",
            tags=list(tags or []),
            platforms=list(platforms or []),
            requires_toolsets=list(requires_toolsets or []),
            fallback_for_toolsets=list(fallback_for_toolsets or []),
            status=status or "draft",
            confidence=float(confidence),
            source=source,
            teacher_model=teacher_model,
            owner=owner,
            when_to_use=(when_to_use if when_to_use is not None else (problem or "")),
            procedure=list(procedure if procedure is not None else (steps or [])),
            pitfalls=list(pitfalls or []),
            verification=list(verification or []),
            body_extra=(solution if solution and not procedure else ""),
        )
        self._write_skill(sk)

        return sk.to_dict()

    def update_skill(self, skill_id: str, updates: Dict, owner: Optional[str] = None) -> bool:
        """`skill_id` is the slug name. Allows updating any field plus
        renames if `name` changes (file is moved on disk).

        The call is owner-scoped: it matches a skill on disk only if
        `skill.owner == owner` (string compare; both empty-string and
        None mean "ownerless"). When `owner is None` (the default), the
        call only matches skills whose own `owner` field is empty —
        callers that want to edit an owned skill must pass the matching
        owner explicitly. This prevents a caller with one owner from
        mutating a file owned by another user that happens to share
        the same slug across category directories. The `owner` key in
        `updates` is also ignored — ownership is not an editable field
        via this path; rename or admin tooling is required for that.
        """
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk or sk.name != skill_id:
                continue
            if (sk.owner or "") != (owner or ""):
                continue

            old_dir = os.path.dirname(path)

            scalar_keys = (
                "description", "version", "category", "status", "confidence",
                "source", "teacher_model", "when_to_use", "body_extra",
                "genre", "type", "uses", "last_used", "audit_verdict",
                "audit_by_teacher", "audit_worker_model", "audit_teacher_model",
                "audited_at", "necessity",
            )
            for k in scalar_keys:
                if k in updates:
                    setattr(sk, k, updates[k])
            list_keys = ("tags", "procedure", "pitfalls", "verification",
                         "platforms", "requires_toolsets", "fallback_for_toolsets",
                         "related")
            for k in list_keys:
                if k in updates:
                    setattr(sk, k, list(updates[k] or []))

            # Old-schema field aliases
            if "title" in updates and "description" not in updates:
                sk.description = updates["title"]
            if "problem" in updates and "when_to_use" not in updates:
                sk.when_to_use = updates["problem"]
            if "solution" in updates and "body_extra" not in updates and not sk.procedure:
                sk.body_extra = updates["solution"]
            if "steps" in updates and "procedure" not in updates:
                sk.procedure = list(updates["steps"] or [])

            # Rename
            new_name = slugify(updates.get("name") or sk.name)
            if new_name != sk.name:
                sk.name = new_name

            # Write to potentially new path
            new_path = self._skill_file(sk.category, sk.name, owner=sk.owner)
            if new_path != path:
                # Move the whole skill directory if rename or recategorize
                new_dir = os.path.dirname(new_path)
                if os.path.isdir(new_dir):
                    logger.warning(f"Skill rename target exists: {new_dir}")
                    return False
                os.makedirs(os.path.dirname(new_dir), exist_ok=True)
                os.rename(old_dir, new_dir)
                # Also rename usage key
                usage = self._load_usage()
                if skill_id in usage:
                    usage[sk.name] = usage.pop(skill_id)
                    self._save_usage(usage)
            self._write_skill(sk)
            return True
        return False

    def delete_skill(self, skill_id: str, owner: Optional[str] = None) -> bool:
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk or sk.name != skill_id:
                continue
            if (sk.owner or "") != (owner or ""):
                continue
            skill_dir = os.path.dirname(path)
            try:
                # Remove the whole skill dir
                for root, dirs, files in os.walk(skill_dir, topdown=False):
                    for f in files:
                        os.remove(os.path.join(root, f))
                    for d in dirs:
                        os.rmdir(os.path.join(root, d))
                os.rmdir(skill_dir)
            except Exception as e:
                logger.warning(f"Failed to remove skill dir {skill_dir}: {e}")
                return False
            usage = self._load_usage()
            if skill_id in usage:
                del usage[skill_id]
                self._save_usage(usage)
            return True
        return False

    def record_use(self, skill_id: str) -> None:
        for sk in self.load_all():
            if sk.get("name") != skill_id and sk.get("id") != skill_id:
                continue
            self.update_skill(
                sk["name"],
                {
                    "uses": int(sk.get("uses", 0) or 0) + 1,
                    "last_used": int(time.time()),
                },
                owner=sk.get("owner"),
            )
            return

    # ----------------------------------------------------------------------
    # Reading a single skill (used by the skill_view tool)
    # ----------------------------------------------------------------------

    def read_skill_md(self, name: str, owner: Optional[str] = None) -> Optional[str]:
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk or sk.name != name:
                continue
            if (sk.owner or "") != (owner or ""):
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    return f.read()
            except Exception:
                return None
        return None

    def read_skill_reference(self, name: str, ref_path: str, owner: Optional[str] = None) -> Optional[str]:
        """Read a sub-file under the skill's directory (references/, etc).
        Refuses path traversal."""
        for path in self._iter_skill_files():
            sk = self._read_skill(path)
            if not sk or sk.name != name:
                continue
            if (sk.owner or "") != (owner or ""):
                continue
            base = os.path.realpath(os.path.dirname(path))
            target = os.path.realpath(os.path.join(base, ref_path))
            if os.path.commonpath([base, target]) != base or target == os.path.dirname(path):
                return None
            if not os.path.isfile(target):
                return None
            try:
                with open(target, encoding="utf-8") as f:
                    return f.read()
            except Exception:
                return None
        return None

    # ----------------------------------------------------------------------
    # Index — the lightweight summary injected into the system prompt
    # ----------------------------------------------------------------------

    def index_for(
        self,
        owner: Optional[str] = None,
        *,
        active_toolsets: Optional[List[str]] = None,
        platform: Optional[str] = None,
    ) -> List[Dict]:
        """Return the `[{name, description, category, status}]` list the
        agent sees in its system prompt.

        Includes:
          - All published skills.
          - Drafts written by the teacher-escalation loop
            (`source == "teacher-escalation"`). The whole point of
            the teacher loop is for the student to find the new
            procedure on the very next turn — waiting for a manual
            publish click defeats the loop.

        Excludes user-created drafts (status=draft, source != teacher-
        escalation) — those are work-in-progress and pollute the
        prompt with half-finished procedures.
        """
        active_toolsets = active_toolsets or []
        out = []
        for s in self.load(owner=owner):
            status = s.get("status")
            # Published + None (pre-status legacy) always included.
            # Drafts only if the teacher wrote them.
            if status not in ("published", None):
                if status == "draft" and s.get("source") == "teacher-escalation":
                    pass  # let it through
                else:
                    continue
            # Platform gating
            if platform and s.get("platforms") and platform not in s["platforms"]:
                continue
            # requires_toolsets: hide unless every required toolset is active
            req = s.get("requires_toolsets") or []
            if req and not all(t in active_toolsets for t in req):
                continue
            # fallback_for_toolsets: hide when any of those toolsets is active
            fb = s.get("fallback_for_toolsets") or []
            if fb and any(t in active_toolsets for t in fb):
                continue
            out.append({
                "name": s["name"],
                "description": s.get("description") or s.get("title", ""),
                "category": s.get("category", "general"),
                "status": status or "published",
            })
        out.sort(key=lambda x: (x["category"], x["name"]))
        return out

    # ----------------------------------------------------------------------
    # Relevance search (kept for the existing /api/skills/search endpoint
    # and the `manage_skills` action="search"). Now operates on the new
    # field set.
    # ----------------------------------------------------------------------

    def get_relevant_skills(
        self,
        query: str,
        skills: Optional[List[Dict]] = None,
        threshold: float = 0.3,
        max_items: int = 5,
        min_confidence: float = 0.0,
    ) -> List[Dict]:
        if skills is None:
            skills = self.load_all()
        if not skills or not query.strip():
            return []
        # Consider published AND draft skills for relevance retrieval.
        # The teacher-escalation loop writes new skills as drafts; the
        # whole point is for the student to find them on the next try
        # without a manual publish click. The UI flags teacher-written
        # entries with a 🎓 badge so users can demote / delete bad
        # ones when they spot them.
        skills = [s for s in skills if s.get("status") in ("published", "draft")]
        # Confidence gate (used by prompt-injection, NOT by search): a DRAFT
        # skill must clear the bar to be injected. Published skills are already
        # vetted, so they always qualify. Missing confidence = treat as 1.0
        # (legacy skills shouldn't silently vanish). 0 disables the gate.
        if min_confidence > 0:
            def _passes(s):
                if s.get("status") == "published":
                    return True
                # Teacher-escalation drafts are auto-written from a (possibly
                # untrusted) trace and injected as authoritative guidance, so they
                # must EARN injection with an explicit, parseable confidence that
                # clears the bar — fail closed on a missing/garbage value instead
                # of treating it as 1.0. Hand-authored legacy drafts keep the
                # lenient "unset → keep" behavior so they don't silently vanish.
                if s.get("source") == "teacher-escalation":
                    c = s.get("confidence")
                    if c is None:
                        return False
                    return _to_float(c, 0.0) >= min_confidence  # unparseable → fail closed
                c = s.get("confidence")
                if c is None:
                    return True  # unset → don't filter (legacy)
                return _to_float(c, 1.0) >= min_confidence  # unparseable → pass
            skills = [s for s in skills if _passes(s)]
        if not skills:
            return []

        query_tokens = _tokenize(query)
        scored = []
        for sk in skills:
            text = " ".join([
                sk.get("name", ""),
                sk.get("description", ""),
                sk.get("when_to_use", ""),
                " ".join(sk.get("tags", []) or []),
                " ".join(sk.get("procedure", []) or []),
            ])
            score = _jaccard(query_tokens, _tokenize(text))
            for tag in sk.get("tags", []) or []:
                if tag and tag in query.lower():
                    score = max(score, 0.3) * 1.3
            if query.lower() in (sk.get("description") or "").lower():
                score = max(score, 0.6)
            score *= 1.0 + _to_float(sk.get("confidence"), 0.5) * 0.1
            if sk.get("uses", 0) > 0:
                score *= 1.05
            if score >= threshold:
                scored.append((score, sk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [sk for _, sk in scored[:max_items]]
