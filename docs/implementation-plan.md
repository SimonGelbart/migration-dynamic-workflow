# Repository implementation plan

This backlog describes building the tool. [The workflow canvas](workflow.md) describes migrating a resource. Planned step documents do not imply those stages are executable.

| Increment | Deliverable | Current status and completion evidence |
| --- | --- | --- |
| 1. Documentation canvas | Overview, architecture, development rules and consistent step documents | Present; readiness is specified, later stages are planned |
| 2. Native TypeScript skeleton | Compiled extension, actual workflow registration and standalone inspection | Implemented; signed-in native smoke check still outstanding, see [verification](verification.md) |
| 3. Private workspace foundation | Configuration, resource initialization and source-change reporting | Implemented; schemaVersion 2 records, explicit upgrade, code-owned transitions and the writer lock added with increment 4 |
| 4. Discovery and target | Source/UI evidence, separate baseline/target, consequential decision checkpoint | Implemented as `discover` (source evidence only; no runtime UI observation). Pause/resume, staleness and validation checked with a stand-in context; native behavior and output quality unverified |
| 5. Reference evaluation | Compare an existing migration with generated discovery/target output | Planned; needs a signed-in session and the private reference resource. Record omissions, unsupported inferences and noise privately; repeat after prompt changes |
| 6. Contracts and package | Rule ownership, API gaps, models, validators and consumer checks | Planned; requirements and package evidence must be traceable |
| 7. API acceptance | Reuse TUnit/HttpClient; controlled fixtures and a real result adapter | Planned; suite builds/runs, selected cases accounted for, causes distinguished |
| 8. API slices and reviews | One eligible task at a time; recurring design review and bounded refactoring | Planned; slice checks, regression detection and recovery demonstrated on a small resource |
| 9. API completion and V2 | Required API cases green; fully duplicated and connected pages | Planned; current package/API/UI evidence for the pilot's intended scope |
| 10. Greater autonomy | Automatic continuation, bounded parallel workers and stronger interruption recovery | Planned; routine work progresses while consequential unknowns still surface |

Next: run the signed-in native smoke check on Windows (including its dynamic-feature step) and record the result. Then run the reference evaluation: initialize the already migrated resource in a private workspace, run `discover`, and compare `legacy.md` and `target.md` with the real migration. Keep a private list of omissions, wrong inferences and noise, improve the step documents and prompts, and repeat the comparison after each prompt change. Do not start application-writing stages until that comparison is acceptable. Then use a small new resource for implementation, after reviewing the shared package/API/E2E conventions.

For every increment: refine its owning step document, add only the required procedures and code, verify outcomes/failure paths, and update this table. Do not prebuild empty runtime stages, a second workflow engine, a dashboard, or a replacement API test harness. Evaluate SQLite only if a concrete persistence limitation appears.

Actual application commands and private configuration become necessary at the stage that uses them. Never fabricate successful application verification because only the orchestration tests have run.
