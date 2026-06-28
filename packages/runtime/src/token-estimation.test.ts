import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIRPlan,
} from "@migaki/mir";

import {
  DEFAULT_TOKEN_ESTIMATOR_ID,
  diffPlanTokenEstimates,
  estimateContextBlockTokens,
  estimatePlanTokens,
  TOKEN_ESTIMATION_VERSION,
} from "./index.js";

describe("token estimation", () => {
  it("estimates a context block from fixture text with explicit metadata", () => {
    const estimate = estimateContextBlockTokens(
      createContext("ctx-system", {
        contentRef: "fixture://system",
      }),
      {
        content: {
          "fixture://system": "alpha beta gamma",
        },
      },
    );

    expect(estimate).toMatchObject({
      version: TOKEN_ESTIMATION_VERSION,
      contextId: "ctx-system",
      contentRef: "fixture://system",
      subjectRef: '$.context[?(@.id=="ctx-system")]',
      tokens: 3,
      unit: "tokens",
      metadata: {
        confidence: "estimated",
        estimator: {
          name: DEFAULT_TOKEN_ESTIMATOR_ID,
        },
        source: "fixture_content",
        version: TOKEN_ESTIMATION_VERSION,
      },
    });
    expect(estimate.metadata.limitations).toContain(
      "Uses a deterministic fixture heuristic, not a provider tokenizer.",
    );
  });

  it("falls back to declared mIR estimates without marking them exact", () => {
    const estimate = estimateContextBlockTokens(
      createContext("ctx-retrieved", {
        tokenEstimate: 12,
      }),
    );

    expect(estimate.tokens).toBe(12);
    expect(estimate.metadata).toMatchObject({
      confidence: "estimated",
      source: "mir_context_token_estimate",
    });
    expect(estimate.metadata.limitations).toContain(
      "Uses the mIR context tokenEstimate as an upstream estimate.",
    );
  });

  it("aggregates plan context and node input groups deterministically", () => {
    const plan = createPlan(
      [
        createContext("ctx-c", {
          contentRef: "fixture://c",
        }),
        createContext("ctx-a", {
          contentRef: "fixture://a",
        }),
        createContext("ctx-b", {
          contentRef: "fixture://b",
        }),
      ],
      ["ctx-b", "ctx-a"],
    );

    const estimate = estimatePlanTokens(plan, {
      content: {
        "fixture://a": "one two",
        "fixture://b": "three four five",
        "fixture://c": "six",
      },
    });

    expect(estimate.tokens).toBe(6);
    expect(estimate.context.contextIds).toEqual(["ctx-a", "ctx-b", "ctx-c"]);
    expect(estimate.context.knownTokens).toBe(6);
    expect(
      estimate.context.blockEstimates.map((block) => block.tokens),
    ).toEqual([2, 3, 1]);
    expect(estimate.nodeInputs).toHaveLength(1);
    expect(estimate.nodeInputs[0]).toMatchObject({
      groupId: "node-model.input_context",
      contextIds: ["ctx-b", "ctx-a"],
      knownTokens: 5,
      tokens: 5,
    });
  });

  it("reports before and after token deltas from plan estimates", () => {
    const before = estimatePlanTokens(
      createPlan(
        [
          createContext("ctx-a", {
            contentRef: "fixture://a",
          }),
          createContext("ctx-b", {
            contentRef: "fixture://b",
          }),
        ],
        ["ctx-a", "ctx-b"],
        "before-plan",
      ),
      {
        content: {
          "fixture://a": "one two",
          "fixture://b": "three four five",
        },
      },
    );
    const after = estimatePlanTokens(
      createPlan(
        [
          createContext("ctx-a", {
            contentRef: "fixture://a",
          }),
        ],
        ["ctx-a"],
        "after-plan",
      ),
      {
        content: {
          "fixture://a": "one two",
        },
      },
    );

    expect(diffPlanTokenEstimates(before, after)).toMatchObject({
      version: TOKEN_ESTIMATION_VERSION,
      beforePlanId: "before-plan",
      afterPlanId: "after-plan",
      beforeTokens: 5,
      afterTokens: 2,
      knownTokenDelta: -3,
      tokenDelta: -3,
      unit: "tokens",
      metadata: {
        confidence: "estimated",
        source: "aggregate",
      },
    });
  });
});

function createPlan(
  context: readonly MIRContextBlock[],
  inputContext: readonly string[],
  id = "token-plan",
): MIRPlan {
  return {
    id,
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context,
    nodes: [
      {
        id: "node-model",
        kind: "model_call",
        inputContext,
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
