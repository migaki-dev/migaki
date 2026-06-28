import type { MIRPrivacyClass, MIRRetentionPolicy } from "@migaki/mir";
import type { ProviderCapabilityName } from "@migaki/providers";

export const EVIDENCE_EVENT_VERSION = "migaki.evidence-event.v0";

export type EvidenceEventVersion = typeof EVIDENCE_EVENT_VERSION;

export const EVIDENCE_EVENT_KINDS = [
  "pass_decision",
  "warning",
  "capability_assumption",
  "context_change",
  "estimate",
  "validator_result",
  "routing_decision",
  "retry_fallback_decision",
  "policy_decision",
] as const;

export type EvidenceEventKind = (typeof EVIDENCE_EVENT_KINDS)[number];

export type EvidenceSourceKind =
  | "cli"
  | "pass"
  | "provider"
  | "runtime"
  | "validator";

export interface EvidencePassIdentity {
  readonly name: string;
  readonly version: string;
}

export interface EvidenceEventSource {
  readonly kind: EvidenceSourceKind;
  readonly nodeId?: string;
  readonly pass?: EvidencePassIdentity;
  readonly runId?: string;
}

export type EvidencePrivacyClass = MIRPrivacyClass | "unspecified";

export interface EvidencePrivacyMetadata {
  readonly privacyClass: EvidencePrivacyClass;
  readonly replayMode: "full_trace" | "metadata" | "none";
  readonly retentionPolicy?: MIRRetentionPolicy;
}

export interface EvidenceRedactionMetadata {
  readonly mode: "none" | "omitted" | "redacted";
  readonly reason?: string;
  readonly refs?: readonly string[];
}

interface EvidenceEventBase<TKind extends EvidenceEventKind> {
  readonly id: string;
  readonly kind: TKind;
  readonly privacy: EvidencePrivacyMetadata;
  readonly redaction: EvidenceRedactionMetadata;
  readonly refs?: readonly string[];
  readonly source: EvidenceEventSource;
  readonly summary: string;
  readonly version: EvidenceEventVersion;
}

export type EvidenceEvent =
  | CapabilityAssumptionEvidenceEvent
  | ContextChangeEvidenceEvent
  | EstimateEvidenceEvent
  | PassDecisionEvidenceEvent
  | PolicyDecisionEvidenceEvent
  | RetryFallbackDecisionEvidenceEvent
  | RoutingDecisionEvidenceEvent
  | ValidatorResultEvidenceEvent
  | WarningEvidenceEvent;

export interface PassDecisionEvidenceEvent extends EvidenceEventBase<"pass_decision"> {
  readonly passDecision: {
    readonly decision: "applied" | "blocked" | "skipped";
    readonly pass: EvidencePassIdentity;
    readonly reason?: string;
  };
}

export interface WarningEvidenceEvent extends EvidenceEventBase<"warning"> {
  readonly warning: {
    readonly assumption?: string;
    readonly code: string;
    readonly path?: string;
    readonly severity: "error" | "info" | "warning";
  };
}

export interface CapabilityAssumptionEvidenceEvent extends EvidenceEventBase<"capability_assumption"> {
  readonly capabilityAssumption: {
    readonly capability: ProviderCapabilityName;
    readonly description: string;
    readonly evidenceRef?: string;
    readonly provider: string;
  };
}

export interface ContextChangeEvidenceEvent extends EvidenceEventBase<"context_change"> {
  readonly contextChange: {
    readonly changeKind:
      | "added"
      | "changed"
      | "compressed"
      | "deduplicated"
      | "redacted"
      | "removed"
      | "reordered";
    readonly contextIds: readonly string[];
    readonly diffRef?: string;
  };
}

export interface EstimateEvidenceEvent extends EvidenceEventBase<"estimate"> {
  readonly estimate: {
    readonly confidence: "estimated" | "exact" | "unknown";
    readonly estimateKind: "cost" | "latency" | "token";
    readonly subjectRef: string;
    readonly unit: "milliseconds" | "tokens" | "usd";
    readonly value?: number;
  };
}

export interface ValidatorResultEvidenceEvent extends EvidenceEventBase<"validator_result"> {
  readonly validatorResult: {
    readonly score?: number;
    readonly status: "failed" | "passed" | "skipped";
    readonly targetRef?: string;
    readonly validatorId: string;
  };
}

export interface RoutingDecisionEvidenceEvent extends EvidenceEventBase<"routing_decision"> {
  readonly routingDecision: {
    readonly nodeId: string;
    readonly reason: string;
    readonly source?: string;
    readonly target: string;
  };
}

export interface RetryFallbackDecisionEvidenceEvent extends EvidenceEventBase<"retry_fallback_decision"> {
  readonly retryFallbackDecision: {
    readonly decision: "fallback" | "not_retryable" | "retry" | "skip";
    readonly fallbackTarget?: string;
    readonly nodeId: string;
    readonly scope: "branch" | "node" | "plan";
  };
}

export interface PolicyDecisionEvidenceEvent extends EvidenceEventBase<"policy_decision"> {
  readonly policyDecision: {
    readonly constraintPath?: string;
    readonly outcome: "allowed" | "blocked" | "warned";
    readonly policyRef: string;
  };
}

export type EvidenceEventValidationErrorCode =
  | "invalid_enum"
  | "invalid_json"
  | "invalid_type"
  | "missing_required"
  | "unknown_version";

export interface EvidenceEventValidationError {
  readonly code: EvidenceEventValidationErrorCode;
  readonly message: string;
  readonly path: string;
}

export type EvidenceEventValidationResult =
  | {
      readonly event: EvidenceEvent;
      readonly errors: readonly [];
      readonly success: true;
    }
  | {
      readonly errors: readonly EvidenceEventValidationError[];
      readonly success: false;
    };

export class EvidenceEventValidationFailure extends Error {
  readonly errors: readonly EvidenceEventValidationError[];

  constructor(errors: readonly EvidenceEventValidationError[]) {
    super("Invalid evidence event.");
    this.name = "EvidenceEventValidationFailure";
    this.errors = errors;
  }
}

const evidenceEventKinds = new Set<string>(EVIDENCE_EVENT_KINDS);
const sourceKinds = new Set<string>([
  "cli",
  "pass",
  "provider",
  "runtime",
  "validator",
]);
const privacyClasses = new Set<string>([
  "confidential",
  "internal",
  "public",
  "restricted",
  "secret",
  "unspecified",
]);
const replayModes = new Set<string>(["full_trace", "metadata", "none"]);
const redactionModes = new Set<string>(["none", "omitted", "redacted"]);
const detailKeysByKind: Readonly<Record<EvidenceEventKind, string>> = {
  capability_assumption: "capabilityAssumption",
  context_change: "contextChange",
  estimate: "estimate",
  pass_decision: "passDecision",
  policy_decision: "policyDecision",
  retry_fallback_decision: "retryFallbackDecision",
  routing_decision: "routingDecision",
  validator_result: "validatorResult",
  warning: "warning",
};

export function serializeEvidenceEvent(event: EvidenceEvent): string {
  return JSON.stringify(event);
}

export function parseEvidenceEvent(serialized: string): EvidenceEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new EvidenceEventValidationFailure([
      {
        code: "invalid_json",
        message: "Evidence event is not valid JSON.",
        path: "$",
      },
    ]);
  }

  const result = validateEvidenceEvent(parsed);

  if (!result.success) {
    throw new EvidenceEventValidationFailure(result.errors);
  }

  return result.event;
}

export function isEvidenceEvent(input: unknown): input is EvidenceEvent {
  return validateEvidenceEvent(input).success;
}

export function validateEvidenceEvent(
  input: unknown,
): EvidenceEventValidationResult {
  const errors: EvidenceEventValidationError[] = [];
  const event = requireRecord(input, "$", errors);

  if (event === undefined) {
    return { errors, success: false };
  }

  const version = requireString(event, "version", "$.version", errors);

  if (version !== undefined && version !== EVIDENCE_EVENT_VERSION) {
    errors.push({
      code: "unknown_version",
      message: "Unsupported evidence event version.",
      path: "$.version",
    });
  }

  const kind = requireString(event, "kind", "$.kind", errors);

  if (kind !== undefined && !evidenceEventKinds.has(kind)) {
    errors.push({
      code: "invalid_enum",
      message: "Unsupported evidence event kind.",
      path: "$.kind",
    });
  }

  requireString(event, "id", "$.id", errors);
  requireString(event, "summary", "$.summary", errors);
  validateSource(event, errors);
  validatePrivacy(event, errors);
  validateRedaction(event, errors);

  if (isEvidenceEventKind(kind)) {
    requireRecord(
      event[detailKeysByKind[kind]],
      `$.${detailKeysByKind[kind]}`,
      errors,
    );
  }

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    errors: [],
    event: input as EvidenceEvent,
    success: true,
  };
}

function validateSource(
  event: Readonly<Record<string, unknown>>,
  errors: EvidenceEventValidationError[],
): void {
  const source = requireRecord(event.source, "$.source", errors);

  if (source === undefined) {
    return;
  }

  requireEnum(source, "kind", "$.source.kind", sourceKinds, errors);
}

function validatePrivacy(
  event: Readonly<Record<string, unknown>>,
  errors: EvidenceEventValidationError[],
): void {
  const privacy = requireRecord(event.privacy, "$.privacy", errors);

  if (privacy === undefined) {
    return;
  }

  requireEnum(
    privacy,
    "privacyClass",
    "$.privacy.privacyClass",
    privacyClasses,
    errors,
  );
  requireEnum(
    privacy,
    "replayMode",
    "$.privacy.replayMode",
    replayModes,
    errors,
  );
}

function validateRedaction(
  event: Readonly<Record<string, unknown>>,
  errors: EvidenceEventValidationError[],
): void {
  const redaction = requireRecord(event.redaction, "$.redaction", errors);

  if (redaction === undefined) {
    return;
  }

  requireEnum(redaction, "mode", "$.redaction.mode", redactionModes, errors);
}

function requireEnum(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
  errors: EvidenceEventValidationError[],
): string | undefined {
  const value = requireString(parent, key, path, errors);

  if (value === undefined) {
    return undefined;
  }

  if (!allowed.has(value)) {
    errors.push({
      code: "invalid_enum",
      message: "Unsupported enum value.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireString(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: EvidenceEventValidationError[],
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

function requireRecord(
  value: unknown,
  path: string,
  errors: EvidenceEventValidationError[],
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEvidenceEventKind(
  value: string | undefined,
): value is EvidenceEventKind {
  return value !== undefined && evidenceEventKinds.has(value);
}
