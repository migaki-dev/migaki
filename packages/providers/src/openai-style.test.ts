import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";

import {
  OPENAI_STYLE_ADAPTER_VERSION,
  createOpenAIStyleAdapter,
  lowerOpenAIStyleModelRequest,
  lookupProviderCapabilities,
  type FetchProviderRequest,
  type ProviderCapabilities,
} from "./index.js";

describe("OpenAI-style adapter lowering", () => {
  it("lowers model nodes into deterministic OpenAI-style request shapes", () => {
    const result = lowerOpenAIStyleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan(),
    });

    expect(result).toMatchObject({
      assumptions: [
        {
          capability: "structured_outputs",
        },
        {
          capability: "tool_calling",
        },
        {
          capability: "automatic_caching",
        },
      ],
      supported: true,
      warnings: [],
    });
    expect(result.requestShape).toEqual({
      input: [
        {
          contentRef: "fixture://rag/system",
          contextId: "ctx-system",
          role: "system",
        },
        {
          contentRef: "fixture://rag/question",
          contextId: "ctx-question",
          role: "user",
        },
      ],
      max_output_tokens: 512,
      metadata: {
        adapterVersion: OPENAI_STYLE_ADAPTER_VERSION,
        nodeId: "node-synthesize",
        sourcePlanId: "openai-style-plan",
      },
      model: "openai-style-synthesis",
      response_format: {
        json_schema: {
          name: "answer_schema",
          schema_ref: "schema://answer",
        },
        type: "json_schema",
      },
      temperature: 0.2,
      tools: [
        {
          name: "lookup",
          schema_ref: "tool://lookup",
        },
      ],
      top_p: 0.9,
    });
  });

  it("warns when explicit cache breakpoints are requested for OpenAI-style automatic caching", () => {
    const result = lowerOpenAIStyleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan({
        cacheKeyRef: "cache://explicit-prefix",
      }),
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

  it("fails closed when a required capability is unavailable", () => {
    const capabilities = {
      ...requiredOpenAIStyleCapabilities(),
      supportsStructuredOutputs: false,
    } satisfies ProviderCapabilities;

    const result = lowerOpenAIStyleModelRequest({
      capabilities,
      nodeId: "node-synthesize",
      plan: createPlan(),
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
    const adapter = createOpenAIStyleAdapter({
      apiKey: "secret-openai-key",
      transport: async (request) => {
        seenRequests.push(request);

        return {
          body: '{"id":"response-1"}',
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
        Authorization: "Bearer secret-openai-key",
        "content-type": "application/json",
      },
      method: "POST",
      url: "https://api.openai.example/v1/responses",
    });
    expect(JSON.parse(seenRequests[0]?.body ?? "{}")).toEqual(
      result.lowering.requestShape,
    );
    expect(result.transport.status).toBe("succeeded");
    expect(JSON.stringify(result.transport)).not.toContain("secret-openai-key");
  });
});

function createPlan(
  options: {
    readonly cacheKeyRef?: string;
  } = {},
): MIRPlan {
  return {
    id: "openai-style-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {
      allowedProviders: ["openai-style"],
    },
    context: [
      {
        cachePolicy:
          options.cacheKeyRef === undefined
            ? {
                mode: "eligible",
                scope: "plan",
              }
            : {
                keyRef: options.cacheKeyRef,
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
          openaiStyle: {
            model: "openai-style-synthesis",
            responseFormat: {
              name: "answer_schema",
              schemaRef: "schema://answer",
            },
            tools: [
              {
                name: "lookup",
                schemaRef: "tool://lookup",
              },
            ],
          },
        },
        model: {
          requiredCapabilities: [
            "structured_output",
            "tool_calling",
            "prompt_caching",
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

function requiredOpenAIStyleCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("openai-style");

  if (capabilities === undefined) {
    throw new Error("OpenAI-style fixture is missing.");
  }

  return capabilities;
}
