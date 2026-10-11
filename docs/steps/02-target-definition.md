# Target definition

Step ID: `02-target-definition`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Implemented as the second part of the `discover` workflow operation. Its checks use a test stand-in for the workflow context; see [verification](../verification.md).

**Purpose**

Establish intended behavior for the resource, including its UI, data effects and API outcomes.

**Inputs**

The complete, current baseline from [legacy discovery](01-legacy-discovery.md), answered decisions and rejected target revisions. Existing V2 conventions and the owner's intended changes arrive through those decisions.

**Procedure**

One agent assigns preserve/change/fix/remove/question dispositions to requirements, each referencing baseline finding IDs, and lists exclusions. Code rejects requirements without a known finding, an allowed disposition or, for question, a focused question. Rejected requirements or no valid requirements keep the stage in progress and prevent approval. Open questions become decisions. When none remain, the workflow always asks the owner to approve that exact target revision, including intended UI behavior and differences.

**Outputs**

Private `target/target.json` and `target/target.md`, separate from the legacy baseline. The revision is a digest of the validated requirements, exclusions, source fingerprint and baseline digest. Stored revision fields never select an approval: saved targets are validated and their revisions recomputed from their actual content.

**Completion**

The stage is complete only when the approval decision for the current revision is answered `approve`, the baseline is current, and no target decision is open. The target never rewrites historical evidence.

**Decisions**

Questions pause at `decision/<resource>/02-target-definition/<decision>`. Answered questions are inputs to the next revision; the run regenerates the target with them and then asks for approval. Any other approval answer is a rejection: the run reports `target-rejected`, and the next `discover` run revises the target using that answer. If the agent produces an identical revision, the rejection still stands.

**Recovery**

A stale or changed baseline makes the target stale. Valid edits to saved target JSON are preserved, assigned a recomputed revision and presented for approval; invalid edits stop the operation without overwriting them. Missing JSON triggers generation, and missing or edited Markdown is rebuilt from validated JSON. Artifact digests are checked before reusing completion, and source/decision changes during generation discard the result. A new target revision needs its corresponding approval. Rejected agent output is retained for diagnosis; start a new run to obtain corrected output.

**Next**

[Contracts and validation](03-contracts-and-validation.md) (planned); revisit discovery for missing facts.
