# Expanded MCP Marketplace local-install catalog design

## Goal

Expand the Odysseus MCP Marketplace from a small local seed list into a large, curated, local-install-only catalog of MCP servers. The Marketplace should feel like an app store: searchable, categorized, and able to install/start/stop/restart/manage MCP servers from safe local package recipes.

## Source ingestion

Odysseus will aggregate multiple catalog sources with priority ordering:

1. **Odysseus curated catalog** — highest priority. This remains the trusted override layer for known-good package recipes, config fields, permissions, categories, tags, and tool hints.
2. **Official MCP Registry API** — primary external source. Odysseus pulls paginated registry data from the public read-only registry API, keeps latest active entries, and converts only supported local package metadata into installable recipes.
3. **Curated outsourced MCP libraries / awesome-lists** — secondary discovery sources. These sources may provide repository/package discovery and metadata enrichment, but Odysseus must not execute arbitrary README commands from them.

Manual refresh remains the trigger for external ingestion. Refresh writes a local cache so the Marketplace remains usable when external sources are unavailable.

## Local-install-only policy

Remote MCP endpoints are not installable in this Marketplace. Registry entries that only expose remote server URLs are excluded from installable results.

Supported local install recipe types:

- **npm/npx** package recipes.
- **PyPI/uv** package recipes.
- **Docker/OCI** image recipes.

Unsupported package types, remote-only entries, malformed package identifiers, and arbitrary command recipes are omitted from installable Marketplace results. The first implementation does not include a discovery-only mode.

## Recipe mapping

Registry and outsourced-library entries are normalized into the existing `CatalogEntry` shape where possible:

- `id`: stable marketplace ID derived from registry/server/package identity.
- `name`: display title from registry title/name.
- `description`: registry/list description.
- `publisher`: registry publisher/source/repository owner when available.
- `version`: latest registry/package version.
- `runtime`: one of `npm`, `python_uv`, or `docker`.
- `recipe`: safe recipe data only, never arbitrary commands.
- `config_fields`: guided setup fields from curated overrides when available.
- `permissions`: curated or inferred high-level permission labels.
- `source_url`: registry/repository/package URL.
- `source_id` and `source_priority`: source provenance.
- `tool_hints`, `categories`, `tags`: optional metadata for search and UI filters.

Odysseus curated entries override external entries with the same identity so maintainers can fix config fields, safer args, permissions, or display metadata.

## Install and lifecycle management

Installed Marketplace servers are managed by Odysseus end-to-end:

- Install converts the selected catalog entry into a local recipe and collects required config through guided forms.
- Installed metadata is stored under `data/mcp_marketplace`.
- The installed server is registered into the existing MCP server database/registry.
- Start, Stop, Restart, Configure, Refresh Tools, and Uninstall remain available in the Installed tab.
- After install/start/restart, Odysseus refreshes the MCP tool registry so enabled tools are available to the assistant prompt/tool cache.
- Installed servers remain manageable even if the source catalog later disappears or changes.

## UI design

The Marketplace remains accessible from:

- the visible sidebar Tools list above Brain; and
- the collapsed icon rail above the Brain icon.

The Marketplace modal scales to hundreds of entries:

### Browse tab

- Search across name, publisher, description, package, and tags.
- Category filters such as Filesystem, Database, Browser, DevTools, Memory, Search, Cloud, Communication, and other discovered categories.
- Runtime filters: npm, Python/uv, Docker.
- Source filters: Odysseus Curated, Official Registry, Community/Awesome Curated.
- Status badges: Installable, Needs config, Installed, Curated, Registry.
- Cards show title, description, publisher/source, runtime/package type, permissions/config needs, and install/manage action.
- Use pagination or Load More so 300+ entries stay responsive.

### Installed tab

- Shows all installed Marketplace MCP servers.
- Shows running/stopped/error status and logs/errors when available.
- Provides Start, Stop, Restart, Configure, Refresh Tools, and Uninstall actions.
- Provides a tool drawer with MCP tool names, schemas, and enable/disable toggles.

## Safety model

The Marketplace must preserve strict install safety:

- No arbitrary `recipe.command` execution.
- Validate npm/PyPI/Docker identifiers before writing install metadata.
- Reject path traversal and unsafe marketplace IDs.
- Required credentials/paths are collected through guided config forms.
- Secrets stay in installed server config/env metadata, not in the source catalog cache.
- External source failures fall back to the last cache and surface refresh errors.
- Install/start failures update installed status/logs without deleting the installed record.

## Testing plan

Implementation should remain TDD-first.

### Catalog ingestion tests

- Official Registry fixtures with npm/PyPI/Docker package metadata map into local install recipes.
- Remote-only registry entries are excluded.
- Pagination/cursor handling pulls multiple pages.
- Odysseus curated duplicates override lower-priority external entries.
- Cache fallback works when external refresh fails.
- Categories/tags/source/runtime metadata survive normalization.

### Runtime safety tests

- Arbitrary commands are rejected.
- Malformed package/image identifiers are rejected.
- Required config fields are validated.
- Existing path traversal protections remain green.

### Route tests

- Manual refresh pulls external catalogs through the new source pipeline.
- Entries endpoint returns category/tag/source/runtime data.
- Install/start/stop/restart/refresh-tools works for registry-derived local recipes.
- Admin-only enforcement remains.

### UI tests

- Marketplace is visible in the sidebar above Brain and in collapsed rail above Brain.
- Search, category, runtime, and source filters are wired.
- Browse handles large catalogs without injecting into hidden admin UI.
- Installed tab lifecycle buttons remain wired.

## Rollout

1. Keep the current curated seed entries.
2. Add the official registry pull and safe local recipe mapping behind manual Refresh Catalogs.
3. Add curated outsourced library enrichment after the registry path is green.
4. Rebuild/restart Docker.
5. Verify focused tests, served assets, admin-protected backend routes, and browser screenshots.
