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
    "feature-shipping": 1,
    "feature-shipping-subskills": 3,
}

EXPECTED_SKILL_NAMES = {
    "ship-feature",
    "grill-with-docs",
    "srs",
    "tdd",
}


def test_default_skill_catalog_is_ship_feature_stack():
    assert len(DEFAULT_SKILLS) == 4
    slugs = [slugify(skill["name"]) for skill in DEFAULT_SKILLS]
    assert len(slugs) == len(set(slugs))
    assert set(slugs) == EXPECTED_SKILL_NAMES
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

    assert result["counts"] == {"created": 4, "updated": 0, "skipped": 0, "removed": 0, "removed_legacy": 0}

    skill_files = sorted((tmp_path / "skills").glob("*/*/SKILL.md"))
    assert len(skill_files) == 4

    parsed = [Skill.from_markdown(path.read_text(encoding="utf-8"), path=str(path)) for path in skill_files]
    assert all(skill.owner == "admin" for skill in parsed)
    assert all(skill.status == "published" for skill in parsed)
    assert all(skill.source == "user" for skill in parsed)
    assert all(not skill.name.endswith("-2") for skill in parsed)

    manager = SkillsManager(str(tmp_path))
    admin_index = manager.index_for(owner="admin")
    other_index = manager.index_for(owner="someone-else")
    assert len(admin_index) == 4
    assert {skill["name"] for skill in admin_index} == EXPECTED_SKILL_NAMES
    assert other_index == []


def test_seed_skills_is_idempotent_without_update_existing(tmp_path):
    first = seed_skills(owner="admin", data_dir=tmp_path)
    second = seed_skills(owner="admin", data_dir=tmp_path)

    assert first["counts"] == {"created": 4, "updated": 0, "skipped": 0, "removed": 0, "removed_legacy": 0}
    assert second["counts"] == {"created": 0, "updated": 0, "skipped": 4, "removed": 0, "removed_legacy": 0}
    assert len(list((tmp_path / "skills").glob("*/*/SKILL.md"))) == 4


def test_seed_skills_keeps_stable_names_when_reassigning_owner(tmp_path):
    seed_skills(owner="prova", data_dir=tmp_path)
    seed_skills(owner="admin", data_dir=tmp_path)

    manager = SkillsManager(str(tmp_path))
    skills = manager.load(owner="admin")

    assert len(skills) == 4
    assert all(not skill["name"].endswith("-2") for skill in skills)
    assert {skill["owner"] for skill in skills} == {"admin"}


def test_seed_skills_dry_run_writes_nothing(tmp_path):
    result = seed_skills(owner="admin", data_dir=tmp_path, dry_run=True)

    assert result["counts"] == {"created": 4, "updated": 0, "skipped": 0, "removed": 0, "removed_legacy": 0}
    assert not list((tmp_path / "skills").glob("*/*/SKILL.md"))


def test_seed_skills_update_existing_refreshes_catalog_entries(tmp_path):
    seed_skills(owner="admin", data_dir=tmp_path)
    result = seed_skills(owner="admin", data_dir=tmp_path, update_existing=True)

    assert result["counts"] == {"created": 0, "updated": 4, "skipped": 0, "removed": 0, "removed_legacy": 0}
    assert len(list((tmp_path / "skills").glob("*/*/SKILL.md"))) == 4


def test_seed_skills_replace_catalog_removes_owner_scoped_extra_skills(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(
        name="old-starter-skill",
        description="Old starter skill",
        category="legacy",
        status="published",
        source="user",
        owner="admin",
    )
    manager.add_skill(
        name="other-user-skill",
        description="Other user's skill",
        category="legacy",
        status="published",
        source="user",
        owner="bob",
    )

    result = seed_skills(owner="admin", data_dir=tmp_path, replace_catalog=True)

    assert result["counts"] == {"created": 4, "updated": 0, "skipped": 0, "removed": 1, "removed_legacy": 0}
    assert result["removed"] == ["old-starter-skill"]
    assert {skill["name"] for skill in manager.load(owner="admin")} == EXPECTED_SKILL_NAMES
    assert {skill["name"] for skill in manager.load(owner="bob")} == {"other-user-skill"}


def test_seed_skills_replace_catalog_removes_legacy_rollback_files_when_obsidian_is_active(tmp_path):
    manager = SkillsManager(str(tmp_path))
    manager.add_skill(
        name="old-legacy-skill",
        description="Old legacy skill",
        category="legacy",
        status="published",
        source="user",
        owner="admin",
    )
    marker = tmp_path / "obsidian-vault" / "_system" / "brain-to-obsidian-skills.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("{}", encoding="utf-8")

    result = seed_skills(owner="admin", data_dir=tmp_path, replace_catalog=True)

    assert result["counts"] == {"created": 4, "updated": 0, "skipped": 0, "removed": 0, "removed_legacy": 1}
    assert result["removed_legacy"] == ["old-legacy-skill"]
    assert not list((tmp_path / "skills").glob("*/*/SKILL.md"))
