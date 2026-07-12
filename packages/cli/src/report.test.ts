import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";
import {
  EVIDENCE_EVENT_VERSION,
  CONTROLLED_REUSE_EXECUTION_VERSION,
  PASS_CONTRACT_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  createEvidenceBundle,
  diffMIRPlans,
  serializeEvidenceBundle,
  serializeMockExecutionTraceArtifact,
  type EvidenceEvent,
  type ControlledReuseExecutionEvidence,
  type MockExecutionTraceArtifact,
  type PassWarning,
  type ReuseDecisionArtifact,
} from "@migaki/runtime";

import { CLI_REPORT_VERSION, runCli } from "./index.js";

const passIdentity = {
  name: "test.pass",
  version: "0.0.0",
};

const warning: PassWarning = {
  code: "assumption_recorded",
  message: "A runtime assumption was recorded.",
  path: "$.nodes[0]",
  severity: "warning",
};

describe("report command", () => {
  it("renders realized controlled-reuse and invalidation evidence as golden human and JSON reports", async () => {
    const reused = createControlledReuseEvidence("reuse");
    const invalidated = createControlledReuseEvidence("execute_normally");

    const jsonResult = await runCli(
      ["report", "--input", "reuse.json", "--format", "json"],
      fakeIo({ "reuse.json": JSON.stringify(reused) }),
    );
    const humanResult = await runCli(
      ["report", "--input", "invalidated.json", "--format", "human"],
      fakeIo({ "invalidated.json": JSON.stringify(invalidated) }),
    );

    expect(JSON.parse(jsonResult.stdout)).toEqual({
      artifactKind: "controlled_reuse_execution",
      decisionRef: {
        currentRunId: "current-run",
        nodeId: "tool-read",
        previousRunId: "previous-run",
        version: REUSE_DECISION_ARTIFACT_VERSION,
      },
      estimates: { classification: "estimated", totalTokens: 120 },
      eligibilityChecks: [
        { name: "decision_status", status: "passed" },
        { name: "exact_match", status: "passed" },
        { name: "operation_kind", status: "passed" },
        { name: "side_effect_class", status: "passed" },
        { name: "source_equivalence", status: "passed" },
        { name: "freshness", status: "passed" },
        { name: "dependencies", status: "passed" },
        { name: "policy", status: "passed" },
      ],
      executionOutcome: "reused",
      identity: { nodeId: "tool-read", previousNodeId: "previous-tool-read" },
      planExecutionDiff: {
        changed: false,
        executedAction: "reuse",
        plannedAction: "reuse",
      },
      policyRef: {
        authorizationVersion: "migaki.controlled-reuse-authorization.v0",
        mode: "exact_read_only_tool_call",
        plannerVersion: "migaki.controlled-reuse-plan.v0",
      },
      realized: {
        actualSkippedActions: 1,
        invalidations: 0,
        normalExecutions: 0,
        plannedReuse: 1,
        potentialReuse: 1,
      },
      reasons: [],
      store: { outcome: "hit", version: "migaki.reuse-value-store.v0" },
      validators: [
        { id: "source-exact", status: "passed" },
        { id: "behavior_equivalence", status: "passed" },
      ],
      version: CLI_REPORT_VERSION,
    });
    expect(humanResult.stdout).toMatchInlineSnapshot(`
      "Migaki Controlled Reuse Report
      Node: previous-tool-read -> tool-read
      Plan/execution: reuse -> execute_normally (changed)
      Potential/planned: 1/1
      Realized: 0 skipped, 1 normal, 1 invalidated
      Estimated avoidable work: 120 tokens (not realized)
      Store: invalidated (migaki.reuse-value-store.v0)
      Eligibility: decision_status passed; exact_match passed; operation_kind passed; side_effect_class passed; source_equivalence passed; freshness passed; dependencies passed; policy passed
      Validators: source-exact passed; behavior_equivalence failed
      Reasons: behavior_equivalence_failed
      "
    `);
  });

  it("renders evidence bundles as deterministic JSON", async () => {
    const bundle = createReportBundle();
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "json"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "evidence_bundle",
      costEstimates: [
        {
          subjectRef: "$.nodes[0]",
          unit: "usd",
          value: 0.01,
        },
      ],
      passCount: 1,
      passes: [
        {
          enabled: true,
          name: "test.pass",
          version: "0.0.0",
        },
      ],
      planDiffChangeCount: 1,
      plans: {
        optimized: "plan-after",
        original: "plan-before",
      },
      replay: {
        handles: ["trace://bundle-run"],
        mode: "metadata",
      },
      reportWarnings: [],
      routingDecisions: [
        {
          nodeId: "node-rank",
          reason: "Ranking can use the mock backend.",
          target: "mock/mock-ranker",
        },
      ],
      runId: "bundle-run",
      tokenEstimates: [
        {
          subjectRef: "$.nodes[0]",
          unit: "tokens",
          value: 42,
        },
      ],
      validatorResults: [
        {
          status: "passed",
          validatorId: "source-grounding",
        },
      ],
      version: CLI_REPORT_VERSION,
      warnings: [
        {
          code: "assumption_recorded",
          message: "A runtime assumption was recorded.",
          severity: "warning",
        },
      ],
    });
  });

  it("renders human-readable reports with obvious warnings and replay metadata", async () => {
    const bundle = createReportBundle();
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "human"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "Migaki Report",
        "Artifact: evidence_bundle",
        "Run: bundle-run",
        "Plans: plan-before -> plan-after",
        "Plan diff: 1 change",
        "Passes:",
        "- test.pass@0.0.0 enabled",
        "Warnings:",
        "- [warning] assumption_recorded: A runtime assumption was recorded.",
        "Estimates:",
        "- token $.nodes[0]: 42 tokens",
        "- cost $.nodes[0]: 0.01 usd",
        "Routing:",
        "- node-rank -> mock/mock-ranker: Ranking can use the mock backend.",
        "Validators:",
        "- source-grounding: passed",
        "Replay: metadata trace://bundle-run",
        "Report warnings: none",
        "",
      ].join("\n"),
    });
  });

  it("warns explicitly when optional evidence sections are missing", async () => {
    const bundle = createEvidenceBundle({
      createdAt: "2026-01-01T00:00:00.000Z",
      events: [],
      optimizedPlan: {
        planId: "plan-after",
        version: MIR_V0_VERSION,
      },
      originalPlan: {
        planId: "plan-before",
        version: MIR_V0_VERSION,
      },
      passes: [],
      planDiff: diffMIRPlans(
        createPlan("plan-before"),
        createPlan("plan-after"),
      ),
      replay: {
        handles: [],
        mode: "metadata",
      },
      runId: "bundle-run",
      warnings: [],
    });
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "json"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(JSON.parse(result.stdout).reportWarnings).toEqual([
      "Missing token estimates.",
      "Missing cost estimates.",
      "Missing routing decisions.",
      "Missing validator results.",
      "Missing replay handles.",
    ]);
  });

  it("renders mock trace run artifacts as JSON", async () => {
    const trace = createTraceArtifact();
    const result = await runCli(
      ["report", "--input", "trace.json", "--format", "json"],
      fakeIo({
        "trace.json": serializeMockExecutionTraceArtifact(trace),
      }),
    );

    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "mock_trace",
      backend: "mock",
      evidenceBundleRef: "evidence://bundle/rag-baseline",
      planId: "rag-baseline",
      reportWarnings: [],
      resultStatus: "succeeded",
      stepCount: 1,
      timing: {
        durationMs: 5,
      },
      traceId: "trace-rag-baseline",
      validatorResults: [
        {
          status: "passed",
          validatorId: "source-grounding",
        },
      ],
      version: CLI_REPORT_VERSION,
    });
  });

  it("renders reuse decision artifacts in human and JSON formats", async () => {
    const artifact = createReuseDecisionArtifact();
    const jsonResult = await runCli(
      ["report", "--input", "reuse-decision.json", "--format", "json"],
      fakeIo({
        "reuse-decision.json": JSON.stringify(artifact),
      }),
    );
    const humanResult = await runCli(
      ["report", "--input", "reuse-decision.json", "--format", "human"],
      fakeIo({
        "reuse-decision.json": JSON.stringify(artifact),
      }),
    );

    expect(jsonResult.exitCode).toBe(0);
    expect(JSON.parse(jsonResult.stdout)).toEqual({
      allowed: 1,
      artifactKind: "reuse_decision",
      blocked: 1,
      comparison: {
        currentRunId: "current",
        previousRunId: "previous",
      },
      decisions: [
        {
          nodeId: "tool-read",
          operationKind: "tool_call",
          reasons: [],
          status: "allowed",
        },
        {
          nodeId: "model-answer",
          operationKind: "model_call",
          reasons: ["model_reuse_needs_review"],
          status: "needs_review",
        },
        {
          nodeId: "tool-write",
          operationKind: "tool_call",
          reasons: ["side_effecting_tool"],
          status: "blocked",
        },
      ],
      needsReview: 1,
      version: CLI_REPORT_VERSION,
    });
    expect(humanResult).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(humanResult.stdout).toContain("Migaki Reuse Decision");
    expect(humanResult.stdout).toContain(
      "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    );
  });
});

function createControlledReuseEvidence(
  action: "execute_normally" | "reuse",
): ControlledReuseExecutionEvidence {
  const reused = action === "reuse";
  return {
    action,
    actualSkippedActions: reused ? 1 : 0,
    decisionRef: {
      currentRunId: "current-run",
      nodeId: "tool-read",
      previousRunId: "previous-run",
      version: REUSE_DECISION_ARTIFACT_VERSION,
    },
    eligibilityChecks: [
      { name: "decision_status", status: "passed" },
      { name: "exact_match", status: "passed" },
      { name: "operation_kind", status: "passed" },
      { name: "side_effect_class", status: "passed" },
      { name: "source_equivalence", status: "passed" },
      { name: "freshness", status: "passed" },
      { name: "dependencies", status: "passed" },
      { name: "policy", status: "passed" },
    ],
    estimatedAvoidableWork: { classification: "estimated", totalTokens: 120 },
    executionOutcome: reused ? "reused" : "executed_normally",
    invalidation: {
      count: reused ? 0 : 1,
      reasonCodes: reused ? [] : ["behavior_equivalence_failed"],
    },
    nodeId: "tool-read",
    planExecutionDiff: {
      changed: !reused,
      executedAction: action,
      plannedAction: "reuse",
    },
    policyRef: {
      authorizationVersion: "migaki.controlled-reuse-authorization.v0",
      mode: "exact_read_only_tool_call",
      plannerVersion: "migaki.controlled-reuse-plan.v0",
    },
    previousNodeId: "previous-tool-read",
    privacyPolicy: {
      exportMode: "metadata_only",
      omittedFields: [
        "prompt",
        "tool_input",
        "tool_output",
        "provider_response",
        "credential",
        "local_machine_path",
        "reusable_value",
      ],
      version: "migaki.evidence-privacy-policy.v0",
    },
    realizedMetrics: {
      actualSkippedActions: reused ? 1 : 0,
      invalidations: reused ? 0 : 1,
      normalExecutions: reused ? 0 : 1,
      plannedReuse: 1,
      potentialReuse: 1,
    },
    reasonCodes: reused ? [] : ["behavior_equivalence_failed"],
    storeRef: {
      outcome: reused ? "hit" : "invalidated",
      version: "migaki.reuse-value-store.v0",
    },
    validatorOutcomes: [
      { id: "source-exact", status: "passed" },
      { id: "behavior_equivalence", status: reused ? "passed" : "failed" },
    ],
    version: CONTROLLED_REUSE_EXECUTION_VERSION,
  };
}

function fakeIo(files: Readonly<Record<string, string>>): {
  readonly readFile: (path: string) => Promise<string>;
} {
  return {
    async readFile(path: string): Promise<string> {
      const file = files[path];

      if (file === undefined) {
        throw new Error(`Missing test file ${path}.`);
      }

      return file;
    },
  };
}

function createReportBundle(): ReturnType<typeof createEvidenceBundle> {
  const before = createPlan("plan-before");
  const after = {
    ...createPlan("plan-after"),
    context: [
      {
        contentRef: "fixture://ctx-a",
        id: "ctx-a",
        mutability: "fixed",
        provenance: {
          source: "user",
        },
        role: "user_input",
      },
    ],
  } satisfies MIRPlan;

  return createEvidenceBundle({
    createdAt: "2026-01-01T00:00:00.000Z",
    events: [
      createEvent("token-estimate", "estimate", {
        estimate: {
          confidence: "estimated",
          estimateKind: "token",
          subjectRef: "$.nodes[0]",
          unit: "tokens",
          value: 42,
        },
      }),
      createEvent("cost-estimate", "estimate", {
        estimate: {
          confidence: "estimated",
          estimateKind: "cost",
          subjectRef: "$.nodes[0]",
          unit: "usd",
          value: 0.01,
        },
      }),
      createEvent("routing", "routing_decision", {
        routingDecision: {
          nodeId: "node-rank",
          reason: "Ranking can use the mock backend.",
          target: "mock/mock-ranker",
        },
      }),
      createEvent("validator", "validator_result", {
        validatorResult: {
          status: "passed",
          validatorId: "source-grounding",
        },
      }),
    ],
    optimizedPlan: {
      planId: after.id,
      version: after.version,
    },
    originalPlan: {
      planId: before.id,
      version: before.version,
    },
    passes: [
      {
        contractVersion: PASS_CONTRACT_VERSION,
        enabled: true,
        name: passIdentity.name,
        version: passIdentity.version,
      },
    ],
    planDiff: diffMIRPlans(before, after),
    replay: {
      handles: [
        {
          kind: "trace",
          ref: "trace://bundle-run",
        },
      ],
      mode: "metadata",
    },
    runId: "bundle-run",
    warnings: [warning],
  });
}

function createReuseDecisionArtifact(): ReuseDecisionArtifact {
  return {
    comparisonRef: {
      currentRunId: "current",
      previousRunId: "previous",
      version: "migaki.observed-trajectory-comparison.v0",
    },
    createdAt: "2026-01-01T00:00:02.000Z",
    decisions: [
      {
        cacheKey: "hash:read",
        dependencyEvidence: {
          message: "Dependencies match.",
          status: "passed",
        },
        estimates: {
          latencyMs: 10,
        },
        freshnessEvidence: {
          message: "Freshness verified.",
          status: "passed",
        },
        nodeId: "tool-read",
        operationKind: "tool_call",
        policyConstraints: {
          message: "Policy allowed.",
          status: "passed",
        },
        previousNodeId: "tool-read",
        reasons: [],
        requiredValidators: [],
        sideEffectClass: "read_only",
        status: "allowed",
      },
      {
        cacheKey: "hash:model",
        dependencyEvidence: {
          message: "Dependencies match.",
          status: "passed",
        },
        estimates: {},
        freshnessEvidence: {
          message: "No file artifacts.",
          status: "passed",
        },
        nodeId: "model-answer",
        operationKind: "model_call",
        policyConstraints: {
          message: "Policy allowed.",
          status: "passed",
        },
        previousNodeId: "model-answer",
        reasons: [
          {
            code: "model_reuse_needs_review",
            message: "Model determinism needs review.",
          },
        ],
        requiredValidators: ["grounding"],
        status: "needs_review",
      },
      {
        cacheKey: "hash:write",
        dependencyEvidence: {
          message: "Dependencies match.",
          status: "passed",
        },
        estimates: {},
        freshnessEvidence: {
          message: "No file artifacts.",
          status: "passed",
        },
        nodeId: "tool-write",
        operationKind: "tool_call",
        policyConstraints: {
          message: "Policy allowed.",
          status: "passed",
        },
        previousNodeId: "tool-write",
        reasons: [
          {
            code: "side_effecting_tool",
            message: "Mutation is not reusable.",
          },
        ],
        requiredValidators: [],
        sideEffectClass: "non_idempotent_mutation",
        status: "blocked",
      },
    ],
    invariant:
      "Evidence first, then explicit decision, then replay only in a future issue. This artifact never skips work.",
    privacyPolicy: {
      exportMatrixVersion: "migaki.evidence-privacy-policy.v0",
      exportMode: "metadata_only",
      fullTraceOptIn: false,
    },
    redaction: {
      mode: "metadata_only",
      omittedFields: [
        "prompt",
        "tool_input",
        "tool_output",
        "provider_response",
        "file_path",
        "customer_data",
        "credential",
        "local_machine_path",
      ],
      reason: "Raw sensitive values are omitted.",
    },
    summary: {
      allowed: 1,
      blocked: 1,
      needsReview: 1,
      totalCandidates: 3,
    },
    version: REUSE_DECISION_ARTIFACT_VERSION,
  };
}

function createPlan(id: string): MIRPlan {
  return {
    id,
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [],
    nodes: [],
    edges: [],
  };
}

function createTraceArtifact(): MockExecutionTraceArtifact {
  return {
    artifactId: "trace-artifact-rag-baseline",
    backend: {
      contractVersion: "migaki.providers.v0",
      id: "mock-backend",
      kind: "mock",
      mockBackendVersion: "migaki.mock-backend.v0",
      provider: "mock",
    },
    createdAt: "2026-01-01T00:00:01.000Z",
    evidenceBundleRef: {
      kind: "artifact",
      ref: "evidence://bundle/rag-baseline",
    },
    plan: {
      planId: "rag-baseline",
      version: MIR_V0_VERSION,
    },
    redactions: [],
    responses: [],
    result: {
      loweredPlanId: "mock-lowered-rag-baseline",
      outputs: [],
      status: "succeeded",
      version: "migaki.providers.v0",
      warnings: [],
    },
    steps: [
      {
        completedAt: "2026-01-01T00:00:00.005Z",
        id: "mock-step-001-node-validate",
        kind: "validator",
        nodeId: "node-validate",
        requestRef: "mock://requests/node-validate",
        sourceNodeId: "node-validate",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "succeeded",
      },
    ],
    timing: {
      durationMs: 5,
    },
    traceId: "trace-rag-baseline",
    validatorResults: [
      {
        status: "passed",
        validatorId: "source-grounding",
      },
    ],
    version: "migaki.trace-artifact.v0",
  };
}

function createEvent<TKind extends EvidenceEvent["kind"]>(
  id: string,
  kind: TKind,
  detail: Omit<
    Extract<EvidenceEvent, { kind: TKind }>,
    "id" | "kind" | "privacy" | "redaction" | "source" | "summary" | "version"
  >,
): Extract<EvidenceEvent, { kind: TKind }> {
  return {
    id,
    kind,
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
      runId: "bundle-run",
    },
    summary: `Evidence event ${id}.`,
    version: EVIDENCE_EVENT_VERSION,
    ...detail,
  } as Extract<EvidenceEvent, { kind: TKind }>;
}
