import { describe, expect, it } from "vitest";

import { migakiPackageName } from "./index.js";

describe("root package entrypoint", () => {
  it("exports the Migaki package name", () => {
    expect(migakiPackageName).toBe("migaki");
  });
});
