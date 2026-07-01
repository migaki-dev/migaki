import { describe, expect, it } from "vitest";

import {
  REPO_AGENT_TRAJECTORY_COMPARISON_BENCHMARK_VERSION,
  createRepoAgentTrajectoryComparisonBenchmark,
  writeRepoAgentTrajectoryComparisonBenchmark,
} from "./index.js";

describe("repo-agent trajectory comparison benchmark", () => {
  it("produces two run graphs, comparison artifacts, and honest reusable-node metrics", async () => {
    const benchmark = await createRepoAgentTrajectoryComparisonBenchmark();

    expect(benchmark.version).toBe(
      REPO_AGENT_TRAJECTORY_COMPARISON_BENCHMARK_VERSION,
    );
    expect(benchmark.artifactRoot).toBe(
      ".migaki/comparisons/repo-agent-two-run-exact",
    );
    expect(benchmark.runs.first.graph.id).toBe("repo-agent-run-1");
    expect(benchmark.runs.second.graph.id).toBe("repo-agent-run-2");
    expect(benchmark.runs.first.trace.steps.map((step) => step.kind)).toEqual([
      "tool",
      "model",
      "tool",
      "model",
      "validator",
    ]);
    expect(benchmark.runs.second.trace.steps.map((step) => step.kind)).toEqual(
      benchmark.runs.first.trace.steps.map((step) => step.kind),
    );
    expect(benchmark.comparison.metrics).toEqual({
      changedNodes: 0,
      estimatedAvoidableModelCalls: 2,
      estimatedAvoidableTokens: 209,
      estimatedAvoidableToolCalls: 2,
      longestReusablePath: {
        length: 4,
        nodeIds: [
          "node-inspect-repo",
          "node-plan-edit",
          "node-run-tests",
          "node-summarize",
        ],
      },
      nonReusableNodesWithReasons: 1,
      reusableModelCalls: 2,
      reusableTokenCount: 270,
      reusableToolCalls: 2,
    });
    expect(
      benchmark.comparison.reusableNodes.map((node) => node.nodeId),
    ).toEqual([
      "node-inspect-repo",
      "node-plan-edit",
      "node-run-tests",
      "node-summarize",
    ]);
    expect(benchmark.comparison.nonReusableNodesWithReasons).toEqual([
      {
        current: expect.any(Object),
        kind: "validator",
        nodeId: "node-validate-summary",
        previous: expect.any(Object),
        reasons: [
          {
            code: "not_reuse_candidate",
            message:
              "Only exact model_call and tool_call nodes are reuse candidates.",
          },
        ],
      },
    ]);
    expect(benchmark.files.map((file) => file.path)).toEqual([
      ".migaki/comparisons/repo-agent-two-run-exact/run-1.graph.json",
      ".migaki/comparisons/repo-agent-two-run-exact/run-2.graph.json",
      ".migaki/comparisons/repo-agent-two-run-exact/comparison.json",
      ".migaki/comparisons/repo-agent-two-run-exact/report.md",
    ]);
    expect(JSON.parse(benchmark.files[2]?.contents ?? "")).toEqual(
      benchmark.comparison,
    );
    expect(benchmark.files[3]?.contents).toContain(
      "Migaki can identify reusable agent trajectory nodes.",
    );
    expect(benchmark.files[3]?.contents).toContain(
      "Estimated potentially avoidable tokens: 209",
    );
    expect(benchmark.files[3]?.contents).toContain(
      "Estimated potentially avoidable model calls: 2",
    );
    expect(benchmark.files[3]?.contents).toContain(
      "Estimated potentially avoidable tool calls: 2",
    );
    expect(benchmark.files[3]?.contents).toContain(
      "node-validate-summary: not_reuse_candidate",
    );
    expect(benchmark.files[3]?.contents).not.toContain("Latency improvement");
    expect(benchmark.claims.cannotClaim).toContain(
      "Live-provider cost or latency improvement.",
    );
  });

  it("can materialize comparison artifacts through an injected filesystem", async () => {
    const benchmark = await createRepoAgentTrajectoryComparisonBenchmark();
    const writes = new Map<string, string>();
    const directories: string[] = [];

    const writtenPaths = await writeRepoAgentTrajectoryComparisonBenchmark(
      benchmark,
      {
        mkdir(path) {
          directories.push(path);
        },
        writeFile(path, contents) {
          writes.set(path, contents);
        },
      },
    );

    expect(writtenPaths).toEqual(benchmark.files.map((file) => file.path));
    expect(directories).toEqual([
      ".migaki/comparisons/repo-agent-two-run-exact",
    ]);
    expect(writes.get(`${benchmark.artifactRoot}/report.md`)).toBe(
      benchmark.reportMarkdown,
    );
  });
});
