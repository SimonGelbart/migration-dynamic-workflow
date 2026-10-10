import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { answerDecision, initializeResource, inspectWorkspace } from "../.github/extensions/resource-migration/inspect.mjs";
import { definition } from "../.github/extensions/resource-migration/workflow.mjs";
import { commit, fixture, treeBytes, workflowHarness } from "./helpers.mjs";

const pagesOutput = {
  coverage: ["Pages/Users.aspx"],
  findings: [
    { statement: "The users page lists accounts.", classification: "code-confirmed", evidence: [{ repository: "ihm", path: "Pages/Users.aspx", line: 1 }], question: null, affectsScope: false },
    { statement: "Escapes the checkout.", classification: "code-confirmed", evidence: [{ repository: "ihm", path: "../api/secret.txt", line: null }], question: null, affectsScope: false },
  ],
};
const ldapOutput = {
  coverage: ["Ldap/UserQuery.cs"],
  findings: [{ statement: "Disabled accounts may be filtered.", classification: "unresolved", evidence: [], question: "Are disabled accounts in scope?", affectsScope: true }],
};
const targetOutput = { requirements: [{ findingIds: ["pages-1"], disposition: "preserve", requirement: "List accounts.", question: null }], exclusions: [] };

function standardAgents(overrides = {}) {
  return async (prompt, options, controller) => {
    const kind = options.label.split(":").slice(0, 2).join(":");
    const override = Object.entries(overrides).find(([prefix]) => options.label.startsWith(`${prefix}:`));
    if (override) return override[1](prompt, options, controller);
    if (kind.startsWith("discovery:pages")) return structuredClone(pagesOutput);
    if (kind.startsWith("discovery:ldap")) return structuredClone(ldapOutput);
    return structuredClone(targetOutput);
  };
}

async function prepared(t) {
  const f = await fixture(t);
  await mkdir(path.join(f.repositories.ihm, "Pages"));
  await commit(f.repositories.ihm, "Pages/Users.aspx", "<asp:GridView ID=\"Users\" />\n");
  await mkdir(path.join(f.repositories.entities, "Ldap"));
  await commit(f.repositories.entities, "Ldap/UserQuery.cs", "// (objectClass=user)\n");
  await initializeResource(f.configPath, "demo");
  const run = (ctx) => definition.run({ ...ctx, args: { operation: "discover", workspaceFile: f.configPath, resourceId: "demo" } });
  return { f, run, resourceDir: path.join(f.resourcesRoot, "demo") };
}

const isPause = { name: "AbortError" };

test("discovery pauses for a scope decision and resumes through target approval without respawning agents", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const sourcesBefore = await treeBytes(f.repositories.ihm);
  const h = workflowHarness(standardAgents());

  await assert.rejects(run(h.attempt()), isPause);
  let inspection = await inspectWorkspace(f.configPath, "demo");
  assert.equal(inspection.status, "awaiting-decision");
  assert.equal(inspection.stages[0].status, "awaiting-decision");
  assert.equal(inspection.openDecisions.length, 1);
  const scope = inspection.openDecisions[0];
  assert.equal(scope.question, "Are disabled accounts in scope?");
  assert.equal(h.pauses[0], `decision/demo/01-legacy-discovery/${scope.id}`);
  const baseline = JSON.parse(await readFile(path.join(resourceDir, "discovery/legacy.json"), "utf8"));
  assert.deepEqual(baseline.findings.map((x) => [x.id, x.classification]), [["pages-1", "code-confirmed"], ["ldap-1", "unresolved"]]);
  assert.equal(baseline.rejected.length, 1);
  assert.match(baseline.rejected[0].reason, /leaves the ihm checkout/);
  await assert.rejects(access(path.join(f.resourcesRoot, ".writer.lock")), { code: "ENOENT" });

  // Resuming without an answer reports the open decision instead of pausing twice at a one-shot checkpoint.
  const unanswered = await run(h.attempt());
  assert.equal(unanswered.status, "awaiting-decision");

  await answerDecision(f.configPath, "demo", scope.id, "No, active accounts only.");
  await assert.rejects(run(h.attempt()), isPause);
  inspection = await inspectWorkspace(f.configPath, "demo");
  assert.equal(inspection.stages[0].status, "complete");
  assert.equal(inspection.stages[1].status, "awaiting-decision");
  const approval = inspection.openDecisions[0];
  assert.match(approval.id, /^approve-[a-f0-9]{12}$/);
  assert.match(await readFile(path.join(resourceDir, "discovery/legacy.md"), "utf8"), /active accounts only/);
  const targetPrompt = h.agentCalls.find((call) => call.options.label.startsWith("target:")).prompt;
  assert.match(targetPrompt, /active accounts only/);

  await answerDecision(f.configPath, "demo", approval.id, "approve");
  const done = await run(h.attempt());
  assert.equal(done.status, "complete");
  assert.deepEqual(done.nextStep, { id: "03-contracts-and-validation", implemented: false });
  assert.equal(done.migrationComplete, false);
  assert.equal(h.agentCalls.length, 3, "two discovery agents and one target agent");
  inspection = await inspectWorkspace(f.configPath, "demo");
  assert.equal(inspection.status, "ready-for-contracts");
  const target = JSON.parse(await readFile(path.join(resourceDir, "target/target.json"), "utf8"));
  assert.equal(`approve-${target.revision}`, approval.id);
  assert.deepEqual(await treeBytes(f.repositories.ihm), sourcesBefore);
});

test("a hand edit made while paused is detected and the stale evidence is rediscovered, keeping recorded answers", async (t) => {
  const { f, run } = await prepared(t);
  const h = workflowHarness(standardAgents());
  await assert.rejects(run(h.attempt()), isPause);
  const before = await inspectWorkspace(f.configPath, "demo");
  const scope = before.openDecisions[0];
  await answerDecision(f.configPath, "demo", scope.id, "Active accounts only.");
  await writeFile(path.join(f.repositories.ihm, "Pages/Users.aspx"), "<asp:GridView ID=\"Users\" AllowPaging=\"true\" />\n");

  const stale = await inspectWorkspace(f.configPath, "demo");
  assert.equal(stale.stages[0].stale, true);
  const resumed = h.attempt();
  await assert.rejects(run(resumed), isPause);
  assert.ok(resumed.logs.some((line) => line.includes("Sources changed")));
  assert.equal(h.agentCalls.filter((c) => c.options.label.startsWith("discovery:")).length, 4);
  const after = await inspectWorkspace(f.configPath, "demo");
  assert.equal(after.stages[0].status, "complete");
  assert.equal(after.stages[0].stale, false);
  assert.equal(after.resource.stages["01-legacy-discovery"].basedOnFingerprint, after.sourceFingerprint);
  assert.equal(after.resource.decisions.find((d) => d.id === scope.id).answer, "Active accounts only.");
});

test("cancellation in the middle of discovery saves nothing and releases the writer lock", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const record = await readFile(path.join(resourceDir, "resource.json"), "utf8");
  const h = workflowHarness(standardAgents({
    "discovery:ldap": async (_prompt, _options, controller) => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  }));
  await assert.rejects(run(h.attempt()), { name: "AbortError" });
  assert.equal(await readFile(path.join(resourceDir, "resource.json"), "utf8"), record);
  await assert.rejects(access(path.join(resourceDir, "discovery")), { code: "ENOENT" });
  await assert.rejects(access(path.join(f.resourcesRoot, ".writer.lock")), { code: "ENOENT" });
});

test("a discovery agent that changes sources invalidates its output before anything is saved", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const h = workflowHarness(standardAgents({
    "discovery:pages": async () => {
      await writeFile(path.join(f.repositories.ihm, "agent-wrote-this.txt"), "x");
      return structuredClone(pagesOutput);
    },
  }));
  await assert.rejects(run(h.attempt()), { code: "sources-changed-during-discovery" });
  await assert.rejects(access(path.join(resourceDir, "discovery")), { code: "ENOENT" });
});

test("a failed agent result stops the stage and leaves the record unchanged", async (t) => {
  const { run, resourceDir } = await prepared(t);
  const record = await readFile(path.join(resourceDir, "resource.json"), "utf8");
  const h = workflowHarness(standardAgents({ "discovery:ldap": async () => null }));
  await assert.rejects(run(h.attempt()), { code: "discovery-agent-failed" });
  assert.equal(await readFile(path.join(resourceDir, "resource.json"), "utf8"), record);
});

test("a rejected target revision is reported and the next run revises it using the recorded answer", async (t) => {
  const { f, run } = await prepared(t);
  const noQuestions = standardAgents({ "discovery:ldap": async () => ({ coverage: [], findings: [] }) });
  const h = workflowHarness(noQuestions);
  await assert.rejects(run(h.attempt()), isPause);
  const approval = (await inspectWorkspace(f.configPath, "demo")).openDecisions[0];
  await answerDecision(f.configPath, "demo", approval.id, "Also show the account's last logon.");
  const rejected = await run(h.attempt());
  assert.equal(rejected.status, "target-rejected");

  const revised = workflowHarness(standardAgents({
    "discovery:ldap": async () => ({ coverage: [], findings: [] }),
    "target": async (prompt) => {
      assert.match(prompt, /last logon/);
      return { requirements: [{ findingIds: ["pages-1"], disposition: "change", requirement: "List accounts with last logon.", question: null }], exclusions: [] };
    },
  }));
  await assert.rejects(run(revised.attempt()), isPause);
  const next = (await inspectWorkspace(f.configPath, "demo")).openDecisions[0];
  assert.notEqual(next.id, approval.id);
  assert.equal(revised.agentCalls.filter((c) => c.options.label.startsWith("discovery:")).length, 0, "current discovery evidence is reused");
});
