"""Execution narration safety gate for O.R.A.C.L.E."""

from __future__ import annotations

import re
from dataclasses import dataclass


MAX_NARRATION_CHARS = 140

RAW_EVENT_TYPES = {
    "debug",
    "search.results",
    "tool.output",
    "tool.parameters",
    "tool.result",
}

TEMPLATE_NARRATIONS = {
    "agent.run.started": "I'm starting the agent run.",
    "agent.run.working": "I'm working on it.",
    "chat.stream.started": "I'm working on your chat request.",
    "chat.stream.completed": "The chat response is ready.",
    "chat.response.started": "I'm thinking through the response.",
    "coding.started": "I'm updating the implementation.",
    "council.started": "I'm asking the Council to review it.",
    "research.started": "I'm researching the next step.",
    "tests.started": "I'm running checks.",
    "tests.passed": "The checks passed.",
}

MESSAGE_NARRATION_EVENT_TYPES = {
    "tool.started",
    "tool.completed",
    "tool.failed",
    "research.progress",
    "research.sources.ready",
    "research.findings.ready",
    "research.completed",
    "council.workflow.started",
    "council.phase.started",
    "council.workflow.completed",
    "skill.test.started",
    "skill.test.progress",
    "skill.test.evaluating",
    "skill.test.completed",
    "skill.test.failed",
    "code.run.started",
    "code.run.completed",
    "code.run.failed",
    "workspace.preview.started",
    "workspace.preview.ready",
    "workspace.preview.failed",
    "workspace.preview.stopped",
    "compare.run.started",
    "compare.run.completed",
    "compare.run.failed",
    "compare.run.stopped",
    "task.run.started",
    "task.run.completed",
    "task.run.failed",
    "task.run.stopped",
    "cookbook.job.started",
    "cookbook.job.completed",
    "cookbook.job.failed",
    "mcp.marketplace.install.started",
    "mcp.marketplace.install.completed",
    "mcp.marketplace.install.failed",
    "mcp.marketplace.action.started",
    "mcp.marketplace.action.completed",
    "mcp.marketplace.action.failed",
}

RAW_TEXT_PATTERNS = [
    re.compile(r"^\s*[\[{]"),
    re.compile(r"```"),
    re.compile(r"\bTraceback \(most recent call last\)"),
    re.compile(r"\b(File|line)\s+\"[^\"]+\"", re.IGNORECASE),
    re.compile(r"\b(stdout|stderr|stack|exception|tool_call|parameters?)\b", re.IGNORECASE),
    re.compile(r"\b(api[_-]?key|token|secret|password)\b", re.IGNORECASE),
]


@dataclass(frozen=True)
class NarrationDecision:
    should_speak: bool
    text: str = ""
    reason: str = "allowed"

    def as_dict(self) -> dict:
        return {
            "should_speak": self.should_speak,
            "text": self.text,
            "reason": self.reason,
        }


def _normalize_event_type(event_type: str | None) -> str:
    return (event_type or "").strip().lower()


def _clean_message(message: str | None) -> str:
    text = (message or "").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > MAX_NARRATION_CHARS:
        text = text[: MAX_NARRATION_CHARS - 1].rstrip() + "."
    return text


def _looks_raw(message: str) -> bool:
    if not message:
        return False
    if "\n" in message and len(message) > 80:
        return True
    return any(pattern.search(message) for pattern in RAW_TEXT_PATTERNS)


def decide_narration(event_type: str | None, message: str | None = None) -> NarrationDecision:
    """Return a safe speakable narration decision for one runtime event."""

    normalized_event = _normalize_event_type(event_type)
    if not normalized_event:
        return NarrationDecision(False, reason="missing_event_type")

    if normalized_event in RAW_EVENT_TYPES or normalized_event.endswith((".output", ".result", ".parameters")):
        return NarrationDecision(False, reason="raw_internal_event")

    cleaned = _clean_message(message)
    if _looks_raw(cleaned):
        return NarrationDecision(False, reason="raw_internal_payload")

    template = TEMPLATE_NARRATIONS.get(normalized_event)
    if template:
        return NarrationDecision(True, template)

    if cleaned and normalized_event in MESSAGE_NARRATION_EVENT_TYPES:
        return NarrationDecision(True, cleaned)

    if cleaned and normalized_event in {"agent.run.progress", "execution.progress", "voice.presence"}:
        return NarrationDecision(True, cleaned)

    return NarrationDecision(False, reason="unsupported_event_type")
