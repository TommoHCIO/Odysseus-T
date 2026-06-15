# Product Context

This context names the whole Odysseus product.

## Language

**Odysseus**:
A self-hosted AI workspace for chat, agents, knowledge, documents, research, communications, and local models.
_Avoid_: Chatbot, admin panel, hosted SaaS

**Workspace**:
The main place where the user works with Odysseus tools and data.
_Avoid_: Dashboard, homepage

**Feature Surface**:
A visible area of Odysseus for one feature, such as Chat, Knowledge, Email, or Cookbook.
_Avoid_: Backend, provider

**Event**:
A recorded system, workflow, or audit thing that happened. Use Message for chat or communication content.
_Avoid_: Message, note

**FastAPI Backend**:
The Python service that owns Odysseus routes, storage, auth, and server-side app behavior.
_Avoid_: Backend when referring to model serving, provider APIs, or host helpers
