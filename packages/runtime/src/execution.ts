import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ADAPTIVE_POLICY_BUNDLE_VERSION,
  ADAPTIVE_POLICY_PROHIBITED_EFFECTS,
  validateAdaptivePolicyBundle,
  type AdaptivePolicyBundle,
} from "./adaptive-policy.js";

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

export interface RenderExecutionAdviceOptions {
  readonly policies?: readonly unknown[];
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
  readonly fileFreshness?: FileFreshnessEvidenceReport;
  readonly fingerprint: string;
  readonly kind: string;
  readonly localReadContexts?: readonly LocalReadContextReport[];
  readonly nodeIds: readonly string[];
  readonly sourceLabels?: readonly string[];
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

export interface FileFreshnessEvidenceReport {
  readonly evidence: string;
  readonly status: "unknown" | "verified";
}

export interface FileReuseEvidenceReport {
  readonly automaticSkip: {
    readonly allowed: boolean;
    readonly reason: string;
  };
  readonly freshness: FileFreshnessEvidenceReport;
  readonly repeatedIdentity: {
    readonly mode: "redacted_fingerprint";
    readonly status: "observed";
  };
  readonly sourceEquivalence: {
    readonly assumption: string;
    readonly status: "unknown" | "verified";
  };
}

export interface LocalReadContextReport {
  readonly commandShapes: readonly string[];
  readonly fileVersion?: {
    readonly kind: string;
    readonly value: string;
  };
  readonly rangeLabel?: string;
  readonly relativePath: string;
}

export interface ExecutionOpportunityReport {
  readonly actionability: ExecutionOpportunityActionability;
  readonly artifactIds?: readonly string[];
  readonly blockedBy: readonly string[];
  readonly category: ExecutionOpportunityCategory;
  readonly confidence: ExecutionOpportunityConfidence;
  readonly estimatedAvoidableLatencyMs?: number;
  readonly fileReuseEvidence?: FileReuseEvidenceReport;
  readonly id: string;
  readonly localReadContexts?: readonly LocalReadContextReport[];
  readonly nodeIds: readonly string[];
  readonly priority: ExecutionOpportunityPriority;
  readonly relatedCandidateCount?: number;
  readonly reason: string;
  readonly safetyNotes: readonly string[];
  readonly sourceLabels?: readonly string[];
  readonly whyActionable: string;
}

export interface ExecutionOpportunitySummaryReport {
  readonly actionabilityCounts: {
    readonly actionable: number;
    readonly blocked: number;
    readonly needsReview: number;
  };
  readonly topOpportunityId?: string;
  readonly topRecommendation?: string;
  readonly total: number;
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
  readonly opportunitySummary?: ExecutionOpportunitySummaryReport;
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

interface AppliedAdvicePolicy {
  readonly bundleId: string;
  readonly category: Extract<ExecutionOpportunityCategory, "file_reuse">;
  readonly ruleId: string;
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
  const opportunitySummary = createOpportunitySummary(opportunities);
  const summary: ExecutionReportSummary = {
    criticalPath: findCriticalPath(graph),
    edgeCount: graph.edges.length,
    failedNodes: graph.nodes
      .filter((node) => node.status === "error")
      .map((node) => node.id),
    nodeCount: graph.nodes.length,
    opportunities,
    opportunitySummary,
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
    "## Opportunity Summary",
    "",
    ...renderOpportunitySummaryLines(summary.opportunitySummary),
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

export function renderExecutionAdvice(
  graph: ExecutionGraph,
  options: RenderExecutionAdviceOptions = {},
): string {
  const summary = createExecutionReportSummary(graph);
  const appliedPolicies = appliedAdvicePolicies(
    summary.opportunities,
    options.policies ?? [],
  );
  const fileReuse = summary.opportunities.find(
    (opportunity) => opportunity.category === "file_reuse",
  );

  if (fileReuse !== undefined) {
    return renderFileReuseAdvice(graph, fileReuse, appliedPolicies);
  }

  const topOpportunity = summary.opportunities[0];

  if (topOpportunity === undefined) {
    return [
      "# Migaki Session Advice",
      "",
      `Run: ${graph.runId}`,
      "",
      "Top signal: none",
      "",
      "Next Codex move:",
      "- No repeated file, cache, or parallelism recommendation is available yet.",
      "- Keep working normally; Migaki needs more observed execution evidence before it can coach the next turn.",
      "",
    ].join("\n");
  }

  return [
    "# Migaki Session Advice",
    "",
    `Run: ${graph.runId}`,
    "",
    `Top signal: ${topOpportunity.actionability} ${topOpportunity.category}`,
    "",
    "Next Codex move:",
    `- Review the ${topOpportunity.category} opportunity before starting the next turn.`,
    `- ${topOpportunity.whyActionable}`,
    "",
    "Safety:",
    `- ${topOpportunity.safetyNotes.join(" ")}`,
    "",
  ].join("\n");
}

function renderFileReuseAdvice(
  graph: ExecutionGraph,
  opportunity: ExecutionOpportunityReport,
  policies: readonly AppliedAdvicePolicy[],
): string {
  return [
    "# Migaki Session Advice",
    "",
    `Run: ${graph.runId}`,
    "",
    `Top signal: ${opportunity.actionability} file_reuse across ${opportunity.nodeIds.length} read-like calls.`,
    `Safe source signals: ${formatSourceLabels(opportunity.sourceLabels)}`,
    ...renderFileReuseEvidenceAdviceLines(opportunity.fileReuseEvidence),
    ...renderLocalReadContextAdviceLines(opportunity.localReadContexts),
    "",
    "Next Codex move:",
    "- Treat the repeated file identity as coaching evidence, not permission to skip a read.",
    "- Reuse prior file context when it already answers the current question.",
    "- If more detail is needed, name the missing fact first, then read the smallest useful range once.",
    "- Keep a short note of what the read contained so later turns can use that context instead of reopening it.",
    "",
    "Suggested next prompt:",
    "Before continuing, check the prior context for files already inspected. Do not reopen the same file unless you need a specific missing range; do not skip reads automatically from this signal alone. If you do read, use the smallest useful range once and summarize what you learned for later turns.",
    "",
    ...renderPolicyProvenanceLines(policies),
    "Safety:",
    "- Raw paths and commands are omitted; this advice uses only fingerprints and safe source labels.",
    "- Observation only: do not cache, replay, or skip reads automatically until freshness and source equivalence are verified.",
    "",
  ].join("\n");
}

function renderFileReuseEvidenceAdviceLines(
  evidence: FileReuseEvidenceReport | undefined,
): readonly string[] {
  if (evidence === undefined) {
    return [];
  }

  return [
    `Freshness: ${evidence.freshness.status}. ${evidence.freshness.evidence}`,
    `Source equivalence: ${evidence.sourceEquivalence.status}. ${evidence.sourceEquivalence.assumption}`,
    `Automatic skip: ${evidence.automaticSkip.allowed ? "allowed" : "disallowed"}. ${evidence.automaticSkip.reason}`,
  ];
}

function renderLocalReadContextAdviceLines(
  contexts: readonly LocalReadContextReport[] | undefined,
): readonly string[] {
  if (contexts === undefined || contexts.length === 0) {
    return [];
  }

  return [
    "",
    "Local dogfood context:",
    ...contexts.map((context) => {
      const range =
        context.rangeLabel === undefined ? "" : ` (${context.rangeLabel})`;
      const commandShapes =
        context.commandShapes.length === 0
          ? "unknown read shape"
          : context.commandShapes.join(", ");
      const version =
        context.fileVersion === undefined
          ? "version unknown"
          : `version ${context.fileVersion.kind} ${context.fileVersion.value}`;

      return `- Already inspected ${context.relativePath}${range} via ${commandShapes}; ${version}.`;
    }),
    "- Reuse the prior context unless that file changed or the current task needs a missing range.",
  ];
}

function appliedAdvicePolicies(
  opportunities: readonly ExecutionOpportunityReport[],
  policies: readonly unknown[],
): readonly AppliedAdvicePolicy[] {
  if (
    !opportunities.some((opportunity) => opportunity.category === "file_reuse")
  ) {
    return [];
  }

  return policies
    .flatMap((policy) => appliedAdvicePoliciesForBundle(policy))
    .sort(
      (left, right) =>
        left.bundleId.localeCompare(right.bundleId) ||
        left.ruleId.localeCompare(right.ruleId),
    );
}

function appliedAdvicePoliciesForBundle(
  policy: unknown,
): readonly AppliedAdvicePolicy[] {
  const bundle = acceptedAdvicePolicyBundle(policy);

  if (bundle === undefined) {
    return [];
  }

  return bundle.rules.flatMap((rule) => {
    if (
      !rule.enabled ||
      rule.target !== "advice_ranking" ||
      rule.action.kind !== "emphasize" ||
      rule.match.category !== "file_reuse"
    ) {
      return [];
    }

    return [
      {
        bundleId: bundle.id,
        category: "file_reuse",
        ruleId: rule.id,
      },
    ];
  });
}

function acceptedAdvicePolicyBundle(
  policy: unknown,
): AdaptivePolicyBundle | undefined {
  const result = validateAdaptivePolicyBundle(policy);

  if (!result.success) {
    return undefined;
  }

  const bundle = result.bundle;

  if (
    bundle.version !== ADAPTIVE_POLICY_BUNDLE_VERSION ||
    bundle.status !== "accepted" ||
    bundle.scope !== "advice" ||
    bundle.safety.effectMode !== "advice_only"
  ) {
    return undefined;
  }

  if (
    ADAPTIVE_POLICY_PROHIBITED_EFFECTS.some(
      (effect) => !bundle.safety.prohibitedEffects.includes(effect),
    )
  ) {
    return undefined;
  }

  return bundle;
}

function renderPolicyProvenanceLines(
  policies: readonly AppliedAdvicePolicy[],
): readonly string[] {
  if (policies.length === 0) {
    return [];
  }

  return [
    "Policy:",
    ...policies.map(
      (policy) => `- Applied ${policy.bundleId}: emphasized file_reuse advice.`,
    ),
    "",
  ];
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
      artifacts: Artifact[];
      artifactIds: string[];
      localReadContexts: LocalReadContextReport[];
      nodeIds: string[];
      sourceLabels: string[];
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
          artifacts: [artifact],
          artifactIds: [artifact.id],
          localReadContexts: optionalLocalReadContext(
            artifactLocalReadContext(artifact),
          ),
          nodeIds: [node.id],
          sourceLabels: optionalString(artifactSourceLabel(artifact)),
        });
      } else {
        existing.artifacts.push(artifact);
        existing.artifactIds.push(artifact.id);
        existing.nodeIds.push(node.id);
        const localReadContext = artifactLocalReadContext(artifact);

        if (localReadContext !== undefined) {
          existing.localReadContexts.push(localReadContext);
        }

        const sourceLabel = artifactSourceLabel(artifact);

        if (sourceLabel !== undefined) {
          existing.sourceLabels.push(sourceLabel);
        }
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
      ...optionalLocalReadContexts(group.localReadContexts),
      nodeIds: group.nodeIds,
      ...(kind === "file"
        ? optionalFileFreshnessEvidence(group.artifacts)
        : {}),
      ...optionalSourceLabels(group.sourceLabels),
    }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function artifactLocalReadContext(
  artifact: Artifact,
): LocalReadContextReport | undefined {
  const metadata = artifact.metadata;

  if (metadata === undefined || !isRecord(metadata.codex)) {
    return undefined;
  }

  const localDogfood = metadata.codex.localDogfood;

  if (!isRecord(localDogfood)) {
    return undefined;
  }

  const relativePath = safeLocalContextText(
    readStringValue(localDogfood, "relativePath"),
  );
  const rangeLabel = safeLocalContextText(
    readStringValue(localDogfood, "rangeLabel"),
  );
  const commandShape =
    safeLocalContextText(readStringValue(localDogfood, "commandShape")) ??
    safeLocalContextText(readStringValue(metadata.codex, "commandShape"));

  if (relativePath === undefined) {
    return undefined;
  }

  return {
    commandShapes: commandShape === undefined ? [] : [commandShape],
    ...optionalFileVersion(localDogfood),
    ...(rangeLabel === undefined ? {} : { rangeLabel }),
    relativePath,
  };
}

function optionalLocalReadContext(
  context: LocalReadContextReport | undefined,
): LocalReadContextReport[] {
  return context === undefined ? [] : [context];
}

function optionalLocalReadContexts(
  contexts: readonly LocalReadContextReport[],
): Pick<RepeatedArtifactReport, "localReadContexts"> | Record<string, never> {
  const combined = combineLocalReadContexts(contexts);

  return combined.length === 0 ? {} : { localReadContexts: combined };
}

function combineLocalReadContexts(
  contexts: readonly LocalReadContextReport[],
): readonly LocalReadContextReport[] {
  const groups = new Map<
    string,
    {
      commandShapes: string[];
      fileVersion?: LocalReadContextReport["fileVersion"];
      rangeLabel?: string;
      relativePath: string;
    }
  >();

  for (const context of contexts) {
    const key = [
      context.relativePath,
      context.rangeLabel ?? "",
      context.fileVersion?.kind ?? "",
      context.fileVersion?.value ?? "",
    ].join("\u0000");
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        commandShapes: [...context.commandShapes],
        ...(context.fileVersion === undefined
          ? {}
          : { fileVersion: context.fileVersion }),
        ...(context.rangeLabel === undefined
          ? {}
          : { rangeLabel: context.rangeLabel }),
        relativePath: context.relativePath,
      });
    } else {
      existing.commandShapes.push(...context.commandShapes);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      commandShapes: uniqueStrings(group.commandShapes),
      ...(group.fileVersion === undefined
        ? {}
        : { fileVersion: group.fileVersion }),
      ...(group.rangeLabel === undefined
        ? {}
        : { rangeLabel: group.rangeLabel }),
      relativePath: group.relativePath,
    }))
    .sort(
      (left, right) =>
        left.relativePath.localeCompare(right.relativePath) ||
        (left.rangeLabel ?? "").localeCompare(right.rangeLabel ?? "") ||
        (left.fileVersion?.value ?? "").localeCompare(
          right.fileVersion?.value ?? "",
        ),
    );
}

function optionalFileVersion(
  localDogfood: Readonly<Record<string, unknown>>,
): Pick<LocalReadContextReport, "fileVersion"> | Record<string, never> {
  const fileVersion = localDogfood.fileVersion;

  if (!isRecord(fileVersion)) {
    return {};
  }

  const kind = safeLocalContextText(readStringValue(fileVersion, "kind"));
  const value = safeLocalContextText(readStringValue(fileVersion, "value"));

  return kind === undefined || value === undefined
    ? {}
    : { fileVersion: { kind, value } };
}

function safeLocalContextText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    trimmed.length > 240 ||
    /[\0\r\n]/u.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

function artifactSourceLabel(artifact: Artifact): string | undefined {
  const metadata = artifact.metadata;

  if (metadata === undefined) {
    return undefined;
  }

  const codex = metadata.codex;

  if (!isRecord(codex)) {
    return undefined;
  }

  const toolName = readStringValue(codex, "toolName");
  const sourceCommand = readStringValue(codex, "sourceCommand");
  const sourceField = readStringValue(codex, "sourceField");

  if (
    (toolName === "Bash" || toolName === "Shell") &&
    sourceCommand !== undefined
  ) {
    const commandName = safeSourceCommandName(sourceCommand);

    return commandName === undefined
      ? `${toolName}.command`
      : `${toolName} ${commandName}`;
  }

  if (toolName !== undefined && sourceField !== undefined) {
    return `${toolName}.${sourceField}`;
  }

  return toolName;
}

function safeSourceCommandName(sourceCommand: string): string | undefined {
  const token = sourceCommand.trim().split(/\s+/, 1)[0];
  const safeReadCommandNames = new Set([
    "cat",
    "head",
    "nl",
    "sed",
    "tail",
    "wc",
  ]);

  return token !== undefined && safeReadCommandNames.has(token)
    ? token
    : undefined;
}

function optionalSourceLabels(
  sourceLabels: readonly string[],
): Pick<RepeatedArtifactReport, "sourceLabels"> | Record<string, never> {
  const unique = uniqueStrings(sourceLabels);

  return unique.length === 0 ? {} : { sourceLabels: unique };
}

function optionalFileFreshnessEvidence(
  artifacts: readonly Artifact[],
): Pick<RepeatedArtifactReport, "fileFreshness"> | Record<string, never> {
  const contentFingerprints = artifacts.flatMap(
    (artifact) => artifactCodexString(artifact, "contentFingerprint") ?? [],
  );

  if (
    contentFingerprints.length === artifacts.length &&
    uniqueStrings(contentFingerprints).length === 1 &&
    !contentFingerprints[0]?.startsWith("unavailable:")
  ) {
    return {
      fileFreshness: {
        evidence:
          "Matching content fingerprints were captured for each read-like call.",
        status: "verified",
      },
    };
  }

  const versionKeys = artifacts.flatMap((artifact) => {
    const fileMtimeMs = artifactCodexNumber(artifact, "fileMtimeMs");
    const fileSizeBytes = artifactCodexNumber(artifact, "fileSizeBytes");

    return fileMtimeMs === undefined || fileSizeBytes === undefined
      ? []
      : [`${fileSizeBytes}:${fileMtimeMs}`];
  });

  if (
    versionKeys.length === artifacts.length &&
    uniqueStrings(versionKeys).length === 1
  ) {
    return {
      fileFreshness: {
        evidence:
          "Matching file size and modification timestamps were captured for each read-like call.",
        status: "verified",
      },
    };
  }

  return {};
}

function artifactCodexString(
  artifact: Artifact,
  key: string,
): string | undefined {
  const codex = artifactCodexMetadata(artifact);

  return codex === undefined ? undefined : readStringValue(codex, key);
}

function artifactCodexNumber(
  artifact: Artifact,
  key: string,
): number | undefined {
  const codex = artifactCodexMetadata(artifact);

  return codex === undefined ? undefined : readNumberValue(codex, key);
}

function artifactCodexMetadata(
  artifact: Artifact,
): Readonly<Record<string, unknown>> | undefined {
  const metadata = artifact.metadata;

  if (metadata === undefined || !isRecord(metadata.codex)) {
    return undefined;
  }

  return metadata.codex;
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
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
    ...createParallelismOpportunities(input.potentialParallelism, nodesById),
  ].sort(compareExecutionOpportunities);
}

function createOpportunitySummary(
  opportunities: readonly ExecutionOpportunityReport[],
): ExecutionOpportunitySummaryReport {
  const topOpportunity = opportunities[0];
  const summary: ExecutionOpportunitySummaryReport = {
    actionabilityCounts: {
      actionable: opportunities.filter(
        (opportunity) => opportunity.actionability === "actionable",
      ).length,
      blocked: opportunities.filter(
        (opportunity) => opportunity.actionability === "blocked",
      ).length,
      needsReview: opportunities.filter(
        (opportunity) => opportunity.actionability === "needs_review",
      ).length,
    },
    total: opportunities.length,
    ...(topOpportunity === undefined
      ? {}
      : {
          topOpportunityId: topOpportunity.id,
          topRecommendation: formatTopOpportunityRecommendation(topOpportunity),
        }),
  };

  return summary;
}

function formatTopOpportunityRecommendation(
  opportunity: ExecutionOpportunityReport,
): string {
  if (opportunity.relatedCandidateCount !== undefined) {
    return `${opportunity.actionability} ${opportunity.category} across ${opportunity.relatedCandidateCount} related candidates on ${opportunity.nodeIds.length} nodes`;
  }

  if (opportunity.category === "file_reuse") {
    const sources = formatSourceLabels(opportunity.sourceLabels);

    return `${opportunity.actionability} file_reuse across ${opportunity.nodeIds.length} read-like calls${sources === "unavailable" ? "" : ` (${sources})`}`;
  }

  return `${opportunity.actionability} ${opportunity.category} on nodes ${opportunity.nodeIds.join(", ")}`;
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
  const freshness = artifact.fileFreshness ?? unknownFileFreshnessEvidence();
  const sourceEquivalenceUnknown =
    "Safe source labels identify the read-like caller, not equivalent bytes, ranges, or output transforms.";

  return {
    actionability: "needs_review",
    artifactIds: artifact.artifactIds,
    blockedBy: [
      "Raw file paths are omitted.",
      ...(freshness.status === "verified"
        ? []
        : [
            "A caller-safe file identity and freshness policy is required before reuse.",
          ]),
      "Command-output equivalence must be verified before avoiding a read.",
    ],
    category: "file_reuse",
    confidence: "medium",
    fileReuseEvidence: {
      automaticSkip: {
        allowed: false,
        reason:
          freshness.status === "verified"
            ? "Source equivalence is unknown."
            : "Freshness and source equivalence are unknown.",
      },
      freshness,
      repeatedIdentity: {
        mode: "redacted_fingerprint",
        status: "observed",
      },
      sourceEquivalence: {
        assumption: sourceEquivalenceUnknown,
        status: "unknown",
      },
    },
    id: opportunityId("file_reuse", {
      artifactIds: artifact.artifactIds,
      fingerprint: artifact.fingerprint,
      nodeIds: artifact.nodeIds,
    }),
    ...(artifact.localReadContexts === undefined
      ? {}
      : { localReadContexts: artifact.localReadContexts }),
    nodeIds: artifact.nodeIds,
    priority: "medium",
    reason: `A ${artifact.kind} fingerprint was observed ${artifact.count} times across read-like tool activity.`,
    safetyNotes: [
      "Raw file paths and commands are omitted; this fingerprint alone does not prove cacheable tool input or output.",
    ],
    ...(artifact.sourceLabels === undefined
      ? {}
      : { sourceLabels: artifact.sourceLabels }),
    whyActionable:
      "The same redacted file identity was reopened through read-like tool calls.",
  };
}

function unknownFileFreshnessEvidence(): FileFreshnessEvidenceReport {
  return {
    evidence:
      "No file version, content digest, or modification timestamp was captured for each read-like call.",
    status: "unknown",
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

function createParallelismOpportunities(
  candidates: readonly PotentialParallelismReport[],
  nodesById: ReadonlyMap<string, ExecutionNode>,
): readonly ExecutionOpportunityReport[] {
  if (candidates.length === 0) {
    return [];
  }

  if (candidates.length === 1) {
    const candidate = candidates[0];

    return candidate === undefined
      ? []
      : [createParallelismOpportunity(candidate, nodesById)];
  }

  const nodeIds = uniqueNodeIds(
    candidates.flatMap((candidate) => candidate.nodeIds),
  );

  return [
    {
      actionability: "blocked",
      blockedBy: [
        "Verify no data dependency, side effect ordering, or user-visible sequencing before parallelizing.",
      ],
      category: "parallelism",
      confidence: "low",
      id: opportunityId("parallelism", {
        candidates: candidates.map((candidate) => candidate.nodeIds),
      }),
      nodeIds,
      priority: "low",
      relatedCandidateCount: candidates.length,
      reason: `${candidates.length} adjacent tool-call pairs are ordered only by observation sequence; verify side effects before parallelizing.`,
      safetyNotes: [
        "Sequence-only adjacency is not proof of independence; verify data dependencies and side effects first.",
      ],
      whyActionable:
        "Multiple adjacent tool-call pairs were observed with only sequence-order evidence, so they are candidates for dependency review.",
    },
  ];
}

function uniqueNodeIds(nodeIds: readonly string[]): readonly string[] {
  return uniqueStrings(nodeIds);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
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

  if (left.category === "file_reuse" && right.category === "file_reuse") {
    const freshnessComparison =
      fileReuseFreshnessRank(right) - fileReuseFreshnessRank(left);

    if (freshnessComparison !== 0) {
      return freshnessComparison;
    }
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

function fileReuseFreshnessRank(
  opportunity: ExecutionOpportunityReport,
): number {
  return opportunity.fileReuseEvidence?.freshness.status === "verified" ? 1 : 0;
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

function renderOpportunitySummaryLines(
  summary: ExecutionOpportunitySummaryReport | undefined,
): readonly string[] {
  const counts = summary?.actionabilityCounts ?? {
    actionable: 0,
    blocked: 0,
    needsReview: 0,
  };

  return [
    `- Total: ${summary?.total ?? 0}`,
    `- Actionability: actionable ${counts.actionable}, needs_review ${counts.needsReview}, blocked ${counts.blocked}`,
    `- Top recommendation: ${summary?.topRecommendation ?? "none"}`,
  ];
}

function renderOpportunityLines(
  opportunities: readonly ExecutionOpportunityReport[],
): readonly string[] {
  if (opportunities.length === 0) {
    return ["- none"];
  }

  return opportunities.map((opportunity) => {
    const details = [
      `Nodes: ${formatOpportunityNodes(opportunity)}`,
      ...(opportunity.artifactIds === undefined
        ? []
        : [`Artifacts: ${opportunity.artifactIds.join(", ")}`]),
      ...(opportunity.relatedCandidateCount === undefined
        ? []
        : [`Related candidates: ${opportunity.relatedCandidateCount}`]),
      ...(opportunity.sourceLabels === undefined
        ? []
        : [`Sources: ${formatSourceLabels(opportunity.sourceLabels)}`]),
      ...renderFileReuseEvidenceDetailLines(opportunity.fileReuseEvidence),
      `avoidable latency ${formatOptionalNumber(opportunity.estimatedAvoidableLatencyMs)} ms`,
      `Why actionable: ${opportunity.whyActionable}`,
      `Blocked by: ${opportunity.blockedBy.length > 0 ? opportunity.blockedBy.join(" ") : "none"}`,
      `Safety: ${opportunity.safetyNotes.join(" ")}`,
    ];

    return `- [${opportunity.actionability} ${opportunity.priority}/${opportunity.confidence}] ${opportunity.category}: ${opportunity.reason} ${details.join("; ")}`;
  });
}

function renderFileReuseEvidenceDetailLines(
  evidence: FileReuseEvidenceReport | undefined,
): readonly string[] {
  if (evidence === undefined) {
    return [];
  }

  return [
    `File identity: ${evidence.repeatedIdentity.status} ${evidence.repeatedIdentity.mode}`,
    `Freshness: ${evidence.freshness.status}`,
    `Source equivalence: ${evidence.sourceEquivalence.status}`,
    `Automatic skip: ${evidence.automaticSkip.allowed ? "allowed" : "disallowed"}`,
  ];
}

function formatOpportunityNodes(
  opportunity: ExecutionOpportunityReport,
): string {
  if (opportunity.relatedCandidateCount !== undefined) {
    return `${opportunity.nodeIds.length} unique nodes`;
  }

  return opportunity.nodeIds.join(", ");
}

function formatSourceLabels(
  sourceLabels: readonly string[] | undefined,
): string {
  if (sourceLabels === undefined || sourceLabels.length === 0) {
    return "unavailable";
  }

  return sourceLabels.join(", ");
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

function readStringValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];

  return typeof value === "string" ? value : undefined;
}

function readNumberValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = input[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
