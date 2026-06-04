# MCP Marketplace Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only MCP Marketplace in Odysseus that browses multiple curated catalogs, installs approved MCP server recipes into isolated folders, manages installed servers and tools, and auto-registers tools through the existing MCP manager.

**Architecture:** Add focused backend modules for catalog normalization, installed metadata, and runtime/process control, then expose them through admin-only `/api/mcp/marketplace/*` routes. Reuse the existing `McpServer` table and `McpManager` connection/tool registry so marketplace installs become normal MCP servers. Add an admin UI section that calls the new routes and extends existing MCP tool toggles instead of replacing manual MCP management.

**Tech Stack:** FastAPI, SQLAlchemy model `McpServer`, JSON metadata files under `data/mcp_marketplace/`, existing `src.mcp_manager.McpManager`, vanilla ES modules in `static/js/admin.js`, pytest/FastAPI TestClient.

---

## File structure

- Create `src/mcp_marketplace_catalog.py` — catalog source definitions, catalog JSON validation, curated seed entries, refresh/cache functions.
- Create `src/mcp_marketplace_store.py` — installed marketplace metadata persistence under `data/mcp_marketplace/installed.json`.
- Create `src/mcp_marketplace_runtime.py` — isolated install path validation, recipe validation, simulated/real install preparation, start/stop/restart status/log helpers.
- Modify `routes/mcp_routes.py` — add marketplace endpoints inside `setup_mcp_routes(mcp_manager)` using the new modules and existing `McpServer` rows.
- Modify `src/mcp_manager.py` — add an explicit `refresh_server_tools()` helper that reconnects by DB row and returns status for marketplace refresh actions.
- Modify `static/index.html` — add admin Marketplace containers near the existing admin services/tools area.
- Modify `static/js/admin.js` — render Marketplace Browse/Installed UI, guided config form, action buttons, and tool drawer.
- Modify `static/style.css` — add marketplace card/status/drawer styling.
- Create `tests/test_mcp_marketplace_catalog.py` — catalog normalization and duplicate priority tests.
- Create `tests/test_mcp_marketplace_store.py` — installed metadata persistence tests.
- Create `tests/test_mcp_marketplace_runtime.py` — recipe/path/runtime status tests.
- Create `tests/test_mcp_marketplace_routes.py` — admin-only API tests for catalogs, install, installed list, controls, and uninstall.
- Create `tests/test_mcp_marketplace_admin_js.py` — static UI regression checks for marketplace endpoint wiring and status controls.

## Commit policy for execution

Each task includes a commit step because this plan is optimized for agentic workers. In this OpenClaude session, do not create commits unless the user explicitly grants commit permission for that task or the whole implementation loop.

---

### Task 1: Catalog model and curated seed cache

**Files:**
- Create: `src/mcp_marketplace_catalog.py`
- Create: `tests/test_mcp_marketplace_catalog.py`

- [ ] **Step 1: Write failing catalog tests**

Create `tests/test_mcp_marketplace_catalog.py` with:

```python
import json

from src.mcp_marketplace_catalog import (
    CatalogEntry,
    CatalogSource,
    normalize_catalog_entries,
    refresh_catalog_cache,
)


def test_normalize_catalog_entries_keeps_highest_priority_duplicate(tmp_path):
    sources = [
        CatalogSource(id="core", name="Core", priority=10, path=str(tmp_path / "core.json")),
        CatalogSource(id="community", name="Community", priority=1, path=str(tmp_path / "community.json")),
    ]
    (tmp_path / "core.json").write_text(json.dumps({
        "entries": [{
            "id": "filesystem",
            "name": "Filesystem",
            "description": "Core filesystem server",
            "publisher": "Model Context Protocol",
            "version": "1.0.0",
            "runtime": "npm",
            "recipe": {"package": "@modelcontextprotocol/server-filesystem", "args": ["{root}"]},
            "config_fields": [{"name": "root", "label": "Root", "type": "path", "required": True}],
            "permissions": ["Read/write selected root"],
            "source_url": "https://github.com/modelcontextprotocol/servers",
        }]
    }), encoding="utf-8")
    (tmp_path / "community.json").write_text(json.dumps({
        "entries": [{
            "id": "filesystem",
            "name": "Filesystem Community",
            "description": "Lower priority duplicate",
            "publisher": "Community",
            "version": "9.9.9",
            "runtime": "npm",
            "recipe": {"package": "unsafe", "args": []},
            "config_fields": [],
            "permissions": [],
            "source_url": "https://example.invalid/fs",
        }]
    }), encoding="utf-8")

    entries, errors = normalize_catalog_entries(sources)

    assert errors == []
    assert len(entries) == 1
    assert entries[0].id == "filesystem"
    assert entries[0].name == "Filesystem"
    assert entries[0].source_id == "core"


def test_refresh_catalog_cache_writes_normalized_entries(tmp_path):
    source_path = tmp_path / "catalog.json"
    cache_path = tmp_path / "catalog_cache.json"
    source_path.write_text(json.dumps({
        "entries": [{
            "id": "sqlite",
            "name": "SQLite",
            "description": "SQLite MCP server",
            "publisher": "Curated",
            "version": "0.1.0",
            "runtime": "python_uv",
            "recipe": {"package": "mcp-server-sqlite", "args": ["--db-path", "{db_path}"]},
            "config_fields": [{"name": "db_path", "label": "Database path", "type": "path", "required": True}],
            "permissions": ["Read/write selected SQLite DB"],
            "source_url": "https://example.invalid/sqlite",
        }]
    }), encoding="utf-8")

    result = refresh_catalog_cache(
        [CatalogSource(id="local", name="Local", priority=1, path=str(source_path))],
        cache_path,
    )

    assert result["errors"] == []
    assert result["entries"][0]["id"] == "sqlite"
    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    assert cached["entries"][0]["runtime"] == "python_uv"
    assert cached["sources"][0]["id"] == "local"


def test_catalog_entry_rejects_unsupported_runtime():
    raw = {
        "id": "bad",
        "name": "Bad",
        "description": "Bad runtime",
        "publisher": "Curated",
        "version": "1",
        "runtime": "shell",
        "recipe": {"command": "rm"},
        "config_fields": [],
        "permissions": [],
        "source_url": "https://example.invalid/bad",
    }

    try:
        CatalogEntry.from_raw(raw, source_id="local", source_priority=1)
    except ValueError as exc:
        assert "Unsupported runtime" in str(exc)
    else:
        raise AssertionError("unsupported runtime should fail")
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_catalog.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'src.mcp_marketplace_catalog'`.

- [ ] **Step 3: Implement catalog module**

Create `src/mcp_marketplace_catalog.py` with:

```python
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


def default_catalog_sources() -> List[CatalogSource]:
    seed_path = MARKETPLACE_DIR / "curated_catalog.json"
    return [CatalogSource(id="odysseus-curated", name="Odysseus Curated", priority=100, path=str(seed_path))]


def ensure_seed_catalog(path: Path | None = None) -> Path:
    catalog_path = path or MARKETPLACE_DIR / "curated_catalog.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    if catalog_path.exists():
        return catalog_path
    seed = {
        "entries": [
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
    }
    catalog_path.write_text(json.dumps(seed, indent=2), encoding="utf-8")
    return catalog_path


def _load_source_entries(source: CatalogSource) -> Tuple[List[CatalogEntry], List[str]]:
    path = Path(source.path)
    if source.id == "odysseus-curated":
        ensure_seed_catalog(path)
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
    target = Path(cache_path or CATALOG_CACHE_PATH)
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
    target = Path(cache_path or CATALOG_CACHE_PATH)
    if not target.exists():
        return refresh_catalog_cache(cache_path=target)
    return json.loads(target.read_text(encoding="utf-8"))


def get_catalog_entry(entry_id: str, cache_path: Path | str | None = None) -> CatalogEntry | None:
    cache = load_catalog_cache(cache_path)
    for raw in cache.get("entries", []):
        if raw.get("id") == entry_id:
            return CatalogEntry.from_raw(raw, raw.get("source_id", "cache"), int(raw.get("source_priority", 0)))
    return None
```

- [ ] **Step 4: Run catalog tests**

Run: `python -m pytest tests/test_mcp_marketplace_catalog.py -v`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp_marketplace_catalog.py tests/test_mcp_marketplace_catalog.py
git commit -m "feat: add MCP marketplace catalog cache"
```

---

### Task 2: Installed marketplace metadata store

**Files:**
- Create: `src/mcp_marketplace_store.py`
- Create: `tests/test_mcp_marketplace_store.py`

- [ ] **Step 1: Write failing store tests**

Create `tests/test_mcp_marketplace_store.py` with:

```python
from src.mcp_marketplace_store import InstalledMarketplaceServer, MarketplaceStore


def test_store_round_trips_installed_server(tmp_path):
    store = MarketplaceStore(tmp_path / "installed.json")
    server = InstalledMarketplaceServer(
        id="filesystem",
        mcp_server_id="mkt-filesystem",
        catalog_entry_id="filesystem",
        name="Filesystem MCP",
        runtime="npm",
        install_dir=str(tmp_path / "filesystem"),
        config={"root": str(tmp_path)},
        status="stopped",
        managed_process=True,
    )

    store.save(server)

    loaded = store.get("filesystem")
    assert loaded is not None
    assert loaded.mcp_server_id == "mkt-filesystem"
    assert loaded.config["root"] == str(tmp_path)
    assert store.list()[0].id == "filesystem"


def test_store_delete_removes_entry(tmp_path):
    store = MarketplaceStore(tmp_path / "installed.json")
    store.save(InstalledMarketplaceServer(
        id="sqlite",
        mcp_server_id="mkt-sqlite",
        catalog_entry_id="sqlite",
        name="SQLite MCP",
        runtime="python_uv",
        install_dir=str(tmp_path / "sqlite"),
        config={},
        status="stopped",
        managed_process=True,
    ))

    assert store.delete("sqlite") is True
    assert store.get("sqlite") is None
    assert store.delete("sqlite") is False
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_store.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'src.mcp_marketplace_store'`.

- [ ] **Step 3: Implement store module**

Create `src/mcp_marketplace_store.py` with:

```python
"""Persistence for installed MCP marketplace servers."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

MARKETPLACE_DIR = Path(os.environ.get("ODYSSEUS_MCP_MARKETPLACE_DIR", "data/mcp_marketplace"))
INSTALLED_PATH = MARKETPLACE_DIR / "installed.json"


@dataclass
class InstalledMarketplaceServer:
    id: str
    mcp_server_id: str
    catalog_entry_id: str
    name: str
    runtime: str
    install_dir: str
    config: Dict[str, Any]
    status: str
    managed_process: bool
    last_error: str | None = None
    logs: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "InstalledMarketplaceServer":
        return cls(
            id=str(raw["id"]),
            mcp_server_id=str(raw["mcp_server_id"]),
            catalog_entry_id=str(raw["catalog_entry_id"]),
            name=str(raw["name"]),
            runtime=str(raw["runtime"]),
            install_dir=str(raw["install_dir"]),
            config=dict(raw.get("config") or {}),
            status=str(raw.get("status") or "stopped"),
            managed_process=bool(raw.get("managed_process", True)),
            last_error=raw.get("last_error"),
            logs=list(raw.get("logs") or []),
            created_at=str(raw.get("created_at") or datetime.now(timezone.utc).isoformat()),
            updated_at=str(raw.get("updated_at") or datetime.now(timezone.utc).isoformat()),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MarketplaceStore:
    def __init__(self, path: Path | str = INSTALLED_PATH):
        self.path = Path(path)

    def _read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {"servers": []}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, payload: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def list(self) -> List[InstalledMarketplaceServer]:
        payload = self._read()
        return [InstalledMarketplaceServer.from_dict(item) for item in payload.get("servers", [])]

    def get(self, server_id: str) -> Optional[InstalledMarketplaceServer]:
        for server in self.list():
            if server.id == server_id:
                return server
        return None

    def save(self, server: InstalledMarketplaceServer) -> InstalledMarketplaceServer:
        server.updated_at = datetime.now(timezone.utc).isoformat()
        servers = [item for item in self.list() if item.id != server.id]
        servers.append(server)
        servers.sort(key=lambda item: item.name.lower())
        self._write({"servers": [item.to_dict() for item in servers]})
        return server

    def delete(self, server_id: str) -> bool:
        servers = self.list()
        kept = [item for item in servers if item.id != server_id]
        if len(kept) == len(servers):
            return False
        self._write({"servers": [item.to_dict() for item in kept]})
        return True
```

- [ ] **Step 4: Run store tests**

Run: `python -m pytest tests/test_mcp_marketplace_store.py -v`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp_marketplace_store.py tests/test_mcp_marketplace_store.py
git commit -m "feat: persist MCP marketplace installs"
```

---

### Task 3: Runtime recipe validation and lifecycle helpers

**Files:**
- Create: `src/mcp_marketplace_runtime.py`
- Create: `tests/test_mcp_marketplace_runtime.py`

- [ ] **Step 1: Write failing runtime tests**

Create `tests/test_mcp_marketplace_runtime.py` with:

```python
import pytest

from src.mcp_marketplace_catalog import CatalogEntry
from src.mcp_marketplace_runtime import (
    build_mcp_server_config,
    install_marketplace_entry,
    marketplace_install_dir,
    validate_recipe,
)


def entry(runtime="npm", recipe=None, fields=None):
    return CatalogEntry(
        id="filesystem",
        name="Filesystem MCP",
        description="Filesystem",
        publisher="Curated",
        version="latest",
        runtime=runtime,
        recipe=recipe or {"package": "@modelcontextprotocol/server-filesystem", "args": ["{root}"]},
        config_fields=fields or [{"name": "root", "label": "Root", "type": "path", "required": True}],
        permissions=["Read/write selected root"],
        source_url="https://example.invalid/fs",
        source_id="local",
        source_priority=1,
    )


def test_marketplace_install_dir_rejects_path_traversal(tmp_path):
    with pytest.raises(ValueError, match="Invalid marketplace id"):
        marketplace_install_dir("../evil", tmp_path)


def test_validate_recipe_rejects_arbitrary_command():
    bad = entry(recipe={"command": "rm -rf /", "args": []})

    with pytest.raises(ValueError, match="package is required"):
        validate_recipe(bad, {"root": "/tmp"})


def test_install_marketplace_entry_creates_isolated_metadata(tmp_path):
    installed = install_marketplace_entry(entry(), {"root": str(tmp_path)}, tmp_path)

    assert installed.id == "filesystem"
    assert installed.mcp_server_id == "mkt-filesystem"
    assert installed.managed_process is True
    assert installed.status == "stopped"
    assert "Prepared npm package" in installed.logs[-1]


def test_build_mcp_server_config_for_npm(tmp_path):
    installed = install_marketplace_entry(entry(), {"root": str(tmp_path)}, tmp_path)

    config = build_mcp_server_config(entry(), installed)

    assert config["id"] == "mkt-filesystem"
    assert config["transport"] == "stdio"
    assert config["command"] == "npx"
    assert config["args"] == ["-y", "@modelcontextprotocol/server-filesystem", str(tmp_path)]
    assert config["env"] == {}


def test_build_mcp_server_config_for_sse():
    sse = entry(runtime="sse", recipe={"url": "{url}"}, fields=[{"name": "url", "label": "URL", "type": "url", "required": True}])
    installed = install_marketplace_entry(sse, {"url": "http://127.0.0.1:9999/sse"})

    config = build_mcp_server_config(sse, installed)

    assert config["transport"] == "sse"
    assert config["url"] == "http://127.0.0.1:9999/sse"
    assert installed.managed_process is False
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_runtime.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'src.mcp_marketplace_runtime'`.

- [ ] **Step 3: Implement runtime module**

Create `src/mcp_marketplace_runtime.py` with:

```python
"""Runtime helpers for MCP marketplace installs."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

from src.mcp_marketplace_catalog import CatalogEntry
from src.mcp_marketplace_store import InstalledMarketplaceServer

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_.-]+$")


def marketplace_install_dir(entry_id: str, base_dir: Path | str = "data/mcp_marketplace") -> Path:
    if not _SAFE_ID.match(entry_id):
        raise ValueError("Invalid marketplace id")
    base = Path(base_dir).resolve()
    target = (base / entry_id).resolve()
    if base not in target.parents and target != base:
        raise ValueError("Install path escapes marketplace directory")
    return target


def _render(value: Any, config: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        rendered = value
        for key, config_value in config.items():
            rendered = rendered.replace("{" + key + "}", str(config_value))
        return rendered
    if isinstance(value, list):
        return [_render(item, config) for item in value]
    if isinstance(value, dict):
        return {key: _render(item, config) for key, item in value.items()}
    return value


def validate_recipe(entry: CatalogEntry, config: Dict[str, Any]) -> None:
    missing = [field["name"] for field in entry.config_fields if field.get("required") and not config.get(field["name"])]
    if missing:
        raise ValueError(f"Missing required config: {', '.join(missing)}")
    if entry.runtime in {"npm", "python_uv"} and not entry.recipe.get("package"):
        raise ValueError("package is required for package runtimes")
    if entry.runtime == "docker" and not entry.recipe.get("image"):
        raise ValueError("image is required for docker runtime")
    if entry.runtime == "sse" and not entry.recipe.get("url"):
        raise ValueError("url is required for sse runtime")
    if "command" in entry.recipe:
        raise ValueError("arbitrary command recipes are not allowed")


def install_marketplace_entry(entry: CatalogEntry, config: Dict[str, Any], base_dir: Path | str = "data/mcp_marketplace") -> InstalledMarketplaceServer:
    validate_recipe(entry, config)
    install_dir = marketplace_install_dir(entry.id, base_dir)
    install_dir.mkdir(parents=True, exist_ok=True)
    (install_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    managed_process = entry.runtime != "sse"
    message = {
        "npm": f"Prepared npm package {entry.recipe.get('package')}",
        "python_uv": f"Prepared Python/uv package {entry.recipe.get('package')}",
        "docker": f"Prepared Docker image {entry.recipe.get('image')}",
        "sse": "Prepared external SSE connection",
    }[entry.runtime]
    return InstalledMarketplaceServer(
        id=entry.id,
        mcp_server_id=f"mkt-{entry.id}",
        catalog_entry_id=entry.id,
        name=entry.name,
        runtime=entry.runtime,
        install_dir=str(install_dir),
        config=config,
        status="stopped",
        managed_process=managed_process,
        logs=[message],
    )


def build_mcp_server_config(entry: CatalogEntry, installed: InstalledMarketplaceServer) -> Dict[str, Any]:
    recipe = _render(entry.recipe, installed.config)
    env = recipe.get("env") or {}
    if entry.runtime == "npm":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", recipe["package"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "python_uv":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "uvx",
            "args": [recipe["package"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "docker":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "docker",
            "args": ["run", "--rm", "-i", recipe["image"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "sse":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "sse",
            "command": None,
            "args": [],
            "env": env,
            "url": recipe["url"],
        }
    raise ValueError(f"Unsupported runtime: {entry.runtime}")


def status_color(status: str) -> str:
    if status in {"running", "connected"}:
        return "green"
    if status in {"installing", "starting", "reconnecting", "refreshing"}:
        return "yellow"
    return "red"
```

- [ ] **Step 4: Run runtime tests**

Run: `python -m pytest tests/test_mcp_marketplace_runtime.py -v`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp_marketplace_runtime.py tests/test_mcp_marketplace_runtime.py
git commit -m "feat: validate MCP marketplace runtime recipes"
```

---

### Task 4: Marketplace backend routes for catalogs and install

**Files:**
- Modify: `routes/mcp_routes.py`
- Create: `tests/test_mcp_marketplace_routes.py`

- [ ] **Step 1: Write failing route tests**

Create `tests/test_mcp_marketplace_routes.py` with:

```python
import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from routes import mcp_routes
from routes.mcp_routes import setup_mcp_routes


class FakeMcpManager:
    def __init__(self):
        self.connected = []
        self.disconnected = []

    def get_server_status(self, server_id):
        return {"status": "connected" if server_id in self.connected else "disconnected", "tool_count": 0, "error": None}

    def get_all_statuses(self):
        return {}

    def get_all_tools(self, disabled_map=None):
        return []

    async def connect_server(self, **kwargs):
        self.connected.append(kwargs["server_id"])
        return True

    async def disconnect_server(self, server_id):
        self.disconnected.append(server_id)


def make_client(monkeypatch, manager=None):
    app = FastAPI()
    mcp_routes.router.routes = []
    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)
    setup_mcp_routes(manager or FakeMcpManager())
    app.include_router(mcp_routes.router)
    return TestClient(app)


def test_marketplace_routes_require_admin(monkeypatch):
    app = FastAPI()
    mcp_routes.router.routes = []

    def deny(request: Request):
        raise HTTPException(status_code=403, detail="Admins only")

    monkeypatch.setattr(mcp_routes, "require_admin", deny)
    setup_mcp_routes(FakeMcpManager())
    app.include_router(mcp_routes.router)
    response = TestClient(app).get("/api/mcp/marketplace/entries")

    assert response.status_code == 403


def test_marketplace_refresh_and_entries(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    client = make_client(monkeypatch)

    refresh = client.post("/api/mcp/marketplace/catalogs/refresh")
    entries = client.get("/api/mcp/marketplace/entries")

    assert refresh.status_code == 200
    assert entries.status_code == 200
    assert any(item["id"] == "filesystem" for item in entries.json())


def test_marketplace_install_creates_installed_entry_and_connects(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    manager = FakeMcpManager()
    client = make_client(monkeypatch, manager)
    client.post("/api/mcp/marketplace/catalogs/refresh")

    response = client.post("/api/mcp/marketplace/install/filesystem", json={"config": {"root": str(tmp_path)}})

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "filesystem"
    assert data["mcp_server_id"] == "mkt-filesystem"
    assert "mkt-filesystem" in manager.connected

    installed = client.get("/api/mcp/marketplace/installed")
    assert installed.status_code == 200
    assert installed.json()[0]["status_color"] == "green"
```

- [ ] **Step 2: Run route tests to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py -v`

Expected: FAIL with 404 for marketplace routes.

- [ ] **Step 3: Add route imports and helpers**

In `routes/mcp_routes.py`, add imports near existing imports:

```python
from src.mcp_marketplace_catalog import (
    default_catalog_sources,
    get_catalog_entry,
    load_catalog_cache,
    refresh_catalog_cache,
)
from src.mcp_marketplace_runtime import build_mcp_server_config, install_marketplace_entry, status_color
from src.mcp_marketplace_store import MarketplaceStore
```

Inside `setup_mcp_routes(mcp_manager)`, after `_host_bridge_response`, add:

```python
    def _marketplace_store() -> MarketplaceStore:
        return MarketplaceStore()

    async def _connect_marketplace_server(entry, installed):
        config = build_mcp_server_config(entry, installed)
        db = SessionLocal()
        try:
            srv = db.query(McpServer).filter(McpServer.id == config["id"]).first()
            if not srv:
                srv = McpServer(id=config["id"], name=config["name"])
                db.add(srv)
            srv.name = config["name"]
            srv.transport = config["transport"]
            srv.command = config["command"]
            srv.args = json.dumps(config["args"])
            srv.env = json.dumps(config["env"])
            srv.url = config["url"]
            srv.is_enabled = True
            db.commit()
        finally:
            db.close()
        connected = await mcp_manager.connect_server(
            server_id=config["id"],
            name=config["name"],
            transport=config["transport"],
            command=config["command"],
            args=config["args"],
            env=config["env"],
            url=config["url"],
        )
        installed.status = "connected" if connected else "error"
        if not connected:
            status = mcp_manager.get_server_status(config["id"])
            installed.last_error = status.get("error")
        _marketplace_store().save(installed)
        return installed

    def _installed_payload(installed):
        status = mcp_manager.get_server_status(installed.mcp_server_id)
        effective_status = status.get("status") or installed.status
        return {
            **installed.to_dict(),
            "runtime_status": status,
            "status": effective_status,
            "status_color": status_color(effective_status),
            "tool_count": status.get("tool_count", 0),
        }
```

- [ ] **Step 4: Add marketplace routes**

Still inside `setup_mcp_routes(mcp_manager)`, before existing `@router.get("/servers")`, add:

```python
    @router.get("/marketplace/catalogs")
    def marketplace_catalogs(request: Request):
        require_admin(request)
        cache = load_catalog_cache()
        return {"sources": cache.get("sources", []), "refreshed_at": cache.get("refreshed_at"), "errors": cache.get("errors", [])}

    @router.post("/marketplace/catalogs/refresh")
    def marketplace_refresh_catalogs(request: Request):
        require_admin(request)
        return refresh_catalog_cache(default_catalog_sources())

    @router.get("/marketplace/entries")
    def marketplace_entries(request: Request):
        require_admin(request)
        cache = load_catalog_cache()
        return cache.get("entries", [])

    @router.post("/marketplace/install/{entry_id}")
    async def marketplace_install(entry_id: str, request: Request):
        require_admin(request)
        body = await request.json()
        config = body.get("config", {}) if isinstance(body, dict) else {}
        entry = get_catalog_entry(entry_id)
        if not entry:
            raise HTTPException(404, "Marketplace entry not found")
        try:
            installed = install_marketplace_entry(entry, config)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        installed = _marketplace_store().save(installed)
        installed = await _connect_marketplace_server(entry, installed)
        return _installed_payload(installed)

    @router.get("/marketplace/installed")
    def marketplace_installed(request: Request):
        require_admin(request)
        return [_installed_payload(installed) for installed in _marketplace_store().list()]
```

- [ ] **Step 5: Run route tests**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py -v`

Expected: PASS, 3 tests.

- [ ] **Step 6: Run existing MCP route tests**

Run: `python -m pytest tests/test_host_bridge_routes.py tests/test_mcp_manager.py -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add routes/mcp_routes.py tests/test_mcp_marketplace_routes.py
git commit -m "feat: add MCP marketplace catalog routes"
```

---

### Task 5: Installed server controls and uninstall routes

**Files:**
- Modify: `routes/mcp_routes.py`
- Modify: `src/mcp_marketplace_store.py`
- Modify: `src/mcp_marketplace_runtime.py`
- Modify: `tests/test_mcp_marketplace_routes.py`

- [ ] **Step 1: Add failing lifecycle route tests**

Append to `tests/test_mcp_marketplace_routes.py`:

```python

def test_marketplace_disconnect_and_connect_controls(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    manager = FakeMcpManager()
    client = make_client(monkeypatch, manager)
    client.post("/api/mcp/marketplace/catalogs/refresh")
    client.post("/api/mcp/marketplace/install/filesystem", json={"config": {"root": str(tmp_path)}})

    disconnected = client.post("/api/mcp/marketplace/installed/filesystem/stop")
    reconnected = client.post("/api/mcp/marketplace/installed/filesystem/start")

    assert disconnected.status_code == 200
    assert "mkt-filesystem" in manager.disconnected
    assert reconnected.status_code == 200
    assert manager.connected.count("mkt-filesystem") >= 2


def test_marketplace_uninstall_disconnects_and_removes_metadata(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    manager = FakeMcpManager()
    client = make_client(monkeypatch, manager)
    client.post("/api/mcp/marketplace/catalogs/refresh")
    client.post("/api/mcp/marketplace/install/filesystem", json={"config": {"root": str(tmp_path)}})

    response = client.delete("/api/mcp/marketplace/installed/filesystem")

    assert response.status_code == 200
    assert response.json()["status"] == "deleted"
    assert client.get("/api/mcp/marketplace/installed").json() == []
    assert "mkt-filesystem" in manager.disconnected
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py::test_marketplace_disconnect_and_connect_controls tests/test_mcp_marketplace_routes.py::test_marketplace_uninstall_disconnects_and_removes_metadata -v`

Expected: FAIL with 404 for lifecycle endpoints.

- [ ] **Step 3: Add runtime log helper**

In `src/mcp_marketplace_store.py`, add this method to `MarketplaceStore`:

```python
    def append_log(self, server_id: str, message: str, status: str | None = None, last_error: str | None = None) -> Optional[InstalledMarketplaceServer]:
        server = self.get(server_id)
        if not server:
            return None
        server.logs.append(message)
        server.logs = server.logs[-50:]
        if status:
            server.status = status
        server.last_error = last_error
        return self.save(server)
```

- [ ] **Step 4: Add lifecycle endpoints**

Inside `setup_mcp_routes(mcp_manager)`, after `marketplace_installed`, add:

```python
    async def _marketplace_start_installed(installed_id: str):
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        entry = get_catalog_entry(installed.catalog_entry_id)
        if not entry:
            raise HTTPException(404, "Marketplace entry not found")
        _marketplace_store().append_log(installed_id, "Starting marketplace server", status="starting")
        installed = await _connect_marketplace_server(entry, installed)
        return _installed_payload(installed)

    @router.post("/marketplace/installed/{installed_id}/start")
    async def marketplace_start(installed_id: str, request: Request):
        require_admin(request)
        return await _marketplace_start_installed(installed_id)

    @router.post("/marketplace/installed/{installed_id}/stop")
    async def marketplace_stop(installed_id: str, request: Request):
        require_admin(request)
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        await mcp_manager.disconnect_server(installed.mcp_server_id)
        installed = _marketplace_store().append_log(installed_id, "Stopped marketplace server", status="stopped")
        return _installed_payload(installed)

    @router.post("/marketplace/installed/{installed_id}/restart")
    async def marketplace_restart(installed_id: str, request: Request):
        require_admin(request)
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        await mcp_manager.disconnect_server(installed.mcp_server_id)
        _marketplace_store().append_log(installed_id, "Restarting marketplace server", status="reconnecting")
        return await _marketplace_start_installed(installed_id)

    @router.post("/marketplace/installed/{installed_id}/configure")
    async def marketplace_configure(installed_id: str, request: Request):
        require_admin(request)
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        body = await request.json()
        config = body.get("config", {}) if isinstance(body, dict) else {}
        entry = get_catalog_entry(installed.catalog_entry_id)
        if not entry:
            raise HTTPException(404, "Marketplace entry not found")
        try:
            updated = install_marketplace_entry(entry, config)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        updated.created_at = installed.created_at
        updated.logs = [*installed.logs, "Updated marketplace server configuration"][-50:]
        _marketplace_store().save(updated)
        return await _marketplace_start_installed(installed_id)

    @router.delete("/marketplace/installed/{installed_id}")
    async def marketplace_uninstall(installed_id: str, request: Request):
        require_admin(request)
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        await mcp_manager.disconnect_server(installed.mcp_server_id)
        db = SessionLocal()
        try:
            srv = db.query(McpServer).filter(McpServer.id == installed.mcp_server_id).first()
            if srv:
                db.delete(srv)
                db.commit()
        finally:
            db.close()
        _marketplace_store().delete(installed_id)
        return {"status": "deleted", "id": installed_id}
```

- [ ] **Step 5: Run lifecycle tests**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py -v`

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add routes/mcp_routes.py src/mcp_marketplace_store.py tests/test_mcp_marketplace_routes.py
git commit -m "feat: manage installed MCP marketplace servers"
```

---

### Task 6: Tool refresh helper and richer tool payloads

**Files:**
- Modify: `src/mcp_manager.py`
- Modify: `routes/mcp_routes.py`
- Modify: `tests/test_mcp_manager.py`
- Modify: `tests/test_mcp_marketplace_routes.py`

- [ ] **Step 1: Add failing manager refresh test**

Append to `tests/test_mcp_manager.py`:

```python

@pytest.mark.asyncio
async def test_refresh_server_tools_reconnects_enabled_db_server(monkeypatch):
    from types import SimpleNamespace

    from src.mcp_manager import McpManager

    manager = McpManager()
    calls = []

    class Query:
        def filter(self, *_args, **_kwargs):
            return self

        def first(self):
            return SimpleNamespace(
                id="mkt-filesystem",
                name="Filesystem MCP",
                transport="stdio",
                command="npx",
                args='["-y", "pkg"]',
                env='{}',
                url=None,
                is_enabled=True,
            )

    class DB:
        def query(self, _model):
            return Query()

        def close(self):
            pass

    async def fake_disconnect(server_id):
        calls.append(("disconnect", server_id))

    async def fake_connect(**kwargs):
        calls.append(("connect", kwargs["server_id"], kwargs["args"]))
        return True

    monkeypatch.setattr("src.database.SessionLocal", lambda: DB())
    monkeypatch.setattr(manager, "disconnect_server", fake_disconnect)
    monkeypatch.setattr(manager, "connect_server", fake_connect)
    monkeypatch.setattr(manager, "get_server_status", lambda server_id: {"status": "connected", "tool_count": 2})

    status = await manager.refresh_server_tools("mkt-filesystem")

    assert status == {"status": "connected", "tool_count": 2}
    assert calls == [("disconnect", "mkt-filesystem"), ("connect", "mkt-filesystem", ["-y", "pkg"])]
```

- [ ] **Step 2: Run manager test to verify failure**

Run: `python -m pytest tests/test_mcp_manager.py::test_refresh_server_tools_reconnects_enabled_db_server -v`

Expected: FAIL with `AttributeError: 'McpManager' object has no attribute 'refresh_server_tools'`.

- [ ] **Step 3: Implement manager refresh helper**

In `src/mcp_manager.py`, after `connect_all_enabled`, add:

```python
    async def refresh_server_tools(self, server_id: str) -> Dict[str, Any]:
        """Reconnect one enabled DB-backed MCP server and return its status."""
        from src.database import McpServer, SessionLocal

        db = SessionLocal()
        try:
            srv = db.query(McpServer).filter(McpServer.id == server_id).first()
            if not srv:
                return {"status": "error", "error": "Server not found"}
            if not srv.is_enabled:
                return {"status": "disabled", "tool_count": 0}
            args = json.loads(srv.args) if srv.args else []
            env = json.loads(srv.env) if srv.env else {}
        finally:
            db.close()

        await self.disconnect_server(server_id)
        await self.connect_server(
            server_id=srv.id,
            name=srv.name,
            transport=srv.transport,
            command=srv.command,
            args=args,
            env=env,
            url=srv.url,
        )
        return self.get_server_status(server_id)
```

- [ ] **Step 4: Add route test for refresh tools**

Append to `tests/test_mcp_marketplace_routes.py`:

```python

def test_marketplace_refresh_tools_uses_manager(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))

    class RefreshManager(FakeMcpManager):
        async def refresh_server_tools(self, server_id):
            self.connected.append(f"refresh:{server_id}")
            return {"status": "connected", "tool_count": 3}

    manager = RefreshManager()
    client = make_client(monkeypatch, manager)
    client.post("/api/mcp/marketplace/catalogs/refresh")
    client.post("/api/mcp/marketplace/install/filesystem", json={"config": {"root": str(tmp_path)}})

    response = client.post("/api/mcp/marketplace/installed/filesystem/refresh-tools")

    assert response.status_code == 200
    assert response.json()["tool_count"] == 3
    assert "refresh:mkt-filesystem" in manager.connected
```

- [ ] **Step 5: Add refresh-tools endpoint**

Inside `setup_mcp_routes(mcp_manager)`, near lifecycle routes, add:

```python
    @router.post("/marketplace/installed/{installed_id}/refresh-tools")
    async def marketplace_refresh_tools(installed_id: str, request: Request):
        require_admin(request)
        installed = _marketplace_store().get(installed_id)
        if not installed:
            raise HTTPException(404, "Installed marketplace server not found")
        _marketplace_store().append_log(installed_id, "Refreshing marketplace server tools", status="refreshing")
        if hasattr(mcp_manager, "refresh_server_tools"):
            await mcp_manager.refresh_server_tools(installed.mcp_server_id)
        else:
            entry = get_catalog_entry(installed.catalog_entry_id)
            if not entry:
                raise HTTPException(404, "Marketplace entry not found")
            await _connect_marketplace_server(entry, installed)
        installed = _marketplace_store().append_log(installed_id, "Refreshed marketplace server tools", status="connected")
        return _installed_payload(installed)
```

- [ ] **Step 6: Run tests**

Run: `python -m pytest tests/test_mcp_manager.py tests/test_mcp_marketplace_routes.py -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp_manager.py routes/mcp_routes.py tests/test_mcp_manager.py tests/test_mcp_marketplace_routes.py
git commit -m "feat: refresh MCP marketplace tools"
```

---

### Task 7: Admin marketplace UI markup and static regression

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`
- Create: `tests/test_mcp_marketplace_admin_js.py`

- [ ] **Step 1: Write failing static UI test**

Create `tests/test_mcp_marketplace_admin_js.py` with:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_admin_index_contains_mcp_marketplace_panel():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert "adm-mcp-marketplace" in html
    assert "adm-mcp-marketplace-browse" in html
    assert "adm-mcp-marketplace-installed" in html


def test_admin_js_wires_mcp_marketplace_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/marketplace/catalogs/refresh" in js
    assert "/api/mcp/marketplace/entries" in js
    assert "/api/mcp/marketplace/installed" in js
    assert "refresh-tools" in js


def test_style_contains_marketplace_status_colors():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    assert ".mcp-marketplace-card" in css
    assert ".mcp-status-green" in css
    assert ".mcp-status-yellow" in css
    assert ".mcp-status-red" in css
```

- [ ] **Step 2: Run static UI test to verify failure**

Run: `python -m pytest tests/test_mcp_marketplace_admin_js.py -v`

Expected: FAIL because marketplace markup and JS endpoints do not exist.

- [ ] **Step 3: Add marketplace markup**

In `static/index.html`, find the admin modal content around the admin Services/MCP section. Add this block near the existing MCP/admin tools section:

```html
<div class="admin-section" id="adm-mcp-marketplace">
  <div class="admin-section-head">
    <div>
      <h3>MCP Marketplace</h3>
      <p>Browse curated MCP servers, install approved recipes, and manage installed tools.</p>
    </div>
    <button class="admin-btn-sm" id="adm-mcp-marketplace-refresh">Refresh Catalogs</button>
  </div>
  <div class="mcp-marketplace-tabs">
    <button class="admin-btn-sm active" data-mcp-marketplace-tab="browse">Browse</button>
    <button class="admin-btn-sm" data-mcp-marketplace-tab="installed">Installed</button>
  </div>
  <div id="adm-mcp-marketplace-msg" class="adm-ep-inline-msg"></div>
  <div id="adm-mcp-marketplace-browse" class="mcp-marketplace-grid"></div>
  <div id="adm-mcp-marketplace-installed" class="mcp-marketplace-grid hidden"></div>
</div>
```

If `admin-section` is not the exact local class, use the nearest existing admin section wrapper and keep the ids exactly as shown.

- [ ] **Step 4: Add marketplace styles**

Append to `static/style.css`:

```css
/* MCP Marketplace */
.mcp-marketplace-tabs {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}

.mcp-marketplace-grid {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.mcp-marketplace-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 92%, var(--fg) 8%);
  padding: 10px;
}

.mcp-marketplace-card-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.mcp-marketplace-title {
  font-weight: 700;
  font-size: 13px;
}

.mcp-marketplace-meta,
.mcp-marketplace-desc,
.mcp-marketplace-perms,
.mcp-marketplace-logs {
  font-size: 11px;
  opacity: 0.72;
  margin-top: 4px;
  line-height: 1.45;
}

.mcp-marketplace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mcp-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.mcp-status-pill::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.mcp-status-green { color: #5cc879; }
.mcp-status-yellow { color: #d9a441; }
.mcp-status-red { color: #e06c75; }

.mcp-marketplace-tools {
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 8px;
}

.mcp-marketplace-tool-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
}

.mcp-marketplace-schema {
  grid-column: 1 / -1;
  font-size: 10px;
  white-space: pre-wrap;
  overflow: auto;
  max-height: 140px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
}
```

- [ ] **Step 5: Run static UI test**

Run: `python -m pytest tests/test_mcp_marketplace_admin_js.py -v`

Expected: still FAIL for JS endpoint strings; HTML/CSS assertions pass.

- [ ] **Step 6: Commit markup and styles**

```bash
git add static/index.html static/style.css tests/test_mcp_marketplace_admin_js.py
git commit -m "feat: add MCP marketplace admin markup"
```

---

### Task 8: Admin marketplace UI behavior

**Files:**
- Modify: `static/js/admin.js`
- Modify: `tests/test_mcp_marketplace_admin_js.py`

- [ ] **Step 1: Add endpoint behavior to admin.js**

In `static/js/admin.js`, after helper functions near the top, add:

```javascript
let _mcpMarketplaceEntries = [];
let _mcpMarketplaceInstalled = [];

function _marketplaceMsg(text, isError = false) {
  const msg = el('adm-mcp-marketplace-msg');
  if (!msg) return;
  msg.textContent = text || '';
  msg.className = isError ? 'adm-ep-inline-msg admin-error' : 'adm-ep-inline-msg admin-success';
}

function _statusClass(color) {
  if (color === 'green') return 'mcp-status-green';
  if (color === 'yellow') return 'mcp-status-yellow';
  return 'mcp-status-red';
}

async function _fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}
```

- [ ] **Step 2: Add browse rendering functions**

Add below the helpers:

```javascript
function renderMcpMarketplaceBrowse() {
  const list = el('adm-mcp-marketplace-browse');
  if (!list) return;
  if (!_mcpMarketplaceEntries.length) {
    list.innerHTML = '<div class="admin-empty">No catalog entries loaded. Refresh catalogs to begin.</div>';
    return;
  }
  list.innerHTML = _mcpMarketplaceEntries.map(entry => `
    <div class="mcp-marketplace-card" data-entry-id="${esc(entry.id)}">
      <div class="mcp-marketplace-card-head">
        <div>
          <div class="mcp-marketplace-title">${esc(entry.name)}</div>
          <div class="mcp-marketplace-meta">${esc(entry.runtime)} · ${esc(entry.publisher)} · ${esc(entry.version)}</div>
        </div>
        <button class="admin-btn-add" data-mcp-install="${esc(entry.id)}">Install</button>
      </div>
      <div class="mcp-marketplace-desc">${esc(entry.description)}</div>
      <div class="mcp-marketplace-perms">Permissions: ${(entry.permissions || []).map(esc).join(', ') || 'None listed'}</div>
    </div>
  `).join('');
}

async function loadMcpMarketplaceEntries() {
  const entries = await _fetchJson('/api/mcp/marketplace/entries');
  _mcpMarketplaceEntries = Array.isArray(entries) ? entries : [];
  renderMcpMarketplaceBrowse();
}

async function refreshMcpMarketplaceCatalogs() {
  _marketplaceMsg('Refreshing catalogs...');
  await _fetchJson('/api/mcp/marketplace/catalogs/refresh', { method: 'POST' });
  await loadMcpMarketplaceEntries();
  _marketplaceMsg('Catalogs refreshed');
}
```

- [ ] **Step 3: Add install/config prompt**

Add below browse functions:

```javascript
async function installMcpMarketplaceEntry(entryId) {
  const entry = _mcpMarketplaceEntries.find(item => item.id === entryId);
  if (!entry) return;
  const config = {};
  for (const field of (entry.config_fields || [])) {
    const value = await uiModule.styledPrompt(`${entry.name}: ${field.label || field.name}`, {
      placeholder: field.type === 'path' ? 'Path' : field.name,
      confirmText: 'Continue',
    });
    if (field.required && !value) {
      uiModule.showError(`${field.label || field.name} is required`);
      return;
    }
    if (value) config[field.name] = value;
  }
  _marketplaceMsg(`Installing ${entry.name}...`);
  await _fetchJson(`/api/mcp/marketplace/install/${encodeURIComponent(entryId)}`, {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
  await loadMcpMarketplaceInstalled();
  _marketplaceMsg(`${entry.name} installed`);
}
```

- [ ] **Step 4: Add installed rendering and controls**

Add below install function:

```javascript
function renderMcpMarketplaceInstalled() {
  const list = el('adm-mcp-marketplace-installed');
  if (!list) return;
  if (!_mcpMarketplaceInstalled.length) {
    list.innerHTML = '<div class="admin-empty">No marketplace servers installed.</div>';
    return;
  }
  list.innerHTML = _mcpMarketplaceInstalled.map(server => `
    <div class="mcp-marketplace-card" data-installed-id="${esc(server.id)}">
      <div class="mcp-marketplace-card-head">
        <div>
          <div class="mcp-marketplace-title">${esc(server.name)}</div>
          <div class="mcp-marketplace-meta">${esc(server.runtime)} · ${esc(server.mcp_server_id)} · ${server.tool_count || 0} tools</div>
        </div>
        <span class="mcp-status-pill ${_statusClass(server.status_color)}">${esc(server.status || 'unknown')}</span>
      </div>
      <div class="mcp-marketplace-actions">
        <button class="admin-btn-sm" data-mcp-action="start" data-installed-id="${esc(server.id)}">Start</button>
        <button class="admin-btn-sm" data-mcp-action="stop" data-installed-id="${esc(server.id)}">Stop</button>
        <button class="admin-btn-sm" data-mcp-action="restart" data-installed-id="${esc(server.id)}">Restart</button>
        <button class="admin-btn-sm" data-mcp-action="refresh-tools" data-installed-id="${esc(server.id)}">Refresh Tools</button>
        <button class="admin-btn-delete" data-mcp-action="delete" data-installed-id="${esc(server.id)}">Uninstall</button>
      </div>
      <div class="mcp-marketplace-logs">${esc((server.logs || []).slice(-3).join(' · '))}</div>
      <div class="mcp-marketplace-tools" data-mcp-tools-for="${esc(server.id)}"></div>
    </div>
  `).join('');
}

async function loadMcpMarketplaceInstalled() {
  const installed = await _fetchJson('/api/mcp/marketplace/installed');
  _mcpMarketplaceInstalled = Array.isArray(installed) ? installed : [];
  renderMcpMarketplaceInstalled();
}

async function runMcpMarketplaceAction(installedId, action) {
  if (action === 'delete') {
    if (!await uiModule.styledConfirm('Uninstall this MCP server?', { confirmText: 'Uninstall', danger: true })) return;
    await _fetchJson(`/api/mcp/marketplace/installed/${encodeURIComponent(installedId)}`, { method: 'DELETE' });
  } else {
    await _fetchJson(`/api/mcp/marketplace/installed/${encodeURIComponent(installedId)}/${action}`, { method: 'POST' });
  }
  await loadMcpMarketplaceInstalled();
}
```

- [ ] **Step 5: Wire initialization events**

Find the admin module initialization function. Add this logic where admin panel event listeners are registered:

```javascript
function initMcpMarketplace() {
  const root = el('adm-mcp-marketplace');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  el('adm-mcp-marketplace-refresh')?.addEventListener('click', () => {
    refreshMcpMarketplaceCatalogs().catch(err => _marketplaceMsg(err.message, true));
  });

  root.querySelectorAll('[data-mcp-marketplace-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.mcpMarketplaceTab;
      root.querySelectorAll('[data-mcp-marketplace-tab]').forEach(item => item.classList.toggle('active', item === btn));
      el('adm-mcp-marketplace-browse')?.classList.toggle('hidden', tab !== 'browse');
      el('adm-mcp-marketplace-installed')?.classList.toggle('hidden', tab !== 'installed');
      if (tab === 'installed') loadMcpMarketplaceInstalled().catch(err => _marketplaceMsg(err.message, true));
    });
  });

  root.addEventListener('click', event => {
    const installBtn = event.target.closest('[data-mcp-install]');
    if (installBtn) {
      installMcpMarketplaceEntry(installBtn.dataset.mcpInstall).catch(err => _marketplaceMsg(err.message, true));
      return;
    }
    const actionBtn = event.target.closest('[data-mcp-action]');
    if (actionBtn) {
      runMcpMarketplaceAction(actionBtn.dataset.installedId, actionBtn.dataset.mcpAction).catch(err => _marketplaceMsg(err.message, true));
    }
  });

  loadMcpMarketplaceEntries().catch(() => renderMcpMarketplaceBrowse());
  loadMcpMarketplaceInstalled().catch(() => renderMcpMarketplaceInstalled());
}
```

Then call `initMcpMarketplace();` from the existing admin initialization path after the modal exists.

- [ ] **Step 6: Run static UI test**

Run: `python -m pytest tests/test_mcp_marketplace_admin_js.py -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add static/js/admin.js tests/test_mcp_marketplace_admin_js.py
git commit -m "feat: wire MCP marketplace admin UI"
```

---

### Task 9: Tool drawer schema display and enable/disable

**Files:**
- Modify: `static/js/admin.js`
- Modify: `routes/mcp_routes.py`
- Modify: `tests/test_mcp_marketplace_routes.py`
- Modify: `tests/test_mcp_marketplace_admin_js.py`

- [ ] **Step 1: Add route test for schema and disabled state**

Append to `tests/test_mcp_marketplace_routes.py`:

```python

def test_server_tools_payload_includes_schema_and_disabled_state(monkeypatch):
    class ToolManager(FakeMcpManager):
        def get_all_tools(self, disabled_map=None):
            return [{
                "server_id": "mkt-filesystem",
                "server_name": "Filesystem MCP",
                "name": "read_file",
                "qualified_name": "mcp__mkt-filesystem__read_file",
                "description": "Read file",
                "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}},
            }]

    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)
    client = make_client(monkeypatch, ToolManager())

    response = client.get("/api/mcp/servers/mkt-filesystem/tools")

    assert response.status_code == 200
    tool = response.json()[0]
    assert tool["input_schema"]["properties"]["path"]["type"] == "string"
    assert tool["is_disabled"] is False
```

- [ ] **Step 2: Run route test**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py::test_server_tools_payload_includes_schema_and_disabled_state -v`

Expected: PASS if existing route preserves schema; if it fails, update `list_server_tools` in `routes/mcp_routes.py` to avoid dropping `input_schema`.

- [ ] **Step 3: Add JS static assertions for tools endpoints**

Append to `tests/test_mcp_marketplace_admin_js.py`:

```python

def test_admin_js_wires_mcp_tool_drawer_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools" in js
    assert "disabled" in js
    assert "input_schema" in js
```

- [ ] **Step 4: Add tool drawer JS**

In `static/js/admin.js`, update `renderMcpMarketplaceInstalled()` so each card includes a button:

```javascript
<button class="admin-btn-sm" data-mcp-action="tools" data-installed-id="${esc(server.id)}">Tools</button>
```

Add these functions below `runMcpMarketplaceAction`:

```javascript
async function loadMcpMarketplaceTools(installedId) {
  const server = _mcpMarketplaceInstalled.find(item => item.id === installedId);
  if (!server) return;
  const box = document.querySelector(`[data-mcp-tools-for="${CSS.escape(installedId)}"]`);
  if (!box) return;
  const tools = await _fetchJson(`/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools`);
  if (!tools.length) {
    box.innerHTML = '<div class="admin-empty">No tools discovered. Try Refresh Tools.</div>';
    return;
  }
  box.innerHTML = tools.map(tool => `
    <div class="mcp-marketplace-tool-row">
      <div>
        <div class="mcp-marketplace-title">${esc(tool.name)}</div>
        <div class="mcp-marketplace-desc">${esc(tool.description || '')}</div>
      </div>
      <label class="admin-switch">
        <input type="checkbox" data-mcp-tool-toggle="${esc(tool.name)}" data-installed-id="${esc(installedId)}" ${tool.is_disabled ? '' : 'checked'}>
        <span class="admin-slider"></span>
      </label>
      <pre class="mcp-marketplace-schema">${esc(JSON.stringify(tool.input_schema || {}, null, 2))}</pre>
    </div>
  `).join('');
}

async function toggleMcpMarketplaceTool(installedId, toolName, enabled) {
  const server = _mcpMarketplaceInstalled.find(item => item.id === installedId);
  if (!server) return;
  const tools = await _fetchJson(`/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools`);
  const disabled = tools.filter(tool => tool.is_disabled).map(tool => tool.name);
  const next = new Set(disabled);
  if (enabled) next.delete(toolName);
  else next.add(toolName);
  await _fetchJson(`/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled: Array.from(next) }),
  });
  await _fetchJson(`/api/mcp/marketplace/installed/${encodeURIComponent(installedId)}/refresh-tools`, { method: 'POST' });
  await loadMcpMarketplaceTools(installedId);
}
```

Update the `root.addEventListener('click', ...)` action handler so action `tools` calls `loadMcpMarketplaceTools(installedId)` instead of `runMcpMarketplaceAction`.

Add a change handler in `initMcpMarketplace()`:

```javascript
  root.addEventListener('change', event => {
    const toggle = event.target.closest('[data-mcp-tool-toggle]');
    if (!toggle) return;
    toggleMcpMarketplaceTool(toggle.dataset.installedId, toggle.dataset.mcpToolToggle, toggle.checked)
      .catch(err => _marketplaceMsg(err.message, true));
  });
```

- [ ] **Step 5: Run route and static UI tests**

Run: `python -m pytest tests/test_mcp_marketplace_routes.py tests/test_mcp_marketplace_admin_js.py -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/mcp_routes.py static/js/admin.js tests/test_mcp_marketplace_routes.py tests/test_mcp_marketplace_admin_js.py
git commit -m "feat: manage MCP marketplace tool toggles"
```

---

### Task 10: Full verification and Ralph loop handoff

**Files:**
- Verify all files changed in Tasks 1-9.
- Use Ralph loop for iterative integration per user request.

- [ ] **Step 1: Run focused backend tests**

Run: `python -m pytest tests/test_mcp_marketplace_catalog.py tests/test_mcp_marketplace_store.py tests/test_mcp_marketplace_runtime.py tests/test_mcp_marketplace_routes.py tests/test_mcp_manager.py tests/test_host_bridge_routes.py -v`

Expected: PASS.

- [ ] **Step 2: Run static UI tests**

Run: `python -m pytest tests/test_mcp_marketplace_admin_js.py -v`

Expected: PASS.

- [ ] **Step 3: Run broader MCP/security-adjacent regression tests**

Run: `python -m pytest tests/test_security_regressions.py tests/test_review_regressions.py -v`

Expected: PASS or unrelated pre-existing failures documented with exact failing test names and errors.

- [ ] **Step 4: Manual UI smoke check**

Start Odysseus using the repository's normal dev command. Open the admin panel and verify:

- MCP Marketplace panel appears.
- Refresh Catalogs populates Filesystem, SQLite, and Playwright entries.
- Browse/Installed tabs switch.
- Installing Filesystem prompts for a root path.
- Installed card shows status, logs, and action buttons.
- Tools button opens a drawer when tools are available.

- [ ] **Step 5: Start Ralph loop for 50 iterations**

Invoke the Ralph loop skill with a prompt equivalent to:

```text
Integrate the MCP Marketplace Admin Panel feature from docs/superpowers/plans/2026-06-03-mcp-marketplace-admin-panel.md. Run 50 iterations. Work task-by-task from the plan, keep changes focused, run the specified tests, and stop for review if tests fail or requirements conflict. Respect the existing uncommitted user changes in this repository and do not discard them.
```

- [ ] **Step 6: Final verification gate**

Because this feature touches backend/API, frontend UI, and multiple files, run an independent `verification` agent before claiming completion. Pass the original user request, changed files, implementation approach, and this plan path.

- [ ] **Step 7: Final commit sequence**

If the user granted implementation-wide commit permission, create commits matching task boundaries. Otherwise, report the changed files and ask whether to commit.

---

## Self-review

- Spec coverage: catalog sources, manual refresh, recipe-only installs, isolated install dirs, npm/Python/uv/Docker/SSE runtimes, guided config, installed actions, tool drawer, admin-only routes, auto-registration through `McpManager`, and tests are each covered by tasks above.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain. Code blocks define the functions/classes used later.
- Type consistency: `CatalogEntry`, `CatalogSource`, `InstalledMarketplaceServer`, `MarketplaceStore`, route ids, and JS endpoint names are consistent across tasks.
- Scope: this is one integrated feature plan. It is large but each task produces testable software and can be iterated by Ralph loop.
