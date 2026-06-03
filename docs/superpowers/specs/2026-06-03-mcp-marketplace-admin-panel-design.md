---
title: MCP Marketplace Admin Panel Design
date: 2026-06-03
status: approved-draft
---

# MCP Marketplace Admin Panel Design

## Goal

Add an admin-only MCP Marketplace panel to Odysseus where admins can browse multiple curated MCP server catalogs, install approved server recipes, manage installed servers and processes, inspect tool details, and automatically register working MCP tools for the assistant.

The feature should extend the existing MCP management system instead of creating a parallel registry. Existing manual MCP server configuration remains available for custom or advanced setups.

## Scope

### In scope

- Admin-only UI for browsing curated MCP catalogs.
- Manual refresh from multiple curated catalog sources.
- Recipe-only one-click installs for approved MCP servers.
- Isolated installs under `data/mcp_marketplace/<server-id>/`.
- Runtime support for npm/npx, Python/uv, Docker, and externally hosted SSE recipes.
- Guided config forms for credentials, filesystem roots, database paths, URLs, and similar server-specific settings.
- Installed server cards with live status and actions.
- Start, stop, restart, connect, disconnect, configure, uninstall, and view logs controls.
- Expandable tool drawer showing exposed tool names, descriptions, and schemas.
- Per-tool enable/disable using Odysseus's existing MCP disabled-tool behavior.
- Automatic registration through the existing `McpManager` and assistant tool registry.

### Out of scope for v1

- Regular-user marketplace access.
- Arbitrary command entry from marketplace install flows.
- Automatic scheduled catalog refresh.
- Community submissions directly from the UI.
- Replacing the current manual MCP server management screen.

## Architecture

Odysseus will add an integrated marketplace layer under the current MCP/admin area:

1. **Catalog source service**
   - Maintains a configured list of curated local and remote catalog sources.
   - Fetches and normalizes catalog entries only when an admin triggers manual refresh.
   - Stores last refresh metadata and normalized entries for browsing.

2. **Recipe installer**
   - Accepts only catalog-defined install recipes.
   - Validates runtime type, command/package/image, args templates, env templates, required config fields, and install path.
   - Creates an isolated install directory under `data/mcp_marketplace/<server-id>/`.
   - Writes installed metadata and creates or updates the standard `McpServer` row.

3. **Runtime manager**
   - Starts, stops, and restarts marketplace-managed processes when Odysseus owns the process.
   - For externally hosted SSE servers, exposes connect/disconnect but not process controls.
   - Tracks status, recent logs, and last error.

4. **MCP connection and tool registry**
   - Reuses `McpManager` for MCP connect/disconnect, tool discovery, and call routing.
   - Reuses existing assistant registry wiring through `set_mcp_manager` and current MCP startup paths.
   - Refreshes tools after install, reconnect, or tool enable/disable changes.

5. **Admin UI panel**
   - Adds a Marketplace area near existing MCP server management.
   - Provides Browse, Installed, and Logs/Status views.
   - Uses server cards for high-level actions and expandable drawers for tool details.

## Catalog model

Each normalized catalog entry contains:

- `id`: stable marketplace entry id.
- `name`: display name.
- `description`: short user-facing summary.
- `publisher`: catalog publisher or maintainer.
- `version`: recipe/package version.
- `runtime`: one of `npm`, `python_uv`, `docker`, or `sse`.
- `recipe`: approved install/start/connect recipe.
- `config_fields`: catalog-defined form fields for required setup values.
- `permissions`: plain-language permission summary.
- `source_url`: upstream project or package source.
- `checksum` or pinned version metadata where available.
- `tool_hints`: optional expected tool names and descriptions.

Catalog refresh merges entries from all configured curated sources into a normalized local cache. Duplicate ids are resolved by source priority and version metadata.

## Install flow

1. Admin opens Marketplace.
2. Admin clicks Refresh Catalogs to fetch all curated sources.
3. Admin selects a catalog entry.
4. Odysseus displays permissions, runtime, install recipe summary, and required config fields.
5. Admin submits the guided config form.
6. Backend validates the entry, recipe, config values, and target install path.
7. Backend creates `data/mcp_marketplace/<server-id>/`.
8. Backend installs or prepares the runtime according to the approved recipe.
9. Backend stores installed marketplace metadata.
10. Backend creates or updates an `McpServer` row.
11. Backend starts/connects the server when possible.
12. `McpManager` discovers tools and registers them for assistant use.
13. UI moves the server into Installed with status, actions, logs, and tool drawer.

## Management behavior

Installed server cards show status with these colors:

- Green: running and connected.
- Yellow: installing, starting, reconnecting, or refreshing tools.
- Red: stopped, disconnected, errored, or failed install.

Actions:

- **Configure**: edit catalog-defined config fields and reconnect/restart when required.
- **Start**: start an Odysseus-managed process.
- **Stop**: stop an Odysseus-managed process.
- **Restart**: stop then start an Odysseus-managed process.
- **Connect**: connect MCP session through `McpManager`.
- **Disconnect**: disconnect MCP session without uninstalling.
- **Uninstall**: after confirmation, stop, disconnect, remove metadata, remove the `McpServer` row, and delete the isolated install directory.
- **View logs**: show recent install/runtime logs and last error.
- **Refresh tools**: reconnect or list tools again and update tool display.

Process controls are available only when Odysseus owns the process. Externally hosted SSE entries use connect/disconnect/configure only.

## Tool management

Each installed server has an expandable tool drawer:

- Tool name.
- Description.
- JSON schema preview.
- Enabled/disabled toggle.
- Last discovered timestamp.

Per-tool disabling uses the existing `McpServer.disabled_tools` behavior so hidden tools are removed from the assistant-visible registry. Toggling a tool refreshes the MCP tool state immediately.

## Backend API

Add or extend admin-only routes under `/api/mcp`:

- `GET /marketplace/catalogs` — list catalog sources and refresh state.
- `POST /marketplace/catalogs/refresh` — manually refresh all curated catalogs.
- `GET /marketplace/entries` — browse normalized catalog entries.
- `POST /marketplace/install/{entry_id}` — validate config, install, create MCP server row, start/connect.
- `GET /marketplace/installed` — list installed marketplace servers with runtime/status/log summary.
- `POST /marketplace/installed/{id}/start` — start managed process.
- `POST /marketplace/installed/{id}/stop` — stop managed process.
- `POST /marketplace/installed/{id}/restart` — restart managed process.
- `POST /marketplace/installed/{id}/configure` — update guided config.
- `DELETE /marketplace/installed/{id}` — uninstall after confirmation.
- Extend existing server tool endpoints as needed to include richer schema and status data.

All marketplace endpoints require admin authorization.

## Data storage

Use existing `data/` conventions:

- `data/mcp_marketplace/catalog_cache.json` or a small database table for normalized catalog entries.
- `data/mcp_marketplace/installed.json` or a small database table for installed marketplace metadata.
- `data/mcp_marketplace/<server-id>/` for install artifacts, generated config, logs, and runtime state.
- Existing `mcp_servers` rows for actual MCP connection configuration.

Add `mcp_servers` columns only if necessary for source/runtime metadata. Prefer separate marketplace metadata when the data is marketplace-specific.

Secrets collected during guided config should not be stored in public catalog cache. They should be stored only in installed server config/metadata with the same access assumptions as existing Odysseus settings and data files.

## Initial catalog seeds

Seed a small curated catalog with compatible entries such as:

- Filesystem MCP server.
- GitHub MCP server.
- SQLite MCP server.
- Playwright/browser MCP server.
- Other stable MCP servers that fit the recipe model and can be configured safely.

Each seed entry must include a permission summary and a guided config schema.

## Testing

Backend tests should cover:

- Catalog normalization across multiple curated sources.
- Source priority and duplicate entry handling.
- Recipe validation rejecting arbitrary commands and path traversal.
- Isolated install directory creation.
- Install metadata and `McpServer` row creation/update.
- Start, stop, restart, connect, and disconnect state transitions.
- Externally hosted SSE entries hiding process-only controls.
- Uninstall cleanup behavior.
- Tool listing and per-tool enable/disable.
- Admin-only route enforcement.

Frontend tests or focused UI checks should cover:

- Browse view rendering.
- Installed server cards and status colors.
- Guided config forms.
- Action button states by runtime/status.
- Tool drawer rendering and toggles.
- Error/log display.

## Rollout

1. Keep existing manual MCP server management working.
2. Add Marketplace as a new admin MCP section.
3. Ship with manual catalog refresh only.
4. Seed a small curated catalog.
5. Ensure installed servers auto-register through existing `McpManager` flow.
6. Keep regular users out of marketplace v1.

## Open decisions resolved

- Marketplace is admin-only.
- Installs use pre-approved recipes only.
- Catalogs come from multiple curated sources and refresh manually.
- Installs are isolated under `data/mcp_marketplace/`.
- Runtime support includes npm/npx, Python/uv, Docker, and SSE recipes.
- UI uses server cards with expandable tool drawers.
- Odysseus manages all server/tool behavior it owns and limits externally hosted servers to connect/disconnect/configure.
