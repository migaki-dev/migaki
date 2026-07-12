import {
  planControlledReuse,
  type ControlledReuseNodePlan,
  type ControlledReusePlanningInput,
  type ControlledReusePlanReasonCode,
} from "./controlled-reuse-planner.js";
import {
  REUSE_VALUE_STORE_VERSION,
  type EphemeralReuseValueStore,
  type ReuseValueCodec,
  type ReuseValueMetadata,
  type ReuseValueStoreReasonCode,
} from "./reuse-value-store.js";

export const CONTROLLED_REUSE_EXECUTION_VERSION =
  "migaki.controlled-reuse-execution.v0";

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
  readonly nodeId: string;
  readonly previousNodeId: string;
  readonly reasonCodes: readonly ControlledReuseExecutionReasonCode[];
  readonly version: ControlledReuseExecutionVersion;
}

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

  if (
    input.version !== CONTROLLED_REUSE_EXECUTION_VERSION ||
    candidate === undefined ||
    input.plan.nodeId !== input.nodeId
  ) {
    return blocked(identity, ["incompatible_execution_input"]);
  }

  // Re-run all authorization, source, freshness, dependency, policy,
  // side-effect, provenance, and validator checks before any execution path.
  // The recomputed plan is also the sole source of actions and reason codes.
  const currentPlan = planControlledReuse(input.current, {
    now: dependencies.now,
  }).nodes.find((node) => node.nodeId === input.nodeId);
  if (currentPlan === undefined) {
    return blocked(identity, ["incompatible_execution_input"]);
  }
  if (currentPlan.action === "blocked") {
    return blocked(identity, currentPlan.reasonCodes);
  }
  if (currentPlan.action === "execute_normally") {
    return executeNormally(identity, currentPlan.reasonCodes, dependencies);
  }
  if (!sameReuseIdentity(input.plan, currentPlan)) {
    return blocked(identity, ["plan_identity_mismatch"]);
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
    return executeNormally(identity, lookup.reasonCodes, dependencies);
  }

  const equivalent = behaviorEquivalent(
    lookup.value,
    lookup.metadata,
    dependencies.validateBehaviorEquivalence,
  );
  if (!equivalent) {
    dependencies.store.invalidate({
      provenance: candidate.reusableValue.provenance,
      version: REUSE_VALUE_STORE_VERSION,
    });
    return executeNormally(
      identity,
      ["behavior_equivalence_failed"],
      dependencies,
    );
  }

  return {
    evidence: evidence(identity, "reuse", 1, []),
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
): Promise<ControlledReuseExecutionResult<T>> {
  const value = await dependencies.executeNormally();
  return {
    evidence: evidence(identity, "execute_normally", 0, reasonCodes),
    status: "executed_normally",
    value,
  };
}

function blocked(
  identity: OperationIdentity,
  reasonCodes: readonly ControlledReuseExecutionReasonCode[],
): ControlledReuseExecutionResult<never> {
  return {
    evidence: evidence(identity, "blocked", 0, reasonCodes),
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
): ControlledReuseExecutionEvidence {
  return {
    action,
    actualSkippedActions,
    nodeId: identity.nodeId,
    previousNodeId: identity.previousNodeId,
    reasonCodes,
    version: CONTROLLED_REUSE_EXECUTION_VERSION,
  };
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
