import json

import pytest
from fastapi import HTTPException, Request
from fastapi.datastructures import State

import routes.skills_routes as skills_routes
from services.memory.skill_imports import (
    import_matt_pocock_skills,
)
from services.memory.skills import SkillsManager


TREE = {
    "tree": [
        {"path": "skills/engineering/tdd/SKILL.md", "type": "blob"},
        {"path": "skills/productivity/handoff/SKILL.md", "type": "blob"},
        {"path": "skills/deprecated/qa/SKILL.md", "type": "blob"},
    ]
}

RAW = {
    "skills/engineering/tdd/SKILL.md": """---
name: tdd
description: Test-driven development with red-green-refactor.
---

# TDD

## Process

1. Write the failing test.
2. Make it pass.
""",
    "skills/productivity/handoff/SKILL.md": """---
name: handoff
description: Write a handoff document for another agent.
---

Write a concise handoff.
""",
}


def _fetch_text(url: str) -> str:
    if url.startswith("https://api.github.com/"):
        return json.dumps(TREE)
    for path, text in RAW.items():
        if url.endswith(path):
            return text
    raise AssertionError(f"unexpected URL {url}")


def test_import_matt_pocock_skills_imports_promoted_buckets_only(tmp_path):
    manager = SkillsManager(str(tmp_path))

    result = import_matt_pocock_skills(
        manager,
        owner="alice",
        fetch_text=_fetch_text,
    )

    assert result["counts"] == {"created": 2, "updated": 0, "skipped": 0}
    skills = manager.load(owner="alice")
    assert {skill["name"] for skill in skills} == {"tdd", "handoff"}
    assert {skill["category"] for skill in skills} == {
        "matt-pocock-engineering",
        "matt-pocock-productivity",
    }
    assert all(skill["status"] == "published" for skill in skills)
    assert all(skill["source"] == "matt-pocock/skills" for skill in skills)
    assert all("matt-pocock" in skill["tags"] for skill in skills)
    assert manager.load(owner="bob") == []


def test_import_matt_pocock_skills_updates_existing_by_default(tmp_path):
    manager = SkillsManager(str(tmp_path))
    first = import_matt_pocock_skills(manager, owner="alice", fetch_text=_fetch_text)
    second = import_matt_pocock_skills(manager, owner="alice", fetch_text=_fetch_text)

    assert first["counts"] == {"created": 2, "updated": 0, "skipped": 0}
    assert second["counts"] == {"created": 0, "updated": 2, "skipped": 0}
    assert len(manager.load(owner="alice")) == 2


def test_import_matt_pocock_skills_replaces_existing_category_path(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(
        name="tdd",
        description="Local test-first skill",
        category="feature-shipping-subskills",
        source="local",
        owner="alice",
    )

    result = import_matt_pocock_skills(
        manager,
        owner="alice",
        buckets=["engineering"],
        fetch_text=_fetch_text,
    )

    assert result["counts"] == {"created": 0, "updated": 1, "skipped": 0}
    skills = manager.load(owner="alice")
    assert [skill["name"] for skill in skills] == ["tdd"]
    assert skills[0]["category"] == "matt-pocock-engineering"
    old_path = tmp_path / "obsidian-vault" / "alice" / "Odysseus" / "Skills" / "feature-shipping-subskills" / "tdd" / "SKILL.md"
    assert not old_path.exists()


def test_import_matt_pocock_skills_can_skip_existing(tmp_path):
    manager = SkillsManager(str(tmp_path))
    import_matt_pocock_skills(manager, owner="alice", fetch_text=_fetch_text)
    result = import_matt_pocock_skills(
        manager,
        owner="alice",
        update_existing=False,
        fetch_text=_fetch_text,
    )

    assert result["counts"] == {"created": 0, "updated": 0, "skipped": 2}


def test_import_matt_pocock_skills_can_limit_buckets(tmp_path):
    manager = SkillsManager(str(tmp_path))
    result = import_matt_pocock_skills(
        manager,
        owner="alice",
        buckets=["engineering"],
        status="draft",
        fetch_text=_fetch_text,
    )

    assert result["counts"] == {"created": 1, "updated": 0, "skipped": 0}
    [skill] = manager.load(owner="alice")
    assert skill["name"] == "tdd"
    assert skill["status"] == "draft"


@pytest.mark.asyncio
async def test_import_matt_pocock_route_is_owner_scoped_and_admin_gated(tmp_path, monkeypatch):
    manager = SkillsManager(str(tmp_path))
    router = skills_routes.setup_skills_routes(manager)
    handler = next(
        route.endpoint
        for route in router.routes
        if route.path == "/api/skills/import/matt-pocock" and "POST" in route.methods
    )
    seen = {}

    def fake_require_admin(request):
        seen["admin_checked"] = True

    def fake_import(manager_arg, **kwargs):
        seen.update(kwargs)
        manager_arg.add_skill(
            name="tdd",
            description="Imported",
            category="matt-pocock-engineering",
            status=kwargs["status"],
            source="matt-pocock/skills",
            owner=kwargs["owner"],
        )
        return {
            "ok": True,
            "source": "mattpocock/skills",
            "ref": "main",
            "buckets": kwargs["buckets"],
            "created": ["tdd"],
            "updated": [],
            "skipped": [],
            "count": 1,
            "counts": {"created": 1, "updated": 0, "skipped": 0},
        }

    monkeypatch.setattr(skills_routes, "require_admin", fake_require_admin)
    monkeypatch.setattr(skills_routes, "import_matt_pocock_skills", fake_import)

    class DummyApp:
        state = State()

    request = Request(scope={
        "type": "http",
        "app": DummyApp(),
        "state": {"current_user": "alice"},
        "headers": [],
    })
    body = skills_routes.SkillImportRequest(buckets=["engineering"], status="draft")

    result = await handler(request, body)

    assert seen["admin_checked"] is True
    assert seen["owner"] == "alice"
    assert seen["buckets"] == ["engineering"]
    assert seen["status"] == "draft"
    assert result["total_visible"] == 1
    assert {skill["owner"] for skill in manager.load(owner="alice")} == {"alice"}
    assert manager.load(owner="bob") == []


@pytest.mark.asyncio
async def test_import_matt_pocock_route_rejects_unknown_bucket(tmp_path, monkeypatch):
    manager = SkillsManager(str(tmp_path))
    router = skills_routes.setup_skills_routes(manager)
    handler = next(
        route.endpoint
        for route in router.routes
        if route.path == "/api/skills/import/matt-pocock" and "POST" in route.methods
    )
    monkeypatch.setattr(skills_routes, "require_admin", lambda request: None)

    class DummyApp:
        state = State()

    request = Request(scope={
        "type": "http",
        "app": DummyApp(),
        "state": {"current_user": "alice"},
        "headers": [],
    })
    body = skills_routes.SkillImportRequest(buckets=["unknown"], status="published")

    with pytest.raises(HTTPException) as exc:
        await handler(request, body)

    assert exc.value.status_code == 400
