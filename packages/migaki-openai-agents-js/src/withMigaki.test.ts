import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalMigakiStore } from "./store.js";
import type { MigakiGraph } from "./types.js";
import { withMigaki } from "./withMigaki.js";

describe("withMigaki", () => {
  it("runs an OpenAI Agents SDK agent and records graph artifacts without replaying cache", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-sdk-"));

    try {
      const store = new CountingMigakiStore(root);
      const model = new TracedFakeModel(
        [
          {
            output: [
              {
                arguments: '{"query":"runner"}',
                callId: "call_1",
                id: "fc_1",
                name: "lookup_repo",
                status: "completed",
                type: "function_call",
              },
            ],
            usage: new sdk.Usage({ inputTokens: 5, outputTokens: 2 }),
          },
          {
            output: [assistantMessage("The runner file is relevant.")],
            usage: new sdk.Usage({ inputTokens: 7, outputTokens: 4 }),
          },
        ],
        sdk.createGenerationSpan,
      );
      const lookupRepo = sdk.tool({
        description: "Search the repository.",
        execute: (input: unknown) => `found:${queryFromInput(input)}`,
        name: "lookup_repo",
        parameters: {
          additionalProperties: false,
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
          type: "object",
        },
        strict: true,
      });
      const agent = new sdk.Agent({
        instructions: "Find the relevant file.",
        name: "RepoAgent",
        tools: [lookupRepo],
      });

      await withMigaki({
        cache: store,
        runConfig: {
          model,
          workflowName: "Migaki SDK smoke test",
        },
        runId: "sdk-smoke-test",
      }).run(agent, "Where is the runner?");

      const runDirectory = join(root, "runs", "sdk-smoke-test");
      const graph = JSON.parse(
        await readFile(join(runDirectory, "graph.json"), "utf8"),
      ) as MigakiGraph;
      const events = (
        await readFile(join(runDirectory, "events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Readonly<Record<string, unknown>>);
      const report = await readFile(join(runDirectory, "report.md"), "utf8");
      const modelNodes = graph.nodes.filter(
        (node) => node.kind === "model_call",
      );
      const toolNodes = graph.nodes.filter((node) => node.kind === "tool_call");

      expect(graph.nodes.map((node) => node.kind)).toEqual(
        expect.arrayContaining(["agent_step", "model_call", "tool_call"]),
      );
      expect(modelNodes).toHaveLength(2);
      expect(toolNodes).toHaveLength(1);
      expect(modelNodes.every((node) => node.metadata.cacheKey)).toBe(true);
      expect(toolNodes.every((node) => node.metadata.cacheKey)).toBe(true);
      expect(model.calls).toHaveLength(2);
      expect(store.cacheGets).toBe(0);
      expect(store.cachePuts).toBe(0);
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
      expect(report).toContain("- Model calls: 2");
      expect(report).toContain("- Tool calls: 1");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("records a failed run and failed model node before rethrowing", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-sdk-fail-"));

    try {
      const agent = new sdk.Agent({
        instructions: "Fail deterministically.",
        name: "FailingAgent",
      });

      await expect(
        withMigaki({
          cache: new LocalMigakiStore(root),
          runConfig: {
            model: new FailingFakeModel(new Error("fixture model unavailable")),
          },
          runId: "sdk-failure-test",
        }).run(agent, "Please fail."),
      ).rejects.toThrow("fixture model unavailable");

      const runDirectory = join(root, "runs", "sdk-failure-test");
      const graph = JSON.parse(
        await readFile(join(runDirectory, "graph.json"), "utf8"),
      ) as MigakiGraph;
      const events = await readFile(join(runDirectory, "events.jsonl"), "utf8");
      const report = await readFile(join(runDirectory, "report.md"), "utf8");
      const modelNodes = graph.nodes.filter(
        (node) => node.kind === "model_call",
      );

      expect(graph.status).toBe("error");
      expect(modelNodes).toHaveLength(1);
      expect(modelNodes[0]?.status).toBe("error");
      expect(modelNodes[0]?.metadata.error).toMatchObject({
        message: "fixture model unavailable",
      });
      expect(events).toContain('"type":"run.failed"');
      expect(report).toContain("## Failed Or Retried Nodes");
      expect(report).toContain("- model-migaki-model-wrapper-1");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("wraps a configured modelProvider and records the resolved model name", async () => {
    const sdk = await loadOpenAIAgentsSdkForTest();
    const root = await mkdtemp(join(tmpdir(), "migaki-sdk-provider-"));

    try {
      const provider = new FakeModelProvider(
        new TracedFakeModel(
          [
            {
              output: [assistantMessage("Provider model answered.")],
              usage: new sdk.Usage({ inputTokens: 3, outputTokens: 4 }),
            },
          ],
          sdk.createGenerationSpan,
        ),
      );
      const agent = new sdk.Agent({
        instructions: "Use provider model.",
        model: "repo-provider-model",
        name: "ProviderAgent",
      });

      await withMigaki({
        cache: new LocalMigakiStore(root),
        runConfig: {
          modelProvider: provider,
        },
        runId: "sdk-provider-test",
      }).run(agent, "Use the provider.");

      const graph = JSON.parse(
        await readFile(
          join(root, "runs", "sdk-provider-test", "graph.json"),
          "utf8",
        ),
      ) as MigakiGraph;
      const modelNodes = graph.nodes.filter(
        (node) => node.kind === "model_call",
      );

      expect(provider.requestedNames).toEqual(["repo-provider-model"]);
      expect(modelNodes).toHaveLength(1);
      expect(modelNodes[0]?.metadata.modelName).toBe("repo-provider-model");
      expect(modelNodes[0]?.metadata.usage).toMatchObject({
        totalTokens: 7,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

interface TestOpenAIAgentsSdk {
  readonly Agent: new (config: Readonly<Record<string, unknown>>) => unknown;
  readonly Usage: new (input: Readonly<Record<string, unknown>>) => unknown;
  readonly createGenerationSpan: CreateGenerationSpan;
  readonly tool: (config: Readonly<Record<string, unknown>>) => unknown;
}

interface TestSpan {
  readonly spanData: Record<string, unknown>;
  end(): void;
  start(): void;
}

type CreateGenerationSpan = (options: {
  readonly data: Record<string, unknown>;
}) => TestSpan;

const openAiAgentsPackageName = "@openai/agents";

async function loadOpenAIAgentsSdkForTest(): Promise<TestOpenAIAgentsSdk> {
  const loaded = (await import(openAiAgentsPackageName)) as unknown;

  if (!isRecord(loaded)) {
    throw new Error("OpenAI Agents SDK did not load.");
  }

  const Agent = loaded.Agent;
  const Usage = loaded.Usage;
  const createGenerationSpan = loaded.createGenerationSpan;
  const tool = loaded.tool;

  if (
    typeof Agent !== "function" ||
    typeof Usage !== "function" ||
    typeof createGenerationSpan !== "function" ||
    typeof tool !== "function"
  ) {
    throw new Error("OpenAI Agents SDK test exports were not available.");
  }

  return {
    Agent: Agent as TestOpenAIAgentsSdk["Agent"],
    Usage: Usage as TestOpenAIAgentsSdk["Usage"],
    createGenerationSpan: createGenerationSpan as CreateGenerationSpan,
    tool: tool as TestOpenAIAgentsSdk["tool"],
  };
}

class TracedFakeModel {
  readonly #createGenerationSpan: CreateGenerationSpan;
  readonly #responses: unknown[];
  readonly calls: unknown[] = [];

  constructor(
    responses: readonly unknown[],
    createGenerationSpan: CreateGenerationSpan,
  ) {
    this.#createGenerationSpan = createGenerationSpan;
    this.#responses = [...responses];
  }

  async getResponse(request: unknown): Promise<unknown> {
    this.calls.push(request);
    const response = this.#responses.shift();

    if (response === undefined) {
      throw new Error("No fake model response queued.");
    }

    const tracing = readUnknownProperty(request, "tracing");
    const span =
      tracing === false
        ? undefined
        : this.#createGenerationSpan({
            data: {
              input: [{ input: readUnknownProperty(request, "input") }],
              model: "fake-repo-model",
              model_config: readUnknownProperty(request, "modelSettings") ?? {},
            },
          });

    span?.start();

    try {
      if (span !== undefined) {
        span.spanData.output = responseOutput(response).map((item) => ({
          item,
        }));
        span.spanData.usage = responseUsage(response);
      }

      return response;
    } finally {
      span?.end();
    }
  }

  getStreamedResponse(): AsyncIterable<unknown> {
    throw new Error("Streaming is not implemented in the fake model.");
  }
}

class FailingFakeModel {
  readonly #error: Error;

  constructor(error: Error) {
    this.#error = error;
  }

  async getResponse(): Promise<unknown> {
    throw this.#error;
  }

  getStreamedResponse(): AsyncIterable<unknown> {
    throw new Error("Streaming is not implemented in the fake model.");
  }
}

class FakeModelProvider {
  readonly #model: unknown;
  readonly requestedNames: string[] = [];

  constructor(model: unknown) {
    this.#model = model;
  }

  getModel(modelName?: string): unknown {
    this.requestedNames.push(modelName ?? "");

    return this.#model;
  }
}

class CountingMigakiStore extends LocalMigakiStore {
  cacheGets = 0;
  cachePuts = 0;

  override async getCachedOutput(key: {
    readonly dependencyHash: string;
    readonly inputHash: string;
    readonly name: string;
    readonly op: "model_call" | "tool_call";
    readonly runtimeHash: string;
  }): Promise<unknown | undefined> {
    this.cacheGets += 1;

    return super.getCachedOutput(key);
  }

  override async putCachedOutput(
    key: {
      readonly dependencyHash: string;
      readonly inputHash: string;
      readonly name: string;
      readonly op: "model_call" | "tool_call";
      readonly runtimeHash: string;
    },
    value: unknown,
  ): Promise<void> {
    this.cachePuts += 1;

    await super.putCachedOutput(key, value);
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

function responseOutput(response: unknown): readonly unknown[] {
  const output = readUnknownProperty(response, "output");

  return Array.isArray(output) ? output : [];
}

function responseUsage(response: unknown): Readonly<Record<string, unknown>> {
  const usage = readUnknownProperty(response, "usage");

  if (!isRecord(usage)) {
    return {};
  }

  return {
    input_tokens: usage.inputTokens ?? usage.input_tokens ?? 0,
    output_tokens: usage.outputTokens ?? usage.output_tokens ?? 0,
  };
}

function queryFromInput(input: unknown): string {
  const query = readUnknownProperty(input, "query");

  return typeof query === "string" ? query : "unknown";
}

function readUnknownProperty(value: unknown, property: string): unknown {
  return isRecord(value) ? value[property] : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
