import { describe, expect, it } from "vitest";

import {
  REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION,
  createLiveRepoAgentComparisonBenchmark,
  writeLiveRepoAgentComparisonBenchmark,
  type LiveOpenAIFetch,
} from "./index.js";

describe("live repo-agent comparison benchmark", () => {
  it("records live usage and hashes without serializing keys or raw responses", async () => {
    const requests: string[] = [];
    let responseIndex = 0;
    const fetcher: LiveOpenAIFetch = async (_url, init) => {
      requests.push(init.body);
      responseIndex += 1;

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: `resp_test_${responseIndex}`,
            output_text: "Sensitive model answer",
            usage: {
              input_tokens: 11,
              input_tokens_details: {
                cached_tokens: 3,
              },
              output_tokens: 7,
              total_tokens: 18,
            },
          });
        },
      };
    };

    const benchmark = await createLiveRepoAgentComparisonBenchmark({
      apiKey: "test-secret-key",
      clock: fakeClock([1000, 1017, 2000, 2029, 3000, 3031, 4000, 4011]),
      fetch: fetcher,
      generatedAt: "2026-01-01T00:00:00.000Z",
      model: "gpt-test",
    });

    expect(benchmark.version).toBe(
      REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION,
    );
    expect(benchmark.artifactRoot).toBe(
      ".migaki/comparisons/repo-agent-two-run-live",
    );
    expect(requests).toHaveLength(4);
    expect(benchmark.observations).toHaveLength(4);
    expect(
      benchmark.observations.map((observation) => observation.durationMs),
    ).toEqual([17, 29, 31, 11]);
    expect(
      benchmark.observations.every((observation) => observation.status),
    ).toBe(true);
    expect(benchmark.reportMarkdown).toContain("Live OpenAI model calls: 4");
    expect(benchmark.reportMarkdown).toContain("Observed total tokens: 72");
    expect(benchmark.reportMarkdown).toContain(
      "Estimated potentially avoidable tokens: 209",
    );
    expect(benchmark.files.map((file) => file.path)).toEqual([
      ".migaki/comparisons/repo-agent-two-run-live/run-1.graph.json",
      ".migaki/comparisons/repo-agent-two-run-live/run-2.graph.json",
      ".migaki/comparisons/repo-agent-two-run-live/comparison.json",
      ".migaki/comparisons/repo-agent-two-run-live/report.md",
      ".migaki/comparisons/repo-agent-two-run-live/live-observations.json",
      ".migaki/comparisons/repo-agent-two-run-live/live-report.md",
    ]);

    const serialized = benchmark.files.map((file) => file.contents).join("\n");

    expect(serialized).not.toContain("test-secret-key");
    expect(serialized).not.toContain("Sensitive model answer");
    expect(serialized).not.toContain("resp_test_");
    expect(serialized).toContain("sha256:");
  });

  it("requires an explicit API key", async () => {
    await expect(
      createLiveRepoAgentComparisonBenchmark({
        apiKey: "",
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => "{}",
        }),
      }),
    ).rejects.toThrow("OPENAI_API_KEY is required");
  });

  it("can materialize live artifacts through an injected filesystem", async () => {
    const benchmark = await createLiveRepoAgentComparisonBenchmark({
      apiKey: "test-secret-key",
      clock: fakeClock(),
      fetch: fakeFetch(),
      generatedAt: "2026-01-01T00:00:00.000Z",
      model: "gpt-test",
    });
    const writes = new Map<string, string>();
    const directories: string[] = [];

    const writtenPaths = await writeLiveRepoAgentComparisonBenchmark(
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
      ".migaki/comparisons/repo-agent-two-run-live",
    ]);
    expect(writes.get(`${benchmark.artifactRoot}/live-report.md`)).toBe(
      benchmark.reportMarkdown,
    );
  });
});

function fakeFetch(): LiveOpenAIFetch {
  return async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        id: "resp_test",
        output_text: "Sensitive model answer",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      });
    },
  });
}

function fakeClock(values: readonly number[] = []): {
  readonly now: () => number;
} {
  let index = 0;

  return {
    now() {
      const value = values[index] ?? index;
      index += 1;

      return value;
    },
  };
}
