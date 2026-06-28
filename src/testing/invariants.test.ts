import { describe, expect, it } from "vitest";

import { defineInvariantCases } from "./invariants.js";

describe("defineInvariantCases", () => {
  it("keeps named invariant table cases available to tests", () => {
    const cases = defineInvariantCases([
      { name: "empty graph", input: { nodes: 0 } },
      { name: "single node graph", input: { nodes: 1 } },
    ]);

    expect(cases.map((testCase) => testCase.name)).toEqual([
      "empty graph",
      "single node graph",
    ]);
  });

  it("rejects duplicate case names", () => {
    expect(() =>
      defineInvariantCases([
        { name: "same", input: 1 },
        { name: "same", input: 2 },
      ]),
    ).toThrow("Duplicate invariant case name: same");
  });
});
