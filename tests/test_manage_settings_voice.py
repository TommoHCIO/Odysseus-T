import json

from core import database
from src import settings as settings_mod
from src import tool_implementations


class _FakeDb:
    def close(self):
        pass


def _settings_store(monkeypatch):
    saved = dict(settings_mod.DEFAULT_SETTINGS)

    def load_settings():
        return dict(saved)

    def save_settings(next_settings):
        saved.clear()
        saved.update(next_settings)

    monkeypatch.setattr(settings_mod, "load_settings", load_settings)
    monkeypatch.setattr(settings_mod, "save_settings", save_settings)
    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDb())
    return saved


async def test_manage_settings_accepts_stt_provider_model_and_language_aliases(monkeypatch):
    saved = _settings_store(monkeypatch)

    provider = await tool_implementations.do_manage_settings(json.dumps({
        "action": "set",
        "key": "speech to text provider",
        "value": "local",
    }))
    model = await tool_implementations.do_manage_settings(json.dumps({
        "action": "set",
        "key": "stt model",
        "value": "tiny",
    }))
    language = await tool_implementations.do_manage_settings(json.dumps({
        "action": "set",
        "key": "transcription language",
        "value": "en",
    }))

    assert provider["exit_code"] == 0
    assert model["exit_code"] == 0
    assert language["exit_code"] == 0
    assert saved["stt_provider"] == "local"
    assert saved["stt_model"] == "tiny"
    assert saved["stt_language"] == "en"


async def test_manage_settings_accepts_oracle_operative_stt_model_alias(monkeypatch):
    saved = _settings_store(monkeypatch)

    result = await tool_implementations.do_manage_settings(json.dumps({
        "action": "set",
        "key": "operative local stt model",
        "value": "operative",
    }))

    assert result["exit_code"] == 0
    assert saved["stt_model"] == "base.en"
