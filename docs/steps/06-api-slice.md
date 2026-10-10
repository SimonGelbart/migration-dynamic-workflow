# API slice

Step ID: `06-api-slice`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Implement one coherent case with its own verifiable outcome.

**Inputs**

An eligible functional task, target/rule/scenario references, source baseline and known unfinished cases.

**Procedure**

Inspect applicable entity, validator, presenter, core and gateway responsibilities. Add meaningful tests for changed behavior and the slice boundary. Implement the necessary changes, run the slice checks and relevant previously passing cases, and evaluate broader scenarios at useful integration points. Temporary unfinished branches may fail explicitly before producing side effects.

**Outputs**

Code changes, slice evidence and accurate remaining-work references.

**Completion**

Slice criteria pass and protected behavior remains valid. A larger journey may still be expected-red. Do not create empty tests in every layer or declare completion from worker confidence.

**Decisions**

Ask when a missing fact changes intended behavior. Reopen affected contracts rather than weakening assertions to fit an implementation error.

**Recovery**

Coordinate one writer to shared checkouts. Recheck source/evidence after interruption or manual edits. Unexpected regressions are investigated before further restructuring.

**Next**

Another eligible slice, [review/refactoring](07-review-and-refactor.md) when due, or [API completion](08-api-completion.md).
