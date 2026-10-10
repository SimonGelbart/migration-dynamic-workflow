import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadWorkspace } from "../.github/extensions/resource-migration/workspace.mjs";
import { resourceId } from "../.github/extensions/resource-migration/model.mjs";
import { fixture } from "./helpers.mjs";

test("resolves relative paths against a configuration outside the current directory, including spaces and BOM", async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, `\uFEFF${JSON.stringify(f.config)}`);
  const workspace = await loadWorkspace(f.configPath);
  assert.deepEqual(workspace.repositories, f.repositories);
  assert.equal(workspace.resourcesRoot, f.resourcesRoot);
});

test("rejects malformed, unsupported and incomplete configuration without creating resource directories", async (t) => {
  const f = await fixture(t);
  for (const [value, code] of [
    ["{broken", "invalid-json"],
    [JSON.stringify({ ...f.config, schemaVersion: 2 }), "unsupported-version"],
    [JSON.stringify({ ...f.config, repositories: { ihm: "../ihm" } }), "invalid-input"],
    [JSON.stringify({ ...f.config, unexpected: true }), "invalid-input"],
    [JSON.stringify({ ...f.config, resourcesRoot: "" }), "invalid-input"],
  ]) {
    await writeFile(f.configPath, value);
    await assert.rejects(loadWorkspace(f.configPath), { code });
  }
});

test("rejects duplicate repository roots", async (t) => {
  const f = await fixture(t);
  f.config.repositories.api = f.config.repositories.ihm;
  await writeFile(f.configPath, JSON.stringify(f.config));
  await assert.rejects(loadWorkspace(f.configPath), { code: "duplicate-repository" });
});

test("reports missing configuration and wrong platform paths explicitly", async (t) => {
  const f = await fixture(t);
  await assert.rejects(loadWorkspace(path.join(f.root, "missing.json")), { code: "file-not-found" });
  if (process.platform !== "win32") {
    f.config.repositories.ihm = "C:\\work\\ihm";
    await writeFile(f.configPath, JSON.stringify(f.config));
    await assert.rejects(loadWorkspace(f.configPath), { code: "wrong-platform-path" });
  }
});

test("resource IDs cannot traverse paths or create Windows device names", () => {
  for (const id of ["../api", "a/b", "a\\b", ".", "..", "", "Upper", "con", "lpt1", "a".repeat(65)]) {
    assert.throws(() => resourceId(id));
  }
  assert.equal(resourceId("group-membership-2"), "group-membership-2");
});

test("validates paths through existing ancestors", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.configDir, "existing"));
  f.config.resourcesRoot = "existing/not-created-yet";
  await writeFile(f.configPath, JSON.stringify(f.config));
  assert.equal((await loadWorkspace(f.configPath)).resourcesRoot, path.join(f.configDir, "existing", "not-created-yet"));
});
