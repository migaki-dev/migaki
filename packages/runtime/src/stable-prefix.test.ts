import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIRPlan,
} from "@migaki/mir";
import { lookupProviderCapabilities } from "@migaki/providers";

import { stablePrefixDetectionPass } from "./index.js";

const baseContext = {
  runId: "stable-prefix-test-run",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("stablePrefixDetectionPass", () => {
  it("reports deterministic stable prefix candidates in model input order", async () => {
    const plan = createPlan(
      [
        createContext("ctx-question", {
          mutability: "fixed",
          privacyClass: "confidential",
          provenance: {
            source: "user",
          },
          role: "user_input",
        }),
        createContext("ctx-system", {
          role: "system_instruction",
        }),
        createContext("ctx-dev", {
          role: "developer_instruction",
        }),
        createContext("ctx-example", {
          role: "example",
        }),
      ],
      ["ctx-dev", "ctx-system", "ctx-question", "ctx-example"],
    );

    const result = await stablePrefixDetectionPass.apply(plan, baseContext);

    expect(result.plan).toBe(plan);
    expect(
      result.evidence
        .filter((event) => event.kind === "context_change")
        .map((event) => event.contextChange.contextIds),
    ).toEqual([["ctx-dev", "ctx-system"]]);
    expect(result.warnings).toMatchObject([
      {
        code: "stable_prefix_candidate_skipped",
        path: '$.context[?(@.id=="ctx-question")]',
      },
    ]);
  });

  it("reports opportunities even when provider lacks explicit cache breakpoints", async () => {
    const mock = lookupProviderCapabilities("mock");

    if (mock === undefined) {
      throw new Error("Missing mock provider fixture.");
    }

    const result = await stablePrefixDetectionPass.apply(createPlan(), {
      ...baseContext,
      providerCapabilities: [mock],
    });

    expect(
      result.evidence.some((event) => event.kind === "context_change"),
    ).toBe(true);
    expect(result.evidence).toMatchObject([
      {
        kind: "context_change",
      },
      {
        kind: "capability_assumption",
        capabilityAssumption: {
          capability: "prompt_caching",
          provider: "mock",
        },
      },
    ]);
    expect(result.warnings).toMatchObject([
      {
        code: "stable_prefix_provider_report_only",
        severity: "info",
      },
    ]);
  });

  it("skips movable and privacy-restricted candidates with evidence", async () => {
    const plan = createPlan([
      createContext("ctx-system", {
        role: "system_instruction",
      }),
      createContext("ctx-movable", {
        mutability: "deduplicable",
        role: "developer_instruction",
      }),
      createContext("ctx-secret", {
        privacyClass: "secret",
        role: "example",
      }),
    ]);

    const result = await stablePrefixDetectionPass.apply(plan, baseContext);

    expect(
      result.evidence
        .filter((event) => event.kind === "context_change")
        .map((event) => event.summary),
    ).toEqual(["Stable prefix opportunity for node node-model."]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "stable_prefix_candidate_skipped",
    ]);
    expect(result.warnings[0]?.assumption).toBe(
      "Context mutability is not fixed.",
    );
  });
});

function createPlan(
  context: readonly MIRContextBlock[] = [
    createContext("ctx-system", {
      role: "system_instruction",
    }),
    createContext("ctx-dev", {
      role: "developer_instruction",
    }),
  ],
  inputContext: readonly string[] = context.map((block) => block.id),
): MIRPlan {
  return {
    id: "stable-prefix-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context,
    nodes: [
      {
        id: "node-model",
        kind: "model_call",
        inputContext,
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
