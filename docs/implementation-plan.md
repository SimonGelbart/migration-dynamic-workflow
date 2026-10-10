# Repository implementation plan

This backlog describes building the tool. [The workflow canvas](workflow.md) describes migrating a resource. Planned step documents do not imply those stages are executable.

| Increment | Deliverable | Current status and completion evidence |
| --- | --- | --- |
| 1. Documentation canvas | Overview, architecture, development rules and consistent step documents | Present; readiness is specified, later stages are planned |
| 2. Native TypeScript skeleton | Compiled extension, actual workflow registration and standalone inspection | Implemented; module checks and live-session verification are distinguished in [verification](verification.md) |
| 3. Private workspace foundation | Configuration, resource initialization and source-change reporting | Implemented; broader migration state transitions are deferred until their stages exist |
| 4. Discovery and target | Source/UI evidence, separate baseline/target, consequential decision checkpoint | Planned; useful output plus correct pause/resume behavior required |
| 5. Reference evaluation | Compare an existing migration with generated discovery/target output | Planned; correct omissions and unsupported inferences before application edits |
| 6. Contracts and package | Rule ownership, API gaps, models, validators and consumer checks | Planned; requirements and package evidence must be traceable |
| 7. API acceptance | Reuse TUnit/HttpClient; controlled fixtures and a real result adapter | Planned; suite builds/runs, selected cases accounted for, causes distinguished |
| 8. API slices and reviews | One eligible task at a time; recurring design review and bounded refactoring | Planned; slice checks, regression detection and recovery demonstrated on a small resource |
| 9. API completion and V2 | Required API cases green; fully duplicated and connected pages | Planned; current package/API/UI evidence for the pilot's intended scope |
| 10. Greater autonomy | Automatic continuation, bounded parallel workers and stronger interruption recovery | Planned; routine work progresses while consequential unknowns still surface |

The next increment is discovery/target definition, preceded by completing any outstanding native Windows smoke check. Select the already migrated reference resource privately, then use a small new resource for implementation. Review the shared package/API/E2E conventions before generating changes.

For every increment: refine its owning step document, add only the required procedures and code, verify outcomes/failure paths, and update this table. Do not prebuild empty runtime stages, a second workflow engine, a dashboard, or a replacement API test harness. Evaluate SQLite only if a concrete persistence limitation appears.

Actual application commands and private configuration become necessary at the stage that uses them. Never fabricate successful application verification because only the orchestration tests have run.
