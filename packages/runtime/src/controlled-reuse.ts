import {
  OBSERVED_TRAJECTORY_COMPARISON_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  type ReuseDecisionArtifact,
  type ReuseDecisionStatus,
} from "./observed-trajectory-comparison.js";

export const CONTROLLED_REUSE_AUTHORIZATION_VERSION =
  "migaki.controlled-reuse-authorization.v0";

export type ControlledReuseAuthorizationVersion =
  typeof CONTROLLED_REUSE_AUTHORIZATION_VERSION;
export type ControlledReuseMode = "disabled" | "exact_read_only_tool_call";
export type ControlledReuseEvidenceStatus = "failed" | "passed" | "unknown";

export interface ControlledReuseEligibility {
  readonly decisionStatus: "allowed";
  readonly match: "exact";
  readonly operationKind: "tool_call";
  readonly sideEffectClass: "read_only";
}

export interface ControlledReuseEvidence {
  readonly dependencies: {
    readonly status: ControlledReuseEvidenceStatus;
  };
  readonly freshness: {
    readonly maximumAgeMs: number;
    readonly observedAt: string;
    readonly status: ControlledReuseEvidenceStatus;
  };
  readonly policy: {
    readonly status: ControlledReuseEvidenceStatus;
  };
  readonly source: {
    readonly currentFingerprint: string;
    readonly equivalence: "exact" | "unknown";
    readonly previousFingerprint: string;
  };
}

export interface ControlledReusableValuePolicy {
  readonly lifetime: {
    readonly createdAt: string;
    readonly expiresAt: string;
  };
  readonly provenance: {
    readonly decisionArtifactVersion: typeof REUSE_DECISION_ARTIFACT_VERSION;
    readonly fingerprint: string;
    readonly nodeId: string;
    readonly previousRunId: string;
  };
  readonly storage: "memory_only";
}

export interface ControlledReuseAuthorizationInput {
  readonly decisionArtifact: ReuseDecisionArtifact;
  readonly decisionNodeId: string;
  readonly eligibility: ControlledReuseEligibility;
  readonly evidence: ControlledReuseEvidence;
  readonly mode: ControlledReuseMode;
  readonly reusableValue: ControlledReusableValuePolicy;
  readonly validators: {
    readonly passed: readonly string[];
    readonly required: readonly string[];
  };
  readonly version: ControlledReuseAuthorizationVersion;
}

export type ControlledReuseAuthorizationStatus =
  | "allowed"
  | "blocked"
  | "needs_review";

export type ControlledReuseAuthorizationReasonCode =
  | "dependency_evidence_failed"
  | "dependency_evidence_needs_review"
  | "decision_artifact_blocked"
  | "decision_artifact_needs_review"
  | "decision_not_found"
  | "decision_status_mismatch"
  | "freshness_evidence_failed"
  | "freshness_evidence_needs_review"
  | "freshness_stale"
  | "operation_kind_unsupported"
  | "opt_in_required"
  | "policy_evidence_failed"
  | "policy_evidence_needs_review"
  | "provenance_mismatch"
  | "reusable_value_expired"
  | "side_effect_unsupported"
  | "source_equivalence_needs_review"
  | "source_fingerprint_mismatch"
  | "storage_policy_unsupported"
  | "validator_missing";

export interface ControlledReuseAuthorizationReason {
  readonly code: ControlledReuseAuthorizationReasonCode;
  readonly message: string;
}

export interface ControlledReuseAuthorization {
  readonly authorized: boolean;
  readonly decisionNodeId?: string;
  readonly reasons: readonly ControlledReuseAuthorizationReason[];
  readonly reusableValue?: ControlledReusableValuePolicy;
  readonly status: ControlledReuseAuthorizationStatus;
  readonly version: ControlledReuseAuthorizationVersion;
}

export interface ControlledReuseValidationError {
  readonly code:
    | "incompatible_version"
    | "invalid_type"
    | "invalid_value"
    | "missing_required";
  readonly message: string;
  readonly path: string;
}

export interface ControlledReuseValidationResult {
  readonly authorization: ControlledReuseAuthorization;
  readonly errors: readonly ControlledReuseValidationError[];
  readonly success: boolean;
}

export function validateControlledReuseAuthorization(
  input: unknown,
  options: { readonly now: string },
): ControlledReuseValidationResult {
  const errors = validateInputShape(input);

  if (errors.length > 0 || !isRecord(input)) {
    return invalidResult(errors);
  }

  const authorizationInput =
    input as unknown as ControlledReuseAuthorizationInput;
  const reasons = authorize(authorizationInput, options.now);
  const status = authorizationStatus(reasons);

  return {
    authorization: {
      authorized: status === "allowed",
      decisionNodeId: authorizationInput.decisionNodeId,
      reasons,
      ...(status === "allowed"
        ? { reusableValue: authorizationInput.reusableValue }
        : {}),
      status,
      version: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
    },
    errors: [],
    success: true,
  };
}

function validateInputShape(input: unknown): ControlledReuseValidationError[] {
  const errors: ControlledReuseValidationError[] = [];

  if (!isRecord(input)) {
    return [
      invalidType("$", "Controlled reuse authorization must be an object."),
    ];
  }

  requireVersion(
    input,
    "version",
    CONTROLLED_REUSE_AUTHORIZATION_VERSION,
    "$.version",
    errors,
  );
  requireString(input, "mode", "$.mode", errors);
  requireString(input, "decisionNodeId", "$.decisionNodeId", errors);

  const artifact = requireRecord(
    input,
    "decisionArtifact",
    "$.decisionArtifact",
    errors,
  );
  if (artifact !== undefined) {
    requireVersion(
      artifact,
      "version",
      REUSE_DECISION_ARTIFACT_VERSION,
      "$.decisionArtifact.version",
      errors,
    );
    requireArray(artifact, "decisions", "$.decisionArtifact.decisions", errors);
    validateDecisionArray(artifact, errors);
    const comparisonRef = requireRecord(
      artifact,
      "comparisonRef",
      "$.decisionArtifact.comparisonRef",
      errors,
    );
    if (comparisonRef !== undefined) {
      requireString(
        comparisonRef,
        "previousRunId",
        "$.decisionArtifact.comparisonRef.previousRunId",
        errors,
      );
      requireVersion(
        comparisonRef,
        "version",
        OBSERVED_TRAJECTORY_COMPARISON_VERSION,
        "$.decisionArtifact.comparisonRef.version",
        errors,
      );
    }
  }

  const eligibility = requireRecord(
    input,
    "eligibility",
    "$.eligibility",
    errors,
  );
  if (eligibility !== undefined) {
    for (const key of [
      "decisionStatus",
      "match",
      "operationKind",
      "sideEffectClass",
    ] as const) {
      requireString(eligibility, key, `$.eligibility.${key}`, errors);
    }
  }

  const evidence = requireRecord(input, "evidence", "$.evidence", errors);
  if (evidence !== undefined) {
    validateEvidence(evidence, errors);
  }

  const validators = requireRecord(input, "validators", "$.validators", errors);
  if (validators !== undefined) {
    requireStringArray(validators, "required", "$.validators.required", errors);
    requireStringArray(validators, "passed", "$.validators.passed", errors);
  }

  const reusableValue = requireRecord(
    input,
    "reusableValue",
    "$.reusableValue",
    errors,
  );
  if (reusableValue !== undefined) {
    validateReusableValue(reusableValue, errors);
  }

  return errors;
}

function validateDecisionArray(
  artifact: Readonly<Record<string, unknown>>,
  errors: ControlledReuseValidationError[],
): void {
  const decisions = artifact.decisions;
  if (!Array.isArray(decisions)) {
    return;
  }

  decisions.forEach((decision, index) => {
    const path = `$.decisionArtifact.decisions[${index}]`;
    if (!isRecord(decision)) {
      errors.push(invalidType(path, "Expected a reuse decision object."));
      return;
    }

    for (const key of ["nodeId", "operationKind", "status"] as const) {
      requireString(decision, key, `${path}.${key}`, errors);
    }
    for (const key of [
      "dependencyEvidence",
      "freshnessEvidence",
      "policyConstraints",
    ] as const) {
      const evidence = requireRecord(decision, key, `${path}.${key}`, errors);
      if (evidence !== undefined) {
        requireEvidenceStatus(
          evidence,
          "status",
          `${path}.${key}.status`,
          errors,
        );
      }
    }
    if (
      decision.cacheKey !== undefined &&
      typeof decision.cacheKey !== "string"
    ) {
      errors.push(
        invalidType(`${path}.cacheKey`, "Expected a fingerprint string."),
      );
    }
    if (
      decision.sideEffectClass !== undefined &&
      typeof decision.sideEffectClass !== "string"
    ) {
      errors.push(
        invalidType(
          `${path}.sideEffectClass`,
          "Expected a side-effect class string.",
        ),
      );
    }
  });
}

function validateEvidence(
  evidence: Readonly<Record<string, unknown>>,
  errors: ControlledReuseValidationError[],
): void {
  for (const key of [
    "dependencies",
    "freshness",
    "policy",
    "source",
  ] as const) {
    requireRecord(evidence, key, `$.evidence.${key}`, errors);
  }

  const dependencies = readRecord(evidence, "dependencies");
  const freshness = readRecord(evidence, "freshness");
  const policy = readRecord(evidence, "policy");
  const source = readRecord(evidence, "source");

  if (dependencies !== undefined) {
    requireEvidenceStatus(
      dependencies,
      "status",
      "$.evidence.dependencies.status",
      errors,
    );
  }
  if (freshness !== undefined) {
    requireEvidenceStatus(
      freshness,
      "status",
      "$.evidence.freshness.status",
      errors,
    );
    requireString(
      freshness,
      "observedAt",
      "$.evidence.freshness.observedAt",
      errors,
    );
    requirePositiveNumber(
      freshness,
      "maximumAgeMs",
      "$.evidence.freshness.maximumAgeMs",
      errors,
    );
  }
  if (policy !== undefined) {
    requireEvidenceStatus(policy, "status", "$.evidence.policy.status", errors);
  }
  if (source !== undefined) {
    requireString(
      source,
      "currentFingerprint",
      "$.evidence.source.currentFingerprint",
      errors,
    );
    requireString(
      source,
      "previousFingerprint",
      "$.evidence.source.previousFingerprint",
      errors,
    );
    requireString(
      source,
      "equivalence",
      "$.evidence.source.equivalence",
      errors,
    );
  }
}

function validateReusableValue(
  reusableValue: Readonly<Record<string, unknown>>,
  errors: ControlledReuseValidationError[],
): void {
  requireString(reusableValue, "storage", "$.reusableValue.storage", errors);
  const provenance = requireRecord(
    reusableValue,
    "provenance",
    "$.reusableValue.provenance",
    errors,
  );
  const lifetime = requireRecord(
    reusableValue,
    "lifetime",
    "$.reusableValue.lifetime",
    errors,
  );

  if (provenance !== undefined) {
    for (const key of [
      "decisionArtifactVersion",
      "fingerprint",
      "nodeId",
      "previousRunId",
    ] as const) {
      requireString(
        provenance,
        key,
        `$.reusableValue.provenance.${key}`,
        errors,
      );
    }
  }
  if (lifetime !== undefined) {
    requireTimestamp(
      lifetime,
      "createdAt",
      "$.reusableValue.lifetime.createdAt",
      errors,
    );
    requireTimestamp(
      lifetime,
      "expiresAt",
      "$.reusableValue.lifetime.expiresAt",
      errors,
    );
  }
}

function authorize(
  input: ControlledReuseAuthorizationInput,
  nowInput: string,
): readonly ControlledReuseAuthorizationReason[] {
  const reasons: ControlledReuseAuthorizationReason[] = [];
  const decision = input.decisionArtifact.decisions.find(
    (candidate) => candidate.nodeId === input.decisionNodeId,
  );

  if (input.mode !== "exact_read_only_tool_call") {
    reasons.push(
      reason(
        "opt_in_required",
        "Controlled reuse requires explicit exact read-only tool-call opt-in.",
      ),
    );
  }

  if (decision === undefined) {
    reasons.push(
      reason(
        "decision_not_found",
        "The referenced reuse decision does not exist.",
      ),
    );
    return reasons;
  }

  reviewDecisionStatus(decision.status, reasons);

  if (
    input.eligibility.operationKind !== "tool_call" ||
    decision.operationKind !== "tool_call"
  ) {
    reasons.push(
      reason(
        "operation_kind_unsupported",
        "Only tool_call decisions are eligible for controlled reuse.",
      ),
    );
  }
  if (
    input.eligibility.sideEffectClass !== "read_only" ||
    decision.sideEffectClass !== "read_only"
  ) {
    reasons.push(
      reason(
        "side_effect_unsupported",
        "Only read_only side effects are eligible for controlled reuse.",
      ),
    );
  }
  if (
    input.eligibility.decisionStatus !== "allowed" ||
    decision.status !== input.eligibility.decisionStatus
  ) {
    reasons.push(
      reason(
        "decision_status_mismatch",
        "The contract and artifact must both classify the decision as allowed.",
      ),
    );
  }

  reviewSource(input, decision.cacheKey, reasons);
  reviewEvidenceStatus(
    "dependency",
    decision.dependencyEvidence.status,
    reasons,
  );
  reviewEvidenceStatus("freshness", decision.freshnessEvidence.status, reasons);
  reviewEvidenceStatus("policy", decision.policyConstraints.status, reasons);
  reviewEvidenceStatus(
    "dependency",
    input.evidence.dependencies.status,
    reasons,
  );
  reviewEvidenceStatus("freshness", input.evidence.freshness.status, reasons);
  reviewEvidenceStatus("policy", input.evidence.policy.status, reasons);
  reviewFreshness(input, nowInput, reasons);
  reviewValidators(input, reasons);
  reviewReusableValue(input, nowInput, reasons);

  return deduplicateReasons(reasons);
}

function reviewDecisionStatus(
  status: ReuseDecisionStatus,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  if (status === "blocked") {
    reasons.push(
      reason(
        "decision_artifact_blocked",
        "The reuse decision artifact blocks this candidate.",
      ),
    );
  } else if (status === "needs_review") {
    reasons.push(
      reason(
        "decision_artifact_needs_review",
        "The reuse decision artifact requires review for this candidate.",
      ),
    );
  }
}

function reviewSource(
  input: ControlledReuseAuthorizationInput,
  decisionFingerprint: string | undefined,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  if (
    input.eligibility.match !== "exact" ||
    input.evidence.source.equivalence !== "exact"
  ) {
    reasons.push(
      reason(
        "source_equivalence_needs_review",
        "Source equivalence must be exact before reuse can be authorized.",
      ),
    );
  }

  const fingerprints = [
    decisionFingerprint,
    input.evidence.source.currentFingerprint,
    input.evidence.source.previousFingerprint,
    input.reusableValue.provenance.fingerprint,
  ];
  if (
    decisionFingerprint === undefined ||
    fingerprints.some((fingerprint) => fingerprint !== decisionFingerprint)
  ) {
    reasons.push(
      reason(
        "source_fingerprint_mismatch",
        "Decision, source, and reusable-value fingerprints must match exactly.",
      ),
    );
  }
}

function reviewEvidenceStatus(
  kind: "dependency" | "freshness" | "policy",
  status: ControlledReuseEvidenceStatus,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  if (status === "passed") {
    return;
  }

  reasons.push(
    reason(
      `${kind}_evidence_${status === "unknown" ? "needs_review" : "failed"}`,
      `${capitalize(kind)} evidence must pass before reuse can be authorized.`,
    ),
  );
}

function reviewFreshness(
  input: ControlledReuseAuthorizationInput,
  nowInput: string,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  const now = timestamp(nowInput);
  const observedAt = timestamp(input.evidence.freshness.observedAt);

  if (
    now === undefined ||
    observedAt === undefined ||
    now < observedAt ||
    now - observedAt > input.evidence.freshness.maximumAgeMs
  ) {
    reasons.push(
      reason(
        "freshness_stale",
        "Freshness evidence is stale or has an invalid observation time.",
      ),
    );
  }
}

function reviewValidators(
  input: ControlledReuseAuthorizationInput,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  const passed = new Set(input.validators.passed);
  if (
    input.validators.required.length === 0 ||
    !input.validators.required.every((validator) => passed.has(validator))
  ) {
    reasons.push(
      reason(
        "validator_missing",
        "Every declared controlled-reuse validator must pass.",
      ),
    );
  }
}

function reviewReusableValue(
  input: ControlledReuseAuthorizationInput,
  nowInput: string,
  reasons: ControlledReuseAuthorizationReason[],
): void {
  if (input.reusableValue.storage !== "memory_only") {
    reasons.push(
      reason(
        "storage_policy_unsupported",
        "The v0 contract permits process-memory storage only.",
      ),
    );
  }

  const provenance = input.reusableValue.provenance;
  if (
    provenance.decisionArtifactVersion !== input.decisionArtifact.version ||
    provenance.nodeId !== input.decisionNodeId ||
    provenance.previousRunId !==
      input.decisionArtifact.comparisonRef.previousRunId
  ) {
    reasons.push(
      reason(
        "provenance_mismatch",
        "Reusable values must identify their decision artifact, node, and source run.",
      ),
    );
  }

  const createdAt = timestamp(input.reusableValue.lifetime.createdAt);
  const expiresAt = timestamp(input.reusableValue.lifetime.expiresAt);
  const now = timestamp(nowInput);
  if (
    createdAt === undefined ||
    expiresAt === undefined ||
    now === undefined ||
    expiresAt <= createdAt ||
    now >= expiresAt
  ) {
    reasons.push(
      reason(
        "reusable_value_expired",
        "Reusable values require a valid, unexpired lifetime.",
      ),
    );
  }
}

function authorizationStatus(
  reasons: readonly ControlledReuseAuthorizationReason[],
): ControlledReuseAuthorizationStatus {
  if (reasons.length === 0) {
    return "allowed";
  }

  return reasons.every((item) => item.code.endsWith("needs_review"))
    ? "needs_review"
    : "blocked";
}

function invalidResult(
  errors: readonly ControlledReuseValidationError[],
): ControlledReuseValidationResult {
  return {
    authorization: {
      authorized: false,
      reasons: [],
      status: "blocked",
      version: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
    },
    errors,
    success: false,
  };
}

function reason(
  code: ControlledReuseAuthorizationReasonCode,
  message: string,
): ControlledReuseAuthorizationReason {
  return { code, message };
}

function deduplicateReasons(
  reasons: readonly ControlledReuseAuthorizationReason[],
): readonly ControlledReuseAuthorizationReason[] {
  return reasons.filter(
    (item, index) =>
      reasons.findIndex((other) => other.code === item.code) === index,
  );
}

function requireVersion(
  record: Readonly<Record<string, unknown>>,
  key: string,
  expected: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (value === undefined) {
    errors.push(missingRequired(path, "Missing required version."));
  } else if (typeof value !== "string") {
    errors.push(invalidType(path, "Version must be a string."));
  } else if (value !== expected) {
    errors.push({
      code: "incompatible_version",
      message: `Expected ${expected}; received ${value}.`,
      path,
    });
  }
}

function requireRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key];
  if (value === undefined) {
    errors.push(missingRequired(path, "Missing required object."));
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push(invalidType(path, "Expected an object."));
    return undefined;
  }
  return value;
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (value === undefined) {
    errors.push(missingRequired(path, "Missing required string."));
  } else if (typeof value !== "string" || value.length === 0) {
    errors.push(invalidType(path, "Expected a non-empty string."));
  }
}

function requireArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  if (!Array.isArray(record[key])) {
    errors.push(invalidType(path, "Expected an array."));
  }
}

function requireStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    errors.push(invalidType(path, "Expected an array of non-empty strings."));
  }
}

function requirePositiveNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({
      code: "invalid_value",
      message: "Expected a positive finite number.",
      path,
    });
  }
}

function requireTimestamp(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (typeof value !== "string") {
    errors.push(invalidType(path, "Expected a timestamp string."));
  } else if (timestamp(value) === undefined) {
    errors.push({
      code: "invalid_value",
      message: "Expected a valid timestamp.",
      path,
    });
  }
}

function requireEvidenceStatus(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ControlledReuseValidationError[],
): void {
  const value = record[key];
  if (value !== "failed" && value !== "passed" && value !== "unknown") {
    errors.push({
      code: "invalid_value",
      message: "Expected failed, passed, or unknown.",
      path,
    });
  }
}

function readRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function missingRequired(
  path: string,
  message: string,
): ControlledReuseValidationError {
  return { code: "missing_required", message, path };
}

function invalidType(
  path: string,
  message: string,
): ControlledReuseValidationError {
  return { code: "invalid_type", message, path };
}

function timestamp(value: string): number | undefined {
  const result = Date.parse(value);
  return Number.isNaN(result) ? undefined : result;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
