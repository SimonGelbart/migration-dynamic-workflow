import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { hasCode, keys, nonempty, object, repositoryRoles, WorkflowError, type Workspace } from "./model.mjs";

export async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw new WorkflowError("file-not-found", `File not found: ${file}`);
    throw new WorkflowError("file-unreadable", `Cannot read file: ${file}`, { cause: error });
  }
  try {
    // Windows editors may write a UTF-8 BOM.
    return JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch (error) {
    throw new WorkflowError("invalid-json", `Invalid JSON in ${file}.`, { cause: error });
  }
}

/** Resolve existing ancestors too, so a symlink cannot hide a path inside an application checkout. */
export async function canonicalPath(value: string): Promise<string> {
  const absolute = path.resolve(value);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonicalPath(parent), path.basename(absolute));
  }
}

export function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function nativePath(value: unknown, label: string): string {
  const result = nonempty(value, label);
  if (process.platform !== "win32" && (result.startsWith("\\") || /^[A-Za-z]:/.test(result))) {
    throw new WorkflowError("wrong-platform-path", `${label} is a Windows path; use a workspace configuration for this machine.`);
  }
  return result;
}

export async function loadWorkspace(configFile: string): Promise<Workspace> {
  const configPath = path.resolve(nativePath(configFile, "workspaceFile"));
  const config = object(await readJson(configPath), "workspace");
  keys(config, ["schemaVersion", "repositories", "resourcesRoot"], "workspace");
  if (config.schemaVersion !== 1) throw new WorkflowError("unsupported-version", "Workspace schemaVersion must be 1.");
  const repositories = object(config.repositories, "repositories");
  keys(repositories, [...repositoryRoles], "repositories");
  const root = path.dirname(configPath);
  const entries = await Promise.all(repositoryRoles.map(async (role) => [
    role, await canonicalPath(path.resolve(root, nativePath(repositories[role], `repositories.${role}`))),
  ] as const));
  const resolved = Object.fromEntries(entries) as Workspace["repositories"];
  const comparable = Object.values(resolved).map((p) => process.platform === "win32" ? p.toLowerCase() : p);
  if (new Set(comparable).size !== repositoryRoles.length) {
    throw new WorkflowError("duplicate-repository", "Each repository role must identify a different checkout.");
  }
  return {
    configPath,
    repositories: resolved,
    resourcesRoot: await canonicalPath(path.resolve(root, nativePath(config.resourcesRoot, "resourcesRoot"))),
  };
}

export async function requireDirectory(directory: string): Promise<void> {
  try {
    if ((await stat(directory)).isDirectory()) return;
  } catch (error) {
    throw new WorkflowError("directory-unavailable", `Directory unavailable: ${directory}`, { cause: error });
  }
  throw new WorkflowError("not-a-directory", `Expected a directory: ${directory}`);
}
