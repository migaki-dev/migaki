import type { MIRNode, MIRPlan } from "@migaki/mir";

import {
  PROVIDER_CONTRACT_VERSION,
  type ExecutionBackend,
  type ExecutionOutput,
  type ExecutionResult,
  type ExecutionUsage,
  type LoweredExecutionPlan,
  type LoweredExecutionStep,
  type ProviderCapabilities,
  type ProviderExecutionError,
  type ProviderWarning,
} from "./contracts.js";
import { lookupProviderCapabilities } from "./fixtures.js";

export const MOCK_BACKEND_VERSION = "migaki.mock-backend.v0";

export type MockBackendVersion = typeof MOCK_BACKEND_VERSION;

export interface MockBackendFixture {
  readonly responses: readonly MockExecutionResponse[];
}

export interface MockExecutionResponse {
  readonly contextId?: string;
  readonly error?: ProviderExecutionError;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly nodeId: string;
  readonly outputRef?: string;
  readonly usage?: ExecutionUsage;
  readonly validation?: MockValidatorOutcome;
}

export interface MockValidatorOutcome {
  readonly score?: number;
  readonly status: "failed" | "passed" | "skipped";
  readonly targetRef?: string;
  readonly validatorId: string;
}

export interface MockLoweredExecutionStep extends LoweredExecutionStep {
  readonly requestRef: string;
}

export interface MockLoweredExecutionPlan extends LoweredExecutionPlan {
  readonly metadata: {
    readonly mockBackendVersion: MockBackendVersion;
  };
  readonly steps: readonly MockLoweredExecutionStep[];
}

export interface MockExecutionLogEntry {
  readonly completedAt: string;
  readonly error?: ProviderExecutionError;
  readonly nodeId: string;
  readonly outputRef?: string;
  readonly startedAt: string;
  readonly status: "failed" | "succeeded";
  readonly stepId: string;
  readonly usage?: ExecutionUsage;
  readonly validation?: MockValidatorOutcome;
}

export interface MockExecutionResult extends ExecutionResult {
  readonly logs: readonly MockExecutionLogEntry[];
  readonly validatorResults: readonly MockValidatorOutcome[];
}

export interface MockExecutionBackendOptions {
  readonly backendId?: string;
  readonly fixture?: MockBackendFixture;
  readonly startedAt?: string;
}

export type MockExecutionBackend = ExecutionBackend<
  MockLoweredExecutionPlan,
  MockExecutionResult
>;

const defaultBackendId = "mock-backend";
const defaultStartedAt = "2026-01-01T00:00:00.000Z";

export function createMockExecutionBackend(
  options: MockExecutionBackendOptions = {},
): MockExecutionBackend {
  const backendId = options.backendId ?? defaultBackendId;
  const fixture = options.fixture ?? { responses: [] };
  const startedAt = options.startedAt ?? defaultStartedAt;
  const capabilities = getMockCapabilities();

  return {
    backendKind: "mock",
    capabilities,
    id: backendId,
    provider: "mock",
    async lower(plan: MIRPlan): Promise<MockLoweredExecutionPlan> {
      return lowerMockPlan(plan, backendId);
    },
    async execute(
      plan: MockLoweredExecutionPlan,
    ): Promise<MockExecutionResult> {
      return executeMockPlan(plan, fixture, startedAt);
    },
  };
}

function lowerMockPlan(
  plan: MIRPlan,
  backendId: string,
): MockLoweredExecutionPlan {
  return {
    assumptions: [
      {
        capability: "structured_outputs",
        description: "Mock backend returns deterministic fixture responses.",
      },
    ],
    backendId,
    id: `mock-lowered-${plan.id}`,
    metadata: {
      mockBackendVersion: MOCK_BACKEND_VERSION,
    },
    provider: "mock",
    sourcePlanId: plan.id,
    steps: plan.nodes.map((node, index) => lowerNode(node, index + 1)),
    version: PROVIDER_CONTRACT_VERSION,
    warnings: createProviderConstraintWarnings(plan),
  };
}

function executeMockPlan(
  plan: MockLoweredExecutionPlan,
  fixture: MockBackendFixture,
  startedAt: string,
): MockExecutionResult {
  const responsesByNode = indexResponses(fixture.responses);
  const outputs: ExecutionOutput[] = [];
  const logs: MockExecutionLogEntry[] = [];
  const validatorResults: MockValidatorOutcome[] = [];
  const usage = createUsageAccumulator();
  let elapsedMs = 0;

  for (const step of plan.steps) {
    const response = responsesByNode.get(step.sourceNodeId) ?? {
      nodeId: step.sourceNodeId,
    };
    const stepUsage = response.usage;
    const latencyMs = stepUsage?.latencyMs ?? 0;
    const stepStartedAt = addMilliseconds(startedAt, elapsedMs);

    elapsedMs += latencyMs;
    addUsage(usage, stepUsage);

    const stepCompletedAt = addMilliseconds(startedAt, elapsedMs);

    if (response.error !== undefined) {
      logs.push({
        completedAt: stepCompletedAt,
        error: response.error,
        nodeId: step.sourceNodeId,
        startedAt: stepStartedAt,
        status: "failed",
        stepId: step.id,
        ...(stepUsage !== undefined ? { usage: stepUsage } : {}),
        ...(response.validation !== undefined
          ? { validation: response.validation }
          : {}),
      });

      return createResult({
        error: response.error,
        logs,
        outputs,
        plan,
        status: outputs.length > 0 ? "partial" : "failed",
        usage,
        validatorResults,
      });
    }

    if (response.validation !== undefined) {
      validatorResults.push(response.validation);
    }

    const outputRef = response.outputRef ?? defaultOutputRef(plan, step);
    const output = createOutput(step, outputRef, response);

    outputs.push(output);
    logs.push({
      completedAt: stepCompletedAt,
      nodeId: step.sourceNodeId,
      outputRef,
      startedAt: stepStartedAt,
      status: "succeeded",
      stepId: step.id,
      ...(stepUsage !== undefined ? { usage: stepUsage } : {}),
      ...(response.validation !== undefined
        ? { validation: response.validation }
        : {}),
    });
  }

  return createResult({
    logs,
    outputs,
    plan,
    status: "succeeded",
    usage,
    validatorResults,
  });
}

function lowerNode(node: MIRNode, index: number): MockLoweredExecutionStep {
  const inputContext = nodeInputContext(node);
  const outputContext = nodeOutputContext(node);

  return {
    id: `mock-step-${String(index).padStart(3, "0")}-${node.id}`,
    kind: lowerStepKind(node),
    requestRef: `mock://requests/${node.id}`,
    sourceNodeId: node.id,
    ...(inputContext !== undefined ? { inputContext } : {}),
    ...(outputContext !== undefined ? { outputContext } : {}),
  };
}

function lowerStepKind(node: MIRNode): LoweredExecutionStep["kind"] {
  switch (node.kind) {
    case "approval":
      return "approval";
    case "branch":
      return "branch";
    case "cache_read":
    case "cache_write":
      return "cache";
    case "context_transform":
      return "context_transform";
    case "join":
      return "join";
    case "model_call":
      return "model";
    case "retrieval_call":
      return "retrieval";
    case "tool_call":
      return "tool";
    case "validator":
      return "validator";
  }
}

function nodeInputContext(node: MIRNode): readonly string[] | undefined {
  switch (node.kind) {
    case "approval":
    case "cache_write":
    case "context_transform":
    case "model_call":
    case "tool_call":
    case "validator":
      return node.inputContext;
    case "retrieval_call":
      return [node.queryContext];
    case "branch":
    case "cache_read":
    case "join":
      return undefined;
  }
}

function nodeOutputContext(node: MIRNode): string | undefined {
  switch (node.kind) {
    case "cache_read":
    case "context_transform":
    case "model_call":
    case "tool_call":
    case "validator":
      return node.outputContext;
    case "retrieval_call":
      return node.resultContext;
    case "approval":
    case "branch":
    case "cache_write":
    case "join":
      return undefined;
  }
}

function createProviderConstraintWarnings(
  plan: MIRPlan,
): readonly ProviderWarning[] {
  if (plan.constraints.deniedProviders?.includes("mock") === true) {
    return [
      {
        assumption: "Plan constraints deny the mock provider.",
        code: "unsupported_capability",
        message: "Mock provider is denied by plan constraints.",
        severity: "error",
      },
    ];
  }

  if (
    plan.constraints.allowedProviders !== undefined &&
    !plan.constraints.allowedProviders.includes("mock")
  ) {
    return [
      {
        assumption: "Plan constraints do not allow the mock provider.",
        code: "unsupported_capability",
        message: "Mock provider is not allowed by plan constraints.",
        severity: "error",
      },
    ];
  }

  return [];
}

function indexResponses(
  responses: readonly MockExecutionResponse[],
): ReadonlyMap<string, MockExecutionResponse> {
  return new Map(responses.map((response) => [response.nodeId, response]));
}

function createOutput(
  step: MockLoweredExecutionStep,
  outputRef: string,
  response: MockExecutionResponse,
): ExecutionOutput {
  const contextId = response.contextId ?? step.outputContext;
  const metadata = createOutputMetadata(response);

  return {
    nodeId: step.sourceNodeId,
    outputRef,
    ...(contextId !== undefined ? { contextId } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function createOutputMetadata(
  response: MockExecutionResponse,
): Readonly<Record<string, unknown>> | undefined {
  if (response.metadata === undefined && response.validation === undefined) {
    return undefined;
  }

  return {
    ...(response.metadata ?? {}),
    ...(response.validation !== undefined
      ? { validation: response.validation }
      : {}),
  };
}

function createResult(input: {
  readonly error?: ProviderExecutionError;
  readonly logs: readonly MockExecutionLogEntry[];
  readonly outputs: readonly ExecutionOutput[];
  readonly plan: MockLoweredExecutionPlan;
  readonly status: ExecutionResult["status"];
  readonly usage: UsageAccumulator;
  readonly validatorResults: readonly MockValidatorOutcome[];
}): MockExecutionResult {
  return {
    loweredPlanId: input.plan.id,
    logs: input.logs,
    outputs: input.outputs,
    status: input.status,
    validatorResults: input.validatorResults,
    version: PROVIDER_CONTRACT_VERSION,
    warnings: input.plan.warnings,
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(hasUsage(input.usage) ? { usage: buildUsage(input.usage) } : {}),
  };
}

interface UsageAccumulator {
  costUsd: number;
  hasCostUsd: boolean;
  hasInputTokens: boolean;
  hasLatencyMs: boolean;
  hasOutputTokens: boolean;
  inputTokens: number;
  latencyMs: number;
  outputTokens: number;
}

function createUsageAccumulator(): UsageAccumulator {
  return {
    costUsd: 0,
    hasCostUsd: false,
    hasInputTokens: false,
    hasLatencyMs: false,
    hasOutputTokens: false,
    inputTokens: 0,
    latencyMs: 0,
    outputTokens: 0,
  };
}

function addUsage(
  accumulator: UsageAccumulator,
  usage: ExecutionUsage | undefined,
): void {
  if (usage === undefined) {
    return;
  }

  if (usage.costUsd !== undefined) {
    accumulator.costUsd += usage.costUsd;
    accumulator.hasCostUsd = true;
  }

  if (usage.inputTokens !== undefined) {
    accumulator.inputTokens += usage.inputTokens;
    accumulator.hasInputTokens = true;
  }

  if (usage.latencyMs !== undefined) {
    accumulator.latencyMs += usage.latencyMs;
    accumulator.hasLatencyMs = true;
  }

  if (usage.outputTokens !== undefined) {
    accumulator.outputTokens += usage.outputTokens;
    accumulator.hasOutputTokens = true;
  }
}

function hasUsage(accumulator: UsageAccumulator): boolean {
  return (
    accumulator.hasCostUsd ||
    accumulator.hasInputTokens ||
    accumulator.hasLatencyMs ||
    accumulator.hasOutputTokens
  );
}

function buildUsage(accumulator: UsageAccumulator): ExecutionUsage {
  return {
    ...(accumulator.hasCostUsd ? { costUsd: accumulator.costUsd } : {}),
    ...(accumulator.hasInputTokens
      ? { inputTokens: accumulator.inputTokens }
      : {}),
    ...(accumulator.hasLatencyMs ? { latencyMs: accumulator.latencyMs } : {}),
    ...(accumulator.hasOutputTokens
      ? { outputTokens: accumulator.outputTokens }
      : {}),
  };
}

function defaultOutputRef(
  plan: MockLoweredExecutionPlan,
  step: MockLoweredExecutionStep,
): string {
  return `mock://outputs/${plan.id}/${step.sourceNodeId}`;
}

function addMilliseconds(startedAt: string, milliseconds: number): string {
  return new Date(Date.parse(startedAt) + milliseconds).toISOString();
}

function getMockCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("mock");

  if (capabilities === undefined) {
    throw new Error("Mock provider capability fixture is missing.");
  }

  return capabilities;
}
