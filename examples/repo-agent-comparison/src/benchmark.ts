import {
  mkdir as makeDirectory,
  writeFile as writeTextFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIREdge,
  type MIRNode,
  type MIRPlan,
} from "@migaki/mir";
import {
  createMockExecutionBackend,
  type MockBackendFixture,
  type MockExecutionResult,
  type MockLoweredExecutionPlan,
} from "@migaki/providers";
import {
  captureMockExecutionTrace,
  compareMigakiGraphs,
  serializeMigakiGraphComparison,
  type MigakiGraphComparison,
  type MockExecutionTraceArtifact,
} from "@migaki/runtime";

export const REPO_AGENT_TRAJECTORY_COMPARISON_BENCHMARK_VERSION =
  "migaki.example.repo-agent-trajectory-comparison.v0";

export interface RepoAgentTrajectoryRunArtifact {
  readonly graph: MIRPlan;
  readonly graphPath: string;
  readonly loweredPlan: MockLoweredExecutionPlan;
  readonly modelCallCount: number;
  readonly result: MockExecutionResult;
  readonly runId: string;
  readonly toolCallCount: number;
  readonly trace: MockExecutionTraceArtifact;
  readonly tracePath: string;
}

export interface RepoAgentTrajectoryComparisonClaims {
  readonly canClaim: readonly string[];
  readonly cannotClaim: readonly string[];
}

export interface RepoAgentBenchmarkFile {
  readonly contents: string;
  readonly mediaType: "application/json" | "text/markdown";
  readonly path: string;
}

export interface RepoAgentBenchmarkFileWriter {
  readonly mkdir: (
    path: string,
    options: { readonly recursive: true },
  ) => Promise<void> | void;
  readonly writeFile: (path: string, contents: string) => Promise<void> | void;
}

export interface RepoAgentTrajectoryComparisonBenchmark {
  readonly artifactRoot: string;
  readonly claims: RepoAgentTrajectoryComparisonClaims;
  readonly comparison: MigakiGraphComparison;
  readonly comparisonId: string;
  readonly files: readonly RepoAgentBenchmarkFile[];
  readonly generatedAt: string;
  readonly reportMarkdown: string;
  readonly runs: {
    readonly first: RepoAgentTrajectoryRunArtifact;
    readonly second: RepoAgentTrajectoryRunArtifact;
  };
  readonly version: typeof REPO_AGENT_TRAJECTORY_COMPARISON_BENCHMARK_VERSION;
}

interface RunRepoAgentTrajectoryOptions {
  readonly artifactRoot: string;
  readonly createdAt: string;
  readonly graphId: string;
  readonly graphPath: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly traceId: string;
  readonly tracePath: string;
}

const comparisonId = "repo-agent-two-run-exact";
const generatedAt = "2026-01-01T00:00:03.000Z";
const artifactRoot = `.migaki/comparisons/${comparisonId}`;
const claims = {
  canClaim: ["Migaki can identify reusable agent trajectory nodes."],
  cannotClaim: [
    "Live-provider cost or latency improvement.",
    "Actual avoided work before exact replay is enabled.",
    "Semantic, fuzzy, vector, or routed reuse.",
  ],
} as const satisfies RepoAgentTrajectoryComparisonClaims;

const nodeFileWriter = {
  async mkdir(path: string, options: { readonly recursive: true }) {
    await makeDirectory(path, options);
  },
  async writeFile(path: string, contents: string) {
    await writeTextFile(path, contents, "utf8");
  },
} satisfies RepoAgentBenchmarkFileWriter;

export async function createRepoAgentTrajectoryComparisonBenchmark(): Promise<RepoAgentTrajectoryComparisonBenchmark> {
  const first = await runRepoAgentTrajectory({
    artifactRoot,
    createdAt: "2026-01-01T00:00:01.000Z",
    graphId: "repo-agent-run-1",
    graphPath: `${artifactRoot}/run-1.graph.json`,
    runId: "repo-agent-run-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    traceId: "trace-repo-agent-run-1",
    tracePath: `${artifactRoot}/run-1.trace.json`,
  });
  const second = await runRepoAgentTrajectory({
    artifactRoot,
    createdAt: "2026-01-01T00:00:02.000Z",
    graphId: "repo-agent-run-2",
    graphPath: `${artifactRoot}/run-2.graph.json`,
    runId: "repo-agent-run-2",
    startedAt: "2026-01-01T00:00:10.000Z",
    traceId: "trace-repo-agent-run-2",
    tracePath: `${artifactRoot}/run-2.trace.json`,
  });
  const comparison = compareMigakiGraphs(first.graph, second.graph);
  const reportMarkdown = renderRepoAgentTrajectoryComparisonReport({
    claims,
    comparison,
    comparisonId,
    first,
    second,
  });
  const files = createBenchmarkFiles({
    comparison,
    first,
    reportMarkdown,
    second,
  });

  return {
    artifactRoot,
    claims,
    comparison,
    comparisonId,
    files,
    generatedAt,
    reportMarkdown,
    runs: {
      first,
      second,
    },
    version: REPO_AGENT_TRAJECTORY_COMPARISON_BENCHMARK_VERSION,
  };
}

export async function writeRepoAgentTrajectoryComparisonBenchmark(
  benchmark: RepoAgentTrajectoryComparisonBenchmark,
  writer: RepoAgentBenchmarkFileWriter = nodeFileWriter,
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

export function renderRepoAgentTrajectoryComparisonReport(input: {
  readonly claims: RepoAgentTrajectoryComparisonClaims;
  readonly comparison: MigakiGraphComparison;
  readonly comparisonId: string;
  readonly first: RepoAgentTrajectoryRunArtifact;
  readonly second: RepoAgentTrajectoryRunArtifact;
}): string {
  const blockedLines =
    input.comparison.nonReusableNodesWithReasons.length === 0
      ? ["- none"]
      : input.comparison.nonReusableNodesWithReasons.map(
          (node) =>
            `- ${node.nodeId}: ${node.reasons
              .map((reason) => reason.code)
              .join(", ")}`,
        );

  return [
    "# Migaki Repo-Agent Trajectory Comparison",
    "",
    `Comparison: ${input.comparisonId}`,
    `Previous graph: ${input.comparison.previousGraphId}`,
    `Current graph: ${input.comparison.currentGraphId}`,
    "",
    "## Artifacts",
    "",
    `- ${input.first.graphPath}`,
    `- ${input.second.graphPath}`,
    `- ${artifactRoot}/comparison.json`,
    `- ${artifactRoot}/report.md`,
    "",
    "## Metrics",
    "",
    `- Reusable model calls: ${input.comparison.metrics.reusableModelCalls}`,
    `- Reusable tool calls: ${input.comparison.metrics.reusableToolCalls}`,
    `- Reusable token count: ${input.comparison.metrics.reusableTokenCount}`,
    `- Estimated potentially avoidable tokens: ${input.comparison.metrics.estimatedAvoidableTokens}`,
    `- Estimated potentially avoidable model calls: ${input.comparison.metrics.estimatedAvoidableModelCalls}`,
    `- Estimated potentially avoidable tool calls: ${input.comparison.metrics.estimatedAvoidableToolCalls}`,
    `- Longest reusable path: ${
      input.comparison.metrics.longestReusablePath.length
    } nodes (${input.comparison.metrics.longestReusablePath.nodeIds.join(
      " -> ",
    )})`,
    `- Non-reusable nodes with reasons: ${input.comparison.metrics.nonReusableNodesWithReasons}`,
    "",
    "## Blocked Reuse Reasons",
    "",
    ...blockedLines,
    "",
    "## Claims",
    "",
    ...input.claims.canClaim.map((claim) => `- ${claim}`),
    "",
    "## Cannot Claim",
    "",
    ...input.claims.cannotClaim.map((claim) => `- ${claim}`),
    "",
    "## Limitations",
    "",
    "- Exact reuse only; no semantic or fuzzy matching.",
    "- Mock provider and fixture tool execution only.",
    "- Metrics are potentially avoidable work, not realized replay.",
    "- No live-provider cost, token, or latency claim.",
    "",
  ].join("\n");
}

function createBenchmarkFiles(input: {
  readonly comparison: MigakiGraphComparison;
  readonly first: RepoAgentTrajectoryRunArtifact;
  readonly reportMarkdown: string;
  readonly second: RepoAgentTrajectoryRunArtifact;
}): readonly RepoAgentBenchmarkFile[] {
  return [
    {
      contents: serializeStableJson(input.first.graph),
      mediaType: "application/json",
      path: input.first.graphPath,
    },
    {
      contents: serializeStableJson(input.second.graph),
      mediaType: "application/json",
      path: input.second.graphPath,
    },
    {
      contents: serializeMigakiGraphComparison(input.comparison),
      mediaType: "application/json",
      path: `${artifactRoot}/comparison.json`,
    },
    {
      contents: input.reportMarkdown,
      mediaType: "text/markdown",
      path: `${artifactRoot}/report.md`,
    },
  ];
}

async function runRepoAgentTrajectory(
  options: RunRepoAgentTrajectoryOptions,
): Promise<RepoAgentTrajectoryRunArtifact> {
  const graph = createRepoAgentGraph({
    graphId: options.graphId,
    traceId: options.traceId,
  });
  const backend = createMockExecutionBackend({
    fixture: createRepoAgentFixture(),
    startedAt: options.startedAt,
  });
  const loweredPlan = await backend.lower(graph);
  const result = await backend.execute(loweredPlan);
  const trace = captureMockExecutionTrace({
    artifactId: `trace-artifact-${options.runId}`,
    createdAt: options.createdAt,
    ...(result.usage !== undefined ? { estimates: result.usage } : {}),
    evidenceBundleRef: {
      kind: "artifact",
      ref: `evidence://bundle/${options.runId}`,
    },
    fixture: createRepoAgentFixture(),
    loweredPlan,
    plan: graph,
    redactions: [
      {
        mode: "omitted",
        path: "$.responses[*].metadata.rawText",
        reason:
          "Repo-agent comparison fixture keeps prompt and tool output text out of replay metadata.",
      },
    ],
    result,
    traceId: options.traceId,
  });

  return {
    graph,
    graphPath: options.graphPath,
    loweredPlan,
    modelCallCount: graph.nodes.filter((node) => node.kind === "model_call")
      .length,
    result,
    runId: options.runId,
    toolCallCount: graph.nodes.filter((node) => node.kind === "tool_call")
      .length,
    trace,
    tracePath: options.tracePath,
  };
}

function createRepoAgentGraph(input: {
  readonly graphId: string;
  readonly traceId: string;
}): MIRPlan {
  return {
    constraints: {
      allowedProviders: ["mock"],
      auditLevel: "evidence_bundle",
      replayPolicy: "metadata",
      retentionPolicy: {
        mode: "metadata_only",
        reason:
          "The benchmark compares graph metadata and hashes without storing repository content.",
      },
    },
    context: createRepoAgentContext(),
    edges: createRepoAgentEdges(),
    id: input.graphId,
    metadata: {
      application: "repo-agent-comparison",
      createdAt: "2026-01-01T00:00:00.000Z",
      description:
        "Deterministic repo-agent trajectory for exact reusable-node comparison.",
      framework: "fixture-agent",
      tags: ["benchmark", "comparison", "repo-agent"],
      traceId: input.traceId,
    },
    nodes: createRepoAgentNodes(),
    version: MIR_V0_VERSION,
  };
}

function createRepoAgentContext(): readonly MIRContextBlock[] {
  return [
    {
      contentHash: "sha256:repo-agent-request",
      contentRef: "fixture://repo-agent/request",
      id: "ctx-repo-request",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        source: "user",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "user_input",
      tokenEstimate: 16,
    },
    {
      contentHash: "sha256:repo-file-snapshot",
      contentRef: "fixture://repo-agent/repo-files",
      id: "ctx-repo-files",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-inspect-repo",
        source: "tool",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "tool_result",
      tokenEstimate: 80,
    },
    {
      contentHash: "sha256:edit-plan",
      contentRef: "fixture://repo-agent/edit-plan",
      id: "ctx-edit-plan",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-plan-edit",
        source: "generated",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "scratchpad",
      tokenEstimate: 45,
    },
    {
      contentHash: "sha256:test-output",
      contentRef: "fixture://repo-agent/test-output",
      id: "ctx-test-output",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-run-tests",
        source: "tool",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "tool_result",
      tokenEstimate: 52,
    },
    {
      contentHash: "sha256:summary",
      contentRef: "fixture://repo-agent/summary",
      id: "ctx-summary",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-summarize",
        source: "generated",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "validator_output",
      tokenEstimate: 34,
    },
    {
      contentHash: "sha256:summary-validation",
      contentRef: "fixture://repo-agent/summary-validation",
      id: "ctx-summary-validation",
      mutability: "fixed",
      privacyClass: "internal",
      provenance: {
        nodeId: "node-validate-summary",
        source: "validator",
      },
      retentionPolicy: {
        mode: "metadata_only",
      },
      role: "validator_output",
      tokenEstimate: 4,
    },
  ];
}

function createRepoAgentNodes(): readonly MIRNode[] {
  return [
    {
      id: "node-inspect-repo",
      inputContext: ["ctx-repo-request"],
      kind: "tool_call",
      metadata: {
        cacheKeyRef: "cache://repo-agent/inspect-repo",
      },
      outputContext: "ctx-repo-files",
      tool: {
        inputRef: "fixture://repo-agent/inputs/inspect-repo",
        name: "repo.read_files",
        schemaRef: "schema://tools/repo.read_files",
      },
    },
    {
      id: "node-plan-edit",
      inputContext: ["ctx-repo-request", "ctx-repo-files"],
      kind: "model_call",
      metadata: {
        cacheKeyRef: "cache://repo-agent/plan-edit",
      },
      model: {
        requiredCapabilities: ["structured_output", "tool_calling"],
        task: "reasoning",
      },
      outputContext: "ctx-edit-plan",
      parameters: {
        maxOutputTokens: 256,
        temperature: 0,
      },
    },
    {
      id: "node-run-tests",
      inputContext: ["ctx-edit-plan"],
      kind: "tool_call",
      metadata: {
        cacheKeyRef: "cache://repo-agent/run-tests",
      },
      outputContext: "ctx-test-output",
      tool: {
        inputRef: "fixture://repo-agent/inputs/run-tests",
        name: "repo.run_tests",
        schemaRef: "schema://tools/repo.run_tests",
      },
    },
    {
      id: "node-summarize",
      inputContext: ["ctx-repo-request", "ctx-edit-plan", "ctx-test-output"],
      kind: "model_call",
      metadata: {
        cacheKeyRef: "cache://repo-agent/summarize",
      },
      model: {
        task: "synthesis",
      },
      outputContext: "ctx-summary",
      parameters: {
        maxOutputTokens: 128,
        temperature: 0,
      },
      validators: ["validator-summary-grounding"],
    },
    {
      failurePolicy: "warn",
      id: "node-validate-summary",
      inputContext: ["ctx-summary", "ctx-test-output"],
      kind: "validator",
      outputContext: "ctx-summary-validation",
      validator: {
        kind: "custom",
        name: "validator-summary-grounding",
      },
    },
  ];
}

function createRepoAgentEdges(): readonly MIREdge[] {
  return [
    {
      contextIds: ["ctx-repo-files"],
      fromNodeId: "node-inspect-repo",
      id: "edge-inspect-plan",
      kind: "data",
      toNodeId: "node-plan-edit",
    },
    {
      contextIds: ["ctx-edit-plan"],
      fromNodeId: "node-plan-edit",
      id: "edge-plan-tests",
      kind: "data",
      toNodeId: "node-run-tests",
    },
    {
      contextIds: ["ctx-test-output"],
      fromNodeId: "node-run-tests",
      id: "edge-tests-summarize",
      kind: "data",
      toNodeId: "node-summarize",
    },
    {
      contextIds: ["ctx-summary"],
      fromNodeId: "node-summarize",
      id: "edge-summarize-validate",
      kind: "validation",
      toNodeId: "node-validate-summary",
    },
  ];
}

function createRepoAgentFixture(): MockBackendFixture {
  return {
    responses: [
      {
        contextId: "ctx-repo-files",
        nodeId: "node-inspect-repo",
        outputRef: "fixture://repo-agent/repo-files",
        usage: {
          inputTokens: 16,
          latencyMs: 4,
          outputTokens: 80,
        },
      },
      {
        contextId: "ctx-edit-plan",
        nodeId: "node-plan-edit",
        outputRef: "fixture://repo-agent/edit-plan",
        usage: {
          costUsd: 0,
          inputTokens: 96,
          latencyMs: 8,
          outputTokens: 45,
        },
      },
      {
        contextId: "ctx-test-output",
        nodeId: "node-run-tests",
        outputRef: "fixture://repo-agent/test-output",
        usage: {
          inputTokens: 45,
          latencyMs: 7,
          outputTokens: 52,
        },
      },
      {
        contextId: "ctx-summary",
        nodeId: "node-summarize",
        outputRef: "fixture://repo-agent/summary",
        usage: {
          costUsd: 0,
          inputTokens: 113,
          latencyMs: 6,
          outputTokens: 34,
        },
      },
      {
        contextId: "ctx-summary-validation",
        nodeId: "node-validate-summary",
        outputRef: "fixture://repo-agent/summary-validation",
        usage: {
          latencyMs: 1,
        },
        validation: {
          status: "passed",
          targetRef: "ctx-summary",
          validatorId: "validator-summary-grounding",
        },
      },
    ],
  };
}

function serializeStableJson(value: unknown): string {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
