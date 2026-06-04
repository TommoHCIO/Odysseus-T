"""Runtime helpers for MCP marketplace installs."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict

from src.mcp_marketplace_catalog import CatalogEntry
from src.mcp_marketplace_store import InstalledMarketplaceServer

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_.-]+$")
_SAFE_PACKAGE = re.compile(r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9._-]+)?$")
_SAFE_IMAGE = re.compile(r"^[a-z0-9]+(?:(?:[._-][a-z0-9]+)+)?(?::[0-9]+)?(?:/[a-z0-9]+(?:(?:[._-][a-z0-9]+)+)?)*(?::[A-Za-z0-9_.-]+)?$")


def marketplace_install_dir(entry_id: str, base_dir: Path | str = "data/mcp_marketplace") -> Path:
    if not _SAFE_ID.match(entry_id):
        raise ValueError("Invalid marketplace id")
    base = Path(base_dir).resolve()
    target = (base / entry_id).resolve()
    if base not in target.parents and target != base:
        raise ValueError("Install path escapes marketplace directory")
    return target


def _render(value: Any, config: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        rendered = value
        for key, config_value in config.items():
            rendered = rendered.replace("{" + key + "}", str(config_value))
        return rendered
    if isinstance(value, list):
        return [_render(item, config) for item in value]
    if isinstance(value, dict):
        return {key: _render(item, config) for key, item in value.items()}
    return value


def _validate_package_identifier(package: str) -> None:
    if not _SAFE_PACKAGE.match(package):
        raise ValueError("Invalid package identifier")


def _validate_image_identifier(image: str) -> None:
    if not _SAFE_IMAGE.match(image):
        raise ValueError("Invalid image identifier")


def validate_recipe(entry: CatalogEntry, config: Dict[str, Any]) -> None:
    missing = [field["name"] for field in entry.config_fields if field.get("required") and not config.get(field["name"])]
    if missing:
        raise ValueError(f"Missing required config: {', '.join(missing)}")
    if entry.runtime in {"npm", "python_uv"} and not entry.recipe.get("package"):
        raise ValueError("package is required for package runtimes")
    if entry.runtime in {"npm", "python_uv"}:
        _validate_package_identifier(str(entry.recipe["package"]))
    if entry.runtime == "docker" and not entry.recipe.get("image"):
        raise ValueError("image is required for docker runtime")
    if entry.runtime == "docker":
        _validate_image_identifier(str(entry.recipe["image"]))
    if entry.runtime == "sse" and not entry.recipe.get("url"):
        raise ValueError("url is required for sse runtime")
    if "command" in entry.recipe:
        raise ValueError("arbitrary command recipes are not allowed")


def install_marketplace_entry(entry: CatalogEntry, config: Dict[str, Any], base_dir: Path | str = "data/mcp_marketplace") -> InstalledMarketplaceServer:
    validate_recipe(entry, config)
    install_dir = marketplace_install_dir(entry.id, base_dir)
    install_dir.mkdir(parents=True, exist_ok=True)
    (install_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    managed_process = entry.runtime != "sse"
    message = {
        "npm": f"Prepared npm package {entry.recipe.get('package')}",
        "python_uv": f"Prepared Python/uv package {entry.recipe.get('package')}",
        "docker": f"Prepared Docker image {entry.recipe.get('image')}",
        "sse": "Prepared external SSE connection",
    }[entry.runtime]
    return InstalledMarketplaceServer(
        id=entry.id,
        mcp_server_id=f"mkt-{entry.id}",
        catalog_entry_id=entry.id,
        name=entry.name,
        runtime=entry.runtime,
        install_dir=str(install_dir),
        config=config,
        status="stopped",
        managed_process=managed_process,
        logs=[message],
    )


def build_mcp_server_config(entry: CatalogEntry, installed: InstalledMarketplaceServer) -> Dict[str, Any]:
    recipe = _render(entry.recipe, installed.config)
    env = recipe.get("env") or {}
    if entry.runtime == "npm":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", recipe["package"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "python_uv":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "uvx",
            "args": [recipe["package"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "docker":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "stdio",
            "command": "docker",
            "args": ["run", "--rm", "-i", recipe["image"], *recipe.get("args", [])],
            "env": env,
            "url": None,
        }
    if entry.runtime == "sse":
        return {
            "id": installed.mcp_server_id,
            "name": installed.name,
            "transport": "sse",
            "command": None,
            "args": [],
            "env": env,
            "url": recipe["url"],
        }
    raise ValueError(f"Unsupported runtime: {entry.runtime}")


def status_color(status: str) -> str:
    if status in {"running", "connected"}:
        return "green"
    if status in {"installing", "starting", "reconnecting", "refreshing"}:
        return "yellow"
    return "red"
