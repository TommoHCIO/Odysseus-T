"""Small graph helpers for future B.L.U.E. skill tree persistence."""

from dataclasses import dataclass, field
from typing import Iterable, List


@dataclass
class BlueNode:
    title: str
    children: List["BlueNode"] = field(default_factory=list)


def flatten_skill_tree(nodes: Iterable[BlueNode]) -> List[str]:
    out: List[str] = []

    def walk(node: BlueNode, depth: int) -> None:
        out.append(f"{'  ' * depth}- {node.title}")
        for child in node.children:
            walk(child, depth + 1)

    for node in nodes:
        walk(node, 0)
    return out
