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
import { createRagBaselineFixture, runRagBaseline } from "./index.js";

describe("RAG baseline fixture", () => {
  it("includes cited chunks with intentional exact duplicates", () => {
    const fixture = createRagBaselineFixture();
    const duplicateGroup = fixture.duplicateGroups[0];

    expect(fixture.chunks.map((chunk) => chunk.citation)).toEqual([
      "migaki-guide#1",
      "migaki-guide#2",
      "migaki-guide#3",
      "migaki-guide#4",
      "migaki-guide#5",
    ]);
    expect(duplicateGroup).toEqual({
      chunkIds: ["chunk-evidence", "chunk-evidence-copy"],
      reason: "Exact duplicate retrieved from overlapping document windows.",
    });
    expect(
      fixture.chunks.find((chunk) => chunk.id === "chunk-evidence")?.text,
    ).toBe(
      fixture.chunks.find((chunk) => chunk.id === "chunk-evidence-copy")?.text,
    );
  });

  it("runs the naive baseline through the mock backend with replayable evidence", async () => {
    const plan = await loadBaselinePlan();
    const run = await runRagBaseline(plan);
    const replay = await replayMockExecutionTrace(
      parseMockExecutionTraceArtifact(
        serializeMockExecutionTraceArtifact(run.trace),
      ),
    );
    const serializedEvidence = serializeEvidenceBundle(run.evidenceBundle);

    expect(run.result).toMatchObject({
      status: "succeeded",
      usage: {
        costUsd: 0,
        inputTokens: 1280,
        latencyMs: 37,
        outputTokens: 1380,
      },
    });
    expect(replay).toMatchObject({
      mismatches: [],
      status: "matched",
      traceId: "trace-rag-baseline",
    });
    expect(parseEvidenceBundle(serializedEvidence)).toEqual(run.evidenceBundle);
    expect(run.reportData).toEqual({
      costEstimateUsd: 0,
      duplicateChunkGroups: [["chunk-evidence", "chunk-evidence-copy"]],
      evidenceBundleRef: "evidence://bundle/rag-baseline",
      latencyMs: 37,
      planId: "rag-baseline",
      replayHandle: "trace://trace-rag-baseline",
      tokenEstimate: 155,
      traceId: "trace-rag-baseline",
      validatorResults: [
        {
          status: "passed",
          targetRef: "ctx-answer",
          validatorId: "validator-source-grounding",
        },
      ],
    });
    expect(run.evidenceBundle).toMatchObject({
      costEstimates: [
        {
          estimate: {
            estimateKind: "cost",
            unit: "usd",
            value: 0,
          },
        },
      ],
      estimates: [
        {
          estimate: {
            estimateKind: "token",
            unit: "tokens",
            value: 155,
          },
        },
        {
          estimate: {
            estimateKind: "cost",
            unit: "usd",
            value: 0,
          },
        },
        {
          estimate: {
            estimateKind: "latency",
            unit: "milliseconds",
            value: 37,
          },
        },
      ],
      replay: {
        handles: [
          {
            kind: "trace",
            ref: "trace://trace-rag-baseline",
          },
        ],
        mode: "metadata",
      },
      runId: "rag-baseline",
      validatorResults: [
        {
          validatorResult: {
            status: "passed",
            targetRef: "ctx-answer",
            validatorId: "validator-source-grounding",
          },
        },
      ],
    });
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
