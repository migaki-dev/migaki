import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRModelCapability,
  type MIRPlan,
} from "@migaki/mir";

import {
  ANTHROPIC_STYLE_ADAPTER_VERSION,
  createAnthropicStyleAdapter,
  lookupProviderCapabilities,
  lowerAnthropicStyleModelRequest,
  type FetchProviderRequest,
  type ProviderCapabilities,
} from "./index.js";

describe("Anthropic-style adapter lowering", () => {
  it("lowers cacheable model nodes into deterministic Anthropic-style request shapes", () => {
    const result = lowerAnthropicStyleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan(),
    });

    expect(result).toMatchObject({
      assumptions: [
        {
          capability: "explicit_cache_breakpoints",
        },
        {
          capability: "tool_calling",
        },
      ],
      supported: true,
      warnings: [],
    });
    expect(result.requestShape).toEqual({
      max_tokens: 512,
      messages: [
        {
          content: [
            {
              text_ref: "fixture://rag/question",
              type: "text_ref",
            },
          ],
          role: "user",
        },
      ],
      metadata: {
        adapterVersion: ANTHROPIC_STYLE_ADAPTER_VERSION,
        nodeId: "node-synthesize",
        sourcePlanId: "anthropic-style-plan",
      },
      model: "anthropic-style-synthesis",
      system: [
        {
          cache_control: {
            ttl: "5m",
            type: "ephemeral",
          },
          text_ref: "fixture://rag/system",
          type: "text_ref",
        },
      ],
      temperature: 0.2,
      tools: [
        {
          input_schema_ref: "tool://lookup",
          name: "lookup",
        },
      ],
      top_p: 0.9,
    });
  });

  it("warns when explicit cache breakpoints are requested but unavailable", () => {
    const capabilities = {
      ...requiredAnthropicStyleCapabilities(),
      supportsExplicitCacheBreakpoints: false,
    } satisfies ProviderCapabilities;

    const result = lowerAnthropicStyleModelRequest({
      capabilities,
      nodeId: "node-synthesize",
      plan: createPlan(),
    });

    expect(result.supported).toBe(true);
    expect(result.warnings).toMatchObject([
      {
        capability: "explicit_cache_breakpoints",
        code: "downgraded_capability",
        severity: "warning",
      },
    ]);
  });

  it("fails closed when structured output is required by a node", () => {
    const result = lowerAnthropicStyleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan({
        requiredCapabilities: ["structured_output"],
      }),
    });

    expect(result.supported).toBe(false);
    expect(result.warnings).toMatchObject([
      {
        capability: "structured_outputs",
        code: "unsupported_capability",
        severity: "error",
      },
    ]);
  });

  it("sends lowered requests through injected fake transport without persisting auth secrets", async () => {
    const seenRequests: FetchProviderRequest[] = [];
    const adapter = createAnthropicStyleAdapter({
      apiKey: "secret-anthropic-key",
      transport: async (request) => {
        seenRequests.push(request);

        return {
          body: '{"id":"message-1"}',
          status: 200,
        };
      },
    });

    const result = await adapter.executeModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan(),
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]).toMatchObject({
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": "secret-anthropic-key",
      },
      method: "POST",
      url: "https://api.anthropic.example/v1/messages",
    });
    expect(JSON.parse(seenRequests[0]?.body ?? "{}")).toEqual(
      result.lowering.requestShape,
    );
    expect(result.transport.status).toBe("succeeded");
    expect(JSON.stringify(result.transport)).not.toContain(
      "secret-anthropic-key",
    );
  });
});

function createPlan(
  options: {
    readonly requiredCapabilities?: readonly MIRModelCapability[];
  } = {},
): MIRPlan {
  return {
    id: "anthropic-style-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {
      allowedProviders: ["anthropic-style"],
    },
    context: [
      {
        cachePolicy: {
          keyRef: "cache://system-prefix",
          mode: "eligible",
          scope: "plan",
        },
        contentRef: "fixture://rag/system",
        id: "ctx-system",
        mutability: "fixed",
        provenance: {
          source: "system",
        },
        role: "system_instruction",
      },
      {
        contentRef: "fixture://rag/question",
        id: "ctx-question",
        mutability: "fixed",
        provenance: {
          source: "user",
        },
        role: "user_input",
      },
    ],
    nodes: [
      {
        id: "node-synthesize",
        inputContext: ["ctx-system", "ctx-question"],
        kind: "model_call",
        metadata: {
          anthropicStyle: {
            cacheTtl: "5m",
            model: "anthropic-style-synthesis",
            tools: [
              {
                name: "lookup",
                schemaRef: "tool://lookup",
              },
            ],
          },
        },
        model: {
          requiredCapabilities: options.requiredCapabilities ?? [
            "prompt_caching",
            "tool_calling",
          ],
          task: "synthesis",
        },
        outputContext: "ctx-answer",
        parameters: {
          maxOutputTokens: 512,
          temperature: 0.2,
          topP: 0.9,
        },
      },
    ],
    edges: [],
  };
}

function requiredAnthropicStyleCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("anthropic-style");

  if (capabilities === undefined) {
    throw new Error("Anthropic-style fixture is missing.");
  }

  return capabilities;
}
