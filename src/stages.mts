import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hasCode, stageIds, WorkflowError, type Decision, type ResourceRecord, type StageId, type StageState, type StageStatus, type StageSummary } from "./model.mjs";
import { privateFilePath } from "./resource.mjs";

export const stageFiles = {
  "01-legacy-discovery": { json: "discovery/legacy.json", markdown: "discovery/legacy.md" },
  "02-target-definition": { json: "target/target.json", markdown: "target/target.md" },
} as const;
export type EvidenceHealth = Partial<Record<StageId, boolean>>;

export function contentDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Clarifications and rejection feedback can widen scope at either stage. Investigate them first. */
export function decisionInputs(record: ResourceRecord): Decision[] {
  return record.decisions.filter((d) => d.answer !== null && !(d.id.startsWith("approve-") && d.answer.trim().toLowerCase() === "approve"))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Rejection feedback alone must not change the baseline identity when its facts are unchanged. */
export function scopeInputDigest(record: ResourceRecord): string {
  return contentDigest(JSON.stringify({
    decisions: decisionInputs(record).filter((d) => !d.id.startsWith("approve-")).map(({ id, question, answer }) => ({ id, question, answer })),
    baseline: null,
  }));
}

export function stageInputDigest(record: ResourceRecord, stage: StageId): string {
  return contentDigest(JSON.stringify({
    // Reestablish evidence produced under the earlier scope-routing and truncation policy.
    policyVersion: 2,
    decisions: decisionInputs(record).map(({ id, question, answer }) => ({ id, question, answer })),
    baseline: stage === "02-target-definition" ? record.stages["01-legacy-discovery"].evidenceDigests[stageFiles["01-legacy-discovery"].json] ?? null : null,
  }));
}

/** Read actual artifact bytes every time; missing or edited evidence cannot establish completion. */
export async function checkStageEvidence(record: ResourceRecord, directory: string): Promise<EvidenceHealth> {
  const health: EvidenceHealth = {};
  for (const id of stageIds) {
    const state = record.stages[id];
    // Check planned artifact paths too, so a linked directory is rejected before any write.
    const files = Object.values(stageFiles[id]);
    health[id] = true;
    for (const relative of files) {
      const file = await privateFilePath(directory, relative);
      if (state.status === "not-started") continue;
      try {
        const bytes = await readFile(file);
        if (!state.evidence.includes(relative) || state.evidenceDigests[relative] !== contentDigest(bytes)) health[id] = false;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        health[id] = false;
      }
    }
  }
  return health;
}

/**
 * Allowed stage transitions. Only workflow code calls `transition`; agent output is data and never selects a state.
 * Reopening a complete stage is allowed only to replace stale evidence.
 */
const allowed: Record<StageStatus, readonly StageStatus[]> = {
  "not-started": ["in-progress"],
  "in-progress": ["in-progress", "awaiting-decision", "complete"],
  "awaiting-decision": ["in-progress", "awaiting-decision", "complete"],
  complete: ["in-progress"],
};

const predecessor: Record<StageId, StageId | null> = {
  "01-legacy-discovery": null,
  "02-target-definition": "01-legacy-discovery",
};

export function emptyStages(): ResourceRecord["stages"] {
  const empty = (): StageState => ({ status: "not-started", basedOnFingerprint: null, evidence: [], evidenceDigests: {}, inputDigest: null, updatedAt: null });
  return { "01-legacy-discovery": empty(), "02-target-definition": empty() };
}

export function isStale(record: ResourceRecord, stage: StageId, fingerprint: string | null, health: EvidenceHealth = {}): boolean {
  const state = record.stages[stage];
  if (state.status === "not-started" || state.basedOnFingerprint === null) return false;
  if (fingerprint !== null && state.basedOnFingerprint !== fingerprint) return true;
  if (health[stage] === false || state.inputDigest !== stageInputDigest(record, stage)) return true;
  const previous = predecessor[stage];
  return previous !== null && (record.stages[previous].status !== "complete" || isStale(record, previous, fingerprint, health));
}

/** A stage is current when it is complete and based on the given sources and on its current predecessor. */
export function isCurrent(record: ResourceRecord, stage: StageId, fingerprint: string, health: EvidenceHealth = {}): boolean {
  return record.stages[stage].status === "complete" && !isStale(record, stage, fingerprint, health);
}

export function isBlocked(record: ResourceRecord, stage: StageId, fingerprint: string | null, health: EvidenceHealth = {}): boolean {
  const previous = predecessor[stage];
  if (previous === null) return false;
  return fingerprint === null ? record.stages[previous].status !== "complete" : !isCurrent(record, previous, fingerprint, health);
}

export function transition(record: ResourceRecord, stage: StageId, to: StageStatus, fingerprint: string, evidence: string[], now: string, evidenceDigests: Record<string, string> = {}): ResourceRecord {
  const from = record.stages[stage].status;
  if (!allowed[from].includes(to)) {
    throw new WorkflowError("invalid-transition", `Stage ${stage} cannot move from ${from} to ${to}.`);
  }
  if (isBlocked(record, stage, fingerprint)) {
    throw new WorkflowError("stage-blocked", `Stage ${stage} requires its predecessor to be complete for the current sources.`);
  }
  if (to === "complete" && openDecisions(record, stage).length) {
    throw new WorkflowError("decisions-open", `Stage ${stage} has unanswered decisions.`);
  }
  return { ...record, stages: { ...record.stages, [stage]: { status: to, basedOnFingerprint: fingerprint, evidence, evidenceDigests, inputDigest: stageInputDigest(record, stage), updatedAt: now } } };
}

export function openDecisions(record: ResourceRecord, stage?: StageId): Decision[] {
  return record.decisions.filter((d) => d.answer === null && (stage === undefined || d.stage === stage));
}

/** Replace a stage's unanswered decisions with a new set. Answered decisions are history and are never dropped. */
export function mergeDecisions(record: ResourceRecord, stage: StageId, proposed: Decision[]): ResourceRecord {
  const answered = new Map(record.decisions.filter((d) => d.answer !== null).map((d) => [d.id, d]));
  const kept = record.decisions.filter((d) => d.answer !== null || d.stage !== stage);
  const added = proposed.filter((d, index) => !answered.has(d.id) && proposed.findIndex((p) => p.id === d.id) === index);
  return { ...record, decisions: [...kept, ...added] };
}

export function summarize(record: ResourceRecord, fingerprint: string | null, health: EvidenceHealth = {}): StageSummary[] {
  return stageIds.map((id) => ({
    id,
    status: record.stages[id].status,
    stale: isStale(record, id, fingerprint, health),
    blocked: isBlocked(record, id, fingerprint, health),
    evidence: record.stages[id].evidence,
  }));
}

export function pauseKey(resourceId: string, decision: Decision): string {
  return `decision/${resourceId}/${decision.stage}/${decision.id}`;
}
