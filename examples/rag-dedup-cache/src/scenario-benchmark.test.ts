import { describe, expect, it } from "vitest";

import {
  parseEvidenceBundle,
  replayMockExecutionTrace,
  serializeEvidenceBundle,
} from "@migaki/runtime";

import {
  renderV0BenchmarkSuiteReport,
  runV0BenchmarkSuite,
  serializeV0BenchmarkSuiteReport,
} from "./index.js";

describe("v0 benchmark scenario matrix", () => {
  it("reports deterministic scenarios for when v0 optimization helps and does not help", async () => {
    const suite = await runV0BenchmarkSuite();
    const report = suite.report;

    expect(JSON.parse(serializeV0BenchmarkSuiteReport(report))).toEqual(report);
    expect(report.scenarios.map((scenario) => scenario.id)).toEqual([
      "no-duplicates-cache-absent-validator-pass",
      "low-duplicates-cache-unsupported-validator-fail",
      "high-duplicates-cache-supported-retry-recovery",
    ]);
    expect(
      report.scenarios.map((scenario) => scenario.dimensions),
    ).toMatchObject([
      {
        duplicateContextRatio: "none",
        stablePrefixCacheEligibility: "absent",
        validatorBehavior: "pass",
      },
      {
        duplicateContextRatio: "low",
        stablePrefixCacheEligibility: "eligible-provider-unsupported",
        validatorBehavior: "fail",
      },
      {
        duplicateContextRatio: "high",
        stablePrefixCacheEligibility: "eligible-provider-supported",
        validatorBehavior: "retry-scoped-recovery",
      },
    ]);
    expect(
      report.scenarios.flatMap((scenario) =>
        scenario.acceptanceCriteria.map((criterion) => criterion.passed),
      ),
    ).toEqual(
      report.scenarios.flatMap((scenario) =>
        scenario.acceptanceCriteria.map(() => true),
      ),
    );

    expect(report.scenarios[0]?.metrics.deltas).toMatchObject({
      costEstimateUsd: 0,
      latencyMs: 0,
      tokenEstimate: 0,
      validatorPassRate: 0,
    });
    expect(report.scenarios[0]?.passes.skipped).toEqual([
      "migaki.context.stable_prefix_detection",
      "migaki.context.prompt_cache_layout_reporting",
    ]);

    expect(report.scenarios[1]?.metrics.deltas).toMatchObject({
      costEstimateUsd: -0.00006,
      latencyMs: -6,
      tokenEstimate: -40,
      validatorPassRate: -1,
    });
    expect(report.scenarios[1]?.warnings).toEqual([
      "prompt_cache_provider_unsupported",
      "stable_prefix_candidate_skipped",
      "stable_prefix_provider_report_only",
    ]);
    expect(report.scenarios[1]?.lowering).toMatchObject({
      cacheBreakpointsLowered: 0,
      path: "litellm-compatible",
      warningCodes: ["downgraded_capability"],
    });

    expect(report.scenarios[2]?.metrics.deltas).toMatchObject({
      costEstimateUsd: -0.00024,
      latencyMs: 16,
      tokenEstimate: -120,
      validatorPassRate: 0,
    });
    expect(report.scenarios[2]?.retry).toEqual({
      firstAttemptValidatorPassRate: 0,
      recoveredValidatorPassRate: 1,
      scope: "node",
      retryExecutedNodeIds: ["node-synthesize", "node-validate"],
    });
    expect(report.scenarios[2]?.lowering).toMatchObject({
      cacheBreakpointsLowered: 1,
      path: "anthropic-style",
      warningCodes: [],
    });
    expect(report.claims.cannotClaim).toEqual(
      expect.arrayContaining([
        "Identical answers after optimization.",
        "Live-provider cost, latency, or quality savings.",
      ]),
    );
    expect(renderV0BenchmarkSuiteReport(report)).toContain(
      "Acceptance criteria:",
    );
  });

  it("returns replayable mock traces and parseable evidence bundles for every scenario", async () => {
    const suite = await runV0BenchmarkSuite();

    for (const scenario of suite.scenarioRuns) {
      expect(
        parseEvidenceBundle(serializeEvidenceBundle(scenario.evidenceBundle)),
      ).toEqual(scenario.evidenceBundle);

      for (const trace of scenario.traces) {
        await expect(replayMockExecutionTrace(trace)).resolves.toMatchObject({
          mismatches: [],
          status: "matched",
          traceId: trace.traceId,
        });
      }
    }
  });
});
