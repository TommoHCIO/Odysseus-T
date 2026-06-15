from src.blue.blue_engine import BLUE_COMMANDS, compose_blue_request, parse_blue_request


def test_parse_blue_request_defaults_to_learn_for_bare_topic():
    parsed = parse_blue_request("fuel price comparison app")

    assert parsed.command == "learn"
    assert parsed.topic == "fuel price comparison app"


def test_compose_blue_request_requires_all_blue_outputs():
    result = compose_blue_request("build fuel price comparison app")

    assert result["command"] == "build"
    assert result["mode"] == "agent"
    assert result["allow_web_search"] is True
    assert "B.L.U.E." in result["prompt"]
    for section in [
        "Skill tree",
        "Learning levels",
        "Prerequisites",
        "Multiple methods",
        "Verified final answer",
    ]:
        assert section in result["prompt"]


def test_supported_blue_commands_match_v1_surface():
    assert BLUE_COMMANDS == {
        "learn",
        "path",
        "map",
        "methods",
        "verify",
        "absorb",
        "debate",
        "build",
    }
