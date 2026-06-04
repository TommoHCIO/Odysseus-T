import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

_TEST_DB_PATH = Path(tempfile.gettempdir()) / f"odysseus_mcp_routes_{os.getpid()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH.as_posix()}"

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from routes import mcp_routes
from routes.mcp_routes import setup_mcp_routes


class FakeQuery:
    def __init__(self, store):
        self.store = store
        self._server_id = None

    def filter(self, condition):
        self._server_id = getattr(getattr(condition, 'right', None), 'value', None)
        return self

    def first(self):
        if self._server_id in self.store:
            return self.store[self._server_id]
        if self._server_id is None and len(self.store) == 1:
            return next(iter(self.store.values()))
        return None

    def all(self):
        return list(self.store.values())


class FakeDbSession:
    store = {}

    def query(self, model):
        return FakeQuery(self.store)

    def add(self, srv):
        self.store[srv.id] = srv

    def delete(self, srv):
        self.store.pop(srv.id, None)

    def commit(self):
        return None

    def close(self):
        return None


def fake_session_local():
    return FakeDbSession()


def reset_fake_db():
    FakeDbSession.store = {}


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
    reset_fake_db()
    app = FastAPI()
    mcp_routes.router.routes = []
    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)
    monkeypatch.setattr(mcp_routes, "SessionLocal", fake_session_local)
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


def test_marketplace_refresh_tools_uses_manager(monkeypatch, tmp_path):
    monkeypatch.setenv("ODYSSEUS_MCP_MARKETPLACE_DIR", str(tmp_path))

    class RefreshManager(FakeMcpManager):
        async def refresh_server_tools(self, server_id):
            self.connected.append(f"refresh:{server_id}")
            return {"status": "connected", "tool_count": 3}

        def get_server_status(self, server_id):
            if f"refresh:{server_id}" in self.connected:
                return {"status": "connected", "tool_count": 3, "error": None}
            return super().get_server_status(server_id)

    manager = RefreshManager()
    client = make_client(monkeypatch, manager)
    client.post("/api/mcp/marketplace/catalogs/refresh")
    client.post("/api/mcp/marketplace/install/filesystem", json={"config": {"root": str(tmp_path)}})

    response = client.post("/api/mcp/marketplace/installed/filesystem/refresh-tools")

    assert response.status_code == 200
    assert response.json()["tool_count"] == 3
    assert "refresh:mkt-filesystem" in manager.connected


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
    FakeDbSession.store["mkt-filesystem"] = SimpleNamespace(id="mkt-filesystem", disabled_tools=json.dumps(["read_file"]))

    response = client.get("/api/mcp/servers/mkt-filesystem/tools")

    assert response.status_code == 200
    tool = response.json()[0]
    assert tool["input_schema"]["properties"]["path"]["type"] == "string"
    assert tool["is_disabled"] is True


def test_marketplace_refresh_uses_external_registry_sources(monkeypatch):
    called = {}

    def fake_default_sources(include_external=False):
        called["include_external"] = include_external
        return []

    monkeypatch.setattr(mcp_routes, "default_catalog_sources", fake_default_sources)
    monkeypatch.setattr(mcp_routes, "refresh_catalog_cache", lambda sources: {"entries": [], "sources": [], "errors": []})
    client = make_client(monkeypatch)

    response = client.post("/api/mcp/marketplace/catalogs/refresh")

    assert response.status_code == 200
    assert called["include_external"] is True


def test_marketplace_installs_registry_derived_local_recipe(monkeypatch, tmp_path):
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
    (tmp_path / "catalog_cache.json").write_text(json.dumps({
        "entries": [registry_entry],
        "sources": [
            {"id": "odysseus-curated", "name": "Odysseus Curated", "priority": 100, "path": str(tmp_path / "curated_catalog.json"), "type": "file"},
            {"id": "odysseus-community-curated", "name": "Odysseus Community Curated", "priority": 80, "path": str(tmp_path / "community_curated_catalog.json"), "type": "file"},
            {"id": "official-mcp-registry", "name": "Official MCP Registry", "priority": 60, "path": "https://registry.modelcontextprotocol.io/v0.1/servers", "type": "registry"},
        ],
        "errors": [],
    }), encoding="utf-8")
    manager = FakeMcpManager()
    client = make_client(monkeypatch, manager)

    response = client.post("/api/mcp/marketplace/install/registry-io.github.acme-search-npm-acme-search-mcp", json={"config": {}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["catalog_entry_id"] == "registry-io.github.acme-search-npm-acme-search-mcp"
    assert payload["runtime"] == "npm"
    assert "mkt-registry-io.github.acme-search-npm-acme-search-mcp" in manager.connected
