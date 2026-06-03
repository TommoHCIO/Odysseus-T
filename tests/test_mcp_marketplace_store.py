from src.mcp_marketplace_store import InstalledMarketplaceServer, MarketplaceStore


def test_store_round_trips_installed_server(tmp_path):
    store = MarketplaceStore(tmp_path / "installed.json")
    server = InstalledMarketplaceServer(
        id="filesystem",
        mcp_server_id="mkt-filesystem",
        catalog_entry_id="filesystem",
        name="Filesystem MCP",
        runtime="npm",
        install_dir=str(tmp_path / "filesystem"),
        config={"root": str(tmp_path)},
        status="stopped",
        managed_process=True,
    )

    store.save(server)

    loaded = store.get("filesystem")
    assert loaded is not None
    assert loaded.mcp_server_id == "mkt-filesystem"
    assert loaded.config["root"] == str(tmp_path)
    assert store.list()[0].id == "filesystem"


def test_store_delete_removes_entry(tmp_path):
    store = MarketplaceStore(tmp_path / "installed.json")
    store.save(InstalledMarketplaceServer(
        id="sqlite",
        mcp_server_id="mkt-sqlite",
        catalog_entry_id="sqlite",
        name="SQLite MCP",
        runtime="python_uv",
        install_dir=str(tmp_path / "sqlite"),
        config={},
        status="stopped",
        managed_process=True,
    ))

    assert store.delete("sqlite") is True
    assert store.get("sqlite") is None
    assert store.delete("sqlite") is False
