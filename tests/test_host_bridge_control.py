import subprocess
from types import SimpleNamespace

import pytest

from src import host_bridge_control as control


def _completed(stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_windows_start_uses_fixed_scheduled_task(monkeypatch):
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return _completed()

    monkeypatch.setattr(control.platform, "system", lambda: "Windows")
    monkeypatch.setattr(control.subprocess, "run", fake_run)

    result = control.start_host_bridge()

    assert result["status"] == "unknown"
    assert len(calls) == 1
    argv, kwargs = calls[0]
    assert argv == [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-ScheduledTask -TaskName 'Odysseus Host Access Bridge'",
    ]
    assert kwargs["shell"] is False


def test_linux_status_maps_active_to_running(monkeypatch):
    monkeypatch.setattr(control.platform, "system", lambda: "Linux")
    monkeypatch.setattr(control.subprocess, "run", lambda argv, **kwargs: _completed(stdout="active\n"))

    result = control.get_host_bridge_status()

    assert result["platform"] == "linux"
    assert result["service_name"] == "odysseus-host-bridge.service"
    assert result["status"] == "running"


def test_unsupported_platform_is_unavailable(monkeypatch):
    monkeypatch.setattr(control.platform, "system", lambda: "FreeBSD")

    result = control.get_host_bridge_status()

    assert result == {
        "available": False,
        "platform": "unsupported",
        "service_name": "Host Access Bridge",
        "status": "unsupported",
        "message": "Host bridge lifecycle control is not supported on this platform",
    }


def test_output_redacts_tokens_and_truncates(monkeypatch):
    secret = "ODYSSEUS_HOST_BRIDGE_TOKEN=abc123 Authorization: Bearer secret-token " + ("x" * 800)
    monkeypatch.setattr(control.platform, "system", lambda: "Linux")
    monkeypatch.setattr(control.subprocess, "run", lambda argv, **kwargs: _completed(stderr=secret, returncode=1))

    result = control.start_host_bridge()

    assert "abc123" not in result["message"]
    assert "secret-token" not in result["message"]
    assert "[redacted]" in result["message"]
    assert len(result["message"]) < 650


def test_restart_uses_fixed_linux_restart_command(monkeypatch):
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return _completed()

    monkeypatch.setattr(control.platform, "system", lambda: "Linux")
    monkeypatch.setattr(control.subprocess, "run", fake_run)

    result = control.restart_host_bridge()

    assert result["available"] is True
    assert calls[0][0] == ["systemctl", "--user", "restart", "odysseus-host-bridge.service"]
    assert calls[0][1]["shell"] is False


def test_timeout_returns_error(monkeypatch):
    def fake_run(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, 10)

    monkeypatch.setattr(control.platform, "system", lambda: "Linux")
    monkeypatch.setattr(control.subprocess, "run", fake_run)

    result = control.stop_host_bridge()

    assert result["status"] == "error"
    assert "timed out" in result["message"].lower()
