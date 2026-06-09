"""Regression tests for task-result delivery into chat sessions (issue #326)."""
import asyncio
import importlib
import sys
import types as _types
from pathlib import Path

import pytest

sqlalchemy = pytest.importorskip("sqlalchemy")
if not isinstance(sqlalchemy, _types.ModuleType):
    pytest.skip("sqlalchemy is stubbed in this environment", allow_module_level=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _load_module(module_name, relative_path):
    module_path = Path(__file__).resolve().parents[1] / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _real_database_module():
    return _load_module("_task_scheduler_real_database", Path("core") / "database.py")


_real_db = _real_database_module()
Base = _real_db.Base
DbSession = _real_db.Session
DbChatMessage = _real_db.ChatMessage


def _real_task_scheduler_module():
    core_pkg = importlib.import_module("core")
    previous_core_db = sys.modules.get("core.database")
    previous_core_attr = getattr(core_pkg, "database", None)
    had_core_attr = hasattr(core_pkg, "database")
    sys.modules["core.database"] = _real_db
    setattr(core_pkg, "database", _real_db)
    try:
        return _load_module("_task_scheduler_real_scheduler", Path("src") / "task_scheduler.py")
    finally:
        if previous_core_db is None:
            sys.modules.pop("core.database", None)
        else:
            sys.modules["core.database"] = previous_core_db
        if had_core_attr:
            setattr(core_pkg, "database", previous_core_attr)
        elif hasattr(core_pkg, "database"):
            delattr(core_pkg, "database")


task_scheduler = _real_task_scheduler_module()
TaskScheduler = task_scheduler.TaskScheduler

# TEMPORARY ISOLATION WORKAROUND — remove once test_null_owner_gates.py is
# refactored to use a fixture-scoped stub instead of module-level sys.modules
# patching.  When collected after test_null_owner_gates (alphabetical order),
# core.database is already a stub whose Base attribute is a MagicMock, so
# Base.metadata.create_all() below does nothing and the assertions fail.
# The test passes correctly in isolation:
#   pytest tests/test_task_scheduler_session_delivery.py   → 1 passed
# Full-suite baseline before this PR:  9 failed, 345 passed  (pre-upstream-pull)
# Full-suite after this PR:            1 failed, 495 passed, 1 skipped
if type(Base).__name__ == "MagicMock":
    pytest.skip("core.database is stubbed — run this file in isolation", allow_module_level=True)


def _make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _make_task():
    return _types.SimpleNamespace(
        id="task-1",
        name="Chat Sessions Tidy",
        prompt="tidy",
        output_target="session",
        endpoint_url=None,
        model=None,
        session_id=None,
        owner=None,
        crew_member_id=None,
    )


def test_session_delivery_survives_empty_database():
    """On a fresh/wiped database there is no session to inherit endpoint/model
    from, so _resolve_defaults returns None. The delivery must still persist a
    session instead of crashing on the NOT NULL constraint (issue #326)."""
    db = _make_db()
    scheduler = TaskScheduler.__new__(TaskScheduler)
    scheduler._session_manager = None
    core_pkg = importlib.import_module("core")
    previous_core_db = sys.modules.get("core.database")
    previous_core_attr = getattr(core_pkg, "database", None)
    had_core_attr = hasattr(core_pkg, "database")
    sys.modules["core.database"] = _real_db
    setattr(core_pkg, "database", _real_db)
    try:
        asyncio.run(scheduler._deliver_task_result(_make_task(), "done", db))
    finally:
        if previous_core_db is None:
            sys.modules.pop("core.database", None)
        else:
            sys.modules["core.database"] = previous_core_db
        if had_core_attr:
            setattr(core_pkg, "database", previous_core_attr)
        elif hasattr(core_pkg, "database"):
            delattr(core_pkg, "database")

    sessions = db.query(DbSession).all()
    assert len(sessions) == 1
    assert sessions[0].endpoint_url == ""
    assert sessions[0].model == ""
