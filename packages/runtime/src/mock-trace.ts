import type { MIRPlan } from "@migaki/mir";
import {
  MOCK_BACKEND_VERSION,
  PROVIDER_CONTRACT_VERSION,
  createMockExecutionBackend,
  type ExecutionOutput,
  type ExecutionResult,
  type ExecutionUsage,
  type LoweredExecutionStep,
  type MockBackendFixture,
  type MockExecutionLogEntry,
  type MockExecutionResponse,
  type MockExecutionResult,
  type MockLoweredExecutionPlan,
  type MockLoweredExecutionStep,
  type MockValidatorOutcome,
  type ProviderExecutionError,
  type ProviderWarning,
} from "@migaki/providers";

import type {
  EvidenceBundleReplayHandle,
  EvidenceBundleRedactionRecord,
} from "./evidence-bundle.js";

export const MOCK_TRACE_ARTIFACT_VERSION = "migaki.trace-artifact.v0";

export type MockTraceArtifactVersion = typeof MOCK_TRACE_ARTIFACT_VERSION;

export interface MockExecutionTracePlanRef {
  readonly hash?: string;
  readonly mediaType?: string;
  readonly planId: string;
  readonly ref?: string;
  readonly version: string;
}

export interface MockExecutionTraceBackend {
  readonly contractVersion: typeof PROVIDER_CONTRACT_VERSION;
  readonly id: string;
  readonly kind: "mock";
  readonly mockBackendVersion: typeof MOCK_BACKEND_VERSION;
  readonly provider: "mock";
}

export interface MockExecutionTraceStep {
  readonly completedAt: string;
  readonly error?: ProviderExecutionError;
  readonly id: string;
  readonly inputContext?: readonly string[];
  readonly kind: LoweredExecutionStep["kind"];
  readonly nodeId: string;
  readonly outputContext?: string;
  readonly outputRef?: string;
  readonly requestRef: string;
  readonly sourceNodeId: string;
  readonly startedAt: string;
  readonly status: MockExecutionLogEntry["status"];
  readonly usage?: ExecutionUsage;
  readonly validation?: MockValidatorOutcome;
}

export interface MockExecutionTraceResultSnapshot {
  readonly error?: ProviderExecutionError;
  readonly loweredPlanId: string;
  readonly outputs: readonly ExecutionOutput[];
  readonly status: ExecutionResult["status"];
  readonly usage?: ExecutionUsage;
  readonly version: typeof PROVIDER_CONTRACT_VERSION;
  readonly warnings: readonly ProviderWarning[];
}

export interface MockExecutionTraceTiming {
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly startedAt?: string;
}

export interface MockExecutionTraceArtifact {
  readonly artifactId: string;
  readonly backend: MockExecutionTraceBackend;
  readonly createdAt: string;
  readonly estimates?: ExecutionUsage;
  readonly evidenceBundleRef?: EvidenceBundleReplayHandle;
  readonly plan: MockExecutionTracePlanRef;
  readonly redactions: readonly EvidenceBundleRedactionRecord[];
  readonly responses: readonly MockExecutionResponse[];
  readonly result: MockExecutionTraceResultSnapshot;
  readonly steps: readonly MockExecutionTraceStep[];
  readonly timing: MockExecutionTraceTiming;
  readonly traceId: string;
  readonly validatorResults: readonly MockValidatorOutcome[];
  readonly version: MockTraceArtifactVersion;
}

export interface CaptureMockExecutionTraceInput {
  readonly artifactId: string;
  readonly createdAt: string;
  readonly estimates?: ExecutionUsage;
  readonly evidenceBundleRef?: EvidenceBundleReplayHandle;
  readonly fixture: MockBackendFixture;
  readonly loweredPlan: MockLoweredExecutionPlan;
  readonly plan: MIRPlan;
  readonly planRef?: string;
  readonly redactions?: readonly EvidenceBundleRedactionRecord[];
  readonly result: MockExecutionResult;
  readonly traceId: string;
}

export type MockExecutionTraceValidationErrorCode =
  | "invalid_json"
  | "invalid_type"
  | "missing_required"
  | "unknown_version";

export interface MockExecutionTraceValidationError {
  readonly code: MockExecutionTraceValidationErrorCode;
  readonly message: string;
  readonly path: string;
}

export type MockExecutionTraceValidationResult =
  | {
      readonly errors: readonly [];
      readonly success: true;
      readonly trace: MockExecutionTraceArtifact;
    }
  | {
      readonly errors: readonly MockExecutionTraceValidationError[];
      readonly success: false;
    };

export class MockExecutionTraceArtifactValidationFailure extends Error {
  readonly errors: readonly MockExecutionTraceValidationError[];

  constructor(errors: readonly MockExecutionTraceValidationError[]) {
    super("Invalid mock execution trace artifact.");
    this.name = "MockExecutionTraceArtifactValidationFailure";
    this.errors = errors;
  }
}

export interface MockExecutionTraceReplayResult {
  readonly mismatches: readonly string[];
  readonly result: MockExecutionResult;
  readonly status: "matched" | "mismatched";
  readonly traceId: string;
}

export function captureMockExecutionTrace(
  input: CaptureMockExecutionTraceInput,
): MockExecutionTraceArtifact {
  const stepsById = new Map(
    input.loweredPlan.steps.map((step) => [step.id, step]),
  );
  const steps = input.result.logs.map((log) => {
    const step = stepsById.get(log.stepId);

    if (step === undefined) {
      throw new Error(`Missing lowered step for log entry ${log.stepId}.`);
    }

    return createTraceStep(step, log);
  });

  return {
    artifactId: input.artifactId,
    backend: {
      contractVersion: PROVIDER_CONTRACT_VERSION,
      id: input.loweredPlan.backendId,
      kind: "mock",
      mockBackendVersion: input.loweredPlan.metadata.mockBackendVersion,
      provider: "mock",
    },
    createdAt: input.createdAt,
    ...(input.estimates !== undefined ? { estimates: input.estimates } : {}),
    ...(input.evidenceBundleRef !== undefined
      ? { evidenceBundleRef: input.evidenceBundleRef }
      : {}),
    plan: {
      planId: input.plan.id,
      ...(input.planRef !== undefined ? { ref: input.planRef } : {}),
      version: input.plan.version,
    },
    redactions: input.redactions ?? [],
    responses: input.fixture.responses,
    result: {
      loweredPlanId: input.result.loweredPlanId,
      outputs: input.result.outputs,
      status: input.result.status,
      version: input.result.version,
      warnings: input.result.warnings,
      ...(input.result.error !== undefined
        ? { error: input.result.error }
        : {}),
      ...(input.result.usage !== undefined
        ? { usage: input.result.usage }
        : {}),
    },
    steps,
    timing: createTraceTiming(input.result),
    traceId: input.traceId,
    validatorResults: input.result.validatorResults,
    version: MOCK_TRACE_ARTIFACT_VERSION,
  };
}

export function serializeMockExecutionTraceArtifact(
  trace: MockExecutionTraceArtifact,
): string {
  return JSON.stringify(toStableJsonValue(trace));
}

export function parseMockExecutionTraceArtifact(
  serialized: string,
): MockExecutionTraceArtifact {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new MockExecutionTraceArtifactValidationFailure([
      {
        code: "invalid_json",
        message: "Mock execution trace artifact is not valid JSON.",
        path: "$",
      },
    ]);
  }

  const result = validateMockExecutionTraceArtifact(parsed);

  if (!result.success) {
    throw new MockExecutionTraceArtifactValidationFailure(result.errors);
  }

  return result.trace;
}

export function validateMockExecutionTraceArtifact(
  input: unknown,
): MockExecutionTraceValidationResult {
  const errors: MockExecutionTraceValidationError[] = [];
  const trace = requireRecord(input, "$", errors);

  if (trace === undefined) {
    return { errors, success: false };
  }

  const version = requireString(trace, "version", "$.version", errors);

  if (version !== undefined && version !== MOCK_TRACE_ARTIFACT_VERSION) {
    errors.push({
      code: "unknown_version",
      message: "Unsupported mock execution trace artifact version.",
      path: "$.version",
    });
  }

  requireString(trace, "artifactId", "$.artifactId", errors);
  requireString(trace, "traceId", "$.traceId", errors);
  requireString(trace, "createdAt", "$.createdAt", errors);
  validatePlanRef(trace, errors);
  validateBackend(trace, errors);
  requireArray(trace, "steps", "$.steps", errors);
  requireArray(trace, "responses", "$.responses", errors);
  requireRecord(trace.result, "$.result", errors);
  requireArray(trace, "validatorResults", "$.validatorResults", errors);
  requireRecord(trace.timing, "$.timing", errors);
  requireArray(trace, "redactions", "$.redactions", errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    errors: [],
    success: true,
    trace: input as MockExecutionTraceArtifact,
  };
}

export async function replayMockExecutionTrace(
  trace: MockExecutionTraceArtifact,
): Promise<MockExecutionTraceReplayResult> {
  const validation = validateMockExecutionTraceArtifact(trace);

  if (!validation.success) {
    throw new MockExecutionTraceArtifactValidationFailure(validation.errors);
  }

  const loweredPlan = createLoweredPlanFromTrace(trace);
  const backend = createMockExecutionBackend({
    backendId: trace.backend.id,
    fixture: {
      responses: trace.responses,
    },
    ...(trace.timing.startedAt !== undefined
      ? { startedAt: trace.timing.startedAt }
      : {}),
  });
  const result = await backend.execute(loweredPlan);
  const mismatches = compareReplayResult(trace, result);

  return {
    mismatches,
    result,
    status: mismatches.length === 0 ? "matched" : "mismatched",
    traceId: trace.traceId,
  };
}

function createTraceStep(
  step: MockLoweredExecutionStep,
  log: MockExecutionLogEntry,
): MockExecutionTraceStep {
  return {
    completedAt: log.completedAt,
    id: step.id,
    kind: step.kind,
    nodeId: log.nodeId,
    requestRef: step.requestRef,
    sourceNodeId: step.sourceNodeId,
    startedAt: log.startedAt,
    status: log.status,
    ...(step.inputContext !== undefined
      ? { inputContext: step.inputContext }
      : {}),
    ...(step.outputContext !== undefined
      ? { outputContext: step.outputContext }
      : {}),
    ...(log.error !== undefined ? { error: log.error } : {}),
    ...(log.outputRef !== undefined ? { outputRef: log.outputRef } : {}),
    ...(log.usage !== undefined ? { usage: log.usage } : {}),
    ...(log.validation !== undefined ? { validation: log.validation } : {}),
  };
}

function createTraceTiming(
  result: MockExecutionResult,
): MockExecutionTraceTiming {
  const firstLog = result.logs[0];
  const lastLog = result.logs[result.logs.length - 1];

  return {
    ...(firstLog !== undefined ? { startedAt: firstLog.startedAt } : {}),
    ...(lastLog !== undefined ? { completedAt: lastLog.completedAt } : {}),
    ...(result.usage?.latencyMs !== undefined
      ? { durationMs: result.usage.latencyMs }
      : {}),
  };
}

function createLoweredPlanFromTrace(
  trace: MockExecutionTraceArtifact,
): MockLoweredExecutionPlan {
  return {
    assumptions: [],
    backendId: trace.backend.id,
    id: trace.result.loweredPlanId,
    metadata: {
      mockBackendVersion: trace.backend.mockBackendVersion,
    },
    provider: trace.backend.provider,
    sourcePlanId: trace.plan.planId,
    steps: trace.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      requestRef: step.requestRef,
      sourceNodeId: step.sourceNodeId,
      ...(step.inputContext !== undefined
        ? { inputContext: step.inputContext }
        : {}),
      ...(step.outputContext !== undefined
        ? { outputContext: step.outputContext }
        : {}),
    })),
    version: trace.backend.contractVersion,
    warnings: trace.result.warnings,
  };
}

function compareReplayResult(
  trace: MockExecutionTraceArtifact,
  result: MockExecutionResult,
): readonly string[] {
  const mismatches: string[] = [];
  const expectedLogs = trace.steps.map(traceStepToLogEntry);
  const checks = [
    {
      actual: result.status,
      expected: trace.result.status,
      path: "result.status",
    },
    {
      actual: result.outputs,
      expected: trace.result.outputs,
      path: "result.outputs",
    },
    {
      actual: result.usage,
      expected: trace.result.usage,
      path: "result.usage",
    },
    {
      actual: result.error,
      expected: trace.result.error,
      path: "result.error",
    },
    {
      actual: result.logs,
      expected: expectedLogs,
      path: "result.logs",
    },
    {
      actual: result.validatorResults,
      expected: trace.validatorResults,
      path: "result.validatorResults",
    },
    {
      actual: result.warnings,
      expected: trace.result.warnings,
      path: "result.warnings",
    },
  ];

  for (const check of checks) {
    if (stableValue(check.actual) !== stableValue(check.expected)) {
      mismatches.push(check.path);
    }
  }

  return mismatches;
}

function traceStepToLogEntry(
  step: MockExecutionTraceStep,
): MockExecutionLogEntry {
  return {
    completedAt: step.completedAt,
    nodeId: step.nodeId,
    startedAt: step.startedAt,
    status: step.status,
    stepId: step.id,
    ...(step.error !== undefined ? { error: step.error } : {}),
    ...(step.outputRef !== undefined ? { outputRef: step.outputRef } : {}),
    ...(step.usage !== undefined ? { usage: step.usage } : {}),
    ...(step.validation !== undefined ? { validation: step.validation } : {}),
  };
}

function validatePlanRef(
  trace: Readonly<Record<string, unknown>>,
  errors: MockExecutionTraceValidationError[],
): void {
  const plan = requireRecord(trace.plan, "$.plan", errors);

  if (plan === undefined) {
    return;
  }

  requireString(plan, "planId", "$.plan.planId", errors);
  requireString(plan, "version", "$.plan.version", errors);
}

function validateBackend(
  trace: Readonly<Record<string, unknown>>,
  errors: MockExecutionTraceValidationError[],
): void {
  const backend = requireRecord(trace.backend, "$.backend", errors);

  if (backend === undefined) {
    return;
  }

  requireString(backend, "id", "$.backend.id", errors);
  requireString(backend, "provider", "$.backend.provider", errors);
  requireString(backend, "kind", "$.backend.kind", errors);
  requireString(
    backend,
    "contractVersion",
    "$.backend.contractVersion",
    errors,
  );
  requireString(
    backend,
    "mockBackendVersion",
    "$.backend.mockBackendVersion",
    errors,
  );
}

function requireString(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MockExecutionTraceValidationError[],
): string | undefined {
  const value = parent[key];

  if (value === undefined) {
    errors.push({
      code: "missing_required",
      message: "Missing required string.",
      path,
    });
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push({
      code: "invalid_type",
      message: "Expected string.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MockExecutionTraceValidationError[],
): readonly unknown[] | undefined {
  const value = parent[key];

  if (value === undefined) {
    errors.push({
      code: "missing_required",
      message: "Missing required array.",
      path,
    });
    return undefined;
  }

  if (!Array.isArray(value)) {
    errors.push({
      code: "invalid_type",
      message: "Expected array.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireRecord(
  value: unknown,
  path: string,
  errors: MockExecutionTraceValidationError[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    errors.push({
      code: "missing_required",
      message: "Missing required object.",
      path,
    });
    return undefined;
  }

  if (!isRecord(value)) {
    errors.push({
      code: "invalid_type",
      message: "Expected object.",
      path,
    });
    return undefined;
  }

  return value;
}

function stableValue(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    const child = value[key];

    if (child !== undefined) {
      stable[key] = toStableJsonValue(child);
    }
  }

  return stable;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
