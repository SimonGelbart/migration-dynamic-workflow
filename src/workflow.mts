import { defineWorkflow, type WorkflowDefinition } from "@github/copilot-sdk/extension";
import { discoverResource, type DiscoveryResult } from "./discovery.mjs";
import { initializeResource, inspectWorkspace, upgradeResource } from "./inspect.mjs";
import { keys, nonempty, object, resourceId, WorkflowError, type Initialization, type Inspection, type Upgrade } from "./model.mjs";

export const operations = ["inspect", "initialize", "upgrade", "discover"] as const;
export type Operation = (typeof operations)[number];
export type WorkflowInput = { operation: Operation; workspaceFile: string; resourceId: string };

/** Step documents whose Status is Implemented. The documentation check enforces agreement in both directions. */
export const implementedSteps = ["00-mission-and-access", "01-legacy-discovery", "02-target-definition"] as const;

export function parseWorkflowInput(value: unknown): WorkflowInput {
  const input = object(value, "workflow arguments");
  keys(input, ["operation", "workspaceFile", "resourceId"], "workflow arguments");
  if (!operations.includes(input.operation as Operation)) {
    throw new WorkflowError("unsupported-operation", `Unsupported operation ${JSON.stringify(input.operation)}. Use one of: ${operations.join(", ")}.`);
  }
  return { operation: input.operation as Operation, workspaceFile: nonempty(input.workspaceFile, "workspaceFile"), resourceId: resourceId(input.resourceId) };
}

const phases = { inspect: "Workspace readiness", initialize: "Resource initialization", upgrade: "Resource upgrade" } as const;

export const definition: WorkflowDefinition<WorkflowInput, Inspection | Initialization | Upgrade | DiscoveryResult> = {
  meta: {
    name: "resource-migration",
    description: "Migrate one legacy resource in stages. inspect: report readiness, stage states and open decisions (read-only). initialize: create the private resource record. upgrade: explicitly convert a schemaVersion 1 record. discover: run legacy discovery and target definition with two read-only agents, pausing for owner decisions. Later stages are not implemented.",
    phases: [{ title: phases.inspect }, { title: phases.initialize }, { title: phases.upgrade }, { title: "Legacy discovery" }, { title: "Target definition" }],
    argsSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: [...operations] },
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
    if (input.operation === "discover") {
      const result = await discoverResource(context, input.workspaceFile, input.resourceId);
      context.log(`discover: ${result.status}. The migration is not complete.`);
      return result;
    }
    context.phase(phases[input.operation]);
    // Read live files every time. A memoized readiness result could hide a manual edit on resume.
    const result = input.operation === "inspect"
      ? await inspectWorkspace(input.workspaceFile, input.resourceId)
      : input.operation === "initialize"
        ? await initializeResource(input.workspaceFile, input.resourceId, context.signal)
        : await upgradeResource(input.workspaceFile, input.resourceId);
    context.signal.throwIfAborted();
    context.log(`${input.operation}: ${result.status}. No migration stage was completed.`);
    return result;
  },
};

export const resourceMigration = defineWorkflow(definition);
