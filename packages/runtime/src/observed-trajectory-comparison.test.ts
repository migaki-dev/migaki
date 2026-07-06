import { describe, expect, it } from "vitest";

import {
  EXECUTION_GRAPH_VERSION,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  OBSERVED_TRAJECTORY_COMPARISON_VERSION,
  compareObservedExecutionGraphs,
  stableExecutionHash,
  type ExecutionGraph,
  type ExecutionNode,
} from "./index.js";

describe("observed trajectory comparison", () => {
  it("classifies exact reusable model and tool nodes with estimates", () => {
    const previous = graph("previous", [
      modelNode("model-answer", {
        dependencies: [{ kind: "context", operationId: "context" }],
        fingerprintSeed: "answer-v1",
        latencyMs: 1200,
      }),
      toolNode("tool-search", {
        dependencies: [{ kind: "model_output", operationId: "model-answer" }],
        fingerprintSeed: "search-v1",
        latencyMs: 300,
        totalTokens: 20,
      }),
    ]);
    const current = graph("current", [
      modelNode("model-answer", {
        dependencies: [{ kind: "context", operationId: "context" }],
        fingerprintSeed: "answer-v1",
        latencyMs: 1300,
        totalTokens: 250,
      }),
      toolNode("tool-search", {
        dependencies: [{ kind: "model_output", operationId: "model-answer" }],
        fingerprintSeed: "search-v1",
        latencyMs: 350,
        totalTokens: 25,
      }),
    ]);

    const comparison = compareObservedExecutionGraphs(previous, current);

    expect(comparison).toMatchObject({
      version: OBSERVED_TRAJECTORY_COMPARISON_VERSION,
      previousRunId: "previous",
      currentRunId: "current",
      privacyPolicy: {
        exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
        exportMode: "metadata_only",
        fullTraceOptIn: false,
      },
      summary: {
        blockedCandidates: 0,
        changedNodes: 0,
        reusableModelCalls: 1,
        reusableToolCalls: 1,
        totalEstimatedAvoidableCostUsd: 0.035,
        totalEstimatedAvoidableLatencyMs: 1650,
        totalEstimatedAvoidableTokens: 275,
      },
    });
    expect(comparison.reusableModelCalls).toMatchObject([
      {
        nodeId: "model-answer",
        operationKind: "model_call",
        estimates: {
          costUsd: 0.025,
          latencyMs: 1300,
          totalTokens: 250,
        },
      },
    ]);
    expect(
      comparison.reusableModelCalls[0]?.checks.map((check) => check.name),
    ).toEqual([
      "cache_key_equality",
      "dependency_equality",
      "runtime_compatibility",
      "status_success",
      "validator_requirements",
      "policy_constraints",
      "freshness_constraints",
      "side_effects",
    ]);
    expect(
      comparison.reusableModelCalls[0]?.checks.every(
        (check) => check.status === "passed",
      ),
    ).toBe(true);
    expect(comparison.reusableToolCalls).toMatchObject([
      {
        nodeId: "tool-search",
        operationKind: "tool_call",
        estimates: {
          costUsd: 0.01,
          latencyMs: 350,
          totalTokens: 25,
        },
      },
    ]);
    expect(comparison.blockedCandidates).toEqual([]);
    expect(comparison.warnings).toEqual([
      {
        code: "potential_reuse_only",
        message:
          "Observed trajectory comparison only identifies potential reusable nodes; it never executes, replays, caches, or skips work.",
      },
    ]);
  });

  it("classifies changed nodes when cache keys differ", () => {
    const previous = graph("previous", [
      modelNode("model-answer", { fingerprintSeed: "answer-v1" }),
    ]);
    const current = graph("current", [
      modelNode("model-answer", { fingerprintSeed: "answer-v2" }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).changedNodes,
    ).toEqual([
      {
        nodeId: "model-answer",
        operationKind: "model_call",
        previousNodeId: "model-answer",
        reason: "cache_key_changed",
      },
    ]);
  });

  it("blocks candidates when exactly one cache key is missing", () => {
    for (const input of [
      {
        expectedCacheKey: stableExecutionHash({ fingerprintSeed: "answer" }),
        previousFingerprintSeed: undefined,
        currentFingerprintSeed: "answer",
      },
      {
        expectedCacheKey: undefined,
        previousFingerprintSeed: "answer",
        currentFingerprintSeed: undefined,
      },
    ]) {
      const previous = graph("previous", [
        modelNode("model-answer", {
          ...(input.previousFingerprintSeed === undefined
            ? {}
            : { fingerprintSeed: input.previousFingerprintSeed }),
        }),
      ]);
      const current = graph("current", [
        modelNode("model-answer", {
          ...(input.currentFingerprintSeed === undefined
            ? {}
            : { fingerprintSeed: input.currentFingerprintSeed }),
        }),
      ]);

      const comparison = compareObservedExecutionGraphs(previous, current);
      const candidate = comparison.blockedCandidates[0];

      expect(comparison.changedNodes).toEqual([]);
      expect(comparison.summary).toMatchObject({
        blockedCandidates: 1,
        changedNodes: 0,
      });
      expect(candidate).toMatchObject({
        nodeId: "model-answer",
        operationKind: "model_call",
        previousNodeId: "model-answer",
        reasons: [
          {
            code: "cache_key_unknown",
            message: "Both observed nodes require a stable cache key.",
          },
        ],
      });
      expect(candidate?.cacheKey).toBe(input.expectedCacheKey);
      expect(candidate?.checks).toContainEqual({
        message: "Both observed nodes require a stable cache key.",
        name: "cache_key_equality",
        status: "unknown",
      });
    }
  });

  it("blocks candidates when file freshness is unknown", () => {
    const previous = graph("previous", [
      toolNode("tool-read", {
        artifacts: [fileArtifact("file-a", "file-v1", "verified")],
        fingerprintSeed: "read-file",
      }),
    ]);
    const current = graph("current", [
      toolNode("tool-read", {
        artifacts: [fileArtifact("file-a", "file-v1", "unknown")],
        fingerprintSeed: "read-file",
      }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).blockedCandidates,
    ).toEqual([
      expect.objectContaining({
        nodeId: "tool-read",
        reasons: [
          {
            code: "freshness_unknown",
            message:
              "File-producing tool candidates require verified comparable freshness evidence.",
          },
        ],
      }),
    ]);
  });

  it("blocks candidates with mixed success status", () => {
    const previous = graph("previous", [
      modelNode("model-answer", { fingerprintSeed: "answer", status: "error" }),
    ]);
    const current = graph("current", [
      modelNode("model-answer", { fingerprintSeed: "answer" }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).blockedCandidates,
    ).toEqual([
      expect.objectContaining({
        nodeId: "model-answer",
        reasons: [
          {
            code: "mixed_status",
            message:
              "Both observed nodes must have ok status before reuse review.",
          },
        ],
      }),
    ]);
  });

  it("blocks model candidates that lack required validator evidence", () => {
    const previous = graph("previous", [
      modelNode("model-answer", {
        fingerprintSeed: "answer",
        validatorsPassed: [],
        validatorsRequired: ["grounding"],
      }),
    ]);
    const current = graph("current", [
      modelNode("model-answer", {
        fingerprintSeed: "answer",
        validatorsPassed: [],
        validatorsRequired: ["grounding"],
      }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).blockedCandidates,
    ).toEqual([
      expect.objectContaining({
        nodeId: "model-answer",
        reasons: [
          {
            code: "validator_missing",
            message:
              "Model-call reuse requires every declared validator to have passed in both runs.",
          },
        ],
      }),
    ]);
  });

  it("blocks side-effecting tool candidates", () => {
    const previous = graph("previous", [
      toolNode("tool-write", {
        fingerprintSeed: "write-file",
        sideEffectClass: "non_idempotent_mutation",
      }),
    ]);
    const current = graph("current", [
      toolNode("tool-write", {
        fingerprintSeed: "write-file",
        sideEffectClass: "non_idempotent_mutation",
      }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).blockedCandidates,
    ).toEqual([
      expect.objectContaining({
        nodeId: "tool-write",
        reasons: [
          {
            code: "side_effecting_tool",
            message:
              "Non-idempotent mutation tool calls are not reusable without a stricter replay policy.",
          },
        ],
      }),
    ]);
  });

  it("reuses read-only tool candidates with explicit side-effect metadata", () => {
    const previous = graph("previous", [
      toolNode("tool-read", {
        fingerprintSeed: "read-state",
        sideEffectClass: "read_only",
      }),
    ]);
    const current = graph("current", [
      toolNode("tool-read", {
        fingerprintSeed: "read-state",
        sideEffectClass: "read_only",
      }),
    ]);

    const comparison = compareObservedExecutionGraphs(previous, current);

    expect(comparison.blockedCandidates).toEqual([]);
    expect(comparison.reusableToolCalls).toMatchObject([
      {
        nodeId: "tool-read",
        operationKind: "tool_call",
      },
    ]);
  });

  it("reuses approved idempotent mutation candidates with matching policy evidence", () => {
    const replaySafety = {
      approvalEvidenceRef: "approval:human-reviewed-charge-1",
      idempotencyKeyRef: "idempotency:charge-request-1",
      policyEvidenceRef: "policy:tool-replay-allowlist-1",
      sideEffectClass: "approval_required",
    };
    const previous = graph("previous", [
      toolNode("tool-charge", {
        fingerprintSeed: "charge-request",
        replaySafety,
      }),
    ]);
    const current = graph("current", [
      toolNode("tool-charge", {
        fingerprintSeed: "charge-request",
        replaySafety,
      }),
    ]);

    const comparison = compareObservedExecutionGraphs(previous, current);

    expect(comparison.blockedCandidates).toEqual([]);
    expect(comparison.reusableToolCalls).toMatchObject([
      {
        nodeId: "tool-charge",
        operationKind: "tool_call",
      },
    ]);
  });

  it("blocks unknown side-effect candidates", () => {
    const previous = graph("previous", [
      toolNode("tool-native-github", {
        fingerprintSeed: "github-mutation",
        sideEffectClass: "unknown",
      }),
    ]);
    const current = graph("current", [
      toolNode("tool-native-github", {
        fingerprintSeed: "github-mutation",
        sideEffectClass: "unknown",
      }),
    ]);

    expect(
      compareObservedExecutionGraphs(previous, current).blockedCandidates,
    ).toEqual([
      expect.objectContaining({
        nodeId: "tool-native-github",
        reasons: [
          {
            code: "side_effect_unknown",
            message:
              "Tool-call reuse requires known side-effect class metadata in both runs.",
          },
        ],
      }),
    ]);
  });
});

function graph(runId: string, nodes: readonly ExecutionNode[]): ExecutionGraph {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    edges: [],
    metadata: {
      reuse: {
        runtimeCompatibilityKey: "runtime:v0",
      },
    },
    nodes,
    runId,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "ok",
    version: EXECUTION_GRAPH_VERSION,
  };
}

function modelNode(
  id: string,
  options: {
    readonly dependencies?: ExecutionNode["dependencies"];
    readonly fingerprintSeed?: string;
    readonly latencyMs?: number;
    readonly status?: ExecutionNode["status"];
    readonly totalTokens?: number;
    readonly validatorsPassed?: readonly string[];
    readonly validatorsRequired?: readonly string[];
  },
): ExecutionNode {
  const validatorsRequired = options.validatorsRequired ?? ["grounding"];

  return node(id, "model_call", options.fingerprintSeed, {
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    ...(options.latencyMs === undefined
      ? {}
      : { latencyMs: options.latencyMs }),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.totalTokens === undefined
      ? {}
      : { totalTokens: options.totalTokens }),
    metadata: {
      reuse: {
        policyAllowed: true,
        validatorsPassed: options.validatorsPassed ?? validatorsRequired,
        validatorsRequired,
      },
    },
  });
}

function toolNode(
  id: string,
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
    readonly dependencies?: ExecutionNode["dependencies"];
    readonly fingerprintSeed?: string;
    readonly latencyMs?: number;
    readonly replaySafety?: Readonly<Record<string, string>>;
    readonly sideEffectClass?: string;
    readonly status?: ExecutionNode["status"];
    readonly totalTokens?: number;
  },
): ExecutionNode {
  return node(id, "tool_call", options.fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    ...(options.latencyMs === undefined
      ? {}
      : { latencyMs: options.latencyMs }),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.totalTokens === undefined
      ? {}
      : { totalTokens: options.totalTokens }),
    metadata: {
      reuse: {
        policyAllowed: true,
        ...(options.replaySafety ?? {
          sideEffectClass: options.sideEffectClass ?? "read_only",
        }),
      },
    },
  });
}

function node(
  id: string,
  operationKind: "model_call" | "tool_call",
  fingerprintSeed: string | undefined,
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
    readonly dependencies?: ExecutionNode["dependencies"];
    readonly latencyMs?: number;
    readonly metadata?: ExecutionNode["metadata"];
    readonly status?: ExecutionNode["status"];
    readonly totalTokens?: number;
  },
): ExecutionNode {
  return {
    artifacts: options.artifacts ?? [],
    dependencies: options.dependencies ?? [],
    ...(options.latencyMs === undefined
      ? {}
      : { durationMs: options.latencyMs }),
    endedAt: "2026-01-01T00:00:01.000Z",
    id,
    metadata: options.metadata ?? {},
    metrics: {
      costUsd: operationKind === "model_call" ? 0.025 : 0.01,
      ...(options.latencyMs === undefined
        ? {}
        : { latencyMs: options.latencyMs }),
      ...(options.totalTokens === undefined
        ? {}
        : { totalTokens: options.totalTokens }),
    },
    operation: {
      ...(fingerprintSeed === undefined
        ? {}
        : { fingerprint: stableExecutionHash({ fingerprintSeed }) }),
      id,
      kind: operationKind,
      name: id,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    status: options.status ?? "ok",
  };
}

function fileArtifact(
  id: string,
  fingerprintSeed: string,
  freshnessStatus: "unknown" | "verified",
): ExecutionNode["artifacts"][number] {
  return {
    fingerprint: stableExecutionHash({ fingerprintSeed }),
    id,
    kind: "file",
    metadata: {
      reuse: {
        freshnessStatus,
      },
      redaction: "raw file path omitted",
    },
  };
}
