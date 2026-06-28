import type { MIRPlanDiff, MIRPlanDiffEntry } from "./diff.js";
import {
  EVIDENCE_EVENT_KINDS,
  EVIDENCE_EVENT_VERSION,
  validateEvidenceEvent,
  type CapabilityAssumptionEvidenceEvent,
  type EstimateEvidenceEvent,
  type EvidenceEvent,
  type EvidenceEventSource,
  type EvidencePrivacyMetadata,
  type EvidenceRedactionMetadata,
  type PolicyDecisionEvidenceEvent,
  type RetryFallbackDecisionEvidenceEvent,
  type RoutingDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
} from "./evidence.js";
import type { PassContractVersion, PassIdentity, PassWarning } from "./pass.js";

export const EVIDENCE_BUNDLE_VERSION = "migaki.evidence-bundle.v0";

export type EvidenceBundleVersion = typeof EVIDENCE_BUNDLE_VERSION;

export const EVIDENCE_BUNDLE_EXPORT_MODES = [
  "full",
  "metadata_only",
  "redacted",
] as const;

export type EvidenceBundleExportMode =
  (typeof EVIDENCE_BUNDLE_EXPORT_MODES)[number];

export interface EvidenceBundlePlanRef {
  readonly hash?: string;
  readonly mediaType?: string;
  readonly planId: string;
  readonly ref?: string;
  readonly version: string;
}

export interface EvidenceBundlePassSummary extends PassIdentity {
  readonly contractVersion?: PassContractVersion;
  readonly enabled: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly warningCodes?: readonly string[];
}

export interface EvidenceBundleReplayHandle {
  readonly hash?: string;
  readonly kind: string;
  readonly mediaType?: string;
  readonly ref: string;
}

export interface EvidenceBundleReplayMetadata {
  readonly handles: readonly EvidenceBundleReplayHandle[];
  readonly mode: EvidencePrivacyMetadata["replayMode"];
  readonly notes?: readonly string[];
}

export interface EvidenceBundleRedactionRecord {
  readonly eventId?: string;
  readonly mode: EvidenceRedactionMetadata["mode"];
  readonly path: string;
  readonly privacyClass?: EvidencePrivacyMetadata["privacyClass"];
  readonly reason: string;
  readonly refs?: readonly string[];
}

export interface EvidenceBundleRedactedEvent {
  readonly id: string;
  readonly kind: EvidenceEvent["kind"];
  readonly privacy: EvidencePrivacyMetadata;
  readonly redaction: EvidenceRedactionMetadata;
  readonly refs?: readonly string[];
  readonly source: EvidenceEventSource;
  readonly summary: string;
  readonly version: typeof EVIDENCE_EVENT_VERSION;
}

export type EvidenceBundleEvent = EvidenceEvent | EvidenceBundleRedactedEvent;

export interface EvidenceBundle {
  readonly contextDiff: readonly MIRPlanDiffEntry[];
  readonly costEstimates: readonly EstimateEvidenceEvent[];
  readonly createdAt: string;
  readonly events: readonly EvidenceBundleEvent[];
  readonly exportMode: EvidenceBundleExportMode;
  readonly estimates: readonly EstimateEvidenceEvent[];
  readonly optimizedPlan: EvidenceBundlePlanRef;
  readonly originalPlan: EvidenceBundlePlanRef;
  readonly passes: readonly EvidenceBundlePassSummary[];
  readonly planDiff: MIRPlanDiff;
  readonly policyDecisions: readonly PolicyDecisionEvidenceEvent[];
  readonly providerAssumptions: readonly CapabilityAssumptionEvidenceEvent[];
  readonly redactions: readonly EvidenceBundleRedactionRecord[];
  readonly replay: EvidenceBundleReplayMetadata;
  readonly retryFallbackDecisions: readonly RetryFallbackDecisionEvidenceEvent[];
  readonly routingDecisions: readonly RoutingDecisionEvidenceEvent[];
  readonly runId: string;
  readonly validatorResults: readonly ValidatorResultEvidenceEvent[];
  readonly version: EvidenceBundleVersion;
  readonly warnings: readonly PassWarning[];
}

export interface CreateEvidenceBundleInput {
  readonly createdAt: string;
  readonly events: readonly EvidenceEvent[];
  readonly exportMode?: EvidenceBundleExportMode;
  readonly optimizedPlan: EvidenceBundlePlanRef;
  readonly originalPlan: EvidenceBundlePlanRef;
  readonly passes: readonly EvidenceBundlePassSummary[];
  readonly planDiff: MIRPlanDiff;
  readonly redactions?: readonly EvidenceBundleRedactionRecord[];
  readonly replay: EvidenceBundleReplayMetadata;
  readonly runId: string;
  readonly warnings: readonly PassWarning[];
}

export type EvidenceBundleValidationErrorCode =
  | "invalid_enum"
  | "invalid_json"
  | "invalid_type"
  | "missing_required"
  | "unknown_version";

export interface EvidenceBundleValidationError {
  readonly code: EvidenceBundleValidationErrorCode;
  readonly message: string;
  readonly path: string;
}

export type EvidenceBundleValidationResult =
  | {
      readonly bundle: EvidenceBundle;
      readonly errors: readonly [];
      readonly success: true;
    }
  | {
      readonly errors: readonly EvidenceBundleValidationError[];
      readonly success: false;
    };

export class EvidenceBundleValidationFailure extends Error {
  readonly errors: readonly EvidenceBundleValidationError[];

  constructor(errors: readonly EvidenceBundleValidationError[]) {
    super("Invalid evidence bundle.");
    this.name = "EvidenceBundleValidationFailure";
    this.errors = errors;
  }
}

const exportModes = new Set<string>(EVIDENCE_BUNDLE_EXPORT_MODES);
const eventKinds = new Set<string>(EVIDENCE_EVENT_KINDS);
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
const sensitivePrivacyClasses = new Set<
  EvidencePrivacyMetadata["privacyClass"]
>(["confidential", "restricted", "secret"]);

export function createEvidenceBundle(
  input: CreateEvidenceBundleInput,
): EvidenceBundle {
  const exportMode = input.exportMode ?? "full";
  const redactions: EvidenceBundleRedactionRecord[] = [
    ...(input.redactions ?? []),
  ];
  const events: EvidenceBundleEvent[] = [];

  for (const event of input.events) {
    if (
      exportMode === "metadata_only" &&
      event.privacy.replayMode === "full_trace"
    ) {
      redactions.push(createMetadataOnlyOmission(event));
      continue;
    }

    if (exportMode === "redacted" && shouldRedactEvent(event)) {
      redactions.push(createRedactedEventRecord(event));
      events.push(createRedactedEventShell(event));
      continue;
    }

    events.push(event);

    if (event.redaction.mode !== "none") {
      redactions.push(createDeclaredRedactionRecord(event));
    }
  }

  const fullEvents = events.filter(isFullEvidenceEvent);
  const estimates = collectEvents(fullEvents, "estimate");

  return {
    contextDiff: input.planDiff.changes.filter(
      (change) => change.artifactKind === "context",
    ),
    costEstimates: estimates.filter(
      (event) => event.estimate.estimateKind === "cost",
    ),
    createdAt: input.createdAt,
    events,
    exportMode,
    estimates,
    optimizedPlan: input.optimizedPlan,
    originalPlan: input.originalPlan,
    passes: input.passes,
    planDiff: input.planDiff,
    policyDecisions: collectEvents(fullEvents, "policy_decision"),
    providerAssumptions: collectEvents(fullEvents, "capability_assumption"),
    redactions,
    replay: input.replay,
    retryFallbackDecisions: collectEvents(
      fullEvents,
      "retry_fallback_decision",
    ),
    routingDecisions: collectEvents(fullEvents, "routing_decision"),
    runId: input.runId,
    validatorResults: collectEvents(fullEvents, "validator_result"),
    version: EVIDENCE_BUNDLE_VERSION,
    warnings: input.warnings,
  };
}

export function serializeEvidenceBundle(bundle: EvidenceBundle): string {
  return JSON.stringify(toStableJsonValue(bundle));
}

export function parseEvidenceBundle(serialized: string): EvidenceBundle {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new EvidenceBundleValidationFailure([
      {
        code: "invalid_json",
        message: "Evidence bundle is not valid JSON.",
        path: "$",
      },
    ]);
  }

  const result = validateEvidenceBundle(parsed);

  if (!result.success) {
    throw new EvidenceBundleValidationFailure(result.errors);
  }

  return result.bundle;
}

export function validateEvidenceBundle(
  input: unknown,
): EvidenceBundleValidationResult {
  const errors: EvidenceBundleValidationError[] = [];
  const bundle = requireRecord(input, "$", errors);

  if (bundle === undefined) {
    return { errors, success: false };
  }

  const version = requireString(bundle, "version", "$.version", errors);

  if (version !== undefined && version !== EVIDENCE_BUNDLE_VERSION) {
    errors.push({
      code: "unknown_version",
      message: "Unsupported evidence bundle version.",
      path: "$.version",
    });
  }

  requireString(bundle, "runId", "$.runId", errors);
  requireString(bundle, "createdAt", "$.createdAt", errors);
  requireEnum(bundle, "exportMode", "$.exportMode", exportModes, errors);
  validatePlanRef(bundle, "originalPlan", "$.originalPlan", errors);
  validatePlanRef(bundle, "optimizedPlan", "$.optimizedPlan", errors);
  requireRecord(bundle.planDiff, "$.planDiff", errors);
  requireRecord(bundle.replay, "$.replay", errors);

  for (const key of [
    "contextDiff",
    "costEstimates",
    "events",
    "estimates",
    "passes",
    "policyDecisions",
    "providerAssumptions",
    "redactions",
    "retryFallbackDecisions",
    "routingDecisions",
    "validatorResults",
    "warnings",
  ]) {
    requireArray(bundle, key, `$.${key}`, errors);
  }

  validateEvents(bundle.events, errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    bundle: input as EvidenceBundle,
    errors: [],
    success: true,
  };
}

function collectEvents<TKind extends EvidenceEvent["kind"]>(
  events: readonly EvidenceEvent[],
  kind: TKind,
): readonly Extract<EvidenceEvent, { kind: TKind }>[] {
  return events.filter(
    (event): event is Extract<EvidenceEvent, { kind: TKind }> =>
      event.kind === kind,
  );
}

function isFullEvidenceEvent(
  event: EvidenceBundleEvent,
): event is EvidenceEvent {
  return validateEvidenceEvent(event).success;
}

function shouldRedactEvent(event: EvidenceEvent): boolean {
  return (
    event.redaction.mode !== "none" ||
    sensitivePrivacyClasses.has(event.privacy.privacyClass)
  );
}

function createMetadataOnlyOmission(
  event: EvidenceEvent,
): EvidenceBundleRedactionRecord {
  return {
    eventId: event.id,
    mode: "omitted",
    path: eventPath(event),
    privacyClass: event.privacy.privacyClass,
    reason:
      "Event requires full trace replay and was omitted from metadata-only export.",
  };
}

function createDeclaredRedactionRecord(
  event: EvidenceEvent,
): EvidenceBundleRedactionRecord {
  return {
    eventId: event.id,
    mode: event.redaction.mode,
    path: eventPath(event),
    privacyClass: event.privacy.privacyClass,
    reason: event.redaction.reason ?? "Event declares redaction metadata.",
    ...(event.redaction.refs !== undefined
      ? { refs: event.redaction.refs }
      : {}),
  };
}

function createRedactedEventRecord(
  event: EvidenceEvent,
): EvidenceBundleRedactionRecord {
  return {
    eventId: event.id,
    mode: "redacted",
    path: eventPath(event),
    privacyClass: event.privacy.privacyClass,
    reason:
      event.redaction.reason ?? "Event privacy class requires redacted export.",
    ...(event.redaction.refs !== undefined
      ? { refs: event.redaction.refs }
      : {}),
  };
}

function createRedactedEventShell(
  event: EvidenceEvent,
): EvidenceBundleRedactedEvent {
  return {
    id: event.id,
    kind: event.kind,
    privacy: event.privacy,
    redaction: {
      mode: "redacted",
      reason:
        event.redaction.reason ??
        "Event privacy class requires redacted export.",
      ...(event.redaction.refs !== undefined
        ? { refs: event.redaction.refs }
        : {}),
    },
    ...(event.refs !== undefined ? { refs: event.refs } : {}),
    source: event.source,
    summary: `Redacted evidence event ${event.id}.`,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function validatePlanRef(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: EvidenceBundleValidationError[],
): void {
  const planRef = requireRecord(parent[key], path, errors);

  if (planRef === undefined) {
    return;
  }

  requireString(planRef, "planId", `${path}.planId`, errors);
  requireString(planRef, "version", `${path}.version`, errors);
}

function validateEvents(
  events: unknown,
  errors: EvidenceBundleValidationError[],
): void {
  if (!Array.isArray(events)) {
    return;
  }

  events.forEach((event, index) => {
    if (validateEvidenceEvent(event).success) {
      return;
    }

    validateRedactedEventShell(event, `$.events[${index}]`, errors);
  });
}

function validateRedactedEventShell(
  event: unknown,
  path: string,
  errors: EvidenceBundleValidationError[],
): void {
  const shell = requireRecord(event, path, errors);

  if (shell === undefined) {
    return;
  }

  const version = requireString(shell, "version", `${path}.version`, errors);

  if (version !== undefined && version !== EVIDENCE_EVENT_VERSION) {
    errors.push({
      code: "unknown_version",
      message: "Unsupported evidence event version.",
      path: `${path}.version`,
    });
  }

  requireString(shell, "id", `${path}.id`, errors);
  requireEnum(shell, "kind", `${path}.kind`, eventKinds, errors);
  requireString(shell, "summary", `${path}.summary`, errors);
  requireRecord(shell.source, `${path}.source`, errors);
  validatePrivacy(shell, path, errors);
  validateRedaction(shell, path, errors);
}

function validatePrivacy(
  event: Readonly<Record<string, unknown>>,
  path: string,
  errors: EvidenceBundleValidationError[],
): void {
  const privacy = requireRecord(event.privacy, `${path}.privacy`, errors);

  if (privacy === undefined) {
    return;
  }

  requireEnum(
    privacy,
    "privacyClass",
    `${path}.privacy.privacyClass`,
    privacyClasses,
    errors,
  );
  requireEnum(
    privacy,
    "replayMode",
    `${path}.privacy.replayMode`,
    replayModes,
    errors,
  );
}

function validateRedaction(
  event: Readonly<Record<string, unknown>>,
  path: string,
  errors: EvidenceBundleValidationError[],
): void {
  const redaction = requireRecord(event.redaction, `${path}.redaction`, errors);

  if (redaction === undefined) {
    return;
  }

  requireEnum(
    redaction,
    "mode",
    `${path}.redaction.mode`,
    redactionModes,
    errors,
  );
}

function requireEnum(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
  errors: EvidenceBundleValidationError[],
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
  errors: EvidenceBundleValidationError[],
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
  errors: EvidenceBundleValidationError[],
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
  errors: EvidenceBundleValidationError[],
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

function eventPath(event: EvidenceEvent): string {
  return `$.events[?(@.id==${JSON.stringify(event.id)})]`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
