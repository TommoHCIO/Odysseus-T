# Operations Context

This context names runtime status, checks, logs, queues, and failures.

## Language

**Diagnostics**:
Current details that help explain why a feature works, is blocked, partly works, or failed.
_Avoid_: Logs, settings

**Diagnostic Panel**:
A UI place that shows what is working, blocked, partly working, or failed.
_Avoid_: Settings

**Health Check**:
A liveness check that says whether a service, bridge, provider, or dependency can be reached.
_Avoid_: Setup check, diagnostics

**Setup Check**:
A readiness check that says whether a user workflow is ready to use.
_Avoid_: Health check

**Log**:
A time-ordered record from Odysseus, a bridge, a service, a provider check, or a background job.
_Avoid_: Audit record, diagnostics

**Audit Record**:
A saved record of a sensitive or important action. AI actions, integration actions, privileged actions, and writes to outside systems or saved user data should create one.
_Avoid_: Log

**Queue**:
A backlog of work waiting to be processed later.
_Avoid_: Task, log

**Background Work**:
Work done after or away from the immediate user request, such as syncing, retries, extraction, downloads, or scheduled work.
_Avoid_: User action, foreground workflow

**Dead Letter**:
Queued work or provider data that could not be processed and needs review, retry, or discard.
_Avoid_: Failure, log entry

**Degraded State**:
A state where a feature partly works but is missing something it needs.
_Avoid_: Failure, disabled

**Blocked State**:
A state where a feature cannot continue until the user or operator fixes something.
_Avoid_: Degraded state

**Retry**:
Trying failed work again.
_Avoid_: Replay when reprocessing saved provider data

**Replay**:
Processing a saved event or dead letter again.
_Avoid_: Retry for ordinary request failure
