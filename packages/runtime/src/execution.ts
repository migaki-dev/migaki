import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const EXECUTION_EVENT_VERSION = "migaki.execution-event.v0";
export const EXECUTION_GRAPH_VERSION = "migaki.execution-graph.v0";
export const EXECUTION_REPORT_VERSION = "migaki.execution-report.v0";

export type ExecutionEventVersion = typeof EXECUTION_EVENT_VERSION;
export type ExecutionGraphVersion = typeof EXECUTION_GRAPH_VERSION;
export type ExecutionReportVersion = typeof EXECUTION_REPORT_VERSION;

export type Metadata = Readonly<Record<string, unknown>>;

export type ExecutionLifecycle = "finish" | "point" | "start";
export type ExecutionNodeStatus = "error" | "ok" | "pending" | "running";
export type ExecutionGraphStatus = "error" | "ok" | "running";

export interface Operation {
  readonly fingerprint?: string;
  readonly id: string;
  readonly kind: string;
  readonly metadata?: Metadata;
  readonly name?: string;
}

export interface Dependency {
  readonly artifactId?: string;
  readonly kind: string;
  readonly metadata?: Metadata;
  readonly operationId: string;
}

export interface Artifact {
  readonly fingerprint?: string;
  readonly id: string;
  readonly kind: string;
  readonly metadata?: Metadata;
}

export interface Metrics {
  readonly cachedInputTokens?: number;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly latencyMs?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
}

export interface ExecutionEvent {
  readonly artifacts?: readonly Artifact[];
  readonly dependencies?: readonly Dependency[];
  readonly id: string;
  readonly lifecycle: ExecutionLifecycle;
  readonly metadata?: Metadata;
  readonly metrics?: Metrics;
  readonly occurredAt?: string;
  readonly operation: Operation;
  readonly runId: string;
  readonly runStatus?: ExecutionGraphStatus;
  readonly status?: Extract<ExecutionNodeStatus, "error" | "ok">;
  readonly version: ExecutionEventVersion;
}

export interface ExecutionNode {
  readonly artifacts: readonly Artifact[];
  readonly dependencies: readonly Dependency[];
  readonly durationMs?: number;
  readonly endedAt?: string;
  readonly id: string;
  readonly metadata: Metadata;
  readonly metrics: Metrics;
  readonly operation: Operation;
  readonly startedAt: string;
  readonly status: ExecutionNodeStatus;
}

export interface ExecutionEdge {
  readonly dependency?: Dependency;
  readonly from: string;
  readonly id: string;
  readonly kind: string;
  readonly metadata: Metadata;
  readonly to: string;
}

export interface ExecutionGraph {
  readonly createdAt: string;
  readonly edges: readonly ExecutionEdge[];
  readonly endedAt?: string;
  readonly metadata: Metadata;
  readonly nodes: readonly ExecutionNode[];
  readonly runId: string;
  readonly startedAt: string;
  readonly status: ExecutionGraphStatus;
  readonly version: ExecutionGraphVersion;
}

export interface ExecutionStore {
  appendEvent(runId: string, event: ExecutionEvent): Promise<void>;
  readEvents(runId: string): Promise<readonly ExecutionEvent[]>;
  writeGraph(runId: string, graph: ExecutionGraph): Promise<void>;
  writeReport(runId: string, report: string): Promise<void>;
}

export interface ExecutionClock {
  now(): Date;
}

export interface MigakiRuntimeOptions {
  readonly clock?: ExecutionClock;
  readonly store: ExecutionStore;
}

export interface RepeatedOperationReport {
  readonly count: number;
  readonly displayName?: string;
  readonly fingerprint: string;
  readonly nodeIds: readonly string[];
  readonly operationKind: string;
}

export interface RepeatedArtifactReport {
  readonly artifactIds: readonly string[];
  readonly count: number;
  readonly fingerprint: string;
  readonly kind: string;
  readonly nodeIds: readonly string[];
}

export interface PotentialCachePointReport {
  readonly avoidableLatencyMs?: number;
  readonly displayName?: string;
  readonly fingerprint: string;
  readonly nodeIds: readonly string[];
  readonly operationKind: string;
}

export interface PotentialParallelismReport {
  readonly nodeIds: readonly [string, string];
  readonly reason: string;
}

export type ExecutionOpportunityCategory =
  | "cache"
  | "failure"
  | "file_reuse"
  | "parallelism";
export type ExecutionOpportunityActionability =
  | "actionable"
  | "blocked"
  | "needs_review";
export type ExecutionOpportunityConfidence = "high" | "low" | "medium";
export type ExecutionOpportunityPriority = "high" | "low" | "medium";

export interface ExecutionOpportunityReport {
  readonly actionability: ExecutionOpportunityActionability;
  readonly artifactIds?: readonly string[];
  readonly blockedBy: readonly string[];
  readonly category: ExecutionOpportunityCategory;
  readonly confidence: ExecutionOpportunityConfidence;
  readonly estimatedAvoidableLatencyMs?: number;
  readonly id: string;
  readonly nodeIds: readonly string[];
  readonly priority: ExecutionOpportunityPriority;
  readonly reason: string;
  readonly safetyNotes: readonly string[];
  readonly whyActionable: string;
}

export interface TokenEstimateReport {
  readonly cachedInputTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
}

export interface ExecutionReportSummary {
  readonly criticalPath: {
    readonly durationMs: number;
    readonly nodeIds: readonly string[];
  };
  readonly edgeCount: number;
  readonly estimatedAvoidableLatencyMs?: number;
  readonly failedNodes: readonly string[];
  readonly nodeCount: number;
  readonly opportunities: readonly ExecutionOpportunityReport[];
  readonly potentialCachePoints: readonly PotentialCachePointReport[];
  readonly potentialParallelism: readonly PotentialParallelismReport[];
  readonly repeatedFiles: readonly RepeatedArtifactReport[];
  readonly repeatedOperations: readonly RepeatedOperationReport[];
  readonly repeatedPrompts: readonly RepeatedArtifactReport[];
  readonly runId: string;
  readonly status: ExecutionGraphStatus;
  readonly tokenEstimates: TokenEstimateReport;
  readonly toolCalls: number;
  readonly version: ExecutionReportVersion;
}

interface MutableExecutionNode {
  artifacts: Artifact[];
  dependencies: Dependency[];
  durationMs?: number;
  endedAt?: string;
  firstSeenIndex: number;
  id: string;
  metadata: Metadata;
  metrics: Metrics;
  operation: Operation;
  startedAt: string;
  status: ExecutionNodeStatus;
}

interface CriticalPathState {
  readonly durationMs: number;
  readonly nodeIds: readonly string[];
}

const defaultClock: ExecutionClock = {
  now() {
    return new Date();
  },
};

export class MigakiRuntime {
  readonly #clock: ExecutionClock;
  readonly #store: ExecutionStore;

  constructor(options: MigakiRuntimeOptions) {
    this.#clock = options.clock ?? defaultClock;
    this.#store = options.store;
  }

  async onExecutionEvent(event: ExecutionEvent): Promise<ExecutionGraph> {
    const occurredAt = event.occurredAt ?? this.#clock.now().toISOString();
    const normalizedEvent: ExecutionEvent = {
      ...event,
      occurredAt,
    };

    await this.#store.appendEvent(normalizedEvent.runId, normalizedEvent);

    const events = await this.#store.readEvents(normalizedEvent.runId);
    const graph = buildExecutionGraph(normalizedEvent.runId, events);

    await this.#store.writeGraph(normalizedEvent.runId, graph);

    if (graph.status !== "running") {
      await this.#store.writeReport(
        normalizedEvent.runId,
        renderExecutionReport(graph),
      );
    }

    return graph;
  }
}

export class LocalStore implements ExecutionStore {
  readonly #rootDirectory: string;

  constructor(rootDirectory = ".migaki") {
    this.#rootDirectory = rootDirectory;
  }

  async appendEvent(runId: string, event: ExecutionEvent): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await appendFile(
      join(runDirectory, "events.jsonl"),
      `${serializeExecutionJson(event)}\n`,
      "utf8",
    );
  }

  async readEvents(runId: string): Promise<readonly ExecutionEvent[]> {
    const runDirectory = this.#runDirectory(runId);
    let contents: string;

    try {
      contents = await readFile(join(runDirectory, "events.jsonl"), "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    return contents
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => parseExecutionEvent(line));
  }

  async writeGraph(runId: string, graph: ExecutionGraph): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await writeFile(
      join(runDirectory, "graph.json"),
      `${serializeExecutionJson(graph, 2)}\n`,
      "utf8",
    );
  }

  async writeReport(runId: string, report: string): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await writeFile(
      join(runDirectory, "report.md"),
      report.endsWith("\n") ? report : `${report}\n`,
      "utf8",
    );
  }

  async #ensureRunDirectory(runId: string): Promise<string> {
    const runDirectory = this.#runDirectory(runId);

    await mkdir(runDirectory, { recursive: true });

    return runDirectory;
  }

  #runDirectory(runId: string): string {
    assertSafeRunId(runId);

    return join(this.#rootDirectory, "runs", runId);
  }
}

export function buildExecutionGraph(
  runId: string,
  events: readonly ExecutionEvent[],
): ExecutionGraph {
  assertSafeRunId(runId);

  const uniqueEvents = dedupeEvents(events);
  const nodesById = new Map<string, MutableExecutionNode>();
  const firstEventAt = uniqueEvents[0]?.occurredAt ?? new Date(0).toISOString();
  let status: ExecutionGraphStatus = "running";
  let endedAt: string | undefined;

  uniqueEvents.forEach((event, index) => {
    if (event.runId !== runId) {
      throw new Error(
        `Execution event ${event.id} belongs to ${event.runId}, not ${runId}.`,
      );
    }

    const occurredAt = event.occurredAt ?? firstEventAt;
    const existing = nodesById.get(event.operation.id);
    const node =
      existing ??
      createMutableNode({
        event,
        firstSeenIndex: index,
        occurredAt,
      });

    updateNodeFromEvent(node, event, occurredAt);
    nodesById.set(node.id, node);

    if (event.runStatus !== undefined) {
      status = event.runStatus;

      if (event.runStatus !== "running") {
        endedAt = occurredAt;
      }
    }
  });

  const nodes = [...nodesById.values()]
    .sort((left, right) => left.firstSeenIndex - right.firstSeenIndex)
    .map(toExecutionNode);
  const edges = buildExecutionEdges(nodes);
  const graph: ExecutionGraph = {
    createdAt: firstEventAt,
    edges,
    metadata: {
      eventCount: events.length,
      uniqueEventCount: uniqueEvents.length,
    },
    nodes,
    runId,
    startedAt: firstEventAt,
    status,
    version: EXECUTION_GRAPH_VERSION,
    ...(endedAt !== undefined ? { endedAt } : {}),
  };

  return graph;
}

export function createExecutionReportSummary(
  graph: ExecutionGraph,
): ExecutionReportSummary {
  const repeatedOperations = findRepeatedOperations(graph.nodes);
  const potentialCachePoints = repeatedOperations.flatMap((operation) => {
    const cachePoint = createPotentialCachePoint(operation, graph.nodes);

    return cachePoint === undefined ? [] : [cachePoint];
  });
  const potentialParallelism = findPotentialParallelism(graph);
  const repeatedFiles = findRepeatedArtifacts(graph.nodes, "file");
  const estimatedAvoidableLatencyMs = sumDefined(
    potentialCachePoints.map((point) => point.avoidableLatencyMs),
  );
  const tokenEstimates = summarizeTokens(graph.nodes);
  const opportunities = createExecutionOpportunities({
    nodes: graph.nodes,
    potentialCachePoints,
    potentialParallelism,
    repeatedFiles,
    repeatedOperations,
  });
  const summary: ExecutionReportSummary = {
    criticalPath: findCriticalPath(graph),
    edgeCount: graph.edges.length,
    failedNodes: graph.nodes
      .filter((node) => node.status === "error")
      .map((node) => node.id),
    nodeCount: graph.nodes.length,
    opportunities,
    potentialCachePoints,
    potentialParallelism,
    repeatedFiles,
    repeatedOperations,
    repeatedPrompts: findRepeatedArtifacts(graph.nodes, "prompt"),
    runId: graph.runId,
    status: graph.status,
    tokenEstimates,
    toolCalls: graph.nodes.filter((node) => node.operation.kind === "tool_call")
      .length,
    version: EXECUTION_REPORT_VERSION,
    ...(estimatedAvoidableLatencyMs !== undefined
      ? { estimatedAvoidableLatencyMs }
      : {}),
  };

  return summary;
}

export function renderExecutionReport(graph: ExecutionGraph): string {
  const summary = createExecutionReportSummary(graph);

  return [
    "# Migaki Execution Report",
    "",
    `Run: ${graph.runId}`,
    `Version: ${summary.version}`,
    `Status: ${graph.status}`,
    `Started: ${graph.startedAt}`,
    `Ended: ${graph.endedAt ?? "unavailable"}`,
    "",
    "## Totals",
    "",
    `- Nodes: ${summary.nodeCount}`,
    `- Edges: ${summary.edgeCount}`,
    `- Tool calls: ${summary.toolCalls}`,
    `- Failed nodes: ${summary.failedNodes.length}`,
    "",
    "## Opportunities",
    "",
    ...renderOpportunityLines(summary.opportunities),
    "",
    "## Nodes",
    "",
    ...renderNodeLines(graph.nodes),
    "",
    "## Edges",
    "",
    ...renderEdgeLines(graph.edges),
    "",
    "## Critical Path",
    "",
    `- Path: ${summary.criticalPath.nodeIds.join(" -> ") || "none"}`,
    `- Duration ms: ${summary.criticalPath.durationMs}`,
    "",
    "## Tool Calls",
    "",
    ...renderToolCallLines(graph.nodes),
    "",
    "## Repeated Operations",
    "",
    ...renderRepeatedOperationLines(summary.repeatedOperations),
    "",
    "## Repeated Prompts",
    "",
    ...renderRepeatedArtifactLines(summary.repeatedPrompts),
    "",
    "## Repeated Files",
    "",
    ...renderRepeatedArtifactLines(summary.repeatedFiles),
    "",
    "## Potential Cache Points",
    "",
    ...renderPotentialCachePointLines(summary.potentialCachePoints),
    "",
    "## Potential Parallelism",
    "",
    ...renderPotentialParallelismLines(summary.potentialParallelism),
    "",
    "## Estimated Avoidable Latency",
    "",
    `- ${formatOptionalNumber(summary.estimatedAvoidableLatencyMs)} ms`,
    "",
    "## Token Estimates",
    "",
    ...renderTokenLines(summary.tokenEstimates),
    "",
  ].join("\n");
}

export function stableExecutionHash(value: unknown): string {
  return `sha256:${stableExecutionDigest(value)}`;
}

export function stableExecutionDigest(value: unknown): string {
  return createHash("sha256")
    .update(serializeExecutionJson(value))
    .digest("hex");
}

export function serializeExecutionJson(value: unknown, space?: number): string {
  return JSON.stringify(toStableExecutionJsonValue(value), null, space);
}

export function parseExecutionEvent(serialized: string): ExecutionEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Execution event is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Execution event must be a JSON object.");
  }

  if (parsed.version !== EXECUTION_EVENT_VERSION) {
    throw new Error("Unsupported execution event version.");
  }

  if (
    typeof parsed.id !== "string" ||
    typeof parsed.runId !== "string" ||
    !isRecord(parsed.operation) ||
    typeof parsed.operation.id !== "string" ||
    typeof parsed.operation.kind !== "string" ||
    !isLifecycle(parsed.lifecycle)
  ) {
    throw new Error("Execution event is missing required fields.");
  }

  return parsed as unknown as ExecutionEvent;
}

export function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(
      "Migaki runId may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }
}

function dedupeEvents(
  events: readonly ExecutionEvent[],
): readonly ExecutionEvent[] {
  const seen = new Set<string>();
  const uniqueEvents: ExecutionEvent[] = [];

  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }

    seen.add(event.id);
    uniqueEvents.push(event);
  }

  return uniqueEvents;
}

function createMutableNode(input: {
  readonly event: ExecutionEvent;
  readonly firstSeenIndex: number;
  readonly occurredAt: string;
}): MutableExecutionNode {
  return {
    artifacts: [],
    dependencies: [],
    firstSeenIndex: input.firstSeenIndex,
    id: input.event.operation.id,
    metadata: {},
    metrics: {},
    operation: input.event.operation,
    startedAt: input.occurredAt,
    status: "pending",
  };
}

function updateNodeFromEvent(
  node: MutableExecutionNode,
  event: ExecutionEvent,
  occurredAt: string,
): void {
  node.operation = mergeOperation(node.operation, event.operation);
  node.metadata = mergeMetadata(node.metadata, event.metadata);
  node.metrics = mergeMetrics(node.metrics, event.metrics);
  node.artifacts = mergeArtifacts(node.artifacts, event.artifacts ?? []);
  node.dependencies = mergeDependencies(
    node.dependencies,
    event.dependencies ?? [],
  );

  if (event.lifecycle === "start") {
    node.status = "running";
    node.startedAt = minIso(node.startedAt, occurredAt);

    return;
  }

  node.status = event.status ?? "ok";
  node.endedAt = occurredAt;
  node.durationMs =
    event.metrics?.durationMs ?? durationMs(node.startedAt, occurredAt);
}

function mergeOperation(left: Operation, right: Operation): Operation {
  return {
    ...left,
    ...right,
    metadata: mergeMetadata(left.metadata, right.metadata),
  };
}

function mergeMetadata(
  left: Metadata | undefined,
  right: Metadata | undefined,
): Metadata {
  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
}

function mergeMetrics(
  left: Metrics | undefined,
  right: Metrics | undefined,
): Metrics {
  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
}

function mergeArtifacts(
  existing: readonly Artifact[],
  additions: readonly Artifact[],
): Artifact[] {
  const artifactsById = new Map(
    existing.map((artifact) => [artifact.id, artifact]),
  );

  for (const artifact of additions) {
    artifactsById.set(artifact.id, artifact);
  }

  return [...artifactsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function mergeDependencies(
  existing: readonly Dependency[],
  additions: readonly Dependency[],
): Dependency[] {
  const dependenciesByKey = new Map(
    existing.map((dependency) => [dependencyKey(dependency), dependency]),
  );

  for (const dependency of additions) {
    dependenciesByKey.set(dependencyKey(dependency), dependency);
  }

  return [...dependenciesByKey.values()].sort((left, right) =>
    dependencyKey(left).localeCompare(dependencyKey(right)),
  );
}

function toExecutionNode(node: MutableExecutionNode): ExecutionNode {
  const executionNode: ExecutionNode = {
    artifacts: node.artifacts,
    dependencies: node.dependencies,
    id: node.id,
    metadata: node.metadata,
    metrics: node.metrics,
    operation: node.operation,
    startedAt: node.startedAt,
    status: node.status,
    ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
  };

  return executionNode;
}

function buildExecutionEdges(
  nodes: readonly ExecutionNode[],
): readonly ExecutionEdge[] {
  const edges: ExecutionEdge[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      pushEdge(edges, seen, {
        dependency,
        from: dependency.operationId,
        kind: dependency.kind,
        metadata: dependency.metadata ?? {},
        to: node.id,
      });
    }
  }

  for (const edge of buildSequenceEdges(nodes)) {
    pushEdge(edges, seen, edge);
  }

  return edges;
}

function buildSequenceEdges(
  nodes: readonly ExecutionNode[],
): readonly Omit<ExecutionEdge, "id">[] {
  const nodesByScope = new Map<string, ExecutionNode[]>();

  for (const node of nodes) {
    const scope = readSequenceScope(node.metadata);

    if (scope === undefined) {
      continue;
    }

    nodesByScope.set(scope, [...(nodesByScope.get(scope) ?? []), node]);
  }

  const edges: Omit<ExecutionEdge, "id">[] = [];

  for (const scopedNodes of [...nodesByScope.values()]) {
    for (let index = 1; index < scopedNodes.length; index += 1) {
      const from = scopedNodes[index - 1];
      const to = scopedNodes[index];

      if (from === undefined || to === undefined || from.id === to.id) {
        continue;
      }

      edges.push({
        from: from.id,
        kind: "sequence",
        metadata: {
          reason: "observation_order",
        },
        to: to.id,
      });
    }
  }

  return edges;
}

function pushEdge(
  edges: ExecutionEdge[],
  seen: Set<string>,
  edge: Omit<ExecutionEdge, "id">,
): void {
  if (
    edge.kind === "sequence" &&
    edges.some(
      (existing) => existing.from === edge.from && existing.to === edge.to,
    )
  ) {
    return;
  }

  const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  edges.push({
    ...edge,
    id: `edge-${stableExecutionDigest(key).slice(0, 16)}`,
  });
}

function findRepeatedOperations(
  nodes: readonly ExecutionNode[],
): readonly RepeatedOperationReport[] {
  const groups = new Map<
    string,
    {
      displayName?: string;
      nodeIds: string[];
      operationKind: string;
    }
  >();

  for (const node of nodes) {
    const fingerprint = node.operation.fingerprint;

    if (fingerprint === undefined) {
      continue;
    }

    const existing = groups.get(fingerprint);

    if (existing === undefined) {
      groups.set(fingerprint, {
        ...(node.operation.name !== undefined
          ? { displayName: node.operation.name }
          : {}),
        nodeIds: [node.id],
        operationKind: node.operation.kind,
      });
    } else {
      existing.nodeIds.push(node.id);
    }
  }

  return [...groups.entries()]
    .filter(([, group]) => group.nodeIds.length > 1)
    .map(([fingerprint, group]) => ({
      count: group.nodeIds.length,
      ...(group.displayName !== undefined
        ? { displayName: group.displayName }
        : {}),
      fingerprint,
      nodeIds: group.nodeIds,
      operationKind: group.operationKind,
    }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function findRepeatedArtifacts(
  nodes: readonly ExecutionNode[],
  kind: string,
): readonly RepeatedArtifactReport[] {
  const groups = new Map<
    string,
    {
      artifactIds: string[];
      nodeIds: string[];
    }
  >();

  for (const node of nodes) {
    for (const artifact of node.artifacts) {
      if (artifact.kind !== kind || artifact.fingerprint === undefined) {
        continue;
      }

      const existing = groups.get(artifact.fingerprint);

      if (existing === undefined) {
        groups.set(artifact.fingerprint, {
          artifactIds: [artifact.id],
          nodeIds: [node.id],
        });
      } else {
        existing.artifactIds.push(artifact.id);
        existing.nodeIds.push(node.id);
      }
    }
  }

  return [...groups.entries()]
    .filter(([, group]) => group.nodeIds.length > 1)
    .map(([fingerprint, group]) => ({
      artifactIds: group.artifactIds,
      count: group.nodeIds.length,
      fingerprint,
      kind,
      nodeIds: group.nodeIds,
    }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function createPotentialCachePoint(
  operation: RepeatedOperationReport,
  nodes: readonly ExecutionNode[],
): PotentialCachePointReport | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const operationNodes = operation.nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId);

    return node === undefined ? [] : [node];
  });

  if (
    operationNodes.length !== operation.nodeIds.length ||
    operationNodes.some((node) => node.status !== "ok")
  ) {
    return undefined;
  }

  const avoidableLatencyMs = sumDefined(
    operationNodes.slice(1).map((node) => node.durationMs),
  );

  return {
    ...(operation.displayName !== undefined
      ? { displayName: operation.displayName }
      : {}),
    fingerprint: operation.fingerprint,
    nodeIds: operation.nodeIds,
    operationKind: operation.operationKind,
    ...(avoidableLatencyMs !== undefined ? { avoidableLatencyMs } : {}),
  };
}

function createExecutionOpportunities(input: {
  readonly nodes: readonly ExecutionNode[];
  readonly potentialCachePoints: readonly PotentialCachePointReport[];
  readonly potentialParallelism: readonly PotentialParallelismReport[];
  readonly repeatedFiles: readonly RepeatedArtifactReport[];
  readonly repeatedOperations: readonly RepeatedOperationReport[];
}): readonly ExecutionOpportunityReport[] {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));

  return [
    ...input.repeatedOperations.flatMap((operation) =>
      createRepeatedFailureOpportunity(operation, nodesById),
    ),
    ...input.potentialCachePoints.map(createCacheOpportunity),
    ...input.repeatedFiles.map(createFileReuseOpportunity),
    ...input.potentialParallelism.map((parallelism) =>
      createParallelismOpportunity(parallelism, nodesById),
    ),
  ].sort(compareExecutionOpportunities);
}

function createRepeatedFailureOpportunity(
  operation: RepeatedOperationReport,
  nodesById: ReadonlyMap<string, ExecutionNode>,
): readonly ExecutionOpportunityReport[] {
  const nodes = operation.nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId);

    return node === undefined ? [] : [node];
  });
  const failedNodes = nodes.filter((node) => node.status === "error");

  if (failedNodes.length === 0) {
    return [];
  }

  const hasSuccessfulNodes = nodes.some((node) => node.status === "ok");
  const displayName = operation.displayName ?? operation.operationKind;
  const latency = sumDefined(failedNodes.map((node) => node.durationMs));
  const opportunity: ExecutionOpportunityReport = {
    actionability: hasSuccessfulNodes ? "needs_review" : "actionable",
    blockedBy: hasSuccessfulNodes
      ? [
          "Mixed success and failure statuses must be explained before retry, cache, or fallback work.",
        ]
      : ["Inspect the failure cause before choosing a fix."],
    category: "failure",
    confidence: hasSuccessfulNodes ? "medium" : "high",
    id: opportunityId("failure", {
      fingerprint: operation.fingerprint,
      nodeIds: operation.nodeIds,
    }),
    nodeIds: operation.nodeIds,
    priority: hasSuccessfulNodes ? "medium" : "high",
    reason: hasSuccessfulNodes
      ? `${displayName} had mixed success and failure for the same ${operation.operationKind} operation fingerprint.`
      : `${displayName} failed repeatedly for the same ${operation.operationKind} operation fingerprint.`,
    safetyNotes: hasSuccessfulNodes
      ? [
          "Mixed success and failure statuses: inspect reliability before treating this as reusable work.",
        ]
      : [
          "Failure repeats are reliability signals, not clean cache candidates.",
        ],
    whyActionable: hasSuccessfulNodes
      ? `The same ${operation.operationKind} fingerprint produced both success and failure, making the reliability boundary visible.`
      : `The same ${operation.operationKind} fingerprint failed more than once, creating a concrete reliability group to investigate.`,
    ...(latency !== undefined ? { estimatedAvoidableLatencyMs: latency } : {}),
  };

  return [opportunity];
}

function createCacheOpportunity(
  point: PotentialCachePointReport,
): ExecutionOpportunityReport {
  const displayName = point.displayName ?? point.operationKind;

  return {
    actionability: "needs_review",
    blockedBy: [
      "Verify input equivalence, side effects, and freshness requirements before adding a cache.",
    ],
    category: "cache",
    confidence: point.avoidableLatencyMs === undefined ? "medium" : "high",
    id: opportunityId("cache", {
      fingerprint: point.fingerprint,
      nodeIds: point.nodeIds,
    }),
    nodeIds: point.nodeIds,
    priority: point.avoidableLatencyMs === undefined ? "medium" : "high",
    reason: `${displayName} repeated the same successful ${point.operationKind} operation ${point.nodeIds.length} times; later runs may be cacheable.`,
    safetyNotes: [
      "Observation only: verify inputs, side effects, and freshness requirements before caching.",
    ],
    whyActionable:
      point.avoidableLatencyMs === undefined
        ? `The same successful ${point.operationKind} fingerprint repeated across the run.`
        : `The same successful ${point.operationKind} fingerprint repeated with measured later-run latency.`,
    ...(point.avoidableLatencyMs !== undefined
      ? { estimatedAvoidableLatencyMs: point.avoidableLatencyMs }
      : {}),
  };
}

function createFileReuseOpportunity(
  artifact: RepeatedArtifactReport,
): ExecutionOpportunityReport {
  return {
    actionability: "needs_review",
    artifactIds: artifact.artifactIds,
    blockedBy: [
      "Raw file paths are omitted.",
      "A caller-safe file identity and freshness policy is required before reuse.",
    ],
    category: "file_reuse",
    confidence: "medium",
    id: opportunityId("file_reuse", {
      artifactIds: artifact.artifactIds,
      fingerprint: artifact.fingerprint,
      nodeIds: artifact.nodeIds,
    }),
    nodeIds: artifact.nodeIds,
    priority: "medium",
    reason: `A ${artifact.kind} fingerprint was observed ${artifact.count} times across tool activity.`,
    safetyNotes: [
      "Raw file paths are omitted; this fingerprint alone does not prove cacheable tool input or output.",
    ],
    whyActionable:
      "The same redacted file fingerprint appeared across multiple tool calls.",
  };
}

function createParallelismOpportunity(
  parallelism: PotentialParallelismReport,
  nodesById: ReadonlyMap<string, ExecutionNode>,
): ExecutionOpportunityReport {
  const durations = parallelism.nodeIds
    .map((nodeId) => nodesById.get(nodeId)?.durationMs)
    .filter((duration): duration is number => typeof duration === "number");
  const estimatedAvoidableLatencyMs =
    durations.length === parallelism.nodeIds.length
      ? Math.min(...durations)
      : undefined;

  return {
    actionability: "blocked",
    blockedBy: [
      "Verify no data dependency, side effect ordering, or user-visible sequencing before parallelizing.",
    ],
    category: "parallelism",
    confidence: "low",
    id: opportunityId("parallelism", {
      nodeIds: parallelism.nodeIds,
    }),
    nodeIds: parallelism.nodeIds,
    priority: "low",
    reason: parallelism.reason,
    safetyNotes: [
      "Sequence-only adjacency is not proof of independence; verify data dependencies and side effects first.",
    ],
    whyActionable:
      "The observed nodes were adjacent with only sequence-order evidence, so they are a candidate for dependency review.",
    ...(estimatedAvoidableLatencyMs !== undefined
      ? { estimatedAvoidableLatencyMs }
      : {}),
  };
}

function compareExecutionOpportunities(
  left: ExecutionOpportunityReport,
  right: ExecutionOpportunityReport,
): number {
  const actionabilityComparison =
    opportunityActionabilityRank(right.actionability) -
    opportunityActionabilityRank(left.actionability);

  if (actionabilityComparison !== 0) {
    return actionabilityComparison;
  }

  const priorityComparison =
    opportunityPriorityRank(right.priority) -
    opportunityPriorityRank(left.priority);

  if (priorityComparison !== 0) {
    return priorityComparison;
  }

  const confidenceComparison =
    opportunityConfidenceRank(right.confidence) -
    opportunityConfidenceRank(left.confidence);

  if (confidenceComparison !== 0) {
    return confidenceComparison;
  }

  const leftLatency = left.estimatedAvoidableLatencyMs;
  const rightLatency = right.estimatedAvoidableLatencyMs;

  if (leftLatency !== undefined || rightLatency !== undefined) {
    if (leftLatency === undefined) {
      return 1;
    }

    if (rightLatency === undefined) {
      return -1;
    }

    if (leftLatency !== rightLatency) {
      return rightLatency - leftLatency;
    }
  }

  const categoryComparison = left.category.localeCompare(right.category);

  if (categoryComparison !== 0) {
    return categoryComparison;
  }

  const nodeComparison = left.nodeIds
    .join("\u0000")
    .localeCompare(right.nodeIds.join("\u0000"));

  if (nodeComparison !== 0) {
    return nodeComparison;
  }

  return left.id.localeCompare(right.id);
}

function opportunityActionabilityRank(
  actionability: ExecutionOpportunityActionability,
): number {
  switch (actionability) {
    case "actionable":
      return 3;
    case "needs_review":
      return 2;
    case "blocked":
      return 1;
  }
}

function opportunityPriorityRank(
  priority: ExecutionOpportunityPriority,
): number {
  switch (priority) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function opportunityConfidenceRank(
  confidence: ExecutionOpportunityConfidence,
): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function opportunityId(
  category: ExecutionOpportunityCategory,
  value: unknown,
): string {
  return `${category}-${stableExecutionDigest(value).slice(0, 12)}`;
}

function findCriticalPath(graph: ExecutionGraph): CriticalPathState {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>(
    graph.nodes.map((node) => [node.id, []]),
  );

  for (const edge of graph.edges) {
    const edges = incoming.get(edge.to);

    if (edges !== undefined && nodesById.has(edge.from)) {
      edges.push(edge.from);
    }
  }

  const memo = new Map<string, CriticalPathState>();
  const visiting = new Set<string>();

  function bestPathTo(nodeId: string): CriticalPathState {
    const cached = memo.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(nodeId)) {
      return {
        durationMs: 0,
        nodeIds: [],
      };
    }

    visiting.add(nodeId);
    const node = nodesById.get(nodeId);
    const ownDuration = node?.durationMs ?? 0;
    const incomingNodeIds = incoming.get(nodeId) ?? [];
    let best: CriticalPathState = {
      durationMs: ownDuration,
      nodeIds: [nodeId],
    };

    for (const incomingNodeId of incomingNodeIds) {
      const previous = bestPathTo(incomingNodeId);
      const candidate: CriticalPathState = {
        durationMs: previous.durationMs + ownDuration,
        nodeIds: [...previous.nodeIds, nodeId],
      };

      if (compareCriticalPath(candidate, best) < 0) {
        best = candidate;
      }
    }

    visiting.delete(nodeId);
    memo.set(nodeId, best);

    return best;
  }

  return (
    graph.nodes
      .map((node) => bestPathTo(node.id))
      .sort(compareCriticalPath)[0] ?? { durationMs: 0, nodeIds: [] }
  );
}

function compareCriticalPath(
  left: CriticalPathState,
  right: CriticalPathState,
): number {
  if (left.durationMs !== right.durationMs) {
    return right.durationMs - left.durationMs;
  }

  if (left.nodeIds.length !== right.nodeIds.length) {
    return right.nodeIds.length - left.nodeIds.length;
  }

  return left.nodeIds
    .join("\u0000")
    .localeCompare(right.nodeIds.join("\u0000"));
}

function findPotentialParallelism(
  graph: ExecutionGraph,
): readonly PotentialParallelismReport[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  return graph.edges
    .filter((edge) => edge.kind === "sequence")
    .flatMap((edge) => {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);

      if (
        from?.operation.kind !== "tool_call" ||
        to?.operation.kind !== "tool_call"
      ) {
        return [];
      }

      return [
        {
          nodeIds: [from.id, to.id] as [string, string],
          reason:
            "Adjacent operations are ordered only by observation sequence; verify side effects before parallelizing.",
        },
      ];
    });
}

function summarizeTokens(nodes: readonly ExecutionNode[]): TokenEstimateReport {
  return {
    ...sumMetric(nodes, "cachedInputTokens"),
    ...sumMetric(nodes, "inputTokens"),
    ...sumMetric(nodes, "outputTokens"),
    ...sumMetric(nodes, "reasoningOutputTokens"),
    ...sumTotalTokens(nodes),
  };
}

function sumMetric(
  nodes: readonly ExecutionNode[],
  key: keyof TokenEstimateReport,
): Partial<TokenEstimateReport> {
  const values = nodes
    .map((node) => node.metrics[key])
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return {};
  }

  return {
    [key]: values.reduce((total, value) => total + value, 0),
  } as Partial<TokenEstimateReport>;
}

function sumTotalTokens(
  nodes: readonly ExecutionNode[],
): Pick<TokenEstimateReport, "totalTokens"> {
  const explicit = nodes
    .map((node) => node.metrics.totalTokens)
    .filter((value): value is number => typeof value === "number");

  if (explicit.length > 0) {
    return {
      totalTokens: explicit.reduce((total, value) => total + value, 0),
    };
  }

  const tokenEstimates = summarizeKnownTokenParts(nodes);

  if (
    tokenEstimates.inputTokens === undefined &&
    tokenEstimates.outputTokens === undefined &&
    tokenEstimates.reasoningOutputTokens === undefined
  ) {
    return {};
  }

  return {
    totalTokens:
      (tokenEstimates.inputTokens ?? 0) +
      (tokenEstimates.outputTokens ?? 0) +
      (tokenEstimates.reasoningOutputTokens ?? 0),
  };
}

function summarizeKnownTokenParts(
  nodes: readonly ExecutionNode[],
): TokenEstimateReport {
  return {
    ...sumMetric(nodes, "inputTokens"),
    ...sumMetric(nodes, "outputTokens"),
    ...sumMetric(nodes, "reasoningOutputTokens"),
  };
}

function renderNodeLines(nodes: readonly ExecutionNode[]): readonly string[] {
  if (nodes.length === 0) {
    return ["- none"];
  }

  return nodes.map(
    (node) =>
      `- ${node.id}: ${node.operation.name ?? node.operation.kind} (${node.operation.kind}, ${node.status}, ${formatOptionalNumber(node.durationMs)} ms)`,
  );
}

function renderEdgeLines(edges: readonly ExecutionEdge[]): readonly string[] {
  if (edges.length === 0) {
    return ["- none"];
  }

  return edges.map((edge) => `- ${edge.from} -> ${edge.to} (${edge.kind})`);
}

function renderToolCallLines(
  nodes: readonly ExecutionNode[],
): readonly string[] {
  const toolCalls = nodes.filter((node) => node.operation.kind === "tool_call");

  if (toolCalls.length === 0) {
    return ["- none"];
  }

  return toolCalls.map(
    (node) =>
      `- ${node.id}: ${node.operation.name ?? "tool"} (${node.status}, ${formatOptionalNumber(node.durationMs)} ms)`,
  );
}

function renderRepeatedOperationLines(
  operations: readonly RepeatedOperationReport[],
): readonly string[] {
  if (operations.length === 0) {
    return ["- none"];
  }

  return operations.map(
    (operation) =>
      `- ${operation.displayName ?? operation.operationKind} (${operation.operationKind}) ${operation.fingerprint}: ${operation.count}x (${operation.nodeIds.join(", ")})`,
  );
}

function renderRepeatedArtifactLines(
  artifacts: readonly RepeatedArtifactReport[],
): readonly string[] {
  if (artifacts.length === 0) {
    return ["- none"];
  }

  return artifacts.map(
    (artifact) =>
      `- ${artifact.kind} ${artifact.fingerprint}: ${artifact.count}x (${artifact.nodeIds.join(", ")})`,
  );
}

function renderPotentialCachePointLines(
  points: readonly PotentialCachePointReport[],
): readonly string[] {
  if (points.length === 0) {
    return ["- none"];
  }

  return points.map(
    (point) =>
      `- ${point.displayName ?? point.operationKind} (${point.operationKind}) ${point.fingerprint}: ${point.nodeIds.join(", ")}; avoidable latency ${formatOptionalNumber(point.avoidableLatencyMs)} ms`,
  );
}

function renderOpportunityLines(
  opportunities: readonly ExecutionOpportunityReport[],
): readonly string[] {
  if (opportunities.length === 0) {
    return ["- none"];
  }

  return opportunities.map((opportunity) => {
    const details = [
      `Nodes: ${opportunity.nodeIds.join(", ")}`,
      ...(opportunity.artifactIds === undefined
        ? []
        : [`Artifacts: ${opportunity.artifactIds.join(", ")}`]),
      `avoidable latency ${formatOptionalNumber(opportunity.estimatedAvoidableLatencyMs)} ms`,
      `Why actionable: ${opportunity.whyActionable}`,
      `Blocked by: ${opportunity.blockedBy.length > 0 ? opportunity.blockedBy.join(" ") : "none"}`,
      `Safety: ${opportunity.safetyNotes.join(" ")}`,
    ];

    return `- [${opportunity.actionability} ${opportunity.priority}/${opportunity.confidence}] ${opportunity.category}: ${opportunity.reason} ${details.join("; ")}`;
  });
}

function renderPotentialParallelismLines(
  candidates: readonly PotentialParallelismReport[],
): readonly string[] {
  if (candidates.length === 0) {
    return ["- none"];
  }

  return candidates.map(
    (candidate) => `- ${candidate.nodeIds.join(" + ")}: ${candidate.reason}`,
  );
}

function renderTokenLines(
  tokenEstimates: TokenEstimateReport,
): readonly string[] {
  const lines = [
    optionalTokenLine("Input tokens", tokenEstimates.inputTokens),
    optionalTokenLine("Cached input tokens", tokenEstimates.cachedInputTokens),
    optionalTokenLine("Output tokens", tokenEstimates.outputTokens),
    optionalTokenLine(
      "Reasoning output tokens",
      tokenEstimates.reasoningOutputTokens,
    ),
    optionalTokenLine("Total tokens", tokenEstimates.totalTokens),
  ].filter((line): line is string => line !== undefined);

  return lines.length === 0 ? ["- unavailable"] : lines;
}

function optionalTokenLine(
  label: string,
  value: number | undefined,
): string | undefined {
  return value === undefined ? undefined : `- ${label}: ${value}`;
}

function readSequenceScope(metadata: Metadata): string | undefined {
  const sequence = metadata.sequence;

  if (!isRecord(sequence)) {
    return undefined;
  }

  return typeof sequence.scope === "string" ? sequence.scope : undefined;
}

function dependencyKey(dependency: Dependency): string {
  return [
    dependency.operationId,
    dependency.kind,
    dependency.artifactId ?? "",
  ].join("\u0000");
}

function durationMs(startedAt: string, endedAt: string): number {
  const duration = Date.parse(endedAt) - Date.parse(startedAt);

  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function minIso(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function sumDefined(
  values: readonly (number | undefined)[],
): number | undefined {
  const knownValues = values.filter(
    (value): value is number => typeof value === "number",
  );

  if (knownValues.length === 0) {
    return undefined;
  }

  return knownValues.reduce((total, value) => total + value, 0);
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unavailable" : String(value);
}

function isLifecycle(value: unknown): value is ExecutionLifecycle {
  return value === "finish" || value === "point" || value === "start";
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function toStableExecutionJsonValue(value: unknown): unknown {
  return normalizeStableExecutionJsonValue(value, new WeakSet<object>());
}

function normalizeStableExecutionJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }

  if (typeof value === "function") {
    return { $function: value.name || "anonymous" };
  }

  if (typeof value === "symbol") {
    return { $symbol: String(value) };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return { $circular: true };
    }

    seen.add(value);
    const normalized = value.map((item) =>
      normalizeStableExecutionJsonValue(item, seen),
    );
    seen.delete(value);

    return normalized;
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return { $circular: true };
  }

  seen.add(value);
  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    const child = value[key];

    if (child !== undefined) {
      stable[key] = normalizeStableExecutionJsonValue(child, seen);
    }
  }

  seen.delete(value);

  return stable;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
