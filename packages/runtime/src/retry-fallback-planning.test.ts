import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";

import { retryFallbackPlanningPass } from "./index.js";

const passContext = {
  runId: "retry-fallback-test-run",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("retryFallbackPlanningPass", () => {
  it("plans synthesis-only retry after validator failure without rerunning retrieval", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createRagPlan(),
      passContext,
    );

    expect(result.plan.id).toBe("rag-retry-plan");
    expect(
      result.evidence.find((event) => event.kind === "retry_fallback_decision"),
    ).toMatchObject({
      kind: "retry_fallback_decision",
      refs: ["validator:node-validate", "preserve-node:node-retrieve"],
      retryFallbackDecision: {
        decision: "retry",
        nodeId: "node-synthesize",
        scope: "node",
      },
      summary:
        "Retry node node-synthesize after validator node-validate fails without rerunning upstream context.",
    });
    expect(result.warnings).toEqual([]);
  });

  it("marks side-effecting tool nodes not retryable without idempotency metadata", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createToolPlan(),
      passContext,
    );

    expect(result.warnings).toMatchObject([
      {
        code: "retry_side_effect_not_retryable",
        severity: "warning",
      },
    ]);
    expect(
      result.evidence.find((event) => event.kind === "retry_fallback_decision"),
    ).toMatchObject({
      retryFallbackDecision: {
        decision: "not_retryable",
        nodeId: "node-charge-card",
        scope: "node",
      },
    });
  });

  it("chooses fallback providers that satisfy allowed and denied provider constraints", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createFallbackPlan(),
      passContext,
    );

    expect(result.warnings).toMatchObject([
      {
        code: "fallback_provider_denied",
        severity: "warning",
      },
    ]);
    expect(
      result.evidence.find(
        (event) =>
          event.kind === "retry_fallback_decision" &&
          event.retryFallbackDecision.decision === "fallback",
      ),
    ).toMatchObject({
      retryFallbackDecision: {
        decision: "fallback",
        fallbackTarget: "backup",
        nodeId: "node-model",
        scope: "node",
      },
    });
  });
});

function createRagPlan(): MIRPlan {
  return {
    id: "rag-retry-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [
      {
        id: "ctx-query",
        contentRef: "fixture://query",
        mutability: "fixed",
        provenance: {
          source: "user",
        },
        role: "user_input",
      },
      {
        id: "ctx-docs",
        contentRef: "fixture://docs",
        mutability: "deduplicable",
        provenance: {
          nodeId: "node-retrieve",
          source: "retrieval",
        },
        role: "retrieved_document",
      },
      {
        id: "ctx-answer",
        contentRef: "fixture://answer",
        mutability: "fixed",
        provenance: {
          nodeId: "node-synthesize",
          source: "generated",
        },
        role: "validator_output",
      },
    ],
    nodes: [
      {
        id: "node-retrieve",
        kind: "retrieval_call",
        queryContext: "ctx-query",
        resultContext: "ctx-docs",
        retrieval: {
          source: "fixture-docs",
        },
      },
      {
        id: "node-synthesize",
        kind: "model_call",
        inputContext: ["ctx-docs"],
        outputContext: "ctx-answer",
        model: {
          task: "synthesis",
        },
      },
      {
        id: "node-validate",
        kind: "validator",
        failurePolicy: "retry_node",
        inputContext: ["ctx-answer"],
        validator: {
          kind: "source_grounding",
          name: "grounded-answer",
        },
      },
    ],
    edges: [
      {
        id: "edge-retrieval-to-synthesis",
        fromNodeId: "node-retrieve",
        kind: "data",
        contextIds: ["ctx-docs"],
        toNodeId: "node-synthesize",
      },
      {
        id: "edge-synthesis-to-validator",
        fromNodeId: "node-synthesize",
        kind: "validation",
        contextIds: ["ctx-answer"],
        toNodeId: "node-validate",
      },
    ],
  };
}

function createToolPlan(): MIRPlan {
  return {
    id: "tool-retry-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [],
    nodes: [
      {
        id: "node-charge-card",
        kind: "tool_call",
        metadata: {
          retryFallback: {
            sideEffecting: true,
          },
        },
        tool: {
          name: "charge-card",
        },
      },
    ],
    edges: [],
  };
}

function createFallbackPlan(): MIRPlan {
  return {
    id: "fallback-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {
      allowedProviders: ["backup"],
      deniedProviders: ["denied"],
    },
    context: [],
    nodes: [
      {
        id: "node-model",
        kind: "model_call",
        metadata: {
          retryFallback: {
            fallbackProviders: ["denied", "backup"],
          },
        },
        model: {
          task: "classification",
        },
      },
    ],
    edges: [],
  };
}
