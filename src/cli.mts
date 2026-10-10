import { parseArgs } from "node:util";
import { initializeResource, inspectWorkspace } from "./inspect.mjs";
import { issue, nonempty, WorkflowError } from "./model.mjs";

try {
  const { positionals, values } = parseArgs({
    options: { workspace: { type: "string" }, resource: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true, strict: true,
  });
  if (values.help) {
    process.stdout.write("Usage: npm run inspect|initialize -- --workspace <workspace.json> --resource <id>\n");
  } else {
    const operation = positionals[0];
    if (positionals.length !== 1 || (operation !== "inspect" && operation !== "initialize")) {
      throw new WorkflowError("unsupported-operation", "Choose exactly one operation: inspect or initialize.");
    }
    const workspace = nonempty(values.workspace, "--workspace");
    const id = nonempty(values.resource, "--resource");
    const result = operation === "inspect" ? await inspectWorkspace(workspace, id) : await initializeResource(workspace, id);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "blocked") process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: issue(error) })}\n`);
  process.exitCode = 1;
}
