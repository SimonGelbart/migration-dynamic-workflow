# Workspace readiness

Step ID: `00-workspace-readiness`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Implemented; see [verification](../verification.md) for executed checks.

**Purpose**

Establish configuration, checkout availability and initial resource state without claiming any migration behavior is complete.

**Inputs**

A workspace JSON file with schemaVersion 1, four distinct Git checkout roots and resourcesRoot; a valid resource ID; Node and Git.

**Procedure**

Validate arguments and configuration. Resolve paths against the config file and canonicalize existing ancestors. Inspect each real checkout, including worktrees and dirty sources. Read the resource record if present, compare its initialization fingerprint and summarize each stage as complete, stale or blocked, with open decisions. The separate initialize operation first performs these checks, then creates one complete schemaVersion 2 record only if absent. A schemaVersion 1 record is reported as needs-upgrade; the explicit upgrade operation preserves it as resource.v1.json before writing schemaVersion 2.

**Outputs**

A structured inspection result, or an explicitly initialized resources/<id>/resource.json. Inspection creates neither files nor directories.

**Completion**

Inspection returns all available repository snapshots and explicit issues. Initialization is idempotent, preserves existing records and cannot write inside the application checkouts. Blocked or invalid state is never promoted, and migrationComplete is always false.

**Decisions**

Request missing paths or capabilities only when they are needed. Never infer real project commands or LDAP connection details from the examples.

**Recovery**

Rerun inspection freely. Repeated initialization preserves a valid record. Corrupt, unsupported or redirected records block progress. A fingerprint change is reported without resetting user work. Live reads are not cached across invocations.

**Next**

[Legacy discovery](01-legacy-discovery.md), through the `discover` operation.
