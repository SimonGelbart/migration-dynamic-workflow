import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { WorkflowError, type RepositoryRole, type RepositorySnapshot, type Workspace } from "./model.mjs";
import { requireDirectory } from "./workspace.mjs";

const execute = promisify(execFile);

async function git(directory: string, args: string[]): Promise<string> {
  try {
    const result = await execute("git", ["-C", directory, ...args], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
      windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout;
  } catch (error) {
    throw new WorkflowError("git-check-failed", `Git inspection failed in ${directory}: ${args[0]}. Check Git availability, repository access and the 15-second/16-MiB inspection limits.`, { cause: error });
  }
}

export async function snapshotRepository(role: RepositoryRole, directory: string): Promise<RepositorySnapshot> {
  await requireDirectory(directory);
  const top = await realpath((await git(directory, ["rev-parse", "--show-toplevel"])).trim());
  if (path.relative(top, directory) !== "") {
    throw new WorkflowError("not-checkout-root", `${role} must point to the checkout root: ${top}`);
  }
  // --verify exits unsuccessfully for an unborn branch. Distinguish it using the object listing.
  const heads = await git(directory, ["log", "-1", "--format=%H", "--all"]);
  const head = heads.trim() === "" ? null : (await git(directory, ["rev-parse", "--verify", "HEAD"])).trim();
  const [status, staged, unstaged, untracked] = await Promise.all([
    git(directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(directory, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary"]),
    git(directory, ["diff", "--no-ext-diff", "--no-textconv", "--binary"]),
    git(directory, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const hash = createHash("sha256");
  for (const part of [head ?? "unborn", status, staged, unstaged]) {
    hash.update(String(Buffer.byteLength(part))).update(":").update(part);
  }
  for (const name of untracked.split("\0").filter(Boolean).sort()) {
    const file = path.join(directory, name);
    const info = await lstat(file);
    hash.update("file:").update(name).update("\0");
    if (info.isSymbolicLink()) {
      hash.update("symlink:").update(await readlink(file));
    } else if (info.isFile()) {
      const content = createHash("sha256");
      for await (const chunk of createReadStream(file)) content.update(chunk as Buffer);
      hash.update(content.digest());
    } else {
      throw new WorkflowError("unsupported-source-entry", `Cannot fingerprint an untracked non-file entry in ${role}.`);
    }
  }
  return { role, path: directory, head, dirty: status.length > 0, fingerprint: hash.digest("hex") };
}

export function workspaceFingerprint(workspace: Workspace, snapshots: RepositorySnapshot[]): string {
  return createHash("sha256").update(JSON.stringify({
    repositories: workspace.repositories,
    resourcesRoot: workspace.resourcesRoot,
    sources: snapshots.map(({ role, fingerprint }) => ({ role, fingerprint })),
  })).digest("hex");
}
