# Target definition

Step ID: `02-target-definition`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Establish intended behavior for the resource, including its UI, data effects and API outcomes.

**Inputs**

Reviewed baseline, unanswered questions, existing V2 conventions and the owner's intended changes.

**Procedure**

Assign preserve/change/fix/remove/question dispositions. Capture concrete examples, defaults, errors, validation display, navigation and relevant interaction states. Reuse existing UI conventions. Present consequential choices for a human decision about the actual target revision.

**Outputs**

Private target.md and decision references, separate from legacy.md.

**Completion**

Observable requirements and exclusions are explicit; consequential questions affecting the next work are resolved. The target does not silently rewrite historical evidence.

**Decisions**

Ask for intended behavior, contract semantics or material scope changes. Existing authorization and agreed conventions cover routine implementation decisions.

**Recovery**

A changed target invalidates affected contracts/tests/evidence. A resumed checkpoint must refer to the decided target revision, not just an old approval flag.

**Next**

[Contracts and validation](03-contracts-and-validation.md); revisit discovery for missing facts.
