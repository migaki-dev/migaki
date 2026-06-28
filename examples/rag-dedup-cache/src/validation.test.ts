import { describe, expect, it } from "vitest";

import { assertMIRPlan } from "@migaki/mir";
import { parseEvidenceBundle, serializeEvidenceBundle } from "@migaki/runtime";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  createRagBaselineFixture,
  runRagRetryScenario,
  validateRagSourceGrounding,
} from "./index.js";

describe("RAG source-grounding validation", () => {
  it("passes cited answers and catches unsupported fixture claims", () => {
    const fixture = createRagBaselineFixture();

    expect(
      validateRagSourceGrounding({
        answer: fixture.answer,
        chunks: fixture.chunks,
      }),
    ).toMatchObject({
      citedChunkIds: ["chunk-plan", "chunk-evidence"],
      status: "passed",
      unsupportedClaims: [],
      validatorId: "validator-source-grounding",
    });
    expect(
      validateRagSourceGrounding({
        answer:
          "Migaki guarantees identical answers after optimization [migaki-guide#1].",
        chunks: fixture.chunks,
      }),
    ).toMatchObject({
      status: "failed",
      unsupportedClaims: [
        "Claim 'guarantees identical answers' is not supported by cited chunks.",
      ],
    });
  });

  it("retries only synthesis after source-grounding failure and records evidence", async () => {
    const scenario = await runRagRetryScenario(await loadBaselinePlan());
    const serializedEvidence = serializeEvidenceBundle(scenario.evidenceBundle);

    expect(scenario.firstAttempt.executedNodeIds).toEqual([
      "node-retrieve",
      "node-rank",
      "node-synthesize",
      "node-validate",
      "node-cache-write",
      "node-join",
    ]);
    expect(scenario.firstAttempt.validatorResults).toMatchObject([
      {
        status: "failed",
        validatorId: "validator-source-grounding",
      },
    ]);
    expect(scenario.retryAttempt.executedNodeIds).toEqual([
      "node-synthesize",
      "node-validate",
    ]);
    expect(scenario.retryAttempt.validatorResults).toMatchObject([
      {
        status: "passed",
        validatorId: "validator-source-grounding",
      },
    ]);
    expect(parseEvidenceBundle(serializedEvidence)).toEqual(
      scenario.evidenceBundle,
    );
    expect(scenario.evidenceBundle.validatorResults).toMatchObject([
      {
        validatorResult: {
          status: "failed",
          validatorId: "validator-source-grounding",
        },
      },
      {
        validatorResult: {
          status: "passed",
          validatorId: "validator-source-grounding",
        },
      },
    ]);
    expect(scenario.evidenceBundle.retryFallbackDecisions).toMatchObject([
      {
        retryFallbackDecision: {
          decision: "retry",
          nodeId: "node-synthesize",
          scope: "node",
        },
      },
    ]);
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
