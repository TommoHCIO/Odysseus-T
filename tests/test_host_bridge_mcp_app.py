import os

from host_bridge.mcp_app import create_mcp_app
from host_bridge.policy import BridgeConfig


def test_create_mcp_app_registers_host_tools():
    app = create_mcp_app(BridgeConfig(allowed_commands=["python"]), token="secret")

    tool_names = {tool.name for tool in app._tool_manager.list_tools()}

    assert {
        "host_health",
        "host_list_dir",
        "host_read_file",
        "host_write_file",
        "host_run_command",
        "host_approve_confirmation",
    }.issubset(tool_names)


def test_token_can_be_loaded_from_environment(monkeypatch):
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_TOKEN", "secret")

    app = create_mcp_app(BridgeConfig(), token=None)

    assert app.name == "Odysseus Host Access Bridge"
