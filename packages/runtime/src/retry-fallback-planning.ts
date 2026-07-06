import type {
  MIREdge,
  MIRNode,
  MIRPlan,
  MIRSideEffectClass,
} from "@migaki/mir";

import { diffMIRPlans } from "./diff.js";
import {
  EVIDENCE_EVENT_VERSION,
  type RetryFallbackDecisionEvidenceEvent,
} from "./evidence.js";
import {
  PASS_CONTRACT_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassEvidenceFragment,
  type PassResult,
  type PassWarning,
} from "./pass.js";

export const RETRY_FALLBACK_PLANNING_VERSION =
  "migaki.retry-fallback-planning.v0";

export type RetryFallbackPlanningVersion =
  typeof RETRY_FALLBACK_PLANNING_VERSION;

export interface RetryFallbackPolicyMetadata {
  readonly approvalEvidenceRef?: string;
  readonly fallbackProviders?: readonly string[];
  readonly idempotencyKeyRef?: string;
  readonly policyEvidenceRef?: string;
  readonly sideEffectClass?: MIRSideEffectClass;
  readonly sideEffecting?: boolean;
}

const sideEffectClasses = new Set<MIRSideEffectClass>([
  "approval_required",
  "idempotent_mutation",
  "non_idempotent_mutation",
  "read_only",
  "unknown",
]);

const passIdentity = {
  name: "migaki.runtime.retry_fallback_planning",
  version: "0.0.0",
};

export const retryFallbackPlanningPass = {
  ...passIdentity,
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.validation.failure_policy",
      required: true,
      source: "mir",
      description: "Uses validator failure policies to place retry boundaries.",
    },
    {
      name: "mir.constraints.provider_policy",
      source: "mir",
      description: "Uses allowed and denied provider constraints for fallback.",
    },
  ],
  outputCapabilities: [
    {
      name: "mir.runtime.retry_fallback_plan",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes:
      "Reports retry and fallback decisions without executing retries or providers.",
  },
  async apply(plan: MIRPlan, context: PassContext): Promise<PassResult> {
    const warnings: PassWarning[] = [];
    const evidence: PassEvidenceFragment[] = [];
    let evidenceIndex = 1;

    for (const validator of plan.nodes) {
      if (
        validator.kind !== "validator" ||
        validator.failurePolicy !== "retry_node"
      ) {
        continue;
      }

      const retryNode = findRetryTargetForValidator(plan, validator);

      if (retryNode === undefined) {
        warnings.push({
          code: "retry_boundary_missing_target",
          message:
            "Validator retry policy could not be mapped to a retryable node.",
          path: nodePath(validator.id),
          severity: "warning",
        });
        continue;
      }

      const preservedNodeIds = upstreamNodeIds(plan.edges, retryNode.id);
      evidence.push(
        createRetryFallbackEvidence({
          context,
          decision: "retry",
          evidenceIndex,
          nodeId: retryNode.id,
          refs: [
            `validator:${validator.id}`,
            ...preservedNodeIds.map((nodeId) => `preserve-node:${nodeId}`),
          ],
          scope: "node",
          summary: `Retry node ${retryNode.id} after validator ${validator.id} fails without rerunning upstream context.`,
        }),
      );
      evidenceIndex += 1;
    }

    for (const node of plan.nodes) {
      const metadata = readRetryFallbackMetadata(node);

      const sideEffectBlocker = retrySideEffectBlocker(node, metadata);

      if (sideEffectBlocker !== undefined) {
        const warning: PassWarning = {
          assumption: sideEffectBlocker.assumption,
          code: "retry_side_effect_not_retryable",
          message: "Tool node is not retryable under its side-effect policy.",
          path: nodePath(node.id),
          severity: "warning",
        };
        warnings.push(warning);
        evidence.push(
          createRetryFallbackEvidence({
            context,
            decision: "not_retryable",
            evidenceIndex,
            nodeId: node.id,
            refs: [RETRY_FALLBACK_PLANNING_VERSION],
            scope: "node",
            summary: `Node ${node.id} is not retryable: ${sideEffectBlocker.summary}`,
          }),
        );
        evidenceIndex += 1;
      }

      if (node.kind !== "model_call") {
        continue;
      }

      const fallback = chooseFallbackProvider(plan, node, metadata, warnings);

      if (fallback === undefined) {
        continue;
      }

      evidence.push(
        createRetryFallbackEvidence({
          context,
          decision: "fallback",
          evidenceIndex,
          fallbackTarget: fallback,
          nodeId: node.id,
          refs: [RETRY_FALLBACK_PLANNING_VERSION],
          scope: "node",
          summary: `Fallback from node ${node.id} to provider ${fallback}.`,
        }),
      );
      evidenceIndex += 1;
    }

    return {
      diff: diffMIRPlans(plan, plan, {
        afterWarnings: warnings,
        beforeWarnings: [],
      }),
      evidence,
      pass: passIdentity,
      plan,
      version: PASS_CONTRACT_VERSION,
      warnings,
    };
  },
} satisfies OptimizationPass;

function findRetryTargetForValidator(
  plan: MIRPlan,
  validator: Extract<MIRNode, { kind: "validator" }>,
): MIRNode | undefined {
  const validationEdge = plan.edges.find(
    (edge) => edge.kind === "validation" && edge.toNodeId === validator.id,
  );

  if (validationEdge !== undefined) {
    return plan.nodes.find(
      (node) =>
        node.id === validationEdge.fromNodeId && node.kind === "model_call",
    );
  }

  return plan.nodes.find(
    (node) =>
      node.kind === "model_call" &&
      node.outputContext !== undefined &&
      validator.inputContext.includes(node.outputContext),
  );
}

function upstreamNodeIds(
  edges: readonly MIREdge[],
  nodeId: string,
): readonly string[] {
  const seen = new Set<string>();
  const upstream: string[] = [];

  for (const edge of edges) {
    if (edge.toNodeId !== nodeId || seen.has(edge.fromNodeId)) {
      continue;
    }

    seen.add(edge.fromNodeId);
    upstream.push(edge.fromNodeId);
  }

  return upstream;
}

function chooseFallbackProvider(
  plan: MIRPlan,
  node: Extract<MIRNode, { kind: "model_call" }>,
  metadata: RetryFallbackPolicyMetadata,
  warnings: PassWarning[],
): string | undefined {
  for (const provider of metadata.fallbackProviders ?? []) {
    if (plan.constraints.deniedProviders?.includes(provider) === true) {
      warnings.push({
        assumption: `Fallback provider ${provider} is denied by plan constraints.`,
        code: "fallback_provider_denied",
        message: "Fallback provider is denied by plan constraints.",
        path: nodePath(node.id),
        severity: "warning",
      });
      continue;
    }

    if (
      plan.constraints.allowedProviders !== undefined &&
      !plan.constraints.allowedProviders.includes(provider)
    ) {
      warnings.push({
        assumption: `Fallback provider ${provider} is not in allowedProviders.`,
        code: "fallback_provider_not_allowed",
        message: "Fallback provider is not allowed by plan constraints.",
        path: nodePath(node.id),
        severity: "warning",
      });
      continue;
    }

    return provider;
  }

  return undefined;
}

function retrySideEffectBlocker(
  node: MIRNode,
  metadata: RetryFallbackPolicyMetadata,
): { readonly assumption: string; readonly summary: string } | undefined {
  if (node.kind !== "tool_call") {
    return undefined;
  }

  const sideEffectClass = effectiveSideEffectClass(metadata);

  switch (sideEffectClass) {
    case "read_only":
      return undefined;
    case "idempotent_mutation":
      return hasIdempotentPolicyEvidence(metadata)
        ? undefined
        : {
            assumption:
              "Idempotent mutation tool node lacks idempotency or policy evidence.",
            summary:
              "idempotent mutation lacks idempotency or policy evidence.",
          };
    case "approval_required":
      return hasIdempotentPolicyEvidence(metadata) &&
        hasApprovalEvidence(node, metadata)
        ? undefined
        : {
            assumption:
              "Approval-required tool node lacks idempotency, policy, or approval evidence.",
            summary:
              "approval-required mutation lacks idempotency, policy, or approval evidence.",
          };
    case "non_idempotent_mutation":
      return {
        assumption:
          "Non-idempotent mutation tool node cannot be retried safely.",
        summary: "non-idempotent mutation.",
      };
    case "unknown":
      return {
        assumption: "Tool node side-effect class is unknown.",
        summary: "side-effect class is unknown.",
      };
  }
}

function readRetryFallbackMetadata(node: MIRNode): RetryFallbackPolicyMetadata {
  const raw = node.metadata?.["retryFallback"];

  if (!isRecord(raw)) {
    return {};
  }

  const fallbackProviders = readStringArray(raw["fallbackProviders"]);
  const sideEffectClass = readSideEffectClass(raw["sideEffectClass"]);

  return {
    ...(typeof raw["approvalEvidenceRef"] === "string"
      ? { approvalEvidenceRef: raw["approvalEvidenceRef"] }
      : {}),
    ...(fallbackProviders !== undefined ? { fallbackProviders } : {}),
    ...(typeof raw["idempotencyKeyRef"] === "string"
      ? { idempotencyKeyRef: raw["idempotencyKeyRef"] }
      : {}),
    ...(typeof raw["policyEvidenceRef"] === "string"
      ? { policyEvidenceRef: raw["policyEvidenceRef"] }
      : {}),
    ...(sideEffectClass === undefined ? {} : { sideEffectClass }),
    ...(typeof raw["sideEffecting"] === "boolean"
      ? { sideEffecting: raw["sideEffecting"] }
      : {}),
  };
}

function effectiveSideEffectClass(
  metadata: RetryFallbackPolicyMetadata,
): MIRSideEffectClass {
  if (metadata.sideEffectClass !== undefined) {
    return metadata.sideEffectClass;
  }

  if (metadata.sideEffecting === true) {
    return "non_idempotent_mutation";
  }

  if (metadata.sideEffecting === false) {
    return "read_only";
  }

  return "unknown";
}

function hasIdempotentPolicyEvidence(
  metadata: RetryFallbackPolicyMetadata,
): boolean {
  return (
    metadata.idempotencyKeyRef !== undefined &&
    metadata.policyEvidenceRef !== undefined
  );
}

function hasApprovalEvidence(
  node: Extract<MIRNode, { kind: "tool_call" }>,
  metadata: RetryFallbackPolicyMetadata,
): boolean {
  return (
    metadata.approvalEvidenceRef !== undefined ||
    node.tool.requiresApprovalId !== undefined
  );
}

function readSideEffectClass(value: unknown): MIRSideEffectClass | undefined {
  return typeof value === "string" &&
    sideEffectClasses.has(value as MIRSideEffectClass)
    ? (value as MIRSideEffectClass)
    : undefined;
}

function createRetryFallbackEvidence(input: {
  readonly context: PassContext;
  readonly decision: RetryFallbackDecisionEvidenceEvent["retryFallbackDecision"]["decision"];
  readonly evidenceIndex: number;
  readonly fallbackTarget?: string;
  readonly nodeId: string;
  readonly refs: readonly string[];
  readonly scope: RetryFallbackDecisionEvidenceEvent["retryFallbackDecision"]["scope"];
  readonly summary: string;
}): RetryFallbackDecisionEvidenceEvent {
  return {
    id: evidenceId(input.evidenceIndex),
    kind: "retry_fallback_decision",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: input.refs,
    retryFallbackDecision: {
      decision: input.decision,
      ...(input.fallbackTarget !== undefined
        ? { fallbackTarget: input.fallbackTarget }
        : {}),
      nodeId: input.nodeId,
      scope: input.scope,
    },
    source: {
      kind: "pass",
      nodeId: input.nodeId,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: input.summary,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }

  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nodePath(id: string): string {
  return `$.nodes[?(@.id==${JSON.stringify(id)})]`;
}

function evidenceId(index: number): string {
  return `retry-fallback-${String(index).padStart(3, "0")}`;
}
