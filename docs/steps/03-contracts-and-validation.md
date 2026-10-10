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

**Outputs**

Private contracts, rule/scenario IDs and existing/extend/missing capability mapping.

**Completion**

Each required workflow maps to an operation and scenario; important rules have an owner verified in the actual architecture. No guessed route, default or layer responsibility.

**Decisions**

Resolve contradictory rules and changes to contract behavior before encoding them in tests.

**Recovery**

Reopen affected target decisions when implementation reveals a real contract issue. Keep links current without copying the same rule into several documents.

**Next**

[Shared package](04-shared-package.md), followed by [API acceptance](05-api-acceptance.md).
