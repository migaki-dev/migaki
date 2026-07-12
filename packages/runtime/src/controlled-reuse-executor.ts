import {
  CONTROLLED_REUSE_PLAN_VERSION,
  planControlledReuse,
  type ControlledReuseNodePlan,
  type ControlledReusePlanningInput,
  type ControlledReusePlanReasonCode,
} from "./controlled-reuse-planner.js";
import { CONTROLLED_REUSE_AUTHORIZATION_VERSION } from "./controlled-reuse.js";
import {
  REUSE_VALUE_STORE_VERSION,
  type EphemeralReuseValueStore,
  type ReuseValueCodec,
  type ReuseValueMetadata,
  type ReuseValueStoreReasonCode,
} from "./reuse-value-store.js";
import {
  EVIDENCE_PRIVACY_EXPORT_FIELDS,
  EVIDENCE_PRIVACY_POLICY_VERSION,
} from "./evidence-bundle.js";
import { REUSE_DECISION_ARTIFACT_VERSION } from "./observed-trajectory-comparison.js";

export const CONTROLLED_REUSE_EXECUTION_VERSION =
  "migaki.controlled-reuse-execution.v0";

const LEGACY_CONTROLLED_REUSE_EXECUTION_FIELDS = new Set([
  "action",
  "actualSkippedActions",
  "nodeId",
  "previousNodeId",
  "reasonCodes",
  "version",
]);

const RICH_CONTROLLED_REUSE_EXECUTION_FIELDS = new Set([
  ...LEGACY_CONTROLLED_REUSE_EXECUTION_FIELDS,
  "decisionRef",
  "eligibilityChecks",
  "estimatedAvoidableWork",
  "executionOutcome",
  "invalidation",
  "planExecutionDiff",
  "policyRef",
  "privacyPolicy",
  "realizedMetrics",
  "storeRef",
  "validatorOutcomes",
]);

export type ControlledReuseExecutionVersion =
  typeof CONTROLLED_REUSE_EXECUTION_VERSION;

export type ControlledReuseExecutionReasonCode =
  | ControlledReusePlanReasonCode
  | ReuseValueStoreReasonCode
  | "behavior_equivalence_failed"
  | "incompatible_execution_input"
  | "plan_identity_mismatch";

export interface ControlledReuseExecutionInput {
  /** Current boundary evidence, not the stale input used to create `plan`. */
  readonly current: ControlledReusePlanningInput;
  readonly nodeId: string;
  readonly plan: ControlledReuseNodePlan;
  readonly version: ControlledReuseExecutionVersion;
}

export interface ControlledReuseExecutionEvidence {
  readonly action: "blocked" | "execute_normally" | "reuse";
  readonly actualSkippedActions: 0 | 1;
  readonly decisionRef?: ControlledReuseDecisionReference;
  readonly eligibilityChecks?: readonly ControlledReuseEligibilityCheck[];
  readonly estimatedAvoidableWork?: ControlledReuseEstimatedAvoidableWork;
  readonly executionOutcome?: "blocked" | "executed_normally" | "reused";
  readonly invalidation?: ControlledReuseInvalidationEvidence;
  readonly nodeId: string;
  readonly planExecutionDiff?: ControlledReusePlanExecutionDiff;
  readonly policyRef?: ControlledReusePolicyReference;
  readonly previousNodeId: string;
  readonly privacyPolicy?: {
    readonly exportMode: "metadata_only";
    readonly omittedFields: readonly string[];
    readonly version: typeof EVIDENCE_PRIVACY_POLICY_VERSION;
  };
  readonly realizedMetrics?: ControlledReuseRealizedMetrics;
  readonly reasonCodes: readonly ControlledReuseExecutionReasonCode[];
  readonly storeRef?: ControlledReuseStoreReference;
  readonly validatorOutcomes?: readonly ControlledReuseValidatorOutcome[];
  readonly version: ControlledReuseExecutionVersion;
}

export interface ControlledReuseDecisionReference {
  readonly currentRunId: string;
  readonly nodeId: string;
  readonly previousRunId: string;
  readonly version: typeof REUSE_DECISION_ARTIFACT_VERSION;
}

export interface ControlledReuseEligibilityCheck {
  readonly name:
    | "decision_status"
    | "dependencies"
    | "exact_match"
    | "freshness"
    | "operation_kind"
    | "policy"
    | "side_effect_class"
    | "source_equivalence";
  readonly status: "failed" | "passed" | "unknown";
}

export interface ControlledReuseEstimatedAvoidableWork {
  readonly classification: "estimated";
  readonly costUsd?: number;
  readonly latencyMs?: number;
  readonly totalTokens?: number;
}

export interface ControlledReuseInvalidationEvidence {
  readonly count: 0 | 1;
  readonly reasonCodes: readonly ControlledReuseExecutionReasonCode[];
}

export interface ControlledReusePlanExecutionDiff {
  readonly changed: boolean;
  readonly executedAction: ControlledReuseExecutionEvidence["action"];
  readonly plannedAction: ControlledReuseNodePlan["action"];
}

export interface ControlledReusePolicyReference {
  readonly authorizationVersion: typeof CONTROLLED_REUSE_AUTHORIZATION_VERSION;
  readonly mode: "disabled" | "exact_read_only_tool_call";
  readonly plannerVersion: typeof CONTROLLED_REUSE_PLAN_VERSION;
}

export interface ControlledReuseRealizedMetrics {
  readonly actualSkippedActions: 0 | 1;
  readonly invalidations: 0 | 1;
  readonly normalExecutions: 0 | 1;
  readonly plannedReuse: 0 | 1;
  readonly potentialReuse: 0 | 1;
}

export interface ControlledReuseStoreReference {
  readonly id?: string;
  readonly outcome: "hit" | "invalidated" | "miss" | "not_checked";
  readonly valueSchemaVersion?: string;
  readonly version: typeof REUSE_VALUE_STORE_VERSION;
}

export interface ControlledReuseValidatorOutcome {
  readonly id: string;
  readonly status: "failed" | "not_run" | "passed";
}

export type ControlledReuseExecutionEvidenceRenderFormat = "human" | "json";

export type ControlledReuseExecutionResult<T> =
  | {
      readonly evidence: ControlledReuseExecutionEvidence;
      readonly status: "blocked";
    }
  | {
      readonly evidence: ControlledReuseExecutionEvidence;
      readonly status: "executed_normally" | "reused";
      readonly value: T;
    };

export interface ControlledReuseExecutionDependencies<T> {
  readonly codec: ReuseValueCodec<T>;
  readonly executeNormally: () => Promise<T> | T;
  readonly now: string;
  readonly store: EphemeralReuseValueStore;
  /**
   * Confirms that the in-memory value satisfies the operation's observable
   * result contract. The value is never copied into execution evidence.
   */
  readonly validateBehaviorEquivalence: (
    value: T,
    metadata: ReuseValueMetadata,
  ) => boolean;
}

/**
 * Resolves one exact read-only controlled-reuse plan. It recomputes the plan
 * from current boundary evidence before lookup and never retries a normal
 * execution internally.
 */
export async function executeControlledReuse<T>(
  value: unknown,
  dependencies: ControlledReuseExecutionDependencies<T>,
): Promise<ControlledReuseExecutionResult<T>> {
  const input = readExecutionInput(value);
  if (input === undefined) {
    return blocked({ nodeId: "executor-input", previousNodeId: "unknown" }, [
      "incompatible_execution_input",
    ]);
  }
  const candidate = input.current.candidates.find(
    (item) => item.nodeId === input.nodeId,
  );
  const identity = {
    nodeId: candidate?.nodeId ?? input.nodeId,
    previousNodeId: candidate?.previousNodeId ?? input.plan.previousNodeId,
  };
  const baseContext = {
    candidate,
    dependencies,
    input,
  };

  if (
    input.version !== CONTROLLED_REUSE_EXECUTION_VERSION ||
    candidate === undefined ||
    input.plan.nodeId !== input.nodeId
  ) {
    return blocked(identity, ["incompatible_execution_input"], baseContext);
  }

  // Re-run all authorization, source, freshness, dependency, policy,
  // side-effect, provenance, and validator checks before any execution path.
  // The recomputed plan is also the sole source of actions and reason codes.
  const currentPlan = planControlledReuse(input.current, {
    now: dependencies.now,
  }).nodes.find((node) => node.nodeId === input.nodeId);
  if (currentPlan === undefined) {
    return blocked(identity, ["incompatible_execution_input"], baseContext);
  }
  if (currentPlan.action === "blocked") {
    return blocked(identity, currentPlan.reasonCodes, baseContext);
  }
  if (currentPlan.action === "execute_normally") {
    return executeNormally(
      identity,
      currentPlan.reasonCodes,
      dependencies,
      baseContext,
    );
  }
  if (!sameReuseIdentity(input.plan, currentPlan)) {
    return blocked(identity, ["plan_identity_mismatch"], baseContext);
  }

  const lookup = dependencies.store.lookup(
    {
      provenance: candidate.reusableValue.provenance,
      version: REUSE_VALUE_STORE_VERSION,
    },
    dependencies.codec,
    { now: dependencies.now },
  );
  if (lookup.status !== "hit") {
    return executeNormally(identity, lookup.reasonCodes, dependencies, {
      ...baseContext,
      invalidated: lookup.status === "invalidated" ? 1 : 0,
      storeOutcome: lookup.status,
    });
  }

  const equivalent = behaviorEquivalent(
    lookup.value,
    lookup.metadata,
    dependencies.validateBehaviorEquivalence,
  );
  if (!equivalent) {
    const invalidation = dependencies.store.invalidate({
      provenance: candidate.reusableValue.provenance,
      version: REUSE_VALUE_STORE_VERSION,
    });
    return executeNormally(
      identity,
      ["behavior_equivalence_failed"],
      dependencies,
      {
        ...baseContext,
        invalidated: invalidation.invalidated === 0 ? 0 : 1,
        storeOutcome: "invalidated",
        behaviorEquivalence: "failed",
      },
    );
  }

  return {
    evidence: evidence(identity, "reuse", 1, [], {
      ...baseContext,
      behaviorEquivalence: "passed",
      storeOutcome: "hit",
    }),
    status: "reused",
    value: lookup.value,
  };
}

function behaviorEquivalent<T>(
  value: T,
  metadata: ReuseValueMetadata,
  validate: (value: T, metadata: ReuseValueMetadata) => boolean,
): boolean {
  try {
    return validate(value, metadata);
  } catch {
    return false;
  }
}

function readExecutionInput(
  value: unknown,
): ControlledReuseExecutionInput | undefined {
  if (
    !isRecord(value) ||
    value.version !== CONTROLLED_REUSE_EXECUTION_VERSION ||
    !safeReference(value.nodeId) ||
    !isRecord(value.plan) ||
    typeof value.plan.action !== "string" ||
    !safeReference(value.plan.nodeId) ||
    !safeReference(value.plan.previousNodeId) ||
    !Array.isArray(value.plan.reasonCodes) ||
    !value.plan.reasonCodes.every((reason) => typeof reason === "string") ||
    !isRecord(value.current) ||
    !Array.isArray(value.current.candidates) ||
    !value.current.candidates.every(
      (candidate) =>
        isRecord(candidate) &&
        safeReference(candidate.nodeId) &&
        safeReference(candidate.previousNodeId),
    )
  ) {
    return undefined;
  }
  return value as unknown as ControlledReuseExecutionInput;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(
  value: Readonly<Record<string, unknown>>,
  fields: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => fields.has(key));
}

function safeReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

async function executeNormally<T>(
  identity: OperationIdentity,
  reasonCodes: readonly ControlledReuseExecutionReasonCode[],
  dependencies: ControlledReuseExecutionDependencies<T>,
  context?: EvidenceContext,
): Promise<ControlledReuseExecutionResult<T>> {
  const value = await dependencies.executeNormally();
  return {
    evidence: evidence(identity, "execute_normally", 0, reasonCodes, context),
    status: "executed_normally",
    value,
  };
}

function blocked(
  identity: OperationIdentity,
  reasonCodes: readonly ControlledReuseExecutionReasonCode[],
  context?: EvidenceContext,
): ControlledReuseExecutionResult<never> {
  return {
    evidence: evidence(identity, "blocked", 0, reasonCodes, context),
    status: "blocked",
  };
}

interface OperationIdentity {
  readonly nodeId: string;
  readonly previousNodeId: string;
}

function evidence(
  identity: OperationIdentity,
  action: ControlledReuseExecutionEvidence["action"],
  actualSkippedActions: 0 | 1,
  reasonCodes: readonly ControlledReuseExecutionReasonCode[],
  context?: EvidenceContext,
): ControlledReuseExecutionEvidence {
  const base: ControlledReuseExecutionEvidence = {
    action,
    actualSkippedActions,
    nodeId: identity.nodeId,
    previousNodeId: identity.previousNodeId,
    reasonCodes,
    version: CONTROLLED_REUSE_EXECUTION_VERSION,
  };
  if (
    context?.candidate === undefined ||
    !isRecord(context.input.current.decisionArtifact) ||
    !Array.isArray(context.input.current.decisionArtifact.decisions) ||
    !isRecord(context.input.current.decisionArtifact.comparisonRef)
  ) {
    return base;
  }

  const decision = context.input.current.decisionArtifact.decisions.find(
    (item) => item.nodeId === context.candidate?.nodeId,
  );
  const description = context.dependencies.store.describe();
  const invalidated = context.invalidated ?? 0;
  const plannedAction = context.input.plan.action;
  const potentialReuse =
    decision?.status === "allowed" &&
    context.candidate.eligibility.match === "exact" &&
    context.candidate.eligibility.operationKind === "tool_call" &&
    context.candidate.eligibility.sideEffectClass === "read_only"
      ? 1
      : 0;

  return {
    ...base,
    decisionRef: {
      currentRunId:
        context.input.current.decisionArtifact.comparisonRef.currentRunId,
      nodeId: context.candidate.nodeId,
      previousRunId:
        context.input.current.decisionArtifact.comparisonRef.previousRunId,
      version: context.input.current.decisionArtifact.version,
    },
    eligibilityChecks: eligibilityChecks(context.candidate),
    ...(decision === undefined
      ? {}
      : { estimatedAvoidableWork: estimatedWork(decision.estimates) }),
    executionOutcome:
      action === "reuse"
        ? "reused"
        : action === "execute_normally"
          ? "executed_normally"
          : "blocked",
    invalidation: {
      count: invalidated,
      reasonCodes: invalidated === 1 ? reasonCodes : [],
    },
    planExecutionDiff: {
      changed: plannedAction !== action,
      executedAction: action,
      plannedAction,
    },
    policyRef: {
      authorizationVersion: context.input.current.policy.authorizationVersion,
      mode: context.input.current.policy.mode,
      plannerVersion: context.input.current.version,
    },
    privacyPolicy: {
      exportMode: "metadata_only",
      omittedFields: [...EVIDENCE_PRIVACY_EXPORT_FIELDS, "reusable_value"],
      version: EVIDENCE_PRIVACY_POLICY_VERSION,
    },
    realizedMetrics: {
      actualSkippedActions,
      invalidations: invalidated,
      normalExecutions: action === "execute_normally" ? 1 : 0,
      plannedReuse: plannedAction === "reuse" ? 1 : 0,
      potentialReuse,
    },
    reasonCodes,
    storeRef: {
      ...(safeReference(description.lifetime.id)
        ? { id: description.lifetime.id }
        : {}),
      outcome: context.storeOutcome ?? "not_checked",
      ...(safeReference(context.dependencies.codec.version)
        ? { valueSchemaVersion: context.dependencies.codec.version }
        : {}),
      version: description.version,
    },
    validatorOutcomes: validatorOutcomes(
      context.candidate,
      context.behaviorEquivalence ?? "not_run",
    ),
  };
}

interface EvidenceContext {
  readonly behaviorEquivalence?: "failed" | "passed";
  readonly candidate?:
    | ControlledReusePlanningInput["candidates"][number]
    | undefined;
  readonly dependencies: {
    readonly codec: { readonly version: string };
    readonly store: EphemeralReuseValueStore;
  };
  readonly input: ControlledReuseExecutionInput;
  readonly invalidated?: 0 | 1;
  readonly storeOutcome?: ControlledReuseStoreReference["outcome"];
}

function eligibilityChecks(
  candidate: ControlledReusePlanningInput["candidates"][number],
): readonly ControlledReuseEligibilityCheck[] {
  const sourceStatus =
    candidate.evidence.source.equivalence === "unknown"
      ? "unknown"
      : candidate.evidence.source.currentFingerprint ===
          candidate.evidence.source.previousFingerprint
        ? "passed"
        : "failed";
  return [
    check(
      "decision_status",
      candidate.eligibility.decisionStatus === "allowed",
    ),
    check("exact_match", candidate.eligibility.match === "exact"),
    check(
      "operation_kind",
      candidate.eligibility.operationKind === "tool_call",
    ),
    check(
      "side_effect_class",
      candidate.eligibility.sideEffectClass === "read_only",
    ),
    { name: "source_equivalence", status: sourceStatus },
    { name: "freshness", status: candidate.evidence.freshness.status },
    { name: "dependencies", status: candidate.evidence.dependencies.status },
    { name: "policy", status: candidate.evidence.policy.status },
  ];
}

function check(
  name: ControlledReuseEligibilityCheck["name"],
  passed: boolean,
): ControlledReuseEligibilityCheck {
  return { name, status: passed ? "passed" : "failed" };
}

function validatorOutcomes(
  candidate: ControlledReusePlanningInput["candidates"][number],
  behaviorEquivalence: ControlledReuseValidatorOutcome["status"],
): readonly ControlledReuseValidatorOutcome[] {
  return [
    ...candidate.validators.required.map((id) => ({
      id,
      status: candidate.validators.passed.includes(id)
        ? ("passed" as const)
        : ("failed" as const),
    })),
    { id: "behavior_equivalence", status: behaviorEquivalence },
  ];
}

function estimatedWork(
  estimates: Readonly<{
    costUsd?: number;
    latencyMs?: number;
    totalTokens?: number;
  }>,
): ControlledReuseEstimatedAvoidableWork {
  return {
    classification: "estimated",
    ...(finiteNonNegative(estimates.costUsd)
      ? { costUsd: estimates.costUsd }
      : {}),
    ...(finiteNonNegative(estimates.latencyMs)
      ? { latencyMs: estimates.latencyMs }
      : {}),
    ...(finiteNonNegative(estimates.totalTokens)
      ? { totalTokens: estimates.totalTokens }
      : {}),
  };
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameReuseIdentity(
  planned: ControlledReuseNodePlan,
  current: ControlledReuseNodePlan,
): boolean {
  const left = planned.provenance;
  const right = current.provenance;
  return (
    planned.action === "reuse" &&
    current.action === "reuse" &&
    planned.nodeId === current.nodeId &&
    planned.previousNodeId === current.previousNodeId &&
    left !== undefined &&
    right !== undefined &&
    left.authorizationVersion === right.authorizationVersion &&
    left.comparisonVersion === right.comparisonVersion &&
    left.currentRunId === right.currentRunId &&
    left.decisionArtifactVersion === right.decisionArtifactVersion &&
    left.decisionNodeId === right.decisionNodeId &&
    left.fingerprint === right.fingerprint &&
    left.plannerVersion === right.plannerVersion &&
    left.previousNodeId === right.previousNodeId &&
    left.previousRunId === right.previousRunId
  );
}

/** Serializes metadata-only execution evidence with stable object key ordering. */
export function serializeControlledReuseExecutionEvidence(
  evidence: ControlledReuseExecutionEvidence,
): string {
  if (!isControlledReuseExecutionEvidence(evidence)) {
    throw new Error("Expected valid controlled-reuse execution evidence.");
  }
  return JSON.stringify(sortJson(evidence));
}

/** Parses current rich evidence and legacy minimal v0 execution evidence. */
export function parseControlledReuseExecutionEvidence(
  serialized: string,
): ControlledReuseExecutionEvidence {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isControlledReuseExecutionEvidence(parsed)) {
    throw new Error(`Expected ${CONTROLLED_REUSE_EXECUTION_VERSION} evidence.`);
  }
  return parsed;
}

export function renderControlledReuseExecutionEvidence(
  evidence: ControlledReuseExecutionEvidence,
  format: ControlledReuseExecutionEvidenceRenderFormat,
): string {
  if (!isControlledReuseExecutionEvidence(evidence)) {
    throw new Error("Expected valid controlled-reuse execution evidence.");
  }
  if (format === "json") {
    return `${serializeControlledReuseExecutionEvidence(evidence)}\n`;
  }

  const metrics = evidence.realizedMetrics;
  const store = evidence.storeRef;
  const diff = evidence.planExecutionDiff;
  const validators = evidence.validatorOutcomes ?? [];
  const estimates = evidence.estimatedAvoidableWork;
  return [
    "Migaki Controlled Reuse Execution",
    `Node: ${evidence.previousNodeId} -> ${evidence.nodeId}`,
    `Plan/execution: ${diff?.plannedAction ?? "unknown"} -> ${
      diff?.executedAction ?? evidence.action
    } (${diff?.changed === true ? "changed" : "unchanged"})`,
    metrics === undefined
      ? `Outcomes: ${evidence.actualSkippedActions} skipped`
      : `Outcomes: ${metrics.potentialReuse} potential, ${metrics.plannedReuse} planned, ${metrics.actualSkippedActions} skipped, ${metrics.normalExecutions} normal, ${metrics.invalidations} invalidated`,
    `Store: ${store?.outcome ?? "unknown"} (${store?.version ?? "unknown"})`,
    `Validators: ${
      validators.length === 0
        ? "none"
        : validators
            .map((validator) => `${validator.id} ${validator.status}`)
            .join("; ")
    }`,
    `Estimates: ${formatEstimates(estimates)}; realized metrics are reported separately`,
    `Reasons: ${
      evidence.reasonCodes.length === 0
        ? "none"
        : evidence.reasonCodes.join(", ")
    }`,
    "",
  ].join("\n");
}

function formatEstimates(
  estimates: ControlledReuseEstimatedAvoidableWork | undefined,
): string {
  if (
    estimates === undefined ||
    (estimates.costUsd === undefined &&
      estimates.latencyMs === undefined &&
      estimates.totalTokens === undefined)
  ) {
    return "none";
  }
  return [
    ...(estimates.totalTokens === undefined
      ? []
      : [`${estimates.totalTokens} tokens`]),
    ...(estimates.costUsd === undefined ? [] : [`${estimates.costUsd} usd`]),
    ...(estimates.latencyMs === undefined ? [] : [`${estimates.latencyMs} ms`]),
  ].join(", ");
}

function isControlledReuseExecutionEvidence(
  value: unknown,
): value is ControlledReuseExecutionEvidence {
  if (
    !isRecord(value) ||
    containsPrivacyUnsafeValue(value) ||
    value.version !== CONTROLLED_REUSE_EXECUTION_VERSION ||
    !safeReference(value.nodeId) ||
    !safeReference(value.previousNodeId) ||
    !["blocked", "execute_normally", "reuse"].includes(String(value.action)) ||
    (value.actualSkippedActions !== 0 && value.actualSkippedActions !== 1) ||
    !Array.isArray(value.reasonCodes) ||
    !value.reasonCodes.every((code) => safeReference(code))
  ) {
    return false;
  }

  const richFields = [
    value.decisionRef,
    value.eligibilityChecks,
    value.executionOutcome,
    value.invalidation,
    value.planExecutionDiff,
    value.policyRef,
    value.privacyPolicy,
    value.realizedMetrics,
    value.storeRef,
    value.validatorOutcomes,
  ];
  if (richFields.every((field) => field === undefined)) {
    return Object.keys(value).every((key) =>
      LEGACY_CONTROLLED_REUSE_EXECUTION_FIELDS.has(key),
    );
  }

  return (
    hasOnlyFields(value, RICH_CONTROLLED_REUSE_EXECUTION_FIELDS) &&
    isDecisionRef(value.decisionRef) &&
    Array.isArray(value.eligibilityChecks) &&
    value.eligibilityChecks.every(isEligibilityCheck) &&
    ["blocked", "executed_normally", "reused"].includes(
      String(value.executionOutcome),
    ) &&
    isInvalidation(value.invalidation) &&
    isPlanExecutionDiff(value.planExecutionDiff) &&
    isPolicyRef(value.policyRef) &&
    isPrivacyPolicy(value.privacyPolicy) &&
    isRealizedMetrics(value.realizedMetrics) &&
    isStoreRef(value.storeRef) &&
    Array.isArray(value.validatorOutcomes) &&
    value.validatorOutcomes.every(isValidatorOutcome) &&
    (value.estimatedAvoidableWork === undefined ||
      isEstimatedWork(value.estimatedAvoidableWork)) &&
    hasCoherentRichExecutionOutcome(value)
  );
}

function hasCoherentRichExecutionOutcome(
  value: Readonly<Record<string, unknown>>,
): boolean {
  if (
    !isRecord(value.invalidation) ||
    !isRecord(value.planExecutionDiff) ||
    !isRecord(value.realizedMetrics) ||
    !isRecord(value.storeRef)
  ) {
    return false;
  }

  const action = value.action;
  const invalidations = value.realizedMetrics.invalidations;
  const plannedAction = value.planExecutionDiff.plannedAction;
  const expectedOutcome =
    action === "reuse"
      ? "reused"
      : action === "execute_normally"
        ? "executed_normally"
        : "blocked";
  const expectedSkippedActions = action === "reuse" ? 1 : 0;
  const expectedNormalExecutions = action === "execute_normally" ? 1 : 0;
  const expectedPlannedReuse = plannedAction === "reuse" ? 1 : 0;

  if (
    value.executionOutcome !== expectedOutcome ||
    value.planExecutionDiff.executedAction !== action ||
    value.planExecutionDiff.changed !== (plannedAction !== action) ||
    value.actualSkippedActions !== expectedSkippedActions ||
    value.realizedMetrics.actualSkippedActions !== expectedSkippedActions ||
    value.realizedMetrics.normalExecutions !== expectedNormalExecutions ||
    invalidations !== value.invalidation.count ||
    value.realizedMetrics.plannedReuse !== expectedPlannedReuse ||
    (expectedPlannedReuse === 1 && value.realizedMetrics.potentialReuse !== 1)
  ) {
    return false;
  }

  if (action === "reuse") {
    return invalidations === 0 && value.storeRef.outcome === "hit";
  }
  if (action === "blocked") {
    return invalidations === 0 && value.storeRef.outcome === "not_checked";
  }
  return value.storeRef.outcome === "invalidated"
    ? invalidations === 1
    : invalidations === 0 &&
        (value.storeRef.outcome === "miss" ||
          value.storeRef.outcome === "not_checked");
}

function containsPrivacyUnsafeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/u.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsPrivacyUnsafeValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  const prohibitedKeys = new Set([
    "credential",
    "customerdata",
    "filepath",
    "localmachinepath",
    "localpath",
    "prompt",
    "providerresponse",
    "reusablevalue",
    "secret",
    "toolinput",
    "tooloutput",
    "value",
  ]);
  return Object.entries(value).some(
    ([key, item]) =>
      prohibitedKeys.has(key.replace(/[_-]/gu, "").toLowerCase()) ||
      containsPrivacyUnsafeValue(item),
  );
}

function isDecisionRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set(["currentRunId", "nodeId", "previousRunId", "version"]),
    ) &&
    safeReference(value.currentRunId) &&
    safeReference(value.previousRunId) &&
    safeReference(value.nodeId) &&
    value.version === REUSE_DECISION_ARTIFACT_VERSION
  );
}

function isEligibilityCheck(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(value, new Set(["name", "status"])) &&
    safeReference(value.name) &&
    ["failed", "passed", "unknown"].includes(String(value.status))
  );
}

function isInvalidation(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(value, new Set(["count", "reasonCodes"])) &&
    (value.count === 0 || value.count === 1) &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.every((code) => safeReference(code))
  );
}

function isPlanExecutionDiff(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set(["changed", "executedAction", "plannedAction"]),
    ) &&
    typeof value.changed === "boolean" &&
    ["blocked", "execute_normally", "reuse"].includes(
      String(value.executedAction),
    ) &&
    ["blocked", "execute_normally", "reuse"].includes(
      String(value.plannedAction),
    )
  );
}

function isPolicyRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set(["authorizationVersion", "mode", "plannerVersion"]),
    ) &&
    value.authorizationVersion === CONTROLLED_REUSE_AUTHORIZATION_VERSION &&
    (value.mode === "disabled" || value.mode === "exact_read_only_tool_call") &&
    value.plannerVersion === CONTROLLED_REUSE_PLAN_VERSION
  );
}

function isPrivacyPolicy(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(value, new Set(["exportMode", "omittedFields", "version"])) &&
    value.exportMode === "metadata_only" &&
    value.version === EVIDENCE_PRIVACY_POLICY_VERSION &&
    Array.isArray(value.omittedFields) &&
    value.omittedFields.every((field) => safeReference(field))
  );
}

function isRealizedMetrics(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set([
        "actualSkippedActions",
        "invalidations",
        "normalExecutions",
        "plannedReuse",
        "potentialReuse",
      ]),
    ) &&
    [
      value.actualSkippedActions,
      value.invalidations,
      value.normalExecutions,
      value.plannedReuse,
      value.potentialReuse,
    ].every((metric) => metric === 0 || metric === 1)
  );
}

function isStoreRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set(["id", "outcome", "valueSchemaVersion", "version"]),
    ) &&
    value.version === REUSE_VALUE_STORE_VERSION &&
    ["hit", "invalidated", "miss", "not_checked"].includes(
      String(value.outcome),
    ) &&
    (value.id === undefined || safeReference(value.id)) &&
    (value.valueSchemaVersion === undefined ||
      safeReference(value.valueSchemaVersion))
  );
}

function isValidatorOutcome(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(value, new Set(["id", "status"])) &&
    safeReference(value.id) &&
    ["failed", "not_run", "passed"].includes(String(value.status))
  );
}

function isEstimatedWork(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyFields(
      value,
      new Set(["classification", "costUsd", "latencyMs", "totalTokens"]),
    ) &&
    value.classification === "estimated" &&
    [value.costUsd, value.latencyMs, value.totalTokens].every(
      (metric) => metric === undefined || finiteNonNegative(metric),
    )
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}
