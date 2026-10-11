import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { answerDecision, initializeResource, inspectWorkspace } from "../.github/extensions/resource-migration/inspect.mjs";
import { definition } from "../.github/extensions/resource-migration/workflow.mjs";
import { commit, fixture, treeBytes, workflowHarness } from "./helpers.mjs";

const pagesOutput = {
  coverage: ["Pages/Users.aspx"],
  findings: [
    { statement: "The users page lists accounts.", classification: "code-confirmed", evidence: [{ repository: "ihm", path: "Pages/Users.aspx", line: 1 }], question: null, affectsScope: false },
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

test("scope answers trigger investigation and target approval reuses the validated proposal", async (t) => {
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
  assert.equal(baseline.rejected.length, 0);
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
  assert.equal(h.agentCalls.length, 5, "two discovery passes and one target agent");
  assert.ok(h.agentCalls.filter((c) => c.options.label.startsWith("discovery:")).slice(2).every((c) => c.prompt.includes("active accounts only")));
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

const noScopeQuestions = () => standardAgents({ "discovery:ldap": async () => ({ coverage: [], findings: [] }) });

async function complete(t) {
  const preparedRun = await prepared(t);
  const h = workflowHarness(noScopeQuestions());
  await assert.rejects(preparedRun.run(h.attempt()), isPause);
  const approval = (await inspectWorkspace(preparedRun.f.configPath, "demo")).openDecisions[0];
  await answerDecision(preparedRun.f.configPath, "demo", approval.id, "approve");
  assert.equal((await preparedRun.run(h.attempt())).status, "complete");
  return { ...preparedRun, h, approval };
}

test("a target edited while paused cannot inherit the original approval", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const h = workflowHarness(noScopeQuestions());
  await assert.rejects(run(h.attempt()), isPause);
  const original = (await inspectWorkspace(f.configPath, "demo")).openDecisions[0];
  const file = path.join(resourceDir, "target/target.json");
  const target = JSON.parse(await readFile(file, "utf8"));
  target.requirements[0].requirement = "List accounts with last logon.";
  await writeFile(file, JSON.stringify(target));
  await answerDecision(f.configPath, "demo", original.id, "approve");
  await assert.rejects(run(h.attempt()), isPause);
  const after = await inspectWorkspace(f.configPath, "demo");
  assert.equal(after.stages[1].status, "awaiting-decision");
  const revised = after.openDecisions[0];
  assert.notEqual(revised.id, original.id);
  assert.equal(h.agentCalls.length, 3, "valid target edits are preserved without regeneration");
  assert.match(await readFile(path.join(resourceDir, "target/target.md"), "utf8"), /last logon/);
  await answerDecision(f.configPath, "demo", revised.id, "approve");
  assert.equal((await run(h.attempt())).status, "complete");
});

test("editing an approved target makes it stale and requires approval for its actual content", async (t) => {
  const { f, run, resourceDir, h, approval } = await complete(t);
  const file = path.join(resourceDir, "target/target.json");
  const target = JSON.parse(await readFile(file, "utf8"));
  target.requirements[0].requirement = "Show active accounts only.";
  target.revision = approval.source; // Stored revision cannot select an approval.
  await writeFile(file, JSON.stringify(target));
  const stale = await inspectWorkspace(f.configPath, "demo");
  assert.equal(stale.status, "ready-for-target");
  assert.equal(stale.stages[1].stale, true);
  await assert.rejects(run(h.attempt()), isPause);
  const next = (await inspectWorkspace(f.configPath, "demo")).openDecisions[0];
  assert.notEqual(next.id, approval.id);
});

test("invalid saved target requirements are preserved and never approved", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const h = workflowHarness(noScopeQuestions());
  await assert.rejects(run(h.attempt()), isPause);
  const approval = (await inspectWorkspace(f.configPath, "demo")).openDecisions[0];
  const file = path.join(resourceDir, "target/target.json");
  const target = JSON.parse(await readFile(file, "utf8"));
  target.requirements[0].findingIds = ["invented-finding"];
  const contents = JSON.stringify(target);
  await writeFile(file, contents);
  await answerDecision(f.configPath, "demo", approval.id, "approve");
  await assert.rejects(run(h.attempt()), { code: "invalid-stage-evidence" });
  assert.equal(await readFile(file, "utf8"), contents);
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-target");
});

test("invalid saved target metadata cannot be overwritten while applying approval", async (t) => {
  const { f, run, resourceDir } = await complete(t);
  const file = path.join(resourceDir, "target/target.json");
  const contents = "null";
  await writeFile(file, contents);
  await assert.rejects(run(workflowHarness(noScopeQuestions()).attempt()), { code: "invalid-stage-evidence" });
  assert.equal(await readFile(file, "utf8"), contents);
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-target");
});

test("a clarified scope investigates newly included pages even with unchanged source files", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  await commit(f.repositories.ihm, "Pages/Edit.aspx", "<asp:TextBox ID=\"Account\" />\n");
  const h = workflowHarness(standardAgents());
  await assert.rejects(run(h.attempt()), isPause);
  const before = await inspectWorkspace(f.configPath, "demo");
  await answerDecision(f.configPath, "demo", before.openDecisions[0].id, "Include the edit page and its child controls.");
  const stale = await inspectWorkspace(f.configPath, "demo");
  assert.equal(stale.sourceFingerprint, before.sourceFingerprint);
  assert.equal(stale.stages[0].stale, true);
  // A new native run must investigate the answer too, rather than trust the old checkpoint.
  const fresh = workflowHarness(standardAgents({
    "discovery:pages": async (prompt) => {
      assert.match(prompt, /Include the edit page and its child controls/);
      return { coverage: ["Pages/Edit.aspx"], findings: [{ statement: "Edit account.", classification: "code-confirmed", evidence: [{ repository: "ihm", path: "Pages/Edit.aspx", line: 1 }], question: null, affectsScope: false }] };
    },
  }));
  await assert.rejects(run(fresh.attempt()), isPause);
  assert.equal(fresh.agentCalls.filter((c) => c.options.label.startsWith("discovery:")).length, 2);
  const baseline = JSON.parse(await readFile(path.join(resourceDir, "discovery/legacy.json"), "utf8"));
  assert.ok(baseline.findings.some((finding) => finding.evidence.some((e) => e.path === "Pages/Edit.aspx")));
});

test("deleted evidence cannot report readiness and rerunning restores and checks the artifacts", async (t) => {
  const { f, run, resourceDir } = await complete(t);
  await rm(path.join(resourceDir, "discovery"), { recursive: true });
  await rm(path.join(resourceDir, "target"), { recursive: true });
  const missing = await inspectWorkspace(f.configPath, "demo");
  assert.equal(missing.status, "ready-for-discovery");
  assert.equal(missing.stages[0].stale, true);
  assert.equal(missing.stages[1].blocked, true);
  const fresh = workflowHarness(noScopeQuestions());
  const done = await run(fresh.attempt());
  assert.equal(done.status, "complete");
  assert.equal(fresh.agentCalls.length, 3);
  for (const file of ["discovery/legacy.json", "discovery/legacy.md", "target/target.json", "target/target.md"]) await access(path.join(resourceDir, file));
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-contracts");
});

test("edited baseline and missing markdown invalidate downstream evidence", async (t) => {
  const { f, run, resourceDir } = await complete(t);
  await writeFile(path.join(resourceDir, "discovery/legacy.json"), "{broken");
  assert.equal((await inspectWorkspace(f.configPath, "demo")).stages[1].blocked, true);
  assert.equal((await run(workflowHarness(noScopeQuestions()).attempt())).status, "complete");
  await rm(path.join(resourceDir, "target/target.md"));
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-target");
  const repair = workflowHarness(noScopeQuestions());
  assert.equal((await run(repair.attempt())).status, "complete");
  assert.equal(repair.agentCalls.length, 0, "markdown is rebuilt from validated JSON");
});

test("older version-2 records without artifact digests must reestablish evidence", async (t) => {
  const { f, run, resourceDir } = await complete(t);
  const file = path.join(resourceDir, "resource.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  for (const stage of Object.values(record.stages)) {
    delete stage.evidenceDigests;
    delete stage.inputDigest;
  }
  await writeFile(file, JSON.stringify(record));
  assert.equal((await inspectWorkspace(f.configPath, "demo")).status, "ready-for-discovery");
  const fresh = workflowHarness(noScopeQuestions());
  assert.equal((await run(fresh.attempt())).status, "complete");
  assert.equal(fresh.agentCalls.filter((c) => c.options.label.startsWith("discovery:")).length, 2);
});

test("rejected discovery findings block completion and retain rejection diagnostics", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const invalid = async () => ({ coverage: ["Users"], findings: [{ statement: "Unsupported behavior.", classification: "code-confirmed", evidence: [], question: null, affectsScope: false }] });
  const h = workflowHarness(standardAgents({ "discovery:pages": invalid, "discovery:ldap": invalid }));
  await assert.rejects(run(h.attempt()), { code: "invalid-agent-output" });
  const inspection = await inspectWorkspace(f.configPath, "demo");
  assert.equal(inspection.stages[0].status, "in-progress");
  assert.equal(inspection.stages[1].blocked, true);
  assert.equal(h.agentCalls.length, 2);
  const baseline = JSON.parse(await readFile(path.join(resourceDir, "discovery/legacy.json"), "utf8"));
  assert.equal(baseline.findings.length, 0);
  assert.equal(baseline.rejected.length, 2);
  assert.match(await readFile(path.join(resourceDir, "discovery/legacy.md"), "utf8"), /needs at least one source reference/);
  await assert.rejects(access(path.join(resourceDir, "target")), { code: "ENOENT" });
});

test("empty discovery cannot become a completed scope without evidence", async (t) => {
  const { run } = await prepared(t);
  const empty = async () => ({ coverage: [], findings: [] });
  await assert.rejects(run(workflowHarness(standardAgents({ "discovery:pages": empty, "discovery:ldap": empty })).attempt()), { code: "invalid-agent-output" });
});

test("rejected target requirements block approval and can be corrected by a new run", async (t) => {
  const { f, run } = await prepared(t);
  const invalid = workflowHarness(standardAgents({
    "discovery:ldap": async () => ({ coverage: [], findings: [] }),
    "target": async () => ({ requirements: [{ ...targetOutput.requirements[0], findingIds: ["invented"] }], exclusions: [] }),
  }));
  await assert.rejects(run(invalid.attempt()), { code: "invalid-agent-output" });
  const blocked = await inspectWorkspace(f.configPath, "demo");
  assert.equal(blocked.stages[1].status, "in-progress");
  assert.equal(blocked.openDecisions.length, 0);
  const corrected = workflowHarness(noScopeQuestions());
  await assert.rejects(run(corrected.attempt()), isPause);
  assert.match((await inspectWorkspace(f.configPath, "demo")).openDecisions[0].id, /^approve-/);
});

test("linked artifact directories cannot redirect reads or writes into application checkouts", async (t) => {
  for (const stage of ["discovery", "target"]) await t.test(stage, async (t) => {
    const { f, run, resourceDir } = await prepared(t);
    await symlink(f.repositories.api, path.join(resourceDir, stage), process.platform === "win32" ? "junction" : "dir");
    const before = await treeBytes(f.repositories.api);
    const inspection = await inspectWorkspace(f.configPath, "demo");
    assert.equal(inspection.status, "blocked");
    assert.ok(inspection.issues.some((i) => i.code === "invalid-artifact-path"));
    await assert.rejects(run(workflowHarness(noScopeQuestions()).attempt()), { code: "workspace-blocked" });
    assert.deepEqual(await treeBytes(f.repositories.api), before);
  });
});

test("a target agent cannot save evidence after changing the sources", async (t) => {
  const { f, run, resourceDir } = await prepared(t);
  const h = workflowHarness(standardAgents({
    "discovery:ldap": async () => ({ coverage: [], findings: [] }),
    "target": async () => {
      await writeFile(path.join(f.repositories.api, "unexpected.txt"), "changed");
      return structuredClone(targetOutput);
    },
  }));
  await assert.rejects(run(h.attempt()), { code: "stage-inputs-changed" });
  await assert.rejects(access(path.join(resourceDir, "target")), { code: "ENOENT" });
});
