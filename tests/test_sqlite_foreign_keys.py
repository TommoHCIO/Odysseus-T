import importlib
import sys
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _real_database_module():
    sys.modules.pop("core.database", None)
    core_module = sys.modules.get("core")
    if core_module is not None and hasattr(core_module, "database"):
        delattr(core_module, "database")
    return importlib.import_module("core.database")


def test_sqlite_foreign_keys_cascade():
    database = _real_database_module()
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    database.Base.metadata.create_all(bind=engine)

    TestSessionLocal = sessionmaker(bind=engine)
    db = TestSessionLocal()

    session_id = "test-session-123"
    s = database.Session(
        id=session_id,
        name="Test Session",
        endpoint_url="http://localhost:8000",
        model="gpt-4",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    m = database.ChatMessage(id="test-msg-123", session_id=session_id, role="user", content="test message")

    db.add(s)
    db.add(m)
    db.commit()

    assert db.query(database.Session).count() == 1
    assert db.query(database.ChatMessage).count() == 1

    db.query(database.Session).filter(database.Session.id == session_id).delete()
    db.commit()

    assert db.query(database.ChatMessage).count() == 0

    db.close()
