import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalMigakiStore } from "./store.js";
import {
  runCodeReviewWorkflowBenchmark,
  runRepoAgentReuseBenchmark,
  runParallelMigakiBenchmark,
  runRepoAgentBenchmark,
} from "./benchmark.js";
import type { MigakiEvent, MigakiGraph } from "./types.js";

describe("repo-agent benchmark", () => {
  it("reports deterministic code-review context reuse and validator quality", async () => {
    const root = await mkdtemp(join(tmpdir(), "migaki-code-review-"));

    try {
      const result = await runCodeReviewWorkflowBenchmark({
        runId: "code-review-test",
        store: new LocalMigakiStore(root),
      });
      const runDirectory = join(root, "runs", "code-review-test");
      const comparison = JSON.parse(
        await readFile(
          join(runDirectory, "artifacts", "comparison.json"),
          "utf8",
        ),
      ) as unknown;
      const metrics = JSON.parse(
        await readFile(join(runDirectory, "artifacts", "metrics.json"), "utf8"),
      ) as unknown;
      const report = await readFile(join(runDirectory, "report.md"), "utf8");

      expect(result.baseline).toMatchObject({
        contextLoads: ["repository-context", "changed-files", "style-guide"],
        modelPath: "review-and-final-comments",
      });
      expect(result.migakiPath).toMatchObject({
        changedFiles: {
          droppable: false,
          role: "non-droppable",
        },
        finalComments: {
          validatorBound: true,
          validatorsRequired: ["validator-review-grounding"],
        },
        staticChecks: {
          deterministic: true,
        },
        styleGuidance: {
          cacheable: true,
          mutability: "fixed",
        },
        unrelatedHistory: {
          removable: true,
        },
      });
      expect(result.metrics).toMatchObject({
        commentAcceptanceProxy: 0.86,
        costDeltaUsd: -0.00012,
        falsePositiveProxy: 0.08,
        latencyDeltaMs: -37,
        validatorPassRate: 0.5,
      });
      expect(result.contextDiff).toEqual({
        changedFileFingerprints: {
          current: "sha256:changed-files-v2",
          previous: "sha256:changed-files-v1",
        },
        fixedCacheable: ["ctx-style-guide"],
        nonDroppable: ["ctx-changed-files"],
        removed: ["ctx-unrelated-history"],
      });
      expect(result.comparison.summary).toMatchObject({
        blockedCandidates: 1,
        changedNodes: 1,
        reusableModelCalls: 1,
        reusableToolCalls: 1,
      });
      expect(result.warningList).toEqual([
        "changed-files-content blocks reuse for model-review-changed-files",
        "validator_missing blocks reuse for model-final-comments",
        "potential_reuse_only: Observed trajectory comparison only identifies potential reusable nodes; it never executes, replays, caches, or skips work.",
      ]);
      expect(comparison).toMatchObject({
        summary: {
          blockedCandidates: 1,
          changedNodes: 1,
          reusableModelCalls: 1,
          reusableToolCalls: 1,
        },
      });
      expect(metrics).toMatchObject({
        commentAcceptanceProxy: 0.86,
        falsePositiveProxy: 0.08,
        validatorPassRate: 0.5,
      });
      expect(report).toContain("Migaki Code-Review Workflow Benchmark");
      expect(report).toContain(
        "- Baseline context loads: repository-context, changed-files, style-guide",
      );
      expect(report).toContain(
        "- Baseline model path: review-and-final-comments",
      );
      expect(report).toContain("- Style guidance: fixed, cacheable");
      expect(report).toContain("- Changed files: non-droppable");
      expect(report).toContain("- Unrelated history: removable");
      expect(report).toContain("- Static checks: deterministic");
      expect(report).toContain("- Final comments: validator-bound");
      expect(report).toContain("- Comment acceptance proxy: 0.86");
      expect(report).toContain("- False-positive proxy: 0.08");
      expect(report).toContain("- Validator pass rate: 0.5");
      expect(report).toContain("- Cost delta USD: -0.000120");
      expect(report).toContain("- Latency delta ms: -37");
      expect(report).toContain(
        "- Changed-file fingerprint diff: sha256:changed-files-v1 -> sha256:changed-files-v2",
      );
      expect(report).toContain(
        "- Warnings: validator_missing blocks reuse for model-final-comments",
      );
      expect(report).toContain(
        "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
      );
      expect(report).not.toMatch(/\bactual savings\b/i);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("compares two deterministic repo-agent runs and writes reuse artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "migaki-reuse-benchmark-"));

    try {
      const result = await runRepoAgentReuseBenchmark({
        runId: "reuse-test",
        store: new LocalMigakiStore(root),
      });
      const previousRunDirectory = join(root, "runs", "reuse-test-a");
      const currentRunDirectory = join(root, "runs", "reuse-test-b");
      const comparisonDirectory = join(root, "runs", "reuse-test");
      const comparison = JSON.parse(
        await readFile(
          join(comparisonDirectory, "artifacts", "comparison.json"),
          "utf8",
        ),
      ) as unknown;
      const reuseDecision = JSON.parse(
        await readFile(
          join(comparisonDirectory, "artifacts", "reuse-decision.json"),
          "utf8",
        ),
      ) as unknown;
      const report = await readFile(
        join(comparisonDirectory, "report.md"),
        "utf8",
      );

      await expect(
        readFile(join(previousRunDirectory, "events.jsonl"), "utf8"),
      ).resolves.toContain('"type":"run.started"');
      await expect(
        readFile(join(previousRunDirectory, "graph.json"), "utf8"),
      ).resolves.toContain('"runId": "reuse-test-a"');
      await expect(
        readFile(join(previousRunDirectory, "report.md"), "utf8"),
      ).resolves.toContain("Migaki Run Report");
      await expect(
        readFile(join(currentRunDirectory, "events.jsonl"), "utf8"),
      ).resolves.toContain('"type":"run.started"');
      await expect(
        readFile(join(currentRunDirectory, "graph.json"), "utf8"),
      ).resolves.toContain('"runId": "reuse-test-b"');
      await expect(
        readFile(join(currentRunDirectory, "report.md"), "utf8"),
      ).resolves.toContain("Migaki Run Report");

      expect(result.comparison.summary).toMatchObject({
        blockedCandidates: 1,
        changedNodes: 1,
        reusableModelCalls: 1,
        reusableToolCalls: 1,
      });
      expect(result.comparison.summary.totalEstimatedAvoidableTokens).toBe(68);
      expect(result.comparison.summary.totalEstimatedAvoidableCostUsd).toBe(
        0.000034,
      );
      expect(result.comparison.summary.totalEstimatedAvoidableLatencyMs).toBe(
        22,
      );
      expect(result.reuseDecision.summary).toMatchObject({
        allowed: 1,
        blocked: 1,
        needsReview: 1,
        totalCandidates: 3,
      });
      expect(comparison).toMatchObject({
        currentRunId: "reuse-test-b",
        previousRunId: "reuse-test-a",
        summary: {
          blockedCandidates: 1,
          changedNodes: 1,
          reusableModelCalls: 1,
          reusableToolCalls: 1,
        },
      });
      expect(reuseDecision).toMatchObject({
        summary: {
          allowed: 1,
          blocked: 1,
          needsReview: 1,
        },
      });
      expect(report).toContain("Migaki Repo-Agent Reuse Benchmark");
      expect(report).toContain(
        "- Previous events: runs/reuse-test-a/events.jsonl",
      );
      expect(report).toContain("- Current graph: runs/reuse-test-b/graph.json");
      expect(report).toContain("- Reusable model nodes: model-summary-reuse");
      expect(report).toContain("- Reusable tool nodes: tool_call-0002");
      expect(report).toContain(
        "- Changed nodes: model-patch-plan (cache_key_changed)",
      );
      expect(report).toContain(
        "- Blocked candidates: tool_call-0003 [side_effect_unknown]",
      );
      expect(report).toContain("- Estimated avoidable tokens: 68");
      expect(report).toContain("- Estimated avoidable cost USD: 0.000034");
      expect(report).toContain("- Estimated avoidable latency ms: 22");
      expect(report).toContain(
        "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
      );
      expect(report).not.toMatch(/\bactual savings\b/i);
      expect(report).not.toMatch(/\bspeedup\b/i);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

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
