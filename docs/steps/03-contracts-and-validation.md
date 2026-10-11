# Contracts and validation

Step ID: `03-contracts-and-validation`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Translate intended workflows into coherent API capabilities and rules with clear ownership.

**Inputs**

Target decisions, existing API/package code, architecture conventions and acceptance examples.

**Procedure**

Build a rule matrix for create/update/child cases, preconditions, omitted/null values, failures and enforcement owners. Derive operations, inputs, outputs and side effects; compare with the API early enough to reuse existing capabilities. Coherent semantics take priority over minimizing endpoint count. Establish flag meanings and defaults from evidence or decisions.

Define functional slices with observable outcomes, scope boundaries, dependencies and requirement/scenario links. Prepare concrete example requests, responses and failure cases. Present the complete API definition and functional slice proposal to the owner for mandatory validation (C11 in the design), before package changes or implementation. Revise requested changes and return target/UI mismatches to target definition.

**Outputs**

Private contracts, rule/scenario IDs, existing/extend/missing capability mapping and the functional slice plan. Record the owner's validation against the exact contract and slice-plan revision.

**Completion**

Each required workflow maps to an operation, functional slice and scenario; important rules have an owner verified in the actual architecture. No guessed route, default or layer responsibility. The owner has validated the current API definition and functional slice boundaries, and no consequential decision remains open. Do not advance to the shared package while validation is missing or deferred.

**Decisions**

Owner validation is always required, even when the agent finds no ambiguity. Resolve contradictory rules and changes to contract behavior before encoding them in tests. The agent may split validated slices into technical tasks autonomously while preserving their behavior and boundaries.

**Recovery**

Reopen affected target decisions when implementation reveals a real contract issue. Material changes to API semantics or functional slice boundaries require renewed validation of the affected revision. Preserve unaffected work and keep links current without copying the same rule into several documents.

**Next**

[Shared package](04-shared-package.md), followed by [API acceptance](05-api-acceptance.md).
