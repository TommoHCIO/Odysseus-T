import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


CANARY = "ODYSSEUS_CANARY_PREFERENCE_4817"


def _install_chat_helper_import_stubs(monkeypatch):
    for mod_name in [
        "starlette.middleware",
        "starlette.middleware.base",
        "core.models",
        "core.database",
        "routes.prefs_routes",
        "routes.research_routes",
        "src.llm_core",
        "src.context_compactor",
        "src.model_context",
        "src.auth_helpers",
    ]:
        if mod_name not in sys.modules:
            monkeypatch.setitem(sys.modules, mod_name, MagicMock())


def _write_canary_note(vault_root: Path) -> None:
    note = (
        vault_root
        / "admin"
        / "Odysseus"
        / "Knowledge"
        / "preference"
        / "obsidian-canary-preference.md"
    )
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(
        "\n".join(
            [
                "---",
                'title: "Obsidian Canary Preference"',
                'category: "knowledge"',
                'genre: "preference"',
                'type: "knowledge.preference"',
                'source: "test"',
                'source_id: "obsidian-chat-canary"',
                "confidence: 1",
                "status: active",
                'tags: ["odysseus/test", "obsidian/recall"]',
                "entities: []",
                "related: []",
                "---",
                "",
                "# Obsidian Canary Preference",
                "",
                f"When asked about {CANARY}, Odysseus should answer: blue-lantern recall is active.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _prepare_chat_helpers(monkeypatch, tmp_path):
    _install_chat_helper_import_stubs(monkeypatch)
    chat_helpers = importlib.import_module("routes.chat_helpers")
    from src import obsidian_knowledge

    vault_root = tmp_path / "obsidian-vault"
    monkeypatch.setattr(obsidian_knowledge, "OBSIDIAN_VAULT_ROOT", str(vault_root))
    _write_canary_note(vault_root)

    async def fake_preprocess(chat_handler, message, att_ids, sess, **kwargs):
        return chat_helpers.PreprocessedMessage(
            enhanced_message=message,
            user_content=message,
            text_for_context=message,
            youtube_transcripts=[],
            attachment_meta=[],
        )

    def fake_extract_preset(chat_handler, preset_id):
        return chat_helpers.PresetInfo(
            temperature=0.7,
            max_tokens=1024,
            system_prompt=None,
            character_name=None,
        )

    def fake_add_user_message(sess, chat_handler, preprocessed, incognito=False):
        sess.messages.append({"role": "user", "content": preprocessed.user_content})

    async def fake_maybe_compact(sess, endpoint_url, model, messages, headers):
        return messages, 4096, False

    monkeypatch.setattr(chat_helpers, "preprocess", fake_preprocess)
    monkeypatch.setattr(chat_helpers, "extract_preset", fake_extract_preset)
    monkeypatch.setattr(chat_helpers, "add_user_message", fake_add_user_message)
    monkeypatch.setattr(chat_helpers, "get_current_user", lambda request: "admin")
    monkeypatch.setattr(chat_helpers, "normalize_model_id", lambda endpoint_url, model: None)
    monkeypatch.setattr(chat_helpers, "maybe_compact", fake_maybe_compact)
    monkeypatch.setattr(chat_helpers, "trim_for_context", lambda messages, context_length: messages)

    return chat_helpers, vault_root


def _fake_session():
    sess = SimpleNamespace(
        endpoint_url="http://localhost:8000/v1",
        model="test-model",
        headers={},
        messages=[],
    )
    sess.get_context_messages = lambda: list(sess.messages)
    return sess


@pytest.mark.asyncio
async def test_build_chat_context_injects_obsidian_canary_knowledge(monkeypatch, tmp_path):
    chat_helpers, vault_root = _prepare_chat_helpers(monkeypatch, tmp_path)
    monkeypatch.setattr(chat_helpers, "load_prefs_for_user", lambda user: {"memory_enabled": True})

    ctx = await chat_helpers.build_chat_context(
        sess=_fake_session(),
        request=SimpleNamespace(),
        chat_handler=SimpleNamespace(),
        chat_processor=SimpleNamespace(build_context_preface=lambda **kwargs: ([], [], [])),
        message=f"What should you remember about {CANARY}?",
        session_id="session-canary",
    )

    injected = [
        msg
        for msg in ctx.messages
        if msg.get("metadata", {}).get("source") == "obsidian canonical knowledge"
    ]
    assert len(injected) == 1
    assert CANARY in injected[0]["content"]
    assert "blue-lantern recall is active" in injected[0]["content"]
    assert "Odysseus/Knowledge/preference/obsidian-canary-preference.md" in injected[0]["content"]

    journal = next((vault_root / "admin" / "Odysseus" / "Journal").rglob("*.md"))
    journal_text = journal.read_text(encoding="utf-8")
    assert "chat.context_injected" in journal_text
    assert "session-canary" in journal_text


@pytest.mark.asyncio
async def test_build_chat_context_logs_council_obsidian_injection(monkeypatch, tmp_path):
    chat_helpers, vault_root = _prepare_chat_helpers(monkeypatch, tmp_path)
    monkeypatch.setattr(chat_helpers, "load_prefs_for_user", lambda user: {"memory_enabled": True})
    noisy_journal = vault_root / "admin" / "Odysseus" / "Journal" / "2026" / "06" / "2026-06-12.md"
    noisy_journal.parent.mkdir(parents=True, exist_ok=True)
    noisy_journal.write_text(
        "# Journal\n\n" + ("council protocol phase injected knowledge recall test " * 300),
        encoding="utf-8",
    )
    message = "\n".join(
        [
            "[ODYSSEUS_COUNCIL_PROTOCOL:deliberative]",
            "Council operating protocol: " + ("council protocol phase injected knowledge recall test " * 20),
            "",
            "[ODYSSEUS_WORKSPACE_STAGE:ideas]",
            f"Question: what should you remember about {CANARY}?",
            "Each Council agent must answer only from injected Obsidian knowledge.",
            "",
            "[COUNCIL_PHASE:position]",
            "Keep this response concise.",
        ]
    )

    ctx = await chat_helpers.build_chat_context(
        sess=_fake_session(),
        request=SimpleNamespace(),
        chat_handler=SimpleNamespace(),
        chat_processor=SimpleNamespace(build_context_preface=lambda **kwargs: ([], [], [])),
        message=message,
        session_id="session-council-canary",
        agent_mode=True,
        council_mode=True,
    )

    injected = [
        msg
        for msg in ctx.messages
        if msg.get("metadata", {}).get("source") == "obsidian canonical knowledge"
    ]
    assert len(injected) == 1
    assert CANARY in injected[0]["content"]
    assert "blue-lantern recall is active" in injected[0]["content"]

    journal_text = noisy_journal.read_text(encoding="utf-8")
    assert "council.context_injected" in journal_text
    assert "agent.context_injected" not in journal_text
    assert "session-council-canary" in journal_text


@pytest.mark.asyncio
async def test_build_chat_context_skips_obsidian_when_memory_disabled(monkeypatch, tmp_path):
    chat_helpers, vault_root = _prepare_chat_helpers(monkeypatch, tmp_path)
    monkeypatch.setattr(chat_helpers, "load_prefs_for_user", lambda user: {"memory_enabled": False})

    ctx = await chat_helpers.build_chat_context(
        sess=_fake_session(),
        request=SimpleNamespace(),
        chat_handler=SimpleNamespace(),
        chat_processor=SimpleNamespace(build_context_preface=lambda **kwargs: ([], [], [])),
        message=f"What should you remember about {CANARY}?",
        session_id="session-no-memory",
    )

    assert not [
        msg
        for msg in ctx.messages
        if msg.get("metadata", {}).get("source") == "obsidian canonical knowledge"
    ]
    assert not (vault_root / "admin" / "Odysseus" / "Journal").exists()
