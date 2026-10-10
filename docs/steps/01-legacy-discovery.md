# Legacy discovery

Step ID: `01-legacy-discovery`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Build a thorough baseline of every workflow in the agreed resource boundary.

**Inputs**

Scoped resource, IHM source, linked pages and controls, available UI access, repository state and relevant existing V2 examples.

**Procedure**

Trace pages/subpages, navigation, query strings, initial loads/postbacks, conditional fields, normalization, validation and messages. Follow actual LDAP filters, search scope, mappings and any additional filtering. Identify parent/child interactions and side effects. Attach evidence and classify findings as observed, code-confirmed, inferred or unresolved.

**Outputs**

Private legacy.md plus a coverage inventory, evidence references and focused questions.

**Completion**

Review significant branches against the page/operation inventory. Missing runtime observations and unknown behavior remain explicit. A long document or a file-existence check cannot prove completeness.

**Decisions**

Ask about missing scope, contradictory behavior and inaccessible evidence when they affect coverage. Optional Dev LDAP exploration is read-only and explicitly configured.

**Recovery**

Reuse valid findings; recheck affected evidence after source changes. Record corrections to historical facts separately from intentional V2 changes.

**Next**

[Target definition](02-target-definition.md).
