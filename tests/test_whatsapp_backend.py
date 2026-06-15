import asyncio
import base64
import json
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base, WhatsAppAuditLog, WhatsAppConversation, WhatsAppMedia, WhatsAppMessage
from routes import whatsapp_helpers as wh
from routes import whatsapp_routes as wr


@pytest.fixture()
def whatsapp_db(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(wh, "SessionLocal", testing_session)
    monkeypatch.setattr(wr, "SessionLocal", testing_session)
    return testing_session


def test_account_setup_conversation_and_draft_first_send(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")
    assert account.is_default is True
    assert account.auth_state == "risk_disclosure_required"

    account = wh.accept_risk_disclosure(account.id, True, owner="alice")
    assert account.risk_disclosure_accepted is True
    assert account.auth_state == "not_configured"

    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(
            auth_state="connected",
            setup_state="connected",
            checks={"messaging": "passed", "media": "passed", "ringtone": "passed"},
        ),
        owner="alice",
    )
    assert account.setup_state == "connected"

    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551234567", profile_name="Ada"),
        owner="alice",
    )

    draft, audit, confirmed = wh.record_send(
        convo.id,
        wh.WhatsAppSendRequest(text="hello from draft", confirmed=False, actor="ai", capability="draft_whatsapp"),
        owner="alice",
    )
    assert confirmed is False
    assert draft.status == "draft"
    assert audit.action == "draft_message"
    assert audit.final_payload is None

    sent, sent_audit, confirmed = wh.record_send(
        convo.id,
        wh.WhatsAppSendRequest(text="hello for real", confirmed=True, actor="user", capability="send_whatsapp"),
        owner="alice",
    )
    assert confirmed is True
    assert sent.status == "queued"
    assert sent.sent_at is not None
    assert sent_audit.action == "send_message"
    assert sent_audit.final_payload == "hello for real"

    db = whatsapp_db()
    try:
        assert db.query(WhatsAppMessage).count() == 2
        assert db.query(WhatsAppAuditLog).count() == 2
    finally:
        db.close()


def test_owner_gate_rejects_cross_owner_account_and_conversation(whatsapp_db):
    bob_account = wh.create_account(wh.WhatsAppAccountCreate(name="Bob", transport="web_client"), owner="bob")

    with pytest.raises(Exception) as exc:
        wh.create_conversation(
            wh.WhatsAppConversationCreate(account_id=bob_account.id, wa_id="+15550000000"),
            owner="alice",
        )
    assert getattr(exc.value, "status_code", None) == 404

    bob_account = wh.accept_risk_disclosure(bob_account.id, True, owner="bob")
    bob_account = wh.update_setup_checks(
        bob_account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="bob",
    )
    bob_convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=bob_account.id, wa_id="+15550000000"),
        owner="bob",
    )
    with pytest.raises(Exception) as exc:
        wh.record_send(
            bob_convo.id,
            wh.WhatsAppSendRequest(text="cross-owner attempt", confirmed=True),
            owner="alice",
        )
    assert getattr(exc.value, "status_code", None) == 404


def test_send_blocks_until_setup_connected(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")
    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551234567"),
        owner="alice",
    )

    with pytest.raises(Exception) as exc:
        wh.record_send(convo.id, wh.WhatsAppSendRequest(text="too soon", confirmed=True), owner="alice")
    assert getattr(exc.value, "status_code", None) == 409
    assert "setup is not connected" in str(exc.value.detail)


def test_create_conversation_normalizes_phone_numbers_and_dedupes(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")

    first = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+1 (555) 123-4567", profile_name="Ada"),
        owner="alice",
    )
    second = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="15551234567@s.whatsapp.net"),
        owner="alice",
    )

    assert first.wa_id == "15551234567@s.whatsapp.net"
    assert second.id == first.id


def test_conversation_title_falls_back_to_readable_phone_not_raw_jid(whatsapp_db, monkeypatch):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="306979134263@s.whatsapp.net"),
        owner="alice",
    )

    assert wh._conversation_to_dict(convo)["title"] == "+306979134263"

    convo.profile_name = "306979134263@s.whatsapp.net"
    data = wh._conversation_to_dict(convo)
    assert data["title"] == "+306979134263"
    assert data["profile_name"] == ""

    import routes.contacts_routes as contacts_routes

    monkeypatch.setattr(
        contacts_routes,
        "_fetch_contacts",
        lambda force=False: [{"name": "Maria Rossi", "phones": ["+30 697 913 4263"], "emails": []}],
    )
    data = wh._conversation_to_dict(convo)
    assert data["title"] == "Maria Rossi"


def test_create_conversation_rejects_invalid_local_only_ids(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")

    with pytest.raises(Exception) as exc:
        wh.create_conversation(
            wh.WhatsAppConversationCreate(account_id=account.id, wa_id="not-a-real-contact"),
            owner="alice",
        )

    assert getattr(exc.value, "status_code", None) == 400
    assert "valid phone number" in str(exc.value.detail)


def test_group_conversation_requires_group_jid(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")

    with pytest.raises(Exception) as exc:
        wh.create_conversation(
            wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551234567", conversation_type="group"),
            owner="alice",
        )
    assert getattr(exc.value, "status_code", None) == 400

    group = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="120363000000000000@g.us", conversation_type="group"),
        owner="alice",
    )
    assert group.wa_id == "120363000000000000@g.us"


def test_routes_expose_minimal_whatsapp_flow(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post("/api/whatsapp/accounts", json={"name": "Personal", "transport": "web_client"})
    assert created.status_code == 200
    account_id = created.json()["account"]["id"]

    disclosed = client.post(f"/api/whatsapp/accounts/{account_id}/risk-disclosure", json={"accepted": True})
    assert disclosed.status_code == 200

    checked = client.post(
        f"/api/whatsapp/accounts/{account_id}/setup-checks",
        json={"auth_state": "connected", "setup_state": "connected", "checks": {"messaging": "passed"}},
    )
    assert checked.status_code == 200

    convo = client.post(
        "/api/whatsapp/conversations",
        json={"account_id": account_id, "wa_id": "+15551234567", "profile_name": "Ada"},
    )
    assert convo.status_code == 200
    conversation_id = convo.json()["conversation"]["id"]

    draft = client.post(
        f"/api/whatsapp/conversations/{conversation_id}/send",
        json={"text": "please review", "confirmed": False, "actor": "ai", "capability": "draft_whatsapp"},
    )
    assert draft.status_code == 200
    assert draft.json()["requires_confirmation"] is True
    assert draft.json()["message"]["status"] == "draft"

    messages = client.get(f"/api/whatsapp/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert len(messages.json()["messages"]) == 1


def test_routes_allow_manual_whatsapp_conversation_rename(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="306979134263@s.whatsapp.net"),
        owner="alice",
    )

    renamed = client.patch(
        f"/api/whatsapp/conversations/{convo.id}",
        json={"display_name": "Maria"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["conversation"]["title"] == "Maria"
    assert renamed.json()["conversation"]["profile_name"] == "Maria"


def test_ai_reply_reads_user_style_and_targets_latest_inbound_messages(whatsapp_db, monkeypatch):
    captured = {}

    def fake_resolve(setting_prefix, owner=None, **kwargs):
        captured.setdefault("resolved", []).append((setting_prefix, owner))
        return "http://llm.test/v1/chat/completions", "style-model", {"Authorization": "Bearer test"}

    async def fake_llm(url, model, messages, **kwargs):
        captured["url"] = url
        captured["model"] = model
        captured["messages"] = messages
        captured["kwargs"] = kwargs
        return "<<<DRAFT>>>\nyep, i'll bring both\n<<<END>>>"

    import src.endpoint_resolver as endpoint_resolver
    import src.llm_core as llm_core

    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint", fake_resolve)
    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)

    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551234567", profile_name="Ada"),
        owner="alice",
    )
    base = datetime(2026, 6, 13, 10, 0, 0)
    db = whatsapp_db()
    try:
        db.add_all(
            [
                WhatsAppMessage(
                    id="old-inbound",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=convo.id,
                    direction="inbound",
                    sender_display_name="Ada",
                    body="old question before the user replied",
                    received_at=base,
                    status="received",
                ),
                WhatsAppMessage(
                    id="user-style",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=convo.id,
                    direction="outbound",
                    body="yep sounds good, i'll sort it",
                    sent_at=base + timedelta(minutes=1),
                    status="sent",
                ),
                WhatsAppMessage(
                    id="new-inbound-1",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=convo.id,
                    direction="inbound",
                    sender_display_name="Ada",
                    body="can you bring the forms?",
                    received_at=base + timedelta(minutes=2),
                    status="received",
                ),
                WhatsAppMessage(
                    id="new-inbound-2",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=convo.id,
                    direction="inbound",
                    sender_display_name="Ada",
                    body="also the blue pen",
                    received_at=base + timedelta(minutes=3),
                    status="received",
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    result = asyncio.run(wh.draft_ai_reply(convo.id, owner="alice"))

    assert result["draft"] == "yep, i'll bring both"
    assert result["requires_confirmation"] is True
    assert result["incoming_message_ids"] == ["new-inbound-1", "new-inbound-2"]
    assert captured["model"] == "style-model"
    prompt = captured["messages"][1]["content"]
    assert "yep sounds good, i'll sort it" in prompt
    latest_section = prompt.split("Latest incoming message(s) to answer:", 1)[1]
    assert "can you bring the forms?" in latest_section
    assert "also the blue pen" in latest_section
    assert "old question before the user replied" not in latest_section


def test_routes_paginate_whatsapp_conversations_and_messages(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post("/api/whatsapp/accounts", json={"name": "Personal", "transport": "web_client"})
    assert created.status_code == 200
    account_id = created.json()["account"]["id"]
    client.post(f"/api/whatsapp/accounts/{account_id}/risk-disclosure", json={"accepted": True})
    client.post(
        f"/api/whatsapp/accounts/{account_id}/setup-checks",
        json={"auth_state": "connected", "setup_state": "connected", "checks": {"messaging": "passed"}},
    )

    conversation_ids = []
    for index in range(3):
        convo = client.post(
            "/api/whatsapp/conversations",
            json={
                "account_id": account_id,
                "wa_id": f"1555123456{index}@s.whatsapp.net",
                "profile_name": f"Contact {index}",
            },
        )
        assert convo.status_code == 200
        conversation_id = convo.json()["conversation"]["id"]
        conversation_ids.append(conversation_id)
        for message_index in range(3):
            sent = client.post(
                f"/api/whatsapp/conversations/{conversation_id}/send",
                json={
                    "text": f"message {index}-{message_index}",
                    "confirmed": True,
                    "actor": "user",
                    "capability": "send_whatsapp",
                },
            )
            assert sent.status_code == 200

    first_page = client.get(f"/api/whatsapp/conversations?account_id={account_id}&limit=2")
    assert first_page.status_code == 200
    first_payload = first_page.json()
    assert len(first_payload["conversations"]) == 2
    assert first_payload["pagination"] == {"limit": 2, "offset": 0, "total": 3, "has_more": True}
    assert first_payload["conversations"][0]["last_message_preview"]

    second_page = client.get(f"/api/whatsapp/conversations?account_id={account_id}&limit=2&offset=2")
    assert second_page.status_code == 200
    second_payload = second_page.json()
    assert len(second_payload["conversations"]) == 1
    assert second_payload["pagination"]["has_more"] is False

    messages = client.get(f"/api/whatsapp/conversations/{conversation_ids[0]}/messages?limit=2&offset=1")
    assert messages.status_code == 200
    message_payload = messages.json()
    assert [m["body"] for m in message_payload["messages"]] == ["message 0-1", "message 0-2"]
    assert message_payload["pagination"] == {"limit": 2, "offset": 1, "total": 3, "has_more": False}


def test_routes_order_mixed_inbound_outbound_messages_chronologically(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post("/api/whatsapp/accounts", json={"name": "Personal", "transport": "web_client"})
    assert created.status_code == 200
    account_id = created.json()["account"]["id"]
    convo = client.post(
        "/api/whatsapp/conversations",
        json={"account_id": account_id, "wa_id": "+15551234567", "profile_name": "Ada"},
    )
    assert convo.status_code == 200
    conversation_id = convo.json()["conversation"]["id"]

    base = datetime(2026, 6, 13, 10, 0, 0)
    db = whatsapp_db()
    try:
        rows = [
            WhatsAppMessage(
                id="m3",
                account_id=account_id,
                conversation_id=conversation_id,
                direction="inbound",
                body="third inbound",
                received_at=base + timedelta(minutes=2),
                created_at=base + timedelta(minutes=12),
            ),
            WhatsAppMessage(
                id="m1",
                account_id=account_id,
                conversation_id=conversation_id,
                direction="inbound",
                body="first inbound",
                received_at=base,
                created_at=base + timedelta(minutes=10),
            ),
            WhatsAppMessage(
                id="m2",
                account_id=account_id,
                conversation_id=conversation_id,
                direction="outbound",
                body="second outbound",
                sent_at=base + timedelta(minutes=1),
                created_at=base + timedelta(minutes=11),
            ),
        ]
        db.add_all(rows)
        convo_row = db.get(WhatsAppConversation, conversation_id)
        convo_row.last_message_at = base + timedelta(minutes=2)
        db.commit()
    finally:
        db.close()

    messages = client.get(f"/api/whatsapp/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert [m["body"] for m in messages.json()["messages"]] == [
        "first inbound",
        "second outbound",
        "third inbound",
    ]

    conversations = client.get(f"/api/whatsapp/conversations?account_id={account_id}")
    assert conversations.status_code == 200
    assert conversations.json()["conversations"][0]["last_message_preview"] == "third inbound"


def test_latest_messages_for_conversation_list_fetches_one_per_thread(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="web_client"), owner="alice")
    first = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551230001", profile_name="Ada"),
        owner="alice",
    )
    second = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="+15551230002", profile_name="Grace"),
        owner="alice",
    )
    base = datetime(2026, 6, 13, 10, 0, 0)
    db = whatsapp_db()
    try:
        db.add_all(
            [
                WhatsAppMessage(
                    id="first-old",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=first.id,
                    direction="inbound",
                    body="first old",
                    received_at=base,
                    created_at=base,
                ),
                WhatsAppMessage(
                    id="first-new",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=first.id,
                    direction="inbound",
                    body="first new",
                    received_at=base + timedelta(minutes=2),
                    created_at=base + timedelta(minutes=2),
                ),
                WhatsAppMessage(
                    id="second-old",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=second.id,
                    direction="inbound",
                    body="second old",
                    received_at=base + timedelta(minutes=1),
                    created_at=base + timedelta(minutes=1),
                ),
                WhatsAppMessage(
                    id="second-new",
                    owner="alice",
                    account_id=account.id,
                    conversation_id=second.id,
                    direction="outbound",
                    body="second new",
                    sent_at=base + timedelta(minutes=3),
                    created_at=base + timedelta(minutes=3),
                ),
            ]
        )
        db.commit()

        latest = wr._latest_messages_for_conversations(db, [first.id, second.id])

        assert {key: msg.body for key, msg in latest.items()} == {
            first.id: "first new",
            second.id: "second new",
        }
    finally:
        db.close()


def test_routes_support_whatsapp_ui_account_and_actions(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post(
        "/api/whatsapp/accounts",
        json={"name": "Personal", "transport": "web_client", "device_label": "Odysseus"},
    )
    assert created.status_code == 200
    account_id = created.json()["account"]["id"]

    patched = client.patch(
        f"/api/whatsapp/accounts/{account_id}",
        json={"ringtone_volume": 33, "notification_channel": "browser", "auto_transcribe_audio": True},
    )
    assert patched.status_code == 200
    assert patched.json()["account"]["ringtone_volume"] == 33

    risk = client.post(f"/api/whatsapp/accounts/{account_id}/risk-disclosure", json={"accepted": True})
    assert risk.status_code == 200

    qr = client.post(f"/api/whatsapp/accounts/{account_id}/connect-qr")
    assert qr.status_code == 200
    assert qr.json()["account"]["auth_state"] == "qr_pending"

    checks = client.post(f"/api/whatsapp/accounts/{account_id}/run-setup-checks")
    assert checks.status_code == 200
    assert checks.json()["blocked"] is True

    convo = client.post(
        "/api/whatsapp/conversations",
        json={"account_id": account_id, "wa_id": "+15551234567", "profile_name": "Ada"},
    )
    assert convo.status_code == 200
    conversation_id = convo.json()["conversation"]["id"]

    draft = client.post(
        f"/api/whatsapp/conversations/{conversation_id}/send",
        json={"text": "local draft", "confirmed": False, "actor": "ai", "capability": "draft_whatsapp"},
    )
    assert draft.status_code == 200
    assert draft.json()["message"]["status"] == "draft"

    sent_blocked = client.post(
        f"/api/whatsapp/conversations/{conversation_id}/send",
        json={"text": "send now", "confirmed": True, "actor": "user", "capability": "send_whatsapp"},
    )
    assert sent_blocked.status_code == 409

    connected = client.post(
        f"/api/whatsapp/accounts/{account_id}/setup-checks",
        json={"auth_state": "connected", "setup_state": "connected", "checks": {"messaging": "passed"}},
    )
    assert connected.status_code == 200

    sent = client.post(
        f"/api/whatsapp/conversations/{conversation_id}/send",
        json={"text": "queued real send", "confirmed": True, "actor": "user", "capability": "send_whatsapp"},
    )
    assert sent.status_code == 200
    assert sent.json()["message"]["status"] == "queued"

    message_id = sent.json()["message"]["id"]
    reacted = client.post(f"/api/whatsapp/messages/{message_id}/react", json={"emoji": "+1"})
    assert reacted.status_code == 200
    assert reacted.json()["message"]["reaction_emoji"] == "+1"

    calls = client.post(f"/api/whatsapp/conversations/{conversation_id}/start-call", json={"call_type": "voice"})
    assert calls.status_code == 200
    assert calls.json()["call"]["state"] == "blocked_needs_bridge"

    call_list = client.get(f"/api/whatsapp/calls?account_id={account_id}")
    assert call_list.status_code == 200
    assert len(call_list.json()["calls"]) == 1
    assert call_list.json()["calls"][0]["conversation_id"] == conversation_id

    export = client.post(f"/api/whatsapp/accounts/{account_id}/export")
    assert export.status_code == 200
    assert len(export.json()["export"]["messages"]) >= 2


def test_routes_reject_unsupported_whatsapp_transport(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post("/api/whatsapp/accounts", json={"name": "Personal", "transport": "test_double"})
    assert created.status_code == 400
    assert "Unsupported WhatsApp transport" in created.text


def test_qr_connection_uses_real_bridge_state_when_enabled(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")

    def fake_start(owner, account_id):
        return {
            "state": "qr_pending",
            "qr": "real-linked-device-qr-payload",
            "qr_expires_at": "2026-06-13T12:00:00",
            "session_path": f"data/whatsapp/sessions/{owner}/{account_id}",
            "chrome_profile_path": f"data/whatsapp/chrome-profiles/{owner}/{account_id}",
        }

    monkeypatch.setattr(wh.whatsapp_bridge, "start_session", fake_start)
    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_start)

    account = wh.create_account(
        wh.WhatsAppAccountCreate(
            name="Personal",
            transport="linked_device_socket",
            display_phone_number="441234567890",
        ),
        owner="alice",
    )
    wh.accept_risk_disclosure(account.id, True, owner="alice")

    updated = wh.request_qr_connection(account.id, owner="alice")
    assert updated.auth_state == "qr_pending"
    assert updated.session_path.endswith(account.id)
    assert updated.chrome_profile_path.endswith(account.id)

    state = wh.get_qr_connection_state(account.id, owner="alice")
    assert state["bridge_enabled"] is True
    assert state["qr"] == "real-linked-device-qr-payload"
    assert state["account"]["diagnostics"]["bridge_state"] == "qr_pending"


def test_connect_qr_route_does_not_double_probe_bridge_status(whatsapp_db, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")
    calls = {"status": 0}

    def fake_start(owner, account_id):
        return {
            "state": "qr_pending",
            "qr": "real-linked-device-qr-payload",
            "qr_expires_at": "2026-06-13T12:00:00",
        }

    def fake_status(owner, account_id):
        calls["status"] += 1
        return fake_start(owner, account_id)

    monkeypatch.setattr(wh.whatsapp_bridge, "start_session", fake_start)
    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_status)
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)

    created = client.post("/api/whatsapp/accounts", json={"name": "Personal", "transport": "linked_device_socket"})
    account_id = created.json()["account"]["id"]
    client.post(f"/api/whatsapp/accounts/{account_id}/risk-disclosure", json={"accepted": True})

    connected = client.post(f"/api/whatsapp/accounts/{account_id}/connect-qr")

    assert connected.status_code == 200
    assert connected.json()["account"]["auth_state"] == "qr_pending"
    assert calls["status"] == 0


def test_connected_bridge_status_clears_stale_diagnostics(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")

    def fake_status(owner, account_id):
        return {
            "state": "connected",
            "connected": True,
            "last_error": "Stream Errored (restart required)",
            "user": {"id": "15551234567@s.whatsapp.net"},
            "session_path": f"data/whatsapp/sessions/{owner}/{account_id}",
            "chrome_profile_path": f"data/whatsapp/chrome-profiles/{owner}/{account_id}",
        }

    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_status)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        row.diagnostics_json = wh._json_dumps(
            {
                "bridge_state": "disconnected",
                "last_error": "Stream Errored (restart required)",
                "reconnect_reason": "connection closed",
            }
        )
        db.commit()
    finally:
        db.close()

    state = wh.get_qr_connection_state(account.id, owner="alice")
    diagnostics = state["account"]["diagnostics"]

    assert state["connected"] is True
    assert state["last_error"] is None
    assert diagnostics["bridge_state"] == "connected"
    assert diagnostics["last_error"] is None
    assert diagnostics["reconnect_reason"] is None
    assert diagnostics["bridge_user_id"] == "15551234567@s.whatsapp.net"
    assert diagnostics["bridge_display_phone_number"] == "15551234567"
    assert state["account"]["display_phone_number"] == "15551234567"


def test_connected_account_dict_hides_stale_bridge_errors(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )
    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        row.diagnostics_json = wh._json_dumps(
            {
                "bridge_state": "connected",
                "bridge_heartbeat": "2026-06-13T12:00:00",
                "last_error": "Stream Errored (restart required)",
                "reconnect_reason": "connection closed",
            }
        )
        db.commit()
        db.refresh(row)
        data = wh._account_to_dict(row)
    finally:
        db.close()

    assert data["diagnostics"]["last_error"] is None
    assert data["diagnostics"]["reconnect_reason"] is None


def test_auth_connected_event_clears_stale_diagnostics(whatsapp_db):
    account = wh.create_account(
        wh.WhatsAppAccountCreate(
            name="Personal",
            transport="linked_device_socket",
            display_phone_number="441234567890",
        ),
        owner="alice",
    )
    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        row.diagnostics_json = json.dumps(
            {
                "bridge_state": "disconnected",
                "last_error": "Stream Errored (restart required)",
                "reconnect_reason": "connection closed",
            }
        )
        db.commit()
    finally:
        db.close()

    result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="auth.connected",
            payload={"user": {"id": "15551234567@s.whatsapp.net"}},
        )
    )

    assert result["normalized"] is True
    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        diagnostics = json.loads(row.diagnostics_json)
        assert row.auth_state == "connected"
        assert row.display_phone_number == "15551234567"
        assert diagnostics["bridge_state"] == "connected"
        assert diagnostics["last_error"] is None
        assert diagnostics["reconnect_reason"] is None
        assert diagnostics["bridge_user_id"] == "15551234567@s.whatsapp.net"
        assert diagnostics["bridge_display_phone_number"] == "15551234567"
    finally:
        db.close()


def test_bridge_message_event_normalizes_inbound_message(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="message.upsert",
            payload={
                "provider_message_id": "ABC123",
                "remote_jid": "15551234567@s.whatsapp.net",
                "from_me": False,
                "push_name": "Ada",
                "message_type": "conversation",
                "body": "live hello",
                "timestamp": 1781352000,
                "raw": {"key": {"id": "ABC123"}},
            },
        )
    )
    assert result["normalized"] is True

    db = whatsapp_db()
    try:
        convo = db.query(WhatsAppConversation).one()
        msg = db.query(WhatsAppMessage).one()
        assert convo.wa_id == "15551234567@s.whatsapp.net"
        assert convo.unread_count == 1
        assert msg.provider_message_id == "ABC123"
        assert msg.body == "live hello"
        assert msg.direction == "inbound"
    finally:
        db.close()


def test_bridge_chat_and_contact_updates_enrich_roster_metadata(whatsapp_db):
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    chat_result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="chats.update",
            payload={
                "chats": [
                    {
                        "id": "393291579586@s.whatsapp.net",
                        "name": "ALBERTO",
                        "unread_count": 0,
                        "timestamp": 1781352000,
                        "archived": False,
                        "pinned": True,
                        "muted": False,
                    }
                ]
            },
        )
    )
    contact_result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="contacts.update",
            payload={
                "contacts": [
                    {
                        "id": "393291579586@s.whatsapp.net",
                        "notify": "Alberto",
                        "img_url": "https://example.invalid/avatar.jpg",
                    }
                ]
            },
        )
    )

    assert chat_result["normalized"] is True
    assert contact_result["normalized"] is True
    db = whatsapp_db()
    try:
        convo = db.query(WhatsAppConversation).one()
        provider_state = json.loads(convo.provider_state_json)
        assert convo.wa_id == "393291579586@s.whatsapp.net"
        assert convo.profile_name == "Alberto"
        assert convo.is_pinned is True
        assert convo.is_muted is False
        assert provider_state["bridge_chat"]["name"] == "ALBERTO"
        assert provider_state["bridge_contact"]["img_url"].endswith("avatar.jpg")
    finally:
        db.close()


def test_bridge_image_event_normalizes_media_and_message_payload_exposes_preview(whatsapp_db, monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_DATA_ROOT", str(tmp_path))
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="message.upsert",
            payload={
                "provider_message_id": "IMG123",
                "remote_jid": "15551234567@s.whatsapp.net",
                "from_me": False,
                "push_name": "Ada",
                "message_type": "image",
                "body": "sunset",
                "timestamp": 1781352000,
                "media": {
                    "media_type": "image",
                    "mime_type": "image/png",
                    "filename": "sunset.png",
                    "file_size": 68,
                    "sha256": "abc123",
                },
                "raw": {"key": {"id": "IMG123"}},
            },
        )
    )
    assert result["normalized"] is True

    db = whatsapp_db()
    try:
        convo = db.query(WhatsAppConversation).one()
        msg = db.query(WhatsAppMessage).one()
        media = db.query(WhatsAppMedia).one()
        assert msg.media_id == media.id
        assert media.provider_media_id == "IMG123"
        assert media.media_type == "image"

        media_dir = tmp_path / "media" / "alice" / account.id
        media_dir.mkdir(parents=True)
        media_path = media_dir / "IMG123.png"
        media_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="))
        media.local_path = str(media_path)
        media.download_status = "downloaded"
        conversation_id = convo.id
        media_id = media.id
        db.commit()
    finally:
        db.close()

    messages = client.get(f"/api/whatsapp/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    payload = messages.json()["messages"][0]
    assert payload["media"]["filename"] == "sunset.png"
    assert payload["media"]["can_preview"] is True
    assert payload["media"]["thumbnail_url"].endswith("?thumb=1")

    media_file = client.get(f"/api/whatsapp/media/{media_id}/file")
    assert media_file.status_code == 200
    assert media_file.headers["content-type"].startswith("image/png")


def test_media_download_uses_stored_raw_message_fallback_and_keep_persists(whatsapp_db, monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")
    app = FastAPI()
    app.include_router(wr.setup_whatsapp_routes())
    client = TestClient(app)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")

    raw_message = {
        "key": {"id": "IMGRAW", "remoteJid": "15551234567@s.whatsapp.net"},
        "message": {
            "imageMessage": {
                "mimetype": "image/png",
                "fileName": "raw.png",
                "fileLength": 68,
                "fileSha256": {"type": "Buffer", "data": [1, 2, 3]},
            }
        },
    }
    result = wh.process_bridge_event(
        wh.WhatsAppBridgeEvent(
            owner="alice",
            account_id=account.id,
            event_type="message.upsert",
            payload={
                "provider_message_id": "IMGRAW",
                "remote_jid": "15551234567@s.whatsapp.net",
                "from_me": False,
                "push_name": "Ada",
                "message_type": "image",
                "body": "",
                "timestamp": 1781352000,
                "media": {"media_type": "image", "mime_type": "image/png", "filename": "raw.png"},
                "raw": raw_message,
            },
        )
    )
    assert result["normalized"] is True

    db = whatsapp_db()
    try:
        media = db.query(WhatsAppMedia).one()
        media_id = media.id
    finally:
        db.close()

    downloaded = tmp_path / "media" / "alice" / account.id / "IMGRAW.png"
    downloaded.parent.mkdir(parents=True)
    downloaded.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="))
    seen = {}

    def fake_download(owner, account_id, provider_message_id, *, raw_message=None):
        seen["owner"] = owner
        seen["account_id"] = account_id
        seen["provider_message_id"] = provider_message_id
        seen["raw_message"] = raw_message
        return {
            "local_path": str(downloaded),
            "mime_type": "image/png",
            "filename": "raw.png",
            "file_size": downloaded.stat().st_size,
            "download_status": "downloaded",
        }

    monkeypatch.setattr(wr.whatsapp_bridge, "download_media", fake_download)

    download = client.post(f"/api/whatsapp/media/{media_id}/download")
    assert download.status_code == 200
    payload = download.json()
    assert payload["media"]["file_url"].endswith(f"/api/whatsapp/media/{media_id}/file")
    assert payload["media"]["can_preview"] is True
    assert seen["provider_message_id"] == "IMGRAW"
    assert seen["raw_message"]["key"]["id"] == "IMGRAW"

    keep = client.post(f"/api/whatsapp/media/{media_id}/save")
    assert keep.status_code == 200
    keep_payload = keep.json()["media"]
    assert keep_payload["saved"] is True
    assert keep_payload["keep_forever"] is True


def test_confirmed_send_calls_bridge_when_enabled(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")
    sent_payloads = []

    def fake_send(owner, account_id, to, text):
        sent_payloads.append((owner, account_id, to, text))
        return {"status": "sent", "provider_message_id": "SENT123", "remote_jid": to}

    monkeypatch.setattr(wh.whatsapp_bridge, "send_text", fake_send)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )
    convo = wh.create_conversation(
        wh.WhatsAppConversationCreate(account_id=account.id, wa_id="15551234567@s.whatsapp.net", profile_name="Ada"),
        owner="alice",
    )

    msg, audit, confirmed = wh.record_send(
        convo.id,
        wh.WhatsAppSendRequest(text="real send", confirmed=True, actor="user", capability="send_whatsapp"),
        owner="alice",
    )

    assert confirmed is True
    assert msg.status == "sent"
    assert msg.provider_message_id == "SENT123"
    assert audit.status == "sent"
    assert sent_payloads == [("alice", account.id, "15551234567@s.whatsapp.net", "real send")]


def test_sync_chats_blocks_without_bridge_and_records_progress(whatsapp_db, monkeypatch):
    monkeypatch.delenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", raising=False)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )

    with pytest.raises(Exception) as exc:
        wh.start_sync_chats(account.id, wh.WhatsAppSyncRequest(), owner="alice")

    assert getattr(exc.value, "status_code", None) == 409
    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        diagnostics = json.loads(row.diagnostics_json)
        assert diagnostics["whatsapp_sync"]["status"] == "blocked"
        assert diagnostics["whatsapp_sync"]["phase"] == "bridge"
        assert diagnostics["sync_queue_depth"] == 0
    finally:
        db.close()


def test_sync_chats_calls_bridge_and_exposes_status(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")
    calls = []

    def fake_sync(owner, account_id, force=False):
        calls.append((owner, account_id, force))
        return {
            "job": {
                "id": "SYNC123",
                "status": "running",
                "phase": "waiting_for_linked_device_history",
                "chats_discovered": 2,
                "chats_normalized": 1,
                "messages_processed": 3,
                "media_queued": 0,
                "failures": 0,
            }
        }

    def fake_status(owner, account_id):
        return {
            "job": {
                "id": "SYNC123",
                "status": "running",
                "phase": "waiting_for_linked_device_history",
                "chats_discovered": 2,
                "chats_normalized": 2,
                "messages_processed": 4,
                "media_queued": 1,
                "failures": 0,
            }
        }

    def fake_session_status(owner, account_id):
        return {
            "state": "connected",
            "connected": True,
            "user": {"id": "15551234567@s.whatsapp.net"},
        }

    monkeypatch.setattr(wh.whatsapp_bridge, "sync_chats", fake_sync)
    monkeypatch.setattr(wh.whatsapp_bridge, "sync_status", fake_status)
    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_session_status)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )

    row, progress = wh.start_sync_chats(account.id, wh.WhatsAppSyncRequest(force=True), owner="alice")
    assert row.id == account.id
    assert progress["job_id"] == "SYNC123"
    assert progress["messages_processed"] == 3
    assert calls == [("alice", account.id, True)]

    _, status = wh.get_sync_chats_status(account.id, owner="alice")
    assert status["job_id"] == "SYNC123"
    assert status["chats_normalized"] == 2
    assert status["media_queued"] == 1


def test_sync_status_clears_stale_sync_error(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")

    def fake_session_status(owner, account_id):
        return {
            "state": "connected",
            "connected": True,
            "user": {"id": "15551234567@s.whatsapp.net"},
        }

    def fake_status(owner, account_id):
        return {
            "job": {
                "status": "idle",
                "phase": "not_started",
                "chats_discovered": 0,
                "chats_normalized": 0,
                "messages_processed": 0,
                "media_queued": 0,
                "failures": 0,
            }
        }

    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_session_status)
    monkeypatch.setattr(wh.whatsapp_bridge, "sync_status", fake_status)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    account = wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )

    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        row.diagnostics_json = wh._json_dumps(
            {
                "last_event": "sync_chats_failed",
                "last_error": "WhatsApp session is not connected",
                "whatsapp_sync": {
                    "status": "failed",
                    "phase": "bridge",
                    "last_error": "WhatsApp session is not connected",
                },
            }
        )
        db.commit()
    finally:
        db.close()

    _, status = wh.get_sync_chats_status(account.id, owner="alice")

    assert status["status"] == "idle"
    assert status["phase"] == "not_started"
    assert status["last_error"] is None
    assert "last_successful_sync_at" not in status

    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        diagnostics = json.loads(row.diagnostics_json)
        assert diagnostics["last_event"] == "sync_status_idle"
        assert diagnostics["last_error"] is None
        assert diagnostics["whatsapp_sync"]["last_error"] is None
    finally:
        db.close()


def test_missing_bridge_session_demotes_stale_connected_account_and_blocks_sync(whatsapp_db, monkeypatch):
    monkeypatch.setenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "true")

    def fake_session_status(owner, account_id):
        return {
            "state": "not_started",
            "connected": False,
            "session_path": f"data/whatsapp/sessions/{owner}/{account_id}",
            "chrome_profile_path": f"data/whatsapp/chrome-profiles/{owner}/{account_id}",
        }

    def fake_sync_status(owner, account_id):
        return {
            "job": {
                "status": "idle",
                "phase": "not_started",
                "chats_discovered": 0,
                "chats_normalized": 0,
                "messages_processed": 0,
                "media_queued": 0,
                "failures": 0,
            }
        }

    monkeypatch.setattr(wh.whatsapp_bridge, "session_status", fake_session_status)
    monkeypatch.setattr(wh.whatsapp_bridge, "sync_status", fake_sync_status)
    account = wh.create_account(wh.WhatsAppAccountCreate(name="Personal", transport="linked_device_socket"), owner="alice")
    wh.update_setup_checks(
        account.id,
        wh.WhatsAppSetupChecks(auth_state="connected", setup_state="connected", checks={"messaging": "passed"}),
        owner="alice",
    )

    _, status = wh.get_sync_chats_status(account.id, owner="alice")

    assert status["status"] == "blocked"
    assert status["phase"] == "bridge"
    assert status["last_error"] == "WhatsApp session is not connected"

    db = whatsapp_db()
    try:
        row = db.get(wh.WhatsAppAccount, account.id)
        diagnostics = json.loads(row.diagnostics_json)
        checks = json.loads(row.setup_checks_json)
        assert row.auth_state == "disconnected"
        assert row.setup_state == "setup_incomplete"
        assert checks["bridge"] == "blocked"
        assert checks["messaging"] == "blocked"
        assert diagnostics["bridge_state"] == "not_started"
        assert diagnostics["last_error"] == "WhatsApp session is not connected"
    finally:
        db.close()
