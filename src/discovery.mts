import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue, WorkflowContext, WorkflowJsonSchema } from "@github/copilot-sdk/extension";
import { inspectWorkspace, updateResource } from "./inspect.mjs";
import { hasCode, object, repositoryRoles, WorkflowError, type Decision, type Inspection, type RepositoryRole, type ResourceRecord, type StageId, type StageSummary } from "./model.mjs";
import { privateFilePath, replaceFile } from "./resource.mjs";
import { checkStageEvidence, contentDigest, decisionInputs, isBlocked, isCurrent, mergeDecisions, openDecisions, pauseKey, scopeInputDigest, stageFiles, stageInputDigest, transition } from "./stages.mjs";
import { canonicalPath, isWithin } from "./workspace.mjs";

export type StageContext = Pick<WorkflowContext, "agent" | "step" | "pause" | "parallel" | "phase" | "log" | "signal" | "runId">;

export const classifications = ["observed", "code-confirmed", "inferred", "unresolved"] as const;
export type Classification = (typeof classifications)[number];
export const dispositions = ["preserve", "change", "fix", "remove", "question"] as const;
export type Disposition = (typeof dispositions)[number];

export type Evidence = { repository: RepositoryRole; path: string; line: number | null };
export type Finding = {
  id: string; area: string; statement: string; classification: Classification;
  evidence: Evidence[]; question: string | null; affectsScope: boolean;
};
export type Rejection = { area: string; index: number; reason: string };
export type Baseline = { schemaVersion: 1; resourceId: string; fingerprint: string; inputDigest: string; coverage: Record<string, string[]>; findings: Finding[]; rejected: Rejection[] };
export type Requirement = { id: string; findingIds: string[]; disposition: Disposition; requirement: string; question: string | null };
export type Target = { schemaVersion: 1; resourceId: string; fingerprint: string; baselineDigest: string; revision: string; inputs: string[]; requirements: Requirement[]; exclusions: string[]; rejected: Rejection[] };

export type DiscoveryResult = {
  schemaVersion: 2;
  operation: "discover";
  status: "complete" | "awaiting-decision" | "target-rejected";
  resourcePath: string;
  stages: StageSummary[];
  openDecisions: Decision[];
  staleEvidenceRediscovered: boolean;
  rejectedFindings: number;
  nextStep: { id: string; implemented: boolean };
  migrationComplete: false;
};

const root = fileURLToPath(new URL("../../../", import.meta.url));
const stepDocument = (name: string) => path.join(root, "docs", "steps", name);

/** At most two read-only discovery agents, each with a distinct focus. */
export const discoveryAreas = [
  { id: "pages", focus: "pages and subpages, navigation, query strings, initial loads and postbacks, controls, conditional fields, normalization, validation and user messages" },
  { id: "ldap", focus: "LDAP queries: filters, search base and scope, attribute mappings, additional in-code filtering, parent/child interactions and side effects (writes, deletes, notifications)" },
] as const;

const baselineFiles = stageFiles["01-legacy-discovery"];
const targetFiles = stageFiles["02-target-definition"];
const maxRounds = 8;
export const outputLimits = { coverage: 500, findings: 300, requirements: 500 } as const;

const findingsSchema: WorkflowJsonSchema = {
  type: "object",
  required: ["coverage", "findings"],
  properties: {
    coverage: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["statement", "classification", "evidence", "question", "affectsScope"],
        properties: {
          statement: { type: "string" },
          classification: { type: "string", enum: [...classifications] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              required: ["repository", "path", "line"],
              properties: { repository: { type: "string", enum: [...repositoryRoles] }, path: { type: "string" }, line: { type: ["integer", "null"] } },
            },
          },
          question: { type: ["string", "null"] },
          affectsScope: { type: "boolean" },
        },
      },
    },
  },
};

const targetSchema: WorkflowJsonSchema = {
  type: "object",
  required: ["requirements", "exclusions"],
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["findingIds", "disposition", "requirement", "question"],
        properties: {
          findingIds: { type: "array", items: { type: "string" } },
          disposition: { type: "string", enum: [...dispositions] },
          requirement: { type: "string" },
          question: { type: ["string", "null"] },
        },
      },
    },
    exclusions: { type: "array", items: { type: "string" } },
  },
};

const hash = contentDigest;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0") ? value.trim() : null;
}

export function questionDecision(stage: StageId, question: string, source: string): Decision {
  return { id: `q-${hash(`${stage}\0${question}`).slice(0, 12)}`, stage, question, source, answer: null, answeredAt: null };
}

async function checkEvidence(value: unknown, repositories: Record<RepositoryRole, string>): Promise<Evidence | string> {
  const item = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!item) return "evidence must be an object";
  const role = item.repository as RepositoryRole;
  if (!repositoryRoles.includes(role)) return "evidence names an unknown repository";
  const relative = text(item.path, 1024);
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return "evidence path must be relative to its checkout";
  const line = item.line;
  if (line !== null && (!Number.isSafeInteger(line) || (line as number) < 1)) return "evidence line must be a positive integer or null";
  const file = path.resolve(repositories[role], relative);
  if (!isWithin(file, repositories[role]) || file === repositories[role]) return `evidence path ${relative} leaves the ${role} checkout`;
  try {
    const info = await lstat(file);
    if (!info.isFile()) return `evidence ${role}:${relative} is not a regular file`;
    if (!isWithin(await canonicalPath(file), repositories[role])) return `evidence ${role}:${relative} resolves outside its checkout`;
  } catch {
    return `evidence ${role}:${relative} does not exist`;
  }
  return { repository: role, path: relative.split(path.sep).join("/"), line: line as number | null };
}

/** Validate structured agent output before anything is saved. Invalid findings are kept as rejections for review, not silently dropped. */
export async function validateFindings(area: string, output: unknown, repositories: Record<RepositoryRole, string>): Promise<{ coverage: string[]; findings: Finding[]; rejected: Rejection[] }> {
  const value = object(output, `${area} discovery output`);
  if (!Array.isArray(value.findings) || !Array.isArray(value.coverage)) throw new WorkflowError("invalid-agent-output", `${area} discovery output must contain findings and coverage arrays.`);
  if (value.findings.length > outputLimits.findings || value.coverage.length > outputLimits.coverage) {
    throw new WorkflowError("agent-output-too-large", `${area} output exceeds ${outputLimits.findings} findings or ${outputLimits.coverage} coverage entries. Split the investigation into bounded output; nothing is truncated or accepted.`);
  }
  const coverage = value.coverage.map((item) => text(item, 500)).filter((item): item is string => item !== null);
  const findings: Finding[] = [];
  const rejected: Rejection[] = [];
  for (const [index, raw] of value.findings.entries()) {
    const reject = (reason: string) => { rejected.push({ area, index, reason }); };
    const item = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!item) { reject("finding must be an object"); continue; }
    const statement = text(item.statement, 4000);
    if (!statement) { reject("statement must be nonempty text of at most 4000 characters"); continue; }
    const classification = item.classification as Classification;
    if (!classifications.includes(classification)) { reject("classification is not observed, code-confirmed, inferred or unresolved"); continue; }
    const question = item.question === null ? null : text(item.question, 2000);
    if (item.question !== null && question === null) { reject("question must be null or nonempty text"); continue; }
    if (classification === "unresolved" && question === null) { reject("an unresolved finding must ask a focused question"); continue; }
    if (typeof item.affectsScope !== "boolean") { reject("affectsScope must be a boolean"); continue; }
    if (!Array.isArray(item.evidence) || item.evidence.length > 20) { reject("evidence must be an array of at most 20 references"); continue; }
    const evidence: Evidence[] = [];
    let problem: string | null = null;
    for (const reference of item.evidence) {
      const checked = await checkEvidence(reference, repositories);
      if (typeof checked === "string") { problem = checked; break; }
      evidence.push(checked);
    }
    if (problem) { reject(problem); continue; }
    if (classification !== "unresolved" && evidence.length === 0) { reject(`a ${classification} finding needs at least one source reference`); continue; }
    findings.push({ id: `${area}-${findings.length + 1}`, area, statement, classification, evidence, question, affectsScope: item.affectsScope });
  }
  return { coverage, findings, rejected };
}

export function validateTarget(output: unknown, baseline: Baseline): { requirements: Requirement[]; exclusions: string[]; rejected: Rejection[] } {
  const value = object(output, "target output");
  if (!Array.isArray(value.requirements) || !Array.isArray(value.exclusions)) throw new WorkflowError("invalid-agent-output", "Target output must contain requirements and exclusions arrays.");
  if (value.requirements.length > outputLimits.requirements) {
    throw new WorkflowError("agent-output-too-large", `Target output exceeds ${outputLimits.requirements} requirements. Split it into bounded output; nothing is truncated or approved.`);
  }
  const known = new Set(baseline.findings.map((f) => f.id));
  const requirements: Requirement[] = [];
  const rejected: Rejection[] = [];
  for (const [index, raw] of value.requirements.entries()) {
    const reject = (reason: string) => { rejected.push({ area: "target", index, reason }); };
    const item = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!item) { reject("requirement must be an object"); continue; }
    const requirement = text(item.requirement, 4000);
    if (!requirement) { reject("requirement must be nonempty text of at most 4000 characters"); continue; }
    const disposition = item.disposition as Disposition;
    if (!dispositions.includes(disposition)) { reject("disposition is not preserve, change, fix, remove or question"); continue; }
    if (!Array.isArray(item.findingIds) || item.findingIds.length === 0 || item.findingIds.some((id) => typeof id !== "string" || !known.has(id))) {
      reject("requirement must reference existing baseline finding IDs"); continue;
    }
    const question = item.question === null ? null : text(item.question, 2000);
    if (item.question !== null && question === null) { reject("question must be null or nonempty text"); continue; }
    if (disposition === "question" && question === null) { reject("a question disposition must ask a focused question"); continue; }
    requirements.push({ id: `req-${requirements.length + 1}`, findingIds: [...new Set(item.findingIds as string[])], disposition, requirement, question });
  }
  const exclusions = value.exclusions.map((item) => text(item, 2000)).filter((item): item is string => item !== null);
  return { requirements, exclusions, rejected };
}

function repositoryList(inspection: Inspection): string {
  return inspection.repositories.map((r) => `- ${r.role}: ${r.path}`).join("\n");
}

export function discoveryPrompt(resourceId: string, area: (typeof discoveryAreas)[number], inspection: Inspection, inputs: Decision[]): string {
  return [
    `You are a read-only legacy discovery agent for the resource "${resourceId}". Focus only on: ${area.focus}.`,
    `Follow the procedure in ${stepDocument("01-legacy-discovery.md")}.`,
    "Do not edit, create, delete, format, build or commit anything in these checkouts, and do not contact LDAP or other services. Any source change invalidates this run.",
    `Checkouts:\n${repositoryList(inspection)}`,
    "Identify the pages and operations belonging to this resource. If the resource boundary is unclear, report an unresolved finding with affectsScope true and a focused question.",
    `Investigate the scope specified by these recorded owner answers, including any newly included pages, controls or operations. Target clarifications and rejection feedback may expand scope too. Do not merely append the answers to previous findings.\n${JSON.stringify(inputs.map(({ id, stage, question, answer }) => ({ id, stage, question, answer })))}`,
    "Target-stage answers describe intended V2 behavior. Use them to identify relevant legacy evidence, while recording what the source actually does. Requested V2 changes must not become invented legacy facts.",
    `Return at most ${outputLimits.findings} findings and ${outputLimits.coverage} coverage entries. If the investigation exceeds these limits, report an unresolved scope finding explaining the need to split it; do not silently omit behavior.`,
    "Return JSON only. coverage lists every page, control group or operation you inspected. Each finding states one behavior and is classified as:",
    "observed (seen at runtime), code-confirmed (read directly in source), inferred (reasoned from indirect evidence) or unresolved (unknown; ask a question).",
    "Evidence uses paths relative to the named checkout and must exist. Set affectsScope true only when the answer changes what belongs to the migration.",
  ].join("\n\n");
}

export function targetPrompt(resourceId: string, baseline: Baseline, inputs: Decision[]): string {
  return [
    `Define the intended V2 behavior for the resource "${resourceId}" from its reviewed legacy baseline. Follow ${stepDocument("02-target-definition.md")}.`,
    "Do not edit any files. Return JSON only.",
    "Give every requirement a disposition: preserve, change, fix, remove or question. Reference baseline finding IDs. Use question, with a focused question, when the owner must decide intended behavior, contract semantics or material scope.",
    "List explicit exclusions. Do not rewrite the historical baseline; record intentional differences as change, fix or remove.",
    `Return at most ${outputLimits.requirements} requirements. If the target cannot fit, report a focused question about splitting the scope rather than silently omitting requirements.`,
    `Baseline findings:\n${JSON.stringify(baseline.findings)}`,
    `Owner decisions to apply:\n${JSON.stringify(inputs.map(({ id, question, answer }) => ({ id, question, answer })))}`,
  ].join("\n\n");
}

function renderBaseline(baseline: Baseline, decisions: Decision[]): string {
  const lines = [`# Legacy baseline: ${baseline.resourceId}`, "", `Generated by the resource-migration workflow from source fingerprint \`${baseline.fingerprint}\`. Regenerated on each run; record corrections as decisions.`, "", "## Coverage", ""];
  for (const [area, items] of Object.entries(baseline.coverage)) lines.push(`- ${area}: ${items.length ? items.join("; ") : "(none reported)"}`);
  lines.push("", "## Findings", "");
  for (const f of baseline.findings) {
    lines.push(`### ${f.id} (${f.classification})`, "", f.statement, "");
    for (const e of f.evidence) lines.push(`- Evidence: ${e.repository}:${e.path}${e.line ? `:${e.line}` : ""}`);
    if (f.question) lines.push(`- Question${f.affectsScope ? " (affects scope)" : ""}: ${f.question}`);
    lines.push("");
  }
  lines.push(...renderDecisions(decisions), ...renderRejections(baseline.rejected));
  return `${lines.join("\n")}\n`;
}

function renderTarget(target: Target, decisions: Decision[]): string {
  const lines = [`# Target definition: ${target.resourceId}`, "", `Revision \`${target.revision}\`, based on source fingerprint \`${target.fingerprint}\` and the baseline in ../${baselineFiles.markdown}.`, "", "## Requirements", ""];
  for (const r of target.requirements) {
    lines.push(`- **${r.id}** [${r.disposition}] ${r.requirement} (findings: ${r.findingIds.join(", ")})`);
    if (r.question) lines.push(`  - Question: ${r.question}`);
  }
  lines.push("", "## Exclusions", "", ...(target.exclusions.length ? target.exclusions.map((e) => `- ${e}`) : ["- (none)"]), "");
  lines.push(...renderDecisions(decisions), ...renderRejections(target.rejected));
  return `${lines.join("\n")}\n`;
}

function renderDecisions(decisions: Decision[]): string[] {
  if (!decisions.length) return [];
  return ["## Decisions", "", ...decisions.map((d) => `- \`${d.id}\`: ${d.question} — ${d.answer === null ? "**open**" : `answered ${d.answeredAt}: ${d.answer}`}`), ""];
}

function renderRejections(rejected: Rejection[]): string[] {
  if (!rejected.length) return [];
  return ["## Rejected agent output", "", ...rejected.map((r) => `- ${r.area} #${r.index}: ${r.reason}`), ""];
}

async function readPrivateJsonSnapshot<T>(directory: string, relative: string): Promise<{ value: T; digest: string } | null> {
  const file = await privateFilePath(directory, relative);
  try {
    const contents = await readFile(file, "utf8");
    return { value: JSON.parse(contents) as T, digest: hash(contents) };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw new WorkflowError("invalid-stage-evidence", `Cannot parse ${relative}; inspect and correct it before rerunning.`, { cause: error });
  }
}

async function readPrivateJson<T>(directory: string, relative: string): Promise<T | null> {
  return (await readPrivateJsonSnapshot<T>(directory, relative))?.value ?? null;
}

function targetRevision(target: Pick<Target, "fingerprint" | "baselineDigest" | "requirements" | "exclusions">): string {
  return hash(JSON.stringify({ fingerprint: target.fingerprint, baselineDigest: target.baselineDigest, requirements: target.requirements, exclusions: target.exclusions })).slice(0, 12);
}

/** Saved target JSON is untrusted. Validate it and derive its revision from actual content. */
function loadedTarget(output: unknown, baseline: Baseline, resourceId: string): Target {
  if (output === null || typeof output !== "object" || Array.isArray(output)) throw new WorkflowError("invalid-stage-evidence", "Saved target must be an object; no approval can be applied.");
  const value = object(output, "saved target");
  if (value.schemaVersion !== 1 || value.resourceId !== resourceId || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.baselineDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.baselineDigest)
    || !Array.isArray(value.inputs) || value.inputs.some((id) => typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id))
    || !Array.isArray(value.requirements) || !Array.isArray(value.exclusions) || !Array.isArray(value.rejected) || value.rejected.length) {
    throw new WorkflowError("invalid-stage-evidence", "Saved target metadata is invalid or contains rejected output; correct it or remove it to regenerate.");
  }
  const checked = validateTarget(value, baseline);
  if (checked.rejected.length || !checked.requirements.length
    || checked.requirements.length !== value.requirements.length
    || checked.requirements.some((requirement, index) => object((value.requirements as unknown[])[index], "saved requirement").id !== requirement.id)
    || JSON.stringify(checked.exclusions) !== JSON.stringify(value.exclusions)) {
    throw new WorkflowError("invalid-stage-evidence", "Saved target requirements or exclusions are invalid; no approval can be applied.");
  }
  const target: Target = { schemaVersion: 1, resourceId, fingerprint: value.fingerprint, baselineDigest: value.baselineDigest, inputs: value.inputs as string[], revision: "", ...checked };
  return { ...target, revision: targetRevision(target) };
}

async function currentState(workspaceFile: string, resourceId: string): Promise<{ inspection: Inspection; record: ResourceRecord; fingerprint: string; directory: string }> {
  // Always reread live state. Configuration, records and sources are never served from the workflow journal.
  const inspection = await inspectWorkspace(workspaceFile, resourceId);
  if (inspection.status === "blocked" || !inspection.sourceFingerprint) {
    throw new WorkflowError("workspace-blocked", `Discovery blocked: ${inspection.issues.map((i) => i.message).join(" ")}`);
  }
  if (inspection.status === "needs-initialization") throw new WorkflowError("resource-missing", "Initialize the resource first.");
  if (inspection.status === "needs-upgrade") throw new WorkflowError("needs-upgrade", "This resource record uses schemaVersion 1. Run the explicit upgrade operation first.");
  return { inspection, record: inspection.resource as ResourceRecord, fingerprint: inspection.sourceFingerprint, directory: path.dirname(inspection.resourcePath) };
}

/** Persist one stage's artifacts and decisions, and move it to the state the code determines. */
async function persistStage<T>(
  workspaceFile: string, resourceId: string, owner: string, stage: StageId, fingerprint: string,
  files: { json: string; markdown: string }, artifact: T | null, proposed: Decision[] | null,
  render: (artifact: T, decisions: Decision[]) => string, finalStatus: (record: ResourceRecord) => "awaiting-decision" | "complete" | "in-progress",
  expectedInputs: string, expectedExistingDigest?: string,
): Promise<ResourceRecord> {
  return updateResource(workspaceFile, resourceId, owner, async (current, directory) => {
    const live = await currentState(workspaceFile, resourceId);
    if (live.fingerprint !== fingerprint || stageInputDigest(current, stage) !== expectedInputs) throw new WorkflowError("stage-inputs-changed", "Sources or decisions changed while the stage ran; rerun before saving.");
    const health = await checkStageEvidence(current, directory);
    if (isBlocked(current, stage, fingerprint, health)) throw new WorkflowError("stage-blocked", `Stage ${stage} requires its predecessor to be complete for the current sources and evidence.`);
    if (expectedExistingDigest !== undefined) {
      const file = await privateFilePath(directory, files.json);
      if (hash(await readFile(file)) !== expectedExistingDigest) throw new WorkflowError("stage-inputs-changed", "Saved evidence changed during this attempt; rerun before applying a decision.");
    }
    const now = new Date().toISOString();
    let record = proposed ? mergeDecisions(current, stage, proposed) : current;
    const stored = artifact ?? await readPrivateJson<T>(directory, files.json);
    if (stored === null) throw new WorkflowError("evidence-missing", `Stage ${stage} evidence ${files.json} is missing; rerun discovery.`);
    const json = `${JSON.stringify(stored, null, 2)}\n`;
    const markdown = render(stored, record.decisions.filter((d) => d.stage === stage));
    // Validate both destinations before the first write.
    await privateFilePath(directory, files.json);
    await privateFilePath(directory, files.markdown);
    await replaceFile(path.join(directory, files.json), json, directory);
    await replaceFile(path.join(directory, files.markdown), markdown, directory);
    const evidence = [files.json, files.markdown];
    const digests = { [files.json]: hash(json), [files.markdown]: hash(markdown) };
    const status = record.stages[stage].status;
    if (status === "not-started" || status === "complete") record = transition(record, stage, "in-progress", fingerprint, evidence, now, digests);
    return transition(record, stage, finalStatus(record), fingerprint, evidence, now, digests);
  });
}

/** Run legacy discovery and target definition with code-owned transitions and durable decision checkpoints. */
export async function discoverResource(ctx: StageContext, workspaceFile: string, resourceId: string): Promise<DiscoveryResult> {
  const owner = `workflow run ${ctx.runId}`;
  let rediscovered = false;
  let rejectedFindings = 0;
  const finish = async (status: DiscoveryResult["status"]): Promise<DiscoveryResult> => {
    const { inspection, record } = await currentState(workspaceFile, resourceId);
    if (status === "complete" && inspection.status !== "ready-for-contracts") throw new WorkflowError("stage-inputs-changed", "Evidence or inputs changed before completion; rerun discovery.");
    return {
      schemaVersion: 2, operation: "discover", status, resourcePath: inspection.resourcePath, stages: inspection.stages, openDecisions: openDecisions(record),
      staleEvidenceRediscovered: rediscovered, rejectedFindings,
      nextStep: status === "complete" ? { id: "03-contracts-and-validation", implemented: false } : { id: openDecisions(record)[0]?.stage ?? "02-target-definition", implemented: true },
      migrationComplete: false,
    };
  };
  /** Pause at a one-shot checkpoint. Returns false when a resumed attempt still has no recorded answer. */
  const awaitDecision = async (decision: Decision): Promise<boolean> => {
    ctx.log(`Decision needed (${decision.id}): ${decision.question} Record it with: npm run answer -- --workspace <workspace.json> --resource ${resourceId} --decision ${decision.id} --answer "<text>", then resume this run.`);
    await ctx.pause(pauseKey(resourceId, decision));
    const { record: latest } = await currentState(workspaceFile, resourceId);
    return latest.decisions.some((d) => d.id === decision.id && d.answer !== null) || !latest.decisions.some((d) => d.id === decision.id);
  };

  for (let round = 0; round < maxRounds; round++) {
    ctx.signal.throwIfAborted();
    const { inspection, record, fingerprint, directory } = await currentState(workspaceFile, resourceId);
    const health = await checkStageEvidence(record, directory);
    const legacy = record.stages["01-legacy-discovery"];
    const legacyInputs = stageInputDigest(record, "01-legacy-discovery");

    if (!isCurrent(record, "01-legacy-discovery", fingerprint, health)) {
      ctx.phase("Legacy discovery");
      const reusable = legacy.status === "awaiting-decision" && legacy.basedOnFingerprint === fingerprint && health["01-legacy-discovery"] === true && legacy.inputDigest === legacyInputs;
      let updated: ResourceRecord;
      if (reusable) {
        // Only unanswered checkpoints can reuse unchanged evidence. New scope answers require investigation.
        updated = await persistStage<Baseline>(workspaceFile, resourceId, owner, "01-legacy-discovery", fingerprint, baselineFiles, null, null, renderBaseline,
          (r) => openDecisions(r, "01-legacy-discovery").length ? "awaiting-decision" : "complete", legacyInputs);
      } else {
        if (legacy.status !== "not-started") {
          rediscovered = true;
          ctx.log("Sources changed, scope answers changed, or discovery evidence is missing or edited. It will be rediscovered; recorded answers are kept.");
        }
        const short = fingerprint.slice(0, 12);
        const inputs = decisionInputs(record);
        const outputs = await ctx.parallel(discoveryAreas.map((area) => () => ctx.agent(discoveryPrompt(resourceId, area, inspection, inputs), { label: `discovery:${area.id}:${short}:${legacyInputs.slice(0, 12)}`, schema: findingsSchema })));
        ctx.signal.throwIfAborted();
        const failed = discoveryAreas.filter((_, index) => outputs[index] === null || outputs[index] === undefined).map((area) => area.id);
        if (failed.length) throw new WorkflowError("discovery-agent-failed", `Discovery produced no valid output for: ${failed.join(", ")}. Nothing was saved; resume or rerun.`);
        // Agents are read-only. Any source change while they ran (theirs or a person's) invalidates this output.
        const after = await currentState(workspaceFile, resourceId);
        if (after.fingerprint !== fingerprint) throw new WorkflowError("sources-changed-during-discovery", "Sources changed while discovery agents ran. Nothing was saved; rerun discovery on stable sources.");
        const repositories = Object.fromEntries(inspection.repositories.map((r) => [r.role, r.path])) as Record<RepositoryRole, string>;
        // Scope answers and sources both participate in the journal key.
        const baseline = await ctx.step(`discovery-baseline-v3-${fingerprint}-${legacyInputs}`, async () => {
          const parts = await Promise.all(discoveryAreas.map((area, index) => validateFindings(area.id, outputs[index], repositories)));
          const result: Baseline = {
            schemaVersion: 1, resourceId, fingerprint, inputDigest: scopeInputDigest(record),
            coverage: Object.fromEntries(discoveryAreas.map((area, index) => [area.id, parts[index]!.coverage])),
            findings: parts.flatMap((p) => p.findings), rejected: parts.flatMap((p) => p.rejected),
          };
          return result as unknown as JsonValue;
        }) as unknown as Baseline;
        rejectedFindings = baseline.rejected.length;
        if (rejectedFindings) ctx.log(`${rejectedFindings} discovery finding(s) failed validation and are listed for review in ${baselineFiles.markdown}.`);
        const insufficient = rejectedFindings > 0 || baseline.findings.length === 0 || !Object.values(baseline.coverage).some((items) => items.length);
        const proposed = baseline.findings.filter((f) => f.question && f.affectsScope).map((f) => questionDecision("01-legacy-discovery", f.question!, f.id));
        updated = await persistStage(workspaceFile, resourceId, owner, "01-legacy-discovery", fingerprint, baselineFiles, baseline, proposed, renderBaseline,
          (r) => insufficient ? "in-progress" : openDecisions(r, "01-legacy-discovery").length ? "awaiting-decision" : "complete", legacyInputs);
        if (insufficient) throw new WorkflowError("invalid-agent-output", "Discovery has rejected findings or insufficient evidence. Review legacy.md and rerun with corrected output; an empty or excluded resource needs an explicit scope finding.");
      }
      const pending = openDecisions(updated, "01-legacy-discovery");
      if (pending.length && !(await awaitDecision(pending[0]!))) return finish("awaiting-decision");
      continue;
    }

    const target = record.stages["02-target-definition"];
    if (!isCurrent(record, "02-target-definition", fingerprint, health)) {
      ctx.phase("Target definition");
      const baselineSnapshot = await readPrivateJsonSnapshot<Baseline>(directory, baselineFiles.json);
      const baseline = baselineSnapshot?.value ?? null;
      if (!baseline || baseline.fingerprint !== fingerprint || baselineSnapshot!.digest !== legacy.evidenceDigests[baselineFiles.json]) throw new WorkflowError("evidence-missing", `${baselineFiles.json} is missing or stale; rerun discovery.`);
      // Approvals are not regeneration inputs; rejections and answered questions are.
      const inputs = decisionInputs(record);
      const inputIds = inputs.map((d) => d.id).sort();
      const targetInputs = stageInputDigest(record, "02-target-definition");
      const baselineDigest = legacy.evidenceDigests[baselineFiles.json]!;
      const previousSnapshot = await readPrivateJsonSnapshot<Record<string, unknown>>(directory, targetFiles.json);
      const previous = previousSnapshot?.value ?? null;
      if (previousSnapshot && (target.status === "awaiting-decision" || target.status === "complete") && target.basedOnFingerprint === fingerprint && target.inputDigest === targetInputs) {
        const checked = loadedTarget(previousSnapshot.value, baseline, resourceId);
        if (checked.fingerprint !== fingerprint || checked.baselineDigest !== baselineDigest || JSON.stringify(checked.inputs) !== JSON.stringify(inputIds)) {
          throw new WorkflowError("invalid-stage-evidence", "Saved target context was edited; inspect and correct it before rerunning.");
        }
      }
      const reusable = (target.status === "awaiting-decision" || target.status === "complete") && target.basedOnFingerprint === fingerprint && previous !== null
        && previous.fingerprint === fingerprint && previous.baselineDigest === baselineDigest && JSON.stringify(previous.inputs) === JSON.stringify(inputIds);
      let definition: Target;
      let expectedExistingDigest: string | undefined;
      if (reusable) {
        definition = loadedTarget(previous, baseline, resourceId);
        expectedExistingDigest = previousSnapshot!.digest;
      } else {
        const output = await ctx.agent(targetPrompt(resourceId, baseline, inputs), { label: `target:${fingerprint.slice(0, 12)}:${targetInputs.slice(0, 12)}`, schema: targetSchema });
        ctx.signal.throwIfAborted();
        if (output === null || output === undefined) throw new WorkflowError("target-agent-failed", "Target definition produced no valid output. Nothing was saved; resume or rerun.");
        const checked = validateTarget(output, baseline);
        definition = { schemaVersion: 1, resourceId, fingerprint, baselineDigest, revision: "", inputs: inputIds, ...checked };
        definition.revision = targetRevision(definition);
        if (checked.rejected.length) ctx.log(`${checked.rejected.length} target requirement(s) failed validation and are listed for review in ${targetFiles.markdown}.`);
      }
      const insufficient = definition.rejected.length > 0 || definition.requirements.length === 0;
      // A question already answered is an input to this revision, not a new question.
      const answeredIds = new Set(record.decisions.filter((d) => d.answer !== null).map((d) => d.id));
      const questions = definition.requirements.filter((r) => r.question).map((r) => questionDecision("02-target-definition", r.question!, r.id)).filter((d) => !answeredIds.has(d.id));
      const approval: Decision = { id: `approve-${definition.revision}`, stage: "02-target-definition", question: `Approve target revision ${definition.revision} in ${targetFiles.markdown}? Answer "approve", or explain what to change.`, source: definition.revision, answer: null, answeredAt: null };
      const proposed = insufficient ? [] : questions.length ? questions : [approval];
      const updated = await persistStage(workspaceFile, resourceId, owner, "02-target-definition", fingerprint, targetFiles, definition, proposed, renderTarget, (r) => {
        if (insufficient) return "in-progress";
        if (openDecisions(r, "02-target-definition").length) return "awaiting-decision";
        if (questions.length) return "in-progress";
        return r.decisions.some((d) => d.id === approval.id && approved(d)) ? "complete" : "in-progress";
      }, targetInputs, expectedExistingDigest);
      if (insufficient) throw new WorkflowError("invalid-agent-output", "Target has rejected requirements or no valid requirements. Review target.md and rerun with corrected output before approval.");
      const pending = openDecisions(updated, "02-target-definition");
      if (pending.length) {
        if (!(await awaitDecision(pending[0]!))) return finish("awaiting-decision");
        continue;
      }
      if (updated.stages["02-target-definition"].status === "complete") return finish("complete");
      if (!questions.length) {
        ctx.log(`Target revision ${definition.revision} was not approved. Run discover again to revise it using the recorded answer.`);
        return finish("target-rejected");
      }
      continue;
    }
    return finish("complete");
  }
  throw new WorkflowError("too-many-rounds", `Discovery did not settle after ${maxRounds} rounds. Inspect the resource and rerun.`);
}

function approved(decision: Decision): boolean {
  return decision.answer !== null && decision.answer.trim().toLowerCase() === "approve";
}
