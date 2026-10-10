# Verification

Run `npm ci` followed by `npm run check`. The check type-checks against the actual pinned SDK, builds JavaScript, runs real filesystem/Git/CLI tests, and checks documentation links and step structure. `npm run demo` exercises the foundation with synthetic local repositories. Test fixtures live in ignored `.local/test-fixtures/` and are removed after each case.

Coverage includes relative paths and spaces, JSON/version errors, invalid identifiers, real worktrees, missing repositories, read-only inspection, concurrent idempotent initialization, corruption preservation, output boundaries and changes to staged/unstaged/untracked source. Workflow tests use the real SDK's definition handle and call its body with a small test context; that is not a live Copilot run.

## Live Copilot smoke check

1. Build with `npm run build` and generate a synthetic input using `npm run demo`.
2. Start an eligible Copilot CLI session from the repository with experimental features enabled. Inspect `/extensions manage`; the extension must load successfully.
3. List the available dynamic workflows and explicitly invoke `resource-migration` with the demo's input JSON.
4. Verify a real native run ID, the Workspace readiness phase and the returned `ready-for-discovery` result. Inspect `/workflows`; a plain standalone command is insufficient evidence.
5. Change a synthetic source file and invoke inspection again. Verify the changed-source flag. Explicitly invoke initialization again and verify `already-exists` without replacing the resource record.
6. Record the CLI version, platform, actual command, run ID/outcome and any compatibility limitation in a private verification note. Keep credentials and private paths out of this repository.

Registration code follows the SDK's [workflow authoring guide](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/workflows.md), [workflow types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/workflow.ts), and [extension API](https://github.com/github/copilot-sdk/blob/main/nodejs/src/extension.ts). See also [GitHub's workflow instructions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows).

## Current verification record

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
