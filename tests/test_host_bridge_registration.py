import pytest

from src.builtin_mcp import _host_bridge_config_from_env, register_host_bridge


class FakeMcpManager:
    def __init__(self):
        self.calls = []

    async def connect_server(self, **kwargs):
        self.calls.append(kwargs)
        return True


def test_host_bridge_config_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ODYSSEUS_HOST_BRIDGE_ENABLED", raising=False)

    assert _host_bridge_config_from_env() is None


def test_host_bridge_config_requires_token_when_enabled(monkeypatch):
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_ENABLED", "true")
    monkeypatch.delenv("ODYSSEUS_HOST_BRIDGE_TOKEN", raising=False)

    with pytest.raises(ValueError):
        _host_bridge_config_from_env()


def test_host_bridge_config_uses_docker_host_default(monkeypatch):
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_ENABLED", "1")
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_TOKEN", "secret")
    monkeypatch.delenv("ODYSSEUS_HOST_BRIDGE_URL", raising=False)

    cfg = _host_bridge_config_from_env()

    assert cfg == {
        "server_id": "host_access",
        "name": "Host Access Bridge",
        "transport": "sse",
        "url": "http://host.docker.internal:8765/sse",
        "env": {"ODYSSEUS_HOST_BRIDGE_TOKEN": "secret"},
    }


@pytest.mark.asyncio
async def test_register_host_bridge_connects_when_enabled(monkeypatch):
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_ENABLED", "true")
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_TOKEN", "secret")
    monkeypatch.setenv("ODYSSEUS_HOST_BRIDGE_URL", "http://127.0.0.1:8765")
    manager = FakeMcpManager()

    ok = await register_host_bridge(manager)

    assert ok is True
    assert manager.calls == [
        {
            "server_id": "host_access",
            "name": "Host Access Bridge",
            "transport": "sse",
            "url": "http://127.0.0.1:8765",
            "env": {"ODYSSEUS_HOST_BRIDGE_TOKEN": "secret"},
        }
    ]


@pytest.mark.asyncio
async def test_register_host_bridge_noops_when_disabled(monkeypatch):
    monkeypatch.delenv("ODYSSEUS_HOST_BRIDGE_ENABLED", raising=False)
    manager = FakeMcpManager()

    ok = await register_host_bridge(manager)

    assert ok is False
    assert manager.calls == []
