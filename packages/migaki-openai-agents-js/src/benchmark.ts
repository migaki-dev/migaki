import { performance } from "node:perf_hooks";

import {
  compareObservedExecutionGraphs,
  createReuseDecisionArtifact,
  renderReuseDecisionArtifact,
} from "@migaki/runtime";
import type {
  Artifact,
  ExecutionEdge,
  ExecutionGraph,
  ExecutionNode,
  Metadata,
  ObservedTrajectoryComparison,
  ReuseDecisionArtifact,
} from "@migaki/runtime";

import { createMigakiReportSummary } from "./report.js";
import { serializeStableJson, stableHash } from "./hash.js";
import { LocalMigakiStore } from "./store.js";
import type {
  MigakiArtifactStore,
  MigakiClock,
  MigakiErrorSnapshot,
  MigakiGraph,
  MigakiNode,
  MigakiReportStore,
  MigakiStore,
} from "./types.js";
import { MigakiRecorder, snapshotError } from "./recorder.js";
import { withMigaki, type WithMigakiOptions } from "./withMigaki.js";

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

export interface RepoAgentReuseBenchmarkOptions {
  readonly runId?: string;
  readonly store?: MigakiStore;
}

export interface RepoAgentReuseBenchmarkResult {
  readonly artifacts: {
    readonly comparison: string;
    readonly currentEvents: string;
    readonly currentGraph: string;
    readonly currentReport: string;
    readonly previousEvents: string;
    readonly previousGraph: string;
    readonly previousReport: string;
    readonly report: string;
    readonly reuseDecision: string;
  };
  readonly comparison: ObservedTrajectoryComparison;
  readonly current: RepoAgentBenchmarkResult;
  readonly previous: RepoAgentBenchmarkResult;
  readonly report: string;
  readonly reuseDecision: ReuseDecisionArtifact;
  readonly runId: string;
}

export type MigakiBenchmarkLane = "baseline" | "migaki";

export interface MigakiAgentRunSpec {
  readonly agent: unknown;
  readonly input: unknown;
  readonly options?: unknown;
  readonly runConfig?: Readonly<Record<string, unknown>>;
}

export interface MigakiBenchmarkTimer {
  now(): number;
}

export interface ParallelMigakiBenchmarkOptions {
  readonly createRun:
    | ((
        lane: MigakiBenchmarkLane,
      ) => MigakiAgentRunSpec | Promise<MigakiAgentRunSpec>)
    | (() => MigakiAgentRunSpec | Promise<MigakiAgentRunSpec>);
  readonly migakiOptions?: Omit<
    WithMigakiOptions,
    "cache" | "runConfig" | "runId" | "store"
  >;
  readonly migakiRunId?: string;
  readonly runId: string;
  readonly store?: MigakiStore;
  readonly timer?: MigakiBenchmarkTimer;
  readonly writeReport?: boolean;
}

export interface ParallelBenchmarkLaneResult {
  readonly durationMs: number;
  readonly error?: MigakiErrorSnapshot;
  readonly output?: unknown;
  readonly status: "error" | "ok";
}

export interface ParallelMigakiBenchmarkComparison {
  readonly baselineDurationMs: number;
  readonly bothSucceeded: boolean;
  readonly migakiDurationMs: number;
  readonly overheadMs: number;
  readonly overheadRatio?: number;
  readonly outputEqual?: boolean;
}

export interface ParallelMigakiBenchmarkResult {
  readonly baseline: ParallelBenchmarkLaneResult;
  readonly comparison: ParallelMigakiBenchmarkComparison;
  readonly migaki: ParallelBenchmarkLaneResult;
  readonly migakiRunId: string;
  readonly report: string;
  readonly runId: string;
}

const defaultRunId = "repo-agent-benchmark";
const defaultReuseRunId = "repo-agent-reuse-benchmark";
const executionGraphVersion = "migaki.execution-graph.v0";

const defaultTimer: MigakiBenchmarkTimer = {
  now() {
    return performance.now();
  },
};

export async function runParallelMigakiBenchmark(
  options: ParallelMigakiBenchmarkOptions,
): Promise<ParallelMigakiBenchmarkResult> {
  const store = options.store ?? new LocalMigakiStore();
  const timer = options.timer ?? defaultTimer;
  const migakiRunId = options.migakiRunId ?? `${options.runId}-migaki`;
  const [baseline, migaki] = await Promise.all([
    measureLane(timer, async () => {
      const spec = await options.createRun("baseline");

      return runOpenAIAgentsBaseline(spec);
    }),
    measureLane(timer, async () => {
      const spec = await options.createRun("migaki");

      return withMigaki({
        ...(options.migakiOptions ?? {}),
        runConfig: spec.runConfig,
        runId: migakiRunId,
        store,
      }).run(spec.agent, spec.input, spec.options);
    }),
  ]);
  const result: ParallelMigakiBenchmarkResult = {
    baseline,
    comparison: compareParallelBenchmarkLanes(baseline, migaki),
    migaki,
    migakiRunId,
    report: "",
    runId: options.runId,
  };
  const report = renderParallelMigakiBenchmarkReport(result);
  const resultWithReport = {
    ...result,
    report,
  };

  if (options.writeReport !== false && isReportStore(store)) {
    await store.writeReport(options.runId, report);
  }

  return resultWithReport;
}

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

export async function runRepoAgentReuseBenchmark(
  options: RepoAgentReuseBenchmarkOptions = {},
): Promise<RepoAgentReuseBenchmarkResult> {
  const runId = options.runId ?? defaultReuseRunId;
  const store = options.store ?? new LocalMigakiStore();
  const previousRunId = `${runId}-a`;
  const currentRunId = `${runId}-b`;
  const previous = await recordRepoAgentReuseTrajectory({
    runId: previousRunId,
    store,
    variant: "previous",
  });
  const current = await recordRepoAgentReuseTrajectory({
    runId: currentRunId,
    store,
    variant: "current",
  });
  const comparison = compareObservedExecutionGraphs(
    toExecutionGraph(previous.graph),
    toExecutionGraph(current.graph),
  );
  const reuseDecision = createReuseDecisionArtifact(comparison, {
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const artifacts = repoAgentReuseArtifacts(runId, previousRunId, currentRunId);
  const report = renderRepoAgentReuseBenchmarkReport({
    artifacts,
    comparison,
    reuseDecision,
    runId,
  });

  if (isReportStore(store)) {
    await store.writeReport(runId, report);
  }

  if (isArtifactStore(store)) {
    await store.writeArtifact(
      runId,
      "comparison.json",
      serializeStableJson(comparison, 2),
    );
    await store.writeArtifact(
      runId,
      "reuse-decision.json",
      serializeStableJson(reuseDecision, 2),
    );
    await store.writeArtifact(
      runId,
      "reuse-decision.md",
      renderReuseDecisionArtifact(reuseDecision, "human"),
    );
  }

  return {
    artifacts,
    comparison,
    current,
    previous,
    report,
    reuseDecision,
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
    readonly spanId?: string;
    readonly totalTokens: number;
  },
): void {
  const inputTokens = Math.floor(input.totalTokens * 0.6);
  const outputTokens = input.totalTokens - inputTokens;
  const spanId = input.spanId ?? `benchmark-model-${clock.now().getTime()}`;

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

async function recordRepoAgentReuseTrajectory(input: {
  readonly runId: string;
  readonly store: MigakiStore;
  readonly variant: "current" | "previous";
}): Promise<RepoAgentBenchmarkResult> {
  const clock = new StepClock("2026-01-01T00:00:00.000Z");
  const recorder = new MigakiRecorder({
    clock,
    metadata: {
      benchmark: "repo-agent-reuse-task",
      liveProviders: false,
    },
    runId: input.runId,
    store: input.store,
  });

  recorder.recordRunStarted({
    task: "Read repository context, summarize, inspect files, and propose a patch.",
  });
  recorder.recordAgentStarted({
    agentName: "repo-agent",
    input: "Compare reusable repository-agent steps.",
  });
  recordModelCall(recorder, clock, {
    input: {
      files: ["package.json", "packages/runtime/src/runner.ts"],
      goal: "find likely patch surface",
    },
    metadata: reusableModelMetadata(),
    modelName: "gpt-5-mini",
    output: {
      next: "readFileTool",
      rationale: "Need the runner contract before proposing a patch.",
    },
    spanId: "summary-reuse",
    totalTokens: 68,
  });
  recordToolCall(recorder, clock, {
    args: { path: "packages/runtime/src/runner.ts", range: "1-80" },
    metadata: readOnlyToolMetadata({
      artifactId: "runner-read",
      fingerprint: "sha256:runner-read-v1",
    }),
    output: { bytes: 4096, found: true },
    toolName: "readFileTool",
  });
  recordToolCall(recorder, clock, {
    args: { command: "git status --short" },
    metadata: {
      estimatedCostUsd: 0,
      reuse: {
        policyAllowed: true,
      },
    },
    output: { stdout: "" },
    toolName: "shellTool",
  });
  recordModelCall(recorder, clock, {
    input: {
      summary:
        input.variant === "previous"
          ? "Runner emits pass evidence."
          : "Runner emits pass evidence and comparison metadata.",
      task: "propose patch",
    },
    metadata: reusableModelMetadata(),
    modelName: "gpt-5-mini",
    output: { patch: "Add deterministic comparison report." },
    spanId: "patch-plan",
    totalTokens: 92,
  });

  const output = "Deterministic repo-agent trajectory recorded.";
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
    runId: input.runId,
  };
}

function reusableModelMetadata(): Readonly<Record<string, unknown>> {
  return {
    reuse: {
      policyAllowed: true,
      validatorsPassed: ["deterministic-fixture-output"],
      validatorsRequired: ["deterministic-fixture-output"],
    },
  };
}

function readOnlyToolMetadata(input: {
  readonly artifactId: string;
  readonly fingerprint: string;
}): Readonly<Record<string, unknown>> {
  return {
    estimatedCostUsd: 0,
    fileArtifact: {
      fingerprint: input.fingerprint,
      id: input.artifactId,
      kind: "file",
      metadata: {
        reuse: {
          freshnessStatus: "verified",
        },
      },
    },
    reuse: {
      policyAllowed: true,
      sideEffectClass: "read_only",
    },
  };
}

function toExecutionGraph(graph: MigakiGraph): ExecutionGraph {
  return {
    createdAt: graph.createdAt,
    edges: graph.edges.map(toExecutionEdge),
    ...(graph.endedAt === undefined ? {} : { endedAt: graph.endedAt }),
    metadata: {
      ...graph.metadata,
      reuse: {
        ...(readRecord(graph.metadata, "reuse") ?? {}),
        runtimeCompatibilityKey: "migaki-openai-agents-js/repo-agent/v0",
      },
    },
    nodes: graph.nodes.map(toExecutionNode),
    runId: graph.runId,
    startedAt: graph.startedAt,
    status: graph.status,
    version: executionGraphVersion,
  };
}

function toExecutionNode(node: MigakiNode): ExecutionNode {
  const cacheKey = readRecord(node.metadata, "cacheKey");
  const durationMs = nodeDurationMs(node);
  const name = readNodeName(node);

  return {
    artifacts: readNodeArtifacts(node),
    dependencies: [],
    ...(node.endedAt === undefined ? {} : { endedAt: node.endedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
    id: node.id,
    metadata: node.metadata,
    metrics: nodeMetrics(node),
    operation: {
      ...(cacheKey === undefined ? {} : { fingerprint: stableHash(cacheKey) }),
      id: node.id,
      kind: node.kind,
      ...(name === undefined ? {} : { name }),
    },
    startedAt: node.startedAt,
    status: node.status,
  };
}

function toExecutionEdge(edge: MigakiGraph["edges"][number]): ExecutionEdge {
  return {
    from: edge.from,
    id: `${edge.from}->${edge.to}:${edge.kind}`,
    kind: edge.kind,
    metadata: {},
    to: edge.to,
  };
}

function nodeMetrics(node: MigakiNode): ExecutionNode["metrics"] {
  const usage = readRecord(node.metadata, "usage");
  const costUsd = readNumber(node.metadata, "estimatedCostUsd");
  const durationMs = nodeDurationMs(node);
  const inputTokens = readNumber(usage, "inputTokens");
  const outputTokens = readNumber(usage, "outputTokens");
  const totalTokens = readNumber(usage, "totalTokens");

  return {
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(durationMs === undefined ? {} : { durationMs, latencyMs: durationMs }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function readNodeArtifacts(node: MigakiNode): readonly Artifact[] {
  const artifact = readRecord(node.metadata, "fileArtifact");

  if (artifact === undefined) {
    return [];
  }

  const id = readString(artifact, "id");
  const kind = readString(artifact, "kind");
  const fingerprint = readString(artifact, "fingerprint");

  if (id === undefined || kind === undefined) {
    return [];
  }

  return [
    {
      ...(fingerprint === undefined ? {} : { fingerprint }),
      id,
      kind,
      metadata: readRecord(artifact, "metadata") ?? {},
    },
  ];
}

function readNodeName(node: MigakiNode): string | undefined {
  return (
    readString(node.metadata, "modelName") ??
    readString(node.metadata, "toolName") ??
    readString(node.metadata, "agentName")
  );
}

function nodeDurationMs(node: MigakiNode): number | undefined {
  if (node.endedAt === undefined) {
    return undefined;
  }

  return Math.max(0, Date.parse(node.endedAt) - Date.parse(node.startedAt));
}

function repoAgentReuseArtifacts(
  runId: string,
  previousRunId: string,
  currentRunId: string,
): RepoAgentReuseBenchmarkResult["artifacts"] {
  return {
    comparison: `runs/${runId}/artifacts/comparison.json`,
    currentEvents: `runs/${currentRunId}/events.jsonl`,
    currentGraph: `runs/${currentRunId}/graph.json`,
    currentReport: `runs/${currentRunId}/report.md`,
    previousEvents: `runs/${previousRunId}/events.jsonl`,
    previousGraph: `runs/${previousRunId}/graph.json`,
    previousReport: `runs/${previousRunId}/report.md`,
    report: `runs/${runId}/report.md`,
    reuseDecision: `runs/${runId}/artifacts/reuse-decision.json`,
  };
}

function renderRepoAgentReuseBenchmarkReport(input: {
  readonly artifacts: RepoAgentReuseBenchmarkResult["artifacts"];
  readonly comparison: ObservedTrajectoryComparison;
  readonly reuseDecision: ReuseDecisionArtifact;
  readonly runId: string;
}): string {
  const blockedLines =
    input.comparison.blockedCandidates.length === 0
      ? ["- Blocked candidates: none"]
      : input.comparison.blockedCandidates.map(
          (candidate) =>
            `- Blocked candidates: ${candidate.nodeId} [${candidate.reasons.map((reason) => reason.code).join(", ")}] ${candidate.reasons.map((reason) => reason.message).join("; ")}`,
        );
  const changedLines =
    input.comparison.changedNodes.length === 0
      ? ["- Changed nodes: none"]
      : input.comparison.changedNodes.map(
          (node) => `- Changed nodes: ${node.nodeId} (${node.reason})`,
        );

  return [
    "# Migaki Repo-Agent Reuse Benchmark",
    "",
    `Run: ${input.runId}`,
    `Previous run: ${input.comparison.previousRunId}`,
    `Current run: ${input.comparison.currentRunId}`,
    "",
    "## Artifacts",
    "",
    `- Previous events: ${input.artifacts.previousEvents}`,
    `- Previous graph: ${input.artifacts.previousGraph}`,
    `- Previous report: ${input.artifacts.previousReport}`,
    `- Current events: ${input.artifacts.currentEvents}`,
    `- Current graph: ${input.artifacts.currentGraph}`,
    `- Current report: ${input.artifacts.currentReport}`,
    `- Comparison artifact: ${input.artifacts.comparison}`,
    `- Reuse decision artifact: ${input.artifacts.reuseDecision}`,
    "",
    "## Comparison",
    "",
    `- Reusable model nodes: ${formatNodeIds(input.comparison.reusableModelCalls)}`,
    `- Reusable tool nodes: ${formatNodeIds(input.comparison.reusableToolCalls)}`,
    ...changedLines,
    ...blockedLines,
    `- Estimated avoidable tokens: ${formatOptionalBenchmarkNumber(input.comparison.summary.totalEstimatedAvoidableTokens)}`,
    `- Estimated avoidable cost USD: ${formatOptionalCost(input.comparison.summary.totalEstimatedAvoidableCostUsd)}`,
    `- Estimated avoidable latency ms: ${formatOptionalBenchmarkNumber(input.comparison.summary.totalEstimatedAvoidableLatencyMs)}`,
    "",
    "## Reuse Decision",
    "",
    `- Allowed: ${input.reuseDecision.summary.allowed}`,
    `- Needs review: ${input.reuseDecision.summary.needsReview}`,
    `- Blocked: ${input.reuseDecision.summary.blocked}`,
    "",
    "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    "Estimated avoidable token, cost, and latency values are comparison metadata for future replay validation, not realized savings.",
    "",
  ].join("\n");
}

function formatOptionalCost(value: number | undefined): string {
  return value === undefined ? "unknown" : value.toFixed(6);
}

function formatNodeIds(nodes: readonly { readonly nodeId: string }[]): string {
  return nodes.length === 0
    ? "none"
    : nodes.map((node) => node.nodeId).join(", ");
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

interface OpenAIAgentsSdkModule {
  readonly Runner: new (config?: Readonly<Record<string, unknown>>) => {
    run(agent: unknown, input: unknown, options?: unknown): Promise<unknown>;
  };
}

const openAiAgentsPackageName = "@openai/agents";

async function runOpenAIAgentsBaseline(
  spec: MigakiAgentRunSpec,
): Promise<unknown> {
  const sdk = await loadOpenAIAgentsSdk();
  const runner = new sdk.Runner({
    ...(spec.runConfig ?? {}),
    tracingDisabled: true,
  });

  return runner.run(spec.agent, spec.input, spec.options);
}

async function loadOpenAIAgentsSdk(): Promise<OpenAIAgentsSdkModule> {
  const loaded = (await import(openAiAgentsPackageName)) as unknown;

  if (!isRecord(loaded) || typeof loaded.Runner !== "function") {
    throw new Error("@openai/agents did not export Runner.");
  }

  return {
    Runner: loaded.Runner as OpenAIAgentsSdkModule["Runner"],
  };
}

async function measureLane(
  timer: MigakiBenchmarkTimer,
  run: () => Promise<unknown>,
): Promise<ParallelBenchmarkLaneResult> {
  const startedAt = timer.now();

  try {
    const output = await run();
    const endedAt = timer.now();

    return {
      durationMs: Math.max(0, endedAt - startedAt),
      output: snapshotRunOutput(output),
      status: "ok",
    };
  } catch (error) {
    const endedAt = timer.now();

    return {
      durationMs: Math.max(0, endedAt - startedAt),
      error: snapshotError(error),
      status: "error",
    };
  }
}

function compareParallelBenchmarkLanes(
  baseline: ParallelBenchmarkLaneResult,
  migaki: ParallelBenchmarkLaneResult,
): ParallelMigakiBenchmarkComparison {
  const overheadMs = migaki.durationMs - baseline.durationMs;
  const bothSucceeded = baseline.status === "ok" && migaki.status === "ok";

  return {
    baselineDurationMs: baseline.durationMs,
    bothSucceeded,
    migakiDurationMs: migaki.durationMs,
    overheadMs,
    ...(baseline.durationMs > 0
      ? { overheadRatio: migaki.durationMs / baseline.durationMs }
      : {}),
    ...(bothSucceeded
      ? {
          outputEqual:
            serializeStableJson(baseline.output) ===
            serializeStableJson(migaki.output),
        }
      : {}),
  };
}

export function renderParallelMigakiBenchmarkReport(
  result: Omit<ParallelMigakiBenchmarkResult, "report">,
): string {
  return [
    "# Migaki Parallel Benchmark",
    "",
    `Run: ${result.runId}`,
    `Migaki run: ${result.migakiRunId}`,
    "",
    "## Results",
    "",
    `- Baseline status: ${result.baseline.status}`,
    `- Migaki status: ${result.migaki.status}`,
    `- Baseline latency ms: ${formatBenchmarkNumber(result.baseline.durationMs)}`,
    `- Migaki latency ms: ${formatBenchmarkNumber(result.migaki.durationMs)}`,
    `- Overhead ms: ${formatBenchmarkNumber(result.comparison.overheadMs)}`,
    `- Overhead ratio: ${formatOptionalBenchmarkNumber(
      result.comparison.overheadRatio,
    )}`,
    `- Outputs equal: ${formatOptionalBoolean(result.comparison.outputEqual)}`,
    "",
    "## Errors",
    "",
    `- Baseline error: ${result.baseline.error?.message ?? "none"}`,
    `- Migaki error: ${result.migaki.error?.message ?? "none"}`,
    "",
  ].join("\n");
}

function snapshotRunOutput(output: unknown): unknown {
  if (!isRecord(output)) {
    return output;
  }

  if ("finalOutput" in output) {
    return output.finalOutput;
  }

  if ("output" in output) {
    return output.output;
  }

  return output;
}

function formatBenchmarkNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatOptionalBenchmarkNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : formatBenchmarkNumber(value);
}

function formatOptionalBoolean(value: boolean | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function isReportStore(store: MigakiStore): store is MigakiReportStore {
  return "writeReport" in store && typeof store.writeReport === "function";
}

function isArtifactStore(store: MigakiStore): store is MigakiArtifactStore {
  return "writeArtifact" in store && typeof store.writeArtifact === "function";
}

function readRecord(
  record: Metadata | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record?.[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
}

function readNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];

  return typeof value === "number" ? value : undefined;
}

function readString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
