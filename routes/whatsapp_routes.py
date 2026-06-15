"""FastAPI routes for the normalized WhatsApp integration surface."""

import json
import os
import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, or_

from core.constants import BASE_DIR
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
from src.auth_helpers import require_user
from src import whatsapp_bridge

from routes.whatsapp_helpers import (
    WhatsAppAccountCreate,
    WhatsAppAccountUpdate,
    WhatsAppBridgeEvent,
    WhatsAppCallRequest,
    WhatsAppConversationCreate,
    WhatsAppConversationUpdate,
    WhatsAppEditRequest,
    WhatsAppReactionRequest,
    WhatsAppReminderRequest,
    WhatsAppRiskDisclosure,
    WhatsAppSendRequest,
    WhatsAppSetupChecks,
    WhatsAppSyncRequest,
    _account_to_dict,
    _audit_to_dict,
    _call_to_dict,
    _conversation_to_dict,
    _get_owned_account,
    _get_owned_conversation,
    _sync_bridge_status,
    ensure_message_media_from_raw,
    _media_to_dict,
    _message_to_dict,
    _transport_event_to_dict,
    accept_risk_disclosure,
    create_account,
    create_conversation,
    create_message_reminder,
    delete_account,
    delete_message,
    disconnect_account,
    draft_ai_reply,
    edit_message,
    mark_conversation_read,
    get_qr_connection_state,
    process_bridge_event,
    react_to_message,
    record_send,
    request_qr_connection,
    run_live_setup_checks,
    set_default_account,
    get_sync_chats_status,
    start_sync_chats,
    start_call,
    update_account,
    update_call_state,
    update_conversation,
    update_setup_checks,
)


def _media_label(media: dict | None) -> str:
    if not media:
        return ""
    labels = {
        "image": "Photo",
        "video": "Video",
        "audio": "Audio",
        "voice": "Voice note",
        "document": "Document",
        "sticker": "Sticker",
    }
    return labels.get(str(media.get("media_type") or "").lower(), "Attachment")


def _safe_media_path(row: WhatsAppMedia) -> Path:
    raw = (row.local_path or "").strip()
    if not raw:
        raise HTTPException(404, "Media file is not downloaded")
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = Path(BASE_DIR) / candidate
    candidate = candidate.resolve()
    data_root = Path(os.getenv("ODYSSEUS_WHATSAPP_DATA_ROOT") or (Path(BASE_DIR) / "data" / "whatsapp")).resolve()
    upload_root = (Path(BASE_DIR) / "data" / "uploads").resolve()
    allowed_roots = (data_root, upload_root)
    inside_allowed = False
    for root in allowed_roots:
        try:
            if os.path.commonpath([str(candidate), str(root)]) == str(root):
                inside_allowed = True
                break
        except ValueError:
            continue
    if not inside_allowed:
        raise HTTPException(403, "Access denied")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(404, "Media file not found")
    return candidate


def _media_raw_message(db, row: WhatsAppMedia) -> dict | None:
    if not row.message_id:
        return None
    msg = db.get(WhatsAppMessage, row.message_id)
    if not msg or msg.account_id != row.account_id or msg.owner != row.owner or not msg.raw_payload:
        return None
    try:
        raw = json.loads(msg.raw_payload)
    except (TypeError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def _message_time_expr():
    return func.coalesce(WhatsAppMessage.sent_at, WhatsAppMessage.received_at, WhatsAppMessage.created_at)


def _message_order(*, descending: bool = False):
    message_time = _message_time_expr()
    direction = message_time.desc() if descending else message_time.asc()
    created = WhatsAppMessage.created_at.desc() if descending else WhatsAppMessage.created_at.asc()
    return direction, created, WhatsAppMessage.id.asc()


def _latest_messages_for_conversations(db, conversation_ids: list[str]) -> dict[str, WhatsAppMessage]:
    if not conversation_ids:
        return {}
    ranked = (
        db.query(
            WhatsAppMessage.id.label("message_id"),
            WhatsAppMessage.conversation_id.label("conversation_id"),
            func.row_number()
            .over(
                partition_by=WhatsAppMessage.conversation_id,
                order_by=_message_order(descending=True),
            )
            .label("rn"),
        )
        .filter(WhatsAppMessage.conversation_id.in_(conversation_ids))
        .subquery()
    )
    rows = (
        db.query(WhatsAppMessage)
        .join(ranked, WhatsAppMessage.id == ranked.c.message_id)
        .filter(ranked.c.rn == 1)
        .all()
    )
    return {row.conversation_id: row for row in rows}


def setup_whatsapp_routes() -> APIRouter:
    router = APIRouter(tags=["whatsapp"])

    @router.get("/api/whatsapp/accounts")
    async def list_accounts(owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            q = db.query(WhatsAppAccount)
            if owner:
                q = q.filter(WhatsAppAccount.owner == owner)
            rows = q.order_by(WhatsAppAccount.is_default.desc(), WhatsAppAccount.created_at.asc()).all()
            for row in rows:
                try:
                    _sync_bridge_status(db, row)
                except HTTPException:
                    pass
            return {"accounts": [_account_to_dict(r) for r in rows]}
        finally:
            db.close()

    @router.post("/api/whatsapp/accounts")
    async def create_account_route(data: WhatsAppAccountCreate, owner: str = Depends(require_user)):
        row = create_account(data, owner)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.patch("/api/whatsapp/accounts/{account_id}")
    async def update_account_route(account_id: str, data: WhatsAppAccountUpdate, owner: str = Depends(require_user)):
        row = update_account(account_id, data, owner)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.post("/api/whatsapp/accounts/{account_id}/set-default")
    async def set_default_route(account_id: str, owner: str = Depends(require_user)):
        row = set_default_account(account_id, owner)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.delete("/api/whatsapp/accounts/{account_id}")
    async def delete_account_route(account_id: str, owner: str = Depends(require_user)):
        delete_account(account_id, owner, delete_all_data=True)
        return {"ok": True}

    @router.post("/api/whatsapp/accounts/{account_id}/risk-disclosure")
    async def risk_disclosure(account_id: str, data: WhatsAppRiskDisclosure, owner: str = Depends(require_user)):
        row = accept_risk_disclosure(account_id, data.accepted, owner)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.post("/api/whatsapp/accounts/{account_id}/connect-qr")
    async def connect_qr(account_id: str, owner: str = Depends(require_user)):
        row = request_qr_connection(account_id, owner)
        data = _account_to_dict(row)
        return {
            "ok": True,
            "account": data,
            "qr_pending": True,
            "bridge_enabled": whatsapp_bridge.bridge_enabled(),
            "state": data["diagnostics"].get("bridge_state") or row.auth_state,
            "qr": None,
            "qr_expires_at": data["diagnostics"].get("qr_expires_at"),
            "connected": row.auth_state == "connected",
            "last_error": data["diagnostics"].get("last_error"),
        }

    @router.get("/api/whatsapp/accounts/{account_id}/qr")
    async def qr_state(account_id: str, owner: str = Depends(require_user)):
        return {"ok": True, **get_qr_connection_state(account_id, owner)}

    @router.post("/api/whatsapp/accounts/{account_id}/setup-checks")
    async def setup_checks(account_id: str, data: WhatsAppSetupChecks, owner: str = Depends(require_user)):
        row = update_setup_checks(account_id, data, owner)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.post("/api/whatsapp/accounts/{account_id}/run-setup-checks")
    async def run_setup_checks(account_id: str, owner: str = Depends(require_user)):
        row, blocked, reason = run_live_setup_checks(account_id, owner)
        return {
            "ok": True,
            "account": _account_to_dict(row),
            "blocked": blocked,
            "reason": reason,
        }

    @router.post("/api/whatsapp/accounts/{account_id}/disconnect")
    async def disconnect_route(account_id: str, owner: str = Depends(require_user)):
        row = disconnect_account(account_id, owner, delete_local_session=False)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.post("/api/whatsapp/accounts/{account_id}/disconnect-and-delete")
    async def disconnect_and_delete_route(account_id: str, owner: str = Depends(require_user)):
        row = disconnect_account(account_id, owner, delete_local_session=True)
        return {"ok": True, "account": _account_to_dict(row)}

    @router.post("/api/whatsapp/accounts/{account_id}/delete-cache")
    async def delete_cache_route(account_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            account = _get_owned_account(db, account_id, owner)
            rows = db.query(WhatsAppMedia).filter(WhatsAppMedia.account_id == account.id).all()
            for media in rows:
                media.local_path = None
                media.download_status = "pending"
                media.saved = False
                media.keep_forever = False
            db.commit()
            return {"ok": True, "cleared": len(rows)}
        finally:
            db.close()

    @router.post("/api/whatsapp/accounts/{account_id}/export")
    async def export_account_route(account_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            account = _get_owned_account(db, account_id, owner)
            conversations = db.query(WhatsAppConversation).filter(WhatsAppConversation.account_id == account.id).all()
            messages = db.query(WhatsAppMessage).filter(WhatsAppMessage.account_id == account.id).all()
            media = db.query(WhatsAppMedia).filter(WhatsAppMedia.account_id == account.id).all()
            calls = db.query(WhatsAppCallEvent).filter(WhatsAppCallEvent.account_id == account.id).all()
            return {
                "ok": True,
                "export": {
                    "account": _account_to_dict(account),
                    "conversations": [_conversation_to_dict(r) for r in conversations],
                    "messages": [_message_to_dict(r) for r in messages],
                    "media": [_media_to_dict(r) for r in media],
                    "calls": [_call_to_dict(r) for r in calls],
                },
            }
        finally:
            db.close()

    @router.get("/api/whatsapp/diagnostics")
    async def diagnostics(account_id: str | None = Query(None), owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            q = db.query(WhatsAppAccount)
            if owner:
                q = q.filter(WhatsAppAccount.owner == owner)
            if account_id:
                account = _get_owned_account(db, account_id, owner)
            else:
                account = q.order_by(WhatsAppAccount.is_default.desc(), WhatsAppAccount.created_at.asc()).first()
            if not account:
                return {"ok": True, "configured": False, "diagnostics": {}}
            data = _account_to_dict(account)
            return {
                "ok": True,
                "configured": True,
                "account_id": account.id,
                "auth_state": account.auth_state,
                "setup_state": account.setup_state,
                "setup_checks": data["setup_checks"],
                "diagnostics": data["diagnostics"],
            }
        finally:
            db.close()

    @router.get("/api/whatsapp/accounts/{account_id}/diagnostics")
    async def account_diagnostics(account_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            account = _get_owned_account(db, account_id, owner)
            data = _account_to_dict(account)
            dead_letters = (
                db.query(WhatsAppTransportEvent)
                .filter(WhatsAppTransportEvent.account_id == account.id, WhatsAppTransportEvent.dead_letter == True)  # noqa: E712
                .count()
            )
            audits = (
                db.query(WhatsAppAuditLog)
                .filter(WhatsAppAuditLog.account_id == account.id)
                .order_by(WhatsAppAuditLog.created_at.desc())
                .limit(10)
                .all()
            )
            return {
                "ok": True,
                "account_id": account.id,
                "auth_state": account.auth_state,
                "setup_state": account.setup_state,
                "setup_checks": data["setup_checks"],
                "diagnostics": data["diagnostics"],
                "dead_letters": dead_letters,
                "recent_audits": [_audit_to_dict(a) for a in audits],
            }
        finally:
            db.close()

    @router.post("/api/whatsapp/accounts/{account_id}/sync")
    async def start_sync_route(account_id: str, data: WhatsAppSyncRequest | None = None, owner: str = Depends(require_user)):
        row, progress = start_sync_chats(account_id, data or WhatsAppSyncRequest(), owner)
        return {"ok": True, "account": _account_to_dict(row), "sync": progress}

    @router.get("/api/whatsapp/accounts/{account_id}/sync")
    async def sync_status_route(account_id: str, owner: str = Depends(require_user)):
        row, progress = get_sync_chats_status(account_id, owner)
        return {"ok": True, "account": _account_to_dict(row), "sync": progress}

    @router.get("/api/whatsapp/conversations")
    async def list_conversations(
        account_id: str | None = Query(None),
        q: str | None = Query(None),
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
        owner: str = Depends(require_user),
    ):
        db = SessionLocal()
        try:
            query = db.query(WhatsAppConversation)
            if owner:
                query = query.filter(WhatsAppConversation.owner == owner)
            if account_id:
                _get_owned_account(db, account_id, owner)
                query = query.filter(WhatsAppConversation.account_id == account_id)
            term = (q or "").strip().lower()
            if term:
                like = f"%{term}%"
                query = query.filter(
                    or_(
                        WhatsAppConversation.wa_id.ilike(like),
                        WhatsAppConversation.profile_name.ilike(like),
                        WhatsAppConversation.group_name.ilike(like),
                    )
                )
            total = query.count()
            rows = (
                query.order_by(WhatsAppConversation.last_message_at.desc(), WhatsAppConversation.created_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            conversation_ids = [r.id for r in rows]
            latest_by_conversation = _latest_messages_for_conversations(db, conversation_ids)
            media_ids = [msg.media_id for msg in latest_by_conversation.values() if msg.media_id]
            media_by_id = {}
            if media_ids:
                media_by_id = {
                    media.id: media
                    for media in db.query(WhatsAppMedia).filter(WhatsAppMedia.id.in_(media_ids)).all()
                }
            items = []
            for r in rows:
                item = _conversation_to_dict(r)
                last = latest_by_conversation.get(r.id)
                last_media = media_by_id.get(last.media_id) if last and last.media_id else None
                item["last_message"] = _message_to_dict(last, last_media) if last else None
                if last and last.body:
                    item["last_message_preview"] = (last.body or "")[:180]
                else:
                    item["last_message_preview"] = _media_label(_media_to_dict(last_media) if last_media else None)
                item["last_message_status"] = last.status if last else ""
                items.append(item)
            return {
                "conversations": items,
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total,
                    "has_more": offset + len(items) < total,
                },
            }
        finally:
            db.close()

    @router.post("/api/whatsapp/conversations")
    async def create_conversation_route(data: WhatsAppConversationCreate, owner: str = Depends(require_user)):
        row = create_conversation(data, owner)
        return {"ok": True, "conversation": _conversation_to_dict(row)}

    @router.patch("/api/whatsapp/conversations/{conversation_id}")
    async def update_conversation_route(conversation_id: str, data: WhatsAppConversationUpdate, owner: str = Depends(require_user)):
        row = update_conversation(conversation_id, data, owner)
        return {"ok": True, "conversation": _conversation_to_dict(row)}

    @router.get("/api/whatsapp/conversations/{conversation_id}/messages")
    async def list_messages(
        conversation_id: str,
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        owner: str = Depends(require_user),
    ):
        db = SessionLocal()
        try:
            convo = _get_owned_conversation(db, conversation_id, owner)
            query = db.query(WhatsAppMessage).filter(WhatsAppMessage.conversation_id == convo.id)
            total = query.count()
            rows = (
                query
                .order_by(*_message_order())
                .offset(offset)
                .limit(limit)
                .all()
            )
            media_by_id = {}
            repaired_media = False
            for row in rows:
                if not row.media_id:
                    media = ensure_message_media_from_raw(db, row)
                    if media:
                        media_by_id[media.id] = media
                        repaired_media = True
            media_ids = [r.media_id for r in rows if r.media_id]
            if media_ids:
                media_query = db.query(WhatsAppMedia).filter(WhatsAppMedia.id.in_(media_ids))
                if owner:
                    media_query = media_query.filter(WhatsAppMedia.owner == owner)
                media_by_id = {
                    r.id: r
                    for r in media_query.all()
                }
            if repaired_media:
                db.commit()
            return {
                "conversation": _conversation_to_dict(convo),
                "messages": [_message_to_dict(r, media_by_id.get(r.media_id)) for r in rows],
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total,
                    "has_more": offset + len(rows) < total,
                },
            }
        finally:
            db.close()

    @router.post("/api/whatsapp/conversations/{conversation_id}/archive")
    async def archive_conversation(conversation_id: str, owner: str = Depends(require_user)):
        row = update_conversation(conversation_id, WhatsAppConversationUpdate(is_archived=True), owner)
        return {"ok": True, "conversation": _conversation_to_dict(row)}

    @router.post("/api/whatsapp/conversations/{conversation_id}/mark-read")
    async def mark_read_conversation(conversation_id: str, owner: str = Depends(require_user)):
        row = mark_conversation_read(conversation_id, True, owner)
        return {"ok": True, "conversation": _conversation_to_dict(row)}

    @router.post("/api/whatsapp/conversations/{conversation_id}/mark-unread")
    async def mark_unread_conversation(conversation_id: str, owner: str = Depends(require_user)):
        row = mark_conversation_read(conversation_id, False, owner)
        return {"ok": True, "conversation": _conversation_to_dict(row)}

    @router.post("/api/whatsapp/conversations/{conversation_id}/send")
    async def send_message(conversation_id: str, data: WhatsAppSendRequest, owner: str = Depends(require_user)):
        msg, audit, confirmed = record_send(conversation_id, data, owner)
        return {
            "ok": True,
            "requires_confirmation": not confirmed,
            "message": _message_to_dict(msg),
            "audit_id": audit.id,
        }

    @router.post("/api/whatsapp/conversations/{conversation_id}/ai-reply")
    async def ai_reply(conversation_id: str, owner: str = Depends(require_user)):
        result = await draft_ai_reply(conversation_id, owner)
        return {"ok": True, **result}

    @router.post("/api/whatsapp/conversations/{conversation_id}/summarize")
    async def summarize_conversation(conversation_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            convo = _get_owned_conversation(db, conversation_id, owner)
            rows = (
                db.query(WhatsAppMessage)
                .filter(WhatsAppMessage.conversation_id == convo.id)
                .order_by(*_message_order())
                .limit(100)
                .all()
            )
            inbound = sum(1 for r in rows if r.direction == "inbound")
            outbound = sum(1 for r in rows if r.direction == "outbound")
            last = rows[-1].body if rows and rows[-1].body else ""
            title = _conversation_to_dict(convo)["title"]
            summary = f"{title}: {len(rows)} messages ({inbound} inbound, {outbound} outbound)."
            if last:
                summary += f" Latest: {last[:180]}"
            return {"ok": True, "summary": summary}
        finally:
            db.close()

    @router.post("/api/whatsapp/conversations/{conversation_id}/start-call")
    async def start_call_route(conversation_id: str, data: WhatsAppCallRequest, owner: str = Depends(require_user)):
        call, audit = start_call(conversation_id, data, owner)
        return {"ok": True, "call": _call_to_dict(call), "audit_id": audit.id}

    @router.post("/api/whatsapp/messages/{message_id}/mark-read")
    async def mark_message_read(message_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            msg = db.get(WhatsAppMessage, message_id)
            if not msg or (owner and msg.owner != owner):
                return {"ok": False, "error": "Message not found"}
            from datetime import datetime
            msg.read_at = datetime.utcnow()
            db.commit()
            db.refresh(msg)
            return {"ok": True, "message": _message_to_dict(msg)}
        finally:
            db.close()

    @router.post("/api/whatsapp/messages/{message_id}/react")
    async def react_message_route(message_id: str, data: WhatsAppReactionRequest, owner: str = Depends(require_user)):
        msg, audit = react_to_message(message_id, data, owner)
        return {"ok": True, "message": _message_to_dict(msg), "audit_id": audit.id}

    @router.post("/api/whatsapp/messages/{message_id}/edit")
    async def edit_message_route(message_id: str, data: WhatsAppEditRequest, owner: str = Depends(require_user)):
        msg, audit = edit_message(message_id, data, owner)
        return {"ok": True, "message": _message_to_dict(msg), "audit_id": audit.id}

    @router.post("/api/whatsapp/messages/{message_id}/delete")
    async def delete_message_route(message_id: str, owner: str = Depends(require_user)):
        msg, audit = delete_message(message_id, owner)
        return {"ok": True, "message": _message_to_dict(msg), "audit_id": audit.id}

    @router.post("/api/whatsapp/messages/{message_id}/reply")
    async def reply_to_message(message_id: str, data: WhatsAppSendRequest, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            source = db.get(WhatsAppMessage, message_id)
            if not source or (owner and source.owner != owner):
                return {"ok": False, "error": "Message not found"}
            conversation_id = source.conversation_id
        finally:
            db.close()
        data.quoted_message_id = message_id
        msg, audit, confirmed = record_send(conversation_id, data, owner)
        return {"ok": True, "requires_confirmation": not confirmed, "message": _message_to_dict(msg), "audit_id": audit.id}

    @router.post("/api/whatsapp/messages/{message_id}/create-reminder")
    async def create_reminder_route(message_id: str, data: WhatsAppReminderRequest, owner: str = Depends(require_user)):
        audit = create_message_reminder(message_id, data, owner)
        return {"ok": True, "audit": _audit_to_dict(audit)}

    @router.get("/api/whatsapp/media")
    async def list_media(account_id: str | None = Query(None), conversation_id: str | None = Query(None), owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            q = db.query(WhatsAppMedia)
            if owner:
                q = q.filter(WhatsAppMedia.owner == owner)
            if account_id:
                _get_owned_account(db, account_id, owner)
                q = q.filter(WhatsAppMedia.account_id == account_id)
            if conversation_id:
                convo = _get_owned_conversation(db, conversation_id, owner)
                msg_ids = [r.id for r in db.query(WhatsAppMessage.id).filter(WhatsAppMessage.conversation_id == convo.id).all()]
                q = q.filter(WhatsAppMedia.message_id.in_(msg_ids or [""]))
            rows = q.order_by(WhatsAppMedia.created_at.desc()).limit(200).all()
            return {"media": [_media_to_dict(r) for r in rows]}
        finally:
            db.close()

    @router.post("/api/whatsapp/media/{media_id}/download")
    async def download_media(media_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            row = db.get(WhatsAppMedia, media_id)
            if not row or (owner and row.owner != owner):
                return {"ok": False, "error": "Media not found"}
            row.download_status = "downloading" if whatsapp_bridge.bridge_enabled() and row.provider_media_id else "queued"
            db.commit()
            if whatsapp_bridge.bridge_enabled() and row.provider_media_id:
                try:
                    result = whatsapp_bridge.download_media(
                        owner,
                        row.account_id,
                        row.provider_media_id,
                        raw_message=_media_raw_message(db, row),
                    )
                    row.local_path = result.get("local_path") or row.local_path
                    row.mime_type = result.get("mime_type") or row.mime_type
                    row.filename = result.get("filename") or row.filename
                    row.file_size = int(result.get("file_size") or row.file_size or 0) or row.file_size
                    row.download_status = result.get("download_status") or "downloaded"
                except whatsapp_bridge.WhatsAppBridgeError as exc:
                    detail = str(exc)
                    if "not connected" in detail.lower() or "not available in the live bridge cache" in detail.lower():
                        row.download_status = "queued"
                        db.commit()
                        db.refresh(row)
                        return {"ok": True, "media": _media_to_dict(row), "requires_bridge": True, "warning": detail}
                    row.download_status = "failed"
                    db.commit()
                    raise HTTPException(502, detail) from exc
            else:
                row.download_status = "queued"
            db.commit()
            db.refresh(row)
            return {"ok": True, "media": _media_to_dict(row), "requires_bridge": not bool(row.local_path)}
        finally:
            db.close()

    @router.get("/api/whatsapp/media/{media_id}/file")
    async def media_file(request: Request, media_id: str, thumb: int = 0, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            row = db.get(WhatsAppMedia, media_id)
            if not row or (owner and row.owner != owner):
                raise HTTPException(404, "Media not found")
            path = _safe_media_path(row)
            mime = row.mime_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            if thumb and mime.startswith("image/"):
                try:
                    from PIL import Image, ImageOps

                    thumb_dir = path.parent / ".thumbs"
                    thumb_dir.mkdir(parents=True, exist_ok=True)
                    thumb_path = thumb_dir / f"{row.id}.jpg"
                    if not thumb_path.exists() or thumb_path.stat().st_mtime < path.stat().st_mtime:
                        im = Image.open(path)
                        im = ImageOps.exif_transpose(im)
                        im.thumbnail((420, 420))
                        if im.mode not in ("RGB", "L"):
                            im = im.convert("RGB")
                        im.save(thumb_path, "JPEG", quality=82)
                    return FileResponse(str(thumb_path), media_type="image/jpeg")
                except Exception:
                    pass
            return FileResponse(str(path), media_type=mime, filename=row.filename or path.name)
        finally:
            db.close()

    @router.post("/api/whatsapp/media/{media_id}/transcribe")
    async def transcribe_media(media_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            row = db.get(WhatsAppMedia, media_id)
            if not row or (owner and row.owner != owner):
                return {"ok": False, "error": "Media not found"}
            row.transcript = row.transcript or ""
            db.commit()
            db.refresh(row)
            return {"ok": True, "media": _media_to_dict(row), "requires_audio_worker": True}
        finally:
            db.close()

    @router.post("/api/whatsapp/media/{media_id}/save")
    async def save_media(media_id: str, owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            row = db.get(WhatsAppMedia, media_id)
            if not row or (owner and row.owner != owner):
                return {"ok": False, "error": "Media not found"}
            row.saved = True
            row.keep_forever = True
            db.commit()
            db.refresh(row)
            return {"ok": True, "media": _media_to_dict(row)}
        finally:
            db.close()

    @router.get("/api/whatsapp/calls")
    async def list_calls(account_id: str | None = Query(None), conversation_id: str | None = Query(None), owner: str = Depends(require_user)):
        db = SessionLocal()
        try:
            q = db.query(WhatsAppCallEvent)
            if owner:
                q = q.filter(WhatsAppCallEvent.owner == owner)
            if account_id:
                _get_owned_account(db, account_id, owner)
                q = q.filter(WhatsAppCallEvent.account_id == account_id)
            if conversation_id:
                convo = _get_owned_conversation(db, conversation_id, owner)
                q = q.filter(WhatsAppCallEvent.conversation_id == convo.id)
            rows = q.order_by(WhatsAppCallEvent.created_at.desc()).limit(100).all()
            return {"calls": [_call_to_dict(r) for r in rows]}
        finally:
            db.close()

    @router.post("/api/whatsapp/calls/{call_id}/open")
    async def open_call(call_id: str, owner: str = Depends(require_user)):
        row = update_call_state(call_id, owner, "open_requested")
        return {"ok": True, "call": _call_to_dict(row), "requires_bridge": True}

    @router.post("/api/whatsapp/calls/{call_id}/dismiss")
    async def dismiss_call(call_id: str, owner: str = Depends(require_user)):
        row = update_call_state(call_id, owner, "dismissed")
        return {"ok": True, "call": _call_to_dict(row)}

    @router.post("/api/whatsapp/ringtone/test")
    async def ringtone_test():
        return {"ok": True, "played": False, "reason": "Browser UI should play the selected built-in ringtone locally."}

    @router.get("/api/whatsapp/webhook")
    async def webhook_verify():
        return {"ok": True, "mode": "personal-linked-device-primary", "cloud_api": "not_configured"}

    @router.post("/api/whatsapp/webhook")
    async def webhook_receive(payload: dict):
        return {"ok": True, "received": bool(payload), "normalized": False}

    @router.post("/api/whatsapp/bridge/events")
    async def bridge_event(data: WhatsAppBridgeEvent, x_odysseus_bridge_token: str | None = Header(None)):
        expected = os.getenv("ODYSSEUS_WHATSAPP_BRIDGE_TOKEN", "")
        if expected and x_odysseus_bridge_token != expected:
            raise HTTPException(401, "Invalid WhatsApp bridge token")
        return process_bridge_event(data)

    return router
