import { hostname } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasCode, WorkflowError } from "./model.mjs";

export type LockOwner = { owner: string; pid: number; host: string; acquiredAt: string };

export function lockPath(resourcesRoot: string): string {
  return path.join(resourcesRoot, ".writer.lock");
}

/**
 * Hold the workspace-wide writer lock while `action` runs. One migration writer per workspace.
 * The lock is a directory created exclusively; it is never broken automatically.
 */
export async function withWriterLock<T>(resourcesRoot: string, owner: string, action: () => Promise<T>): Promise<T> {
  const directory = lockPath(resourcesRoot);
  await mkdir(resourcesRoot, { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw new WorkflowError("lock-failed", `Cannot create the writer lock at ${directory}.`, { cause: error });
    let holder = "an unknown owner";
    try {
      const info = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")) as LockOwner;
      holder = `${info.owner} (process ${info.pid} on ${info.host}, since ${info.acquiredAt})`;
    } catch { /* The holder may still be writing its owner file. */ }
    throw new WorkflowError("writer-locked", `Another migration writer holds the workspace lock: ${holder}. Retry when it finishes. If no migration process is running, remove ${directory}.`);
  }
  try {
    const info: LockOwner = { owner, pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() };
    await writeFile(path.join(directory, "owner.json"), `${JSON.stringify(info)}\n`, { flag: "wx" });
    return await action();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
