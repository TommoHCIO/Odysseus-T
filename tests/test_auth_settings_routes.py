from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.auth_routes import setup_auth_routes


class FakeAuthManager:
    is_configured = True
    signup_enabled = False

    def get_username_for_token(self, token):
        return None

    def is_admin(self, user):
        return False


def test_auth_disabled_allows_settings_save(monkeypatch):
    saved = {}
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr("routes.auth_routes._load_settings", lambda: {"default_endpoint_id": "old", "default_model": "old-model"})
    monkeypatch.setattr("routes.auth_routes._save_settings", lambda settings: saved.update(settings))
    monkeypatch.setattr("routes.auth_routes.DEFAULT_SETTINGS", {
        "default_endpoint_id": "",
        "default_model": "",
    })
    app = FastAPI()
    app.include_router(setup_auth_routes(FakeAuthManager()))
    client = TestClient(app)

    response = client.post("/api/auth/settings", json={
        "default_endpoint_id": "fc7fc665",
        "default_model": "deepseek/deepseek-v4-flash",
    })

    assert response.status_code == 200
    assert saved["default_endpoint_id"] == "fc7fc665"
    assert saved["default_model"] == "deepseek/deepseek-v4-flash"
