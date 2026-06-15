# WhatsApp QR Auth And Sync Chats Smoke Path

## Summary

Make the existing Personal WhatsApp bridge path prove one real end-to-end workflow:

```text
WhatsApp Integration -> QR Auth -> connected Linked Device -> Sync Chats -> imported Available WhatsApp History -> visible WhatsApp library
```

This slice does not attempt to finish every WhatsApp MVP capability. It turns the current bridge-backed backend and UI into a verifiable live path with diagnostics strong enough to continue later work.

## Goal

A user can connect one Personal WhatsApp Integration through QR Auth, see the Communication Account become connected only when the Linked Device session is actually active, start Sync Chats, and inspect imported conversations/messages in the WhatsApp library.

## In Scope

- QR Auth session startup through the existing `whatsapp-bridge` service.
- QR state reporting from bridge to backend to Settings UI.
- Connected/disconnected/reconnect-required account state based on live bridge status.
- Sync Chats start/status path against the active linked-device session.
- Available WhatsApp History import for chats and provider messages exposed by the bridge.
- Diagnostics that distinguish bridge process health from account session state.
- Focused automated tests for state transitions, sync progress, stale diagnostics clearing, and owner boundaries.
- Browser QA for Settings, sidebar, and WhatsApp library on desktop and mobile.

## Out Of Scope

- Real WhatsApp calls and Desktop Fallback automation.
- Full media retention and audio transcription workers.
- Provider-backed reactions, edits, deletes, tombstones, and read receipts.
- Cloud API configuration, webhooks, templates, or Business Platform behavior.
- Contact merge/linking, LID-to-phone reconciliation beyond what the bridge already reports.
- AI knowledge extraction, Obsidian persistence, reminders, and urgency scoring.

## Assumptions

- Docker Compose is the primary local runtime for this slice.
- The `whatsapp-bridge` service runs from `services/whatsapp_bridge/bridge.js`.
- Baileys linked-device behavior is the primary source for QR Auth, live events, and Available WhatsApp History.
- WhatsApp may expose partial history only; UI and diagnostics must not promise full account backup.
- The user has a phone with WhatsApp available for live QR scan verification.

## Requirements

### Functional Requirements

- FR-001: Odysseus shall let a user create or select one Personal WhatsApp Integration from Settings.
- FR-002: Odysseus shall require accepted personal automation disclosure before starting QR Auth.
- FR-003: Odysseus shall request QR Auth by starting an owner/account-scoped bridge session.
- FR-004: Odysseus shall expose QR pending, connecting, connected, disconnected, expired, failed, and reconnect-required states from bridge session status.
- FR-005: Odysseus shall mark a Communication Account connected only when the bridge reports an active linked-device session.
- FR-006: Odysseus shall clear stale bridge errors and reconnect reasons after a later successful connected state.
- FR-007: Odysseus shall demote stale connected accounts when the bridge process is healthy but the account session is not active.
- FR-008: Odysseus shall provide a user-started Sync Chats action for a connected account.
- FR-009: Sync Chats shall import Available WhatsApp History exposed by the linked-device session and label progress with the partial-history caveat.
- FR-010: Sync Chats shall report progress for chats discovered, chats normalized, messages processed, media queued, failures, elapsed time, phase, and last error.
- FR-011: Imported provider messages shall dedupe by account and provider message ID when available.
- FR-012: Backfilled inbound messages shall not increment local unread count as if they were new live messages.
- FR-013: The WhatsApp sidebar and library shall show imported conversations without requiring a per-row message call.

### Data Requirements

- DATA-001: Account, conversation, message, media, audit, and transport-event records shall remain owner-scoped.
- DATA-002: Raw WhatsApp Payload persistence shall remain short-lived or protected by the existing raw payload expiry fields.
- DATA-003: Session and Chrome profile paths shall be owner/account-scoped and safe for local diagnostics.
- DATA-004: Bridge diagnostics shall avoid exposing QR payloads, session credentials, cookies, media secrets, raw media URLs, and decrypted media bytes in logs.

### Integration Requirements

- INT-001: The Python backend shall talk to the bridge through `ODYSSEUS_WHATSAPP_BRIDGE_URL`.
- INT-002: Bridge callbacks to `/api/whatsapp/bridge/events` shall use `ODYSSEUS_WHATSAPP_BRIDGE_TOKEN` when configured.
- INT-003: Docker Compose shall start `odysseus` and `whatsapp-bridge` with a shared `data/whatsapp` root.
- INT-004: The bridge shall return session status even when no session has been started.

### Non-Functional Requirements

- NFR-001: UI polling for QR or sync state shall not freeze the Settings or WhatsApp library surfaces.
- NFR-002: Sync Chats shall avoid tight request loops; provider history requests shall be rate-limited by bridge configuration.
- NFR-003: Diagnostics shall make blocked versus degraded states understandable without reading container logs first.
- NFR-004: Desktop and mobile WhatsApp surfaces shall not clip controls or create horizontal overflow.

## Acceptance Criteria

- AC-001: Starting from no configured WhatsApp Integration, the user can create one and accept the disclosure.
- AC-002: Clicking Connect with QR starts a bridge session and shows a scannable QR state in Settings.
- AC-003: After scanning, `/api/whatsapp/accounts` reports `auth_state=connected` and `setup_state=connected` only if the linked-device session is active.
- AC-004: If the bridge is running but the account session is missing, the account is shown as setup incomplete or disconnected, not connected.
- AC-005: Sync Chats can be started from the WhatsApp library/status area for a connected account.
- AC-006: Sync progress displays phase, counts, failures, and partial-history caveat.
- AC-007: Imported conversations appear in the sidebar and WhatsApp library.
- AC-008: Imported messages appear chronologically in the selected conversation thread.
- AC-009: Automated WhatsApp backend tests pass.
- AC-010: `node --check services/whatsapp_bridge/bridge.js`, `static/js/whatsappInbox.js`, `static/js/whatsappLibrary.js`, and touched Settings JS pass.
- AC-011: Browser screenshots exist for Settings QR pending/connected state, Sync Chats progress/result, library desktop, and library mobile.

## Vertical Slices

### Slice 1: Bridge Session Truth

Mode: AFK until live QR scan.

Acceptance:

- Bridge health and session status distinguish process health from account session state.
- Backend account state follows bridge session state.
- Stale connected accounts are demoted when session status is not connected.
- Stale errors clear on connected state.

### Slice 2: QR Auth UI Loop

Mode: HITL for phone QR scan.

Acceptance:

- Settings starts QR Auth and shows current QR/session status.
- QR polling stops or backs off when modal closes or account changes.
- Connected state appears after scan.
- Reconnect-required or failed states show actionable copy.

### Slice 3: Sync Chats Import

Mode: HITL for live connected account.

Acceptance:

- Sync Chats starts only for a connected session.
- Bridge posts chat/message/sync progress events.
- Backend stores imported conversations/messages idempotently.
- Backfill does not inflate unread counts.

### Slice 4: Visible Library Proof

Mode: AFK with seeded tests, HITL for live screenshots.

Acceptance:

- Sidebar refreshes after sync or explicit refresh.
- Library displays conversations, messages, progress, and blocked states.
- Desktop and mobile screenshots show no clipped controls or horizontal overflow.

## Verification Plan

- `python -m py_compile routes/whatsapp_helpers.py routes/whatsapp_routes.py src/whatsapp_bridge.py tests/test_whatsapp_backend.py`
- `python -m pytest tests/test_whatsapp_backend.py -q`
- `node --check services/whatsapp_bridge/bridge.js`
- `node --check static/js/whatsappInbox.js`
- `node --check static/js/whatsappLibrary.js`
- `node --check static/js/settings.js`
- `docker compose up -d --build odysseus whatsapp-bridge`
- Browser QA at `http://127.0.0.1:7000`
- Docker logs check after startup, QR Auth, Sync Chats, and library load

## Open Questions

- OQ-001: Should this slice require a fresh live QR scan, or may it use an already-linked local session for the first pass?
- OQ-002: Should the Settings UI hide sensitive local session/profile paths from non-admin users during this slice?
- OQ-003: Should Sync Chats expose pause/cancel now, or remain future work after the smoke path is proven?

