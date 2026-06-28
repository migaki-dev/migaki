import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRConstraints, type MIRPlan } from "@migaki/mir";
import { lookupProviderCapabilities } from "@migaki/providers";

import { evaluateOptimizationConstraints } from "./index.js";

const basePlan = {
  id: "constraint-plan",
  version: MIR_V0_VERSION,
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  constraints: {},
  context: [],
  nodes: [],
  edges: [],
} satisfies MIRPlan;

describe("evaluateOptimizationConstraints", () => {
  it.each([
    {
      constraints: { maxCostUsd: 1 },
      estimates: { costUsd: 2 },
      code: "cost_exceeded",
      path: "$.constraints.maxCostUsd",
    },
    {
      constraints: { maxLatencyMs: 100 },
      estimates: { latencyMs: 101 },
      code: "latency_exceeded",
      path: "$.constraints.maxLatencyMs",
    },
    {
      constraints: { minEvalScore: 0.9 },
      estimates: { evalScore: 0.89 },
      code: "eval_score_too_low",
      path: "$.constraints.minEvalScore",
    },
    {
      constraints: { minValidatorPassRate: 0.95 },
      estimates: { validatorPassRate: 0.9 },
      code: "validator_pass_rate_too_low",
      path: "$.constraints.minValidatorPassRate",
    },
    {
      constraints: { allowedRegression: 0.05 },
      estimates: { regression: 0.06 },
      code: "regression_exceeded",
      path: "$.constraints.allowedRegression",
    },
  ] satisfies readonly {
    readonly code: string;
    readonly constraints: MIRConstraints;
    readonly estimates: Record<string, number>;
    readonly path: string;
  }[])(
    "blocks threshold violation $code",
    ({ code, constraints, estimates, path }) => {
      const result = evaluateOptimizationConstraints(
        createPlan({ constraints }),
        {
          estimates,
        },
      );

      expect(result.allowed).toBe(false);
      expect(result.failures).toMatchObject([
        {
          code,
          path,
        },
      ]);
      expect(result.evidence[0]).toMatchObject({
        kind: "policy_decision",
        policyDecision: {
          outcome: "blocked",
          policyRef: path,
        },
      });
    },
  );

  it("fails closed when a required threshold cannot be evaluated", () => {
    const result = evaluateOptimizationConstraints(
      createPlan({
        constraints: {
          maxCostUsd: 1,
        },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.failures).toEqual([
      {
        code: "constraint_unchecked",
        evidenceRef: "constraint-evidence-001",
        message:
          "Required constraint cannot be evaluated with available inputs.",
        path: "$.constraints.maxCostUsd",
        severity: "error",
      },
    ]);
  });

  it("checks allowed and denied providers against capability fixtures", () => {
    const mock = requireProvider("mock");
    const openAiStyle = requireProvider("openai-style");

    expect(
      evaluateOptimizationConstraints(
        createPlan({
          constraints: {
            allowedProviders: ["mock"],
            deniedProviders: ["openai-style"],
          },
        }),
        {
          providerCapabilities: [mock],
        },
      ).allowed,
    ).toBe(true);

    const result = evaluateOptimizationConstraints(
      createPlan({
        constraints: {
          allowedProviders: ["mock"],
          deniedProviders: ["openai-style"],
        },
      }),
      {
        providerCapabilities: [openAiStyle],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "provider_not_allowed",
      "provider_denied",
    ]);
  });

  it("checks replay, audit, validator, retention, and privacy requirements", () => {
    const openAiStyle = requireProvider("openai-style");

    const result = evaluateOptimizationConstraints(
      {
        ...basePlan,
        constraints: {
          auditLevel: "evidence_bundle",
          dataPolicy: {
            allowPersistence: false,
            allowedPrivacyClasses: ["internal"],
            redactionRequired: true,
          },
          replayPolicy: "full_trace",
          requiredValidators: ["source-grounding"],
          retentionPolicy: {
            mode: "ephemeral",
          },
        },
        context: [
          {
            id: "secret-context",
            contentRef: "fixture://secret-context",
            mutability: "fixed",
            privacyClass: "secret",
            provenance: {
              source: "user",
            },
            retentionPolicy: {
              mode: "full",
            },
            role: "user_input",
          },
        ],
      },
      {
        availableValidatorIds: [],
        providerCapabilities: [openAiStyle],
        supportedAuditLevels: ["summary"],
        supportedReplayPolicies: ["metadata"],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "replay_policy_unsupported",
      "audit_level_unsupported",
      "retention_unavailable",
      "validator_missing",
      "privacy_class_not_allowed",
      "redaction_required",
    ]);
    expect(
      result.evidence.every((event) => event.kind === "policy_decision"),
    ).toBe(true);
  });
});

function createPlan(overrides: Partial<MIRPlan>): MIRPlan {
  return {
    ...basePlan,
    ...overrides,
  };
}

function requireProvider(fixtureId: string) {
  const capabilities = lookupProviderCapabilities(fixtureId);

  if (capabilities === undefined) {
    throw new Error(`Missing provider fixture ${fixtureId}.`);
  }

  return capabilities;
}
