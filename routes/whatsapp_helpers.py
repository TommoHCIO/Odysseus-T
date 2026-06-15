"""Helpers for the WhatsApp integration API.

This module owns the normalized backend contract. Real WhatsApp Web/Desktop,
linked-device socket, and Cloud API transports should plug in behind this
surface; route handlers should keep using these owner-scoped helpers.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import func

from core.database import (
    SessionLocal,
    WhatsAppAccount,
    WhatsAppAuditLog,
    WhatsAppCallEvent,
    WhatsAppConversation,
    WhatsAppMedia,
    WhatsAppMessage,
    WhatsAppTransportEvent,
)
from src import whatsapp_bridge


AUTH_STATES = {
    "not_configured",
    "risk_disclosure_required",
    "qr_pending",
    "qr_expired",
    "connecting",
    "setup_incomplete",
    "connected",
    "disconnected",
    "reconnect_required",
    "failed",
}

SETUP_STATES = {"not_configured", "setup_incomplete", "connected", "failed"}
TRANSPORTS = {"web_client", "official_desktop_client", "linked_device_socket", "cloud_api"}
CONVERSATION_TYPES = {"direct", "group"}
DIRECT_JID_DOMAINS = {"s.whatsapp.net", "lid", "c.us"}
GROUP_JID_DOMAINS = {"g.us"}


def _message_time_expr():
    return func.coalesce(WhatsAppMessage.sent_at, WhatsAppMessage.received_at, WhatsAppMessage.created_at)


def _message_order(*, descending: bool = False):
    message_time = _message_time_expr()
    direction = message_time.desc() if descending else message_time.asc()
    created = WhatsAppMessage.created_at.desc() if descending else WhatsAppMessage.created_at.asc()
    return direction, created, WhatsAppMessage.id.asc()


class WhatsAppAccountCreate(BaseModel):
    name: str = "WhatsApp"
    transport: str = "web_client"
    is_default: bool = False
    display_phone_number: Optional[str] = None
    device_label: Optional[str] = None


class WhatsAppAccountUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None
    display_phone_number: Optional[str] = None
    device_label: Optional[str] = None
    notification_channel: Optional[str] = None
    ringtone: Optional[str] = None
    ringtone_volume: Optional[int] = None
    auto_download_media: Optional[bool] = None
    auto_download_media_types: Optional[list[str]] = None
    auto_transcribe_audio: Optional[bool] = None
    media_retention_policy: Optional[dict[str, Any]] = None
    call_settings: Optional[dict[str, Any]] = None


class WhatsAppRiskDisclosure(BaseModel):
    accepted: bool = True


class WhatsAppSetupChecks(BaseModel):
    checks: dict[str, Any] = {}
    auth_state: Optional[str] = None
    setup_state: Optional[str] = None


class WhatsAppSyncRequest(BaseModel):
    force: bool = False


class WhatsAppConversationCreate(BaseModel):
    account_id: str
    wa_id: str
    conversation_type: str = "direct"
    profile_name: Optional[str] = None
    group_name: Optional[str] = None


class WhatsAppConversationUpdate(BaseModel):
    display_name: Optional[str] = None
    profile_name: Optional[str] = None
    group_name: Optional[str] = None
    is_archived: Optional[bool] = None
    is_pinned: Optional[bool] = None
    is_muted: Optional[bool] = None
    needs_reply: Optional[bool] = None
    send_blocked_by_opt_out: Optional[bool] = None


class WhatsAppSendRequest(BaseModel):
    text: str
    confirmed: bool = False
    actor: str = "user"
    capability: str = "draft_whatsapp"
    quoted_message_id: Optional[str] = None


class WhatsAppReactionRequest(BaseModel):
    emoji: str
    actor: str = "user"
    capability: str = "manage_whatsapp"


class WhatsAppEditRequest(BaseModel):
    text: str
    actor: str = "user"
    capability: str = "manage_whatsapp"


class WhatsAppReminderRequest(BaseModel):
    due_at: Optional[str] = None
    title: Optional[str] = None
    actor: str = "user"
    capability: str = "manage_whatsapp"


class WhatsAppCallRequest(BaseModel):
    call_type: str = "voice"
    actor: str = "user"
    capability: str = "control_whatsapp_call"


class WhatsAppBridgeEvent(BaseModel):
    owner: Optional[str] = None
    account_id: str
    event_type: str
    payload: dict[str, Any] = {}


def _normalize_whatsapp_identifier(raw: str, conversation_type: str) -> str:
    value = (raw or "").strip()
    if not value:
        raise HTTPException(400, "wa_id required")

    value = value.replace("https://wa.me/", "").replace("http://wa.me/", "")
    compact = re.sub(r"\s+", "", value)
    lower = compact.lower()

    if "@" in compact:
        local, domain = compact.rsplit("@", 1)
        domain = domain.lower()
        if not local:
            raise HTTPException(400, "Invalid WhatsApp ID")
        if conversation_type == "group":
            if domain not in GROUP_JID_DOMAINS:
                raise HTTPException(400, "Group conversations require a WhatsApp group ID")
            return f"{local}@{domain}"
        if domain in GROUP_JID_DOMAINS:
            raise HTTPException(400, "Group WhatsApp IDs must use conversation_type=group")
        if domain not in DIRECT_JID_DOMAINS:
            raise HTTPException(400, "Unsupported WhatsApp ID domain")
        return f"{local}@{domain}"

    if conversation_type == "group":
        raise HTTPException(400, "Group conversations require a WhatsApp group ID")

    if lower.startswith("wa.me/"):
        compact = compact[6:]
    if compact.startswith("+"):
        compact = compact[1:]
    digits = re.sub(r"[^\d]", "", compact)
    if len(digits) < 8 or len(digits) > 15:
        raise HTTPException(400, "Enter a valid phone number or WhatsApp ID")
    return f"{digits}@s.whatsapp.net"


def _json_loads(raw: str | None, fallback):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _friendly_whatsapp_title(wa_id: str, conversation_type: str) -> str:
    value = (wa_id or "").strip()
    if conversation_type == "group":
        return "WhatsApp group"
    if value.endswith("@s.whatsapp.net"):
        digits = value.split("@", 1)[0]
        if digits.isdigit() and len(digits) >= 8:
            return f"+{digits}"
    if value.endswith("@lid"):
        return "WhatsApp contact"
    return value


def _phone_digits(value: str | None) -> str:
    return re.sub(r"[^\d]", "", str(value or ""))


def _contact_display_name_for_phone_jid(wa_id: str) -> str:
    value = (wa_id or "").strip()
    if not value.endswith("@s.whatsapp.net"):
        return ""
    target = value.split("@", 1)[0]
    if not target.isdigit():
        return ""
    try:
        from routes.contacts_routes import _fetch_contacts

        contacts = _fetch_contacts()
    except Exception:
        return ""
    for contact in contacts or []:
        if not isinstance(contact, dict):
            continue
        name = _clean_whatsapp_display_name(contact.get("name"))
        if not name:
            continue
        for phone in contact.get("phones") or []:
            if _phone_digits(phone) == target:
                return name
    return ""


def _clean_whatsapp_display_name(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if text.endswith(("@s.whatsapp.net", "@lid", "@g.us", "@c.us")):
        return ""
    return text


def _model_data(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=True)
    return model.dict(exclude_unset=True)


def _require_owned_row(row, owner: str, label: str):
    if row is None:
        raise HTTPException(404, f"{label} not found")
    if owner and row.owner != owner:
        raise HTTPException(404, f"{label} not found")
    return row


def _get_owned_account(db, account_id: str, owner: str) -> WhatsAppAccount:
    return _require_owned_row(db.get(WhatsAppAccount, account_id), owner, "Account")


def _get_owned_conversation(db, conversation_id: str, owner: str) -> WhatsAppConversation:
    return _require_owned_row(db.get(WhatsAppConversation, conversation_id), owner, "Conversation")


def _account_to_dict(row: WhatsAppAccount) -> dict[str, Any]:
    capabilities = _account_capabilities(row)
    diagnostics = _json_loads(row.diagnostics_json, {})
    if row.auth_state == "connected" and row.setup_state == "connected":
        diagnostics["last_error"] = None
        diagnostics["reconnect_reason"] = None
    return {
        "id": row.id,
        "owner": row.owner,
        "name": row.name,
        "enabled": bool(row.enabled),
        "is_default": bool(row.is_default),
        "transport": row.transport,
        "display_phone_number": row.display_phone_number or "",
        "device_label": row.device_label or "",
        "risk_disclosure_accepted": bool(row.risk_disclosure_accepted),
        "auth_state": row.auth_state,
        "setup_state": row.setup_state,
        "setup_checks": _json_loads(row.setup_checks_json, {}),
        "diagnostics": diagnostics,
        "session_path": row.session_path or "",
        "chrome_profile_path": row.chrome_profile_path or "",
        "notification_channel": row.notification_channel,
        "ringtone": row.ringtone,
        "ringtone_volume": int(row.ringtone_volume or 0),
        "auto_download_media": bool(row.auto_download_media),
        "auto_download_media_types": _json_loads(row.auto_download_media_types_json, ["image", "video", "audio", "document"]),
        "auto_transcribe_audio": bool(row.auto_transcribe_audio),
        "media_retention_policy": _json_loads(row.media_retention_policy_json, {}),
        "call_settings": _json_loads(row.call_settings_json, {}),
        "capabilities": capabilities,
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _account_capabilities(row: WhatsAppAccount) -> dict[str, Any]:
    connected = row.setup_state == "connected" and row.auth_state == "connected" and bool(row.enabled)
    personal = row.transport in {"web_client", "linked_device_socket", "official_desktop_client"}
    has_bridge = bool(_json_loads(row.diagnostics_json, {}).get("bridge_heartbeat"))
    return {
        "read": connected,
        "send_text": connected,
        "send_media": connected and row.transport in {"web_client", "linked_device_socket", "cloud_api"},
        "message_actions": connected,
        "media_download": connected,
        "audio_transcription": connected and bool(row.auto_transcribe_audio),
        "call_control": connected and personal,
        "qr_auth": row.transport in {"web_client", "linked_device_socket"},
        "desktop_fallback": row.transport in {"web_client", "official_desktop_client"},
        "requires_host_bridge": row.transport in {"web_client", "official_desktop_client", "linked_device_socket"},
        "host_bridge_available": has_bridge,
        "limitations": _transport_limitations(row),
    }


def _transport_limitations(row: WhatsAppAccount) -> list[str]:
    limits = []
    if row.transport in {"web_client", "official_desktop_client", "linked_device_socket"}:
        limits.append("Personal linked-device actions require the host WhatsApp bridge to be running.")
    if row.transport == "official_desktop_client":
        limits.append("Desktop client is configured for calls/fallback; message sync is not treated as primary.")
    if row.transport == "cloud_api":
        limits.append("Cloud API requires service-window/template checks before proactive sends.")
    if row.setup_state != "connected":
        limits.append("Setup must be connected before reads, sends, media, or calls are enabled.")
    return limits


def _conversation_to_dict(row: WhatsAppConversation) -> dict[str, Any]:
    title = _clean_whatsapp_display_name(row.group_name if row.conversation_type == "group" else row.profile_name)
    contact_title = "" if title else _contact_display_name_for_phone_jid(row.wa_id)
    fallback_title = _friendly_whatsapp_title(row.wa_id, row.conversation_type)
    return {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id,
        "wa_id": row.wa_id,
        "conversation_type": row.conversation_type,
        "title": title or contact_title or fallback_title,
        "profile_name": _clean_whatsapp_display_name(row.profile_name),
        "group_name": _clean_whatsapp_display_name(row.group_name),
        "linked_contact_id": row.linked_contact_id or "",
        "last_message_at": _dt(row.last_message_at),
        "unread_count": int(row.unread_count or 0),
        "is_archived": bool(row.is_archived),
        "is_pinned": bool(row.is_pinned),
        "is_muted": bool(row.is_muted),
        "needs_reply": bool(row.needs_reply),
        "urgency_score": int(row.urgency_score or 0),
        "send_blocked_by_opt_out": bool(row.send_blocked_by_opt_out),
        "advanced_privacy_detected": bool(row.advanced_privacy_detected),
        "provider_state": _json_loads(row.provider_state_json, {}),
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _message_to_dict(row: WhatsAppMessage, media: WhatsAppMedia | None = None) -> dict[str, Any]:
    data = {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id,
        "conversation_id": row.conversation_id,
        "provider_message_id": row.provider_message_id or "",
        "sender_wa_id": row.sender_wa_id or "",
        "sender_display_name": row.sender_display_name or "",
        "direction": row.direction,
        "message_type": row.message_type,
        "body": row.body or "",
        "status": row.status,
        "sent_at": _dt(row.sent_at),
        "received_at": _dt(row.received_at),
        "read_at": _dt(row.read_at),
        "edited_at": _dt(row.edited_at),
        "deleted_at": _dt(row.deleted_at),
        "quoted_message_id": row.quoted_message_id or "",
        "reaction_to_message_id": row.reaction_to_message_id or "",
        "reaction_emoji": row.reaction_emoji or "",
        "media_id": row.media_id or "",
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }
    if media is not None:
        data["media"] = _media_to_dict(media, row)
    return data


def _media_to_dict(row: WhatsAppMedia, message: WhatsAppMessage | None = None) -> dict[str, Any]:
    has_file = bool(row.local_path and row.download_status == "downloaded")
    is_image = (row.media_type == "image") or (row.mime_type or "").startswith("image/")
    thumbnail_data_url = _thumbnail_data_url_from_message(message) if is_image and message is not None else ""
    return {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id,
        "message_id": row.message_id or "",
        "provider_media_id": row.provider_media_id or "",
        "media_type": row.media_type,
        "mime_type": row.mime_type or "",
        "filename": row.filename or "",
        "local_path": row.local_path or "",
        "file_size": row.file_size or 0,
        "sha256": row.sha256 or "",
        "download_status": row.download_status,
        "file_url": f"/api/whatsapp/media/{row.id}/file" if has_file else "",
        "thumbnail_url": f"/api/whatsapp/media/{row.id}/file?thumb=1" if has_file and is_image else "",
        "thumbnail_data_url": thumbnail_data_url,
        "can_preview": bool(has_file and is_image),
        "transcript": row.transcript or "",
        "saved": bool(row.saved),
        "keep_forever": bool(row.keep_forever),
        "retention_expires_at": _dt(row.retention_expires_at),
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _call_to_dict(row: WhatsAppCallEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id,
        "conversation_id": row.conversation_id or "",
        "provider_call_id": row.provider_call_id or "",
        "call_type": row.call_type,
        "direction": row.direction,
        "state": row.state,
        "started_at": _dt(row.started_at),
        "ended_at": _dt(row.ended_at),
        "handled_by": row.handled_by or "",
        "details": _json_loads(row.details_json, {}),
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _audit_to_dict(row: WhatsAppAuditLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id or "",
        "conversation_id": row.conversation_id or "",
        "message_id": row.message_id or "",
        "actor": row.actor,
        "capability": row.capability,
        "action": row.action,
        "transport": row.transport or "",
        "status": row.status,
        "failure_details": row.failure_details or "",
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _transport_event_to_dict(row: WhatsAppTransportEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "owner": row.owner,
        "account_id": row.account_id,
        "event_type": row.event_type,
        "provider_event_id": row.provider_event_id or "",
        "normalized": bool(row.normalized),
        "retry_count": int(row.retry_count or 0),
        "dead_letter": bool(row.dead_letter),
        "error": row.error or "",
        "raw_payload_expires_at": _dt(row.raw_payload_expires_at),
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _write_audit(
    db,
    *,
    owner: str,
    account_id: str | None,
    conversation_id: str | None,
    message_id: str | None,
    actor: str,
    capability: str,
    action: str,
    transport: str | None,
    draft_payload: str | None = None,
    final_payload: str | None = None,
    transport_result: dict[str, Any] | None = None,
    status: str = "recorded",
    failure_details: str | None = None,
) -> WhatsAppAuditLog:
    row = WhatsAppAuditLog(
        id=uuid.uuid4().hex,
        owner=owner,
        account_id=account_id,
        conversation_id=conversation_id,
        message_id=message_id,
        actor=(actor or "user").strip() or "user",
        capability=(capability or "manage_whatsapp").strip() or "manage_whatsapp",
        action=action,
        draft_payload=draft_payload,
        final_payload=final_payload,
        transport=transport,
        transport_result=_json_dumps(transport_result) if transport_result is not None else None,
        status=status,
        failure_details=failure_details,
    )
    db.add(row)
    return row


def _bridge_is_enabled() -> bool:
    return whatsapp_bridge.bridge_enabled()


def _merge_diagnostics(row: WhatsAppAccount, updates: dict[str, Any]) -> dict[str, Any]:
    diag = _json_loads(row.diagnostics_json, {})
    diag.update(updates)
    row.diagnostics_json = _json_dumps(diag)
    return diag


def _sync_progress_from_result(result: dict[str, Any], *, fallback_status: str = "requested") -> dict[str, Any]:
    job = result.get("job") if isinstance(result.get("job"), dict) else result
    now = datetime.utcnow().isoformat()
    return {
        "job_id": job.get("id") or job.get("job_id") or uuid.uuid4().hex,
        "status": job.get("status") or fallback_status,
        "phase": job.get("phase") or "available_history",
        "chats_discovered": int(job.get("chats_discovered") or job.get("chatsDiscovered") or 0),
        "chats_normalized": int(job.get("chats_normalized") or job.get("chatsNormalized") or 0),
        "messages_processed": int(job.get("messages_processed") or job.get("messagesProcessed") or 0),
        "media_queued": int(job.get("media_queued") or job.get("mediaQueued") or 0),
        "failures": int(job.get("failures") or 0),
        "elapsed_ms": int(job.get("elapsed_ms") or job.get("elapsedMs") or 0),
        "partial_history_caveat": job.get("partial_history_caveat")
        or job.get("partialHistoryCaveat")
        or "Only linked-device/cloud history made available by WhatsApp can be imported.",
        "started_at": job.get("started_at") or job.get("startedAt") or now,
        "updated_at": job.get("updated_at") or job.get("updatedAt") or now,
        "last_error": job.get("last_error") or job.get("lastError"),
    }


def _set_sync_progress(row: WhatsAppAccount, progress: dict[str, Any]) -> dict[str, Any]:
    diag = _json_loads(row.diagnostics_json, {})
    previous = diag.get("whatsapp_sync") if isinstance(diag.get("whatsapp_sync"), dict) else {}
    merged = dict(previous)
    merged.update({k: v for k, v in progress.items() if v is not None})
    if "last_error" in progress and progress.get("last_error") is None:
        merged["last_error"] = None
    if merged.get("status") == "completed" and merged.get("last_error") is None:
        merged["last_successful_sync_at"] = merged.get("updated_at") or datetime.utcnow().isoformat()
    diag["whatsapp_sync"] = merged
    diag["sync_queue_depth"] = 1 if merged.get("status") in {"requested", "running", "watching"} else 0
    row.diagnostics_json = _json_dumps(diag)
    return merged


def _sync_seed_chats(db, account: WhatsAppAccount, *, limit: int = 500) -> list[dict[str, Any]]:
    conversations = (
        db.query(WhatsAppConversation)
        .filter(WhatsAppConversation.account_id == account.id)
        .order_by(WhatsAppConversation.last_message_at.desc().nullslast(), WhatsAppConversation.updated_at.desc())
        .limit(limit)
        .all()
    )
    seeds: list[dict[str, Any]] = []
    for convo in conversations:
        oldest = (
            db.query(WhatsAppMessage)
            .filter(
                WhatsAppMessage.account_id == account.id,
                WhatsAppMessage.conversation_id == convo.id,
                WhatsAppMessage.provider_message_id.isnot(None),
            )
            .order_by(*_message_order())
            .first()
        )
        seed: dict[str, Any] = {
            "jid": convo.wa_id,
            "name": convo.group_name or convo.profile_name or "",
            "conversation_type": convo.conversation_type,
        }
        if oldest:
            happened_at = oldest.sent_at or oldest.received_at or oldest.created_at
            seed["oldest_message"] = {
                "key": {
                    "remoteJid": convo.wa_id,
                    "id": oldest.provider_message_id,
                    "fromMe": oldest.direction == "outbound",
                },
                "messageTimestamp": int(happened_at.timestamp()) if happened_at else 0,
            }
        seeds.append(seed)
    return seeds


def _bridge_user_id(user: dict[str, Any] | None) -> str:
    if not isinstance(user, dict):
        return ""
    return str(user.get("id") or user.get("jid") or user.get("wid") or "").strip()


def _bridge_display_phone(user: dict[str, Any] | None) -> str:
    bridge_id = _bridge_user_id(user)
    if not bridge_id and isinstance(user, dict):
        bridge_id = str(user.get("phone") or user.get("phoneNumber") or "").strip()
    return bridge_id.split(":")[0].split("@")[0].strip()


def _apply_bridge_session(row: WhatsAppAccount, session: dict[str, Any]) -> None:
    state = session.get("state") or "unknown"
    connected = state == "connected"
    user = session.get("user") or {}
    bridge_user_id = _bridge_user_id(user)
    bridge_phone = _bridge_display_phone(user)
    if session.get("session_path"):
        row.session_path = session.get("session_path")
    if session.get("chrome_profile_path"):
        row.chrome_profile_path = session.get("chrome_profile_path")
    if connected:
        row.auth_state = "connected"
        row.setup_state = "connected"
        checks = _json_loads(row.setup_checks_json, {})
        checks.update({"messaging": "passed", "linked_device_socket": "passed", "bridge": "passed"})
        row.setup_checks_json = _json_dumps(checks)
        if bridge_phone:
            row.display_phone_number = bridge_phone
    elif state in {"qr_pending", "connecting"}:
        row.auth_state = state
        row.setup_state = "setup_incomplete"
    elif state == "reconnect_required":
        row.auth_state = "reconnect_required"
        row.setup_state = "setup_incomplete"
    elif state == "failed":
        row.auth_state = "failed"
        row.setup_state = "failed"
    elif state in {"not_started", "disconnected", "unknown"}:
        row.auth_state = "disconnected"
        row.setup_state = "setup_incomplete"
        checks = _json_loads(row.setup_checks_json, {})
        checks.update({"bridge": "blocked", "messaging": "blocked"})
        row.setup_checks_json = _json_dumps(checks)
        if not session.get("last_error"):
            session["last_error"] = "WhatsApp bridge session is not connected"
    _merge_diagnostics(
        row,
        {
            "bridge_heartbeat": datetime.utcnow().isoformat(),
            "bridge_state": state,
            "last_error": None if connected else session.get("last_error"),
            "last_event": "bridge_session_status",
            "reconnect_reason": None if connected else _json_loads(row.diagnostics_json, {}).get("reconnect_reason"),
            "qr_expires_at": session.get("qr_expires_at"),
            "bridge_version": session.get("version"),
            "bridge_user_id": bridge_user_id or None,
            "bridge_display_phone_number": bridge_phone or None,
        },
    )


def _sync_bridge_status(db, row: WhatsAppAccount) -> dict[str, Any]:
    if not _bridge_is_enabled():
        return {}
    try:
        session = whatsapp_bridge.session_status(row.owner, row.id)
        _apply_bridge_session(row, session)
        db.commit()
        db.refresh(row)
        return session
    except whatsapp_bridge.WhatsAppBridgeError as exc:
        _merge_diagnostics(
            row,
            {
                "bridge_heartbeat": None,
                "bridge_state": "unreachable",
                "last_error": str(exc),
                "last_event": "bridge_unreachable",
            },
        )
        db.commit()
        raise HTTPException(502, str(exc)) from exc


def refresh_account_bridge_statuses(rows: list[WhatsAppAccount]) -> None:
    if not rows or not _bridge_is_enabled():
        return
    db = SessionLocal()
    try:
        for account in rows:
            row = db.get(WhatsAppAccount, account.id)
            if not row:
                continue
            try:
                _sync_bridge_status(db, row)
            except HTTPException:
                continue
    finally:
        db.close()


def _message_datetime(timestamp: Any) -> datetime:
    try:
        value = float(timestamp or 0)
    except (TypeError, ValueError):
        value = 0
    if value > 0:
        return datetime.utcfromtimestamp(value)
    return datetime.utcnow()


def _raw_payload_dict(row: WhatsAppMessage) -> dict[str, Any]:
    raw = row.raw_payload or ""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def _media_node_from_message(message: dict[str, Any] | None) -> tuple[str | None, dict[str, Any] | None]:
    if not isinstance(message, dict):
        return None, None
    for media_type, key in (
        ("image", "imageMessage"),
        ("video", "videoMessage"),
        ("audio", "audioMessage"),
        ("document", "documentMessage"),
        ("sticker", "stickerMessage"),
    ):
        value = message.get(key)
        if isinstance(value, dict):
            return media_type, value
    for wrapper in (
        "ephemeralMessage",
        "viewOnceMessage",
        "viewOnceMessageV2",
        "viewOnceMessageV2Extension",
        "documentWithCaptionMessage",
    ):
        nested = message.get(wrapper)
        if isinstance(nested, dict):
            found_type, found_value = _media_node_from_message(nested.get("message"))
            if found_type:
                return found_type, found_value
    return None, None


def _thumbnail_data_url_from_message(row: WhatsAppMessage | None) -> str:
    if row is None:
        return ""
    raw = _raw_payload_dict(row)
    media_type, media_node = _media_node_from_message(raw.get("message"))
    if media_type != "image" or not isinstance(media_node, dict):
        return ""
    thumb = media_node.get("jpegThumbnail")
    if isinstance(thumb, str) and thumb:
        return f"data:image/jpeg;base64,{thumb}"
    return ""


def _bridge_media_metadata(payload: dict[str, Any]) -> dict[str, Any] | None:
    media = payload.get("media")
    if not isinstance(media, dict):
        raw_message = ((payload.get("raw") or {}).get("message") or {}) if isinstance(payload.get("raw"), dict) else {}
        media_type, value = _media_node_from_message(raw_message)
        if media_type and isinstance(value, dict):
            media = {
                "media_type": media_type,
                "mime_type": value.get("mimetype") or "",
                "filename": value.get("fileName") or value.get("title") or "",
                "file_size": value.get("fileLength") or 0,
                "sha256": "",
            }
    if not isinstance(media, dict):
        return None
    media_type = str(media.get("media_type") or media.get("type") or payload.get("message_type") or "file").lower()
    if media_type in {"conversation", "extendedtext", "unknown", "text"}:
        return None
    if media_type not in {"image", "video", "audio", "document", "sticker", "voice", "file"}:
        media_type = "file"
    try:
        file_size = int(media.get("file_size") or media.get("fileLength") or 0)
    except (TypeError, ValueError):
        file_size = 0
    return {
        "media_type": media_type,
        "mime_type": str(media.get("mime_type") or media.get("mimetype") or "").strip(),
        "filename": str(media.get("filename") or media.get("file_name") or "").strip(),
        "file_size": file_size,
        "sha256": str(media.get("sha256") or "").strip() or None,
    }


def ensure_message_media_from_raw(db, row: WhatsAppMessage) -> WhatsAppMedia | None:
    if row.media_id:
        return db.get(WhatsAppMedia, row.media_id)
    if row.message_type not in {"image", "video", "audio", "document", "sticker", "voice", "file"}:
        return None
    raw = _raw_payload_dict(row)
    if not raw:
        return None
    media_meta = _bridge_media_metadata(
        {
            "provider_message_id": row.provider_message_id or row.id,
            "message_type": row.message_type,
            "raw": raw,
        }
    )
    if not media_meta:
        return None
    provider_media_id = row.provider_message_id or row.id
    media = (
        db.query(WhatsAppMedia)
        .filter(WhatsAppMedia.account_id == row.account_id, WhatsAppMedia.provider_media_id == provider_media_id)
        .first()
    )
    if not media:
        media = WhatsAppMedia(
            id=uuid.uuid4().hex,
            owner=row.owner,
            account_id=row.account_id,
            message_id=row.id,
            provider_media_id=provider_media_id,
            media_type=media_meta["media_type"],
            mime_type=media_meta["mime_type"] or None,
            filename=media_meta["filename"] or None,
            file_size=media_meta["file_size"] or None,
            sha256=media_meta["sha256"],
            download_status="pending",
            raw_payload=_json_dumps(media_meta),
        )
        db.add(media)
        db.flush()
    else:
        media.message_id = media.message_id or row.id
    row.media_id = media.id
    return media


def create_account(data: WhatsAppAccountCreate, owner: str) -> WhatsAppAccount:
    name = (data.name or "").strip() or "WhatsApp"
    transport = (data.transport or "web_client").strip()
    if transport not in TRANSPORTS:
        raise HTTPException(400, "Unsupported WhatsApp transport")
    db = SessionLocal()
    try:
        q = db.query(WhatsAppAccount)
        if owner:
            q = q.filter(WhatsAppAccount.owner == owner)
        existing_count = q.count()
        row = WhatsAppAccount(
            id=uuid.uuid4().hex,
            owner=owner,
            name=name,
            transport=transport,
            is_default=bool(data.is_default or existing_count == 0),
            display_phone_number=(data.display_phone_number or "").strip() or None,
            device_label=(data.device_label or "").strip() or None,
            auth_state="risk_disclosure_required",
            setup_state="not_configured",
            setup_checks_json=_json_dumps({}),
            diagnostics_json=_json_dumps({"bridge_heartbeat": None, "last_event": None, "last_send_error": None}),
            auto_download_media_types_json=_json_dumps(["image", "video", "audio", "document"]),
            media_retention_policy_json=_json_dumps({"max_cache_mb": 1024, "delete_after_days": 90}),
            call_settings_json=_json_dumps({}),
        )
        if row.is_default:
            q.update({WhatsAppAccount.is_default: False})
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def update_account(account_id: str, data: WhatsAppAccountUpdate, owner: str) -> WhatsAppAccount:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        payload = _model_data(data)
        if "name" in payload and payload["name"] is not None:
            row.name = (payload["name"] or "").strip() or row.name
        if "enabled" in payload and payload["enabled"] is not None:
            row.enabled = bool(payload["enabled"])
        if "display_phone_number" in payload:
            row.display_phone_number = (payload["display_phone_number"] or "").strip() or None
        if "device_label" in payload:
            row.device_label = (payload["device_label"] or "").strip() or None
        if "notification_channel" in payload and payload["notification_channel"]:
            row.notification_channel = payload["notification_channel"]
        if "ringtone" in payload and payload["ringtone"]:
            row.ringtone = payload["ringtone"]
        if "ringtone_volume" in payload and payload["ringtone_volume"] is not None:
            row.ringtone_volume = max(0, min(100, int(payload["ringtone_volume"])))
        if "auto_download_media" in payload and payload["auto_download_media"] is not None:
            row.auto_download_media = bool(payload["auto_download_media"])
        if "auto_download_media_types" in payload and payload["auto_download_media_types"] is not None:
            row.auto_download_media_types_json = _json_dumps(payload["auto_download_media_types"])
        if "auto_transcribe_audio" in payload and payload["auto_transcribe_audio"] is not None:
            row.auto_transcribe_audio = bool(payload["auto_transcribe_audio"])
        if "media_retention_policy" in payload and payload["media_retention_policy"] is not None:
            row.media_retention_policy_json = _json_dumps(payload["media_retention_policy"])
        if "call_settings" in payload and payload["call_settings"] is not None:
            row.call_settings_json = _json_dumps(payload["call_settings"])
        if payload.get("is_default"):
            q = db.query(WhatsAppAccount)
            if owner:
                q = q.filter(WhatsAppAccount.owner == owner)
            q.update({WhatsAppAccount.is_default: False})
            row.is_default = True
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def set_default_account(account_id: str, owner: str) -> WhatsAppAccount:
    return update_account(account_id, WhatsAppAccountUpdate(is_default=True), owner)


def delete_account(account_id: str, owner: str, delete_all_data: bool = False) -> None:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if delete_all_data:
            db.query(WhatsAppMedia).filter(WhatsAppMedia.account_id == row.id).delete()
            db.query(WhatsAppCallEvent).filter(WhatsAppCallEvent.account_id == row.id).delete()
            db.query(WhatsAppAuditLog).filter(WhatsAppAuditLog.account_id == row.id).delete()
            db.query(WhatsAppTransportEvent).filter(WhatsAppTransportEvent.account_id == row.id).delete()
        db.delete(row)
        db.commit()
    finally:
        db.close()


def request_qr_connection(account_id: str, owner: str) -> WhatsAppAccount:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if row.transport not in {"web_client", "linked_device_socket"}:
            raise HTTPException(409, "This transport does not support QR linked-device auth")
        if not row.risk_disclosure_accepted:
            raise HTTPException(409, "Risk disclosure must be accepted before QR connection")
        row.auth_state = "qr_pending"
        row.setup_state = "setup_incomplete"
        diag = _json_loads(row.diagnostics_json, {})
        diag.update({
            "last_event": "qr_connection_requested",
            "reconnect_reason": None,
            "bridge_required": True,
            "bridge_heartbeat": diag.get("bridge_heartbeat"),
        })
        row.diagnostics_json = _json_dumps(diag)
        event = WhatsAppTransportEvent(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=row.id,
            event_type="qr_connection_requested",
            normalized=True,
            raw_payload=None,
        )
        db.add(event)
        _write_audit(
            db,
            owner=owner,
            account_id=row.id,
            conversation_id=None,
            message_id=None,
            actor="user",
            capability="manage_whatsapp",
            action="request_qr_connection",
            transport=row.transport,
            status="recorded",
        )
        if _bridge_is_enabled():
            try:
                session = whatsapp_bridge.start_session(owner, row.id)
                _apply_bridge_session(row, session)
            except whatsapp_bridge.WhatsAppBridgeError as exc:
                row.auth_state = "failed"
                row.setup_state = "failed"
                _merge_diagnostics(
                    row,
                    {
                        "bridge_heartbeat": None,
                        "bridge_state": "unreachable",
                        "last_error": str(exc),
                        "last_event": "qr_connection_failed",
                    },
                )
                db.commit()
                raise HTTPException(502, str(exc)) from exc
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def get_qr_connection_state(account_id: str, owner: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if not _bridge_is_enabled():
            data = _account_to_dict(row)
            return {"account": data, "bridge_enabled": False, "qr": None, "qr_expires_at": None}
        session = _sync_bridge_status(db, row)
        connected = bool(session.get("connected")) or session.get("state") == "connected"
        return {
            "account": _account_to_dict(row),
            "bridge_enabled": True,
            "state": session.get("state") or row.auth_state,
            "qr": session.get("qr"),
            "qr_expires_at": session.get("qr_expires_at"),
            "connected": connected,
            "last_error": None if connected else session.get("last_error"),
        }
    finally:
        db.close()


def disconnect_account(account_id: str, owner: str, delete_local_session: bool = False) -> WhatsAppAccount:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        bridge_error = None
        if _bridge_is_enabled():
            try:
                whatsapp_bridge.stop_session(owner, row.id, remove_files=delete_local_session)
            except whatsapp_bridge.WhatsAppBridgeError as exc:
                bridge_error = str(exc)
        row.auth_state = "disconnected"
        row.setup_state = "not_configured"
        if delete_local_session:
            row.session_secret = None
            row.browser_secret = None
            row.session_path = None
            row.chrome_profile_path = None
        diag = _json_loads(row.diagnostics_json, {})
        diag.update({"last_event": "disconnected", "reconnect_reason": "user_disconnected"})
        if bridge_error:
            diag["last_error"] = bridge_error
        row.diagnostics_json = _json_dumps(diag)
        _write_audit(
            db,
            owner=owner,
            account_id=row.id,
            conversation_id=None,
            message_id=None,
            actor="user",
            capability="manage_whatsapp",
            action="disconnect_account",
            transport=row.transport,
            status="recorded",
        )
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def accept_risk_disclosure(account_id: str, accepted: bool, owner: str) -> WhatsAppAccount:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        row.risk_disclosure_accepted = bool(accepted)
        if accepted and row.auth_state == "risk_disclosure_required":
            row.auth_state = "not_configured"
        elif not accepted:
            row.auth_state = "risk_disclosure_required"
            row.setup_state = "not_configured"
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def update_setup_checks(account_id: str, data: WhatsAppSetupChecks, owner: str) -> WhatsAppAccount:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if data.auth_state:
            if data.auth_state not in AUTH_STATES:
                raise HTTPException(400, "Invalid auth_state")
            row.auth_state = data.auth_state
        if data.setup_state:
            if data.setup_state not in SETUP_STATES:
                raise HTTPException(400, "Invalid setup_state")
            row.setup_state = data.setup_state
        row.setup_checks_json = _json_dumps(data.checks or {})
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def run_live_setup_checks(account_id: str, owner: str) -> tuple[WhatsAppAccount, bool, str]:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if not _bridge_is_enabled():
            data = _account_to_dict(row)
            has_bridge = bool(data["diagnostics"].get("bridge_heartbeat"))
            auth_state = row.auth_state
            checks = dict(data["setup_checks"] or {})
            checks.setdefault("messaging", "blocked" if not has_bridge else "pending")
            checks.setdefault("media", "blocked" if not has_bridge else "pending")
            checks.setdefault("ringtone", "available")
            checks.setdefault("chrome_calls", "blocked" if not has_bridge else "pending")
            checks.setdefault("desktop_fallback", "blocked" if not has_bridge else "pending")
            checks.setdefault("os_automation", "blocked" if not has_bridge else "pending")
            row.setup_checks_json = _json_dumps(checks)
            row.auth_state = auth_state
            row.setup_state = "setup_incomplete"
            db.commit()
            db.refresh(row)
            return row, True, "Host WhatsApp bridge is not configured"

        session = _sync_bridge_status(db, row)
        checks = _json_loads(row.setup_checks_json, {})
        connected = bool(session.get("connected"))
        checks.update(
            {
                "bridge": "passed",
                "messaging": "passed" if connected else "pending",
                "linked_device_socket": "passed" if connected else "pending",
                "media": "pending" if connected else "blocked",
                "ringtone": "available",
                "chrome_calls": "pending",
                "desktop_fallback": "pending",
                "os_automation": "pending",
            }
        )
        row.setup_checks_json = _json_dumps(checks)
        if connected:
            row.auth_state = "connected"
            row.setup_state = "connected"
        elif row.auth_state not in {"qr_pending", "connecting", "reconnect_required"}:
            row.auth_state = session.get("state") or row.auth_state
            row.setup_state = "setup_incomplete"
        db.commit()
        db.refresh(row)
        return row, not connected, "" if connected else "Scan the live WhatsApp linked-device QR to finish setup"
    finally:
        db.close()


def start_sync_chats(account_id: str, data: WhatsAppSyncRequest, owner: str) -> tuple[WhatsAppAccount, dict[str, Any]]:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if _bridge_is_enabled():
            _sync_bridge_status(db, row)
        if row.auth_state != "connected" or row.setup_state != "connected":
            progress = _set_sync_progress(
                row,
                {
                    "job_id": uuid.uuid4().hex,
                    "status": "blocked",
                    "phase": "setup",
                    "updated_at": datetime.utcnow().isoformat(),
                    "last_error": "WhatsApp account setup is not connected",
                },
            )
            _merge_diagnostics(row, {"last_event": "sync_chats_blocked", "last_error": progress["last_error"]})
            db.commit()
            raise HTTPException(409, progress["last_error"])

        _write_audit(
            db,
            owner=owner,
            account_id=row.id,
            conversation_id=None,
            message_id=None,
            actor="user",
            capability="read_whatsapp",
            action="sync_chats",
            transport=row.transport,
            status="recorded",
        )

        if not _bridge_is_enabled():
            progress = _set_sync_progress(
                row,
                {
                    "job_id": uuid.uuid4().hex,
                    "status": "blocked",
                    "phase": "bridge",
                    "updated_at": datetime.utcnow().isoformat(),
                    "last_error": "Host WhatsApp bridge is not configured",
                },
            )
            _merge_diagnostics(
                row,
                {
                    "last_event": "sync_chats_blocked",
                    "last_error": "Host WhatsApp bridge is not configured",
                    "bridge_required": True,
                },
            )
            db.commit()
            raise HTTPException(409, progress["last_error"])

        try:
            seed_chats = _sync_seed_chats(db, row)
            try:
                result = whatsapp_bridge.sync_chats(
                    owner,
                    row.id,
                    force=bool(data.force),
                    seed_chats=seed_chats,
                )
            except TypeError as exc:
                if "seed_chats" not in str(exc):
                    raise
                result = whatsapp_bridge.sync_chats(owner, row.id, force=bool(data.force))
        except whatsapp_bridge.WhatsAppBridgeError as exc:
            progress = _set_sync_progress(
                row,
                {
                    "job_id": uuid.uuid4().hex,
                    "status": "failed",
                    "phase": "bridge",
                    "updated_at": datetime.utcnow().isoformat(),
                    "last_error": str(exc),
                },
            )
            _merge_diagnostics(row, {"last_event": "sync_chats_failed", "last_error": str(exc)})
            db.commit()
            raise HTTPException(502, str(exc)) from exc

        progress = _set_sync_progress(row, _sync_progress_from_result(result, fallback_status="running"))
        _merge_diagnostics(
            row,
            {
                "last_event": "sync_chats_requested",
                "last_error": None,
                "bridge_heartbeat": datetime.utcnow().isoformat(),
            },
        )
        db.add(
            WhatsAppTransportEvent(
                id=uuid.uuid4().hex,
                owner=owner,
                account_id=row.id,
                event_type="sync_chats_requested",
                normalized=True,
                raw_payload=None,
            )
        )
        db.commit()
        db.refresh(row)
        return row, progress
    finally:
        db.close()


def get_sync_chats_status(account_id: str, owner: str) -> tuple[WhatsAppAccount, dict[str, Any]]:
    db = SessionLocal()
    try:
        row = _get_owned_account(db, account_id, owner)
        if _bridge_is_enabled():
            bridge_session = _sync_bridge_status(db, row)
            try:
                result = whatsapp_bridge.sync_status(owner, row.id)
                if result:
                    progress = _set_sync_progress(row, _sync_progress_from_result(result, fallback_status="idle"))
                    if not bridge_session.get("connected"):
                        progress = _set_sync_progress(
                            row,
                            {
                                "status": "blocked",
                                "phase": "bridge",
                                "updated_at": datetime.utcnow().isoformat(),
                                "last_error": "WhatsApp session is not connected",
                            },
                        )
                    _merge_diagnostics(
                        row,
                        {
                            "last_event": f"sync_status_{progress.get('status') or 'idle'}",
                            "last_error": None if bridge_session.get("connected") else "WhatsApp session is not connected",
                            "bridge_heartbeat": datetime.utcnow().isoformat(),
                        },
                    )
                    db.commit()
                    db.refresh(row)
            except whatsapp_bridge.WhatsAppBridgeError as exc:
                _set_sync_progress(
                    row,
                    {
                        "status": "failed",
                        "phase": "bridge",
                        "updated_at": datetime.utcnow().isoformat(),
                        "last_error": str(exc),
                    },
                )
                _merge_diagnostics(row, {"last_event": "sync_status_failed", "last_error": str(exc)})
                db.commit()
        progress = _json_loads(row.diagnostics_json, {}).get("whatsapp_sync") or {
            "status": "idle",
            "phase": "not_started",
            "chats_discovered": 0,
            "chats_normalized": 0,
            "messages_processed": 0,
            "media_queued": 0,
            "failures": 0,
            "elapsed_ms": 0,
            "partial_history_caveat": "Only linked-device/cloud history made available by WhatsApp can be imported.",
            "updated_at": None,
        }
        return row, progress
    finally:
        db.close()


def _format_whatsapp_message_for_prompt(row: WhatsAppMessage, *, title: str = "") -> str:
    speaker = "User" if row.direction == "outbound" else (row.sender_display_name or title or "Contact")
    when = row.sent_at or row.received_at or row.created_at
    when_text = when.isoformat(timespec="minutes") if when else "unknown time"
    body = re.sub(r"\s+", " ", (row.body or "")).strip()
    return f"[{when_text}] {speaker}: {body}"


def _clean_ai_draft(raw: str) -> str:
    from src.text_helpers import strip_think

    text = strip_think(raw or "", prose=False, prompt_echo=True).strip()
    markers = re.search(r"<<<DRAFT>>>\s*([\s\S]*?)\s*<<<END>>>", text, flags=re.IGNORECASE)
    if markers:
        text = markers.group(1).strip()
    text = re.sub(r"^\s*(?:Draft|Reply|Message)\s*:\s*", "", text, flags=re.IGNORECASE).strip()
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1].strip()
    return text[:4000]


async def draft_ai_reply(conversation_id: str, owner: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        convo = _get_owned_conversation(db, conversation_id, owner)
        account = _get_owned_account(db, convo.account_id, owner)
        title = _conversation_to_dict(convo)["title"]

        latest_outbound_time = (
            db.query(func.max(_message_time_expr()))
            .filter(
                WhatsAppMessage.conversation_id == convo.id,
                WhatsAppMessage.direction == "outbound",
                WhatsAppMessage.status != "draft",
            )
            .scalar()
        )

        inbound_query = db.query(WhatsAppMessage).filter(
            WhatsAppMessage.conversation_id == convo.id,
            WhatsAppMessage.direction == "inbound",
            WhatsAppMessage.deleted_at.is_(None),
            WhatsAppMessage.body.isnot(None),
            WhatsAppMessage.body != "",
        )
        if latest_outbound_time:
            pending_inbound = (
                inbound_query
                .filter(_message_time_expr() > latest_outbound_time)
                .order_by(*_message_order())
                .limit(8)
                .all()
            )
        else:
            pending_inbound = []
        if not pending_inbound:
            pending_inbound = (
                inbound_query
                .order_by(*_message_order(descending=True))
                .limit(5)
                .all()
            )
            pending_inbound = list(reversed(pending_inbound))

        recent_thread = (
            db.query(WhatsAppMessage)
            .filter(
                WhatsAppMessage.conversation_id == convo.id,
                WhatsAppMessage.deleted_at.is_(None),
                WhatsAppMessage.body.isnot(None),
                WhatsAppMessage.body != "",
            )
            .order_by(*_message_order(descending=True))
            .limit(24)
            .all()
        )
        recent_thread = list(reversed(recent_thread))

        style_samples = (
            db.query(WhatsAppMessage)
            .filter(
                WhatsAppMessage.account_id == account.id,
                WhatsAppMessage.direction == "outbound",
                WhatsAppMessage.status != "draft",
                WhatsAppMessage.deleted_at.is_(None),
                WhatsAppMessage.body.isnot(None),
                WhatsAppMessage.body != "",
            )
            .order_by(*_message_order(descending=True))
            .limit(20)
            .all()
        )
        style_samples = list(reversed(style_samples))
    finally:
        db.close()

    if not pending_inbound:
        raise HTTPException(409, "No incoming WhatsApp message is available to draft a reply to")

    from src import endpoint_resolver
    from src import llm_core

    url, model, headers = endpoint_resolver.resolve_endpoint("utility", owner=owner)
    if not url or not model:
        url, model, headers = endpoint_resolver.resolve_endpoint("default", owner=owner)
    if not url or not model:
        raise HTTPException(503, "No LLM endpoint configured - set a Utility or Default Chat model in Settings -> AI Defaults.")

    style_text = "\n".join(_format_whatsapp_message_for_prompt(m) for m in style_samples[-15:])
    if not style_text:
        style_text = "No outgoing samples are available yet. Use a concise, natural WhatsApp tone."
    pending_text = "\n".join(_format_whatsapp_message_for_prompt(m, title=title) for m in pending_inbound)
    thread_text = "\n".join(_format_whatsapp_message_for_prompt(m, title=title) for m in recent_thread)

    messages = [
        {
            "role": "system",
            "content": (
                "You draft WhatsApp replies for the user. Read the user's recent outgoing messages "
                "as style examples, then draft a reply to the latest incoming contact messages. "
                "Match the user's tone, casing, punctuation, brevity, emoji habits, and level of warmth. "
                "Do not invent facts, promises, attachments, calls, or availability. Do not claim the message was sent. "
                "Return only the draft between <<<DRAFT>>> and <<<END>>>."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Conversation: {title}\n"
                f"WhatsApp ID: {convo.wa_id}\n\n"
                "User's recent outgoing WhatsApp messages for writing style:\n"
                f"{style_text}\n\n"
                "Recent conversation context:\n"
                f"{thread_text}\n\n"
                "Latest incoming message(s) to answer:\n"
                f"{pending_text}\n\n"
                "Draft the user's reply now."
            ),
        },
    ]

    raw = await llm_core.llm_call_async(url, model, messages, headers=headers, max_tokens=500, temperature=0.4)
    draft = _clean_ai_draft(raw)
    if not draft:
        raise HTTPException(502, "LLM returned an empty WhatsApp draft")
    return {
        "draft": draft,
        "requires_confirmation": True,
        "style_sample_count": len(style_samples),
        "incoming_message_ids": [m.id for m in pending_inbound],
        "model": model,
    }


def create_conversation(data: WhatsAppConversationCreate, owner: str) -> WhatsAppConversation:
    conversation_type = (data.conversation_type or "direct").strip()
    if conversation_type not in CONVERSATION_TYPES:
        raise HTTPException(400, "Invalid conversation_type")
    wa_id = _normalize_whatsapp_identifier(data.wa_id, conversation_type)
    db = SessionLocal()
    try:
        account = _get_owned_account(db, data.account_id, owner)
        row = (
            db.query(WhatsAppConversation)
            .filter(WhatsAppConversation.account_id == account.id, WhatsAppConversation.wa_id == wa_id)
            .first()
        )
        if row:
            return row
        row = WhatsAppConversation(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=account.id,
            wa_id=wa_id,
            conversation_type=conversation_type,
            profile_name=(data.profile_name or "").strip() or None,
            group_name=(data.group_name or "").strip() or None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def _bridge_conversation_type(wa_id: str) -> str:
    return "group" if (wa_id or "").endswith("@g.us") else "direct"


def _bridge_display_name(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _bridge_set_provider_state(convo: WhatsAppConversation, key: str, value: dict[str, Any]) -> None:
    state = _json_loads(convo.provider_state_json, {})
    if not isinstance(state, dict):
        state = {}
    state[key] = value
    convo.provider_state_json = _json_dumps(state)


def _bridge_contact_jids(contact: dict[str, Any]) -> list[str]:
    jids: list[str] = []
    for key in ("id", "jid", "lid", "wa_id"):
        raw = str(contact.get(key) or "").strip()
        if not raw:
            continue
        if "@" in raw:
            jid = raw
        else:
            digits = re.sub(r"[^\d]", "", raw)
            if len(digits) < 8 or len(digits) > 15:
                continue
            jid = f"{digits}@s.whatsapp.net"
        if jid and jid not in jids:
            jids.append(jid)
    return jids


def _normalize_bridge_chat(db, account: WhatsAppAccount, owner: str, chat: dict[str, Any]) -> bool:
    wa_id = str(chat.get("id") or chat.get("jid") or "").strip()
    if not wa_id or wa_id == "status@broadcast":
        return False
    convo = (
        db.query(WhatsAppConversation)
        .filter(WhatsAppConversation.account_id == account.id, WhatsAppConversation.wa_id == wa_id)
        .first()
    )
    if not convo:
        convo = WhatsAppConversation(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=account.id,
            wa_id=wa_id,
            conversation_type=_bridge_conversation_type(wa_id),
        )
        db.add(convo)
        db.flush()

    name = _bridge_display_name(chat.get("name"), chat.get("subject"), chat.get("notify"))
    if name:
        if convo.conversation_type == "group":
            convo.group_name = name
        else:
            convo.profile_name = name
    if chat.get("unread_count") is not None:
        convo.unread_count = int(chat.get("unread_count") or 0)
    if chat.get("timestamp"):
        convo.last_message_at = _message_datetime(chat.get("timestamp"))
    if chat.get("archived") is not None:
        convo.is_archived = bool(chat.get("archived"))
    if chat.get("pinned") is not None:
        convo.is_pinned = bool(chat.get("pinned"))
    if chat.get("muted") is not None:
        convo.is_muted = bool(chat.get("muted"))
    _bridge_set_provider_state(
        convo,
        "bridge_chat",
        {k: v for k, v in chat.items() if k in {"id", "name", "unread_count", "timestamp", "archived", "pinned", "muted", "source"}},
    )
    return True


def _normalize_bridge_contact(db, account: WhatsAppAccount, contact: dict[str, Any]) -> bool:
    jids = _bridge_contact_jids(contact)
    if not jids:
        return False
    convo = (
        db.query(WhatsAppConversation)
        .filter(WhatsAppConversation.account_id == account.id, WhatsAppConversation.wa_id.in_(jids))
        .first()
    )
    if not convo or convo.conversation_type != "direct":
        return False
    name = _bridge_display_name(contact.get("name"), contact.get("notify"), contact.get("verified_name"), contact.get("verifiedName"))
    if name:
        convo.profile_name = name
    _bridge_set_provider_state(
        convo,
        "bridge_contact",
        {k: v for k, v in contact.items() if k in {"id", "jid", "lid", "name", "notify", "verified_name", "verifiedName", "img_url", "imgUrl"}},
    )
    return True


def process_bridge_event(data: WhatsAppBridgeEvent) -> dict[str, Any]:
    event_owner = data.owner or None
    payload = data.payload or {}
    db = SessionLocal()
    try:
        account = db.get(WhatsAppAccount, data.account_id)
        if not account:
            raise HTTPException(404, "Account not found")
        if event_owner and account.owner != event_owner:
            raise HTTPException(404, "Account not found")
        owner = account.owner
        event = WhatsAppTransportEvent(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=account.id,
            event_type=data.event_type,
            provider_event_id=str(payload.get("provider_message_id") or payload.get("id") or "") or None,
            normalized=False,
            raw_payload=_json_dumps(payload),
            raw_payload_expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(event)

        if data.event_type == "auth.connected":
            account.auth_state = "connected"
            account.setup_state = "connected"
            account.session_path = payload.get("session_path") or account.session_path
            account.chrome_profile_path = payload.get("chrome_profile_path") or account.chrome_profile_path
            user = payload.get("user") or {}
            bridge_user_id = _bridge_user_id(user)
            bridge_phone = _bridge_display_phone(user)
            if bridge_phone:
                account.display_phone_number = bridge_phone
            checks = _json_loads(account.setup_checks_json, {})
            checks.update({"bridge": "passed", "messaging": "passed", "linked_device_socket": "passed"})
            account.setup_checks_json = _json_dumps(checks)
            _merge_diagnostics(
                account,
                {
                    "bridge_heartbeat": datetime.utcnow().isoformat(),
                    "bridge_state": "connected",
                    "last_error": None,
                    "last_event": data.event_type,
                    "reconnect_reason": None,
                    "bridge_user_id": bridge_user_id or None,
                    "bridge_display_phone_number": bridge_phone or None,
                },
            )
            event.normalized = True

        elif data.event_type in {"auth.revoked", "auth.disconnected"}:
            account.auth_state = "reconnect_required" if data.event_type == "auth.revoked" else "disconnected"
            account.setup_state = "setup_incomplete"
            _merge_diagnostics(
                account,
                {
                    "bridge_state": account.auth_state,
                    "reconnect_reason": payload.get("reason") or data.event_type,
                    "last_event": data.event_type,
                },
            )
            event.normalized = True

        elif data.event_type == "message.upsert":
            remote_jid = (payload.get("remote_jid") or "").strip()
            if not remote_jid:
                event.dead_letter = True
                event.error = "Missing remote_jid"
            else:
                provider_id = (payload.get("provider_message_id") or "").strip() or None
                existing = None
                if provider_id:
                    existing = (
                        db.query(WhatsAppMessage)
                        .filter(WhatsAppMessage.account_id == account.id, WhatsAppMessage.provider_message_id == provider_id)
                        .first()
                    )
                conversation_type = "group" if remote_jid.endswith("@g.us") else "direct"
                convo = (
                    db.query(WhatsAppConversation)
                    .filter(WhatsAppConversation.account_id == account.id, WhatsAppConversation.wa_id == remote_jid)
                    .first()
                )
                if not convo:
                    convo = WhatsAppConversation(
                        id=uuid.uuid4().hex,
                        owner=owner,
                        account_id=account.id,
                        wa_id=remote_jid,
                        conversation_type=conversation_type,
                        profile_name=_clean_whatsapp_display_name(payload.get("push_name")) if conversation_type == "direct" else None,
                        group_name=_clean_whatsapp_display_name(payload.get("push_name")) if conversation_type == "group" else None,
                    )
                    db.add(convo)
                    db.flush()
                happened_at = _message_datetime(payload.get("timestamp"))
                has_bridge_timestamp = payload.get("timestamp") not in (None, "")
                direction = "outbound" if payload.get("from_me") else "inbound"
                is_backfill = bool(payload.get("sync_backfill"))
                media_meta = _bridge_media_metadata(payload)
                if not existing:
                    msg = WhatsAppMessage(
                        id=uuid.uuid4().hex,
                        owner=owner,
                        account_id=account.id,
                        conversation_id=convo.id,
                        provider_message_id=provider_id,
                        sender_wa_id=payload.get("participant") or remote_jid,
                        sender_display_name=payload.get("push_name") or "",
                        direction=direction,
                        message_type=payload.get("message_type") or "text",
                        body=payload.get("body") or "",
                        status="sent" if direction == "outbound" else "received",
                        sent_at=happened_at if direction == "outbound" else None,
                        received_at=happened_at if direction == "inbound" else None,
                        raw_payload=_json_dumps(payload.get("raw") or payload),
                        raw_payload_expires_at=datetime.utcnow() + timedelta(days=7),
                    )
                    db.add(msg)
                    db.flush()
                    if direction == "inbound":
                        convo.last_inbound_at = happened_at
                        if not is_backfill:
                            convo.unread_count = int(convo.unread_count or 0) + 1
                            convo.needs_reply = True
                else:
                    msg = existing
                    existing.status = "sent" if direction == "outbound" else existing.status
                    existing.body = existing.body or payload.get("body") or ""
                    existing.raw_payload = _json_dumps(payload.get("raw") or payload)
                    if has_bridge_timestamp:
                        if direction == "outbound":
                            existing.sent_at = happened_at
                        else:
                            existing.received_at = happened_at
                if media_meta:
                    media_provider_id = provider_id or str(payload.get("media_id") or payload.get("provider_media_id") or "").strip() or msg.id
                    media = (
                        db.query(WhatsAppMedia)
                        .filter(WhatsAppMedia.account_id == account.id, WhatsAppMedia.provider_media_id == media_provider_id)
                        .first()
                    )
                    if not media:
                        media = WhatsAppMedia(
                            id=uuid.uuid4().hex,
                            owner=owner,
                            account_id=account.id,
                            message_id=msg.id,
                            provider_media_id=media_provider_id,
                            media_type=media_meta["media_type"],
                            mime_type=media_meta["mime_type"] or None,
                            filename=media_meta["filename"] or None,
                            file_size=media_meta["file_size"] or None,
                            sha256=media_meta["sha256"],
                            download_status="pending",
                            raw_payload=_json_dumps({k: v for k, v in media_meta.items() if k != "local_path"}),
                        )
                        db.add(media)
                        db.flush()
                    else:
                        media.message_id = media.message_id or msg.id
                        media.media_type = media_meta["media_type"] or media.media_type
                        media.mime_type = media_meta["mime_type"] or media.mime_type
                        media.filename = media_meta["filename"] or media.filename
                        media.file_size = media_meta["file_size"] or media.file_size
                        media.sha256 = media_meta["sha256"] or media.sha256
                    msg.media_id = media.id
                    if msg.message_type in {"conversation", "extendedText", "text"}:
                        msg.message_type = media.media_type
                convo.last_message_at = happened_at
                _merge_diagnostics(account, {"last_event": "message.upsert", "last_provider_message_id": provider_id})
                event.normalized = True

        elif data.event_type in {"chats.upsert", "chats.update"}:
            normalized_count = 0
            for chat in payload.get("chats") or []:
                if isinstance(chat, dict) and _normalize_bridge_chat(db, account, owner, chat):
                    normalized_count += 1
            _merge_diagnostics(account, {"last_event": data.event_type, "last_chats_normalized": normalized_count})
            event.normalized = True

        elif data.event_type in {"contacts.upsert", "contacts.update"}:
            normalized_count = 0
            for contact in payload.get("contacts") or []:
                if isinstance(contact, dict) and _normalize_bridge_contact(db, account, contact):
                    normalized_count += 1
            _merge_diagnostics(account, {"last_event": data.event_type, "last_contacts_normalized": normalized_count})
            event.normalized = True

        elif data.event_type == "sync.progress":
            progress = _set_sync_progress(account, _sync_progress_from_result(payload, fallback_status="running"))
            _merge_diagnostics(
                account,
                {
                    "last_event": "sync.progress",
                    "last_error": progress.get("last_error"),
                    "bridge_heartbeat": datetime.utcnow().isoformat(),
                },
            )
            event.normalized = True

        else:
            _merge_diagnostics(account, {"last_event": data.event_type})

        db.commit()
        return {"ok": True, "normalized": bool(event.normalized), "dead_letter": bool(event.dead_letter)}
    finally:
        db.close()


def update_conversation(conversation_id: str, data: WhatsAppConversationUpdate, owner: str) -> WhatsAppConversation:
    db = SessionLocal()
    try:
        row = _get_owned_conversation(db, conversation_id, owner)
        payload = _model_data(data)
        manual_name = _clean_whatsapp_display_name(payload.get("display_name"))
        if manual_name:
            if row.conversation_type == "group":
                row.group_name = manual_name
            else:
                row.profile_name = manual_name
        if "profile_name" in payload:
            row.profile_name = _clean_whatsapp_display_name(payload.get("profile_name")) or None
        if "group_name" in payload:
            row.group_name = _clean_whatsapp_display_name(payload.get("group_name")) or None
        for key in ("is_archived", "is_pinned", "is_muted", "needs_reply", "send_blocked_by_opt_out"):
            if key in payload and payload[key] is not None:
                setattr(row, key, bool(payload[key]))
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def mark_conversation_read(conversation_id: str, read: bool, owner: str) -> WhatsAppConversation:
    db = SessionLocal()
    try:
        row = _get_owned_conversation(db, conversation_id, owner)
        row.unread_count = 0 if read else max(1, int(row.unread_count or 0))
        if read:
            now = datetime.utcnow()
            (
                db.query(WhatsAppMessage)
                .filter(WhatsAppMessage.conversation_id == row.id, WhatsAppMessage.direction == "inbound", WhatsAppMessage.read_at.is_(None))
                .update({WhatsAppMessage.read_at: now}, synchronize_session=False)
            )
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def record_send(conversation_id: str, data: WhatsAppSendRequest, owner: str) -> tuple[WhatsAppMessage, WhatsAppAuditLog, bool]:
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(400, "Message text required")
    db = SessionLocal()
    try:
        convo = _get_owned_conversation(db, conversation_id, owner)
        account = _get_owned_account(db, convo.account_id, owner)
        confirmed = bool(data.confirmed)
        if confirmed and convo.send_blocked_by_opt_out:
            raise HTTPException(409, "Conversation is blocked by opt-out")
        if confirmed and account.setup_state != "connected":
            raise HTTPException(409, "WhatsApp account setup is not connected")

        now = datetime.utcnow()
        msg = WhatsAppMessage(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=account.id,
            conversation_id=convo.id,
            direction="outbound",
            message_type="text",
            body=text,
            status="queued" if confirmed else "draft",
            sent_at=now if confirmed else None,
            quoted_message_id=data.quoted_message_id or None,
        )
        db.add(msg)
        db.flush()

        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=convo.id,
            message_id=msg.id,
            actor=(data.actor or "user").strip() or "user",
            capability=(data.capability or "draft_whatsapp").strip() or "draft_whatsapp",
            action="send_message" if confirmed else "draft_message",
            draft_payload=text,
            final_payload=text if confirmed else None,
            transport=account.transport,
            transport_result={"status": msg.status, "requires_bridge": account.transport != "cloud_api"},
            status="sent" if msg.status == "sent" else "recorded",
        )
        convo.last_message_at = now
        if confirmed and _bridge_is_enabled():
            try:
                result = whatsapp_bridge.send_text(owner, account.id, convo.wa_id, text)
                msg.status = result.get("status") or "sent"
                msg.provider_message_id = result.get("provider_message_id") or msg.provider_message_id
                audit.transport_result = _json_dumps(result)
                audit.status = "sent"
                _merge_diagnostics(
                    account,
                    {
                        "last_event": "message_sent",
                        "last_send_error": None,
                        "bridge_heartbeat": datetime.utcnow().isoformat(),
                    },
                )
            except whatsapp_bridge.WhatsAppBridgeError as exc:
                msg.status = "failed"
                audit.status = "failed"
                audit.failure_details = str(exc)
                audit.transport_result = _json_dumps({"status": "failed", "error": str(exc)})
                _merge_diagnostics(
                    account,
                    {
                        "last_event": "message_send_failed",
                        "last_send_error": str(exc),
                        "bridge_heartbeat": None,
                    },
                )
                db.commit()
                raise HTTPException(502, str(exc)) from exc
        db.commit()
        db.refresh(msg)
        db.refresh(audit)
        return msg, audit, confirmed
    finally:
        db.close()


def react_to_message(message_id: str, data: WhatsAppReactionRequest, owner: str) -> tuple[WhatsAppMessage, WhatsAppAuditLog]:
    emoji = (data.emoji or "").strip()
    if not emoji:
        raise HTTPException(400, "Reaction emoji required")
    db = SessionLocal()
    try:
        msg = _require_owned_row(db.get(WhatsAppMessage, message_id), owner, "Message")
        account = _get_owned_account(db, msg.account_id, owner)
        msg.reaction_emoji = emoji
        msg.reaction_to_message_id = msg.id
        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=msg.conversation_id,
            message_id=msg.id,
            actor=data.actor,
            capability=data.capability,
            action="react_message",
            transport=account.transport,
            final_payload=emoji,
            transport_result={"status": "queued", "requires_bridge": account.transport != "cloud_api"},
        )
        db.commit()
        db.refresh(msg)
        db.refresh(audit)
        return msg, audit
    finally:
        db.close()


def edit_message(message_id: str, data: WhatsAppEditRequest, owner: str) -> tuple[WhatsAppMessage, WhatsAppAuditLog]:
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(400, "Message text required")
    db = SessionLocal()
    try:
        msg = _require_owned_row(db.get(WhatsAppMessage, message_id), owner, "Message")
        account = _get_owned_account(db, msg.account_id, owner)
        if msg.direction != "outbound":
            raise HTTPException(409, "Only outbound messages can be edited")
        old = msg.body or ""
        msg.body = text
        msg.edited_at = datetime.utcnow()
        msg.status = "queued"
        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=msg.conversation_id,
            message_id=msg.id,
            actor=data.actor,
            capability=data.capability,
            action="edit_message",
            transport=account.transport,
            draft_payload=old,
            final_payload=text,
            transport_result={"status": msg.status, "requires_bridge": account.transport != "cloud_api"},
        )
        db.commit()
        db.refresh(msg)
        db.refresh(audit)
        return msg, audit
    finally:
        db.close()


def delete_message(message_id: str, owner: str, actor: str = "user") -> tuple[WhatsAppMessage, WhatsAppAuditLog]:
    db = SessionLocal()
    try:
        msg = _require_owned_row(db.get(WhatsAppMessage, message_id), owner, "Message")
        account = _get_owned_account(db, msg.account_id, owner)
        msg.deleted_at = datetime.utcnow()
        msg.status = "queued_delete"
        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=msg.conversation_id,
            message_id=msg.id,
            actor=actor,
            capability="manage_whatsapp",
            action="delete_message",
            transport=account.transport,
            final_payload=msg.body,
            transport_result={"status": msg.status, "requires_bridge": account.transport != "cloud_api"},
        )
        db.commit()
        db.refresh(msg)
        db.refresh(audit)
        return msg, audit
    finally:
        db.close()


def create_message_reminder(message_id: str, data: WhatsAppReminderRequest, owner: str) -> WhatsAppAuditLog:
    db = SessionLocal()
    try:
        msg = _require_owned_row(db.get(WhatsAppMessage, message_id), owner, "Message")
        account = _get_owned_account(db, msg.account_id, owner)
        title = (data.title or "").strip() or "WhatsApp follow-up"
        payload = _json_dumps({"title": title, "due_at": data.due_at, "message_id": msg.id, "body": msg.body or ""})
        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=msg.conversation_id,
            message_id=msg.id,
            actor=data.actor,
            capability=data.capability,
            action="create_reminder",
            transport=account.transport,
            final_payload=payload,
            status="recorded",
        )
        db.commit()
        db.refresh(audit)
        return audit
    finally:
        db.close()


def start_call(conversation_id: str, data: WhatsAppCallRequest, owner: str) -> tuple[WhatsAppCallEvent, WhatsAppAuditLog]:
    call_type = (data.call_type or "voice").strip()
    if call_type not in {"voice", "video", "group_voice", "group_video"}:
        raise HTTPException(400, "Invalid call_type")
    db = SessionLocal()
    try:
        convo = _get_owned_conversation(db, conversation_id, owner)
        account = _get_owned_account(db, convo.account_id, owner)
        if account.setup_state != "connected":
            raise HTTPException(409, "WhatsApp account setup is not connected")
        now = datetime.utcnow()
        has_bridge = bool(_json_loads(account.diagnostics_json, {}).get("bridge_heartbeat"))
        row = WhatsAppCallEvent(
            id=uuid.uuid4().hex,
            owner=owner,
            account_id=account.id,
            conversation_id=convo.id,
            call_type=call_type,
            direction="outgoing",
            state="launch_requested" if has_bridge else "blocked_needs_bridge",
            started_at=now,
            handled_by=account.transport,
            details_json=_json_dumps({"requires_bridge": not has_bridge, "conversation_title": _conversation_to_dict(convo)["title"]}),
        )
        db.add(row)
        db.flush()
        audit = _write_audit(
            db,
            owner=owner,
            account_id=account.id,
            conversation_id=convo.id,
            message_id=None,
            actor=data.actor,
            capability=data.capability,
            action="start_call",
            transport=account.transport,
            final_payload=call_type,
            transport_result={"state": row.state, "requires_bridge": not has_bridge},
            status="blocked" if not has_bridge else "recorded",
            failure_details="Host WhatsApp bridge is not reporting a heartbeat" if not has_bridge else None,
        )
        db.commit()
        db.refresh(row)
        db.refresh(audit)
        return row, audit
    finally:
        db.close()


def update_call_state(call_id: str, owner: str, state: str) -> WhatsAppCallEvent:
    db = SessionLocal()
    try:
        row = _require_owned_row(db.get(WhatsAppCallEvent, call_id), owner, "Call")
        row.state = state
        if state in {"dismissed", "ended"}:
            row.ended_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()
