from pathlib import Path
import re


REPO = Path(__file__).resolve().parent.parent
GROUP_JS = REPO / "static" / "js" / "group.js"
WORKSPACE_JS = REPO / "static" / "js" / "workspace.js"


def _group_source() -> str:
    return GROUP_JS.read_text(encoding="utf-8")


def _workspace_source() -> str:
    return WORKSPACE_JS.read_text(encoding="utf-8")


def test_council_artifact_quality_gate_constants_and_hard_failures():
    src = _group_source()

    assert "const COUNCIL_ARTIFACT_QA_MIN_SCORE = 85;" in src
    assert "const COUNCIL_ARTIFACT_QA_MAX_REVISIONS = 2;" in src
    assert "function _evaluateCouncilArtifactQuality" in src
    assert "passed: score >= COUNCIL_ARTIFACT_QA_MIN_SCORE && failures.length === 0" in src

    for generic_signature in [
        "Council Collaboration Review Build",
        "Full-Stack Product Review Build",
        "Project Review Build",
        "Local final product fallback",
        "New local record",
    ]:
        assert generic_signature in src


def test_council_artifact_quality_requires_interaction_and_final_evidence():
    src = _group_source()

    assert "meaningfulControlCount >= 2 && hasScript && hasEventHandling" in src
    assert "semanticSectionCount + classSectionCount" in src
    assert "Final response needs an exact local validation command and result." in src
    assert "Final response must mention the Council build directory" in src
    assert "package-only localhost preview evidence" in src
    assert "No HTML sandbox artifact was provided" in src
    assert "packageReviewOnly" in src
    assert "First build action: create" in src
    assert "Forbidden build outputs: /tmp" in src
    assert "Council build tool path" in src
    assert "starts in the Odysseus workspace root" in src
    assert "data/council-builds/${slug}" in src
    assert "readmePath" in src
    assert "relative paths like resilience-mesh.html" in src
    assert "README.md" in src
    assert "package.json" in src
    assert "node --check" in src


def test_council_artifact_quality_rejects_outside_build_tool_evidence():
    src = _group_source()

    assert "function _councilToolEvidenceText" in src
    assert "function _councilQaCandidateText" in src
    assert "Council tool evidence:" in src
    assert "forbiddenBuildPathPattern" in src
    assert "forbiddenToolEvidencePattern" in src
    assert "Final build evidence includes forbidden outside-directory writes or repository-root Docker commands." in src
    assert "docker-compose\\s+up" in src
    assert "C:\\\\Users" in src
    assert "/app/data" in src
    assert "buildPathSafety" in src


def test_council_synthesis_streaming_uses_lightweight_render_guard():
    src = _group_source()

    assert "const deferLiveRender = Boolean" in src
    assert "council-deferred-stream-status" in src
    assert "full ${accumulated.length.toLocaleString()} characters retained for QA and Idea Loop artifact storage" in src


def test_council_stage_artifact_no_longer_injects_fallback_html():
    src = _group_source()
    match = re.search(
        r"function _ensureStageArtifact\(response, stage, task = ''\) \{(?P<body>[\s\S]*?)\n\}",
        src,
    )
    assert match, "_ensureStageArtifact not found"
    body = match.group("body")

    assert "_fallbackProjectArtifact" not in body
    assert "```html" not in body
    assert "return _evaluateCouncilArtifactQuality(response, stage, task, buildPaths).passed ? response : '';" in body


def test_council_artifact_qa_revision_loop_and_blocked_publish_shape():
    src = _group_source()

    assert "while (!qaResult.passed && attempts < COUNCIL_ARTIFACT_QA_MAX_REVISIONS)" in src
    assert "Council artifact QA blocked" in src
    assert "tags: blocked ? [...new Set([...config.tags, 'qa-blocked'])] : config.tags" in src
    assert "qa_result: qaResult ? _qaResultForStorage(qaResult, qaAttempts) : undefined" in src
    assert "No sandbox preview was published" in src
    assert "_startWorkspaceLocalPreview(config.kind, item.id)" in src


def test_consensus_blocker_parser_accepts_none_with_explanation():
    src = _group_source()

    assert "function _isNoConsensusBlockerLine" in src
    assert "const hasNamedBlockers = Boolean(blockersLine && !_isNoConsensusBlockerLine(blockersLine));" in src
    assert "blockers: blockersLine && !_isNoConsensusBlockerLine(blockersLine) ? blockersLine : ''" in src


def test_workspace_renders_qa_blocked_cards_without_preview_iframe():
    src = _workspace_source()

    assert "function _renderQaBlocked" in src
    assert "function _renderLivePreview" in src
    assert "function _renderPackageReview" in src
    assert "Start localhost preview" in src
    assert "Live localhost preview" in src
    assert "const qaBlocked = Boolean" in src
    assert "const htmlArtifact = kind === 'requests' || qaBlocked || livePreview ? '' : _extractHtmlArtifact(fullBody, kind);" in src
    assert "QA blocked" in src
