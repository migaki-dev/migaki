import {
  assertMIRPlan,
  type MIRContextBlock,
  type MIREdge,
  type MIRModelCallNode,
  type MIRNode,
  type MIRPlan,
} from "@migaki/mir";
import {
  createMockExecutionBackend,
  lookupProviderCapabilities,
  lowerAnthropicStyleModelRequest,
  lowerLiteLLMCompatibleModelRequest,
  type MockBackendFixture,
  type MockExecutionResponse,
  type MockExecutionResult,
  type MockLoweredExecutionPlan,
  type MockValidatorOutcome,
  type ProviderCapabilities,
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
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

export const V0_BENCHMARK_SUITE_REPORT_VERSION =
  "migaki.example.v0-benchmark-suite-report.v0";

export type V0BenchmarkDuplicateContextRatio = "high" | "low" | "none";
export type V0BenchmarkStablePrefixCacheEligibility =
  | "absent"
  | "eligible-provider-supported"
  | "eligible-provider-unsupported";
export type V0BenchmarkValidatorBehavior =
  | "fail"
  | "pass"
  | "retry-scoped-recovery";
export type V0BenchmarkLoweringPath =
  | "anthropic-style"
  | "litellm-compatible"
  | "none";

export interface V0BenchmarkScenarioAcceptanceCriterion {
  readonly actual: string;
  readonly id: string;
  readonly passed: boolean;
  readonly threshold: string;
}

export interface V0BenchmarkMetricSnapshot {
  readonly costEstimateUsd?: number;
  readonly latencyMs?: number;
  readonly tokenEstimate?: number;
  readonly validatorPassRate: number;
}

export interface V0BenchmarkMetricDeltas {
  readonly costEstimateUsd?: number;
  readonly latencyMs?: number;
  readonly tokenEstimate?: number;
  readonly validatorPassRate: number;
}

export interface V0BenchmarkScenarioMetrics {
  readonly baseline: V0BenchmarkMetricSnapshot;
  readonly deltas: V0BenchmarkMetricDeltas;
  readonly optimized: V0BenchmarkMetricSnapshot;
}

export interface V0BenchmarkScenarioDimensions {
  readonly backendPath: "mock_execution";
  readonly duplicateContextRatio: V0BenchmarkDuplicateContextRatio;
  readonly duplicateContextRatioEstimate: number;
  readonly stablePrefixCacheEligibility: V0BenchmarkStablePrefixCacheEligibility;
  readonly validatorBehavior: V0BenchmarkValidatorBehavior;
}

export interface V0BenchmarkLoweringSummary {
  readonly cacheBreakpointsLowered: number;
  readonly inputItemCount: number;
  readonly path: V0BenchmarkLoweringPath;
  readonly provider: string;
  readonly supported: boolean;
  readonly warningCodes: readonly string[];
}

export interface V0BenchmarkRetrySummary {
  readonly firstAttemptValidatorPassRate: number;
  readonly recoveredValidatorPassRate: number;
  readonly retryExecutedNodeIds: readonly string[];
  readonly scope: "node";
}

export interface V0BenchmarkScenarioReport {
  readonly acceptanceCriteria: readonly V0BenchmarkScenarioAcceptanceCriterion[];
  readonly artifacts: {
    readonly evidenceBundleRef: string;
    readonly replayRefs: readonly string[];
  };
  readonly dimensions: V0BenchmarkScenarioDimensions;
  readonly id: string;
  readonly limitations: readonly string[];
  readonly lowering: V0BenchmarkLoweringSummary;
  readonly metrics: V0BenchmarkScenarioMetrics;
  readonly nonGoals: readonly string[];
  readonly passes: {
    readonly applied: readonly string[];
    readonly skipped: readonly string[];
  };
  readonly planDiffChangeCount: number;
  readonly retry?: V0BenchmarkRetrySummary;
  readonly title: string;
  readonly validatorResults: {
    readonly baseline: readonly MockValidatorOutcome[];
    readonly optimized: readonly MockValidatorOutcome[];
  };
  readonly warnings: readonly string[];
}

export interface V0BenchmarkSuiteClaims {
  readonly canClaim: readonly string[];
  readonly cannotClaim: readonly string[];
}

export interface V0BenchmarkSuiteReport {
  readonly claims: V0BenchmarkSuiteClaims;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly scenarios: readonly V0BenchmarkScenarioReport[];
  readonly version: typeof V0_BENCHMARK_SUITE_REPORT_VERSION;
}

export interface V0BenchmarkScenarioRun {
  readonly evidenceBundle: EvidenceBundle;
  readonly report: V0BenchmarkScenarioReport;
  readonly traces: readonly MockExecutionTraceArtifact[];
}

export interface V0BenchmarkSuiteRun {
  readonly report: V0BenchmarkSuiteReport;
  readonly scenarioRuns: readonly V0BenchmarkScenarioRun[];
}

interface BenchmarkDoc {
  readonly contentHash: string;
  readonly duplicateOf?: string;
  readonly id: string;
  readonly sourceRef: string;
}

interface ScenarioDefinition {
  readonly disabledPasses: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly docs: readonly BenchmarkDoc[];
  readonly duplicateContextRatio: V0BenchmarkDuplicateContextRatio;
  readonly duplicateContextRatioEstimate: number;
  readonly id: string;
  readonly includeStablePrefix: boolean;
  readonly latency: {
    readonly baselineSynthesisMs: number;
    readonly optimizedSynthesisMs: number;
    readonly retrySynthesisMs?: number;
  };
  readonly loweringPath: V0BenchmarkLoweringPath;
  readonly providerFixtureId: "anthropic-style" | "litellm-compatible" | "mock";
  readonly stablePrefixCacheEligibility: V0BenchmarkStablePrefixCacheEligibility;
  readonly title: string;
  readonly validatorBehavior: V0BenchmarkValidatorBehavior;
}

interface ScenarioExecution {
  readonly fixture: MockBackendFixture;
  readonly loweredPlan: MockLoweredExecutionPlan;
  readonly result: MockExecutionResult;
  readonly trace: MockExecutionTraceArtifact;
}

interface ScenarioExecutionInput {
  readonly evidenceBundleRef: string;
  readonly fixture: MockBackendFixture;
  readonly plan: MIRPlan;
  readonly runKind: "baseline" | "optimized" | "retry";
  readonly scenarioId: string;
  readonly traceId: string;
}

const generatedAt = "2026-01-01T00:00:04.000Z";
const startedAt = "2026-01-01T00:00:00.000Z";
const validatorId = "validator-source-grounding";
const answerOutputTokens = 64;
const documentTokenEstimate = 40;
const questionTokenEstimate = 12;
const systemTokenEstimate = 20;
const answerTokenEstimate = 30;
const validationTokenEstimate = 5;

const benchmarkPasses = [
  exactDuplicateContextEliminationPass,
  stablePrefixDetectionPass,
  promptCacheLayoutReportingPass,
  staticRoutingPolicyPass,
  retryFallbackPlanningPass,
] as const;

const scenarioDefinitions = [
  {
    disabledPasses: [
      {
        name: stablePrefixDetectionPass.name,
        reason: "Scenario has no stable prefix candidate.",
      },
      {
        name: promptCacheLayoutReportingPass.name,
        reason: "Scenario has no cache-eligible prefix.",
      },
    ],
    docs: [
      createDoc("intro", "hash-intro"),
      createDoc("evidence", "hash-evidence"),
      createDoc("cache", "hash-cache"),
    ],
    duplicateContextRatio: "none",
    duplicateContextRatioEstimate: 0,
    id: "no-duplicates-cache-absent-validator-pass",
    includeStablePrefix: false,
    latency: {
      baselineSynthesisMs: 30,
      optimizedSynthesisMs: 30,
    },
    loweringPath: "none",
    providerFixtureId: "mock",
    stablePrefixCacheEligibility: "absent",
    title: "No duplicate context, no cache candidate, validator passes",
    validatorBehavior: "pass",
  },
  {
    disabledPasses: [],
    docs: [
      createDoc("intro", "hash-intro"),
      createDoc("evidence", "hash-evidence"),
      createDoc("evidence-copy", "hash-evidence", "evidence"),
      createDoc("cache", "hash-cache"),
    ],
    duplicateContextRatio: "low",
    duplicateContextRatioEstimate: 0.25,
    id: "low-duplicates-cache-unsupported-validator-fail",
    includeStablePrefix: true,
    latency: {
      baselineSynthesisMs: 30,
      optimizedSynthesisMs: 24,
    },
    loweringPath: "litellm-compatible",
    providerFixtureId: "litellm-compatible",
    stablePrefixCacheEligibility: "eligible-provider-unsupported",
    title: "Low duplicate context, cache unsupported, validator fails",
    validatorBehavior: "fail",
  },
  {
    disabledPasses: [],
    docs: [
      createDoc("intro", "hash-intro"),
      createDoc("evidence", "hash-evidence"),
      createDoc("evidence-copy-1", "hash-evidence", "evidence"),
      createDoc("evidence-copy-2", "hash-evidence", "evidence"),
      createDoc("cache", "hash-cache"),
      createDoc("cache-copy", "hash-cache", "cache"),
    ],
    duplicateContextRatio: "high",
    duplicateContextRatioEstimate: 0.5,
    id: "high-duplicates-cache-supported-retry-recovery",
    includeStablePrefix: true,
    latency: {
      baselineSynthesisMs: 34,
      optimizedSynthesisMs: 24,
      retrySynthesisMs: 24,
    },
    loweringPath: "anthropic-style",
    providerFixtureId: "anthropic-style",
    stablePrefixCacheEligibility: "eligible-provider-supported",
    title: "High duplicate context, cache supported, retry-scoped recovery",
    validatorBehavior: "retry-scoped-recovery",
  },
] as const satisfies readonly ScenarioDefinition[];

export async function runV0BenchmarkSuite(): Promise<V0BenchmarkSuiteRun> {
  const scenarioRuns: V0BenchmarkScenarioRun[] = [];

  for (const definition of scenarioDefinitions) {
    scenarioRuns.push(await runScenario(definition));
  }

  return {
    report: {
      claims: {
        canClaim: [
          "Exact duplicate context removal reduces deterministic token and cost estimates when duplicate retrieved context exists.",
          "No duplicate context means the v0 deterministic dedup pass reports no token or cost improvement.",
          "Provider fixture capabilities determine whether cache opportunities are supported, downgraded, or unsupported.",
          "Validator failures and retry-scoped recovery are visible in benchmark evidence and replay artifacts.",
        ],
        cannotClaim: [
          "Identical answers after optimization.",
          "Live-provider cost, latency, or quality savings.",
          "Semantic duplicate detection, semantic compression, or semantic caching.",
          "Provider-exact tokenization or invoice-exact billing.",
        ],
      },
      generatedAt,
      limitations: [
        "Uses deterministic fixtures and synthetic usage numbers only.",
        "Uses mock execution traces for replay; request lowering is fixture-backed and does not call providers.",
        "Latency is explicit fixture latency, not wall-clock provider latency.",
      ],
      scenarios: scenarioRuns.map((scenario) => scenario.report),
      version: V0_BENCHMARK_SUITE_REPORT_VERSION,
    },
    scenarioRuns,
  };
}

export async function createV0BenchmarkSuiteReport(): Promise<V0BenchmarkSuiteReport> {
  return (await runV0BenchmarkSuite()).report;
}

export function renderV0BenchmarkSuiteReport(
  report: V0BenchmarkSuiteReport,
): string {
  return [
    "Migaki v0 Scenario Benchmark Suite",
    `Generated: ${report.generatedAt}`,
    `Scenarios: ${report.scenarios.length}`,
    `Can claim: ${report.claims.canClaim.join("; ")}`,
    `Cannot claim: ${report.claims.cannotClaim.join("; ")}`,
    "",
    ...report.scenarios.flatMap((scenario) => [
      `Scenario: ${scenario.id}`,
      `Dimensions: duplicate=${scenario.dimensions.duplicateContextRatio}, cache=${scenario.dimensions.stablePrefixCacheEligibility}, validator=${scenario.dimensions.validatorBehavior}, backend=${scenario.dimensions.backendPath}, lowering=${scenario.lowering.path}`,
      "Acceptance criteria:",
      ...scenario.acceptanceCriteria.map(
        (criterion) =>
          `- ${criterion.id}: ${criterion.threshold}; actual ${criterion.actual}; passed ${String(
            criterion.passed,
          )}`,
      ),
      "Results:",
      `- Tokens: ${formatMetricDelta(
        scenario.metrics.baseline.tokenEstimate,
        scenario.metrics.optimized.tokenEstimate,
        scenario.metrics.deltas.tokenEstimate,
      )}`,
      `- Cost USD: ${formatMetricDelta(
        scenario.metrics.baseline.costEstimateUsd,
        scenario.metrics.optimized.costEstimateUsd,
        scenario.metrics.deltas.costEstimateUsd,
      )}`,
      `- Latency ms: ${formatMetricDelta(
        scenario.metrics.baseline.latencyMs,
        scenario.metrics.optimized.latencyMs,
        scenario.metrics.deltas.latencyMs,
      )}`,
      `- Validator pass rate: ${formatMetricDelta(
        scenario.metrics.baseline.validatorPassRate,
        scenario.metrics.optimized.validatorPassRate,
        scenario.metrics.deltas.validatorPassRate,
      )}`,
      `- Plan diff changes: ${scenario.planDiffChangeCount}`,
      `- Warnings: ${scenario.warnings.join(", ")}`,
      `- Replay refs: ${scenario.artifacts.replayRefs.join(", ")}`,
      "",
    ]),
  ].join("\n");
}

export function serializeV0BenchmarkSuiteReport(
  report: V0BenchmarkSuiteReport,
): string {
  return `${JSON.stringify(toStableJsonValue(report), null, 2)}\n`;
}

async function runScenario(
  definition: ScenarioDefinition,
): Promise<V0BenchmarkScenarioRun> {
  const inputPlan = createScenarioPlan(definition);
  const providerCapabilities = requireProviderCapabilities(
    definition.providerFixtureId,
  );
  const passReport = await runOptimizationPasses(inputPlan, benchmarkPasses, {
    clock: {
      now: () => Date.UTC(2026, 0, 1),
    },
    disabledPasses: definition.disabledPasses,
    failurePolicy: "stop",
    providerCapabilities: [providerCapabilities],
    runId: definition.id,
  });
  const optimizedPlan = passReport.plan;
  const planDiff = diffMIRPlans(inputPlan, optimizedPlan, {
    afterWarnings: passReport.warnings,
  });
  const evidenceBundleRef = `evidence://benchmark/${definition.id}`;
  const baselineExecution = await executeScenario({
    evidenceBundleRef,
    fixture: createScenarioFixture({
      definition,
      phase: "baseline",
      plan: inputPlan,
      validationStatus: "passed",
    }),
    plan: inputPlan,
    runKind: "baseline",
    scenarioId: definition.id,
    traceId: `trace-benchmark-${definition.id}-baseline`,
  });
  const optimizedValidationStatus =
    definition.validatorBehavior === "pass" ? "passed" : "failed";
  const optimizedExecution = await executeScenario({
    evidenceBundleRef,
    fixture: createScenarioFixture({
      definition,
      phase: "optimized",
      plan: optimizedPlan,
      validationStatus: optimizedValidationStatus,
    }),
    plan: optimizedPlan,
    runKind: "optimized",
    scenarioId: definition.id,
    traceId: `trace-benchmark-${definition.id}-optimized`,
  });
  const retryExecution =
    definition.validatorBehavior === "retry-scoped-recovery"
      ? await executeScenario({
          evidenceBundleRef,
          fixture: createScenarioFixture({
            definition,
            phase: "retry",
            plan: optimizedPlan,
            validationStatus: "passed",
          }),
          plan: optimizedPlan,
          runKind: "retry",
          scenarioId: definition.id,
          traceId: `trace-benchmark-${definition.id}-retry`,
        })
      : undefined;
  const baselineTokenEstimate = estimatePlanTokens(inputPlan);
  const optimizedTokenEstimate = estimatePlanTokens(optimizedPlan);
  const baselineCostEstimate = estimatePlanCosts(
    inputPlan,
    baselineTokenEstimate,
    createCostOptions(definition),
  );
  const optimizedCostEstimate = estimatePlanCosts(
    optimizedPlan,
    optimizedTokenEstimate,
    createCostOptions(definition),
  );
  const baselineMetrics = createMetricSnapshot({
    validatorResults: baselineExecution.result.validatorResults,
    ...(baselineCostEstimate.costUsd !== undefined
      ? { costEstimateUsd: baselineCostEstimate.costUsd }
      : {}),
    ...(baselineExecution.result.usage?.latencyMs !== undefined
      ? { latencyMs: baselineExecution.result.usage.latencyMs }
      : {}),
    ...(baselineTokenEstimate.tokens !== undefined
      ? { tokenEstimate: baselineTokenEstimate.tokens }
      : {}),
  });
  const optimizedMetricValidatorResults =
    retryExecution?.result.validatorResults ??
    optimizedExecution.result.validatorResults;
  const optimizedMetrics = createMetricSnapshot({
    latencyMs:
      (optimizedExecution.result.usage?.latencyMs ?? 0) +
      (retryExecution?.result.usage?.latencyMs ?? 0),
    validatorResults: optimizedMetricValidatorResults,
    ...(optimizedCostEstimate.costUsd !== undefined
      ? { costEstimateUsd: optimizedCostEstimate.costUsd }
      : {}),
    ...(optimizedTokenEstimate.tokens !== undefined
      ? { tokenEstimate: optimizedTokenEstimate.tokens }
      : {}),
  });
  const metrics = {
    baseline: baselineMetrics,
    deltas: createMetricDeltas(baselineMetrics, optimizedMetrics),
    optimized: optimizedMetrics,
  } satisfies V0BenchmarkScenarioMetrics;
  const traces = [
    baselineExecution.trace,
    optimizedExecution.trace,
    ...(retryExecution === undefined ? [] : [retryExecution.trace]),
  ];
  const lowering = createLoweringSummary(definition, optimizedPlan);
  const retry = createRetrySummary(optimizedExecution, retryExecution);
  const warnings = uniqueSorted(
    passReport.warnings.map((warning) => warning.code),
  );
  const evidenceBundle = createEvidenceBundle({
    createdAt: generatedAt,
    events: [
      ...passReport.evidence,
      ...createRuntimeEvidenceEvents({
        baselineMetrics,
        definition,
        optimizedMetrics,
        optimizedValidatorResults: [
          ...optimizedExecution.result.validatorResults,
          ...(retryExecution?.result.validatorResults ?? []),
        ],
      }),
    ],
    exportMode: "metadata_only",
    optimizedPlan: {
      planId: optimizedPlan.id,
      ref: `mir://benchmark/${definition.id}/optimized`,
      version: optimizedPlan.version,
    },
    originalPlan: {
      planId: inputPlan.id,
      ref: `mir://benchmark/${definition.id}/baseline`,
      version: inputPlan.version,
    },
    passes: passReport.passes.map(toEvidencePassSummary),
    planDiff,
    replay: {
      handles: traces.map((trace) => ({
        kind: "trace",
        ref: traceRef(trace.traceId),
      })),
      mode: "metadata",
    },
    runId: definition.id,
    warnings: passReport.warnings,
  });
  const report: V0BenchmarkScenarioReport = {
    acceptanceCriteria: createAcceptanceCriteria({
      definition,
      lowering,
      metrics,
      retry,
      warnings,
    }),
    artifacts: {
      evidenceBundleRef,
      replayRefs: traces.map((trace) => traceRef(trace.traceId)),
    },
    dimensions: {
      backendPath: "mock_execution",
      duplicateContextRatio: definition.duplicateContextRatio,
      duplicateContextRatioEstimate: definition.duplicateContextRatioEstimate,
      stablePrefixCacheEligibility: definition.stablePrefixCacheEligibility,
      validatorBehavior: definition.validatorBehavior,
    },
    id: definition.id,
    limitations: [
      "Deterministic token estimator, not provider tokenizer.",
      "Synthetic fixture latency, not live service latency.",
      "Provider lowering uses fixture capabilities and injected request shapes only.",
    ],
    lowering,
    metrics,
    nonGoals: [
      "Identical answer quality.",
      "Live-provider savings.",
      "Semantic duplicate detection.",
    ],
    passes: {
      applied: passReport.passes
        .filter((record) => record.enabled)
        .map((record) => record.pass.name),
      skipped: passReport.passes
        .filter((record) => !record.enabled)
        .map((record) => record.pass.name),
    },
    planDiffChangeCount: planDiff.changes.length,
    ...(retry !== undefined ? { retry } : {}),
    title: definition.title,
    validatorResults: {
      baseline: baselineExecution.result.validatorResults,
      optimized: [
        ...optimizedExecution.result.validatorResults,
        ...(retryExecution?.result.validatorResults ?? []),
      ],
    },
    warnings,
  };

  return {
    evidenceBundle,
    report,
    traces,
  };
}

function createScenarioPlan(definition: ScenarioDefinition): MIRPlan {
  const docContextIds = definition.docs.map((doc) => contextIdForDoc(doc.id));
  const inputContext = [
    ...(definition.includeStablePrefix ? ["ctx-system"] : []),
    "ctx-question",
    ...docContextIds,
  ];
  const context: MIRContextBlock[] = [
    ...(definition.includeStablePrefix ? [createSystemContext()] : []),
    {
      contentRef: "fixture://benchmark/question",
      id: "ctx-question",
      mutability: "fixed",
      privacyClass: "confidential",
      provenance: {
        source: "user",
      },
      retentionPolicy: {
        mode: "redacted",
      },
      role: "user_input",
      tokenEstimate: questionTokenEstimate,
    },
    ...definition.docs.map(createDocContext),
    {
      contentRef: "fixture://benchmark/answer",
      id: "ctx-answer",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-synthesize",
        source: "generated",
      },
      role: "validator_output",
      tokenEstimate: answerTokenEstimate,
    },
    {
      contentRef: "fixture://benchmark/validation",
      id: "ctx-validation",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-validate",
        source: "validator",
      },
      role: "validator_output",
      tokenEstimate: validationTokenEstimate,
    },
  ];
  const nodes: MIRNode[] = [
    {
      id: "node-retrieve",
      kind: "retrieval_call",
      queryContext: "ctx-question",
      resultContext: docContextIds[0] ?? "ctx-question",
      retrieval: {
        source: "benchmark-fixture",
        topK: definition.docs.length,
      },
    },
    createSynthesisNode(definition, inputContext),
    {
      failurePolicy:
        definition.validatorBehavior === "retry-scoped-recovery"
          ? "retry_node"
          : "warn",
      id: "node-validate",
      inputContext: ["ctx-answer", ...docContextIds],
      kind: "validator",
      outputContext: "ctx-validation",
      validator: {
        kind: "source_grounding",
        name: validatorId,
      },
    },
  ];
  const edges: MIREdge[] = [
    {
      contextIds: docContextIds,
      fromNodeId: "node-retrieve",
      id: "edge-retrieve-synthesize",
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
  ];

  return assertMIRPlan({
    constraints: {
      allowedProviders:
        definition.providerFixtureId === "mock"
          ? ["mock"]
          : ["mock", definition.providerFixtureId],
      auditLevel: "evidence_bundle",
      dataPolicy: {
        allowModelTraining: false,
        allowPersistence: false,
        allowedPrivacyClasses: ["confidential", "internal"],
        redactionRequired: true,
      },
      minValidatorPassRate: definition.validatorBehavior === "fail" ? 0 : 1,
      replayPolicy: "metadata",
      requiredValidators: [validatorId],
      retentionPolicy: {
        mode: "metadata_only",
        reason:
          "Benchmark fixtures keep prompt and document text out of artifacts.",
      },
      ...(definition.includeStablePrefix
        ? {
            cachePolicy: {
              keyRef: "cache://benchmark/stable-prefix",
              mode: "eligible",
              scope: "plan",
            },
          }
        : {}),
    },
    context,
    edges,
    id: `benchmark-${definition.id}`,
    metadata: {
      application: "rag-dedup-cache",
      createdAt: "2026-01-01T00:00:00.000Z",
      description: definition.title,
      tags: ["example", "benchmark", definition.duplicateContextRatio],
      traceId: `trace-benchmark-${definition.id}`,
    },
    nodes,
    version: "migaki.mir.v0",
  });
}

function createSynthesisNode(
  definition: ScenarioDefinition,
  inputContext: readonly string[],
): MIRModelCallNode {
  return {
    id: "node-synthesize",
    inputContext,
    kind: "model_call",
    metadata: {
      anthropicStyle: {
        cacheTtl: "5m",
        model: "anthropic-style-synthesis",
      },
      litellmCompatible: {
        model: "litellm-compatible-synthesis",
      },
    },
    model: {
      task: "synthesis",
    },
    outputContext: "ctx-answer",
    parameters: {
      maxOutputTokens: answerOutputTokens,
    },
    validators: [validatorId],
  };
}

function createSystemContext(): MIRContextBlock {
  return {
    cachePolicy: {
      keyRef: "cache://benchmark/stable-prefix",
      mode: "eligible",
      scope: "plan",
    },
    contentRef: "fixture://benchmark/system",
    id: "ctx-system",
    mutability: "fixed",
    privacyClass: "internal",
    provenance: {
      source: "system",
    },
    retentionPolicy: {
      mode: "metadata_only",
    },
    role: "system_instruction",
    tokenEstimate: systemTokenEstimate,
  };
}

function createDocContext(doc: BenchmarkDoc): MIRContextBlock {
  return {
    contentHash: `sha256:${doc.contentHash}`,
    contentRef: `fixture://benchmark/docs/${doc.id}`,
    id: contextIdForDoc(doc.id),
    mutability: "deduplicable",
    privacyClass: "internal",
    provenance: {
      source: "retrieval",
      sourceRef: doc.sourceRef,
    },
    role: "retrieved_document",
    tokenEstimate: documentTokenEstimate,
  };
}

async function executeScenario(
  input: ScenarioExecutionInput,
): Promise<ScenarioExecution> {
  const backend = createMockExecutionBackend({
    fixture: input.fixture,
    startedAt,
  });
  const loweredPlan =
    input.runKind === "retry"
      ? createRetryLoweredPlan(await backend.lower(input.plan))
      : await backend.lower(input.plan);
  const result = await backend.execute(loweredPlan);
  const trace = captureMockExecutionTrace({
    artifactId: `trace-artifact-${input.traceId}`,
    createdAt: generatedAt,
    ...(result.usage !== undefined ? { estimates: result.usage } : {}),
    evidenceBundleRef: {
      kind: "artifact",
      ref: input.evidenceBundleRef,
    },
    fixture: input.fixture,
    loweredPlan,
    plan: input.plan,
    planRef: `mir://benchmark/${input.scenarioId}/${input.runKind}`,
    redactions: [
      {
        mode: "omitted",
        path: "$.responses[*].metadata.rawText",
        reason: "Benchmark traces keep fixture text out of replay metadata.",
      },
    ],
    result,
    traceId: input.traceId,
  });

  return {
    fixture: input.fixture,
    loweredPlan,
    result,
    trace,
  };
}

function createScenarioFixture(input: {
  readonly definition: ScenarioDefinition;
  readonly phase: "baseline" | "optimized" | "retry";
  readonly plan: MIRPlan;
  readonly validationStatus: MockValidatorOutcome["status"];
}): MockBackendFixture {
  const synthesisLatency =
    input.phase === "baseline"
      ? input.definition.latency.baselineSynthesisMs
      : input.phase === "retry"
        ? (input.definition.latency.retrySynthesisMs ??
          input.definition.latency.optimizedSynthesisMs)
        : input.definition.latency.optimizedSynthesisMs;
  const responses: MockExecutionResponse[] = [
    {
      contextId: firstRetrievedContextId(input.plan),
      nodeId: "node-retrieve",
      outputRef: `fixture://benchmark/${input.definition.id}/${input.phase}/retrieval`,
      usage: {
        inputTokens: questionTokenEstimate,
        latencyMs: 10,
        outputTokens: documentOutputTokens(input.plan),
      },
    },
    {
      contextId: "ctx-answer",
      nodeId: "node-synthesize",
      outputRef: `fixture://benchmark/${input.definition.id}/${input.phase}/answer`,
      usage: {
        inputTokens: modelInputTokens(input.plan),
        latencyMs: synthesisLatency,
        outputTokens: answerOutputTokens,
      },
    },
    {
      contextId: "ctx-validation",
      nodeId: "node-validate",
      outputRef: `fixture://benchmark/${input.definition.id}/${input.phase}/validation`,
      usage: {
        latencyMs: 2,
      },
      validation: {
        score: input.validationStatus === "passed" ? 1 : 0,
        status: input.validationStatus,
        targetRef: "ctx-answer",
        validatorId,
      },
    },
  ];

  if (input.phase !== "retry") {
    return { responses };
  }

  return {
    responses: responses.filter((response) => isRetryNode(response.nodeId)),
  };
}

function createRetryLoweredPlan(
  loweredPlan: MockLoweredExecutionPlan,
): MockLoweredExecutionPlan {
  return {
    ...loweredPlan,
    id: `${loweredPlan.id}-retry`,
    steps: loweredPlan.steps.filter((step) => isRetryNode(step.sourceNodeId)),
  };
}

function createCostOptions(definition: ScenarioDefinition) {
  switch (definition.providerFixtureId) {
    case "anthropic-style":
      return {
        asOf: "2026-01-01",
        modelSelections: [
          {
            model: "anthropic-style-synthesis",
            nodeId: "node-synthesize",
            outputTokens: answerOutputTokens,
            provider: "anthropic-style",
          },
        ],
      };
    case "litellm-compatible":
      return {
        asOf: "2026-01-01",
        modelSelections: [
          {
            model: "litellm-compatible-synthesis",
            nodeId: "node-synthesize",
            outputTokens: answerOutputTokens,
            provider: "litellm-compatible",
          },
        ],
      };
    case "mock":
      return {
        asOf: "2026-01-01",
        modelSelections: [
          {
            model: "mock-default",
            nodeId: "node-synthesize",
            outputTokens: answerOutputTokens,
            provider: "mock",
          },
        ],
      };
  }
}

function createLoweringSummary(
  definition: ScenarioDefinition,
  plan: MIRPlan,
): V0BenchmarkLoweringSummary {
  if (definition.loweringPath === "none") {
    return {
      cacheBreakpointsLowered: 0,
      inputItemCount: 0,
      path: "none",
      provider: "mock",
      supported: true,
      warningCodes: [],
    };
  }

  if (definition.loweringPath === "litellm-compatible") {
    const lowering = lowerLiteLLMCompatibleModelRequest({
      nodeId: "node-synthesize",
      plan,
    });

    return {
      cacheBreakpointsLowered: 0,
      inputItemCount: lowering.requestShape.messages.length,
      path: definition.loweringPath,
      provider: lowering.capabilities.provider,
      supported: lowering.supported,
      warningCodes: uniqueSorted(
        lowering.warnings.map((warning) => warning.code),
      ),
    };
  }

  const lowering = lowerAnthropicStyleModelRequest({
    nodeId: "node-synthesize",
    plan,
  });
  const contentBlocks = [
    ...(lowering.requestShape.system ?? []),
    ...lowering.requestShape.messages.flatMap((message) => message.content),
  ];

  return {
    cacheBreakpointsLowered: contentBlocks.filter(
      (block) => block.cache_control !== undefined,
    ).length,
    inputItemCount: contentBlocks.length,
    path: definition.loweringPath,
    provider: lowering.capabilities.provider,
    supported: lowering.supported,
    warningCodes: uniqueSorted(
      lowering.warnings.map((warning) => warning.code),
    ),
  };
}

function createRetrySummary(
  optimizedExecution: ScenarioExecution,
  retryExecution: ScenarioExecution | undefined,
): V0BenchmarkRetrySummary | undefined {
  if (retryExecution === undefined) {
    return undefined;
  }

  return {
    firstAttemptValidatorPassRate: validatorPassRate(
      optimizedExecution.result.validatorResults,
    ),
    recoveredValidatorPassRate: validatorPassRate(
      retryExecution.result.validatorResults,
    ),
    retryExecutedNodeIds: retryExecution.result.logs.map((log) => log.nodeId),
    scope: "node",
  };
}

function createMetricSnapshot(input: {
  readonly costEstimateUsd?: number;
  readonly latencyMs?: number;
  readonly tokenEstimate?: number;
  readonly validatorResults: readonly MockValidatorOutcome[];
}): V0BenchmarkMetricSnapshot {
  return {
    validatorPassRate: validatorPassRate(input.validatorResults),
    ...(input.costEstimateUsd !== undefined
      ? { costEstimateUsd: input.costEstimateUsd }
      : {}),
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.tokenEstimate !== undefined
      ? { tokenEstimate: input.tokenEstimate }
      : {}),
  };
}

function createMetricDeltas(
  baseline: V0BenchmarkMetricSnapshot,
  optimized: V0BenchmarkMetricSnapshot,
): V0BenchmarkMetricDeltas {
  return {
    validatorPassRate: roundMetric(
      optimized.validatorPassRate - baseline.validatorPassRate,
    ),
    ...(baseline.costEstimateUsd !== undefined &&
    optimized.costEstimateUsd !== undefined
      ? {
          costEstimateUsd: roundMetric(
            optimized.costEstimateUsd - baseline.costEstimateUsd,
          ),
        }
      : {}),
    ...(baseline.latencyMs !== undefined && optimized.latencyMs !== undefined
      ? { latencyMs: optimized.latencyMs - baseline.latencyMs }
      : {}),
    ...(baseline.tokenEstimate !== undefined &&
    optimized.tokenEstimate !== undefined
      ? { tokenEstimate: optimized.tokenEstimate - baseline.tokenEstimate }
      : {}),
  };
}

function createAcceptanceCriteria(input: {
  readonly definition: ScenarioDefinition;
  readonly lowering: V0BenchmarkLoweringSummary;
  readonly metrics: V0BenchmarkScenarioMetrics;
  readonly retry: V0BenchmarkRetrySummary | undefined;
  readonly warnings: readonly string[];
}): readonly V0BenchmarkScenarioAcceptanceCriterion[] {
  switch (input.definition.validatorBehavior) {
    case "pass":
      return [
        criterion({
          actual: formatOptionalNumber(input.metrics.deltas.tokenEstimate),
          id: "no_duplicate_no_token_gain",
          passed: input.metrics.deltas.tokenEstimate === 0,
          threshold:
            "scenario without duplicate context must report zero token delta",
        }),
        criterion({
          actual: String(input.metrics.optimized.validatorPassRate),
          id: "validator_passes",
          passed: input.metrics.optimized.validatorPassRate === 1,
          threshold: "optimized validator pass rate must be 1",
        }),
        criterion({
          actual: input.lowering.path,
          id: "no_provider_lowering",
          passed: input.lowering.path === "none",
          threshold: "cache-absent scenario must not claim provider lowering",
        }),
      ];
    case "fail":
      return [
        criterion({
          actual: formatOptionalNumber(input.metrics.deltas.tokenEstimate),
          id: "duplicate_tokens_reduce",
          passed: (input.metrics.deltas.tokenEstimate ?? 0) < 0,
          threshold:
            "low duplicate scenario must reduce deterministic token estimate",
        }),
        criterion({
          actual: String(input.metrics.optimized.validatorPassRate),
          id: "validator_failure_reported",
          passed: input.metrics.optimized.validatorPassRate === 0,
          threshold:
            "failed validator scenario must surface validator pass rate 0",
        }),
        criterion({
          actual: input.warnings.join(","),
          id: "unsupported_cache_warning",
          passed: input.warnings.includes("prompt_cache_provider_unsupported"),
          threshold:
            "provider-unsupported cache scenario must report unsupported cache warning",
        }),
        criterion({
          actual: input.lowering.warningCodes.join(","),
          id: "lowering_downgrade_reported",
          passed: input.lowering.warningCodes.includes("downgraded_capability"),
          threshold:
            "request-lowering path must report downgraded cache capability",
        }),
      ];
    case "retry-scoped-recovery":
      return [
        criterion({
          actual: formatOptionalNumber(input.metrics.deltas.tokenEstimate),
          id: "high_duplicate_tokens_reduce",
          passed: (input.metrics.deltas.tokenEstimate ?? 0) <= -120,
          threshold:
            "high duplicate scenario must reduce deterministic token estimate by at least 120",
        }),
        criterion({
          actual: String(input.metrics.optimized.validatorPassRate),
          id: "validator_recovers",
          passed: input.metrics.optimized.validatorPassRate === 1,
          threshold: "retry recovery must end with validator pass rate 1",
        }),
        criterion({
          actual: input.retry?.retryExecutedNodeIds.join(",") ?? "none",
          id: "retry_scope",
          passed:
            input.retry?.retryExecutedNodeIds.join(",") ===
            "node-synthesize,node-validate",
          threshold:
            "retry recovery must execute only synthesis and validation nodes",
        }),
        criterion({
          actual: String(input.lowering.cacheBreakpointsLowered),
          id: "explicit_cache_lowered",
          passed: input.lowering.cacheBreakpointsLowered > 0,
          threshold:
            "provider-supported cache scenario must lower an explicit cache breakpoint",
        }),
        criterion({
          actual: formatOptionalNumber(input.metrics.deltas.latencyMs),
          id: "retry_latency_accounted",
          passed: (input.metrics.deltas.latencyMs ?? 0) > 0,
          threshold:
            "retry recovery must report added deterministic latency instead of hiding it",
        }),
      ];
  }
}

function criterion(
  input: V0BenchmarkScenarioAcceptanceCriterion,
): V0BenchmarkScenarioAcceptanceCriterion {
  return input;
}

function createRuntimeEvidenceEvents(input: {
  readonly baselineMetrics: V0BenchmarkMetricSnapshot;
  readonly definition: ScenarioDefinition;
  readonly optimizedMetrics: V0BenchmarkMetricSnapshot;
  readonly optimizedValidatorResults: readonly MockValidatorOutcome[];
}): readonly (EstimateEvidenceEvent | ValidatorResultEvidenceEvent)[] {
  return [
    createEstimateEvent({
      estimateKind: "token",
      id: `${input.definition.id}-baseline-token-estimate`,
      runId: input.definition.id,
      subjectRef: `mir://benchmark/${input.definition.id}/baseline`,
      summary: "Estimated baseline benchmark fixture tokens.",
      unit: "tokens",
      ...(input.baselineMetrics.tokenEstimate !== undefined
        ? { value: input.baselineMetrics.tokenEstimate }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "token",
      id: `${input.definition.id}-optimized-token-estimate`,
      runId: input.definition.id,
      subjectRef: `mir://benchmark/${input.definition.id}/optimized`,
      summary: "Estimated optimized benchmark fixture tokens.",
      unit: "tokens",
      ...(input.optimizedMetrics.tokenEstimate !== undefined
        ? { value: input.optimizedMetrics.tokenEstimate }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "cost",
      id: `${input.definition.id}-baseline-cost-estimate`,
      runId: input.definition.id,
      subjectRef: `mir://benchmark/${input.definition.id}/baseline`,
      summary: "Estimated baseline benchmark fixture cost.",
      unit: "usd",
      ...(input.baselineMetrics.costEstimateUsd !== undefined
        ? { value: input.baselineMetrics.costEstimateUsd }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "cost",
      id: `${input.definition.id}-optimized-cost-estimate`,
      runId: input.definition.id,
      subjectRef: `mir://benchmark/${input.definition.id}/optimized`,
      summary: "Estimated optimized benchmark fixture cost.",
      unit: "usd",
      ...(input.optimizedMetrics.costEstimateUsd !== undefined
        ? { value: input.optimizedMetrics.costEstimateUsd }
        : {}),
    }),
    createEstimateEvent({
      estimateKind: "latency",
      id: `${input.definition.id}-optimized-latency-estimate`,
      runId: input.definition.id,
      subjectRef: `trace://benchmark/${input.definition.id}/optimized`,
      summary: "Estimated deterministic optimized benchmark latency.",
      unit: "milliseconds",
      ...(input.optimizedMetrics.latencyMs !== undefined
        ? { value: input.optimizedMetrics.latencyMs }
        : {}),
    }),
    ...input.optimizedValidatorResults.map((result, index) =>
      createValidatorEvent({
        definition: input.definition,
        index,
        result,
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
  readonly definition: ScenarioDefinition;
  readonly index: number;
  readonly result: MockValidatorOutcome;
}): ValidatorResultEvidenceEvent {
  return {
    id: `${input.definition.id}-validator-${String(input.index + 1).padStart(
      3,
      "0",
    )}`,
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
      runId: input.definition.id,
    },
    summary: `Benchmark validator ${input.result.status}.`,
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

function modelInputTokens(plan: MIRPlan): number {
  const contextById = new Map(plan.context.map((block) => [block.id, block]));
  const node = plan.nodes.find(
    (candidate) => candidate.id === "node-synthesize",
  );

  if (node?.inputContext === undefined) {
    return 0;
  }

  return node.inputContext.reduce(
    (total, contextId) =>
      total + (contextById.get(contextId)?.tokenEstimate ?? 0),
    0,
  );
}

function documentOutputTokens(plan: MIRPlan): number {
  return plan.context
    .filter((block) => block.role === "retrieved_document")
    .reduce((total, block) => total + (block.tokenEstimate ?? 0), 0);
}

function firstRetrievedContextId(plan: MIRPlan): string {
  return (
    plan.context.find((block) => block.role === "retrieved_document")?.id ??
    "ctx-question"
  );
}

function createDoc(
  id: string,
  contentHash: string,
  duplicateOf?: string,
): BenchmarkDoc {
  return {
    contentHash,
    ...(duplicateOf !== undefined ? { duplicateOf } : {}),
    id,
    sourceRef: `benchmark-doc#${id}`,
  };
}

function contextIdForDoc(id: string): string {
  return `ctx-doc-${id}`;
}

function isRetryNode(nodeId: string): boolean {
  return nodeId === "node-synthesize" || nodeId === "node-validate";
}

function validatorPassRate(results: readonly MockValidatorOutcome[]): number {
  if (results.length === 0) {
    return 0;
  }

  return (
    results.filter((result) => result.status === "passed").length /
    results.length
  );
}

function requireProviderCapabilities(fixtureId: string): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities(fixtureId);

  if (capabilities === undefined) {
    throw new Error(`Missing provider capability fixture ${fixtureId}.`);
  }

  return capabilities;
}

function traceRef(traceId: string): string {
  return `trace://${traceId}`;
}

function formatMetricDelta(
  before: number | undefined,
  after: number | undefined,
  delta: number | undefined,
): string {
  return `${formatOptionalNumber(before)} -> ${formatOptionalNumber(
    after,
  )} (${formatOptionalNumber(delta)})`;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    stable[key] = toStableJsonValue(value[key]);
  }

  return stable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
