# WhatsApp Status

Last updated: 2026-06-14

WhatsApp is good enough for now. Do not continue expanding it unless the user reports a concrete blocker from daily use.

## Current Chat Rendering Status

- Emoji shortcode rendering is fixed for AI replies in normal chat rendering mode.
- Shortcodes are backed by generated GitHub gemoji alias data, not a small hand-maintained list.
- Known working examples include `:party popper:`, `:tada:`, `:heart_eyes:`, `:parrot:`, and `:-1:`.
- Markdown code spans and fenced code blocks keep emoji shortcodes literal.
- `Text-only Emojis` remains an opt-in accessibility/display mode; when enabled, it intentionally strips emoji from AI replies.
- Verification passed with focused markdown tests, JS syntax checks, Docker rebuild, `/api/health`, visible Chrome QA, screenshot evidence, and clean runtime logs.

## Current Skills Invocation Status

- Skills are visible in the Obsidian Knowledge Cockpit and remain stored as owner-scoped `SKILL.md` files.
- Chat supports `/skill "skill name" [request]` to invoke a specific skill as procedure guidance.
- Live slash autocomplete recommends skills while typing after `/skill`; confirmed working example: `/skill s` suggests `/skill "ship-feature"` first.
- Matt Pocock skills can be imported live into the cockpit, while `ship-feature` remains the primary feature-shipping skill.

## Current B.L.U.E. Learning Mode Status

- `/blue` is now an Odysseus learning mode that composes a structured B.L.U.E. Agent prompt rather than launching a separate app.
- Supported commands are `/blue learn`, `/blue path`, `/blue map`, `/blue methods`, `/blue verify`, `/blue absorb`, `/blue debate`, and `/blue build`.
- Typing `/blue ` in the live composer shows all eight subcommands with short descriptions.
- The slash handoff waits out the app submit debounce, sends through the visible composer send button, and hides the internal composed prompt bubble.
- Completed multi-round B.L.U.E. responses no longer leave stale `.streaming` classes on older assistant continuation bubbles.
- Latest focused verification passed: JS slash tests, JS syntax checks, B.L.U.E. backend tests, Docker rebuild, `/api/health`, Chrome autocomplete DOM check, and Docker logs showing `/api/blue/compose` plus `/api/chat_stream` 200s.
- Browser evidence: `artifacts/screenshots/blue-autocomplete-subcommands.png`.

## B.L.U.E. QA Rule

- Do not fire all `/blue` commands back-to-back. Wait for the current assistant response to finish, confirm the composer is enabled and no `.msg-ai.streaming` elements remain, then wait at least 20 seconds before submitting the next B.L.U.E. command.

## Current Email MCP Status

- Email MCP reply tooling now exposes `To` and `Cc` when reading messages, so agents can inspect thread participants before replying.
- `reply_to_email(reply_all=true)` excludes the sending account's own addresses and supports explicit recipient exclusions, such as "do not CC Alessandra and Mario."
- `send_email` exposes `in_reply_to` and `references` for deliberate threading when a valid prior Email Message ID is known.
- The fix was rebuilt into the Docker Compose runtime and `/api/health` passed afterward.

## Current State

- Personal WhatsApp can connect through QR linked-device auth.
- Sync Chats imports available linked-device history.
- The sidebar and WhatsApp Library are usable for browsing chats.
- Conversation titles avoid raw JIDs where possible, and the user can manually rename chats.
- The connection path has been made fast enough for normal use.
- Contacts and Integrations rail loading have been sped up.

## Known Limits

- Some chats still need manual renaming when WhatsApp does not provide a trusted display name.
- Deep WhatsApp completion work is intentionally parked: calls, rich media, reactions/edits/deletes, full FTS, advanced privacy handling, and Cloud API are not priorities right now.
- Treat WhatsApp as a stable-enough local integration, not a launch-complete WhatsApp product.

## Resume Only If

- QR/link-device connection breaks.
- Sync Chats stops importing usable history.
- Sending or reading normal text chats breaks.
- The UI becomes too slow again.
- The user explicitly asks to resume WhatsApp feature work.
