# Expanded MCP Marketplace Local Installs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the MCP Marketplace into a large local-install-only catalog sourced from the official MCP Registry plus curated outsourced libraries, while keeping Odysseus able to install/start/stop/restart/configure/refresh each installed MCP server.

**Architecture:** Keep the current Marketplace catalog/cache/store/runtime shape, but split external registry ingestion into a focused module. The existing curated JSON catalogs remain the trusted override layer; external registry/list entries are normalized into the same `CatalogEntry` objects only when they map to safe local npm/PyPI-uv/Docker recipes. The UI remains in the visible sidebar and collapsed rail, and the Marketplace modal gains search/filter controls for hundreds of entries.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy, pytest, vanilla JavaScript modules, static HTML/CSS, Docker Compose, official MCP Registry REST API.

---

## File Structure

- Modify `src/mcp_marketplace_catalog.py`
  - Add source types (`file`, `registry`) while preserving existing local curated catalog behavior.
  - Add `categories`, `tags`, and `package_type` metadata to `CatalogEntry`.
  - Keep manual refresh/cache API stable for existing routes.
- Create `src/mcp_marketplace_registry.py`
  - Fetch paginated official MCP Registry server data.
  - Normalize only local install package records into raw catalog entries.
  - Exclude remote-only entries.
- Modify `src/mcp_marketplace_runtime.py`
  - Add separate Docker/OCI image validation so real images like `ghcr.io/org/server:1.0.0` can be installed safely.
  - Keep arbitrary command rejection.
- Modify `routes/mcp_routes.py`
  - Make manual Marketplace refresh include external registry sources.
  - Keep normal page load/cache reads local and fast.
- Modify `static/index.html`
  - Keep visible `tool-mcp-marketplace-btn` above Brain and collapsed `rail-mcp-marketplace` above Brain.
  - Add Browse filters/search controls inside the Marketplace modal.
- Modify `static/js/admin.js`
  - Load/filter 300+ entries client-side for the current loaded result set.
  - Add search/category/runtime/source filters and Load More.
  - Preserve install/start/stop/restart/configure/refresh-tools/uninstall behavior.
- Modify `static/style.css`
  - Add minimal filter toolbar and metadata badge styles using existing Odysseus visual language.
- Modify tests:
  - `tests/test_mcp_marketplace_catalog.py`
  - `tests/test_mcp_marketplace_registry.py` (new)
  - `tests/test_mcp_marketplace_runtime.py`
  - `tests/test_mcp_marketplace_routes.py`
  - `tests/test_mcp_marketplace_admin_js.py`

No git commits are authorized by this plan unless the user explicitly grants commit permission. Treat commit steps as checkpoint notes only if permission is absent.

---

### Task 1: Lock current visible Marketplace placement

**Files:**
- Modify: `tests/test_mcp_marketplace_admin_js.py`
- Modify: `static/index.html`
- Modify: `static/js/admin.js`

- [ ] **Step 1: Write/confirm the failing placement test exists**

Ensure `tests/test_mcp_marketplace_admin_js.py` contains these two tests with a blank line between them:

```python
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_index_has_standalone_marketplace_rail_button_above_brain():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    rail_html = html[html.index('id="icon-rail"') : html.index('<nav class="sidebar"', html.index('id="icon-rail"'))]
    rail_button_ids = re.findall(r'<button[^>]+id="([^"]+)"', rail_html)

    assert "rail-mcp-marketplace" in rail_button_ids
    assert rail_button_ids[rail_button_ids.index("rail-memory") - 1] == "rail-mcp-marketplace"
    assert "mcp-marketplace-modal" in html
    assert "adm-mcp-marketplace-browse" in html
    assert "adm-mcp-marketplace-installed" in html


def test_index_has_visible_marketplace_sidebar_entry_above_brain():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    tools_html = html[html.index('id="tools-section"') : html.index('<div class="sidebar-user-bar"', html.index('id="tools-section"'))]
    tool_item_ids = re.findall(r'<div class="list-item" id="([^"]+)"', tools_html)

    assert "tool-mcp-marketplace-btn" in tool_item_ids
    assert tool_item_ids[tool_item_ids.index("tool-memory-btn") - 1] == "tool-mcp-marketplace-btn"
    assert "MCP Marketplace" in tools_html
```

- [ ] **Step 2: Run placement test**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py -q
```

Expected: `6 passed`. If it fails because the visible sidebar entry is missing, fix `static/index.html` so `tool-mcp-marketplace-btn` is immediately before `tool-memory-btn` in `#tools-section`, and fix `static/js/admin.js` so `initMcpMarketplaceRail()` attaches `openMcpMarketplaceModal` to both `rail-mcp-marketplace` and `tool-mcp-marketplace-btn`.

- [ ] **Step 3: Verify browser-visible state**

After Docker rebuild later, verify through Chrome DevTools MCP or browser JS:

```javascript
() => {
  const item = document.querySelector('#tool-mcp-marketplace-btn');
  const modal = document.querySelector('#mcp-marketplace-modal');
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return {
    visible: item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0,
    directlyAboveBrain: item.nextElementSibling.id === 'tool-memory-btn',
    modalOpened: modal && !modal.classList.contains('hidden')
  };
}
```

Expected: all three values are `true`.

---

### Task 2: Add registry normalization module

**Files:**
- Create: `src/mcp_marketplace_registry.py`
- Create: `tests/test_mcp_marketplace_registry.py`

- [ ] **Step 1: Write failing tests for local package mapping and remote exclusion**

Create `tests/test_mcp_marketplace_registry.py`:

```python
from src.mcp_marketplace_registry import normalize_registry_servers, registry_entries_from_payload


def test_registry_payload_maps_npm_package_to_marketplace_entry():
    payload = {
        "servers": [{
            "server": {
                "name": "io.github.acme/files",
                "title": "Acme Files",
                "description": "File tools from Acme",
                "version": "1.2.3",
                "repository": {"url": "https://github.com/acme/files", "source": "github"},
                "packages": [{
                    "registryType": "npm",
                    "identifier": "@acme/mcp-files",
                    "version": "1.2.3",
                    "transport": {"type": "stdio"},
                }],
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}},
        }],
        "metadata": {"nextCursor": None, "count": 1},
    }

    entries = registry_entries_from_payload(payload, source_id="official-mcp-registry", source_priority=60)

    assert len(entries) == 1
    entry = entries[0]
    assert entry["id"] == "registry-io.github.acme-files-npm-acme-mcp-files"
    assert entry["name"] == "Acme Files"
    assert entry["runtime"] == "npm"
    assert entry["recipe"] == {"package": "@acme/mcp-files", "args": []}
    assert entry["package_type"] == "npm"
    assert entry["categories"] == ["Registry"]
    assert "registry" in entry["tags"]


def test_registry_payload_maps_pypi_package_to_python_uv_runtime():
    payload = {
        "servers": [{
            "server": {
                "name": "io.github.acme/db",
                "description": "Database tools",
                "version": "0.4.0",
                "packages": [{"registryType": "pypi", "identifier": "acme-mcp-db", "version": "0.4.0", "transport": {"type": "stdio"}}],
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}},
        }],
        "metadata": {"nextCursor": None, "count": 1},
    }

    entries = registry_entries_from_payload(payload, source_id="official-mcp-registry", source_priority=60)

    assert entries[0]["runtime"] == "python_uv"
    assert entries[0]["recipe"] == {"package": "acme-mcp-db", "args": []}
    assert entries[0]["package_type"] == "pypi"


def test_registry_payload_maps_oci_package_to_docker_runtime():
    payload = {
        "servers": [{
            "server": {
                "name": "io.github.acme/browser",
                "description": "Browser tools",
                "version": "2.0.0",
                "packages": [{"registryType": "oci", "identifier": "ghcr.io/acme/mcp-browser:2.0.0", "version": "2.0.0", "transport": {"type": "stdio"}}],
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}},
        }],
        "metadata": {"nextCursor": None, "count": 1},
    }

    entries = registry_entries_from_payload(payload, source_id="official-mcp-registry", source_priority=60)

    assert entries[0]["runtime"] == "docker"
    assert entries[0]["recipe"] == {"image": "ghcr.io/acme/mcp-browser:2.0.0", "args": []}
    assert entries[0]["package_type"] == "oci"


def test_registry_payload_excludes_remote_only_server():
    payload = {
        "servers": [{
            "server": {
                "name": "io.github.acme/remote-only",
                "description": "Remote only",
                "version": "1.0.0",
                "remotes": [{"type": "streamable-http", "url": "https://example.invalid/mcp"}],
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}},
        }],
        "metadata": {"nextCursor": None, "count": 1},
    }

    assert registry_entries_from_payload(payload, source_id="official-mcp-registry", source_priority=60) == []


def test_registry_payload_excludes_non_latest_or_inactive_server():
    payload = {
        "servers": [
            {"server": {"name": "old", "description": "Old", "version": "1", "packages": [{"registryType": "npm", "identifier": "old-mcp"}]}, "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": False}}},
            {"server": {"name": "inactive", "description": "Inactive", "version": "1", "packages": [{"registryType": "npm", "identifier": "inactive-mcp"}]}, "_meta": {"io.modelcontextprotocol.registry/official": {"status": "deleted", "isLatest": True}}},
        ],
        "metadata": {"nextCursor": None, "count": 2},
    }

    assert registry_entries_from_payload(payload, source_id="official-mcp-registry", source_priority=60) == []


def test_normalize_registry_servers_handles_raw_server_lists():
    raw_servers = [{
        "server": {
            "name": "io.github.acme/search",
            "title": "Acme Search",
            "description": "Search tools",
            "version": "1.0.0",
            "packages": [{"registryType": "npm", "identifier": "acme-search-mcp"}],
        },
        "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}},
    }]

    entries = normalize_registry_servers(raw_servers, source_id="official-mcp-registry", source_priority=60)

    assert len(entries) == 1
    assert entries[0]["id"] == "registry-io.github.acme-search-npm-acme-search-mcp"
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_registry.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'src.mcp_marketplace_registry'`.

- [ ] **Step 3: Implement minimal registry normalization**

Create `src/mcp_marketplace_registry.py`:

```python
"""Official MCP Registry ingestion helpers for local-install Marketplace entries."""

from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, Iterable, List

_REGISTRY_ID_SAFE = re.compile(r"[^a-zA-Z0-9_.-]+")


def _slug(value: str) -> str:
    cleaned = _REGISTRY_ID_SAFE.sub("-", value.strip()).strip("-")
    return cleaned or "unknown"


def _official_meta(record: Dict[str, Any]) -> Dict[str, Any]:
    return ((record.get("_meta") or {}).get("io.modelcontextprotocol.registry/official") or {})


def _is_latest_active(record: Dict[str, Any]) -> bool:
    meta = _official_meta(record)
    return meta.get("status", "active") == "active" and meta.get("isLatest", True) is True


def _runtime_for_package(package: Dict[str, Any]) -> str | None:
    registry_type = str(package.get("registryType") or "").lower()
    if registry_type == "npm":
        return "npm"
    if registry_type == "pypi":
        return "python_uv"
    if registry_type in {"oci", "docker"}:
        return "docker"
    return None


def _recipe_for_package(package: Dict[str, Any], runtime: str) -> Dict[str, Any]:
    identifier = str(package.get("identifier") or "").strip()
    if runtime == "docker":
        return {"image": identifier, "args": []}
    return {"package": identifier, "args": []}


def normalize_registry_servers(raw_servers: Iterable[Dict[str, Any]], source_id: str, source_priority: int) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for record in raw_servers:
        if not _is_latest_active(record):
            continue
        server = record.get("server") or record
        packages = server.get("packages") or []
        if not packages:
            continue
        server_name = str(server.get("name") or "unknown")
        title = str(server.get("title") or server_name.rsplit("/", 1)[-1])
        description = str(server.get("description") or "No description provided.")
        version = str(server.get("version") or "latest")
        repository = server.get("repository") or {}
        source_url = str(repository.get("url") or server.get("websiteUrl") or "https://registry.modelcontextprotocol.io")
        publisher = str(repository.get("source") or server_name.split("/", 1)[0] or "MCP Registry")
        for package in packages:
            runtime = _runtime_for_package(package)
            identifier = str(package.get("identifier") or "").strip()
            if not runtime or not identifier:
                continue
            package_type = str(package.get("registryType") or "").lower()
            package_slug = _slug(identifier.replace("@", ""))
            entry_id = f"registry-{_slug(server_name)}-{package_type}-{package_slug}"
            entries.append({
                "id": entry_id,
                "name": title,
                "description": description,
                "publisher": publisher,
                "version": str(package.get("version") or version),
                "runtime": runtime,
                "recipe": _recipe_for_package(package, runtime),
                "config_fields": [],
                "permissions": ["Local MCP server package from the official MCP Registry"],
                "source_url": source_url,
                "package_type": package_type,
                "categories": ["Registry"],
                "tags": ["registry", package_type, runtime],
            })
    return entries


def registry_entries_from_payload(payload: Dict[str, Any], source_id: str, source_priority: int) -> List[Dict[str, Any]]:
    return normalize_registry_servers(payload.get("servers") or [], source_id=source_id, source_priority=source_priority)
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_registry.py -q
```

Expected: `6 passed`.

---

### Task 3: Add registry pagination fetcher

**Files:**
- Modify: `src/mcp_marketplace_registry.py`
- Modify: `tests/test_mcp_marketplace_registry.py`

- [ ] **Step 1: Add failing pagination test**

Append to `tests/test_mcp_marketplace_registry.py`:

```python
from src.mcp_marketplace_registry import fetch_registry_catalog


class FakeRegistryResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeRegistryClient:
    def __init__(self):
        self.urls = []

    def get(self, url, params=None, timeout=None):
        self.urls.append((url, params, timeout))
        if not params or not params.get("cursor"):
            return FakeRegistryResponse({
                "servers": [{"server": {"name": "one", "description": "One", "version": "1", "packages": [{"registryType": "npm", "identifier": "one-mcp"}]}, "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}}}],
                "metadata": {"nextCursor": "next-page", "count": 1},
            })
        return FakeRegistryResponse({
            "servers": [{"server": {"name": "two", "description": "Two", "version": "1", "packages": [{"registryType": "npm", "identifier": "two-mcp"}]}, "_meta": {"io.modelcontextprotocol.registry/official": {"status": "active", "isLatest": True}}}],
            "metadata": {"nextCursor": None, "count": 1},
        })


def test_fetch_registry_catalog_follows_cursor_pages():
    client = FakeRegistryClient()

    entries = fetch_registry_catalog("https://registry.example/v0.1/servers", source_id="official-mcp-registry", source_priority=60, client=client, page_limit=5)

    assert [entry["id"] for entry in entries] == [
        "registry-one-npm-one-mcp",
        "registry-two-npm-two-mcp",
    ]
    assert client.urls[0][1] == {"limit": 96}
    assert client.urls[1][1] == {"limit": 96, "cursor": "next-page"}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_registry.py::test_fetch_registry_catalog_follows_cursor_pages -q
```

Expected: FAIL with `ImportError` or `NameError` for `fetch_registry_catalog`.

- [ ] **Step 3: Implement fetcher**

Add to `src/mcp_marketplace_registry.py`:

```python
import httpx


def fetch_registry_catalog(
    url: str,
    source_id: str,
    source_priority: int,
    client: Any | None = None,
    page_limit: int = 10,
    request_timeout: float = 20.0,
) -> List[Dict[str, Any]]:
    http_client = client or httpx.Client()
    close_client = client is None
    cursor = None
    entries: List[Dict[str, Any]] = []
    try:
        for _ in range(page_limit):
            params = {"limit": 96}
            if cursor:
                params["cursor"] = cursor
            response = http_client.get(url, params=params, timeout=request_timeout)
            response.raise_for_status()
            payload = response.json()
            entries.extend(registry_entries_from_payload(payload, source_id=source_id, source_priority=source_priority))
            cursor = (payload.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
    finally:
        if close_client and hasattr(http_client, "close"):
            http_client.close()
    return entries
```

- [ ] **Step 4: Run registry tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_registry.py -q
```

Expected: `7 passed`.

---

### Task 4: Extend CatalogEntry metadata and source dispatch

**Files:**
- Modify: `src/mcp_marketplace_catalog.py`
- Modify: `tests/test_mcp_marketplace_catalog.py`

- [ ] **Step 1: Add failing metadata/source tests**

Append to `tests/test_mcp_marketplace_catalog.py`:

```python

def test_catalog_entry_preserves_categories_tags_and_package_type():
    raw = {
        "id": "registry-search",
        "name": "Registry Search",
        "description": "Search MCP",
        "publisher": "registry",
        "version": "1.0.0",
        "runtime": "npm",
        "recipe": {"package": "registry-search-mcp"},
        "config_fields": [],
        "permissions": [],
        "source_url": "https://registry.modelcontextprotocol.io",
        "categories": ["Search"],
        "tags": ["registry", "npm"],
        "package_type": "npm",
    }

    entry = CatalogEntry.from_raw(raw, source_id="official-mcp-registry", source_priority=60)

    assert entry.categories == ["Search"]
    assert entry.tags == ["registry", "npm"]
    assert entry.package_type == "npm"
    assert entry.to_dict()["categories"] == ["Search"]


def test_registry_source_is_loaded_through_fetcher(monkeypatch):
    from src import mcp_marketplace_catalog as catalog

    def fake_fetch(url, source_id, source_priority):
        assert url == "https://registry.example/v0.1/servers"
        assert source_id == "official-mcp-registry"
        assert source_priority == 60
        return [{
            "id": "registry-one",
            "name": "Registry One",
            "description": "One",
            "publisher": "Registry",
            "version": "1",
            "runtime": "npm",
            "recipe": {"package": "one-mcp"},
            "config_fields": [],
            "permissions": [],
            "source_url": "https://registry.example",
            "categories": ["Registry"],
            "tags": ["registry"],
            "package_type": "npm",
        }]

    monkeypatch.setattr(catalog, "fetch_registry_catalog", fake_fetch)
    sources = [CatalogSource(id="official-mcp-registry", name="Official MCP Registry", priority=60, path="https://registry.example/v0.1/servers", type="registry")]

    entries, errors = normalize_catalog_entries(sources)

    assert errors == []
    assert entries[0].id == "registry-one"
    assert entries[0].categories == ["Registry"]
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_catalog.py::test_catalog_entry_preserves_categories_tags_and_package_type tests/test_mcp_marketplace_catalog.py::test_registry_source_is_loaded_through_fetcher -q
```

Expected: FAIL because `CatalogEntry` lacks fields and `CatalogSource` lacks `type`.

- [ ] **Step 3: Implement catalog metadata/source type**

In `src/mcp_marketplace_catalog.py`:

1. Import registry fetcher near the top:

```python
from src.mcp_marketplace_registry import fetch_registry_catalog
```

2. Change `CatalogSource` to:

```python
@dataclass(frozen=True)
class CatalogSource:
    id: str
    name: str
    priority: int
    path: str
    type: str = "file"

    def to_public_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name, "priority": self.priority, "path": self.path, "type": self.type}
```

3. Add fields to `CatalogEntry`:

```python
    categories: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    package_type: str | None = None
```

4. In `CatalogEntry.from_raw`, add to the constructor:

```python
            categories=[str(category) for category in (raw.get("categories") or [])],
            tags=[str(tag) for tag in (raw.get("tags") or [])],
            package_type=str(raw["package_type"]) if raw.get("package_type") else None,
```

5. At the start of `_load_source_entries`, before file path handling, add registry dispatch:

```python
    if source.type == "registry":
        try:
            raw_entries = fetch_registry_catalog(source.path, source.id, source.priority)
        except Exception as exc:
            return [], [f"{source.id}: {exc}"]
        entries = []
        errors: List[str] = []
        for raw_entry in raw_entries:
            try:
                entries.append(CatalogEntry.from_raw(raw_entry, source.id, source.priority))
            except ValueError as exc:
                errors.append(f"{source.id}/{raw_entry.get('id', 'unknown')}: {exc}")
        return entries, errors
```

- [ ] **Step 4: Run catalog tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_catalog.py -q
```

Expected: all catalog tests pass.

---

### Task 5: Keep normal cache reads local, external refresh manual

**Files:**
- Modify: `src/mcp_marketplace_catalog.py`
- Modify: `routes/mcp_routes.py`
- Modify: `tests/test_mcp_marketplace_catalog.py`
- Modify: `tests/test_mcp_marketplace_routes.py`

- [ ] **Step 1: Add failing tests for external source policy**

Append to `tests/test_mcp_marketplace_catalog.py`:

```python

def test_default_catalog_sources_are_local_by_default(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))

    sources = default_catalog_sources()

    assert {source.id for source in sources} >= {"odysseus-curated", "odysseus-community-curated"}
    assert "official-mcp-registry" not in {source.id for source in sources}


def test_default_catalog_sources_can_include_external_registry(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))

    sources = default_catalog_sources(include_external=True)
    registry = [source for source in sources if source.id == "official-mcp-registry"][0]

    assert registry.type == "registry"
    assert registry.path == "https://registry.modelcontextprotocol.io/v0.1/servers"
```

Add to `tests/test_mcp_marketplace_routes.py`:

```python

def test_marketplace_refresh_uses_external_registry_sources(monkeypatch, admin_client):
    from src import mcp_marketplace_catalog as catalog

    called = {}

    def fake_default_sources(include_external=False):
        called["include_external"] = include_external
        return []

    monkeypatch.setattr(catalog, "default_catalog_sources", fake_default_sources)
    monkeypatch.setattr("routes.mcp_routes.default_catalog_sources", fake_default_sources)
    monkeypatch.setattr("routes.mcp_routes.refresh_catalog_cache", lambda sources: {"entries": [], "sources": [], "errors": []})

    response = admin_client.post("/api/mcp/marketplace/catalogs/refresh")

    assert response.status_code == 200
    assert called["include_external"] is True
```

If this route test fixture name does not match the current file, adapt the test to the existing `client`/admin fixture pattern already used in `tests/test_mcp_marketplace_routes.py`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_catalog.py::test_default_catalog_sources_can_include_external_registry tests/test_mcp_marketplace_routes.py::test_marketplace_refresh_uses_external_registry_sources -q
```

Expected: FAIL because `include_external` is not implemented.

- [ ] **Step 3: Implement external source option**

Change `default_catalog_sources` in `src/mcp_marketplace_catalog.py`:

```python
def default_catalog_sources(include_external: bool = False) -> List[CatalogSource]:
    base = _marketplace_dir()
    sources = [
        CatalogSource(id="odysseus-curated", name="Odysseus Curated", priority=100, path=str(base / "curated_catalog.json")),
        CatalogSource(id="odysseus-community-curated", name="Odysseus Community Curated", priority=80, path=str(base / "community_curated_catalog.json")),
    ]
    if include_external:
        sources.append(CatalogSource(
            id="official-mcp-registry",
            name="Official MCP Registry",
            priority=60,
            path=os.environ.get("ODYSSEUS_MCP_REGISTRY_URL", "https://registry.modelcontextprotocol.io/v0.1/servers"),
            type="registry",
        ))
    return sources
```

Change `routes/mcp_routes.py` refresh endpoint:

```python
    @router.post("/marketplace/catalogs/refresh")
    def marketplace_refresh_catalogs(request: Request):
        require_admin(request)
        return refresh_catalog_cache(default_catalog_sources(include_external=True))
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_catalog.py tests/test_mcp_marketplace_routes.py -q
```

Expected: PASS, except unrelated existing project-wide warnings are okay.

---

### Task 6: Add Docker/OCI image validation separate from package validation

**Files:**
- Modify: `src/mcp_marketplace_runtime.py`
- Modify: `tests/test_mcp_marketplace_runtime.py`

- [ ] **Step 1: Add failing Docker image validation tests**

Append to `tests/test_mcp_marketplace_runtime.py`:

```python

def test_validate_recipe_accepts_registry_oci_image_identifier():
    entry = CatalogEntry(
        id="docker-registry",
        name="Docker Registry MCP",
        description="Docker registry image",
        publisher="Registry",
        version="1.0.0",
        runtime="docker",
        recipe={"image": "ghcr.io/acme/mcp-server:1.0.0", "args": []},
        config_fields=[],
        permissions=[],
        source_url="https://registry.modelcontextprotocol.io",
        source_id="official-mcp-registry",
        source_priority=60,
    )

    validate_recipe(entry, {})


def test_validate_recipe_rejects_malformed_docker_image_identifier():
    entry = CatalogEntry(
        id="bad-docker",
        name="Bad Docker MCP",
        description="Bad docker image",
        publisher="Registry",
        version="1.0.0",
        runtime="docker",
        recipe={"image": "ghcr.io/acme/mcp;rm -rf /", "args": []},
        config_fields=[],
        permissions=[],
        source_url="https://registry.modelcontextprotocol.io",
        source_id="official-mcp-registry",
        source_priority=60,
    )

    try:
        validate_recipe(entry, {})
    except ValueError as exc:
        assert "Invalid image identifier" in str(exc)
    else:
        raise AssertionError("malformed docker image should fail")
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_runtime.py::test_validate_recipe_accepts_registry_oci_image_identifier tests/test_mcp_marketplace_runtime.py::test_validate_recipe_rejects_malformed_docker_image_identifier -q
```

Expected: first test fails because current package regex rejects `ghcr.io/acme/mcp-server:1.0.0`.

- [ ] **Step 3: Implement Docker image regex**

In `src/mcp_marketplace_runtime.py`, add below `_SAFE_PACKAGE`:

```python
_SAFE_IMAGE = re.compile(r"^[a-z0-9]+(?:(?:[._-][a-z0-9]+)+)?(?::[0-9]+)?(?:/[a-z0-9]+(?:(?:[._-][a-z0-9]+)+)?)*(?::[A-Za-z0-9_.-]+)?$")
```

Add helper:

```python
def _validate_image_identifier(image: str) -> None:
    if not _SAFE_IMAGE.match(image):
        raise ValueError("Invalid image identifier")
```

Change Docker validation in `validate_recipe`:

```python
    if entry.runtime == "docker" and not entry.recipe.get("image"):
        raise ValueError("image is required for docker runtime")
    if entry.runtime == "docker":
        _validate_image_identifier(str(entry.recipe["image"]))
```

Do not use `_validate_package_identifier` for Docker images after this change.

- [ ] **Step 4: Run runtime tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_runtime.py -q
```

Expected: PASS.

---

### Task 7: Add route coverage for registry-derived lifecycle install

**Files:**
- Modify: `tests/test_mcp_marketplace_routes.py`

- [ ] **Step 1: Add failing route test**

Add this test near existing Marketplace install/start tests. Match fixture names to the current file; if existing tests use `client`, `monkeypatch`, and a fake manager, follow that exact pattern.

```python

def test_marketplace_installs_registry_derived_local_recipe(monkeypatch, admin_client, tmp_path):
    from src import mcp_marketplace_catalog as catalog

    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    registry_entry = {
        "id": "registry-io.github.acme-search-npm-acme-search-mcp",
        "name": "Acme Search",
        "description": "Search tools",
        "publisher": "github",
        "version": "1.0.0",
        "runtime": "npm",
        "recipe": {"package": "acme-search-mcp", "args": []},
        "config_fields": [],
        "permissions": ["Local MCP server package from the official MCP Registry"],
        "source_url": "https://registry.modelcontextprotocol.io",
        "categories": ["Registry"],
        "tags": ["registry", "npm"],
        "package_type": "npm",
    }
    monkeypatch.setattr(catalog, "load_catalog_cache", lambda cache_path=None: {"entries": [registry_entry], "sources": [], "errors": []})
    monkeypatch.setattr("routes.mcp_routes.load_catalog_cache", lambda cache_path=None: {"entries": [registry_entry], "sources": [], "errors": []})

    response = admin_client.post("/api/mcp/marketplace/install/registry-io.github.acme-search-npm-acme-search-mcp", json={"config": {}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["catalog_entry_id"] == "registry-io.github.acme-search-npm-acme-search-mcp"
    assert payload["runtime"] == "npm"
```

If `admin_client` is not the fixture name, inspect the existing route tests and use the authenticated admin client fixture already present there.

- [ ] **Step 2: Run route test to verify RED or PASS**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_routes.py::test_marketplace_installs_registry_derived_local_recipe -q
```

Expected: It may PASS if route code is already generic. If it fails because `CatalogEntry.from_raw` lacks new metadata fields or because monkeypatch target differs, apply the minimal fix from earlier tasks or adjust the fixture target to the existing test pattern.

- [ ] **Step 3: Run route suite**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_routes.py -q
```

Expected: PASS.

---

### Task 8: Add Marketplace browse search/filter UI

**Files:**
- Modify: `static/index.html`
- Modify: `static/js/admin.js`
- Modify: `static/style.css`
- Modify: `tests/test_mcp_marketplace_admin_js.py`

- [ ] **Step 1: Add failing UI string tests**

Append to `tests/test_mcp_marketplace_admin_js.py`:

```python

def test_marketplace_browse_has_search_and_filters():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert "adm-mcp-marketplace-search" in html
    assert "adm-mcp-marketplace-category" in html
    assert "adm-mcp-marketplace-runtime" in html
    assert "adm-mcp-marketplace-source" in html
    assert "adm-mcp-marketplace-load-more" in html


def test_admin_js_filters_marketplace_entries_client_side():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "filterMcpMarketplaceEntries" in js
    assert "renderMcpMarketplaceFilterOptions" in js
    assert "adm-mcp-marketplace-search" in js
    assert "adm-mcp-marketplace-category" in js
    assert "adm-mcp-marketplace-runtime" in js
    assert "adm-mcp-marketplace-source" in js
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py::test_marketplace_browse_has_search_and_filters tests/test_mcp_marketplace_admin_js.py::test_admin_js_filters_marketplace_entries_client_side -q
```

Expected: FAIL because controls/functions do not exist.

- [ ] **Step 3: Add filter controls to modal**

In `static/index.html`, inside the `adm-mcp-marketplace` card, place this block between the tab buttons and `adm-mcp-marketplace-msg`:

```html
<div class="mcp-marketplace-filters" id="adm-mcp-marketplace-filters">
  <input id="adm-mcp-marketplace-search" class="mcp-marketplace-search" type="search" placeholder="Search MCP servers, packages, tags..." autocomplete="off" />
  <select id="adm-mcp-marketplace-category" class="mcp-marketplace-filter-select" aria-label="Marketplace category">
    <option value="">All categories</option>
  </select>
  <select id="adm-mcp-marketplace-runtime" class="mcp-marketplace-filter-select" aria-label="Marketplace runtime">
    <option value="">All runtimes</option>
  </select>
  <select id="adm-mcp-marketplace-source" class="mcp-marketplace-filter-select" aria-label="Marketplace source">
    <option value="">All sources</option>
  </select>
</div>
```

Place this button after `adm-mcp-marketplace-browse`:

```html
<button class="memory-toolbar-btn mcp-marketplace-load-more hidden" id="adm-mcp-marketplace-load-more">Load More</button>
```

- [ ] **Step 4: Add minimal filter styles**

In `static/style.css`, add near existing Marketplace styles:

```css
.mcp-marketplace-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}

.mcp-marketplace-search,
.mcp-marketplace-filter-select {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px 10px;
}

.mcp-marketplace-search {
  flex: 1 1 260px;
}

.mcp-marketplace-filter-select {
  flex: 0 1 170px;
}

.mcp-marketplace-load-more {
  align-self: flex-start;
  margin-top: 10px;
}
```

- [ ] **Step 5: Add JS filtering state/functions**

In `static/js/admin.js`, near existing Marketplace state, add:

```javascript
let _mcpMarketplaceEntries = [];
let _mcpMarketplaceVisibleCount = 48;
```

Add these helpers before `renderMcpMarketplaceBrowse`:

```javascript
function _entryText(entry) {
  return [entry.name, entry.description, entry.publisher, entry.package_type, entry.runtime, entry.source_id, ...(entry.tags || []), ...(entry.categories || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filterMcpMarketplaceEntries(entries) {
  const query = (el('adm-mcp-marketplace-search')?.value || '').trim().toLowerCase();
  const category = el('adm-mcp-marketplace-category')?.value || '';
  const runtime = el('adm-mcp-marketplace-runtime')?.value || '';
  const source = el('adm-mcp-marketplace-source')?.value || '';
  return entries.filter(entry => {
    if (query && !_entryText(entry).includes(query)) return false;
    if (category && !(entry.categories || []).includes(category)) return false;
    if (runtime && entry.runtime !== runtime) return false;
    if (source && entry.source_id !== source) return false;
    return true;
  });
}

function _setSelectOptions(selectId, values, label) {
  const select = el(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}

function renderMcpMarketplaceFilterOptions(entries) {
  const categories = [...new Set(entries.flatMap(entry => entry.categories || []))].sort((a, b) => a.localeCompare(b));
  const runtimes = [...new Set(entries.map(entry => entry.runtime).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sources = [...new Set(entries.map(entry => entry.source_id).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  _setSelectOptions('adm-mcp-marketplace-category', categories, 'All categories');
  _setSelectOptions('adm-mcp-marketplace-runtime', runtimes, 'All runtimes');
  _setSelectOptions('adm-mcp-marketplace-source', sources, 'All sources');
}
```

Modify `loadMcpMarketplaceEntries()` so it stores entries and renders filters:

```javascript
async function loadMcpMarketplaceEntries() {
  const entries = await _fetchJson('/api/mcp/marketplace/entries');
  _mcpMarketplaceEntries = Array.isArray(entries) ? entries : [];
  _mcpMarketplaceVisibleCount = 48;
  renderMcpMarketplaceFilterOptions(_mcpMarketplaceEntries);
  renderMcpMarketplaceBrowse(_mcpMarketplaceEntries);
}
```

Modify `renderMcpMarketplaceBrowse()` so it filters and slices before rendering:

```javascript
function renderMcpMarketplaceBrowse() {
  const list = el('adm-mcp-marketplace-browse');
  if (!list) return;
  const filtered = filterMcpMarketplaceEntries(_mcpMarketplaceEntries);
  const visible = filtered.slice(0, _mcpMarketplaceVisibleCount);
  const loadMore = el('adm-mcp-marketplace-load-more');
  if (loadMore) {
    loadMore.classList.toggle('hidden', filtered.length <= _mcpMarketplaceVisibleCount);
    loadMore.textContent = `Load More (${filtered.length - visible.length} remaining)`;
  }
  if (!_mcpMarketplaceEntries.length) {
    list.innerHTML = '<div class="admin-empty">No catalog entries loaded. Refresh catalogs to begin.</div>';
    return;
  }
  if (!visible.length) {
    list.innerHTML = '<div class="admin-empty">No matching marketplace entries.</div>';
    return;
  }
  list.innerHTML = visible.map(entry => `
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
```


In `initMcpMarketplace()`, add idempotent listeners:

```javascript
  ['adm-mcp-marketplace-search', 'adm-mcp-marketplace-category', 'adm-mcp-marketplace-runtime', 'adm-mcp-marketplace-source'].forEach(id => {
    const control = el(id);
    if (control && control.dataset.filterReady !== '1') {
      control.dataset.filterReady = '1';
      control.addEventListener(id === 'adm-mcp-marketplace-search' ? 'input' : 'change', () => {
        _mcpMarketplaceVisibleCount = 48;
        renderMcpMarketplaceBrowse(_mcpMarketplaceEntries);
      });
    }
  });
  const loadMore = el('adm-mcp-marketplace-load-more');
  if (loadMore && loadMore.dataset.ready !== '1') {
    loadMore.dataset.ready = '1';
    loadMore.addEventListener('click', () => {
      _mcpMarketplaceVisibleCount += 48;
      renderMcpMarketplaceBrowse(_mcpMarketplaceEntries);
    });
  }
```

- [ ] **Step 6: Run UI tests and JS syntax**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py -q
node --check static/js/admin.js
```

Expected: tests pass and `node --check` has no output.

---

### Task 9: Expose category/tag/runtime/source metadata in cards

**Files:**
- Modify: `static/js/admin.js`
- Modify: `tests/test_mcp_marketplace_admin_js.py`

- [ ] **Step 1: Add failing card metadata test**

Append to `tests/test_mcp_marketplace_admin_js.py`:

```python

def test_admin_js_renders_marketplace_metadata_badges():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "package_type" in js
    assert "categories" in js
    assert "tags" in js
    assert "mcp-marketplace-meta" in js
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py::test_admin_js_renders_marketplace_metadata_badges -q
```

Expected: FAIL if metadata is not rendered yet.

- [ ] **Step 3: Render metadata badges in card template**

In `renderMcpMarketplaceBrowse`, before the card return template, compute:

```javascript
    const meta = [entry.package_type || entry.runtime, entry.source_id, ...(entry.categories || []).slice(0, 2)]
      .filter(Boolean)
      .map(value => `<span class="mcp-marketplace-meta">${escapeHtml(value)}</span>`)
      .join('');
```

Inside each card template, add below the publisher/runtime line:

```javascript
<div class="mcp-marketplace-card-meta">${meta}</div>
```

- [ ] **Step 4: Add style**

In `static/style.css`:

```css
.mcp-marketplace-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.mcp-marketplace-meta {
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 7px;
}
```

- [ ] **Step 5: Run UI checks**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py -q
node --check static/js/admin.js
```

Expected: PASS.

---

### Task 10: Full focused integration verification

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run all focused Marketplace tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py tests/test_mcp_marketplace_catalog.py tests/test_mcp_marketplace_registry.py tests/test_mcp_marketplace_runtime.py tests/test_mcp_marketplace_store.py tests/test_mcp_marketplace_routes.py tests/test_mcp_manager.py -q
```

Expected: all focused tests pass. Existing warnings are acceptable; failures are not.

- [ ] **Step 2: Check JS syntax**

Run:

```bash
node --check static/js/admin.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Rebuild and restart Docker**

Run:

```bash
docker compose -p odysseus up -d --build odysseus
```

Expected: command exits 0 and `docker compose -p odysseus ps` shows the `odysseus` service running.

- [ ] **Step 4: Verify served assets and visible UI**

Run:

```bash
python - <<'PY'
from urllib.request import urlopen
html = urlopen('http://127.0.0.1:7000/static/index.html', timeout=20).read().decode('utf-8', 'replace')
js = urlopen('http://127.0.0.1:7000/static/js/admin.js', timeout=20).read().decode('utf-8', 'replace')
for token in ['tool-mcp-marketplace-btn', 'rail-mcp-marketplace', 'adm-mcp-marketplace-search', 'adm-mcp-marketplace-category', 'adm-mcp-marketplace-runtime', 'adm-mcp-marketplace-source']:
    print(token, token in html or token in js)
PY
```

Expected: every printed token is `True`.

- [ ] **Step 5: Verify browser behavior with Chrome DevTools MCP**

Use Chrome DevTools MCP to open `http://127.0.0.1:7000/static/index.html`, then evaluate:

```javascript
() => {
  const item = document.querySelector('#tool-mcp-marketplace-btn');
  const modal = document.querySelector('#mcp-marketplace-modal');
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return {
    visible: item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0,
    directlyAboveBrain: item.nextElementSibling.id === 'tool-memory-btn',
    modalOpened: modal && !modal.classList.contains('hidden'),
    hasSearch: !!document.querySelector('#adm-mcp-marketplace-search'),
    hasFilters: !!document.querySelector('#adm-mcp-marketplace-category') && !!document.querySelector('#adm-mcp-marketplace-runtime') && !!document.querySelector('#adm-mcp-marketplace-source')
  };
}
```

Expected: all values are `true`.

- [ ] **Step 6: Run independent verification**

Because this changes multiple backend/UI files, invoke the verification agent with:

- Original request: expanded local-install-only MCP Marketplace with 300+ sourced entries and lifecycle management.
- Changed files.
- Plan path: `docs/superpowers/plans/2026-06-04-expanded-mcp-marketplace-local-installs.md`.

Expected: verifier returns PASS or PARTIAL. If FAIL, fix findings and re-run verifier.

---

## Self-Review Notes

Spec coverage:

- Local installs only: Tasks 2, 4, 5, 6.
- Official MCP Registry pull: Tasks 2, 3, 5.
- Curated override layer: Task 4 keeps source priority; Task 5 keeps local curated sources highest priority.
- Install/start/stop/restart lifecycle: Task 7 verifies registry-derived entries still use existing lifecycle routes; existing route tests remain in Task 10.
- UI visible above Brain: Task 1.
- Search/filter scalable UI: Tasks 8 and 9.
- Safety: Task 6 plus existing runtime tests in Task 10.
- Docker/browser verification: Task 10.

Implementation constraints:

- Do not add remote MCP install support.
- Do not execute arbitrary commands from external sources.
- Do not reintroduce `pinned_models` or model-settings changes.
- Do not commit unless explicit commit permission is granted.
