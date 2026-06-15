# Outputs Context

This context names things produced by Odysseus, agents, models, or workflows.

## Language

**Output**:
Any result produced by Odysseus, an agent, a tool, a model, or a workflow.
_Avoid_: Artifact for every result

**Artifact**:
A made result from an agent, Council run, research workflow, or tool run that may be previewed, checked, or saved.
_Avoid_: Document by default

**Preview**:
A rendered view of an output, media item, document, app, or file. Preview does not mean accepted or changed.
_Avoid_: Edit, acceptance

**Validation Evidence**:
Proof that an output was checked, such as tests, screenshots, logs, or notes from running it.
_Avoid_: Summary, confidence

**Accepted Artifact**:
A made result with enough proof that it was checked for its type.
_Avoid_: Generated artifact, unverified output

**Blocked Artifact**:
A made result that cannot be accepted because a check failed or proof is missing.
_Avoid_: Accepted artifact

**Local Preview**:
A preview served from the user's own machine.
_Avoid_: Deployed app

**Sandbox Preview**:
A limited preview area for inspecting an output safely.
_Avoid_: Native runtime
