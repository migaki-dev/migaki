import { describe, expect, it } from "vitest";

import { assertMIRPlan } from "@migaki/mir";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  createRagFeatureSmokeReport,
  renderRagFeatureSmokeReport,
  serializeRagFeatureSmokeReport,
} from "./index.js";

describe("RAG feature smoke", () => {
  it("proves the real v0 RAG optimization features stay wired together", async () => {
    const report = await createRagFeatureSmokeReport(await loadBaselinePlan());
    const serialized = serializeRagFeatureSmokeReport(report);

    expect(JSON.parse(serialized)).toEqual(report);
    expect(report.status).toBe("passed");
    expect(report.features).toEqual([
      {
        actual: "ctx-chunk-evidence-copy",
        id: "duplicate_context_elimination",
        passed: true,
        required: "remove exact duplicate retrieved context",
      },
      {
        actual: "stable-prefix evidence present",
        id: "stable_prefix_detection",
        passed: true,
        required: "record stable system/developer prefix opportunity",
      },
      {
        actual: "prompt-cache layout evidence present",
        id: "prompt_cache_layout_reporting",
        passed: true,
        required: "report provider-aware prompt-cache layout",
      },
      {
        actual: "node-synthesize,node-validate",
        id: "source_grounding_retry_scope",
        passed: true,
        required: "retry only synthesis and validation after grounding failure",
      },
      {
        actual: "5/5",
        id: "benchmark_acceptance",
        passed: true,
        required: "all v0 benchmark acceptance criteria pass",
      },
    ]);
    expect(report.metrics).toEqual({
      latencyDeltaMs: -6,
      optimizedValidatorPassRate: 1,
      tokenDelta: -26,
    });
    expect(report.evidence).toEqual({
      baselineBundle: "evidence://bundle/rag-baseline",
      optimizedBundle: "evidence://bundle/rag-optimized",
      replay: "trace://trace-rag-baseline | trace://trace-rag-optimized",
    });
    expect(report.warnings).toEqual([
      "prompt_cache_provider_unsupported",
      "stable_prefix_candidate_skipped",
      "stable_prefix_provider_report_only",
    ]);
    expect(renderRagFeatureSmokeReport(report)).toEqual(
      [
        "Migaki RAG Feature Smoke",
        "Status: passed",
        "Features: passed 5/5",
        "- [pass] duplicate_context_elimination: remove exact duplicate retrieved context (ctx-chunk-evidence-copy)",
        "- [pass] stable_prefix_detection: record stable system/developer prefix opportunity (stable-prefix evidence present)",
        "- [pass] prompt_cache_layout_reporting: report provider-aware prompt-cache layout (prompt-cache layout evidence present)",
        "- [pass] source_grounding_retry_scope: retry only synthesis and validation after grounding failure (node-synthesize,node-validate)",
        "- [pass] benchmark_acceptance: all v0 benchmark acceptance criteria pass (5/5)",
        "Token delta: -26",
        "Latency delta ms: -6",
        "Optimized validator pass rate: 1",
        "Evidence: evidence://bundle/rag-baseline | evidence://bundle/rag-optimized",
        "Replay: trace://trace-rag-baseline | trace://trace-rag-optimized",
        "Warnings: prompt_cache_provider_unsupported, stable_prefix_candidate_skipped, stable_prefix_provider_report_only",
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
