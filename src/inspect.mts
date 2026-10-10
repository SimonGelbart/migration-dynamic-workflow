import { stat } from "node:fs/promises";
import { snapshotRepository, workspaceFingerprint } from "./git.mjs";
import { hasCode, issue, repositoryRoles, resourceId, WorkflowError, type Initialization, type Inspection, type ResourceRecord } from "./model.mjs";
import { createResource, readResource, resourcePath } from "./resource.mjs";
import { loadWorkspace } from "./workspace.mjs";

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
  let resource: ResourceRecord | null = null;
  try { resource = await readResource(file, id); } catch (error) { issues.push(issue(error)); }
  const fingerprint = repositories.length === repositoryRoles.length ? workspaceFingerprint(workspace, repositories) : null;
  return {
    schemaVersion: 1, operation: "inspect",
    status: issues.length ? "blocked" : resource ? "ready-for-discovery" : "needs-initialization",
    workspacePath: workspace.configPath, repositories, resourcePath: file, resource,
    sourceFingerprint: fingerprint,
    sourcesChangedSinceInitialization: resource && fingerprint ? resource.sourceFingerprint !== fingerprint : null,
    issues, nextStep: { id: "01-legacy-discovery", implemented: false }, migrationComplete: false,
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
    return { schemaVersion: 1, operation: "initialize", status: "already-exists", resourcePath: inspection.resourcePath, resource: inspection.resource, migrationComplete: false };
  }
  const record: ResourceRecord = {
    schemaVersion: 1, id, stage: "legacy-discovery", status: "not-started",
    createdAt: new Date().toISOString(), sourceFingerprint: inspection.sourceFingerprint,
  };
  // Recheck path boundaries immediately before creating the record.
  const currentWorkspace = await loadWorkspace(workspaceFile);
  const file = await resourcePath(currentWorkspace, id);
  if (file !== inspection.resourcePath || inspection.repositories.some((r) => r.path !== currentWorkspace.repositories[r.role])) {
    throw new WorkflowError("workspace-changed", "Workspace paths changed during initialization. Retry inspection.");
  }
  signal?.throwIfAborted();
  const result = await createResource(file, record, signal);
  return { schemaVersion: 1, operation: "initialize", status: result.created ? "created" : "already-exists", resourcePath: file, resource: result.record, migrationComplete: false };
}
