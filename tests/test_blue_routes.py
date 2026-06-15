import pytest
from fastapi import Request
from fastapi.datastructures import State

import routes.blue_routes as blue_routes


def _request(owner: str = "alice") -> Request:
    class DummyApp:
        state = State()

    return Request(
        scope={
            "type": "http",
            "app": DummyApp(),
            "state": {"current_user": owner},
            "headers": [],
        }
    )


def _compose_handler():
    router = blue_routes.setup_blue_routes()
    return next(
        route.endpoint
        for route in router.routes
        if route.path == "/api/blue/compose" and "POST" in route.methods
    )


@pytest.mark.asyncio
async def test_blue_compose_route_returns_agent_prompt():
    handler = _compose_handler()

    result = await handler(
        _request("alice"),
        blue_routes.BlueComposeRequest(input="verify OAuth security basics"),
    )

    assert result["feature"] == "blue"
    assert result["owner"] == "alice"
    assert result["command"] == "verify"
    assert result["topic"] == "OAuth security basics"
    assert result["mode"] == "agent"
    assert result["allow_web_search"] is True
    assert "Council Verdict" in result["prompt"]
