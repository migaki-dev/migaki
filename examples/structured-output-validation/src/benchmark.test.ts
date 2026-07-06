import { describe, expect, it } from "vitest";

import {
  createStructuredOutputValidationReport,
  renderStructuredOutputValidationReport,
  serializeStructuredOutputValidationReport,
} from "./index.js";

describe("structured-output validation example", () => {
  it("reports deterministic baseline retries and Migaki provider fallback evidence", async () => {
    const report = await createStructuredOutputValidationReport();
    const serialized = serializeStructuredOutputValidationReport(report);

    expect(JSON.parse(serialized)).toEqual(report);
    expect(report.baseline).toMatchObject({
      attempts: 2,
      retryScope: "whole_prompt",
      retriedNodeIds: [
        "baseline-prompt-attempt-1",
        "baseline-parse-attempt-1",
        "baseline-prompt-attempt-2",
        "baseline-parse-attempt-2",
      ],
      schemaValid: true,
    });
    expect(report.migaki.native).toMatchObject({
      downgradeWarnings: [],
      providerCapabilityPath: "provider-native structured_outputs",
      provider: "openai-style",
      retryCount: 0,
      schemaValid: true,
    });
    expect(report.migaki.fallback).toMatchObject({
      downgradeWarnings: ["downgraded_capability:structured_outputs"],
      providerCapabilityPath: "post-validation fallback",
      provider: "anthropic-style",
      retryCount: 1,
      retryScopeNodeIds: ["node-extract"],
      schemaValid: true,
    });
    expect(
      report.acceptanceCriteria.map((criterion) => criterion.passed),
    ).toEqual([true, true, true, true, true]);
    expect(report.claims.cannotClaim).toContain(
      "Identical answers across providers.",
    );
    expect(renderStructuredOutputValidationReport(report)).toEqual(
      [
        "Migaki Structured Output Validation Report",
        "Baseline: whole_prompt retries=1 valid=true costPerValidResultUsd=0",
        "Native: openai-style provider-native structured_outputs retries=0 valid=true costPerValidResultUsd=0",
        "Fallback: anthropic-style post-validation fallback retries=1 valid=true costPerValidResultUsd=0",
        "Retry scope: node-extract",
        "Warnings: downgraded_capability:structured_outputs",
        "Criteria: passed 5/5",
        "Cannot claim: Identical answers across providers.; Live-provider cost or latency improvement.",
        "",
      ].join("\n"),
    );
  });
});
