import { describe, expect, it } from "vitest";

import {
  createModelCallCacheKey,
  createToolCallCacheKey,
  stableHash,
} from "./hash.js";

describe("Migaki stable hashing", () => {
  it("normalizes object key order before hashing", () => {
    expect(
      stableHash({
        zebra: true,
        alpha: {
          second: 2,
          first: 1,
        },
      }),
    ).toBe(
      stableHash({
        alpha: {
          first: 1,
          second: 2,
        },
        zebra: true,
      }),
    );
  });

  it("builds deterministic model and tool cache keys without replaying them", () => {
    expect(
      createModelCallCacheKey({
        modelName: "gpt-5-mini",
        modelParams: { temperature: 0 },
        normalizedInput: { task: "summarize" },
        outputSchema: "text",
        sdkPackageVersion: "0.12.0",
      }),
    ).toMatchObject({
      name: "gpt-5-mini",
      op: "model_call",
    });
    expect(
      createToolCallCacheKey({
        toolArgs: { query: "runner" },
        toolName: "searchRepoTool",
        toolVersion: "fixture.v0",
      }),
    ).toMatchObject({
      name: "searchRepoTool",
      op: "tool_call",
    });
  });
});
