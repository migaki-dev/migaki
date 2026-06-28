import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIRPlan,
} from "@migaki/mir";
import { lookupProviderCapabilities } from "@migaki/providers";

import {
  promptCacheLayoutReportingPass,
  PROMPT_CACHE_LAYOUT_VERSION,
} from "./index.js";

const baseContext = {
  runId: "prompt-cache-layout-test-run",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("promptCacheLayoutReportingPass", () => {
  it("reports explicit breakpoint layouts with cacheable token estimates", async () => {
    const anthropic = requireProvider("anthropic-style");
    const result = await promptCacheLayoutReportingPass.apply(createPlan(), {
      ...baseContext,
      providerCapabilities: [anthropic],
    });

    expect(result.plan.id).toBe("prompt-cache-plan");
    expect(result.evidence.slice(0, 3)).toMatchObject([
      {
        kind: "capability_assumption",
        capabilityAssumption: {
          capability: "prompt_caching",
          provider: "anthropic-style",
        },
      },
      {
        kind: "context_change",
        summary:
          "Explicit cache breakpoint opportunity for node node-model on anthropic-style.",
      },
      {
        kind: "estimate",
        estimate: {
          estimateKind: "token",
          unit: "tokens",
          value: 30,
        },
      },
    ]);
    expect(
      result.evidence.find((event) => event.kind === "capability_assumption"),
    ).toMatchObject({
      capabilityAssumption: {
        evidenceRef: `provider-capabilities://anthropic-style/${anthropic.version}/2026-01-01`,
      },
    });
    expect(result.evidence[0]?.refs).toContain(PROMPT_CACHE_LAYOUT_VERSION);
    expect(
      result.evidence.find(
        (event) =>
          event.kind === "estimate" && event.estimate.estimateKind === "cost",
      ),
    ).toMatchObject({
      kind: "estimate",
      estimate: {
        estimateKind: "cost",
        unit: "usd",
        value: 0.00006,
      },
    });
  });

  it("distinguishes automatic cache behavior from explicit breakpoint support", async () => {
    const openaiStyle = requireProvider("openai-style");
    const result = await promptCacheLayoutReportingPass.apply(createPlan(), {
      ...baseContext,
      providerCapabilities: [openaiStyle],
    });

    expect(result.evidence[0]).toMatchObject({
      kind: "capability_assumption",
      capabilityAssumption: {
        description:
          "Provider declares automatic prompt caching but no explicit cache breakpoints.",
      },
    });
    expect(
      result.evidence.find((event) => event.kind === "context_change"),
    ).toMatchObject({
      kind: "context_change",
      summary:
        "Automatic prompt-cache layout opportunity for node node-model on openai-style.",
    });
    expect(result.warnings).toMatchObject([
      {
        code: "stable_prefix_candidate_skipped",
      },
      {
        code: "prompt_cache_explicit_breakpoint_unavailable",
        severity: "info",
      },
    ]);
  });

  it("warns and emits warning evidence when a provider has no prompt-cache support", async () => {
    const mock = requireProvider("mock");
    const result = await promptCacheLayoutReportingPass.apply(createPlan(), {
      ...baseContext,
      providerCapabilities: [mock],
    });

    expect(result.warnings.map((warning) => warning.code)).toContain(
      "prompt_cache_provider_unsupported",
    );
    expect(
      result.evidence
        .filter((event) => event.kind === "warning")
        .map((event) => event.warning.code),
    ).toContain("prompt_cache_provider_unsupported");
  });
});

function requireProvider(fixtureId: string) {
  const provider = lookupProviderCapabilities(fixtureId);

  if (provider === undefined) {
    throw new Error(`Missing provider fixture ${fixtureId}.`);
  }

  return provider;
}

function createPlan(): MIRPlan {
  return {
    id: "prompt-cache-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [
      createContext("ctx-dev", {
        role: "developer_instruction",
        tokenEstimate: 10,
      }),
      createContext("ctx-system", {
        role: "system_instruction",
        tokenEstimate: 20,
      }),
      createContext("ctx-question", {
        privacyClass: "confidential",
        provenance: {
          source: "user",
        },
        role: "user_input",
        tokenEstimate: 5,
      }),
    ],
    nodes: [
      {
        id: "node-model",
        kind: "model_call",
        inputContext: ["ctx-dev", "ctx-system", "ctx-question"],
        model: {
          task: "synthesis",
        },
      },
    ],
    edges: [],
  };
}

function createContext(
  id: string,
  overrides: Partial<Omit<MIRContextBlock, "id">> = {},
): MIRContextBlock {
  return {
    id,
    contentRef: `fixture://${id}`,
    mutability: "fixed",
    privacyClass: "internal",
    provenance: {
      source: "system",
    },
    role: "system_instruction",
    ...overrides,
  };
}
