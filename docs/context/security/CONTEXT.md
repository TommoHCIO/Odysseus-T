# Security Context

This context names users, ownership, permissions, secrets, and deployment safety.

## Language

**User**:
A person or login identity using Odysseus.
_Avoid_: Account, owner when login identity matters

**Owner**:
The data-boundary identity for a record, file, integration, or workflow state.
_Avoid_: Account, user when data ownership matters

**Admin**:
A user who can use dangerous or deployment-wide controls.
_Avoid_: Owner, operator, admin account

**Privilege**:
A user-level permission for a feature or action. Use Capability for AI/tool action gates.
_Avoid_: Role, AI capability

**Scope**:
A limit on what an API token, tool, or integration may access.
_Avoid_: Privilege

**Secret**:
A value that must be protected, such as an API key, token, password, cookie, or session material.
_Avoid_: Setting

**Secret Storage**:
The protected storage used for secrets.
_Avoid_: Plain settings

**Redaction**:
Removing or hiding secrets before showing, logging, exporting, or saving text.
_Avoid_: Deletion

**API Token**:
A secret credential for outside callers to use approved Odysseus APIs.
_Avoid_: Session token, password

**Session Token**:
A secret credential that keeps a logged-in user session active.
_Avoid_: API token

**Localhost Bypass**:
A development-only auth bypass for loopback requests.
_Avoid_: Trusted mode

**Private Deployment**:
An Odysseus deployment available only through localhost, trusted LAN, VPN, reverse proxy, or private access layer.
_Avoid_: Public deployment
