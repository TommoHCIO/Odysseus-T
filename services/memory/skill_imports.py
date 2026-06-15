"""Live imports for external SKILL.md libraries."""

from __future__ import annotations

import json
import os
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from services.memory.skill_format import Skill, parse_frontmatter, slugify
from services.memory.skills import SkillsManager

MATT_POCOCK_REPO = "mattpocock/skills"
MATT_POCOCK_REF = "main"
MATT_POCOCK_PROMOTED_BUCKETS = ("engineering", "productivity", "misc")
GITHUB_API_TREE_URL = (
    "https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1"
)
GITHUB_RAW_URL = "https://raw.githubusercontent.com/{repo}/{ref}/{path}"
USER_AGENT = "Odysseus-T skill importer"


@dataclass(frozen=True)
class RemoteSkill:
    name: str
    bucket: str
    path: str
    raw_url: str
    markdown: str


def _fetch_text(url: str, *, timeout: int = 20) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _github_tree_paths(
    *,
    repo: str = MATT_POCOCK_REPO,
    ref: str = MATT_POCOCK_REF,
    fetch_text: Callable[[str], str] = _fetch_text,
) -> list[str]:
    url = GITHUB_API_TREE_URL.format(
        repo=urllib.parse.quote(repo, safe="/"),
        ref=urllib.parse.quote(ref, safe=""),
    )
    try:
        data = json.loads(fetch_text(url))
    except (json.JSONDecodeError, urllib.error.URLError, TimeoutError) as exc:
        raise ValueError(f"Could not read GitHub skill tree: {exc}") from exc
    tree = data.get("tree")
    if not isinstance(tree, list):
        raise ValueError("GitHub skill tree response was missing tree entries")
    return [
        str(item.get("path") or "")
        for item in tree
        if item.get("type") == "blob" and str(item.get("path") or "").endswith("/SKILL.md")
    ]


def _bucket_for_path(path: str) -> Optional[str]:
    parts = path.split("/")
    if len(parts) < 4 or parts[0] != "skills" or parts[-1] != "SKILL.md":
        return None
    return parts[1]


def discover_matt_pocock_skill_paths(
    *,
    buckets: Iterable[str] = MATT_POCOCK_PROMOTED_BUCKETS,
    repo: str = MATT_POCOCK_REPO,
    ref: str = MATT_POCOCK_REF,
    fetch_text: Callable[[str], str] = _fetch_text,
) -> list[str]:
    allowed = {bucket.strip() for bucket in buckets if bucket and bucket.strip()}
    return [
        path
        for path in _github_tree_paths(repo=repo, ref=ref, fetch_text=fetch_text)
        if _bucket_for_path(path) in allowed
    ]


def _raw_url(repo: str, ref: str, path: str) -> str:
    return GITHUB_RAW_URL.format(
        repo=urllib.parse.quote(repo, safe="/"),
        ref=urllib.parse.quote(ref, safe=""),
        path=urllib.parse.quote(path, safe="/"),
    )


def fetch_matt_pocock_skills(
    *,
    buckets: Iterable[str] = MATT_POCOCK_PROMOTED_BUCKETS,
    repo: str = MATT_POCOCK_REPO,
    ref: str = MATT_POCOCK_REF,
    fetch_text: Callable[[str], str] = _fetch_text,
) -> list[RemoteSkill]:
    remote: list[RemoteSkill] = []
    for path in discover_matt_pocock_skill_paths(
        buckets=buckets,
        repo=repo,
        ref=ref,
        fetch_text=fetch_text,
    ):
        url = _raw_url(repo, ref, path)
        try:
            markdown = fetch_text(url)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ValueError(f"Could not fetch {path}: {exc}") from exc
        bucket = _bucket_for_path(path) or "imported"
        name = slugify(path.split("/")[-2], fallback="skill")
        remote.append(RemoteSkill(name=name, bucket=bucket, path=path, raw_url=url, markdown=markdown))
    return remote


def _remote_skill_to_skill(remote: RemoteSkill, *, owner: Optional[str], status: str) -> Skill:
    fm, body = parse_frontmatter(remote.markdown)
    parsed = Skill.from_markdown(remote.markdown)
    name = slugify(parsed.name or remote.name, fallback=remote.name)
    description = (parsed.description or fm.get("description") or name.replace("-", " ")).strip()
    tags = sorted({*(parsed.tags or []), "matt-pocock", "external-skill", remote.bucket})
    related = sorted({*(parsed.related or []), remote.raw_url})
    return Skill(
        name=name,
        description=description[:400],
        version=parsed.version or "1.0.0",
        category=f"matt-pocock-{remote.bucket}",
        tags=tags,
        platforms=list(parsed.platforms or []),
        requires_toolsets=list(parsed.requires_toolsets or []),
        fallback_for_toolsets=list(parsed.fallback_for_toolsets or []),
        status=status if status in {"draft", "published"} else "published",
        confidence=0.75,
        source="matt-pocock/skills",
        owner=owner,
        genre="runbook",
        type="skills.imported",
        related=related,
        when_to_use=parsed.when_to_use or description,
        procedure=list(parsed.procedure or []),
        pitfalls=list(parsed.pitfalls or []),
        verification=list(parsed.verification or []),
        body_extra=body.strip(),
    )


def _delete_existing_skill_files(manager: SkillsManager, skill: Skill) -> None:
    for path in list(manager._iter_skill_files()):
        existing = manager._read_skill(path)
        if not existing or existing.name != skill.name:
            continue
        if (existing.owner or "") != (skill.owner or ""):
            continue
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)


def import_matt_pocock_skills(
    manager: SkillsManager,
    *,
    owner: Optional[str],
    buckets: Iterable[str] = MATT_POCOCK_PROMOTED_BUCKETS,
    status: str = "published",
    update_existing: bool = True,
    fetch_text: Callable[[str], str] = _fetch_text,
) -> dict:
    remote_skills = fetch_matt_pocock_skills(buckets=buckets, fetch_text=fetch_text)
    existing = {
        skill.get("name")
        for skill in manager.load(owner=owner)
        if skill.get("name")
    }
    created: list[str] = []
    updated: list[str] = []
    skipped: list[str] = []

    for remote in remote_skills:
        skill = _remote_skill_to_skill(remote, owner=owner, status=status)
        exists = skill.name in existing
        if exists and not update_existing:
            skipped.append(skill.name)
            continue
        if exists:
            _delete_existing_skill_files(manager, skill)
        manager._write_skill(skill)
        existing.add(skill.name)
        if exists:
            updated.append(skill.name)
        else:
            created.append(skill.name)

    return {
        "ok": True,
        "source": MATT_POCOCK_REPO,
        "ref": MATT_POCOCK_REF,
        "buckets": sorted({bucket for bucket in buckets}),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "count": len(remote_skills),
        "counts": {
            "created": len(created),
            "updated": len(updated),
            "skipped": len(skipped),
        },
    }
