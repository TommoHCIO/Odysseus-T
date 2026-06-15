# O.R.A.C.L.E. Realtime Voice Control Plane

Last updated: 2026-06-14

## Problem

O.R.A.C.L.E. needs a runtime contract that separates live speech from Odysseus execution. Speech can be interrupted immediately, but Agent Runs, Council workflows, tools, research, and coding work must continue unless the user gives a hard stop.

## Scope

In scope for this slice:

- Create a FastAPI voice control plane under `/api/voice`.
- Track a Voice Session attached to an existing Chat Session.
- Support Soft Interrupt for stopping speech and clearing queued audio without stopping execution.
- Support Hard Interrupt for cancelling speech and the attached Agent Run.
- Expose status and configuration needed by future frontend voice runtime modules.

Out of scope for this slice:

- WebRTC audio streaming.
- Silero VAD integration.
- Incremental Speech-to-Text.
- Streaming Text-to-Speech playback.
- Voice Orb UI.
- Council voice narration.

## Requirements

**FR-001**: Odysseus shall create or resume a Voice Session for an existing Chat Session through `POST /api/voice/session`.

Acceptance criteria:

- The response includes `voice_session_id`, `session_id`, `state`, `speech_state`, and `execution_state`.
- A new Voice Session starts in `listening` state.

**FR-002**: Odysseus shall process a Soft Interrupt through `POST /api/voice/interrupt`.

Acceptance criteria:

- The response state is `interrupted`.
- The response actions include `stop_tts=true` and `clear_audio_queue=true`.
- The response actions include `cancel_execution=false`.
- The attached Agent Run is not stopped.

**FR-003**: Odysseus shall process a Hard Interrupt through `POST /api/voice/cancel`.

Acceptance criteria:

- The response state is `cancelled`.
- The response actions include `cancel_execution=true`.
- If the Voice Session is attached to a Chat Session, the active detached Agent Run stop path is called.

**FR-004**: Odysseus shall expose Voice Session status through `GET /api/voice/status`.

Acceptance criteria:

- The route can look up a Voice Session by `voice_session_id`.
- The route can look up a Voice Session by attached `session_id`.

**FR-005**: Odysseus shall expose O.R.A.C.L.E. control-plane capability metadata through `GET /api/voice/config`.

Acceptance criteria:

- The response identifies the runtime as `oracle`.
- The response declares soft interrupt, hard interrupt, and WebSocket support.
- The response includes SRD latency targets.

## Implementation Decisions

- Voice state is process-local for this slice, matching the existing detached Agent Run durability scope.
- Soft Interrupt returns frontend actions instead of directly manipulating browser audio, because browser TTS/audio queues live client-side.
- Hard Interrupt delegates to the existing detached Agent Run stop path.
- Existing STT/TTS services remain providers; they are not execution engines.

## Verification

Focused automated tests:

```text
python -m pytest tests/test_realtime_voice_routes.py -q
```

Expected result:

```text
5 passed
```

## Next Slices

1. Add frontend voice runtime modules that consume `/api/voice/config`, `/api/voice/session`, `/api/voice/interrupt`, and `/api/voice/cancel`.
2. Add AudioWorklet/WebRTC microphone capture with local silence detection and browser-safe fallback.
3. Add incremental Speech-to-Text stream plumbing.
4. Add Speech Scheduler and Execution Narrator fed by chat/agent stream events.
5. Add Voice Orb UI and visible Chrome QA screenshots.
