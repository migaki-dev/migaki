import { describe, expect, it } from "vitest";

import {
  createRepoAgentTrajectoryComparisonBenchmark,
  writeRepoAgentTrajectoryComparisonBenchmark,
} from "./benchmark.js";

describe("repo-agent trajectory comparison benchmark runner", () => {
  it("writes deterministic comparison artifacts", async () => {
    const benchmark = await createRepoAgentTrajectoryComparisonBenchmark();
    const writtenPaths =
      await writeRepoAgentTrajectoryComparisonBenchmark(benchmark);

    expect(writtenPaths).toEqual(benchmark.files.map((file) => file.path));

    console.log("Migaki repo-agent trajectory comparison benchmark");
    console.log(`Comparison: ${benchmark.comparisonId}`);
    console.log(`Artifact root: ${benchmark.artifactRoot}`);
    console.log(
      `Reusable model calls: ${benchmark.comparison.metrics.reusableModelCalls}`,
    );
    console.log(
      `Reusable tool calls: ${benchmark.comparison.metrics.reusableToolCalls}`,
    );
    console.log(
      `Estimated potentially avoidable tokens: ${benchmark.comparison.metrics.estimatedAvoidableTokens}`,
    );
    console.log("Artifacts:");

    for (const path of writtenPaths) {
      console.log(`- ${path}`);
    }
  });
});
