#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertMIRPlan, type MIRPlan } from "@migaki/mir";

import {
  createV0BenchmarkReport,
  type V0BenchmarkReport,
} from "./benchmark.js";
import { runRagOptimized } from "./optimized.js";

export const RAG_FEATURE_SMOKE_REPORT_VERSION =
  "migaki.example.rag-feature-smoke.v0";

export type RagFeatureSmokeStatus = "failed" | "passed";

export interface RagFeatureSmokeFeature {
  readonly actual: string;
  readonly id: string;
  readonly passed: boolean;
  readonly required: string;
}

export interface RagFeatureSmokeReport {
  readonly evidence: {
    readonly baselineBundle: string;
    readonly optimizedBundle: string;
    readonly replay: string;
  };
  readonly features: readonly RagFeatureSmokeFeature[];
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly metrics: {
    readonly latencyDeltaMs?: number;
    readonly optimizedValidatorPassRate: number;
    readonly tokenDelta?: number;
  };
  readonly status: RagFeatureSmokeStatus;
  readonly version: typeof RAG_FEATURE_SMOKE_REPORT_VERSION;
  readonly warnings: readonly string[];
}

const generatedAt = "2026-01-01T00:00:04.000Z";

export async function createRagFeatureSmokeReport(
  baselinePlan: MIRPlan,
): Promise<RagFeatureSmokeReport> {
  const [benchmark, optimized] = await Promise.all([
    createV0BenchmarkReport(baselinePlan),
    runRagOptimized(baselinePlan),
  ]);
  const features = createFeatureChecks({ benchmark, optimized });
  const status = features.every((feature) => feature.passed)
    ? "passed"
    : "failed";

  return {
    evidence: {
      baselineBundle: benchmark.evidence.baseline,
      optimizedBundle: benchmark.evidence.optimized,
      replay: `${benchmark.replayArtifacts.baseline} | ${benchmark.replayArtifacts.optimized}`,
    },
    features,
    generatedAt,
    limitations: benchmark.limitations,
    metrics: {
      ...(benchmark.metrics.deltas.latencyMs !== undefined
        ? { latencyDeltaMs: benchmark.metrics.deltas.latencyMs }
        : {}),
      optimizedValidatorPassRate: benchmark.metrics.optimized.validatorPassRate,
      ...(benchmark.metrics.deltas.tokenEstimate !== undefined
        ? { tokenDelta: benchmark.metrics.deltas.tokenEstimate }
        : {}),
    },
    status,
    version: RAG_FEATURE_SMOKE_REPORT_VERSION,
    warnings: benchmark.warnings,
  };
}

export function renderRagFeatureSmokeReport(
  report: RagFeatureSmokeReport,
): string {
  return [
    "Migaki RAG Feature Smoke",
    `Status: ${report.status}`,
    `Features: passed ${report.features.filter((feature) => feature.passed).length}/${report.features.length}`,
    ...report.features.map(
      (feature) =>
        `- [${feature.passed ? "pass" : "fail"}] ${feature.id}: ${feature.required} (${feature.actual})`,
    ),
    `Token delta: ${formatOptionalNumber(report.metrics.tokenDelta)}`,
    `Latency delta ms: ${formatOptionalNumber(report.metrics.latencyDeltaMs)}`,
    `Optimized validator pass rate: ${report.metrics.optimizedValidatorPassRate}`,
    `Evidence: ${report.evidence.baselineBundle} | ${report.evidence.optimizedBundle}`,
    `Replay: ${report.evidence.replay}`,
    `Warnings: ${report.warnings.join(", ")}`,
    `Limitations: ${report.limitations.join("; ")}`,
    "",
  ].join("\n");
}

export function serializeRagFeatureSmokeReport(
  report: RagFeatureSmokeReport,
): string {
  return `${JSON.stringify(toStableJsonValue(report), null, 2)}\n`;
}

async function loadBaselinePlan(): Promise<MIRPlan> {
  return assertMIRPlan(
    JSON.parse(
      await readFile(
        new URL(
          "../../../packages/mir/src/examples/rag-baseline.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function createFeatureChecks(input: {
  readonly benchmark: V0BenchmarkReport;
  readonly optimized: Awaited<ReturnType<typeof runRagOptimized>>;
}): readonly RagFeatureSmokeFeature[] {
  const acceptancePassed = input.benchmark.acceptanceCriteria.filter(
    (criterion) => criterion.passed,
  ).length;
  const retryScope = input.benchmark.acceptanceCriteria.find(
    (criterion) => criterion.id === "retry_scope",
  );
  const stablePrefixReported = input.optimized.evidenceBundle.events.some(
    (event) =>
      event.kind === "context_change" &&
      event.summary.startsWith("Stable prefix opportunity"),
  );
  const promptCacheReported = input.optimized.evidenceBundle.events.some(
    (event) =>
      event.kind === "context_change" &&
      event.summary.includes("prompt-cache layout opportunity"),
  );

  return [
    {
      actual: input.optimized.reportData.duplicateContextRemoved.join(","),
      id: "duplicate_context_elimination",
      passed: input.optimized.reportData.duplicateContextRemoved.includes(
        "ctx-chunk-evidence-copy",
      ),
      required: "remove exact duplicate retrieved context",
    },
    {
      actual: stablePrefixReported
        ? "stable-prefix evidence present"
        : "stable-prefix evidence missing",
      id: "stable_prefix_detection",
      passed: stablePrefixReported,
      required: "record stable system/developer prefix opportunity",
    },
    {
      actual: promptCacheReported
        ? "prompt-cache layout evidence present"
        : "prompt-cache layout evidence missing",
      id: "prompt_cache_layout_reporting",
      passed: promptCacheReported,
      required: "report provider-aware prompt-cache layout",
    },
    {
      actual: retryScope?.actual ?? "missing",
      id: "source_grounding_retry_scope",
      passed: retryScope?.passed ?? false,
      required: "retry only synthesis and validation after grounding failure",
    },
    {
      actual: `${acceptancePassed}/${input.benchmark.acceptanceCriteria.length}`,
      id: "benchmark_acceptance",
      passed: acceptancePassed === input.benchmark.acceptanceCriteria.length,
      required: "all v0 benchmark acceptance criteria pass",
    },
  ];
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .flatMap((key) => {
          const nested = value[key];

          return nested === undefined ? [] : [[key, toStableJsonValue(nested)]];
        }),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      [
        "Usage: scripts/migaki-feature-smoke [--json]",
        "",
        "Run the deterministic RAG feature smoke and fail if any feature check fails.",
        "",
        "Options:",
        "  --json      Print the stable JSON report instead of text.",
        "  -h, --help  Show this help.",
        "",
      ].join("\n"),
    );
    return;
  }

  const unknown = args.find((arg) => arg !== "--json");

  if (unknown !== undefined) {
    process.stderr.write(`Unknown argument: ${unknown}\n`);
    process.exitCode = 2;
    return;
  }

  const report = await createRagFeatureSmokeReport(await loadBaselinePlan());
  const output = args.includes("--json")
    ? serializeRagFeatureSmokeReport(report)
    : renderRagFeatureSmokeReport(report);

  process.stdout.write(output);

  if (report.status !== "passed") {
    process.exitCode = 1;
  }
}

function isCliEntrypoint(): boolean {
  const invokedPath = process.argv[1];

  if (invokedPath === undefined) {
    return false;
  }

  const modulePath = fileURLToPath(import.meta.url);

  try {
    return realpathSync(invokedPath) === realpathSync(modulePath);
  } catch {
    return resolve(invokedPath) === modulePath;
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    process.stderr.write(
      error instanceof Error ? `${error.message}\n` : "Feature smoke failed.\n",
    );
    process.exitCode = 1;
  });
}
