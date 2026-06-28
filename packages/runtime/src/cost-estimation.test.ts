import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIRPlan,
} from "@migaki/mir";
import type { ProviderCostRateFixture } from "@migaki/providers";

import {
  COST_ESTIMATION_VERSION,
  diffPlanCostEstimates,
  estimatePlanCosts,
  estimatePlanTokens,
} from "./index.js";

describe("cost estimation", () => {
  it("estimates node and plan cost from token estimates and rate fixtures", () => {
    const plan = createPlan([
      createContext("ctx-input", {
        tokenEstimate: 1_000,
      }),
    ]);
    const tokenEstimate = estimatePlanTokens(plan);

    const estimate = estimatePlanCosts(plan, tokenEstimate, {
      asOf: "2026-01-15",
      modelSelections: [
        {
          model: "fixture-model",
          nodeId: "node-model",
          outputTokens: 500,
          provider: "fixture-provider",
        },
      ],
      rates: [
        createRate({
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 2,
        }),
      ],
    });

    expect(estimate).toMatchObject({
      version: COST_ESTIMATION_VERSION,
      costUsd: 0.002,
      currency: "USD",
      knownCostUsd: 0.002,
      planId: "cost-plan",
      warnings: [],
    });
    expect(estimate.nodes).toMatchObject([
      {
        costUsd: 0.002,
        inputCostUsd: 0.001,
        inputTokens: 1_000,
        model: "fixture-model",
        nodeId: "node-model",
        outputCostUsd: 0.001,
        outputTokens: 500,
        provider: "fixture-provider",
        metadata: {
          confidence: "estimated",
          source: "provider_cost_rate_fixture",
        },
      },
    ]);
    expect(estimate.nodes[0]?.metadata.rate).toMatchObject({
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      provider: "fixture-provider",
      model: "fixture-model",
    });
  });

  it("fails closed for unknown rates when cost constraints must be proven", () => {
    const plan = createPlan(
      [
        createContext("ctx-input", {
          tokenEstimate: 1_000,
        }),
      ],
      {
        maxCostUsd: 1,
      },
    );
    const tokenEstimate = estimatePlanTokens(plan);

    const estimate = estimatePlanCosts(plan, tokenEstimate, {
      modelSelections: [
        {
          model: "missing-model",
          nodeId: "node-model",
          provider: "fixture-provider",
        },
      ],
      rates: [],
    });

    expect(estimate.costUsd).toBeUndefined();
    expect(estimate.warnings).toMatchObject([
      {
        code: "cost_rate_unknown",
        severity: "error",
      },
    ]);
    expect(estimate.nodes[0]?.metadata).toMatchObject({
      confidence: "unknown",
      source: "missing_rate",
    });
  });

  it("computes estimates with stale rate warnings", () => {
    const plan = createPlan([
      createContext("ctx-input", {
        tokenEstimate: 2_000,
      }),
    ]);
    const tokenEstimate = estimatePlanTokens(plan);

    const estimate = estimatePlanCosts(plan, tokenEstimate, {
      asOf: "2026-02-01",
      modelSelections: [
        {
          model: "fixture-model",
          nodeId: "node-model",
          provider: "fixture-provider",
        },
      ],
      rates: [
        createRate({
          expiresAt: "2026-01-31",
          inputUsdPerMillionTokens: 1,
        }),
      ],
    });

    expect(estimate.costUsd).toBe(0.002);
    expect(estimate.warnings).toMatchObject([
      {
        code: "cost_rate_stale",
        severity: "warning",
      },
    ]);
  });

  it("reports before and after cost deltas", () => {
    const rate = createRate({
      inputUsdPerMillionTokens: 1,
    });
    const before = estimatePlanCosts(
      createPlan([
        createContext("ctx-input", {
          tokenEstimate: 5_000,
        }),
      ]),
      estimatePlanTokens(
        createPlan([
          createContext("ctx-input", {
            tokenEstimate: 5_000,
          }),
        ]),
      ),
      {
        modelSelections: [
          {
            model: "fixture-model",
            nodeId: "node-model",
            provider: "fixture-provider",
          },
        ],
        rates: [rate],
      },
    );
    const after = estimatePlanCosts(
      createPlan([
        createContext("ctx-input", {
          tokenEstimate: 2_000,
        }),
      ]),
      estimatePlanTokens(
        createPlan([
          createContext("ctx-input", {
            tokenEstimate: 2_000,
          }),
        ]),
      ),
      {
        modelSelections: [
          {
            model: "fixture-model",
            nodeId: "node-model",
            provider: "fixture-provider",
          },
        ],
        rates: [rate],
      },
    );

    expect(diffPlanCostEstimates(before, after)).toMatchObject({
      version: COST_ESTIMATION_VERSION,
      beforeCostUsd: 0.005,
      afterCostUsd: 0.002,
      costDeltaUsd: -0.003,
      knownCostDeltaUsd: -0.003,
      currency: "USD",
      metadata: {
        confidence: "estimated",
        source: "aggregate",
      },
    });
  });
});

function createPlan(
  context: readonly MIRContextBlock[],
  constraints: MIRPlan["constraints"] = {},
): MIRPlan {
  return {
    id: "cost-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints,
    context,
    nodes: [
      {
        id: "node-model",
        kind: "model_call",
        inputContext: context.map((block) => block.id),
        model: {
          task: "synthesis",
        },
      },
    ],
    edges: [],
  };
}

function createContext(
  id: string,
  overrides: Partial<Omit<MIRContextBlock, "id">> = {},
): MIRContextBlock {
  return {
    id,
    contentRef: `fixture://${id}`,
    mutability: "fixed",
    provenance: {
      source: "system",
    },
    role: "system_instruction",
    ...overrides,
  };
}

function createRate(
  overrides: Partial<
    Omit<
      ProviderCostRateFixture,
      "currency" | "model" | "provider" | "source" | "version"
    >
  > = {},
): ProviderCostRateFixture {
  return {
    version: "migaki.provider-cost-rates.v0",
    provider: "fixture-provider",
    model: "fixture-model",
    currency: "USD",
    inputUsdPerMillionTokens: 1,
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      note: "Unit test rate fixture.",
    },
    ...overrides,
  };
}
