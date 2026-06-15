import pytest
from fastapi import Request
from fastapi.datastructures import State

import routes.skills_routes as skills_routes
from services.memory.skills import SkillsManager


def _request(owner: str = "alice") -> Request:
    class DummyApp:
        state = State()

    return Request(scope={
        "type": "http",
        "app": DummyApp(),
        "state": {"current_user": owner},
        "headers": [],
    })


def _invoke_handler(manager: SkillsManager):
    router = skills_routes.setup_skills_routes(manager)
    return next(
        route.endpoint
        for route in router.routes
        if route.path == "/api/skills/invoke" and "POST" in route.methods
    )


@pytest.mark.asyncio
async def test_invoke_skill_returns_owner_scoped_markdown_for_exact_name(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(
        name="ship-feature",
        description="Ship a feature end to end.",
        category="feature-shipping",
        status="published",
        owner="alice",
    )
    handler = _invoke_handler(manager)

    result = await handler(
        _request("alice"),
        skills_routes.SkillInvokeRequest(query="ship-feature"),
    )

    assert result["found"] is True
    assert result["skill"]["name"] == "ship-feature"
    assert "name: ship-feature" in result["markdown"]


@pytest.mark.asyncio
async def test_invoke_skill_recommends_ship_feature_when_query_is_empty(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(name="tdd", description="Test first.", category="engineering", status="published", owner="alice")
    manager.add_skill(name="ship-feature", description="Ship feature.", category="feature-shipping", status="published", owner="alice")
    handler = _invoke_handler(manager)

    result = await handler(
        _request("alice"),
        skills_routes.SkillInvokeRequest(query="", include_markdown=False),
    )

    assert result["found"] is False
    assert [skill["name"] for skill in result["recommendations"]][:1] == ["ship-feature"]


@pytest.mark.asyncio
async def test_invoke_skill_recommends_ship_feature_for_short_prefix(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(name="srs", description="Requirements.", category="feature-shipping-subskills", status="published", owner="alice")
    manager.add_skill(name="ship-feature", description="Ship feature.", category="feature-shipping", status="published", owner="alice")
    handler = _invoke_handler(manager)

    result = await handler(
        _request("alice"),
        skills_routes.SkillInvokeRequest(query="s", include_markdown=False),
    )

    assert result["found"] is False
    assert [skill["name"] for skill in result["recommendations"]][:1] == ["ship-feature"]


@pytest.mark.asyncio
async def test_invoke_skill_recommends_fuzzy_matches_without_markdown(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(name="to-prd", description="Turn a loose idea into a product requirements document.", status="published", owner="alice")
    manager.add_skill(name="handoff", description="Write a compact handoff for another agent.", status="published", owner="alice")
    handler = _invoke_handler(manager)

    result = await handler(
        _request("alice"),
        skills_routes.SkillInvokeRequest(query="product requirements", include_markdown=False),
    )

    assert result["found"] is False
    assert result["recommendations"]
    assert result["recommendations"][0]["name"] == "to-prd"
    assert "markdown" not in result


@pytest.mark.asyncio
async def test_invoke_skill_does_not_recommend_other_users_skills(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(name="ship-feature", description="Alice skill.", status="published", owner="alice")
    manager.add_skill(name="secret-skill", description="Bob private skill.", status="published", owner="bob")
    handler = _invoke_handler(manager)

    result = await handler(
        _request("alice"),
        skills_routes.SkillInvokeRequest(query="secret", include_markdown=False),
    )

    assert result["found"] is False
    assert all(skill["name"] != "secret-skill" for skill in result["recommendations"])
