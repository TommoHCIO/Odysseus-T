"""Interrupt helpers for O.R.A.C.L.E. voice sessions."""

from __future__ import annotations

HARD_INTERRUPT_WORDS = {
    "abort",
    "cancel",
    "cancel that",
    "never mind",
    "nevermind",
    "stop",
    "stop working",
}


def classify_interrupt(text: str) -> str:
    normalized = " ".join((text or "").lower().split())
    if normalized in HARD_INTERRUPT_WORDS:
        return "hard"
    return "soft"

