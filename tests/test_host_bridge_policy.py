from pathlib import Path

import pytest

from host_bridge.policy import (
    BridgeConfig,
    CommandDenied,
    PathDenied,
    classify_command,
    enforce_output_limit,
    load_bridge_config,
    resolve_allowed_path,
)


def test_default_config_denies_all_host_paths_and_commands(tmp_path):
    cfg = BridgeConfig()

    with pytest.raises(PathDenied):
        resolve_allowed_path(tmp_path / "note.txt", cfg)

    with pytest.raises(CommandDenied):
        classify_command("python", ["--version"], cfg)


def test_allowed_root_permits_read_path_but_blocks_traversal(tmp_path):
    root = tmp_path / "allowed"
    root.mkdir()
    (root / "note.txt").write_text("ok", encoding="utf-8")
    cfg = BridgeConfig(allowed_roots=[root])

    assert resolve_allowed_path(root / "note.txt", cfg) == (root / "note.txt").resolve()

    outside = tmp_path / "outside.txt"
    outside.write_text("no", encoding="utf-8")
    with pytest.raises(PathDenied):
        resolve_allowed_path(root / ".." / "outside.txt", cfg)


def test_writable_paths_must_be_inside_writable_roots(tmp_path):
    readonly = tmp_path / "readonly"
    writable = tmp_path / "writable"
    readonly.mkdir()
    writable.mkdir()
    cfg = BridgeConfig(allowed_roots=[readonly, writable], writable_roots=[writable])

    assert resolve_allowed_path(writable / "out.txt", cfg, require_write=True) == (writable / "out.txt").resolve()

    with pytest.raises(PathDenied):
        resolve_allowed_path(readonly / "out.txt", cfg, require_write=True)


def test_command_policy_allows_exact_commands_and_blocks_dangerous_patterns():
    cfg = BridgeConfig(allowed_commands=["git", "python"], blocked_commands=["git push", "shutdown"])

    assert classify_command("git", ["status"], cfg) == "allow"

    with pytest.raises(CommandDenied):
        classify_command("git", ["push"], cfg)

    with pytest.raises(CommandDenied):
        classify_command("shutdown", ["/s"], cfg)


def test_command_policy_marks_confirmation_patterns():
    cfg = BridgeConfig(allowed_commands=["git"], confirm_commands=["git commit"])

    assert classify_command("git", ["commit", "-m", "msg"], cfg) == "confirm"




def test_command_policy_rejects_arbitrary_path_with_allowed_basename(tmp_path):
    evil = tmp_path / "python"
    evil.write_text("not really python", encoding="utf-8")
    cfg = BridgeConfig(allowed_commands=["python"])

    with pytest.raises(CommandDenied):
        classify_command(str(evil), [], cfg)



def test_load_bridge_config_from_json(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    config_path = tmp_path / "config.json"
    config_path.write_text(
        '{"allowed_roots": ["' + str(root).replace('\\', '\\\\') + '"], "allowed_commands": ["python"], "max_runtime_seconds": 45, "max_output_bytes": 1234}',
        encoding="utf-8",
    )

    cfg = load_bridge_config(config_path)

    assert cfg.allowed_roots == [root]
    assert cfg.allowed_commands == ["python"]
    assert cfg.max_runtime_seconds == 45
    assert cfg.max_output_bytes == 1234
