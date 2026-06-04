import subprocess
import sys
from pathlib import Path


HOST_BRIDGE_DIR = Path(__file__).resolve().parents[1] / "host_bridge"


def test_mcp_app_module_help_runs_from_repo_root():
    result = subprocess.run(
        [sys.executable, "-m", "host_bridge.mcp_app", "--help"],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0
    assert "Run the Odysseus host access MCP bridge" in result.stdout


def test_installers_launch_bridge_as_module_from_repo_root():
    scripts = [
        HOST_BRIDGE_DIR / "install_windows_service.ps1",
        HOST_BRIDGE_DIR / "install_linux_user_service.sh",
        HOST_BRIDGE_DIR / "install_macos_launchagent.sh",
    ]

    for script in scripts:
        content = script.read_text(encoding="utf-8")
        assert "host_bridge.mcp_app" in content
        assert "-m" in content
        assert "mcp_app.py" not in content
