import { describe, expect, it } from "vitest";

import {
  PROVIDER_CONTRACT_VERSION,
  checkProviderCapabilityRequirements,
  type ExecutionBackend,
  type ExecutionResult,
  type LoweredExecutionPlan,
  type ProviderCapabilities,
} from "./index.js";
import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";

const capabilityFixtures = [
  {
    version: PROVIDER_CONTRACT_VERSION,
    provider: "mock",
    backendKind: "mock",
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      note: "Deterministic local mock backend for tests.",
    },
    supportsPromptCaching: false,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: true,
    supportsBatching: false,
    supportsReasoningControls: false,
    supportsZeroDataRetention: true,
    maxContextTokens: 8192,
  },
  {
    version: PROVIDER_CONTRACT_VERSION,
    provider: "openai-style",
    backendKind: "openai_style",
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      note: "OpenAI-style capability fixture for request lowering tests.",
    },
    supportsPromptCaching: true,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: true,
    supportsToolCalling: true,
    supportsRemoteMCP: true,
    supportsStructuredOutputs: true,
    supportsBatching: true,
    supportsReasoningControls: true,
    supportsZeroDataRetention: false,
    maxContextTokens: 128000,
  },
  {
    version: PROVIDER_CONTRACT_VERSION,
    provider: "anthropic-style",
    backendKind: "anthropic_style",
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      note: "Anthropic-style capability fixture for request lowering tests.",
    },
    cacheTtlOptions: ["5m", "1h"],
    supportsPromptCaching: true,
    supportsExplicitCacheBreakpoints: true,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: false,
    supportsBatching: true,
    supportsReasoningControls: true,
    supportsZeroDataRetention: false,
    maxContextTokens: 200000,
  },
  {
    version: PROVIDER_CONTRACT_VERSION,
    provider: "litellm-compatible",
    backendKind: "litellm_compatible",
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      note: "Gateway-compatible fixture; gateway owns routing and connectivity.",
    },
    supportsPromptCaching: false,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: true,
    supportsBatching: false,
    supportsReasoningControls: false,
    supportsZeroDataRetention: false,
    maxContextTokens: 32000,
  },
] as const satisfies readonly ProviderCapabilities[];

const minimalPlan = {
  id: "provider-contract-plan",
  version: MIR_V0_VERSION,
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  constraints: {},
  context: [],
  nodes: [],
  edges: [],
} satisfies MIRPlan;

const mockBackend = {
  id: "mock-backend",
  provider: "mock",
  backendKind: "mock",
  capabilities: capabilityFixtures[0],
  async lower(plan: MIRPlan): Promise<LoweredExecutionPlan> {
    return {
      version: PROVIDER_CONTRACT_VERSION,
      id: "lowered-mock-plan",
      sourcePlanId: plan.id,
      backendId: "mock-backend",
      provider: "mock",
      assumptions: [
        {
          capability: "structured_outputs",
          description: "Mock backend returns deterministic structured output.",
        },
      ],
      steps: [],
      warnings: [],
    };
  },
  async execute(plan: LoweredExecutionPlan): Promise<ExecutionResult> {
    return {
      version: PROVIDER_CONTRACT_VERSION,
      loweredPlanId: plan.id,
      status: "succeeded",
      outputs: [],
      warnings: [],
    };
  },
} satisfies ExecutionBackend;

describe("provider backend contracts", () => {
  it("covers the v0 backend kinds with capability fixtures", () => {
    expect(capabilityFixtures.map((fixture) => fixture.backendKind)).toEqual([
      "mock",
      "openai_style",
      "anthropic_style",
      "litellm_compatible",
    ]);
  });

  it("supports a typed execution backend boundary", async () => {
    const loweredPlan = await mockBackend.lower(minimalPlan);
    const result = await mockBackend.execute(loweredPlan);

    expect(loweredPlan.sourcePlanId).toBe("provider-contract-plan");
    expect(result.status).toBe("succeeded");
  });

  it("fails closed when a required capability is unsupported", () => {
    const result = checkProviderCapabilityRequirements(capabilityFixtures[2], [
      {
        capability: "structured_outputs",
        required: true,
        reason: "Validator requires native structured output lowering.",
      },
    ]);

    expect(result).toEqual({
      supported: false,
      warnings: [
        {
          code: "unsupported_capability",
          severity: "error",
          capability: "structured_outputs",
          message: "Required provider capability is unavailable.",
          assumption: "Validator requires native structured output lowering.",
        },
      ],
    });
  });
});
