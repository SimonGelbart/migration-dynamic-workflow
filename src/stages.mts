import { stageIds, WorkflowError, type Decision, type ResourceRecord, type StageId, type StageState, type StageStatus, type StageSummary } from "./model.mjs";

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
  const empty = (): StageState => ({ status: "not-started", basedOnFingerprint: null, evidence: [], updatedAt: null });
  return { "01-legacy-discovery": empty(), "02-target-definition": empty() };
}

export function isStale(record: ResourceRecord, stage: StageId, fingerprint: string | null): boolean {
  const state = record.stages[stage];
  if (state.status === "not-started" || state.basedOnFingerprint === null) return false;
  if (fingerprint !== null && state.basedOnFingerprint !== fingerprint) return true;
  const previous = predecessor[stage];
  return previous !== null && record.stages[previous].basedOnFingerprint !== state.basedOnFingerprint;
}

/** A stage is current when it is complete and based on the given sources and on its current predecessor. */
export function isCurrent(record: ResourceRecord, stage: StageId, fingerprint: string): boolean {
  return record.stages[stage].status === "complete" && !isStale(record, stage, fingerprint);
}

export function isBlocked(record: ResourceRecord, stage: StageId, fingerprint: string | null): boolean {
  const previous = predecessor[stage];
  if (previous === null) return false;
  return fingerprint === null ? record.stages[previous].status !== "complete" : !isCurrent(record, previous, fingerprint);
}

export function transition(record: ResourceRecord, stage: StageId, to: StageStatus, fingerprint: string, evidence: string[], now: string): ResourceRecord {
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
  return { ...record, stages: { ...record.stages, [stage]: { status: to, basedOnFingerprint: fingerprint, evidence, updatedAt: now } } };
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

export function summarize(record: ResourceRecord, fingerprint: string | null): StageSummary[] {
  return stageIds.map((id) => ({
    id,
    status: record.stages[id].status,
    stale: isStale(record, id, fingerprint),
    blocked: isBlocked(record, id, fingerprint),
    evidence: record.stages[id].evidence,
  }));
}

export function pauseKey(resourceId: string, decision: Decision): string {
  return `decision/${resourceId}/${decision.stage}/${decision.id}`;
}
