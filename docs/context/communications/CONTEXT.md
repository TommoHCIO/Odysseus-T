# Communications Context

This context names shared Email and WhatsApp ideas.

## Language

**Communications**:
The Odysseus area for reading, searching, drafting, sending, and acting on human messages.
_Avoid_: Messaging only, inbox only

**Provider**:
An outside message system that Odysseus connects to, such as Email or WhatsApp.
_Avoid_: Channel, integration

**Communication Account**:
An Email, WhatsApp, or other provider account that Odysseus can read from or send through.
_Avoid_: User account, account, identity

**Conversation**:
A provider-backed exchange with one person, group, or addressable party. In Email, use Thread when talking about email chains.
_Avoid_: Chat for every provider

**Group Conversation**:
A provider-backed conversation with more than two participants. It is not a Contact by default.
_Avoid_: Contact, group contact

**Participant**:
A person or provider identity taking part in a conversation. Show a Contact Display Name when one is known.
_Avoid_: Contact when only a provider identity is known

**Thread**:
An ordered chain of provider messages. Prefer Thread for Email.
_Avoid_: Conversation when the provider specifically exposes email threading

**Provider Message**:
A message from, or meant for, an outside provider such as Email or WhatsApp. It may have provider IDs, but it is not the ID itself.
_Avoid_: Chat message, provider locator, message when ambiguity is likely

**Provider Locator**:
The provider's own information needed to find a provider message or conversation again.
_Avoid_: Provider message

**Draft**:
A local message proposal that has not been sent. AI-written communication should become a draft before any send.
_Avoid_: Queued message, pending send

**Reply Draft**:
A draft meant to answer an existing provider message or thread.
_Avoid_: Confirmed send

**Provider Draft**:
A draft stored by the outside provider, such as an email in a Drafts folder.
_Avoid_: Draft

**Confirmed Send**:
A send where the user approved the exact final message that will go out.
_Avoid_: Auto-send, implicit approval

**Delivery Status**:
Odysseus' best known send state for a provider message, such as queued, sent, delivered, read, or failed.
_Avoid_: Unread state

**Unread State**:
Odysseus' local view of what still needs attention. Provider read receipts are separate.
_Avoid_: Read receipt

**Call Alert**:
An Odysseus alert for an incoming communication call. It does not mean auto-answer, recording, or transcription.
_Avoid_: Call handling, call recording
