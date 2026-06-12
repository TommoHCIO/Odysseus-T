from pathlib import Path

import pytest

from host_bridge.policy import BridgeConfig
from host_bridge.server import HostBridge, UnauthorizedError


def test_host_bridge_rejects_invalid_token(tmp_path):
    bridge = HostBridge(BridgeConfig(allowed_roots=[tmp_path]), token="secret")

    with pytest.raises(UnauthorizedError):
        bridge.host_health(token="wrong")


def test_host_bridge_health_returns_policy_summary(tmp_path):
    bridge = HostBridge(
        BridgeConfig(allowed_roots=[tmp_path], allowed_commands=["python"]),
        token="secret",
    )

    health = bridge.host_health(token="secret")

    assert health["status"] == "ok"
    assert health["policy"]["allowed_roots"] == [str(tmp_path.resolve())]
    assert health["policy"]["allowed_commands"] == ["python"]


def test_host_bridge_reads_only_allowed_files(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    note = allowed / "note.txt"
    note.write_text("hello", encoding="utf-8")
    bridge = HostBridge(BridgeConfig(allowed_roots=[allowed]), token="secret")

    assert bridge.host_read_file(str(note), token="secret") == "hello"

    with pytest.raises(Exception):
        bridge.host_read_file(str(tmp_path / "outside.txt"), token="secret")


def test_host_bridge_writes_only_writable_files(tmp_path):
    writable = tmp_path / "writable"
    readonly = tmp_path / "readonly"
    writable.mkdir()
    readonly.mkdir()
    bridge = HostBridge(
        BridgeConfig(allowed_roots=[writable, readonly], writable_roots=[writable]),
        token="secret",
    )

    bridge.host_write_file(str(writable / "out.txt"), "ok", token="secret")
    assert (writable / "out.txt").read_text(encoding="utf-8") == "ok"

    with pytest.raises(Exception):
        bridge.host_write_file(str(readonly / "out.txt"), "no", token="secret")


def test_host_bridge_runs_allowed_command_without_shell():
    bridge = HostBridge(BridgeConfig(allowed_commands=["python"]), token="secret")

    result = bridge.host_run_command("python", ["--version"], token="secret", timeout_seconds=10)

    assert result["exit_code"] == 0
    assert "Python" in (result["stdout"] + result["stderr"])




def test_host_bridge_denies_unallowed_command():
    bridge = HostBridge(BridgeConfig(allowed_commands=["python"]), token="secret")

    with pytest.raises(Exception):
        bridge.host_run_command("git", ["status"], token="secret")


def test_host_bridge_records_audit_events_for_allowed_and_denied_actions(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    note = allowed / "note.txt"
    note.write_text("hello", encoding="utf-8")
    bridge = HostBridge(BridgeConfig(allowed_roots=[allowed]), token="secret")

    bridge.host_read_file(str(note), token="secret")
    with pytest.raises(Exception):
        bridge.host_read_file(str(tmp_path / "outside.txt"), token="secret")

    events = bridge.audit_events
    assert events[0]["tool"] == "host_read_file"
    assert events[0]["decision"] == "allow"
    assert events[0]["status"] == "ok"
    assert events[1]["tool"] == "host_read_file"
    assert events[1]["decision"] == "deny"
    assert events[1]["status"] == "error"


def test_host_bridge_uses_configured_runtime_and_output_limits():
    bridge = HostBridge(
        BridgeConfig(allowed_commands=["python"], max_runtime_seconds=10, max_output_bytes=8),
        token="secret",
    )

    result = bridge.host_run_command(
        "python",
        ["-c", "print('abcdefghijklmnop')"],
        token="secret",
    )

    assert result["exit_code"] == 0
    assert "truncated" in result["stdout"].lower()


def test_confirm_required_command_creates_pending_confirmation():
    bridge = HostBridge(BridgeConfig(allowed_commands=["git"], confirm_commands=["git commit"]), token="secret")

    with pytest.raises(Exception):
        bridge.host_run_command("git", ["commit", "-m", "msg"], token="secret")

    pending = bridge.pending_confirmations
    assert len(pending) == 1
    confirmation_id, confirmation = next(iter(pending.items()))
    assert confirmation_id
    assert confirmation["tool"] == "host_run_command"
    assert confirmation["command"] == "git"
    assert confirmation["args"] == ["commit", "-m", "msg"]


def test_approved_confirmation_allows_matching_command_once(monkeypatch):
    bridge = HostBridge(BridgeConfig(allowed_commands=["python"], confirm_commands=["python -c"]), token="secret")

    with pytest.raises(Exception):
        bridge.host_run_command("python", ["-c", "print('ok')"], token="secret")
    confirmation_id = next(iter(bridge.pending_confirmations))

    bridge.approve_confirmation(confirmation_id, token="secret")
    result = bridge.host_run_command("python", ["-c", "print('ok')"], token="secret")

    assert result["exit_code"] == 0
    assert "ok" in result["stdout"]
    assert bridge.pending_confirmations == {}
