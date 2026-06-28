import { describe, expect, it } from "vitest";

import { assertMIRPlan, type MIRPlan } from "@migaki/mir";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  MOCK_BACKEND_VERSION,
  PROVIDER_CONTRACT_VERSION,
  createMockExecutionBackend,
} from "./index.js";

describe("mock execution backend", () => {
  it("lowers the RAG baseline fixture into deterministic mock steps", async () => {
    const backend = createMockExecutionBackend();
    const plan = await loadRagBaselinePlan();

    const lowered = await backend.lower(plan);

    expect(lowered).toMatchObject({
      assumptions: [
        {
          capability: "structured_outputs",
          description: "Mock backend returns deterministic fixture responses.",
        },
      ],
      backendId: "mock-backend",
      id: "mock-lowered-rag-baseline",
      metadata: {
        mockBackendVersion: MOCK_BACKEND_VERSION,
      },
      provider: "mock",
      sourcePlanId: "rag-baseline",
      version: PROVIDER_CONTRACT_VERSION,
      warnings: [],
    });
    expect(
      lowered.steps.map((step) => ({
        id: step.id,
        inputContext: step.inputContext,
        kind: step.kind,
        outputContext: step.outputContext,
        sourceNodeId: step.sourceNodeId,
      })),
    ).toEqual([
      {
        id: "mock-step-001-node-retrieve",
        inputContext: ["ctx-question"],
        kind: "retrieval",
        outputContext: "ctx-retrieved",
        sourceNodeId: "node-retrieve",
      },
      {
        id: "mock-step-002-node-synthesize",
        inputContext: ["ctx-system", "ctx-question", "ctx-retrieved"],
        kind: "model",
        outputContext: "ctx-answer",
        sourceNodeId: "node-synthesize",
      },
      {
        id: "mock-step-003-node-validate",
        inputContext: ["ctx-answer", "ctx-retrieved"],
        kind: "validator",
        outputContext: "ctx-validation",
        sourceNodeId: "node-validate",
      },
    ]);
  });

  it("executes fixture responses with deterministic fake-clock logs and usage", async () => {
    const backend = createMockExecutionBackend({
      fixture: {
        responses: [
          {
            contextId: "ctx-retrieved",
            nodeId: "node-retrieve",
            outputRef: "fixture://mock/rag/retrieved",
            usage: {
              inputTokens: 24,
              latencyMs: 10,
              outputTokens: 1200,
            },
          },
          {
            contextId: "ctx-answer",
            nodeId: "node-synthesize",
            outputRef: "fixture://mock/rag/answer",
            usage: {
              costUsd: 0,
              inputTokens: 1256,
              latencyMs: 25,
              outputTokens: 180,
            },
          },
          {
            contextId: "ctx-validation",
            nodeId: "node-validate",
            outputRef: "fixture://mock/rag/validation",
            usage: {
              latencyMs: 2,
            },
            validation: {
              status: "passed",
              targetRef: "ctx-answer",
              validatorId: "validator-source-grounding",
            },
          },
        ],
      },
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const lowered = await backend.lower(await loadRagBaselinePlan());

    const result = await backend.execute(lowered);

    expect(result).toMatchObject({
      loweredPlanId: "mock-lowered-rag-baseline",
      status: "succeeded",
      usage: {
        costUsd: 0,
        inputTokens: 1280,
        latencyMs: 37,
        outputTokens: 1380,
      },
      validatorResults: [
        {
          status: "passed",
          targetRef: "ctx-answer",
          validatorId: "validator-source-grounding",
        },
      ],
      version: PROVIDER_CONTRACT_VERSION,
      warnings: [],
    });
    expect(result.outputs.map((output) => output.outputRef)).toEqual([
      "fixture://mock/rag/retrieved",
      "fixture://mock/rag/answer",
      "fixture://mock/rag/validation",
    ]);
    expect(
      result.logs.map((entry) => ({
        completedAt: entry.completedAt,
        nodeId: entry.nodeId,
        startedAt: entry.startedAt,
        status: entry.status,
      })),
    ).toEqual([
      {
        completedAt: "2026-01-01T00:00:00.010Z",
        nodeId: "node-retrieve",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "succeeded",
      },
      {
        completedAt: "2026-01-01T00:00:00.035Z",
        nodeId: "node-synthesize",
        startedAt: "2026-01-01T00:00:00.010Z",
        status: "succeeded",
      },
      {
        completedAt: "2026-01-01T00:00:00.037Z",
        nodeId: "node-validate",
        startedAt: "2026-01-01T00:00:00.035Z",
        status: "succeeded",
      },
    ]);
  });

  it("injects retryable failures without rerunning later steps", async () => {
    const backend = createMockExecutionBackend({
      fixture: {
        responses: [
          {
            contextId: "ctx-retrieved",
            nodeId: "node-retrieve",
            outputRef: "fixture://mock/rag/retrieved",
          },
          {
            error: {
              code: "mock_synthesis_failed",
              message: "Injected synthesis failure.",
              retryable: true,
            },
            nodeId: "node-synthesize",
            usage: {
              latencyMs: 5,
            },
          },
        ],
      },
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const lowered = await backend.lower(await loadRagBaselinePlan());

    const result = await backend.execute(lowered);

    expect(result).toMatchObject({
      error: {
        code: "mock_synthesis_failed",
        retryable: true,
      },
      status: "partial",
    });
    expect(result.outputs).toEqual([
      {
        contextId: "ctx-retrieved",
        nodeId: "node-retrieve",
        outputRef: "fixture://mock/rag/retrieved",
      },
    ]);
    expect(result.logs.map((entry) => entry.nodeId)).toEqual([
      "node-retrieve",
      "node-synthesize",
    ]);
    expect(result.logs.at(-1)).toMatchObject({
      error: {
        code: "mock_synthesis_failed",
        retryable: true,
      },
      nodeId: "node-synthesize",
      status: "failed",
    });
  });
});

async function loadRagBaselinePlan(): Promise<MIRPlan> {
  return assertMIRPlan(
    await readJsonFixture(
      new URL("../../mir/src/examples/rag-baseline.json", import.meta.url),
    ),
  );
}
