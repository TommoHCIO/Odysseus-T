from pathlib import Path


HOST_BRIDGE_DIR = Path(__file__).resolve().parents[1] / "host_bridge"


def test_linux_user_service_installer_exists_and_uses_user_systemd():
    script = HOST_BRIDGE_DIR / "install_linux_user_service.sh"

    content = script.read_text(encoding="utf-8")

    assert "systemctl --user" in content
    assert "odysseus-host-bridge.service" in content
    assert "host_bridge.mcp_app" in content


def test_macos_launchagent_installer_exists_and_uses_user_launchagent():
    script = HOST_BRIDGE_DIR / "install_macos_launchagent.sh"

    content = script.read_text(encoding="utf-8")

    assert "$HOME/Library/LaunchAgents" in content
    assert "com.odysseus.host-bridge.plist" in content
    assert "host_bridge.mcp_app" in content
