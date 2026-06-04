# Odysseus Upstream Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely checkpoint and push the current verified Odysseus feature state, then integrate the latest original Odysseus upstream while preserving Host Access MCP, 100 seeded skills, and the expanded local-install MCP Marketplace.

**Architecture:** Use two branches: one immutable checkpoint branch from the currently verified detached working tree, and one integration branch based on latest `origin/main`. Commit and push the checkpoint first so rollback is guaranteed; then merge/cherry-pick the checkpoint branch into latest upstream and resolve conflicts deliberately. Verification gates run before push, after checkpoint push, and after upstream integration.

**Tech Stack:** Git, GitHub remotes (`origin`, `odysseus-t`), Python/pytest, Node syntax checks, Docker Compose, Chrome DevTools MCP/browser verification, Odysseus FastAPI/static UI.

---

## File Structure

This plan primarily changes git state, not product code. Product code should only change when resolving upstream integration conflicts.

- Preserve current modified/new feature files:
  - `routes/mcp_routes.py`
  - `src/mcp_marketplace_catalog.py`
  - `src/mcp_marketplace_registry.py`
  - `src/mcp_marketplace_runtime.py`
  - `static/index.html`
  - `static/js/admin.js`
  - `static/style.css`
  - `tests/test_mcp_marketplace_admin_js.py`
  - `tests/test_mcp_marketplace_catalog.py`
  - `tests/test_mcp_marketplace_registry.py`
  - `tests/test_mcp_marketplace_routes.py`
  - `tests/test_mcp_marketplace_runtime.py`
  - `tests/test_mcp_marketplace_store.py`
  - `docs/superpowers/specs/2026-06-04-expanded-mcp-marketplace-local-installs-design.md`
  - `docs/superpowers/plans/2026-06-04-expanded-mcp-marketplace-local-installs.md`
- Preserve current test-harness fixes:
  - `tests/test_companion_pairing.py`
  - `tests/test_cookbook_helpers.py`
  - `tests/test_host_bridge_routes.py`
  - `tests/test_hwfit_macos.py`
  - `tests/test_local_endpoint_js.py`
  - `tests/test_markdown_rendering_js.py`
  - `tests/test_reply_recipients_js.py`
  - `tests/test_security_regressions.py`
  - `tests/test_shell_routes.py`
  - `tests/test_sqlite_foreign_keys.py`
  - `tests/test_topic_analyzer.py`
  - `tests/test_webhook_ssrf_resilience.py`
- Preserve any already-committed local features on current detached base, including:
  - Host Access MCP.
  - 100 seeded skills.
  - existing MCP marketplace foundation.
- Create git branches:
  - `checkpoint/verified-marketplace-host-skills-2026-06-04`
  - `integration/upstream-main-with-local-features-2026-06-04`
- Push to remote:
  - `odysseus-t` unless the user explicitly changes target.

---

### Task 1: Preflight current repository state

**Files:**
- Read-only git state.

- [ ] **Step 1: Confirm repository and detached HEAD**

Run:

```bash
git -C "/e/Workspace/odysseus" status --short
git -C "/e/Workspace/odysseus" branch -vv
git -C "/e/Workspace/odysseus" remote -v
```

Expected:

```text
- Working tree has Marketplace/test-harness changes.
- HEAD is detached from 142d08f or equivalent verified feature base.
- Remotes include origin and odysseus-t.
```

- [ ] **Step 2: Confirm no sensitive files are about to be committed**

Run:

```bash
git -C "/e/Workspace/odysseus" status --short | grep -E "(^|/)(\.env|auth\.json|credentials|secret|token|key)(\.|$)" || true
```

Expected:

```text
No auth/secret file paths are listed.
```

- [ ] **Step 3: Confirm live feature still works before checkpoint**

Run:

```bash
cd "/e/Workspace/odysseus" && PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py tests/test_mcp_marketplace_catalog.py tests/test_mcp_marketplace_registry.py tests/test_mcp_marketplace_routes.py tests/test_mcp_marketplace_runtime.py tests/test_mcp_marketplace_store.py -q --tb=short
```

Expected:

```text
All focused Marketplace tests pass.
```

- [ ] **Step 4: Confirm syntax checks still pass before checkpoint**

Run:

```bash
cd "/e/Workspace/odysseus" && node --check static/js/admin.js && python -m py_compile src/mcp_marketplace_catalog.py src/mcp_marketplace_registry.py src/mcp_marketplace_runtime.py routes/mcp_routes.py
```

Expected:

```text
Command exits 0 with no syntax errors.
```

---

### Task 2: Create and commit checkpoint branch

**Files:**
- Git branch: `checkpoint/verified-marketplace-host-skills-2026-06-04`
- Commit current working tree exactly after preflight.

- [ ] **Step 1: Create checkpoint branch without changing files**

Run:

```bash
git -C "/e/Workspace/odysseus" switch -c checkpoint/verified-marketplace-host-skills-2026-06-04
```

Expected:

```text
Switched to a new branch 'checkpoint/verified-marketplace-host-skills-2026-06-04'
```

- [ ] **Step 2: Stage only relevant files**

Run:

```bash
git -C "/e/Workspace/odysseus" add \
  routes/mcp_routes.py \
  src/mcp_marketplace_catalog.py \
  src/mcp_marketplace_registry.py \
  src/mcp_marketplace_runtime.py \
  static/index.html \
  static/js/admin.js \
  static/style.css \
  tests/test_mcp_marketplace_admin_js.py \
  tests/test_mcp_marketplace_catalog.py \
  tests/test_mcp_marketplace_registry.py \
  tests/test_mcp_marketplace_routes.py \
  tests/test_mcp_marketplace_runtime.py \
  tests/test_mcp_marketplace_store.py \
  tests/test_companion_pairing.py \
  tests/test_cookbook_helpers.py \
  tests/test_host_bridge_routes.py \
  tests/test_hwfit_macos.py \
  tests/test_local_endpoint_js.py \
  tests/test_markdown_rendering_js.py \
  tests/test_reply_recipients_js.py \
  tests/test_security_regressions.py \
  tests/test_shell_routes.py \
  tests/test_sqlite_foreign_keys.py \
  tests/test_topic_analyzer.py \
  tests/test_webhook_ssrf_resilience.py \
  docs/superpowers/specs/2026-06-04-expanded-mcp-marketplace-local-installs-design.md \
  docs/superpowers/plans/2026-06-04-expanded-mcp-marketplace-local-installs.md
```

Expected:

```text
Command exits 0.
```

- [ ] **Step 3: Review staged diff summary**

Run:

```bash
git -C "/e/Workspace/odysseus" diff --cached --stat
git -C "/e/Workspace/odysseus" diff --cached --name-only
```

Expected:

```text
Only intended Marketplace, test-harness, and docs files are staged.
No auth.json, .env, credentials, or generated screenshots are staged.
```

- [ ] **Step 4: Commit checkpoint**

Run:

```bash
git -C "/e/Workspace/odysseus" commit -m "$(cat <<'EOF'
Add expanded local MCP marketplace

Preserve the verified Host Access/skills branch state while adding the visible MCP Marketplace, official registry ingestion, local-only lifecycle controls, and Windows/order-stable test coverage.
EOF
)"
```

Expected:

```text
[checkpoint/verified-marketplace-host-skills-2026-06-04 <sha>] Add expanded local MCP marketplace
```

- [ ] **Step 5: Confirm checkpoint branch is clean except intentionally ignored/untracked workspace files**

Run:

```bash
git -C "/e/Workspace/odysseus" status --short
```

Expected:

```text
No intended Marketplace/test-harness source changes remain unstaged.
Only unrelated local artifacts may remain untracked.
```

---

### Task 3: Push checkpoint branch to safe remote

**Files:**
- Remote branch on `odysseus-t`: `checkpoint/verified-marketplace-host-skills-2026-06-04`

- [ ] **Step 1: Push checkpoint branch**

Run:

```bash
git -C "/e/Workspace/odysseus" push -u odysseus-t checkpoint/verified-marketplace-host-skills-2026-06-04
```

Expected:

```text
Branch pushed and tracking odysseus-t/checkpoint/verified-marketplace-host-skills-2026-06-04.
```

- [ ] **Step 2: Verify remote branch exists**

Run:

```bash
git -C "/e/Workspace/odysseus" ls-remote --heads odysseus-t checkpoint/verified-marketplace-host-skills-2026-06-04
```

Expected:

```text
A commit SHA and refs/heads/checkpoint/verified-marketplace-host-skills-2026-06-04 are printed.
```

---

### Task 4: Create latest-upstream integration branch

**Files:**
- Git branch: `integration/upstream-main-with-local-features-2026-06-04`

- [ ] **Step 1: Fetch latest original upstream**

Run:

```bash
git -C "/e/Workspace/odysseus" fetch origin --prune
```

Expected:

```text
Fetch exits 0.
```

- [ ] **Step 2: Create integration branch from latest original upstream**

Run:

```bash
git -C "/e/Workspace/odysseus" switch -c integration/upstream-main-with-local-features-2026-06-04 origin/main
```

Expected:

```text
Switched to a new branch 'integration/upstream-main-with-local-features-2026-06-04'
```

- [ ] **Step 3: Record upstream base commit**

Run:

```bash
git -C "/e/Workspace/odysseus" rev-parse --short HEAD
git -C "/e/Workspace/odysseus" log --oneline -1
```

Expected:

```text
HEAD matches latest origin/main, currently cf5c511 or newer.
```

---

### Task 5: Merge checkpoint branch into latest upstream

**Files:**
- Conflict-dependent. Expect likely conflicts in:
  - `static/index.html`
  - `static/js/admin.js`
  - `static/style.css`
  - `routes/mcp_routes.py`
  - `tests/conftest.py`
  - marketplace/test harness files.

- [ ] **Step 1: Merge checkpoint without committing automatically**

Run:

```bash
git -C "/e/Workspace/odysseus" merge --no-ff --no-commit checkpoint/verified-marketplace-host-skills-2026-06-04
```

Expected:

```text
Either clean merge staged for commit or conflict list is printed.
```

- [ ] **Step 2: List conflicts if any**

Run:

```bash
git -C "/e/Workspace/odysseus" diff --name-only --diff-filter=U
```

Expected:

```text
If output is empty, continue to Task 6.
If output lists files, resolve each conflict deliberately.
```

- [ ] **Step 3: Resolve `static/index.html` conflicts by preserving both upstream UI improvements and Marketplace placement**

Required final invariants in `static/index.html`:

```html
<button class="icon-rail-btn" id="rail-mcp-marketplace" title="MCP Marketplace">
```

must appear immediately before:

```html
<button class="icon-rail-btn" id="rail-memory" title="Brain">
```

and the visible Tools list must contain:

```html
<div class="list-item" id="tool-mcp-marketplace-btn">
  ...
  <span class="grow">MCP Marketplace</span>
</div>
<div class="list-item" id="tool-memory-btn">
```

Also preserve the Marketplace modal nodes:

```html
<div id="adm-mcp-marketplace-filters" class="mcp-marketplace-filters">
<input id="adm-mcp-marketplace-search"
<select id="adm-mcp-marketplace-category"
<select id="adm-mcp-marketplace-runtime"
<select id="adm-mcp-marketplace-source"
<div id="adm-mcp-marketplace-browse" class="mcp-marketplace-grid"></div>
<button id="adm-mcp-marketplace-load-more"
<div id="adm-mcp-marketplace-installed" class="mcp-marketplace-grid hidden"></div>
```

- [ ] **Step 4: Resolve `static/js/admin.js` conflicts by preserving Marketplace wiring and upstream UI fixes**

Required final functions/identifiers in `static/js/admin.js`:

```javascript
function initMcpMarketplaceRail()
function openMcpMarketplaceModal()
function loadMcpMarketplaceEntries()
function renderMcpMarketplaceFilterOptions(entries)
function filterMcpMarketplaceEntries(entries)
function renderMcpMarketplaceBrowse()
function renderMcpMarketplaceInstalled()
```

Required final behavior:

```javascript
const browseActive = !el('adm-mcp-marketplace-browse')?.classList.contains('hidden');
loadMore.classList.toggle('hidden', !browseActive || filtered.length <= _mcpMarketplaceVisibleCount);
el('adm-mcp-marketplace-filters')?.classList.toggle('hidden', tab !== 'browse');
el('adm-mcp-marketplace-load-more')?.classList.toggle('hidden', tab !== 'browse' || filterMcpMarketplaceEntries(_mcpMarketplaceEntries).length <= _mcpMarketplaceVisibleCount);
```

- [ ] **Step 5: Resolve `static/style.css` conflicts by preserving hidden overrides and upstream styles**

Required final CSS:

```css
.mcp-marketplace-filters.hidden {
  display: none;
}

.mcp-marketplace-grid.hidden {
  display: none;
}

.mcp-marketplace-meta-badge {
  color: var(--color-muted);
}
```

Do not use:

```css
var(--text-muted)
```

- [ ] **Step 6: Resolve `routes/mcp_routes.py` conflicts by preserving lifecycle and malformed disabled_tools guard**

Required final endpoints/handlers must still include:

```python
@router.post("/marketplace/catalogs/refresh")
def marketplace_refresh_catalogs(request: Request):
    require_admin(request)
    return refresh_catalog_cache(default_catalog_sources(include_external=True))
```

and single-server tools must tolerate malformed `disabled_tools` values:

```python
disabled_list = []
if srv and srv.disabled_tools:
    try:
        disabled_list = json.loads(srv.disabled_tools)
    except (json.JSONDecodeError, TypeError):
        disabled_list = []
disabled_set = set(disabled_list)
```

- [ ] **Step 7: Resolve Marketplace Python module conflicts**

Required final files/functions:

`src/mcp_marketplace_registry.py`:

```python
def normalize_registry_servers(raw_servers, source_id: str, source_priority: int):
    ...

def registry_entries_from_payload(payload, source_id: str, source_priority: int):
    ...

def fetch_registry_catalog(url: str, source_id: str, source_priority: int, client=None, page_limit: int = 10, request_timeout: float = 20.0):
    ...
```

`src/mcp_marketplace_catalog.py`:

```python
def default_catalog_sources(include_external: bool = False) -> List[CatalogSource]:
    ...
```

and external source must be manual-refresh only:

```python
default_catalog_sources(include_external=True)
```

only in refresh route/tests, not normal entry reads unless intentionally cached.

`src/mcp_marketplace_runtime.py` must keep:

```python
if "command" in entry.recipe:
    raise ValueError("arbitrary command recipes are not allowed")
```

and Docker image validation for `ghcr.io/acme/mcp-server:1.0.0`.

- [ ] **Step 8: Resolve test conflicts by preferring upstream centralized fixes when cleaner**

If conflicts involve these upstream commits:

```text
965185c fix(tests): pre-import real sqlalchemy/database in conftest to prevent stub contamination
5869106 test: stabilize full test collection
a91321d Scope core.* module stubs to the test, not the module
3d8c364 [Bash] Fix Windows cookbook background tasks
```

Prefer upstream centralized/fixture-scoped fixes over repeated local `sys.modules.pop()` patches when they produce passing tests and do not weaken coverage.

Required final tests must still cover:

```python
assert ".mcp-marketplace-grid.hidden" in css
assert ".mcp-marketplace-filters.hidden" in css
```

and:

```python
assert tool["is_disabled"] is True
```

in Marketplace route disabled-tool coverage.

- [ ] **Step 9: Stage resolved files and complete merge commit**

Run:

```bash
git -C "/e/Workspace/odysseus" status --short
git -C "/e/Workspace/odysseus" diff --name-only --diff-filter=U
```

Expected:

```text
No unmerged files remain.
```

Then stage resolved files:

```bash
git -C "/e/Workspace/odysseus" add <resolved-files>
```

Then commit merge:

```bash
git -C "/e/Workspace/odysseus" commit -m "$(cat <<'EOF'
Merge verified local features onto upstream main

Preserve Host Access MCP, seeded skills, and expanded local MCP Marketplace while bringing in the latest original Odysseus updates.
EOF
)"
```

Expected:

```text
Merge commit is created on integration/upstream-main-with-local-features-2026-06-04.
```

---

### Task 6: Verify integrated branch locally

**Files:**
- Read/execute only.

- [ ] **Step 1: Run Marketplace focused tests**

Run:

```bash
cd "/e/Workspace/odysseus" && PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests/test_mcp_marketplace_admin_js.py tests/test_mcp_marketplace_catalog.py tests/test_mcp_marketplace_registry.py tests/test_mcp_marketplace_routes.py tests/test_mcp_marketplace_runtime.py tests/test_mcp_marketplace_store.py -q --tb=short
```

Expected:

```text
All Marketplace tests pass.
```

- [ ] **Step 2: Run full suite**

Run:

```bash
cd "/e/Workspace/odysseus" && PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' python -m pytest tests -q --maxfail=1 --tb=short
```

Expected:

```text
Full suite exits 0.
```

If this fails, record exact failing test and check upstream candidates before patching:

```bash
git -C "/e/Workspace/odysseus" log --oneline origin/main -- <failing-file>
```

- [ ] **Step 3: Run syntax/compile checks**

Run:

```bash
cd "/e/Workspace/odysseus" && node --check static/js/admin.js && python -m py_compile src/mcp_marketplace_catalog.py src/mcp_marketplace_registry.py src/mcp_marketplace_runtime.py routes/mcp_routes.py
```

Expected:

```text
Command exits 0.
```

- [ ] **Step 4: Run static safety checks**

Run:

```bash
cd "/e/Workspace/odysseus" && \
  ! grep -R --line-number --exclude-dir=.git --exclude='*.md' 'pinned_models' routes src static tests && \
  ! grep -R --line-number --exclude-dir=.git -- '--text-muted' static/style.css && \
  grep -R --line-number 'mcp-marketplace-grid.hidden' static/style.css && \
  grep -R --line-number 'mcp-marketplace-filters.hidden' static/style.css && \
  grep -R --line-number 'arbitrary command recipes are not allowed' src/mcp_marketplace_runtime.py
```

Expected:

```text
No runtime pinned_models hits, no --text-muted, hidden CSS rules exist, arbitrary command rejection exists.
```

---

### Task 7: Rebuild Docker and verify live Odysseus UI

**Files:**
- Docker image/container only.
- Screenshot artifact allowed but do not stage it unless user asks.

- [ ] **Step 1: Rebuild and restart Odysseus**

Run:

```bash
cd "/e/Workspace/odysseus" && docker compose -p odysseus up -d --build odysseus
```

Expected:

```text
Odysseus container rebuilds and starts successfully.
```

- [ ] **Step 2: Open live app with browser MCP**

Use Chrome DevTools MCP:

```text
navigate_page url=http://127.0.0.1:7000/
```

Expected:

```text
Odysseus main UI appears after login/session.
```

- [ ] **Step 3: Verify Marketplace placement in browser DOM**

Use browser MCP evaluate script:

```javascript
() => {
  const sidebarTools = [...document.querySelectorAll('#tools-section .list-item, #tools-section button')]
    .map(el => el.textContent.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return {
    sidebarTools,
    marketplaceBeforeBrain:
      sidebarTools.indexOf('MCP Marketplace') !== -1 &&
      sidebarTools.indexOf('Brain') !== -1 &&
      sidebarTools.indexOf('MCP Marketplace') < sidebarTools.indexOf('Brain'),
    railMarketplace: !!document.getElementById('rail-mcp-marketplace'),
    railBrain: !!document.getElementById('rail-memory'),
  };
}
```

Expected JSON:

```json
{
  "marketplaceBeforeBrain": true,
  "railMarketplace": true,
  "railBrain": true
}
```

- [ ] **Step 4: Verify modal tab hiding in browser DOM**

Open Marketplace, click Installed, then evaluate:

```javascript
() => {
  const info = (selector) => {
    const el = document.querySelector(selector);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {className: el.className, display: cs.display, width: r.width, height: r.height};
  };
  return {
    filters: info('#adm-mcp-marketplace-filters'),
    browse: info('#adm-mcp-marketplace-browse'),
    installed: info('#adm-mcp-marketplace-installed'),
    loadMore: info('#adm-mcp-marketplace-load-more'),
  };
}
```

Expected:

```text
filters.display == 'none'
browse.display == 'none'
installed.display == 'grid' or visible layout display
loadMore is hidden when installed tab is active
```

- [ ] **Step 5: Run safe live lifecycle smoke**

Create container-side test root:

```bash
docker exec odysseus-odysseus-1 sh -lc 'mkdir -p /tmp/odysseus-marketplace-smoke'
```

Use authenticated browser MCP `evaluate_script`:

```javascript
async () => {
  const result = {steps: []};
  async function req(label, url, options = {}) {
    const res = await fetch(url, {
      headers: {'Content-Type': 'application/json', ...(options.headers || {})},
      ...options,
    });
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    result.steps.push({label, status: res.status, ok: res.ok, body});
    if (!res.ok) throw new Error(`${label} failed ${res.status}`);
    return body;
  }
  const install = await req('install filesystem', '/api/mcp/marketplace/install/filesystem', {
    method: 'POST',
    body: JSON.stringify({config: {root: '/tmp/odysseus-marketplace-smoke'}}),
  });
  const installedId = install.installed_id || install.id;
  await new Promise(r => setTimeout(r, 1000));
  await req('installed after install', '/api/mcp/marketplace/installed');
  await req('refresh tools', `/api/mcp/marketplace/installed/${installedId}/refresh-tools`, {method: 'POST'});
  await req('stop', `/api/mcp/marketplace/installed/${installedId}/stop`, {method: 'POST'});
  await req('start', `/api/mcp/marketplace/installed/${installedId}/start`, {method: 'POST'});
  await req('restart', `/api/mcp/marketplace/installed/${installedId}/restart`, {method: 'POST'});
  await req('uninstall', `/api/mcp/marketplace/installed/${installedId}`, {method: 'DELETE'});
  const after = await req('installed after uninstall', '/api/mcp/marketplace/installed');
  result.removed = Array.isArray(after) && !after.some(item => item.id === installedId || item.installed_id === installedId);
  return result;
}
```

Expected:

```json
{
  "removed": true,
  "steps": [
    {"label":"install filesystem","status":200,"ok":true},
    {"label":"installed after install","status":200,"ok":true},
    {"label":"refresh tools","status":200,"ok":true},
    {"label":"stop","status":200,"ok":true},
    {"label":"start","status":200,"ok":true},
    {"label":"restart","status":200,"ok":true},
    {"label":"uninstall","status":200,"ok":true},
    {"label":"installed after uninstall","status":200,"ok":true}
  ]
}
```

---

### Task 8: Push integrated branch

**Files:**
- Remote branch on `odysseus-t`: `integration/upstream-main-with-local-features-2026-06-04`

- [ ] **Step 1: Confirm clean integration branch**

Run:

```bash
git -C "/e/Workspace/odysseus" status --short
git -C "/e/Workspace/odysseus" log --oneline --max-count=5
```

Expected:

```text
No uncommitted source changes remain.
Recent history includes merge commit preserving local features.
```

- [ ] **Step 2: Push integration branch**

Run:

```bash
git -C "/e/Workspace/odysseus" push -u odysseus-t integration/upstream-main-with-local-features-2026-06-04
```

Expected:

```text
Branch pushed and tracking odysseus-t/integration/upstream-main-with-local-features-2026-06-04.
```

---

### Task 9: Final report

**Files:**
- None.

- [ ] **Step 1: Summarize branches and verification**

Report these exact fields:

```text
Checkpoint branch: checkpoint/verified-marketplace-host-skills-2026-06-04
Checkpoint pushed: yes/no
Integration branch: integration/upstream-main-with-local-features-2026-06-04
Integration pushed: yes/no
Original upstream base: <sha>
Local feature commit/merge: <sha>
Focused Marketplace tests: pass/fail
Full suite: pass/fail
Docker/browser verification: pass/fail
Live lifecycle smoke: pass/fail
Known caveats: <list>
```

- [ ] **Step 2: If push fails due credentials or remote permissions**

Report:

```text
Local branch is committed and ready.
Push failed because: <exact reason>
Run this yourself if needed:
git -C "/e/Workspace/odysseus" push -u odysseus-t <branch-name>
```

---

## Self-Review

- Spec coverage: Plan covers checkpointing, pushing current state, creating latest-upstream integration branch, preserving Host Access MCP/seeded skills/Marketplace, verification, Docker/browser live checks, and final reporting.
- Placeholder scan: No TBD/TODO/implement-later placeholders remain. Conflict resolution steps specify final invariants and exact code snippets to preserve.
- Type/identifier consistency: Branch names, file paths, function names, endpoint names, and CSS selectors are consistent across tasks.
- Safety: No direct pull into dirty detached state. No force push. No secret files staged. Push target is `odysseus-t` unless user changes it.
