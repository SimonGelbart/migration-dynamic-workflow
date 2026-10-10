import { defineWorkflow, type WorkflowDefinition } from "@github/copilot-sdk/extension";
import { initializeResource, inspectWorkspace } from "./inspect.mjs";
import { keys, nonempty, object, resourceId, WorkflowError, type Initialization, type Inspection } from "./model.mjs";

export type WorkflowInput = { operation: "inspect" | "initialize"; workspaceFile: string; resourceId: string };

export function parseWorkflowInput(value: unknown): WorkflowInput {
  const input = object(value, "workflow arguments");
  keys(input, ["operation", "workspaceFile", "resourceId"], "workflow arguments");
  if (input.operation !== "inspect" && input.operation !== "initialize") {
    throw new WorkflowError("unsupported-operation", "Only inspect and initialize are implemented.");
  }
  return { operation: input.operation, workspaceFile: nonempty(input.workspaceFile, "workspaceFile"), resourceId: resourceId(input.resourceId) };
}

export const definition: WorkflowDefinition<WorkflowInput, Inspection | Initialization> = {
  meta: {
    name: "resource-migration",
    description: "Inspect migration workspace readiness, or explicitly initialize a private resource record. Later migration stages are not implemented.",
    phases: [{ title: "Workspace readiness" }, { title: "Resource initialization" }],
    argsSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["inspect", "initialize"] },
        workspaceFile: { type: "string", description: "Workspace JSON path; prefer an absolute path." },
        resourceId: { type: "string", description: "Lowercase letters, digits and hyphens; starts with a letter." },
      },
      required: ["operation", "workspaceFile", "resourceId"],
    },
    limits: { maxConcurrentSubagents: 2 },
  },
  async run(context) {
    // The SDK schema validates only a subset of JSON Schema. Validate semantics here too.
    const input = parseWorkflowInput(context.args);
    context.signal.throwIfAborted();
    context.phase(input.operation === "inspect" ? "Workspace readiness" : "Resource initialization");
    // Read live files every time. A memoized readiness result could hide a manual edit on resume.
    const result = input.operation === "inspect"
      ? await inspectWorkspace(input.workspaceFile, input.resourceId)
      : await initializeResource(input.workspaceFile, input.resourceId, context.signal);
    context.signal.throwIfAborted();
    context.log(`${input.operation}: ${result.status}. No migration stage was completed.`);
    return result;
  },
};

export const resourceMigration = defineWorkflow(definition);
