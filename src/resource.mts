import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { hasCode, keys, nonempty, object, resourceId, stageIds, stageStatuses, WorkflowError, type Decision, type ResourceRecord, type ResourceRecordV1, type StageId, type StageStatus, type Workspace } from "./model.mjs";
import { canonicalPath, isWithin, readJson } from "./workspace.mjs";

export async function resourcePath(workspace: Workspace, id: string): Promise<string> {
  resourceId(id);
  const directory = path.join(workspace.resourcesRoot, id);
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WorkflowError("invalid-resource-directory", "The resource directory must be a real directory, not a link or file.");
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const canonical = await canonicalPath(directory);
  for (const repository of Object.values(workspace.repositories)) {
    if (isWithin(canonical, repository) || isWithin(repository, canonical)) {
      throw new WorkflowError("resource-overlaps-repository", "Resource records must be separate from the application checkouts.");
    }
  }
  return path.join(canonical, "resource.json");
}

const sha = /^[a-f0-9]{64}$/;

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new WorkflowError("invalid-resource-record", `${label} must be a date/time string.`);
  }
  return value;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : date(value, label);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha.test(value)) throw new WorkflowError("invalid-resource-record", `${label} must be a SHA-256 digest.`);
  return value;
}

export function parseResourceV1(record: Record<string, unknown>, expectedId: string): ResourceRecordV1 {
  keys(record, ["schemaVersion", "id", "stage", "status", "createdAt", "sourceFingerprint"], "resource");
  if (resourceId(record.id) !== expectedId) throw new WorkflowError("resource-id-mismatch", "The stored resource ID does not match the selected resource.");
  if (record.stage !== "legacy-discovery" || record.status !== "not-started") {
    throw new WorkflowError("unsupported-resource-state", "A schemaVersion 1 record can only be an unstarted legacy-discovery record.");
  }
  return { schemaVersion: 1, id: expectedId, stage: "legacy-discovery", status: "not-started", createdAt: date(record.createdAt, "Resource createdAt"), sourceFingerprint: digest(record.sourceFingerprint, "Resource sourceFingerprint") };
}

function parseDecision(value: unknown): Decision {
  const decision = object(value, "decision");
  keys(decision, ["id", "stage", "question", "source", "answer", "answeredAt"], "decision");
  if (typeof decision.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(decision.id)) throw new WorkflowError("invalid-resource-record", "Decision IDs use lowercase letters, digits and hyphens.");
  if (!stageIds.includes(decision.stage as StageId)) throw new WorkflowError("invalid-resource-record", `Decision ${decision.id} has an unknown stage.`);
  const answer = decision.answer === null ? null : nonempty(decision.answer, `decision ${decision.id} answer`);
  const answeredAt = nullableDate(decision.answeredAt, `decision ${decision.id} answeredAt`);
  if ((answer === null) !== (answeredAt === null)) throw new WorkflowError("invalid-resource-record", `Decision ${decision.id} must have both answer and answeredAt, or neither.`);
  return { id: decision.id, stage: decision.stage as StageId, question: nonempty(decision.question, "decision question"), source: nonempty(decision.source, "decision source"), answer, answeredAt };
}

function evidencePath(value: unknown): string {
  const text = nonempty(value, "stage evidence");
  if (path.isAbsolute(text) || text.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new WorkflowError("invalid-resource-record", "Stage evidence paths must be relative to the resource directory.");
  }
  return text;
}

export function parseResource(value: unknown, expectedId: string): ResourceRecord | ResourceRecordV1 {
  const record = object(value, "resource");
  if (record.schemaVersion === 1) return parseResourceV1(record, expectedId);
  if (record.schemaVersion !== 2) throw new WorkflowError("unsupported-version", "Resource schemaVersion must be 1 or 2.");
  keys(record, ["schemaVersion", "id", "createdAt", "initialFingerprint", "revision", "stages", "decisions", "upgradedFrom"], "resource");
  if (resourceId(record.id) !== expectedId) throw new WorkflowError("resource-id-mismatch", "The stored resource ID does not match the selected resource.");
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) throw new WorkflowError("invalid-resource-record", "Resource revision must be a positive integer.");
  const stagesValue = object(record.stages, "stages");
  keys(stagesValue, [...stageIds], "stages");
  const stages = Object.fromEntries(stageIds.map((id) => {
    const state = object(stagesValue[id], `stages.${id}`);
    keys(state, ["status", "basedOnFingerprint", "evidence", "updatedAt"], `stages.${id}`);
    if (!stageStatuses.includes(state.status as StageStatus)) throw new WorkflowError("invalid-resource-record", `stages.${id}.status is not a known status.`);
    if (!Array.isArray(state.evidence)) throw new WorkflowError("invalid-resource-record", `stages.${id}.evidence must be an array.`);
    const basedOnFingerprint = state.basedOnFingerprint === null ? null : digest(state.basedOnFingerprint, `stages.${id}.basedOnFingerprint`);
    if (state.status !== "not-started" && basedOnFingerprint === null) throw new WorkflowError("invalid-resource-record", `Started stage ${id} must record the fingerprint it was based on.`);
    return [id, { status: state.status as StageStatus, basedOnFingerprint, evidence: state.evidence.map(evidencePath), updatedAt: nullableDate(state.updatedAt, `stages.${id}.updatedAt`) }];
  })) as ResourceRecord["stages"];
  if (!Array.isArray(record.decisions)) throw new WorkflowError("invalid-resource-record", "Resource decisions must be an array.");
  const decisions = record.decisions.map(parseDecision);
  if (new Set(decisions.map((d) => d.id)).size !== decisions.length) throw new WorkflowError("invalid-resource-record", "Decision IDs must be unique.");
  if (record.upgradedFrom !== null && record.upgradedFrom !== originalV1Name) throw new WorkflowError("invalid-resource-record", `upgradedFrom must be null or ${originalV1Name}.`);
  return {
    schemaVersion: 2, id: expectedId, createdAt: date(record.createdAt, "Resource createdAt"),
    initialFingerprint: digest(record.initialFingerprint, "Resource initialFingerprint"),
    revision: record.revision as number, stages, decisions, upgradedFrom: record.upgradedFrom,
  };
}

export const originalV1Name = "resource.v1.json";

export async function readResource(file: string, id: string): Promise<ResourceRecord | ResourceRecordV1 | null> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new WorkflowError("invalid-resource-file", "resource.json must be a regular file, not a link.");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  return parseResource(await readJson(file), id);
}

/** Publish a complete record atomically without replacing any existing record. */
export async function createResource(file: string, record: ResourceRecord, signal?: AbortSignal): Promise<{ created: boolean; record: ResourceRecord | ResourceRecordV1 }> {
  signal?.throwIfAborted();
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.resource-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();
    try {
      await link(temporary, file);
      return { created: true, record };
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        throw new WorkflowError("resource-publish-failed", "Cannot atomically initialize the resource. Use a local filesystem supporting hard links (such as NTFS or ext4); no overwrite fallback is used.", { cause: error });
      }
      const existing = await readResource(file, record.id);
      if (!existing) throw new WorkflowError("resource-disappeared", "The resource changed concurrently. Retry inspection.");
      return { created: false, record: existing };
    }
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!hasCode(error, "ENOENT")) throw error; });
  }
}

/**
 * Atomically replace a private file (resource record or stage artifact). Callers must hold the writer lock.
 * Replacement is used only for the workflow's own records, never for application sources.
 */
export async function replaceFile(file: string, contents: string): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!hasCode(error, "ENOENT")) throw error; });
  }
}

export function serialize(record: ResourceRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
