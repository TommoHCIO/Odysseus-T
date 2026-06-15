"""Knowledge metadata helpers for B.L.U.E. outputs."""

from typing import Any, Dict, Optional


def blue_knowledge_metadata(owner: Optional[str], command: str, topic: str) -> Dict[str, Any]:
    return {
        "owner": owner,
        "feature": "blue",
        "category": "knowledge",
        "genre": "learning",
        "type": "blue_artifact",
        "source": "blue",
        "command": command,
        "topic": topic,
        "tags": ["blue", "learning"],
    }
