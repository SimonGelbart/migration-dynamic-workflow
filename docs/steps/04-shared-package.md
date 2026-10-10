# Shared package

Step ID: `04-shared-package`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Provide the models and validators required by the agreed contracts and their consumers.

**Inputs**

Contracts/rule matrix, shared package source, actual dependencies and build/test commands.

**Procedure**

Inspect current model/validator structure and consumers. Change necessary models and FluentValidation rules, distinguishing create/update/child semantics. Keep directory-dependent business rules in their established owning layer. Test changed rules and build the required .NET 10 and .NET Standard 2.0 targets; check relevant consumer compatibility.

**Outputs**

Package changes and linked build/validation evidence.

**Completion**

Required checks pass and intended consumers can use the contracts. A test on the modern API runtime alone does not verify the Web Forms consumer.

**Decisions**

Ask about semantic ambiguity or dependency changes that expand scope. Do not assume a package split or upgrade is required.

**Recovery**

Preserve user edits and revisit only affected contracts when a genuine incompatibility appears. Record unavailable environment checks explicitly.

**Next**

[API acceptance](05-api-acceptance.md).
