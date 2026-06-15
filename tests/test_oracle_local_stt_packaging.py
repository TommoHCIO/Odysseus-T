from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def test_dockerfile_has_opt_in_local_stt_dependency_install():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    requirements = (ROOT / "requirements-local-stt.txt").read_text(encoding="utf-8")

    assert "ARG INSTALL_LOCAL_STT=false" in dockerfile
    assert "requirements-local-stt.txt" in dockerfile
    assert "INSTALL_LOCAL_STT" in dockerfile
    assert "faster-whisper" in requirements
    assert "PyMuPDF" not in requirements
    assert "markitdown" not in requirements


def test_compose_exposes_local_stt_build_arg_for_odysseus_only():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))

    odysseus_build = compose["services"]["odysseus"]["build"]
    whatsapp_build = compose["services"]["whatsapp-bridge"]["build"]

    assert odysseus_build["context"] == "."
    assert odysseus_build["args"]["INSTALL_LOCAL_STT"] == "${ODYSSEUS_INSTALL_LOCAL_STT:-false}"
    assert whatsapp_build == "."


def test_default_runtime_installs_websocket_backend_for_oracle_ws():
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")

    assert "websockets" in requirements or "uvicorn[standard]" in requirements or "wsproto" in requirements
