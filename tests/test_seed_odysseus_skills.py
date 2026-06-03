import sys
from pathlib import Path

import pytest

def _atomic_write_text(path, content, **kwargs):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content, encoding="utf-8")

from scripts.seed_odysseus_skills import DEFAULT_SKILLS, category_counts, seed_skills
from services.memory.skill_format import Skill, slugify
from services.memory.skills import SkillsManager

EXPECTED_CATEGORIES = {
    "coding-workflow": 20,
    "odysseus-host-mcp-docker": 20,
    "productivity-doc-email-research": 20,
    "software-engineering-devops": 20,
    "safety-verification-planning": 20,
}


def test_default_skill_catalog_has_exactly_100_unique_skills():
    assert len(DEFAULT_SKILLS) == 100
    slugs = [slugify(skill["name"]) for skill in DEFAULT_SKILLS]
    assert len(slugs) == len(set(slugs))
    assert category_counts() == EXPECTED_CATEGORIES


@pytest.mark.parametrize("skill", DEFAULT_SKILLS)
def test_default_skills_have_required_fields(skill):
    assert skill["name"]
    assert skill["description"]
    assert skill["category"] in EXPECTED_CATEGORIES
    assert skill["when_to_use"]
    assert skill["procedure"]
    assert skill["verification"]
    assert isinstance(skill["tags"], list)
    assert isinstance(skill["pitfalls"], list)


def test_seed_skills_writes_parseable_published_owner_scoped_skills(tmp_path):
    result = seed_skills(owner="admin", data_dir=tmp_path)

    assert result["counts"] == {"created": 100, "updated": 0, "skipped": 0}

    skill_files = sorted((tmp_path / "skills").glob("*/*/SKILL.md"))
    assert len(skill_files) == 100

    parsed = [Skill.from_markdown(path.read_text(encoding="utf-8"), path=str(path)) for path in skill_files]
    assert all(skill.owner == "admin" for skill in parsed)
    assert all(skill.status == "published" for skill in parsed)
    assert all(skill.source == "user" for skill in parsed)
    assert all(not skill.name.endswith("-2") for skill in parsed)

    manager = SkillsManager(str(tmp_path))
    admin_index = manager.index_for(owner="admin")
    other_index = manager.index_for(owner="someone-else")
    assert len(admin_index) == 100
    assert other_index == []


def test_seed_skills_is_idempotent_without_update_existing(tmp_path):
    first = seed_skills(owner="admin", data_dir=tmp_path)
    second = seed_skills(owner="admin", data_dir=tmp_path)

    assert first["counts"] == {"created": 100, "updated": 0, "skipped": 0}
    assert second["counts"] == {"created": 0, "updated": 0, "skipped": 100}
    assert len(list((tmp_path / "skills").glob("*/*/SKILL.md"))) == 100


def test_seed_skills_keeps_stable_names_when_reassigning_owner(tmp_path):
    seed_skills(owner="prova", data_dir=tmp_path)
    seed_skills(owner="admin", data_dir=tmp_path)

    manager = SkillsManager(str(tmp_path))
    skills = manager.load(owner="admin")

    assert len(skills) == 100
    assert all(not skill["name"].endswith("-2") for skill in skills)
    assert {skill["owner"] for skill in skills} == {"admin"}


def test_seed_skills_dry_run_writes_nothing(tmp_path):
    result = seed_skills(owner="admin", data_dir=tmp_path, dry_run=True)

    assert result["counts"] == {"created": 100, "updated": 0, "skipped": 0}
    assert not list((tmp_path / "skills").glob("*/*/SKILL.md"))


def test_seed_skills_update_existing_refreshes_catalog_entries(tmp_path):
    seed_skills(owner="admin", data_dir=tmp_path)
    result = seed_skills(owner="admin", data_dir=tmp_path, update_existing=True)

    assert result["counts"] == {"created": 0, "updated": 100, "skipped": 0}
    assert len(list((tmp_path / "skills").glob("*/*/SKILL.md"))) == 100
