import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRModelCapability,
  type MIRPlan,
} from "@migaki/mir";

import {
  LITELLM_COMPATIBLE_ADAPTER_VERSION,
  createLiteLLMCompatibleAdapter,
  lowerLiteLLMCompatibleModelRequest,
  type FetchProviderRequest,
} from "./index.js";

describe("LiteLLM-compatible adapter lowering", () => {
  it("lowers model nodes into deterministic gateway-compatible chat request shapes", () => {
    const result = lowerLiteLLMCompatibleModelRequest({
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
      ],
      gatewayAssumptions: [
        {
          owner: "gateway",
          responsibility: "provider_routing",
        },
        {
          owner: "gateway",
          responsibility: "connectivity",
        },
        {
          owner: "gateway",
          responsibility: "budget_enforcement",
        },
        {
          owner: "gateway",
          responsibility: "fallback_policy",
        },
        {
          owner: "gateway",
          responsibility: "observability",
        },
      ],
      supported: true,
      warnings: [],
    });
    expect(result.requestShape).toEqual({
      max_tokens: 512,
      messages: [
        {
          content_ref: "fixture://rag/system",
          context_id: "ctx-system",
          role: "system",
        },
        {
          content_ref: "fixture://rag/question",
          context_id: "ctx-question",
          role: "user",
        },
      ],
      metadata: {
        adapterVersion: LITELLM_COMPATIBLE_ADAPTER_VERSION,
        gatewayResponsibilities: [
          "provider_routing",
          "connectivity",
          "budget_enforcement",
          "fallback_policy",
          "observability",
        ],
        nodeId: "node-synthesize",
        sourcePlanId: "litellm-compatible-plan",
      },
      model: "litellm-compatible-synthesis",
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
          function: {
            name: "lookup",
            parameters_ref: "tool://lookup",
          },
          type: "function",
        },
      ],
      top_p: 0.9,
    });
  });

  it("fails closed when a required capability is unavailable", () => {
    const result = lowerLiteLLMCompatibleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan({
        requiredCapabilities: ["prompt_caching"],
      }),
    });

    expect(result.supported).toBe(false);
    expect(result.warnings).toMatchObject([
      {
        capability: "prompt_caching",
        code: "unsupported_capability",
        severity: "error",
      },
    ]);
  });

  it("warns when cache metadata is present but delegated to the gateway", () => {
    const result = lowerLiteLLMCompatibleModelRequest({
      nodeId: "node-synthesize",
      plan: createPlan({
        cacheKeyRef: "cache://system-prefix",
      }),
    });

    expect(result.supported).toBe(true);
    expect(result.warnings).toMatchObject([
      {
        assumption:
          "LiteLLM-compatible gateway fixture does not lower Migaki cache policy.",
        capability: "prompt_caching",
        code: "downgraded_capability",
        severity: "warning",
      },
    ]);
  });

  it("sends lowered requests through injected fake transport without persisting auth secrets", async () => {
    const seenRequests: FetchProviderRequest[] = [];
    const adapter = createLiteLLMCompatibleAdapter({
      apiKey: "secret-litellm-key",
      transport: async (request) => {
        seenRequests.push(request);

        return {
          body: '{"id":"chatcmpl-1"}',
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
        Authorization: "Bearer secret-litellm-key",
        "content-type": "application/json",
      },
      method: "POST",
      url: "https://litellm.example/v1/chat/completions",
    });
    expect(JSON.parse(seenRequests[0]?.body ?? "{}")).toEqual(
      result.lowering.requestShape,
    );
    expect(result.transport.status).toBe("succeeded");
    expect(JSON.stringify(result.transport)).not.toContain(
      "secret-litellm-key",
    );
  });
});

function createPlan(
  options: {
    readonly cacheKeyRef?: string;
    readonly requiredCapabilities?: readonly MIRModelCapability[];
  } = {},
): MIRPlan {
  return {
    id: "litellm-compatible-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {
      allowedProviders: ["litellm-compatible"],
    },
    context: [
      {
        contentRef: "fixture://rag/system",
        id: "ctx-system",
        mutability: "fixed",
        provenance: {
          source: "system",
        },
        role: "system_instruction",
        ...(options.cacheKeyRef === undefined
          ? {}
          : {
              cachePolicy: {
                keyRef: options.cacheKeyRef,
                mode: "eligible",
                scope: "plan",
              },
            }),
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
          litellmCompatible: {
            model: "litellm-compatible-synthesis",
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
          requiredCapabilities: options.requiredCapabilities ?? [
            "structured_output",
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
