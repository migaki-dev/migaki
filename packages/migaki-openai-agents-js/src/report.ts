import { serializeStableJson, stableHash } from "./hash.js";
import {
  MIGAKI_REPORT_VERSION,
  type MigakiCacheKey,
  type MigakiGraph,
  type MigakiNode,
} from "./types.js";

export interface MigakiRepeatedOperation {
  readonly cacheKeyHash: string;
  readonly count: number;
  readonly nodeIds: readonly string[];
  readonly op: MigakiCacheKey["op"];
}

export interface MigakiReportSummary {
  readonly cacheableNodeCount: number;
  readonly duplicateModelCallShapedOperations: number;
  readonly duplicateToolCalls: number;
  readonly estimatedAvoidableCostUsd?: number;
  readonly failedOrRetriedNodes: readonly string[];
  readonly handoffs: number;
  readonly latencyMs?: number | undefined;
  readonly llmCalls: number;
  readonly longestPath: {
    readonly durationMs: number;
    readonly nodeIds: readonly string[];
  };
  readonly modelCalls: number;
  readonly nonGoals: readonly string[];
  readonly potentialCacheHits: number;
  readonly repeatedOperations: readonly MigakiRepeatedOperation[];
  readonly tokens: number;
  readonly toolCalls: number;
  readonly totalNodes: number;
  readonly version: typeof MIGAKI_REPORT_VERSION;
}

const explicitNonGoals = [
  "semantic IR",
  "distributed cache",
  "vector database",
  "RAG framework",
  "model router",
  "actual cache replay",
  "graph optimizer",
  "UI",
  "Postgres backend",
] as const;

export function createMigakiReportSummary(
  graph: MigakiGraph,
): MigakiReportSummary {
  const repeatedOperations = findRepeatedOperations(graph.nodes);
  const potentialCacheHits = repeatedOperations.reduce(
    (total, operation) => total + operation.count - 1,
    0,
  );
  const failedOrRetriedNodes = graph.nodes
    .filter(
      (node) =>
        node.status === "error" ||
        typeof node.metadata.retryOf === "string" ||
        typeof node.metadata.retryAttempt === "number",
    )
    .map((node) => node.id);
  const estimatedAvoidableCostUsd = estimateAvoidableCostUsd(
    repeatedOperations,
    graph.nodes,
  );

  return {
    cacheableNodeCount: graph.nodes.filter((node) => isCacheableNode(node))
      .length,
    duplicateModelCallShapedOperations: repeatedOperations
      .filter((operation) => operation.op === "model_call")
      .reduce((total, operation) => total + operation.count - 1, 0),
    duplicateToolCalls: repeatedOperations
      .filter((operation) => operation.op === "tool_call")
      .reduce((total, operation) => total + operation.count - 1, 0),
    failedOrRetriedNodes,
    handoffs: graph.nodes.filter((node) => node.kind === "handoff").length,
    llmCalls: graph.nodes.filter((node) => node.kind === "model_call").length,
    longestPath: findLongestPath(graph),
    modelCalls: graph.nodes.filter((node) => node.kind === "model_call").length,
    nonGoals: explicitNonGoals,
    potentialCacheHits,
    repeatedOperations,
    tokens: graph.nodes.reduce((total, node) => total + nodeTokens(node), 0),
    toolCalls: graph.nodes.filter((node) => node.kind === "tool_call").length,
    totalNodes: graph.nodes.length,
    version: MIGAKI_REPORT_VERSION,
    ...(runLatencyMs(graph) !== undefined
      ? { latencyMs: runLatencyMs(graph) }
      : {}),
    ...(estimatedAvoidableCostUsd !== undefined
      ? { estimatedAvoidableCostUsd }
      : {}),
  };
}

export function renderMigakiReport(graph: MigakiGraph): string {
  const summary = createMigakiReportSummary(graph);
  const repeatedLines =
    summary.repeatedOperations.length === 0
      ? ["- none"]
      : summary.repeatedOperations.map(
          (operation) =>
            `- ${operation.op} ${operation.cacheKeyHash}: ${operation.count}x (${operation.nodeIds.join(", ")})`,
        );
  const failedLines =
    summary.failedOrRetriedNodes.length === 0
      ? ["- none"]
      : summary.failedOrRetriedNodes.map((nodeId) => `- ${nodeId}`);

  return [
    "# Migaki Run Report",
    "",
    `Run: ${graph.runId}`,
    `Version: ${summary.version}`,
    `Status: ${graph.status}`,
    "",
    "## Totals",
    "",
    `- Total nodes: ${summary.totalNodes}`,
    `- Model calls: ${summary.modelCalls}`,
    `- Tool calls: ${summary.toolCalls}`,
    `- Handoffs: ${summary.handoffs}`,
    `- Tokens: ${summary.tokens}`,
    `- Latency ms: ${formatOptionalNumber(summary.latencyMs)}`,
    `- Cacheable node count: ${summary.cacheableNodeCount}`,
    "",
    "## Reuse Signals",
    "",
    `- Repeated operations: ${summary.repeatedOperations.length}`,
    `- Duplicate tool calls: ${summary.duplicateToolCalls}`,
    `- Duplicate model-call-shaped operations: ${summary.duplicateModelCallShapedOperations}`,
    `- Potential cache hits: ${summary.potentialCacheHits}`,
    `- Estimated avoidable cost: ${formatAvoidableCost(summary)}`,
    "",
    "## Repeated Operations",
    "",
    ...repeatedLines,
    "",
    "## Critical Path",
    "",
    `- Longest path: ${summary.longestPath.nodeIds.join(" -> ") || "none"}`,
    `- Longest path latency ms: ${summary.longestPath.durationMs}`,
    "",
    "## Failed Or Retried Nodes",
    "",
    ...failedLines,
    "",
    "## Explicit Non-Goals",
    "",
    ...summary.nonGoals.map((goal) => `- ${goal}`),
    "",
  ].join("\n");
}

function findRepeatedOperations(
  nodes: readonly MigakiNode[],
): readonly MigakiRepeatedOperation[] {
  const groups = new Map<
    string,
    {
      cacheKeyHash: string;
      nodeIds: string[];
      op: MigakiCacheKey["op"];
    }
  >();

  for (const node of nodes) {
    const cacheKey = readCacheKey(node);

    if (cacheKey === undefined) {
      continue;
    }

    const cacheKeyHash = stableHash(cacheKey);
    const existing = groups.get(cacheKeyHash);

    if (existing === undefined) {
      groups.set(cacheKeyHash, {
        cacheKeyHash,
        nodeIds: [node.id],
        op: cacheKey.op,
      });
    } else {
      existing.nodeIds.push(node.id);
    }
  }

  return [...groups.values()]
    .filter((group) => group.nodeIds.length > 1)
    .map((group) => ({
      cacheKeyHash: group.cacheKeyHash,
      count: group.nodeIds.length,
      nodeIds: [...group.nodeIds],
      op: group.op,
    }))
    .sort((left, right) => left.cacheKeyHash.localeCompare(right.cacheKeyHash));
}

function findLongestPath(graph: MigakiGraph): {
  readonly durationMs: number;
  readonly nodeIds: readonly string[];
} {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incoming.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const list = incoming.get(edge.to);

    if (list !== undefined) {
      list.push(edge.from);
    }
  }

  const memo = new Map<string, { durationMs: number; nodeIds: string[] }>();
  const visit = (
    nodeId: string,
    visiting: ReadonlySet<string>,
  ): { durationMs: number; nodeIds: string[] } => {
    const cached = memo.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    const node = nodesById.get(nodeId);

    if (node === undefined || visiting.has(nodeId)) {
      return { durationMs: 0, nodeIds: [] };
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);

    let bestParent = { durationMs: 0, nodeIds: [] as string[] };

    for (const parentId of incoming.get(nodeId) ?? []) {
      const parentPath = visit(parentId, nextVisiting);

      if (parentPath.durationMs > bestParent.durationMs) {
        bestParent = parentPath;
      }
    }

    const result = {
      durationMs: bestParent.durationMs + nodeDurationMs(node),
      nodeIds: [...bestParent.nodeIds, nodeId],
    };

    memo.set(nodeId, result);

    return result;
  };

  let longest = { durationMs: 0, nodeIds: [] as string[] };

  for (const node of graph.nodes) {
    const path = visit(node.id, new Set<string>());

    if (path.durationMs > longest.durationMs) {
      longest = path;
    }
  }

  return longest;
}

function isCacheableNode(node: MigakiNode): boolean {
  return readCacheKey(node) !== undefined;
}

function readCacheKey(node: MigakiNode): MigakiCacheKey | undefined {
  const value = node.metadata.cacheKey;

  if (!isRecord(value)) {
    return undefined;
  }

  if (
    (value.op !== "model_call" && value.op !== "tool_call") ||
    typeof value.name !== "string" ||
    typeof value.inputHash !== "string" ||
    typeof value.dependencyHash !== "string" ||
    typeof value.runtimeHash !== "string"
  ) {
    return undefined;
  }

  return {
    dependencyHash: value.dependencyHash,
    inputHash: value.inputHash,
    name: value.name,
    op: value.op,
    runtimeHash: value.runtimeHash,
  };
}

function estimateAvoidableCostUsd(
  repeatedOperations: readonly MigakiRepeatedOperation[],
  nodes: readonly MigakiNode[],
): number | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let total = 0;
  let foundCost = false;

  for (const operation of repeatedOperations) {
    for (const nodeId of operation.nodeIds.slice(1)) {
      const node = nodesById.get(nodeId);
      const cost = readNumber(node?.metadata.estimatedCostUsd);

      if (cost !== undefined) {
        total += cost;
        foundCost = true;
      }
    }
  }

  return foundCost ? roundUsd(total) : undefined;
}

function nodeTokens(node: MigakiNode): number {
  const usage = node.metadata.usage;

  if (!isRecord(usage)) {
    return 0;
  }

  return readNumber(usage.totalTokens) ?? 0;
}

function nodeDurationMs(node: MigakiNode): number {
  if (node.endedAt === undefined) {
    return 0;
  }

  const startedAt = Date.parse(node.startedAt);
  const endedAt = Date.parse(node.endedAt);

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 0;
  }

  return Math.max(0, endedAt - startedAt);
}

function runLatencyMs(graph: MigakiGraph): number | undefined {
  if (graph.endedAt === undefined) {
    return undefined;
  }

  const startedAt = Date.parse(graph.startedAt);
  const endedAt = Date.parse(graph.endedAt);

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return undefined;
  }

  return Math.max(0, endedAt - startedAt);
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function formatAvoidableCost(summary: MigakiReportSummary): string {
  return summary.estimatedAvoidableCostUsd === undefined
    ? "unknown (no pricing metadata)"
    : `$${summary.estimatedAvoidableCostUsd.toFixed(6)}`;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function serializeMigakiReportSummary(
  summary: MigakiReportSummary,
): string {
  return `${serializeStableJson(summary, 2)}\n`;
}
