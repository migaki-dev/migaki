import { describe, expect, it } from "vitest";

import { stableJson } from "./fixtures.js";

describe("fixture helpers", () => {
  it("renders stable JSON with sorted object keys", () => {
    expect(
      stableJson({
        zebra: true,
        alpha: {
          second: 2,
          first: 1,
        },
      }),
    ).toBe(
      `{
  "alpha": {
    "first": 1,
    "second": 2
  },
  "zebra": true
}
`,
    );
  });
});
