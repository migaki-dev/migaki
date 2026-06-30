import { createMigakiReportSummary } from "./report.js";
import { LocalMigakiStore } from "./store.js";
import type { MigakiClock, MigakiGraph, MigakiStore } from "./types.js";
import { MigakiRecorder } from "./recorder.js";

export interface RepoAgentBenchmarkOptions {
  readonly clock?: MigakiClock;
  readonly runId?: string;
  readonly store?: MigakiStore;
}

export interface RepoAgentBenchmarkMetrics {
  readonly cacheableNodeCount: number;
  readonly duplicateModelCallShapedOperations: number;
  readonly duplicateToolCalls: number;
  readonly latencyMs?: number | undefined;
  readonly llmCalls: number;
  readonly potentialCacheHits: number;
  readonly tokens: number;
  readonly toolCalls: number;
}

export interface RepoAgentBenchmarkResult {
  readonly graph: MigakiGraph;
  readonly metrics: RepoAgentBenchmarkMetrics;
  readonly output: string;
  readonly runId: string;
}

const defaultRunId = "repo-agent-benchmark";

export async function runRepoAgentBenchmark(
  options: RepoAgentBenchmarkOptions = {},
): Promise<RepoAgentBenchmarkResult> {
  const clock = options.clock ?? new StepClock("2026-01-01T00:00:00.000Z");
  const runId = options.runId ?? defaultRunId;
  const store = options.store ?? new LocalMigakiStore();
  const recorder = new MigakiRecorder({
    clock,
    metadata: {
      benchmark: "repo-agent-task",
      liveProviders: false,
    },
    runId,
    store,
  });

  recorder.recordRunStarted({
    task: "Read files, find relevant files, summarize, patch, test, debug, answer.",
  });
  recorder.recordAgentStarted({
    agentName: "repo-agent",
    input: "Investigate failing repo task and produce a patch.",
  });
  recordModelCall(recorder, clock, {
    input: {
      files: ["package.json", "packages/runtime/src/runner.ts"],
      goal: "find likely patch surface",
    },
    modelName: "gpt-5-mini",
    output: {
      next: "searchRepoTool",
      rationale: "Need local symbols before proposing patch.",
    },
    totalTokens: 68,
  });
  recordToolCall(recorder, clock, {
    args: { path: "package.json" },
    output: { bytes: 944, found: true },
    toolName: "readFileTool",
  });
  recordToolCall(recorder, clock, {
    args: { query: "runOptimizationPasses" },
    output: { files: ["packages/runtime/src/runner.ts"] },
    toolName: "searchRepoTool",
  });
  recordToolCall(recorder, clock, {
    args: { query: "runOptimizationPasses" },
    output: { files: ["packages/runtime/src/runner.ts"] },
    toolName: "searchRepoTool",
  });
  recordModelCall(recorder, clock, {
    input: {
      files: ["packages/runtime/src/runner.ts"],
      question: "summarize patch surface",
    },
    modelName: "gpt-5-mini",
    output: { summary: "Runner emits pass evidence and warnings." },
    totalTokens: 74,
  });
  recordModelCall(recorder, clock, {
    input: {
      files: ["packages/runtime/src/runner.ts"],
      question: "summarize patch surface",
    },
    modelName: "gpt-5-mini",
    output: { summary: "Runner emits pass evidence and warnings." },
    totalTokens: 74,
  });
  recordModelCall(recorder, clock, {
    input: {
      summary: "Runner emits pass evidence and warnings.",
      task: "propose patch",
    },
    modelName: "gpt-5-mini",
    output: { patch: "Add evidence hook for pass timing." },
    totalTokens: 92,
  });
  recordToolCall(recorder, clock, {
    args: { patch: "Add evidence hook for pass timing." },
    output: { changedFiles: ["packages/runtime/src/runner.ts"] },
    toolName: "applyPatchTool",
  });
  recordToolCall(recorder, clock, {
    args: { command: "pnpm test -- runner" },
    error: new Error("runner evidence fixture mismatch"),
    metadata: { estimatedCostUsd: 0 },
    output: { exitCode: 1 },
    toolName: "runTestsTool",
  });
  recordModelCall(recorder, clock, {
    input: {
      failure: "runner evidence fixture mismatch",
      task: "debug",
    },
    metadata: {
      retryAttempt: 1,
      retryOf: "tool_call-0009",
    },
    modelName: "gpt-5-mini",
    output: { fix: "Update deterministic fixture timestamp." },
    totalTokens: 81,
  });
  recordToolCall(recorder, clock, {
    args: { patch: "Update deterministic fixture timestamp." },
    metadata: {
      retryAttempt: 1,
      retryOf: "tool_call-0008",
    },
    output: { changedFiles: ["packages/runtime/src/runner.test.ts"] },
    toolName: "applyPatchTool",
  });
  recordToolCall(recorder, clock, {
    args: { command: "pnpm test -- runner" },
    metadata: {
      retryAttempt: 1,
      retryOf: "tool_call-0009",
    },
    output: { exitCode: 0 },
    toolName: "runTestsTool",
  });
  recordModelCall(recorder, clock, {
    input: {
      patch: "evidence timing hook",
      tests: "passing",
    },
    modelName: "gpt-5-mini",
    output: { final: "Patch proposed and tests pass." },
    totalTokens: 55,
  });

  const output = "Patch proposed and tests pass.";
  const graph = await recorder.finalizeRunCompleted(output);
  const summary = createMigakiReportSummary(graph);

  return {
    graph,
    metrics: {
      cacheableNodeCount: summary.cacheableNodeCount,
      duplicateModelCallShapedOperations:
        summary.duplicateModelCallShapedOperations,
      duplicateToolCalls: summary.duplicateToolCalls,
      llmCalls: summary.llmCalls,
      potentialCacheHits: summary.potentialCacheHits,
      tokens: summary.tokens,
      toolCalls: summary.toolCalls,
      ...(summary.latencyMs !== undefined
        ? { latencyMs: summary.latencyMs }
        : {}),
    },
    output,
    runId,
  };
}

function recordModelCall(
  recorder: MigakiRecorder,
  clock: MigakiClock,
  input: {
    readonly input: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly modelName: string;
    readonly output: unknown;
    readonly totalTokens: number;
  },
): void {
  const inputTokens = Math.floor(input.totalTokens * 0.6);
  const outputTokens = input.totalTokens - inputTokens;
  const spanId = `benchmark-model-${clock.now().getTime()}`;

  recorder.recordModelCallStarted({
    input: input.input,
    metadata: {
      estimatedCostUsd: input.totalTokens * 0.0000005,
      ...(input.metadata ?? {}),
    },
    modelName: input.modelName,
    modelParams: {
      temperature: 0,
    },
    outputSchema: "text",
    spanId,
  });

  tick(clock, 17);
  recorder.completeModelCallBySpan({
    input: input.input,
    metadata: {
      estimatedCostUsd: input.totalTokens * 0.0000005,
      ...(input.metadata ?? {}),
    },
    modelName: input.modelName,
    modelParams: {
      temperature: 0,
    },
    output: input.output,
    outputSchema: "text",
    spanId,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: input.totalTokens,
    },
  });
}

function recordToolCall(
  recorder: MigakiRecorder,
  clock: MigakiClock,
  input: {
    readonly args: unknown;
    readonly error?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly output: unknown;
    readonly toolName: string;
  },
): void {
  recorder.recordToolCallStarted({
    args: input.args,
    toolName: input.toolName,
    toolVersion: "fixture.v0",
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
  tick(clock, 5);
  recorder.completeToolCall({
    args: input.args,
    error: input.error,
    output: input.output,
    toolName: input.toolName,
    toolVersion: "fixture.v0",
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

function tick(clock: MigakiClock, durationMs: number): void {
  if ("advanceBy" in clock && typeof clock.advanceBy === "function") {
    clock.advanceBy(durationMs);
  }
}

class StepClock implements MigakiClock {
  #nowMs: number;

  constructor(startTime: string) {
    this.#nowMs = Date.parse(startTime);
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  advanceBy(durationMs: number): void {
    this.#nowMs += durationMs;
  }
}
