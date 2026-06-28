import { describe, expect, it } from "vitest";

import { assertMIRPlan } from "@migaki/mir";
import {
  parseEvidenceBundle,
  parseMockExecutionTraceArtifact,
  replayMockExecutionTrace,
  serializeEvidenceBundle,
  serializeMockExecutionTraceArtifact,
} from "@migaki/runtime";

import { readJsonFixture } from "../../../src/testing/index.js";
import { runRagBaseline, runRagOptimized } from "./index.js";

describe("RAG optimized pipeline", () => {
  it("runs safe v0 passes and captures replayable optimized evidence", async () => {
    const baselinePlan = await loadBaselinePlan();
    const baseline = await runRagBaseline(baselinePlan);
    const optimized = await runRagOptimized(baselinePlan);
    const replay = await replayMockExecutionTrace(
      parseMockExecutionTraceArtifact(
        serializeMockExecutionTraceArtifact(optimized.trace),
      ),
    );
    const serializedEvidence = serializeEvidenceBundle(
      optimized.evidenceBundle,
    );

    expect(
      optimized.optimizationInputPlan.context.map((block) => block.id),
    ).toContain("ctx-chunk-evidence-copy");
    expect(
      optimized.optimizedPlan.context.map((block) => block.id),
    ).not.toContain("ctx-chunk-evidence-copy");
    expect(
      optimized.optimizedPlan.nodes.find((node) => node.id === "node-rank"),
    ).toMatchObject({
      inputContext: [
        "ctx-question",
        "ctx-chunk-plan",
        "ctx-chunk-evidence",
        "ctx-chunk-cache",
        "ctx-chunk-replay",
      ],
    });
    expect(replay).toMatchObject({
      mismatches: [],
      status: "matched",
      traceId: "trace-rag-optimized",
    });
    expect(parseEvidenceBundle(serializedEvidence)).toEqual(
      optimized.evidenceBundle,
    );
    expect(optimized.reportData.tokenEstimate).toBeLessThan(
      baseline.reportData.tokenEstimate ?? Number.POSITIVE_INFINITY,
    );
    expect(optimized.reportData).toMatchObject({
      duplicateContextRemoved: ["ctx-chunk-evidence-copy"],
      evidenceBundleRef: "evidence://bundle/rag-optimized",
      passNames: [
        "migaki.context.exact_duplicate_elimination",
        "migaki.context.stable_prefix_detection",
        "migaki.context.prompt_cache_layout_reporting",
        "migaki.runtime.static_routing_policy",
        "migaki.runtime.retry_fallback_planning",
      ],
      replayHandle: "trace://trace-rag-optimized",
      routingDecisions: [
        {
          nodeId: "node-rank",
          target: "mock/mock-ranker",
        },
      ],
      retryDecisions: [
        {
          decision: "retry",
          nodeId: "node-synthesize",
          scope: "node",
        },
      ],
      traceId: "trace-rag-optimized",
      warningCodes: expect.arrayContaining([
        "prompt_cache_provider_unsupported",
        "stable_prefix_candidate_skipped",
      ]),
    });
    expect(optimized.evidenceBundle.planDiff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: "ctx-chunk-evidence-copy",
          kind: "context_removed",
        }),
      ]),
    );
    expect(
      optimized.evidenceBundle.events.filter(
        (event) => event.kind === "routing_decision",
      ),
    ).toHaveLength(1);
    expect(
      optimized.evidenceBundle.events.filter(
        (event) => event.kind === "retry_fallback_decision",
      ),
    ).toHaveLength(1);
    expect(
      optimized.evidenceBundle.events.filter(
        (event) =>
          event.kind === "context_change" && event.summary.includes("cache"),
      ).length,
    ).toBeGreaterThan(0);
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
