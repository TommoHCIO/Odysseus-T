"""Persistence for installed MCP marketplace servers."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

MARKETPLACE_DIR = Path(os.environ.get("ODYSSEUS_MCP_MARKETPLACE_DIR", "data/mcp_marketplace"))
INSTALLED_PATH = MARKETPLACE_DIR / "installed.json"


@dataclass
class InstalledMarketplaceServer:
    id: str
    mcp_server_id: str
    catalog_entry_id: str
    name: str
    runtime: str
    install_dir: str
    config: Dict[str, Any]
    status: str
    managed_process: bool
    last_error: str | None = None
    logs: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "InstalledMarketplaceServer":
        return cls(
            id=str(raw["id"]),
            mcp_server_id=str(raw["mcp_server_id"]),
            catalog_entry_id=str(raw["catalog_entry_id"]),
            name=str(raw["name"]),
            runtime=str(raw["runtime"]),
            install_dir=str(raw["install_dir"]),
            config=dict(raw.get("config") or {}),
            status=str(raw.get("status") or "stopped"),
            managed_process=bool(raw.get("managed_process", True)),
            last_error=raw.get("last_error"),
            logs=list(raw.get("logs") or []),
            created_at=str(raw.get("created_at") or datetime.now(timezone.utc).isoformat()),
            updated_at=str(raw.get("updated_at") or datetime.now(timezone.utc).isoformat()),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MarketplaceStore:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path is not None else Path(os.environ.get("ODYSSEUS_MCP_MARKETPLACE_DIR", "data/mcp_marketplace")) / "installed.json"

    def _read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {"servers": []}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, payload: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def list(self) -> List[InstalledMarketplaceServer]:
        payload = self._read()
        return [InstalledMarketplaceServer.from_dict(item) for item in payload.get("servers", [])]

    def get(self, server_id: str) -> Optional[InstalledMarketplaceServer]:
        for server in self.list():
            if server.id == server_id:
                return server
        return None

    def save(self, server: InstalledMarketplaceServer) -> InstalledMarketplaceServer:
        server.updated_at = datetime.now(timezone.utc).isoformat()
        servers = [item for item in self.list() if item.id != server.id]
        servers.append(server)
        servers.sort(key=lambda item: item.name.lower())
        self._write({"servers": [item.to_dict() for item in servers]})
        return server

    def delete(self, server_id: str) -> bool:
        servers = self.list()
        kept = [item for item in servers if item.id != server_id]
        if len(kept) == len(servers):
            return False
        self._write({"servers": [item.to_dict() for item in kept]})
        return True

    def append_log(self, server_id: str, message: str, status: str | None = None, last_error: str | None = None) -> Optional[InstalledMarketplaceServer]:
        server = self.get(server_id)
        if not server:
            return None
        server.logs.append(message)
        server.logs = server.logs[-50:]
        if status:
            server.status = status
        server.last_error = last_error
        return self.save(server)
