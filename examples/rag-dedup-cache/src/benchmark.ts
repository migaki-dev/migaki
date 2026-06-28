import type { MIRPlan } from "@migaki/mir";
import type { MockValidatorOutcome } from "@migaki/providers";

import { runRagBaseline } from "./baseline.js";
import { runRagOptimized } from "./optimized.js";
import { runRagRetryScenario } from "./validation.js";

export const V0_BENCHMARK_REPORT_VERSION =
  "migaki.example.v0-benchmark-report.v0";

export interface V0BenchmarkRunMetrics {
  readonly costEstimateUsd?: number;
  readonly evidenceBundleRef: string;
  readonly latencyMs?: number;
  readonly planId: string;
  readonly replayHandle: string;
  readonly tokenEstimate?: number;
  readonly validatorPassRate: number;
}

export interface V0BenchmarkDeltas {
  readonly costEstimateUsd?: number;
  readonly latencyMs?: number;
  readonly tokenEstimate?: number;
  readonly validatorPassRate: number;
}

export interface V0BenchmarkAcceptanceCriterion {
  readonly actual: string;
  readonly id: string;
  readonly passed: boolean;
  readonly threshold: string;
}

export interface V0BenchmarkClaims {
  readonly canClaim: readonly string[];
  readonly cannotClaim: readonly string[];
}

export interface V0BenchmarkReport {
  readonly acceptanceCriteria: readonly V0BenchmarkAcceptanceCriterion[];
  readonly changed: readonly string[];
  readonly claims: V0BenchmarkClaims;
  readonly evidence: {
    readonly baseline: string;
    readonly optimized: string;
    readonly retryScenario: string;
  };
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly metrics: {
    readonly baseline: V0BenchmarkRunMetrics;
    readonly deltas: V0BenchmarkDeltas;
    readonly optimized: V0BenchmarkRunMetrics;
  };
  readonly passes: readonly string[];
  readonly plans: {
    readonly baseline: string;
    readonly optimized: string;
    readonly planDiffChangeCount: number;
  };
  readonly replayArtifacts: {
    readonly baseline: string;
    readonly optimized: string;
  };
  readonly retryDecisions: readonly {
    readonly decision: string;
    readonly nodeId: string;
    readonly scope: string;
  }[];
  readonly routingDecisions: readonly {
    readonly nodeId: string;
    readonly target: string;
  }[];
  readonly skipped: readonly string[];
  readonly unchanged: readonly string[];
  readonly validatorResults: {
    readonly baseline: readonly MockValidatorOutcome[];
    readonly optimized: readonly MockValidatorOutcome[];
    readonly retryScenario: readonly MockValidatorOutcome[];
  };
  readonly version: typeof V0_BENCHMARK_REPORT_VERSION;
  readonly warnings: readonly string[];
}

const generatedAt = "2026-01-01T00:00:03.000Z";
const retryScenarioEvidenceRef = "evidence://bundle/rag-retry-scenario";

export async function createV0BenchmarkReport(
  baselinePlan: MIRPlan,
): Promise<V0BenchmarkReport> {
  const baseline = await runRagBaseline(baselinePlan);
  const optimized = await runRagOptimized(baselinePlan);
  const retryScenario = await runRagRetryScenario(baselinePlan);
  const baselineMetrics = createRunMetrics({
    evidenceBundleRef: baseline.reportData.evidenceBundleRef,
    planId: baseline.reportData.planId,
    replayHandle: baseline.reportData.replayHandle,
    validatorResults: baseline.reportData.validatorResults,
    ...(baseline.reportData.costEstimateUsd !== undefined
      ? { costEstimateUsd: baseline.reportData.costEstimateUsd }
      : {}),
    ...(baseline.reportData.latencyMs !== undefined
      ? { latencyMs: baseline.reportData.latencyMs }
      : {}),
    ...(baseline.reportData.tokenEstimate !== undefined
      ? { tokenEstimate: baseline.reportData.tokenEstimate }
      : {}),
  });
  const optimizedMetrics = createRunMetrics({
    evidenceBundleRef: optimized.reportData.evidenceBundleRef,
    planId: optimized.reportData.planId,
    replayHandle: optimized.reportData.replayHandle,
    validatorResults: optimized.reportData.validatorResults,
    ...(optimized.reportData.costEstimateUsd !== undefined
      ? { costEstimateUsd: optimized.reportData.costEstimateUsd }
      : {}),
    ...(optimized.reportData.latencyMs !== undefined
      ? { latencyMs: optimized.reportData.latencyMs }
      : {}),
    ...(optimized.reportData.tokenEstimate !== undefined
      ? { tokenEstimate: optimized.reportData.tokenEstimate }
      : {}),
  });
  const deltas = createDeltas(baselineMetrics, optimizedMetrics);
  const warnings = uniqueSorted(optimized.reportData.warningCodes);

  return {
    acceptanceCriteria: createAcceptanceCriteria({
      baseline: baselineMetrics,
      deltas,
      optimized: optimizedMetrics,
      retryOnlyNodeIds: retryScenario.retryAttempt.executedNodeIds,
      warnings,
    }),
    changed: [
      "Exact duplicate retrieved context was removed before ranking.",
      "Ranking was routed to the deterministic mock ranker.",
      "Source-grounding failure retries only synthesis and validation.",
    ],
    claims: {
      canClaim: [
        "The optimized mock-backed fixture uses fewer estimated tokens.",
        "The optimized mock-backed fixture keeps validator pass rate at 1.",
        "The optimized run and retry scenario are replayable and evidence-backed.",
      ],
      cannotClaim: [
        "Identical answer quality across live providers.",
        "Live-provider cost or latency improvement.",
        "Semantic compression or semantic caching behavior.",
      ],
    },
    evidence: {
      baseline: baseline.reportData.evidenceBundleRef,
      optimized: optimized.reportData.evidenceBundleRef,
      retryScenario: retryScenarioEvidenceRef,
    },
    generatedAt,
    limitations: [
      "mock execution only",
      "no live-provider benchmark",
      "no identical-answer claim",
    ],
    metrics: {
      baseline: baselineMetrics,
      deltas,
      optimized: optimizedMetrics,
    },
    passes: optimized.reportData.passNames,
    plans: {
      baseline: baseline.reportData.planId,
      optimized: optimized.reportData.planId,
      planDiffChangeCount: optimized.reportData.planDiffChangeCount,
    },
    replayArtifacts: {
      baseline: baseline.reportData.replayHandle,
      optimized: optimized.reportData.replayHandle,
    },
    retryDecisions: optimized.reportData.retryDecisions,
    routingDecisions: optimized.reportData.routingDecisions,
    skipped: [
      "No semantic compression.",
      "No semantic caching.",
      "No learned routing.",
      "No live-provider benchmark.",
    ],
    unchanged: [
      "Required source-grounding validator remains enforced.",
      "Evidence export remains metadata-only.",
      "Provider execution remains deterministic mock-backed.",
    ],
    validatorResults: {
      baseline: baseline.reportData.validatorResults,
      optimized: optimized.reportData.validatorResults,
      retryScenario: [
        ...retryScenario.firstAttempt.validatorResults,
        ...retryScenario.retryAttempt.validatorResults,
      ],
    },
    version: V0_BENCHMARK_REPORT_VERSION,
    warnings,
  };
}

export function renderV0BenchmarkReport(report: V0BenchmarkReport): string {
  return [
    "Migaki v0 Benchmark Report",
    `Baseline: ${report.plans.baseline}`,
    `Optimized: ${report.plans.optimized}`,
    `Token estimate: ${formatMetricDelta(
      report.metrics.baseline.tokenEstimate,
      report.metrics.optimized.tokenEstimate,
      report.metrics.deltas.tokenEstimate,
    )}`,
    `Cost estimate USD: ${formatMetricDelta(
      report.metrics.baseline.costEstimateUsd,
      report.metrics.optimized.costEstimateUsd,
      report.metrics.deltas.costEstimateUsd,
    )}`,
    `Latency ms: ${formatMetricDelta(
      report.metrics.baseline.latencyMs,
      report.metrics.optimized.latencyMs,
      report.metrics.deltas.latencyMs,
    )}`,
    `Validator pass rate: ${formatMetricDelta(
      report.metrics.baseline.validatorPassRate,
      report.metrics.optimized.validatorPassRate,
      report.metrics.deltas.validatorPassRate,
    )}`,
    `Plan diff changes: ${report.plans.planDiffChangeCount}`,
    `Replay: ${report.replayArtifacts.baseline} | ${report.replayArtifacts.optimized}`,
    `Passes: ${report.passes.join(", ")}`,
    `Routing: ${report.routingDecisions
      .map((decision) => `${decision.nodeId} -> ${decision.target}`)
      .join(", ")}`,
    `Retry: ${report.retryDecisions
      .map(
        (decision) =>
          `${decision.nodeId} ${decision.decision} ${decision.scope}`,
      )
      .join(", ")}`,
    `Warnings: ${report.warnings.join(", ")}`,
    `Criteria: passed ${
      report.acceptanceCriteria.filter((criterion) => criterion.passed).length
    }/${report.acceptanceCriteria.length}`,
    `Limitations: ${report.limitations.join("; ")}`,
    "",
  ].join("\n");
}

export function serializeV0BenchmarkReport(report: V0BenchmarkReport): string {
  return `${JSON.stringify(toStableJsonValue(report), null, 2)}\n`;
}

function createRunMetrics(input: {
  readonly costEstimateUsd?: number;
  readonly evidenceBundleRef: string;
  readonly latencyMs?: number;
  readonly planId: string;
  readonly replayHandle: string;
  readonly tokenEstimate?: number;
  readonly validatorResults: readonly MockValidatorOutcome[];
}): V0BenchmarkRunMetrics {
  return {
    evidenceBundleRef: input.evidenceBundleRef,
    planId: input.planId,
    replayHandle: input.replayHandle,
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

function createDeltas(
  baseline: V0BenchmarkRunMetrics,
  optimized: V0BenchmarkRunMetrics,
): V0BenchmarkDeltas {
  return {
    validatorPassRate: optimized.validatorPassRate - baseline.validatorPassRate,
    ...(baseline.costEstimateUsd !== undefined &&
    optimized.costEstimateUsd !== undefined
      ? {
          costEstimateUsd: optimized.costEstimateUsd - baseline.costEstimateUsd,
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
  readonly baseline: V0BenchmarkRunMetrics;
  readonly deltas: V0BenchmarkDeltas;
  readonly optimized: V0BenchmarkRunMetrics;
  readonly retryOnlyNodeIds: readonly string[];
  readonly warnings: readonly string[];
}): readonly V0BenchmarkAcceptanceCriterion[] {
  return [
    {
      actual: formatOptionalNumber(input.deltas.tokenEstimate),
      id: "token_delta",
      passed:
        input.baseline.tokenEstimate !== undefined &&
        input.optimized.tokenEstimate !== undefined &&
        input.optimized.tokenEstimate < input.baseline.tokenEstimate,
      threshold: "optimized token estimate must be lower than baseline",
    },
    {
      actual: formatOptionalNumber(input.deltas.costEstimateUsd),
      id: "cost_delta",
      passed:
        input.deltas.costEstimateUsd !== undefined &&
        input.deltas.costEstimateUsd <= 0,
      threshold: "optimized estimated cost must not exceed baseline",
    },
    {
      actual: formatOptionalNumber(input.deltas.latencyMs),
      id: "latency_delta",
      passed:
        input.deltas.latencyMs !== undefined && input.deltas.latencyMs <= 0,
      threshold: "optimized deterministic latency must not exceed baseline",
    },
    {
      actual: String(input.optimized.validatorPassRate),
      id: "validator_pass_rate",
      passed:
        input.optimized.validatorPassRate >= input.baseline.validatorPassRate &&
        input.optimized.validatorPassRate === 1,
      threshold: "optimized validator pass rate must remain 1",
    },
    {
      actual: input.retryOnlyNodeIds.join(","),
      id: "retry_scope",
      passed:
        input.retryOnlyNodeIds.join(",") === "node-synthesize,node-validate",
      threshold: "source-grounding retry must not rerun retrieval or ranking",
    },
  ];
}

function validatorPassRate(results: readonly MockValidatorOutcome[]): number {
  if (results.length === 0) {
    return 0;
  }

  const passed = results.filter((result) => result.status === "passed").length;

  return passed / results.length;
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
