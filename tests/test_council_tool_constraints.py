import pytest

from src.agent_tools import ToolBlock
from src.tool_execution import execute_tool_block


@pytest.mark.asyncio
async def test_council_build_write_file_allows_build_dir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    build_dir = "data/council-builds/resilience-mesh-test"
    block = ToolBlock("write_file", f"{build_dir}/README.md\nok")

    desc, result = await execute_tool_block(
        block,
        owner=None,
        tool_constraints={"council_build_dir": build_dir},
    )

    assert desc.startswith("write_file:")
    assert result["exit_code"] == 0
    assert (tmp_path / build_dir / "README.md").read_text(encoding="utf-8") == "ok"


@pytest.mark.asyncio
async def test_council_build_write_file_blocks_outside_dir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    block = ToolBlock("write_file", "resilience-mesh.html\nbad")

    desc, result = await execute_tool_block(
        block,
        owner=None,
        tool_constraints={"council_build_dir": "data/council-builds/resilience-mesh-test"},
    )

    assert desc == "write_file: BLOCKED"
    assert result["exit_code"] == 1
    assert "only allows write_file inside data/council-builds/resilience-mesh-test" in result["error"]
    assert not (tmp_path / "resilience-mesh.html").exists()


@pytest.mark.asyncio
async def test_council_build_bash_blocks_tmp_and_repo_root_drift(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    build_dir = "data/council-builds/resilience-mesh-test"

    desc, result = await execute_tool_block(
        ToolBlock("bash", "cat > /tmp/resilience-mesh.html"),
        owner=None,
        tool_constraints={"council_build_dir": build_dir},
    )

    assert desc == "bash: BLOCKED"
    assert result["exit_code"] == 1
    assert "Council build scope blocked" in result["error"]

    desc, result = await execute_tool_block(
        ToolBlock("bash", "echo ok > resilience-mesh.html"),
        owner=None,
        tool_constraints={"council_build_dir": build_dir},
    )

    assert desc == "bash: BLOCKED"
    assert result["exit_code"] == 1
    assert not (tmp_path / "resilience-mesh.html").exists()


@pytest.mark.asyncio
async def test_council_build_bash_blocks_long_running_preview_commands(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    build_dir = "data/council-builds/ready-app"

    for command in [
        f"cd {build_dir} && npm install",
        f"cd {build_dir} && npm run dev",
        f"cd {build_dir} && docker compose up",
    ]:
        desc, result = await execute_tool_block(
            ToolBlock("bash", command),
            owner=None,
            tool_constraints={"council_build_dir": build_dir},
        )

        assert desc == "bash: BLOCKED"
        assert result["exit_code"] == 1
        assert "Council build scope blocked" in result["error"]
