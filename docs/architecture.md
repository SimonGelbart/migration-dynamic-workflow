# Architecture

The owner maintains this tool and accepts a documented build step. TypeScript `.mts` sources compile into a Copilot project extension at `.github/extensions/resource-migration/extension.mjs`. Generated files are ignored; `npm ci` and `npm run build` are required after checkout. Copying only the extension output would not distribute the documentation and future skills; use the whole repository for now.

| Source | Responsibility |
| --- | --- |
| `src/extension.mts` | Join Copilot with the native workflow handle |
| `src/workflow.mts` | Native metadata, semantic argument validation, phases and dispatch |
| `src/cli.mts` | Standalone commands for local checks and diagnosis |
| `src/inspect.mts` | Readiness report and initialization coordination |
| `src/workspace.mts` | Versioned configuration, path resolution and directory checks |
| `src/git.mts` | Checkout inspection and source fingerprints |
| `src/resource.mts` | Resource validation and atomic create-if-absent persistence |
| `src/model.mts` | Shared types and validation helpers |

The adapter uses the actual `defineWorkflow` and `joinSession({ workflows })` APIs, type-checked against the pinned SDK. Copilot supplies its own SDK when loading extensions. A different CLI version can still expose an incompatible preview API; follow the smoke check in [verification](verification.md).

Both entry points share the same ordinary core functions. Inspection invokes only local reads and Git inspection commands; it does not build application projects, call LDAP, edit sources or claim tests passed. Initialization is a separate explicit operation. Runtime input validation remains necessary because TypeScript types do not validate JSON, and the SDK's argument schema supports only a structural subset.

## Records and evidence

The private workspace contains configuration and `resources/<id>/resource.json`. Schema version 1 currently supports only an unstarted `legacy-discovery` record, its creation date, and the initialization source fingerprint. Later state transitions and evidence records will be introduced with their actual stages. Unsupported or corrupt state blocks progress; it is not silently reset.

The fingerprint includes resolved workspace paths, Git HEAD, staged/unstaged differences and untracked nonignored file contents. It detects ordinary local edits without requiring a clean checkout. Ignored files, external services, tool versions, uncommitted contents inside submodules, and concurrent edits during a scan are outside this snapshot guarantee. Stage-specific verification must establish its own stable inputs and evidence. A changed fingerprint is reported, not automatically accepted as verified work.

Git runs without optional locks and without external diff/text-conversion commands. Each invocation has a 15-second timeout and a 16-MiB output limit; oversized or unavailable inspection is reported as a failure. No shell command string is constructed from configuration.

Initialization checks boundaries and publishes a fully written temporary record with an exclusive hard link. A racing initializer reads the winner's complete record. Existing bytes are never replaced. An interrupted process can leave a `.resource-*.tmp` file; inspect the canonical `resource.json`, confirm no initializer is running, then remove orphaned temporary files if needed. Atomic create requires a filesystem supporting hard links. This is not a migration-wide writer lock: there are no application-writing stages yet.

Copilot owns run IDs, run history and native checkpoints. Resource records will track migration progress across runs. We do not duplicate the native execution database. Readiness reads are deliberately not memoized, so a resumed invocation rereads current inputs.

## Extension growth

Add an implemented stage's module, needed skill/template and meaningful checks together. Canonical procedures live in [steps](workflow.md); skills should load the relevant instructions rather than repeat them. Plan one active resource per workspace and at most two workers, with one writer to shared application checkouts. Implement the writer coordination and stale-evidence checks before adding application writes.

Windows is the full migration target. Linux can run orchestration tests and whatever analysis is supported by its available sources. Dev LDAP may later be an explicit read-only discovery profile; the local container remains the repeatable test environment. Neither LDAP access nor a new test harness is part of this skeleton.
