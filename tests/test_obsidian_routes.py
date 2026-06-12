from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import obsidian_knowledge
from routes import obsidian_routes, workspace_routes


def _client(tmp_path, monkeypatch):
    vault_root = str(tmp_path / "obsidian-vault")
    monkeypatch.setattr(obsidian_routes, "OBSIDIAN_VAULT_ROOT", vault_root)
    monkeypatch.setattr(obsidian_knowledge, "OBSIDIAN_VAULT_ROOT", vault_root)
    monkeypatch.setattr(workspace_routes, "WORKSPACE_FILE", str(tmp_path / "workspace.json"))
    monkeypatch.setattr(workspace_routes, "OBSIDIAN_VAULT_ROOT", vault_root)
    app = FastAPI()

    @app.middleware("http")
    async def attach_user(request, call_next):
        user = request.headers.get("x-test-user")
        if user:
            request.state.current_user = user
        return await call_next(request)

    app.include_router(workspace_routes.setup_workspace_routes())
    app.include_router(obsidian_routes.setup_obsidian_routes())
    return TestClient(app)


def test_obsidian_note_crud_indexes_wikilinks_and_backlinks(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    alpha = client.put(
        "/api/obsidian/notes/Alpha.md",
        json={
            "content": (
                "---\n"
                "title: Alpha Note\n"
                "tags: [project, council]\n"
                "aliases: [Start]\n"
                "---\n\n"
                "# Alpha Heading\n\n"
                "Links to [[Beta]] and #priority/open.\n"
                "- [ ] tighten graph\n"
            )
        },
        headers={"x-test-user": "alice"},
    )
    assert alpha.status_code == 200

    beta = client.put(
        "/api/obsidian/notes/Beta.md",
        json={"content": "# Beta\n\nBacklink target."},
        headers={"x-test-user": "alice"},
    )
    assert beta.status_code == 200

    indexed = client.get("/api/obsidian", headers={"x-test-user": "alice"})
    assert indexed.status_code == 200
    notes = {note["path"]: note for note in indexed.json()["notes"]}
    assert notes["Alpha.md"]["title"] == "Alpha Note"
    assert notes["Alpha.md"]["aliases"] == ["Start"]
    assert set(notes["Alpha.md"]["tags"]) == {"council", "priority/open", "project"}
    assert notes["Alpha.md"]["outgoing_paths"] == ["Beta.md"]
    assert notes["Alpha.md"]["tasks"] == [{"done": False, "text": "tighten graph"}]
    assert notes["Beta.md"]["backlinks"] == ["Alpha.md"]
    assert {"from": "Alpha.md", "to": "Beta.md", "type": "wikilink"} in indexed.json()["graph"]["edges"]


def test_obsidian_rejects_path_traversal(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.put(
        "/api/obsidian/notes/%2E%2E/secret.md",
        json={"content": "# Nope"},
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 400


def test_obsidian_workspace_sync_does_not_overwrite_unmanaged_notes(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    created = client.post(
        "/api/workspace/requests",
        json={
            "id": "abc123456789",
            "title": "Roadmap",
            "body": "Workspace card body",
            "tags": ["strategy"],
        },
        headers={"x-test-user": "alice"},
    )
    assert created.status_code == 200

    unmanaged = client.put(
        "/api/obsidian/notes/Workspace/requests/roadmap-abc12345.md",
        json={"content": "# User Roadmap\n\nDo not overwrite me."},
        headers={"x-test-user": "alice"},
    )
    assert unmanaged.status_code == 200

    synced = client.post("/api/obsidian/workspace/sync", headers={"x-test-user": "alice"})
    assert synced.status_code == 200
    assert synced.json()["skipped"] == 1
    assert synced.json()["notes"] == [
        {"path": "Workspace/requests/roadmap-abc12345.md", "status": "skipped-unmanaged"}
    ]

    note = client.get(
        "/api/obsidian/notes/Workspace/requests/roadmap-abc12345.md",
        headers={"x-test-user": "alice"},
    )
    assert "Do not overwrite me." in note.json()["content"]


def test_obsidian_workspace_sync_creates_managed_notes(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    client.post(
        "/api/workspace/council",
        json={
            "id": "def987654321",
            "title": "Council Review",
            "body": "Final review details",
            "status": "verified",
            "tags": ["review"],
            "links": {"session_id": "session-1"},
            "evidence": "pytest passed",
        },
        headers={"x-test-user": "alice"},
    )

    synced = client.post("/api/obsidian/workspace/sync", headers={"x-test-user": "alice"})
    assert synced.status_code == 200
    assert synced.json()["created"] == 1

    note = client.get(
        "/api/obsidian/notes/Workspace/council/council-review-def98765.md",
        headers={"x-test-user": "alice"},
    )
    assert note.status_code == 200
    assert note.json()["frontmatter"]["odysseus_managed"] is True
    assert "Final review details" in note.json()["content"]
    assert "pytest passed" in note.json()["content"]


def test_obsidian_taxonomy_exposes_expanded_event_types(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.get("/api/obsidian/taxonomy", headers={"x-test-user": "alice"})

    assert response.status_code == 200
    data = response.json()
    assert len(data["event_types"]) >= 168
    assert "chat.user_message" in data["event_types"]
    assert "council.context_injected" in data["event_types"]
    assert "knowledge.verified_fix" in data["event_types"]
    assert "verified-solution" in data["genres"]
    assert data["unclassified_type"] == "unclassified.event"


def test_obsidian_log_redacts_secrets_and_creates_pending_curation(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/obsidian/log",
        json={
            "event_type": "knowledge.preference",
            "title": "Editor preference",
            "summary": "User prefers dense review screens with api_key=sk_live_123456789abcdef.",
            "genre": "preference",
            "source": "chat",
            "source_id": "session-1",
            "tags": ["preference"],
            "content": "Keep dashboards compact. token: ghp_abcdefghijklmnopqrstuvwxyz123456",
        },
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "knowledge.preference"
    assert payload["curation_path"]

    note = client.get(f"/api/obsidian/notes/{payload['note_path']}", headers={"x-test-user": "alice"})
    assert "Editor preference" in note.json()["content"]
    assert "sk_live_123456789abcdef" not in note.json()["content"]
    assert "ghp_abcdefghijklmnopqrstuvwxyz123456" not in note.json()["content"]
    assert "[REDACTED]" in note.json()["content"]

    pending = client.get("/api/obsidian/curation/pending", headers={"x-test-user": "alice"})
    assert pending.status_code == 200
    assert pending.json()["notes"][0]["frontmatter"]["status"] == "pending"


def test_obsidian_unknown_event_type_logs_as_unclassified(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/obsidian/log",
        json={"event_type": "future.new_kind", "title": "Future event", "summary": "Still captured."},
        headers={"x-test-user": "alice"},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "unclassified.event"
    note = client.get(f"/api/obsidian/notes/{response.json()['note_path']}", headers={"x-test-user": "alice"})
    assert '"requested_type": "future.new_kind"' in note.json()["content"]


def test_obsidian_search_prefers_curation_over_journal(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    client.post(
        "/api/obsidian/log",
        json={
            "event_type": "knowledge.verified_fix",
            "title": "Chrome preview fix",
            "summary": "Verified solution for sandbox iframe preview headers.",
            "genre": "verified-solution",
            "content": "Use proxy route with frame headers for Chrome preview.",
        },
        headers={"x-test-user": "alice"},
    )

    response = client.get("/api/obsidian/search?q=Chrome%20preview%20headers", headers={"x-test-user": "alice"})

    assert response.status_code == 200
    results = response.json()["results"]
    assert results
    assert "/Curation/Pending/" in results[0]["path"]


def test_obsidian_curation_approve_moves_pending_to_knowledge(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    logged = client.post(
        "/api/obsidian/log",
        json={
            "event_type": "knowledge.verified_fix",
            "title": "Stable fix",
            "summary": "A verified fix should be promotable.",
            "genre": "verified-solution",
        },
        headers={"x-test-user": "alice"},
    ).json()

    approved = client.post(
        "/api/obsidian/curation/approve",
        json={"path": logged["curation_path"]},
        headers={"x-test-user": "alice"},
    )

    assert approved.status_code == 200
    assert approved.json()["path"].startswith("Odysseus/Knowledge/verified-solution/")
    note = client.get(f"/api/obsidian/notes/{approved.json()['path']}", headers={"x-test-user": "alice"})
    assert note.status_code == 200
    assert note.json()["frontmatter"]["status"] == "approved"


def test_workspace_create_auto_logs_to_obsidian_journal(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    created = client.post(
        "/api/workspace/requests",
        json={"title": "Capture everything", "body": "Obsidian should remember this.", "tags": ["obsidian"]},
        headers={"x-test-user": "alice"},
    )

    assert created.status_code == 200
    search = client.get("/api/obsidian/search?q=Capture%20everything", headers={"x-test-user": "alice"})
    assert search.status_code == 200
    assert search.json()["results"]
    assert "/Journal/" in search.json()["results"][0]["path"]
