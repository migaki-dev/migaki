import type { MIRConstraints, MIRPlan } from "@migaki/mir";
import type { ProviderCapabilities } from "@migaki/providers";

import {
  EVIDENCE_EVENT_VERSION,
  type EvidenceEvent,
  type PolicyDecisionEvidenceEvent,
} from "./evidence.js";

export const CONSTRAINT_EVALUATION_VERSION = "migaki.constraint-evaluation.v0";

export type ConstraintEvaluationVersion = typeof CONSTRAINT_EVALUATION_VERSION;

export type ConstraintFailureCode =
  | "audit_level_unsupported"
  | "constraint_unchecked"
  | "cost_exceeded"
  | "eval_score_too_low"
  | "latency_exceeded"
  | "privacy_class_not_allowed"
  | "provider_capabilities_missing"
  | "provider_denied"
  | "provider_not_allowed"
  | "redaction_required"
  | "regression_exceeded"
  | "replay_policy_unsupported"
  | "retention_unavailable"
  | "validator_missing"
  | "validator_pass_rate_too_low";

export type ConstraintWarningCode = "constraint_not_configured";

export interface ConstraintEvaluationOptions {
  readonly availableValidatorIds?: readonly string[];
  readonly estimates?: ConstraintEvaluationEstimates;
  readonly providerCapabilities?: readonly ProviderCapabilities[];
  readonly supportedAuditLevels?: readonly AuditLevel[];
  readonly supportedReplayPolicies?: readonly ReplayPolicy[];
}

export interface ConstraintEvaluationEstimates {
  readonly costUsd?: number;
  readonly evalScore?: number;
  readonly latencyMs?: number;
  readonly regression?: number;
  readonly validatorPassRate?: number;
}

export interface ConstraintEvaluation {
  readonly allowed: boolean;
  readonly evidence: readonly EvidenceEvent[];
  readonly failures: readonly ConstraintFailure[];
  readonly version: ConstraintEvaluationVersion;
  readonly warnings: readonly ConstraintWarning[];
}

export interface ConstraintFailure {
  readonly code: ConstraintFailureCode;
  readonly evidenceRef: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "error";
}

export interface ConstraintWarning {
  readonly code: ConstraintWarningCode;
  readonly evidenceRef: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "info" | "warning";
}

type AuditLevel = NonNullable<MIRConstraints["auditLevel"]>;
type ReplayPolicy = NonNullable<MIRConstraints["replayPolicy"]>;
type PolicyOutcome = PolicyDecisionEvidenceEvent["policyDecision"]["outcome"];

export function evaluateOptimizationConstraints(
  plan: MIRPlan,
  options: ConstraintEvaluationOptions = {},
): ConstraintEvaluation {
  const builder = new ConstraintEvaluationBuilder();

  evaluateThresholds(plan.constraints, options, builder);
  evaluateProviderPolicy(plan.constraints, options, builder);
  evaluateReplayPolicy(plan.constraints, options, builder);
  evaluateAuditLevel(plan.constraints, options, builder);
  evaluateRetentionPolicy(plan.constraints, options, builder);
  evaluateValidators(plan.constraints, options, builder);
  evaluatePrivacyPolicy(plan, builder);

  return builder.toEvaluation();
}

function evaluateThresholds(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  evaluateMaximumThreshold({
    actual: options.estimates?.costUsd,
    code: "cost_exceeded",
    constraint: constraints.maxCostUsd,
    path: "$.constraints.maxCostUsd",
    unit: "cost",
    builder,
  });
  evaluateMaximumThreshold({
    actual: options.estimates?.latencyMs,
    code: "latency_exceeded",
    constraint: constraints.maxLatencyMs,
    path: "$.constraints.maxLatencyMs",
    unit: "latency",
    builder,
  });
  evaluateMinimumThreshold({
    actual: options.estimates?.evalScore,
    code: "eval_score_too_low",
    constraint: constraints.minEvalScore,
    path: "$.constraints.minEvalScore",
    unit: "eval score",
    builder,
  });
  evaluateMinimumThreshold({
    actual: options.estimates?.validatorPassRate,
    code: "validator_pass_rate_too_low",
    constraint: constraints.minValidatorPassRate,
    path: "$.constraints.minValidatorPassRate",
    unit: "validator pass rate",
    builder,
  });
  evaluateMaximumThreshold({
    actual: options.estimates?.regression,
    code: "regression_exceeded",
    constraint: constraints.allowedRegression,
    path: "$.constraints.allowedRegression",
    unit: "regression",
    builder,
  });
}

function evaluateProviderPolicy(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  if (
    constraints.allowedProviders === undefined &&
    constraints.deniedProviders === undefined
  ) {
    return;
  }

  const capabilities = options.providerCapabilities ?? [];

  if (capabilities.length === 0) {
    builder.addFailure({
      code: "provider_capabilities_missing",
      message: "Provider constraints require provider capability inputs.",
      path: "$.constraints.allowedProviders",
    });
    return;
  }

  for (const provider of capabilities) {
    if (constraints.allowedProviders !== undefined) {
      if (!constraints.allowedProviders.includes(provider.provider)) {
        builder.addFailure({
          code: "provider_not_allowed",
          message: "Provider is not in the allowed provider list.",
          path: "$.constraints.allowedProviders",
        });
      } else {
        builder.addEvidence(
          "allowed",
          "$.constraints.allowedProviders",
          "Provider allow-list constraint passed.",
        );
      }
    }

    if (constraints.deniedProviders !== undefined) {
      if (constraints.deniedProviders.includes(provider.provider)) {
        builder.addFailure({
          code: "provider_denied",
          message: "Provider is present in the denied provider list.",
          path: "$.constraints.deniedProviders",
        });
      } else {
        builder.addEvidence(
          "allowed",
          "$.constraints.deniedProviders",
          "Provider deny-list constraint passed.",
        );
      }
    }
  }
}

function evaluateReplayPolicy(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  if (constraints.replayPolicy === undefined) {
    return;
  }

  if (
    options.supportedReplayPolicies?.includes(constraints.replayPolicy) !== true
  ) {
    builder.addFailure({
      code: "replay_policy_unsupported",
      message: "Required replay policy is not supported by this run.",
      path: "$.constraints.replayPolicy",
    });
    return;
  }

  builder.addEvidence(
    "allowed",
    "$.constraints.replayPolicy",
    "Replay policy constraint passed.",
  );
}

function evaluateAuditLevel(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  if (constraints.auditLevel === undefined) {
    return;
  }

  if (options.supportedAuditLevels?.includes(constraints.auditLevel) !== true) {
    builder.addFailure({
      code: "audit_level_unsupported",
      message: "Required audit level is not supported by this run.",
      path: "$.constraints.auditLevel",
    });
    return;
  }

  builder.addEvidence(
    "allowed",
    "$.constraints.auditLevel",
    "Audit level constraint passed.",
  );
}

function evaluateRetentionPolicy(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  const requiresZeroDataRetention =
    constraints.retentionPolicy?.mode === "ephemeral" ||
    constraints.dataPolicy?.allowPersistence === false;

  if (!requiresZeroDataRetention) {
    return;
  }

  const capabilities = options.providerCapabilities ?? [];

  if (capabilities.length === 0) {
    builder.addFailure({
      code: "provider_capabilities_missing",
      message: "Retention constraints require provider capability inputs.",
      path: "$.constraints.retentionPolicy",
    });
    return;
  }

  if (
    capabilities.some(
      (capabilitiesForProvider) =>
        capabilitiesForProvider.supportsZeroDataRetention !== true,
    )
  ) {
    builder.addFailure({
      code: "retention_unavailable",
      message:
        "Required retention policy is unavailable for a selected provider.",
      path: "$.constraints.retentionPolicy",
    });
    return;
  }

  builder.addEvidence(
    "allowed",
    "$.constraints.retentionPolicy",
    "Retention policy constraint passed.",
  );
}

function evaluateValidators(
  constraints: MIRConstraints,
  options: ConstraintEvaluationOptions,
  builder: ConstraintEvaluationBuilder,
): void {
  if (constraints.requiredValidators === undefined) {
    return;
  }

  const availableValidators = new Set(options.availableValidatorIds ?? []);

  for (const validatorId of constraints.requiredValidators) {
    if (!availableValidators.has(validatorId)) {
      builder.addFailure({
        code: "validator_missing",
        message: "Required validator is unavailable.",
        path: "$.constraints.requiredValidators",
      });
      continue;
    }

    builder.addEvidence(
      "allowed",
      "$.constraints.requiredValidators",
      "Required validator constraint passed.",
    );
  }
}

function evaluatePrivacyPolicy(
  plan: MIRPlan,
  builder: ConstraintEvaluationBuilder,
): void {
  const allowedPrivacyClasses =
    plan.constraints.dataPolicy?.allowedPrivacyClasses;

  if (allowedPrivacyClasses !== undefined) {
    const allowedPrivacyClassSet = new Set(allowedPrivacyClasses);

    for (const block of plan.context) {
      if (
        block.privacyClass !== undefined &&
        allowedPrivacyClassSet.has(block.privacyClass)
      ) {
        builder.addEvidence(
          "allowed",
          "$.constraints.dataPolicy.allowedPrivacyClasses",
          "Privacy class constraint passed.",
        );
        continue;
      }

      builder.addFailure({
        code: "privacy_class_not_allowed",
        message: "Context block privacy class is not allowed by data policy.",
        path: "$.constraints.dataPolicy.allowedPrivacyClasses",
      });
    }
  }

  if (plan.constraints.dataPolicy?.redactionRequired !== true) {
    return;
  }

  for (const block of plan.context) {
    if (!requiresExplicitRedaction(block.privacyClass)) {
      continue;
    }

    if (
      block.retentionPolicy?.mode === "metadata_only" ||
      block.retentionPolicy?.mode === "redacted"
    ) {
      builder.addEvidence(
        "allowed",
        "$.constraints.dataPolicy.redactionRequired",
        "Redaction requirement passed.",
      );
      continue;
    }

    builder.addFailure({
      code: "redaction_required",
      message:
        "Sensitive context must declare redacted or metadata-only retention.",
      path: "$.constraints.dataPolicy.redactionRequired",
    });
  }
}

function evaluateMaximumThreshold(input: {
  readonly actual: number | undefined;
  readonly builder: ConstraintEvaluationBuilder;
  readonly code: ConstraintFailureCode;
  readonly constraint: number | undefined;
  readonly path: string;
  readonly unit: string;
}): void {
  if (input.constraint === undefined) {
    return;
  }

  if (input.actual === undefined) {
    input.builder.addUnchecked(input.path);
    return;
  }

  if (input.actual > input.constraint) {
    input.builder.addFailure({
      code: input.code,
      message: `Estimated ${input.unit} exceeds the required maximum.`,
      path: input.path,
    });
    return;
  }

  input.builder.addEvidence(
    "allowed",
    input.path,
    `Estimated ${input.unit} satisfies the required maximum.`,
  );
}

function evaluateMinimumThreshold(input: {
  readonly actual: number | undefined;
  readonly builder: ConstraintEvaluationBuilder;
  readonly code: ConstraintFailureCode;
  readonly constraint: number | undefined;
  readonly path: string;
  readonly unit: string;
}): void {
  if (input.constraint === undefined) {
    return;
  }

  if (input.actual === undefined) {
    input.builder.addUnchecked(input.path);
    return;
  }

  if (input.actual < input.constraint) {
    input.builder.addFailure({
      code: input.code,
      message: `Estimated ${input.unit} is below the required minimum.`,
      path: input.path,
    });
    return;
  }

  input.builder.addEvidence(
    "allowed",
    input.path,
    `Estimated ${input.unit} satisfies the required minimum.`,
  );
}

function requiresExplicitRedaction(
  privacyClass: MIRPlan["context"][number]["privacyClass"],
): boolean {
  return (
    privacyClass === "confidential" ||
    privacyClass === "restricted" ||
    privacyClass === "secret"
  );
}

class ConstraintEvaluationBuilder {
  readonly #evidence: EvidenceEvent[] = [];
  readonly #failures: ConstraintFailure[] = [];
  readonly #warnings: ConstraintWarning[] = [];

  addUnchecked(path: string): void {
    this.addFailure({
      code: "constraint_unchecked",
      message: "Required constraint cannot be evaluated with available inputs.",
      path,
    });
  }

  addFailure(input: {
    readonly code: ConstraintFailureCode;
    readonly message: string;
    readonly path: string;
  }): void {
    const evidenceRef = this.addEvidence("blocked", input.path, input.message);

    this.#failures.push({
      code: input.code,
      evidenceRef,
      message: input.message,
      path: input.path,
      severity: "error",
    });
  }

  addEvidence(
    outcome: PolicyOutcome,
    policyRef: string,
    summary: string,
  ): string {
    const id = `constraint-evidence-${String(this.#evidence.length + 1).padStart(3, "0")}`;

    this.#evidence.push({
      id,
      kind: "policy_decision",
      policyDecision: {
        outcome,
        policyRef,
      },
      privacy: {
        privacyClass: "internal",
        replayMode: "metadata",
      },
      redaction: {
        mode: "none",
      },
      source: {
        kind: "runtime",
      },
      summary,
      version: EVIDENCE_EVENT_VERSION,
    });

    return id;
  }

  toEvaluation(): ConstraintEvaluation {
    return {
      allowed: this.#failures.length === 0,
      evidence: this.#evidence,
      failures: this.#failures,
      version: CONSTRAINT_EVALUATION_VERSION,
      warnings: this.#warnings,
    };
  }
}
