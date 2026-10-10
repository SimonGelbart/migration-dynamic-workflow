import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspectWorkspace, initializeResource } from "../.github/extensions/resource-migration/inspect.mjs";
import { snapshotRepository } from "../.github/extensions/resource-migration/git.mjs";
import { commit, fixture, git, treeBytes } from "./helpers.mjs";

test("inspection accepts unborn repositories and does not write even Git indexes or private records", async (t) => {
  const f = await fixture(t);
  const before = await treeBytes(f.root);
  const result = await inspectWorkspace(f.configPath, "demo");
  assert.equal(result.status, "needs-initialization");
  assert.equal(result.repositories.length, 4);
  assert.ok(result.repositories.every((r) => r.head === null));
  assert.equal(result.migrationComplete, false);
  assert.equal(result.nextStep.implemented, false);
  assert.deepEqual(await treeBytes(f.root), before);
});

test("missing repositories block initialization without creating records", async (t) => {
  const f = await fixture(t);
  await rm(f.repositories.api, { recursive: true });
  const result = await inspectWorkspace(f.configPath, "demo");
  assert.equal(result.status, "blocked");
  assert.equal(result.sourceFingerprint, null);
  await assert.rejects(initializeResource(f.configPath, "demo"), { code: "workspace-blocked" });
  await assert.rejects(access(f.resourcesRoot), { code: "ENOENT" });
});

test("a plain folder is not a checkout and a subdirectory is not accepted as the checkout root", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.repositories.api, ".git"), { recursive: true });
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "blocked");
  const nested = path.join(f.repositories.ihm, "nested");
  await mkdir(nested);
  await assert.rejects(snapshotRepository("ihm", nested), { code: "not-checkout-root" });
});

test("a real Git worktree with a .git file is supported", async (t) => {
  const f = await fixture(t);
  await commit(f.repositories.api);
  const worktree = path.join(f.root, "api worktree");
  await git(f.repositories.api, "worktree", "add", "--detach", worktree);
  f.config.repositories.api = "../api worktree";
  await writeFile(f.configPath, JSON.stringify(f.config));
  const result = await inspectWorkspace(f.configPath, "demo");
  assert.equal(result.status, "needs-initialization");
  assert.equal(result.repositories.find((r) => r.role === "api").path, worktree);
});

test("initialization persists one complete record and preserves it across repeated calls", async (t) => {
  const f = await fixture(t);
  const first = await initializeResource(f.configPath, "demo");
  assert.equal(first.status, "created");
  assert.equal(first.resource.status, "not-started");
  const bytes = await readFile(first.resourcePath, "utf8");
  const again = await initializeResource(f.configPath, "demo");
  assert.equal(again.status, "already-exists");
  assert.equal(await readFile(first.resourcePath, "utf8"), bytes);
  const result = await inspectWorkspace(f.configPath, "demo");
  assert.equal(result.status, "ready-for-discovery");
  assert.equal(result.sourcesChangedSinceInitialization, false);
  assert.equal(result.migrationComplete, false);
});

test("concurrent initializations publish one record without truncating or overwriting it", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([initializeResource(f.configPath, "demo"), initializeResource(f.configPath, "demo")]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["already-exists", "created"]);
  assert.deepEqual(results[0].resource, results[1].resource);
  assert.deepEqual(await readdir(path.dirname(results[0].resourcePath)), ["resource.json"]);
});

test("cancellation during readiness does not publish a resource record", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = initializeResource(f.configPath, "demo", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(access(f.resourcesRoot), { code: "ENOENT" });
});

test("corrupt or unsupported existing resource records block progress and remain untouched", async (t) => {
  const f = await fixture(t);
  const initial = await initializeResource(f.configPath, "demo");
  for (const contents of ["{broken", JSON.stringify({ ...initial.resource, schemaVersion: 99 }), JSON.stringify({ ...initial.resource, status: "completed" }), JSON.stringify({ ...initial.resource, id: "another" })]) {
    await writeFile(initial.resourcePath, contents);
    assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "blocked");
    await assert.rejects(initializeResource(f.configPath, "demo"), { code: "workspace-blocked" });
    assert.equal(await readFile(initial.resourcePath, "utf8"), contents);
  }
});

test("resource output cannot overlap an application checkout", async (t) => {
  const f = await fixture(t);
  f.config.resourcesRoot = "../api";
  await writeFile(f.configPath, JSON.stringify(f.config));
  const before = await treeBytes(f.repositories.api);
  await assert.rejects(initializeResource(f.configPath, "demo"), { code: "resource-overlaps-repository" });
  assert.deepEqual(await treeBytes(f.repositories.api), before);
});

test("symlinked resource directories cannot redirect initialization", async (t) => {
  const f = await fixture(t);
  await mkdir(f.resourcesRoot);
  await symlink(f.repositories.api, path.join(f.resourcesRoot, "demo"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(initializeResource(f.configPath, "demo"), { code: "invalid-resource-directory" });
  await assert.rejects(access(path.join(f.repositories.api, "resource.json")), { code: "ENOENT" });
});

test("fingerprints detect tracked, staged and untracked content changes without demanding a clean tree", async (t) => {
  const f = await fixture(t);
  await commit(f.repositories.api);
  const initial = await initializeResource(f.configPath, "demo");
  await writeFile(path.join(f.repositories.api, "tracked.txt"), "second\n");
  const dirty = await inspectWorkspace(f.configPath, "demo");
  assert.equal(dirty.status, "ready-for-discovery");
  assert.equal(dirty.sourcesChangedSinceInitialization, true);
  await git(f.repositories.api, "add", "tracked.txt");
  const staged = await inspectWorkspace(f.configPath, "demo");
  assert.notEqual(staged.sourceFingerprint, dirty.sourceFingerprint);
  await writeFile(path.join(f.repositories.api, "untracked.txt"), "one");
  const untracked = await inspectWorkspace(f.configPath, "demo");
  await writeFile(path.join(f.repositories.api, "untracked.txt"), "two");
  const edited = await inspectWorkspace(f.configPath, "demo");
  assert.notEqual(untracked.sourceFingerprint, edited.sourceFingerprint);
  assert.equal(JSON.parse(await readFile(initial.resourcePath, "utf8")).sourceFingerprint, initial.resource.sourceFingerprint);
});
