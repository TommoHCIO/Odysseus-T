from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_admin_index_contains_mcp_marketplace_rail_modal():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert html.index('id="rail-cookbook"') < html.index('id="rail-mcp-marketplace"')
    assert html.index('id="tool-cookbook-btn"') < html.index('id="tool-mcp-marketplace-btn"')
    assert 'id="mcp-marketplace-modal"' in html
    assert 'role="dialog" aria-label="MCP Marketplace"' in html
    assert 'id="close-mcp-marketplace-modal"' in html

    for selector in (
        'id="adm-mcp-marketplace"',
        'id="adm-mcp-marketplace-refresh"',
        'id="adm-mcp-marketplace-browse"',
        'id="adm-mcp-marketplace-installed"',
    ):
        assert html.count(selector) == 1


def test_admin_index_no_longer_exposes_mcp_marketplace_as_settings_tab():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert 'data-settings-tab="marketplace"' not in html
    assert 'data-settings-panel="marketplace"' not in html


def test_app_js_wires_mcp_marketplace_rail_button():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "rail-mcp-marketplace" in js
    assert "tool-mcp-marketplace-btn" in js
    assert "openMcpMarketplace" in js


def test_admin_js_wires_mcp_marketplace_modal_and_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "export function openMcpMarketplace" in js
    assert "closeMcpMarketplace" in js
    assert "mcp-marketplace-modal" in js
    assert "/api/mcp/marketplace/catalogs/refresh" in js
    assert "/api/mcp/marketplace/entries" in js
    assert "/api/mcp/marketplace/installed" in js
    assert "refresh-tools" in js
    assert 'data-mcp-action="configure"' in js
    assert "config_fields" in js
    assert "server.config" in js

def test_style_contains_marketplace_status_colors():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    assert ".mcp-marketplace-card" in css
    assert ".mcp-status-green" in css
    assert ".mcp-status-yellow" in css
    assert ".mcp-status-red" in css


def test_admin_js_wires_mcp_tool_drawer_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools" in js
    assert "disabled" in js
    assert "input_schema" in js
