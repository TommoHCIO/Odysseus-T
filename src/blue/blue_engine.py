"""B.L.U.E. request parsing and prompt composition."""

from typing import Any, Dict, Optional

from .blue_memory import blue_knowledge_metadata
from .blue_prompts import build_blue_prompt
from .blue_schema import BlueRequest

BLUE_COMMANDS = {"learn", "path", "map", "methods", "verify", "absorb", "debate", "build"}


def parse_blue_request(raw: str) -> BlueRequest:
    text = (raw or "").strip()
    if not text:
        raise ValueError("Tell B.L.U.E. what to work on, for example: /blue learn OAuth basics")

    first, _, rest = text.partition(" ")
    command = first.lower()
    if command in BLUE_COMMANDS:
        topic = rest.strip()
        if not topic:
            raise ValueError(f"Add a topic after /blue {command}.")
        return BlueRequest(command=command, topic=topic)

    return BlueRequest(command="learn", topic=text)


def compose_blue_request(raw: str, owner: Optional[str] = None) -> Dict[str, Any]:
    request = parse_blue_request(raw)
    prompt = build_blue_prompt(request)
    return {
        "feature": "blue",
        "command": request.command,
        "topic": request.topic,
        "mode": "agent",
        "allow_web_search": True,
        "allow_bash": False,
        "prompt": prompt,
        "metadata": blue_knowledge_metadata(owner, request.command, request.topic),
    }
