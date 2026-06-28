import type { MIRModelRequirement, MIRNode, MIRPlan } from "@migaki/mir";

import { diffMIRPlans } from "./diff.js";
import {
  EVIDENCE_EVENT_VERSION,
  type RoutingDecisionEvidenceEvent,
} from "./evidence.js";
import {
  PASS_CONTRACT_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassEvidenceFragment,
  type PassResult,
  type PassWarning,
} from "./pass.js";

export const STATIC_ROUTING_VERSION = "migaki.static-routing.v0";

export type StaticRoutingVersion = typeof STATIC_ROUTING_VERSION;

export interface StaticRoutingCandidate {
  readonly model: string;
  readonly provider: string;
}

export interface StaticRoutingPolicyMetadata {
  readonly candidates?: readonly StaticRoutingCandidate[];
  readonly requiredValidators?: readonly string[];
}

const passIdentity = {
  name: "migaki.runtime.static_routing_policy",
  version: "0.0.0",
};

const eligibleTasks = new Set<MIRModelRequirement["task"]>([
  "classification",
  "ranking",
]);

export const staticRoutingPolicyPass = {
  ...passIdentity,
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.constraints.provider_policy",
      source: "mir",
      description: "Uses allowed and denied provider constraints.",
    },
    {
      name: "mir.validators.required",
      source: "mir",
      description: "Requires declared validators before routing.",
    },
  ],
  outputCapabilities: [
    {
      name: "mir.runtime.static_routing_decision",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes:
      "Reports static routing decisions for explicitly eligible low-risk nodes.",
  },
  async apply(plan: MIRPlan, context: PassContext): Promise<PassResult> {
    const warnings: PassWarning[] = [];
    const evidence: PassEvidenceFragment[] = [];
    let evidenceIndex = 1;

    for (const node of plan.nodes) {
      if (node.kind !== "model_call") {
        continue;
      }

      const policy = readStaticRoutingPolicy(node);

      if ((policy.candidates ?? []).length === 0) {
        continue;
      }

      if (!eligibleTasks.has(node.model.task)) {
        warnings.push({
          assumption: `Task ${node.model.task} is outside the v0 static routing allow-list.`,
          code: "static_routing_ineligible_task",
          message: "Model node is not eligible for static routing.",
          path: nodePath(node.id),
          severity: "warning",
        });
        continue;
      }

      if (!hasRequiredValidators(plan, policy)) {
        warnings.push({
          assumption:
            "Static routing requires declared validators to constrain behavior.",
          code: "static_routing_validator_missing",
          message: "Required validator constraints are missing.",
          path: nodePath(node.id),
          severity: "warning",
        });
        continue;
      }

      const candidate = chooseRoutingCandidate(plan, node, policy, warnings);

      if (candidate === undefined) {
        continue;
      }

      evidence.push(
        createRoutingEvidence({
          candidate,
          context,
          evidenceIndex,
          node,
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

function chooseRoutingCandidate(
  plan: MIRPlan,
  node: Extract<MIRNode, { kind: "model_call" }>,
  policy: StaticRoutingPolicyMetadata,
  warnings: PassWarning[],
): StaticRoutingCandidate | undefined {
  for (const candidate of policy.candidates ?? []) {
    if (
      plan.constraints.deniedProviders?.includes(candidate.provider) === true
    ) {
      warnings.push({
        assumption: `Provider ${candidate.provider} is denied by plan constraints.`,
        code: "static_routing_provider_denied",
        message: "Static routing candidate provider is denied.",
        path: nodePath(node.id),
        severity: "warning",
      });
      continue;
    }

    if (
      plan.constraints.allowedProviders !== undefined &&
      !plan.constraints.allowedProviders.includes(candidate.provider)
    ) {
      warnings.push({
        assumption: `Provider ${candidate.provider} is not in allowedProviders.`,
        code: "static_routing_provider_not_allowed",
        message: "Static routing candidate provider is not allowed.",
        path: nodePath(node.id),
        severity: "warning",
      });
      continue;
    }

    return candidate;
  }

  return undefined;
}

function hasRequiredValidators(
  plan: MIRPlan,
  policy: StaticRoutingPolicyMetadata,
): boolean {
  const requiredValidators = policy.requiredValidators ?? [];

  if (requiredValidators.length === 0) {
    return false;
  }

  const available = new Set(plan.constraints.requiredValidators ?? []);

  return requiredValidators.every((validatorId) => available.has(validatorId));
}

function createRoutingEvidence(input: {
  readonly candidate: StaticRoutingCandidate;
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly node: Extract<MIRNode, { kind: "model_call" }>;
}): RoutingDecisionEvidenceEvent {
  return {
    id: evidenceId(input.evidenceIndex),
    kind: "routing_decision",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: [STATIC_ROUTING_VERSION],
    routingDecision: {
      nodeId: input.node.id,
      reason: `Low-risk ${input.node.model.task} node satisfies static routing policy.`,
      source: input.node.model.task,
      target: `${input.candidate.provider}/${input.candidate.model}`,
    },
    source: {
      kind: "pass",
      nodeId: input.node.id,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Routed ${input.node.id} to ${input.candidate.provider}/${input.candidate.model}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function readStaticRoutingPolicy(node: MIRNode): StaticRoutingPolicyMetadata {
  const raw = node.metadata?.["staticRouting"];

  if (!isRecord(raw)) {
    return {};
  }

  const candidates = readCandidates(raw["candidates"]);
  const requiredValidators = readStringArray(raw["requiredValidators"]);

  return {
    ...(candidates !== undefined ? { candidates } : {}),
    ...(requiredValidators !== undefined ? { requiredValidators } : {}),
  };
}

function readCandidates(
  value: unknown,
): readonly StaticRoutingCandidate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const candidates: StaticRoutingCandidate[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }

    if (
      typeof item["provider"] !== "string" ||
      typeof item["model"] !== "string"
    ) {
      return undefined;
    }

    candidates.push({
      model: item["model"],
      provider: item["provider"],
    });
  }

  return candidates;
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
  return `static-routing-${String(index).padStart(3, "0")}`;
}
