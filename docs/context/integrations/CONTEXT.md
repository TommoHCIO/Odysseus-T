# Integrations Context

This context names connections between Odysseus and outside systems.

## Language

**Integration**:
A user-configured connection to an outside system, provider account, or local service.
_Avoid_: Plugin, provider

**Provider Account**:
An account or identity the user owns in an outside service.
_Avoid_: User account, Odysseus account, account

**Connector**:
A packaged technical way for Odysseus to talk to an outside app, service, or API.
_Avoid_: Skill, integration

**Plugin**:
A package that adds skills, tools, apps, or other capabilities to Odysseus.
_Avoid_: Integration

**MCP Server**:
A server that exposes tools or resources through the Model Context Protocol.
_Avoid_: Provider endpoint

**Provider Endpoint**:
The API address used for model, embedding, search, or other provider calls. It is where calls go, not the model itself.
_Avoid_: Model, server, integration

**Endpoint Probe**:
A check that asks whether a provider endpoint is reachable and what it supports.
_Avoid_: Setup check

**Host Bridge**:
A helper process that runs on the host, outside the FastAPI Backend or app container. It handles things that need host browser, OS, desktop app, GPU/runtime, or filesystem access.
_Avoid_: Bridge, provider, connector

**WhatsApp Bridge**:
The host bridge for WhatsApp linked-device, browser, media, sync, and desktop-control work.
_Avoid_: Bridge, provider

**Webhook**:
An HTTP endpoint that lets an outside system trigger Odysseus.
_Avoid_: API token, connector
