# WhatsApp Context

This context names WhatsApp-specific ideas in Odysseus.

## Language

**WhatsApp Integration**:
The user's configured WhatsApp connection in Odysseus.
_Avoid_: WhatsApp connector, WhatsApp account when referring to the whole feature

**Personal WhatsApp**:
The personal-account WhatsApp path that uses linked-device auth and visible WhatsApp surfaces.
_Avoid_: Business WhatsApp, campaign transport

**Linked Device**:
A WhatsApp companion-device session approved from the user's main WhatsApp app.
_Avoid_: Login, password auth

**QR Auth**:
The linked-device flow where Odysseus shows a WhatsApp QR code for the user to scan.
_Avoid_: Password login, browser login

**Available WhatsApp History**:
The old chats and provider messages WhatsApp exposes to the linked device. Do not promise full history.
_Avoid_: Full history, complete backup

**Sync Chats**:
The user-started backfill action that imports Available WhatsApp History.
_Avoid_: Background follow-up work, live new messages, export, scrape

**Live Ingestion**:
Handling new WhatsApp provider events as they arrive.
_Avoid_: Sync Chats

**Background Ingestion**:
WhatsApp-specific follow-up work after data is received, such as cleanup, media download, transcription, extraction, or retries.
_Avoid_: Sync Chats

**Personal Transport**:
The non-Cloud-API WhatsApp path for linked-device, browser, or desktop-backed behavior.
_Avoid_: Campaign transport, business API

**Linked-Device Socket**:
The WhatsApp transport path that uses a linked-device connection for messages, history, media, and status.
_Avoid_: WhatsApp Web browser area

**Cloud API**:
The separate WhatsApp Business Platform path with service-window, template, webhook, token, and business-account rules.
_Avoid_: Personal WhatsApp, QR auth

**Dedicated Chrome Profile**:
The isolated Chrome profile Odysseus uses for WhatsApp Web login recovery and visible calls.
_Avoid_: User's everyday Chrome profile

**WhatsApp Call Surface**:
The visible WhatsApp Web or WhatsApp Desktop interface where the user handles a call.
_Avoid_: Local call event, auto-call

**Desktop Fallback**:
Using the official WhatsApp Desktop app when WhatsApp Web or browser automation cannot handle a call path.
_Avoid_: Primary transport

**Call Event**:
A recorded WhatsApp call-related event in Odysseus, such as ringing, launch requested, dismissed, or ended.
_Avoid_: WhatsApp Call Surface

**Presence**:
Provider-visible activity such as online, typing, or recording state. Use Provider Read Receipt for read state.
_Avoid_: Unread state, read receipt

**Provider Read Receipt**:
A WhatsApp-visible signal that a provider message was read.
_Avoid_: Unread state, local mark-read

**Opt-Out Block**:
A block that prevents AI or automated WhatsApp sends after a stop or opt-out signal.
_Avoid_: Mute, archive

**Anti-Spam Guardrail**:
A rule that stops personal WhatsApp from being used for bulk or spam-like sending.
_Avoid_: Campaign tool

**AI Background Read**:
A WhatsApp read done by AI or background work. It must never emit presence or provider read receipts.
_Avoid_: Human UI read, mark-read

**Human UI Read**:
A WhatsApp read caused by the user visibly opening messages in Odysseus.
_Avoid_: AI background read

**WhatsApp JID**:
A WhatsApp provider ID for a contact, group, or addressable target.
_Avoid_: Phone number, contact name

**Phone JID**:
A WhatsApp JID based on a phone number.
_Avoid_: LID JID

**WhatsApp Group JID**:
A WhatsApp provider ID for a group conversation.
_Avoid_: Contact, Display Name

**LID JID**:
A WhatsApp linked-device ID that may point to the same real contact as a phone-number JID.
_Avoid_: Contact, phone JID

**Advanced Chat Privacy**:
A WhatsApp privacy setting that should limit export, AI saving, and long-term knowledge extraction when detected.
_Avoid_: Normal chat privacy, mute

**Raw WhatsApp Payload**:
Provider data saved before or alongside Odysseus normalization. It may contain sensitive details and should be short-lived or protected.
_Avoid_: Provider Message
