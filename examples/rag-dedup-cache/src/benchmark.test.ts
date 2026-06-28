import { describe, expect, it } from "vitest";

import { assertMIRPlan } from "@migaki/mir";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  createV0BenchmarkReport,
  renderV0BenchmarkReport,
  serializeV0BenchmarkReport,
} from "./index.js";

describe("v0 benchmark report", () => {
  it("renders deterministic baseline versus optimized proof data", async () => {
    const report = await createV0BenchmarkReport(await loadBaselinePlan());
    const serialized = serializeV0BenchmarkReport(report);

    expect(JSON.parse(serialized)).toEqual(report);
    expect(report.metrics).toEqual({
      baseline: {
        costEstimateUsd: 0,
        evidenceBundleRef: "evidence://bundle/rag-baseline",
        latencyMs: 37,
        planId: "rag-baseline",
        replayHandle: "trace://trace-rag-baseline",
        tokenEstimate: 155,
        validatorPassRate: 1,
      },
      deltas: {
        costEstimateUsd: 0,
        latencyMs: -6,
        tokenEstimate: -26,
        validatorPassRate: 0,
      },
      optimized: {
        costEstimateUsd: 0,
        evidenceBundleRef: "evidence://bundle/rag-optimized",
        latencyMs: 31,
        planId: "rag-optimized",
        replayHandle: "trace://trace-rag-optimized",
        tokenEstimate: 129,
        validatorPassRate: 1,
      },
    });
    expect(
      report.acceptanceCriteria.map((criterion) => criterion.passed),
    ).toEqual([true, true, true, true, true]);
    expect(report.claims.cannotClaim).toContain(
      "Identical answer quality across live providers.",
    );
    expect(renderV0BenchmarkReport(report)).toEqual(
      [
        "Migaki v0 Benchmark Report",
        "Baseline: rag-baseline",
        "Optimized: rag-optimized",
        "Token estimate: 155 -> 129 (-26)",
        "Cost estimate USD: 0 -> 0 (0)",
        "Latency ms: 37 -> 31 (-6)",
        "Validator pass rate: 1 -> 1 (0)",
        "Plan diff changes: 7",
        "Replay: trace://trace-rag-baseline | trace://trace-rag-optimized",
        "Passes: migaki.context.exact_duplicate_elimination, migaki.context.stable_prefix_detection, migaki.context.prompt_cache_layout_reporting, migaki.runtime.static_routing_policy, migaki.runtime.retry_fallback_planning",
        "Routing: node-rank -> mock/mock-ranker",
        "Retry: node-synthesize retry node",
        "Warnings: prompt_cache_provider_unsupported, stable_prefix_candidate_skipped, stable_prefix_provider_report_only",
        "Criteria: passed 5/5",
        "Limitations: mock execution only; no live-provider benchmark; no identical-answer claim",
        "",
      ].join("\n"),
    );
  });
});

async function loadBaselinePlan() {
  return assertMIRPlan(
    await readJsonFixture(
      new URL(
        "../../../packages/mir/src/examples/rag-baseline.json",
        import.meta.url,
      ),
    ),
  );
}
