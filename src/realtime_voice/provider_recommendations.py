"""Provider-readiness guidance for O.R.A.C.L.E. realtime speech."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


_PROVIDER_RECOMMENDATIONS: Dict[str, Any] = {
    "status": "recommended_not_configured",
    "primary_modular_stack": {
        "stt": "Cartesia Ink 2",
        "tts": "Cartesia Sonic 3.5/Turbo",
        "transport": "persistent_websocket",
        "turn_control": ["manual_finalize", "auto_turn_detection"],
        "keeps_odysseus_as_brain": True,
        "evidence_note": "Best modular O.R.A.C.L.E. fit; strongest latency claims still need local probe validation.",
    },
    "best_public_stt_latency": {
        "provider": "AssemblyAI Universal-3 Pro Streaming",
        "p50_after_vad_ms": 150,
        "p90_after_vad_ms": 240,
        "evidence_note": "Most concrete public STT latency disclosure found in the research report.",
    },
    "full_realtime_benchmark": {
        "primary": "OpenAI Realtime API",
        "runner_up": "Inworld Realtime API",
        "role": "benchmark_or_fallback",
        "reason": "Use full speech-to-speech APIs to compare perceived latency without making them Odysseus' primary brain.",
    },
    "voice_quality_alternates": [
        {
            "stt": "Cartesia Ink 2",
            "tts": "ElevenLabs Flash v2.5",
            "reason": "Strong explicit chunked text-in/audio-out TTS semantics.",
        },
        {
            "stt": "Cartesia Ink 2",
            "tts": "Rime Arcana v3",
            "reason": "Warmer voice quality if a small TTS latency tradeoff is acceptable.",
        },
    ],
    "implementation_blockers": [
        "browser_token_endpoint",
        "streaming_stt_websocket_adapter",
        "streaming_tts_websocket_adapter",
        "persistent_speech_socket_runtime",
        "provider_latency_probe_endpoint",
        "provider_latency_probe",
    ],
    "operational_definition": (
        "A recommended stack becomes operational only after browser-safe provider tokens, "
        "persistent streaming STT/TTS adapters, interrupt-safe audio queueing, and local "
        "latency probes pass in the rebuilt runtime."
    ),
}


def get_provider_recommendations(
    *,
    provider_token_stats: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Return a defensive copy of the researched provider-readiness guidance."""

    recommendations = deepcopy(_PROVIDER_RECOMMENDATIONS)
    completed = [
        "browser_token_endpoint",
        "streaming_stt_websocket_adapter",
        "streaming_tts_websocket_adapter",
        "persistent_stt_socket_reuse",
        "persistent_tts_socket_reuse",
        "answer_highlight_narration",
        "provider_latency_probe_endpoint",
    ]
    blockers = [
        "persistent_speech_socket_runtime",
        "provider_latency_probe",
    ]
    cartesia_stats = (provider_token_stats or {}).get("cartesia") or {}
    if not cartesia_stats.get("available"):
        blockers.insert(0, cartesia_stats.get("setup_blocker") or "cartesia_api_key_missing")
    recommendations["completed_capabilities"] = completed
    recommendations["implementation_blockers"] = blockers
    return recommendations
