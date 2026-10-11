# Architecture

The owner maintains this tool and accepts a documented build step. TypeScript `.mts` sources compile into a Copilot project extension at `.github/extensions/resource-migration/extension.mjs`. Generated files are ignored; `npm ci` and `npm run build` are required after checkout. Copying only the extension output would not distribute the documentation and future skills; use the whole repository for now.

| Source | Responsibility |
| --- | --- |
| `src/extension.mts` | Join Copilot with the native workflow handle |
| `src/workflow.mts` | Native metadata, semantic argument validation, phases and dispatch |
| `src/cli.mts` | Standalone commands for local checks and diagnosis |
| `src/inspect.mts` | Readiness and stage summary, initialization, explicit upgrade, locked record updates and answers |
| `src/discovery.mts` | Discovery and target agents, output validation, private artifacts and decision checkpoints |
| `src/stages.mts` | Code-owned stage transitions, staleness, decisions and pause keys |
| `src/lock.mts` | Workspace-wide writer lock |
| `src/workspace.mts` | Versioned configuration, path resolution and directory checks |
| `src/git.mts` | Checkout inspection and source fingerprints |
| `src/resource.mts` | Resource validation (schemaVersion 1 and 2), atomic create-if-absent and atomic replacement |
| `src/model.mts` | Shared types and validation helpers |

The adapter uses the actual `defineWorkflow` and `joinSession({ workflows })` APIs, type-checked against the pinned SDK. Copilot supplies its own SDK when loading extensions. A different CLI version can still expose an incompatible preview API; follow the smoke check in [verification](verification.md).

Both entry points share the same ordinary core functions. Inspection invokes only local reads and Git inspection commands; it does not build application projects, call LDAP, edit sources or claim tests passed. Initialization, upgrade and answers are separate explicit operations. Discovery runs only as the native workflow because it needs workflow agents and checkpoints. Runtime input validation remains necessary because TypeScript types do not validate JSON, and the SDK's argument schema supports only a structural subset.

## Records and evidence

The private workspace contains configuration, `resources/<id>/resource.json` and each stage's artifacts beside it. Schema version 2 records a revision, the initialization fingerprint, a state per implemented stage (`not-started`, `in-progress`, `awaiting-decision` or `complete`), the evidence files and source fingerprint each stage was based on, and owner decisions. Staleness and blocking are computed on inspection, not stored: a stage is stale when the current sources or its predecessor's evidence differ from what it was based on. Unsupported or corrupt state blocks progress; it is not silently reset.

Schema version 1 records are reported as `needs-upgrade`. Only the explicit upgrade operation converts one; it first copies the original bytes to `resource.v1.json` without overwriting, then writes version 2. Initialization creates version 2.

Stage transitions are a fixed table in code. Agent output is data that code validates; it never selects a state. A stage cannot complete with open decisions, and a stage cannot start until its predecessor is complete for the current sources.

The fingerprint includes resolved workspace paths, Git HEAD, staged/unstaged differences and untracked nonignored file contents. It detects ordinary local edits without requiring a clean checkout. Ignored files, external services, tool versions, uncommitted contents inside submodules, and concurrent edits during a scan are outside this snapshot guarantee. A changed fingerprint makes stage evidence stale; it is never automatically accepted as verified work.

Git runs without optional locks and without external diff/text-conversion commands. Each invocation has a 15-second timeout and a 16-MiB output limit; oversized or unavailable inspection is reported as a failure. No shell command string is constructed from configuration.

Initialization checks boundaries and publishes a fully written temporary record with an exclusive hard link. A racing initializer reads the winner's complete record. Initialization never replaces existing bytes. An interrupted process can leave a `.resource-*.tmp` file; inspect the canonical `resource.json`, confirm no initializer is running, then remove orphaned temporary files if needed. Atomic create requires a filesystem supporting hard links.

Every later write (stage artifacts, record updates, upgrades and answers) holds the workspace writer lock: a `resourcesRoot/.writer.lock` directory created exclusively and naming its holder. Writers reread the record inside the lock and replace files by atomic rename, so concurrent answers are not lost. The lock is held only while writing, not while agents run or a run is paused; a writer that finds it held fails with the holder's name. The lock is never broken automatically: if no migration process is running, remove the directory by hand. The same lock will serialize writes to application checkouts when those stages exist.

## Native runs, journal and checkpoints

Copilot owns run IDs, run history, the step/agent journal and checkpoints. The resource record is authoritative for migration progress; a native checkpoint only says where a run stopped. When they disagree, the record and the current sources win. A resumed run restarts its body, rereads configuration, record and sources, and recomputes what to do. If the sources changed while paused, the affected evidence is stale and is produced again rather than continued.

Caching rules:

- Never cached: configuration, the resource record, decisions, Git state and fingerprints. They are read outside `ctx.step`, every attempt.
- Cached by the journal: agent results (memoized by prompt and options, and labeled with the source fingerprint) and validated discovery output (`ctx.step` key `discovery-baseline-v1-<fingerprint>`). A resume reuses them only for identical sources. Version a key when its producer's meaning changes.
- Answers are inputs. The target prompt includes answered decisions, so a new answer produces a new agent call rather than replaying an old result.

Pause keys are `decision/<resourceId>/<stageId>/<decisionId>`. Decision IDs are `q-` plus a digest of the stage and question, so the same question keeps its ID and answer across rediscovery, or `approve-<target revision>`. A checkpoint is one-shot per run: a resumed attempt whose decision is still unanswered returns `awaiting-decision` instead of pausing again; start a new run after answering.

Workflow tests drive the real definition with a stand-in context that models the documented journal and one-shot pause semantics. That is not evidence of native behavior; see [verification](verification.md).

## Extension growth

Add an implemented stage's module, needed skill/template and meaningful checks together, and list it in `implementedSteps`; the documentation check compares that list with each step's Status. Canonical procedures live in [steps](workflow.md). Discovery needs no skill: its agent prompts point to the owning step document. Plan one active resource per workspace and at most two workers, with one writer to shared application checkouts. Before adding application writes, record the source state before and after each write and add stage-specific stale-evidence checks.

Keep a single `resource-migration` workflow with an `operation` argument until operation-specific arguments make one schema unwieldy. Extract the generic workspace, record, fingerprint and readiness parts only when a second workflow needs them.

Windows is the full migration target. Linux can run orchestration tests and whatever analysis is supported by its available sources. Dev LDAP may later be an explicit read-only discovery profile; acceptance tests use a disposable LDAP (Testcontainers or the local container) as the repeatable test environment and never write to Dev LDAP. Neither LDAP access nor a new test harness is part of this skeleton.
