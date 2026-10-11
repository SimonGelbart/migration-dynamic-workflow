# Verification

Run `npm ci` followed by `npm run check`. The check type-checks against the actual pinned SDK, builds JavaScript, runs real filesystem/Git/CLI tests, and checks documentation links and step structure. `npm run demo` exercises the foundation with synthetic local repositories. Test fixtures live in ignored `.local/test-fixtures/` and are removed after each case.

Coverage includes relative paths and spaces, JSON/version errors, invalid identifiers, real worktrees, missing repositories, read-only inspection, concurrent idempotent initialization, corruption preservation, output boundaries and changes to staged/unstaged/untracked source. Record checks cover code-owned transitions, the explicit schemaVersion 1 upgrade, the writer lock and write-once answers. Discovery checks cover pause/resume, clarified scope investigation in resumed and new runs, changed source, edited target approval, invalid target preservation, missing/edited artifacts, older version-2 records without digests, rejected/empty output, redirected artifact paths, cancellation, failed agents and rejected targets. The documentation check also requires each step's Implemented status to match `implementedSteps` in the code.

Workflow tests call the real definition with a stand-in context (`workflowHarness` in `tests/helpers.mjs`) that models the documented journal and one-shot pause semantics, and returns scripted agent output. That is not a live Copilot run and says nothing about the quality of real agent output.

## Live Copilot smoke check

1. Build with `npm run build` and generate a synthetic input using `npm run demo`.
2. Start an eligible Copilot CLI session from the repository with experimental features enabled. Inspect `/extensions manage`; the extension must load successfully.
3. List the available dynamic workflows and explicitly invoke `resource-migration` with the demo's input JSON.
4. Verify a real native run ID, the Workspace readiness phase and the returned `ready-for-discovery` result. Inspect `/workflows`; a plain standalone command is insufficient evidence.
5. Change a synthetic source file and invoke inspection again. Verify the changed-source flag. Explicitly invoke initialization again and verify `already-exists` without replacing the resource record.
6. Dynamic features: add a small synthetic page to the demo `ihm` checkout and invoke `operation: "discover"`. Verify two discovery agents, saved `discovery/` evidence or a paused run at a `decision/...` checkpoint, then `npm run answer` and a resume of the same run ID. Edit a synthetic source while paused, resume, and verify the rediscovery log line. Answer the target approval and verify `complete`. Record whether `ctx.step`, agent memoization and one-shot pause behaved as [the architecture](architecture.md) assumes.
7. Record the CLI version, platform, actual command, run ID/outcome and any compatibility limitation in a private verification note. Keep credentials and private paths out of this repository.

Registration code follows the SDK's [workflow authoring guide](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/workflows.md), [workflow types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/workflow.ts), and [extension API](https://github.com/github/copilot-sdk/blob/main/nodejs/src/extension.ts). See also [GitHub's workflow instructions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows).

## Current verification record

Review fixes, local verification on 11 October 2026:

| Check | Result |
| --- | --- |
| Linux, Node 24.19.0, TypeScript 6.0.3, SDK 1.0.19 | Type-check, build, 50 tests and documentation check passed; 19 documentation files checked |
| Earlier failure reproductions | Regression tests confirm changed targets need the corresponding approval, scope answers trigger investigation, missing/edited artifacts invalidate readiness, rejected/empty output cannot complete, and linked artifact paths cannot redirect writes |
| Native Copilot smoke check and Windows execution | Not run locally: Copilot CLI unavailable; Windows requires the CI matrix or a Windows environment |
| Private application and development LDAP checks | Not run; live LDAP integration remains planned |

Discovery increment, local verification on 10 October 2026:

| Check | Result |
| --- | --- |
| Linux, Node 22, TypeScript 6.0.3, SDK 1.0.19 | Type-check, build, 34 tests and documentation check passed |
| Native smoke check, including the dynamic-feature step | Not run: Copilot CLI was not installed in this environment and no signed-in session was available |
| Runtime SDK version supplied by Copilot | Unknown until the smoke check. If it differs from 1.0.19, pin the dev dependency to it rather than adding a runtime shim |
| Real discovery agent output, reference-resource evaluation | Not run; requires a signed-in session and the private applications |

Initial local verification on 10 October 2026:

| Check | Result |
| --- | --- |
| Linux, Node 24.19.0, TypeScript 6.0.3 | Strict project type-check and build passed |
| SDK 1.0.19 definition and core/CLI tests | 22 tests passed, none skipped |
| Documentation | 18 Markdown files checked for local links and step structure |
| Synthetic demo | inspect → initialize → inspect produced the expected results |
| Copilot CLI 1.0.95 | Version and workflow command checked; native run stopped with `No authentication information found` |
| Signed-in native registration/run | Not verified; perform the smoke check above |
| Windows tool execution | CI matrix configured; consult the actual run result |
| Private applications and LDAP | Not accessed or verified |

The CI matrix checks this tool on Windows and Linux; it does not authenticate to Copilot or test the private applications. The SDK definition test is not a substitute for successful native registration and a recorded workflow run. Authentication was not bypassed, and no substitute model provider was configured.

Source fingerprints are change indicators, not test results. An unavailable command or runtime must be reported as unavailable. No discovery, application build, API acceptance, LDAP, or UI behavior is claimed verified by this skeleton.
