from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_index_has_standalone_marketplace_rail_button_above_email():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert "rail-mcp-marketplace" in html
    assert html.index('id="rail-mcp-marketplace"') < html.index('id="rail-email"')
    assert "mcp-marketplace-modal" in html
    assert "adm-mcp-marketplace-browse" in html
    assert "adm-mcp-marketplace-installed" in html


def test_admin_js_wires_mcp_marketplace_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/marketplace/catalogs/refresh" in js
    assert "/api/mcp/marketplace/entries" in js
    assert "/api/mcp/marketplace/installed" in js
    assert "refresh-tools" in js


def test_admin_js_no_longer_injects_marketplace_into_mcp_admin_section():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "ensureMcpMarketplacePanel" not in js
    assert "insertBefore(marketplacePanel, mcpList)" not in js


def test_admin_js_wires_mcp_tool_drawer_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/servers/${encodeURIComponent(server.mcp_server_id)}/tools" in js
    assert "disabled" in js
    assert "input_schema" in js


def test_admin_js_opens_standalone_marketplace_modal_from_rail():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "openMcpMarketplaceModal" in js
    assert "closeMcpMarketplaceModal" in js
    assert "rail-mcp-marketplace" in js
    assert "mcp-marketplace-modal" in js
