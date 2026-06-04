import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from routes import mcp_routes
from routes.mcp_routes import setup_mcp_routes


class FakeMcpManager:
    def __init__(self):
        self.disconnected = []
        self.calls = []

    def get_server_status(self, server_id):
        return {"server_id": server_id, "connected": True}

    def get_all_statuses(self):
        return {}

    async def disconnect_server(self, server_id):
        self.disconnected.append(server_id)

    async def call_tool(self, tool_name, arguments):
        self.calls.append((tool_name, arguments))
        return {"ok": True, "tool": tool_name, "arguments": arguments}


def make_client(manager=None):
    app = FastAPI()
    mcp_routes.router.routes = []
    setup_mcp_routes(manager or FakeMcpManager())
    app.include_router(mcp_routes.router)
    return TestClient(app)


def test_host_bridge_status_route_requires_admin_and_returns_mcp_status(monkeypatch):
    called = {"admin": False}

    def require_admin(request: Request):
        called["admin"] = True

    monkeypatch.setattr(mcp_routes, "require_admin", require_admin)
    monkeypatch.setattr(
        mcp_routes,
        "get_host_bridge_status",
        lambda: {"available": True, "platform": "windows", "service_name": "Odysseus Host Access Bridge", "status": "running", "message": "ok"},
    )

    response = make_client().get("/api/mcp/host-bridge/status")

    assert response.status_code == 200
    data = response.json()
    assert called["admin"] is True
    assert data["service"]["status"] == "running"
    assert data["mcp"]["server_id"] == "host_access"


def test_host_bridge_routes_propagate_admin_denial(monkeypatch):
    def deny(request: Request):
        raise HTTPException(status_code=403, detail="Admins only")

    monkeypatch.setattr(mcp_routes, "require_admin", deny)

    response = make_client().post("/api/mcp/host-bridge/start")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_host_bridge_stop_disconnects_host_access(monkeypatch):
    manager = FakeMcpManager()
    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)
    monkeypatch.setattr(
        mcp_routes,
        "stop_host_bridge",
        lambda: {"available": True, "platform": "linux", "service_name": "odysseus-host-bridge.service", "status": "stopped", "message": ""},
    )

    response = make_client(manager).post("/api/mcp/host-bridge/stop")

    assert response.status_code == 200
    assert manager.disconnected == ["host_access"]
    assert "ODYSSEUS_HOST_BRIDGE_TOKEN" not in response.text




def test_mcp_servers_includes_live_host_access_without_db_row(monkeypatch):
    class ManagerWithLiveHost(FakeMcpManager):
        def get_all_statuses(self):
            return {
                "host_access": {
                    "status": "connected",
                    "name": "Host Access Bridge",
                    "transport": "sse",
                    "url": "http://127.0.0.1:8765/sse",
                    "tool_count": 6,
                    "error": None,
                }
            }

    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)

    response = make_client(ManagerWithLiveHost()).get("/api/mcp/servers")

    assert response.status_code == 200
    servers = response.json()
    assert any(server["id"] == "host_access" for server in servers)
    host = next(server for server in servers if server["id"] == "host_access")
    assert host["name"] == "Host Access Bridge"
    assert host["status"] == "connected"
    assert host["tool_count"] == 6
    assert "env" not in host or host["env"] == {}


def test_mcp_server_tools_includes_live_host_access_without_db_row(monkeypatch):
    class ManagerWithLiveHost(FakeMcpManager):
        def get_all_tools(self, disabled_map=None):
            return [
                {
                    "server_id": "host_access",
                    "server_name": "Host Access Bridge",
                    "name": "host_health",
                    "qualified_name": "mcp__host_access__host_health",
                    "description": "Host health",
                    "is_disabled": False,
                }
            ]

    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)

    response = make_client(ManagerWithLiveHost()).get("/api/mcp/servers/host_access/tools")

    assert response.status_code == 200
    tools = response.json()
    assert len(tools) == 1
    assert tools[0]["name"] == "host_health"
    assert tools[0]["qualified_name"] == "mcp__host_access__host_health"
    assert tools[0]["is_disabled"] is False


def test_mcp_server_tool_call_uses_mcp_manager_for_runtime_only_host_access(monkeypatch):
    manager = FakeMcpManager()
    monkeypatch.setattr(mcp_routes, "require_admin", lambda request: None)

    response = make_client(manager).post(
        "/api/mcp/servers/host_access/tools/host_health/call",
        json={"arguments": {"include_policy": True}},
    )

    assert response.status_code == 200
    assert manager.calls == [("mcp__host_access__host_health", {"include_policy": True})]
    assert response.json()["ok"] is True
