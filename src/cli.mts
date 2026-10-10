import { parseArgs } from "node:util";
import { answerDecision, initializeResource, inspectWorkspace, upgradeResource } from "./inspect.mjs";
import { issue, nonempty, WorkflowError } from "./model.mjs";

const usage = `Usage:
  npm run inspect|initialize|upgrade -- --workspace <workspace.json> --resource <id>
  npm run answer -- --workspace <workspace.json> --resource <id> --decision <decision-id> --answer <text>
Discovery uses agents and runs only as the native resource-migration workflow (operation "discover").
`;

try {
  const { positionals, values } = parseArgs({
    options: {
      workspace: { type: "string" }, resource: { type: "string" }, decision: { type: "string" }, answer: { type: "string" }, help: { type: "boolean" },
    },
    allowPositionals: true, strict: true,
  });
  if (values.help) {
    process.stdout.write(usage);
  } else {
    const operation = positionals[0];
    if (positionals.length !== 1 || !["inspect", "initialize", "upgrade", "answer"].includes(operation ?? "")) {
      throw new WorkflowError("unsupported-operation", "Choose exactly one operation: inspect, initialize, upgrade or answer.");
    }
    if (operation !== "answer" && (values.decision !== undefined || values.answer !== undefined)) {
      throw new WorkflowError("invalid-input", "--decision and --answer apply only to the answer operation.");
    }
    const workspace = nonempty(values.workspace, "--workspace");
    const id = nonempty(values.resource, "--resource");
    const result = operation === "inspect" ? await inspectWorkspace(workspace, id)
      : operation === "initialize" ? await initializeResource(workspace, id)
        : operation === "upgrade" ? await upgradeResource(workspace, id)
          : await answerDecision(workspace, id, nonempty(values.decision, "--decision"), nonempty(values.answer, "--answer"));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "blocked") process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: issue(error) })}\n`);
  process.exitCode = 1;
}
