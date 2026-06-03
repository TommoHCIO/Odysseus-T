import pytest

from src.mcp_manager import _format_mcp_connection_error


def test_playwright_mcp_connection_error_includes_install_hint():
    msg = _format_mcp_connection_error(
        "Browser (Playwright)",
        "npx",
        ["-y", "@playwright/mcp@latest", "--headless"],
        RuntimeError("package not found"),
    )

    assert "package not found" in msg
    assert "Browser MCP could not start" in msg
    assert "npx -y @playwright/mcp@latest --version" in msg
    assert "restart Odysseus" in msg



def test_generic_mcp_connection_error_preserves_original_error():
    msg = _format_mcp_connection_error(
        "Custom MCP",
        "python",
        ["server.py"],
        RuntimeError("boom"),
    )

    assert msg == "boom"


@pytest.mark.asyncio
async def test_host_access_calls_inject_configured_token(monkeypatch):
    from src.mcp_manager import McpManager

    class Session:
        def __init__(self):
            self.calls = []

        async def call_tool(self, tool_name, arguments):
            self.calls.append(arguments)

            class Result:
                content = []
                isError = False

            return Result()

    session = Session()
    manager = McpManager()
    manager._sessions["host_access"] = session
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_TOKEN", "secret-token")

    await manager.call_tool("mcp__host_access__host_health", {})
    await manager.call_tool("mcp__host_access__host_health", {"token": ""})
    await manager.call_tool("mcp__host_access__host_health", {"token": "placeholder", "include_policy": True})

    assert session.calls == [
        {"token": "secret-token"},
        {"token": "secret-token"},
        {"token": "secret-token", "include_policy": True},
    ]


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

    monkeypatch.setattr("core.database.SessionLocal", lambda: DB())
    monkeypatch.setattr(manager, "disconnect_server", fake_disconnect)
    monkeypatch.setattr(manager, "connect_server", fake_connect)
    monkeypatch.setattr(manager, "get_server_status", lambda server_id: {"status": "connected", "tool_count": 2})

    status = await manager.refresh_server_tools("mkt-filesystem")

    assert status == {"status": "connected", "tool_count": 2}
    assert calls == [("disconnect", "mkt-filesystem"), ("connect", "mkt-filesystem", ["-y", "pkg"])]
