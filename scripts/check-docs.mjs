import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["README.md", "AGENTS.md", ".github/copilot-instructions.md"];
for (const file of await readdir(path.join(root, "docs"), { recursive: true })) {
  if (file.endsWith(".md")) files.push(path.join("docs", file));
}
const failures = [];
// Step documents marked Implemented must match the operations the built workflow declares, and the reverse.
const built = path.join(root, ".github/extensions/resource-migration/workflow.mjs");
let implementedSteps;
try { ({ implementedSteps } = await import(pathToFileURL(built).href)); }
catch { failures.push("Build the extension (npm run build) before checking step status against the code."); }
const documentedImplemented = new Set();
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
    const status = /\*\*Status\*\*\s+(\S+)/.exec(contents)?.[1] ?? "";
    if (status.startsWith("Implemented")) documentedImplemented.add(path.basename(file, ".md"));
  }
}
if (implementedSteps) {
  for (const step of implementedSteps) if (!documentedImplemented.has(step)) failures.push(`docs/steps/${step}.md: the code implements this step but its Status is not Implemented`);
  for (const step of documentedImplemented) if (!implementedSteps.includes(step)) failures.push(`docs/steps/${step}.md: Status is Implemented but the workflow does not declare it`);
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Checked ${files.length} documentation files and their local links. Content coverage still needs review.`);
