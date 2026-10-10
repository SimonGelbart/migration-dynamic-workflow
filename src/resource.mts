import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { hasCode, keys, object, resourceId, WorkflowError, type ResourceRecord, type Workspace } from "./model.mjs";
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

export function parseResource(value: unknown, expectedId: string): ResourceRecord {
  const record = object(value, "resource");
  keys(record, ["schemaVersion", "id", "stage", "status", "createdAt", "sourceFingerprint"], "resource");
  if (record.schemaVersion !== 1) throw new WorkflowError("unsupported-version", "Resource schemaVersion must be 1.");
  if (resourceId(record.id) !== expectedId) throw new WorkflowError("resource-id-mismatch", "The stored resource ID does not match the selected resource.");
  if (record.stage !== "legacy-discovery" || record.status !== "not-started") {
    throw new WorkflowError("unsupported-resource-state", "This skeleton supports only an unstarted legacy-discovery record; it cannot verify later migration states.");
  }
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new WorkflowError("invalid-resource-record", "Resource createdAt must be a date/time string.");
  }
  if (typeof record.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.sourceFingerprint)) {
    throw new WorkflowError("invalid-resource-record", "Resource sourceFingerprint must be a SHA-256 digest.");
  }
  return { schemaVersion: 1, id: expectedId, stage: "legacy-discovery", status: "not-started", createdAt: record.createdAt, sourceFingerprint: record.sourceFingerprint };
}

export async function readResource(file: string, id: string): Promise<ResourceRecord | null> {
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
export async function createResource(file: string, record: ResourceRecord, signal?: AbortSignal): Promise<{ created: boolean; record: ResourceRecord }> {
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
