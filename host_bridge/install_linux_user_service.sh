#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="odysseus-host-bridge.service"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$SERVICE_DIR/$SERVICE_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"

mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_PATH" <<SERVICE
[Unit]
Description=Odysseus Host Access Bridge
After=network.target

[Service]
Type=simple
ExecStart=$PYTHON_BIN -m host_bridge.mcp_app
Restart=on-failure
RestartSec=5
WorkingDirectory=$REPO_ROOT

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "Installed and started user service: $SERVICE_NAME"
echo "Service file: $SERVICE_PATH"
