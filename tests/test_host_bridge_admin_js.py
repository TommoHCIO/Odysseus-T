from pathlib import Path


ADMIN_JS = Path(__file__).resolve().parents[1] / "static" / "js" / "admin.js"


def test_host_bridge_admin_js_uses_fixed_endpoints_without_secrets():
    content = ADMIN_JS.read_text(encoding="utf-8")

    assert "/api/mcp/host-bridge/status" in content
    assert "/api/mcp/host-bridge/start" in content
    assert "/api/mcp/host-bridge/stop" in content
    assert "/api/mcp/host-bridge/restart" in content
    assert "ODYSSEUS_HOST_BRIDGE_TOKEN" not in content
    assert "hostBridgeEndpoints" in content


def test_host_bridge_admin_js_validates_actions_and_uses_no_request_body():
    content = ADMIN_JS.read_text(encoding="utf-8")

    assert "function _hostBridgeEndpoint(action)" in content
    assert "throw new Error('Invalid host bridge action')" in content
    assert "body:" not in content[content.index("async function controlHostBridge"):content.index("function initHostBridgeControls")]
    assert "credentials: 'same-origin'" in content


def test_host_bridge_admin_js_initializes_controls():
    content = ADMIN_JS.read_text(encoding="utf-8")

    assert "adm-hostBridgeStatus" in content
    assert "adm-hostBridgeRefresh" in content
    assert "adm-hostBridgeStart" in content
    assert "adm-hostBridgeStop" in content
    assert "adm-hostBridgeRestart" in content
    assert "initHostBridgeControls" in content
