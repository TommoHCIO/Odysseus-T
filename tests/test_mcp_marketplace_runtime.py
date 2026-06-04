import pytest

from src.mcp_marketplace_catalog import CatalogEntry
from src.mcp_marketplace_runtime import (
    build_mcp_server_config,
    install_marketplace_entry,
    marketplace_install_dir,
    validate_recipe,
)


def entry(runtime="npm", recipe=None, fields=None):
    return CatalogEntry(
        id="filesystem",
        name="Filesystem MCP",
        description="Filesystem",
        publisher="Curated",
        version="latest",
        runtime=runtime,
        recipe=recipe or {"package": "@modelcontextprotocol/server-filesystem", "args": ["{root}"]},
        config_fields=fields or [{"name": "root", "label": "Root", "type": "path", "required": True}],
        permissions=["Read/write selected root"],
        source_url="https://example.invalid/fs",
        source_id="local",
        source_priority=1,
    )


def test_marketplace_install_dir_rejects_path_traversal(tmp_path):
    with pytest.raises(ValueError, match="Invalid marketplace id"):
        marketplace_install_dir("../evil", tmp_path)


def test_validate_recipe_rejects_arbitrary_command():
    bad = entry(recipe={"command": "rm -rf /", "args": []})

    with pytest.raises(ValueError, match="package is required"):
        validate_recipe(bad, {"root": "/tmp"})


def test_validate_recipe_rejects_malformed_package_identifier():
    bad = entry(recipe={"package": "evil; rm -rf /", "args": []})

    with pytest.raises(ValueError, match="Invalid package identifier"):
        validate_recipe(bad, {"root": "/tmp"})


def test_install_marketplace_entry_creates_isolated_metadata(tmp_path):
    installed = install_marketplace_entry(entry(), {"root": str(tmp_path)}, tmp_path)

    assert installed.id == "filesystem"
    assert installed.mcp_server_id == "mkt-filesystem"
    assert installed.managed_process is True
    assert installed.status == "stopped"
    assert "Prepared npm package" in installed.logs[-1]


def test_build_mcp_server_config_for_npm(tmp_path):
    installed = install_marketplace_entry(entry(), {"root": str(tmp_path)}, tmp_path)

    config = build_mcp_server_config(entry(), installed)

    assert config["id"] == "mkt-filesystem"
    assert config["transport"] == "stdio"
    assert config["command"] == "npx"
    assert config["args"] == ["-y", "@modelcontextprotocol/server-filesystem", str(tmp_path)]
    assert config["env"] == {}


def test_build_mcp_server_config_for_sse():
    sse = entry(runtime="sse", recipe={"url": "{url}"}, fields=[{"name": "url", "label": "URL", "type": "url", "required": True}])
    installed = install_marketplace_entry(sse, {"url": "http://127.0.0.1:9999/sse"})

    config = build_mcp_server_config(sse, installed)

    assert config["transport"] == "sse"
    assert config["url"] == "http://127.0.0.1:9999/sse"
    assert installed.managed_process is False
