from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_admin_index_contains_mcp_marketplace_panel():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert "adm-mcp-marketplace" in html
    assert "adm-mcp-marketplace-browse" in html
    assert "adm-mcp-marketplace-installed" in html


def test_admin_js_wires_mcp_marketplace_endpoints():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "/api/mcp/marketplace/catalogs/refresh" in js
    assert "/api/mcp/marketplace/entries" in js
    assert "/api/mcp/marketplace/installed" in js
    assert "refresh-tools" in js


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
