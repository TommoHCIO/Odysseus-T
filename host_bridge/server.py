"""Local host-access bridge implementation.

This module intentionally keeps host access behind explicit policy checks. The
class can be adapted to an MCP transport layer without changing the core policy
behavior.
"""

from __future__ import annotations

import getpass
import os
import platform
import subprocess
import uuid
from pathlib import Path
from typing import Any

from .policy import BridgeConfig, classify_command, enforce_output_limit, resolve_allowed_path


class UnauthorizedError(PermissionError):
    """Raised when a bridge request has an invalid token."""


class ConfirmationRequired(PermissionError):
    """Raised when policy requires explicit user confirmation."""


class HostBridge:
    """Policy-enforcing host access facade for MCP tools."""

    def __init__(self, config: BridgeConfig, *, token: str, max_output_bytes: int | None = None):
        if not token:
            raise ValueError("Host bridge token must be non-empty")
        self.config = config
        self.token = token
        self.max_output_bytes = max_output_bytes if max_output_bytes is not None else config.max_output_bytes
        self.audit_events: list[dict[str, Any]] = []
        self.pending_confirmations: dict[str, dict[str, Any]] = {}
        self._approved_confirmations: set[tuple[str, tuple[str, ...]]] = set()

    def _record_audit(self, *, tool: str, decision: str, status: str, summary: str) -> None:
        self.audit_events.append({"tool": tool, "decision": decision, "status": status, "summary": summary})

    def _authorize(self, token: str) -> None:
        if token != self.token:
            raise UnauthorizedError("Invalid host bridge token")

    def _policy_summary(self) -> dict[str, Any]:
        return {
            "allowed_roots": [str(Path(root).expanduser().resolve()) for root in self.config.allowed_roots],
            "writable_roots": [str(Path(root).expanduser().resolve()) for root in self.config.writable_roots],
            "allowed_commands": list(self.config.allowed_commands),
            "blocked_commands": list(self.config.blocked_commands),
            "confirm_commands": list(self.config.confirm_commands),
        }

    def approve_confirmation(self, confirmation_id: str, *, token: str) -> dict[str, Any]:
        """Approve a pending confirmation for one matching command execution."""

        self._authorize(token)
        confirmation = self.pending_confirmations.pop(confirmation_id)
        self._approved_confirmations.add((confirmation["command"], tuple(confirmation["args"])))
        return {"confirmation_id": confirmation_id, "status": "approved"}

    def _require_or_record_confirmation(self, command: str, args: list[str]) -> None:
        key = (command, tuple(args))
        if key in self._approved_confirmations:
            self._approved_confirmations.remove(key)
            return
        confirmation_id = uuid.uuid4().hex
        self.pending_confirmations[confirmation_id] = {
            "tool": "host_run_command",
            "command": command,
            "args": list(args),
        }
        raise ConfirmationRequired(f"Command requires confirmation: {confirmation_id}")

    def host_health(self, *, token: str) -> dict[str, Any]:
        self._authorize(token)
        return {
            "status": "ok",
            "user": getpass.getuser(),
            "os": platform.system(),
            "policy": self._policy_summary(),
        }

    def host_list_dir(self, path: str, *, token: str) -> list[dict[str, Any]]:
        self._authorize(token)
        resolved = resolve_allowed_path(path, self.config)
        return [
            {"name": child.name, "path": str(child), "is_dir": child.is_dir()}
            for child in sorted(resolved.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        ]

    def host_read_file(self, path: str, *, token: str, max_bytes: int | None = None) -> str:
        self._authorize(token)
        try:
            resolved = resolve_allowed_path(path, self.config)
            limit = max_bytes if max_bytes is not None else self.max_output_bytes
            data = resolved.read_text(encoding="utf-8")
            self._record_audit(tool="host_read_file", decision="allow", status="ok", summary=str(resolved))
            return enforce_output_limit(data, max_bytes=limit)
        except Exception as exc:
            self._record_audit(tool="host_read_file", decision="deny", status="error", summary=str(exc))
            raise

    def host_write_file(self, path: str, content: str, *, token: str, mode: str = "w") -> dict[str, Any]:
        self._authorize(token)
        if mode not in {"w", "a"}:
            raise ValueError("mode must be 'w' or 'a'")
        resolved = resolve_allowed_path(path, self.config, require_write=True)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        with resolved.open(mode, encoding="utf-8") as handle:
            handle.write(content)
        return {"path": str(resolved), "bytes_written": len(content.encode("utf-8"))}

    def host_run_command(
        self,
        command: str,
        args: list[str] | None = None,
        *,
        token: str,
        cwd: str | None = None,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        self._authorize(token)
        args = args or []
        decision = classify_command(command, args, self.config)
        if decision == "confirm":
            self._require_or_record_confirmation(command, args)

        resolved_cwd = None
        if cwd:
            resolved_cwd = resolve_allowed_path(cwd, self.config)
        elif self.config.allowed_roots:
            resolved_cwd = resolve_allowed_path(self.config.allowed_roots[0], self.config)

        completed = subprocess.run(
            [command, *args],
            cwd=str(resolved_cwd) if resolved_cwd else None,
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds if timeout_seconds is not None else self.config.max_runtime_seconds,
            env=os.environ.copy(),
            check=False,
        )
        return {
            "exit_code": completed.returncode,
            "stdout": enforce_output_limit(completed.stdout, max_bytes=self.max_output_bytes),
            "stderr": enforce_output_limit(completed.stderr, max_bytes=self.max_output_bytes),
        }
