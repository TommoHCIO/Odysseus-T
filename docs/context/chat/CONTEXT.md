# Chat Context

This context names chat work in Odysseus.

## Language

**Chat**:
The place where a user talks with models, assistants, agents, or Council workflows.
_Avoid_: Workspace, assistant

**Session**:
A saved chat work thread. It can include messages, model settings, attached documents, and task context.
_Avoid_: Chat log, conversation only

**Message**:
One entry inside a chat session, from a user, assistant, agent, system, or tool. Use Provider Message for Email or WhatsApp.
_Avoid_: Document, event, provider message

**Streaming Response**:
A model or agent answer that appears piece by piece while it is still being generated.
_Avoid_: Background work

**Chat Attachment**:
A file or document attached to a chat message or session.
_Avoid_: Provider attachment

**System Prompt**:
Instructions given to a model before the user's message to shape behavior.
_Avoid_: User message

**Incognito Session**:
A temporary chat session that should not be saved like normal work.
_Avoid_: Private deployment, hidden session
