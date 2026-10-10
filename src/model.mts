export const repositoryRoles = ["ihm", "entities", "api", "e2e"] as const;
export type RepositoryRole = (typeof repositoryRoles)[number];
export type Workspace = {
  configPath: string;
  repositories: Record<RepositoryRole, string>;
  resourcesRoot: string;
};
export type Issue = { code: string; message: string };
export type RepositorySnapshot = {
  role: RepositoryRole;
  path: string;
  head: string | null;
  dirty: boolean;
  fingerprint: string;
};
export const stageIds = ["01-legacy-discovery", "02-target-definition"] as const;
export type StageId = (typeof stageIds)[number];
export const stageStatuses = ["not-started", "in-progress", "awaiting-decision", "complete"] as const;
export type StageStatus = (typeof stageStatuses)[number];
export type StageState = {
  status: StageStatus;
  /** Workspace fingerprint the stage's evidence was produced from. */
  basedOnFingerprint: string | null;
  /** Paths relative to the resource directory. */
  evidence: string[];
  updatedAt: string | null;
};
export type Decision = {
  id: string;
  stage: StageId;
  question: string;
  source: string;
  answer: string | null;
  answeredAt: string | null;
};
export type ResourceRecordV1 = {
  schemaVersion: 1;
  id: string;
  stage: "legacy-discovery";
  status: "not-started";
  createdAt: string;
  sourceFingerprint: string;
};
export type ResourceRecord = {
  schemaVersion: 2;
  id: string;
  createdAt: string;
  initialFingerprint: string;
  revision: number;
  stages: Record<StageId, StageState>;
  decisions: Decision[];
  upgradedFrom: string | null;
};
export type StageSummary = {
  id: StageId;
  status: StageStatus;
  stale: boolean;
  blocked: boolean;
  evidence: string[];
};
export type InspectionStatus =
  | "blocked" | "needs-initialization" | "needs-upgrade" | "ready-for-discovery"
  | "awaiting-decision" | "ready-for-target" | "ready-for-contracts";
export type Inspection = {
  schemaVersion: 2;
  operation: "inspect";
  status: InspectionStatus;
  workspacePath: string;
  repositories: RepositorySnapshot[];
  resourcePath: string;
  resource: ResourceRecord | ResourceRecordV1 | null;
  sourceFingerprint: string | null;
  sourcesChangedSinceInitialization: boolean | null;
  stages: StageSummary[];
  openDecisions: Decision[];
  issues: Issue[];
  nextStep: { id: string; implemented: boolean };
  migrationComplete: false;
};
export type Initialization = {
  schemaVersion: 2;
  operation: "initialize";
  status: "created" | "already-exists";
  resourcePath: string;
  resource: ResourceRecord | ResourceRecordV1;
  migrationComplete: false;
};
export type Upgrade = {
  schemaVersion: 2;
  operation: "upgrade";
  status: "upgraded" | "already-current";
  resourcePath: string;
  preservedOriginal: string | null;
  resource: ResourceRecord;
  migrationComplete: false;
};
export type Answer = {
  schemaVersion: 2;
  operation: "answer";
  status: "recorded";
  decision: Decision;
  migrationComplete: false;
};

export class WorkflowError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowError";
  }
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError("invalid-input", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function keys(value: Record<string, unknown>, expected: string[], label: string): void {
  const unsupported = Object.keys(value).filter((key) => !expected.includes(key));
  if (unsupported.length) {
    throw new WorkflowError("invalid-input", `${label} contains unsupported fields: ${unsupported.join(", ")}. Expected: ${expected.join(", ")}.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new WorkflowError("invalid-input", `${label}.${key} is required.`);
    }
  }
}

export function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new WorkflowError("invalid-input", `${label} must be a nonempty string without NUL characters.`);
  }
  return value;
}

export function resourceId(value: unknown): string {
  const id = nonempty(value, "resourceId");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id)) {
    throw new WorkflowError("invalid-resource-id", "Use a lowercase resource ID starting with a letter, followed by letters, digits or hyphens (maximum 64 characters; no Windows device names).");
  }
  return id;
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function issue(error: unknown): Issue {
  return error instanceof WorkflowError
    ? { code: error.code, message: error.message }
    : { code: "operation-failed", message: error instanceof Error ? error.message : "An operation failed." };
}
