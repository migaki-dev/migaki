import type { MIRNode, MIRPlan } from "@migaki/mir";
import {
  citeProviderCostRate,
  listProviderCostRateFixtures,
  type ProviderCostRateEvidenceCitation,
  type ProviderCostRateFixture,
} from "@migaki/providers";

import type {
  ContextTokenEstimateGroup,
  PlanTokenEstimate,
} from "./token-estimation.js";

export const COST_ESTIMATION_VERSION = "migaki.cost-estimation.v0";

export type CostEstimationVersion = typeof COST_ESTIMATION_VERSION;

export type CostEstimateConfidence = "estimated" | "unknown";

export type CostEstimateSource =
  | "aggregate"
  | "missing_model_selection"
  | "missing_rate"
  | "missing_tokens"
  | "provider_cost_rate_fixture";

export interface CostEstimateMetadata {
  readonly confidence: CostEstimateConfidence;
  readonly limitations: readonly string[];
  readonly rate?: ProviderCostRateEvidenceCitation;
  readonly source: CostEstimateSource;
  readonly version: CostEstimationVersion;
}

export interface CostModelSelection {
  readonly model: string;
  readonly nodeId: string;
  readonly outputTokens?: number;
  readonly provider: string;
}

export type UnknownCostPolicy = "error" | "warning";

export interface EstimatePlanCostsOptions {
  readonly asOf?: string;
  readonly modelSelections: readonly CostModelSelection[];
  readonly rates?: readonly ProviderCostRateFixture[];
  readonly unknownCostPolicy?: UnknownCostPolicy;
}

export type CostEstimateWarningCode =
  | "cost_constraint_exceeded"
  | "cost_model_selection_missing"
  | "cost_not_comparable"
  | "cost_output_rate_unknown"
  | "cost_rate_stale"
  | "cost_rate_unknown"
  | "cost_tokens_unknown";

export interface CostEstimateWarning {
  readonly assumption?: string;
  readonly code: CostEstimateWarningCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly path?: string;
  readonly severity: "error" | "info" | "warning";
}

export interface NodeCostEstimate {
  readonly costUsd?: number;
  readonly currency: "USD";
  readonly inputCostUsd?: number;
  readonly inputTokens?: number;
  readonly knownCostUsd: number;
  readonly metadata: CostEstimateMetadata;
  readonly model?: string;
  readonly nodeId: string;
  readonly outputCostUsd?: number;
  readonly outputTokens?: number;
  readonly provider?: string;
  readonly subjectRef: string;
  readonly version: CostEstimationVersion;
  readonly warnings: readonly CostEstimateWarning[];
}

export interface PlanCostEstimate {
  readonly costUsd?: number;
  readonly currency: "USD";
  readonly knownCostUsd: number;
  readonly metadata: CostEstimateMetadata;
  readonly nodes: readonly NodeCostEstimate[];
  readonly planId: string;
  readonly subjectRef: string;
  readonly version: CostEstimationVersion;
  readonly warnings: readonly CostEstimateWarning[];
}

export interface PlanCostEstimateDelta {
  readonly afterCostUsd?: number;
  readonly afterPlanId: string;
  readonly beforeCostUsd?: number;
  readonly beforePlanId: string;
  readonly costDeltaUsd?: number;
  readonly currency: "USD";
  readonly knownCostDeltaUsd: number;
  readonly metadata: CostEstimateMetadata;
  readonly version: CostEstimationVersion;
  readonly warnings: readonly CostEstimateWarning[];
}

const costRateLimitations = [
  "Uses versioned provider/model cost-rate fixtures, not live billing data.",
  "Cost is an estimate and may differ from invoices, discounts, gateway policy, or cached-token pricing.",
] as const;

const missingSelectionLimitations = [
  "No provider/model selection was supplied for this model node.",
] as const;

const missingRateLimitations = [
  "No provider/model cost-rate fixture matched the selected provider and model.",
] as const;

const missingTokenLimitations = [
  "Token estimate was unknown, so total cost is unknown.",
] as const;

const outputOmittedLimitations = [
  "Output token cost is omitted when output token estimates are unavailable.",
] as const;

const staleRateLimitations = [
  "The selected cost-rate fixture is stale for the requested estimate date.",
] as const;

const aggregateLimitations = [
  "Aggregates node-level cost estimates without live billing lookup.",
  "Aggregate totals are unknown when any required node cost is unknown.",
] as const;

const deltaLimitations = [
  "Compares aggregate cost estimates and does not claim invoice-exact savings.",
] as const;

export function estimatePlanCosts(
  plan: MIRPlan,
  tokenEstimate: PlanTokenEstimate,
  options: EstimatePlanCostsOptions,
): PlanCostEstimate {
  const rates = options.rates ?? listProviderCostRateFixtures();
  const nodeInputs = new Map(
    tokenEstimate.nodeInputs.map((group) => [group.groupId, group]),
  );
  const selections = new Map(
    options.modelSelections.map((selection) => [selection.nodeId, selection]),
  );
  const nodes = plan.nodes.flatMap((node) =>
    estimateNodeCost(node, nodeInputs, selections, rates, plan, options),
  );
  const costUsd = sumKnownNodeCosts(nodes);
  const knownCostUsd = roundUsd(
    nodes.reduce((total, estimate) => total + estimate.knownCostUsd, 0),
  );
  const warnings = [
    ...nodes.flatMap((estimate) => estimate.warnings),
    ...checkCostConstraint(plan, costUsd),
  ];
  const estimate: PlanCostEstimate = {
    currency: "USD",
    knownCostUsd,
    metadata: createAggregateMetadata({
      confidence: costUsd === undefined ? "unknown" : "estimated",
      inputMetadata: nodes.map((node) => node.metadata),
      limitations: aggregateLimitations,
      source: "aggregate",
    }),
    nodes,
    planId: plan.id,
    subjectRef: planPath(plan.id),
    version: COST_ESTIMATION_VERSION,
    warnings,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };

  return estimate;
}

export function diffPlanCostEstimates(
  before: PlanCostEstimate,
  after: PlanCostEstimate,
): PlanCostEstimateDelta {
  const comparable =
    before.currency === after.currency &&
    before.costUsd !== undefined &&
    after.costUsd !== undefined;
  const warnings = comparable
    ? []
    : [
        {
          code: "cost_not_comparable",
          message:
            "Cost delta is unknown because one or both aggregate costs are unknown.",
          severity: "warning",
        } satisfies CostEstimateWarning,
      ];
  const delta: PlanCostEstimateDelta = {
    afterPlanId: after.planId,
    beforePlanId: before.planId,
    currency: "USD",
    knownCostDeltaUsd: roundUsd(after.knownCostUsd - before.knownCostUsd),
    metadata: createAggregateMetadata({
      confidence: comparable ? "estimated" : "unknown",
      inputMetadata: [before.metadata, after.metadata],
      limitations: deltaLimitations,
      source: "aggregate",
    }),
    version: COST_ESTIMATION_VERSION,
    warnings,
    ...(after.costUsd !== undefined ? { afterCostUsd: after.costUsd } : {}),
    ...(before.costUsd !== undefined ? { beforeCostUsd: before.costUsd } : {}),
    ...(comparable
      ? { costDeltaUsd: roundUsd(after.costUsd - before.costUsd) }
      : {}),
  };

  return delta;
}

function estimateNodeCost(
  node: MIRNode,
  nodeInputs: ReadonlyMap<string, ContextTokenEstimateGroup>,
  selections: ReadonlyMap<string, CostModelSelection>,
  rates: readonly ProviderCostRateFixture[],
  plan: MIRPlan,
  options: EstimatePlanCostsOptions,
): readonly NodeCostEstimate[] {
  if (node.kind !== "model_call") {
    return [];
  }

  const selection = selections.get(node.id);
  const nodeInput = nodeInputs.get(`${node.id}.input_context`);
  const unknownSeverity = severityForUnknownCost(plan, options);

  if (selection === undefined) {
    return [
      createUnknownNodeEstimate({
        code: "cost_model_selection_missing",
        limitations: missingSelectionLimitations,
        message: "Model node has no provider/model cost selection.",
        node,
        severity: unknownSeverity,
        source: "missing_model_selection",
      }),
    ];
  }

  const rate = lookupRate(rates, selection);

  if (rate === undefined) {
    return [
      createUnknownNodeEstimate({
        code: "cost_rate_unknown",
        limitations: missingRateLimitations,
        message: "Provider/model cost-rate fixture is unknown.",
        model: selection.model,
        node,
        provider: selection.provider,
        severity: unknownSeverity,
        source: "missing_rate",
      }),
    ];
  }

  const warnings: CostEstimateWarning[] = [];
  const stale = isRateStale(rate, options.asOf);

  if (stale) {
    warnings.push({
      assumption: `Rate fixture expired at ${rate.expiresAt}.`,
      code: "cost_rate_stale",
      message: "Provider/model cost-rate fixture is stale.",
      nodeId: node.id,
      path: nodePath(node.id),
      severity: "warning",
    });
  }

  if (nodeInput?.tokens === undefined) {
    warnings.push({
      code: "cost_tokens_unknown",
      message: "Node input token estimate is unknown.",
      nodeId: node.id,
      path: nodePath(node.id),
      severity: unknownSeverity,
    });

    const knownInputCostUsd = roundUsd(
      ((nodeInput?.knownTokens ?? 0) / 1_000_000) *
        rate.inputUsdPerMillionTokens,
    );

    return [
      createNodeEstimate({
        knownCostUsd: knownInputCostUsd,
        limitations: [
          ...costRateLimitations,
          ...missingTokenLimitations,
          ...(stale ? staleRateLimitations : []),
        ],
        metadataSource: "missing_tokens",
        model: selection.model,
        node,
        provider: selection.provider,
        rate,
        warnings,
      }),
    ];
  }

  const inputCostUsd = roundUsd(
    (nodeInput.tokens / 1_000_000) * rate.inputUsdPerMillionTokens,
  );
  const outputCostUsd =
    selection.outputTokens !== undefined &&
    rate.outputUsdPerMillionTokens !== undefined
      ? roundUsd(
          (selection.outputTokens / 1_000_000) * rate.outputUsdPerMillionTokens,
        )
      : undefined;

  if (
    selection.outputTokens !== undefined &&
    rate.outputUsdPerMillionTokens === undefined
  ) {
    warnings.push({
      code: "cost_output_rate_unknown",
      message: "Output token estimate was supplied but output rate is unknown.",
      nodeId: node.id,
      path: nodePath(node.id),
      severity: unknownSeverity,
    });
  }

  const costUsd =
    selection.outputTokens !== undefined &&
    rate.outputUsdPerMillionTokens === undefined
      ? undefined
      : roundUsd(inputCostUsd + (outputCostUsd ?? 0));
  const knownCostUsd = roundUsd(inputCostUsd + (outputCostUsd ?? 0));

  return [
    createNodeEstimate({
      ...(costUsd !== undefined ? { costUsd } : {}),
      inputCostUsd,
      inputTokens: nodeInput.tokens,
      knownCostUsd,
      limitations: [
        ...costRateLimitations,
        ...(selection.outputTokens === undefined
          ? outputOmittedLimitations
          : []),
        ...(stale ? staleRateLimitations : []),
      ],
      metadataSource:
        costUsd === undefined ? "missing_rate" : "provider_cost_rate_fixture",
      model: selection.model,
      node,
      ...(outputCostUsd !== undefined ? { outputCostUsd } : {}),
      ...(selection.outputTokens !== undefined
        ? { outputTokens: selection.outputTokens }
        : {}),
      provider: selection.provider,
      rate,
      warnings,
    }),
  ];
}

function createUnknownNodeEstimate(input: {
  readonly code: CostEstimateWarningCode;
  readonly limitations: readonly string[];
  readonly message: string;
  readonly model?: string;
  readonly node: Extract<MIRNode, { kind: "model_call" }>;
  readonly provider?: string;
  readonly severity: CostEstimateWarning["severity"];
  readonly source: CostEstimateSource;
}): NodeCostEstimate {
  return createNodeEstimate({
    knownCostUsd: 0,
    limitations: input.limitations,
    metadataSource: input.source,
    ...(input.model !== undefined ? { model: input.model } : {}),
    node: input.node,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    warnings: [
      {
        code: input.code,
        message: input.message,
        nodeId: input.node.id,
        path: nodePath(input.node.id),
        severity: input.severity,
      },
    ],
  });
}

function createNodeEstimate(input: {
  readonly costUsd?: number;
  readonly inputCostUsd?: number;
  readonly inputTokens?: number;
  readonly knownCostUsd: number;
  readonly limitations: readonly string[];
  readonly metadataSource: CostEstimateSource;
  readonly model?: string;
  readonly node: Extract<MIRNode, { kind: "model_call" }>;
  readonly outputCostUsd?: number;
  readonly outputTokens?: number;
  readonly provider?: string;
  readonly rate?: ProviderCostRateFixture;
  readonly warnings: readonly CostEstimateWarning[];
}): NodeCostEstimate {
  const estimate: NodeCostEstimate = {
    currency: "USD",
    knownCostUsd: input.knownCostUsd,
    metadata: createMetadata({
      confidence: input.costUsd === undefined ? "unknown" : "estimated",
      limitations: input.limitations,
      ...(input.rate !== undefined
        ? { rate: citeProviderCostRate(input.rate) }
        : {}),
      source: input.metadataSource,
    }),
    nodeId: input.node.id,
    subjectRef: nodePath(input.node.id),
    version: COST_ESTIMATION_VERSION,
    warnings: input.warnings,
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    ...(input.inputCostUsd !== undefined
      ? { inputCostUsd: input.inputCostUsd }
      : {}),
    ...(input.inputTokens !== undefined
      ? { inputTokens: input.inputTokens }
      : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.outputCostUsd !== undefined
      ? { outputCostUsd: input.outputCostUsd }
      : {}),
    ...(input.outputTokens !== undefined
      ? { outputTokens: input.outputTokens }
      : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
  };

  return estimate;
}

function createMetadata(input: {
  readonly confidence: CostEstimateConfidence;
  readonly limitations: readonly string[];
  readonly rate?: ProviderCostRateEvidenceCitation;
  readonly source: CostEstimateSource;
}): CostEstimateMetadata {
  return {
    confidence: input.confidence,
    limitations: uniqueLimitations(input.limitations),
    source: input.source,
    version: COST_ESTIMATION_VERSION,
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
  };
}

function createAggregateMetadata(input: {
  readonly confidence: CostEstimateConfidence;
  readonly inputMetadata: readonly CostEstimateMetadata[];
  readonly limitations: readonly string[];
  readonly source: CostEstimateSource;
}): CostEstimateMetadata {
  return createMetadata({
    confidence: input.confidence,
    limitations: uniqueLimitations([
      ...input.inputMetadata.flatMap((metadata) => metadata.limitations),
      ...input.limitations,
    ]),
    source: input.source,
  });
}

function sumKnownNodeCosts(
  nodes: readonly NodeCostEstimate[],
): number | undefined {
  let total = 0;

  for (const estimate of nodes) {
    if (estimate.costUsd === undefined) {
      return undefined;
    }

    total += estimate.costUsd;
  }

  return roundUsd(total);
}

function checkCostConstraint(
  plan: MIRPlan,
  costUsd: number | undefined,
): readonly CostEstimateWarning[] {
  if (plan.constraints.maxCostUsd === undefined || costUsd === undefined) {
    return [];
  }

  if (costUsd <= plan.constraints.maxCostUsd) {
    return [];
  }

  return [
    {
      assumption: `Estimated cost ${costUsd} exceeds maxCostUsd ${plan.constraints.maxCostUsd}.`,
      code: "cost_constraint_exceeded",
      message: "Estimated plan cost exceeds the configured maxCostUsd.",
      path: "$.constraints.maxCostUsd",
      severity: "error",
    },
  ];
}

function lookupRate(
  rates: readonly ProviderCostRateFixture[],
  selection: CostModelSelection,
): ProviderCostRateFixture | undefined {
  return rates.find(
    (rate) =>
      rate.provider === selection.provider && rate.model === selection.model,
  );
}

function isRateStale(
  rate: ProviderCostRateFixture,
  asOf: string | undefined,
): boolean {
  if (asOf === undefined || rate.expiresAt === undefined) {
    return false;
  }

  const asOfMs = Date.parse(asOf);
  const expiresAtMs = Date.parse(rate.expiresAt);

  if (Number.isNaN(asOfMs) || Number.isNaN(expiresAtMs)) {
    return false;
  }

  return asOfMs > expiresAtMs;
}

function severityForUnknownCost(
  plan: MIRPlan,
  options: EstimatePlanCostsOptions,
): CostEstimateWarning["severity"] {
  if (
    options.unknownCostPolicy === "error" ||
    plan.constraints.maxCostUsd !== undefined
  ) {
    return "error";
  }

  return "warning";
}

function roundUsd(value: number): number {
  return Number(value.toFixed(12));
}

function uniqueLimitations(limitations: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const limitation of limitations) {
    if (seen.has(limitation)) {
      continue;
    }

    seen.add(limitation);
    unique.push(limitation);
  }

  return unique;
}

function nodePath(id: string): string {
  return `$.nodes[?(@.id==${JSON.stringify(id)})]`;
}

function planPath(id: string): string {
  return `$.plan[?(@.id==${JSON.stringify(id)})]`;
}
