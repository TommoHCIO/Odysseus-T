from fastapi import FastAPI
from fastapi.testclient import TestClient
import base64
import json
import urllib.error

from routes.realtime_voice_routes import setup_realtime_voice_routes
from services.stt.stt_service import STTService
from src.realtime_voice.provider_tokens import CartesiaProviderTokenService, ProviderTokenUnavailable
from src.realtime_voice.voice_session import VoiceSessionManager


def _client(stop_calls=None):
    app = FastAPI()
    manager = VoiceSessionManager()
    calls = stop_calls if stop_calls is not None else []

    def stop_run(session_id: str) -> bool:
        calls.append(session_id)
        return True

    app.include_router(setup_realtime_voice_routes(manager=manager, stop_run=stop_run))
    return TestClient(app), calls


class FakeProviderTokenService:
    def __init__(self, *, available=True, token="browser-token", token_error=None):
        self.available = available
        self.token = token
        self.token_error = token_error
        self.calls = []

    def get_stats(self):
        if self.available:
            return {
                "provider": "cartesia",
                "available": True,
                "setup_status": "ready",
                "setup_blocker": None,
                "cartesia_version": "2026-03-01",
                "max_expires_in": 3600,
                "supported_grants": ["stt", "tts"],
            }
        return {
            "provider": "cartesia",
            "available": False,
            "setup_status": "missing_api_key",
            "setup_blocker": "cartesia_api_key_missing",
            "cartesia_version": "2026-03-01",
            "max_expires_in": 3600,
            "supported_grants": ["stt", "tts"],
        }

    def generate_token(self, *, grants, expires_in):
        self.calls.append({"grants": grants, "expires_in": expires_in})
        if self.token_error is not None:
            raise self.token_error
        if not self.available:
            raise RuntimeError("cartesia_api_key_missing")
        return {
            "provider": "cartesia",
            "token": self.token,
            "expires_in": expires_in,
            "grants": grants,
            "auth": "access_token_query_param",
            "cartesia_version": "2026-03-01",
        }


class _FakeHttpResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_cartesia_provider_token_service_reads_api_key_file(tmp_path, monkeypatch):
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    monkeypatch.delenv("CARTESIA_API_KEY_FILE", raising=False)
    key_file = tmp_path / "cartesia_api_key"
    key_file.write_text(" file-secret \n", encoding="utf-8")

    service = CartesiaProviderTokenService(api_key_file=str(key_file))

    stats = service.get_stats()
    assert stats["available"] is True
    assert stats["setup_status"] == "ready"
    assert stats["setup_blocker"] is None
    assert stats["credential_source"] == "file"
    assert "file-secret" not in str(stats)


def test_cartesia_provider_token_service_reports_unreadable_key_file_without_secret(tmp_path, monkeypatch):
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    monkeypatch.delenv("CARTESIA_API_KEY_FILE", raising=False)
    missing_key_file = tmp_path / "missing_cartesia_api_key"

    service = CartesiaProviderTokenService(api_key_file=str(missing_key_file))

    stats = service.get_stats()
    assert stats["available"] is False
    assert stats["setup_status"] == "missing_api_key_file"
    assert stats["setup_blocker"] == "cartesia_api_key_file_missing"
    assert stats["credential_source"] == "missing"
    assert str(missing_key_file) not in str(stats)


def test_cartesia_provider_token_service_hot_reloads_key_file_after_start(tmp_path, monkeypatch):
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    monkeypatch.delenv("CARTESIA_API_KEY_FILE", raising=False)
    key_file = tmp_path / "cartesia_api_key"
    service = CartesiaProviderTokenService(api_key_file=str(key_file))

    first_stats = service.get_stats()
    assert first_stats["available"] is False
    assert first_stats["setup_blocker"] == "cartesia_api_key_file_missing"

    key_file.write_text(" later-file-secret \n", encoding="utf-8")

    second_stats = service.get_stats()
    assert second_stats["available"] is True
    assert second_stats["setup_status"] == "ready"
    assert second_stats["credential_source"] == "file"
    assert "later-file-secret" not in str(second_stats)


def test_cartesia_provider_token_service_sends_only_requested_grants(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append({
            "timeout": timeout,
            "headers": dict(request.header_items()),
            "body": json.loads(request.data.decode("utf-8")),
        })
        return _FakeHttpResponse({"token": "short-token"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    service = CartesiaProviderTokenService(api_key="test-secret")

    data = service.generate_token(grants={"stt": True}, expires_in=120)

    assert data["token"] == "short-token"
    assert data["grants"] == {"stt": True, "tts": False}
    assert calls[0]["body"] == {"grants": {"stt": True}, "expires_in": 120}


def test_cartesia_provider_token_service_retries_x_api_key_auth(monkeypatch):
    auth_modes = []

    def fake_urlopen(request, timeout):
        headers = dict(request.header_items())
        if "Authorization" in headers:
            auth_modes.append("bearer")
            raise urllib.error.HTTPError(
                request.full_url,
                502,
                "Bad Gateway",
                hdrs={},
                fp=None,
            )
        auth_modes.append("x_api_key")
        assert "X-api-key" in headers or "X-API-Key" in headers
        return _FakeHttpResponse({"token": "retry-token"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    service = CartesiaProviderTokenService(api_key="test-secret")

    data = service.generate_token(grants={"tts": True}, expires_in=60)

    assert data["token"] == "retry-token"
    assert data["grants"] == {"stt": False, "tts": True}
    assert auth_modes == ["bearer", "x_api_key"]


def test_voice_session_starts_listening_for_existing_session():
    client, _ = _client()

    response = client.post("/api/voice/session", json={"session_id": "chat-1"})

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == "chat-1"
    assert data["state"] == "listening"
    assert data["speech_state"] == "idle"
    assert data["execution_state"] == "idle"
    assert data["voice_session_id"]


def test_soft_interrupt_stops_speech_without_stopping_execution():
    client, stop_calls = _client()
    voice_session_id = client.post(
        "/api/voice/session",
        json={"session_id": "chat-1"},
    ).json()["voice_session_id"]

    response = client.post(
        "/api/voice/interrupt",
        json={"voice_session_id": voice_session_id, "reason": "user_speech"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["state"] == "interrupted"
    assert data["actions"] == {
        "stop_tts": True,
        "clear_audio_queue": True,
        "cancel_execution": False,
    }
    assert stop_calls == []


def test_hard_cancel_stops_attached_agent_run():
    client, stop_calls = _client()
    voice_session_id = client.post(
        "/api/voice/session",
        json={"session_id": "chat-1"},
    ).json()["voice_session_id"]

    response = client.post(
        "/api/voice/cancel",
        json={"voice_session_id": voice_session_id, "reason": "user_cancel"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["state"] == "cancelled"
    assert data["run_stopped"] is True
    assert data["actions"]["cancel_execution"] is True
    assert stop_calls == ["chat-1"]


def test_voice_status_can_lookup_by_chat_session_id():
    client, _ = _client()
    created = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.get("/api/voice/status", params={"session_id": "chat-1"})

    assert response.status_code == 200
    data = response.json()
    assert data["voice_session_id"] == created["voice_session_id"]
    assert data["state"] == "listening"


def test_voice_config_reports_control_plane_capabilities(monkeypatch):
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "hybrid"})
    client, _ = _client()

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["runtime"] == "oracle"
    assert data["voice_mode"] == {
        "selected": "hybrid",
        "effective": "hybrid",
        "available": True,
        "setup_blocker": None,
        "options": ["local", "hybrid", "cartesia"],
    }
    assert data["supports_soft_interrupt"] is True
    assert data["supports_hard_interrupt"] is True
    assert data["supports_speech_to_chat"] is False
    assert data["supports_execution_narration_preview"] is True
    assert data["speech_to_chat_bridge"] == {
        "browser_final_transcript_submit": True,
        "server_final_utterance_submit": False,
        "websocket_final_transcript_submit": False,
        "partial_transcripts": False,
        "incremental_streaming": False,
        "supports_speech_to_chat": False,
        "blocking_reason": "server_stt_unavailable",
    }
    assert data["targets_ms"]["interruption"] == 100


def test_voice_preferences_saves_selected_mode(monkeypatch):
    saved = {}
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "hybrid"})
    monkeypatch.setattr("routes.realtime_voice_routes.save_settings", lambda settings: saved.update(settings))
    app = FastAPI()
    app.include_router(setup_realtime_voice_routes(stop_run=lambda _session_id: False))
    client = TestClient(app)

    response = client.post("/api/voice/preferences", json={"mode": "local"})

    assert response.status_code == 200
    assert response.json()["voice_mode"]["selected"] == "local"
    assert saved["oracle_voice_mode"] == "local"


def test_voice_preferences_normalizes_unknown_mode(monkeypatch):
    saved = {}
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "local"})
    monkeypatch.setattr("routes.realtime_voice_routes.save_settings", lambda settings: saved.update(settings))
    app = FastAPI()
    app.include_router(setup_realtime_voice_routes(stop_run=lambda _session_id: False))
    client = TestClient(app)

    response = client.post("/api/voice/preferences", json={"mode": "mystery"})

    assert response.status_code == 200
    assert response.json()["voice_mode"]["selected"] == "hybrid"
    assert saved["oracle_voice_mode"] == "hybrid"


def test_voice_config_marks_cartesia_mode_setup_blocker(monkeypatch):
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "cartesia"})
    app = FastAPI()
    app.include_router(
        setup_realtime_voice_routes(
            stop_run=lambda _session_id: False,
            provider_token_service=FakeProviderTokenService(available=False),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    voice_mode = response.json()["voice_mode"]
    assert voice_mode["selected"] == "cartesia"
    assert voice_mode["effective"] == "cartesia"
    assert voice_mode["available"] is False
    assert voice_mode["setup_blocker"] == "cartesia_api_key_missing"


def test_voice_config_marks_cartesia_mode_rejected_key_blocker(monkeypatch):
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "cartesia"})
    app = FastAPI()
    token_service = FakeProviderTokenService(available=True)

    def stats_with_rejected_key():
        stats = FakeProviderTokenService.get_stats(token_service)
        stats.update({
            "available": False,
            "setup_status": "token_failed",
            "setup_blocker": "cartesia_api_key_rejected",
            "credential_available": True,
            "token_upstream_status_code": 401,
        })
        return stats

    token_service.get_stats = stats_with_rejected_key
    app.include_router(
        setup_realtime_voice_routes(
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["realtime_provider_tokens"]["cartesia"]["credential_available"] is True
    assert data["voice_mode"]["selected"] == "cartesia"
    assert data["voice_mode"]["available"] is False
    assert data["voice_mode"]["setup_blocker"] == "cartesia_api_key_rejected"


def test_voice_cartesia_credentials_store_secret_file_and_select_mode(tmp_path, monkeypatch):
    saved = {}
    key_file = tmp_path / "cartesia_api_key"
    token_service = CartesiaProviderTokenService(api_key="", api_key_file=str(key_file))
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda _request, timeout=None: _FakeHttpResponse({"token": "verified-browser-token"}),
    )
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "hybrid"})
    monkeypatch.setattr("routes.realtime_voice_routes.save_settings", lambda settings: saved.update(settings))
    app = FastAPI()
    app.include_router(
        setup_realtime_voice_routes(
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post(
        "/api/voice/credentials/cartesia",
        json={"api_key": "  secret-cartesia-key  "},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["credential_saved"] is True
    assert data["voice_mode"]["selected"] == "cartesia"
    assert data["realtime_provider_tokens"]["cartesia"]["available"] is True
    assert data["realtime_provider_tokens"]["cartesia"]["setup_status"] == "ready"
    assert data["credential_verified"] is True
    assert data["realtime_provider_tokens"]["cartesia"]["credential_source"] == "file"
    assert "secret-cartesia-key" not in str(data)
    assert "verified-browser-token" not in str(data)
    assert key_file.read_text(encoding="utf-8") == "secret-cartesia-key\n"
    assert saved["oracle_voice_mode"] == "cartesia"


def test_voice_cartesia_credentials_reports_rejected_key_on_save(tmp_path, monkeypatch):
    saved = {}
    key_file = tmp_path / "cartesia_api_key"
    token_service = CartesiaProviderTokenService(api_key="", api_key_file=str(key_file))

    def fake_urlopen(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            401,
            "Unauthorized",
            hdrs={},
            fp=None,
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("routes.realtime_voice_routes.load_settings", lambda: {"oracle_voice_mode": "hybrid"})
    monkeypatch.setattr("routes.realtime_voice_routes.save_settings", lambda settings: saved.update(settings))
    app = FastAPI()
    app.include_router(
        setup_realtime_voice_routes(
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post(
        "/api/voice/credentials/cartesia",
        json={"api_key": "  rejected-cartesia-key  "},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "message": "Cartesia API key was saved, but token verification failed.",
        "provider": "cartesia",
        "credential_saved": True,
        "setup_blocker": "cartesia_api_key_rejected",
        "upstream_status_code": 401,
    }
    assert key_file.read_text(encoding="utf-8") == "rejected-cartesia-key\n"
    assert saved == {}
    assert "rejected-cartesia-key" not in response.text


def test_voice_config_reports_researched_provider_recommendations():
    client, _ = _client()

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    recommendations = data["provider_recommendations"]
    assert recommendations["status"] == "recommended_not_configured"
    assert recommendations["primary_modular_stack"]["stt"] == "Cartesia Ink 2"
    assert recommendations["primary_modular_stack"]["tts"] == "Cartesia Sonic 3.5/Turbo"
    assert recommendations["primary_modular_stack"]["keeps_odysseus_as_brain"] is True
    assert recommendations["best_public_stt_latency"]["provider"] == "AssemblyAI Universal-3 Pro Streaming"
    assert recommendations["full_realtime_benchmark"]["primary"] == "OpenAI Realtime API"
    assert "browser_token_endpoint" in recommendations["completed_capabilities"]
    assert "streaming_stt_websocket_adapter" in recommendations["completed_capabilities"]
    assert "streaming_tts_websocket_adapter" in recommendations["completed_capabilities"]
    assert "persistent_stt_socket_reuse" in recommendations["completed_capabilities"]
    assert "persistent_tts_socket_reuse" in recommendations["completed_capabilities"]
    assert "answer_highlight_narration" in recommendations["completed_capabilities"]
    assert "provider_latency_probe_endpoint" in recommendations["completed_capabilities"]
    assert "cartesia_api_key_missing" in recommendations["implementation_blockers"]
    assert "streaming_stt_websocket_adapter" not in recommendations["implementation_blockers"]
    assert "streaming_tts_websocket_adapter" not in recommendations["implementation_blockers"]
    assert "persistent_stt_socket_reuse" not in recommendations["implementation_blockers"]
    assert "persistent_tts_socket_reuse" not in recommendations["implementation_blockers"]
    assert "answer_highlight_narration" not in recommendations["implementation_blockers"]
    assert "provider_latency_probe_endpoint" not in recommendations["implementation_blockers"]
    assert "persistent_speech_socket_runtime" in recommendations["implementation_blockers"]
    assert "provider_latency_probe" in recommendations["implementation_blockers"]


def test_voice_config_reports_cartesia_token_broker_status():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(available=True)
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["realtime_provider_tokens"]["cartesia"]["available"] is True
    assert data["realtime_provider_tokens"]["cartesia"]["setup_blocker"] is None
    assert "browser_token_endpoint" in data["provider_recommendations"]["completed_capabilities"]
    assert "streaming_stt_websocket_adapter" in data["provider_recommendations"]["completed_capabilities"]
    assert "persistent_stt_socket_reuse" in data["provider_recommendations"]["completed_capabilities"]
    assert "persistent_tts_socket_reuse" in data["provider_recommendations"]["completed_capabilities"]
    assert "answer_highlight_narration" in data["provider_recommendations"]["completed_capabilities"]
    assert "provider_latency_probe_endpoint" in data["provider_recommendations"]["completed_capabilities"]
    assert "cartesia_api_key_missing" not in data["provider_recommendations"]["implementation_blockers"]
    assert data["cartesia_stt_proxy"] == {
        "available": True,
        "path": "/api/voice/cartesia-stt/ws",
        "setup_blocker": None,
        "provider": "cartesia",
    }
    assert data["cartesia_tts_proxy"] == {
        "available": True,
        "path": "/api/voice/cartesia-tts/ws",
        "setup_blocker": None,
        "provider": "cartesia",
    }


def test_voice_config_reports_cartesia_proxy_blockers_without_secret():
    app = FastAPI()
    manager = VoiceSessionManager()
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=FakeProviderTokenService(available=False),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["cartesia_stt_proxy"] == {
        "available": False,
        "path": "/api/voice/cartesia-stt/ws",
        "setup_blocker": "cartesia_api_key_missing",
        "provider": "cartesia",
    }
    assert data["cartesia_tts_proxy"] == {
        "available": False,
        "path": "/api/voice/cartesia-tts/ws",
        "setup_blocker": "cartesia_api_key_missing",
        "provider": "cartesia",
    }
    assert "browser-token" not in str(data)


def test_voice_provider_token_issues_short_lived_cartesia_browser_token():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(available=True, token="short-lived-token")
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post(
        "/api/voice/provider-token",
        json={"provider": "cartesia", "grants": {"stt": True}, "expires_in": 90},
    )

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "provider": "cartesia",
        "token": "short-lived-token",
        "expires_in": 90,
        "grants": {"stt": True, "tts": False},
        "auth": "access_token_query_param",
        "cartesia_version": "2026-03-01",
    }
    assert token_service.calls == [{"grants": {"stt": True, "tts": False}, "expires_in": 90}]


def test_voice_provider_token_reports_missing_cartesia_key_without_secret():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(available=False)
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post("/api/voice/provider-token", json={"provider": "cartesia"})

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "message": "Cartesia browser token generation is not configured.",
        "provider": "cartesia",
        "setup_blocker": "cartesia_api_key_missing",
    }


def test_voice_provider_token_reports_upstream_cartesia_status_without_secret():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(
        available=True,
        token_error=ProviderTokenUnavailable(
            "Cartesia browser token generation failed.",
            status_code=502,
            setup_blocker="cartesia_api_key_rejected",
            upstream_status_code=401,
        ),
    )
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post("/api/voice/provider-token", json={"provider": "cartesia"})

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "message": "Cartesia browser token generation failed.",
        "provider": "cartesia",
        "setup_blocker": "cartesia_api_key_rejected",
        "upstream_status_code": 401,
    }
    assert "test-secret" not in response.text


def test_voice_provider_latency_probe_reports_redacted_token_timing():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(available=True, token="secret-browser-token")
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post(
        "/api/voice/provider-latency-probe",
        json={"provider": "cartesia", "grants": {"stt": True, "tts": True}, "expires_in": 30},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "cartesia"
    assert data["ok"] is True
    assert data["token_probe"]["ok"] is True
    assert data["token_probe"]["token_ms"] >= 0
    assert data["token_probe"]["grants"] == {"stt": True, "tts": True}
    assert data["token_probe"]["expires_in"] == 30
    assert data["token_probe"]["token_redacted"] is True
    assert "secret-browser-token" not in str(data)
    assert token_service.calls == [{"grants": {"stt": True, "tts": True}, "expires_in": 30}]


def test_voice_provider_latency_probe_reports_missing_key_without_secret():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(available=False)
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post("/api/voice/provider-latency-probe", json={"provider": "cartesia"})

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "message": "Cartesia provider latency probe is not configured.",
        "provider": "cartesia",
        "setup_blocker": "cartesia_api_key_missing",
    }


def test_voice_provider_latency_probe_reports_upstream_cartesia_status_without_secret():
    app = FastAPI()
    manager = VoiceSessionManager()
    token_service = FakeProviderTokenService(
        available=True,
        token_error=ProviderTokenUnavailable(
            "Cartesia browser token generation failed.",
            status_code=502,
            setup_blocker="cartesia_api_key_rejected",
            upstream_status_code=401,
        ),
    )
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            provider_token_service=token_service,
        )
    )
    client = TestClient(app)

    response = client.post("/api/voice/provider-latency-probe", json={"provider": "cartesia"})

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "message": "Cartesia browser token generation failed.",
        "provider": "cartesia",
        "setup_blocker": "cartesia_api_key_rejected",
        "upstream_status_code": 401,
    }


def test_voice_provider_token_rejects_unknown_provider():
    client, _ = _client()

    response = client.post("/api/voice/provider-token", json={"provider": "unknown"})

    assert response.status_code == 400
    assert response.json()["detail"]["message"] == "Unsupported realtime voice provider"


def test_voice_config_reports_server_stt_final_utterance_capability():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        available = True

        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "base",
                "language": "",
            }

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_speech_to_chat"] is False
    assert data["supports_server_stt_final_utterance"] is True
    assert data["supports_ws_audio_stream"] is True
    assert data["supports_partial_transcripts"] is False
    assert data["stt"]["provider"] == "local"
    assert data["speech_to_chat_bridge"] == {
        "browser_final_transcript_submit": True,
        "server_final_utterance_submit": True,
        "websocket_final_transcript_submit": True,
        "partial_transcripts": False,
        "incremental_streaming": False,
        "supports_speech_to_chat": False,
        "blocking_reason": "incremental_stt_bridge_pending",
    }


def test_voice_config_treats_endpoint_stt_final_utterance_as_operational_speech_to_chat():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def get_stats(self):
            return {
                "available": True,
                "provider": "endpoint:speaches",
                "model": "gpt-4o-transcribe",
                "language": "en",
                "supports_partial_transcripts": False,
                "supports_incremental_transcripts": False,
                "speech_to_chat_quality": "provider_grade",
                "speech_to_chat_blocker": None,
            }

        def transcribe(self, _audio_bytes: bytes):
            return "hello oracle"

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_speech_to_chat"] is True
    assert data["supports_server_stt_final_utterance"] is True
    assert data["supports_incremental_stt_stream"] is False
    assert data["speech_to_chat_bridge"] == {
        "browser_final_transcript_submit": True,
        "server_final_utterance_submit": True,
        "websocket_final_transcript_submit": True,
        "partial_transcripts": False,
        "incremental_streaming": False,
        "supports_speech_to_chat": True,
        "blocking_reason": None,
    }


def test_voice_config_reports_endpoint_stt_missing_blocker():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def get_stats(self):
            return {
                "available": False,
                "provider": "endpoint:speaches",
                "model": "whisper-1",
                "language": "en",
                "endpoint_id": "speaches",
                "setup_status": "endpoint_missing",
                "setup_blocker": "stt_endpoint_missing",
                "supports_partial_transcripts": False,
                "supports_incremental_transcripts": False,
                "speech_to_chat_quality": "unavailable",
                "speech_to_chat_blocker": "stt_endpoint_missing",
            }

        def transcribe(self, _audio_bytes: bytes):
            return None

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_speech_to_chat"] is False
    assert data["supports_server_stt_final_utterance"] is False
    assert data["stt"]["setup_status"] == "endpoint_missing"
    assert data["stt"]["setup_blocker"] == "stt_endpoint_missing"
    assert data["speech_to_chat_bridge"]["blocking_reason"] == "stt_endpoint_missing"


def test_voice_config_reports_local_stt_dependency_blocker():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def get_stats(self):
            return {
                "available": False,
                "provider": "local",
                "model": "base",
                "language": "",
                "model_loaded": False,
                "setup_status": "dependency_missing",
                "setup_blocker": "local_stt_dependency_missing",
                "install_hint": "Install faster-whisper.",
                "supports_partial_transcripts": False,
                "supports_incremental_transcripts": False,
            }

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_speech_to_chat"] is False
    assert data["supports_server_stt_final_utterance"] is False
    assert data["supports_ws_audio_stream"] is False
    assert data["stt"]["setup_status"] == "dependency_missing"
    assert data["stt"]["setup_blocker"] == "local_stt_dependency_missing"
    assert data["speech_to_chat_bridge"]["blocking_reason"] == "local_stt_dependency_missing"


def test_voice_config_reports_server_tts_chunked_audio_stream_capability():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeTtsService:
        def get_stats(self):
            return {
                "available": True,
                "ready": True,
                "provider": "endpoint:voice",
                "supports_chunked_audio_stream": True,
            }

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            tts_service=FakeTtsService(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_tts_chunked_audio_stream"] is True
    assert data["tts"]["supports_chunked_audio_stream"] is True


def test_voice_config_reports_always_on_voice_narrator_status():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeNarrator:
        def get_stats(self):
            return {
                "running": True,
                "queue_size": 0,
                "max_queue_size": 8,
                "backend_tts_available": True,
            }

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            voice_narrator=FakeNarrator(),
        )
    )
    client = TestClient(app)

    response = client.get("/api/voice/config")

    assert response.status_code == 200
    data = response.json()
    assert data["supports_voice_narrator_queue"] is True
    assert data["voice_narrator"] == {
        "running": True,
        "queue_size": 0,
        "max_queue_size": 8,
        "backend_tts_available": True,
    }


def test_voice_speak_uses_always_on_voice_narrator_queue():
    app = FastAPI()
    manager = VoiceSessionManager()
    calls = []

    class FakeNarrator:
        def get_stats(self):
            return {
                "running": True,
                "queue_size": 0,
                "max_queue_size": 8,
                "backend_tts_available": True,
            }

        async def synthesize(self, text: str):
            calls.append(text)
            return b"ID3narrated"

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            voice_narrator=FakeNarrator(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.post(
        "/api/voice/speak",
        json={
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "text": "Queued narration",
        },
    )
    status = client.get("/api/voice/status", params={"session_id": "chat-1"}).json()

    assert response.status_code == 200
    assert response.content == b"ID3narrated"
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert calls == ["Queued narration"]
    assert status["state"] == "listening"
    assert status["speech_state"] == "listening"
    assert status["last_reason"] == "voice_narrator_complete"


def test_voice_speak_streams_tts_audio_and_returns_to_listening():
    app = FastAPI()
    manager = VoiceSessionManager()
    calls = []

    class FakeTtsService:
        available = True

        def get_stats(self):
            return {
                "available": True,
                "ready": True,
                "provider": "endpoint:voice",
                "supports_chunked_audio_stream": True,
            }

        def synthesize_stream(self, text: str):
            calls.append(text)
            yield b"ID3"
            yield b"voice"

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            tts_service=FakeTtsService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.post(
        "/api/voice/speak",
        json={
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "text": "O.R.A.C.L.E. speaking",
        },
    )
    status = client.get("/api/voice/status", params={"session_id": "chat-1"}).json()

    assert response.status_code == 200
    assert response.content == b"ID3voice"
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.headers["x-voice-session-id"] == voice_session["voice_session_id"]
    assert calls == ["O.R.A.C.L.E. speaking"]
    assert status["state"] == "listening"
    assert status["speech_state"] == "listening"
    assert status["last_reason"] == "tts_stream_complete"


def test_voice_speak_rejects_unavailable_tts_without_fabricating_audio():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeTtsService:
        available = False

        def get_stats(self):
            return {
                "available": False,
                "ready": False,
                "provider": "disabled",
                "supports_chunked_audio_stream": False,
            }

        def synthesize_stream(self, text: str):
            raise AssertionError("synthesize_stream should not be called")

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            tts_service=FakeTtsService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.post(
        "/api/voice/speak",
        json={
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "text": "Speak this",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["message"] == "Server Text-to-Speech is not available for O.R.A.C.L.E."


def test_voice_narration_previews_safe_execution_progress():
    client, _ = _client()
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.post(
        "/api/voice/narration",
        json={
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "event_type": "tests.started",
            "message": "Running focused route and frontend checks",
        },
    )
    status = client.get("/api/voice/status", params={"session_id": "chat-1"}).json()

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "voice.narration"
    assert data["should_speak"] is True
    assert data["text"] == "I'm running checks."
    assert data["voice_session_id"] == voice_session["voice_session_id"]
    assert status["state"] == "working"
    assert status["execution_state"] == "working"
    assert status["last_reason"] == "narration_preview"


def test_voice_narration_speaks_live_frontend_event_templates():
    client, _ = _client()
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()
    cases = [
        ("chat.stream.started", "I am working on your chat request.", "I'm working on your chat request."),
        ("chat.stream.completed", "The chat response is ready.", "The chat response is ready."),
        ("tool.started", "I am using search.", "I am using search."),
        ("tool.completed", "The search step finished.", "The search step finished."),
        ("research.completed", "The research report is ready.", "The research report is ready."),
        ("code.run.started", "A code run started.", "A code run started."),
        ("workspace.preview.ready", "The local preview is ready.", "The local preview is ready."),
    ]

    for event_type, message, expected_text in cases:
        response = client.post(
            "/api/voice/narration",
            json={
                "voice_session_id": voice_session["voice_session_id"],
                "session_id": "chat-1",
                "event_type": event_type,
                "message": message,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["should_speak"] is True, event_type
        assert data["text"] == expected_text


def test_voice_narration_suppresses_raw_tool_output_without_fabricating_speech():
    client, _ = _client()
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    response = client.post(
        "/api/voice/narration",
        json={
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "event_type": "tool.output",
            "message": '{"tool":"shell","command":"pytest","stdout":"Traceback (most recent call last)"}',
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "voice.narration"
    assert data["should_speak"] is False
    assert data["text"] == ""
    assert data["reason"] == "raw_internal_event"


def test_voice_ws_transcribes_audio_stream_on_utterance_end():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def __init__(self):
            self.audio_bytes = b""

        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "base",
                "language": "",
            }

        def transcribe(self, audio_bytes: bytes):
            self.audio_bytes = audio_bytes
            return "hello from oracle"

    stt_service = FakeSttService()
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"abc").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"def").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({"type": "voice.audio.end"})
        transcript = websocket.receive_json()

    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "hello from oracle"
    assert transcript["submit_to_chat"] is True
    assert transcript["voice_session_id"] == voice_session["voice_session_id"]
    assert stt_service.audio_bytes == b"abcdef"


def test_voice_ws_forwards_provider_partial_transcripts_before_final():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeStreamingSttService:
        def __init__(self):
            self.audio_bytes = b""

        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "base",
                "language": "",
                "supports_partial_transcripts": True,
            }

        def transcribe_stream(self, audio_bytes: bytes):
            self.audio_bytes = audio_bytes
            yield {"type": "partial", "text": "hello"}
            yield {"type": "partial", "text": "hello from"}
            yield {"type": "final", "text": "hello from oracle"}

    stt_service = FakeStreamingSttService()
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()
    config = client.get("/api/voice/config").json()

    assert config["supports_partial_transcripts"] is True

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"abcdef").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({"type": "voice.audio.end"})
        first_partial = websocket.receive_json()
        second_partial = websocket.receive_json()
        transcript = websocket.receive_json()

    assert first_partial["type"] == "voice.transcript.partial"
    assert first_partial["text"] == "hello"
    assert first_partial["submit_to_chat"] is False
    assert second_partial["type"] == "voice.transcript.partial"
    assert second_partial["text"] == "hello from"
    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "hello from oracle"
    assert transcript["submit_to_chat"] is True
    assert stt_service.audio_bytes == b"abcdef"


def test_voice_ws_forwards_incremental_partial_transcripts_before_utterance_end():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeIncrementalStream:
        def __init__(self):
            self.chunks = []

        def accept_audio(self, audio_bytes: bytes):
            self.chunks.append(audio_bytes)
            yield {
                "type": "partial",
                "text": f"heard {len(b''.join(self.chunks))} bytes",
                "diagnostics": {
                    "provider": "local",
                    "mode": "rolling_buffer",
                    "bytes_received": len(b"".join(self.chunks)),
                    "decode_attempt": len(self.chunks),
                    "decode_ms": 12.5,
                    "text": "must not leak",
                },
            }

        def finish(self):
            yield {
                "type": "final",
                "text": "hello from incremental oracle",
                "diagnostics": {
                    "provider": "local",
                    "mode": "rolling_buffer",
                    "bytes_received": len(b"".join(self.chunks)),
                    "decode_attempt": len(self.chunks) + 1,
                    "decode_ms": 15.25,
                    "transcript": "must not leak",
                },
            }

    class FakeIncrementalSttService:
        def __init__(self):
            self.stream = FakeIncrementalStream()

        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "base",
                "language": "",
                "supports_partial_transcripts": True,
                "supports_incremental_transcripts": True,
            }

        def start_incremental_stream(self, **_kwargs):
            return self.stream

        def transcribe(self, _audio_bytes: bytes):
            raise AssertionError("batch transcription should not be used for incremental streams")

    stt_service = FakeIncrementalSttService()
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()
    config = client.get("/api/voice/config").json()

    assert config["speech_to_chat_bridge"]["incremental_streaming"] is True

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"abc").decode("ascii"),
        })
        chunk_ack = websocket.receive_json()
        partial = websocket.receive_json()
        websocket.send_json({"type": "voice.audio.end"})
        transcript = websocket.receive_json()

    assert chunk_ack["type"] == "voice.audio.chunk.received"
    assert partial["type"] == "voice.transcript.partial"
    assert partial["text"] == "heard 3 bytes"
    assert partial["submit_to_chat"] is False
    assert partial["diagnostics"] == {
        "provider": "local",
        "mode": "rolling_buffer",
        "bytes_received": 3,
        "decode_attempt": 1,
        "decode_ms": 12.5,
    }
    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "hello from incremental oracle"
    assert transcript["submit_to_chat"] is False
    assert transcript["diagnostics"] == {
        "provider": "local",
        "mode": "rolling_buffer",
        "bytes_received": 3,
        "decode_attempt": 2,
        "decode_ms": 15.25,
        "quality_gate": "diagnostic_only",
    }
    assert stt_service.stream.chunks == [b"abc"]


def test_voice_ws_uses_local_stt_incremental_stream_when_available(monkeypatch):
    app = FastAPI()
    manager = VoiceSessionManager()
    stt_service = STTService()
    calls = []

    monkeypatch.setattr(stt_service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(stt_service, "_get_whisper", lambda: object())

    def fake_events(audio_bytes, language="", **_kwargs):
        calls.append((len(audio_bytes), language))
        if len(audio_bytes) == 12000:
            return [
                {"type": "partial", "text": "hello"},
                {"type": "final", "text": "hello"},
            ]
        return [
            {"type": "partial", "text": "hello"},
            {"type": "partial", "text": "hello oracle"},
            {"type": "final", "text": "hello oracle"},
        ]

    monkeypatch.setattr(stt_service, "_transcribe_local_events", fake_events)

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()
    config = client.get("/api/voice/config").json()

    assert config["supports_speech_to_chat"] is False
    assert config["supports_incremental_stt_stream"] is True
    assert config["speech_to_chat_bridge"]["incremental_streaming"] is True
    assert config["speech_to_chat_bridge"]["supports_speech_to_chat"] is False
    assert config["speech_to_chat_bridge"]["blocking_reason"] == "local_rolling_buffer_diagnostic"
    assert config["stt"]["speech_to_chat_quality"] == "diagnostic"
    assert config["stt"]["speech_to_chat_blocker"] == "local_rolling_buffer_diagnostic"

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 12000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        first_partial = websocket.receive_json()
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"b" * 64000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        second_partial = websocket.receive_json()
        websocket.send_json({"type": "voice.audio.end"})
        transcript = websocket.receive_json()

    assert first_partial["type"] == "voice.transcript.partial"
    assert first_partial["text"] == "hello"
    assert first_partial["submit_to_chat"] is False
    assert second_partial["type"] == "voice.transcript.partial"
    assert second_partial["text"] == "hello oracle"
    assert second_partial["submit_to_chat"] is False
    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "hello oracle"
    assert transcript["submit_to_chat"] is False
    assert transcript["diagnostics"]["quality_gate"] == "diagnostic_only"
    assert calls == [
        (12000, "en"),
        (76000, "en"),
        (76000, "en"),
    ]


def test_voice_ws_throttles_local_incremental_partial_decodes_until_byte_threshold(monkeypatch):
    app = FastAPI()
    manager = VoiceSessionManager()
    stt_service = STTService()
    calls = []

    monkeypatch.setattr(stt_service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(stt_service, "_get_whisper", lambda: object())

    def fake_events(audio_bytes, language="", **_kwargs):
        calls.append((len(audio_bytes), language))
        text = f"heard {len(audio_bytes)} bytes"
        return [
            {"type": "partial", "text": text},
            {"type": "final", "text": text},
        ]

    monkeypatch.setattr(stt_service, "_transcribe_local_events", fake_events)

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 11999).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"b").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        partial = websocket.receive_json()
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"c").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({"type": "voice.audio.end"})
        transcript = websocket.receive_json()

    assert partial["type"] == "voice.transcript.partial"
    assert partial["text"] == "heard 12000 bytes"
    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "heard 12001 bytes"
    assert calls == [
        (12000, "en"),
        (12001, "en"),
    ]


def test_voice_ws_does_not_submit_max_duration_ended_audio(monkeypatch):
    app = FastAPI()
    manager = VoiceSessionManager()
    stt_service = STTService()

    monkeypatch.setattr(stt_service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(stt_service, "_get_whisper", lambda: object())
    monkeypatch.setattr(stt_service, "_transcribe_local_events", lambda *_args, **_kwargs: [
        {"type": "partial", "text": "background speech"},
        {"type": "final", "text": "background speech"},
    ])

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 12000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        partial = websocket.receive_json()
        websocket.send_json({
            "type": "voice.audio.end",
            "end_reason": "max_speech_ms",
        })
        transcript = websocket.receive_json()

    assert partial["type"] == "voice.transcript.partial"
    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "background speech"
    assert transcript["submit_to_chat"] is False
    assert transcript["end_reason"] == "max_speech_ms"


def test_voice_ws_does_not_submit_low_value_endpoint_filler_transcript():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def get_stats(self):
            return {
                "available": True,
                "provider": "endpoint:speaches-stt",
                "model": "Systran/faster-whisper-small.en",
                "language": "en",
                "supports_partial_transcripts": False,
                "supports_incremental_transcripts": False,
                "speech_to_chat_quality": "provider_grade",
            }

        def transcribe(self, _audio_bytes: bytes):
            return "Look, ahem."

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 8000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({
            "type": "voice.audio.end",
            "end_reason": "trailing_silence",
        })
        transcript = websocket.receive_json()

    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "Look, ahem."
    assert transcript["submit_to_chat"] is False
    assert transcript["diagnostics"]["quality_gate"] == "low_value_transcript"


def test_voice_ws_does_not_submit_low_confidence_local_stt(monkeypatch):
    app = FastAPI()
    manager = VoiceSessionManager()

    class LowConfidenceStream:
        def accept_audio(self, audio_bytes: bytes):
            return []

        def append_audio(self, audio_bytes: bytes):
            return None

        def finish(self):
            return [
                {
                    "type": "final",
                    "text": "background speech",
                    "diagnostics": {
                        "provider": "local",
                        "mode": "rolling_buffer",
                        "bytes_received": 12000,
                        "decode_attempt": 1,
                        "decode_ms": 15.0,
                        "avg_logprob": -1.8,
                        "no_speech_prob": 0.92,
                    },
                }
            ]

    class FakeSttService:
        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "tiny",
                "language": "en",
                "supports_partial_transcripts": True,
                "supports_incremental_transcripts": True,
            }

        def start_incremental_stream(self, **_kwargs):
            return LowConfidenceStream()

        def transcribe(self, _audio_bytes: bytes):
            raise AssertionError("batch transcription should not be used")

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 12000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({
            "type": "voice.audio.end",
            "end_reason": "trailing_silence",
        })
        transcript = websocket.receive_json()

    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "background speech"
    assert transcript["submit_to_chat"] is False
    assert transcript["end_reason"] == "trailing_silence"
    assert transcript["diagnostics"]["quality_gate"] == "low_confidence"
    assert transcript["diagnostics"]["avg_logprob"] == -1.8
    assert transcript["diagnostics"]["no_speech_prob"] == 0.92


def test_voice_ws_does_not_submit_local_stt_vad_filter_fallback(monkeypatch):
    app = FastAPI()
    manager = VoiceSessionManager()

    class VadFallbackStream:
        def accept_audio(self, audio_bytes: bytes):
            return []

        def append_audio(self, audio_bytes: bytes):
            return None

        def finish(self):
            return [
                {
                    "type": "final",
                    "text": "hallucinated recovery",
                    "diagnostics": {
                        "provider": "local",
                        "mode": "rolling_buffer",
                        "bytes_received": 12000,
                        "decode_attempt": 2,
                        "decode_ms": 15.0,
                        "avg_logprob": -0.2,
                        "no_speech_prob": 0.05,
                        "vad_filter_retried_without_vad": True,
                    },
                }
            ]

    class FakeSttService:
        def get_stats(self):
            return {
                "available": True,
                "provider": "local",
                "model": "tiny",
                "language": "en",
                "supports_partial_transcripts": True,
                "supports_incremental_transcripts": True,
            }

        def start_incremental_stream(self, **_kwargs):
            return VadFallbackStream()

        def transcribe(self, _audio_bytes: bytes):
            raise AssertionError("batch transcription should not be used")

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"a" * 12000).decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({
            "type": "voice.audio.end",
            "end_reason": "trailing_silence",
        })
        transcript = websocket.receive_json()

    assert transcript["type"] == "voice.transcript.final"
    assert transcript["text"] == "hallucinated recovery"
    assert transcript["submit_to_chat"] is False
    assert transcript["diagnostics"]["quality_gate"] == "vad_filter_fallback"
    assert transcript["diagnostics"]["vad_filter_retried_without_vad"] is True


def test_voice_ws_reports_transcription_unavailable_without_fake_transcript():
    app = FastAPI()
    manager = VoiceSessionManager()

    class FakeSttService:
        def get_stats(self):
            return {
                "available": False,
                "provider": "disabled",
                "model": "base",
                "language": "",
            }

        def transcribe(self, audio_bytes: bytes):
            raise AssertionError("transcribe should not be called when unavailable")

    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=FakeSttService(),
        )
    )
    client = TestClient(app)
    voice_session = client.post("/api/voice/session", json={"session_id": "chat-1"}).json()

    with client.websocket_connect("/api/voice/ws") as websocket:
        assert websocket.receive_json()["type"] == "voice.ready"
        websocket.send_json({
            "type": "voice.audio.start",
            "voice_session_id": voice_session["voice_session_id"],
            "session_id": "chat-1",
            "mime_type": "audio/webm",
        })
        assert websocket.receive_json()["type"] == "voice.audio.started"
        websocket.send_json({
            "type": "voice.audio.chunk",
            "audio": base64.b64encode(b"abc").decode("ascii"),
        })
        assert websocket.receive_json()["type"] == "voice.audio.chunk.received"
        websocket.send_json({"type": "voice.audio.end"})
        error = websocket.receive_json()

    assert error["type"] == "voice.error"
    assert error["code"] == "stt_unavailable"
    assert "text" not in error
