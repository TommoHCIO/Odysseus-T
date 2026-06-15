# O.R.A.C.L.E.

Last updated: 2026-06-15

O.R.A.C.L.E. means Odysseus Realtime Adaptive Conversational Listening Engine. It is the named Realtime Voice runtime for Odysseus-T: a live speech communication layer around existing Odysseus execution.

The core rule is simple: speech is not the execution engine. Odysseus can speak, listen, narrate, and accept interruption while Agent Runs, Council workflows, tools, research, coding, tests, and planning continue independently.

## Core Essence

O.R.A.C.L.E. is the voice presence of Odysseus while Odysseus works.

It should feel alive, interruptible, and aware, but it must stay compact and secondary to the real work. The user talks to Odysseus through O.R.A.C.L.E.; O.R.A.C.L.E. does not become a separate assistant, separate chat, separate memory, separate model router, or large floating workspace.

The core UX promise is: the user can speak naturally, stop speech instantly, and still see that Odysseus keeps working unless they deliberately give a Hard Interrupt.

## Sources

- Product vision: `C:\Users\prova\Downloads\O.R.A.C.L.E.pdf`
- Current operator state: [handoff.md](./handoff.md)
- Current parked goal note: [endgoal.md](./endgoal.md)
- Voice glossary: [docs/context/voice/CONTEXT.md](./docs/context/voice/CONTEXT.md)
- Current backend slice: [docs/superpowers/specs/2026-06-14-oracle-realtime-voice-control-plane.md](./docs/superpowers/specs/2026-06-14-oracle-realtime-voice-control-plane.md)

## Product Intent

O.R.A.C.L.E. should make Odysseus feel like an active teammate that can keep working while maintaining a natural conversation.

The user should be able to say something like "Build me a fuel tracking application" and see Odysseus begin work immediately: Council can debate, tools can run, research can proceed, code can be generated, tests can execute, and progress can be narrated without blocking the work.

## Non-Negotiables

- Realtime Voice is a communication runtime, not a replacement for Chat, Agent Runs, Council, tools, or model routing.
- Speech output must never pause execution.
- Soft Interrupt stops spoken output and clears queued audio while work continues.
- Hard Interrupt stops spoken output and cancels the attached Agent Run or Council workflow when possible.
- O.R.A.C.L.E. must reuse existing Odysseus model support, especially `/api/chat_stream`, OpenRouter, Ollama, llama.cpp, vLLM, and OpenAI-compatible endpoints.
- Speech-to-Text and Text-to-Speech providers must remain modular.
- The user must be able to understand that background work is still active.

## Runtime Model

Runtime A is Execution. It owns normal Odysseus work:

- Agent Runs
- Council workflows
- Tool Calls
- shell commands
- browser usage
- research
- coding
- planning
- Knowledge and recall
- RAG

Runtime B is Communication. It owns live voice behavior:

- Voice Session state
- Voice Presence
- Execution Narration
- Voice Scheduler decisions
- Text-to-Speech playback
- Speech-to-Text stream handling
- Soft Interrupt
- Hard Interrupt
- Voice Orb state

Runtime B may stop at any moment. Runtime A continues unless the user gives a Hard Interrupt.

## UI/UX Decisions

- The Voice Orb is the compact always-available O.R.A.C.L.E. control.
- The Voice Orb stays in the composer toolbar for now.
- O.R.A.C.L.E. should not become a large floating assistant widget.
- Clicking the inactive Voice Orb starts or resumes the Voice Session.
- Clicking the active Voice Orb triggers Soft Interrupt by default.
- Hard Interrupt must be a deliberate separate action, such as press-and-hold or a future expanded Voice Panel control.
- The compact Voice Orb shows only voice state, not background work type.
- The Voice Orb should use icon, color, and subtle state animation for quick glance state.
- The Voice Orb should also expose accessible text through labels, titles, or tooltips.
- The Voice Orb should never show live transcript text.
- Background work should appear outside the compact Voice Orb, such as in the existing chat or workspace status surfaces.
- A future Voice Panel may expand from the compact control when transcript, detailed state, or explicit cancellation controls need more room.

## Current Repo State

Implemented backend control plane:

- `routes/realtime_voice_routes.py`
- `src/realtime_voice/voice_session.py`
- `src/realtime_voice/voice_state_machine.py`
- `src/realtime_voice/voice_interrupt.py`
- `/api/voice/session`
- `/api/voice/interrupt`
- `/api/voice/cancel`
- `/api/voice/status`
- `/api/voice/config`
- `/api/voice/ws`
- `/api/voice/narration`
- `/api/voice/config` declares `supports_speech_to_chat` from the configured provider's incremental bridge readiness

Implemented frontend runtime shell:

- `static/js/realtimeVoice.js`
- `static/js/voiceRuntime.js`
- `static/js/voiceMicCapture.js`
- `static/js/voiceActivityDetection.js`
- `static/js/oracleSpeechRecognition.js`
- `static/js/cartesiaRealtimeStt.js`
- `static/js/cartesiaRealtimeTts.js`
- `static/js/voiceOrb.js`
- `static/js/voiceInterrupt.js`
- `static/js/audioPlayback.js`
- `#oracle-voice-btn` in the app shell
- service-worker precache entries for the O.R.A.C.L.E. modules

Recent app-shell cleanup:

- The prominent sidebar Models browser is hidden and removed from Customize UI. Model selection remains in the compact composer model picker.
- The compact icon rail is now suppressed whenever the full sidebar is open, so the app does not show a double rail.
- New Chat in the full sidebar and compact rail is guarded by an early delegated click handler so the exact UI control clears the active Session and returns to a fresh composer.
- The app module cache key is currently `20260614newchat2`.
- The service worker cache is currently `odysseus-v399`.

Verified contracts already present:

- `tests/test_realtime_voice_routes.py`
- `tests/realtime_voice_frontend.test.js`

Current limitation: the repo has the control plane, frontend shell, browser microphone capture, local Web Audio Voice Activity Detection, a browser Speech Recognition fallback that submits final transcripts through the existing chat composer, a server STT final-utterance fallback for browsers without Web Speech when a non-browser STT provider is configured, and a `/api/voice/ws` audio stream bridge that accepts VAD-bounded chunks and returns a final transcript. The Docker runtime now includes a Uvicorn-compatible websocket backend, so browser websocket upgrades reach the FastAPI route instead of degrading to an HTTP 404 upgrade failure. The websocket can forward provider-native `voice.transcript.partial` events after utterance-end transcription, and it now has an optional incremental STT provider seam: when a server STT provider advertises `supports_incremental_transcripts` and exposes `start_incremental_stream`, incoming websocket chunks are offered to that stream immediately, chunk-time partial transcripts are forwarded before `voice.audio.end`, and the final transcript remains gated until utterance end. The bundled local faster-whisper provider now claims that seam only when local STT is enabled and the Whisper model can load; its adapter conservatively re-decodes the accumulated microphone bytes, emits changed partial text before `voice.audio.end`, suppresses punctuation/case/spacing-only partial churn, rejects a one-word final fragment when a longer stable partial exists for the same rolling buffer, emits the final text on stream finish, and attaches redacted diagnostics (`provider`, `mode`, `bytes_received`, `decode_attempt`, `decode_ms`) to websocket partial/final transcript events. Expected early undecodable rolling-buffer probes are treated as debug-level probe misses during incremental `accept_audio(...)`, while final and batch transcription still use normal error logging. Endpoint, browser, disabled, and unavailable local providers do not claim incremental support. The browser runtime now publishes explicit websocket and audio-stream state transitions for that bridge, treats explicit `voice.transcript.empty` events as completed non-submit results, gates websocket final transcript submission on server `submit_to_chat=true`, passes consistent final transcript provenance for browser speech, server final-utterance STT, and websocket STT, carries sanitized provenance into the normal chat submission path, exposes the last final transcript source through runtime status, and exposes the latest redacted websocket STT diagnostics through runtime status without storing transcript text or adding transcript UI. Browser VAD now resumes its Web Audio context on start, and microphone capture restarts the `MediaRecorder` at VAD speech start for server-STT/websocket paths so utterance blobs start at a fresh media-container boundary instead of mid-WebM. Authenticated browser QA has now proven the post-boundary path with generated microphone chunks and forced VAD boundaries: Voice Orb activation, `/api/voice/ws` start/chunks/end, local faster-whisper partial/final transcript, and normal composer submission with `source=voice.websocket` provenance. It has also proven production VAD transition wiring with deterministic analyser samples and no manual runtime VAD event injection: production `OracleVoiceActivityDetector` emitted `speech_start` and `speech_end`, the runtime opened and ended `/api/voice/ws`, and the final transcript submitted with websocket provenance. A newer authenticated browser QA keeps the real browser `AudioContext` and `AnalyserNode`, replaces `getUserMedia` with a browser-generated `AudioContext` destination stream, and proves natural VAD detection over that browser-capturable source through the full websocket/STT/composer path with `source=voice.websocket` provenance and redacted STT diagnostics in both websocket payloads and runtime status. Physical microphone HITL QA has proven both the browser SpeechRecognition-disabled websocket/local-STT path and the Chrome/Web Speech path. `/api/voice/config` now includes `speech_to_chat_bridge` diagnostics that show which final-transcript submit paths are present while reporting incremental bridge support only when an incremental STT provider is actually available. Speech-to-Text stats now also expose setup-check diagnostics (`setup_status`, `setup_blocker`, and local install hints) so O.R.A.C.L.E. can distinguish disabled STT from a configured local provider missing `faster-whisper` or a loadable model. Docker now has an explicit opt-in local STT build path: the default image stays lean, while `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose build odysseus` passes `INSTALL_LOCAL_STT=true` and installs only `requirements-local-stt.txt` for local faster-whisper transcription. The settings tool now recognizes friendly aliases for STT provider, model, language, and an operative local STT model profile; `operative local stt model` maps to `stt_model=base.en`. The local faster-whisper provider now exposes segment-level partial transcript events and a best-effort rolling-buffer incremental stream when its optional dependency/model is available; endpoint, browser, disabled, and unavailable local providers do not claim partial or incremental support. Server Text-to-Speech now exposes `/api/tts/stream` as a chunked audio transport for server TTS providers, and `/api/voice/speak` lets an existing Voice Session stream server TTS audio while moving the Voice Session through speaking back to listening. The browser O.R.A.C.L.E. runtime can request `/api/voice/speak`, play the returned audio, expose local `speaking` state, and stop that playback through Soft or Hard Interrupt. `/api/voice/narration` provides the first deterministic Voice Scheduler safety gate: it previews short speakable execution narration for safe runtime events and suppresses raw internals such as JSON, tool output, stack traces, code blocks, search dumps, and secrets. The browser runtime can consume narration previews, publish whether narration was allowed or suppressed, explicitly speak safe narration through the existing Voice Session speech path when requested, and accept compact `oraclevoice:narration-request` browser events from nearby app surfaces. The chat stream now emits deterministic start/completion narration requests only when O.R.A.C.L.E. is already active, Agent tool lifecycle events now emit deterministic started/completed/failed narration requests from sanitized tool labels only, Deep Research lifecycle events now emit deterministic progress/sources/findings/completion narration requests from whitelisted phase labels only, Council workflow phases now emit deterministic lifecycle narration requests from whitelisted phase labels only, Skill test lifecycle events now emit deterministic started/progress/evaluating/completed/failed narration requests from generic labels only, Code Runner lifecycle events now emit deterministic started/completed/failed narration requests from generic labels only, Workspace Local Preview lifecycle events now emit deterministic started/ready/failed/stopped narration requests from generic labels only, Compare run lifecycle events now emit deterministic started/completed/failed/stopped narration requests from generic labels only, Scheduled Task lifecycle events now emit deterministic started/completed/failed/stopped narration requests from generic labels only, Cookbook model-job lifecycle events now emit deterministic started/completed/failed/stopped narration requests from generic labels only, and MCP Marketplace lifecycle events now emit deterministic started/completed/failed narration requests from generic labels only, so normal chat, tool rendering, research output, Council deliberation, Skill test logs, code block output, preview internals, comparison payloads, scheduled task payloads, Cookbook model job payloads, and MCP Marketplace payloads do not start the microphone or voice session on their own or read raw payloads aloud. Current server providers may still synthesize the whole audio response before yielding chunks, but the browser runtime now has provider-native Cartesia realtime adapters: STT requests a short-lived scoped token, opens Cartesia's manual STT WebSocket, streams raw `pcm_f32le` microphone frames from the active browser `AudioContext`, sends `finalize` when Odysseus VAD detects speech end, keeps the Cartesia STT socket open for the next VAD turn, and submits final text through the existing composer as `source=voice.cartesia_stt`; TTS requests a short-lived scoped token, opens Cartesia's TTS WebSocket, sends an utterance with model/voice/context/raw `pcm_f32le` output settings, plays base64 audio chunks through Web Audio, and lets Soft or Hard Interrupt stop that PCM queue before falling back to server/browser TTS. `/api/voice/config` reports `supports_speech_to_chat=true` only when the server incremental STT-to-chat bridge is backed by an incremental provider; in the current local environment it is true after the opt-in local STT build and settings `local` / `base.en` / `en`, through the conservative faster-whisper rolling-buffer adapter. `/api/voice/config` now also exposes researched `provider_recommendations`, naming Cartesia Ink 2 plus Cartesia Sonic 3.5/Turbo as the primary modular paid stack, and `realtime_provider_tokens`, which reports whether the Cartesia browser access-token broker is ready. `/api/voice/provider-token` can mint short-lived Cartesia browser access tokens with scoped STT/TTS grants when `CARTESIA_API_KEY` is set, without exposing the API key. WebRTC server transport, AudioWorklet processing, provider-grade/Silero VAD, persistent provider TTS socket reuse, clause-level TTS queueing, full automatic Voice Scheduler event-bus wiring beyond these compact Chat/tool/research/Council/Skill-test/Code-run/Workspace-preview/Compare-run/Scheduled-task/Cookbook-job/MCP-Marketplace producers, full Execution Narrator autonomy, live Cartesia token/socket smoke with runtime credentials, provider latency probes, and richer Voice Orb states remain future slices.

## Latest O.R.A.C.L.E. Operational Evidence

Scoped operational definition for this pass: when O.R.A.C.L.E. voice mode is set to Cartesia, answer-highlight output must use Cartesia Nolan through the live runtime path, not browser/default fallback. Tiny presence acknowledgements such as `Got it.` may use fast browser TTS for latency. If live Cartesia TTS fails while Cartesia is explicitly selected for answer speech, O.R.A.C.L.E. must fail closed with an inline/runtime blocker instead of silently switching voices. Voice-originated chat turns must also speak only the answer highlight path, never the legacy whole-response stream from the beginning.

Status on 2026-06-15: complete and operational for proxy-backed Cartesia Nolan answer TTS routing, fast browser presence acknowledgements, and voice-originated answer-highlight exclusivity in the rebuilt local runtime.

Evidence:

- Direct browser Cartesia TTS WebSocket smoke failed before a generation request, so TTS now mirrors STT and uses an Odysseus-owned same-origin proxy at `/api/voice/cartesia-tts/ws`.
- `/api/voice/config` now reports `cartesia_tts_proxy={available,path,setup_blocker,provider}` beside the existing Cartesia token/proxy diagnostics.
- `/api/voice/cartesia-tts/ws` accepts browser WebSocket connections, mints a short-lived server-side Cartesia TTS access token, opens Cartesia's TTS WebSocket from Odysseus, and relays browser/provider messages without exposing the API key or browser token.
- `static/js/cartesiaRealtimeTts.js` now prefers the local proxy when available, sends Nolan voice ID `65209f8e-6140-4a20-b819-3cc2e21da19b`, model `sonic-3.5`, and raw `pcm_f32le` output settings, while retaining the direct token/socket implementation as fallback code.
- `static/js/voiceRuntime.js` lets `lane='presence'` + `mode='fast'` acknowledgements use browser TTS before Cartesia so short phrases such as `Got it.` stay maximally responsive.
- `static/js/voiceRuntime.js` now fails closed in explicit Cartesia mode: a Cartesia TTS failure publishes `speechPlaybackState='cartesia_failed'` and does not fall through to browser/default/server voice. Hybrid mode can still fall back.
- `static/js/cartesiaRealtimeTts.js` now serializes PCM chunk scheduling with `playbackChain`; `done` waits for every queued chunk to be scheduled before waiting for playback end, so the answer-highlight tail is not lost when provider `done` arrives before asynchronous chunk scheduling drains.
- `static/js/voiceRuntime.js` now explicitly mutes voice input during TTS playback: it clears the microphone buffer, stops browser SpeechRecognition with state `muted`, stops any warm Cartesia STT stream with state `muted`, publishes `oraclePlaybackInputMuted`, then clears the buffer again and rearms the appropriate STT path after playback plus the echo-guard tail.
- `static/js/chat.js` disables both legacy `window.aiTTSManager.autoPlay` paths for voice-originated turns: streaming sentence playback and the completion-time full-message enqueue. The answer-highlight narrator remains the only spoken assistant-response lane for O.R.A.C.L.E. speech.
- Service worker cache is now `odysseus-v399`.
- Cartesia STT warm rearming now treats `Cartesia STT is still finalizing the previous turn` as a transient finalize/drain state: the runtime publishes `cartesiaRealtimeSttRewarmDeferred`, stays in `transcribing`, retries the warm STT socket after a short delay, and does not mark Cartesia setup as blocked with `cartesia_stt_socket_failed`.
- Real silent Cartesia/Nolan smoke after rebuild succeeded through the proxy: `canUse=true`, `provider=cartesia`, `streamed=true`, `sawAudio=true`, request voice `{mode:"id", id:"65209f8e-6140-4a20-b819-3cc2e21da19b"}`, 11 audio chunks, 366,912 bytes, and socket URL `ws://127.0.0.1:7000/api/voice/cartesia-tts/ws?cartesia_version=2026-03-01`.
- Verification: `python -m py_compile routes\realtime_voice_routes.py src\realtime_voice\provider_tokens.py` passed; `node --check static\js\cartesiaRealtimeTts.js`, `node --check static\js\voiceRuntime.js`, `node --check static\js\chat.js`, and `node --check static\sw.js` passed; `node --test tests\realtime_voice_frontend.test.js` passed 59/59; `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50; guarded secret scan found no Cartesia key/token outside ignored secret storage; `docker compose up -d --build odysseus` rebuilt/recreated the runtime after scoping `ODYSSEUS_CHOWN_PATHS=/app /app/logs` so startup no longer scans the full `/app/data` bind mount; `/api/health` returned healthy at `2026-06-15T12:55:57.817332`; served assets reported `odysseus-v399`, `/api/voice/cartesia-tts/ws`, `cartesia_tts_proxy`, the Nolan ID, finalizing-race deferred STT rewarm, presence-before-Cartesia routing, serialized PCM playback queueing, playback input mute, and the voice-originated completion autoplay guard. Docker logs showed app startup complete, the voice narrator worker started, Chrome fetching the O.R.A.C.L.E. voice modules, and no fresh Cartesia auth failure after the v399 rebuild.

Remaining loop estimate: 0 loops for the scoped fast-presence plus Cartesia Nolan/proxy/fail-closed answer-highlight path with serialized audio queue drain, playback-time input muting, and non-blocking STT finalizing rewarm. One HITL loop remains only if the definition expands to subjective speaker/headphone confirmation of the live answer audio timbre, volume, echo behavior, and real spoken-turn latency.

Scoped operational definition for this pass: when a chat turn comes from an O.R.A.C.L.E. voice transcript, Odysseus must keep the full assistant response visible in chat while speaking only a short answer highlight. The spoken highlight must skip code fences, file trees, path-heavy lines, tables, command/log-like output, and other syntax-heavy material.

Status on 2026-06-15: complete and operational for bounded voice-originated answer highlight narration in the rebuilt local runtime. This does not attempt semantic LLM summarization; it is a deterministic speech-safety filter and digest for the browser answer lane.

Evidence:

- `static/js/chat.js` removed the streaming answer-clause queue and replaced it with a completion-time answer highlight pass.
- `_oracleCleanSpeakableAssistantText(...)` still strips tool blocks, thinking blocks, code fences, inline markdown chrome, and links, then rejects structured/code-like lines before speech.
- `_oracleBuildAnswerNarration(...)` picks at most three prose sentences and caps spoken answer text at 360 characters.
- Voice-originated turns still get the immediate `Got it.` Voice Presence acknowledgement; at completion, O.R.A.C.L.E. speaks the filtered answer highlight on the `answer` lane, or falls back to the compact `The chat response is ready.` lifecycle line when no safe prose remains.
- `/api/voice/config` now reports `answer_highlight_narration` as the completed capability instead of the older `clause_level_tts_queue` wording.
- Service worker cache is now `odysseus-v391`.
- Verification: `node --check static\js\chat.js` and `node --check static\sw.js` passed; `node --test tests\realtime_voice_frontend.test.js` passed 59/59; `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50 after the provider-capability rename; guarded secret scan found no Cartesia key outside `data/secrets/**`; `docker compose up -d --build odysseus` rebuilt/recreated the runtime; `/api/health` returned healthy at `2026-06-15T11:43:27.841112`; served `sw.js` reported `odysseus-v391`; served `chat.js` exposed `_oracleBuildAnswerNarration` and no `answerClauseQueue`; authenticated Chrome/CDP reported `answer_highlight_narration` in `/api/voice/config` and proved a mocked voice-originated chat turn spoke `Got it.` plus `Here is the plan. The important caveat is that audio stays compact.`, with code/tree fragments excluded from speech.

Remaining loop estimate: 0 loops for the scoped deterministic answer-highlight narrator behavior; 1 future loop only if the goal becomes model-assisted summarization of long answers instead of deterministic filtering.

Scoped operational definition for this pass: when O.R.A.C.L.E. voice mode is set to Cartesia and the Cartesia realtime TTS adapter is ready, all spoken presence and answer-highlight lanes must route to Cartesia first, including short `fast` phrases such as `Got it.`. The configured Cartesia voice must be Nolan (`65209f8e-6140-4a20-b819-3cc2e21da19b`), and the spoken answer highlight should prefer summary/result/caveat/next-step sentences while still skipping code, logs, trees, and other structured output.

Status on 2026-06-15: complete and operational for the scoped Cartesia-first TTS routing and deterministic answer-summary selection in the rebuilt local runtime.

Evidence:

- `static/js/voiceRuntime.js` now attempts Cartesia realtime TTS before the fast browser TTS shortcut, so Cartesia mode no longer silently speaks short presence or answer phrases through the default browser voice.
- `static/js/cartesiaRealtimeTts.js` now uses Nolan voice ID `65209f8e-6140-4a20-b819-3cc2e21da19b`.
- `static/js/chat.js` now scores safe answer sentences for summary/result/done/important/caveat/next/tested cues and deemphasizes code/log/setup phrasing before selecting the spoken answer highlight.
- Service worker cache is now `odysseus-v392`.
- Verification: `node --check static\js\voiceRuntime.js`, `node --check static\js\cartesiaRealtimeTts.js`, `node --check static\js\chat.js`, and `node --check static\sw.js` passed; `node --test tests\realtime_voice_frontend.test.js` passed 59/59; `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50; guarded secret scan found no Cartesia key outside ignored secret storage; `docker compose up -d --build odysseus` rebuilt/recreated the runtime; `/api/health` returned healthy at `2026-06-15T12:03:15.478093`; served assets reported `odysseus-v392`, Nolan ID, Cartesia-before-fast routing, and the answer-summary picker; authenticated Chrome/CDP proved `runtime.speak('Got it.', { lane: 'presence', mode: 'fast' })` produced one Cartesia TTS call, zero browser TTS calls, and playback states `loading -> cartesia_realtime -> idle`.

Remaining loop estimate: 0 loops for this scoped Cartesia-first/Nolan/summary-picker behavior; 1 future HITL loop remains if the definition expands to a subjective real-audio pass against live Cartesia output rather than a browser runtime smoke with the Cartesia adapter mocked.

Scoped operational definition for this pass: O.R.A.C.L.E. in Cartesia mode must accept a clean physical-microphone utterance through the proxy-backed Cartesia realtime STT path, submit exactly one normal chat message with `source=voice.cartesia_stt`, suppress duplicate/echo submissions, keep background/media transcripts out of chat, and surface filtered input inline through compact Voice Presence rather than a mystery failure or global toast.

Status on 2026-06-15: complete and operational for the scoped clean physical microphone Cartesia speech-to-chat path in the rebuilt local runtime. The noisy-room/background-video path is safer and more honest, but still needs a broader subjective/noisy-room pass if "fully operational" includes always-on hands-free listening while speakers or videos are playing.

Evidence:

- `OracleVoiceRuntime` now carries `voiceInputHealth` and `voiceInputRejectCount` in runtime status. Background media transcripts, Oracle playback echo, and duplicate voice transcripts are rejected before chat submission and surfaced as compact `Noise`, `Echo`, or `Repeat` Voice Presence states.
- Rejected transcripts include a short redacted `heardText` diagnostic in runtime state, so QA can distinguish "Cartesia is unavailable" from "Cartesia heard the room instead of the user." Accepted transcripts still preserve the no-transcript-UI rule.
- `voiceOrb.js` renders filtered voice input inline through `#oracle-voice-presence`; `style.css` gives those filtered states a warning treatment; `artifacts/oracle_physical_mic_qa.js` now reports Cartesia/background expected-text failures with the recent heard STT text instead of a generic websocket failure.
- `static/js/cartesiaRealtimeStt.js` guards stale WebSocket event handlers by socket identity, avoiding old socket close/error events poisoning the current warm stream.
- Service worker cache is now `odysseus-v390`.
- Physical microphone QA after rebuild passed with real `Default - Microphone (B microphone) (0d8c:0005)`, production VAD (`speechStarts=2`, `speechEnds=2`, `maxVoiceActivityLevel=0.329714`), Cartesia proxy STT streaming, `browserFinalTranscripts=["Hello.","Hello."]`, exactly one chat message `Hello.`, `source=voice.cartesia_stt`, no unexpected chat messages, and no Cartesia realtime errors. Cartesia socket readiness telemetry reported about `21 ms` for warm socket readiness and final turn diagnostics reported `finalize_to_final_ms=114`.
- Verification: `node --test tests\realtime_voice_frontend.test.js` passed 59/59; `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50; Node syntax checks passed for touched voice assets and the physical QA harness; guarded secret scan found no Cartesia key outside `data/secrets/**`; `docker compose up -d --build odysseus` rebuilt/recreated the runtime; `/api/health` returned healthy; served `sw.js` reported `odysseus-v390`; Docker logs showed `O.R.A.C.L.E. voice narrator worker started` and normal voice control-plane startup.

Remaining loop estimate: 0 loops for this scoped Cartesia clean-mic speech-to-chat goal; 1 loop for a deliberate noisy-room/speaker-echo subjective pass and any follow-up calibration UI if the definition expands to always-on hands-free listening during background media playback.

Scoped operational definition for this pass: O.R.A.C.L.E. must expose measurable Cartesia STT turn latency in runtime state and must apply a conservative voice transcript hygiene pass before any voice-originated text reaches the normal chat/LLM submission path. The pass must reject obvious background-noise transcripts, collapse accidental repeated STT words, apply low-risk speech autocorrections, preserve compact/no-transcript UI, and keep the existing Cartesia proxy path operational.

Status on 2026-06-15: complete and operational for runtime latency telemetry plus pre-submit voice transcript hygiene in the rebuilt local runtime. This does not by itself prove a fresh physical microphone Cartesia speech-to-TTS latency number; that remains one HITL QA loop.

Evidence:

- `static/js/cartesiaRealtimeStt.js` now records `socket_ready_ms`, `turn_to_socket_ready_ms`, `finalize_to_final_ms`, `turn_to_final_ms`, and `transport` for Cartesia STT turns, and emits those diagnostics through state/final transcript callbacks.
- `OracleVoiceRuntime` stores sanitized Cartesia latency diagnostics in `status.cartesiaRealtimeSttLatency`, keeps them in normal `oraclevoice:state` events, and preserves the no-transcript-UI rule.
- `OracleVoiceRuntime.handleFinalTranscript(...)` now routes voice-originated text through `_prepareVoiceTranscriptForChat(...)` before calling `onFinalTranscript(...)`. The filter rejects obvious non-speech/background media markers such as `[music]`, `background noise`, and common video-tail phrases, collapses repeated words such as `hello hello hello`, and corrects low-risk STT spellings such as `oracole`, `cartesha`, `s t t`, and `t t s`.
- Authenticated Chrome/CDP after rebuild and ignore-cache reload reported served service worker `odysseus-v384`, active runtime present, `cartesiaRealtimeSttLatency={provider:"cartesia", transport:"proxy", socket_ready_ms:12, turn_to_socket_ready_ms:20, finalize_to_final_ms:34, turn_to_final_ms:120}`, synthetic `[music]` rejected with `reason=background_noise`, and synthetic `hello hello hello oracole cartesha s t t` submitted as `hello oracle Cartesia STT` with `autocorrected=true`. Screenshot evidence: `artifacts/screenshots/oracle-v384-latency-filter.png`.
- Verification: `node --test tests\realtime_voice_frontend.test.js` passed 58/58; `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50; `python -m compileall routes services -q` passed; `docker compose up -d --build odysseus` rebuilt/recreated the runtime; `/api/health` returned healthy at `2026-06-15T10:44:33.439232`; Docker logs showed `O.R.A.C.L.E. voice narrator worker started` and normal voice control-plane startup.

Scoped operational definition for this pass: Cartesia mode must keep the browser on an Odysseus-owned realtime STT WebSocket, while Odysseus opens Cartesia server-side with a short-lived scoped token. The browser must see Cartesia mode as ready, load the proxy-first STT adapter, open `/api/voice/cartesia-stt/ws`, and receive a proxy-ready event without exposing an API key or browser token.

Status on 2026-06-15: complete and operational for the proxy-backed Cartesia STT socket path in the rebuilt local runtime. This removes the previous direct-browser Cartesia STT socket blocker from the critical voice path; full spoken end-to-end quality still depends on a physical microphone/provider transcript pass.

Evidence:

- `/api/voice/config` now reports `cartesia_stt_proxy={available,path,setup_blocker,provider}` beside `realtime_provider_tokens`.
- `/api/voice/cartesia-stt/ws` accepts browser WebSocket connections, mints a server-side scoped Cartesia STT access token, opens Cartesia's manual STT WebSocket from Odysseus, relays binary microphone frames plus text control messages, and relays provider messages back to the browser.
- `static/js/cartesiaRealtimeStt.js` now uses the local proxy first when `cartesia_stt_proxy.available=true`, while retaining the direct Cartesia token/socket path as a fallback implementation.
- `OracleVoiceRuntime` passes live config into the Cartesia STT adapter so the adapter can choose the proxy path for the current runtime.
- Authenticated Chrome/CDP after rebuild reported `voiceMode.selected=cartesia`, `tokenAvailable=true`, `cartesia_stt_proxy.available=true`, route chip `Cartesia`, presence `Ready`, served service worker `odysseus-v383`, served STT source containing `/api/voice/cartesia-stt/ws` and `buildProxyWebSocketUrl`, no toast text, and browser WebSocket result `{type:"ready", provider:"cartesia", proxy:true}` from `/api/voice/cartesia-stt/ws?sample_rate=16000`. Screenshot evidence: `artifacts/screenshots/oracle-cartesia-proxy-v383.png`.
- Verification: `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 50/50; `node --test tests\realtime_voice_frontend.test.js` passed 57/57; Python and Node syntax checks passed; `docker compose up -d --build odysseus` rebuilt/recreated the runtime; `/api/health` returned healthy at `2026-06-15T10:22:27.638498`; Docker logs showed `/api/voice/config`, fresh `cartesiaRealtimeStt.js`, and accepted `/api/voice/cartesia-stt/ws` with no O.R.A.C.L.E. runtime error.

Scoped operational definition for this pass: Cartesia credentials must only be called ready after a token preflight succeeds; live Cartesia STT socket failures in the browser must become a compact setup/fallback state, not a fatal red toast; browser/server fallback must remain usable so voice can continue while provider-native STT is unavailable.

Status on 2026-06-14: complete and operational for credential preflight plus recoverable Cartesia STT socket-failure UX; not fully operational for direct browser Cartesia STT in this Chrome session because the provider WebSocket did not establish reliably from the browser even though token minting is healthy.

Evidence:

- `/api/voice/credentials/cartesia` now saves the key, immediately mints a short-lived STT/TTS token to verify it, and only switches O.R.A.C.L.E. to Cartesia mode after verification succeeds. Successful responses include `credential_verified=true`; rejected saved keys return a sanitized setup blocker and never return key material.
- `CartesiaProviderTokenService.get_stats()` now distinguishes `credential_available` from token readiness and latches the latest token blocker, so `/api/voice/config` does not claim Cartesia is operational after a known token failure.
- `cartesiaRealtimeStt.js` now marks socket open/error/close failures as recoverable `cartesia_stt_socket_failed`, closes stalled sockets safely, and enforces a 4000 ms connect timeout before falling back.
- `OracleVoiceRuntime` treats Cartesia STT/TTS socket failures as recoverable provider blockers, disables only Cartesia realtime for the current session, and keeps browser SpeechRecognition fallback enabled without emitting the global `O.R.A.C.L.E. STT failed` toast.
- Safe server-side Cartesia STT WebSocket handshake opened with a short-lived token; no token or API key was printed.
- Authenticated Chrome QA after rebuild reported Cartesia mode selected, `tokenStats.available=true`, `setup_status=ready`, provider latency probe 200, generated browser-side Cartesia STT adapter failure `setupBlocker=cartesia_stt_socket_failed`, `runtimeBlocked=true`, `_shouldUseCartesiaRealtimeStt()=false`, `_shouldUseBrowserSpeechRecognition()=true`, `errors=[]`, and no toast text. Screenshot evidence: `artifacts/screenshots/oracle-cartesia-stt-timeout-fallback-v382.png`.
- Verification: `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 49/49; `node --test tests\realtime_voice_frontend.test.js` passed 57/57; JS/Python syntax checks passed; `docker compose up -d --build odysseus` rebuilt the runtime; `/api/health` returned healthy at `2026-06-14T21:51:25.736451`.

Scoped operational definition for this pass: Cartesia mode remains selectable and credential-backed, but a live Cartesia access-token failure must be diagnosed truthfully, shown inline in the compact setup surface, and must not leave O.R.A.C.L.E. in a dead global-error state. Browser/local fallback must stay available after the failure.

Status on 2026-06-14: complete and operational for rejected-key diagnosis and fallback UX; not operational for live Cartesia STT/TTS with the currently saved credential because Cartesia rejects it.

Evidence:

- Cartesia access-token broker now sends only requested true grants, retries Cartesia's documented `X-API-Key` header after bearer auth failure, maps upstream 401/403 to `cartesia_api_key_rejected`, and returns `upstream_status_code` in sanitized provider-token/probe errors.
- Realtime STT/TTS browser adapters parse provider-token error bodies and attach safe `setupBlocker`, `status`, and `recoverable` metadata.
- The browser runtime marks recoverable Cartesia provider-token failures as `cartesiaRealtimeBlocked`, disables Cartesia realtime for the current session, and falls back to browser speech instead of raising the old global `O.R.A.C.L.E. Cartesia STT failed` toast.
- The compact route chip/setup surface switches to `Setup` and shows the blocker, such as `cartesia_api_key_rejected`.
- Safe live broker probe after rebuild reported `configured=true`, `credential_source=file`, then `ok=false`, `setup_blocker=cartesia_api_key_rejected`, and `upstream_status_code=401`. No key or access token was printed.
- Authenticated Chrome QA verified Cartesia mode selected, Test status `cartesia_api_key_rejected`, route chip `Setup`, stale global Cartesia STT error absent, `cartesiaRealtimeBlocked=true`, `_shouldUseCartesiaRealtimeStt()=false`, `_shouldUseBrowserSpeechRecognition()=true`, and no desktop overflow. Screenshot evidence: `artifacts/screenshots/oracle-cartesia-key-rejected-desktop-v381.png` and `artifacts/screenshots/oracle-cartesia-key-rejected-mobile-v381.png`.
- Verification: `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 47/47; `node --test tests\realtime_voice_frontend.test.js` passed 57/57; JS/Python syntax checks passed; `docker compose up -d --build odysseus` rebuilt the runtime; `/api/health` returned healthy at `2026-06-14T21:35:40.171831`.

Scoped operational definition for this pass: Docker Compose starts Odysseus plus a local OpenAI-compatible Speaches STT endpoint; `/api/voice/config` reports endpoint STT ready with no blocker; `/api/voice/ws` accepts bounded audio, returns a final transcript, and marks it `submit_to_chat=true` so the browser runtime can submit it through the normal chat path.

Status on 2026-06-14: complete and operational for the generated-audio endpoint websocket speech-to-chat slice; partially complete for fully hands-free physical microphone use.

Evidence:

- Speaches is compose-managed at `http://speaches:8000/v1` inside Docker and `http://127.0.0.1:8000/v1` on the host.
- `data/settings.json` now selects `stt_provider=endpoint:speaches-stt`, `stt_model=Systran/faster-whisper-tiny`, and `stt_language=en` for the lower-latency endpoint fallback.
- Speaches model discovery lists `Systran/faster-whisper-small.en`, `Systran/faster-whisper-base.en`, and `Systran/faster-whisper-tiny`.
- `services/stt/stt_service.py` now sends endpoint transcriptions with deterministic OpenAI-compatible request fields: `response_format=json` and `temperature=0`.
- `artifacts/oracle_endpoint_ws_smoke.py --expect hello` passed after rebuild with final transcript `Hello Oracle!`, `submit_to_chat=true`, `provider=endpoint:speaches-stt`, and later `model=Systran/faster-whisper-tiny` after latency tuning.
- Later physical-microphone hardening added post-speech non-speech VAD closeout, a speech-peak-relative continuation threshold, a bounded `MediaRecorder.requestData()` flush before `voice.audio.end`, and a server-side `low_value_transcript` quality gate for tiny filler/noise phrases such as `Look, ahem.`.
- Final physical microphone QA passed after rebuild with real microphone input, browser SpeechRecognition disabled, endpoint STT `Systran/faster-whisper-small.en`, `voice.audio.start/chunk/end` over `/api/voice/ws`, final transcript `Hello Oracle!`, one chat submission with `source=voice.websocket`, and no microphone/browser errors. The pass also produced two empty/non-submit websocket transcript results for short non-speech segments.
- Remaining loop estimate: 0 for the scoped physical microphone endpoint speech-to-chat path in a quiet room; 1-2 more if low-latency partial transcripts, provider-native realtime STT, or noisy-room barge-in robustness are included in the definition of "fully operational."

## Requirements

**FR-001**: Odysseus shall create or resume a Voice Session attached to an existing Odysseus Session.

Acceptance criteria:

- `POST /api/voice/session` returns `voice_session_id`, `session_id`, `state`, `speech_state`, and `execution_state`.
- A new Voice Session starts in `listening` state.
- A resumed non-cancelled Voice Session keeps the same `voice_session_id`.

**FR-002**: Odysseus shall support Soft Interrupt without cancelling execution.

Acceptance criteria:

- `POST /api/voice/interrupt` returns `state=interrupted`.
- The response actions include `stop_tts=true`, `clear_audio_queue=true`, and `cancel_execution=false`.
- Browser-side TTS and speech synthesis are stopped optimistically.
- The attached Agent Run is not stopped.

**FR-003**: Odysseus shall support Hard Interrupt for deliberate cancellation.

Acceptance criteria:

- `POST /api/voice/cancel` returns `state=cancelled`.
- The response actions include `cancel_execution=true`.
- If the Voice Session is attached to a Chat Session, the existing detached Agent Run stop path is called.
- Future Council voice work shall cancel the active Council workflow through the existing Council cancellation path.

**FR-004**: Odysseus shall expose O.R.A.C.L.E. runtime configuration.

Acceptance criteria:

- `GET /api/voice/config` returns `runtime=oracle`.
- The response declares support for Soft Interrupt, Hard Interrupt, and WebSocket readiness.
- The response declares `supports_speech_to_chat=true` only when the server Speech-to-Text-to-chat bridge is backed by an available incremental provider.
- The response includes latency targets for interruption, first transcript, speech start, and first audio response.

**FR-007**: Odysseus shall submit browser-recognized speech through the normal chat composer when available.

Acceptance criteria:

- Chrome/Web Speech final transcripts from O.R.A.C.L.E. call the same visible submit path as typed chat.
- Submitted speech preserves existing Chat, Agent, Compare, and Group routing because it uses the existing composer.
- O.R.A.C.L.E. Hard Interrupt stops browser speech recognition cleanup alongside microphone cleanup.
- Clicking the interrupted Voice Orb resumes listening instead of sending another interrupt.

**FR-008**: Odysseus shall detect local voice activity from the active browser microphone stream.

Acceptance criteria:

- O.R.A.C.L.E. publishes speech start, speech end, silence, and audio level state from the active microphone stream when Web Audio is available.
- Voice Activity Detection status is exposed through the microphone/runtime state events without adding transcript UI.
- If user speech starts while O.R.A.C.L.E. is speaking, the runtime triggers Soft Interrupt with `reason=vad_speech_start`.
- If Web Audio Voice Activity Detection is unavailable or fails, microphone capture continues and the runtime stays honest about the unavailable VAD state.

**FR-008A**: Odysseus shall let the user choose the active O.R.A.C.L.E. microphone from the app shell.

Acceptance criteria:

- The composer toolbar exposes a compact `#oracle-mic-select` control next to the Voice Orb.
- The selector enumerates browser `audioinput` devices and persists the chosen device through `OracleMicCapture`.
- Normal O.R.A.C.L.E. startup applies the selected device through exact `deviceId` constraints when available.
- The selector does not add transcript UI or revive the old Voice Panel.

**FR-009**: Odysseus shall support a server Speech-to-Text final-utterance fallback when browser speech recognition is unavailable.

Acceptance criteria:

- `/api/voice/config` exposes `supports_server_stt_final_utterance=true` when a non-browser STT provider is configured and available.
- O.R.A.C.L.E. consumes VAD-bounded microphone audio and posts it to `/api/stt/transcribe` only when browser Web Speech is unavailable.
- When the websocket audio stream bridge is available, the browser runtime shall not also run the older server final-utterance fallback for the same VAD segment.
- Returned server transcripts call the same final-transcript path as browser Speech Recognition, preserving existing composer routing.
- This fallback does not flip `supports_speech_to_chat`; that flag remains reserved for the future server/incremental STT-to-chat bridge.

**FR-010**: Odysseus shall accept VAD-bounded browser audio chunks over the O.R.A.C.L.E. WebSocket.

Acceptance criteria:

- `/api/voice/config` exposes `supports_ws_audio_stream=true` when the configured server STT path can process audio.
- `/api/voice/ws` accepts `voice.audio.start`, `voice.audio.chunk`, and `voice.audio.end` messages for an attached Voice Session.
- The WebSocket returns `voice.transcript.final` with `submit_to_chat=true` after server STT succeeds.
- If server STT is unavailable, the WebSocket returns `voice.error` without fabricating transcript text.
- The browser runtime streams chunks through `/api/voice/ws` when Web Speech is unavailable and the WebSocket stream capability is present.

**FR-011**: Odysseus shall forward provider-native partial transcript events when the selected STT provider supports them.

Acceptance criteria:

- `/api/voice/config` exposes `supports_partial_transcripts=false` for current final-only providers.
- The local faster-whisper provider reports `supports_partial_transcripts=true` only when local STT is enabled and the Whisper model can load.
- A provider that reports `supports_partial_transcripts=true` and implements a streaming transcript method may emit partial transcript events through `/api/voice/ws`.
- `/api/voice/ws` forwards `voice.transcript.partial` events with `submit_to_chat=false`.
- The browser runtime publishes partial transcript state internally without adding transcript UI and without submitting partial text to chat.
- The final transcript remains the only websocket transcript event that can call the existing composer submit path.

**FR-012**: Odysseus shall expose a chunked server Text-to-Speech audio transport.

Acceptance criteria:

- `/api/tts/stream` returns audio bytes with the same provider selection and availability rules as `/api/tts/synthesize`.
- The stream route preserves the correct audio MIME type for MP3 and WAV audio.
- `/api/voice/config` exposes `supports_tts_chunked_audio_stream=true` only when server TTS is available and not browser-only.
- The current chunked transport does not claim provider-native low-latency synthesis; providers may still synthesize the full audio before chunks are sent.

**FR-013**: Odysseus shall let an existing Voice Session stream server Text-to-Speech audio.

Acceptance criteria:

- `POST /api/voice/speak` resolves an existing Voice Session and rejects unknown sessions.
- The endpoint streams audio bytes from server Text-to-Speech with the correct audio MIME type.
- While audio is being produced, the Voice Session state becomes `speaking`.
- After the stream completes, the Voice Session returns to `listening`.
- If server Text-to-Speech is unavailable, the endpoint returns an explicit error without fabricating audio.
- This endpoint is a control-plane speech output surface, not the Voice Scheduler or Execution Narrator.

**FR-014**: Odysseus shall let the browser O.R.A.C.L.E. runtime play Voice Session speech output.

Acceptance criteria:

- The browser runtime exposes a `speak(text)` path that requires non-empty text and an active Voice Session.
- `speak(text)` calls `POST /api/voice/speak` with `voice_session_id`, `session_id`, and text.
- The returned audio bytes are played through browser audio playback without adding transcript UI.
- While playback is active, the compact Voice Orb can reflect local `speaking` state.
- Soft Interrupt and Hard Interrupt stop O.R.A.C.L.E. speech playback through the shared audio interruption path.
- This is a playback consumer for existing speech output, not scheduler-driven Execution Narration.

**FR-015**: Odysseus shall preview safe Execution Narration decisions before automatic narration is wired.

Acceptance criteria:

- `GET /api/voice/config` exposes `supports_execution_narration_preview=true`.
- `POST /api/voice/narration` resolves an existing Voice Session and rejects unknown sessions.
- For safe runtime progress events, the endpoint returns `type=voice.narration`, `should_speak=true`, and a short speakable text.
- For raw internal events such as tool output, tool parameters, search dumps, JSON payloads, stack traces, code blocks, or secret-looking text, the endpoint returns `should_speak=false` with an explicit reason and no fabricated speech.
- Speakable narration preview may mark the attached Voice Session execution state as `working`.
- This is the deterministic safety gate for the Voice Scheduler; it does not yet subscribe to runtime events or automatically call Text-to-Speech.

**FR-016**: Odysseus shall let the browser O.R.A.C.L.E. runtime consume Execution Narration previews.

Acceptance criteria:

- The browser runtime exposes a `narrate(eventType, message, options)` path for runtime activity events.
- `narrate(...)` calls `POST /api/voice/narration` with the active Voice Session, attached Odysseus Session, event type, and message.
- The runtime publishes `narrationState=checking`, then either `allowed`, `suppressed`, or `error` without adding transcript UI.
- If the server suppresses narration, the browser must not call Text-to-Speech or fabricate a replacement phrase.
- If the server allows narration and the caller explicitly passes `speak=true`, the browser may pass the safe text to the existing Voice Session `speak(text)` path.
- This is still a consumer contract, not automatic event-bus subscription.

**FR-017**: Odysseus shall let browser surfaces request O.R.A.C.L.E. narration through a compact event bridge.

Acceptance criteria:

- The browser runtime listens for `oraclevoice:narration-request` events on `window`.
- Event details may provide `eventType` or `event_type`, a `message`, and optional `speak=true`.
- The runtime routes accepted requests through `narrate(eventType, message, { speak })` so `/api/voice/narration` remains the safety gate.
- The event bridge must not add transcript UI, bypass suppression, or fabricate replacement narration.
- This bridge is a browser ingress contract for nearby app surfaces, not full automatic Voice Scheduler wiring across Chat, Agent Runs, Council, tools, research, and tests.

**FR-018**: Odysseus shall request safe O.R.A.C.L.E. narration for Chat stream lifecycle events when voice is already active.

Acceptance criteria:

- Starting a chat stream dispatches `oraclevoice:narration-request` with `eventType=chat.stream.started`.
- Completing a chat stream dispatches `oraclevoice:narration-request` with `eventType=chat.stream.completed`.
- Chat stream narration requests use deterministic status messages and must not include raw assistant text, tool output, accumulated stream text, or hidden prompts.
- Chat stream narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- The server `/api/voice/narration` safety gate remains responsible for deciding whether a requested lifecycle narration can be spoken.
- This is the first Chat lifecycle producer, not full automatic event-bus wiring across all execution surfaces.

**FR-019**: Odysseus shall request safe O.R.A.C.L.E. narration for Agent tool lifecycle events when voice is already active.

Acceptance criteria:

- Starting an Agent tool call dispatches `oraclevoice:narration-request` with `eventType=tool.started`.
- Completing a tool call dispatches `oraclevoice:narration-request` with `eventType=tool.completed`; failed tool results dispatch `eventType=tool.failed`.
- Tool lifecycle narration requests use deterministic status messages derived only from a sanitized, length-bounded tool label.
- Tool lifecycle narration requests must not include raw tool output, command strings, arguments, parameters, progress tails, screenshots, JSON payloads, stack traces, or hidden prompts.
- Tool lifecycle narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- The server `/api/voice/narration` safety gate remains responsible for deciding whether a requested tool lifecycle narration can be spoken.
- This is a compact Agent tool producer, not full automatic Voice Scheduler event-bus wiring across Council, research, tests, or arbitrary runtime events.

**FR-020**: Odysseus shall publish O.R.A.C.L.E. websocket audio stream state through the browser runtime.

Acceptance criteria:

- The browser runtime status exposes `voiceSocketState` for the `/api/voice/ws` connection.
- `voiceSocketState` transitions through at least `connecting`, `connected`, `closed`, and `error` when those websocket events occur.
- The browser runtime status exposes `voiceAudioStreamState` for the active microphone audio stream.
- `voiceAudioStreamState` transitions through `streaming` while chunks are being sent, `transcribing` after `voice.audio.end`, `idle` after a final transcript or socket close, and `error` after websocket audio errors.
- These states publish through the existing `oraclevoice:state` event and do not add transcript UI.
- This observability contract does not flip `supports_speech_to_chat`; the full production server/incremental STT-to-chat bridge remains future work.

**FR-021**: Odysseus shall request safe O.R.A.C.L.E. narration for Deep Research lifecycle events when voice is already active.

Acceptance criteria:

- Research progress dispatches `oraclevoice:narration-request` with `eventType=research.progress`.
- Research source readiness dispatches `eventType=research.sources.ready`.
- Research finding readiness dispatches `eventType=research.findings.ready`.
- Research completion dispatches `eventType=research.completed`.
- Research narration requests use deterministic messages derived only from whitelisted phase labels or generic lifecycle labels.
- Research narration requests must not include research query text, source titles, source URLs, findings, report content, raw `json.data`, model diagnostics, stack traces, or hidden prompts.
- Research narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- The server `/api/voice/narration` safety gate remains responsible for deciding whether a requested Research Job narration can be spoken.
- This is a compact Deep Research producer, not full automatic Voice Scheduler event-bus wiring across all execution surfaces.

**FR-022**: Odysseus shall gate websocket final transcript submission on explicit server intent and preserve transcript provenance.

Acceptance criteria:

- Browser handling of `voice.transcript.final` checks `submit_to_chat=true` before submitting text through the existing composer path.
- If a websocket final transcript omits `submit_to_chat=true`, the browser publishes the final transcript state internally but does not call the composer submission handler.
- Submitted websocket final transcripts include provenance metadata for `source=voice.websocket`, `voiceSessionId`, `sessionId`, `mimeType`, and the normalized submit intent.
- Provider partial transcript events remain internal only and never call the final transcript submission path.
- This contract does not add transcript UI and does not flip `/api/voice/config` `supports_speech_to_chat`; it is a safety/provenance step for the existing VAD-bounded websocket bridge.

**FR-023**: Odysseus shall preserve final transcript provenance for all current browser-side Speech-to-Text submission paths.

Acceptance criteria:

- Browser Web Speech final transcripts call the shared final transcript handler with `source=voice.browser_speech`.
- Server final-utterance STT fallback transcripts call the shared final transcript handler with `source=voice.server_stt_final`.
- Websocket final transcripts keep `source=voice.websocket` and server `submit_to_chat` gating from FR-022.
- Final transcript provenance includes the active `voiceSessionId`, attached `sessionId`, and normalized submit intent when available.
- Server final-utterance STT provenance includes the submitted audio MIME type.
- The provenance contract is published through existing `oraclevoice:state` events and final transcript context; it does not add transcript UI or flip `/api/voice/config` `supports_speech_to_chat`.

**FR-024**: Odysseus shall expose the last final transcript source in O.R.A.C.L.E. runtime status without storing transcript text.

Acceptance criteria:

- `OracleVoiceRuntime.status.lastTranscriptSource` starts as `null`.
- Browser Web Speech, server final-utterance STT fallback, and websocket final transcript paths update `lastTranscriptSource` with normalized provenance.
- Websocket final transcripts that omit `submit_to_chat=true` update `lastTranscriptSource` while still not submitting text through the composer.
- Runtime status must not store final transcript text or add transcript UI.
- This contract does not flip `/api/voice/config` `supports_speech_to_chat`; the full server/incremental STT-to-chat bridge remains future work.

**FR-033**: Odysseus shall carry O.R.A.C.L.E. final transcript provenance through the existing chat submission path.

Acceptance criteria:

- Browser Web Speech, server final-utterance STT, and websocket final transcripts pass their normalized `transcriptSource` context to the app-level final transcript submit handler.
- The app-level handler writes the transcript text only into the existing chat composer and stores the source metadata as a one-shot next-send payload.
- The chat stream request includes `voice_transcript_source` only for the voice-triggered send that consumed that payload.
- Server-side chat handling sanitizes voice transcript source metadata to the allowed fields: `source`, `voiceSessionId`, `sessionId`, `mimeType`, and `submitToChat`.
- Sanitized voice transcript source metadata may be attached to the persisted user message metadata.
- Voice transcript source metadata must not include transcript text, raw audio, partial transcript text, provider payloads, JSON internals, stack traces, or hidden prompts.
- This contract does not add transcript UI and does not flip `/api/voice/config` `supports_speech_to_chat`; the full server/incremental STT-to-chat bridge remains future work.

**FR-034**: Odysseus shall expose honest speech-to-chat bridge readiness diagnostics.

Acceptance criteria:

- `GET /api/voice/config` includes a `speech_to_chat_bridge` object.
- The object reports `browser_final_transcript_submit=true` because browser Web Speech final transcripts can submit through the existing composer path.
- The object reports `server_final_utterance_submit=true` only when a non-browser server Speech-to-Text provider is available.
- The object reports `websocket_final_transcript_submit=true` only when websocket audio streaming can use a server Speech-to-Text provider.
- The object reports whether provider partial transcripts are available.
- The object reports `incremental_streaming=true` only when a server Speech-to-Text provider advertises incremental transcript support and exposes an incremental stream object.
- The object mirrors `supports_speech_to_chat=true` only when the websocket Speech-to-Text-to-chat bridge is backed by that incremental provider seam.
- The object includes a blocking reason such as `server_stt_unavailable` or `incremental_stt_bridge_pending`.

**FR-035**: Odysseus shall support an optional incremental Speech-to-Text provider seam behind the O.R.A.C.L.E. WebSocket.

Acceptance criteria:

- A server Speech-to-Text provider may advertise `supports_incremental_transcripts=true` and expose `start_incremental_stream`.
- `/api/voice/config` reports `supports_incremental_stt_stream=true`, `speech_to_chat_bridge.incremental_streaming=true`, and `supports_speech_to_chat=true` only when that provider seam is present and server Speech-to-Text is available.
- During `/api/voice/ws` audio streaming, each valid `voice.audio.chunk` is passed to the active incremental stream before `voice.audio.end`.
- Chunk-time incremental transcript events are forwarded as `voice.transcript.partial` with `submit_to_chat=false`.
- The final transcript is emitted as `voice.transcript.final` with `submit_to_chat=true` only after `voice.audio.end`.
- If no incremental stream is available, the websocket keeps the existing VAD-bounded final-utterance transcription behavior.
- The local faster-whisper provider exposes `start_incremental_stream` only when local STT is enabled and its Whisper model can load.
- The local incremental stream accumulates audio chunks, re-decodes the accumulated bytes, emits changed partial text before utterance end, and emits final text after `finish()`.
- Endpoint, browser, disabled, and unavailable local providers must report `supports_incremental_transcripts=false`.

**FR-036**: Odysseus shall expose setup-check diagnostics for Speech-to-Text readiness.

Acceptance criteria:

- Speech-to-Text stats include `setup_status` and `setup_blocker`.
- Disabled Speech-to-Text reports `setup_status=disabled` and `setup_blocker=stt_disabled`.
- A configured local provider without the `faster-whisper` dependency reports `setup_status=dependency_missing`, `setup_blocker=local_stt_dependency_missing`, and an install hint.
- A configured local provider whose dependency exists but whose model cannot load reports `setup_status=model_unavailable` and `setup_blocker=local_stt_model_unavailable`.
- `/api/voice/config.speech_to_chat_bridge.blocking_reason` surfaces actionable local Speech-to-Text setup blockers before falling back to generic `server_stt_unavailable`.

**FR-037**: Odysseus shall provide an opt-in Docker build path for local Speech-to-Text dependencies.

Acceptance criteria:

- The default Docker image does not install local faster-whisper Speech-to-Text dependencies.
- `ODYSSEUS_INSTALL_LOCAL_STT=true` passes `INSTALL_LOCAL_STT=true` to the `odysseus` service build.
- `requirements-local-stt.txt` contains the local Speech-to-Text dependency set and does not pull unrelated optional packages such as document ingestion extras.
- An opt-in image can import `faster_whisper`, `ctranslate2`, and `av`.
- The `whatsapp-bridge` service stays on the default build path and does not receive the local STT build arg.

**FR-038**: Odysseus shall let operators configure Speech-to-Text provider, model, and language through friendly settings-tool aliases.

Acceptance criteria:

- `manage_settings` accepts a friendly alias for the Speech-to-Text provider and writes `stt_provider`.
- `manage_settings` accepts a friendly alias for the Speech-to-Text model and writes `stt_model`.
- `manage_settings` accepts a friendly alias for the Speech-to-Text language and writes `stt_language`.
- The raw settings keys remain supported.
- Enabling local STT with an installed dependency and loadable model makes `/api/voice/config` report ready local STT and the incremental speech-to-chat bridge.

**FR-039**: Odysseus shall include a runtime websocket backend for O.R.A.C.L.E. browser audio streaming.

Acceptance criteria:

- The default runtime requirements include a Uvicorn-compatible websocket backend.
- A rebuilt Docker image can import that websocket backend.
- Browser websocket upgrades to `/api/voice/ws` are accepted by Uvicorn/FastAPI.
- The browser runtime can send `voice.audio.start`, `voice.audio.chunk`, and `voice.audio.end` to `/api/voice/ws`.
- The server returns websocket control events such as `voice.ready`, `voice.audio.started`, `voice.audio.chunk.received`, and either a transcript event or an explicit empty/error event.

**FR-040**: Odysseus shall keep VAD-bounded server-STT/browser websocket audio at valid media boundaries and complete empty transcript states cleanly.

Acceptance criteria:

- Browser Voice Activity Detection resumes its Web Audio context when starting so analysers do not remain stuck in flat silence on browsers that create suspended contexts.
- When server Speech-to-Text or websocket audio streaming will consume VAD-bounded microphone audio, the browser restarts the `MediaRecorder` at speech start and clears the previous buffer before collecting utterance chunks.
- The restarted recorder preserves the active microphone stream and does not stop tracks during the boundary reset.
- The websocket path starts after the speech-boundary recorder reset so the first submitted utterance chunk can include a fresh media-container header.
- Browser handling of `voice.transcript.empty` resets websocket audio state to idle, publishes `serverTranscriptionState=ready`, records `source=voice.websocket` provenance with `submitToChat=false`, and does not call the composer submission handler.
- This contract does not claim provider-grade low-latency STT; it makes the current VAD-bounded browser container and empty-result states robust enough for local/server STT QA.

**FR-041**: Odysseus shall expose redacted incremental Speech-to-Text diagnostics on O.R.A.C.L.E. websocket transcript events.

Acceptance criteria:

- Local rolling-buffer incremental STT partial and final events include diagnostics for provider, mode, bytes received, decode attempt, and decode milliseconds.
- O.R.A.C.L.E. websocket `voice.transcript.partial` and `voice.transcript.final` events preserve those diagnostics through an allowlist.
- `OracleVoiceRuntime.status.lastTranscriptDiagnostics` starts as `null` and updates from the latest websocket partial/final transcript diagnostics.
- Transcript-like fields such as text or transcript are not copied into the diagnostics object.
- Runtime status must not store final transcript text or add transcript UI.
- Real-analyser browser QA fails if websocket partial/final transcript diagnostics or runtime-status diagnostics disappear.
- These diagnostics are operational observability for the current conservative adapter, not a claim of provider-grade low-latency STT.

**FR-042**: Odysseus shall suppress punctuation-only partial transcript churn in the local rolling-buffer Speech-to-Text stream.

Acceptance criteria:

- The local rolling-buffer incremental stream compares partial transcript updates with a normalized key that ignores case, punctuation, and spacing.
- A partial transcript that only changes punctuation, casing, or whitespace from the last emitted partial is not forwarded as a new partial.
- A partial transcript that adds or changes actual words is still forwarded.
- The final transcript remains raw provider text and is still emitted after `finish()`.
- Redacted diagnostics remain attached to forwarded partial and final events.
- This is a conservative quality guard for the local rolling-buffer adapter, not a replacement for provider-grade low-latency STT.

**FR-043**: Odysseus shall avoid replacing a longer stable rolling-buffer transcript with a short final fragment.

Acceptance criteria:

- When local rolling-buffer `finish()` receives a one-word final transcript but the same stream has already emitted a stable partial with at least three words, the stream keeps the longer partial text as the final transcript.
- Legitimate short utterances still emit when no longer stable partial exists in the same stream.
- The chosen final transcript keeps the final decode diagnostics.
- This guard applies only to the conservative local rolling-buffer stream and does not change browser Speech Recognition, endpoint STT, or provider-native final transcript behavior.
- This is a quality guard against fragment finals, not provider-grade segmentation.

**FR-044**: Odysseus shall not auto-submit websocket Speech-to-Text results from max-duration VAD segments.

Acceptance criteria:

- Browser Voice Activity Detection publishes why a speech segment ended, using `trailing_silence` for normal silence boundaries and `max_speech_ms` for the safety cap.
- The browser O.R.A.C.L.E. runtime sends the sanitized `end_reason` on `/api/voice/ws` `voice.audio.end`.
- The websocket route may return a diagnostic final transcript for `max_speech_ms` segments, but it sets `submit_to_chat=false`.
- The browser runtime records the final transcript source with `submitToChat=false` and does not call the composer submit path for that result.
- This guard prevents long or background audio captured up to the max-speech safety cap from becoming an unintended user command. It does not solve provider-grade STT quality, latency, or noise isolation.

**FR-045**: Odysseus shall quality-gate local rolling-buffer websocket transcripts before chat submission.

Acceptance criteria:

- Local faster-whisper transcription events expose redacted quality diagnostics, including average log probability, no-speech probability, compression ratio, and language probability when available.
- The local rolling-buffer incremental stream preserves those diagnostics on partial and final transcript events.
- `/api/voice/ws` suppresses `submit_to_chat` for local rolling-buffer final transcripts that are below the configured confidence floor or above the configured no-speech probability ceiling.
- Suppressed local final transcripts remain visible as websocket transcript events with diagnostics, but the browser does not call the composer submit path.
- The browser runtime preserves redacted quality diagnostics in `lastTranscriptDiagnostics` without storing transcript text or rendering transcript UI.
- This is a safety and observability gate for the current local adapter, not a replacement for provider-grade streaming Speech-to-Text.

**FR-046**: Odysseus shall end websocket audio streams by wall-clock timeout even if Voice Activity Detection does not emit `speech_end`.

Acceptance criteria:

- The browser O.R.A.C.L.E. runtime starts a wall-clock max-stream timer when `/api/voice/ws` audio streaming starts.
- If no VAD `speech_end` arrives within the max stream window, the runtime sends `voice.audio.end` with `end_reason=max_speech_ms`.
- The runtime clears the max-stream timer on normal audio end, websocket close, websocket error, empty transcript, and final transcript handling.
- This failsafe prevents a stuck websocket audio stream when browser analyser sampling or VAD silence detection does not close the segment.

**FR-047**: Odysseus shall use adaptive browser Voice Activity Detection thresholds for soft physical microphones.

Acceptance criteria:

- Browser Voice Activity Detection tracks a smoothed microphone noise floor while idle.
- Browser Voice Activity Detection publishes `noiseFloor`, `adaptiveSpeechThreshold`, `adaptiveSilenceThreshold`, and `listeningMs` in activity status for HITL diagnostics.
- Speech start uses a lower absolute soft-mic threshold after a short startup noise warmup so brief physical-mic peaks can start a segment without immediately treating startup ambient noise as speech.
- Speech end uses adaptive silence and relative quiet thresholds so a segment can close by `trailing_silence` before the max-duration safety path when the user stops speaking.
- The wall-clock max-stream and local transcript quality gates remain required safety backstops; adaptive VAD is not transcript-quality or provider-latency evidence by itself.

**FR-048**: Odysseus shall expose researched realtime speech provider recommendations without claiming they are configured.

Acceptance criteria:

- `/api/voice/config` includes `provider_recommendations`.
- The recommendations identify Cartesia Ink 2 plus Cartesia Sonic 3.5/Turbo as the primary modular paid stack and preserve that Odysseus remains the brain.
- The recommendations identify AssemblyAI Universal-3 Pro Streaming as the best public STT latency evidence and OpenAI Realtime API as the full realtime benchmark.
- The recommendations list implementation blockers before the stack can be called operational, including missing runtime credentials, persistent speech runtime proof, and provider latency probes.
- The recommendations do not include provider secrets, runtime credentials, or hidden API keys.

**FR-049**: Odysseus shall issue short-lived browser access tokens for the selected modular realtime speech provider.

Acceptance criteria:

- `GET /api/voice/config` includes `realtime_provider_tokens.cartesia`.
- The Cartesia token diagnostics report `available=true` only when the server has Cartesia credentials from `CARTESIA_API_KEY`, `CARTESIA_API_KEY_FILE`, or a default mounted secret-file location.
- `POST /api/voice/provider-token` supports provider `cartesia`.
- The endpoint returns a short-lived access token with scoped `stt` and/or `tts` grants and `auth=access_token_query_param`.
- The endpoint rejects unknown providers and grantless Cartesia requests.
- Missing Cartesia configuration returns an explicit setup blocker without fabricating a token.
- The endpoint never returns, logs, or documents the Cartesia API key or secret-file contents.

**FR-050**: Odysseus shall play provider-native Cartesia realtime Text-to-Speech through the browser before falling back to server or browser synthesis.

Acceptance criteria:

- The browser runtime tries Cartesia realtime TTS only when `/api/voice/config` reports `realtime_provider_tokens.cartesia.available=true`.
- The browser token request asks `/api/voice/provider-token` for provider `cartesia` with `grants.tts=true`.
- The Cartesia browser WebSocket URL uses `cartesia_version` and `access_token` query parameters.
- The generation request includes model, voice, language, `context_id`, and raw `pcm_f32le` output format.
- The runtime decodes base64 `chunk` messages and plays them through Web Audio without adding transcript UI.
- Soft Interrupt and Hard Interrupt stop the active Cartesia PCM playback queue.
- Cartesia token or WebSocket failures fall back to the existing server/browser TTS path and publish a redacted runtime error.

**FR-051**: Odysseus shall stream browser microphone audio to Cartesia realtime Speech-to-Text before falling back to browser or server speech recognition.

Acceptance criteria:

- The browser runtime uses Cartesia realtime STT only when `/api/voice/config` reports `realtime_provider_tokens.cartesia.available=true`.
- The browser token request asks `/api/voice/provider-token` for provider `cartesia` with `grants.stt=true`.
- The Cartesia STT WebSocket URL uses `model=ink-2`, `encoding=pcm_f32le`, `sample_rate`, `cartesia_version`, and `access_token` query parameters.
- The browser streams raw microphone frames from the active `AudioContext`/microphone stream as binary WebSocket messages.
- The runtime sends `finalize` when O.R.A.C.L.E. Voice Activity Detection emits speech end.
- Partial transcript events may update internal runtime status but must not submit text to chat or render a transcript panel.
- Final transcript chunks are assembled after Cartesia `flush_done`/`done` and submitted through the existing composer with `source=voice.cartesia_stt`.
- Cartesia STT errors stop the provider stream, publish redacted error state, and leave browser/server fallback paths available when Cartesia is not configured.

**FR-052**: Odysseus shall reuse the Cartesia realtime Speech-to-Text socket across user turns.

Acceptance criteria:

- Starting a new Cartesia STT turn reuses an existing open or connecting Cartesia STT WebSocket instead of always closing and reopening it.
- `finalize` ends only the current user turn, not the provider WebSocket.
- `flush_done` or `done` flushes the current final transcript, clears the finalizing state, and leaves the socket ready for the next turn when still open.
- Hard Interrupt, microphone stop, or explicit runtime cleanup closes the Cartesia STT socket.
- If a new user turn starts while the previous turn is still finalizing, the runtime reports a redacted provider state error rather than overlapping two turns on one manual-finalize socket.

**FR-053**: Odysseus shall reuse the Cartesia realtime Text-to-Speech socket across spoken utterances.

Acceptance criteria:

- Starting a new Cartesia TTS utterance reuses an existing open or connecting Cartesia TTS WebSocket instead of always closing and reopening it.
- Each spoken utterance uses a fresh Cartesia `context_id` so audio chunks, `done`, and errors are routed only to the active request.
- Soft Interrupt or a newer spoken turn stops local PCM playback immediately and sends a Cartesia context cancel message for the active context when the socket is open.
- Normal Cartesia `done` completion waits for queued PCM playback to drain and then resolves the utterance without closing the provider WebSocket.
- Cartesia TTS socket close or error rejects the active request, clears the active playback queue, and leaves server/browser TTS fallback paths available.
- The readiness diagnostics may mark persistent TTS socket reuse complete while still keeping live provider credentials and provider latency probes as blockers for full paid-provider operation.

**FR-054**: Odysseus shall narrate bounded answer highlights for voice-originated assistant responses.

Acceptance criteria:

- When a submitted chat turn came from an O.R.A.C.L.E. voice transcript, the full assistant response remains visible in Chat.
- At stream completion, O.R.A.C.L.E. builds one bounded spoken highlight from safe prose instead of reading the whole response or streaming every answer clause.
- The highlight filter strips tool blocks, thinking blocks, code fences, markdown chrome, links, file trees, path-heavy lines, tables, command/log-like output, and syntax-heavy fragments before speech.
- The spoken highlight is capped to a few prose sentences and a small character budget, never adds transcript UI, and uses the existing `answer` speech lane.
- If no safe prose remains after filtering, O.R.A.C.L.E. speaks only the compact completion lifecycle phrase.
- The readiness diagnostics may mark answer-highlight narration complete while still keeping live provider credentials, persistent provider runtime proof, and provider latency probes as blockers for full paid-provider operation.

**FR-055**: Odysseus shall support secret-file Cartesia credential ingress without storing provider secrets in source.

Acceptance criteria:

- `CartesiaProviderTokenService` can read a Cartesia API key from `CARTESIA_API_KEY_FILE` or a default mounted secret-file location when `CARTESIA_API_KEY` is not present.
- If the service started before the secret file existed, later config/probe calls re-check the configured or default secret-file path while the process is running.
- `/api/voice/config` reports whether Cartesia credentials are available and the redacted credential source category (`env`, `file`, or `missing`).
- Missing, unreadable, or empty secret files return setup blockers without echoing the file path or contents.
- `docker-compose.yml` passes `CARTESIA_API_KEY_FILE` through to the Odysseus service without committing any key material.
- `scripts/set_cartesia_secret.ps1` provides a local no-echo prompt that writes the key to the default Docker-mounted secret-file path.

**FR-056**: Odysseus shall expose a redacted Cartesia provider latency probe.

Acceptance criteria:

- `POST /api/voice/provider-latency-probe` supports provider `cartesia`.
- The probe mints a short-lived scoped provider token server-side and reports elapsed token-mint time in milliseconds.
- The probe response includes grants, expiry, auth mode, Cartesia API version, and `token_redacted=true`, but never returns the provider token or API key.
- Missing provider credentials return a sanitized setup blocker.
- Readiness diagnostics may mark the probe endpoint complete while keeping live provider probe success as a blocker until it passes in the rebuilt runtime with real credentials.

**FR-057**: Odysseus shall show and control the active O.R.A.C.L.E. voice route as compact Voice Presence instrumentation.

Acceptance criteria:

- The composer toolbar includes a compact `#oracle-voice-route` chip beside the existing Voice Presence label.
- The route chip shows only a short route label: `Cartesia`, `Hybrid`, `Local`, or `Setup`.
- Clicking the route chip opens a compact `#oracle-voice-setup` popover, not a large Voice Panel or transcript surface.
- The setup popover lets the user choose `Local`, `Hybrid`, or `Cartesia` mode.
- `Local` forces the browser/local voice path and does not use server websocket STT or provider-native Cartesia.
- `Hybrid` uses the browser speech path plus server speech fallback when available.
- `Cartesia` uses the provider-native Cartesia STT/TTS path when credentials are ready.
- `Setup` is shown when `Cartesia` mode is selected but the Cartesia credential is missing or unusable.
- The setup popover lets an admin or single-user deployment save a Cartesia API key to secret-file storage.
- The route chip and setup popover never show transcript text or provider secrets.
- The Voice Orb accessible label includes the route label so screen-reader users hear the same route context.

**FR-058**: Odysseus shall proxy Cartesia realtime Speech-to-Text through the local O.R.A.C.L.E. backend before the browser falls back to direct provider sockets.

Acceptance criteria:

- `/api/voice/config` reports `cartesia_stt_proxy.available=true` only when Cartesia token credentials are ready.
- `/api/voice/config` reports `cartesia_stt_proxy.path=/api/voice/cartesia-stt/ws` and a sanitized setup blocker when the proxy cannot be used.
- `/api/voice/cartesia-stt/ws` accepts browser WebSocket connections and never exposes the Cartesia API key or provider token to the browser.
- The proxy mints a short-lived server-side Cartesia STT token, opens Cartesia's manual STT WebSocket, and relays binary audio frames plus text control messages.
- The browser STT adapter uses the local proxy path first when it is available, while keeping the direct provider-token path as fallback code.
- Proxy token/socket failures return compact recoverable error messages so the existing browser/server speech fallback remains available.

**FR-059**: Odysseus shall filter voice transcripts for obvious background noise and low-risk STT cleanup before submitting them to the LLM.

Acceptance criteria:

- Voice-originated final transcripts pass through a runtime hygiene function before `onFinalTranscript(...)` is called.
- The hygiene function rejects obvious background-noise or background-media transcripts without submitting them to chat.
- The hygiene function collapses accidental repeated words and applies conservative STT spelling cleanup without rewriting user intent.
- Rejected transcripts publish compact `transcriptRejected`, `transcriptRejectReason`, and `transcriptFilter` state for QA.
- Accepted corrected transcripts publish `transcriptAutocorrected` and `transcriptFilter` state for QA.
- The feature does not add a transcript panel, store raw transcript text in runtime status, or expose provider secrets.

**FR-025**: Odysseus shall request safe O.R.A.C.L.E. narration for Council workflow lifecycle events when voice is already active.

Acceptance criteria:

- Council workflow start dispatches `oraclevoice:narration-request` with `eventType=council.workflow.started`.
- Council phase boundaries dispatch `eventType=council.phase.started` for position, evidence, convergence, consensus, and synthesis phases.
- Council completion or blocked outcomes dispatch deterministic workflow narration requests.
- Council narration requests use deterministic messages derived only from whitelisted phase labels.
- Council narration requests must not include the user task, Council transcript, model responses, tool output, command strings, JSON payloads, stack traces, or hidden prompts.
- Council narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Council lifecycle producer, not full Council voice integration or Council hard-cancel wiring.

**FR-026**: Odysseus shall request safe O.R.A.C.L.E. narration for Skill test lifecycle events when voice is already active.

Acceptance criteria:

- Starting a Skill test dispatches `oraclevoice:narration-request` with `eventType=skill.test.started`.
- Running, evaluation, completed, and failed Skill test states dispatch deterministic lifecycle narration requests.
- Skill test narration requests use generic messages only.
- Skill test narration requests must not include the Skill name, generated task, model name, tool name, command string, tool output, assistant text, error details, verdict body, JSON payloads, stack traces, or hidden prompts.
- Skill test narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Skill test producer, not full test-runner voice integration or automatic narration for arbitrary checks.

**FR-027**: Odysseus shall request safe O.R.A.C.L.E. narration for Code Runner lifecycle events when voice is already active.

Acceptance criteria:

- Starting a code block run dispatches `oraclevoice:narration-request` with `eventType=code.run.started`.
- Completed code block runs dispatch `eventType=code.run.completed`; failed, timed-out, or blocked runs dispatch `eventType=code.run.failed`.
- Code Runner narration requests use generic messages only.
- Code Runner narration requests must not include code text, language, command strings, stdout, stderr, result text, popup text, exception details, JSON payloads, stack traces, or hidden prompts.
- Code Runner narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Run-button producer, not full shell-command voice integration or automatic narration for arbitrary execution.

**FR-028**: Odysseus shall request safe O.R.A.C.L.E. narration for Workspace Local Preview lifecycle events when voice is already active.

Acceptance criteria:

- Starting a local preview dispatches `oraclevoice:narration-request` with `eventType=workspace.preview.started`.
- A ready local preview dispatches `eventType=workspace.preview.ready`; failed starts dispatch `eventType=workspace.preview.failed`; stopped previews dispatch `eventType=workspace.preview.stopped`.
- Workspace preview narration requests use generic messages only.
- Workspace preview narration requests must not include workspace item kind, item ID, item title, item body, build path, command string, preview URL, logs, proxy content, response payloads, error details, JSON payloads, stack traces, or hidden prompts.
- Workspace preview narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Local Preview producer, not full automatic narration for arbitrary workspace execution or preview content.

**FR-029**: Odysseus shall request safe O.R.A.C.L.E. narration for Compare run lifecycle events when voice is already active.

Acceptance criteria:

- Starting a Comparison Run dispatches `oraclevoice:narration-request` with `eventType=compare.run.started`.
- Completed Comparison Runs dispatch `eventType=compare.run.completed`; failed runs dispatch `eventType=compare.run.failed`; user stop requests dispatch `eventType=compare.run.stopped`.
- Compare run narration requests use generic messages only.
- Compare run narration requests must not include the user prompt, model names, provider names, candidate answers, combined answers, search results, source titles, source URLs, metrics, votes, session IDs, response payloads, error details, JSON payloads, stack traces, or hidden prompts.
- Compare run narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Compare producer, not full automatic narration for candidate content, judging, or model scoring.

**FR-030**: Odysseus shall request safe O.R.A.C.L.E. narration for Scheduled Task lifecycle events when voice is already active.

Acceptance criteria:

- Manually starting a Scheduled Task dispatches `oraclevoice:narration-request` with `eventType=task.run.started`.
- Completed Scheduled Task notifications dispatch `eventType=task.run.completed`; failed notifications dispatch `eventType=task.run.failed`; user stop requests dispatch `eventType=task.run.stopped`.
- Scheduled Task narration requests use generic messages only.
- Scheduled Task narration requests must not include the task name, prompt, notification body, action name, model name, result text, output text, error details, task ID, run ID, response payloads, JSON payloads, stack traces, or hidden prompts.
- Scheduled Task narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Scheduled Task producer, not full automatic narration for arbitrary task output, task bodies, or scheduler internals.

**FR-031**: Odysseus shall request safe O.R.A.C.L.E. narration for Cookbook model-job lifecycle events when voice is already active.

Acceptance criteria:

- Starting a Cookbook download, dependency, or serve job dispatches `oraclevoice:narration-request` with `eventType=cookbook.job.started`.
- Completed Cookbook jobs dispatch `eventType=cookbook.job.completed`; failed jobs dispatch `eventType=cookbook.job.failed`; user stop or kill requests dispatch `eventType=cookbook.job.stopped`.
- Cookbook job narration requests use generic messages only.
- Cookbook job narration requests must not include the model name, repo ID, command string, host, port, endpoint URL, output tail, error details, task ID, session ID, response payloads, JSON payloads, stack traces, or hidden prompts.
- Cookbook job narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Cookbook producer, not full automatic narration for model setup logs, model serving diagnostics, or arbitrary background job internals.

**FR-032**: Odysseus shall request safe O.R.A.C.L.E. narration for MCP Marketplace lifecycle events when voice is already active.

Acceptance criteria:

- Starting an MCP Marketplace install dispatches `oraclevoice:narration-request` with `eventType=mcp.marketplace.install.started`; completed installs dispatch `eventType=mcp.marketplace.install.completed`; failed installs dispatch `eventType=mcp.marketplace.install.failed`.
- Starting an installed MCP Marketplace server action dispatches `eventType=mcp.marketplace.action.started`; completed actions dispatch `eventType=mcp.marketplace.action.completed`; failed actions dispatch `eventType=mcp.marketplace.action.failed`.
- MCP Marketplace narration requests use generic messages only.
- MCP Marketplace narration requests must not include marketplace entry names, MCP server IDs, action names, configuration field names, configuration values, tool names, input schemas, logs, error details, package IDs, URLs, response payloads, JSON payloads, stack traces, or hidden prompts.
- MCP Marketplace narration requests set `requireActive=true`, so they are ignored unless an O.R.A.C.L.E. Voice Session is already active and not interrupted or cancelled.
- This is a compact Integration/MCP producer, not full automatic narration for all settings, connector configuration, tool schemas, install logs, or MCP runtime diagnostics.

**FR-005**: Odysseus shall narrate execution without reading raw internals aloud.

Acceptance criteria:

- Execution Narration may speak concise status such as "I'm wiring the frontend and validating dependencies."
- The Voice Scheduler must suppress raw JSON, stack traces, tool parameters, large code blocks, and search dumps.
- Narration must be derived from Odysseus runtime activity, not treated as the final model answer.

**FR-006**: Odysseus shall show multi-task voice presence.

Acceptance criteria:

- The Voice Orb can represent idle, listening, transcribing, thinking, working, speaking, interrupted, and cancelled states.
- The UI can indicate background execution activity while speech is interrupted or idle.
- Future UI should distinguish Council, tool use, testing, coding, and research activity when those signals are available.

## Performance Targets

- Soft Interrupt: under 100 ms
- First partial transcript: under 300 ms
- Speech start: under 500 ms
- First audio response: under 800 ms

These are target budgets for the full runtime. The current control-plane slice exposes them through `/api/voice/config`; it does not yet prove the complete audio path can meet them.

The physical microphone QA harness now reports measured latency fields, the configured `/api/voice/config.targets_ms` values, and per-field budget status so HITL runs can identify whether evidence is within target, over target, or missing. It can also require an expected spoken phrase with `ORACLE_PHYSICAL_MIC_EXPECTED_TEXT`, so a run only passes as transcript-quality evidence when the websocket final transcript and submitted chat message match the intended words.

The latest physical microphone latency pass reached production VAD `speech_start` and `speech_end`, websocket audio start/chunk/end streaming, local rolling-buffer final STT, and normal chat submission with `source=voice.websocket`. The measured path proves the current speech-to-chat wiring, but not the latency targets: speech start to first audio chunk was within budget at `296 ms`, while first partial transcript, first final transcript, and audio-end-to-final remained over budget (`1504 ms`, `10834 ms`, and `1837 ms` respectively). The current local rolling-buffer adapter is operational proof infrastructure, not provider-grade low-latency STT.

The latest physical-mic safety loop added harness support for a countdown cue, microphone device selection, input calibration telemetry, and an explicit diagnostic non-submit expectation. It also fixed a browser-runtime safety regression where the legacy `voice.server_stt_final` fallback could submit a hallucinated transcript even when the websocket STT path had correctly marked its own transcript `submit_to_chat=false`.

After rebuilding with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T13:04:32.401443`, and the served `voiceRuntime.js` contained the websocket/server-STT mutual-exclusion guard. The final physical-mic safety-mode HITL pass proved the scoped safer failure mode: real microphone capture, production VAD (`speechStarts=2`, `speechEnds=1`, `maxVoiceActivityLevel=0.194381`), websocket audio lifecycle (`voice.audio.start=2`, `voice.audio.chunk=72`, `voice.audio.end=1`), local STT partial/final events, no `/api/chat_stream` submission, and `lastTranscriptSource.submitToChat=false`. The local tiny faster-whisper transcript was still wrong, and latency remained over target except first audio chunk (`302 ms` within `500 ms`; first partial `1679 ms`, first final `12692 ms`, and audio-end-to-final `693 ms` over the `300 ms` first-transcript budget). This makes the scoped safety/observability slice complete and operational, but full O.R.A.C.L.E. natural speech-to-chat remains blocked on provider-grade STT quality/noise isolation and latency.

The next local STT profile loop changed the live model to `base.en` through the new settings alias, rebuilt with local STT enabled, and warmed the model successfully: `provider=local`, `model=base.en`, `setup_status=ready`, `supports_incremental_transcripts=true`. The physical microphone websocket/local-STT path still failed expected text: with the Realtek microphone array it produced real VAD and websocket audio events, but local faster-whisper final transcripts such as `Korea and Bulgaria.` and `It's literally sitting there absolutely fucking this` did not match `hello oracle` and did not submit to chat. This keeps local faster-whisper as diagnostic/observability infrastructure, not an operative natural speech-to-chat provider.

The Chrome/Web Speech path is now operative for a scoped, correctly selected physical microphone flow. With `ORACLE_PHYSICAL_MIC_ALLOW_BROWSER_SPEECH=1`, `ORACLE_PHYSICAL_MIC_DEVICE_INDEX=3`, and expected text `hello`, the HITL harness selected `Microphone (B microphone) (0d8c:0005)`, recorded one production VAD speech start/end, captured `maxVoiceActivityLevel=0.434680`, received browser final transcripts `hello`, submitted exactly one normal chat message `hello`, and preserved `source=voice.browser_speech` provenance. A broader first browser-speech run also showed why this is a scoped verdict: the default/Realtek path produced no browser finals, and a longer B-microphone run submitted one bogus browser recognition result before the clean `hello`. O.R.A.C.L.E. is therefore complete and operational for the Chrome/Web Speech + correct microphone + short clean utterance path, which prompted the production selector/default preference work below; full hands-free reliability still needs better transcript confidence/noise gating.

The next browser-mic reliability loop moved the microphone choice into production capture instead of the QA harness: `OracleMicCapture` now persists a preferred microphone device in browser storage, applies it as `deviceId: { exact: ... }` during normal `getUserMedia`, reports the active selected device label, and falls back to the default mic if the saved device becomes stale. The physical microphone harness now calls `runtime.micCapture.setPreferredDevice(...)` rather than replacing `getUserMedia`, so a selected QA device is the same preference the app uses afterward. Browser SpeechRecognition now uses bounded utterance mode (`continuous=false`) with the existing restart-on-end loop, so Chrome gets cleaner opportunities to finalize short commands while O.R.A.C.L.E. remains listening. A duplicate-final guard suppresses repeated identical browser finals within a short window before they can submit duplicate chat messages. After rebuild, served source confirmed the preferred mic, bounded utterance, and duplicate guard changes, and `/api/health` returned healthy at `2026-06-14T13:28:46.776060`. The final HITL run used no device override, selected the persisted `Microphone (B microphone) (0d8c:0005)`, recorded production VAD speech start/end with `maxVoiceActivityLevel=0.369206`, received browser final transcripts for `hello`, submitted exactly one normal chat message `hello`, and preserved `source=voice.browser_speech` provenance. Current status: Chrome/Web Speech O.R.A.C.L.E. speech-to-chat is complete and operational for the selected physical microphone and short clean utterances. The local websocket/faster-whisper path remains non-operational for natural speech commands and should stay treated as diagnostic fallback infrastructure until replaced or materially improved.

The in-app microphone selector loop added `#oracle-mic-select` beside the Voice Orb, runtime microphone enumeration/selection methods, compact toolbar styling, and a dedicated authenticated Chrome selector QA harness. A first live run caught a real defect: the fallback/default option displayed a stored `B microphone` label without a `deviceId`, so starting O.R.A.C.L.E. still captured `Microphone Array (Realtek(R) Audio)`. The fix now labels that row as current/default and prefers concrete `audioinput` device options. After rebuilding with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T13:40:05.951327`, served `voiceOrb.js` contained the `Current:`/`Default microphone` fix, and `node artifacts\oracle_mic_selector_qa.js` passed against visible Chrome/CDP. The live selector QA found 5 microphone options, selected `Default - Microphone (B microphone) (0d8c:0005)`, persisted it as the preferred device, clicked the real Voice Orb, and verified active capture used `Default - Microphone (B microphone) (0d8c:0005)` with `microphoneState=capturing`. Screenshot evidence: `artifacts/screenshots/oracle-mic-selector-desktop.png` and `artifacts/screenshots/oracle-mic-selector-mobile.png`.

The browser-speech confidence gate loop hardened the already-operative Chrome/Web Speech path against the bogus-result failure seen during longer hands-free runs. `OracleSpeechRecognition` now records `SpeechRecognitionAlternative.confidence`, rejects explicitly low positive final confidence before `onFinalTranscript(finalText)` can submit to chat, publishes a redacted rejection event with `rejectedFinalTranscript=true` and `rejectionReason=low_confidence`, and keeps unknown or zero confidence accepted so browser variants that do not report meaningful confidence are not accidentally muted. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 47/47, `node --check static\js\oracleSpeechRecognition.js` passed, rebuilt with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, served `oracleSpeechRecognition.js` contained `MIN_FINAL_TRANSCRIPT_CONFIDENCE`, `rejectedFinalTranscript`, and `low_confidence`, and `/api/health` returned healthy at `2026-06-14T13:50:22.542269`. No new physical microphone HITL speech run was required for this narrow logic guard; the prior live evidence remains the Chrome/Web Speech + selected B microphone `hello` run.

The online STT-operability pass checked current project/official sources before changing the remaining local/server path. Relevant findings: whisper.cpp's stream example describes microphone streaming as a naive rolling real-time inference example and says sliding-window VAD needs tuning; Silero VAD documents fast speech gating, including sub-millisecond 30 ms chunk processing on one CPU thread; faster-whisper positions itself as a fast transcription backend and points live/streaming usage toward dedicated integrations such as Whisper-Streaming and WhisperLive. Based on that, Odysseus now distinguishes `supports_incremental_stt_stream` from operational speech-to-chat. Local faster-whisper rolling-buffer streams remain available for diagnostics and QA evidence, but report `speech_to_chat_quality=diagnostic`, `speech_to_chat_blocker=local_rolling_buffer_diagnostic`, and their websocket finals set `submit_to_chat=false` with `quality_gate=diagnostic_only` instead of auto-submitting. Verification: `python -m pytest tests/test_realtime_voice_routes.py -q` passed 21 tests, `python -m pytest tests/test_speech_service_toggles.py -q` passed 16 tests, `node --test tests\realtime_voice_frontend.test.js` passed 47/47, and `python -m py_compile routes\realtime_voice_routes.py services\stt\stt_service.py` passed. After rebuilding with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T13:56:51.845499`, logs showed `Realtime voice control plane initialized`, and an in-container stats probe returned local `base.en` ready with `supports_incremental_transcripts=True`, `speech_to_chat_quality='diagnostic'`, and `speech_to_chat_blocker='local_rolling_buffer_diagnostic'`.

The endpoint-STT operability loop used current OpenAI and Speaches documentation to separate two server-side operational modes: bounded utterance transcription and live realtime transcription. OpenAI documents `/audio/transcriptions` as the file/bounded-audio path and points microphone/live transcript deltas to Realtime transcription; Speaches documents an OpenAI API-compatible server with `/audio/transcriptions`, streaming transcription, and a Realtime API. Odysseus now treats provider-grade endpoint STT as operational speech-to-chat for completed VAD-bounded utterances even when it does not expose incremental partial transcripts. In `/api/voice/config`, an `endpoint:<id>` provider with `speech_to_chat_quality=provider_grade` and a callable `transcribe` path can set `supports_speech_to_chat=true`, `server_final_utterance_submit=true`, `incremental_streaming=false`, and `blocking_reason=null`. Local rolling-buffer faster-whisper remains diagnostic-only. Verification: `python -m pytest tests/test_realtime_voice_routes.py -q` passed 22 tests, `python -m pytest tests/test_speech_service_toggles.py -q` passed 16 tests, `node --test tests\realtime_voice_frontend.test.js` passed 47/47, and `python -m py_compile routes\realtime_voice_routes.py services\stt\stt_service.py` passed. After rebuilding with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T14:04:28.615605`. The live instance is still configured to local `base.en`, so its runtime stats correctly remain `speech_to_chat_quality='diagnostic'`; the endpoint-operational path is ready for a configured OpenAI-compatible STT endpoint such as Speaches or OpenAI.

The endpoint readiness and live Speaches loop made the bounded-utterance server STT path operational in the current runtime. Odysseus now resolves `endpoint:<id>` STT providers against enabled `ModelEndpoint` rows before reporting availability; missing, disabled, or blank endpoints report `setup_status=endpoint_missing`, `setup_blocker=stt_endpoint_missing`, `speech_to_chat_quality=unavailable`, and an OpenAI-compatible endpoint install hint instead of falsely claiming readiness. `docker-compose.yml` now owns a `speaches` service using `ghcr.io/speaches-ai/speaches:latest-cpu`, published on `127.0.0.1:8000`, with the persisted `odysseus-speaches-hf` model-cache volume. `Systran/faster-whisper-tiny` is downloaded through `POST /v1/models/Systran/faster-whisper-tiny`, and Odysseus is configured with `stt_provider=endpoint:speaches-stt`, `stt_model=Systran/faster-whisper-tiny`, and `stt_language=en`. The registered endpoint row is `speaches-stt` with base URL `http://speaches:8000/v1`. Verification: `python -m pytest tests/test_realtime_voice_routes.py -q` passed 23 tests, `python -m pytest tests/test_speech_service_toggles.py -q` passed 17 tests, `node --test tests\realtime_voice_frontend.test.js` passed 47/47, and `python -m py_compile services\stt\stt_service.py routes\realtime_voice_routes.py` passed. After rebuilding with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T14:14:05.139351`; after moving Speaches into Compose, `/api/health` returned healthy at `2026-06-14T14:17:51.044461`. An in-container STT stats probe returned `provider='endpoint:speaches-stt'`, `speech_to_chat_quality='provider_grade'`, and no blocker; a generated WAV saying `hello oracle` transcribed through `STTService.transcribe(...)` as `Hello Oracle.`; and the voice bridge calculation returned `supports_speech_to_chat=true`, `server_final_utterance_submit=true`, `incremental_streaming=false`, and `blocking_reason=null`. Scoped operational verdict: complete and operational for provider-grade VAD-bounded final-utterance STT through Speaches; realtime partial streaming and longer noisy hands-free reliability remain future hardening.

The endpoint websocket smoke loop added `artifacts/oracle_endpoint_ws_smoke.py`, a repeatable in-container harness that creates a Voice Session, sends a generated WAV through `/api/voice/ws`, and requires a `voice.transcript.final` event containing expected text with `submit_to_chat=true`. This closes the gap between direct `STTService.transcribe(...)` evidence and the real O.R.A.C.L.E. websocket route. Verification: the first run failed because the harness did not exist, the second run caught a script import-root issue, and the corrected harness passed after being copied into the container. After the final rebuild with `ODYSSEUS_INSTALL_LOCAL_STT=true docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T14:23:36.546296`, `docker compose ps speaches odysseus` showed both services up, and `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` returned `ok=true`. The final event was `type=voice.transcript.final`, `text='Hello Oracle.'`, `submit_to_chat=true`, `speech_to_chat_bridge.blocking_reason=null`, `supports_speech_to_chat=true`, `server_final_utterance_submit=true`, and `supports_incremental_stt_stream=false`, with elapsed websocket smoke time around `1091 ms`. Scoped operational verdict is unchanged but stronger: complete and operational for O.R.A.C.L.E.'s compose-managed Speaches final-utterance websocket speech-to-chat path.

The live Voice Orb unavailable-popup loop fixed a frontend event-composition bug discovered during manual browser testing. The backend config and runtime were already healthy (`/api/voice/config` returned `runtime='oracle'`, provider-grade `endpoint:speaches-stt`, and no speech-to-chat blocker), but the button rendered `O.R.A.C.L.E. Unavailable` because `OracleVoiceRuntime._publish(event.detail)` allowed child speech-recognition `status` objects to overwrite the parent Oracle runtime status in the public `oraclevoice:state` event. `_publish` now strips child `status`, `session`, and `config` fields before composing the public detail, so `status.available` is always the parent runtime availability. Because `voiceRuntime.js` is service-worker precached, `static/sw.js` cache was bumped to `odysseus-v364`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 49/49, Docker was rebuilt, `/api/health` returned healthy at `2026-06-14T14:55:09.602036`, the live CDP tab showed `window.oracleVoiceRuntime.status.available=true`, `configRuntime='oracle'`, and the button title `O.R.A.C.L.E. Ready. Start O.R.A.C.L.E.`, and `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` returned `ok=true` with final `Hello Oracle!` and `submit_to_chat=true`.

The browser Web Speech network-failure loop hardened the live testing path where Chrome for Testing exposes `SpeechRecognition` but fails the remote recognizer with `error='network'`. `OracleSpeechRecognition` now treats `network` and `service-not-allowed` as browser speech unavailable, suppresses the fatal red speech-recognition toast for those fallbackable failures, and publishes `speechRecognitionUnavailable=true` with `supported=false`. `OracleVoiceRuntime` now asks `_isBrowserSpeechRecognitionUsable()` before deciding between browser transcripts and provider-grade server STT, so an unavailable browser recognizer routes microphone audio through `/api/voice/ws` instead of blocking the Speaches path. Because both changed modules are precached, `static/sw.js` cache is now `odysseus-v365`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 50/50, `node --check static\js\oracleSpeechRecognition.js` and `node --check static\js\voiceRuntime.js` passed, `python -m pytest tests\test_realtime_voice_routes.py -q` passed 24/24, Docker was rebuilt, `/api/health` returned healthy at `2026-06-14T15:03:09.562631`, `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` returned `ok=true` with final `Hello Oracle!`, and a live CDP probe after reload showed `swVersion='odysseus-v365'`, `speechRecognition.supported=false`, `lastError='network'`, `errorToastCount=0`, button title `O.R.A.C.L.E. Ready. Start O.R.A.C.L.E.`, and `_shouldUseVoiceWebSocket()=true`.

The browser TTS narrator loop fixed the silent narrator path when server TTS is disabled. Live config still reports `tts.provider='disabled'`, `available=false`, and `supports_chunked_audio_stream=false`, so `OracleVoiceRuntime.speak()` previously hit `/api/voice/speak`, received unavailable server TTS, and could not produce audible narration. `speak()` now uses server audio when available and otherwise falls back to browser `speechSynthesis`, publishes `speechPlaybackState='browser'`, and stays interruptible through the existing audio stop/cancel path. The narration safety gate also now recognizes the exact generic frontend event names already emitted by chat, tools, research, Council, skill tests, code runs, workspace previews, compare runs, scheduled tasks, Cookbook jobs, and MCP Marketplace events, while continuing to suppress raw internal events and raw-looking payloads. Because `voiceRuntime.js` is precached, `static/sw.js` cache is now `odysseus-v366`. Verification: a new TDD regression first failed because `_canUseBrowserTtsFallback()` was missing, then `node --test tests\realtime_voice_frontend.test.js` passed 51/51, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 27/27, `node --check static\js\voiceRuntime.js` passed, and `python -m py_compile src\realtime_voice\voice_narration.py` passed. After rebuilding with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T15:14:19.982433`, `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` still returned `ok=true` with final `Hello Oracle!`, and a live CDP probe after reload showed `swVersion='odysseus-v366'`, narration `should_speak=true` for `chat.stream.started`, browser `speechSynthesis.speak` called with `I'm working on your chat request.`, and playback events `loading -> browser -> idle`. Scoped operational verdict: complete and operational for audible browser-TTS Oracle narration in the current runtime, assuming the user's browser/OS audio output is not muted.

The spoken-response reliability loop fixed the user-facing case where speaking to Oracle could submit and receive a chat response but the assistant's actual response was not heard. Docker logs did not show a TTS exception because the current runtime still has server TTS disabled; the audible path is browser `speechSynthesis`. `OracleVoiceRuntime` now prefers the operational provider-grade Speaches server-STT path over Chrome Web Speech by default, publishing `speechRecognitionState='server_stt'` and `speechRecognitionBypassed=true`, so Chrome's remote recognizer no longer has to fail with `network` before server STT is used. Chat streaming now preserves whether the prompt came from a submitted voice transcript and, for those voice-originated turns, speaks a cleaned and capped final assistant response through `oracleVoiceRuntime.speak(...)` instead of only speaking the generic completion narration. Because `voiceRuntime.js`, `chat.js`, and related modules are precached, `static/sw.js` cache is now `odysseus-v367`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 53/53, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 27/27, `node --check static\js\voiceRuntime.js` and `node --check static\js\chat.js` passed, Docker was rebuilt, `/api/health` returned healthy at `2026-06-14T15:27:29.688267`, and `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` returned `ok=true`, final `Hello Oracle!`, and `submit_to_chat=true`. Scoped operational verdict: complete and operational for voice-originated assistant response readback through browser TTS, subject to the browser/OS output device not being muted.

The STT-to-TTS latency loop fixed the regression where the provider-grade server STT path became the only active input path, making short spoken turns wait for VAD-bounded Speaches transcription before the chat/TTS response could begin. `OracleVoiceRuntime` now starts browser SpeechRecognition whenever the browser exposes it, while keeping websocket/server STT armed as the fallback/safety-net path. The first accepted final transcript for a speech turn wins, and slower duplicate finals from the other path are suppressed with `voiceTurnDuplicateTranscript` instead of creating a second chat submission. Browser TTS fallback is also more resilient: it cancels stale speech, resumes the browser speech queue before and after `speechSynthesis.speak(...)`, publishes browser playback on `utterance.onstart`, and times out instead of hanging indefinitely. Because `voiceRuntime.js` is precached, `static/sw.js` cache is now `odysseus-v368`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 53/53, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 27/27, `node --check static\js\voiceRuntime.js` and `node --check static\sw.js` passed, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T15:40:40.363978`, served assets contained `voiceSpeechTurnId`, `voiceTurnDuplicateTranscript`, `ORACLE_BROWSER_TTS_TIMEOUT_MS`, `speechSynthesis.resume`, and service worker `odysseus-v368`, and `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` returned `ok=true`, final `Hello Oracle!`, `submit_to_chat=true`, and elapsed `4707.296 ms`. Visible Chrome/CDP verification after a forced reload showed the loaded runtime no longer gates browser speech behind server preference, the Voice Orb moved from `Ready` to `Listening` with `buttonUnavailable=false`, browser SpeechRecognition was `listening`, websocket STT remained available with `_shouldUseVoiceWebSocket()=true`, and a browser TTS smoke returned `true` after calling `cancel`, `resume`, `speak`, and `resume`. Scoped operational verdict: complete and operational for the low-latency hybrid STT path and browser-TTS readback code path; physical spoken latency still depends on whether Chrome/Web Speech returns a usable final transcript in the user's browser, with Speaches remaining the slower fallback.

The immediate Voice Presence latency loop fixed the remaining perceived delay between a final transcript and the first audible response. When a voice-originated transcript is accepted for chat submission, `app.js` now speaks a short direct `Got it.` acknowledgement immediately, before scheduling the composer submit click. `chat.js` suppresses the later generic `chat.stream.started` spoken narration for that same voice-originated turn so the user hears one fast acknowledgement instead of stacked status phrases. The live Speaches fallback profile was also switched from `Systran/faster-whisper-small.en` to `Systran/faster-whisper-tiny` in `data/settings.json`, lowering the fallback websocket smoke from about `4623 ms` to `3255 ms` cold after the switch and `947 ms` warm, while still returning `Hello Oracle.` with `submit_to_chat=true`. Because `app.js`, `chat.js`, and voice modules are precached, `static/sw.js` cache is now `odysseus-v369`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 53/53, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 27/27, `node --check static\app.js`, `node --check static\js\chat.js`, and `node --check static\sw.js` passed, Docker was rebuilt with `docker compose up -d --build odysseus`, Odysseus was restarted after the settings switch, `/api/health` returned healthy at `2026-06-14T15:49:22.764419`, in-container STT stats reported `provider=endpoint:speaches-stt`, `model=Systran/faster-whisper-tiny`, and `speech_to_chat_quality=provider_grade`, and visible Chrome/CDP after a forced reload verified `Got it.` was spoken about `10 ms` before the intercepted submit click for a simulated voice final transcript. Scoped operational verdict: complete and operational for immediate audible acknowledgement after recognized speech plus faster endpoint fallback; the full answer still depends on normal chat model latency.

The always-on Voice Narrator loop moved server Text-to-Speech work behind a Runtime B worker queue. `src/realtime_voice/voice_narrator.py` now owns a long-lived async queue that serializes backend TTS synthesis off the request event loop; `app.py` starts it on FastAPI startup and stops it on shutdown; `/api/voice/speak` uses the narrator queue when a backend TTS provider is available and keeps the browser playback contract unchanged; `/api/voice/config` reports `supports_voice_narrator_queue` and `voice_narrator` diagnostics. In the current runtime, the narrator worker is running, but backend TTS remains disabled, so audible output still relies on browser `speechSynthesis` fallback until a server TTS provider is configured. Verification: `python -m pytest tests\test_realtime_voice_routes.py -q` passed 27/27, `python -m pytest tests\test_tts_routes.py -q` passed 2/2, `node --test tests\realtime_voice_frontend.test.js` passed 53/53, Python and Node syntax checks passed, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T16:04:42.880049`, container logs showed `O.R.A.C.L.E. voice narrator worker started`, and authenticated CDP config returned `supports_voice_narrator_queue=true`, `voice_narrator.running=true`, `queue_size=0`, and `backend_tts_available=false`. Scoped operational verdict: complete and operational for the always-on narrator worker/queue itself; not yet operational for server-side audible narration because no backend TTS provider is enabled.

The post-narrator live browser send proof closed the reported "it doesn't send the message" regression. Authenticated CDP through `http://127.0.0.1:9226` triggered `window.oracleVoiceRuntime.handleFinalTranscript('say ok', { source: 'voice.browser_speech', submitToChat: true, ... })` in the rebuilt app. The runtime accepted the transcript, spoke the immediate `Got it.` Voice Presence acknowledgement, emptied the composer through the normal send path, and emitted a real `POST http://127.0.0.1:7000/api/chat_stream`. CDP request post data contained `message=say ok`, `mode=chat`, and `voice_transcript_source={"source":"voice.browser_speech","voiceSessionId":"qa-real-send","sessionId":"qa-real-chat","mimeType":"text/plain","submitToChat":true}`. A follow-up stack-trace run reproduced the request with no runtime exception; the earlier terse exception came from a test harness stop-click after the request, not from voice submission. Scoped operational verdict: complete and operational for final voice transcript to normal Chat send.

The server-TTS operability loop made backend audible narration operational through compose-managed Speaches. Speaches now has `speaches-ai/Kokoro-82M-v1.0-ONNX` downloaded, Odysseus has a dedicated enabled `ModelEndpoint` row `speaches-tts` at `http://speaches:8000/v1`, and `data/settings.json` selects `tts_provider=endpoint:speaches-tts`, `tts_model=speaches-ai/Kokoro-82M-v1.0-ONNX`, and `tts_voice=af_heart`. `TTSService` now resolves endpoint providers before claiming availability and reports `setup_status`, `setup_blocker`, `endpoint_id`, and install hints for missing TTS endpoints. Browser playback is also hardened: server audio playback has a 60s timeout, and `OracleVoiceRuntime.speak(...)` falls back to browser `speechSynthesis` if server audio playback fails or stalls. `static/sw.js` cache is now `odysseus-v371`. Verification: `python -m pytest tests\test_speech_service_toggles.py tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 48/48, `node --test tests\realtime_voice_frontend.test.js` passed 53/53, Node/Python syntax checks passed, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T16:22:32.069126`, served assets exposed `odysseus-v371`, `ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS`, and `voice audio playback timed out`, authenticated CDP `/api/voice/config` returned `tts.available=true`, `setup_status=ready`, `supports_tts_chunked_audio_stream=true`, and `voice_narrator.backend_tts_available=true`, authenticated CDP `/api/voice/speak` returned `audio/mpeg` with 15048 bytes in about 1639 ms, a forced browser audio-playback rejection fell back to browser TTS and returned `true`, and `docker compose exec -T odysseus python artifacts/oracle_endpoint_ws_smoke.py --expect hello` still passed with final `Hello Oracle.` and `submit_to_chat=true`. Scoped operational verdict: complete and operational for server-side O.R.A.C.L.E. TTS/narrator audio in this local Docker runtime, with browser TTS retained as a fallback.

The fast voice UX scheduler loop fixed the user-visible mismatch between the intended O.R.A.C.L.E. feel and the current experience: presence acknowledgements, final answer readback, and incidental narrator updates were all competing for the same server-first TTS lane, so the app could feel slow, silent, or stale even when STT and TTS providers were technically configured. `OracleVoiceRuntime.speak(text, options)` now has explicit speech lanes (`presence`, `answer`, `narration`), generation-based stale playback suppression, and droppable narration. Voice-originated `Got it.` acknowledgements and final assistant answer readback now use the fast browser TTS lane with interrupt enabled, while execution narration is fast but non-interrupting and drops if speech is already active. Server TTS remains available for explicit server-mode speech and as backend capability; the default UX path now prioritizes responsiveness and avoids narrator backlog. `static/sw.js` cache is now `odysseus-v372`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 54/54, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 29/29, Node syntax checks passed for `voiceRuntime.js`, `app.js`, `chat.js`, and `sw.js`, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy after startup on 2026-06-14, served assets exposed `odysseus-v372` plus the fast-lane markers, authenticated CDP proved presence and answer speech completed through browser `speechSynthesis` with zero `/api/voice/speak` calls, narration dropped while another speech lane was busy, and a simulated final voice transcript still accepted, filled the composer, and triggered the normal chat form submit path. Scoped operational verdict: complete and operational for the fast perceived voice UX scheduler in the rebuilt local runtime. Remaining loops are 0 for this scheduler slice; 1-2 remain for physical-microphone HITL confirmation of subjective audio timing and noisy-room barge-in, if those are included in "fully operational."

The core-essence Voice Presence loop made O.R.A.C.L.E. visibly feel like a live communication layer instead of a hidden mic/TTS utility. The composer now includes a compact `#oracle-voice-presence` readout beside the Voice Orb. It shows only state labels such as `Ready`, `Waking`, `Listening`, `Speaking`, `Working`, and `Interrupted`; it never shows transcript text and does not revive the old Voice Panel. `voiceOrb.js` now resolves visible presence from runtime status, speech playback, websocket/transcription state, and execution state, while `voiceRuntime.js` distinguishes startup `configState=loading` from true unavailable/error state so a fresh reload no longer flashes a false `Unavailable` label. `static/sw.js` cache is now `odysseus-v374`. Verification: `node --test tests\realtime_voice_frontend.test.js` passed 54/54, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 29/29, Node syntax checks passed for the touched modules, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy on 2026-06-14, served assets exposed `odysseus-v374`, `configState`, and `ORACLE_PRESENCE_ID`, authenticated CDP showed a fresh reload at `Ready` with `buttonUnavailable=false`, actual mouse interaction with the Voice Orb changed visible presence to `Listening`, a second click soft-interrupted to `Interrupted`, forced runtime state events rendered `Waking`, `Listening`, `Speaking`, `Working`, and `Interrupted`, and mobile layout had no overlap or horizontal overflow. Screenshot evidence: `artifacts/screenshots/oracle-presence-desktop-v374.png` and `artifacts/screenshots/oracle-presence-mobile-v374.png`. Scoped operational verdict: complete and operational for compact visible Voice Presence aligned with O.R.A.C.L.E.'s core essence. Remaining loops are 0 for this UI presence slice; 1 remains if the definition includes a human subjective pass on physical speech timing and audio output.

The inline-only Voice Presence loop removed the remaining popup mismatch with O.R.A.C.L.E.'s core essence. Passive voice capability/config failures now stay in the compact presence readout and accessible Voice Orb title instead of raising the global red toast `O.R.A.C.L.E. voice is unavailable.` Normal listening/transcribing state also stays in the Voice Presence surface instead of emitting redundant `O.R.A.C.L.E. listening` or `O.R.A.C.L.E. transcribing` toasts; explicit action failures still use error toasts. `static/sw.js` cache is now `odysseus-v375`. Verification: the TDD regression first failed on the passive unavailable toast path, then `node --test tests\realtime_voice_frontend.test.js` passed 54/54, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 29/29, Node syntax checks passed, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T17:45:29.288701`, served assets exposed `odysseus-v375`, `voicePresenceOnly`, and no removed toast strings, authenticated CDP showed fresh reload `Ready` with zero toasts, a forced unavailable runtime state rendered inline `Unavailable` with zero toasts, a real mouse click on the Voice Orb changed presence to `Listening` with zero toasts, and a second click changed presence to `Interrupted` with zero toasts. Endpoint websocket smoke still returned final `Hello Oracle.` with `submit_to_chat=true`. Screenshot evidence: `artifacts/screenshots/oracle-presence-inline-only-v375.png`. Scoped operational verdict: complete and operational for inline-only compact Voice Presence. Remaining loops are 0 for this UX slice; 1 remains only if the definition includes human subjective audio timing/output.

The interrupted spoken-turn feedback loop fixed the case where a soft interrupt could silence the next voice-originated turn. `app.js` no longer treats `status.state === 'interrupted'` as a reason to skip the immediate `Got it.` Voice Presence acknowledgement, and `chat.js` no longer treats `interrupted` as a reason to skip the final assistant answer readback for submitted voice turns. Hard-cancelled sessions still suppress those speech paths, and generic background narration still remains suppressed while interrupted. `static/sw.js` cache is now `odysseus-v376`. Verification: the new TDD regression first failed on the interrupted-state guard, then `node --test tests\realtime_voice_frontend.test.js` passed 54/54, `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed 29/29, Node syntax checks passed, Docker was rebuilt with `docker compose up -d --build odysseus`, `/api/health` returned healthy at `2026-06-14T18:16:39.427350`, served assets exposed `odysseus-v376`, and authenticated CDP proved that with O.R.A.C.L.E. active and `Interrupted`, `handleFinalTranscript('hello oracle', { source: 'voice.browser_speech', submitToChat: true })` returned `accepted=true`, queued browser speech text `Got it.`, preserved the inline `Interrupted` presence state, and submitted the chat form. Endpoint websocket smoke returned final `Hello Oracle.` with `submit_to_chat=true`. Runtime logs also explain the earlier server-TTS failure: Speaches cold-loaded `speaches-ai/Kokoro-82M-v1.0-ONNX` in about 61 seconds after attempting unavailable CUDA libraries, which can exceed the 60s server speech timeout. Scoped operational verdict: complete and operational for soft-interrupted browser-TTS voice acknowledgement/readback; server Kokoro cold-start latency remains a separate provider/runtime blocker for realtime server TTS.

## Next Vertical Slices

1. Provider-Grade Incremental STT

   Replace or supplement the conservative local rolling-buffer faster-whisper adapter with a provider-grade low-latency path, such as AudioWorklet/WebRTC framing, Silero-assisted segmentation, whisper.cpp, or a provider-native stream that decodes microphone frames as they arrive.

2. Provider-Native Streaming Text-to-Speech

   Upgrade beyond chunked audio transport by letting Kokoro, Piper, XTTS, or future hosted providers yield audio as synthesis progresses behind the same scheduler contract.

3. Voice Scheduler and Execution Narrator

   Convert broader Agent Run, coding, planning, Council, tool, research, and test events into short speakable updates while filtering noisy internals.

4. Provider-grade Voice Activity Detection

   Upgrade or supplement the local Web Audio detector with Silero VAD, an AudioWorklet path, or another modular provider when server-side audio streaming exists.

5. Voice Orb state polish

   Polish the compact Voice Orb so it clearly shows only voice state: idle, listening, transcribing, thinking, working, speaking, interrupted, or cancelled.

6. Council voice integration

   Keep Council active during voice conversations. Later, optionally add a mode where the user can hear Council discussion snippets before the final Odysseus consensus.

## Verification Plan

Focused automated checks:

```text
python -m pytest tests/test_realtime_voice_routes.py -q
node --test tests/realtime_voice_frontend.test.js
```

For any UI change:

- Rebuild the Docker Compose runtime when app assets or routes change.
- Check `/api/health`.
- Run visible Chrome QA through the configured CDP endpoint.
- For interactive controls, click or type into the exact user-facing control in the rebuilt authenticated app and verify the resulting app state. Source assertions and served-asset checks are not enough.
- Capture desktop and mobile screenshots.
- Check service logs for runtime errors.
- If sidebar or shell layout changes, confirm the full sidebar and compact icon rail are mutually exclusive.

## QA Scenarios

- Start O.R.A.C.L.E. in an existing Chat Session and confirm the Voice Session attaches to that session.
- Start O.R.A.C.L.E. without an active session and confirm the runtime fails gracefully or creates an intentional unattached Voice Session.
- Trigger Soft Interrupt while TTS is playing and confirm speech stops while background work continues.
- Trigger Hard Interrupt while an Agent Run is active and confirm the run is stopped.
- Trigger repeated Soft Interrupts and confirm the Voice Session remains recoverable.
- Attempt voice runtime access while unauthenticated and confirm existing auth behavior is preserved.
- Confirm spoken narration never reads raw tool payloads, stack traces, secrets, or large code blocks.
- In Chrome/Web Speech capable browsers, confirm final O.R.A.C.L.E. speech transcripts submit through the normal chat composer.
- In unsupported browsers, confirm O.R.A.C.L.E. stays honest that speech chat is not connected through the current browser/server path.
- Confirm the composer model picker remains available after the sidebar Models section is hidden.

## Out Of Scope For The Current Control Plane

- Replacing existing model routing.
- Creating a separate voice-only memory or chat system.
- Treating voice transcripts as Knowledge without a review or approved save step.
- Making WhatsApp part of O.R.A.C.L.E. work while WhatsApp is parked.
- Shipping a fake voice transport as completion evidence.

## Open Questions

- Which STT provider should be the first production path: faster-whisper, whisper.cpp, or an existing Odysseus provider wrapper?
- Which local TTS provider should be first-class: Kokoro, Piper, XTTS, or a configurable priority order?
- Should Voice Presence phrases be deterministic templates, model-assisted, or hybrid?
- What is the exact cancellation path for active Council workflows once Council voice integration begins?
- Should future server-side O.R.A.C.L.E. transcripts be saved as chat Messages, temporary Voice Session state, or reviewed Knowledge Candidates?
