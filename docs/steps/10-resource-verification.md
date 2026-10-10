# Resource verification

Step ID: `10-resource-verification`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Reconcile the agreed resource scope with current implementation, evidence and documentation.

**Inputs**

Target scope, current package/API/UI outcomes, resource records and explicit exclusions.

**Procedure**

Check each required workflow against its evidence and source state. Reconcile documents with the intended implemented behavior while preserving the historical snapshot. List unresolved or unavailable checks accurately and close only work that meets its criteria.

**Outputs**

A private completion report and verified resource progress.

**Completion**

Required checks and UI interactions pass, evidence is current, and exclusions were explicitly agreed. There is no deployment, intermediate-PR or production rollout gate in this local loop.

**Decisions**

Ask about material scope changes and unresolved required behavior; do not declare them excluded without a decision.

**Recovery**

Reopen only affected steps when source or target changes invalidate evidence.

**Next**

Finish this resource or explicitly begin the next resource.
