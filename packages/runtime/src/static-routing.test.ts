import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";

import { staticRoutingPolicyPass } from "./index.js";

const passContext = {
  runId: "static-routing-test-run",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("staticRoutingPolicyPass", () => {
  it("routes explicitly eligible ranking nodes to configured providers", async () => {
    const result = await staticRoutingPolicyPass.apply(
      createPlan(),
      passContext,
    );

    expect(result.warnings).toEqual([]);
    expect(
      result.evidence.find((event) => event.kind === "routing_decision"),
    ).toMatchObject({
      routingDecision: {
        nodeId: "node-rank",
        reason: "Low-risk ranking node satisfies static routing policy.",
        target: "mock/mock-ranker",
      },
    });
  });

  it("skips synthesis nodes even when a routing candidate is configured", async () => {
    const result = await staticRoutingPolicyPass.apply(
      createPlan({
        task: "synthesis",
      }),
      passContext,
    );

    expect(result.evidence).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: "static_routing_ineligible_task",
        severity: "warning",
      },
    ]);
  });

  it("blocks denied fallback providers", async () => {
    const result = await staticRoutingPolicyPass.apply(
      createPlan({
        deniedProviders: ["mock"],
      }),
      passContext,
    );

    expect(result.evidence).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: "static_routing_provider_denied",
        severity: "warning",
      },
    ]);
  });

  it("blocks routing when required validators are missing", async () => {
    const result = await staticRoutingPolicyPass.apply(
      createPlan({
        availableValidators: [],
      }),
      passContext,
    );

    expect(result.evidence).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: "static_routing_validator_missing",
        severity: "warning",
      },
    ]);
  });
});

function createPlan(
  options: {
    readonly allowedProviders?: readonly string[];
    readonly availableValidators?: readonly string[];
    readonly deniedProviders?: readonly string[];
    readonly task?: "classification" | "ranking" | "synthesis";
  } = {},
): MIRPlan {
  return {
    id: "static-routing-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {
      allowedProviders: options.allowedProviders ?? ["mock"],
      ...(options.deniedProviders !== undefined
        ? { deniedProviders: options.deniedProviders }
        : {}),
      requiredValidators: options.availableValidators ?? ["rank-validator"],
    },
    context: [],
    nodes: [
      {
        id: "node-rank",
        kind: "model_call",
        metadata: {
          staticRouting: {
            candidates: [
              {
                model: "mock-ranker",
                provider: "mock",
              },
            ],
            requiredValidators: ["rank-validator"],
          },
        },
        model: {
          task: options.task ?? "ranking",
        },
      },
    ],
    edges: [],
  };
}
