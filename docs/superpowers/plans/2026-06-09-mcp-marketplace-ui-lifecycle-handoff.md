# Handoff: MCP Marketplace rail UI and lifecycle validation

Date: 2026-06-09
Branch: `main`
Commit before this handoff: `405a45f Restore MCP marketplace and local browser validation`

## Summary

This handoff captures the completed Odysseus-T Marketplace work on `C:/Odysseus-T`:

- Moved MCP Marketplace out of Settings into the main UI under Cookbook/Cooknook.
- Added both icon-rail and expanded-sidebar Marketplace entry points.
- Reused Odysseus modal/card/button styling so the Marketplace matches the existing UI.
- Restored expanded registry-backed MCP Marketplace catalog ingestion.
- Added installed-server Configure support so config-required MCPs can be corrected after install.
- Verified Marketplace install/configure/start/stop/restart/uninstall through visible Chrome and Odysseus Agent-mode chat.
- Fixed full-suite test isolation/platform issues so the configured suite passes on this Windows/Git Bash environment.

## Key files changed

### Marketplace UI

- `static/index.html`
  - Added `#rail-mcp-marketplace` after `#rail-cookbook`.
  - Added `#tool-mcp-marketplace-btn` after `#tool-cookbook-btn` for expanded-sidebar visibility.
  - Added `#mcp-marketplace-modal` using existing modal/admin card styles.
  - Removed Settings Marketplace tab/panel markup.

- `static/app.js`
  - Wires both Marketplace buttons to `adminModule.openMcpMarketplace?.()`.

- `static/js/admin.js`
  - Adds `openMcpMarketplace()` / `closeMcpMarketplace()`.
  - Reuses existing Marketplace browse/installed render functions and endpoints.
  - Adds Installed-card `Configure` action.
  - Keeps lifecycle actions: Start, Stop, Restart, Tools, Refresh Tools.

- `static/js/settings.js`
  - Removes `marketplace` from `ADMIN_TABS`.

- `static/js/modalManager.js`
  - Adds modal/dock metadata for `mcp-marketplace-modal`.

### Marketplace backend/catalog

- `routes/mcp_routes.py`
  - Installed payload now includes `config_fields` from the catalog entry.
  - This enables reconfiguring already-installed config-required MCPs.

- `src/mcp_marketplace_catalog.py`
  - Supports external registry source inclusion.

- `src/mcp_marketplace_registry.py`
  - New official MCP Registry normalization/fetch support.

### Related runtime fixes

- `core/database.py`
  - Adds `pinned_models` field and migration for model endpoints.

- `routes/auth_routes.py`
  - Allows auth-disabled local mode to save auth/model settings.

- `routes/session_routes.py`
  - Allows anonymous local auth-disabled sessions while preserving owner checks.

- `src/agent_loop.py`, `src/tool_security.py`
  - Keeps MCP tool schemas reachable in auth-disabled single-user mode and Agent mode.

- `static/js/skills.js`
  - Avoids eager skill markdown fetches that saturated browser request pools.

## Verification performed

### Focused tests

```bash
cd /c/Odysseus-T
python -m pytest -p no:cacheprovider tests/test_mcp_marketplace_admin_js.py tests/test_dialog_aria.py -q
```

Result:

```text
10 passed
```

```bash
cd /c/Odysseus-T
DATABASE_URL="sqlite:///C:/Users/prova/AppData/Local/Temp/odysseus_marketplace_verify_after_auth.db" \
  python -m pytest -p no:cacheprovider \
  tests/test_mcp_marketplace_routes.py \
  tests/test_mcp_marketplace_catalog.py \
  tests/test_mcp_marketplace_registry.py -q
```

Result:

```text
23 passed
```

### JavaScript syntax

```bash
node --check C:/Odysseus-T/static/app.js \
  && node --check C:/Odysseus-T/static/js/admin.js \
  && node --check C:/Odysseus-T/static/js/settings.js \
  && node --check C:/Odysseus-T/static/js/modalManager.js
```

Result: passed.

### Full suite

```bash
cd /c/Odysseus-T
PYTHONDONTWRITEBYTECODE=1 python -m pytest -p no:cacheprovider --tb=short -x -q
```

Result:

```text
1205 passed, 2 skipped
```

### Independent verifier

Final independent verification returned **PARTIAL** only because its isolated live npx-backed Filesystem install hit the known local npm/npx `EISDIR` issue. It independently passed:

- Static UI placement/removal checks.
- Focused Marketplace tests.
- JS syntax checks.
- Full pytest suite.
- Live HTTP static/API markers.
- API adversarial probes.
- Screenshot artifact validation.

### Visible Chrome / Odysseus Agent-mode validation

Visible Chrome test sent Odysseus this Agent-mode prompt:

```text
Agent-mode test. Do not simulate. Use actual Odysseus tools or API actions if available. Install one safe MCP from the MCP Marketplace, start it, prove it is usable by showing its installed status and available tool count/tools, restart it, stop it, then uninstall it. Report each step with the actual status/result.
```

Observed behavior:

- Odysseus checked current MCP state with real tools/API calls.
- It tried SQLite MCP first, detected `uvx` unavailable, and uninstalled it.
- It installed Playwright Browser MCP from Marketplace.
- It proved Playwright was connected with `23 tools`.
- It listed tool/status information.
- It restarted Playwright.
- It stopped Playwright.
- It uninstalled Playwright.
- Final backend installed IDs returned to the original baseline:
  - `filesystem connected 14`
  - `memory connected 9`
  - no `playwright` installed entry.

Screenshot evidence:

- `data/browser-mcp-marketplace-rail-modal.png`
- `data/browser-mcp-marketplace-lifecycle.png`
- `data/browser-odysseus-chat-mcp-lifecycle.png`

## Important environment notes

- Use authoritative source at `C:/Odysseus-T`.
- Docker/Compose Windows path handling should use `C:/Odysseus-T`, not `/tmp` or untrusted drive copies.
- Chrome DevTools MCP via `npx` is flaky in this environment due known npm `EISDIR`; cached Chrome DevTools MCP CLI was used.
- Auth-disabled local browser testing uses:

```bash
AUTH_ENABLED=false
LOCALHOST_BYPASS=true
ODYSSEUS_HOST_BRIDGE_ENABLED=true
ODYSSEUS_HOST_BRIDGE_TOKEN=local-test-token
```

- Filesystem MCP inside Docker must use a container-visible path such as `/app/data`, not a Windows host path.

## Current state

- Marketplace UI is accessible from the left rail/sidebar under Cookbook.
- Marketplace is no longer in Settings.
- Installed MCP lifecycle controls work from the Marketplace modal.
- Odysseus Agent mode can use actual tools/API actions to perform Marketplace lifecycle tasks.
- Full pytest is green locally.

## Follow-up / open item

The pending future request is to design a larger Marketplace UX/source expansion:

- broader/near-infinite source ingestion,
- stronger search/filtering/discovery UX,
- around 10 additional Marketplace UX improvements.

That should be handled as a separate design/spec cycle before implementation.
