import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_index_has_standalone_marketplace_rail_button_above_brain():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    rail_html = html[html.index('id="icon-rail"') : html.index('<nav class="sidebar"', html.index('id="icon-rail"'))]
    rail_button_ids = re.findall(r'<button[^>]+id="([^"]+)"', rail_html)

    assert "rail-mcp-marketplace" in rail_button_ids
    assert rail_button_ids[rail_button_ids.index("rail-memory") - 1] == "rail-mcp-marketplace"
    assert "mcp-marketplace-modal" in html
    assert "adm-mcp-marketplace-browse" in html
    assert "adm-mcp-marketplace-installed" in html


def test_index_has_visible_marketplace_sidebar_entry_above_brain():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    tools_html = html[html.index('id="tools-section"') : html.index('<div class="sidebar-user-bar"', html.index('id="tools-section"'))]
    tool_item_ids = re.findall(r'<div class="list-item" id="([^"]+)"', tools_html)

    assert "tool-mcp-marketplace-btn" in tool_item_ids
    assert tool_item_ids[tool_item_ids.index("tool-memory-btn") - 1] == "tool-mcp-marketplace-btn"
    assert "MCP Marketplace" in tools_html


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
    assert "tool-mcp-marketplace-btn" in js
    assert "mcp-marketplace-modal" in js


def test_marketplace_browse_has_search_and_filters():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert "adm-mcp-marketplace-search" in html
    assert "adm-mcp-marketplace-category" in html
    assert "adm-mcp-marketplace-runtime" in html
    assert "adm-mcp-marketplace-source" in html
    assert "adm-mcp-marketplace-load-more" in html


def test_admin_js_hides_browse_filters_on_installed_tab():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "adm-mcp-marketplace-filters" in js
    assert "adm-mcp-marketplace-load-more" in js
    assert "tab !== 'browse'" in js


def test_admin_js_keeps_load_more_hidden_when_browse_tab_inactive():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")
    render_start = js.index("function renderMcpMarketplaceBrowse()")
    render_end = js.index("async function loadMcpMarketplaceEntries", render_start)
    render_body = js[render_start:render_end]

    assert "adm-mcp-marketplace-load-more" in render_body
    assert "browseActive" in render_body
    assert "!browseActive" in render_body


def test_admin_js_filters_marketplace_entries_client_side():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "filterMcpMarketplaceEntries" in js
    assert "renderMcpMarketplaceFilterOptions" in js
    assert "adm-mcp-marketplace-search" in js
    assert "adm-mcp-marketplace-category" in js
    assert "adm-mcp-marketplace-runtime" in js
    assert "adm-mcp-marketplace-source" in js


def test_marketplace_filter_and_grid_hidden_styles_override_layout_displays():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    assert ".mcp-marketplace-filters.hidden" in css
    assert ".mcp-marketplace-grid.hidden" in css


def test_marketplace_metadata_badges_use_existing_muted_color_token():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    badge_start = css.index(".mcp-marketplace-meta-badge")
    badge_end = css.index("}", badge_start)
    badge_css = css[badge_start:badge_end]

    assert "--text-muted" not in badge_css
    assert "--color-muted" in badge_css


def test_admin_js_renders_marketplace_metadata_badges():
    js = (ROOT / "static" / "js" / "admin.js").read_text(encoding="utf-8")

    assert "package_type" in js
    assert "categories" in js
    assert "tags" in js
    assert "mcp-marketplace-card-meta" in js
    assert "mcp-marketplace-meta-badge" in js


def test_marketplace_filter_and_grid_hidden_styles_override_layout_displays():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    assert ".mcp-marketplace-filters.hidden" in css
    assert ".mcp-marketplace-grid.hidden" in css
