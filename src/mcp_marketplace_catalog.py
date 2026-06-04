"""Curated MCP marketplace catalog loading and normalization."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

SUPPORTED_RUNTIMES = {"npm", "python_uv", "docker", "sse"}
MARKETPLACE_DIR = Path(os.environ.get("ODYSSEUS_MCP_MARKETPLACE_DIR", "data/mcp_marketplace"))
CATALOG_CACHE_PATH = MARKETPLACE_DIR / "catalog_cache.json"


@dataclass(frozen=True)
class CatalogSource:
    id: str
    name: str
    priority: int
    path: str

    def to_public_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name, "priority": self.priority, "path": self.path}


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    name: str
    description: str
    publisher: str
    version: str
    runtime: str
    recipe: Dict[str, Any]
    config_fields: List[Dict[str, Any]]
    permissions: List[str]
    source_url: str
    source_id: str
    source_priority: int
    checksum: str | None = None
    tool_hints: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_raw(cls, raw: Dict[str, Any], source_id: str, source_priority: int) -> "CatalogEntry":
        required = ["id", "name", "description", "publisher", "version", "runtime", "recipe", "config_fields", "permissions", "source_url"]
        missing = [key for key in required if key not in raw]
        if missing:
            raise ValueError(f"Catalog entry missing fields: {', '.join(missing)}")
        runtime = str(raw["runtime"])
        if runtime not in SUPPORTED_RUNTIMES:
            raise ValueError(f"Unsupported runtime: {runtime}")
        if not isinstance(raw["recipe"], dict):
            raise ValueError("recipe must be an object")
        if not isinstance(raw["config_fields"], list):
            raise ValueError("config_fields must be a list")
        if not isinstance(raw["permissions"], list):
            raise ValueError("permissions must be a list")
        return cls(
            id=str(raw["id"]),
            name=str(raw["name"]),
            description=str(raw["description"]),
            publisher=str(raw["publisher"]),
            version=str(raw["version"]),
            runtime=runtime,
            recipe=dict(raw["recipe"]),
            config_fields=list(raw["config_fields"]),
            permissions=[str(p) for p in raw["permissions"]],
            source_url=str(raw["source_url"]),
            source_id=source_id,
            source_priority=source_priority,
            checksum=str(raw["checksum"]) if raw.get("checksum") else None,
            tool_hints=list(raw.get("tool_hints") or []),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _marketplace_dir() -> Path:
    return Path(os.environ.get("ODYSSEUS_MCP_MARKETPLACE_DIR", str(MARKETPLACE_DIR)))


def default_catalog_sources() -> List[CatalogSource]:
    base = _marketplace_dir()
    return [
        CatalogSource(id="odysseus-curated", name="Odysseus Curated", priority=100, path=str(base / "curated_catalog.json")),
        CatalogSource(id="odysseus-community-curated", name="Odysseus Community Curated", priority=80, path=str(base / "community_curated_catalog.json")),
    ]


def _seed_entries_for_source(source_id: str) -> List[Dict[str, Any]]:
    if source_id == "odysseus-community-curated":
        return [
            {
                "id": "github",
                "name": "GitHub MCP",
                "description": "Access GitHub repositories and issues with a configured token.",
                "publisher": "Curated MCP Community",
                "version": "latest",
                "runtime": "npm",
                "recipe": {"package": "@modelcontextprotocol/server-github", "args": []},
                "config_fields": [{"name": "GITHUB_TOKEN", "label": "GitHub token", "type": "secret", "required": True}],
                "permissions": ["GitHub API access granted by the provided token"],
                "source_url": "https://github.com/modelcontextprotocol/servers",
                "tool_hints": [{"name": "search_repositories", "description": "Search GitHub repositories"}],
            },
            {
                "id": "memory",
                "name": "Memory MCP",
                "description": "Store and retrieve local memory graph entries.",
                "publisher": "Curated MCP Community",
                "version": "latest",
                "runtime": "npm",
                "recipe": {"package": "@modelcontextprotocol/server-memory", "args": []},
                "config_fields": [],
                "permissions": ["Local memory graph storage managed by the MCP server"],
                "source_url": "https://github.com/modelcontextprotocol/servers",
            },
        ]
    return [
        {
            "id": "filesystem",
            "name": "Filesystem MCP",
            "description": "Expose a selected filesystem root to MCP tools.",
            "publisher": "Model Context Protocol",
            "version": "latest",
            "runtime": "npm",
            "recipe": {"package": "@modelcontextprotocol/server-filesystem", "args": ["{root}"]},
            "config_fields": [{"name": "root", "label": "Allowed root", "type": "path", "required": True}],
            "permissions": ["Read/write access to the selected root only"],
            "source_url": "https://github.com/modelcontextprotocol/servers",
            "tool_hints": [{"name": "read_file", "description": "Read files from the selected root"}],
        },
        {
            "id": "sqlite",
            "name": "SQLite MCP",
            "description": "Query and inspect a selected SQLite database.",
            "publisher": "Curated MCP",
            "version": "latest",
            "runtime": "python_uv",
            "recipe": {"package": "mcp-server-sqlite", "args": ["--db-path", "{db_path}"]},
            "config_fields": [{"name": "db_path", "label": "SQLite database path", "type": "path", "required": True}],
            "permissions": ["Read/write access to the selected SQLite database"],
            "source_url": "https://github.com/modelcontextprotocol/servers",
        },
        {
            "id": "playwright",
            "name": "Playwright Browser MCP",
            "description": "Control a browser through Playwright MCP.",
            "publisher": "Microsoft Playwright",
            "version": "latest",
            "runtime": "npm",
            "recipe": {"package": "@playwright/mcp", "args": ["--headless"]},
            "config_fields": [],
            "permissions": ["Browser automation from the Odysseus host"],
            "source_url": "https://github.com/microsoft/playwright-mcp",
        },
    ]


def ensure_seed_catalog(path: Path | None = None, source_id: str = "odysseus-curated") -> Path:
    catalog_path = path or _marketplace_dir() / "curated_catalog.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    if catalog_path.exists():
        return catalog_path
    seed = {"entries": _seed_entries_for_source(source_id)}
    catalog_path.write_text(json.dumps(seed, indent=2), encoding="utf-8")
    return catalog_path


def _load_source_entries(source: CatalogSource) -> Tuple[List[CatalogEntry], List[str]]:
    path = Path(source.path)
    if source.id in {"odysseus-curated", "odysseus-community-curated"}:
        ensure_seed_catalog(path, source.id)
    errors: List[str] = []
    try:
        raw_catalog = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [], [f"{source.id}: {exc}"]
    entries = []
    for raw_entry in raw_catalog.get("entries", []):
        try:
            entries.append(CatalogEntry.from_raw(raw_entry, source.id, source.priority))
        except ValueError as exc:
            errors.append(f"{source.id}/{raw_entry.get('id', 'unknown')}: {exc}")
    return entries, errors


def normalize_catalog_entries(sources: Iterable[CatalogSource]) -> Tuple[List[CatalogEntry], List[str]]:
    by_id: Dict[str, CatalogEntry] = {}
    errors: List[str] = []
    for source in sources:
        entries, source_errors = _load_source_entries(source)
        errors.extend(source_errors)
        for entry in entries:
            current = by_id.get(entry.id)
            if current is None or entry.source_priority > current.source_priority:
                by_id[entry.id] = entry
    return sorted(by_id.values(), key=lambda item: item.name.lower()), errors


def refresh_catalog_cache(sources: Iterable[CatalogSource] | None = None, cache_path: Path | str | None = None) -> Dict[str, Any]:
    source_list = list(sources or default_catalog_sources())
    entries, errors = normalize_catalog_entries(source_list)
    target = Path(cache_path or (_marketplace_dir() / "catalog_cache.json"))
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "sources": [source.to_public_dict() for source in source_list],
        "errors": errors,
        "entries": [entry.to_dict() for entry in entries],
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def load_catalog_cache(cache_path: Path | str | None = None) -> Dict[str, Any]:
    target = Path(cache_path or (_marketplace_dir() / "catalog_cache.json"))
    if not target.exists():
        return refresh_catalog_cache(cache_path=target)
    cache = json.loads(target.read_text(encoding="utf-8"))
    expected_source_ids = {source.id for source in default_catalog_sources()}
    cached_source_ids = {source.get("id") for source in cache.get("sources", [])}
    if cache_path is None and not expected_source_ids.issubset(cached_source_ids):
        return refresh_catalog_cache(cache_path=target)
    return cache


def get_catalog_entry(entry_id: str, cache_path: Path | str | None = None) -> CatalogEntry | None:
    cache = load_catalog_cache(cache_path)
    for raw in cache.get("entries", []):
        if raw.get("id") == entry_id:
            return CatalogEntry.from_raw(raw, raw.get("source_id", "cache"), int(raw.get("source_priority", 0)))
    return None
