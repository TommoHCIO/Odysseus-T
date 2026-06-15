# Context Map

Odysseus has many feature areas. Use this map to find the right glossary before changing names in code, UI, docs, or plans.

## Contexts

- [Product](./docs/context/product/CONTEXT.md) - names the overall Odysseus workspace and broad user-facing areas.
- [Chat](./docs/context/chat/CONTEXT.md) - names conversational work, sessions, messages, and chat-attached state.
- [Knowledge](./docs/context/knowledge/CONTEXT.md) - names saved knowledge, recall, vault, and old memory words.
- [Agents](./docs/context/agents/CONTEXT.md) - names AI helpers, skills, tools, and Council workflows.
- [Models](./docs/context/models/CONTEXT.md) - names model choice, download, serving, and hardware fit.
- [Research](./docs/context/research/CONTEXT.md) - names multi-step research and reports.
- [Compare](./docs/context/compare/CONTEXT.md) - names side-by-side model testing and blind comparison.
- [Outputs](./docs/context/outputs/CONTEXT.md) - names generated results, saved work, previews, and proof that work was checked.
- [Communications](./docs/context/communications/CONTEXT.md) - names email, WhatsApp, drafts, sends, calls, notifications, and conversation surfaces.
- [Contacts](./docs/context/contacts/CONTEXT.md) - names people, organizations, contact identities, provider identities, and explicit merges.
- [Email](./docs/context/email/CONTEXT.md) - names Email mailbox, IMAP, SMTP, folder, UID, and triage ideas.
- [WhatsApp](./docs/context/whatsapp/CONTEXT.md) - names WhatsApp linked-device, sync, ID, privacy, and call ideas.
- [Documents](./docs/context/documents/CONTEXT.md) - names writing, editing, files, and attachments.
- [Media](./docs/context/media/CONTEXT.md) - names gallery, image editing, and generated media assets.
- [Voice](./docs/context/voice/CONTEXT.md) - names speech-to-text, text-to-speech, voice recording, and transcription.
- [Planning](./docs/context/planning/CONTEXT.md) - names notes, tasks, reminders, schedules, and calendar concepts.
- [Settings](./docs/context/settings/CONTEXT.md) - names user preferences, presets, themes, and setup choices.
- [Data](./docs/context/data/CONTEXT.md) - names uploads, imports, exports, backups, cleanup, and local app data.
- [Integrations](./docs/context/integrations/CONTEXT.md) - names external services, providers, bridges, webhooks, and connectors.
- [Security](./docs/context/security/CONTEXT.md) - names ownership, permissions, admin controls, tokens, and deployment safety.
- [Operations](./docs/context/operations/CONTEXT.md) - names diagnostics, logs, checks, queues, audit records, and partial failures.
- [Search](./docs/context/search/CONTEXT.md) - names web search, local search, indexing, and found evidence.
- [Interface](./docs/context/interface/CONTEXT.md) - names recurring Odysseus UI places and navigation patterns.

## Relationships

- **Product -> Knowledge**: The workspace shows Knowledge as a main feature.
- **Product -> Chat**: Chat is a main way users work.
- **Product -> Agents**: The workspace is where AI helpers act.
- **Chat -> Agents**: Chat sessions can include assistants, agents, tool runs, and Council workflows.
- **Chat -> Documents**: Chat sessions can include attached documents and generated outputs.
- **Agents -> Knowledge**: Agents may recall or persist Knowledge when capabilities allow it.
- **Agents -> Models**: Agents run through configured local or remote models.
- **Research -> Agents**: Deep Research may use AI-helper planning and writing.
- **Research -> Outputs**: Deep Research produces reports as structured outputs.
- **Compare -> Models**: Compare tests models against each other.
- **Compare -> Outputs**: Compare may produce a winning answer or combined result.
- **Agents -> Outputs**: Agents and Council workflows may produce artifacts that need preview, checks, or saving into another feature.
- **Models -> Product**: Cookbook supports the workspace by helping users choose and serve models.
- **Communications -> Agents**: Agents may read, summarize, draft, or send messages only through allowed workflows.
- **Communications -> Knowledge**: Communications can produce Knowledge Candidates, reminders, tasks, and evidence-backed summaries.
- **Contacts -> Communications**: Communications may display, search, or route messages through contact identities and provider identities.
- **WhatsApp -> Contacts**: WhatsApp JIDs and LID JIDs may link to contacts only when the match is confirmed or trusted.
- **Contacts -> Security**: Contact merges and identity links must respect owner boundaries and user confirmation.
- **Email -> Communications**: Email uses shared Communications language for communication accounts, threads, provider messages, drafts, confirmed sends, unread state, and attachments.
- **Email -> Contacts**: Email addresses are Provider Identities that may link to Contacts.
- **Email -> Operations**: Email fetch, read, send, draft, and triage work should show diagnostics, logs, partial failures, and background work when useful.
- **WhatsApp -> Communications**: WhatsApp uses shared Communications language for accounts, conversations, provider messages, drafts, sends, unread state, and call alerts.
- **WhatsApp -> Integrations**: WhatsApp depends on the WhatsApp Bridge and WhatsApp transport paths.
- **WhatsApp -> Operations**: WhatsApp setup, sync, media, calls, and sends must expose diagnostics, setup checks, queues, and dead letters.
- **WhatsApp -> Security**: WhatsApp sync, AI reads, sends, media, and knowledge extraction must respect owner boundaries, privacy constraints, write confirmations, and audit records.
- **Documents -> Agents**: Agents may assist with edits, suggestions, extraction, and drafting inside user-controlled document workflows.
- **Outputs -> Documents**: A made result may become a document when the user chooses to keep editing it as one.
- **Outputs -> Media**: Generated media is a media-specific output that may also appear in Gallery.
- **Media -> Models**: Media generation and editing depend on configured image-capable models or local image tools.
- **Voice -> Models**: Voice features may use speech or audio models.
- **Planning -> Communications**: Messages can become reminders, tasks, or calendar follow-ups.
- **Settings -> Models**: Settings and presets choose which models Odysseus uses.
- **Data -> Security**: Uploads, backups, exports, and cleanup must respect owners and secrets.
- **Integrations -> Security**: External systems must respect owner boundaries, secrets handling, and admin gates.
- **Operations -> Integrations**: Provider, bridge, and webhook behavior should expose health, diagnostics, logs, and queue state.
- **Operations -> Security**: Logs, audit records, and diagnostics must respect owner boundaries and secret redaction.
- **Search -> Knowledge**: Found evidence can become Knowledge only after review or another approved save step.
- **Interface -> Product**: Interface language should describe reusable UI surfaces without redefining product domains.
