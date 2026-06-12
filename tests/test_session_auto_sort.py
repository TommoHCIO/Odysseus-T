from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest


class _Column:
    def __init__(self, name):
        self.name = name

    def __eq__(self, value):
        return ("eq", self.name, value)

    def in_(self, values):
        return ("in", self.name, tuple(values))


class _DbSession:
    id = _Column("id")
    archived = _Column("archived")
    owner = _Column("owner")


class _DbMsg:
    id = _Column("id")
    session_id = _Column("session_id")
    role = _Column("role")
    content = _Column("content")
    timestamp = _Column("timestamp")


class _Query:
    def __init__(self, rows, selected=None):
        self.rows = list(rows)
        self.selected = selected

    def filter(self, *conditions):
        for condition in conditions:
            if not isinstance(condition, tuple):
                continue
            if condition[0] == "eq":
                _, field, value = condition
                self.rows = [row for row in self.rows if getattr(row, field) == value]
            elif condition[0] == "in":
                _, field, values = condition
                self.rows = [row for row in self.rows if getattr(row, field) in values]
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    def order_by(self, *args, **kwargs):
        return self

    def count(self):
        return len(self.rows)

    def all(self):
        if self.selected:
            return [(getattr(row, self.selected.name),) for row in self.rows]
        return list(self.rows)

    def first(self):
        if not self.rows:
            return None
        row = self.rows[0]
        if self.selected:
            return (getattr(row, self.selected.name),)
        return row


class _FakeDb:
    def __init__(self, sessions, messages):
        self.sessions = sessions
        self.messages = messages
        self.deleted = []
        self.committed = False

    def query(self, selected):
        if selected is _DbSession:
            return _Query(self.sessions)
        if isinstance(selected, _Column):
            return _Query(self.messages, selected=selected)
        return _Query([])

    def delete(self, row):
        self.deleted.append(row.id)
        self.sessions = [item for item in self.sessions if item.id != row.id]

    def commit(self):
        self.committed = True

    def close(self):
        pass


def _session(session_id, *, created_at, name="New Chat", owner="admin"):
    return SimpleNamespace(
        id=session_id,
        name=name,
        owner=owner,
        archived=False,
        is_important=False,
        created_at=created_at,
        updated_at=created_at,
        last_accessed=created_at,
        last_message_at=None,
        folder=None,
    )


@pytest.mark.asyncio
async def test_auto_sort_does_not_delete_fresh_empty_session(monkeypatch):
    from core import database
    from src import session_actions

    now = datetime.utcnow()
    db = _FakeDb([_session("fresh", created_at=now - timedelta(seconds=20))], [])
    monkeypatch.setattr(database, "SessionLocal", lambda: db)
    monkeypatch.setattr(database, "Session", _DbSession)
    monkeypatch.setattr(database, "ChatMessage", _DbMsg)

    result = await session_actions.run_auto_sort("admin", skip_llm=True)

    assert "Cleaned 0 sessions" in result
    assert db.deleted == []
    assert db.sessions[0].id == "fresh"


@pytest.mark.asyncio
async def test_auto_sort_still_deletes_old_empty_session(monkeypatch):
    from core import database
    from src import session_actions

    old = datetime.utcnow() - timedelta(hours=1)
    db = _FakeDb([_session("old-empty", created_at=old)], [])
    monkeypatch.setattr(database, "SessionLocal", lambda: db)
    monkeypatch.setattr(database, "Session", _DbSession)
    monkeypatch.setattr(database, "ChatMessage", _DbMsg)

    result = await session_actions.run_auto_sort("admin", skip_llm=True)

    assert "Cleaned 1 sessions" in result
    assert db.deleted == ["old-empty"]
