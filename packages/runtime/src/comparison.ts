import { createHash } from "node:crypto";

import type {
  MIRContextBlock,
  MIREdge,
  MIRNode,
  MIRNodeKind,
  MIRPlan,
} from "@migaki/mir";

export const GRAPH_COMPARISON_VERSION = "migaki.graph-comparison.v0";

export type GraphComparisonVersion = typeof GRAPH_COMPARISON_VERSION;
export type MigakiGraph = MIRPlan;
export type ReusableNodeKind = "model_call" | "tool_call";

export type GraphReuseBlockedReasonCode =
  | "cache_key_changed"
  | "dependency_hash_changed"
  | "input_hash_changed"
  | "node_kind_changed"
  | "node_missing_in_previous_graph"
  | "not_reuse_candidate"
  | "runtime_hash_changed";

export interface GraphNodeFingerprint {
  readonly cacheKey?: string;
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly runtimeHash: string;
}

export interface ReusableGraphNode extends GraphNodeFingerprint {
  readonly kind: ReusableNodeKind;
  readonly nodeId: string;
  readonly tokenEstimate: number;
}

export interface GraphReuseBlockedReason {
  readonly code: GraphReuseBlockedReasonCode;
  readonly message: string;
}

export interface NonReusableGraphNode {
  readonly current: GraphNodeFingerprint;
  readonly kind: MIRNodeKind;
  readonly nodeId: string;
  readonly previous: GraphNodeFingerprint | undefined;
  readonly reasons: readonly GraphReuseBlockedReason[];
}

export interface LongestReusablePath {
  readonly length: number;
  readonly nodeIds: readonly string[];
}

export interface GraphComparisonMetrics {
  readonly changedNodes: number;
  readonly estimatedAvoidableModelCalls: number;
  readonly estimatedAvoidableTokens: number;
  readonly estimatedAvoidableToolCalls: number;
  readonly longestReusablePath: LongestReusablePath;
  readonly nonReusableNodesWithReasons: number;
  readonly reusableModelCalls: number;
  readonly reusableTokenCount: number;
  readonly reusableToolCalls: number;
}

export interface MigakiGraphComparison {
  readonly changedNodes: readonly string[];
  readonly currentGraphId: string;
  readonly metrics: GraphComparisonMetrics;
  readonly nonReusableNodesWithReasons: readonly NonReusableGraphNode[];
  readonly previousGraphId: string;
  readonly reusableNodes: readonly ReusableGraphNode[];
  readonly version: GraphComparisonVersion;
}

interface FingerprintContext {
  readonly contextById: ReadonlyMap<string, MIRContextBlock>;
  readonly graph: MigakiGraph;
  readonly incomingEdgesByNodeId: ReadonlyMap<string, readonly MIREdge[]>;
  readonly nodeById: ReadonlyMap<string, MIRNode>;
}

interface NodeComparisonCandidate {
  readonly current: GraphNodeFingerprint;
  readonly currentNode: MIRNode;
  readonly previous: GraphNodeFingerprint | undefined;
  readonly previousNode: MIRNode | undefined;
  readonly reasons: readonly GraphReuseBlockedReason[];
}

export function compareMigakiGraphs(
  previous: MigakiGraph,
  current: MigakiGraph,
): MigakiGraphComparison {
  const previousContext = createFingerprintContext(previous);
  const currentContext = createFingerprintContext(current);
  const candidates = current.nodes
    .map((currentNode) =>
      compareNode(currentNode, previousContext, currentContext),
    )
    .sort((left, right) =>
      compareStrings(left.currentNode.id, right.currentNode.id),
    );
  const reusableNodes = candidates.flatMap((candidate) =>
    toReusableNode(candidate, currentContext),
  );
  const nonReusableNodesWithReasons = candidates.flatMap((candidate) =>
    toNonReusableNode(candidate),
  );
  const changedNodes = candidates.flatMap((candidate) =>
    isChangedCandidate(candidate) ? [candidate.currentNode.id] : [],
  );

  return {
    changedNodes,
    currentGraphId: current.id,
    metrics: createMetrics(current, reusableNodes, nonReusableNodesWithReasons),
    nonReusableNodesWithReasons,
    previousGraphId: previous.id,
    reusableNodes,
    version: GRAPH_COMPARISON_VERSION,
  };
}

export function serializeMigakiGraphComparison(
  comparison: MigakiGraphComparison,
): string {
  return `${JSON.stringify(toStableJsonValue(comparison), null, 2)}\n`;
}

function compareNode(
  currentNode: MIRNode,
  previousContext: FingerprintContext,
  currentContext: FingerprintContext,
): NodeComparisonCandidate {
  const current = fingerprintNode(currentNode, currentContext);
  const previousNode = previousContext.nodeById.get(currentNode.id);
  const previous =
    previousNode === undefined
      ? undefined
      : fingerprintNode(previousNode, previousContext);
  const reasons = blockedReasons({
    current,
    currentNode,
    previous,
    previousNode,
  });

  return {
    current,
    currentNode,
    previous,
    previousNode,
    reasons,
  };
}

function blockedReasons(input: {
  readonly current: GraphNodeFingerprint;
  readonly currentNode: MIRNode;
  readonly previous: GraphNodeFingerprint | undefined;
  readonly previousNode: MIRNode | undefined;
}): readonly GraphReuseBlockedReason[] {
  if (!isReuseCandidate(input.currentNode)) {
    return [reason("not_reuse_candidate")];
  }

  if (input.previousNode === undefined || input.previous === undefined) {
    return [reason("node_missing_in_previous_graph")];
  }

  if (input.previousNode.kind !== input.currentNode.kind) {
    return [reason("node_kind_changed")];
  }

  const reasons: GraphReuseBlockedReason[] = [];

  if (input.previous.cacheKey !== input.current.cacheKey) {
    reasons.push(reason("cache_key_changed"));
  }

  if (input.previous.inputHash !== input.current.inputHash) {
    reasons.push(reason("input_hash_changed"));
  }

  if (input.previous.dependencyHash !== input.current.dependencyHash) {
    reasons.push(reason("dependency_hash_changed"));
  }

  if (input.previous.runtimeHash !== input.current.runtimeHash) {
    reasons.push(reason("runtime_hash_changed"));
  }

  return reasons;
}

function toReusableNode(
  candidate: NodeComparisonCandidate,
  context: FingerprintContext,
): readonly ReusableGraphNode[] {
  if (
    candidate.reasons.length > 0 ||
    !isReuseCandidate(candidate.currentNode)
  ) {
    return [];
  }

  return [
    {
      ...candidate.current,
      kind: candidate.currentNode.kind,
      nodeId: candidate.currentNode.id,
      tokenEstimate: estimateInputTokens(candidate.currentNode, context),
    },
  ];
}

function toNonReusableNode(
  candidate: NodeComparisonCandidate,
): readonly NonReusableGraphNode[] {
  if (candidate.reasons.length === 0) {
    return [];
  }

  return [
    {
      current: candidate.current,
      kind: candidate.currentNode.kind,
      nodeId: candidate.currentNode.id,
      previous: candidate.previous,
      reasons: candidate.reasons,
    },
  ];
}

function isChangedCandidate(candidate: NodeComparisonCandidate): boolean {
  return (
    isReuseCandidate(candidate.currentNode) &&
    candidate.previousNode !== undefined &&
    candidate.reasons.length > 0
  );
}

function createMetrics(
  graph: MigakiGraph,
  reusableNodes: readonly ReusableGraphNode[],
  nonReusableNodesWithReasons: readonly NonReusableGraphNode[],
): GraphComparisonMetrics {
  const reusableModelNodes = reusableNodes.filter(
    (node) => node.kind === "model_call",
  );
  const reusableToolNodes = reusableNodes.filter(
    (node) => node.kind === "tool_call",
  );

  return {
    changedNodes: nonReusableNodesWithReasons.filter((node) =>
      node.reasons.some(
        (nodeReason) =>
          nodeReason.code !== "node_missing_in_previous_graph" &&
          nodeReason.code !== "not_reuse_candidate",
      ),
    ).length,
    estimatedAvoidableModelCalls: reusableModelNodes.length,
    estimatedAvoidableTokens: sumTokens(reusableModelNodes),
    estimatedAvoidableToolCalls: reusableToolNodes.length,
    longestReusablePath: findLongestReusablePath(graph, reusableNodes),
    nonReusableNodesWithReasons: nonReusableNodesWithReasons.length,
    reusableModelCalls: reusableModelNodes.length,
    reusableTokenCount: sumTokens(reusableNodes),
    reusableToolCalls: reusableToolNodes.length,
  };
}

function fingerprintNode(
  node: MIRNode,
  context: FingerprintContext,
): GraphNodeFingerprint {
  const cacheKey = cacheKeyForNode(node);
  const fingerprint: GraphNodeFingerprint = {
    dependencyHash: hashValue(dependencyFingerprint(node, context)),
    inputHash: hashValue(inputFingerprint(node, context)),
    runtimeHash: hashValue(runtimeFingerprint(node)),
    ...(cacheKey !== undefined ? { cacheKey } : {}),
  };

  return fingerprint;
}

function inputFingerprint(
  node: MIRNode,
  context: FingerprintContext,
): Readonly<Record<string, unknown>> {
  const inputContextIds = inputContextIdsForNode(node);

  return {
    context: inputContextIds.map((contextId) =>
      contextFingerprint(context.contextById.get(contextId), contextId),
    ),
    inputContextIds,
    ...(node.kind === "tool_call" && node.tool.inputRef !== undefined
      ? { toolInputRef: node.tool.inputRef }
      : {}),
  };
}

function dependencyFingerprint(
  node: MIRNode,
  context: FingerprintContext,
): Readonly<Record<string, unknown>> {
  const incomingEdges = context.incomingEdgesByNodeId.get(node.id) ?? [];

  return {
    incomingEdges: incomingEdges.map((edge) => {
      const sourceNode = context.nodeById.get(edge.fromNodeId);

      return {
        conditionRef: edge.conditionRef,
        contextIds: edge.contextIds ?? [],
        fromNodeId: edge.fromNodeId,
        id: edge.id,
        kind: edge.kind,
        sourceNodeKind: sourceNode?.kind,
      };
    }),
  };
}

function runtimeFingerprint(node: MIRNode): Readonly<Record<string, unknown>> {
  switch (node.kind) {
    case "approval":
      return {
        approval: node.approval,
        inputContext: node.inputContext,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
      };
    case "branch":
      return {
        branches: node.branches,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
      };
    case "cache_read":
      return {
        cacheKeyRef: node.cacheKeyRef,
        cachePolicy: node.cachePolicy,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        outputContext: node.outputContext,
      };
    case "cache_write":
      return {
        cacheKeyRef: node.cacheKeyRef,
        cachePolicy: node.cachePolicy,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
      };
    case "context_transform":
      return {
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        outputContext: node.outputContext,
        transform: node.transform,
      };
    case "join":
      return {
        inputNodeIds: node.inputNodeIds,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        strategy: node.strategy,
      };
    case "model_call":
      return {
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        model: node.model,
        outputContext: node.outputContext,
        parameters: node.parameters,
        validators: node.validators,
      };
    case "retrieval_call":
      return {
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        queryContext: node.queryContext,
        resultContext: node.resultContext,
        retrieval: node.retrieval,
      };
    case "tool_call":
      return {
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        outputContext: node.outputContext,
        tool: {
          name: node.tool.name,
          requiresApprovalId: node.tool.requiresApprovalId,
          schemaRef: node.tool.schemaRef,
        },
      };
    case "validator":
      return {
        failurePolicy: node.failurePolicy,
        kind: node.kind,
        metadata: runtimeMetadata(node.metadata),
        outputContext: node.outputContext,
        validator: node.validator,
      };
  }
}

function contextFingerprint(
  block: MIRContextBlock | undefined,
  contextId: string,
): Readonly<Record<string, unknown>> {
  if (block === undefined) {
    return {
      id: contextId,
      missing: true,
    };
  }

  return {
    cachePolicy: block.cachePolicy,
    contentHash: block.contentHash,
    contentRef: block.contentRef,
    id: block.id,
    mutability: block.mutability,
    privacyClass: block.privacyClass,
    provenance: block.provenance,
    retentionPolicy: block.retentionPolicy,
    role: block.role,
    tokenEstimate: block.tokenEstimate,
  };
}

function cacheKeyForNode(node: MIRNode): string | undefined {
  const metadataCacheKey = metadataString(node.metadata, "cacheKey");
  const metadataCacheKeyRef = metadataString(node.metadata, "cacheKeyRef");

  if (metadataCacheKey !== undefined) {
    return metadataCacheKey;
  }

  if (metadataCacheKeyRef !== undefined) {
    return metadataCacheKeyRef;
  }

  if (node.kind === "cache_read" || node.kind === "cache_write") {
    return node.cachePolicy?.keyRef ?? node.cacheKeyRef;
  }

  return undefined;
}

function runtimeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const runtime: Record<string, unknown> = {};

  for (const key of Object.keys(metadata).sort(compareStrings)) {
    if (key === "cacheKey" || key === "cacheKeyRef") {
      continue;
    }

    runtime[key] = metadata[key];
  }

  return Object.keys(runtime).length === 0 ? undefined : runtime;
}

function inputContextIdsForNode(node: MIRNode): readonly string[] {
  switch (node.kind) {
    case "approval":
    case "cache_write":
    case "context_transform":
    case "model_call":
    case "tool_call":
    case "validator":
      return node.inputContext ?? [];
    case "retrieval_call":
      return [node.queryContext];
    case "branch":
    case "cache_read":
    case "join":
      return [];
  }
}

function createFingerprintContext(graph: MigakiGraph): FingerprintContext {
  return {
    contextById: new Map(graph.context.map((block) => [block.id, block])),
    graph,
    incomingEdgesByNodeId: indexIncomingEdges(graph.edges),
    nodeById: new Map(graph.nodes.map((node) => [node.id, node])),
  };
}

function indexIncomingEdges(
  edges: readonly MIREdge[],
): ReadonlyMap<string, readonly MIREdge[]> {
  const index = new Map<string, MIREdge[]>();

  for (const edge of edges) {
    const list = index.get(edge.toNodeId) ?? [];
    list.push(edge);
    index.set(edge.toNodeId, list);
  }

  for (const [nodeId, list] of index) {
    index.set(
      nodeId,
      [...list].sort((left, right) => compareStrings(left.id, right.id)),
    );
  }

  return index;
}

function estimateInputTokens(
  node: MIRNode,
  context: FingerprintContext,
): number {
  return inputContextIdsForNode(node).reduce((total, contextId) => {
    const tokenEstimate = context.contextById.get(contextId)?.tokenEstimate;

    return total + (tokenEstimate ?? 0);
  }, 0);
}

function findLongestReusablePath(
  graph: MigakiGraph,
  reusableNodes: readonly ReusableGraphNode[],
): LongestReusablePath {
  const reusableNodeIds = new Set(reusableNodes.map((node) => node.nodeId));

  if (reusableNodeIds.size === 0) {
    return {
      length: 0,
      nodeIds: [],
    };
  }

  const nodeOrder = new Map(
    graph.nodes.map((node, index) => [node.id, index] as const),
  );
  const outgoing = indexReusableOutgoingEdges(graph.edges, reusableNodeIds);
  const memo = new Map<string, readonly string[]>();
  let longest: readonly string[] = [];

  for (const nodeId of reusableNodeIds) {
    const path = longestPathFrom(nodeId, outgoing, memo, new Set(), nodeOrder);

    if (isBetterPath(path, longest)) {
      longest = path;
    }
  }

  return {
    length: longest.length,
    nodeIds: longest,
  };
}

function indexReusableOutgoingEdges(
  edges: readonly MIREdge[],
  reusableNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (
      !reusableNodeIds.has(edge.fromNodeId) ||
      !reusableNodeIds.has(edge.toNodeId)
    ) {
      continue;
    }

    const list = outgoing.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, list);
  }

  return outgoing;
}

function longestPathFrom(
  nodeId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  memo: Map<string, readonly string[]>,
  visiting: Set<string>,
  nodeOrder: ReadonlyMap<string, number>,
): readonly string[] {
  const memoized = memo.get(nodeId);

  if (memoized !== undefined) {
    return memoized;
  }

  if (visiting.has(nodeId)) {
    return [nodeId];
  }

  visiting.add(nodeId);

  const neighbors = [...(outgoing.get(nodeId) ?? [])].sort((left, right) => {
    const leftOrder = nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return compareStrings(left, right);
  });
  let best: readonly string[] = [nodeId];

  for (const neighbor of neighbors) {
    const candidate = [
      nodeId,
      ...longestPathFrom(neighbor, outgoing, memo, visiting, nodeOrder),
    ];

    if (isBetterPath(candidate, best)) {
      best = candidate;
    }
  }

  visiting.delete(nodeId);
  memo.set(nodeId, best);

  return best;
}

function isBetterPath(
  candidate: readonly string[],
  incumbent: readonly string[],
): boolean {
  if (candidate.length !== incumbent.length) {
    return candidate.length > incumbent.length;
  }

  return candidate.join("\u0000") < incumbent.join("\u0000");
}

function sumTokens(nodes: readonly ReusableGraphNode[]): number {
  return nodes.reduce((total, node) => total + node.tokenEstimate, 0);
}

function isReuseCandidate(
  node: MIRNode,
): node is Extract<MIRNode, { readonly kind: ReusableNodeKind }> {
  return node.kind === "model_call" || node.kind === "tool_call";
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];

  return typeof value === "string" ? value : undefined;
}

function reason(code: GraphReuseBlockedReasonCode): GraphReuseBlockedReason {
  switch (code) {
    case "cache_key_changed":
      return {
        code,
        message: "The exact cache key changed between graph runs.",
      };
    case "dependency_hash_changed":
      return {
        code,
        message:
          "The exact upstream dependency hash changed between graph runs.",
      };
    case "input_hash_changed":
      return {
        code,
        message: "The exact input context hash changed between graph runs.",
      };
    case "node_kind_changed":
      return {
        code,
        message: "The node kind changed between graph runs.",
      };
    case "node_missing_in_previous_graph":
      return {
        code,
        message: "No node with the same id exists in the previous graph.",
      };
    case "not_reuse_candidate":
      return {
        code,
        message:
          "Only exact model_call and tool_call nodes are reuse candidates.",
      };
    case "runtime_hash_changed":
      return {
        code,
        message: "The exact runtime request hash changed between graph runs.",
      };
  }
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
