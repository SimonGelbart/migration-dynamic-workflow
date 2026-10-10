import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { definition, parseWorkflowInput, resourceMigration } from "../.github/extensions/resource-migration/workflow.mjs";
import { execute, fixture } from "./helpers.mjs";

const cli = fileURLToPath(new URL("../.github/extensions/resource-migration/cli.mjs", import.meta.url));

test("CLI can initialize and inspect in separate processes from another working directory", async (t) => {
  const f = await fixture(t);
  const run = (operation) => execute(process.execPath, [cli, operation, "--workspace", f.configPath, "--resource", "demo"], { cwd: f.root, encoding: "utf8" });
  assert.equal(JSON.parse((await run("initialize")).stdout).status, "created");
  assert.equal(JSON.parse((await run("inspect")).stdout).status, "ready-for-discovery");
});

test("CLI rejects unknown input before it can initialize a record", async (t) => {
  const f = await fixture(t);
  await assert.rejects(execute(process.execPath, [cli, "initialize", "--workspace", f.configPath, "--resource", "demo", "--unsupported"]), (error) => error.code === 1);
  await assert.rejects(access(f.resourcesRoot), { code: "ENOENT" });
});

test("workflow arguments enforce semantic constraints beyond the SDK's structural schema", () => {
  const valid = { operation: "inspect", workspaceFile: "workspace.json", resourceId: "demo" };
  assert.deepEqual(parseWorkflowInput(valid), valid);
  for (const value of [{ ...valid, operation: "migrate" }, { ...valid, resourceId: "../api" }, { ...valid, unexpected: true }, { ...valid, workspaceFile: "" }]) {
    assert.throws(() => parseWorkflowInput(value));
  }
});

test("real SDK accepts the workflow definition and its body reports readiness without spawning agents", async (t) => {
  const f = await fixture(t);
  assert.equal(resourceMigration.meta.name, "resource-migration");
  assert.equal(resourceMigration.meta.argsSchema.properties.operation.type, "string");
  const phases = [];
  const logs = [];
  const result = await definition.run({
    args: { operation: "inspect", workspaceFile: f.configPath, resourceId: "demo" },
    signal: new AbortController().signal,
    phase: (value) => phases.push(value),
    log: (value) => logs.push(value),
    // Deliberately no agent/session or checkpoint methods: readiness needs none.
  });
  assert.equal(result.status, "needs-initialization");
  assert.deepEqual(phases, ["Workspace readiness"]);
  assert.ok(logs[0].includes("No migration stage was completed"));
});

test("a cancelled native invocation does not initialize anything", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(definition.run({ args: { operation: "initialize", workspaceFile: f.configPath, resourceId: "demo" }, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(access(path.join(f.resourcesRoot, "demo")), { code: "ENOENT" });
});
