import { createHash } from "node:crypto";
import {
  mkdir as makeDirectory,
  writeFile as writeTextFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  createRepoAgentTrajectoryComparisonBenchmark,
  type RepoAgentTrajectoryComparisonBenchmark,
} from "./benchmark.js";

export const REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION =
  "migaki.example.repo-agent-live-comparison.v0";

export interface LiveOpenAIUsage {
  readonly cachedInputTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface LiveModelCallObservation {
  readonly durationMs: number;
  readonly model: string;
  readonly nodeId: "node-plan-edit" | "node-summarize";
  readonly outputHash: string;
  readonly requestHash: string;
  readonly responseIdHash?: string;
  readonly runId: string;
  readonly status: "succeeded";
  readonly usage: LiveOpenAIUsage;
}

export interface LiveBenchmarkFile {
  readonly contents: string;
  readonly mediaType: "application/json" | "text/markdown";
  readonly path: string;
}

export interface LiveRepoAgentComparisonBenchmark {
  readonly artifactRoot: string;
  readonly baseBenchmark: RepoAgentTrajectoryComparisonBenchmark;
  readonly comparisonId: string;
  readonly files: readonly LiveBenchmarkFile[];
  readonly generatedAt: string;
  readonly model: string;
  readonly observations: readonly LiveModelCallObservation[];
  readonly reportMarkdown: string;
  readonly version: typeof REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION;
}

export interface LiveBenchmarkFileWriter {
  readonly mkdir: (
    path: string,
    options: { readonly recursive: true },
  ) => Promise<void> | void;
  readonly writeFile: (path: string, contents: string) => Promise<void> | void;
}

export interface LiveBenchmarkClock {
  readonly now: () => number;
}

export interface LiveOpenAIResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

export type LiveOpenAIFetch = (
  url: string,
  init: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "POST";
  },
) => Promise<LiveOpenAIResponse>;

export interface CreateLiveRepoAgentComparisonBenchmarkOptions {
  readonly apiKey?: string;
  readonly clock?: LiveBenchmarkClock;
  readonly fetch?: LiveOpenAIFetch;
  readonly generatedAt?: string;
  readonly model?: string;
}

const liveComparisonId = "repo-agent-two-run-live";
const liveArtifactRoot = `.migaki/comparisons/${liveComparisonId}`;
const defaultModel = "gpt-5.5";
const openAIResponsesUrl = "https://api.openai.com/v1/responses";

const nodeFileWriter = {
  async mkdir(path: string, options: { readonly recursive: true }) {
    await makeDirectory(path, options);
  },
  async writeFile(path: string, contents: string) {
    await writeTextFile(path, contents, "utf8");
  },
} satisfies LiveBenchmarkFileWriter;

const systemInstruction =
  "You are participating in a Migaki live benchmark. Return concise plain text only. Do not include private data.";

export async function createLiveRepoAgentComparisonBenchmark(
  options: CreateLiveRepoAgentComparisonBenchmarkOptions = {},
): Promise<LiveRepoAgentComparisonBenchmark> {
  const apiKey = options.apiKey ?? process.env["OPENAI_API_KEY"];

  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      "OPENAI_API_KEY is required for the live repo-agent comparison benchmark.",
    );
  }

  const model =
    options.model ?? process.env["OPENAI_LIVE_BENCHMARK_MODEL"] ?? defaultModel;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const clock = options.clock ?? { now: () => Date.now() };
  const fetcher = options.fetch ?? defaultFetch;
  const baseBenchmark = await createRepoAgentTrajectoryComparisonBenchmark();
  const observations = await runLiveModelCalls({
    apiKey,
    clock,
    fetcher,
    model,
  });
  const reportMarkdown = renderLiveRepoAgentComparisonReport({
    baseBenchmark,
    generatedAt,
    model,
    observations,
  });
  const files = createLiveBenchmarkFiles({
    baseBenchmark,
    generatedAt,
    model,
    observations,
    reportMarkdown,
  });

  return {
    artifactRoot: liveArtifactRoot,
    baseBenchmark,
    comparisonId: liveComparisonId,
    files,
    generatedAt,
    model,
    observations,
    reportMarkdown,
    version: REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION,
  };
}

export async function writeLiveRepoAgentComparisonBenchmark(
  benchmark: LiveRepoAgentComparisonBenchmark,
  writer: LiveBenchmarkFileWriter = nodeFileWriter,
): Promise<readonly string[]> {
  const createdDirectories = new Set<string>();

  for (const file of benchmark.files) {
    const directory = dirname(file.path);

    if (!createdDirectories.has(directory)) {
      await writer.mkdir(directory, { recursive: true });
      createdDirectories.add(directory);
    }

    await writer.writeFile(file.path, file.contents);
  }

  return benchmark.files.map((file) => file.path);
}

function renderLiveRepoAgentComparisonReport(input: {
  readonly baseBenchmark: RepoAgentTrajectoryComparisonBenchmark;
  readonly generatedAt: string;
  readonly model: string;
  readonly observations: readonly LiveModelCallObservation[];
}): string {
  const usage = aggregateUsage(input.observations);

  return [
    "# Migaki Live Repo-Agent Trajectory Comparison",
    "",
    `Generated at: ${input.generatedAt}`,
    `Model: ${input.model}`,
    `Comparison: ${liveComparisonId}`,
    "",
    "## Live Observations",
    "",
    `- Live OpenAI model calls: ${input.observations.length}`,
    `- Observed input tokens: ${formatOptionalNumber(usage.inputTokens)}`,
    `- Observed cached input tokens: ${formatOptionalNumber(
      usage.cachedInputTokens,
    )}`,
    `- Observed output tokens: ${formatOptionalNumber(usage.outputTokens)}`,
    `- Observed total tokens: ${formatOptionalNumber(usage.totalTokens)}`,
    `- Observed wall-clock duration ms: ${input.observations.reduce(
      (total, observation) => total + observation.durationMs,
      0,
    )}`,
    "",
    "## Reuse Evidence",
    "",
    `- Reusable model calls: ${input.baseBenchmark.comparison.metrics.reusableModelCalls}`,
    `- Reusable tool calls: ${input.baseBenchmark.comparison.metrics.reusableToolCalls}`,
    `- Estimated potentially avoidable model calls: ${input.baseBenchmark.comparison.metrics.estimatedAvoidableModelCalls}`,
    `- Estimated potentially avoidable tool calls: ${input.baseBenchmark.comparison.metrics.estimatedAvoidableToolCalls}`,
    `- Estimated potentially avoidable tokens: ${input.baseBenchmark.comparison.metrics.estimatedAvoidableTokens}`,
    "",
    "## Claims",
    "",
    "- Migaki can identify reusable agent trajectory nodes before replay.",
    "- Live calls produced usage observations for model-call nodes.",
    "",
    "## Cannot Claim",
    "",
    "- Live latency or cost improvement.",
    "- Actual avoided live-provider work before replay exists.",
    "- Semantic, fuzzy, vector, or routed reuse.",
    "",
    "## Privacy",
    "",
    "- Raw OpenAI prompts and responses are not stored in these artifacts.",
    "- API keys are read from the process environment and are not serialized.",
    "- Response ids and output text are recorded only as SHA-256 hashes.",
    "",
  ].join("\n");
}

async function runLiveModelCalls(input: {
  readonly apiKey: string;
  readonly clock: LiveBenchmarkClock;
  readonly fetcher: LiveOpenAIFetch;
  readonly model: string;
}): Promise<readonly LiveModelCallObservation[]> {
  const observations: LiveModelCallObservation[] = [];

  for (const runId of ["repo-agent-live-run-1", "repo-agent-live-run-2"]) {
    observations.push(
      await callOpenAIModel({
        ...input,
        nodeId: "node-plan-edit",
        prompt:
          "Plan one safe TypeScript edit for a repo-agent benchmark. Mention tests briefly.",
        runId,
      }),
    );
    observations.push(
      await callOpenAIModel({
        ...input,
        nodeId: "node-summarize",
        prompt:
          "Summarize a deterministic repo-agent benchmark result in one sentence.",
        runId,
      }),
    );
  }

  return observations;
}

async function callOpenAIModel(input: {
  readonly apiKey: string;
  readonly clock: LiveBenchmarkClock;
  readonly fetcher: LiveOpenAIFetch;
  readonly model: string;
  readonly nodeId: LiveModelCallObservation["nodeId"];
  readonly prompt: string;
  readonly runId: string;
}): Promise<LiveModelCallObservation> {
  const requestBody = {
    input: [
      {
        content: systemInstruction,
        role: "system",
      },
      {
        content: input.prompt,
        role: "user",
      },
    ],
    max_output_tokens: 64,
    metadata: {
      benchmark: liveComparisonId,
      node_id: input.nodeId,
      run_id: input.runId,
    },
    model: input.model,
    reasoning: {
      effort: "low",
    },
    store: false,
    text: {
      verbosity: "low",
    },
  };
  const startedAt = input.clock.now();
  const response = await input.fetcher(openAIResponsesUrl, {
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const durationMs = input.clock.now() - startedAt;
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI Responses API request failed with status ${response.status}: ${readErrorMessage(
        responseText,
      )}`,
    );
  }

  const payload = parseJsonRecord(responseText);
  const outputText = readOutputText(payload);

  return {
    durationMs,
    model: input.model,
    nodeId: input.nodeId,
    outputHash: hashValue(outputText),
    requestHash: hashValue(requestBody),
    ...(readString(payload, "id") !== undefined
      ? { responseIdHash: hashValue(readString(payload, "id")) }
      : {}),
    runId: input.runId,
    status: "succeeded",
    usage: readUsage(payload["usage"]),
  };
}

function createLiveBenchmarkFiles(input: {
  readonly baseBenchmark: RepoAgentTrajectoryComparisonBenchmark;
  readonly generatedAt: string;
  readonly model: string;
  readonly observations: readonly LiveModelCallObservation[];
  readonly reportMarkdown: string;
}): readonly LiveBenchmarkFile[] {
  const baseFiles = input.baseBenchmark.files.map((file) => ({
    ...file,
    path: file.path.replace(
      ".migaki/comparisons/repo-agent-two-run-exact",
      liveArtifactRoot,
    ),
  }));

  return [
    ...baseFiles,
    {
      contents: serializeStableJson({
        generatedAt: input.generatedAt,
        model: input.model,
        observations: input.observations,
        version: REPO_AGENT_LIVE_COMPARISON_BENCHMARK_VERSION,
      }),
      mediaType: "application/json",
      path: `${liveArtifactRoot}/live-observations.json`,
    },
    {
      contents: input.reportMarkdown,
      mediaType: "text/markdown",
      path: `${liveArtifactRoot}/live-report.md`,
    },
  ];
}

async function defaultFetch(
  url: string,
  init: Parameters<LiveOpenAIFetch>[1],
): Promise<LiveOpenAIResponse> {
  return fetch(url, init);
}

function aggregateUsage(
  observations: readonly LiveModelCallObservation[],
): LiveOpenAIUsage {
  const cachedInputTokens = sumOptional(
    observations.map((observation) => observation.usage.cachedInputTokens),
  );
  const inputTokens = sumOptional(
    observations.map((observation) => observation.usage.inputTokens),
  );
  const outputTokens = sumOptional(
    observations.map((observation) => observation.usage.outputTokens),
  );
  const totalTokens = sumOptional(
    observations.map((observation) => observation.usage.totalTokens),
  );

  return {
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function sumOptional(
  values: readonly (number | undefined)[],
): number | undefined {
  if (values.every((value) => value === undefined)) {
    return undefined;
  }

  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function readUsage(value: unknown): LiveOpenAIUsage {
  if (!isRecord(value)) {
    return {};
  }

  const details = isRecord(value["input_tokens_details"])
    ? value["input_tokens_details"]
    : undefined;
  const cachedInputTokens = readNumber(details, "cached_tokens");
  const inputTokens = readNumber(value, "input_tokens");
  const outputTokens = readNumber(value, "output_tokens");
  const totalTokens = readNumber(value, "total_tokens");

  return {
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function readOutputText(payload: Readonly<Record<string, unknown>>): string {
  const outputText = readString(payload, "output_text");

  if (outputText !== undefined) {
    return outputText;
  }

  return JSON.stringify(payload["output"] ?? "");
}

function readErrorMessage(responseText: string): string {
  try {
    const payload = parseJsonRecord(responseText);
    const error = payload["error"];

    if (isRecord(error)) {
      return readString(error, "message") ?? "unknown error";
    }
  } catch {
    return "invalid JSON error response";
  }

  return "unknown error";
}

function parseJsonRecord(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(serialized);

  if (!isRecord(parsed)) {
    throw new Error("Expected a JSON object from the OpenAI Responses API.");
  }

  return parsed;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];

  return typeof value === "string" ? value : undefined;
}

function readNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function serializeStableJson(value: unknown): string {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
}

function hashValue(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(toStableJsonValue(value)))
    .digest("hex")}`;
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort(compareStrings)) {
    const child = value[key];

    if (child === undefined) {
      continue;
    }

    stable[key] = toStableJsonValue(child);
  }

  return stable;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
