"""Official MCP Registry ingestion helpers for local-install Marketplace entries."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List

import httpx

_REGISTRY_ID_SAFE = re.compile(r"[^a-zA-Z0-9_.-]+")


def _slug(value: str) -> str:
    cleaned = _REGISTRY_ID_SAFE.sub("-", value.strip()).strip("-")
    return cleaned or "unknown"


def _official_meta(record: Dict[str, Any]) -> Dict[str, Any]:
    return ((record.get("_meta") or {}).get("io.modelcontextprotocol.registry/official") or {})


def _is_latest_active(record: Dict[str, Any]) -> bool:
    meta = _official_meta(record)
    return meta.get("status", "active") == "active" and meta.get("isLatest", True) is True


def _runtime_for_package(package: Dict[str, Any]) -> str | None:
    registry_type = str(package.get("registryType") or "").lower()
    if registry_type == "npm":
        return "npm"
    if registry_type == "pypi":
        return "python_uv"
    if registry_type in {"oci", "docker"}:
        return "docker"
    return None


def _recipe_for_package(package: Dict[str, Any], runtime: str) -> Dict[str, Any]:
    identifier = str(package.get("identifier") or "").strip()
    if runtime == "docker":
        return {"image": identifier, "args": []}
    return {"package": identifier, "args": []}


def normalize_registry_servers(raw_servers: Iterable[Dict[str, Any]], source_id: str, source_priority: int) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for record in raw_servers:
        if not _is_latest_active(record):
            continue
        server = record.get("server") or record
        packages = server.get("packages") or []
        if not packages:
            continue
        server_name = str(server.get("name") or "unknown")
        title = str(server.get("title") or server_name.rsplit("/", 1)[-1])
        description = str(server.get("description") or "No description provided.")
        version = str(server.get("version") or "latest")
        repository = server.get("repository") or {}
        source_url = str(repository.get("url") or server.get("websiteUrl") or "https://registry.modelcontextprotocol.io")
        publisher = str(repository.get("source") or server_name.split("/", 1)[0] or "MCP Registry")
        for package in packages:
            runtime = _runtime_for_package(package)
            identifier = str(package.get("identifier") or "").strip()
            if not runtime or not identifier:
                continue
            package_type = str(package.get("registryType") or "").lower()
            package_slug = _slug(identifier.replace("@", ""))
            entry_id = f"registry-{_slug(server_name)}-{package_type}-{package_slug}"
            entries.append({
                "id": entry_id,
                "name": title,
                "description": description,
                "publisher": publisher,
                "version": str(package.get("version") or version),
                "runtime": runtime,
                "recipe": _recipe_for_package(package, runtime),
                "config_fields": [],
                "permissions": ["Local MCP server package from the official MCP Registry"],
                "source_url": source_url,
                "package_type": package_type,
                "categories": ["Registry"],
                "tags": ["registry", package_type, runtime],
            })
    return entries


def registry_entries_from_payload(payload: Dict[str, Any], source_id: str, source_priority: int) -> List[Dict[str, Any]]:
    return normalize_registry_servers(payload.get("servers") or [], source_id=source_id, source_priority=source_priority)


def fetch_registry_catalog(
    url: str,
    source_id: str,
    source_priority: int,
    client: Any | None = None,
    page_limit: int = 2,
    request_timeout: float = 15.0,
) -> List[Dict[str, Any]]:
    http_client = client or httpx.Client()
    close_client = client is None
    cursor = None
    entries: List[Dict[str, Any]] = []
    try:
        for _ in range(page_limit):
            params = {"limit": 96}
            if cursor:
                params["cursor"] = cursor
            try:
                response = http_client.get(url, params=params, timeout=request_timeout)
                response.raise_for_status()
                payload = response.json()
            except Exception:
                if entries:
                    break
                raise
            entries.extend(registry_entries_from_payload(payload, source_id=source_id, source_priority=source_priority))
            cursor = (payload.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
    finally:
        if close_client and hasattr(http_client, "close"):
            http_client.close()
    return entries
