from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.middleware import SecurityHeadersMiddleware
from routes import workspace_routes


def _client(tmp_path, monkeypatch, *, security_headers=False):
    monkeypatch.setattr(workspace_routes, "WORKSPACE_FILE", str(tmp_path / "workspace.json"))
    app = FastAPI()

    @app.middleware("http")
    async def attach_user(request, call_next):
        user = request.headers.get("x-test-user")
        if user:
            request.state.current_user = user
        return await call_next(request)

    if security_headers:
        app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(workspace_routes.setup_workspace_routes())
    return TestClient(app)


def test_workspace_crud_persists_by_user(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, security_headers=True)

    created = client.post(
        "/api/workspace/ideas",
        json={"title": "Sketch council loop", "body": "Compare models before execution", "tags": ["council"]},
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200
    item = created.json()
    assert item["title"] == "Sketch council loop"
    assert item["status"] == "open"

    listed = client.get("/api/workspace", headers={"x-test-user": "alice"})
    assert listed.status_code == 200
    assert listed.json()["ideas"][0]["id"] == item["id"]

    updated = client.put(
        f"/api/workspace/ideas/{item['id']}",
        json={"status": "accepted"},
        headers={"x-test-user": "alice"},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "accepted"

    bob = client.get("/api/workspace", headers={"x-test-user": "bob"})
    assert bob.status_code == 200
    assert bob.json()["ideas"] == []

    deleted = client.delete(f"/api/workspace/ideas/{item['id']}", headers={"x-test-user": "alice"})
    assert deleted.status_code == 200
    assert client.get("/api/workspace", headers={"x-test-user": "alice"}).json()["ideas"] == []


def test_workspace_rejects_unknown_collection(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/workspace/not-real",
        json={"title": "Nope"},
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 404


def test_workspace_artifact_serves_html_with_preview_csp(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    html = '<!doctype html><html><body><h1 data-odysseus-project-review="1">Full stack</h1><script>window.ok=1</script></body></html>'
    created = client.post(
        "/api/workspace/council",
        json={"title": "Fuel review", "body": f"```html\n{html}\n```"},
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200

    response = client.get(
        f"/api/workspace/artifact/council/{created.json()['id']}",
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "script-src 'unsafe-inline'" in response.headers["content-security-policy"]
    assert 'data-odysseus-project-review="1"' in response.text


def test_workspace_artifact_404_for_qa_blocked_card_without_html(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    created = client.post(
        "/api/workspace/council",
        json={
            "title": "Council final product: blocked",
            "body": "## Council artifact QA blocked\nNo sandbox preview was published.",
            "status": "blocked",
            "tags": ["council", "qa-blocked"],
            "links": {
                "qa_result": {
                    "score": 42,
                    "attempts": 2,
                    "failures": ["Preview appears to be a generic shell."],
                }
            },
        },
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200

    response = client.get(
        f"/api/workspace/artifact/council/{created.json()['id']}",
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 404


def test_workspace_preview_starts_static_council_build(tmp_path, monkeypatch):
    build_root = tmp_path / "council-builds"
    build_dir = build_root / "demo-app"
    build_dir.mkdir(parents=True)
    (build_dir / "index.html").write_text(
        "<!doctype html><html><body><h1>Demo Local Preview</h1></body></html>",
        encoding="utf-8",
    )
    monkeypatch.setattr(workspace_routes, "COUNCIL_BUILD_ROOT", str(build_root))
    monkeypatch.setattr(workspace_routes, "DATA_DIR", str(tmp_path / "data"))
    client = _client(tmp_path, monkeypatch)

    created = client.post(
        "/api/workspace/council",
        json={
            "title": "Council final product: demo",
            "body": "Package-only final review with localhost evidence.",
            "status": "verified",
            "links": {"build_dir": str(build_dir)},
        },
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200
    item_id = created.json()["id"]

    try:
        response = client.post(
            f"/api/workspace/preview/council/{item_id}/start",
            headers={"x-test-user": "alice"},
        )
        assert response.status_code == 200
        preview = response.json()
        assert preview["status"] == "running"
        assert preview["runtime"] == "static-html"
        assert preview["url"] == f"/api/workspace/preview/council/{item_id}/proxy/"
        assert preview["internal_url"].startswith("http://127.0.0.1:")

        proxied = client.get(preview["url"], headers={"x-test-user": "alice"})
        assert proxied.status_code == 200
        assert "Demo Local Preview" in proxied.text
        assert "x-frame-options" not in proxied.headers

        listed = client.get("/api/workspace", headers={"x-test-user": "alice"})
        stored = listed.json()["council"][0]["links"]["preview"]
        assert stored["status"] == "running"
        assert stored["url"] == preview["url"]
    finally:
        client.post(
            f"/api/workspace/preview/council/{item_id}/stop",
            headers={"x-test-user": "alice"},
        )


def test_workspace_preview_rejects_blocked_qa_card(tmp_path, monkeypatch):
    build_root = tmp_path / "council-builds"
    build_dir = build_root / "blocked-app"
    build_dir.mkdir(parents=True)
    (build_dir / "index.html").write_text("<h1>Blocked</h1>", encoding="utf-8")
    monkeypatch.setattr(workspace_routes, "COUNCIL_BUILD_ROOT", str(build_root))
    client = _client(tmp_path, monkeypatch)

    created = client.post(
        "/api/workspace/council",
        json={
            "title": "Council final product: blocked",
            "body": "Blocked QA card.",
            "status": "blocked",
            "tags": ["qa-blocked"],
            "links": {"build_dir": str(build_dir)},
        },
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200

    response = client.post(
        f"/api/workspace/preview/council/{created.json()['id']}/start",
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 400


def test_workspace_concurrent_creates_do_not_drop_items(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    def create_item(index):
        response = client.post(
            "/api/workspace/requests",
            json={"title": f"Request {index}"},
            headers={"x-test-user": "alice"},
        )
        assert response.status_code == 200
        return response.json()["id"]

    with ThreadPoolExecutor(max_workers=8) as executor:
        ids = list(executor.map(create_item, range(20)))

    listed = client.get("/api/workspace", headers={"x-test-user": "alice"})
    assert listed.status_code == 200
    requests = listed.json()["requests"]
    assert len(requests) == 20
    assert {item["id"] for item in requests} == set(ids)
