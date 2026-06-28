import { describe, expect, it } from "vitest";

import { readJsonFixture } from "../../../src/testing/index.js";
import { validateMIRPlan } from "./index.js";

const examples = [
  {
    id: "rag-baseline",
    path: "./examples/rag-baseline.json",
  },
  {
    id: "rag-optimized-skeleton",
    path: "./examples/rag-optimized-skeleton.json",
  },
  {
    id: "code-review",
    path: "./examples/code-review.json",
  },
] as const;

describe("mIR example plans", () => {
  it.each(examples)("validates $id", async ({ id, path }) => {
    const plan = await readJsonFixture(new URL(path, import.meta.url));
    const result = validateMIRPlan(plan);

    expect(result).toEqual({
      errors: [],
      plan,
      success: true,
    });
    expect(plan).toMatchObject({
      id,
      version: "migaki.mir.v0",
    });
  });
});
