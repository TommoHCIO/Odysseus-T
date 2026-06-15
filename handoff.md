# Odysseus-T Handoff

Last updated: 2026-06-15

This is the short operator handoff for the whole Odysseus-T workspace. Keep it current and concise. Long feature evidence belongs in focused docs such as `oracle.md`, not here.

## Read First

- App URL: `http://127.0.0.1:7000`
- Recent Chrome CDP endpoint: `http://127.0.0.1:9226`
- Runtime service: Docker Compose service `odysseus`
- Auth is enabled locally.
- App shell cache: `app.js?v=20260614newchat2`
- Service worker cache: `odysseus-v399`
- Main map: `CONTEXT-MAP.md`
- O.R.A.C.L.E. detail: `oracle.md`

## Project Shape

Odysseus-T is a local-first AI workspace with these major surfaces:

- Chat: sessions, messages, model routing, voice-originated messages, file/context attachment.
- Agent: tool-using autonomous task runs with shell/files/web/MCP/skills/memory.
- Council: multi-agent phased workflow for Idea, Sketch, Review/final product.
- Knowledge: Obsidian is canonical; legacy Brain/Memory exists for compatibility.
- Cookbook/Models: model discovery, hardware fit, downloads, serving, provider setup.
- Deep Research: multi-step source gathering and report synthesis.
- Compare: blind side-by-side model comparison and synthesis.
- Documents/Outputs: editable documents, generated artifacts, previews, QA evidence.
- Communications: Email and WhatsApp surfaces, drafts, sends, contacts, notifications.
- Media: gallery, generated images, editing flows.
- Voice: O.R.A.C.L.E. realtime listening/speaking layer around existing work.

Use `CONTEXT-MAP.md` before renaming UI concepts or moving cross-domain behavior.

## Operating Rules

- Validate UI/UX changes in a real visible Chrome browser. For layout changes, capture screenshots.
- For interactive changes, click/tap/type the exact user-facing control in the rebuilt authenticated app.
- Static tests, source assertions, served-asset checks, and logs do not replace real interaction when the change is interactive.
- After Docker rebuilds or browser tests, check `/api/health` and recent `docker compose logs --tail=120 odysseus`.
- Keep user worktree changes. Do not reset/revert unrelated files.
- Do not use fake transports or generic artifact fallbacks as completion evidence. A failed artifact should become an explicit QA/blocker item.
- Keep secrets out of Git, logs, screenshots, and shared docs. `data/`, `logs/`, `.env`, uploads, auth/session files, keys, and provider tokens are private.

## Current Runtime Notes

- Default Docker Compose binds Odysseus and bundled services to `127.0.0.1`.
- Bundled services include ChromaDB, SearXNG, ntfy, and currently Speaches for local speech endpoints.
- `docker-compose.yml` scopes Odysseus startup chown work with `ODYSSEUS_CHOWN_PATHS=/app /app/logs`; do not remove this unless startup scanning is intentionally redesigned.
- Optional built-in Browser MCP is currently unavailable inside Odysseus because `@playwright/mcp@latest` is not installed in the container npx cache. It is optional and not blocking normal app use.
- Windows host currently does not have working `git.exe` on PATH. PATH references `E:\Git\cmd`, but that drive is not mounted. Earlier commits used Python `dulwich`.
- If Chrome shows stale UI after rebuild, unregister/bypass the service worker or use a fresh cache-busted target.

## Current O.R.A.C.L.E. Status

O.R.A.C.L.E. is the current active feature focus, but not the whole project.

Latest scoped verdict: operational for the current Cartesia voice UX slice.

Working now:

- Cartesia mode uses proxy-backed Cartesia TTS for answer-highlight speech.
- Nolan voice is wired: `65209f8e-6140-4a20-b819-3cc2e21da19b`.
- Tiny presence acknowledgements such as `Got it.` may use fast browser TTS by design.
- Voice-originated assistant responses speak a short answer highlight, not the full raw response.
- Speech skips code blocks, file trees, command/log output, tables, links, and syntax-heavy fragments.
- TTS playback mutes/rearms voice input to reduce speaker echo contaminating STT.
- Cartesia STT finalizing races now defer/retry instead of becoming `cartesia_stt_socket_failed`.

Latest verification:

- `node --check static\js\voiceRuntime.js`
- `node --check static\js\cartesiaRealtimeTts.js`
- `node --check static\js\chat.js`
- `node --check static\sw.js`
- `node --test tests\realtime_voice_frontend.test.js` passed `59/59`
- `python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q` passed `50/50`
- `docker compose up -d --build odysseus` completed
- `/api/health` returned healthy at `2026-06-15T13:02:02.656564`

Remaining loops:

- `0` implementation loops for the current Cartesia Nolan/proxy/fail-closed answer-highlight + STT finalizing-race scope.
- `1` HITL loop remains for subjective speaker/headphone confirmation: timbre, volume, echo, and spoken-turn latency.

## Other Important Areas

Knowledge and Council:

- Obsidian is the canonical knowledge store. Treat legacy Brain/Memory as compatibility.
- Council agents currently receive Obsidian knowledge through injected context. Add a Council-safe read-only search tool only if agents need active queries during debate.
- Council workflow tests must use at least two agents, both on `deepseek/deepseek-v4-flash`.
- For Council changes, test the full path when possible: Phase 1 Idea -> Phase 2 Sketch -> Phase 3 Review/final product.

Chat and session stability:

- The composer, model picker, sidebar New Chat, session materialization, and voice transcript submission are tightly coupled. Test the exact click/submit path.
- If touching chat rendering, verify markdown, code/pre preservation, tool blocks, TTS buttons, and voice-originated answer narration.

B.L.U.E.:

- B.L.U.E. learning-mode work exists in the repo/worktree. Use a fresh chat or isolate the latest assistant message for browser QA because generated prompts include required section labels that can appear elsewhere in history.

Communications:

- WhatsApp is parked unless a real daily-use blocker appears. No fake transport is acceptable for completion; the first complete WhatsApp path must work against live personal QR auth and the host bridge.
- Email/WhatsApp/contact work must respect owner boundaries, explicit send confirmation, diagnostics, queues/dead letters, and secret/privacy redaction.

Models and Cookbook:

- Cookbook storage in Docker lives under `data/huggingface` and `data/local`.
- Docker GPU passthrough and llama.cpp CUDA are separate. `nvidia-smi` inside the container proves GPU access, not that llama.cpp has CUDA runtime support.
- Ollama on the host should be configured as `http://host.docker.internal:11434/v1`.

Security:

- Keep `AUTH_ENABLED=true` outside narrow local debugging.
- Keep `LOCALHOST_BYPASS=false` outside local development.
- Do not expose raw ChromaDB, SearXNG, ntfy, Ollama, vLLM, llama.cpp, databases, or provider APIs. Expose only authenticated Odysseus through a trusted proxy/private access layer.
- Rotate any API key or token that was pasted into shared chat, screenshots, or logs.

## Key Files

- `CONTEXT-MAP.md` - domain map and naming boundaries.
- `README.md` - setup, runtime, security, architecture overview.
- `oracle.md` - O.R.A.C.L.E. UX contract, requirements, and evidence.
- `app.py` - FastAPI entry point and startup wiring.
- `core/` - auth, database, middleware, constants.
- `routes/` - API routes for chat, sessions, memory, documents, models, voice, communications.
- `src/` - model/agent/search/knowledge/runtime implementation.
- `services/` - STT/TTS and integration services.
- `static/app.js` and `static/js/` - browser UI and feature modules.
- `tests/` - Python and Node regression coverage.
- `docker-compose.yml`, `Dockerfile`, `docker/` - local runtime packaging.
- `data/` and `logs/` - private runtime state; gitignored.

O.R.A.C.L.E. hot files:

- `static/js/voiceRuntime.js`
- `static/js/cartesiaRealtimeStt.js`
- `static/js/cartesiaRealtimeTts.js`
- `static/js/chat.js`
- `static/js/voiceOrb.js`
- `routes/realtime_voice_routes.py`
- `src/realtime_voice/provider_tokens.py`
- `tests/realtime_voice_frontend.test.js`
- `tests/test_realtime_voice_routes.py`
- `tests/test_tts_routes.py`

## Verification Shortcuts

General health:

```powershell
docker compose ps
curl.exe -fsS http://127.0.0.1:7000/api/health
docker compose logs --tail=120 odysseus
```

O.R.A.C.L.E. focused:

```powershell
node --test tests\realtime_voice_frontend.test.js
python -m pytest tests\test_realtime_voice_routes.py tests\test_tts_routes.py -q
node --check static\js\voiceRuntime.js
node --check static\js\cartesiaRealtimeTts.js
node --check static\js\chat.js
node --check static\sw.js
```

Context-sensitive docs:

- Use `docs/context/*/CONTEXT.md` before changing terminology in a domain.
- Use `oracle.md` before changing voice UX.
- Use `README.md` before changing setup, deployment, or security assumptions.

## Suggested Next Work

1. Run one real voice turn in Chrome with Cartesia selected and confirm audible Nolan answer-highlight playback.
2. If O.R.A.C.L.E. still shows `cartesia_stt_socket_failed`, verify Chrome loaded service worker `odysseus-v399`.
3. Restore or fix host Git on PATH, or keep using a deliberate non-interactive fallback until Git is available.
4. Keep Council/Obsidian terminology aligned with `CONTEXT-MAP.md` and the relevant `docs/context/*/CONTEXT.md`.
5. If work moves away from O.R.A.C.L.E., update this file by changing the active focus and preserving only essential current-state bullets.
