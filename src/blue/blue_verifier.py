"""Validation helpers for B.L.U.E. artifacts."""

BLUE_REQUIRED_SECTIONS = (
    "Skill tree",
    "Learning levels",
    "Prerequisites",
    "Multiple methods",
    "Verified final answer",
)


def missing_required_sections(markdown: str) -> list[str]:
    text = markdown or ""
    return [section for section in BLUE_REQUIRED_SECTIONS if section not in text]


def is_complete_blue_artifact(markdown: str) -> bool:
    return not missing_required_sections(markdown)
