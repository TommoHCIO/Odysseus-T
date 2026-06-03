"""Policy helpers for the Odysseus host access bridge."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path


class PathDenied(ValueError):
    """Raised when a host path is outside the configured policy."""


class CommandDenied(ValueError):
    """Raised when a host command is outside the configured policy."""


@dataclass(frozen=True)
class BridgeConfig:
    """Host bridge security policy.

    Empty defaults intentionally deny all host paths and commands.
    """

    allowed_roots: list[Path | str] = field(default_factory=list)
    writable_roots: list[Path | str] = field(default_factory=list)
    allowed_commands: list[str] = field(default_factory=list)
    blocked_commands: list[str] = field(default_factory=list)
    confirm_commands: list[str] = field(default_factory=list)
    max_runtime_seconds: int = 30
    max_output_bytes: int = 1_000_000


def _resolve_existing_or_parent(path: Path) -> Path:
    if path.exists():
        return path.resolve()
    parent = path.parent
    if parent.exists():
        return parent.resolve() / path.name
    return path.resolve()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolved_roots(roots: list[Path | str]) -> list[Path]:
    return [Path(root).expanduser().resolve() for root in roots]


def resolve_allowed_path(path: Path | str, cfg: BridgeConfig, *, require_write: bool = False) -> Path:
    """Resolve a path if it is permitted by the bridge path policy."""

    requested = _resolve_existing_or_parent(Path(path).expanduser())
    readable_roots = _resolved_roots(cfg.allowed_roots)
    if not any(_is_relative_to(requested, root) for root in readable_roots):
        raise PathDenied(f"Path is outside allowed roots: {requested}")

    if require_write:
        writable_roots = _resolved_roots(cfg.writable_roots)
        if not any(_is_relative_to(requested, root) for root in writable_roots):
            raise PathDenied(f"Path is outside writable roots: {requested}")

    return requested


def _normalize_command(command: str) -> str:
    expanded = Path(command).expanduser()
    if expanded.is_absolute() or expanded.parent != Path("."):
        return str(expanded.resolve()).lower()
    return command.lower()


def _command_line(command: str, args: list[str]) -> str:
    return " ".join([command, *args]).strip().lower()


def _matches_pattern(line: str, pattern: str) -> bool:
    pattern = pattern.strip().lower()
    return bool(pattern) and (line == pattern or line.startswith(pattern + " "))


def classify_command(command: str, args: list[str], cfg: BridgeConfig) -> str:
    """Classify a command as allowed or confirmation-required."""

    normalized = _normalize_command(command)
    display = Path(command).name.lower()
    line = _command_line(normalized, args)
    display_line = _command_line(display, args)

    if any(_matches_pattern(line, pattern) or _matches_pattern(display_line, pattern) for pattern in cfg.blocked_commands):
        raise CommandDenied(f"Command is blocked: {display}")

    allowed = {_normalize_command(cmd) for cmd in cfg.allowed_commands}
    if normalized not in allowed:
        raise CommandDenied(f"Command is not allowed: {display}")

    if any(_matches_pattern(line, pattern) or _matches_pattern(display_line, pattern) for pattern in cfg.confirm_commands):
        return "confirm"

    return "allow"



def load_bridge_config(path: Path | str) -> BridgeConfig:
    """Load bridge policy from a JSON config file."""

    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return BridgeConfig(
        allowed_roots=[Path(root) for root in data.get("allowed_roots", [])],
        writable_roots=[Path(root) for root in data.get("writable_roots", [])],
        allowed_commands=list(data.get("allowed_commands", [])),
        blocked_commands=list(data.get("blocked_commands", [])),
        confirm_commands=list(data.get("confirm_commands", [])),
        max_runtime_seconds=int(data.get("max_runtime_seconds", 30)),
        max_output_bytes=int(data.get("max_output_bytes", 1_000_000)),
    )


def enforce_output_limit(output: str, *, max_bytes: int) -> str:
    """Return output truncated to a UTF-8 byte limit with a clear marker."""

    encoded = output.encode("utf-8")
    if len(encoded) <= max_bytes:
        return output

    truncated = encoded[:max_bytes].decode("utf-8", errors="ignore")
    return f"{truncated}\n[output truncated to {max_bytes} bytes]"
