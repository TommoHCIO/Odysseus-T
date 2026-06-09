# Odysseus C-Drive Docker and Chrome MCP Test Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that the recovered Odysseus-T fork runs from `C:/Odysseus-T` through Docker, that Docker bind mounts point at the C-drive copy instead of the corrupted E-drive copy, and that the web UI works at `http://127.0.0.1:7000` when tested through Chrome DevTools MCP.

**Architecture:** Treat `C:/Odysseus-T` as the only authoritative working copy. Use Docker Compose with `--project-directory /c/Odysseus-T` and project name `odysseus-t` so Compose renders bind mounts from `C:\Odysseus-T` and does not reuse the old stopped `odysseus-*` containers that still mount `E:\Workspace\odysseus`. Test in layers: static repo integrity, Compose mount rendering, container startup, API health, admin/MCP endpoints, optional host bridge, then browser UI behavior through Chrome DevTools MCP.

**Tech Stack:** Windows 11, Docker Desktop 29.5.2, Docker Compose, FastAPI/Uvicorn, Python 3.12 container, ChromaDB, SearXNG, ntfy, MCP SSE/stdio servers, Chrome DevTools MCP, Git.

---

## Source-of-truth context

- Authoritative repo path: `C:/Odysseus-T`
- Git remote: `https://github.com/TommoHCIO/Odysseus-T.git`
- Current branch at handoff creation: `main`
- Current synced commit at handoff creation: `5633cbc Initialize Odysseus-T feature snapshot`
- Original upstream reference: `https://github.com/pewdiepie-archdaemon/odysseus`
- User fork/reference repo: `https://github.com/TommoHCIO/Odysseus-T`
- Recovered source was copied from `E:/workspace/odysseus-t-export` to `C:/Odysseus-T`.
- `E:` is not trustworthy. It is NTFS, marked dirty/full-repair-needed, and read operations hung on at least `E:/workspace/odysseus-t-export/docs/compare.gif`.
- Do not use `E:/workspace/odysseus` or `E:/workspace/odysseus-t-export` for runtime testing.
- The C copy was repaired from Git objects after transfer:
  - `docs/compare.gif` restored to `3,564,957` bytes
  - `services/memory/skills.py` restored to `28,420` bytes
- Verified after transfer:
  - `git -C /c/Odysseus-T fsck --no-progress` exited `0`
  - `python -m compileall -q /c/Odysseus-T/host_bridge /c/Odysseus-T/src /c/Odysseus-T/routes /c/Odysseus-T/mcp_servers /c/Odysseus-T/scripts` exited `0`
  - critical MCP/host files are present
- Old stopped Docker containers exist and must not be reused blindly:
  - `odysseus-odysseus-1`
  - `odysseus-searxng-1`
  - `odysseus-chromadb-1`
  - `odysseus-ntfy-1`
- Old `odysseus-odysseus-1` mounts point at `E:\Workspace\odysseus`, including:
  - `E:\Workspace\odysseus\data` -> `/app/data`
  - `E:\Workspace\odysseus\logs` -> `/app/logs`
  - `E:\Workspace\odysseus\data\ssh` -> `/app/.ssh`
  - `E:\Workspace\odysseus\data\huggingface` -> `/app/.cache/huggingface`
  - `E:\Workspace\odysseus\data\local` -> `/app/.local`
- Always use Compose project name `odysseus-t` and project directory `/c/Odysseus-T` for this test pass.

## Verified important files in `C:/Odysseus-T`

- `docker-compose.yml`
- `Dockerfile`
- `docker/entrypoint.sh`
- `app.py`
- `host_bridge/mcp_app.py`
- `host_bridge/policy.py`
- `host_bridge/server.py`
- `host_bridge/config.example.json`
- `src/host_bridge_control.py`
- `src/builtin_mcp.py`
- `src/mcp_marketplace_catalog.py`
- `src/mcp_marketplace_runtime.py`
- `src/mcp_marketplace_store.py`
- `routes/mcp_routes.py`
- `mcp_servers/email_server.py`
- `mcp_servers/image_gen_server.py`
- `mcp_servers/memory_server.py`
- `mcp_servers/rag_server.py`
- `scripts/seed_odysseus_skills.py`
- `data/mcp_marketplace/catalog_cache.json`
- `data/mcp_marketplace/curated_catalog.json`
- `static/index.html`
- `static/js/admin.js`

## Docker Compose facts from `C:/Odysseus-T/docker-compose.yml`

Run this command from any shell:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T config --format json
```

The rendered config must show:

- service `odysseus` build context: `C:\Odysseus-T`
- service `odysseus` port: `127.0.0.1:7000 -> 7000/tcp`
- service `searxng` port: `127.0.0.1:8080 -> 8080/tcp`
- service `chromadb` port: `127.0.0.1:8100 -> 8000/tcp`
- service `ntfy` port: `127.0.0.1:8091 -> 80/tcp`
- service `odysseus` bind mounts:
  - `C:\Odysseus-T\data` -> `/app/data`
  - `C:\Odysseus-T\logs` -> `/app/logs`
  - `C:\Odysseus-T\data\ssh` -> `/app/.ssh`
  - `C:\Odysseus-T\data\huggingface` -> `/app/.cache/huggingface`
  - `C:\Odysseus-T\data\local` -> `/app/.local`
- service `searxng` bind mount:
  - `C:\Odysseus-T\config\searxng\settings.yml` -> `/tmp/searxng-settings.yml.template`

At handoff creation, `docker version --format '{{.Client.Version}} / {{.Server.Version}}'` returned:

```text
29.5.2 / 29.5.2
```

## Auth and endpoint facts

- Health endpoint: `GET /api/health`
  - source: `app.py:771-773`
  - expected JSON shape: `{"status":"healthy","timestamp":"..."}`
- Version endpoint: `GET /api/version`
  - source: `app.py:766-769`
- Runtime endpoint: `GET /api/runtime`
  - source: `app.py:775+`
- SPA root: `GET /`
  - source: `app.py:711-719`
  - serves `static/index.html`
- Auth status: `GET /api/auth/status`
  - source: `routes/auth_routes.py:159-174`
- Admin-only MCP routes use `core.middleware.require_admin`:
  - `AUTH_ENABLED=false` allows admin-gated routes for local test mode
  - source: `core/middleware.py:19-44`
- MCP marketplace API routes:
  - `GET /api/mcp/marketplace/catalogs`
  - `POST /api/mcp/marketplace/catalogs/refresh`
  - `GET /api/mcp/marketplace/entries`
  - `GET /api/mcp/marketplace/installed`
  - source: `routes/mcp_routes.py:142-178`
- MCP server status route:
  - `GET /api/mcp/servers`
  - source: `routes/mcp_routes.py:271-332`
- Host bridge control routes:
  - `GET /api/mcp/host-bridge/status`
  - `POST /api/mcp/host-bridge/start`
  - `POST /api/mcp/host-bridge/stop`
  - `POST /api/mcp/host-bridge/restart`
  - source: `routes/mcp_routes.py:112-140`

## Host bridge facts

- Host bridge MCP app: `host_bridge/mcp_app.py`
- Default host bridge token env var: `ODYSSEUS_HOST_BRIDGE_TOKEN`
- Default bind host: `127.0.0.1`
- Default port: `8765`
- Default SSE URL from inside Docker: `http://host.docker.internal:8765/sse`
- Optional Odysseus-side bridge env vars:
  - `ODYSSEUS_HOST_BRIDGE_ENABLED=true`
  - `ODYSSEUS_HOST_BRIDGE_TOKEN=<token>`
  - `ODYSSEUS_HOST_BRIDGE_URL=http://host.docker.internal:8765/sse`
  - `ODYSSEUS_HOST_BRIDGE_TRANSPORT=sse`
- Built-in host bridge registration source: `src/builtin_mcp.py:92-123`
- Host bridge policy defaults deny all paths and commands.
- `host_bridge/config.example.json` has empty `allowed_roots`, empty `writable_roots`, and empty `allowed_commands` by default.
- Do not broaden host bridge policy during a smoke test. Use a tiny dedicated sandbox folder under `C:/Odysseus-T/data/host_bridge_smoke` if testing host file access.

## Commit policy

This handoff is a testing plan, not a feature implementation plan. Do not commit test-run artifacts, `.env`, logs, databases, Docker volumes, screenshots, or temporary host bridge configs unless the user explicitly asks. If code or committed docs are changed, use normal Git safety: inspect status/diff first and only commit on explicit user request.

---

### Task 1: Verify repo and Docker are using the C-drive source

**Files:**
- Read: `C:/Odysseus-T/docker-compose.yml`
- Read: `C:/Odysseus-T/Dockerfile`
- Read: `C:/Odysseus-T/.dockerignore`
- No code changes.

- [ ] **Step 1: Verify working tree status**

Run:

```bash
git -C /c/Odysseus-T status --short --branch
```

Expected output starts with:

```text
## main...origin/main
```

Expected acceptable state: no modified tracked files listed. If modified tracked files appear, inspect with:

```bash
git -C /c/Odysseus-T diff --stat
git -C /c/Odysseus-T diff -- <path-from-status>
```

Do not restore or delete user changes without explicit user approval.

- [ ] **Step 2: Verify Docker is reachable**

Run:

```bash
docker version --format '{{.Client.Version}} / {{.Server.Version}}'
```

Expected output resembles:

```text
29.5.2 / 29.5.2
```

Any server-side connection error means Docker Desktop is not ready. Stop and ask the user to start Docker Desktop.

- [ ] **Step 3: Render Compose config from C drive**

Run:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T config --format json > /tmp/odysseus-t-compose-config.json
python - <<'PY'
import json
from pathlib import Path
cfg = json.loads(Path('/tmp/odysseus-t-compose-config.json').read_text())
od = cfg['services']['odysseus']
print('project', cfg['name'])
print('build_context', od['build']['context'])
print('ports', od['ports'])
for v in od['volumes']:
    print(v['source'], '->', v['target'])
PY
```

Expected output includes:

```text
project odysseus-t
build_context C:\Odysseus-T
C:\Odysseus-T\data -> /app/data
C:\Odysseus-T\logs -> /app/logs
C:\Odysseus-T\data\ssh -> /app/.ssh
C:\Odysseus-T\data\huggingface -> /app/.cache/huggingface
C:\Odysseus-T\data\local -> /app/.local
```

Failure condition: any bind mount source starts with `E:\`. If that happens, do not continue; the Compose command is using the wrong project directory or an old project.

- [ ] **Step 4: Confirm old E-mounted containers are not the target project**

Run:

```bash
docker ps --all --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker inspect odysseus-odysseus-1 --format '{{json .Mounts}}' 2>/dev/null || true
```

Expected: old `odysseus-*` containers may exist and may show `E:\Workspace\odysseus` mounts. That is known historical state. Do not start those containers for this test.

---

### Task 2: Start the C-drive Docker stack

**Files:**
- Read: `C:/Odysseus-T/docker-compose.yml`
- Runtime creates/updates ignored local files under `C:/Odysseus-T/data/` and `C:/Odysseus-T/logs/`.
- No code changes.

- [ ] **Step 1: Start the stack with C-drive project identity**

Run:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T up -d --build
```

Expected: Compose builds or reuses `odysseus-t-odysseus` image and starts containers named like:

```text
odysseus-t-odysseus-1
odysseus-t-searxng-1
odysseus-t-chromadb-1
odysseus-t-ntfy-1
```

- [ ] **Step 2: Check container status**

Run:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T ps
```

Expected:

- `odysseus` is `running`
- `searxng` is `running` or `healthy`
- `chromadb` is `running`
- `ntfy` is `running`
- `odysseus` publishes `127.0.0.1:7000->7000/tcp`

If `odysseus` exits, inspect logs before retrying:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T logs --tail=200 odysseus
```

- [ ] **Step 3: Verify running container bind mounts are C-drive mounts**

Run:

```bash
docker inspect odysseus-t-odysseus-1 --format '{{json .Mounts}}' | python -m json.tool
```

Expected mount sources include only `C:\Odysseus-T\...` for the Odysseus bind mounts. Expected bind entries:

```text
C:\Odysseus-T\data -> /app/data
C:\Odysseus-T\logs -> /app/logs
C:\Odysseus-T\data\ssh -> /app/.ssh
C:\Odysseus-T\data\huggingface -> /app/.cache/huggingface
C:\Odysseus-T\data\local -> /app/.local
```

Failure condition: any mount source starts with `E:\`. Stop and recreate using the exact `docker compose -p odysseus-t ... --project-directory /c/Odysseus-T` command.

- [ ] **Step 4: Verify container sees `/app` from the C-drive build**

Run:

```bash
docker exec odysseus-t-odysseus-1 python - <<'PY'
from pathlib import Path
for p in ['app.py', 'host_bridge/mcp_app.py', 'routes/mcp_routes.py', 'src/mcp_marketplace_catalog.py', 'scripts/seed_odysseus_skills.py']:
    q = Path('/app') / p
    print(p, q.exists(), q.stat().st_size if q.exists() else 'missing')
PY
```

Expected: every listed path prints `True` with a nonzero size.

---

### Task 3: Verify Odysseus HTTP/API health from localhost:7000

**Files:**
- Runtime-only HTTP checks.
- No code changes.

- [ ] **Step 1: Wait for health endpoint**

Run:

```bash
python - <<'PY'
import json, time, urllib.request
url='http://127.0.0.1:7000/api/health'
last=None
for attempt in range(60):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            body=r.read().decode('utf-8')
        print(r.status, body)
        data=json.loads(body)
        if r.status == 200 and data.get('status') == 'healthy':
            raise SystemExit(0)
    except Exception as e:
        last=repr(e)
    time.sleep(2)
print('health check failed:', last)
raise SystemExit(1)
PY
```

Expected output contains:

```text
200 {"status":"healthy", ...}
```

- [ ] **Step 2: Verify root SPA responds**

Run:

```bash
python - <<'PY'
import urllib.request
for url in ['http://127.0.0.1:7000/', 'http://127.0.0.1:7000/api/version', 'http://127.0.0.1:7000/api/runtime', 'http://127.0.0.1:7000/api/auth/status']:
    with urllib.request.urlopen(url, timeout=10) as r:
        data=r.read(300).decode('utf-8', errors='replace')
    print(url, r.status, data.replace('\n',' ')[:180])
PY
```

Expected:

- `/` returns `200` and HTML content containing Odysseus UI markup.
- `/api/version` returns `200` JSON.
- `/api/runtime` returns `200` JSON.
- `/api/auth/status` returns `200` JSON.

- [ ] **Step 3: Check logs for startup errors**

Run:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T logs --tail=250 odysseus
```

Expected acceptable warnings:

- missing optional API keys
- host bridge disabled if `ODYSSEUS_HOST_BRIDGE_ENABLED=false`
- optional browser MCP startup delay

Failure indicators:

- traceback during app startup
- database open failure
- permission denied under `/app/data` or `/app/logs`
- repeated restart loop
- `E:\Workspace` paths in logs

---

### Task 4: Verify MCP marketplace and server APIs

**Files:**
- Runtime-only HTTP checks.
- No code changes.

- [ ] **Step 1: Query MCP marketplace routes in test-friendly auth mode**

If the stack was started with default `AUTH_ENABLED=true`, admin routes return `403` until logged in. For API-only smoke tests, restart with auth disabled for localhost validation:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T down
AUTH_ENABLED=false LOCALHOST_BYPASS=true docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T up -d --build
```

Security note: use this only for local smoke testing bound to `127.0.0.1`. Do not expose this instance to a network with auth disabled.

- [ ] **Step 2: Verify marketplace catalog APIs**

Run:

```bash
python - <<'PY'
import json, urllib.request
base='http://127.0.0.1:7000'
for path in ['/api/mcp/marketplace/catalogs', '/api/mcp/marketplace/entries', '/api/mcp/marketplace/installed', '/api/mcp/servers']:
    with urllib.request.urlopen(base + path, timeout=20) as r:
        body=r.read().decode('utf-8')
    print(path, r.status, body[:500].replace('\n',' '))
    json.loads(body)
PY
```

Expected:

- all requests return `200`
- `/api/mcp/marketplace/catalogs` returns object with `sources`
- `/api/mcp/marketplace/entries` returns a JSON list
- `/api/mcp/marketplace/installed` returns a JSON list
- `/api/mcp/servers` returns a JSON list containing built-in or runtime MCP statuses when available

- [ ] **Step 3: Refresh marketplace catalogs**

Run:

```bash
python - <<'PY'
import json, urllib.request
req=urllib.request.Request('http://127.0.0.1:7000/api/mcp/marketplace/catalogs/refresh', method='POST')
with urllib.request.urlopen(req, timeout=30) as r:
    body=r.read().decode('utf-8')
print(r.status, body[:1000])
data=json.loads(body)
assert 'entries' in data or 'errors' in data
PY
```

Expected: `200` response with normalized catalog result. If errors are present, record them exactly; do not edit catalog code during this test plan unless the user asks for a fix.

---

### Task 5: Optional host bridge smoke test with least-privilege policy

**Files:**
- Create local runtime-only file: `C:/Odysseus-T/data/host_bridge_smoke/host_bridge.config.json`
- Runtime-only process: `python -m host_bridge.mcp_app --config ... --token ... --transport sse`
- No committed code changes.

- [ ] **Step 1: Create a minimal host bridge sandbox config**

Run:

```bash
python - <<'PY'
import json
from pathlib import Path
root=Path('C:/Odysseus-T/data/host_bridge_smoke')
root.mkdir(parents=True, exist_ok=True)
(root/'readme.txt').write_text('host bridge smoke test\n', encoding='utf-8')
config={
  'bind_host': '127.0.0.1',
  'port': 8765,
  'allowed_roots': [str(root)],
  'writable_roots': [str(root)],
  'allowed_commands': ['python --version'],
  'blocked_commands': ['shutdown','reboot','format','diskpart','regedit','rm -rf','del /s'],
  'confirm_commands': [],
  'max_runtime_seconds': 10,
  'max_output_bytes': 100000
}
(root/'host_bridge.config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
print(root/'host_bridge.config.json')
PY
```

Expected: prints `C:\Odysseus-T\data\host_bridge_smoke\host_bridge.config.json`.

- [ ] **Step 2: Start the host bridge on the Windows host**

Run in a separate terminal or background shell from `C:/Odysseus-T`:

```bash
cd /c/Odysseus-T && ODYSSEUS_HOST_BRIDGE_TOKEN=smoke-token python -m host_bridge.mcp_app --config C:/Odysseus-T/data/host_bridge_smoke/host_bridge.config.json --token smoke-token --transport sse
```

Expected: host bridge listens on `127.0.0.1:8765` and exposes SSE at `http://127.0.0.1:8765/sse`.

If Python dependencies are missing on the Windows host, use the Docker-only API tests in Task 4 and record that host bridge process startup is blocked by missing host Python dependencies.

- [ ] **Step 3: Restart Odysseus with host bridge enabled**

Run:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T down
AUTH_ENABLED=false LOCALHOST_BYPASS=true ODYSSEUS_HOST_BRIDGE_ENABLED=true ODYSSEUS_HOST_BRIDGE_TOKEN=smoke-token ODYSSEUS_HOST_BRIDGE_URL=http://host.docker.internal:8765/sse docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T up -d --build
```

Expected: Odysseus starts and logs either successful registration of `host_access` or a clear connection error.

- [ ] **Step 4: Verify Odysseus sees the host bridge MCP server**

Run:

```bash
python - <<'PY'
import json, time, urllib.request
base='http://127.0.0.1:7000'
for _ in range(20):
    with urllib.request.urlopen(base + '/api/mcp/servers', timeout=10) as r:
        data=json.loads(r.read().decode('utf-8'))
    host=[s for s in data if s.get('id') == 'host_access' or 'Host Access' in str(s.get('name'))]
    print(host)
    if host:
        raise SystemExit(0)
    time.sleep(2)
raise SystemExit('host_access not visible in /api/mcp/servers')
PY
```

Expected: printed JSON list includes a `host_access` server or `Host Access Bridge` entry. If it is present but disconnected, inspect logs:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T logs --tail=250 odysseus
```

---

### Task 6: Chrome DevTools MCP browser test against localhost:7000

**Files:**
- Browser-only test.
- No code changes.

- [ ] **Step 1: Open Odysseus in Chrome through Chrome DevTools MCP**

Use Chrome DevTools MCP tools in this order:

```text
new_page(url="http://127.0.0.1:7000/")
wait_for(text or selector that indicates the Odysseus shell/login page loaded)
take_snapshot()
```

Expected snapshot evidence:

- page is not a network error page
- page title or visible text identifies Odysseus, Login, Setup, Chat, or the main app shell
- no obvious fatal error overlay

If the page shows login/setup, that is acceptable for default `AUTH_ENABLED=true`. If the stack was intentionally restarted with `AUTH_ENABLED=false`, expect the app shell without needing credentials.

- [ ] **Step 2: Verify browser can call the health API from page context**

Use Chrome DevTools MCP `evaluate_script` on the selected page:

```javascript
await fetch('/api/health').then(r => r.json())
```

Expected result contains:

```json
{"status":"healthy"}
```

- [ ] **Step 3: Verify static JS modules loaded**

Use Chrome DevTools MCP `evaluate_script`:

```javascript
({
  hasAdminModule: Boolean(window.adminModule),
  hasDocument: Boolean(document.querySelector('body')),
  scripts: Array.from(document.scripts).map(s => s.src || '[inline]').slice(0, 20)
})
```

Expected:

- `hasDocument: true`
- script list includes app/static assets from `127.0.0.1:7000`
- if authenticated/app shell loaded, `hasAdminModule` should be `true`

- [ ] **Step 4: Inspect console and network failures**

Use Chrome DevTools MCP console/network tools if available, or equivalent DevTools MCP calls:

```text
list_console_messages(types=["error", "warning"])
list_network_requests(pageSize=100)
```

Expected:

- no repeated JavaScript module MIME errors
- no repeated 500s for `/api/health`, `/api/runtime`, `/api/auth/status`
- admin-only API calls may return `403` when `AUTH_ENABLED=true` and no admin is logged in; that is not a frontend load failure

- [ ] **Step 5: Verify MCP Marketplace UI exists in DOM**

Use Chrome DevTools MCP `evaluate_script`:

```javascript
({
  marketplaceCard: Boolean(document.querySelector('#adm-mcp-marketplace')),
  refreshButton: Boolean(document.querySelector('#adm-mcp-marketplace-refresh')),
  browseGrid: Boolean(document.querySelector('#adm-mcp-marketplace-browse')),
  installedGrid: Boolean(document.querySelector('#adm-mcp-marketplace-installed'))
})
```

Expected all booleans are `true` once the main app/admin DOM is loaded. If not logged in and the admin modal is not mounted, restart smoke stack with `AUTH_ENABLED=false LOCALHOST_BYPASS=true` and repeat.

---

### Task 7: Record final test evidence

**Files:**
- No required file changes.
- If the user asks for an evidence log, create `C:/Odysseus-T/docs/superpowers/plans/2026-06-09-odysseus-c-drive-docker-chrome-test-results.md`.

- [ ] **Step 1: Capture command evidence**

Collect these outputs in the final response or evidence log:

```bash
git -C /c/Odysseus-T status --short --branch
docker version --format '{{.Client.Version}} / {{.Server.Version}}'
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T ps
docker inspect odysseus-t-odysseus-1 --format '{{json .Mounts}}'
python - <<'PY'
import urllib.request
for url in ['http://127.0.0.1:7000/api/health','http://127.0.0.1:7000/api/version','http://127.0.0.1:7000/api/runtime']:
    with urllib.request.urlopen(url, timeout=10) as r:
        print(url, r.status, r.read(200).decode('utf-8', errors='replace'))
PY
```

Expected evidence must prove:

- repository under `/c/Odysseus-T` is the test target
- Docker daemon is reachable
- Compose project `odysseus-t` is running
- Odysseus bind mounts are from `C:\Odysseus-T`, not `E:\Workspace`
- `http://127.0.0.1:7000/api/health` returns healthy
- Chrome DevTools MCP can load `http://127.0.0.1:7000/`

- [ ] **Step 2: Summarize failures exactly if any occur**

If any step fails, report:

- exact command/tool call
- exit code or tool error
- first relevant error lines
- whether the failure is Docker startup, mount path, API health, auth/admin access, MCP marketplace API, host bridge, or browser UI
- next single recommended diagnostic command

Do not claim Odysseus is working unless Task 3 health and Task 6 browser load both have fresh evidence.

---

## Cleanup commands

Stop only the C-drive test stack:

```bash
docker compose -p odysseus-t -f /c/Odysseus-T/docker-compose.yml --project-directory /c/Odysseus-T down
```

Do not remove volumes unless the user asks. Do not remove old `odysseus-*` E-mounted containers unless the user explicitly asks to clean them up.

## Known risks and guardrails

- E drive remains unreliable until an Administrator shell successfully runs `chkdsk E: /f /x` or equivalent repair.
- Old Docker containers named `odysseus-*` are not proof that the C-drive stack works; they are historical and E-mounted.
- Use `odysseus-t-*` container names for this test pass.
- Do not enable broad host bridge filesystem access. Keep host bridge tests inside `C:/Odysseus-T/data/host_bridge_smoke`.
- `AUTH_ENABLED=false` is acceptable only for local smoke testing on `127.0.0.1`; restore normal auth for any non-local use.
- Do not commit `.env`, runtime data, logs, local database files, screenshots, or temporary host bridge config unless explicitly requested.

## Handoff completion checklist

- [ ] `docker version` confirms server reachable.
- [ ] rendered Compose config shows `C:\Odysseus-T` build context and bind mounts.
- [ ] `odysseus-t-odysseus-1` exists and is running.
- [ ] `docker inspect odysseus-t-odysseus-1` shows no `E:\` bind mounts.
- [ ] `/api/health` returns `{"status":"healthy"}`.
- [ ] `/api/mcp/marketplace/entries` returns JSON when auth is disabled or admin-authenticated.
- [ ] Chrome DevTools MCP loads `http://127.0.0.1:7000/` and can evaluate `fetch('/api/health')`.
- [ ] Final response includes exact evidence and does not rely on assumed state.
