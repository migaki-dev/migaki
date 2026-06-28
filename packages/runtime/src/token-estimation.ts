import type { MIRContextBlock, MIRNode, MIRPlan } from "@migaki/mir";

import { createContextLedger } from "./context-ledger.js";

export const TOKEN_ESTIMATION_VERSION = "migaki.token-estimation.v0";

export type TokenEstimationVersion = typeof TOKEN_ESTIMATION_VERSION;

export const DEFAULT_TOKEN_ESTIMATOR_ID =
  "migaki.token_estimator.deterministic_fixture";
export const DEFAULT_TOKEN_ESTIMATOR_VERSION = "0.0.0";

export const DEFAULT_TOKEN_ESTIMATOR_LIMITATIONS = [
  "Uses a deterministic fixture heuristic, not a provider tokenizer.",
  "Counts ASCII words, numbers, and punctuation tokens from supplied fixture text.",
] as const;

export type TokenEstimateConfidence = "estimated" | "unknown";

export type TokenEstimateSource =
  | "aggregate"
  | "fixture_content"
  | "mir_context_token_estimate"
  | "missing_content";

export interface TokenEstimatorIdentity {
  readonly name: string;
  readonly version: string;
}

export interface TokenEstimateMetadata {
  readonly confidence: TokenEstimateConfidence;
  readonly estimator: TokenEstimatorIdentity;
  readonly limitations: readonly string[];
  readonly source: TokenEstimateSource;
  readonly version: TokenEstimationVersion;
}

export interface TokenEstimatorInput {
  readonly declaredTokenEstimate?: number;
  readonly subjectRef: string;
  readonly text?: string;
}

export interface TokenEstimatorResult {
  readonly metadata: TokenEstimateMetadata;
  readonly subjectRef: string;
  readonly tokens?: number;
  readonly unit: "tokens";
  readonly version: TokenEstimationVersion;
}

export interface TokenEstimator {
  readonly identity: TokenEstimatorIdentity;
  estimate(input: TokenEstimatorInput): TokenEstimatorResult;
}

export type TokenEstimateContentResolver = (
  contentRef: string,
  block: MIRContextBlock,
) => string | undefined;

export type TokenEstimateContentLookup =
  | Readonly<Record<string, string>>
  | ReadonlyMap<string, string>
  | TokenEstimateContentResolver;

export interface TokenEstimateOptions {
  readonly content?: TokenEstimateContentLookup;
  readonly estimator?: TokenEstimator;
}

export interface ContextBlockTokenEstimate extends TokenEstimatorResult {
  readonly contentRef: string;
  readonly contextId: string;
}

export interface ContextTokenEstimateGroup {
  readonly blockEstimates: readonly ContextBlockTokenEstimate[];
  readonly contextIds: readonly string[];
  readonly groupId: string;
  readonly knownTokens: number;
  readonly metadata: TokenEstimateMetadata;
  readonly subjectRef: string;
  readonly tokens?: number;
  readonly unit: "tokens";
  readonly unknownContextIds: readonly string[];
  readonly version: TokenEstimationVersion;
}

export interface EstimateContextGroupTokensInput extends TokenEstimateOptions {
  readonly blocks: readonly MIRContextBlock[];
  readonly groupId: string;
  readonly missingContextIds?: readonly string[];
  readonly subjectRef?: string;
}

export interface PlanTokenEstimate {
  readonly context: ContextTokenEstimateGroup;
  readonly metadata: TokenEstimateMetadata;
  readonly nodeInputs: readonly ContextTokenEstimateGroup[];
  readonly planId: string;
  readonly subjectRef: string;
  readonly tokens?: number;
  readonly unit: "tokens";
  readonly version: TokenEstimationVersion;
}

export interface PlanTokenEstimateDelta {
  readonly afterPlanId: string;
  readonly afterTokens?: number;
  readonly beforePlanId: string;
  readonly beforeTokens?: number;
  readonly knownTokenDelta: number;
  readonly metadata: TokenEstimateMetadata;
  readonly tokenDelta?: number;
  readonly unit: "tokens";
  readonly version: TokenEstimationVersion;
}

const defaultTokenEstimatorIdentity: TokenEstimatorIdentity = {
  name: DEFAULT_TOKEN_ESTIMATOR_ID,
  version: DEFAULT_TOKEN_ESTIMATOR_VERSION,
};

const mirEstimateLimitations = [
  "Uses the mIR context tokenEstimate as an upstream estimate.",
  "Does not claim provider-exact tokenization.",
] as const;

const missingContentLimitations = [
  "No fixture content or usable declared token estimate was available.",
  "Totals that include this estimate are marked unknown.",
] as const;

const aggregateLimitations = [
  "Aggregates metadata-only token estimates without including raw fixture content.",
  "Aggregate totals are unknown when any referenced context estimate is unknown.",
] as const;

const deltaLimitations = [
  "Compares aggregate estimates and does not claim provider-exact token accounting.",
] as const;

export const deterministicTokenEstimator = {
  identity: defaultTokenEstimatorIdentity,
  estimate(input: TokenEstimatorInput): TokenEstimatorResult {
    if (input.text !== undefined) {
      return createEstimatorResult({
        confidence: "estimated",
        estimator: defaultTokenEstimatorIdentity,
        limitations: DEFAULT_TOKEN_ESTIMATOR_LIMITATIONS,
        source: "fixture_content",
        subjectRef: input.subjectRef,
        tokens: estimateDeterministicTokens(input.text),
      });
    }

    if (isUsableTokenEstimate(input.declaredTokenEstimate)) {
      return createEstimatorResult({
        confidence: "estimated",
        estimator: defaultTokenEstimatorIdentity,
        limitations: mirEstimateLimitations,
        source: "mir_context_token_estimate",
        subjectRef: input.subjectRef,
        tokens: input.declaredTokenEstimate,
      });
    }

    return createEstimatorResult({
      confidence: "unknown",
      estimator: defaultTokenEstimatorIdentity,
      limitations: missingContentLimitations,
      source: "missing_content",
      subjectRef: input.subjectRef,
    });
  },
} satisfies TokenEstimator;

export function createDeterministicTokenEstimator(): TokenEstimator {
  return deterministicTokenEstimator;
}

export function estimateDeterministicTokens(text: string): number {
  const trimmed = text.trim();

  if (trimmed === "") {
    return 0;
  }

  return trimmed.match(/[A-Za-z0-9]+|[^\sA-Za-z0-9]/g)?.length ?? 0;
}

export function estimateContextBlockTokens(
  block: MIRContextBlock,
  options: TokenEstimateOptions = {},
): ContextBlockTokenEstimate {
  const estimator = options.estimator ?? deterministicTokenEstimator;
  const subjectRef = contextPath(block.id);
  const text = resolveContent(options.content, block);
  const input: TokenEstimatorInput = {
    subjectRef,
    ...(block.tokenEstimate !== undefined
      ? { declaredTokenEstimate: block.tokenEstimate }
      : {}),
    ...(text !== undefined ? { text } : {}),
  };
  const result = estimator.estimate(input);
  const estimate: ContextBlockTokenEstimate = {
    contentRef: block.contentRef,
    contextId: block.id,
    metadata: result.metadata,
    subjectRef: result.subjectRef,
    unit: result.unit,
    version: result.version,
    ...(result.tokens !== undefined ? { tokens: result.tokens } : {}),
  };

  return estimate;
}

export function estimateContextGroupTokens(
  input: EstimateContextGroupTokensInput,
): ContextTokenEstimateGroup {
  const estimator = input.estimator ?? deterministicTokenEstimator;
  const blockEstimates = input.blocks.map((block) =>
    estimateContextBlockTokens(block, {
      ...(input.content !== undefined ? { content: input.content } : {}),
      estimator,
    }),
  );
  const missingContextIds = input.missingContextIds ?? [];
  const unknownContextIds = [
    ...blockEstimates
      .filter((estimate) => estimate.tokens === undefined)
      .map((estimate) => estimate.contextId),
    ...missingContextIds,
  ];
  const knownTokens = blockEstimates.reduce(
    (total, estimate) => total + (estimate.tokens ?? 0),
    0,
  );
  const metadata = createAggregateMetadata({
    confidence: unknownContextIds.length === 0 ? "estimated" : "unknown",
    estimator: estimator.identity,
    inputMetadata: blockEstimates.map((estimate) => estimate.metadata),
    limitations: aggregateLimitations,
    source: "aggregate",
  });
  const group: ContextTokenEstimateGroup = {
    blockEstimates,
    contextIds: [
      ...blockEstimates.map((estimate) => estimate.contextId),
      ...missingContextIds,
    ],
    groupId: input.groupId,
    knownTokens,
    metadata,
    subjectRef: input.subjectRef ?? `token-group://${input.groupId}`,
    unit: "tokens",
    unknownContextIds,
    version: TOKEN_ESTIMATION_VERSION,
    ...(unknownContextIds.length === 0 ? { tokens: knownTokens } : {}),
  };

  return group;
}

export function estimatePlanTokens(
  plan: MIRPlan,
  options: TokenEstimateOptions = {},
): PlanTokenEstimate {
  const estimator = options.estimator ?? deterministicTokenEstimator;
  const contextGroup = estimateContextGroupTokens({
    blocks: createContextLedger(plan).all(),
    ...(options.content !== undefined ? { content: options.content } : {}),
    estimator,
    groupId: "plan.context",
    subjectRef: "$.context",
  });
  const contextById = new Map(plan.context.map((block) => [block.id, block]));
  const nodeInputs = plan.nodes.flatMap((node) =>
    createNodeInputEstimate(node, contextById, {
      ...(options.content !== undefined ? { content: options.content } : {}),
      estimator,
    }),
  );
  const estimate: PlanTokenEstimate = {
    context: contextGroup,
    metadata: createAggregateMetadata({
      confidence: contextGroup.metadata.confidence,
      estimator: estimator.identity,
      inputMetadata: [contextGroup.metadata],
      limitations: aggregateLimitations,
      source: "aggregate",
    }),
    nodeInputs,
    planId: plan.id,
    subjectRef: planPath(plan.id),
    unit: "tokens",
    version: TOKEN_ESTIMATION_VERSION,
    ...(contextGroup.tokens !== undefined
      ? { tokens: contextGroup.tokens }
      : {}),
  };

  return estimate;
}

export function diffPlanTokenEstimates(
  before: PlanTokenEstimate,
  after: PlanTokenEstimate,
): PlanTokenEstimateDelta {
  const hasCompleteDelta =
    before.tokens !== undefined && after.tokens !== undefined;
  const metadata = createAggregateMetadata({
    confidence: hasCompleteDelta ? "estimated" : "unknown",
    estimator: aggregateEstimatorIdentity([before.metadata, after.metadata]),
    inputMetadata: [before.metadata, after.metadata],
    limitations: deltaLimitations,
    source: "aggregate",
  });
  const delta: PlanTokenEstimateDelta = {
    afterPlanId: after.planId,
    beforePlanId: before.planId,
    knownTokenDelta: after.context.knownTokens - before.context.knownTokens,
    metadata,
    unit: "tokens",
    version: TOKEN_ESTIMATION_VERSION,
    ...(after.tokens !== undefined ? { afterTokens: after.tokens } : {}),
    ...(before.tokens !== undefined ? { beforeTokens: before.tokens } : {}),
    ...(hasCompleteDelta ? { tokenDelta: after.tokens - before.tokens } : {}),
  };

  return delta;
}

function createNodeInputEstimate(
  node: MIRNode,
  contextById: ReadonlyMap<string, MIRContextBlock>,
  options: Required<Pick<TokenEstimateOptions, "estimator">> &
    Pick<TokenEstimateOptions, "content">,
): readonly ContextTokenEstimateGroup[] {
  if (node.inputContext === undefined || node.inputContext.length === 0) {
    return [];
  }

  const blocks: MIRContextBlock[] = [];
  const missingContextIds: string[] = [];

  for (const contextId of node.inputContext) {
    const block = contextById.get(contextId);

    if (block === undefined) {
      missingContextIds.push(contextId);
      continue;
    }

    blocks.push(block);
  }

  return [
    estimateContextGroupTokens({
      blocks,
      ...(options.content !== undefined ? { content: options.content } : {}),
      estimator: options.estimator,
      groupId: `${node.id}.input_context`,
      missingContextIds,
      subjectRef: `$.nodes[?(@.id==${JSON.stringify(node.id)})].inputContext`,
    }),
  ];
}

function createEstimatorResult(input: {
  readonly confidence: TokenEstimateConfidence;
  readonly estimator: TokenEstimatorIdentity;
  readonly limitations: readonly string[];
  readonly source: TokenEstimateSource;
  readonly subjectRef: string;
  readonly tokens?: number;
}): TokenEstimatorResult {
  const result: TokenEstimatorResult = {
    metadata: createMetadata({
      confidence: input.confidence,
      estimator: input.estimator,
      limitations: input.limitations,
      source: input.source,
    }),
    subjectRef: input.subjectRef,
    unit: "tokens",
    version: TOKEN_ESTIMATION_VERSION,
    ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
  };

  return result;
}

function createMetadata(input: {
  readonly confidence: TokenEstimateConfidence;
  readonly estimator: TokenEstimatorIdentity;
  readonly limitations: readonly string[];
  readonly source: TokenEstimateSource;
}): TokenEstimateMetadata {
  return {
    confidence: input.confidence,
    estimator: cloneEstimatorIdentity(input.estimator),
    limitations: [...input.limitations],
    source: input.source,
    version: TOKEN_ESTIMATION_VERSION,
  };
}

function createAggregateMetadata(input: {
  readonly confidence: TokenEstimateConfidence;
  readonly estimator: TokenEstimatorIdentity;
  readonly inputMetadata: readonly TokenEstimateMetadata[];
  readonly limitations: readonly string[];
  readonly source: TokenEstimateSource;
}): TokenEstimateMetadata {
  return createMetadata({
    confidence: input.confidence,
    estimator: input.estimator,
    limitations: uniqueLimitations([
      ...input.inputMetadata.flatMap((metadata) => metadata.limitations),
      ...input.limitations,
    ]),
    source: input.source,
  });
}

function aggregateEstimatorIdentity(
  metadata: readonly TokenEstimateMetadata[],
): TokenEstimatorIdentity {
  const first = metadata[0]?.estimator ?? defaultTokenEstimatorIdentity;

  for (const item of metadata) {
    if (
      item.estimator.name !== first.name ||
      item.estimator.version !== first.version
    ) {
      return {
        name: "mixed",
        version: "multiple",
      };
    }
  }

  return first;
}

function cloneEstimatorIdentity(
  identity: TokenEstimatorIdentity,
): TokenEstimatorIdentity {
  return {
    name: identity.name,
    version: identity.version,
  };
}

function uniqueLimitations(limitations: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const limitation of limitations) {
    if (seen.has(limitation)) {
      continue;
    }

    seen.add(limitation);
    unique.push(limitation);
  }

  return unique;
}

function resolveContent(
  lookup: TokenEstimateContentLookup | undefined,
  block: MIRContextBlock,
): string | undefined {
  if (lookup === undefined) {
    return undefined;
  }

  if (typeof lookup === "function") {
    return lookup(block.contentRef, block);
  }

  if (isMapLike(lookup)) {
    return lookup.get(block.contentRef);
  }

  return lookup[block.contentRef];
}

function isMapLike(
  lookup: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
): lookup is ReadonlyMap<string, string> {
  const candidate = lookup as { readonly get?: unknown };

  return typeof candidate.get === "function";
}

function isUsableTokenEstimate(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function contextPath(id: string): string {
  return `$.context[?(@.id==${JSON.stringify(id)})]`;
}

function planPath(id: string): string {
  return `$.plan[?(@.id==${JSON.stringify(id)})]`;
}
