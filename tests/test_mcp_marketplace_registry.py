from src.mcp_marketplace_registry import normalize_registry_servers, registry_entries_from_payload, fetch_registry_catalog


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
