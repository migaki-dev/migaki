import { MIR_V0_VERSION, assertMIRPlan, type MIRPlan } from "@migaki/mir";
import {
  checkProviderCapabilityRequirements,
  lookupProviderCapabilities,
  type ProviderCapabilities,
  type ProviderWarning,
} from "@migaki/providers";
import {
  EVIDENCE_EVENT_VERSION,
  createEvidenceBundle,
  diffMIRPlans,
  type CapabilityAssumptionEvidenceEvent,
  type EstimateEvidenceEvent,
  type EvidenceBundle,
  type RetryFallbackDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
  type WarningEvidenceEvent,
} from "@migaki/runtime";

export const STRUCTURED_OUTPUT_VALIDATION_REPORT_VERSION =
  "migaki.example.structured-output-validation-report.v0";
export const STRUCTURED_OUTPUT_VALIDATION_FIXTURE_VERSION =
  "migaki.example.structured-output-validation-fixture.v0";

export interface StructuredOutputValidationRunSummary {
  readonly attempts: number;
  readonly costPerValidResultUsd: number;
  readonly downgradeWarnings: readonly string[];
  readonly evidenceBundleRef: string;
  readonly planId: string;
  readonly provider: string;
  readonly providerCapabilityPath: string;
  readonly retriedNodeIds?: readonly string[];
  readonly retryCount: number;
  readonly retryScope?: "node" | "whole_prompt";
  readonly retryScopeNodeIds: readonly string[];
  readonly schemaValid: boolean;
}

export interface StructuredOutputAcceptanceCriterion {
  readonly actual: string;
  readonly id: string;
  readonly passed: boolean;
  readonly threshold: string;
}

export interface StructuredOutputValidationReport {
  readonly acceptanceCriteria: readonly StructuredOutputAcceptanceCriterion[];
  readonly baseline: StructuredOutputValidationRunSummary;
  readonly claims: {
    readonly canClaim: readonly string[];
    readonly cannotClaim: readonly string[];
  };
  readonly evidence: {
    readonly fallbackBundle: string;
    readonly nativeBundle: string;
  };
  readonly fixtureVersion: typeof STRUCTURED_OUTPUT_VALIDATION_FIXTURE_VERSION;
  readonly generatedAt: string;
  readonly migaki: {
    readonly fallback: StructuredOutputValidationRunSummary;
    readonly native: StructuredOutputValidationRunSummary;
  };
  readonly plan: string;
  readonly schemaRef: string;
  readonly version: typeof STRUCTURED_OUTPUT_VALIDATION_REPORT_VERSION;
}

interface InvoiceExtraction {
  readonly currency?: string;
  readonly invoiceId?: string;
  readonly total?: number;
}

interface SchemaValidationResult {
  readonly errors: readonly string[];
  readonly status: "failed" | "passed";
}

interface ProviderRun {
  readonly evidenceBundle: EvidenceBundle;
  readonly summary: StructuredOutputValidationRunSummary;
}

const generatedAt = "2026-01-01T00:00:05.000Z";
const schemaRef = "schema://examples/invoice-extraction.v0";
const baselineEvidenceBundleRef =
  "evidence://bundle/structured-output-baseline";
const nativeEvidenceBundleRef = "evidence://bundle/structured-output-native";
const fallbackEvidenceBundleRef =
  "evidence://bundle/structured-output-fallback";
const plan = createStructuredOutputPlan();

export async function createStructuredOutputValidationReport(): Promise<StructuredOutputValidationReport> {
  const baseline = runBaselineFixture();
  const native = runMigakiProviderPath({
    providerId: "openai-style",
    runId: "structured-output-native",
  });
  const fallback = runMigakiProviderPath({
    providerId: "anthropic-style",
    runId: "structured-output-fallback",
  });

  return {
    acceptanceCriteria: createAcceptanceCriteria({
      baseline,
      fallback: fallback.summary,
      native: native.summary,
    }),
    baseline,
    claims: {
      canClaim: [
        "The fixture records provider-native structured output when capabilities declare support.",
        "The fixture records post-validation fallback and downgrade warning evidence otherwise.",
        "The fallback path retries only the invalid extraction node in this deterministic fixture.",
      ],
      cannotClaim: [
        "Identical answers across providers.",
        "Live-provider cost or latency improvement.",
      ],
    },
    evidence: {
      fallbackBundle: fallback.summary.evidenceBundleRef,
      nativeBundle: native.summary.evidenceBundleRef,
    },
    fixtureVersion: STRUCTURED_OUTPUT_VALIDATION_FIXTURE_VERSION,
    generatedAt,
    migaki: {
      fallback: fallback.summary,
      native: native.summary,
    },
    plan: plan.id,
    schemaRef,
    version: STRUCTURED_OUTPUT_VALIDATION_REPORT_VERSION,
  };
}

export function renderStructuredOutputValidationReport(
  report: StructuredOutputValidationReport,
): string {
  return [
    "Migaki Structured Output Validation Report",
    `Baseline: ${report.baseline.retryScope} retries=${report.baseline.retryCount} valid=${report.baseline.schemaValid} costPerValidResultUsd=${report.baseline.costPerValidResultUsd}`,
    `Native: ${report.migaki.native.provider} ${report.migaki.native.providerCapabilityPath} retries=${report.migaki.native.retryCount} valid=${report.migaki.native.schemaValid} costPerValidResultUsd=${report.migaki.native.costPerValidResultUsd}`,
    `Fallback: ${report.migaki.fallback.provider} ${report.migaki.fallback.providerCapabilityPath} retries=${report.migaki.fallback.retryCount} valid=${report.migaki.fallback.schemaValid} costPerValidResultUsd=${report.migaki.fallback.costPerValidResultUsd}`,
    `Retry scope: ${report.migaki.fallback.retryScopeNodeIds.join(",")}`,
    `Warnings: ${report.migaki.fallback.downgradeWarnings.join(", ")}`,
    `Criteria: passed ${
      report.acceptanceCriteria.filter((criterion) => criterion.passed).length
    }/${report.acceptanceCriteria.length}`,
    `Cannot claim: ${report.claims.cannotClaim.join("; ")}`,
    "",
  ].join("\n");
}

export function serializeStructuredOutputValidationReport(
  report: StructuredOutputValidationReport,
): string {
  return `${JSON.stringify(toStableJsonValue(report), null, 2)}\n`;
}

function runBaselineFixture(): StructuredOutputValidationRunSummary {
  const firstAttempt = validateInvoiceExtraction({ invoiceId: "INV-1001" });
  const secondAttempt = validateInvoiceExtraction({
    currency: "USD",
    invoiceId: "INV-1001",
    total: 42,
  });

  return {
    attempts: 2,
    costPerValidResultUsd: 0,
    downgradeWarnings: [],
    evidenceBundleRef: baselineEvidenceBundleRef,
    planId: "baseline-json-prompt",
    provider: "mock",
    providerCapabilityPath: "prompted JSON parse",
    retriedNodeIds: [
      "baseline-prompt-attempt-1",
      "baseline-parse-attempt-1",
      "baseline-prompt-attempt-2",
      "baseline-parse-attempt-2",
    ],
    retryCount:
      firstAttempt.status === "failed" && secondAttempt.status === "passed"
        ? 1
        : 0,
    retryScope: "whole_prompt",
    retryScopeNodeIds: [
      "baseline-prompt-attempt-1",
      "baseline-parse-attempt-1",
      "baseline-prompt-attempt-2",
      "baseline-parse-attempt-2",
    ],
    schemaValid: secondAttempt.status === "passed",
  };
}

function runMigakiProviderPath(input: {
  readonly providerId: string;
  readonly runId: string;
}): ProviderRun {
  const capabilities = requireProviderCapabilities(input.providerId);
  const capabilityCheck = checkProviderCapabilityRequirements(
    capabilities,
    [
      {
        capability: "structured_outputs",
        reason:
          "invoice extraction schema can be provider-native or post-validated",
        required: false,
      },
    ],
    { checkedAt: generatedAt },
  );
  const supportsNativeStructuredOutput =
    capabilityCheck.warnings.every(
      (warning) =>
        warning.capability !== "structured_outputs" ||
        warning.code !== "downgraded_capability",
    ) && capabilities.supportsStructuredOutputs;
  const validationAttempts = supportsNativeStructuredOutput
    ? [
        validateInvoiceExtraction({
          currency: "USD",
          invoiceId: "INV-1001",
          total: 42,
        }),
      ]
    : [
        validateInvoiceExtraction({ invoiceId: "INV-1001" }),
        validateInvoiceExtraction({
          currency: "USD",
          invoiceId: "INV-1001",
          total: 42,
        }),
      ];
  const retryCount = Math.max(0, validationAttempts.length - 1);
  const schemaValid =
    validationAttempts[validationAttempts.length - 1]?.status === "passed";
  const retryScopeNodeIds = retryCount > 0 ? ["node-extract"] : [];
  const providerCapabilityPath = supportsNativeStructuredOutput
    ? "provider-native structured_outputs"
    : "post-validation fallback";
  const evidenceBundleRef = supportsNativeStructuredOutput
    ? nativeEvidenceBundleRef
    : fallbackEvidenceBundleRef;
  const downgradeWarnings = warningCodes(capabilityCheck.warnings);
  const evidenceBundle = createEvidenceBundle({
    createdAt: generatedAt,
    events: createEvidenceEvents({
      capabilities,
      downgradeWarnings: capabilityCheck.warnings,
      evidenceBundleRef,
      providerCapabilityPath,
      retryCount,
      retryScopeNodeIds,
      runId: input.runId,
      validationAttempts,
    }),
    exportMode: "metadata_only",
    optimizedPlan: {
      planId: plan.id,
      ref: "mir://examples/structured-output-validation",
      version: plan.version,
    },
    originalPlan: {
      planId: plan.id,
      ref: "mir://examples/structured-output-validation",
      version: plan.version,
    },
    passes: [],
    planDiff: diffMIRPlans(plan, plan),
    replay: {
      handles: [
        {
          kind: "trace",
          ref: `trace://${input.runId}`,
        },
      ],
      mode: "metadata",
      notes: [
        "Fixture uses deterministic local values and omits raw provider responses.",
      ],
    },
    runId: input.runId,
    warnings: [],
  });

  return {
    evidenceBundle,
    summary: {
      attempts: validationAttempts.length,
      costPerValidResultUsd: schemaValid ? 0 : Number.NaN,
      downgradeWarnings,
      evidenceBundleRef,
      planId: plan.id,
      provider: capabilities.provider,
      providerCapabilityPath,
      retryCount,
      retryScopeNodeIds,
      schemaValid,
      ...(retryCount > 0 ? { retryScope: "node" as const } : {}),
    },
  };
}

function createStructuredOutputPlan(): MIRPlan {
  return assertMIRPlan({
    constraints: {
      allowedProviders: ["openai-style", "anthropic-style"],
      auditLevel: "evidence_bundle",
      requiredValidators: ["validator-invoice-schema"],
      retentionPolicy: {
        mode: "metadata_only",
        reason: "Structured-output example must not retain raw invoices.",
      },
    },
    context: [
      {
        contentRef: "fixture://structured-output/system",
        id: "ctx-system",
        mutability: "fixed",
        privacyClass: "internal",
        provenance: {
          source: "system",
        },
        role: "system_instruction",
        tokenEstimate: 24,
      },
      {
        contentRef: "fixture://structured-output/invoice",
        id: "ctx-invoice",
        mutability: "fixed",
        privacyClass: "confidential",
        provenance: {
          source: "user",
        },
        role: "user_input",
        tokenEstimate: 64,
      },
      {
        contentRef: "fixture://structured-output/invoice-json",
        id: "ctx-invoice-json",
        mutability: "fixed",
        privacyClass: "internal",
        provenance: {
          nodeId: "node-extract",
          source: "generated",
        },
        role: "validator_output",
        tokenEstimate: 24,
      },
      {
        contentRef: "fixture://structured-output/schema-validation",
        id: "ctx-schema-validation",
        mutability: "fixed",
        privacyClass: "internal",
        provenance: {
          nodeId: "node-validate-schema",
          source: "validator",
        },
        role: "validator_output",
        tokenEstimate: 8,
      },
    ],
    edges: [
      {
        contextIds: ["ctx-invoice-json"],
        fromNodeId: "node-extract",
        id: "edge-extract-validate",
        kind: "validation",
        toNodeId: "node-validate-schema",
      },
      {
        fromNodeId: "node-validate-schema",
        id: "edge-validate-join",
        kind: "control",
        toNodeId: "node-join",
      },
    ],
    id: "structured-output-validation",
    metadata: {
      application: "@migaki/example-structured-output-validation",
      createdAt: "2026-01-01T00:00:00.000Z",
      description:
        "Schema-aware invoice extraction example with provider structured-output fallback evidence.",
      tags: ["example", "structured-output", "validation"],
      traceId: "trace-structured-output-validation",
    },
    nodes: [
      {
        id: "node-extract",
        inputContext: ["ctx-system", "ctx-invoice"],
        kind: "model_call",
        model: {
          requiredCapabilities: ["structured_output"],
          task: "classification",
        },
        outputContext: "ctx-invoice-json",
        parameters: {
          maxOutputTokens: 128,
          temperature: 0,
        },
        validators: ["validator-invoice-schema"],
      },
      {
        failurePolicy: "retry_node",
        id: "node-validate-schema",
        inputContext: ["ctx-invoice-json"],
        kind: "validator",
        outputContext: "ctx-schema-validation",
        validator: {
          kind: "schema",
          name: "validator-invoice-schema",
          schemaRef,
        },
      },
      {
        id: "node-join",
        inputNodeIds: ["node-validate-schema"],
        kind: "join",
        strategy: "all",
      },
    ],
    version: MIR_V0_VERSION,
  });
}

function createEvidenceEvents(input: {
  readonly capabilities: ProviderCapabilities;
  readonly downgradeWarnings: readonly ProviderWarning[];
  readonly evidenceBundleRef: string;
  readonly providerCapabilityPath: string;
  readonly retryCount: number;
  readonly retryScopeNodeIds: readonly string[];
  readonly runId: string;
  readonly validationAttempts: readonly SchemaValidationResult[];
}): readonly (
  | CapabilityAssumptionEvidenceEvent
  | EstimateEvidenceEvent
  | RetryFallbackDecisionEvidenceEvent
  | ValidatorResultEvidenceEvent
  | WarningEvidenceEvent
)[] {
  return [
    createCapabilityEvidenceEvent(input),
    ...input.downgradeWarnings.map((warning, index) =>
      createWarningEvidenceEvent({ ...input, index, warning }),
    ),
    ...input.validationAttempts.map((result, index) =>
      createValidatorEvidenceEvent({
        index,
        result,
        runId: input.runId,
      }),
    ),
    ...(input.retryCount > 0
      ? [
          createRetryEvidenceEvent({
            retryScopeNodeIds: input.retryScopeNodeIds,
            runId: input.runId,
          }),
        ]
      : []),
    createCostEvidenceEvent(input),
  ];
}

function createCapabilityEvidenceEvent(input: {
  readonly capabilities: ProviderCapabilities;
  readonly providerCapabilityPath: string;
  readonly runId: string;
}): CapabilityAssumptionEvidenceEvent {
  return {
    capabilityAssumption: {
      capability: "structured_outputs",
      description: input.providerCapabilityPath,
      evidenceRef: `provider-capabilities://${input.capabilities.provider}/${input.capabilities.version}/${input.capabilities.observedAt}`,
      provider: input.capabilities.provider,
    },
    id: "structured-output-capability",
    kind: "capability_assumption",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    refs: [input.capabilities.version, schemaRef],
    source: {
      kind: "provider",
      runId: input.runId,
    },
    summary: `Recorded ${input.providerCapabilityPath} for ${input.capabilities.provider}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createWarningEvidenceEvent(input: {
  readonly index: number;
  readonly runId: string;
  readonly warning: ProviderWarning;
}): WarningEvidenceEvent {
  return {
    id: `structured-output-warning-${String(input.index + 1).padStart(3, "0")}`,
    kind: "warning",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "provider",
      runId: input.runId,
    },
    summary: input.warning.message,
    version: EVIDENCE_EVENT_VERSION,
    warning: {
      ...(input.warning.assumption !== undefined
        ? { assumption: input.warning.assumption }
        : {}),
      ...(input.warning.capability !== undefined
        ? { capability: input.warning.capability }
        : {}),
      code: input.warning.code,
      severity: input.warning.severity,
    },
  };
}

function createValidatorEvidenceEvent(input: {
  readonly index: number;
  readonly result: SchemaValidationResult;
  readonly runId: string;
}): ValidatorResultEvidenceEvent {
  return {
    id: `structured-output-validator-${String(input.index + 1).padStart(3, "0")}`,
    kind: "validator_result",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
      refs: input.result.errors,
    },
    source: {
      kind: "validator",
      nodeId: "node-validate-schema",
      runId: input.runId,
    },
    summary: `Invoice schema validator ${input.result.status}.`,
    validatorResult: {
      score: input.result.status === "passed" ? 1 : 0,
      status: input.result.status,
      targetRef: "ctx-invoice-json",
      validatorId: "validator-invoice-schema",
    },
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createRetryEvidenceEvent(input: {
  readonly retryScopeNodeIds: readonly string[];
  readonly runId: string;
}): RetryFallbackDecisionEvidenceEvent {
  return {
    id: "structured-output-retry-decision",
    kind: "retry_fallback_decision",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    retryFallbackDecision: {
      decision: "retry",
      nodeId: input.retryScopeNodeIds[0] ?? "node-extract",
      scope: "node",
    },
    source: {
      kind: "runtime",
      nodeId: input.retryScopeNodeIds[0] ?? "node-extract",
      runId: input.runId,
    },
    summary:
      "Retry only the invalid extraction node after schema validation fails.",
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createCostEvidenceEvent(input: {
  readonly evidenceBundleRef: string;
  readonly runId: string;
  readonly validationAttempts: readonly SchemaValidationResult[];
}): EstimateEvidenceEvent {
  return {
    estimate: {
      confidence: "estimated",
      estimateKind: "cost",
      subjectRef: input.evidenceBundleRef,
      unit: "usd",
      value: 0,
    },
    id: "structured-output-cost-per-valid-result",
    kind: "estimate",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "runtime",
      runId: input.runId,
    },
    summary: `Estimated cost per valid result after ${input.validationAttempts.length} attempt(s).`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function validateInvoiceExtraction(
  value: InvoiceExtraction,
): SchemaValidationResult {
  const errors = [
    ...(typeof value.invoiceId === "string" && value.invoiceId.length > 0
      ? []
      : ["missing invoiceId"]),
    ...(typeof value.total === "number" ? [] : ["missing total"]),
    ...(value.currency === "USD" ? [] : ["currency must be USD"]),
  ];

  return {
    errors,
    status: errors.length === 0 ? "passed" : "failed",
  };
}

function createAcceptanceCriteria(input: {
  readonly baseline: StructuredOutputValidationRunSummary;
  readonly fallback: StructuredOutputValidationRunSummary;
  readonly native: StructuredOutputValidationRunSummary;
}): readonly StructuredOutputAcceptanceCriterion[] {
  return [
    {
      actual: input.baseline.retryScope ?? "missing",
      id: "baseline_retries_whole_prompt",
      passed:
        input.baseline.retryScope === "whole_prompt" &&
        input.baseline.retryCount === 1,
      threshold: "baseline retries the whole JSON prompt on parse failure",
    },
    {
      actual: input.native.providerCapabilityPath,
      id: "native_structured_output",
      passed:
        input.native.providerCapabilityPath ===
          "provider-native structured_outputs" &&
        input.native.downgradeWarnings.length === 0,
      threshold: "native path uses provider-declared structured output",
    },
    {
      actual: input.fallback.downgradeWarnings.join(","),
      id: "fallback_warning",
      passed: input.fallback.downgradeWarnings.includes(
        "downgraded_capability:structured_outputs",
      ),
      threshold: "fallback path records structured-output downgrade warning",
    },
    {
      actual: input.fallback.retryScopeNodeIds.join(","),
      id: "retry_scope",
      passed: input.fallback.retryScopeNodeIds.join(",") === "node-extract",
      threshold: "schema failure retries only the invalid extraction node",
    },
    {
      actual: `${input.native.schemaValid},${input.fallback.schemaValid}`,
      id: "schema_validity",
      passed: input.native.schemaValid && input.fallback.schemaValid,
      threshold: "native and fallback fixture results pass schema validation",
    },
  ];
}

function requireProviderCapabilities(providerId: string): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities(providerId);

  if (capabilities === undefined) {
    throw new Error(`Unknown provider capability fixture: ${providerId}`);
  }

  return capabilities;
}

function warningCodes(warnings: readonly ProviderWarning[]): readonly string[] {
  return warnings.map((warning) =>
    warning.capability === undefined
      ? warning.code
      : `${warning.code}:${warning.capability}`,
  );
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    stable[key] = toStableJsonValue(value[key]);
  }

  return stable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
