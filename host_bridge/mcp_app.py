"""MCP application wrapper for the Odysseus host access bridge."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .policy import BridgeConfig, load_bridge_config
from .server import HostBridge


DEFAULT_TOKEN_ENV = "ODYSSEUS_HOST_BRIDGE_TOKEN"


def create_mcp_app(config: BridgeConfig, *, token: str | None) -> FastMCP:
    """Create a FastMCP app exposing controlled host-access tools."""

    resolved_token = token or os.environ.get(DEFAULT_TOKEN_ENV, "")
    bridge = HostBridge(config, token=resolved_token)
    app = FastMCP(
        "Odysseus Host Access Bridge",
        instructions=(
            "Controlled host-PC access bridge for Odysseus. Tools require the "
            "configured bridge token and enforce host-side path and command policy."
        ),
        host=os.environ.get("ODYSSEUS_HOST_BRIDGE_BIND", "127.0.0.1"),
        port=int(os.environ.get("ODYSSEUS_HOST_BRIDGE_PORT", "8765")),
    )

    @app.tool()
    def host_health(token: str) -> dict:
        """Return host bridge status and policy summary."""

        return bridge.host_health(token=token)

    @app.tool()
    def host_list_dir(path: str, token: str) -> list[dict]:
        """List a host directory under configured allowed roots."""

        return bridge.host_list_dir(path, token=token)

    @app.tool()
    def host_read_file(path: str, token: str, max_bytes: int | None = None) -> str:
        """Read a host file under configured allowed roots."""

        return bridge.host_read_file(path, token=token, max_bytes=max_bytes)

    @app.tool()
    def host_write_file(path: str, content: str, token: str, mode: str = "w") -> dict:
        """Write a host file under configured writable roots."""

        return bridge.host_write_file(path, content, token=token, mode=mode)

    @app.tool()
    def host_run_command(
        command: str,
        args: list[str] | None,
        token: str,
        cwd: str | None = None,
        timeout_seconds: int | None = None,
    ) -> dict:
        """Run an allowed host command without shell interpolation."""

        return bridge.host_run_command(
            command,
            args or [],
            token=token,
            cwd=cwd,
            timeout_seconds=timeout_seconds,
        )

    @app.tool()
    def host_approve_confirmation(confirmation_id: str, token: str) -> dict:
        """Approve a pending confirmation for one matching host command."""

        return bridge.approve_confirmation(confirmation_id, token=token)

    return app


def _default_config_path() -> Path:
    return Path(os.environ.get("ODYSSEUS_HOST_BRIDGE_CONFIG", Path(__file__).with_name("config.json")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Odysseus host access MCP bridge")
    parser.add_argument("--config", type=Path, default=_default_config_path())
    parser.add_argument("--token", default=os.environ.get(DEFAULT_TOKEN_ENV, ""))
    parser.add_argument("--transport", choices=("sse", "streamable-http", "stdio"), default="sse")
    args = parser.parse_args()

    config = load_bridge_config(args.config) if args.config.exists() else BridgeConfig()
    app = create_mcp_app(config, token=args.token)
    app.run(transport=args.transport)


if __name__ == "__main__":
    main()
