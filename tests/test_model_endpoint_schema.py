import importlib.util
import sqlite3
import sys
from pathlib import Path


def _real_database_module():
    existing = sys.modules.get("core.database")
    if existing is not None and getattr(existing, "__file__", None):
        return existing
    module_path = Path(__file__).resolve().parents[1] / "core" / "database.py"
    spec = importlib.util.spec_from_file_location("_odysseus_real_database_for_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_model_endpoint_accepts_pinned_models_column():
    ModelEndpoint = _real_database_module().ModelEndpoint

    endpoint = ModelEndpoint(
        id="ep-test",
        name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        pinned_models='["openrouter/auto"]',
    )

    assert endpoint.pinned_models == '["openrouter/auto"]'


def test_pinned_models_migration_adds_existing_sqlite_column(tmp_path, monkeypatch):
    database = _real_database_module()
    db_path = tmp_path / "odysseus.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE model_endpoints ("
        "id VARCHAR PRIMARY KEY, "
        "name VARCHAR NOT NULL, "
        "base_url VARCHAR NOT NULL"
        ")"
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(database, "DATABASE_URL", f"sqlite:///{db_path}")

    database._migrate_add_pinned_models_column()

    conn = sqlite3.connect(db_path)
    columns = [row[1] for row in conn.execute("PRAGMA table_info(model_endpoints)").fetchall()]
    conn.close()
    assert "pinned_models" in columns
