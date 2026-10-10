# Review and refactor

Step ID: `07-review-and-refactor`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned; recurrent within the API loop.

**Purpose**

Improve accumulated implementation where a concrete design problem justifies the work.

**Inputs**

Stable implemented source, recent slice outcomes, relevant target rules and existing findings.

**Procedure**

Review after a batch, initially three completed slices, or earlier for a concrete issue. Look for duplicated responsibilities, inconsistent rules, repeated workarounds or misplaced behavior. Use SOLID/CUPID/Clean Architecture as questions, not automatic demands for abstractions. Deduplicate findings and enqueue a bounded behavior-preserving task only when useful.

**Outputs**

One compact review outcome and any justified refactoring task with scope, intended benefit and protecting checks.

**Completion**

No-refactor is valid. Selected improvements address their stated problem and preserve previously passing behavior; investigate changed causes among expected-red cases. Do not force a finding or reopen the entire architecture every time.

**Decisions**

Behavior-preserving changes within scope may proceed automatically. Contract/business changes are functional changes requiring the relevant target decision.

**Recovery**

Establish protection before restructuring uncovered behavior. Apply reviews to stable snapshots, and invalidate conclusions when relevant code changes.

**Next**

Return to [API slice](06-api-slice.md) or proceed to [API completion](08-api-completion.md).
