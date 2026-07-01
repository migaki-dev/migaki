import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalMigakiStore } from "./store.js";
import {
  runParallelMigakiBenchmark,
  runRepoAgentBenchmark,
} from "./benchmark.js";
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

  it("runs equivalent baseline and Migaki agent lanes in parallel", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-parallel-"));
    const gate = new TwoLaneGate();

    try {
      const resultPromise = runParallelMigakiBenchmark({
        createRun(lane) {
          return createAgentRunSpec({
            instructions: "Answer from the benchmark model.",
            model: new BenchmarkFakeModel({
              gate,
              lane,
              output: "parallel answer",
              usage: new sdk.Usage({ inputTokens: 4, outputTokens: 3 }),
            }),
            sdk,
          });
        },
        runId: "parallel-test",
        store: new LocalMigakiStore(root),
      });

      await gate.waitForArrivals(2);

      expect(gate.arrivals).toEqual(["baseline", "migaki"]);

      gate.release();

      const result = await resultPromise;
      const report = await readFile(
        join(root, "runs", "parallel-test", "report.md"),
        "utf8",
      );
      const migakiGraph = JSON.parse(
        await readFile(
          join(root, "runs", "parallel-test-migaki", "graph.json"),
          "utf8",
        ),
      ) as MigakiGraph;

      expect(result.baseline.status).toBe("ok");
      expect(result.migaki.status).toBe("ok");
      expect(result.comparison).toMatchObject({
        bothSucceeded: true,
        outputEqual: true,
      });
      expect(
        migakiGraph.nodes.filter((node) => node.kind === "model_call"),
      ).toHaveLength(1);
      expect(report).toContain("- Baseline status: ok");
      expect(report).toContain("- Migaki status: ok");
      expect(report).toContain("- Outputs equal: true");
    } finally {
      gate.release();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns both lane outcomes when the Migaki lane fails", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-parallel-fail-"));

    try {
      const result = await runParallelMigakiBenchmark({
        createRun(lane) {
          return createAgentRunSpec({
            instructions: "Exercise benchmark failure reporting.",
            model:
              lane === "migaki"
                ? new FailingBenchmarkModel("migaki model unavailable")
                : new BenchmarkFakeModel({
                    lane,
                    output: "baseline answer",
                    usage: new sdk.Usage({ inputTokens: 2, outputTokens: 2 }),
                  }),
            sdk,
          });
        },
        runId: "parallel-failure-test",
        store: new LocalMigakiStore(root),
      });
      const report = await readFile(
        join(root, "runs", "parallel-failure-test", "report.md"),
        "utf8",
      );

      expect(result.baseline).toMatchObject({
        output: "baseline answer",
        status: "ok",
      });
      expect(result.migaki).toMatchObject({
        error: {
          message: "migaki model unavailable",
        },
        status: "error",
      });
      expect(result.comparison).toMatchObject({
        bothSucceeded: false,
      });
      expect(result.comparison.outputEqual).toBeUndefined();
      expect(report).toContain("- Baseline error: none");
      expect(report).toContain("- Migaki error: migaki model unavailable");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

interface TestOpenAIAgentsSdk {
  readonly Agent: new (config: Readonly<Record<string, unknown>>) => unknown;
  readonly Usage: new (input: Readonly<Record<string, unknown>>) => unknown;
}

interface AgentRunSpecInput {
  readonly instructions: string;
  readonly model: unknown;
  readonly sdk: TestOpenAIAgentsSdk;
}

const openAiAgentsPackageName = "@openai/agents";

async function loadOpenAIAgentsSdkForTest(): Promise<TestOpenAIAgentsSdk> {
  const loaded = (await import(openAiAgentsPackageName)) as unknown;

  if (!isRecord(loaded)) {
    throw new Error("OpenAI Agents SDK did not load.");
  }

  const Agent = loaded.Agent;
  const Usage = loaded.Usage;

  if (typeof Agent !== "function" || typeof Usage !== "function") {
    throw new Error("OpenAI Agents SDK test exports were not available.");
  }

  return {
    Agent: Agent as TestOpenAIAgentsSdk["Agent"],
    Usage: Usage as TestOpenAIAgentsSdk["Usage"],
  };
}

function createAgentRunSpec(input: AgentRunSpecInput): {
  readonly agent: unknown;
  readonly input: string;
  readonly runConfig: Readonly<Record<string, unknown>>;
} {
  return {
    agent: new input.sdk.Agent({
      instructions: input.instructions,
      name: "BenchmarkAgent",
    }),
    input: "Run the benchmark.",
    runConfig: {
      model: input.model,
    },
  };
}

class BenchmarkFakeModel {
  readonly #gate: TwoLaneGate | undefined;
  readonly #lane: string;
  readonly #output: string;
  readonly #usage: unknown;

  constructor(input: {
    readonly gate?: TwoLaneGate;
    readonly lane: string;
    readonly output: string;
    readonly usage: unknown;
  }) {
    this.#gate = input.gate;
    this.#lane = input.lane;
    this.#output = input.output;
    this.#usage = input.usage;
  }

  async getResponse(): Promise<Readonly<Record<string, unknown>>> {
    await this.#gate?.arrive(this.#lane);

    return {
      output: [assistantMessage(this.#output)],
      usage: this.#usage,
    };
  }

  getStreamedResponse(): AsyncIterable<unknown> {
    throw new Error("Streaming is not implemented in the fake model.");
  }
}

class FailingBenchmarkModel {
  readonly #message: string;

  constructor(message: string) {
    this.#message = message;
  }

  async getResponse(): Promise<unknown> {
    throw new Error(this.#message);
  }

  getStreamedResponse(): AsyncIterable<unknown> {
    throw new Error("Streaming is not implemented in the fake model.");
  }
}

class TwoLaneGate {
  readonly arrivals: string[] = [];
  #arrivalResolver: (() => void) | undefined;
  readonly #arrivalsPromise = new Promise<void>((resolve) => {
    this.#arrivalResolver = resolve;
  });
  #releaseResolver: (() => void) | undefined;
  readonly #releasePromise = new Promise<void>((resolve) => {
    this.#releaseResolver = resolve;
  });

  async arrive(lane: string): Promise<void> {
    this.arrivals.push(lane);

    if (this.arrivals.length >= 2) {
      this.#arrivalResolver?.();
    }

    await this.#releasePromise;
  }

  async waitForArrivals(count: number): Promise<void> {
    if (this.arrivals.length >= count) {
      return;
    }

    await this.#arrivalsPromise;
  }

  release(): void {
    this.#releaseResolver?.();
  }
}

function assistantMessage(text: string): Readonly<Record<string, unknown>> {
  return {
    content: [
      {
        providerData: {
          annotations: [],
        },
        text,
        type: "output_text",
      },
    ],
    id: "msg_1",
    role: "assistant",
    status: "completed",
    type: "message",
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
