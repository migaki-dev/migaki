import type { MIRPlan } from "@migaki/mir";
import {
  createMockExecutionBackend,
  type MockBackendFixture,
  type MockExecutionResult,
  type MockLoweredExecutionPlan,
  type MockValidatorOutcome,
} from "@migaki/providers";
import {
  EVIDENCE_EVENT_VERSION,
  captureMockExecutionTrace,
  createEvidenceBundle,
  diffMIRPlans,
  estimatePlanCosts,
  estimatePlanTokens,
  type EvidenceBundle,
  type EstimateEvidenceEvent,
  type MockExecutionTraceArtifact,
  type PlanCostEstimate,
  type PlanTokenEstimate,
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

export const RAG_BASELINE_FIXTURE_VERSION =
  "migaki.example.rag-baseline-fixture.v0";
export const RAG_BASELINE_RUN_ARTIFACT_VERSION =
  "migaki.example.rag-baseline-run.v0";

export interface RagDocumentChunk {
  readonly citation: string;
  readonly contentRef: string;
  readonly documentId: string;
  readonly duplicateOf?: string;
  readonly id: string;
  readonly text: string;
}

export interface RagDuplicateChunkGroup {
  readonly chunkIds: readonly string[];
  readonly reason: string;
}

export interface RagBaselineFixture {
  readonly answer: string;
  readonly chunks: readonly RagDocumentChunk[];
  readonly duplicateGroups: readonly RagDuplicateChunkGroup[];
  readonly question: string;
  readonly systemInstruction: string;
  readonly validation: string;
  readonly version: typeof RAG_BASELINE_FIXTURE_VERSION;
}

export interface RagBaselineReportData {
  readonly costEstimateUsd?: number;
  readonly duplicateChunkGroups: readonly (readonly string[])[];
  readonly evidenceBundleRef: string;
  readonly latencyMs?: number;
  readonly planId: string;
  readonly replayHandle: string;
  readonly tokenEstimate?: number;
  readonly traceId: string;
  readonly validatorResults: readonly MockValidatorOutcome[];
}

export interface RagBaselineRunOptions {
  readonly createdAt?: string;
  readonly runId?: string;
  readonly startedAt?: string;
}

export interface RagBaselineRunArtifact {
  readonly costEstimate: PlanCostEstimate;
  readonly evidenceBundle: EvidenceBundle;
  readonly fixture: RagBaselineFixture;
  readonly loweredPlan: MockLoweredExecutionPlan;
  readonly plan: MIRPlan;
  readonly reportData: RagBaselineReportData;
  readonly result: MockExecutionResult;
  readonly tokenEstimate: PlanTokenEstimate;
  readonly trace: MockExecutionTraceArtifact;
  readonly version: typeof RAG_BASELINE_RUN_ARTIFACT_VERSION;
}

const defaultRunId = "rag-baseline";
const defaultStartedAt = "2026-01-01T00:00:00.000Z";
const defaultCreatedAt = "2026-01-01T00:00:01.000Z";
const traceId = "trace-rag-baseline";
const evidenceBundleRef = "evidence://bundle/rag-baseline";
const replayHandle = `trace://${traceId}`;
const synthesisOutputTokens = 180;

const baselineFixture = {
  answer:
    "Migaki optimizes explicit execution graphs, keeps evidence for changes and costs, and preserves deterministic replay artifacts [migaki-guide#1] [migaki-guide#2].",
  chunks: [
    {
      citation: "migaki-guide#1",
      contentRef: "fixture://rag/chunks/plan",
      documentId: "migaki-guide",
      id: "chunk-plan",
      text: "Migaki represents agent work as explicit execution graphs.",
    },
    {
      citation: "migaki-guide#2",
      contentRef: "fixture://rag/chunks/evidence",
      documentId: "migaki-guide",
      id: "chunk-evidence",
      text: "Evidence records plan changes, assumptions, costs, validators, and replay handles.",
    },
    {
      citation: "migaki-guide#3",
      contentRef: "fixture://rag/chunks/evidence-copy",
      documentId: "migaki-guide",
      duplicateOf: "chunk-evidence",
      id: "chunk-evidence-copy",
      text: "Evidence records plan changes, assumptions, costs, validators, and replay handles.",
    },
    {
      citation: "migaki-guide#4",
      contentRef: "fixture://rag/chunks/cache",
      documentId: "migaki-guide",
      id: "chunk-cache",
      text: "Stable instructions can become cacheable prefixes when provider capabilities allow it.",
    },
    {
      citation: "migaki-guide#5",
      contentRef: "fixture://rag/chunks/replay",
      documentId: "migaki-guide",
      id: "chunk-replay",
      text: "Mock backends make baseline and optimized runs deterministic for replay.",
    },
  ],
  duplicateGroups: [
    {
      chunkIds: ["chunk-evidence", "chunk-evidence-copy"],
      reason: "Exact duplicate retrieved from overlapping document windows.",
    },
  ],
  question: "What does Migaki optimize in agent workflows?",
  systemInstruction: "Answer with cited chunks only. Keep reasoning concise.",
  validation: "passed: answer cites supported chunks.",
  version: RAG_BASELINE_FIXTURE_VERSION,
} as const satisfies RagBaselineFixture;

export function createRagBaselineFixture(): RagBaselineFixture {
  return baselineFixture;
}

export async function runRagBaseline(
  plan: MIRPlan,
  options: RagBaselineRunOptions = {},
): Promise<RagBaselineRunArtifact> {
  const runId = options.runId ?? defaultRunId;
  const startedAt = options.startedAt ?? defaultStartedAt;
  const createdAt = options.createdAt ?? defaultCreatedAt;
  const fixture = createRagBaselineFixture();
  const backendFixture = createMockFixture();
  const backend = createMockExecutionBackend({
    fixture: backendFixture,
    startedAt,
  });
  const loweredPlan = await backend.lower(plan);
  const result = await backend.execute(loweredPlan);
  const tokenEstimate = estimatePlanTokens(plan, {
    content: createContentLookup(fixture),
  });
  const costEstimate = estimatePlanCosts(plan, tokenEstimate, {
    asOf: "2026-01-01",
    modelSelections: [
      {
        model: "mock-default",
        nodeId: "node-synthesize",
        outputTokens: synthesisOutputTokens,
        provider: "mock",
      },
    ],
  });
  const trace = captureMockExecutionTrace({
    artifactId: "trace-artifact-rag-baseline",
    createdAt,
    ...(result.usage !== undefined ? { estimates: result.usage } : {}),
    evidenceBundleRef: {
      kind: "artifact",
      ref: evidenceBundleRef,
    },
    fixture: backendFixture,
    loweredPlan,
    plan,
    redactions: [
      {
        mode: "omitted",
        path: "$.responses[*].metadata.rawText",
        reason: "Baseline trace keeps fixture content out of replay metadata.",
      },
    ],
    result,
    traceId,
  });
  const evidenceBundle = createEvidenceBundle({
    createdAt,
    events: createBaselineEvidenceEvents({
      costEstimate,
      result,
      runId,
      tokenEstimate,
    }),
    exportMode: "metadata_only",
    optimizedPlan: {
      planId: plan.id,
      ref: "mir://examples/rag-baseline",
      version: plan.version,
    },
    originalPlan: {
      planId: plan.id,
      ref: "mir://examples/rag-baseline",
      version: plan.version,
    },
    passes: [],
    planDiff: diffMIRPlans(plan, plan),
    replay: {
      handles: [
        {
          kind: "trace",
          ref: replayHandle,
        },
      ],
      mode: "metadata",
    },
    runId,
    warnings: [],
  });

  return {
    costEstimate,
    evidenceBundle,
    fixture,
    loweredPlan,
    plan,
    reportData: createReportData({
      costEstimate,
      fixture,
      plan,
      result,
      tokenEstimate,
    }),
    result,
    tokenEstimate,
    trace,
    version: RAG_BASELINE_RUN_ARTIFACT_VERSION,
  };
}

function createMockFixture(): MockBackendFixture {
  return {
    responses: [
      {
        contextId: "ctx-retrieved",
        nodeId: "node-retrieve",
        outputRef: "fixture://rag/retrieved-chunks/raw",
        usage: {
          inputTokens: 24,
          latencyMs: 10,
          outputTokens: 1200,
        },
      },
      {
        contextId: "ctx-answer",
        nodeId: "node-synthesize",
        outputRef: "fixture://rag/answer/baseline",
        usage: {
          costUsd: 0,
          inputTokens: 1256,
          latencyMs: 25,
          outputTokens: synthesisOutputTokens,
        },
      },
      {
        contextId: "ctx-validation",
        nodeId: "node-validate",
        outputRef: "fixture://rag/validation/baseline",
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
}

function createContentLookup(
  fixture: RagBaselineFixture,
): Readonly<Record<string, string>> {
  return {
    "fixture://rag/answer/baseline": fixture.answer,
    "fixture://rag/question": fixture.question,
    "fixture://rag/retrieved-chunks/raw": formatRetrievedChunks(fixture),
    "fixture://rag/system": fixture.systemInstruction,
    "fixture://rag/validation/baseline": fixture.validation,
  };
}

function formatRetrievedChunks(fixture: RagBaselineFixture): string {
  return fixture.chunks
    .map((chunk) => `[${chunk.citation}] ${chunk.text}`)
    .join("\n");
}

function createBaselineEvidenceEvents(input: {
  readonly costEstimate: PlanCostEstimate;
  readonly result: MockExecutionResult;
  readonly runId: string;
  readonly tokenEstimate: PlanTokenEstimate;
}): readonly (EstimateEvidenceEvent | ValidatorResultEvidenceEvent)[] {
  return [
    createEstimateEvent({
      estimateKind: "token",
      id: "baseline-token-estimate",
      runId: input.runId,
      subjectRef: input.tokenEstimate.subjectRef,
      summary: "Estimated total baseline fixture tokens.",
      unit: "tokens",
      ...(input.tokenEstimate.tokens !== undefined
        ? { value: input.tokenEstimate.tokens }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "cost",
      id: "baseline-cost-estimate",
      runId: input.runId,
      subjectRef: input.costEstimate.subjectRef,
      summary: "Estimated baseline mock execution cost.",
      unit: "usd",
      ...(input.costEstimate.costUsd !== undefined
        ? { value: input.costEstimate.costUsd }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "latency",
      id: "baseline-latency-estimate",
      runId: input.runId,
      subjectRef: replayHandle,
      summary: "Measured deterministic mock baseline latency.",
      unit: "milliseconds",
      ...(input.result.usage?.latencyMs !== undefined
        ? { value: input.result.usage.latencyMs }
        : {}),
    }),
    ...input.result.validatorResults.map((result, index) =>
      createValidatorEvent({
        index,
        result,
        runId: input.runId,
      }),
    ),
  ];
}

function createEstimateEvent(input: {
  readonly estimateKind: EstimateEvidenceEvent["estimate"]["estimateKind"];
  readonly id: string;
  readonly runId: string;
  readonly subjectRef: string;
  readonly summary: string;
  readonly unit: EstimateEvidenceEvent["estimate"]["unit"];
  readonly value?: number;
}): EstimateEvidenceEvent {
  return {
    estimate: {
      confidence: input.value === undefined ? "unknown" : "estimated",
      estimateKind: input.estimateKind,
      subjectRef: input.subjectRef,
      unit: input.unit,
      ...(input.value !== undefined ? { value: input.value } : {}),
    },
    id: input.id,
    kind: "estimate",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "runtime",
      runId: input.runId,
    },
    summary: input.summary,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createValidatorEvent(input: {
  readonly index: number;
  readonly result: MockValidatorOutcome;
  readonly runId: string;
}): ValidatorResultEvidenceEvent {
  return {
    id: `baseline-validator-${String(input.index + 1).padStart(3, "0")}`,
    kind: "validator_result",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "validator",
      runId: input.runId,
    },
    summary: "Recorded deterministic baseline validator result.",
    validatorResult: {
      status: input.result.status,
      ...(input.result.score !== undefined
        ? { score: input.result.score }
        : {}),
      ...(input.result.targetRef !== undefined
        ? { targetRef: input.result.targetRef }
        : {}),
      validatorId: input.result.validatorId,
    },
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createReportData(input: {
  readonly costEstimate: PlanCostEstimate;
  readonly fixture: RagBaselineFixture;
  readonly plan: MIRPlan;
  readonly result: MockExecutionResult;
  readonly tokenEstimate: PlanTokenEstimate;
}): RagBaselineReportData {
  return {
    duplicateChunkGroups: input.fixture.duplicateGroups.map(
      (group) => group.chunkIds,
    ),
    evidenceBundleRef,
    planId: input.plan.id,
    replayHandle,
    traceId,
    validatorResults: input.result.validatorResults,
    ...(input.costEstimate.costUsd !== undefined
      ? { costEstimateUsd: input.costEstimate.costUsd }
      : {}),
    ...(input.result.usage?.latencyMs !== undefined
      ? { latencyMs: input.result.usage.latencyMs }
      : {}),
    ...(input.tokenEstimate.tokens !== undefined
      ? { tokenEstimate: input.tokenEstimate.tokens }
      : {}),
  };
}
