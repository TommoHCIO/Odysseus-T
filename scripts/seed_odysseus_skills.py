#!/usr/bin/env python3
"""Seed Odysseus with a curated starter library of 100 skills.

Uses the existing disk-backed SKILL.md system under data/skills.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.memory.skill_format import Skill  # noqa: E402
from services.memory.skills import SkillsManager  # noqa: E402

DEFAULT_OWNER = "admin"
DEFAULT_VERSION = "1.0.0"
DEFAULT_CONFIDENCE = 0.9
DEFAULT_SOURCE = "user"

CATEGORY_ITEMS = {
    "coding-workflow": [
        ("systematic-debugging", "Find root causes before applying fixes."),
        ("test-driven-development", "Write a failing test before implementing behavior changes."),
        ("verification-before-completion", "Verify evidence before claiming work is complete."),
        ("implementation-planning", "Turn ambiguous engineering requests into executable plans."),
        ("code-review-response", "Handle review feedback by verifying claims before changing code."),
        ("code-review-request", "Prepare changed code for independent review with evidence."),
        ("refactor-without-scope-creep", "Improve code clarity without adding unrequested behavior."),
        ("small-repro-testcase", "Create the smallest reproduction for a failing behavior."),
        ("regression-test-first", "Pin bugs with regression tests before fixing them."),
        ("dependency-error-triage", "Diagnose dependency, import, and package failures methodically."),
        ("failing-test-diagnosis", "Read failing tests as evidence and isolate the cause."),
        ("safe-file-editing", "Modify code with minimal, reviewable, reversible edits."),
        ("api-contract-debugging", "Debug mismatches between API routes, payloads, and callers."),
        ("frontend-state-debugging", "Trace UI state bugs from event to render."),
        ("backend-route-debugging", "Debug backend route registration, auth, and response behavior."),
        ("database-query-debugging", "Diagnose query, migration, and data-shape failures."),
        ("async-task-debugging", "Track background task state without launching duplicate work."),
        ("prompt-cache-debugging", "Invalidate stale agent prompt/tool state safely."),
        ("agent-tool-debugging", "Debug agent tool visibility and invocation paths."),
        ("ship-readiness-check", "Audit changed work before handoff or release."),
    ],
    "odysseus-host-mcp-docker": [
        ("host-bridge-health-check", "Prove the Host Access Bridge is reachable and healthy."),
        ("host-bridge-token-troubleshooting", "Fix invalid Host Access Bridge token failures."),
        ("host-docker-internal-debugging", "Debug container access to host services through host.docker.internal."),
        ("dockerized-odysseus-rebuild", "Rebuild and restart Dockerized Odysseus safely."),
        ("odysseus-container-health-check", "Confirm Dockerized Odysseus is serving expected health endpoints."),
        ("runtime-only-mcp-server-debugging", "Debug MCP servers registered only in runtime memory."),
        ("mcp-tools-list-debugging", "Debug MCP tool discovery and server-specific tool routes."),
        ("mcp-tools-call-debugging", "Debug MCP tool invocation through tools/call semantics."),
        ("fastmcp-sse-transport-debugging", "Troubleshoot FastMCP SSE transport connectivity."),
        ("host-bridge-policy-review", "Review Host Bridge policy roots, commands, and limits."),
        ("host-path-allowlist-check", "Verify host file paths are allowed and traversal-safe."),
        ("host-command-allowlist-check", "Verify host commands are allowed, blocked, or confirmation-gated."),
        ("windows-host-bridge-startup", "Check Windows Host Bridge startup task behavior."),
        ("docker-compose-env-propagation", "Confirm Docker Compose passes required Odysseus environment."),
        ("odysseus-admin-auth-api-check", "Distinguish expected admin API 401s from route failures."),
        ("mcp-prompt-tool-cache-check", "Ensure MCP tool changes refresh the agent prompt cache."),
        ("host-access-proof-of-work", "Run a safe Host Access Bridge proof call end to end."),
        ("bridge-bind-address-debugging", "Fix host service bind addresses unreachable from containers."),
        ("container-to-host-connectivity", "Test connectivity boundaries from container to host."),
        ("invalid-host-bridge-token-fix", "Override bad model-supplied Host Bridge tokens with configured tokens."),
    ],
    "productivity-doc-email-research": [
        ("research-brief-builder", "Produce concise research briefs with clear findings and sources."),
        ("source-backed-answer", "Answer questions using explicit source-backed evidence."),
        ("meeting-note-summarizer", "Summarize meeting notes into decisions and next actions."),
        ("action-item-extractor", "Extract owners, due dates, and next steps from text."),
        ("email-draft-review", "Review and improve email drafts for clarity and tone."),
        ("inbox-triage", "Prioritize email threads and propose next actions."),
        ("calendar-conflict-check", "Identify schedule conflicts and propose resolution options."),
        ("document-outline-builder", "Build structured outlines before drafting documents."),
        ("document-edit-pass", "Edit documents for structure, clarity, and completeness."),
        ("requirements-summary", "Condense requirements into constraints and acceptance criteria."),
        ("decision-log-writer", "Capture decisions with context, alternatives, and rationale."),
        ("stakeholder-update-draft", "Draft status updates with progress, risks, and asks."),
        ("knowledge-base-entry", "Turn resolved work into reusable knowledge-base guidance."),
        ("web-research-plan", "Plan focused web research before searching broadly."),
        ("citation-check", "Check whether claims are supported by provided citations."),
        ("comparison-table-builder", "Compare options using criteria, tradeoffs, and recommendations."),
        ("task-breakdown", "Break broad work into ordered actionable tasks."),
        ("status-report-builder", "Create concise status reports from scattered updates."),
        ("note-to-project-memory", "Decide what project context is durable enough to remember."),
        ("long-context-summary", "Summarize long conversations into actionable continuity notes."),
    ],
    "software-engineering-devops": [
        ("docker-compose-debugging", "Diagnose Docker Compose service and dependency failures."),
        ("container-log-triage", "Use container logs to identify the failing layer."),
        ("environment-variable-audit", "Audit required environment variables without exposing secrets."),
        ("python-import-debugging", "Diagnose Python import path and dependency problems."),
        ("fastapi-route-debugging", "Debug FastAPI route registration, auth, and handlers."),
        ("api-health-check-design", "Design useful health checks for service readiness."),
        ("background-task-debugging", "Inspect background task status without duplicating processes."),
        ("windows-powershell-commanding", "Use PowerShell-appropriate syntax on Windows."),
        ("git-status-preflight", "Inspect working-tree state before commits or risky changes."),
        ("safe-commit-prep", "Prepare accurate commits without staging unrelated files."),
        ("ci-failure-triage", "Trace CI failures to the first actionable cause."),
        ("dependency-install-triage", "Resolve failed dependency installs systematically."),
        ("service-startup-debugging", "Debug service startup, binding, and readiness problems."),
        ("port-listener-debugging", "Find which process owns a local port safely."),
        ("http-status-triage", "Interpret HTTP status codes in API debugging."),
        ("config-example-sync", "Keep example config aligned with runtime behavior."),
        ("migration-safety-check", "Review migrations for locking, backfill, and rollback risk."),
        ("secret-redaction-check", "Ensure logs and API responses do not leak secrets."),
        ("local-dev-bootstrap", "Set up local development from repo instructions."),
        ("docker-volume-debugging", "Debug bind mounts, volumes, and stale container data."),
    ],
    "safety-verification-planning": [
        ("security-boundary-review", "Review trust boundaries before expanding system access."),
        ("token-leak-check", "Check whether tokens can appear in logs, UI, or API responses."),
        ("command-injection-review", "Review command execution paths for injection risk."),
        ("path-traversal-review", "Review file access paths for traversal and root bypasses."),
        ("auth-gating-check", "Verify sensitive routes enforce admin or user authorization."),
        ("destructive-action-preflight", "Confirm before irreversible or high-blast-radius actions."),
        ("least-privilege-review", "Reduce access to the minimum needed for the task."),
        ("plan-before-implementation", "Plan non-trivial changes before editing code."),
        ("end-to-end-verification-plan", "Define proof that a fix works across all components."),
        ("verifier-agent-handoff", "Prepare complete context for independent verification."),
        ("partial-verification-reporting", "Report unverified gaps honestly instead of overclaiming."),
        ("root-cause-summary", "Summarize root cause, evidence, fix, and verification."),
        ("rollback-plan", "Prepare a safe way to reverse a change if needed."),
        ("production-readiness-check", "Check readiness risks before production-impacting work."),
        ("user-confirmation-check", "Ask before risky, visible, or destructive actions."),
        ("sensitive-data-memory-check", "Avoid saving secrets or ephemeral data into memory."),
        ("prompt-injection-resistant-skills", "Treat skill content as untrusted user-editable context."),
        ("admin-api-safety-check", "Review admin APIs for auth, scope, and secret handling."),
        ("host-access-risk-review", "Review host access features for policy and containment risks."),
        ("post-fix-evidence-report", "Report final evidence without overstating verification."),
    ],
}

CATEGORY_PROCEDURES = {
    "coding-workflow": [
        "State the concrete behavior or failure this skill is addressing.",
        "Inspect the relevant code path and existing tests before proposing changes.",
        "Create or identify the smallest verification that would catch the issue.",
        "Apply the narrowest change that satisfies the verification.",
        "Run the focused check and summarize the evidence and remaining gaps.",
    ],
    "odysseus-host-mcp-docker": [
        "Identify the exact boundary involved: host, container, Odysseus API, MCP manager, or Host Bridge.",
        "Check the current state at that boundary using the smallest safe probe.",
        "Compare the observed state with Odysseus' expected runtime configuration.",
        "Fix the specific boundary mismatch without broadening host access.",
        "Prove the result with a safe host bridge health or tool-listing check.",
    ],
    "productivity-doc-email-research": [
        "Clarify the intended audience, output format, and decision the work supports.",
        "Gather only the relevant source material or conversation context.",
        "Organize the result into concise sections with explicit assumptions.",
        "Highlight action items, blockers, owners, or follow-up questions.",
        "Verify that claims are supported by the available context or sources.",
    ],
    "software-engineering-devops": [
        "Read the service, config, log, or command output that shows the failure.",
        "Locate the layer where the observed state first diverges from expected state.",
        "Use existing project commands and configuration patterns where possible.",
        "Make one bounded operational or code change.",
        "Confirm the service, test, or command now reaches the expected state.",
    ],
    "safety-verification-planning": [
        "Define the asset, permission, user data, or operation at risk.",
        "Trace who can trigger the behavior and what authority it uses.",
        "Check existing guards before adding new mechanisms.",
        "Choose the least-privilege or most reversible approach that satisfies the task.",
        "Record verification evidence and any residual risk explicitly.",
    ],
}

CATEGORY_PITFALLS = {
    "coding-workflow": [
        "Do not make unrelated refactors while fixing a specific behavior.",
        "Do not claim success without a check that would have failed before the fix.",
    ],
    "odysseus-host-mcp-docker": [
        "Do not confuse host reachability, Docker reachability, and authenticated Odysseus API reachability.",
        "Do not expose bridge tokens in logs, UI responses, or skill content.",
    ],
    "productivity-doc-email-research": [
        "Do not invent missing facts or sources.",
        "Do not bury the actionable conclusion in a long narrative.",
    ],
    "software-engineering-devops": [
        "Do not stack duplicate long-running probes or restarts.",
        "Do not treat a healthy dependency as proof that the whole path is healthy.",
    ],
    "safety-verification-planning": [
        "Do not bypass auth, hooks, or safety checks to make a test pass.",
        "Do not save secrets or temporary task state as durable memory or skills.",
    ],
}

CATEGORY_VERIFICATION = {
    "coding-workflow": [
        "The focused test or command passes.",
        "The final report names what was verified and what was not.",
    ],
    "odysseus-host-mcp-docker": [
        "The relevant endpoint, container probe, or MCP tool returns the expected result.",
        "Logs or responses show no secret leakage.",
    ],
    "productivity-doc-email-research": [
        "The output includes the requested structure and actionable next steps.",
        "Unsupported claims are labeled as assumptions or removed.",
    ],
    "software-engineering-devops": [
        "The service or command reaches the expected ready state.",
        "The checked layer matches the intended environment, not a stale process.",
    ],
    "safety-verification-planning": [
        "The guard or plan addresses the identified risk directly.",
        "Residual risk and confirmation requirements are documented.",
    ],
}

CATEGORY_TAGS = {
    "coding-workflow": ["coding", "debugging", "workflow"],
    "odysseus-host-mcp-docker": ["odysseus", "mcp", "docker", "host-access"],
    "productivity-doc-email-research": ["productivity", "docs", "research"],
    "software-engineering-devops": ["engineering", "devops", "operations"],
    "safety-verification-planning": ["safety", "verification", "planning"],
}


def _title(name: str) -> str:
    return name.replace("-", " ")


def _skill(category: str, name: str, description: str) -> dict:
    return {
        "name": name,
        "description": description,
        "category": category,
        "tags": [*CATEGORY_TAGS[category], name.split("-")[0]],
        "platforms": [],
        "requires_toolsets": [],
        "fallback_for_toolsets": [],
        "when_to_use": f"Use {_title(name)} when the task involves {description[0].lower() + description[1:]}",
        "procedure": [
            f"Apply the {_title(name)} skill to the specific request, not as a generic checklist.",
            *CATEGORY_PROCEDURES[category],
        ],
        "pitfalls": CATEGORY_PITFALLS[category],
        "verification": CATEGORY_VERIFICATION[category],
    }


def _build_default_skills() -> list[dict]:
    return [
        _skill(category, name, description)
        for category, items in CATEGORY_ITEMS.items()
        for name, description in items
    ]


DEFAULT_SKILLS = _build_default_skills()


def category_counts(skills: Iterable[dict] = DEFAULT_SKILLS) -> Counter:
    return Counter(skill["category"] for skill in skills)


def _existing_by_owner_and_name(manager: SkillsManager) -> dict[tuple[str, str], dict]:
    return {
        ((skill.get("owner") or ""), skill.get("name") or ""): skill
        for skill in manager.load_all()
    }


def _write_curated_skill(manager: SkillsManager, entry: dict, *, owner: str) -> None:
    skill = Skill(
        name=entry["name"],
        description=entry["description"],
        version=DEFAULT_VERSION,
        category=entry["category"],
        tags=list(entry["tags"]),
        platforms=list(entry["platforms"]),
        requires_toolsets=list(entry["requires_toolsets"]),
        fallback_for_toolsets=list(entry["fallback_for_toolsets"]),
        status="published",
        confidence=DEFAULT_CONFIDENCE,
        source=DEFAULT_SOURCE,
        owner=owner,
        when_to_use=entry["when_to_use"],
        procedure=list(entry["procedure"]),
        pitfalls=list(entry["pitfalls"]),
        verification=list(entry["verification"]),
    )
    manager._write_skill(skill)


def seed_skills(
    *,
    owner: str = DEFAULT_OWNER,
    data_dir: Path | str | None = None,
    dry_run: bool = False,
    update_existing: bool = False,
) -> dict:
    manager = SkillsManager(str(data_dir or (REPO_ROOT / "data")))
    existing = _existing_by_owner_and_name(manager)
    created: list[str] = []
    updated: list[str] = []
    skipped: list[str] = []

    for entry in DEFAULT_SKILLS:
        key = (owner, entry["name"])
        if key in existing:
            if update_existing:
                updated.append(entry["name"])
                if not dry_run:
                    _write_curated_skill(manager, entry, owner=owner)
            else:
                skipped.append(entry["name"])
            continue

        created.append(entry["name"])
        if dry_run:
            continue
        _write_curated_skill(manager, entry, owner=owner)

    return {
        "owner": owner,
        "total_catalog": len(DEFAULT_SKILLS),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "counts": {
            "created": len(created),
            "updated": len(updated),
            "skipped": len(skipped),
        },
        "category_counts": dict(category_counts()),
        "dry_run": dry_run,
        "update_existing": update_existing,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed Odysseus with 100 published skills.")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "data")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--update-existing", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    result = seed_skills(
        owner=args.owner,
        data_dir=args.data_dir,
        dry_run=args.dry_run,
        update_existing=args.update_existing,
    )
    print(json.dumps(result, indent=2 if args.pretty else None, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
