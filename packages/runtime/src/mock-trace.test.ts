import { describe, expect, it } from "vitest";

import { assertMIRPlan, type MIRPlan } from "@migaki/mir";
import {
  MOCK_BACKEND_VERSION,
  PROVIDER_CONTRACT_VERSION,
  createMockExecutionBackend,
  type MockBackendFixture,
} from "@migaki/providers";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  MOCK_TRACE_ARTIFACT_VERSION,
  captureMockExecutionTrace,
  parseMockExecutionTraceArtifact,
  replayMockExecutionTrace,
  serializeMockExecutionTraceArtifact,
  validateMockExecutionTraceArtifact,
} from "./index.js";

const startedAt = "2026-01-01T00:00:00.000Z";

const fixture: MockBackendFixture = {
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
};

describe("mock execution trace artifacts", () => {
  it("captures a replayable trace with schema, timing, responses, validators, and evidence refs", async () => {
    const { loweredPlan, plan, result } = await executeBaselineFixture();

    const trace = captureMockExecutionTrace({
      artifactId: "trace-artifact-rag-baseline",
      createdAt: "2026-01-01T00:00:01.000Z",
      estimates: {
        costUsd: 0,
        inputTokens: 1280,
        latencyMs: 37,
        outputTokens: 1380,
      },
      evidenceBundleRef: {
        kind: "artifact",
        ref: "evidence://bundle/rag-baseline",
      },
      fixture,
      loweredPlan,
      plan,
      redactions: [
        {
          mode: "omitted",
          path: "$.responses[*].metadata",
          reason: "Mock trace fixture does not persist prompt text.",
        },
      ],
      result,
      traceId: "trace-rag-baseline",
    });

    expect(trace).toMatchObject({
      artifactId: "trace-artifact-rag-baseline",
      backend: {
        contractVersion: PROVIDER_CONTRACT_VERSION,
        id: "mock-backend",
        kind: "mock",
        mockBackendVersion: MOCK_BACKEND_VERSION,
        provider: "mock",
      },
      evidenceBundleRef: {
        ref: "evidence://bundle/rag-baseline",
      },
      plan: {
        planId: "rag-baseline",
        version: "migaki.mir.v0",
      },
      result: {
        status: "succeeded",
      },
      timing: {
        completedAt: "2026-01-01T00:00:00.037Z",
        durationMs: 37,
        startedAt,
      },
      traceId: "trace-rag-baseline",
      version: MOCK_TRACE_ARTIFACT_VERSION,
    });
    expect(trace.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(trace.responses.map((response) => response.nodeId)).toEqual([
      "node-retrieve",
      "node-synthesize",
      "node-validate",
    ]);
    expect(trace.validatorResults).toEqual([
      {
        status: "passed",
        targetRef: "ctx-answer",
        validatorId: "validator-source-grounding",
      },
    ]);
    expect(validateMockExecutionTraceArtifact(trace)).toEqual({
      errors: [],
      success: true,
      trace,
    });
    expect(
      parseMockExecutionTraceArtifact(
        serializeMockExecutionTraceArtifact(trace),
      ),
    ).toEqual(trace);
  });

  it("replays a captured mock trace deterministically", async () => {
    const { loweredPlan, plan, result } = await executeBaselineFixture();
    const trace = captureMockExecutionTrace({
      artifactId: "trace-artifact-rag-baseline",
      createdAt: "2026-01-01T00:00:01.000Z",
      fixture,
      loweredPlan,
      plan,
      result,
      traceId: "trace-rag-baseline",
    });

    const replay = await replayMockExecutionTrace(
      parseMockExecutionTraceArtifact(
        serializeMockExecutionTraceArtifact(trace),
      ),
    );

    expect(replay).toMatchObject({
      mismatches: [],
      status: "matched",
      traceId: "trace-rag-baseline",
    });
    expect(replay.result.outputs).toEqual(trace.result.outputs);
    expect(replay.result.logs).toEqual(
      trace.steps.map((step) => ({
        completedAt: step.completedAt,
        nodeId: step.nodeId,
        outputRef: step.outputRef,
        startedAt: step.startedAt,
        status: step.status,
        stepId: step.id,
        ...(step.usage !== undefined ? { usage: step.usage } : {}),
        ...(step.validation !== undefined
          ? { validation: step.validation }
          : {}),
      })),
    );
  });

  it("reports replay mismatches when captured fixture data changes", async () => {
    const { loweredPlan, plan, result } = await executeBaselineFixture();
    const trace = captureMockExecutionTrace({
      artifactId: "trace-artifact-rag-baseline",
      createdAt: "2026-01-01T00:00:01.000Z",
      fixture: {
        responses: fixture.responses.map((response) =>
          response.nodeId === "node-synthesize"
            ? {
                ...response,
                outputRef: "fixture://mock/rag/changed-answer",
              }
            : response,
        ),
      },
      loweredPlan,
      plan,
      result,
      traceId: "trace-rag-baseline",
    });

    const replay = await replayMockExecutionTrace(trace);

    expect(replay.status).toBe("mismatched");
    expect(replay.mismatches).toContain("result.outputs");
  });

  it("refuses incompatible trace schema versions with clear errors", () => {
    expect(
      validateMockExecutionTraceArtifact({
        version: "migaki.trace-artifact.v99",
      }),
    ).toEqual({
      errors: [
        {
          code: "unknown_version",
          message: "Unsupported mock execution trace artifact version.",
          path: "$.version",
        },
        {
          code: "missing_required",
          message: "Missing required string.",
          path: "$.artifactId",
        },
        {
          code: "missing_required",
          message: "Missing required string.",
          path: "$.traceId",
        },
        {
          code: "missing_required",
          message: "Missing required string.",
          path: "$.createdAt",
        },
        {
          code: "missing_required",
          message: "Missing required object.",
          path: "$.plan",
        },
        {
          code: "missing_required",
          message: "Missing required object.",
          path: "$.backend",
        },
        {
          code: "missing_required",
          message: "Missing required array.",
          path: "$.steps",
        },
        {
          code: "missing_required",
          message: "Missing required array.",
          path: "$.responses",
        },
        {
          code: "missing_required",
          message: "Missing required object.",
          path: "$.result",
        },
        {
          code: "missing_required",
          message: "Missing required array.",
          path: "$.validatorResults",
        },
        {
          code: "missing_required",
          message: "Missing required object.",
          path: "$.timing",
        },
        {
          code: "missing_required",
          message: "Missing required array.",
          path: "$.redactions",
        },
      ],
      success: false,
    });
    expect(() =>
      parseMockExecutionTraceArtifact(
        JSON.stringify({
          version: "migaki.trace-artifact.v99",
        }),
      ),
    ).toThrow("Invalid mock execution trace artifact.");
  });
});

async function executeBaselineFixture(): Promise<{
  readonly loweredPlan: Awaited<
    ReturnType<ReturnType<typeof createMockExecutionBackend>["lower"]>
  >;
  readonly plan: MIRPlan;
  readonly result: Awaited<
    ReturnType<ReturnType<typeof createMockExecutionBackend>["execute"]>
  >;
}> {
  const backend = createMockExecutionBackend({ fixture, startedAt });
  const plan = await loadRagBaselinePlan();
  const loweredPlan = await backend.lower(plan);
  const result = await backend.execute(loweredPlan);

  return {
    loweredPlan,
    plan,
    result,
  };
}

async function loadRagBaselinePlan(): Promise<MIRPlan> {
  return assertMIRPlan(
    await readJsonFixture(
      new URL("../../mir/src/examples/rag-baseline.json", import.meta.url),
    ),
  );
}
