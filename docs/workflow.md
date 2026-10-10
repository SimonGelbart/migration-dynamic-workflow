# Workflow canvas

The canonical procedure for each step is linked below. Public documents describe the method; private resource artifacts describe the actual legacy behavior and agreed target. Skills will reference the owning step, code enforces eligible transitions, and verification supplies evidence. Document existence alone does not establish completion. [The workflow design](design.md) shows the whole flow, states and decision loop in diagrams.

| Step | Outcome |
| --- | --- |
| [00. Workspace readiness](steps/00-workspace-readiness.md) | Known configuration and initial resource state |
| [01. Legacy discovery](steps/01-legacy-discovery.md) | Evidence-backed baseline |
| [02. Target definition](steps/02-target-definition.md) | Agreed intended behavior, separate from history |
| [03. Contracts and validation](steps/03-contracts-and-validation.md) | Rule ownership, API contracts and capability gaps |
| [04. Shared package](steps/04-shared-package.md) | Models/validators usable by the intended consumers |
| [05. API acceptance](steps/05-api-acceptance.md) | Runnable final-behavior scenarios with tracked outcomes |
| [06. API slice](steps/06-api-slice.md) | One coherent case implemented and verified |
| [07. Review and refactor](steps/07-review-and-refactor.md) | Justified improvements with protected behavior |
| [08. API completion](steps/08-api-completion.md) | Required API scenarios pass after consolidation |
| [09. V2 integration](steps/09-v2-integration.md) | Fully copied pages connected through the established API pattern |
| [10. Resource verification](steps/10-resource-verification.md) | Scope reconciled with current evidence |

Steps 06 and 07 form a recurring loop. Review after a small batch, initially three completed slices, or earlier for a concrete issue. A review can find nothing worth changing. Final API consolidation remains useful after all required cases pass. Newly discovered requirements can reopen affected contracts, tests or package work; do not rewrite the historical snapshot to fit V2.

## Operating rules

- One resource may be a sizeable feature with several submodules. Plan one active migration per workspace.
- Aim for automatic continuation through eligible stages and batches. Routine reviews are internal checkpoints, not repeated human approvals.
- Ask for decisions when requirements, contract semantics, intended behavior or material scope are unresolved. Do not block unrelated clear work unnecessarily.
- Start with at most two workers for independent tasks. Coordinate shared writes with one writer; reviews apply to stable code. Isolate fixtures or serialize runs that mutate shared LDAP test data.
- Use the existing IHM, entities, API and E2E repositories. Keep TUnit/HttpClient and the established code-behind-to-API pattern. The shared package targets .NET 10 and .NET Standard 2.0, and the legacy frontend uses .NET Framework 4.8.
- Keep real records, private findings and connection details outside this public repository. LDAPfornet does not identify the server in the local container; establish its actual capabilities before claiming AD-specific coverage.
- This is a local development loop. Intermediate PR, deployment and rollout gates are outside its scope.

## Outcomes and evidence

The acceptance suite asserts final intended behavior. Known unfinished cases may remain red during API slices, including explicit `NotImplementedException` branches. Identify cases and causes individually. Previously passing behavior must remain protected, and a changed cause in an already-red case needs investigation. Failure counts alone are insufficient. Build/fixture failure, missing tests and skipped required cases do not prove behavior.

Each slice has its own criteria and meaningful unit/integration evidence, even when a larger journey is still unfinished. Inspect applicable layer responsibilities without creating empty tests in every layer. All required resource API cases must pass before API completion and V2 integration.

Manual edits between runs are expected. Recheck affected prerequisites and invalidate stale evidence; do not blindly reuse a checkpoint or reset user work. Versioned progress records describe verified outcomes, not agent confidence. Discovery and target definition record the source fingerprint their evidence was based on, and become stale when it changes; later stages must implement their own evidence and resumption policies. See [the architecture](architecture.md) for how records, the workflow journal and pause checkpoints relate.

Every step document uses Purpose, Inputs, Procedure, Outputs, Completion, Decisions, Recovery and Next fields, plus an honest implementation Status. A semantic review of coverage remains necessary even when structural checks pass.
