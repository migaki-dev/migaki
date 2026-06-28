import type { MIRContextBlock, MIRNode, MIRPlan } from "@migaki/mir";
import type { ProviderCapabilities } from "@migaki/providers";

import {
  CONTEXT_LEDGER_VERSION,
  createContextLedger,
} from "./context-ledger.js";
import { diffMIRPlans } from "./diff.js";
import {
  EVIDENCE_EVENT_VERSION,
  type CapabilityAssumptionEvidenceEvent,
  type ContextChangeEvidenceEvent,
} from "./evidence.js";
import {
  PASS_CONTRACT_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassEvidenceFragment,
  type PassResult,
  type PassWarning,
} from "./pass.js";

const passIdentity = {
  name: "migaki.context.stable_prefix_detection",
  version: "0.0.0",
};

export const stablePrefixDetectionPass = {
  ...passIdentity,
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.context.ledger",
      required: true,
      source: "runtime",
      description: `Uses ${CONTEXT_LEDGER_VERSION} context lookups.`,
    },
  ],
  outputCapabilities: [
    {
      name: "mir.context.stable_prefix_reported",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes:
      "Reports stable prefix opportunities without mutating provider requests.",
  },
  async apply(plan: MIRPlan, context: PassContext): Promise<PassResult> {
    const ledger = createContextLedger(plan);
    const warnings: PassWarning[] = [];
    const evidence: PassEvidenceFragment[] = [];
    let evidenceIndex = 1;

    for (const node of plan.nodes) {
      if (node.kind !== "model_call" || node.inputContext === undefined) {
        continue;
      }

      const prefixIds = collectStablePrefixIds(node, ledger, warnings);

      if (prefixIds.length === 0) {
        continue;
      }

      evidence.push(
        createStablePrefixEvidence({
          context,
          contextIds: prefixIds,
          evidenceIndex,
          nodeId: node.id,
        }),
      );
      evidenceIndex += 1;
    }

    for (const capabilities of context.providerCapabilities ?? []) {
      evidence.push(
        createProviderAssumptionEvidence({
          capabilities,
          context,
          evidenceIndex,
        }),
      );
      evidenceIndex += 1;

      if (!capabilities.supportsExplicitCacheBreakpoints) {
        warnings.push({
          assumption:
            "Stable prefix opportunity is report-only for providers without explicit cache breakpoints.",
          code: "stable_prefix_provider_report_only",
          message:
            "Provider does not declare explicit cache breakpoint support.",
          path: "$.providerCapabilities",
          severity: "info",
        });
      }
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

interface ContextLookup {
  byId(id: string): MIRContextBlock | undefined;
}

function collectStablePrefixIds(
  node: Extract<MIRNode, { kind: "model_call" }>,
  ledger: ContextLookup,
  warnings: PassWarning[],
): readonly string[] {
  const prefixIds: string[] = [];

  for (const contextId of node.inputContext ?? []) {
    const block = ledger.byId(contextId);
    const reason = stablePrefixSkipReason(block);

    if (reason === undefined) {
      prefixIds.push(contextId);
      continue;
    }

    warnings.push({
      assumption: reason,
      code: "stable_prefix_candidate_skipped",
      message: "Context block is not eligible for stable prefix grouping.",
      path:
        block === undefined
          ? `$.nodes[?(@.id==${JSON.stringify(node.id)})]`
          : contextPath(block.id),
      severity: "warning",
    });
    break;
  }

  return prefixIds;
}

function stablePrefixSkipReason(
  block: MIRContextBlock | undefined,
): string | undefined {
  if (block === undefined) {
    return "Context reference is missing.";
  }

  if (!isStablePrefixRole(block.role)) {
    return "Context role is not eligible for stable prefix grouping.";
  }

  if (block.mutability !== "fixed") {
    return "Context mutability is not fixed.";
  }

  if (isSensitive(block.privacyClass)) {
    return "Privacy-restricted context is not eligible for cacheable prefix grouping.";
  }

  if (block.cachePolicy?.mode === "forbidden") {
    return "Context cache policy forbids cache layout.";
  }

  return undefined;
}

function isStablePrefixRole(role: MIRContextBlock["role"]): boolean {
  return (
    role === "developer_instruction" ||
    role === "example" ||
    role === "system_instruction"
  );
}

function createStablePrefixEvidence(input: {
  readonly context: PassContext;
  readonly contextIds: readonly string[];
  readonly evidenceIndex: number;
  readonly nodeId: string;
}): ContextChangeEvidenceEvent {
  return {
    contextChange: {
      changeKind: "changed",
      contextIds: input.contextIds,
    },
    id: evidenceId(input.evidenceIndex),
    kind: "context_change",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      nodeId: input.nodeId,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Stable prefix opportunity for node ${input.nodeId}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createProviderAssumptionEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly evidenceIndex: number;
}): CapabilityAssumptionEvidenceEvent {
  return {
    capabilityAssumption: {
      capability: "prompt_caching",
      description: input.capabilities.supportsExplicitCacheBreakpoints
        ? "Provider declares explicit cache breakpoint support."
        : "Provider lacks explicit cache breakpoints; stable prefix is reported only.",
      provider: input.capabilities.provider,
    },
    id: evidenceId(input.evidenceIndex),
    kind: "capability_assumption",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Recorded stable prefix cache assumption for ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function evidenceId(index: number): string {
  return `stable-prefix-${String(index).padStart(3, "0")}`;
}

function contextPath(contextId: string): string {
  return `$.context[?(@.id==${JSON.stringify(contextId)})]`;
}

function isSensitive(privacyClass: MIRContextBlock["privacyClass"]): boolean {
  return (
    privacyClass === "confidential" ||
    privacyClass === "restricted" ||
    privacyClass === "secret"
  );
}
