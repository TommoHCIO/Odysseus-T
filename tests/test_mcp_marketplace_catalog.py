import json

from src.mcp_marketplace_catalog import (
    CatalogEntry,
    CatalogSource,
    default_catalog_sources,
    load_catalog_cache,
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


def test_default_catalog_sources_include_multiple_curated_libraries(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))

    sources = default_catalog_sources()
    cache = load_catalog_cache()

    assert len(sources) >= 2
    assert len(cache["sources"]) >= 2
    assert {source.id for source in sources} >= {"odysseus-curated", "odysseus-community-curated"}
    assert {entry["id"] for entry in cache["entries"]} >= {"filesystem", "sqlite", "playwright", "github"}


def test_load_catalog_cache_refreshes_stale_single_source_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))
    stale_cache = tmp_path / "catalog_cache.json"
    stale_cache.write_text(json.dumps({
        "refreshed_at": "2026-01-01T00:00:00+00:00",
        "sources": [{"id": "odysseus-curated", "name": "Odysseus Curated", "priority": 100, "path": str(tmp_path / "curated_catalog.json")}],
        "errors": [],
        "entries": [],
    }), encoding="utf-8")

    cache = load_catalog_cache()

    assert len(cache["sources"]) >= 2
    assert {entry["id"] for entry in cache["entries"]} >= {"filesystem", "sqlite", "playwright", "github"}
