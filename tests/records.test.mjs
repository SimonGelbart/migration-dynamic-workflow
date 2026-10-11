import assert from "node:assert/strict";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { answerDecision, initializeResource, inspectWorkspace, updateResource, upgradeResource } from "../.github/extensions/resource-migration/inspect.mjs";
import { emptyStages, transition } from "../.github/extensions/resource-migration/stages.mjs";
import { parseWorkflowInput } from "../.github/extensions/resource-migration/workflow.mjs";
import { definition } from "../.github/extensions/resource-migration/workflow.mjs";
import { fixture, workflowHarness } from "./helpers.mjs";
import { replaceFile } from "../.github/extensions/resource-migration/resource.mjs";

const a = "a".repeat(64);
const b = "b".repeat(64);
const record = () => ({ schemaVersion: 2, id: "demo", createdAt: new Date(0).toISOString(), initialFingerprint: a, revision: 1, stages: emptyStages(), decisions: [], upgradedFrom: null });
const now = new Date(0).toISOString();

test("code-owned transitions reject skipped, blocked and undecided moves", () => {
  assert.throws(() => transition(record(), "01-legacy-discovery", "complete", a, [], now), { code: "invalid-transition" });
  assert.throws(() => transition(record(), "02-target-definition", "in-progress", a, [], now), { code: "stage-blocked" });
  let r = transition(record(), "01-legacy-discovery", "in-progress", a, [], now);
  r = { ...r, decisions: [{ id: "q-1", stage: "01-legacy-discovery", question: "?", source: "x", answer: null, answeredAt: null }] };
  assert.throws(() => transition(r, "01-legacy-discovery", "complete", a, [], now), { code: "decisions-open" });
  r = transition({ ...r, decisions: [] }, "01-legacy-discovery", "complete", a, [], now);
  // Discovery evidence for other sources does not unblock the target.
  assert.throws(() => transition(r, "02-target-definition", "in-progress", b, [], now), { code: "stage-blocked" });
  assert.equal(transition(r, "02-target-definition", "in-progress", a, [], now).stages["02-target-definition"].status, "in-progress");
});

test("a schemaVersion 1 record requires an explicit upgrade that preserves the original", async (t) => {
  const f = await fixture(t);
  const dir = path.join(f.resourcesRoot, "demo");
  await mkdir(dir, { recursive: true });
  const v1 = `${JSON.stringify({ schemaVersion: 1, id: "demo", stage: "legacy-discovery", status: "not-started", createdAt: now, sourceFingerprint: a }, null, 2)}\n`;
  await writeFile(path.join(dir, "resource.json"), v1);
  const inspection = await inspectWorkspace(f.configPath, "demo");
  assert.equal(inspection.status, "needs-upgrade");
  assert.equal(inspection.sourcesChangedSinceInitialization, true);
  const discover = definition.run({ ...workflowHarness(async () => null).attempt(), args: { operation: "discover", workspaceFile: f.configPath, resourceId: "demo" } });
  await assert.rejects(discover, { code: "needs-upgrade" });
  assert.equal(await readFile(path.join(dir, "resource.json"), "utf8"), v1);

  const upgraded = await upgradeResource(f.configPath, "demo");
  assert.equal(upgraded.status, "upgraded");
  assert.equal(await readFile(path.join(dir, "resource.v1.json"), "utf8"), v1);
  assert.equal(upgraded.resource.initialFingerprint, a);
  assert.equal(upgraded.resource.createdAt, now);
  assert.equal((await upgradeResource(f.configPath, "demo")).status, "already-current");
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-discovery");
});

test("an upgrade never overwrites a different preserved original", async (t) => {
  const f = await fixture(t);
  const dir = path.join(f.resourcesRoot, "demo");
  await mkdir(dir, { recursive: true });
  const v1 = JSON.stringify({ schemaVersion: 1, id: "demo", stage: "legacy-discovery", status: "not-started", createdAt: now, sourceFingerprint: a });
  await writeFile(path.join(dir, "resource.json"), v1);
  await writeFile(path.join(dir, "resource.v1.json"), "other");
  await assert.rejects(upgradeResource(f.configPath, "demo"), { code: "upgrade-conflict" });
  assert.equal(await readFile(path.join(dir, "resource.json"), "utf8"), v1);
  assert.equal(await readFile(path.join(dir, "resource.v1.json"), "utf8"), "other");
});

test("the workspace writer lock blocks other writers, names its holder and is never broken automatically", async (t) => {
  const f = await fixture(t);
  await initializeResource(f.configPath, "demo");
  let inner;
  await updateResource(f.configPath, "demo", "first writer", async (r) => {
    inner = await upgradeResource(f.configPath, "demo").catch((error) => error);
    return r;
  });
  assert.equal(inner.code, "writer-locked");
  assert.match(inner.message, /first writer/);
  await assert.rejects(access(path.join(f.resourcesRoot, ".writer.lock")), { code: "ENOENT" });
  await mkdir(path.join(f.resourcesRoot, ".writer.lock"));
  await assert.rejects(upgradeResource(f.configPath, "demo"), { code: "writer-locked" });
  await access(path.join(f.resourcesRoot, ".writer.lock"));
});

test("answers are recorded once and never overwritten", async (t) => {
  const f = await fixture(t);
  await initializeResource(f.configPath, "demo");
  await updateResource(f.configPath, "demo", "test", async (r) => ({ ...r, decisions: [{ id: "q-1", stage: "01-legacy-discovery", question: "In scope?", source: "x", answer: null, answeredAt: null }] }));
  await assert.rejects(answerDecision(f.configPath, "demo", "q-2", "yes"), { code: "decision-not-found" });
  const answer = await answerDecision(f.configPath, "demo", "q-1", "yes");
  assert.equal(answer.decision.answer, "yes");
  await assert.rejects(answerDecision(f.configPath, "demo", "q-1", "no"), { code: "decision-already-answered" });
  const stored = (await inspectWorkspace(f.configPath, "demo")).resource;
  assert.equal(stored.decisions[0].answer, "yes");
  assert.equal(stored.revision, 3);
});

test("invalid workflow arguments name the problem and the accepted values", () => {
  const valid = { operation: "inspect", workspaceFile: "workspace.json", resourceId: "demo" };
  assert.throws(() => parseWorkflowInput({ ...valid, extra: 1 }), /unsupported fields: extra\. Expected: operation, workspaceFile, resourceId/);
  assert.throws(() => parseWorkflowInput({ ...valid, operation: "migrate" }), /Use one of: inspect, initialize, upgrade, discover/);
});

test("the write boundary rejects linked parents and files outside the private root", async (t) => {
  const f = await fixture(t);
  const initialized = await initializeResource(f.configPath, "demo");
  const privateRoot = path.dirname(initialized.resourcePath);
  await symlink(f.repositories.api, path.join(privateRoot, "discovery"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(replaceFile(path.join(privateRoot, "discovery/legacy.json"), "{}", privateRoot), { code: "invalid-artifact-path" });
  await assert.rejects(replaceFile(path.join(f.repositories.api, "legacy.json"), "{}", privateRoot), { code: "invalid-artifact-path" });
  await assert.rejects(access(path.join(f.repositories.api, "legacy.json")), { code: "ENOENT" });
});
