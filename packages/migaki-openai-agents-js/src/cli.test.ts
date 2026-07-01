import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
  runCli,
  type MigakiOpenAIAgentsCliIo,
} from "./cli.js";
import type { MigakiGraph } from "./types.js";

describe("openai agents instrumentation cli", () => {
  it("runs the deterministic repo-agent benchmark and reports artifact paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "migaki-cli-fixture-"));

    try {
      const result = await runCli([
        "repo-agent-benchmark",
        "--run-id",
        "cli-fixture",
        "--store",
        root,
        "--format",
        "json",
      ]);
      const output = JSON.parse(result.stdout) as Readonly<
        Record<string, unknown>
      >;
      const artifacts = output.artifacts as Readonly<Record<string, unknown>>;
      const metrics = output.metrics as Readonly<Record<string, unknown>>;

      expect(result).toMatchObject({
        exitCode: 0,
        stderr: "",
      });
      expect(output).toMatchObject({
        command: "repo-agent-benchmark",
        runId: "cli-fixture",
        version: MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
      });
      expect(metrics).toMatchObject({
        cacheableNodeCount: 13,
        llmCalls: 6,
        potentialCacheHits: 3,
        toolCalls: 7,
      });
      expect(artifacts).toEqual({
        events: join(root, "runs", "cli-fixture", "events.jsonl"),
        graph: join(root, "runs", "cli-fixture", "graph.json"),
        report: join(root, "runs", "cli-fixture", "report.md"),
      });
      await expect(
        readFile(join(root, "runs", "cli-fixture", "report.md"), "utf8"),
      ).resolves.toContain("- Potential cache hits: 3");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads a benchmark module and runs baseline plus Migaki lanes", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-cli-parallel-"));
    const cwd = "/workspace/project";
    const modulePath = "./benchmarks/repo-agent.ts";
    const importedSpecifiers: string[] = [];

    const io: MigakiOpenAIAgentsCliIo = {
      cwd() {
        return cwd;
      },
      async importModule(specifier) {
        importedSpecifiers.push(specifier);

        return {
          createRun(lane: string) {
            return createAgentRunSpec({
              instructions: `Answer from the ${lane} lane.`,
              model: new CliFakeModel("cli parallel answer", sdk),
              sdk,
            });
          },
        };
      },
    };

    try {
      const result = await runCli(
        [
          "benchmark",
          "--module",
          modulePath,
          "--run-id",
          "cli-parallel",
          "--store",
          root,
          "--format",
          "json",
        ],
        io,
      );
      const output = JSON.parse(result.stdout) as Readonly<
        Record<string, unknown>
      >;
      const comparison = output.comparison as Readonly<Record<string, unknown>>;
      const artifacts = output.artifacts as Readonly<Record<string, unknown>>;
      const migakiGraph = JSON.parse(
        await readFile(
          join(root, "runs", "cli-parallel-migaki", "graph.json"),
          "utf8",
        ),
      ) as MigakiGraph;

      expect(result).toMatchObject({
        exitCode: 0,
        stderr: "",
      });
      expect(importedSpecifiers).toEqual([
        pathToFileURL(resolve(cwd, modulePath)).href,
      ]);
      expect(output).toMatchObject({
        command: "benchmark",
        migakiRunId: "cli-parallel-migaki",
        module: modulePath,
        runId: "cli-parallel",
        version: MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
      });
      expect(comparison).toMatchObject({
        bothSucceeded: true,
        outputEqual: true,
      });
      expect(artifacts).toEqual({
        comparisonReport: join(root, "runs", "cli-parallel", "report.md"),
        migakiEvents: join(root, "runs", "cli-parallel-migaki", "events.jsonl"),
        migakiGraph: join(root, "runs", "cli-parallel-migaki", "graph.json"),
        migakiReport: join(root, "runs", "cli-parallel-migaki", "report.md"),
      });
      expect(
        migakiGraph.nodes.filter((node) => node.kind === "model_call"),
      ).toHaveLength(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails benchmark invocations without a module path", async () => {
    const result = await runCli(["benchmark", "--run-id", "missing-module"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("Missing required --module argument."),
      stdout: "",
    });
  });

  it("renders command-specific help without running a benchmark", async () => {
    const result = await runCli(["benchmark", "--help"]);

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: expect.stringContaining(
        "Usage: migaki-openai-agents-js benchmark",
      ),
    });
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
      name: "CliBenchmarkAgent",
    }),
    input: "Run the CLI benchmark.",
    runConfig: {
      model: input.model,
    },
  };
}

class CliFakeModel {
  readonly #output: string;
  readonly #sdk: TestOpenAIAgentsSdk;

  constructor(output: string, sdk: TestOpenAIAgentsSdk) {
    this.#output = output;
    this.#sdk = sdk;
  }

  getResponse(): Readonly<Record<string, unknown>> {
    return {
      output: [assistantMessage(this.#output)],
      usage: new this.#sdk.Usage({ inputTokens: 4, outputTokens: 3 }),
    };
  }

  getStreamedResponse(): AsyncIterable<unknown> {
    throw new Error("Streaming is not implemented in the fake model.");
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
