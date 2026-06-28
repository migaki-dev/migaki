import type { MIRPlan } from "@migaki/mir";
import {
  createMockExecutionBackend,
  type MockExecutionResponse,
  type MockExecutionResult,
  type MockLoweredExecutionPlan,
  type MockValidatorOutcome,
} from "@migaki/providers";
import {
  EVIDENCE_EVENT_VERSION,
  createEvidenceBundle,
  diffMIRPlans,
  type EvidenceBundle,
  type RetryFallbackDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

import { createRagBaselineFixture, type RagDocumentChunk } from "./baseline.js";
import { runRagOptimized } from "./optimized.js";

export const RAG_SOURCE_GROUNDING_VALIDATOR_VERSION =
  "migaki.example.rag-source-grounding-validator.v0";
export const RAG_RETRY_SCENARIO_VERSION =
  "migaki.example.rag-retry-scenario.v0";

export interface RagSourceGroundingValidationInput {
  readonly answer: string;
  readonly chunks: readonly RagDocumentChunk[];
  readonly targetRef?: string;
}

export interface RagSourceGroundingValidationResult extends MockValidatorOutcome {
  readonly citedChunkIds: readonly string[];
  readonly missingCitations: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly version: typeof RAG_SOURCE_GROUNDING_VALIDATOR_VERSION;
}

export interface RagRetryAttempt {
  readonly executedNodeIds: readonly string[];
  readonly result: MockExecutionResult;
  readonly resultStatus: MockExecutionResult["status"];
  readonly validatorResults: readonly MockValidatorOutcome[];
}

export interface RagRetryScenario {
  readonly evidenceBundle: EvidenceBundle;
  readonly firstAttempt: RagRetryAttempt;
  readonly retryAttempt: RagRetryAttempt;
  readonly version: typeof RAG_RETRY_SCENARIO_VERSION;
}

const scenarioRunId = "rag-retry-scenario";
const scenarioCreatedAt = "2026-01-01T00:00:02.000Z";
const scenarioStartedAt = "2026-01-01T00:00:00.000Z";
const unsupportedAnswer =
  "Migaki guarantees identical answers after optimization [migaki-guide#1].";
const retryAnswer =
  "Migaki optimizes graph execution with evidence and replay metadata [migaki-guide#1] [migaki-guide#2].";

export function validateRagSourceGrounding(
  input: RagSourceGroundingValidationInput,
): RagSourceGroundingValidationResult {
  const citationToChunk = new Map(
    input.chunks.map((chunk) => [chunk.citation, chunk]),
  );
  const citations = extractCitations(input.answer);
  const citedChunks = citations.flatMap((citation) => {
    const chunk = citationToChunk.get(citation);

    return chunk === undefined ? [] : [chunk];
  });
  const missingCitations = citations.filter(
    (citation) => !citationToChunk.has(citation),
  );
  const unsupportedClaims = [
    ...(citations.length === 0 ? ["Answer does not cite source chunks."] : []),
    ...missingCitations.map(
      (citation) => `Citation '${citation}' does not exist in the fixture.`,
    ),
    ...claimSupportFailures(input.answer, new Set(citations)),
  ];
  const status = unsupportedClaims.length === 0 ? "passed" : "failed";

  return {
    citedChunkIds: citedChunks.map((chunk) => chunk.id),
    missingCitations,
    score: status === "passed" ? 1 : 0,
    status,
    targetRef: input.targetRef ?? "ctx-answer",
    unsupportedClaims,
    validatorId: "validator-source-grounding",
    version: RAG_SOURCE_GROUNDING_VALIDATOR_VERSION,
  };
}

export async function runRagRetryScenario(
  baselinePlan: MIRPlan,
): Promise<RagRetryScenario> {
  const fixture = createRagBaselineFixture();
  const optimized = await runRagOptimized(baselinePlan, {
    runId: scenarioRunId,
  });
  const firstValidation = validateRagSourceGrounding({
    answer: unsupportedAnswer,
    chunks: fixture.chunks,
  });
  const retryValidation = validateRagSourceGrounding({
    answer: retryAnswer,
    chunks: fixture.chunks,
  });
  const firstAttemptResult = await executeLoweredPlan(optimized.loweredPlan, {
    responses: optimized.trace.responses.map((response) =>
      responseForAttempt(response, firstValidation, "first"),
    ),
  });
  const retryAttemptResult = await executeLoweredPlan(
    createRetryOnlyLoweredPlan(optimized.loweredPlan),
    {
      responses: optimized.trace.responses.flatMap((response) =>
        isRetryNode(response.nodeId)
          ? [responseForAttempt(response, retryValidation, "retry")]
          : [],
      ),
    },
  );
  const retryDecision = optimized.evidenceBundle.retryFallbackDecisions[0];
  const evidenceBundle = createEvidenceBundle({
    createdAt: scenarioCreatedAt,
    events: [
      createValidatorEvent({
        id: "retry-scenario-validator-failed",
        result: firstValidation,
      }),
      ...(retryDecision !== undefined ? [createRetryEvent(retryDecision)] : []),
      createValidatorEvent({
        id: "retry-scenario-validator-passed",
        result: retryValidation,
      }),
    ],
    exportMode: "metadata_only",
    optimizedPlan: {
      planId: optimized.optimizedPlan.id,
      ref: "mir://examples/rag-optimized/retry-scenario",
      version: optimized.optimizedPlan.version,
    },
    originalPlan: {
      planId: optimized.optimizedPlan.id,
      ref: "mir://examples/rag-optimized/retry-scenario",
      version: optimized.optimizedPlan.version,
    },
    passes: [],
    planDiff: diffMIRPlans(optimized.optimizedPlan, optimized.optimizedPlan),
    replay: {
      handles: [],
      mode: "metadata",
    },
    runId: scenarioRunId,
    warnings: [],
  });

  return {
    evidenceBundle,
    firstAttempt: toRetryAttempt(firstAttemptResult),
    retryAttempt: toRetryAttempt(retryAttemptResult),
    version: RAG_RETRY_SCENARIO_VERSION,
  };
}

function extractCitations(answer: string): readonly string[] {
  return [...answer.matchAll(/\[([^\]]+)\]/g)].flatMap((match) => {
    const citation = match[1]?.trim();

    return citation === undefined || citation === "" ? [] : [citation];
  });
}

function claimSupportFailures(
  answer: string,
  citations: ReadonlySet<string>,
): readonly string[] {
  const normalized = answer.toLowerCase();
  const failures: string[] = [];

  if (normalized.includes("guarantees identical answers")) {
    failures.push(
      "Claim 'guarantees identical answers' is not supported by cited chunks.",
    );
  }

  if (
    (normalized.includes("execution graphs") ||
      normalized.includes("graph execution")) &&
    !citations.has("migaki-guide#1")
  ) {
    failures.push("Execution-graph claims must cite migaki-guide#1.");
  }

  if (normalized.includes("evidence") && !citations.has("migaki-guide#2")) {
    failures.push("Evidence claims must cite migaki-guide#2.");
  }

  if (
    normalized.includes("replay") &&
    !citations.has("migaki-guide#2") &&
    !citations.has("migaki-guide#5")
  ) {
    failures.push("Replay claims must cite migaki-guide#2 or migaki-guide#5.");
  }

  if (normalized.includes("cache") && !citations.has("migaki-guide#4")) {
    failures.push("Cache claims must cite migaki-guide#4.");
  }

  return failures;
}

async function executeLoweredPlan(
  loweredPlan: MockLoweredExecutionPlan,
  fixture: { readonly responses: readonly MockExecutionResponse[] },
): Promise<MockExecutionResult> {
  const backend = createMockExecutionBackend({
    backendId: loweredPlan.backendId,
    fixture: { responses: fixture.responses },
    startedAt: scenarioStartedAt,
  });

  return backend.execute(loweredPlan);
}

function responseForAttempt(
  response: MockExecutionResponse,
  validation: MockValidatorOutcome,
  attempt: "first" | "retry",
): MockExecutionResponse {
  if (response.nodeId === "node-synthesize") {
    return {
      ...response,
      outputRef:
        attempt === "first"
          ? "fixture://rag/answer/unsupported"
          : "fixture://rag/answer/retry",
    };
  }

  if (response.nodeId === "node-validate") {
    return {
      ...response,
      outputRef:
        attempt === "first"
          ? "fixture://rag/validation/failed"
          : "fixture://rag/validation/retry",
      validation,
    };
  }

  return response;
}

function createRetryOnlyLoweredPlan(
  loweredPlan: MockLoweredExecutionPlan,
): MockLoweredExecutionPlan {
  return {
    ...loweredPlan,
    id: "mock-lowered-rag-optimized-retry-synthesis",
    steps: loweredPlan.steps.filter((step) => isRetryNode(step.sourceNodeId)),
  };
}

function isRetryNode(nodeId: string): boolean {
  return nodeId === "node-synthesize" || nodeId === "node-validate";
}

function toRetryAttempt(result: MockExecutionResult): RagRetryAttempt {
  return {
    executedNodeIds: result.logs.map((log) => log.nodeId),
    result,
    resultStatus: result.status,
    validatorResults: result.validatorResults,
  };
}

function createValidatorEvent(input: {
  readonly id: string;
  readonly result: MockValidatorOutcome;
}): ValidatorResultEvidenceEvent {
  return {
    id: input.id,
    kind: "validator_result",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "validator",
      runId: scenarioRunId,
    },
    summary: `Source-grounding validator ${input.result.status}.`,
    validatorResult: {
      status: input.result.status,
      ...(input.result.score !== undefined
        ? { score: input.result.score }
        : {}),
      ...(input.result.targetRef !== undefined
        ? { targetRef: input.result.targetRef }
        : {}),
      validatorId: input.result.validatorId,
    },
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createRetryEvent(
  event: RetryFallbackDecisionEvidenceEvent,
): RetryFallbackDecisionEvidenceEvent {
  return {
    id: "retry-scenario-retry-decision",
    kind: "retry_fallback_decision",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    ...(event.refs !== undefined ? { refs: event.refs } : {}),
    retryFallbackDecision: event.retryFallbackDecision,
    source: {
      kind: "runtime",
      nodeId: event.retryFallbackDecision.nodeId,
      runId: scenarioRunId,
    },
    summary:
      "Retry only the synthesis node after source-grounding validation fails.",
    version: EVIDENCE_EVENT_VERSION,
  };
}
