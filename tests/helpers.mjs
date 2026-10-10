import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const execute = promisify(execFile);
export const roles = ["ihm", "entities", "api", "e2e"];

export async function git(directory, ...args) {
  return execute("git", ["-C", directory, ...args], { encoding: "utf8", windowsHide: true });
}

export async function fixture(t) {
  const temporaryRoot = fileURLToPath(new URL("../.local/test-fixtures/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "migration-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositories = Object.fromEntries(roles.map((role) => [role, path.join(root, role)]));
  await Promise.all(roles.map(async (role) => {
    await mkdir(repositories[role]);
    await git(repositories[role], "init", "--quiet");
  }));
  const configDir = path.join(root, "private workspace");
  await mkdir(configDir);
  const configPath = path.join(configDir, "workspace.json");
  const config = { schemaVersion: 1, repositories: Object.fromEntries(roles.map((role) => [role, `../${role}`])), resourcesRoot: "resources" };
  await writeFile(configPath, JSON.stringify(config));
  return { root, repositories, configDir, configPath, config, resourcesRoot: path.join(configDir, "resources") };
}

export async function commit(directory, name = "tracked.txt", text = "first\n") {
  await writeFile(path.join(directory, name), text);
  await git(directory, "add", "--", name);
  await git(directory, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
}

export async function treeBytes(directory) {
  const result = {};
  async function visit(current, relative = "") {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) await visit(path.join(current, item.name), name);
      else if (item.isFile()) result[name] = (await readFile(path.join(current, item.name))).toString("base64");
    }
  }
  await visit(directory);
  return result;
}
