# API completion

Step ID: `08-api-completion`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Establish that the complete required API behavior is ready for UI integration.

**Inputs**

Completed required slices, current acceptance suite, relevant package evidence and accumulated review findings.

**Procedure**

Run all required resource scenarios. Resolve required unfinished branches and accidental skips or fixture workarounds. Perform final consolidation for concrete cross-slice inconsistencies; execute bounded tasks and rerun protecting checks after changes.

**Outputs**

Current complete API evidence and any explicit agreed exclusions.

**Completion**

Every required API scenario passes after final changes. Earlier green evidence cannot stand in for current source. Fixture failure or unavailable tests block this claim.

**Decisions**

Confirm any proposed behavior change or scope exclusion; do not silently redefine completion.

**Recovery**

Reopen the affected functional/refactoring task on failure. Preserve valid evidence for unchanged inputs while rerunning impacted checks.

**Next**

[V2 integration](09-v2-integration.md).
