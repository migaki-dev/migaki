import { describe, expect, it } from "vitest";

import {
  createLiveRepoAgentComparisonBenchmark,
  writeLiveRepoAgentComparisonBenchmark,
} from "./live-benchmark.js";

describe("live repo-agent trajectory comparison benchmark runner", () => {
  it("writes live comparison artifacts", async () => {
    const benchmark = await createLiveRepoAgentComparisonBenchmark();
    const writtenPaths = await writeLiveRepoAgentComparisonBenchmark(benchmark);

    expect(writtenPaths).toEqual(benchmark.files.map((file) => file.path));

    console.log("Migaki live repo-agent trajectory comparison benchmark");
    console.log(`Comparison: ${benchmark.comparisonId}`);
    console.log(`Artifact root: ${benchmark.artifactRoot}`);
    console.log(`Model: ${benchmark.model}`);
    console.log(`Live model calls: ${benchmark.observations.length}`);
    console.log(
      `Reusable model calls: ${benchmark.baseBenchmark.comparison.metrics.reusableModelCalls}`,
    );
    console.log(
      `Reusable tool calls: ${benchmark.baseBenchmark.comparison.metrics.reusableToolCalls}`,
    );
    console.log(
      `Estimated potentially avoidable tokens: ${benchmark.baseBenchmark.comparison.metrics.estimatedAvoidableTokens}`,
    );
    console.log("Artifacts:");

    for (const path of writtenPaths) {
      console.log(`- ${path}`);
    }
  }, 120_000);
});
