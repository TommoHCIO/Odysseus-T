from src import tool_security


def test_auth_disabled_owner_none_keeps_single_user_tools(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    class FakeAuthManager:
        is_configured = True

        def is_admin(self, owner):
            return False

    import core.auth
    monkeypatch.setattr(core.auth, "AuthManager", FakeAuthManager)

    assert tool_security.blocked_tools_for_owner(None) == set()
