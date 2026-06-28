import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{src,packages,examples}/**/*.e2e.test.ts"],
    passWithNoTests: true,
  },
});
