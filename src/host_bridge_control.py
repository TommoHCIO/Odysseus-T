"""Fixed Host Access Bridge service/task lifecycle controls."""

from __future__ import annotations

import os
import platform
import re
import subprocess
from typing import Callable

WINDOWS_TASK_NAME = "Odysseus Host Access Bridge"
LINUX_SYSTEMD_UNIT = "odysseus-host-bridge.service"
MACOS_LAUNCHD_LABEL = "com.odysseus.host-bridge"
MESSAGE_LIMIT = 500


def _platform_key() -> str:
    name = platform.system().lower()
    if name == "windows":
        return "windows"
    if name == "linux":
        return "linux"
    if name == "darwin":
        return "macos"
    return "unsupported"


def _service_name(platform_key: str) -> str:
    return {
        "windows": WINDOWS_TASK_NAME,
        "linux": LINUX_SYSTEMD_UNIT,
        "macos": MACOS_LAUNCHD_LABEL,
    }.get(platform_key, "Host Access Bridge")


def _result(platform_key: str, status: str, message: str, *, available: bool = True) -> dict:
    return {
        "available": available,
        "platform": platform_key,
        "service_name": _service_name(platform_key),
        "status": status,
        "message": _sanitize_message(message),
    }


def _unsupported() -> dict:
    return _result(
        "unsupported",
        "unsupported",
        "Host bridge lifecycle control is not supported on this platform",
        available=False,
    )


def _sanitize_message(message: str) -> str:
    redacted = re.sub(r"ODYSSEUS_HOST_BRIDGE_TOKEN=\S+", "ODYSSEUS_HOST_BRIDGE_TOKEN=[redacted]", message)
    redacted = re.sub(r"Authorization:\s*Bearer\s+\S+", "Authorization: Bearer [redacted]", redacted, flags=re.I)
    redacted = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", redacted, flags=re.I)
    if len(redacted) > MESSAGE_LIMIT:
        return redacted[:MESSAGE_LIMIT] + "...[truncated]"
    return redacted


def _run_fixed_command(argv: list[str], timeout: int = 10) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
        check=False,
    )


def _run_action(platform_key: str, action: str, argv: list[str], parser: Callable[[subprocess.CompletedProcess[str]], dict] | None = None) -> dict:
    try:
        completed = _run_fixed_command(argv)
    except subprocess.TimeoutExpired:
        return _result(platform_key, "error", f"Host bridge {action} timed out")
    except FileNotFoundError as exc:
        return _result(platform_key, "not_installed", str(exc), available=False)

    if parser:
        return parser(completed)
    if completed.returncode == 0:
        return _result(platform_key, "unknown", f"Host bridge {action} command completed")
    return _result(platform_key, "error", completed.stderr or completed.stdout or f"Host bridge {action} failed")


def _windows_command(action: str) -> list[str]:
    command = {
        "status": f"Get-ScheduledTask -TaskName '{WINDOWS_TASK_NAME}' | Select-Object -ExpandProperty State",
        "start": f"Start-ScheduledTask -TaskName '{WINDOWS_TASK_NAME}'",
        "stop": f"Stop-ScheduledTask -TaskName '{WINDOWS_TASK_NAME}'",
    }[action]
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command]


def _linux_command(action: str) -> list[str]:
    verb = "is-active" if action == "status" else action
    return ["systemctl", "--user", verb, LINUX_SYSTEMD_UNIT]


def _macos_target() -> str:
    return f"gui/{os.getuid()}/{MACOS_LAUNCHD_LABEL}"


def _macos_command(action: str) -> list[str]:
    target = _macos_target()
    if action == "status":
        return ["launchctl", "print", target]
    if action == "stop":
        return ["launchctl", "bootout", target]
    return ["launchctl", "kickstart", "-k", target]


def _parse_windows_status(completed: subprocess.CompletedProcess[str]) -> dict:
    output = (completed.stdout or completed.stderr).strip()
    lower = output.lower()
    if completed.returncode != 0:
        if "not found" in lower or "no msft_scheduledtask" in lower:
            return _result("windows", "not_installed", output, available=False)
        return _result("windows", "error", output)
    if lower == "running":
        return _result("windows", "running", "Host Access Bridge scheduled task is running")
    if lower in {"ready", "disabled"}:
        return _result("windows", "stopped", "Host Access Bridge scheduled task is stopped")
    return _result("windows", "unknown", output or "Unknown scheduled task state")


def _parse_linux_status(completed: subprocess.CompletedProcess[str]) -> dict:
    output = (completed.stdout or completed.stderr).strip()
    lower = output.lower()
    if lower == "active":
        return _result("linux", "running", "Host Access Bridge user service is running")
    if lower in {"inactive", "failed"}:
        return _result("linux", "stopped", output)
    if "could not be found" in lower or "not-found" in lower:
        return _result("linux", "not_installed", output, available=False)
    if completed.returncode != 0:
        return _result("linux", "error", output)
    return _result("linux", "unknown", output or "Unknown systemd service state")


def _parse_macos_status(completed: subprocess.CompletedProcess[str]) -> dict:
    output = (completed.stdout or completed.stderr).strip()
    lower = output.lower()
    if "could not find service" in lower or "no such process" in lower:
        return _result("macos", "not_installed", output, available=False)
    if completed.returncode != 0:
        return _result("macos", "error", output)
    if "pid =" in lower or "state = running" in lower:
        return _result("macos", "running", "Host Access Bridge LaunchAgent is running")
    return _result("macos", "unknown", output or "LaunchAgent exists but state is unknown")


def get_host_bridge_status() -> dict:
    platform_key = _platform_key()
    if platform_key == "unsupported":
        return _unsupported()
    if platform_key == "windows":
        return _run_action(platform_key, "status", _windows_command("status"), _parse_windows_status)
    if platform_key == "linux":
        return _run_action(platform_key, "status", _linux_command("status"), _parse_linux_status)
    return _run_action(platform_key, "status", _macos_command("status"), _parse_macos_status)


def start_host_bridge() -> dict:
    platform_key = _platform_key()
    if platform_key == "unsupported":
        return _unsupported()
    if platform_key == "windows":
        return _run_action(platform_key, "start", _windows_command("start"))
    if platform_key == "linux":
        return _run_action(platform_key, "start", _linux_command("start"))
    return _run_action(platform_key, "start", _macos_command("start"))


def stop_host_bridge() -> dict:
    platform_key = _platform_key()
    if platform_key == "unsupported":
        return _unsupported()
    if platform_key == "windows":
        return _run_action(platform_key, "stop", _windows_command("stop"))
    if platform_key == "linux":
        return _run_action(platform_key, "stop", _linux_command("stop"))
    return _run_action(platform_key, "stop", _macos_command("stop"))


def restart_host_bridge() -> dict:
    platform_key = _platform_key()
    if platform_key == "unsupported":
        return _unsupported()
    if platform_key == "windows":
        stop_host_bridge()
        return start_host_bridge()
    if platform_key == "linux":
        return _run_action(platform_key, "restart", _linux_command("restart"))
    return _run_action(platform_key, "restart", _macos_command("restart"))
