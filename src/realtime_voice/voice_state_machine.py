"""State names for the realtime voice control plane."""

from __future__ import annotations

from dataclasses import dataclass


IDLE = "idle"
LISTENING = "listening"
TRANSCRIBING = "transcribing"
THINKING = "thinking"
WORKING = "working"
SPEAKING = "speaking"
INTERRUPTED = "interrupted"
CANCELLED = "cancelled"

VOICE_STATES = {
    IDLE,
    LISTENING,
    TRANSCRIBING,
    THINKING,
    WORKING,
    SPEAKING,
    INTERRUPTED,
    CANCELLED,
}

SPEECH_STATES = {IDLE, LISTENING, SPEAKING, INTERRUPTED}
EXECUTION_STATES = {IDLE, THINKING, WORKING, CANCELLED}


@dataclass(frozen=True)
class VoiceActions:
    stop_tts: bool = False
    clear_audio_queue: bool = False
    cancel_execution: bool = False

    def as_dict(self) -> dict:
        return {
            "stop_tts": self.stop_tts,
            "clear_audio_queue": self.clear_audio_queue,
            "cancel_execution": self.cancel_execution,
        }


SOFT_INTERRUPT_ACTIONS = VoiceActions(
    stop_tts=True,
    clear_audio_queue=True,
    cancel_execution=False,
)

HARD_INTERRUPT_ACTIONS = VoiceActions(
    stop_tts=True,
    clear_audio_queue=True,
    cancel_execution=True,
)


def require_voice_state(state: str) -> str:
    if state not in VOICE_STATES:
        raise ValueError(f"Unknown voice state: {state}")
    return state

