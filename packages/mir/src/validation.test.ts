import { describe, expect, it } from "vitest";

import {
  readJsonFixture,
  readTextFixture,
  stableJson,
} from "../../../src/testing/index.js";
import { validateMIRPlan } from "./index.js";

describe("validateMIRPlan", () => {
  it("accepts a valid golden mIR fixture", async () => {
    const plan = await readJsonFixture(
      new URL("./fixtures/valid-rag-plan.json", import.meta.url),
    );

    const result = validateMIRPlan(plan);

    expect(result).toEqual({
      errors: [],
      plan,
      success: true,
    });
  });

  it("returns deterministic structured errors for an invalid golden fixture", async () => {
    const plan = await readJsonFixture(
      new URL("./fixtures/invalid-plan.json", import.meta.url),
    );
    const expectedErrors = await readTextFixture(
      new URL("./fixtures/invalid-plan.errors.json", import.meta.url),
    );

    const result = validateMIRPlan(plan);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error("Expected invalid fixture to fail validation.");
    }

    expect(stableJson(result.errors)).toBe(expectedErrors);
  });
});
