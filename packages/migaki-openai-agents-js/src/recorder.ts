import {
  createModelCallCacheKey,
  createToolCallCacheKey,
  stableHash,
} from "./hash.js";
import { renderMigakiReport } from "./report.js";
import {
  MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION,
  MIGAKI_GRAPH_VERSION,
  OPENAI_AGENTS_SDK_VERSION,
  type MigakiCacheKey,
  type MigakiClock,
  type MigakiEdge,
  type MigakiErrorSnapshot,
  type MigakiEvent,
  type MigakiEventType,
  type MigakiGraph,
  type MigakiNode,
  type MigakiNodeKind,
  type MigakiReportStore,
  type MigakiStore,
  type MigakiUsageSnapshot,
} from "./types.js";

export interface MigakiRecorderOptions {
  readonly clock?: MigakiClock | undefined;
  readonly instrumentationVersion?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly runId: string;
  readonly sdkPackageVersion?: string | undefined;
  readonly store: MigakiStore;
}

export interface RecordAgentInput {
  readonly agentName: string;
  readonly input?: unknown | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly spanId?: string | undefined;
}

export interface RecordModelCallInput {
  readonly input?: unknown | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly modelName: string;
  readonly modelParams?: unknown | undefined;
  readonly outputSchema?: unknown | undefined;
  readonly parentSpanId?: string | null | undefined;
  readonly spanId?: string | undefined;
}

export interface RecordToolCallInput {
  readonly args?: unknown | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly toolName: string;
  readonly toolVersion?: string | undefined;
}

export interface RecordHandoffInput {
  readonly fromAgent?: string | undefined;
  readonly input?: unknown | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly parentSpanId?: string | null | undefined;
  readonly spanId?: string | undefined;
  readonly toAgent?: string | undefined;
}

const systemClock: MigakiClock = {
  now() {
    return new Date();
  },
};

export class MigakiRecorder {
  readonly #agentNodeIdsByName = new Map<string, string[]>();
  readonly #clock: MigakiClock;
  readonly #edges: MigakiEdge[] = [];
  readonly #events: MigakiEvent[] = [];
  #eventCounter = 0;
  readonly #graphMetadata: Readonly<Record<string, unknown>>;
  readonly #instrumentationVersion: string;
  #lastNodeId: string | undefined;
  readonly #nodeIdsBySpanId = new Map<string, string>();
  readonly #nodes = new Map<string, MigakiNode>();
  #nodeCounter = 0;
  readonly #openToolNodeIdsByCacheKey = new Map<string, string[]>();
  readonly #pendingWrites: Promise<void>[] = [];
  readonly #runId: string;
  readonly #sdkPackageVersion: string;
  readonly #store: MigakiStore;
  readonly #startedAt: string;

  constructor(options: MigakiRecorderOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#graphMetadata = options.metadata ?? {};
    this.#instrumentationVersion =
      options.instrumentationVersion ??
      MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION;
    this.#runId = options.runId;
    this.#sdkPackageVersion =
      options.sdkPackageVersion ?? OPENAI_AGENTS_SDK_VERSION;
    this.#store = options.store;
    this.#startedAt = this.#timestamp();
  }

  get runId(): string {
    return this.#runId;
  }

  recordRunStarted(input?: unknown): void {
    this.#appendEvent("run.started", {
      metadata: {
        inputHash: input === undefined ? undefined : stableHash(input),
      },
    });
  }

  recordAgentStarted(input: RecordAgentInput): string {
    const existingNodeId =
      input.spanId === undefined
        ? undefined
        : this.#nodeIdsBySpanId.get(input.spanId);

    if (existingNodeId !== undefined) {
      return existingNodeId;
    }

    const nodeId = this.#createNode({
      input: input.input ?? { agentName: input.agentName },
      kind: "agent_step",
      metadata: {
        agentName: input.agentName,
        ...input.metadata,
      },
      ...(input.spanId !== undefined
        ? { requestedId: this.#nodeIdFromExternalId("agent", input.spanId) }
        : {}),
    });

    if (input.spanId !== undefined) {
      this.#nodeIdsBySpanId.set(input.spanId, nodeId);
    }

    const byName = this.#agentNodeIdsByName.get(input.agentName) ?? [];
    byName.push(nodeId);
    this.#agentNodeIdsByName.set(input.agentName, byName);
    const inputHash = this.#nodes.get(nodeId)?.inputHash;

    this.#appendEvent("agent.started", {
      metadata: { agentName: input.agentName },
      nodeId,
      ...(inputHash !== undefined ? { inputHash } : {}),
    });

    return nodeId;
  }

  recordAgentSpanStarted(input: RecordAgentInput): string {
    const existingNodeId =
      input.spanId === undefined
        ? undefined
        : this.#nodeIdsBySpanId.get(input.spanId);

    if (existingNodeId !== undefined) {
      return existingNodeId;
    }

    const latestAgentNodeId = this.#latestOpenAgentNodeId(input.agentName);

    if (latestAgentNodeId !== undefined && input.spanId !== undefined) {
      this.#nodeIdsBySpanId.set(input.spanId, latestAgentNodeId);
      this.#mergeNodeMetadata(latestAgentNodeId, {
        ...input.metadata,
        openaiSpanId: input.spanId,
      });
      return latestAgentNodeId;
    }

    return this.recordAgentStarted(input);
  }

  completeAgentByName(agentName: string, output?: unknown): void {
    const nodeId = this.#latestOpenAgentNodeId(agentName);

    if (nodeId !== undefined) {
      this.#completeNode(nodeId, { output });
    }
  }

  completeSpan(spanId: string, output?: unknown, error?: unknown): void {
    const nodeId = this.#nodeIdsBySpanId.get(spanId);

    if (nodeId !== undefined) {
      this.#completeNode(nodeId, {
        error,
        output,
      });
    }
  }

  recordModelCallStarted(input: RecordModelCallInput): string {
    const existingNodeId =
      input.spanId === undefined
        ? undefined
        : this.#nodeIdsBySpanId.get(input.spanId);

    if (existingNodeId !== undefined) {
      return existingNodeId;
    }

    const cacheKey = createModelCallCacheKey({
      instrumentationVersion: this.#instrumentationVersion,
      modelName: input.modelName,
      modelParams: input.modelParams,
      normalizedInput: input.input ?? null,
      outputSchema: input.outputSchema,
      sdkPackageVersion: this.#sdkPackageVersion,
    });
    const nodeId = this.#createNode({
      input: input.input ?? {
        modelName: input.modelName,
        modelParams: input.modelParams ?? null,
      },
      kind: "model_call",
      metadata: {
        cacheKey,
        modelName: input.modelName,
        modelParams: input.modelParams ?? null,
        outputSchema: input.outputSchema ?? null,
        ...input.metadata,
      },
      ...(this.#nodeIdForParentSpan(input.parentSpanId) !== undefined
        ? { parentNodeId: this.#nodeIdForParentSpan(input.parentSpanId) }
        : {}),
      ...(input.spanId !== undefined
        ? { requestedId: this.#nodeIdFromExternalId("model", input.spanId) }
        : {}),
    });

    if (input.spanId !== undefined) {
      this.#nodeIdsBySpanId.set(input.spanId, nodeId);
    }

    this.#appendEvent("model.call.started", {
      cacheKey,
      inputHash: cacheKey.inputHash,
      metadata: { modelName: input.modelName },
      nodeId,
    });

    return nodeId;
  }

  completeModelCallBySpan(input: {
    readonly error?: unknown;
    readonly input?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly modelName: string;
    readonly modelParams?: unknown;
    readonly output?: unknown;
    readonly outputSchema?: unknown;
    readonly spanId: string;
    readonly usage?: MigakiUsageSnapshot | undefined;
  }): void {
    const existingNodeId = this.#nodeIdsBySpanId.get(input.spanId);
    const nodeId =
      existingNodeId ??
      this.recordModelCallStarted({
        input: input.input,
        modelName: input.modelName,
        modelParams: input.modelParams,
        outputSchema: input.outputSchema,
        spanId: input.spanId,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
    const cacheKey = createModelCallCacheKey({
      instrumentationVersion: this.#instrumentationVersion,
      modelName: input.modelName,
      modelParams: input.modelParams,
      normalizedInput: input.input ?? null,
      outputSchema: input.outputSchema,
      sdkPackageVersion: this.#sdkPackageVersion,
    });

    this.#mergeNodeMetadata(nodeId, {
      cacheKey,
      ...(input.metadata ?? {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
    });
    this.#replaceNodeInputHash(nodeId, cacheKey.inputHash);
    this.#completeNode(nodeId, {
      cacheKey,
      error: input.error,
      eventType: "model.call.completed",
      metadata: { modelName: input.modelName },
      output: input.output,
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
    });
  }

  recordToolCallStarted(input: RecordToolCallInput): string {
    const cacheKey = createToolCallCacheKey({
      instrumentationVersion: this.#instrumentationVersion,
      sdkPackageVersion: this.#sdkPackageVersion,
      toolArgs: input.args ?? null,
      toolName: input.toolName,
      ...(input.toolVersion !== undefined
        ? { toolVersion: input.toolVersion }
        : {}),
    });
    const nodeId = this.#createNode({
      input: input.args ?? null,
      kind: "tool_call",
      metadata: {
        cacheKey,
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? null,
        ...input.metadata,
      },
      ...(this.#lastAgentNodeId() !== undefined
        ? { parentNodeId: this.#lastAgentNodeId() }
        : {}),
    });
    const cacheKeyHash = stableHash(cacheKey);
    const openNodes = this.#openToolNodeIdsByCacheKey.get(cacheKeyHash) ?? [];
    openNodes.push(nodeId);
    this.#openToolNodeIdsByCacheKey.set(cacheKeyHash, openNodes);
    this.#appendEvent("tool.call.started", {
      cacheKey,
      inputHash: cacheKey.inputHash,
      metadata: { toolName: input.toolName },
      nodeId,
    });

    return nodeId;
  }

  completeToolCall(input: {
    readonly args?: unknown;
    readonly error?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly output?: unknown;
    readonly toolName: string;
    readonly toolVersion?: string;
  }): void {
    const cacheKey = createToolCallCacheKey({
      instrumentationVersion: this.#instrumentationVersion,
      sdkPackageVersion: this.#sdkPackageVersion,
      toolArgs: input.args ?? null,
      toolName: input.toolName,
      ...(input.toolVersion !== undefined
        ? { toolVersion: input.toolVersion }
        : {}),
    });
    const nodeId =
      this.#shiftOpenToolNodeId(stableHash(cacheKey)) ??
      this.recordToolCallStarted({
        args: input.args,
        toolName: input.toolName,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.toolVersion !== undefined
          ? { toolVersion: input.toolVersion }
          : {}),
      });

    this.#mergeNodeMetadata(nodeId, {
      cacheKey,
      ...(input.metadata ?? {}),
    });
    this.#completeNode(nodeId, {
      cacheKey,
      error: input.error,
      eventType: "tool.call.completed",
      metadata: { toolName: input.toolName },
      output: input.output,
    });
  }

  recordHandoffStarted(input: RecordHandoffInput): string {
    const existingNodeId =
      input.spanId === undefined
        ? undefined
        : this.#nodeIdsBySpanId.get(input.spanId);

    if (existingNodeId !== undefined) {
      return existingNodeId;
    }

    const handoffName = `${input.fromAgent ?? "unknown"}->${input.toAgent ?? "unknown"}`;
    const nodeId = this.#createNode({
      input: input.input ?? {
        fromAgent: input.fromAgent ?? null,
        toAgent: input.toAgent ?? null,
      },
      kind: "handoff",
      metadata: {
        fromAgent: input.fromAgent ?? null,
        toAgent: input.toAgent ?? null,
        ...input.metadata,
      },
      ...(this.#nodeIdForParentSpan(input.parentSpanId) !== undefined
        ? { parentNodeId: this.#nodeIdForParentSpan(input.parentSpanId) }
        : {}),
      ...(input.spanId !== undefined
        ? { requestedId: this.#nodeIdFromExternalId("handoff", input.spanId) }
        : {}),
    });

    if (input.spanId !== undefined) {
      this.#nodeIdsBySpanId.set(input.spanId, nodeId);
    }

    const inputHash = this.#nodes.get(nodeId)?.inputHash;

    this.#appendEvent("handoff.started", {
      metadata: { handoffName },
      nodeId,
      ...(inputHash !== undefined ? { inputHash } : {}),
    });

    return nodeId;
  }

  completeHandoffBySpan(input: {
    readonly error?: unknown;
    readonly fromAgent?: string;
    readonly output?: unknown;
    readonly spanId: string;
    readonly toAgent?: string;
  }): void {
    const nodeId =
      this.#nodeIdsBySpanId.get(input.spanId) ??
      this.recordHandoffStarted({
        spanId: input.spanId,
        ...(input.fromAgent !== undefined
          ? { fromAgent: input.fromAgent }
          : {}),
        ...(input.toAgent !== undefined ? { toAgent: input.toAgent } : {}),
      });

    this.#completeNode(nodeId, {
      error: input.error,
      eventType: "handoff.completed",
      metadata: {
        fromAgent: input.fromAgent ?? null,
        toAgent: input.toAgent ?? null,
      },
      output: input.output ?? {
        fromAgent: input.fromAgent ?? null,
        toAgent: input.toAgent ?? null,
      },
    });
  }

  async finalizeRunCompleted(output?: unknown): Promise<MigakiGraph> {
    const endedAt = this.#timestamp();

    this.#appendEvent("run.completed", {
      metadata: {
        outputHash: output === undefined ? undefined : stableHash(output),
      },
      status: "ok",
    });

    return this.#writeFinalGraph("ok", endedAt);
  }

  async finalizeRunFailed(error: unknown): Promise<MigakiGraph> {
    const endedAt = this.#timestamp();
    const errorSnapshot = snapshotError(error);

    for (const node of this.#nodes.values()) {
      if (node.endedAt === undefined) {
        this.#nodes.set(node.id, {
          ...node,
          endedAt,
          metadata: {
            ...node.metadata,
            error: errorSnapshot,
          },
          status: "error",
        });
      }
    }

    this.#appendEvent("run.failed", {
      error: errorSnapshot,
      metadata: {},
      status: "error",
    });

    return this.#writeFinalGraph("error", endedAt);
  }

  #appendEvent(
    type: MigakiEventType,
    input: {
      readonly cacheKey?: MigakiCacheKey;
      readonly error?: MigakiErrorSnapshot;
      readonly inputHash?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly nodeId?: string;
      readonly outputHash?: string;
      readonly parentNodeId?: string;
      readonly status?: "error" | "ok";
      readonly usage?: MigakiUsageSnapshot;
    },
  ): void {
    const event: MigakiEvent = {
      eventId: `event-${String(++this.#eventCounter).padStart(6, "0")}`,
      metadata: compactRecord(input.metadata ?? {}),
      runId: this.#runId,
      timestamp: this.#timestamp(),
      type,
      ...(input.cacheKey !== undefined ? { cacheKey: input.cacheKey } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.inputHash !== undefined ? { inputHash: input.inputHash } : {}),
      ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
      ...(input.outputHash !== undefined
        ? { outputHash: input.outputHash }
        : {}),
      ...(input.parentNodeId !== undefined
        ? { parentNodeId: input.parentNodeId }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
    };

    this.#events.push(event);
    this.#pendingWrites.push(this.#store.appendEvent(this.#runId, event));
  }

  #createNode(input: {
    readonly input: unknown;
    readonly kind: MigakiNodeKind;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
    readonly parentNodeId?: string | undefined;
    readonly requestedId?: string | undefined;
  }): string {
    const nodeId = input.requestedId ?? this.#nextNodeId(input.kind);
    const node: MigakiNode = {
      id: nodeId,
      inputHash: stableHash(input.input),
      kind: input.kind,
      metadata: compactRecord(input.metadata ?? {}),
      startedAt: this.#timestamp(),
      status: "ok",
    };

    this.#nodes.set(nodeId, node);

    if (this.#lastNodeId !== undefined && this.#lastNodeId !== nodeId) {
      this.#addEdge(this.#lastNodeId, nodeId, "depends_on");
    }

    if (input.parentNodeId !== undefined && input.parentNodeId !== nodeId) {
      this.#addEdge(input.parentNodeId, nodeId, "calls");
    }

    this.#lastNodeId = nodeId;

    return nodeId;
  }

  #completeNode(
    nodeId: string,
    input: {
      readonly cacheKey?: MigakiCacheKey;
      readonly error?: unknown;
      readonly eventType?: MigakiEventType;
      readonly metadata?: Readonly<Record<string, unknown>> | undefined;
      readonly output?: unknown;
      readonly usage?: MigakiUsageSnapshot | undefined;
    },
  ): void {
    const node = this.#nodes.get(nodeId);

    if (node === undefined || node.endedAt !== undefined) {
      return;
    }

    const errorSnapshot =
      input.error === undefined ? undefined : snapshotError(input.error);
    const outputHash =
      input.output === undefined ? undefined : stableHash(input.output);
    const status = errorSnapshot === undefined ? "ok" : "error";
    const updatedNode: MigakiNode = {
      ...node,
      endedAt: this.#timestamp(),
      metadata: compactRecord({
        ...node.metadata,
        ...(input.cacheKey !== undefined ? { cacheKey: input.cacheKey } : {}),
        ...(input.metadata ?? {}),
        ...(errorSnapshot !== undefined ? { error: errorSnapshot } : {}),
        ...(input.usage !== undefined ? { usage: input.usage } : {}),
      }),
      status,
      ...(outputHash !== undefined ? { outputHash } : {}),
    };

    this.#nodes.set(nodeId, updatedNode);

    if (input.eventType !== undefined) {
      this.#appendEvent(input.eventType, {
        nodeId,
        status,
        ...(input.cacheKey !== undefined ? { cacheKey: input.cacheKey } : {}),
        ...(errorSnapshot !== undefined ? { error: errorSnapshot } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(outputHash !== undefined ? { outputHash } : {}),
        ...(input.usage !== undefined ? { usage: input.usage } : {}),
      });
    }
  }

  async #writeFinalGraph(
    status: "error" | "ok",
    endedAt: string,
  ): Promise<MigakiGraph> {
    await Promise.all(this.#pendingWrites);

    const graph: MigakiGraph = {
      createdAt: this.#startedAt,
      edges: [...this.#edges],
      endedAt,
      metadata: {
        instrumentationVersion: this.#instrumentationVersion,
        sdkPackageVersion: this.#sdkPackageVersion,
        ...this.#graphMetadata,
      },
      nodes: [...this.#nodes.values()],
      runId: this.#runId,
      startedAt: this.#startedAt,
      status,
      version: MIGAKI_GRAPH_VERSION,
    };

    await this.#store.writeGraph(this.#runId, graph);

    if (isReportStore(this.#store)) {
      await this.#store.writeReport(this.#runId, renderMigakiReport(graph));
    }

    return graph;
  }

  #addEdge(from: string, to: string, kind: MigakiEdge["kind"]): void {
    if (
      this.#edges.some(
        (edge) => edge.from === from && edge.to === to && edge.kind === kind,
      )
    ) {
      return;
    }

    this.#edges.push({ from, kind, to });
  }

  #mergeNodeMetadata(
    nodeId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    const node = this.#nodes.get(nodeId);

    if (node === undefined) {
      return;
    }

    this.#nodes.set(nodeId, {
      ...node,
      metadata: compactRecord({
        ...node.metadata,
        ...metadata,
      }),
    });
  }

  #replaceNodeInputHash(nodeId: string, inputHash: string): void {
    const node = this.#nodes.get(nodeId);

    if (node !== undefined) {
      this.#nodes.set(nodeId, { ...node, inputHash });
    }
  }

  #latestOpenAgentNodeId(agentName: string): string | undefined {
    const nodeIds = this.#agentNodeIdsByName.get(agentName) ?? [];

    for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
      const nodeId = nodeIds[index];

      if (
        nodeId !== undefined &&
        this.#nodes.get(nodeId)?.endedAt === undefined
      ) {
        return nodeId;
      }
    }

    return undefined;
  }

  #lastAgentNodeId(): string | undefined {
    for (const nodeId of [...this.#nodes.keys()].reverse()) {
      if (this.#nodes.get(nodeId)?.kind === "agent_step") {
        return nodeId;
      }
    }

    return undefined;
  }

  #nodeIdForParentSpan(
    parentSpanId: string | null | undefined,
  ): string | undefined {
    return parentSpanId === null || parentSpanId === undefined
      ? undefined
      : this.#nodeIdsBySpanId.get(parentSpanId);
  }

  #shiftOpenToolNodeId(cacheKeyHash: string): string | undefined {
    const nodeIds = this.#openToolNodeIdsByCacheKey.get(cacheKeyHash);

    if (nodeIds === undefined) {
      return undefined;
    }

    const nodeId = nodeIds.shift();

    if (nodeIds.length === 0) {
      this.#openToolNodeIdsByCacheKey.delete(cacheKeyHash);
    }

    return nodeId;
  }

  #nextNodeId(kind: MigakiNodeKind): string {
    this.#nodeCounter += 1;
    return `${kind}-${String(this.#nodeCounter).padStart(4, "0")}`;
  }

  #nodeIdFromExternalId(prefix: string, externalId: string): string {
    return `${prefix}-${externalId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  }

  #timestamp(): string {
    return this.#clock.now().toISOString();
  }
}

export function snapshotError(error: unknown): MigakiErrorSnapshot {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return { message: String(error) };
}

export function compactRecord(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const compacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

function isReportStore(store: MigakiStore): store is MigakiReportStore {
  return "writeReport" in store && typeof store.writeReport === "function";
}
