# Working on this repository

This repository builds an incremental Copilot dynamic workflow. Read [README.md](README.md), [the implementation plan](docs/implementation-plan.md), and [the workflow canvas](docs/workflow.md) before changing behavior.

- Implement only the requested increment. The current runtime supports `inspect`, explicit `initialize`/`upgrade`, and `discover` (legacy discovery and target definition); later migration stages are documented plans.
- Keep canonical procedures in `docs/steps/`. Add a skill only when an implemented stage needs it, and reference its owning document.
- Author TypeScript in `src/*.mts`; generated `.mjs` files under `.github/extensions/resource-migration/` are ignored. Build before loading or reloading Copilot.
- Use the real pinned SDK types and official source/guidance. Do not invent registration APIs or use local declaration stubs to hide incompatibility.
- Keep inspection read-only. Operations write only the selected private resource directory, under the writer lock for anything but initialization, and must not replace answered decisions or reset progress silently.
- Do not commit real application paths, credentials, LDAP records, or private resource artifacts. Examples and fixtures are synthetic.
- Preserve the user's local edits. A commit ID alone does not identify the source state in this local development loop.
- Add meaningful checks for behavior, failure paths and regressions. Do not mechanically add tests to every layer or replace the existing application TUnit/HttpClient harness.
- Run `npm run check` and the relevant native smoke check when changing integration. Report unavailable checks honestly; a mocked context is not a live Copilot run.
- Update the owning documentation, implementation status, and affected checks with behavior changes. Keep improvements bounded and deduplicate findings.
- The migration workflow's ability to delegate work is a product capability. It does not require parallel agents to develop this repository.
