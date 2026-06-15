"""In-memory O.R.A.C.L.E. voice session state."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Dict, Optional
from uuid import uuid4

from .voice_state_machine import (
    CANCELLED,
    HARD_INTERRUPT_ACTIONS,
    IDLE,
    INTERRUPTED,
    LISTENING,
    SOFT_INTERRUPT_ACTIONS,
    VoiceActions,
    require_voice_state,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class VoiceSession:
    voice_session_id: str
    session_id: Optional[str] = None
    state: str = LISTENING
    speech_state: str = IDLE
    execution_state: str = IDLE
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    interrupt_count: int = 0
    last_reason: str = ""

    def as_dict(self) -> dict:
        return {
            "voice_session_id": self.voice_session_id,
            "session_id": self.session_id,
            "state": self.state,
            "speech_state": self.speech_state,
            "execution_state": self.execution_state,
            "interrupt_count": self.interrupt_count,
            "last_reason": self.last_reason,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class VoiceSessionManager:
    """Tracks live voice session state for the current server process."""

    def __init__(self) -> None:
        self._sessions: Dict[str, VoiceSession] = {}
        self._by_chat_session: Dict[str, str] = {}
        self._lock = RLock()

    def start(self, session_id: Optional[str] = None) -> VoiceSession:
        with self._lock:
            if session_id and session_id in self._by_chat_session:
                existing = self._sessions[self._by_chat_session[session_id]]
                if existing.state != CANCELLED:
                    existing.state = LISTENING
                    existing.updated_at = _now()
                    return existing

            voice_session = VoiceSession(
                voice_session_id=str(uuid4()),
                session_id=session_id,
            )
            self._sessions[voice_session.voice_session_id] = voice_session
            if session_id:
                self._by_chat_session[session_id] = voice_session.voice_session_id
            return voice_session

    def get(
        self,
        voice_session_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Optional[VoiceSession]:
        with self._lock:
            if voice_session_id:
                return self._sessions.get(voice_session_id)
            if session_id:
                mapped = self._by_chat_session.get(session_id)
                if mapped:
                    return self._sessions.get(mapped)
            return None

    def set_state(
        self,
        voice_session: VoiceSession,
        state: str,
        *,
        speech_state: Optional[str] = None,
        execution_state: Optional[str] = None,
        reason: str = "",
    ) -> VoiceSession:
        with self._lock:
            voice_session.state = require_voice_state(state)
            if speech_state is not None:
                voice_session.speech_state = speech_state
            if execution_state is not None:
                voice_session.execution_state = execution_state
            if reason:
                voice_session.last_reason = reason
            voice_session.updated_at = _now()
            return voice_session

    def soft_interrupt(self, voice_session: VoiceSession, reason: str = "") -> tuple[VoiceSession, VoiceActions]:
        with self._lock:
            voice_session.interrupt_count += 1
            self.set_state(
                voice_session,
                INTERRUPTED,
                speech_state=INTERRUPTED,
                reason=reason or "user_speech",
            )
            return voice_session, SOFT_INTERRUPT_ACTIONS

    def hard_cancel(self, voice_session: VoiceSession, reason: str = "") -> tuple[VoiceSession, VoiceActions]:
        with self._lock:
            voice_session.interrupt_count += 1
            self.set_state(
                voice_session,
                CANCELLED,
                speech_state=INTERRUPTED,
                execution_state=CANCELLED,
                reason=reason or "user_cancel",
            )
            return voice_session, HARD_INTERRUPT_ACTIONS

