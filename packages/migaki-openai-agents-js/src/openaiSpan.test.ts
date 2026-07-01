import { describe, expect, it } from "vitest";

import {
  modelCallEndFromOpenAISpan,
  modelCallStartFromOpenAISpan,
} from "./openaiSpan.js";

describe("OpenAI Agents span parsing", () => {
  it("classifies Responses API response spans as model calls", () => {
    const span = {
      parentId: "agent-span",
      spanData: {
        _input: [
          {
            content: "Run the live Migaki benchmark smoke test.",
            role: "user",
          },
        ],
        _response: {
          id: "resp_live",
          model: "gpt-4.1-mini",
          output: [
            {
              content: [
                {
                  text: "migaki live benchmark ok",
                  type: "output_text",
                },
              ],
              role: "assistant",
              type: "message",
            },
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 5,
            total_tokens: 16,
          },
        },
        response_id: "resp_live",
        type: "response",
      },
      spanId: "response-span",
      traceId: "trace-live",
    };

    expect(modelCallStartFromOpenAISpan(span)).toEqual({
      input: span.spanData._input,
      modelName: "gpt-4.1-mini",
      parentSpanId: "agent-span",
      spanId: "response-span",
    });
    expect(modelCallEndFromOpenAISpan(span)).toEqual({
      input: span.spanData._input,
      modelName: "gpt-4.1-mini",
      output: span.spanData._response.output,
      spanId: "response-span",
      usage: {
        inputTokens: 11,
        outputTokens: 5,
        totalTokens: 16,
      },
    });
  });
});
