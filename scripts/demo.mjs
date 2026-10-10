import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { initializeResource, inspectWorkspace } from "../.github/extensions/resource-migration/inspect.mjs";

const execute = promisify(execFile);
const local = fileURLToPath(new URL("../.local/", import.meta.url));
await mkdir(local, { recursive: true });
const root = await mkdtemp(path.join(local, "demo-"));
const roles = ["ihm", "entities", "api", "e2e"];
for (const role of roles) {
  const directory = path.join(root, role);
  await mkdir(directory);
  await execute("git", ["-C", directory, "init", "--quiet"], { windowsHide: true });
}
const privateDirectory = path.join(root, "private");
await mkdir(privateDirectory);
const workspaceFile = path.join(privateDirectory, "workspace.json");
await writeFile(workspaceFile, JSON.stringify({ schemaVersion: 1, repositories: Object.fromEntries(roles.map((role) => [role, `../${role}`])), resourcesRoot: "resources" }, null, 2));
const inputFile = path.join(privateDirectory, "workflow-input.json");
await writeFile(inputFile, JSON.stringify({ operation: "inspect", workspaceFile, resourceId: "demo" }, null, 2));
const before = await inspectWorkspace(workspaceFile, "demo");
const initialized = await initializeResource(workspaceFile, "demo");
const after = await inspectWorkspace(workspaceFile, "demo");
if (before.status !== "needs-initialization" || initialized.status !== "created" || after.status !== "ready-for-discovery") {
  throw new Error("Synthetic demonstration did not produce the expected outcomes.");
}
console.log(JSON.stringify({ workspaceFile, nativeWorkflowInput: inputFile, before: before.status, initialization: initialized.status, after: after.status, migrationComplete: false }, null, 2));
