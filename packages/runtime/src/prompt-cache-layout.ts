import type { MIRPlan } from "@migaki/mir";
import {
  listProviderCostRateFixtures,
  type ProviderCapabilities,
  type ProviderCostRateFixture,
} from "@migaki/providers";

import { createContextLedger } from "./context-ledger.js";
import { diffMIRPlans } from "./diff.js";
import {
  EVIDENCE_EVENT_VERSION,
  type CapabilityAssumptionEvidenceEvent,
  type ContextChangeEvidenceEvent,
  type EstimateEvidenceEvent,
  type WarningEvidenceEvent,
} from "./evidence.js";
import {
  PASS_CONTRACT_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassEvidenceFragment,
  type PassResult,
  type PassWarning,
} from "./pass.js";
import { stablePrefixDetectionPass } from "./stable-prefix.js";
import { estimateContextGroupTokens } from "./token-estimation.js";

export const PROMPT_CACHE_LAYOUT_VERSION = "migaki.prompt-cache-layout.v0";

export type PromptCacheLayoutVersion = typeof PROMPT_CACHE_LAYOUT_VERSION;

export type PromptCacheLayoutKind =
  | "automatic"
  | "explicit_breakpoint"
  | "unsupported";

const passIdentity = {
  name: "migaki.context.prompt_cache_layout_reporting",
  version: "0.0.0",
};

export const promptCacheLayoutReportingPass = {
  ...passIdentity,
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.context.stable_prefix_reported",
      required: true,
      source: "runtime",
      description: "Uses stable prefix detection output as cache candidates.",
    },
    {
      name: "provider.prompt_caching",
      required: true,
      source: "provider",
      description: "Uses provider cache capability fixtures.",
    },
  ],
  outputCapabilities: [
    {
      name: "mir.context.prompt_cache_layout_reported",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes:
      "Reports provider-aware cache layout opportunities without mutating requests.",
  },
  async apply(plan: MIRPlan, context: PassContext): Promise<PassResult> {
    const stablePrefixResult = await stablePrefixDetectionPass.apply(
      plan,
      createStablePrefixContext(context),
    );
    const prefixByNode = collectStablePrefixEvidence(
      stablePrefixResult.evidence,
    );
    const ledger = createContextLedger(plan);
    const warnings = [...stablePrefixResult.warnings];
    const evidence: PassEvidenceFragment[] = [];
    let evidenceIndex = 1;

    for (const capabilities of context.providerCapabilities ?? []) {
      const layoutKind = classifyLayoutKind(capabilities);
      const costRate = singleCostRateForProvider(capabilities.provider);

      evidence.push(
        createProviderAssumptionEvidence({
          capabilities,
          context,
          evidenceIndex,
          layoutKind,
        }),
      );
      evidenceIndex += 1;

      const providerWarnings = providerWarningsFor(capabilities, layoutKind);
      warnings.push(...providerWarnings);

      for (const warning of providerWarnings) {
        evidence.push(
          createWarningEvidence({
            capabilities,
            context,
            evidenceIndex,
            warning,
          }),
        );
        evidenceIndex += 1;
      }

      for (const [nodeId, contextIds] of prefixByNode) {
        const tokenEstimate = estimateContextGroupTokens({
          blocks: contextIds.flatMap((contextId) => {
            const block = ledger.byId(contextId);

            return block === undefined ? [] : [block];
          }),
          groupId: `${capabilities.provider}.${nodeId}.prompt_cache_prefix`,
          missingContextIds: contextIds.filter(
            (contextId) => ledger.byId(contextId) === undefined,
          ),
          subjectRef: cacheSubjectRef(capabilities.provider, nodeId),
        });

        evidence.push(
          createContextEvidence({
            capabilities,
            context,
            contextIds,
            evidenceIndex,
            layoutKind,
            nodeId,
          }),
        );
        evidenceIndex += 1;

        evidence.push(
          createTokenEstimateEvidence({
            capabilities,
            context,
            evidenceIndex,
            nodeId,
            tokenEstimate,
          }),
        );
        evidenceIndex += 1;

        if (tokenEstimate.tokens !== undefined && costRate !== undefined) {
          evidence.push(
            createCostEstimateEvidence({
              capabilities,
              context,
              costRate,
              evidenceIndex,
              nodeId,
              tokens: tokenEstimate.tokens,
            }),
          );
          evidenceIndex += 1;
        }
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

function createStablePrefixContext(context: PassContext): PassContext {
  return {
    runId: context.runId,
    startedAt: context.startedAt,
    ...(context.metadata !== undefined ? { metadata: context.metadata } : {}),
    ...(context.previousEvidenceRefs !== undefined
      ? { previousEvidenceRefs: context.previousEvidenceRefs }
      : {}),
  };
}

function collectStablePrefixEvidence(
  evidence: readonly PassEvidenceFragment[],
): ReadonlyMap<string, readonly string[]> {
  const byNode = new Map<string, readonly string[]>();

  for (const event of evidence) {
    if (
      event.kind !== "context_change" ||
      event.source.nodeId === undefined ||
      event.contextChange.contextIds.length === 0
    ) {
      continue;
    }

    byNode.set(event.source.nodeId, event.contextChange.contextIds);
  }

  return byNode;
}

function classifyLayoutKind(
  capabilities: ProviderCapabilities,
): PromptCacheLayoutKind {
  if (capabilities.supportsExplicitCacheBreakpoints) {
    return "explicit_breakpoint";
  }

  if (capabilities.supportsAutomaticCaching) {
    return "automatic";
  }

  return "unsupported";
}

function providerWarningsFor(
  capabilities: ProviderCapabilities,
  layoutKind: PromptCacheLayoutKind,
): readonly PassWarning[] {
  if (layoutKind === "explicit_breakpoint") {
    return [];
  }

  if (layoutKind === "automatic") {
    return [
      {
        assumption:
          "Provider supports automatic prompt caching but does not declare explicit breakpoint placement.",
        code: "prompt_cache_explicit_breakpoint_unavailable",
        message:
          "Prompt-cache layout report cannot place explicit cache breakpoints for this provider.",
        path: providerPath(capabilities.provider),
        severity: "info",
      },
    ];
  }

  return [
    {
      assumption:
        "Provider does not declare prompt-cache support in its capability fixture.",
      code: "prompt_cache_provider_unsupported",
      message:
        "Prompt-cache layout opportunities are metadata-only for this provider.",
      path: providerPath(capabilities.provider),
      severity: "warning",
    },
  ];
}

function createProviderAssumptionEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly layoutKind: PromptCacheLayoutKind;
}): CapabilityAssumptionEvidenceEvent {
  return {
    capabilityAssumption: {
      capability: "prompt_caching",
      description: providerAssumptionDescription(
        input.capabilities,
        input.layoutKind,
      ),
      evidenceRef: providerEvidenceRef(input.capabilities),
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
    refs: [PROMPT_CACHE_LAYOUT_VERSION, input.capabilities.version],
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Recorded prompt-cache layout assumption for ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createContextEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly contextIds: readonly string[];
  readonly evidenceIndex: number;
  readonly layoutKind: PromptCacheLayoutKind;
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
    refs: [
      PROMPT_CACHE_LAYOUT_VERSION,
      providerEvidenceRef(input.capabilities),
    ],
    source: {
      kind: "pass",
      nodeId: input.nodeId,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `${layoutSummaryPrefix(input.layoutKind)} for node ${input.nodeId} on ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createTokenEstimateEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly nodeId: string;
  readonly tokenEstimate: ReturnType<typeof estimateContextGroupTokens>;
}): EstimateEvidenceEvent {
  return {
    estimate: {
      confidence:
        input.tokenEstimate.tokens === undefined ? "unknown" : "estimated",
      estimateKind: "token",
      subjectRef: cacheSubjectRef(input.capabilities.provider, input.nodeId),
      unit: "tokens",
      ...(input.tokenEstimate.tokens !== undefined
        ? { value: input.tokenEstimate.tokens }
        : {}),
    },
    id: evidenceId(input.evidenceIndex),
    kind: "estimate",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: [
      PROMPT_CACHE_LAYOUT_VERSION,
      input.tokenEstimate.version,
      providerEvidenceRef(input.capabilities),
    ],
    source: {
      kind: "pass",
      nodeId: input.nodeId,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Estimated cacheable stable-prefix tokens for ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createCostEstimateEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly costRate: ProviderCostRateFixture;
  readonly evidenceIndex: number;
  readonly nodeId: string;
  readonly tokens: number;
}): EstimateEvidenceEvent {
  return {
    estimate: {
      confidence: "estimated",
      estimateKind: "cost",
      subjectRef: `${cacheSubjectRef(input.capabilities.provider, input.nodeId)}.estimatedInputCostUsd`,
      unit: "usd",
      value: roundUsd(
        (input.tokens / 1_000_000) * input.costRate.inputUsdPerMillionTokens,
      ),
    },
    id: evidenceId(input.evidenceIndex),
    kind: "estimate",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: [
      PROMPT_CACHE_LAYOUT_VERSION,
      input.costRate.version,
      providerEvidenceRef(input.capabilities),
    ],
    source: {
      kind: "pass",
      nodeId: input.nodeId,
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: `Estimated cacheable stable-prefix input cost for ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createWarningEvidence(input: {
  readonly capabilities: ProviderCapabilities;
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly warning: PassWarning;
}): WarningEvidenceEvent {
  return {
    id: evidenceId(input.evidenceIndex),
    kind: "warning",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: [
      PROMPT_CACHE_LAYOUT_VERSION,
      providerEvidenceRef(input.capabilities),
    ],
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: input.warning.message,
    version: EVIDENCE_EVENT_VERSION,
    warning: {
      ...(input.warning.assumption !== undefined
        ? { assumption: input.warning.assumption }
        : {}),
      code: input.warning.code,
      ...(input.warning.path !== undefined ? { path: input.warning.path } : {}),
      severity: input.warning.severity,
    },
  };
}

function providerAssumptionDescription(
  capabilities: ProviderCapabilities,
  layoutKind: PromptCacheLayoutKind,
): string {
  if (layoutKind === "explicit_breakpoint") {
    return "Provider declares explicit cache breakpoint support.";
  }

  if (layoutKind === "automatic") {
    return "Provider declares automatic prompt caching but no explicit cache breakpoints.";
  }

  return `Provider does not declare prompt-cache support in ${capabilities.version}.`;
}

function layoutSummaryPrefix(layoutKind: PromptCacheLayoutKind): string {
  if (layoutKind === "explicit_breakpoint") {
    return "Explicit cache breakpoint opportunity";
  }

  if (layoutKind === "automatic") {
    return "Automatic prompt-cache layout opportunity";
  }

  return "Metadata-only prompt-cache layout opportunity";
}

function providerEvidenceRef(capabilities: ProviderCapabilities): string {
  return `provider-capabilities://${capabilities.provider}/${capabilities.version}/${capabilities.observedAt}`;
}

function singleCostRateForProvider(
  provider: string,
): ProviderCostRateFixture | undefined {
  const rates = listProviderCostRateFixtures().filter(
    (rate) => rate.provider === provider,
  );

  if (rates.length !== 1) {
    return undefined;
  }

  return rates[0];
}

function roundUsd(value: number): number {
  return Number(value.toFixed(12));
}

function cacheSubjectRef(provider: string, nodeId: string): string {
  return `${providerPath(provider)}.nodes[?(@.id==${JSON.stringify(nodeId)})].promptCacheLayout.cacheablePrefix`;
}

function providerPath(provider: string): string {
  return `$.providerCapabilities[?(@.provider==${JSON.stringify(provider)})]`;
}

function evidenceId(index: number): string {
  return `prompt-cache-layout-${String(index).padStart(3, "0")}`;
}
