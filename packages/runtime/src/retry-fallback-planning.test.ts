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

  it("does not warn for approved idempotent mutation tool nodes with policy evidence", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createApprovedToolPlan(),
      passContext,
    );

    expect(result.warnings).toEqual([]);
    expect(
      result.evidence.filter(
        (event) =>
          event.kind === "retry_fallback_decision" &&
          event.retryFallbackDecision.decision === "not_retryable",
      ),
    ).toEqual([]);
  });

  it("marks approval-required tool nodes without approval evidence not retryable", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createApprovalGateOnlyToolPlan(),
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

  it("marks idempotent mutation tool nodes with empty evidence refs not retryable", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createEmptyEvidenceToolPlan(),
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
        nodeId: "node-idempotent-write",
        scope: "node",
      },
    });
  });

  it("marks unknown side-effect tool nodes not retryable", async () => {
    const result = await retryFallbackPlanningPass.apply(
      createUnknownToolPlan(),
      passContext,
    );

    expect(result.warnings).toMatchObject([
      {
        code: "retry_side_effect_not_retryable",
        severity: "warning",
      },
    ]);
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
            sideEffectClass: "non_idempotent_mutation",
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

function createApprovedToolPlan(): MIRPlan {
  return {
    id: "approved-tool-retry-plan",
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
            approvalEvidenceRef: "approval:human-reviewed-charge-1",
            idempotencyKeyRef: "idempotency:charge-request-1",
            policyEvidenceRef: "policy:tool-retry-allowlist-1",
            sideEffectClass: "approval_required",
          },
        },
        tool: {
          name: "charge-card",
          requiresApprovalId: "approval-charge-card",
        },
      },
    ],
    edges: [],
  };
}

function createApprovalGateOnlyToolPlan(): MIRPlan {
  return {
    id: "approval-gate-only-tool-retry-plan",
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
            idempotencyKeyRef: "idempotency:charge-request-1",
            policyEvidenceRef: "policy:tool-retry-allowlist-1",
            sideEffectClass: "approval_required",
          },
        },
        tool: {
          name: "charge-card",
          requiresApprovalId: "approval-charge-card",
        },
      },
    ],
    edges: [],
  };
}

function createEmptyEvidenceToolPlan(): MIRPlan {
  return {
    id: "empty-evidence-tool-retry-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [],
    nodes: [
      {
        id: "node-idempotent-write",
        kind: "tool_call",
        metadata: {
          retryFallback: {
            idempotencyKeyRef: "",
            policyEvidenceRef: "",
            sideEffectClass: "idempotent_mutation",
          },
        },
        tool: {
          name: "upsert-cached-record",
        },
      },
    ],
    edges: [],
  };
}

function createUnknownToolPlan(): MIRPlan {
  return {
    id: "unknown-tool-retry-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [],
    nodes: [
      {
        id: "node-native-github",
        kind: "tool_call",
        metadata: {
          retryFallback: {
            sideEffectClass: "unknown",
          },
        },
        tool: {
          name: "github-update-issue",
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
