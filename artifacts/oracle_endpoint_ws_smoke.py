"""Smoke-test O.R.A.C.L.E. websocket STT against the configured endpoint.

Run inside the Odysseus container after the runtime is configured, for example:

    python artifacts/oracle_endpoint_ws_smoke.py --expect hello
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.realtime_voice_routes import setup_realtime_voice_routes
from services.stt.stt_service import get_stt_service
from src.realtime_voice.voice_session import VoiceSessionManager


def _chunks(data: bytes, size: int) -> list[bytes]:
    return [data[index : index + size] for index in range(0, len(data), size)]


def _fail(message: str, result: dict[str, Any]) -> int:
    result["ok"] = False
    result["failure"] = message
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default="artifacts/oracle_sapi_hello.wav")
    parser.add_argument("--expect", default="hello")
    parser.add_argument("--mime-type", default="audio/wav")
    parser.add_argument("--chunk-size", type=int, default=16_384)
    args = parser.parse_args()

    audio_path = Path(args.audio)
    result: dict[str, Any] = {
        "audio": str(audio_path),
        "expected": args.expect,
        "events": [],
    }
    if not audio_path.exists():
        return _fail(f"audio file not found: {audio_path}", result)

    app = FastAPI()
    manager = VoiceSessionManager()
    stt_service = get_stt_service()
    app.include_router(
        setup_realtime_voice_routes(
            manager=manager,
            stop_run=lambda _session_id: False,
            stt_service=stt_service,
        )
    )
    client = TestClient(app)
    config = client.get("/api/voice/config").json()
    result["config"] = {
        "supports_speech_to_chat": config.get("supports_speech_to_chat"),
        "supports_server_stt_final_utterance": config.get("supports_server_stt_final_utterance"),
        "supports_incremental_stt_stream": config.get("supports_incremental_stt_stream"),
        "speech_to_chat_bridge": config.get("speech_to_chat_bridge"),
        "stt": config.get("stt"),
    }
    voice_session = client.post(
        "/api/voice/session",
        json={"session_id": "oracle-endpoint-ws-smoke"},
    ).json()
    audio_bytes = audio_path.read_bytes()
    started = time.perf_counter()
    final_event: dict[str, Any] | None = None

    with client.websocket_connect("/api/voice/ws") as websocket:
        ready = websocket.receive_json()
        result["events"].append(ready)
        websocket.send_json(
            {
                "type": "voice.audio.start",
                "voice_session_id": voice_session["voice_session_id"],
                "session_id": "oracle-endpoint-ws-smoke",
                "mime_type": args.mime_type,
            }
        )
        result["events"].append(websocket.receive_json())
        for chunk in _chunks(audio_bytes, args.chunk_size):
            websocket.send_json(
                {
                    "type": "voice.audio.chunk",
                    "audio": base64.b64encode(chunk).decode("ascii"),
                }
            )
            result["events"].append(websocket.receive_json())
        websocket.send_json({"type": "voice.audio.end"})
        while True:
            event = websocket.receive_json()
            result["events"].append(event)
            if event.get("type") in {"voice.transcript.final", "voice.transcript.empty", "voice.error"}:
                final_event = event
                break

    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    result["elapsed_ms"] = elapsed_ms
    result["final_event"] = final_event
    if not final_event:
        return _fail("missing final websocket event", result)
    if final_event.get("type") != "voice.transcript.final":
        return _fail(f"expected final transcript, got {final_event.get('type')}", result)
    if final_event.get("submit_to_chat") is not True:
        return _fail("final transcript was not marked for chat submission", result)
    text = str(final_event.get("text") or "")
    if args.expect and args.expect.lower() not in text.lower():
        return _fail(f"expected text containing {args.expect!r}, got {text!r}", result)
    result["ok"] = True
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
