# Unified Workspace, Obsidian Brain, Voice, Model Council, and Idea Loop Design

## Summary

Design Odysseus as one unified workspace that orchestrates existing features instead of replacing them with disconnected new modules. The core user-facing additions are:

- **Obsidian**: a dedicated rail-launched native Odysseus window that becomes the knowledge + Brain control center.
- **Idea Loop**: a dedicated rail-launched native Odysseus window for human-in-the-loop idea, project, execution, and verification workflows.
- **Model Council**: durable multi-model orchestration built from current Group Chat and Compare capabilities.
- **Voice / TTS / Wake activation**: hybrid browser-first speech input/output, concise spoken summaries, and optional Jarvis-style wake-word mode.

The central product rule is: a user request should move visibly from request to context, ideas, sketch, council review, approved execution, verification, and ready-for-review state.

## Goals

- Make Odysseus feel like one connected workspace.
- Include and orchestrate existing Odysseus features: Chat, Agent mode, Memory/Brain, Notes, Documents, Library, Research, RAG, Group Chat, Compare, Skills, Gallery, Cookbook, MCP Marketplace, host bridge/tool execution, settings, and validation surfaces.
- Give Obsidian a first-class rail window and fold Brain/memory controls into it.
- Give Idea Loop a first-class rail window for human-in-the-loop work.
- Let Model Council find bugs, propose missing features, critique plans, and improve task outputs before execution or promotion.
- Support knowledge tasks and full software/project creation tasks.
- Treat a request as finalized only when the output is proved working and ready for user review.

## Non-goals for the first implementation cycle

- Full Obsidian plugin compatibility.
- Obsidian Canvas or Dataview support.
- Fully autonomous destructive host operations.
- Replacing every existing Odysseus surface at once.
- Always-on wake-word mode enabled by default.

## Product architecture

Add a durable workspace layer over existing Odysseus features.

Core lifecycle:

```text
request -> context -> ideas -> sketch -> council review -> approved execution -> verification -> ready for review
```

Existing features plug into the lifecycle:

- **Chat / Agent**: request capture, streaming, tool execution, history.
- **Obsidian / Brain**: vault-backed knowledge, memory curation, semantic recall, used context visibility.
- **Documents / Library**: durable artifacts, specs, exports, final deliverables.
- **Research / RAG**: grounding sources and evidence.
- **Group Chat / Compare**: Model Council modes.
- **Skills / Recipes**: repeatable brainstorm, critique, refine, build, verify workflows.
- **Host Bridge / Tools**: local execution for apps, servers, tests, browser checks.
- **Voice / TTS**: hands-free request, review, and status loops.
- **Gallery / Cookbook / MCP Marketplace**: visual assets, model/server setup, and capability supply.

The main backend primitive should be a durable workspace item that references related sessions, council runs, idea cards, sketches, vault notes, documents, commands, logs, verification evidence, and final artifacts.

## UI and UX

### Rail placement

Odysseus should have first-class rail entries for:

```text
Left rail
├─ Chat
├─ Obsidian
├─ Idea Loop
├─ Compare / Model Council
├─ Research
├─ Library
├─ Cookbook
├─ MCP Marketplace
└─ Settings
```

### Obsidian window

Obsidian should open as a native Odysseus feature window, matching current design language from Cookbook, Email, Calendar, and other feature surfaces.

It should include:

- Vault browser/editor.
- Search and graph/backlink navigation.
- Brain memory controls.
- Used-context view.
- Vault indexing status.
- Note-to-memory promotion.
- Links to Idea Loop, council runs, documents, research, and chat sessions.

### Idea Loop window

Idea Loop should open as a native Odysseus feature window/control panel, not a foreign custom popup.

It should include:

- **Top bar**: title, active workspace item, status, close/minimize/dock controls.
- **Board column**: Ideas, Sketches, Council Review, Execution, Ready for Review.
- **Detail pane**: selected item content, lineage, sources, model outputs, user edits.
- **Action bar**: send to one model, run council, edit, delete, move, promote, execute, verify.
- **Log/evidence area**: commands, generated files, server URL, browser/test validation, final review state.

Cross-links:

- Chat: “Send to Idea Loop”.
- Model Council: “Save as idea” / “Attach council review”.
- Obsidian: “Create idea from note”.
- Documents/Library: “Turn into work item”.
- Tool/host bridge logs: link back to active Idea Loop item.

Design rule: every major addition must be visible in the UI, not hidden in settings or backend-only routes.

## Core data model

### WorkspaceItem

Represents one user request or project.

Suggested fields:

- `id`
- `owner`
- `title`
- `original_request`
- `type`: `idea`, `app`, `research`, `document`, `task`, `automation`, etc.
- `status`: `captured`, `ideas`, `sketch`, `council_review`, `approved`, `executing`, `verifying`, `ready_for_review`, `archived`
- `created_at`
- `updated_at`
- links to chat sessions, vault notes, documents, research tasks, tool runs, final artifacts

### IdeaCard

A generated or user-created idea inside a workspace item.

Suggested fields:

- `workspace_item_id`
- `title`
- `summary`
- `content`
- `tags`
- `source_context`
- `score`
- `votes`
- `status`
- `position`
- lineage to model/council run

Supports edit, delete, move, merge, split, and promotion.

### Sketch

A concrete expansion of an idea.

Suggested fields:

- `workspace_item_id`
- `idea_card_id`
- `model_refs`
- `requirements`
- `feature_list`
- `architecture`
- `risks`
- `dependencies`
- `validation_plan`
- user edits / review status

### CouncilRun

A durable multi-model operation.

Suggested fields:

- `workspace_item_id`
- `mode`: `parallel`, `roundtable`, `compare`, `critique`, `synthesis`, `arena`
- `participants`: endpoint/model/persona records
- `prompt`
- `inputs`
- `outputs`
- `metrics`
- `votes`
- `errors`
- `stop_reasons`
- `synthesis_result`

Participant identity should be `(endpoint_id, model, persona)` so the same model on different endpoints remains distinct.

### ExecutionRun

Approved host-bridge/tool work.

Suggested fields:

- `workspace_item_id`
- `approved_by`
- `approval_scope`
- `commands_or_actions`
- `files_changed`
- `logs`
- `generated_artifacts`
- `server_process_info`
- `validation_results`
- `risk_gate_events`

### VerificationEvidence

Proof that the final request works.

Suggested fields:

- `workspace_item_id`
- `execution_run_id`
- `tests_run`
- `browser_checks`
- `server_url`
- `screenshots_or_logs`
- `status`
- `human_review_state`

### BrainVaultLink

Connects Obsidian vault records to memory/context and workspace items.

Suggested fields:

- `owner`
- `vault_path`
- `note_path`
- `frontmatter`
- `aliases`
- `tags`
- `wikilinks`
- `backlinks`
- `headings`
- `task_refs`
- `embedding/index state`
- related memory ids
- related workspace item ids

## Obsidian as the Brain surface

Obsidian should be the dedicated user-facing knowledge + Brain window.

It replaces the separate Brain UI concept while preserving Brain functionality internally.

### Obsidian responsibilities

- Vault browser/editor for Markdown notes.
- YAML frontmatter, tags, aliases, wikilinks, backlinks, task lists.
- Search and graph-style navigation.
- Vault indexing into RAG/search.
- Artifact storage for specs, ideas, sketches, research summaries, and project docs.

### Brain functionality surfaced inside Obsidian

- Curated memories.
- Pending auto-extractions.
- Semantic recall status.
- Used-context history.
- Promote note snippet to memory.
- Link memory to vault note.
- User facts/preferences/goals/project context.
- Memory curation and audit.

### Boundary

Brain can remain the internal memory/recall engine, but the primary user-facing knowledge center is Obsidian.

Vault notes should not be blindly converted into personal memory. Promotion into personal memory should be explicit, user-reviewed, or audited.

## Model Council

Model Council should unify and extend the existing Group Chat and Compare features.

Modes:

- **Parallel council**: multiple models/personas answer the same prompt at once.
- **Roundtable**: models speak turn-by-turn and can see prior replies.
- **Compare**: side-by-side responses with metrics, voting, and optional blind mode.
- **Critique + synthesis**: models critique an idea/sketch/plan; synthesizer merges findings.
- **Arena / voting**: user or council ranks outputs; scores attach to workspace item.

Model Council should be usable from:

- Chat.
- Idea Loop.
- Obsidian note actions.
- Documents/Library.
- Compare surface.

From Idea Loop, primary actions are:

- Send to one model.
- Run council.
- Critique sketch.
- Find bugs/features.
- Synthesize concrete plan.

Durable state must live on the backend, not only localStorage.

## Idea Loop

Idea Loop is the human-in-the-loop execution surface where the council shines.

Lifecycle:

1. User asks a task.
2. One model or council creates ideas.
3. Ideas save into the Idea Loop window.
4. User deletes, edits, moves, merges, splits, or selects ideas.
5. User sends an idea to one or many models to make it concrete.
6. The resulting sketch is logged and saved.
7. User reviews or modifies the sketch.
8. User sends the approved sketch to council for bug/feature/risk critique and concrete refinement.
9. User approves execution.
10. Odysseus executes through existing tools/host bridge.
11. Verification evidence proves the result works.
12. Final artifact is marked ready for review.

Idea Loop must support full software/project creation, not only Markdown or Obsidian artifacts.

Examples of supported outputs:

- Obsidian notes.
- Documents/specs/plans.
- Research artifacts.
- Task lists.
- Full-stack applications.
- Mobile application projects.
- APIs/databases/tests.
- Local repos or worktrees.
- Startable localhost apps.

## Execution and verification

Idea Loop must close the loop from request to proved-working result.

For software tasks, finalization requires proof that the artifact can be started and reviewed.

Example request:

> Create an app that monitors real-time gas prices.

Required final state:

- Repo/files created.
- Server starts.
- Localhost webpage works.
- Data source behavior is visible and explained.
- Browser interaction verified.
- Logs/evidence attached to the Idea Loop item.
- User can open and review the running app.

For knowledge tasks, finalization requires:

- Artifact saved.
- Linked to source context.
- Searchable/reviewable from the relevant window.
- Attached to the workspace item.

“Done” means ready for user review, not merely planned.

## Voice, TTS, and wake activation

Voice should be part of the unified workspace.

### Voice input

Default behavior:

- Hybrid browser-first.
- Record -> transcribe -> insert into composer.
- User reviews transcript before sending.
- Commands can target Chat, Idea Loop, Obsidian, or Model Council.

### TTS output

TTS should avoid long useless audio.

Default behavior:

- Speak only the important parts.
- Use concise spoken summary/key-points mode.
- Read full message only on explicit request.

Prioritize:

- Final decision.
- Key bugs found.
- Missing features.
- Next action.
- Verification result.

Suggested buttons:

- Read summary.
- Read full message.
- Stop.
- Read council summary.
- Read validation result.
- Read next action.

### Wake activation

Add optional Jarvis/Iron-Man-style voice activation.

Requirements:

- Off by default.
- Configurable wake phrase, such as “Odysseus” or “Hey Odysseus”.
- Visible listening indicator.
- Push-to-talk fallback.
- Local/browser wake detection preferred where possible.
- Clear privacy and permission controls.
- Wake-event logging.
- Concise spoken confirmations.

Example:

```text
User: “Hey Odysseus, send this gas price app sketch to council.”
Odysseus wakes -> transcribes -> confirms target/action -> runs council -> speaks summary:
“Council found two data-source risks and one missing feature. I saved the review in Idea Loop.”
```

## Safety and error handling

### Safety gates

Risky host-bridge actions require explicit approval:

- Deleting files.
- Installing/removing dependencies.
- Force operations.
- External publishing.
- Destructive database actions.
- Shared infrastructure changes.

Routine local reversible steps can run inside an approved execution plan and log to Idea Loop.

### Failure handling

Council/model failure:

- Show failed participant.
- Keep successful outputs.
- Allow rerun failed model only.

Voice failure:

- Fallback from wake mode to push-to-talk.
- Fallback from STT to audio attachment.
- Fallback from TTS summary to text summary.

Obsidian sync failure:

- Show file/path conflict.
- Never silently overwrite vault files.
- Offer keep vault, keep Odysseus, or manual merge.

Execution failure:

- Keep logs attached to workspace item.
- Return to sketch/council review for fixes.
- Do not mark ready until verified.

## Testing and validation

Unit/API tests:

- Workspace item state transitions.
- IdeaCard CRUD and ordering.
- Sketch creation/revision.
- CouncilRun persistence and participant identity.
- ExecutionRun logging.
- VerificationEvidence final-state rules.
- Obsidian parser: frontmatter, wikilinks, backlinks, task lists.
- Voice settings and STT/TTS provider fallback.
- Summary-only TTS behavior.

Browser/UI tests:

- Obsidian rail window opens and matches native window patterns.
- Idea Loop rail window opens and matches native window patterns.
- Chat “Send to Idea Loop”.
- Council run from Idea Loop.
- Obsidian note to Idea Loop.
- Execution evidence shown in Idea Loop.
- Audio & Voice settings visible.
- Wake activation controls off by default.

End-to-end validation:

- Create an Idea Loop app request.
- Generate ideas.
- Create a sketch.
- Run council critique.
- Approve execution.
- Build a small local app.
- Start localhost server.
- Verify browser interaction.
- Mark ready for review only after evidence exists.

## Open implementation notes

- Inspect current Cookbook, Email, Calendar, Notes, Library, and modal/window implementations before final UI implementation.
- Reuse existing Group Chat and Compare logic where possible, but move durable council state to backend records.
- Reuse existing MemoryManager/vector store internally, but surface user controls through Obsidian.
- Reuse existing TTS/STT service modules, but expose missing settings UI and fix provider/status refresh gaps during implementation.
- Reuse existing host bridge/tool execution paths, but attach outputs to ExecutionRun and VerificationEvidence.
