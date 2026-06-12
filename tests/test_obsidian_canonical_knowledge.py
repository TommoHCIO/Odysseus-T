import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.knowledge_routes import setup_knowledge_routes
from services.memory.skill_format import Skill, slugify
from services.memory.skills import SkillsManager
from src.memory import MemoryManager
from src.obsidian_knowledge import search_knowledge


def _write_legacy_memory(data_dir: Path, rows: list[dict]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "memory.json").write_text(json.dumps(rows), encoding="utf-8")


def test_legacy_memory_imports_to_obsidian_once(tmp_path):
    _write_legacy_memory(
        tmp_path,
        [
            {
                "id": "pref-1",
                "text": "User prefers concise implementation notes.",
                "category": "preference",
                "owner": "alice",
                "uses": 3,
                "pinned": True,
            }
        ],
    )

    manager = MemoryManager(str(tmp_path))
    first = manager.migrate_legacy_memory()
    second = manager.migrate_legacy_memory()

    assert first["imported"] == 0  # __init__ already ran the idempotent import
    assert second["imported"] == 0
    notes = list((tmp_path / "obsidian-vault" / "alice" / "Odysseus" / "Knowledge").rglob("*.md"))
    assert len(notes) == 1
    content = notes[0].read_text(encoding="utf-8")
    assert "genre: \"preference\"" in content
    assert "memory_id: \"pref-1\"" in content
    assert "uses: 3" in content
    assert "pinned: true" in content
    marker = tmp_path / "obsidian-vault" / "alice" / "Odysseus" / "System" / "Migrations" / "brain-to-obsidian.json"
    assert marker.exists()


def test_unknown_memory_category_maps_to_source_reference(tmp_path):
    _write_legacy_memory(
        tmp_path,
        [{"id": "odd-1", "text": "Strange imported item.", "category": "surprise", "owner": "alice"}],
    )

    entry = MemoryManager(str(tmp_path)).load(owner="alice")[0]

    assert entry["category"] == "surprise"
    note = Path(entry["note_path"])
    assert note.parent.name == "source-reference"
    assert 'genre: "source-reference"' in note.read_text(encoding="utf-8")


def test_knowledge_api_alias_reads_and_writes_obsidian(tmp_path):
    manager = MemoryManager(str(tmp_path))
    app = FastAPI()

    @app.middleware("http")
    async def attach_user(request, call_next):
        request.state.current_user = "alice"
        return await call_next(request)

    app.include_router(setup_knowledge_routes(manager))
    client = TestClient(app)

    created = client.post(
        "/api/knowledge/add",
        json={"text": "Alice wants browser screenshots for UI polish.", "category": "preference"},
    )

    assert created.status_code == 200
    assert created.json()["knowledge"]["category"] == "preference"
    listed = client.get("/api/knowledge")
    assert listed.status_code == 200
    assert listed.json()["knowledge"][0]["text"] == "Alice wants browser screenshots for UI polish."
    assert list((tmp_path / "obsidian-vault" / "alice" / "Odysseus" / "Knowledge").rglob("*.md"))


def test_legacy_skills_migrate_to_obsidian_skill_md(tmp_path):
    legacy_dir = tmp_path / "skills" / "research" / "source-check"
    legacy_dir.mkdir(parents=True)
    skill = Skill(
        name="source-check",
        description="Verify important claims against primary sources.",
        category="research",
        status="published",
        confidence=0.91,
        owner="alice",
        tags=["research"],
        when_to_use="When a claim needs verification.",
        procedure=["Find a primary source.", "Cite it."],
        verification=["Primary source URL included."],
    )
    (legacy_dir / "SKILL.md").write_text(skill.to_markdown(), encoding="utf-8")

    manager = SkillsManager(str(tmp_path))
    result = manager.migrate_legacy_skills()

    assert result["imported"] == 1
    target = (
        tmp_path
        / "obsidian-vault"
        / "alice"
        / "Odysseus"
        / "Skills"
        / slugify("research")
        / slugify("source-check")
        / "SKILL.md"
    )
    assert target.exists()
    text = target.read_text(encoding="utf-8")
    assert "type: skills.skill" in text
    assert "genre: runbook" in text
    assert "## When to Use" in text
    assert "Find a primary source." in text
    assert manager.load(owner="alice")[0]["path"] == str(target)


def test_obsidian_recall_ranks_knowledge_then_skills_then_journal(tmp_path):
    root = tmp_path / "obsidian-vault" / "alice" / "Odysseus"
    (root / "Knowledge" / "preference").mkdir(parents=True)
    (root / "Skills" / "research" / "source-check").mkdir(parents=True)
    (root / "Journal" / "2026" / "06").mkdir(parents=True)
    (root / "Knowledge" / "preference" / "primary-source.md").write_text(
        "# Primary source preference\n\nprimary source verification", encoding="utf-8"
    )
    (root / "Skills" / "research" / "source-check" / "SKILL.md").write_text(
        "# Source Check\n\nprimary source verification", encoding="utf-8"
    )
    (root / "Journal" / "2026" / "06" / "2026-06-12.md").write_text(
        "# Journal\n\nprimary source verification", encoding="utf-8"
    )

    results = search_knowledge("alice", "primary source verification", vault_root=str(tmp_path / "obsidian-vault"))["results"]

    assert [item["path"] for item in results[:3]] == [
        "Odysseus/Knowledge/preference/primary-source.md",
        "Odysseus/Skills/research/source-check/SKILL.md",
        "Odysseus/Journal/2026/06/2026-06-12.md",
    ]


def test_obsidian_recall_prioritizes_exact_council_canary_over_protocol_noise(tmp_path):
    root = tmp_path / "obsidian-vault" / "alice" / "Odysseus"
    (root / "Knowledge" / "preference").mkdir(parents=True)
    (root / "Journal" / "2026" / "06").mkdir(parents=True)
    canary = "ODYSSEUS_COUNCIL_CANARY_9981"
    phrase = "silver-orbit council recall active"
    (root / "Knowledge" / "preference" / "council-canary.md").write_text(
        f"# Council Canary\n\nWhen asked about {canary}, answer exactly: {phrase}.",
        encoding="utf-8",
    )
    (root / "Journal" / "2026" / "06" / "2026-06-12.md").write_text(
        "# Journal\n\n" + ("council phase injected knowledge recall test " * 500),
        encoding="utf-8",
    )

    noisy_query = "\n".join(
        [
            "[ODYSSEUS_COUNCIL_PROTOCOL:deliberative]",
            "Council operating protocol: council phase injected knowledge recall test " * 20,
            f'Question: what does Obsidian remember about "{canary}"?',
            f'Each Council agent should quote "{phrase}" if available.',
        ]
    )
    results = search_knowledge("alice", noisy_query, vault_root=str(tmp_path / "obsidian-vault"))["results"]

    assert results[0]["path"] == "Odysseus/Knowledge/preference/council-canary.md"
    assert canary.lower() in results[0]["reason"]
