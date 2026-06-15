# O.R.A.C.L.E. Frontend Microphone Runtime

Last updated: 2026-06-14

## Problem

O.R.A.C.L.E. needs browser microphone capture before it can support live Speech-to-Text, Voice Activity Detection, or user speech interrupts.

## Scope

In scope for this slice:

- Add a browser microphone capture module for the O.R.A.C.L.E. frontend runtime.
- Request microphone permission only after a Voice Session starts.
- Capture audio chunks with `MediaRecorder`.
- Publish microphone state and buffered audio chunks for future STT/VAD slices.
- Stop microphone tracks on Hard Interrupt.
- Fail safely when microphone capture is unavailable or denied.

Out of scope for this slice:

- Incremental Speech-to-Text.
- Voice Activity Detection.
- Streaming Text-to-Speech.
- WebRTC server transport.
- Saving voice transcripts as Messages or Knowledge.

## Requirements

**FR-001**: O.R.A.C.L.E. shall start browser microphone capture after creating a Voice Session.

Acceptance criteria:

- The runtime calls `getUserMedia` only after `/api/voice/session` succeeds.
- Capture state is published through the existing O.R.A.C.L.E. state event.

**FR-002**: O.R.A.C.L.E. shall capture audio in small chunks.

Acceptance criteria:

- Capture uses `MediaRecorder`.
- Chunks are emitted on a bounded interval.
- Chunks are buffered with a maximum retained count.

**FR-003**: O.R.A.C.L.E. shall fail safely when microphone capture is unavailable.

Acceptance criteria:

- Unsupported browsers report `unavailable`.
- Permission denial reports `denied`.
- The app does not crash when capture cannot start.

**FR-004**: O.R.A.C.L.E. shall release microphone resources on Hard Interrupt.

Acceptance criteria:

- Hard Interrupt stops the `MediaRecorder` when active.
- All microphone tracks are stopped.

## Verification

Focused automated checks:

```text
node --test tests/realtime_voice_frontend.test.js
```

Manual QA for a later browser pass:

- Start O.R.A.C.L.E. and grant microphone permission.
- Confirm the voice button remains active and microphone state becomes `capturing`.
- Deny microphone permission in browser settings and confirm the app reports unavailable/denied without breaking chat.
- Hard-cancel O.R.A.C.L.E. and confirm the browser microphone indicator turns off.
