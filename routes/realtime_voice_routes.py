"""O.R.A.C.L.E. realtime voice routes."""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import inspect
import re
import time
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.realtime_voice.provider_recommendations import get_provider_recommendations
from src.realtime_voice.provider_tokens import (
    CartesiaProviderTokenService,
    ProviderTokenUnavailable,
    normalize_cartesia_grants,
    normalize_expires_in,
)
from src.auth_helpers import _auth_disabled, get_current_user
from src.settings import load_settings, save_settings
from src.realtime_voice.voice_narration import decide_narration
from src.realtime_voice.voice_narrator import VoiceNarratorQueueFull
from src.realtime_voice.voice_session import VoiceSession, VoiceSessionManager
from src.realtime_voice.voice_state_machine import LISTENING, SPEAKING, TRANSCRIBING, WORKING


class VoiceSessionRequest(BaseModel):
    session_id: Optional[str] = None


class VoiceControlRequest(BaseModel):
    voice_session_id: Optional[str] = None
    session_id: Optional[str] = None
    reason: str = ""


class VoiceSpeakRequest(VoiceControlRequest):
    text: str


class VoiceNarrationRequest(VoiceControlRequest):
    event_type: str
    message: str = ""


class VoiceProviderTokenRequest(BaseModel):
    provider: str = "cartesia"
    grants: Optional[Dict[str, bool]] = None
    expires_in: int = 60


class VoiceProviderLatencyProbeRequest(VoiceProviderTokenRequest):
    pass


class VoicePreferencesRequest(BaseModel):
    mode: str = "hybrid"


class VoiceCartesiaCredentialRequest(BaseModel):
    api_key: str


_DEFAULT_MANAGER = VoiceSessionManager()
_LOCAL_INCREMENTAL_INITIAL_DECODE_BYTES = 12_000
_LOCAL_INCREMENTAL_DECODE_STEP_BYTES = 64_000
_LOCAL_STT_MIN_AVG_LOGPROB = -1.2
_LOCAL_STT_MAX_NO_SPEECH_PROB = 0.6
_LOW_VALUE_TRANSCRIPT_TOKENS = {
    "ahem",
    "ah",
    "er",
    "erm",
    "hmm",
    "hm",
    "look",
    "oh",
    "uh",
    "um",
}
_VOICE_MODES = {"local", "hybrid", "cartesia"}
_CARTESIA_STT_PROXY_PATH = "/api/voice/cartesia-stt/ws"
_CARTESIA_TTS_PROXY_PATH = "/api/voice/cartesia-tts/ws"
_CARTESIA_STT_WEBSOCKET_URL = "wss://api.cartesia.ai/stt/websocket"
_CARTESIA_TTS_WEBSOCKET_URL = "wss://api.cartesia.ai/tts/websocket"
_CARTESIA_STT_MODEL = "ink-2"
_CARTESIA_STT_ENCODING = "pcm_f32le"


def _normalize_voice_mode(mode: Any) -> str:
    normalized = str(mode or "").strip().lower()
    return normalized if normalized in _VOICE_MODES else "hybrid"


def _cartesia_stt_proxy_status(cartesia_stats: Dict[str, Any]) -> Dict[str, Any]:
    available = bool((cartesia_stats or {}).get("available"))
    return {
        "available": available,
        "path": _CARTESIA_STT_PROXY_PATH,
        "setup_blocker": None if available else (cartesia_stats or {}).get("setup_blocker") or "cartesia_api_key_missing",
        "provider": "cartesia",
    }


def _cartesia_tts_proxy_status(cartesia_stats: Dict[str, Any]) -> Dict[str, Any]:
    available = bool((cartesia_stats or {}).get("available"))
    return {
        "available": available,
        "path": _CARTESIA_TTS_PROXY_PATH,
        "setup_blocker": None if available else (cartesia_stats or {}).get("setup_blocker") or "cartesia_api_key_missing",
        "provider": "cartesia",
    }


def _cartesia_stt_websocket_url(
    token_result: Dict[str, Any],
    *,
    sample_rate: int,
    model: str = _CARTESIA_STT_MODEL,
    encoding: str = _CARTESIA_STT_ENCODING,
) -> str:
    query = urlencode({
        "model": model,
        "encoding": encoding,
        "sample_rate": str(max(8000, min(int(sample_rate or 48000), 192000))),
        "cartesia_version": token_result.get("cartesia_version") or "2026-03-01",
        "access_token": token_result.get("token") or "",
    })
    return f"{_CARTESIA_STT_WEBSOCKET_URL}?{query}"


def _cartesia_tts_websocket_url(token_result: Dict[str, Any]) -> str:
    query = urlencode({
        "cartesia_version": token_result.get("cartesia_version") or "2026-03-01",
        "access_token": token_result.get("token") or "",
    })
    return f"{_CARTESIA_TTS_WEBSOCKET_URL}?{query}"


async def _connect_cartesia_websocket(url: str) -> Any:
    import websockets

    return await websockets.connect(url, open_timeout=10, max_size=4 * 1024 * 1024)


def _require_admin_or_single_user(request: Request) -> None:
    if _auth_disabled():
        return
    auth_manager = getattr(getattr(request.app, "state", None), "auth_manager", None)
    if auth_manager is None or not getattr(auth_manager, "is_configured", False):
        return
    user = get_current_user(request)
    if not user or not auth_manager.is_admin(user):
        raise HTTPException(403, "Admin only")


def _default_stop_run(session_id: str) -> bool:
    from src import agent_runs

    return agent_runs.stop(session_id)


def _resolve_voice_session(
    manager: VoiceSessionManager,
    payload: VoiceControlRequest,
) -> VoiceSession:
    voice_session = manager.get(
        voice_session_id=payload.voice_session_id,
        session_id=payload.session_id,
    )
    if not voice_session:
        raise HTTPException(404, "Voice session not found")
    return voice_session


def _with_actions(voice_session: VoiceSession, actions: dict, **extra: Any) -> Dict[str, Any]:
    data = voice_session.as_dict()
    data["actions"] = actions
    data.update(extra)
    return data


def _server_stt_available(stt_stats: Optional[dict]) -> bool:
    stt_provider = (stt_stats or {}).get("provider", "")
    return bool(
        (stt_stats or {}).get("available")
        and stt_provider not in {"", "disabled", "browser"}
    )


def _server_stt_supports_partial(stt_service: Any, stt_stats: Optional[dict]) -> bool:
    return bool(
        _server_stt_available(stt_stats)
        and (stt_stats or {}).get("supports_partial_transcripts")
        and callable(getattr(stt_service, "transcribe_stream", None))
    )


def _is_local_rolling_buffer_stream(stream: Any) -> bool:
    return stream is not None and stream.__class__.__name__ == "LocalIncrementalSTTStream"


def _server_stt_supports_incremental_stream(stt_service: Any, stt_stats: Optional[dict]) -> bool:
    return bool(
        _server_stt_available(stt_stats)
        and (stt_stats or {}).get("supports_incremental_transcripts")
        and callable(getattr(stt_service, "start_incremental_stream", None))
    )


def _server_stt_supports_operational_speech_to_chat(
    stt_service: Any,
    stt_stats: Optional[dict],
) -> bool:
    if not _server_stt_available(stt_stats):
        return False
    quality = str((stt_stats or {}).get("speech_to_chat_quality") or "").strip()
    if quality in {"provider_grade", "operational"}:
        return callable(getattr(stt_service, "transcribe", None)) or _server_stt_supports_incremental_stream(
            stt_service,
            stt_stats,
        )
    if not _server_stt_supports_incremental_stream(stt_service, stt_stats):
        return False
    if (stt_stats or {}).get("provider") == "local":
        return False
    return quality == ""


def _server_tts_stream_available(tts_service: Any, tts_stats: Optional[dict]) -> bool:
    return bool(
        (tts_stats or {}).get("available")
        and (tts_stats or {}).get("supports_chunked_audio_stream")
        and callable(getattr(tts_service, "synthesize_stream", None))
    )


def _speech_to_chat_bridge_status(
    *,
    supports_server_stt_final_utterance: bool,
    supports_partial_transcripts: bool,
    supports_incremental_streaming: bool,
    supports_operational_speech_to_chat: bool,
    stt_setup_blocker: Optional[str] = None,
    speech_to_chat_blocker: Optional[str] = None,
) -> Dict[str, Any]:
    blocking_reason = (
        None
        if supports_operational_speech_to_chat
        else (
            stt_setup_blocker
            if stt_setup_blocker
            else speech_to_chat_blocker
            if speech_to_chat_blocker
            else
            "incremental_stt_bridge_pending"
            if supports_server_stt_final_utterance
            else "server_stt_unavailable"
        )
    )
    return {
        "browser_final_transcript_submit": True,
        "server_final_utterance_submit": supports_server_stt_final_utterance,
        "websocket_final_transcript_submit": supports_server_stt_final_utterance,
        "partial_transcripts": supports_partial_transcripts,
        "incremental_streaming": supports_incremental_streaming,
        "supports_speech_to_chat": supports_operational_speech_to_chat,
        "blocking_reason": blocking_reason,
    }


def _audio_mime(audio_data: bytes) -> str:
    is_mp3 = audio_data[:3] == b"ID3" or (
        len(audio_data) >= 2
        and audio_data[0] == 0xff
        and (audio_data[1] & 0xe0) == 0xe0
    )
    return "audio/mpeg" if is_mp3 else "audio/wav"


def _stt_setup_blocker(stt_stats: Optional[dict]) -> Optional[str]:
    blocker = (stt_stats or {}).get("setup_blocker")
    if blocker in {
        "local_stt_dependency_missing",
        "local_stt_model_unavailable",
        "stt_endpoint_missing",
    }:
        return blocker
    return None


def _normalize_transcript_event(event: Any) -> tuple[str, str]:
    if isinstance(event, str):
        return "partial", event.strip()
    if not isinstance(event, dict):
        return "", ""
    raw_type = str(event.get("type") or event.get("event") or "").strip()
    text = str(event.get("text") or event.get("transcript") or "").strip()
    if raw_type in {"final", "transcript.final", "voice.transcript.final"} or event.get("final") is True:
        return "final", text
    if raw_type in {"partial", "interim", "transcript.partial", "voice.transcript.partial"}:
        return "partial", text
    return "", text


def _transcript_event_diagnostics(event: Any) -> Dict[str, Any]:
    if not isinstance(event, dict):
        return {}
    diagnostics = event.get("diagnostics")
    if not isinstance(diagnostics, dict):
        return {}
    safe: Dict[str, Any] = {}
    for key in ("provider", "mode", "quality_gate"):
        value = diagnostics.get(key)
        if isinstance(value, str) and value:
            safe[key] = value[:80]
    for key in ("bytes_received", "chunk_count", "decode_attempt"):
        value = diagnostics.get(key)
        if isinstance(value, int) and value >= 0:
            safe[key] = value
    for key in ("decode_ms", "avg_logprob", "no_speech_prob", "compression_ratio", "language_probability"):
        value = diagnostics.get(key)
        if isinstance(value, (int, float)):
            safe[key] = value
    for key in ("vad_filter_retried_without_vad",):
        value = diagnostics.get(key)
        if isinstance(value, bool):
            safe[key] = value
    return safe


def _low_value_transcript(text: str) -> bool:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    if not words:
        return True
    if len(words) <= 3 and set(words).issubset(_LOW_VALUE_TRANSCRIPT_TOKENS):
        return True
    return False


def _should_submit_transcript(*, text: str, end_reason: str, diagnostics: Dict[str, Any]) -> bool:
    if end_reason == "max_speech_ms":
        diagnostics["quality_gate"] = "max_duration"
        return False
    if _low_value_transcript(text):
        diagnostics["quality_gate"] = "low_value_transcript"
        return False
    if diagnostics.get("provider") == "local" and diagnostics.get("mode") == "rolling_buffer":
        if diagnostics.get("vad_filter_retried_without_vad") is True:
            diagnostics["quality_gate"] = "vad_filter_fallback"
            return False
        avg_logprob = diagnostics.get("avg_logprob")
        no_speech_prob = diagnostics.get("no_speech_prob")
        if (
            isinstance(avg_logprob, (int, float))
            and avg_logprob < _LOCAL_STT_MIN_AVG_LOGPROB
        ) or (
            isinstance(no_speech_prob, (int, float))
            and no_speech_prob > _LOCAL_STT_MAX_NO_SPEECH_PROB
        ):
            diagnostics["quality_gate"] = "low_confidence"
            return False
        diagnostics["quality_gate"] = "diagnostic_only"
        return False
    return True


async def _iter_transcript_events(stream: Any):
    if inspect.isawaitable(stream):
        stream = await stream
    if hasattr(stream, "__aiter__"):
        async for event in stream:
            yield event
        return
    for event in stream:
        yield event


async def _call_stream_method(stream: Any, method_name: str, *args: Any, **kwargs: Any) -> Any:
    method = getattr(stream, method_name, None)
    if not callable(method):
        return None
    try:
        result = method(*args, **kwargs)
    except TypeError:
        result = method(*args)
    if inspect.isawaitable(result):
        result = await result
    return result


async def _start_incremental_stt_stream(stt_service: Any, *, mime_type: str) -> Any:
    starter = getattr(stt_service, "start_incremental_stream", None)
    if not callable(starter):
        return None
    try:
        stream = starter(mime_type=mime_type)
    except TypeError:
        stream = starter()
    if inspect.isawaitable(stream):
        stream = await stream
    return stream


async def _send_transcript_events(
    websocket: WebSocket,
    *,
    voice_session: VoiceSession,
    session_id: Optional[str],
    mime_type: str,
    events: Any,
    submit_final: bool,
) -> Dict[str, Any]:
    final_text = ""
    final_diagnostics: Dict[str, Any] = {}
    async for event in _iter_transcript_events(events or []):
        event_type, event_text = _normalize_transcript_event(event)
        if not event_text:
            continue
        diagnostics = _transcript_event_diagnostics(event)
        if event_type == "final" and submit_final:
            final_text = event_text
            final_diagnostics = diagnostics
            continue
        if event_type in {"partial", "final"}:
            payload = {
                "type": "voice.transcript.partial",
                "voice_session_id": voice_session.voice_session_id,
                "session_id": session_id,
                "text": event_text,
                "mime_type": mime_type,
                "submit_to_chat": False,
            }
            if diagnostics:
                payload["diagnostics"] = diagnostics
            await websocket.send_json(payload)
    return {"text": final_text, "diagnostics": final_diagnostics}


def setup_realtime_voice_routes(
    *,
    manager: Optional[VoiceSessionManager] = None,
    stop_run: Optional[Callable[[str], bool]] = None,
    verify_owner: Optional[Callable[[Request, str], None]] = None,
    stt_service: Any = None,
    tts_service: Any = None,
    voice_narrator: Any = None,
    provider_token_service: Any = None,
) -> APIRouter:
    voice_manager = manager or _DEFAULT_MANAGER
    stop_active_run = stop_run or _default_stop_run
    token_service = provider_token_service or CartesiaProviderTokenService()
    router = APIRouter(prefix="/api/voice", tags=["voice"])

    def verify(request: Request, session_id: Optional[str]) -> None:
        if verify_owner and session_id:
            verify_owner(request, session_id)

    @router.post("/session")
    async def start_voice_session(request: Request, payload: VoiceSessionRequest) -> Dict[str, Any]:
        verify(request, payload.session_id)
        voice_session = voice_manager.start(payload.session_id)
        return voice_session.as_dict()

    @router.post("/interrupt")
    async def soft_interrupt(request: Request, payload: VoiceControlRequest) -> Dict[str, Any]:
        voice_session = _resolve_voice_session(voice_manager, payload)
        verify(request, voice_session.session_id)
        voice_session, actions = voice_manager.soft_interrupt(voice_session, payload.reason)
        return _with_actions(voice_session, actions.as_dict())

    @router.post("/cancel")
    async def hard_cancel(request: Request, payload: VoiceControlRequest) -> Dict[str, Any]:
        voice_session = _resolve_voice_session(voice_manager, payload)
        verify(request, voice_session.session_id)
        voice_session, actions = voice_manager.hard_cancel(voice_session, payload.reason)
        run_stopped = False
        if voice_session.session_id:
            run_stopped = bool(stop_active_run(voice_session.session_id))
        return _with_actions(voice_session, actions.as_dict(), run_stopped=run_stopped)

    @router.post("/speak")
    async def speak(request: Request, payload: VoiceSpeakRequest):
        text = (payload.text or "").strip()
        if not text:
            raise HTTPException(400, {"message": "Text is required"})

        voice_session = _resolve_voice_session(voice_manager, payload)
        verify(request, voice_session.session_id)

        narrator_stats = None
        if voice_narrator is not None:
            try:
                narrator_stats = voice_narrator.get_stats()
            except Exception:
                narrator_stats = {"backend_tts_available": False}
        use_voice_narrator = bool(
            voice_narrator is not None
            and (narrator_stats or {}).get("backend_tts_available")
            and callable(getattr(voice_narrator, "synthesize", None))
        )

        tts_stats = None
        if not use_voice_narrator and tts_service is not None:
            try:
                tts_stats = tts_service.get_stats()
            except Exception:
                tts_stats = {"available": False}
        if not use_voice_narrator and not _server_tts_stream_available(tts_service, tts_stats):
            raise HTTPException(
                503,
                {"message": "Server Text-to-Speech is not available for O.R.A.C.L.E."},
            )

        if use_voice_narrator:
            try:
                audio = await voice_narrator.synthesize(text)
            except VoiceNarratorQueueFull:
                raise HTTPException(429, {"message": "O.R.A.C.L.E. narrator queue is full"})
            if not audio:
                raise HTTPException(500, {"message": "Speech synthesis failed"})
            first_chunk = audio
            stream = iter(())
            complete_reason = "voice_narrator_complete"
        else:
            stream = iter(tts_service.synthesize_stream(text))
            first_chunk = next(stream, None)
            if not first_chunk:
                raise HTTPException(500, {"message": "Speech synthesis failed"})
            complete_reason = "tts_stream_complete"

        voice_manager.set_state(
            voice_session,
            SPEAKING,
            speech_state=SPEAKING,
            reason=payload.reason or ("voice_narrator" if use_voice_narrator else "tts_stream"),
        )

        def audio_chunks():
            try:
                yield first_chunk
                yield from stream
            finally:
                voice_manager.set_state(
                    voice_session,
                    LISTENING,
                    speech_state=LISTENING,
                    reason=complete_reason,
                )

        return StreamingResponse(
            audio_chunks(),
            media_type=_audio_mime(first_chunk),
            headers={"X-Voice-Session-Id": voice_session.voice_session_id},
        )

    @router.post("/narration")
    async def narration(request: Request, payload: VoiceNarrationRequest) -> Dict[str, Any]:
        voice_session = _resolve_voice_session(voice_manager, payload)
        verify(request, voice_session.session_id)

        decision = decide_narration(payload.event_type, payload.message)
        if decision.should_speak:
            voice_manager.set_state(
                voice_session,
                WORKING,
                execution_state=WORKING,
                reason="narration_preview",
            )

        return {
            "type": "voice.narration",
            "voice_session_id": voice_session.voice_session_id,
            "session_id": voice_session.session_id,
            "event_type": payload.event_type,
            **decision.as_dict(),
        }

    @router.get("/status")
    async def voice_status(
        request: Request,
        voice_session_id: Optional[str] = Query(default=None),
        session_id: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        verify(request, session_id)
        voice_session = voice_manager.get(voice_session_id=voice_session_id, session_id=session_id)
        if not voice_session:
            raise HTTPException(404, "Voice session not found")
        verify(request, voice_session.session_id)
        return voice_session.as_dict()

    @router.get("/config")
    async def voice_config() -> Dict[str, Any]:
        settings = load_settings()
        selected_voice_mode = _normalize_voice_mode(settings.get("oracle_voice_mode"))
        stt_stats = None
        tts_stats = None
        narrator_stats = None
        provider_token_stats = {"cartesia": {"available": False, "setup_blocker": "token_service_unavailable"}}
        supports_server_stt_final_utterance = False
        supports_partial_transcripts = False
        supports_incremental_stt_stream = False
        supports_operational_speech_to_chat = False
        supports_tts_chunked_audio_stream = False
        supports_voice_narrator_queue = False
        if stt_service is not None:
            try:
                stt_stats = stt_service.get_stats()
                supports_server_stt_final_utterance = _server_stt_available(stt_stats)
                supports_partial_transcripts = _server_stt_supports_partial(stt_service, stt_stats)
                supports_incremental_stt_stream = _server_stt_supports_incremental_stream(
                    stt_service,
                    stt_stats,
                )
                supports_operational_speech_to_chat = _server_stt_supports_operational_speech_to_chat(
                    stt_service,
                    stt_stats,
                )
            except Exception:
                stt_stats = {"available": False}
        if tts_service is not None:
            try:
                tts_stats = tts_service.get_stats()
                supports_tts_chunked_audio_stream = bool(
                    (tts_stats or {}).get("available")
                    and (tts_stats or {}).get("supports_chunked_audio_stream")
                )
            except Exception:
                tts_stats = {"available": False}
        if voice_narrator is not None:
            try:
                narrator_stats = voice_narrator.get_stats()
                supports_voice_narrator_queue = bool((narrator_stats or {}).get("running"))
            except Exception:
                narrator_stats = {"running": False}
        if token_service is not None:
            try:
                provider_token_stats = {"cartesia": token_service.get_stats()}
            except Exception:
                provider_token_stats = {
                    "cartesia": {
                        "provider": "cartesia",
                        "available": False,
                        "setup_status": "error",
                        "setup_blocker": "provider_token_stats_failed",
                    }
                }
        cartesia_stats = provider_token_stats.get("cartesia") or {}
        effective_voice_mode = selected_voice_mode
        voice_mode_blocker = None
        if selected_voice_mode == "cartesia" and not cartesia_stats.get("available"):
            voice_mode_blocker = cartesia_stats.get("setup_blocker") or "cartesia_api_key_missing"
        cartesia_stt_proxy = _cartesia_stt_proxy_status(cartesia_stats)
        cartesia_tts_proxy = _cartesia_tts_proxy_status(cartesia_stats)
        return {
            "runtime": "oracle",
            "voice_mode": {
                "selected": selected_voice_mode,
                "effective": effective_voice_mode,
                "available": voice_mode_blocker is None,
                "setup_blocker": voice_mode_blocker,
                "options": ["local", "hybrid", "cartesia"],
            },
            "supports_soft_interrupt": True,
            "supports_hard_interrupt": True,
            "supports_ws": True,
            "supports_speech_to_chat": supports_operational_speech_to_chat,
            "supports_execution_narration_preview": True,
            "supports_server_stt_final_utterance": supports_server_stt_final_utterance,
            "supports_ws_audio_stream": supports_server_stt_final_utterance,
            "supports_partial_transcripts": supports_partial_transcripts,
            "supports_incremental_stt_stream": supports_incremental_stt_stream,
            "supports_tts_chunked_audio_stream": supports_tts_chunked_audio_stream,
            "supports_voice_narrator_queue": supports_voice_narrator_queue,
            "speech_to_chat_bridge": _speech_to_chat_bridge_status(
                supports_server_stt_final_utterance=supports_server_stt_final_utterance,
                supports_partial_transcripts=supports_partial_transcripts,
                supports_incremental_streaming=supports_incremental_stt_stream,
                supports_operational_speech_to_chat=supports_operational_speech_to_chat,
                stt_setup_blocker=_stt_setup_blocker(stt_stats),
                speech_to_chat_blocker=(stt_stats or {}).get("speech_to_chat_blocker"),
            ),
            "stt": stt_stats,
            "tts": tts_stats,
            "voice_narrator": narrator_stats,
            "realtime_provider_tokens": provider_token_stats,
            "cartesia_stt_proxy": cartesia_stt_proxy,
            "cartesia_tts_proxy": cartesia_tts_proxy,
            "provider_recommendations": get_provider_recommendations(
                provider_token_stats=provider_token_stats,
            ),
            "targets_ms": {
                "interruption": 100,
                "speech_start": 500,
                "first_transcript": 300,
                "voice_response": 800,
            },
        }

    @router.post("/preferences")
    async def voice_preferences(request: Request, payload: VoicePreferencesRequest) -> Dict[str, Any]:
        _require_admin_or_single_user(request)
        mode = _normalize_voice_mode(payload.mode)
        settings = load_settings()
        settings["oracle_voice_mode"] = mode
        save_settings(settings)
        return {
            "ok": True,
            "voice_mode": {
                "selected": mode,
                "options": ["local", "hybrid", "cartesia"],
            },
        }

    @router.post("/credentials/cartesia")
    async def voice_cartesia_credentials(
        request: Request,
        payload: VoiceCartesiaCredentialRequest,
    ) -> Dict[str, Any]:
        _require_admin_or_single_user(request)
        api_key = (payload.api_key or "").strip()
        if not api_key:
            raise HTTPException(400, {"message": "Cartesia API key is required"})
        if token_service is None or not callable(getattr(token_service, "store_api_key_file", None)):
            raise HTTPException(
                503,
                {
                    "message": "Cartesia credential storage is unavailable.",
                    "provider": "cartesia",
                    "setup_blocker": "cartesia_credential_storage_unavailable",
                },
            )
        try:
            stats = token_service.store_api_key_file(api_key)
        except ValueError as exc:
            raise HTTPException(400, {"message": str(exc), "provider": "cartesia"}) from exc
        except OSError as exc:
            raise HTTPException(
                500,
                {
                    "message": "Cartesia API key could not be saved.",
                    "provider": "cartesia",
                    "setup_blocker": "cartesia_api_key_file_unwritable",
                },
            ) from exc
        try:
            await asyncio.to_thread(
                token_service.generate_token,
                grants={"stt": True, "tts": True},
                expires_in=30,
            )
        except ProviderTokenUnavailable as exc:
            detail = {
                "message": "Cartesia API key was saved, but token verification failed.",
                "provider": "cartesia",
                "credential_saved": True,
                "setup_blocker": exc.setup_blocker,
            }
            if getattr(exc, "upstream_status_code", None) is not None:
                detail["upstream_status_code"] = exc.upstream_status_code
            raise HTTPException(exc.status_code, detail) from exc
        settings = load_settings()
        settings["oracle_voice_mode"] = "cartesia"
        save_settings(settings)
        safe_stats = dict(token_service.get_stats() if token_service is not None else stats or {})
        safe_stats.pop("api_key", None)
        return {
            "ok": True,
            "provider": "cartesia",
            "credential_saved": True,
            "credential_verified": True,
            "realtime_provider_tokens": {"cartesia": safe_stats},
            "voice_mode": {
                "selected": "cartesia",
                "options": ["local", "hybrid", "cartesia"],
            },
        }

    @router.post("/provider-token")
    async def voice_provider_token(payload: VoiceProviderTokenRequest) -> Dict[str, Any]:
        provider = (payload.provider or "").strip().lower()
        if provider != "cartesia":
            raise HTTPException(
                400,
                {
                    "message": "Unsupported realtime voice provider",
                    "provider": provider or payload.provider,
                },
            )
        stats = token_service.get_stats() if token_service is not None else {}
        if not stats.get("available"):
            raise HTTPException(
                503,
                {
                    "message": "Cartesia browser token generation is not configured.",
                    "provider": "cartesia",
                    "setup_blocker": stats.get("setup_blocker") or "cartesia_api_key_missing",
                },
            )
        try:
            grants = normalize_cartesia_grants(payload.grants)
        except ValueError as exc:
            raise HTTPException(400, {"message": str(exc), "provider": "cartesia"}) from exc
        expires_in = normalize_expires_in(payload.expires_in)
        try:
            return await asyncio.to_thread(
                token_service.generate_token,
                grants=grants,
                expires_in=expires_in,
            )
        except ProviderTokenUnavailable as exc:
            detail = {
                "message": str(exc),
                "provider": "cartesia",
                "setup_blocker": exc.setup_blocker,
            }
            if getattr(exc, "upstream_status_code", None) is not None:
                detail["upstream_status_code"] = exc.upstream_status_code
            raise HTTPException(
                exc.status_code,
                detail,
            ) from exc

    @router.post("/provider-latency-probe")
    async def voice_provider_latency_probe(payload: VoiceProviderLatencyProbeRequest) -> Dict[str, Any]:
        provider = (payload.provider or "").strip().lower()
        if provider != "cartesia":
            raise HTTPException(
                400,
                {
                    "message": "Unsupported realtime voice provider",
                    "provider": provider or payload.provider,
                },
            )
        stats = token_service.get_stats() if token_service is not None else {}
        if not stats.get("available"):
            raise HTTPException(
                503,
                {
                    "message": "Cartesia provider latency probe is not configured.",
                    "provider": "cartesia",
                    "setup_blocker": stats.get("setup_blocker") or "cartesia_api_key_missing",
                },
            )
        try:
            grants = normalize_cartesia_grants(payload.grants)
        except ValueError as exc:
            raise HTTPException(400, {"message": str(exc), "provider": "cartesia"}) from exc
        expires_in = normalize_expires_in(payload.expires_in)
        started = time.perf_counter()
        try:
            token_result = await asyncio.to_thread(
                token_service.generate_token,
                grants=grants,
                expires_in=expires_in,
            )
        except ProviderTokenUnavailable as exc:
            detail = {
                "message": str(exc),
                "provider": "cartesia",
                "setup_blocker": exc.setup_blocker,
            }
            if getattr(exc, "upstream_status_code", None) is not None:
                detail["upstream_status_code"] = exc.upstream_status_code
            raise HTTPException(
                exc.status_code,
                detail,
            ) from exc
        token_ms = round((time.perf_counter() - started) * 1000, 2)
        token_present = bool(str((token_result or {}).get("token") or "").strip())
        return {
            "provider": "cartesia",
            "ok": token_present,
            "token_probe": {
                "ok": token_present,
                "token_ms": token_ms,
                "grants": grants,
                "expires_in": expires_in,
                "auth": (token_result or {}).get("auth") or "access_token_query_param",
                "cartesia_version": (token_result or {}).get("cartesia_version"),
                "token_redacted": True,
            },
        }

    @router.websocket("/cartesia-stt/ws")
    async def voice_cartesia_stt_ws(
        websocket: WebSocket,
        sample_rate: int = Query(default=48000),
        model: str = Query(default=_CARTESIA_STT_MODEL),
        encoding: str = Query(default=_CARTESIA_STT_ENCODING),
    ) -> None:
        await websocket.accept()
        provider_ws = None
        stats = token_service.get_stats() if token_service is not None else {}
        if not stats.get("available"):
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime STT proxy is not configured.",
                "error_code": stats.get("setup_blocker") or "cartesia_api_key_missing",
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return
        try:
            token_result = await asyncio.to_thread(
                token_service.generate_token,
                grants={"stt": True},
                expires_in=120,
            )
            provider_url = _cartesia_stt_websocket_url(
                token_result,
                sample_rate=sample_rate,
                model=model or _CARTESIA_STT_MODEL,
                encoding=encoding or _CARTESIA_STT_ENCODING,
            )
            provider_ws = await _connect_cartesia_websocket(provider_url)
        except ProviderTokenUnavailable as exc:
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime STT proxy token failed.",
                "error_code": exc.setup_blocker,
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return
        except Exception:
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime STT proxy socket failed.",
                "error_code": "cartesia_stt_proxy_socket_failed",
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return

        async def browser_to_provider() -> None:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                data = message.get("bytes")
                if data is not None:
                    await provider_ws.send(data)
                    continue
                text = message.get("text")
                if text is not None:
                    await provider_ws.send(text)

        async def provider_to_browser() -> None:
            async for message in provider_ws:
                if isinstance(message, (bytes, bytearray)):
                    await websocket.send_bytes(bytes(message))
                else:
                    await websocket.send_text(str(message))

        try:
            await websocket.send_json({"type": "ready", "provider": "cartesia", "proxy": True})
            browser_task = asyncio.create_task(browser_to_provider())
            provider_task = asyncio.create_task(provider_to_browser())
            done, pending = await asyncio.wait(
                {browser_task, provider_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in pending:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            for task in done:
                exc = task.exception()
                if exc is not None:
                    raise exc
        except WebSocketDisconnect:
            pass
        except Exception:
            with contextlib.suppress(Exception):
                await websocket.send_json({
                    "type": "error",
                    "message": "Cartesia realtime STT proxy failed.",
                    "error_code": "cartesia_stt_proxy_failed",
                    "provider": "cartesia",
                    "recoverable": True,
                })
        finally:
            if provider_ws is not None:
                with contextlib.suppress(Exception):
                    await provider_ws.close()
            with contextlib.suppress(Exception):
                await websocket.close()

    @router.websocket("/cartesia-tts/ws")
    async def voice_cartesia_tts_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        provider_ws = None
        stats = token_service.get_stats() if token_service is not None else {}
        if not stats.get("available"):
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime TTS proxy is not configured.",
                "error_code": stats.get("setup_blocker") or "cartesia_api_key_missing",
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return
        try:
            token_result = await asyncio.to_thread(
                token_service.generate_token,
                grants={"tts": True},
                expires_in=120,
            )
            provider_url = _cartesia_tts_websocket_url(token_result)
            provider_ws = await _connect_cartesia_websocket(provider_url)
        except ProviderTokenUnavailable as exc:
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime TTS proxy token failed.",
                "error_code": exc.setup_blocker,
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return
        except Exception:
            await websocket.send_json({
                "type": "error",
                "message": "Cartesia realtime TTS proxy socket failed.",
                "error_code": "cartesia_tts_proxy_socket_failed",
                "provider": "cartesia",
                "recoverable": True,
            })
            await websocket.close(code=1011)
            return

        async def browser_to_provider() -> None:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                data = message.get("bytes")
                if data is not None:
                    await provider_ws.send(data)
                    continue
                text = message.get("text")
                if text is not None:
                    await provider_ws.send(text)

        async def provider_to_browser() -> None:
            async for message in provider_ws:
                if isinstance(message, (bytes, bytearray)):
                    await websocket.send_bytes(bytes(message))
                else:
                    await websocket.send_text(str(message))

        try:
            await websocket.send_json({"type": "ready", "provider": "cartesia", "proxy": True})
            browser_task = asyncio.create_task(browser_to_provider())
            provider_task = asyncio.create_task(provider_to_browser())
            done, pending = await asyncio.wait(
                {browser_task, provider_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in pending:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            for task in done:
                exc = task.exception()
                if exc is not None:
                    raise exc
        except WebSocketDisconnect:
            pass
        except Exception:
            with contextlib.suppress(Exception):
                await websocket.send_json({
                    "type": "error",
                    "message": "Cartesia realtime TTS proxy failed.",
                    "error_code": "cartesia_tts_proxy_failed",
                    "provider": "cartesia",
                    "recoverable": True,
                })
        finally:
            if provider_ws is not None:
                with contextlib.suppress(Exception):
                    await provider_ws.close()
            with contextlib.suppress(Exception):
                await websocket.close()

    @router.websocket("/ws")
    async def voice_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        audio_buffer = bytearray()
        incremental_pending_audio = bytearray()
        active_voice_session: Optional[VoiceSession] = None
        active_incremental_stream: Any = None
        next_incremental_decode_bytes = 0
        active_mime_type = "audio/webm"
        try:
            await websocket.send_json({"type": "voice.ready", "runtime": "oracle"})
            while True:
                message = await websocket.receive_json()
                message_type = message.get("type") if isinstance(message, dict) else ""

                if message_type == "voice.audio.start":
                    payload = VoiceControlRequest(
                        voice_session_id=message.get("voice_session_id"),
                        session_id=message.get("session_id"),
                        reason="ws_audio_stream",
                    )
                    active_voice_session = _resolve_voice_session(voice_manager, payload)
                    audio_buffer = bytearray()
                    incremental_pending_audio = bytearray()
                    active_mime_type = message.get("mime_type") or "audio/webm"
                    active_incremental_stream = None
                    next_incremental_decode_bytes = 0
                    stt_stats = None
                    if stt_service is not None:
                        try:
                            stt_stats = stt_service.get_stats()
                        except Exception:
                            stt_stats = {"available": False}
                    if _server_stt_supports_incremental_stream(stt_service, stt_stats):
                        active_incremental_stream = await _start_incremental_stt_stream(
                            stt_service,
                            mime_type=active_mime_type,
                        )
                        if _is_local_rolling_buffer_stream(active_incremental_stream):
                            next_incremental_decode_bytes = _LOCAL_INCREMENTAL_INITIAL_DECODE_BYTES
                    voice_manager.set_state(
                        active_voice_session,
                        TRANSCRIBING,
                        speech_state=TRANSCRIBING,
                        reason="ws_audio_stream",
                    )
                    await websocket.send_json({
                        "type": "voice.audio.started",
                        "voice_session_id": active_voice_session.voice_session_id,
                        "session_id": active_voice_session.session_id,
                        "mime_type": active_mime_type,
                    })
                    continue

                if message_type == "voice.audio.chunk":
                    if active_voice_session is None:
                        await websocket.send_json({
                            "type": "voice.error",
                            "code": "voice_session_required",
                            "message": "Start a voice audio stream before sending chunks.",
                        })
                        continue
                    encoded_audio = message.get("audio", "")
                    try:
                        decoded_audio = base64.b64decode(encoded_audio, validate=True)
                        audio_buffer.extend(decoded_audio)
                        incremental_pending_audio.extend(decoded_audio)
                    except (binascii.Error, TypeError, ValueError):
                        await websocket.send_json({
                            "type": "voice.error",
                            "code": "invalid_audio_chunk",
                            "message": "Audio chunks must be base64 encoded.",
                        })
                        continue
                    await websocket.send_json({
                        "type": "voice.audio.chunk.received",
                        "voice_session_id": active_voice_session.voice_session_id,
                        "bytes_received": len(audio_buffer),
                    })
                    should_decode_incremental = active_incremental_stream is not None
                    if should_decode_incremental and next_incremental_decode_bytes:
                        should_decode_incremental = len(audio_buffer) >= next_incremental_decode_bytes
                    if should_decode_incremental:
                        events = await _call_stream_method(
                            active_incremental_stream,
                            "accept_audio",
                            bytes(incremental_pending_audio),
                        )
                        incremental_pending_audio = bytearray()
                        await _send_transcript_events(
                            websocket,
                            voice_session=active_voice_session,
                            session_id=active_voice_session.session_id,
                            mime_type=active_mime_type,
                            events=events,
                            submit_final=False,
                        )
                        if next_incremental_decode_bytes:
                            while next_incremental_decode_bytes <= len(audio_buffer):
                                next_incremental_decode_bytes += _LOCAL_INCREMENTAL_DECODE_STEP_BYTES
                    continue

                if message_type == "voice.audio.end":
                    if active_voice_session is None:
                        await websocket.send_json({
                            "type": "voice.error",
                            "code": "voice_session_required",
                            "message": "Start a voice audio stream before ending it.",
                        })
                        continue

                    end_reason = str(message.get("end_reason") or "trailing_silence").strip() or "trailing_silence"

                    stt_stats = None
                    if stt_service is not None:
                        try:
                            stt_stats = stt_service.get_stats()
                        except Exception:
                            stt_stats = {"available": False}
                    if not _server_stt_available(stt_stats):
                        voice_manager.set_state(
                            active_voice_session,
                            LISTENING,
                            speech_state=LISTENING,
                            reason="stt_unavailable",
                        )
                        await websocket.send_json({
                            "type": "voice.error",
                            "code": "stt_unavailable",
                            "message": "Server Speech-to-Text is not available for O.R.A.C.L.E. audio streams.",
                            "voice_session_id": active_voice_session.voice_session_id,
                        })
                        continue

                    if not audio_buffer:
                        await websocket.send_json({
                            "type": "voice.error",
                            "code": "empty_audio",
                            "message": "No audio chunks were received.",
                            "voice_session_id": active_voice_session.voice_session_id,
                        })
                        continue

                    text = ""
                    transcript_diagnostics: Dict[str, Any] = {}
                    if active_incremental_stream is not None:
                        if incremental_pending_audio:
                            if callable(getattr(active_incremental_stream, "append_audio", None)):
                                active_incremental_stream.append_audio(bytes(incremental_pending_audio))
                            else:
                                await _call_stream_method(
                                    active_incremental_stream,
                                    "accept_audio",
                                    bytes(incremental_pending_audio),
                                )
                            incremental_pending_audio = bytearray()
                        events = await _call_stream_method(active_incremental_stream, "finish")
                        transcript_result = await _send_transcript_events(
                            websocket,
                            voice_session=active_voice_session,
                            session_id=active_voice_session.session_id,
                            mime_type=active_mime_type,
                            events=events,
                            submit_final=True,
                        )
                        text = str(transcript_result.get("text") or "")
                        transcript_diagnostics = transcript_result.get("diagnostics") or {}
                    elif _server_stt_supports_partial(stt_service, stt_stats):
                        stream = stt_service.transcribe_stream(bytes(audio_buffer))
                        async for event in _iter_transcript_events(stream):
                            event_type, event_text = _normalize_transcript_event(event)
                            if event_type == "partial" and event_text:
                                await websocket.send_json({
                                    "type": "voice.transcript.partial",
                                    "voice_session_id": active_voice_session.voice_session_id,
                                    "session_id": active_voice_session.session_id,
                                    "text": event_text,
                                    "mime_type": active_mime_type,
                                    "submit_to_chat": False,
                                })
                            elif event_type == "final":
                                text = event_text
                    else:
                        text = stt_service.transcribe(bytes(audio_buffer)) if stt_service is not None else None
                    voice_manager.set_state(
                        active_voice_session,
                        LISTENING,
                        speech_state=LISTENING,
                        reason="ws_audio_max_duration" if end_reason == "max_speech_ms" else "ws_audio_transcribed",
                    )
                    if not text:
                        await websocket.send_json({
                            "type": "voice.transcript.empty",
                            "voice_session_id": active_voice_session.voice_session_id,
                            "mime_type": active_mime_type,
                            "submit_to_chat": False,
                            "end_reason": end_reason,
                        })
                        continue
                    submit_to_chat = _should_submit_transcript(
                        text=text,
                        end_reason=end_reason,
                        diagnostics=transcript_diagnostics,
                    )
                    final_payload = {
                        "type": "voice.transcript.final",
                        "voice_session_id": active_voice_session.voice_session_id,
                        "session_id": active_voice_session.session_id,
                        "text": text,
                        "mime_type": active_mime_type,
                        "submit_to_chat": submit_to_chat,
                        "end_reason": end_reason,
                    }
                    if transcript_diagnostics:
                        final_payload["diagnostics"] = transcript_diagnostics
                    await websocket.send_json(final_payload)
                    audio_buffer = bytearray()
                    active_incremental_stream = None
                    continue

                await websocket.send_json({"type": "voice.event", "event": message})
        except WebSocketDisconnect:
            return

    return router
