import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["README.md", "AGENTS.md", ".github/copilot-instructions.md"];
for (const file of await readdir(path.join(root, "docs"), { recursive: true })) {
  if (file.endsWith(".md")) files.push(path.join("docs", file));
}
const failures = [];
for (const file of files) {
  const contents = await readFile(path.join(root, file), "utf8");
  for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    try { await access(path.resolve(root, path.dirname(file), target)); }
    catch { failures.push(`${file}: missing link ${target}`); }
  }
  if (file.startsWith(`docs${path.sep}steps${path.sep}`)) {
    for (const label of ["Status", "Purpose", "Inputs", "Procedure", "Outputs", "Completion", "Decisions", "Recovery", "Next"]) {
      if (!contents.includes(`**${label}**`)) failures.push(`${file}: missing ${label}`);
    }
  }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Checked ${files.length} documentation files and their local links. Content coverage still needs review.`);
