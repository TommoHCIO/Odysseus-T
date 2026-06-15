from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import contacts_routes as cr


def test_contacts_summary_uses_cache_without_full_fetch(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(
        cr,
        "_get_carddav_config",
        lambda: {"url": "http://carddav.example/contacts/", "username": "alice", "password": "secret"},
    )
    monkeypatch.setattr(
        cr,
        "_fetch_contacts",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("summary should not fetch contacts")),
    )
    cr._contact_cache["contacts"] = [{"uid": "1", "name": "Ada", "emails": ["ada@example.com"], "phones": []}]
    cr._contact_cache["fetched_at"] = None

    app = FastAPI()
    app.include_router(cr.setup_contacts_routes())
    client = TestClient(app)

    response = client.get("/api/contacts/summary")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["carddav_configured"] is True
