# Migration dynamic workflow

A Copilot project extension for incrementally migrating a legacy Web Forms resource to an API-backed V2 implementation. The workflow canvas lives in [docs/workflow.md](docs/workflow.md), with one document per step.

**Implemented:** workspace inspection and explicit resource initialization. **Planned:** discovery, target decisions, contracts, package/API implementation, recurring refactoring, and V2 integration. This skeleton does not migrate application code or connect to LDAP.

The primary target is Windows. The orchestration and synthetic fixtures can also be developed on Linux. Passing these checks does not establish that the legacy .NET Framework application can build there.

## Start locally

Install Node.js 24 or later and Git. Use a local filesystem that supports hard links, such as NTFS or ext4, for private records. Run from the repository root in PowerShell or a Linux terminal:

```sh
npm ci
npm run check
npm run demo
```

The demo creates four synthetic Git checkouts and a private workspace under a unique ignored `.local/demo-*` directory. It exercises inspect, initialize, and inspect again; it prints the actual workspace and native-workflow input paths. It does not use the application repositories or LDAP. Remove a generated demo directory when you no longer need it.

The compiler is pinned to TypeScript 6 because its JavaScript compiler also runs in restricted development environments without `/proc/self/exe`. The lockfile pins development dependencies, including the SDK used for type checking; the runtime extension SDK is supplied by Copilot.

## Configure real checkouts

Copy [examples/workspace.example.json](examples/workspace.example.json) to a private directory and adjust the four checkout-root paths. All relative paths resolve against that configuration file, independently of the terminal's current directory. Git worktrees are supported; dirty worktrees are allowed. Use separate configurations for Windows and Linux when their paths differ.

```powershell
npm run inspect -- --workspace "C:\work\migration-private\workspace.json" --resource "example-resource"
npm run initialize -- --workspace "C:\work\migration-private\workspace.json" --resource "example-resource"
npm run inspect -- --workspace "C:\work\migration-private\workspace.json" --resource "example-resource"
```

Use a lowercase resource ID beginning with a letter, then letters, digits or hyphens (maximum 64 characters). Windows device names are rejected on all platforms. Resource records must be separate from the application checkouts. Initialization creates `<resourcesRoot>/<id>/resource.json` only when the prerequisites pass; repeating it preserves the existing record. An invalid record is reported, never repaired by overwriting it.

Inspection returns `blocked`, `needs-initialization`, or `ready-for-discovery`. The last outcome means the configuration and initial record are ready; discovery itself is not implemented. Every result explicitly reports `migrationComplete: false`. CLI exit codes: 0 for a completed operation, 2 for a blocked inspection, and 1 for invalid input or an operation failure. Initialization still leaves the resource at `legacy-discovery` / `not-started`.

## Load the native Copilot workflow

Build first, then start Copilot CLI from this repository:

```sh
npm run build
copilot --experimental
```

Use `/extensions manage` to check the `resource-migration` extension. Ask Copilot to list dynamic workflows, then explicitly ask it to run `resource-migration` with `operation: "inspect"`, the workspace JSON path, and `resourceId`. Normal extension trust and permission handling applies.

You can also use the input JSON printed by the demo:

```powershell
copilot --experimental workflow run resource-migration --args '@PATH-PRINTED-BY-DEMO/workflow-input.json'
```

Replace the placeholder with the real input-file path, keeping the leading `@`. For your private workspace, create a JSON input file like this outside the public repository:

```json
{
  "operation": "inspect",
  "workspaceFile": "C:/work/migration-private/workspace.json",
  "resourceId": "example-resource"
}
```

Use `operation: "initialize"` only when you intend to create the private record. Both operations execute deterministic local code and spawn no agents. Rebuild after source changes and reload extensions with `/clear` or restart the session. A workflow run marked completed means its inspection/initialization finished, not that the migration did.

The native integration needs a Copilot session eligible for dynamic workflows. See [verification and limitations](docs/verification.md) for what has actually been exercised and the remaining smoke check.

## Continue development

- [Implementation plan](docs/implementation-plan.md): ten increments, starting with this skeleton.
- [Architecture](docs/architecture.md): modules, persistence and boundaries.
- [Workflow canvas](docs/workflow.md): canonical procedures and recurring review loop.
- [Verification](docs/verification.md): reproducible checks and their limits.
- [Development rules](AGENTS.md): instructions for working on this repository.

The application's existing TUnit/HttpClient tests stay in its E2E repository. This repository's tests exercise the workflow tool.
