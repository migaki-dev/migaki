import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalMigakiStore } from "./store.js";
import { runRepoAgentBenchmark } from "./benchmark.js";
import type { MigakiEvent, MigakiGraph } from "./types.js";

describe("repo-agent benchmark", () => {
  it("writes JSONL events, a graph, and the first useful report", async () => {
    const root = await mkdtemp(join(tmpdir(), "migaki-benchmark-"));

    try {
      const result = await runRepoAgentBenchmark({
        runId: "benchmark-test",
        store: new LocalMigakiStore(root),
      });
      const runDirectory = join(root, "runs", "benchmark-test");
      const events = (
        await readFile(join(runDirectory, "events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as MigakiEvent);
      const graph = JSON.parse(
        await readFile(join(runDirectory, "graph.json"), "utf8"),
      ) as MigakiGraph;
      const report = await readFile(join(runDirectory, "report.md"), "utf8");

      expect(result.metrics).toMatchObject({
        cacheableNodeCount: 13,
        duplicateModelCallShapedOperations: 1,
        duplicateToolCalls: 2,
        llmCalls: 6,
        potentialCacheHits: 3,
        tokens: 444,
        toolCalls: 7,
      });
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "run.started",
          "agent.started",
          "model.call.started",
          "model.call.completed",
          "tool.call.started",
          "tool.call.completed",
          "run.completed",
        ]),
      );
      expect(graph.nodes).toHaveLength(14);
      expect(report).toContain("- Total nodes: 14");
      expect(report).toContain("- Potential cache hits: 3");
      expect(report).toContain("- actual cache replay");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
