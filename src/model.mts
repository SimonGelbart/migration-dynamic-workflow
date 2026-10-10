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
export type ResourceRecord = {
  schemaVersion: 1;
  id: string;
  stage: "legacy-discovery";
  status: "not-started";
  createdAt: string;
  sourceFingerprint: string;
};
export type Inspection = {
  schemaVersion: 1;
  operation: "inspect";
  status: "blocked" | "needs-initialization" | "ready-for-discovery";
  workspacePath: string;
  repositories: RepositorySnapshot[];
  resourcePath: string;
  resource: ResourceRecord | null;
  sourceFingerprint: string | null;
  sourcesChangedSinceInitialization: boolean | null;
  issues: Issue[];
  nextStep: { id: "01-legacy-discovery"; implemented: false };
  migrationComplete: false;
};
export type Initialization = {
  schemaVersion: 1;
  operation: "initialize";
  status: "created" | "already-exists";
  resourcePath: string;
  resource: ResourceRecord;
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
  if (Object.keys(value).some((key) => !expected.includes(key))) {
    throw new WorkflowError("invalid-input", `${label} contains unsupported fields.`);
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
