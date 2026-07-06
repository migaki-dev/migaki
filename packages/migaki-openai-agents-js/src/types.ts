export const MIGAKI_AGENTS_JS_PACKAGE_VERSION = "0.0.0";
export const MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION =
  "migaki.openai-agents-js.instrumentation.v0";
export const MIGAKI_GRAPH_VERSION = "migaki.openai-agents-js.graph.v0";
export const MIGAKI_REPORT_VERSION = "migaki.openai-agents-js.report.v0";
export const OPENAI_AGENTS_SDK_VERSION = "0.12.0";

export type MigakiEventType =
  | "run.started"
  | "agent.started"
  | "model.call.started"
  | "model.call.completed"
  | "tool.call.started"
  | "tool.call.completed"
  | "handoff.started"
  | "handoff.completed"
  | "run.completed"
  | "run.failed";

export interface MigakiCacheKey {
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly name: string;
  readonly op: "model_call" | "tool_call";
  readonly runtimeHash: string;
}

export interface MigakiErrorSnapshot {
  readonly message: string;
  readonly name?: string;
}

export interface MigakiUsageSnapshot {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

interface MigakiEventBase<TType extends MigakiEventType> {
  readonly cacheKey?: MigakiCacheKey;
  readonly error?: MigakiErrorSnapshot;
  readonly eventId: string;
  readonly inputHash?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nodeId?: string;
  readonly outputHash?: string;
  readonly parentNodeId?: string;
  readonly runId: string;
  readonly status?: "error" | "ok";
  readonly timestamp: string;
  readonly type: TType;
  readonly usage?: MigakiUsageSnapshot;
}

export type MigakiEvent =
  | MigakiEventBase<"run.started">
  | MigakiEventBase<"agent.started">
  | MigakiEventBase<"model.call.started">
  | MigakiEventBase<"model.call.completed">
  | MigakiEventBase<"tool.call.started">
  | MigakiEventBase<"tool.call.completed">
  | MigakiEventBase<"handoff.started">
  | MigakiEventBase<"handoff.completed">
  | MigakiEventBase<"run.completed">
  | MigakiEventBase<"run.failed">;

export type MigakiNodeKind =
  | "agent_step"
  | "handoff"
  | "model_call"
  | "tool_call";

export interface MigakiNode {
  readonly endedAt?: string;
  readonly id: string;
  readonly inputHash: string;
  readonly kind: MigakiNodeKind;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly outputHash?: string;
  readonly startedAt: string;
  readonly status: "error" | "ok";
}

export interface MigakiEdge {
  readonly from: string;
  readonly kind: "calls" | "depends_on" | "produces";
  readonly to: string;
}

export interface MigakiGraph {
  readonly createdAt: string;
  readonly edges: readonly MigakiEdge[];
  readonly endedAt?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nodes: readonly MigakiNode[];
  readonly runId: string;
  readonly startedAt: string;
  readonly status: "error" | "ok" | "running";
  readonly version: typeof MIGAKI_GRAPH_VERSION;
}

export interface MigakiStore {
  appendEvent(runId: string, event: MigakiEvent): Promise<void>;
  getCachedOutput?(key: MigakiCacheKey): Promise<unknown | undefined>;
  putCachedOutput?(key: MigakiCacheKey, value: unknown): Promise<void>;
  writeGraph(runId: string, graph: MigakiGraph): Promise<void>;
}

export interface MigakiReportStore extends MigakiStore {
  writeReport(runId: string, report: string): Promise<void>;
}

export interface MigakiArtifactStore extends MigakiReportStore {
  writeArtifact(runId: string, name: string, content: string): Promise<void>;
}

export interface MigakiClock {
  now(): Date;
}
