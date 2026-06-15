"""Short-lived browser token brokers for realtime speech providers."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Mapping, Optional


CARTESIA_VERSION = "2026-03-01"
CARTESIA_ACCESS_TOKEN_URL = "https://api.cartesia.ai/access-token"
_MAX_EXPIRES_IN = 3600
_DEFAULT_API_KEY_FILES = (
    "/run/secrets/cartesia_api_key",
    "/app/secrets/cartesia_api_key",
    "/app/data/secrets/cartesia_api_key",
)


class ProviderTokenUnavailable(RuntimeError):
    """Raised when a realtime provider token cannot be minted."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 503,
        setup_blocker: str,
        upstream_status_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.setup_blocker = setup_blocker
        self.upstream_status_code = upstream_status_code


def normalize_cartesia_grants(grants: Optional[Mapping[str, Any]]) -> Dict[str, bool]:
    requested = grants or {"stt": True, "tts": True}
    normalized = {
        "stt": bool(requested.get("stt", False)),
        "tts": bool(requested.get("tts", False)),
    }
    if not normalized["stt"] and not normalized["tts"]:
        raise ValueError("At least one Cartesia grant is required")
    return normalized


def normalize_expires_in(expires_in: Any) -> int:
    try:
        value = int(expires_in)
    except (TypeError, ValueError):
        value = 60
    return max(1, min(value, _MAX_EXPIRES_IN))


def default_cartesia_api_key_file() -> str:
    return _DEFAULT_API_KEY_FILES[-1]


class CartesiaProviderTokenService:
    """Mint browser-safe Cartesia access tokens without exposing the API key."""

    provider = "cartesia"

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        api_key_file: Optional[str] = None,
        access_token_url: str = CARTESIA_ACCESS_TOKEN_URL,
        cartesia_version: str = CARTESIA_VERSION,
        timeout_seconds: float = 10.0,
    ) -> None:
        env_api_key = api_key if api_key is not None else os.environ.get("CARTESIA_API_KEY", "")
        configured_api_key_file = (
            api_key_file
            if api_key_file is not None
            else os.environ.get("CARTESIA_API_KEY_FILE", "")
        )
        self.access_token_url = access_token_url
        self.cartesia_version = cartesia_version
        self.timeout_seconds = timeout_seconds
        self.configured_api_key_file = configured_api_key_file
        self.credential_source = "missing"
        self.setup_status = "missing_api_key"
        self.setup_blocker: Optional[str] = "cartesia_api_key_missing"
        self.last_token_setup_blocker: Optional[str] = None
        self.last_token_status_code: Optional[int] = None
        self.last_token_upstream_status_code: Optional[int] = None
        self.api_key = (env_api_key or "").strip()
        if self.api_key:
            self.credential_source = "env"
            self.setup_status = "ready"
            self.setup_blocker = None
            return

        self.api_key = self._load_api_key_from_file(configured_api_key_file)

    def _reload_api_key_if_missing(self) -> None:
        if (self.api_key or "").strip():
            return
        self.api_key = self._load_api_key_from_file(self.configured_api_key_file)

    def _load_api_key_from_file(self, configured_api_key_file: str) -> str:
        candidate_files = []
        if configured_api_key_file:
            candidate_files.append(configured_api_key_file)
        else:
            candidate_files.extend(path for path in _DEFAULT_API_KEY_FILES if os.path.exists(path))

        for index, api_key_file in enumerate(candidate_files):
            try:
                with open(api_key_file, "r", encoding="utf-8") as handle:
                    key = handle.read().strip()
            except FileNotFoundError:
                if configured_api_key_file:
                    self.setup_status = "missing_api_key_file"
                    self.setup_blocker = "cartesia_api_key_file_missing"
                continue
            except OSError:
                if configured_api_key_file or index == len(candidate_files) - 1:
                    self.setup_status = "unreadable_api_key_file"
                    self.setup_blocker = "cartesia_api_key_file_unreadable"
                continue
            if key:
                self.credential_source = "file"
                self.setup_status = "ready"
                self.setup_blocker = None
                return key
            if configured_api_key_file or index == len(candidate_files) - 1:
                self.setup_status = "empty_api_key_file"
                self.setup_blocker = "cartesia_api_key_file_empty"
        return ""

    def get_stats(self) -> Dict[str, Any]:
        self._reload_api_key_if_missing()
        credential_available = bool((self.api_key or "").strip())
        token_blocker = self.last_token_setup_blocker if credential_available else None
        available = credential_available and not token_blocker
        return {
            "provider": self.provider,
            "available": available,
            "credential_available": credential_available,
            "setup_status": "token_failed" if token_blocker else (self.setup_status if not available else "ready"),
            "setup_blocker": token_blocker if token_blocker else (None if available else self.setup_blocker),
            "credential_source": self.credential_source if credential_available else "missing",
            "token_status_code": self.last_token_status_code,
            "token_upstream_status_code": self.last_token_upstream_status_code,
            "cartesia_version": self.cartesia_version,
            "max_expires_in": _MAX_EXPIRES_IN,
            "supported_grants": ["stt", "tts"],
            "auth": "access_token_query_param",
        }

    def store_api_key_file(self, api_key: str, *, api_key_file: Optional[str] = None) -> Dict[str, Any]:
        key = (api_key or "").strip()
        if not key:
            raise ValueError("Cartesia API key is required")
        target = (api_key_file or self.configured_api_key_file or default_cartesia_api_key_file()).strip()
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(key + "\n")
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
        if not self.configured_api_key_file:
            self.configured_api_key_file = target
        self.api_key = key
        self.credential_source = "file"
        self.setup_status = "ready"
        self.setup_blocker = None
        self._clear_token_failure()
        return self.get_stats()

    def _clear_token_failure(self) -> None:
        self.last_token_setup_blocker = None
        self.last_token_status_code = None
        self.last_token_upstream_status_code = None

    def _mark_token_failure(self, exc: ProviderTokenUnavailable) -> ProviderTokenUnavailable:
        self.last_token_setup_blocker = exc.setup_blocker
        self.last_token_status_code = exc.status_code
        self.last_token_upstream_status_code = exc.upstream_status_code
        return exc

    def _access_token_request(self, body: bytes, auth_mode: str) -> urllib.request.Request:
        headers = {
            "Cartesia-Version": self.cartesia_version,
            "Content-Type": "application/json",
        }
        if auth_mode == "x_api_key":
            headers["X-API-Key"] = self.api_key
        else:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return urllib.request.Request(
            self.access_token_url,
            data=body,
            method="POST",
            headers=headers,
        )

    def _token_http_blocker(self, status_code: int) -> str:
        if status_code in {401, 403}:
            return "cartesia_api_key_rejected"
        if status_code == 402:
            return "cartesia_plan_or_billing_blocked"
        if status_code == 429:
            return "cartesia_rate_limited"
        return f"cartesia_token_http_{status_code}"

    def generate_token(self, *, grants: Mapping[str, Any], expires_in: Any) -> Dict[str, Any]:
        stats = self.get_stats()
        if not stats["available"]:
            raise ProviderTokenUnavailable(
                "Cartesia browser token generation is not configured.",
                setup_blocker=stats.get("setup_blocker") or "cartesia_api_key_missing",
                upstream_status_code=stats.get("token_upstream_status_code"),
            )

        normalized_grants = normalize_cartesia_grants(grants)
        normalized_expires_in = normalize_expires_in(expires_in)
        body = json.dumps({
            "grants": {name: True for name, enabled in normalized_grants.items() if enabled},
            "expires_in": normalized_expires_in,
        }).encode("utf-8")
        last_http_error: Optional[urllib.error.HTTPError] = None
        last_url_error: Optional[BaseException] = None
        payload = None
        try:
            for auth_mode in ("bearer", "x_api_key"):
                request = self._access_token_request(body, auth_mode)
                try:
                    with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    break
                except urllib.error.HTTPError as exc:
                    last_http_error = exc
                    continue
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    last_url_error = exc
                    continue
        except urllib.error.HTTPError as exc:
            raise self._mark_token_failure(ProviderTokenUnavailable(
                "Cartesia browser token generation failed.",
                status_code=502,
                setup_blocker=self._token_http_blocker(exc.code),
                upstream_status_code=exc.code,
            )) from exc
        if payload is None and last_http_error is not None:
            raise self._mark_token_failure(ProviderTokenUnavailable(
                "Cartesia browser token generation failed.",
                status_code=502,
                setup_blocker=self._token_http_blocker(last_http_error.code),
                upstream_status_code=last_http_error.code,
            )) from last_http_error
        if payload is None and last_url_error is not None:
            raise self._mark_token_failure(ProviderTokenUnavailable(
                "Cartesia browser token generation failed.",
                status_code=502,
                setup_blocker="cartesia_token_request_failed",
            )) from last_url_error
        if payload is None:
            raise self._mark_token_failure(ProviderTokenUnavailable(
                "Cartesia browser token generation failed.",
                status_code=502,
                setup_blocker="cartesia_token_request_failed",
            ))

        token = payload.get("token")
        if not isinstance(token, str) or not token.strip():
            raise self._mark_token_failure(ProviderTokenUnavailable(
                "Cartesia browser token response did not include a token.",
                status_code=502,
                setup_blocker="cartesia_token_missing",
            ))
        self._clear_token_failure()
        return {
            "provider": self.provider,
            "token": token,
            "expires_in": normalized_expires_in,
            "grants": normalized_grants,
            "auth": "access_token_query_param",
            "cartesia_version": self.cartesia_version,
        }
