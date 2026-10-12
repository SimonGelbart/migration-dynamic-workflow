# Mission and access

Step ID: `00-mission-and-access`. See [the workflow canvas](../workflow.md) for shared rules and [the workflow design](../design.md#0-complete-workflow-at-a-glance) (S00, W01–W08) for the flow.

**Status**

Implemented for workspace readiness: configuration, checkouts, existing edits and the resource record (W02, W03, W07 for source access), through the `inspect`, `initialize` and `upgrade` operations and the Workspace readiness phase; see [verification](../verification.md) for executed checks. Planned: the mission inputs and scope (W01, W04), development LDAP configuration and read access through the read-only LDAP wrapper (W05, W06), and routing existing progress to impact assessment (W08).

**Purpose**

Establish the mission (scope, authorized actions, completion criteria), configuration, checkout availability, development LDAP read access and initial resource state without claiming any migration behavior is complete.

**Inputs**

A workspace JSON file with schemaVersion 1, four distinct Git checkout roots and resourcesRoot; a valid resource ID; Node and Git. Planned: the resource brief, entry pages and requested changes; the development LDAP configuration and a credential reference (never the credential itself).

**Procedure**

Validate arguments and configuration. Planned before the existing checks: record the resource brief, entry pages, requested changes, authorized actions and completion criteria; read the development LDAP configuration and confirm the endpoint, permitted search scope and read access through the read-only wrapper, which only searches. Resolve paths against the config file and canonicalize existing ancestors. Inspect each real checkout, including worktrees and dirty sources. Read the resource record if present, compare its initialization fingerprint and summarize each stage as complete, stale or blocked, with open decisions. The separate initialize operation first performs these checks, then creates one complete schemaVersion 2 record only if absent. A schemaVersion 1 record is reported as needs-upgrade; the explicit upgrade operation preserves it as resource.v1.json before writing schemaVersion 2.

**Outputs**

A structured inspection result, or an explicitly initialized resources/<id>/resource.json. Inspection creates neither files nor directories.

**Completion**

Inspection returns all available repository snapshots and explicit issues. Initialization is idempotent, preserves existing records and cannot write inside the application checkouts. Blocked or invalid state is never promoted, and migrationComplete is always false.

**Decisions**

Request missing paths, scope, authority or capabilities only when they are needed; missing scope or authority goes to the shared decision subroutine, blocked access to the recovery subroutine. Never infer real project commands or LDAP connection details from the examples.

**Recovery**

Rerun inspection freely. Repeated initialization preserves a valid record. Corrupt, unsupported or redirected records block progress. A fingerprint change is reported without resetting user work. Live reads are not cached across invocations.

**Next**

[Legacy discovery](01-legacy-discovery.md), through the `discover` operation, for a new resource. Planned: a resource with existing progress goes to impact assessment first, which resumes the earliest affected stage.
