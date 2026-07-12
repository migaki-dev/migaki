import {
  CONTROLLED_REUSE_AUTHORIZATION_VERSION,
  validateControlledReuseAuthorization,
  type ControlledReuseAuthorizationInput,
  type ControlledReuseAuthorizationReasonCode,
  type ControlledReuseEligibility,
  type ControlledReuseEvidence,
  type ControlledReuseMode,
  type ControlledReusableValuePolicy,
} from "./controlled-reuse.js";
import type { ReuseDecisionArtifact } from "./observed-trajectory-comparison.js";

export const CONTROLLED_REUSE_PLAN_VERSION = "migaki.controlled-reuse-plan.v0";

export type ControlledReusePlanVersion = typeof CONTROLLED_REUSE_PLAN_VERSION;
export type ControlledReusePlanAction =
  | "blocked"
  | "execute_normally"
  | "reuse";
export type ControlledReusePlanReasonCode =
  | ControlledReuseAuthorizationReasonCode
  | "incompatible_authorization_input"
  | "incompatible_plan_version"
  | "previous_node_mismatch"
  | "validator_contract_mismatch";

export interface ControlledReusePlanningPolicy {
  readonly authorizationVersion: typeof CONTROLLED_REUSE_AUTHORIZATION_VERSION;
  readonly mode: ControlledReuseMode;
}

export interface ControlledReusePlanningCandidate {
  readonly eligibility: ControlledReuseEligibility;
  readonly evidence: ControlledReuseEvidence;
  readonly nodeId: string;
  readonly previousNodeId: string;
  readonly reusableValue: ControlledReusableValuePolicy;
  readonly validators: ControlledReuseAuthorizationInput["validators"];
}

export interface ControlledReusePlanningInput {
  readonly candidates: readonly ControlledReusePlanningCandidate[];
  readonly decisionArtifact: ReuseDecisionArtifact;
  readonly policy: ControlledReusePlanningPolicy;
  readonly version: ControlledReusePlanVersion;
}

export interface ControlledReusePlanProvenance {
  readonly authorizationVersion: typeof CONTROLLED_REUSE_AUTHORIZATION_VERSION;
  readonly comparisonVersion: string;
  readonly currentRunId: string;
  readonly decisionArtifactVersion: string;
  readonly decisionNodeId: string;
  readonly fingerprint: string;
  readonly plannerVersion: ControlledReusePlanVersion;
  readonly previousNodeId: string;
  readonly previousRunId: string;
}

export interface ControlledReuseNodePlan {
  readonly action: ControlledReusePlanAction;
  readonly nodeId: string;
  readonly previousNodeId: string;
  readonly provenance?: ControlledReusePlanProvenance;
  readonly reasonCodes: readonly ControlledReusePlanReasonCode[];
}

export interface ControlledReusePlanWarning {
  readonly code: ControlledReusePlanReasonCode;
  readonly message: string;
  readonly nodeId: string;
}

export interface ControlledReusePlan {
  readonly nodes: readonly ControlledReuseNodePlan[];
  readonly version: ControlledReusePlanVersion;
  readonly warnings: readonly ControlledReusePlanWarning[];
}

/**
 * Produces metadata-only execution choices. It never reads a value, invokes a
 * tool, skips a node, persists state, or consults wall-clock time.
 */
export function planControlledReuse(
  input: ControlledReusePlanningInput,
  options: { readonly now: string },
): ControlledReusePlan {
  if (input.version !== CONTROLLED_REUSE_PLAN_VERSION) {
    return blockedPlan(
      input.candidates,
      "incompatible_plan_version",
      `Expected ${CONTROLLED_REUSE_PLAN_VERSION}; received ${String(input.version)}.`,
    );
  }

  const nodes = input.candidates.map((candidate) =>
    planCandidate(input, candidate, options.now),
  );

  return {
    nodes,
    version: CONTROLLED_REUSE_PLAN_VERSION,
    warnings: nodes.flatMap((node) =>
      node.reasonCodes.map((code) => ({
        code,
        message: reasonMessage(code),
        nodeId: node.nodeId,
      })),
    ),
  };
}

function planCandidate(
  input: ControlledReusePlanningInput,
  candidate: ControlledReusePlanningCandidate,
  now: string,
): ControlledReuseNodePlan {
  const authorizationInput = {
    decisionArtifact: input.decisionArtifact,
    decisionNodeId: candidate.nodeId,
    eligibility: candidate.eligibility,
    evidence: candidate.evidence,
    mode: input.policy.mode,
    reusableValue: candidate.reusableValue,
    validators: candidate.validators,
    version: input.policy.authorizationVersion,
  };
  const validation = validateControlledReuseAuthorization(authorizationInput, {
    now,
  });

  if (!validation.success) {
    return nodePlan(candidate, "blocked", ["incompatible_authorization_input"]);
  }

  const decision = input.decisionArtifact.decisions.find(
    (item) => item.nodeId === candidate.nodeId,
  );
  const reasons: ControlledReusePlanReasonCode[] =
    validation.authorization.reasons.map((reason) => reason.code);

  if (
    decision !== undefined &&
    decision.previousNodeId !== candidate.previousNodeId
  ) {
    reasons.push("previous_node_mismatch");
  }
  if (
    decision !== undefined &&
    !decision.requiredValidators.every(
      (validator) =>
        candidate.validators.required.includes(validator) &&
        candidate.validators.passed.includes(validator),
    )
  ) {
    reasons.push("validator_contract_mismatch");
  }

  const reasonCodes = deduplicate(reasons);
  if (reasonCodes.length === 0 && decision !== undefined) {
    return {
      ...nodePlan(candidate, "reuse", []),
      provenance: {
        authorizationVersion: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
        comparisonVersion: input.decisionArtifact.comparisonRef.version,
        currentRunId: input.decisionArtifact.comparisonRef.currentRunId,
        decisionArtifactVersion: input.decisionArtifact.version,
        decisionNodeId: decision.nodeId,
        fingerprint: candidate.reusableValue.provenance.fingerprint,
        plannerVersion: CONTROLLED_REUSE_PLAN_VERSION,
        previousNodeId: decision.previousNodeId,
        previousRunId: input.decisionArtifact.comparisonRef.previousRunId,
      },
    };
  }

  return nodePlan(
    candidate,
    shouldExecuteNormally(reasonCodes, decision?.status)
      ? "execute_normally"
      : "blocked",
    reasonCodes,
  );
}

function shouldExecuteNormally(
  reasons: readonly ControlledReusePlanReasonCode[],
  decisionStatus: "allowed" | "blocked" | "needs_review" | undefined,
): boolean {
  if (decisionStatus === "blocked") {
    return false;
  }

  return reasons.every(
    (code) =>
      code === "decision_not_found" ||
      code === "opt_in_required" ||
      code.endsWith("needs_review") ||
      (code === "decision_status_mismatch" &&
        decisionStatus === "needs_review"),
  );
}

function blockedPlan(
  candidates: readonly ControlledReusePlanningCandidate[],
  code: ControlledReusePlanReasonCode,
  message: string,
): ControlledReusePlan {
  return {
    nodes: candidates.map((candidate) =>
      nodePlan(candidate, "blocked", [code]),
    ),
    version: CONTROLLED_REUSE_PLAN_VERSION,
    warnings: candidates.map((candidate) => ({
      code,
      message,
      nodeId: candidate.nodeId,
    })),
  };
}

function nodePlan(
  candidate: ControlledReusePlanningCandidate,
  action: ControlledReusePlanAction,
  reasonCodes: readonly ControlledReusePlanReasonCode[],
): ControlledReuseNodePlan {
  return {
    action,
    nodeId: candidate.nodeId,
    previousNodeId: candidate.previousNodeId,
    reasonCodes,
  };
}

function deduplicate(
  reasons: readonly ControlledReusePlanReasonCode[],
): readonly ControlledReusePlanReasonCode[] {
  return reasons.filter((reason, index) => reasons.indexOf(reason) === index);
}

function reasonMessage(code: ControlledReusePlanReasonCode): string {
  switch (code) {
    case "incompatible_authorization_input":
      return "The authorization policy or decision artifact is malformed or incompatible.";
    case "incompatible_plan_version":
      return "The controlled-reuse planner contract version is incompatible.";
    case "previous_node_mismatch":
      return "The current candidate does not identify the decision's previous node.";
    case "validator_contract_mismatch":
      return "The current validator outcomes do not satisfy the decision artifact.";
    default:
      return `Controlled reuse was not selected: ${code}.`;
  }
}
