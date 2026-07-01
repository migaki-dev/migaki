import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/*.benchmark.test.ts",
      "**/*.e2e.test.ts",
      "**/*.live-benchmark.test.ts",
    ],
    include: ["{src,packages,examples}/**/*.test.ts"],
  },
});
