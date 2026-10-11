import { constants } from "node:fs";
import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { snapshotRepository, workspaceFingerprint } from "./git.mjs";
import { withWriterLock } from "./lock.mjs";
import { hasCode, issue, nonempty, repositoryRoles, resourceId, WorkflowError, type Answer, type Initialization, type Inspection, type ResourceRecord, type Upgrade } from "./model.mjs";
import { createResource, originalV1Name, parseResource, readResource, replaceFile, resourcePath, serialize } from "./resource.mjs";
import { emptyStages, isCurrent, openDecisions, summarize } from "./stages.mjs";
import { loadWorkspace } from "./workspace.mjs";

function nextStatus(inspection: Pick<Inspection, "issues" | "resource" | "sourceFingerprint">): Pick<Inspection, "status" | "nextStep"> {
  const { resource, sourceFingerprint: fingerprint } = inspection;
  if (inspection.issues.length || (resource && !fingerprint)) return { status: "blocked", nextStep: { id: "00-mission-and-access", implemented: true } };
  if (!resource) return { status: "needs-initialization", nextStep: { id: "00-mission-and-access", implemented: true } };
  if (resource.schemaVersion === 1) return { status: "needs-upgrade", nextStep: { id: "00-mission-and-access", implemented: true } };
  const current = fingerprint as string;
  if (openDecisions(resource).length) return { status: "awaiting-decision", nextStep: { id: openDecisions(resource)[0]!.stage, implemented: true } };
  if (!isCurrent(resource, "01-legacy-discovery", current)) return { status: "ready-for-discovery", nextStep: { id: "01-legacy-discovery", implemented: true } };
  if (!isCurrent(resource, "02-target-definition", current)) return { status: "ready-for-target", nextStep: { id: "02-target-definition", implemented: true } };
  return { status: "ready-for-contracts", nextStep: { id: "03-contracts-and-validation", implemented: false } };
}

export async function inspectWorkspace(workspaceFile: string, selectedId: string): Promise<Inspection> {
  const id = resourceId(selectedId);
  const workspace = await loadWorkspace(workspaceFile);
  const file = await resourcePath(workspace, id);
  const issues: Inspection["issues"] = [];
  const snapshots = await Promise.allSettled(repositoryRoles.map((role) => snapshotRepository(role, workspace.repositories[role])));
  const repositories: Inspection["repositories"] = [];
  for (const result of snapshots) {
    if (result.status === "fulfilled") repositories.push(result.value);
    else issues.push(issue(result.reason));
  }
  try {
    if (!(await stat(workspace.resourcesRoot)).isDirectory()) {
      issues.push({ code: "not-a-directory", message: "resourcesRoot must identify a directory." });
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) issues.push(issue(error));
  }
  let resource: Inspection["resource"] = null;
  try { resource = await readResource(file, id); } catch (error) { issues.push(issue(error)); }
  const fingerprint = repositories.length === repositoryRoles.length ? workspaceFingerprint(workspace, repositories) : null;
  const initial = resource === null ? null : resource.schemaVersion === 1 ? resource.sourceFingerprint : resource.initialFingerprint;
  const base = { issues, resource, sourceFingerprint: fingerprint };
  return {
    schemaVersion: 2, operation: "inspect", ...nextStatus(base),
    workspacePath: workspace.configPath, repositories, resourcePath: file, resource,
    sourceFingerprint: fingerprint,
    sourcesChangedSinceInitialization: initial && fingerprint ? initial !== fingerprint : null,
    stages: resource?.schemaVersion === 2 ? summarize(resource, fingerprint) : [],
    openDecisions: resource?.schemaVersion === 2 ? openDecisions(resource) : [],
    issues, migrationComplete: false,
  };
}

export async function initializeResource(workspaceFile: string, selectedId: string, signal?: AbortSignal): Promise<Initialization> {
  signal?.throwIfAborted();
  const id = resourceId(selectedId);
  const inspection = await inspectWorkspace(workspaceFile, id);
  signal?.throwIfAborted();
  if (inspection.status === "blocked" || !inspection.sourceFingerprint) {
    throw new WorkflowError("workspace-blocked", `Initialization blocked: ${inspection.issues.map((item) => item.message).join(" ")}`);
  }
  if (inspection.resource) {
    return { schemaVersion: 2, operation: "initialize", status: "already-exists", resourcePath: inspection.resourcePath, resource: inspection.resource, migrationComplete: false };
  }
  const record: ResourceRecord = {
    schemaVersion: 2, id, createdAt: new Date().toISOString(), initialFingerprint: inspection.sourceFingerprint,
    revision: 1, stages: emptyStages(), decisions: [], upgradedFrom: null,
  };
  // Recheck path boundaries immediately before creating the record.
  const currentWorkspace = await loadWorkspace(workspaceFile);
  const file = await resourcePath(currentWorkspace, id);
  if (file !== inspection.resourcePath || inspection.repositories.some((r) => r.path !== currentWorkspace.repositories[r.role])) {
    throw new WorkflowError("workspace-changed", "Workspace paths changed during initialization. Retry inspection.");
  }
  signal?.throwIfAborted();
  const result = await createResource(file, record, signal);
  return { schemaVersion: 2, operation: "initialize", status: result.created ? "created" : "already-exists", resourcePath: file, resource: result.record, migrationComplete: false };
}

/**
 * Read, change and atomically replace a schemaVersion 2 record under the workspace writer lock.
 * `change` receives the record as currently stored, so concurrent answers are not lost.
 */
export async function updateResource(workspaceFile: string, id: string, owner: string, change: (record: ResourceRecord, directory: string) => Promise<ResourceRecord>): Promise<ResourceRecord> {
  const workspace = await loadWorkspace(workspaceFile);
  const file = await resourcePath(workspace, id);
  return withWriterLock(workspace.resourcesRoot, owner, async () => {
    const current = await readResource(file, id);
    if (!current) throw new WorkflowError("resource-missing", "Initialize the resource first.");
    if (current.schemaVersion !== 2) throw new WorkflowError("needs-upgrade", "This resource record uses schemaVersion 1. Run the explicit upgrade operation first.");
    const next = await change(current, path.dirname(file));
    if (next === current) return current;
    const stored = { ...next, revision: current.revision + 1 };
    parseResource(JSON.parse(serialize(stored)), id);
    await replaceFile(file, serialize(stored));
    return stored;
  });
}

/** Explicitly upgrade a schemaVersion 1 record. The original bytes are preserved beside it and never overwritten. */
export async function upgradeResource(workspaceFile: string, selectedId: string): Promise<Upgrade> {
  const id = resourceId(selectedId);
  const workspace = await loadWorkspace(workspaceFile);
  const file = await resourcePath(workspace, id);
  return withWriterLock(workspace.resourcesRoot, "upgrade", async () => {
    const current = await readResource(file, id);
    if (!current) throw new WorkflowError("resource-missing", "Initialize the resource first.");
    if (current.schemaVersion === 2) {
      return { schemaVersion: 2, operation: "upgrade", status: "already-current", resourcePath: file, preservedOriginal: current.upgradedFrom, resource: current, migrationComplete: false };
    }
    const original = path.join(path.dirname(file), originalV1Name);
    try {
      await copyFile(file, original, constants.COPYFILE_EXCL);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      if (await readFile(original, "utf8") !== await readFile(file, "utf8")) {
        throw new WorkflowError("upgrade-conflict", `${originalV1Name} already exists with different contents. Inspect both files; nothing was changed.`);
      }
    }
    const record: ResourceRecord = {
      schemaVersion: 2, id, createdAt: current.createdAt, initialFingerprint: current.sourceFingerprint,
      revision: 1, stages: emptyStages(), decisions: [], upgradedFrom: originalV1Name,
    };
    await replaceFile(file, serialize(record));
    return { schemaVersion: 2, operation: "upgrade", status: "upgraded", resourcePath: file, preservedOriginal: original, resource: record, migrationComplete: false };
  });
}

/** Record a human answer for an open decision. An answered decision is never overwritten. */
export async function answerDecision(workspaceFile: string, selectedId: string, decisionId: string, answerText: string): Promise<Answer> {
  const id = resourceId(selectedId);
  const text = nonempty(answerText, "answer").trim();
  if (text.length > 4000) throw new WorkflowError("invalid-input", "answer must be at most 4000 characters.");
  let recorded: Answer["decision"] | undefined;
  await updateResource(workspaceFile, id, "answer", async (record) => {
    const decision = record.decisions.find((d) => d.id === decisionId);
    if (!decision) throw new WorkflowError("decision-not-found", `No decision ${decisionId}. Run inspect to list open decisions.`);
    if (decision.answer !== null) throw new WorkflowError("decision-already-answered", `Decision ${decisionId} was already answered on ${decision.answeredAt}; it is not overwritten.`);
    recorded = { ...decision, answer: text, answeredAt: new Date().toISOString() };
    return { ...record, decisions: record.decisions.map((d) => d.id === decisionId ? recorded! : d) };
  });
  return { schemaVersion: 2, operation: "answer", status: "recorded", decision: recorded!, migrationComplete: false };
}
