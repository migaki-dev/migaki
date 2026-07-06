import type { MIRSideEffectClass } from "@migaki/mir";

import {
  stableExecutionDigest,
  type Artifact,
  type Dependency,
  type ExecutionGraph,
  type ExecutionNode,
  type Metadata,
} from "./execution.js";
import {
  EVIDENCE_PRIVACY_EXPORT_FIELDS,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  type EvidencePrivacyPolicyReference,
} from "./evidence-bundle.js";

export const OBSERVED_TRAJECTORY_COMPARISON_VERSION =
  "migaki.observed-trajectory-comparison.v0";
export const REUSE_DECISION_ARTIFACT_VERSION = "migaki.reuse-decision.v0";

export type ObservedTrajectoryComparisonVersion =
  typeof OBSERVED_TRAJECTORY_COMPARISON_VERSION;
export type ReuseDecisionArtifactVersion =
  typeof REUSE_DECISION_ARTIFACT_VERSION;

export type ObservedTrajectoryReusableOperationKind =
  | "model_call"
  | "tool_call";

export type ObservedTrajectoryCheckStatus = "failed" | "passed" | "unknown";

export type ObservedTrajectoryCheckName =
  | "cache_key_equality"
  | "dependency_equality"
  | "freshness_constraints"
  | "policy_constraints"
  | "runtime_compatibility"
  | "side_effects"
  | "status_success"
  | "validator_requirements";

export type ObservedTrajectoryBlockerCode =
  | "cache_key_unknown"
  | "dependency_mismatch"
  | "freshness_unknown"
  | "mixed_status"
  | "policy_unknown"
  | "policy_denied"
  | "runtime_incompatible"
  | "runtime_unknown"
  | "side_effect_policy_missing"
  | "side_effect_unknown"
  | "side_effecting_tool"
  | "validator_missing";

export interface ObservedTrajectoryEstimate {
  readonly costUsd?: number;
  readonly latencyMs?: number;
  readonly totalTokens?: number;
}

export interface ObservedTrajectoryCheck {
  readonly blockerCode?: ObservedTrajectoryBlockerCode;
  readonly message: string;
  readonly name: ObservedTrajectoryCheckName;
  readonly status: ObservedTrajectoryCheckStatus;
}

export interface ObservedTrajectoryBlocker {
  readonly code: ObservedTrajectoryBlockerCode;
  readonly message: string;
}

export interface ObservedTrajectoryReusableNode {
  readonly cacheKey: string;
  readonly checks: readonly ObservedTrajectoryCheck[];
  readonly estimates: ObservedTrajectoryEstimate;
  readonly nodeId: string;
  readonly operationKind: ObservedTrajectoryReusableOperationKind;
  readonly previousNodeId: string;
  readonly requiredValidators: readonly string[];
  readonly sideEffectClass?: MIRSideEffectClass;
}

export interface ObservedTrajectoryBlockedCandidate {
  readonly cacheKey?: string;
  readonly checks: readonly ObservedTrajectoryCheck[];
  readonly estimates: ObservedTrajectoryEstimate;
  readonly nodeId: string;
  readonly operationKind: ObservedTrajectoryReusableOperationKind;
  readonly previousNodeId: string;
  readonly reasons: readonly ObservedTrajectoryBlocker[];
  readonly requiredValidators: readonly string[];
  readonly sideEffectClass?: MIRSideEffectClass;
}

export interface ObservedTrajectoryChangedNode {
  readonly nodeId: string;
  readonly operationKind: ObservedTrajectoryReusableOperationKind;
  readonly previousNodeId?: string;
  readonly reason: "cache_key_changed" | "missing_previous_node";
}

export interface ObservedTrajectoryWarning {
  readonly code: "potential_reuse_only";
  readonly message: string;
}

export interface ObservedTrajectoryComparisonSummary {
  readonly blockedCandidates: number;
  readonly changedNodes: number;
  readonly reusableModelCalls: number;
  readonly reusableToolCalls: number;
  readonly totalEstimatedAvoidableCostUsd?: number;
  readonly totalEstimatedAvoidableLatencyMs?: number;
  readonly totalEstimatedAvoidableTokens?: number;
}

export interface ObservedTrajectoryComparison {
  readonly blockedCandidates: readonly ObservedTrajectoryBlockedCandidate[];
  readonly changedNodes: readonly ObservedTrajectoryChangedNode[];
  readonly currentRunId: string;
  readonly privacyPolicy: EvidencePrivacyPolicyReference;
  readonly previousRunId: string;
  readonly reusableModelCalls: readonly ObservedTrajectoryReusableNode[];
  readonly reusableToolCalls: readonly ObservedTrajectoryReusableNode[];
  readonly summary: ObservedTrajectoryComparisonSummary;
  readonly version: ObservedTrajectoryComparisonVersion;
  readonly warnings: readonly ObservedTrajectoryWarning[];
}

export type ReuseDecisionStatus = "allowed" | "blocked" | "needs_review";

export type ReuseDecisionReasonCode =
  | ObservedTrajectoryBlockerCode
  | "model_reuse_needs_review"
  | "mutation_reuse_needs_review";

export interface ReuseDecisionReason {
  readonly code: ReuseDecisionReasonCode;
  readonly message: string;
}

export interface ReuseDecisionEvidenceSummary {
  readonly message: string;
  readonly status: ObservedTrajectoryCheckStatus;
}

export interface ReuseDecision {
  readonly cacheKey?: string;
  readonly dependencyEvidence: ReuseDecisionEvidenceSummary;
  readonly estimates: ObservedTrajectoryEstimate;
  readonly freshnessEvidence: ReuseDecisionEvidenceSummary;
  readonly nodeId: string;
  readonly operationKind: ObservedTrajectoryReusableOperationKind;
  readonly policyConstraints: ReuseDecisionEvidenceSummary;
  readonly previousNodeId: string;
  readonly reasons: readonly ReuseDecisionReason[];
  readonly requiredValidators: readonly string[];
  readonly sideEffectClass?: MIRSideEffectClass;
  readonly status: ReuseDecisionStatus;
}

export interface ReuseDecisionArtifactRedaction {
  readonly mode: "metadata_only";
  readonly omittedFields: readonly (typeof EVIDENCE_PRIVACY_EXPORT_FIELDS)[number][];
  readonly reason: string;
}

export interface ReuseDecisionArtifactSummary {
  readonly allowed: number;
  readonly blocked: number;
  readonly needsReview: number;
  readonly totalCandidates: number;
}

export interface ReuseDecisionArtifact {
  readonly comparisonRef: {
    readonly currentRunId: string;
    readonly previousRunId: string;
    readonly version: ObservedTrajectoryComparisonVersion;
  };
  readonly createdAt: string;
  readonly decisions: readonly ReuseDecision[];
  readonly invariant: string;
  readonly privacyPolicy: EvidencePrivacyPolicyReference;
  readonly redaction: ReuseDecisionArtifactRedaction;
  readonly summary: ReuseDecisionArtifactSummary;
  readonly version: ReuseDecisionArtifactVersion;
}

export type ReuseDecisionRenderFormat = "human" | "json";

interface CandidateReview {
  readonly cacheKey?: string;
  readonly checks: readonly ObservedTrajectoryCheck[];
  readonly estimates: ObservedTrajectoryEstimate;
  readonly reasons: readonly ObservedTrajectoryBlocker[];
  readonly requiredValidators: readonly string[];
  readonly sideEffectClass?: MIRSideEffectClass;
}

interface ToolReplaySafetyMetadata {
  readonly approvalEvidenceRef?: string;
  readonly idempotencyKeyRef?: string;
  readonly policyEvidenceRef?: string;
  readonly sideEffectClass?: MIRSideEffectClass;
}

const sideEffectClasses = new Set<MIRSideEffectClass>([
  "approval_required",
  "idempotent_mutation",
  "non_idempotent_mutation",
  "read_only",
  "unknown",
]);

export function compareObservedExecutionGraphs(
  previous: ExecutionGraph,
  current: ExecutionGraph,
): ObservedTrajectoryComparison {
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const reusableModelCalls: ObservedTrajectoryReusableNode[] = [];
  const reusableToolCalls: ObservedTrajectoryReusableNode[] = [];
  const blockedCandidates: ObservedTrajectoryBlockedCandidate[] = [];
  const changedNodes: ObservedTrajectoryChangedNode[] = [];

  for (const currentNode of current.nodes) {
    const operationKind = reusableOperationKind(currentNode);

    if (operationKind === undefined) {
      continue;
    }

    const previousNode = previousNodes.get(currentNode.id);

    if (previousNode === undefined) {
      changedNodes.push({
        nodeId: currentNode.id,
        operationKind,
        reason: "missing_previous_node",
      });
      continue;
    }

    const previousKind = reusableOperationKind(previousNode);

    if (previousKind !== operationKind) {
      changedNodes.push({
        nodeId: currentNode.id,
        operationKind,
        previousNodeId: previousNode.id,
        reason: "cache_key_changed",
      });
      continue;
    }

    const previousCacheKey = previousNode.operation.fingerprint;
    const currentCacheKey = currentNode.operation.fingerprint;

    if (
      previousCacheKey !== undefined &&
      currentCacheKey !== undefined &&
      previousCacheKey !== currentCacheKey
    ) {
      changedNodes.push({
        nodeId: currentNode.id,
        operationKind,
        previousNodeId: previousNode.id,
        reason: "cache_key_changed",
      });
      continue;
    }

    const review = reviewCandidate({
      current,
      currentNode,
      operationKind,
      previous,
      previousNode,
    });

    if (review.reasons.length > 0) {
      blockedCandidates.push({
        ...(review.cacheKey === undefined ? {} : { cacheKey: review.cacheKey }),
        checks: review.checks,
        estimates: review.estimates,
        nodeId: currentNode.id,
        operationKind,
        previousNodeId: previousNode.id,
        reasons: review.reasons,
        requiredValidators: review.requiredValidators,
        ...(review.sideEffectClass === undefined
          ? {}
          : { sideEffectClass: review.sideEffectClass }),
      });
      continue;
    }

    if (review.cacheKey === undefined) {
      blockedCandidates.push({
        checks: review.checks,
        estimates: review.estimates,
        nodeId: currentNode.id,
        operationKind,
        previousNodeId: previousNode.id,
        reasons: [
          {
            code: "cache_key_unknown",
            message: "Both observed nodes require a stable cache key.",
          },
        ],
        requiredValidators: review.requiredValidators,
        ...(review.sideEffectClass === undefined
          ? {}
          : { sideEffectClass: review.sideEffectClass }),
      });
      continue;
    }

    const reusableNode: ObservedTrajectoryReusableNode = {
      cacheKey: review.cacheKey,
      checks: review.checks,
      estimates: review.estimates,
      nodeId: currentNode.id,
      operationKind,
      previousNodeId: previousNode.id,
      requiredValidators: review.requiredValidators,
      ...(review.sideEffectClass === undefined
        ? {}
        : { sideEffectClass: review.sideEffectClass }),
    };

    if (operationKind === "model_call") {
      reusableModelCalls.push(reusableNode);
    } else {
      reusableToolCalls.push(reusableNode);
    }
  }

  const reusableNodes = [...reusableModelCalls, ...reusableToolCalls];

  return {
    blockedCandidates,
    changedNodes,
    currentRunId: current.runId,
    privacyPolicy: {
      exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
      exportMode: "metadata_only",
      fullTraceOptIn: false,
    },
    previousRunId: previous.runId,
    reusableModelCalls,
    reusableToolCalls,
    summary: {
      blockedCandidates: blockedCandidates.length,
      changedNodes: changedNodes.length,
      reusableModelCalls: reusableModelCalls.length,
      reusableToolCalls: reusableToolCalls.length,
      ...sumReusableEstimates(reusableNodes),
    },
    version: OBSERVED_TRAJECTORY_COMPARISON_VERSION,
    warnings: [
      {
        code: "potential_reuse_only",
        message:
          "Observed trajectory comparison only identifies potential reusable nodes; it never executes, replays, caches, or skips work.",
      },
    ],
  };
}

export function createReuseDecisionArtifact(
  comparison: ObservedTrajectoryComparison,
  options: { readonly createdAt?: string } = {},
): ReuseDecisionArtifact {
  const decisions = sortReuseDecisions([
    ...comparison.reusableModelCalls.map(decideReusableNode),
    ...comparison.reusableToolCalls.map(decideReusableNode),
    ...comparison.blockedCandidates.map(decideBlockedCandidate),
  ]);

  return {
    comparisonRef: {
      currentRunId: comparison.currentRunId,
      previousRunId: comparison.previousRunId,
      version: comparison.version,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decisions,
    invariant:
      "Evidence first, then explicit decision, then replay only in a future issue. This artifact never skips work.",
    privacyPolicy: comparison.privacyPolicy,
    redaction: {
      mode: "metadata_only",
      omittedFields: EVIDENCE_PRIVACY_EXPORT_FIELDS,
      reason:
        "Reuse decisions carry metadata, check statuses, fingerprints, and omission records only; raw prompts, tool payloads, provider responses, credentials, and local paths are omitted.",
    },
    summary: {
      allowed: decisions.filter((decision) => decision.status === "allowed")
        .length,
      blocked: decisions.filter((decision) => decision.status === "blocked")
        .length,
      needsReview: decisions.filter(
        (decision) => decision.status === "needs_review",
      ).length,
      totalCandidates: decisions.length,
    },
    version: REUSE_DECISION_ARTIFACT_VERSION,
  };
}

export function renderReuseDecisionArtifact(
  artifact: ReuseDecisionArtifact,
  format: ReuseDecisionRenderFormat,
): string {
  if (format === "json") {
    return `${stableStringify(artifact)}\n`;
  }

  const lines = [
    "Migaki Reuse Decision",
    `Version: ${artifact.version}`,
    `Runs: ${artifact.comparisonRef.previousRunId} -> ${artifact.comparisonRef.currentRunId}`,
    `Summary: ${artifact.summary.allowed} allowed, ${artifact.summary.needsReview} needs_review, ${artifact.summary.blocked} blocked`,
    `Invariant: ${artifact.invariant}`,
    "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    "Decisions:",
    ...formatDecisionLines(artifact.decisions),
    `Redaction: ${artifact.redaction.mode}; omitted ${artifact.redaction.omittedFields.join(", ")}`,
  ];

  return `${lines.join("\n")}\n`;
}

function reviewCandidate(input: {
  readonly current: ExecutionGraph;
  readonly currentNode: ExecutionNode;
  readonly operationKind: ObservedTrajectoryReusableOperationKind;
  readonly previous: ExecutionGraph;
  readonly previousNode: ExecutionNode;
}): CandidateReview {
  const sideEffectClass =
    input.operationKind === "tool_call"
      ? readToolReplaySafety(input.currentNode).sideEffectClass
      : undefined;

  const checks = [
    checkCacheKeyEquality(input.previousNode, input.currentNode),
    checkDependencyEquality(input.previousNode, input.currentNode),
    checkRuntimeCompatibility(input.previous, input.current),
    checkStatusSuccess(input.previousNode, input.currentNode),
    checkValidatorRequirements(input.previousNode, input.currentNode),
    checkPolicyConstraints(input.previousNode, input.currentNode),
    checkFreshnessConstraints(input.previousNode, input.currentNode),
    checkSideEffects(input.previousNode, input.currentNode),
  ];

  return {
    ...(input.currentNode.operation.fingerprint === undefined
      ? {}
      : { cacheKey: input.currentNode.operation.fingerprint }),
    checks,
    estimates: estimatesForNode(input.currentNode),
    reasons: blockersForChecks(checks),
    requiredValidators:
      input.operationKind === "model_call"
        ? readValidationMetadata(input.currentNode.metadata).required
        : [],
    ...(sideEffectClass === undefined ? {} : { sideEffectClass }),
  };
}

function decideReusableNode(
  node: ObservedTrajectoryReusableNode,
): ReuseDecision {
  if (
    node.operationKind === "tool_call" &&
    node.sideEffectClass === "read_only"
  ) {
    return {
      ...baseDecisionFields(node),
      reasons: [],
      status: "allowed",
    };
  }

  if (node.operationKind === "model_call") {
    return {
      ...baseDecisionFields(node),
      reasons: [
        {
          code: "model_reuse_needs_review",
          message:
            "Model-call reuse requires deterministic replay evidence or explicit acceptance criteria before it can be allowed.",
        },
      ],
      status: "needs_review",
    };
  }

  return {
    ...baseDecisionFields(node),
    reasons: [
      {
        code: "mutation_reuse_needs_review",
        message:
          "Mutation-class tool reuse requires a future replay policy gate even when comparison evidence matches.",
      },
    ],
    status: "needs_review",
  };
}

function decideBlockedCandidate(
  candidate: ObservedTrajectoryBlockedCandidate,
): ReuseDecision {
  return {
    ...baseDecisionFields(candidate),
    reasons: candidate.reasons,
    status: "blocked",
  };
}

function baseDecisionFields(
  candidate:
    | ObservedTrajectoryReusableNode
    | ObservedTrajectoryBlockedCandidate,
): Omit<ReuseDecision, "reasons" | "status"> {
  return {
    ...(candidate.cacheKey === undefined
      ? {}
      : { cacheKey: candidate.cacheKey }),
    dependencyEvidence: evidenceForCheck(candidate, "dependency_equality"),
    estimates: candidate.estimates,
    freshnessEvidence: evidenceForCheck(candidate, "freshness_constraints"),
    nodeId: candidate.nodeId,
    operationKind: candidate.operationKind,
    policyConstraints: evidenceForCheck(candidate, "policy_constraints"),
    previousNodeId: candidate.previousNodeId,
    requiredValidators: candidate.requiredValidators,
    ...(candidate.sideEffectClass === undefined
      ? {}
      : { sideEffectClass: candidate.sideEffectClass }),
  };
}

function evidenceForCheck(
  candidate:
    | ObservedTrajectoryReusableNode
    | ObservedTrajectoryBlockedCandidate,
  name: ObservedTrajectoryCheckName,
): ReuseDecisionEvidenceSummary {
  const check = candidate.checks.find((item) => item.name === name);

  return {
    message: check?.message ?? `Missing ${name} evidence.`,
    status: check?.status ?? "unknown",
  };
}

function sortReuseDecisions(
  decisions: readonly ReuseDecision[],
): readonly ReuseDecision[] {
  return [...decisions].sort((left, right) => {
    const statusDelta =
      decisionStatusRank(left.status) - decisionStatusRank(right.status);

    if (statusDelta !== 0) {
      return statusDelta;
    }

    return left.nodeId.localeCompare(right.nodeId);
  });
}

function decisionStatusRank(status: ReuseDecisionStatus): number {
  switch (status) {
    case "allowed":
      return 0;
    case "needs_review":
      return 1;
    case "blocked":
      return 2;
  }
}

function formatDecisionLines(
  decisions: readonly ReuseDecision[],
): readonly string[] {
  if (decisions.length === 0) {
    return ["- none"];
  }

  return decisions.map((decision) => {
    const reasons =
      decision.reasons.length === 0
        ? "all required evidence passed"
        : decision.reasons
            .map((reason) => `${reason.code}: ${reason.message}`)
            .join("; ");

    return `- [${decision.status}] ${decision.nodeId} (${decision.operationKind}): ${reasons}`;
  });
}

function checkCacheKeyEquality(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  const previousKey = previousNode.operation.fingerprint;
  const currentKey = currentNode.operation.fingerprint;

  if (previousKey === undefined || currentKey === undefined) {
    return {
      message: "Both observed nodes require a stable cache key.",
      name: "cache_key_equality",
      status: "unknown",
    };
  }

  return {
    message: "Operation cache keys match.",
    name: "cache_key_equality",
    status: previousKey === currentKey ? "passed" : "failed",
  };
}

function checkDependencyEquality(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  return {
    message:
      "Dependency lists must match by kind, operation id, artifact id, and metadata.",
    name: "dependency_equality",
    status:
      dependencySignature(previousNode.dependencies) ===
      dependencySignature(currentNode.dependencies)
        ? "passed"
        : "failed",
  };
}

function checkRuntimeCompatibility(
  previous: ExecutionGraph,
  current: ExecutionGraph,
): ObservedTrajectoryCheck {
  const previousKey = readString(
    readRecord(previous.metadata, "reuse"),
    "runtimeCompatibilityKey",
  );
  const currentKey = readString(
    readRecord(current.metadata, "reuse"),
    "runtimeCompatibilityKey",
  );

  if (previousKey === undefined || currentKey === undefined) {
    return {
      message:
        "Both graphs require explicit runtime compatibility metadata before reuse review.",
      name: "runtime_compatibility",
      status: "unknown",
    };
  }

  return {
    message: "Runtime compatibility keys match.",
    name: "runtime_compatibility",
    status: previousKey === currentKey ? "passed" : "failed",
  };
}

function checkStatusSuccess(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  return {
    message: "Both observed nodes must have ok status before reuse review.",
    name: "status_success",
    status:
      previousNode.status === "ok" && currentNode.status === "ok"
        ? "passed"
        : "failed",
  };
}

function checkValidatorRequirements(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  if (currentNode.operation.kind !== "model_call") {
    return {
      message: "Tool-call reuse does not require model validators.",
      name: "validator_requirements",
      status: "passed",
    };
  }

  const previousValidation = readValidationMetadata(previousNode.metadata);
  const currentValidation = readValidationMetadata(currentNode.metadata);

  if (
    previousValidation.required.length === 0 ||
    currentValidation.required.length === 0 ||
    !allValidatorsPassed(previousValidation) ||
    !allValidatorsPassed(currentValidation)
  ) {
    return {
      message:
        "Model-call reuse requires every declared validator to have passed in both runs.",
      name: "validator_requirements",
      status: "failed",
    };
  }

  return {
    message: "Required validators passed in both runs.",
    name: "validator_requirements",
    status: "passed",
  };
}

function checkPolicyConstraints(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  const previousAllowed = readBoolean(
    readRecord(previousNode.metadata, "reuse"),
    "policyAllowed",
  );
  const currentAllowed = readBoolean(
    readRecord(currentNode.metadata, "reuse"),
    "policyAllowed",
  );

  if (previousAllowed === undefined || currentAllowed === undefined) {
    return {
      message:
        "Both observed nodes require explicit policy permission metadata.",
      name: "policy_constraints",
      status: "unknown",
    };
  }

  return {
    message: "Reuse policy allows comparison for both observed nodes.",
    name: "policy_constraints",
    status: previousAllowed && currentAllowed ? "passed" : "failed",
  };
}

function checkFreshnessConstraints(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  const fileArtifacts = [
    ...previousNode.artifacts.filter((artifact) => artifact.kind === "file"),
    ...currentNode.artifacts.filter((artifact) => artifact.kind === "file"),
  ];

  if (fileArtifacts.length === 0) {
    return {
      message: "No freshness-gated file artifacts are attached.",
      name: "freshness_constraints",
      status: "passed",
    };
  }

  return {
    message:
      "File-producing tool candidates require verified comparable freshness evidence.",
    name: "freshness_constraints",
    status: fileArtifacts.every(hasVerifiedFreshness) ? "passed" : "unknown",
  };
}

function checkSideEffects(
  previousNode: ExecutionNode,
  currentNode: ExecutionNode,
): ObservedTrajectoryCheck {
  if (currentNode.operation.kind !== "tool_call") {
    return {
      message: "Model calls do not carry tool side-effect metadata.",
      name: "side_effects",
      status: "passed",
    };
  }

  const previousReplaySafety = readToolReplaySafety(previousNode);
  const currentReplaySafety = readToolReplaySafety(currentNode);

  if (
    previousReplaySafety.sideEffectClass === undefined ||
    currentReplaySafety.sideEffectClass === undefined ||
    previousReplaySafety.sideEffectClass === "unknown" ||
    currentReplaySafety.sideEffectClass === "unknown"
  ) {
    return {
      blockerCode: "side_effect_unknown",
      message:
        "Tool-call reuse requires known side-effect class metadata in both runs.",
      name: "side_effects",
      status: "unknown",
    };
  }

  if (
    previousReplaySafety.sideEffectClass !== currentReplaySafety.sideEffectClass
  ) {
    return {
      blockerCode: "side_effect_policy_missing",
      message:
        "Tool-call reuse requires matching side-effect class metadata in both runs.",
      name: "side_effects",
      status: "failed",
    };
  }

  switch (currentReplaySafety.sideEffectClass) {
    case "read_only":
      return {
        message: "Tool-call side-effect class is read-only in both runs.",
        name: "side_effects",
        status: "passed",
      };
    case "idempotent_mutation":
      return matchingReplayEvidence(previousReplaySafety, currentReplaySafety, [
        "idempotencyKeyRef",
        "policyEvidenceRef",
      ])
        ? {
            message:
              "Idempotent mutation tool calls include matching policy and idempotency evidence.",
            name: "side_effects",
            status: "passed",
          }
        : {
            blockerCode: "side_effect_policy_missing",
            message:
              "Idempotent mutation reuse requires matching idempotency and policy evidence.",
            name: "side_effects",
            status: "failed",
          };
    case "approval_required":
      return matchingReplayEvidence(previousReplaySafety, currentReplaySafety, [
        "approvalEvidenceRef",
        "idempotencyKeyRef",
        "policyEvidenceRef",
      ])
        ? {
            message:
              "Approval-required tool calls include matching approval, policy, and idempotency evidence.",
            name: "side_effects",
            status: "passed",
          }
        : {
            blockerCode: "side_effect_policy_missing",
            message:
              "Approval-required reuse requires matching approval, idempotency, and policy evidence.",
            name: "side_effects",
            status: "failed",
          };
    case "non_idempotent_mutation":
      return {
        blockerCode: "side_effecting_tool",
        message:
          "Non-idempotent mutation tool calls are not reusable without a stricter replay policy.",
        name: "side_effects",
        status: "failed",
      };
  }
}

function blockersForChecks(
  checks: readonly ObservedTrajectoryCheck[],
): readonly ObservedTrajectoryBlocker[] {
  return checks.flatMap((check): readonly ObservedTrajectoryBlocker[] => {
    if (check.status === "passed") {
      return [];
    }

    switch (check.name) {
      case "cache_key_equality":
        return [
          {
            code: "cache_key_unknown",
            message: check.message,
          },
        ];
      case "dependency_equality":
        return [
          {
            code: "dependency_mismatch",
            message: check.message,
          },
        ];
      case "freshness_constraints":
        return [
          {
            code: "freshness_unknown",
            message: check.message,
          },
        ];
      case "policy_constraints":
        return [
          {
            code:
              check.status === "unknown" ? "policy_unknown" : "policy_denied",
            message: check.message,
          },
        ];
      case "runtime_compatibility":
        return [
          {
            code:
              check.status === "unknown"
                ? "runtime_unknown"
                : "runtime_incompatible",
            message: check.message,
          },
        ];
      case "side_effects":
        return [
          {
            code:
              check.blockerCode ??
              (check.status === "unknown"
                ? "side_effect_unknown"
                : "side_effecting_tool"),
            message: check.message,
          },
        ];
      case "status_success":
        return [
          {
            code: "mixed_status",
            message: check.message,
          },
        ];
      case "validator_requirements":
        return [
          {
            code: "validator_missing",
            message: check.message,
          },
        ];
    }
  });
}

function reusableOperationKind(
  node: ExecutionNode,
): ObservedTrajectoryReusableOperationKind | undefined {
  if (
    node.operation.kind === "model_call" ||
    node.operation.kind === "tool_call"
  ) {
    return node.operation.kind;
  }

  return undefined;
}

function estimatesForNode(node: ExecutionNode): ObservedTrajectoryEstimate {
  const latencyMs = node.metrics.latencyMs ?? node.durationMs;

  return {
    ...(node.metrics.costUsd === undefined
      ? {}
      : { costUsd: node.metrics.costUsd }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(node.metrics.totalTokens === undefined
      ? {}
      : { totalTokens: node.metrics.totalTokens }),
  };
}

function sumReusableEstimates(
  nodes: readonly ObservedTrajectoryReusableNode[],
): Pick<
  ObservedTrajectoryComparisonSummary,
  | "totalEstimatedAvoidableCostUsd"
  | "totalEstimatedAvoidableLatencyMs"
  | "totalEstimatedAvoidableTokens"
> {
  return {
    ...sumEstimate(nodes, "costUsd", "totalEstimatedAvoidableCostUsd"),
    ...sumEstimate(nodes, "latencyMs", "totalEstimatedAvoidableLatencyMs"),
    ...sumEstimate(nodes, "totalTokens", "totalEstimatedAvoidableTokens"),
  };
}

function sumEstimate<
  SourceKey extends keyof ObservedTrajectoryEstimate,
  TargetKey extends keyof ObservedTrajectoryComparisonSummary,
>(
  nodes: readonly ObservedTrajectoryReusableNode[],
  sourceKey: SourceKey,
  targetKey: TargetKey,
): Partial<ObservedTrajectoryComparisonSummary> {
  const values = nodes
    .map((node) => node.estimates[sourceKey])
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return {};
  }

  return {
    [targetKey]: values.reduce((total, value) => total + value, 0),
  } as Partial<ObservedTrajectoryComparisonSummary>;
}

function dependencySignature(dependencies: readonly Dependency[]): string {
  return stableExecutionDigest(
    dependencies.map((dependency) => ({
      artifactId: dependency.artifactId,
      kind: dependency.kind,
      metadata: dependency.metadata,
      operationId: dependency.operationId,
    })),
  );
}

function hasVerifiedFreshness(artifact: Artifact): boolean {
  return (
    readString(readRecord(artifact.metadata, "reuse"), "freshnessStatus") ===
    "verified"
  );
}

function readValidationMetadata(metadata: Metadata): {
  readonly passed: readonly string[];
  readonly required: readonly string[];
} {
  const reuse = readRecord(metadata, "reuse");

  return {
    passed: readStringArray(reuse, "validatorsPassed"),
    required: readStringArray(reuse, "validatorsRequired"),
  };
}

function readToolReplaySafety(node: ExecutionNode): ToolReplaySafetyMetadata {
  const reuse = readRecord(node.metadata, "reuse");
  const approvalEvidenceRef = readString(reuse, "approvalEvidenceRef");
  const idempotencyKeyRef = readString(reuse, "idempotencyKeyRef");
  const policyEvidenceRef = readString(reuse, "policyEvidenceRef");
  const sideEffecting = readBoolean(reuse, "sideEffecting");
  const sideEffectClass =
    readSideEffectClass(readString(reuse, "sideEffectClass")) ??
    (sideEffecting === true
      ? "non_idempotent_mutation"
      : sideEffecting === false
        ? "read_only"
        : undefined);

  return {
    ...(approvalEvidenceRef === undefined ? {} : { approvalEvidenceRef }),
    ...(idempotencyKeyRef === undefined ? {} : { idempotencyKeyRef }),
    ...(policyEvidenceRef === undefined ? {} : { policyEvidenceRef }),
    ...(sideEffectClass === undefined ? {} : { sideEffectClass }),
  };
}

function readSideEffectClass(
  value: string | undefined,
): MIRSideEffectClass | undefined {
  return value !== undefined &&
    sideEffectClasses.has(value as MIRSideEffectClass)
    ? (value as MIRSideEffectClass)
    : undefined;
}

function matchingReplayEvidence(
  previous: ToolReplaySafetyMetadata,
  current: ToolReplaySafetyMetadata,
  keys: readonly (keyof ToolReplaySafetyMetadata)[],
): boolean {
  return keys.every((key) => {
    const previousValue = previous[key];
    const currentValue = current[key];

    return (
      typeof previousValue === "string" &&
      previousValue.length > 0 &&
      previousValue === currentValue
    );
  });
}

function allValidatorsPassed(input: {
  readonly passed: readonly string[];
  readonly required: readonly string[];
}): boolean {
  const passed = new Set(input.passed);

  return input.required.every((validator) => passed.has(validator));
}

function readRecord(
  record: Metadata | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record?.[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
}

function readBoolean(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];

  return typeof value === "boolean" ? value : undefined;
}

function readString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

function readStringArray(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = record?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, toStableJsonValue(item)]),
  );
}
