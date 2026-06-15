"""HTTP client for the local WhatsApp linked-device bridge."""

from __future__ import annotations

import os
from typing import Any

import httpx


class WhatsAppBridgeError(RuntimeError):
    """Raised when the real WhatsApp bridge cannot complete an action."""


def bridge_enabled() -> bool:
    value = os.getenv("ODYSSEUS_WHATSAPP_BRIDGE_ENABLED", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def bridge_url() -> str:
    return os.getenv("ODYSSEUS_WHATSAPP_BRIDGE_URL", "http://127.0.0.1:8788").rstrip("/")


def _headers() -> dict[str, str]:
    token = os.getenv("ODYSSEUS_WHATSAPP_BRIDGE_TOKEN", "")
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}", "X-Odysseus-Bridge-Token": token}


def _safe_part(value: str | None) -> str:
    raw = value or "default"
    return "".join(ch if ch.isalnum() or ch in "_.-" else "_" for ch in raw)[:96] or "default"


def _path(owner: str | None, account_id: str, suffix: str) -> str:
    return f"{bridge_url()}/sessions/{_safe_part(owner)}/{_safe_part(account_id)}/{suffix}"


def _request(method: str, url: str, *, json: dict[str, Any] | None = None, timeout: float = 10.0) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.request(method, url, headers=_headers(), json=json)
    except httpx.HTTPError as exc:
        raise WhatsAppBridgeError(f"WhatsApp bridge is unreachable: {exc}") from exc

    data = response.json() if response.content else {}
    if response.status_code >= 400 or data.get("ok") is False:
        detail = data.get("error") or data.get("detail") or response.text or f"HTTP {response.status_code}"
        raise WhatsAppBridgeError(str(detail))
    return data


def health() -> dict[str, Any]:
    return _request("GET", f"{bridge_url()}/health", timeout=3.0)


def start_session(owner: str | None, account_id: str) -> dict[str, Any]:
    data = _request("POST", _path(owner, account_id, "start"), timeout=30.0)
    return data.get("session") or {}


def session_status(owner: str | None, account_id: str) -> dict[str, Any]:
    data = _request("GET", _path(owner, account_id, "status"), timeout=5.0)
    return data.get("session") or {}


def stop_session(owner: str | None, account_id: str, *, remove_files: bool = False) -> dict[str, Any]:
    return _request("POST", _path(owner, account_id, "stop"), json={"remove_files": bool(remove_files)}, timeout=10.0)


def send_text(owner: str | None, account_id: str, to: str, text: str) -> dict[str, Any]:
    return _request(
        "POST",
        _path(owner, account_id, "send"),
        json={"to": to, "text": text},
        timeout=30.0,
    )


def sync_chats(
    owner: str | None,
    account_id: str,
    *,
    force: bool = False,
    seed_chats: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return _request(
        "POST",
        _path(owner, account_id, "sync"),
        json={"force": bool(force), "seed_chats": seed_chats or []},
        timeout=30.0,
    )


def sync_status(owner: str | None, account_id: str) -> dict[str, Any]:
    return _request("GET", _path(owner, account_id, "sync"), timeout=5.0)


def download_media(
    owner: str | None,
    account_id: str,
    provider_message_id: str,
    *,
    raw_message: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"provider_message_id": provider_message_id}
    if raw_message:
        payload["raw_message"] = raw_message
    return _request(
        "POST",
        _path(owner, account_id, "download-media"),
        json=payload,
        timeout=60.0,
    ).get("media") or {}
