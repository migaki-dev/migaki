import type { MIRContextBlock, MIREdge, MIRNode, MIRPlan } from "@migaki/mir";
import {
  createMockExecutionBackend,
  lookupProviderCapabilities,
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
  exactDuplicateContextEliminationPass,
  promptCacheLayoutReportingPass,
  retryFallbackPlanningPass,
  runOptimizationPasses,
  stablePrefixDetectionPass,
  staticRoutingPolicyPass,
  type EvidenceBundle,
  type EvidenceBundlePassSummary,
  type EstimateEvidenceEvent,
  type MockExecutionTraceArtifact,
  type PassRunReport,
  type PlanCostEstimate,
  type PlanTokenEstimate,
  type RetryFallbackDecisionEvidenceEvent,
  type RoutingDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

import {
  createRagBaselineFixture,
  type RagBaselineFixture,
} from "./baseline.js";

export const RAG_OPTIMIZED_RUN_ARTIFACT_VERSION =
  "migaki.example.rag-optimized-run.v0";

export interface RagOptimizedRoutingDecision {
  readonly nodeId: string;
  readonly target: string;
}

export interface RagOptimizedRetryDecision {
  readonly decision: RetryFallbackDecisionEvidenceEvent["retryFallbackDecision"]["decision"];
  readonly nodeId: string;
  readonly scope: RetryFallbackDecisionEvidenceEvent["retryFallbackDecision"]["scope"];
}

export interface RagOptimizedReportData {
  readonly costEstimateUsd?: number;
  readonly duplicateContextRemoved: readonly string[];
  readonly evidenceBundleRef: string;
  readonly latencyMs?: number;
  readonly passNames: readonly string[];
  readonly planDiffChangeCount: number;
  readonly planId: string;
  readonly replayHandle: string;
  readonly retryDecisions: readonly RagOptimizedRetryDecision[];
  readonly routingDecisions: readonly RagOptimizedRoutingDecision[];
  readonly tokenEstimate?: number;
  readonly traceId: string;
  readonly validatorResults: readonly MockValidatorOutcome[];
  readonly warningCodes: readonly string[];
}

export interface RagOptimizedRunOptions {
  readonly createdAt?: string;
  readonly runId?: string;
  readonly startedAt?: string;
}

export interface RagOptimizedRunArtifact {
  readonly costEstimate: PlanCostEstimate;
  readonly evidenceBundle: EvidenceBundle;
  readonly fixture: RagBaselineFixture;
  readonly loweredPlan: MockLoweredExecutionPlan;
  readonly optimizationInputPlan: MIRPlan;
  readonly optimizedPlan: MIRPlan;
  readonly passReport: PassRunReport;
  readonly reportData: RagOptimizedReportData;
  readonly result: MockExecutionResult;
  readonly tokenEstimate: PlanTokenEstimate;
  readonly trace: MockExecutionTraceArtifact;
  readonly version: typeof RAG_OPTIMIZED_RUN_ARTIFACT_VERSION;
}

const defaultRunId = "rag-optimized";
const defaultStartedAt = "2026-01-01T00:00:00.000Z";
const defaultCreatedAt = "2026-01-01T00:00:01.000Z";
const traceId = "trace-rag-optimized";
const evidenceBundleRef = "evidence://bundle/rag-optimized";
const replayHandle = `trace://${traceId}`;
const rankOutputTokens = 96;
const synthesisOutputTokens = 180;

export async function runRagOptimized(
  baselinePlan: MIRPlan,
  options: RagOptimizedRunOptions = {},
): Promise<RagOptimizedRunArtifact> {
  const runId = options.runId ?? defaultRunId;
  const startedAt = options.startedAt ?? defaultStartedAt;
  const createdAt = options.createdAt ?? defaultCreatedAt;
  const fixture = createRagBaselineFixture();
  const optimizationInputPlan = createOptimizationInputPlan(
    baselinePlan,
    fixture,
  );
  const passReport = await runOptimizationPasses(
    optimizationInputPlan,
    [
      exactDuplicateContextEliminationPass,
      stablePrefixDetectionPass,
      promptCacheLayoutReportingPass,
      staticRoutingPolicyPass,
      retryFallbackPlanningPass,
    ],
    {
      clock: {
        now: () => Date.UTC(2026, 0, 1),
      },
      failurePolicy: "stop",
      providerCapabilities: [requireProviderCapabilities("mock")],
      runId,
    },
  );
  const optimizedPlan = passReport.plan;
  const backendFixture = createOptimizedMockFixture();
  const backend = createMockExecutionBackend({
    fixture: backendFixture,
    startedAt,
  });
  const loweredPlan = await backend.lower(optimizedPlan);
  const result = await backend.execute(loweredPlan);
  const tokenEstimate = estimatePlanTokens(optimizedPlan, {
    content: createOptimizedContentLookup(fixture),
  });
  const costEstimate = estimatePlanCosts(optimizedPlan, tokenEstimate, {
    asOf: "2026-01-01",
    modelSelections: [
      {
        model: "mock-default",
        nodeId: "node-rank",
        outputTokens: rankOutputTokens,
        provider: "mock",
      },
      {
        model: "mock-default",
        nodeId: "node-synthesize",
        outputTokens: synthesisOutputTokens,
        provider: "mock",
      },
    ],
  });
  const trace = captureMockExecutionTrace({
    artifactId: "trace-artifact-rag-optimized",
    createdAt,
    ...(result.usage !== undefined ? { estimates: result.usage } : {}),
    evidenceBundleRef: {
      kind: "artifact",
      ref: evidenceBundleRef,
    },
    fixture: backendFixture,
    loweredPlan,
    plan: optimizedPlan,
    redactions: [
      {
        mode: "omitted",
        path: "$.responses[*].metadata.rawText",
        reason: "Optimized trace keeps fixture content out of replay metadata.",
      },
    ],
    result,
    traceId,
  });
  const planDiff = diffMIRPlans(optimizationInputPlan, optimizedPlan, {
    afterWarnings: passReport.warnings,
  });
  const evidenceBundle = createEvidenceBundle({
    createdAt,
    events: [
      ...passReport.evidence,
      ...createOptimizedRuntimeEvidence({
        costEstimate,
        result,
        runId,
        tokenEstimate,
      }),
    ],
    exportMode: "metadata_only",
    optimizedPlan: {
      planId: optimizedPlan.id,
      ref: "mir://examples/rag-optimized",
      version: optimizedPlan.version,
    },
    originalPlan: {
      planId: optimizationInputPlan.id,
      ref: "mir://examples/rag-optimized/input",
      version: optimizationInputPlan.version,
    },
    passes: passReport.passes.map(toEvidencePassSummary),
    planDiff,
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
    warnings: passReport.warnings,
  });

  return {
    costEstimate,
    evidenceBundle,
    fixture,
    loweredPlan,
    optimizationInputPlan,
    optimizedPlan,
    passReport,
    reportData: createReportData({
      costEstimate,
      evidenceBundle,
      passReport,
      planDiffChangeCount: planDiff.changes.length,
      result,
      tokenEstimate,
    }),
    result,
    tokenEstimate,
    trace,
    version: RAG_OPTIMIZED_RUN_ARTIFACT_VERSION,
  };
}

function createOptimizationInputPlan(
  baselinePlan: MIRPlan,
  fixture: RagBaselineFixture,
): MIRPlan {
  const chunkContextIds = fixture.chunks.map((chunk) =>
    contextIdForChunk(chunk.id),
  );

  return {
    constraints: {
      ...baselinePlan.constraints,
      allowedProviders: ["mock"],
      cachePolicy: {
        mode: "eligible",
        scope: "plan",
      },
      requiredValidators: ["validator-source-grounding"],
      retentionPolicy: {
        mode: "metadata_only",
        reason: "Optimized fixture should retain only replay metadata.",
      },
    },
    context: [
      createSystemContext(baselinePlan),
      requireContext(baselinePlan, "ctx-question"),
      ...fixture.chunks.map((chunk) => createChunkContext(chunk, fixture)),
      {
        cachePolicy: {
          keyRef: "cache://rag/stable-prefix",
          mode: "eligible",
          scope: "plan",
        },
        contentRef: "fixture://rag/ranked-chunks",
        id: "ctx-ranked",
        mutability: "droppable",
        privacyClass: "internal",
        provenance: {
          nodeId: "node-rank",
          source: "generated",
        },
        role: "scratchpad",
        tokenEstimate: 48,
      },
      {
        contentRef: "fixture://rag/answer/optimized",
        id: "ctx-answer",
        mutability: "fixed",
        privacyClass: "internal",
        provenance: {
          nodeId: "node-synthesize",
          source: "generated",
        },
        role: "validator_output",
        tokenEstimate: 180,
      },
      {
        contentRef: "fixture://rag/validation/optimized",
        id: "ctx-validation",
        mutability: "fixed",
        privacyClass: "internal",
        provenance: {
          nodeId: "node-validate",
          source: "validator",
        },
        role: "validator_output",
      },
    ],
    edges: createOptimizedEdges(chunkContextIds),
    id: "rag-optimized",
    metadata: {
      ...baselinePlan.metadata,
      description:
        "Optimized RAG plan using safe v0 duplicate, cache, routing, and retry evidence.",
      tags: ["example", "rag", "optimized"],
      traceId,
    },
    nodes: createOptimizedNodes(chunkContextIds),
    version: baselinePlan.version,
  };
}

function createSystemContext(plan: MIRPlan): MIRContextBlock {
  const context = requireContext(plan, "ctx-system");

  return {
    ...context,
    cachePolicy: {
      keyRef: "cache://rag/stable-prefix",
      mode: "eligible",
      scope: "plan",
    },
  };
}

function createChunkContext(
  chunk: RagBaselineFixture["chunks"][number],
  fixture: RagBaselineFixture,
): MIRContextBlock {
  const duplicateCanonical = fixture.duplicateGroups
    .find((group) => group.chunkIds.includes(chunk.id))
    ?.chunkIds.at(0);

  return {
    contentHash: `sha256:${duplicateCanonical ?? chunk.id}`,
    contentRef: chunk.contentRef,
    id: contextIdForChunk(chunk.id),
    mutability: "deduplicable",
    privacyClass: "internal",
    provenance: {
      source: "retrieval",
      sourceRef: chunk.citation,
    },
    role: "retrieved_document",
    tokenEstimate: estimateFixtureTokens(chunk.text),
  };
}

function createOptimizedNodes(
  chunkContextIds: readonly string[],
): readonly MIRNode[] {
  return [
    {
      id: "node-retrieve",
      kind: "retrieval_call",
      queryContext: "ctx-question",
      resultContext: chunkContextIds[0] ?? "ctx-question",
      retrieval: {
        source: "docs",
        topK: 20,
      },
    },
    {
      id: "node-rank",
      inputContext: ["ctx-question", ...chunkContextIds],
      kind: "model_call",
      metadata: {
        staticRouting: {
          candidates: [
            {
              model: "mock-ranker",
              provider: "mock",
            },
          ],
          requiredValidators: ["validator-source-grounding"],
        },
      },
      model: {
        requiredCapabilities: ["structured_output"],
        task: "ranking",
      },
      outputContext: "ctx-ranked",
      parameters: {
        maxOutputTokens: 256,
      },
    },
    {
      id: "node-synthesize",
      inputContext: ["ctx-system", "ctx-question", "ctx-ranked"],
      kind: "model_call",
      model: {
        task: "synthesis",
      },
      outputContext: "ctx-answer",
      parameters: {
        maxOutputTokens: 512,
      },
      validators: ["validator-source-grounding"],
    },
    {
      failurePolicy: "retry_node",
      id: "node-validate",
      inputContext: ["ctx-answer", ...chunkContextIds],
      kind: "validator",
      outputContext: "ctx-validation",
      validator: {
        kind: "source_grounding",
        name: "validator-source-grounding",
      },
    },
    {
      cacheKeyRef: "cache://rag/stable-prefix",
      cachePolicy: {
        keyRef: "cache://rag/stable-prefix",
        mode: "eligible",
        scope: "plan",
      },
      id: "node-cache-write",
      inputContext: ["ctx-system"],
      kind: "cache_write",
    },
    {
      id: "node-join",
      inputNodeIds: ["node-validate", "node-cache-write"],
      kind: "join",
      strategy: "all",
    },
  ];
}

function createOptimizedEdges(
  chunkContextIds: readonly string[],
): readonly MIREdge[] {
  return [
    {
      contextIds: chunkContextIds,
      fromNodeId: "node-retrieve",
      id: "edge-retrieve-rank",
      kind: "data",
      toNodeId: "node-rank",
    },
    {
      contextIds: ["ctx-ranked"],
      fromNodeId: "node-rank",
      id: "edge-rank-synthesize",
      kind: "data",
      toNodeId: "node-synthesize",
    },
    {
      contextIds: ["ctx-answer"],
      fromNodeId: "node-synthesize",
      id: "edge-synthesize-validate",
      kind: "validation",
      toNodeId: "node-validate",
    },
    {
      fromNodeId: "node-validate",
      id: "edge-validate-join",
      kind: "control",
      toNodeId: "node-join",
    },
    {
      fromNodeId: "node-cache-write",
      id: "edge-cache-write-join",
      kind: "control",
      toNodeId: "node-join",
    },
  ];
}

function createOptimizedMockFixture(): MockBackendFixture {
  return {
    responses: [
      {
        contextId: "ctx-chunk-plan",
        nodeId: "node-retrieve",
        outputRef: "fixture://rag/retrieved-chunks/raw",
        usage: {
          inputTokens: 24,
          latencyMs: 10,
          outputTokens: 1200,
        },
      },
      {
        contextId: "ctx-ranked",
        nodeId: "node-rank",
        outputRef: "fixture://rag/ranked-chunks",
        usage: {
          inputTokens: 900,
          latencyMs: 8,
          outputTokens: rankOutputTokens,
        },
      },
      {
        contextId: "ctx-answer",
        nodeId: "node-synthesize",
        outputRef: "fixture://rag/answer/optimized",
        usage: {
          costUsd: 0,
          inputTokens: 420,
          latencyMs: 20,
          outputTokens: synthesisOutputTokens,
        },
      },
      {
        contextId: "ctx-validation",
        nodeId: "node-validate",
        outputRef: "fixture://rag/validation/optimized",
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

function createOptimizedContentLookup(
  fixture: RagBaselineFixture,
): Readonly<Record<string, string>> {
  const chunkEntries = fixture.chunks.map(
    (chunk) => [chunk.contentRef, chunk.text] as const,
  );

  return {
    ...Object.fromEntries(chunkEntries),
    "fixture://rag/answer/optimized":
      "Migaki optimizes graph execution with deduplicated evidence, static routing, and retry metadata [migaki-guide#1] [migaki-guide#2].",
    "fixture://rag/question": fixture.question,
    "fixture://rag/ranked-chunks":
      "Ranked citations: migaki-guide#1, migaki-guide#2, migaki-guide#4, migaki-guide#5.",
    "fixture://rag/system": fixture.systemInstruction,
    "fixture://rag/validation/optimized":
      "passed: optimized answer cites supported chunks.",
  };
}

function createOptimizedRuntimeEvidence(input: {
  readonly costEstimate: PlanCostEstimate;
  readonly result: MockExecutionResult;
  readonly runId: string;
  readonly tokenEstimate: PlanTokenEstimate;
}): readonly (EstimateEvidenceEvent | ValidatorResultEvidenceEvent)[] {
  return [
    createEstimateEvent({
      estimateKind: "token",
      id: "optimized-token-estimate",
      runId: input.runId,
      subjectRef: input.tokenEstimate.subjectRef,
      summary: "Estimated total optimized fixture tokens.",
      unit: "tokens",
      ...(input.tokenEstimate.tokens !== undefined
        ? { value: input.tokenEstimate.tokens }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "cost",
      id: "optimized-cost-estimate",
      runId: input.runId,
      subjectRef: input.costEstimate.subjectRef,
      summary: "Estimated optimized mock execution cost.",
      unit: "usd",
      ...(input.costEstimate.costUsd !== undefined
        ? { value: input.costEstimate.costUsd }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "latency",
      id: "optimized-latency-estimate",
      runId: input.runId,
      subjectRef: replayHandle,
      summary: "Measured deterministic mock optimized latency.",
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
    id: `optimized-validator-${String(input.index + 1).padStart(3, "0")}`,
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
    summary: "Recorded deterministic optimized validator result.",
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

function toEvidencePassSummary(
  record: PassRunReport["passes"][number],
): EvidenceBundlePassSummary {
  return {
    enabled: record.enabled,
    name: record.pass.name,
    version: record.pass.version,
    ...(record.enabled && "result" in record
      ? { contractVersion: record.result.version }
      : {}),
    ...(record.evidence.length > 0
      ? { evidenceRefs: record.evidence.map((event) => event.id) }
      : {}),
    ...(record.warnings.length > 0
      ? { warningCodes: record.warnings.map((warning) => warning.code) }
      : {}),
  };
}

function createReportData(input: {
  readonly costEstimate: PlanCostEstimate;
  readonly evidenceBundle: EvidenceBundle;
  readonly passReport: PassRunReport;
  readonly planDiffChangeCount: number;
  readonly result: MockExecutionResult;
  readonly tokenEstimate: PlanTokenEstimate;
}): RagOptimizedReportData {
  return {
    duplicateContextRemoved: input.evidenceBundle.planDiff.changes.flatMap(
      (change) =>
        change.kind === "context_removed" && change.artifactId !== undefined
          ? [change.artifactId]
          : [],
    ),
    evidenceBundleRef,
    passNames: input.passReport.passes.map((record) => record.pass.name),
    planDiffChangeCount: input.planDiffChangeCount,
    planId: input.evidenceBundle.optimizedPlan.planId,
    replayHandle,
    retryDecisions:
      input.evidenceBundle.retryFallbackDecisions.map(toRetryDecision),
    routingDecisions:
      input.evidenceBundle.routingDecisions.map(toRoutingDecision),
    traceId,
    validatorResults: input.result.validatorResults,
    warningCodes: input.passReport.warnings.map((warning) => warning.code),
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

function toRoutingDecision(
  event: RoutingDecisionEvidenceEvent,
): RagOptimizedRoutingDecision {
  return {
    nodeId: event.routingDecision.nodeId,
    target: event.routingDecision.target,
  };
}

function toRetryDecision(
  event: RetryFallbackDecisionEvidenceEvent,
): RagOptimizedRetryDecision {
  return {
    decision: event.retryFallbackDecision.decision,
    nodeId: event.retryFallbackDecision.nodeId,
    scope: event.retryFallbackDecision.scope,
  };
}

function requireContext(plan: MIRPlan, contextId: string): MIRContextBlock {
  const context = plan.context.find((block) => block.id === contextId);

  if (context === undefined) {
    throw new Error(`Missing context ${contextId}.`);
  }

  return context;
}

function requireProviderCapabilities(fixtureId: string) {
  const capabilities = lookupProviderCapabilities(fixtureId);

  if (capabilities === undefined) {
    throw new Error(`Missing provider capability fixture ${fixtureId}.`);
  }

  return capabilities;
}

function contextIdForChunk(chunkId: string): string {
  return `ctx-${chunkId}`;
}

function estimateFixtureTokens(text: string): number {
  return text.trim().match(/[A-Za-z0-9]+|[^\sA-Za-z0-9]/g)?.length ?? 0;
}
