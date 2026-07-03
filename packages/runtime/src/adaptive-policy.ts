import type {
  EvidencePrivacyMetadata,
  EvidenceRedactionMetadata,
} from "./evidence.js";

export const META_OBSERVATION_VERSION = "migaki.meta-observation.v0";
export const ADAPTIVE_POLICY_DIFF_VERSION = "migaki.policy-diff.v0";
export const ADAPTIVE_POLICY_PROPOSAL_VERSION = "migaki.policy-proposal.v0";
export const ADAPTIVE_POLICY_BUNDLE_VERSION = "migaki.policy-bundle.v0";

export type MetaObservationVersion = typeof META_OBSERVATION_VERSION;
export type AdaptivePolicyDiffVersion = typeof ADAPTIVE_POLICY_DIFF_VERSION;
export type AdaptivePolicyProposalVersion =
  typeof ADAPTIVE_POLICY_PROPOSAL_VERSION;
export type AdaptivePolicyBundleVersion = typeof ADAPTIVE_POLICY_BUNDLE_VERSION;

export const META_OBSERVATION_SIGNALS = [
  "advice_emitted",
  "advice_injected",
  "advice_outcome_observed",
  "opportunity_observed",
  "policy_applied",
  "policy_proposed",
  "policy_validated",
] as const;

export type MetaObservationSignal = (typeof META_OBSERVATION_SIGNALS)[number];

export const META_OBSERVATION_SOURCE_KINDS = [
  "advice",
  "codex_wrapper",
  "execution_report",
  "policy_validator",
] as const;

export type MetaObservationSourceKind =
  (typeof META_OBSERVATION_SOURCE_KINDS)[number];

export const META_OBSERVATION_SUBJECT_KINDS = [
  "advice",
  "opportunity",
  "policy",
  "run",
] as const;

export type MetaObservationSubjectKind =
  (typeof META_OBSERVATION_SUBJECT_KINDS)[number];

export interface MetaObservationSource {
  readonly kind: MetaObservationSourceKind;
  readonly runId?: string;
}

export interface MetaObservationSubject {
  readonly kind: MetaObservationSubjectKind;
  readonly ref: string;
  readonly safeLabel?: string;
}

export interface MetaObservation {
  readonly evidenceRefs: readonly string[];
  readonly id: string;
  readonly observedAt: string;
  readonly privacy: EvidencePrivacyMetadata;
  readonly redaction: EvidenceRedactionMetadata;
  readonly signal: MetaObservationSignal;
  readonly source: MetaObservationSource;
  readonly subject: MetaObservationSubject;
  readonly summary: string;
  readonly version: MetaObservationVersion;
}

export const ADAPTIVE_POLICY_SCOPES = ["advice"] as const;

export type AdaptivePolicyScope = (typeof ADAPTIVE_POLICY_SCOPES)[number];

export const ADAPTIVE_POLICY_RULE_TARGETS = [
  "advice_ranking",
  "advice_suppression",
  "advice_wording",
] as const;

export type AdaptivePolicyRuleTarget =
  (typeof ADAPTIVE_POLICY_RULE_TARGETS)[number];

export const ADAPTIVE_POLICY_ACTION_KINDS = [
  "annotate",
  "deemphasize",
  "emphasize",
  "suppress",
] as const;

export type AdaptivePolicyActionKind =
  (typeof ADAPTIVE_POLICY_ACTION_KINDS)[number];

export interface AdaptivePolicyRuleMatch {
  readonly actionability?: string;
  readonly category?: string;
  readonly signal?: MetaObservationSignal;
}

export interface AdaptivePolicyRuleAction {
  readonly kind: AdaptivePolicyActionKind;
  readonly note?: string;
  readonly weightDelta?: number;
}

export interface AdaptivePolicyRule {
  readonly action: AdaptivePolicyRuleAction;
  readonly description: string;
  readonly enabled: boolean;
  readonly evidenceRefs: readonly string[];
  readonly id: string;
  readonly match: AdaptivePolicyRuleMatch;
  readonly target: AdaptivePolicyRuleTarget;
}

export const ADAPTIVE_POLICY_DIFF_OPERATIONS = [
  "add_rule",
  "remove_rule",
  "update_rule",
] as const;

export type AdaptivePolicyDiffOperation =
  (typeof ADAPTIVE_POLICY_DIFF_OPERATIONS)[number];

export const ADAPTIVE_POLICY_RISK_LEVELS = ["low", "medium", "high"] as const;

export type AdaptivePolicyRiskLevel =
  (typeof ADAPTIVE_POLICY_RISK_LEVELS)[number];

export interface AdaptivePolicyDiffChange {
  readonly after?: unknown;
  readonly before?: unknown;
  readonly evidenceRefs: readonly string[];
  readonly operation: AdaptivePolicyDiffOperation;
  readonly path: string;
  readonly rationale: string;
  readonly risk: AdaptivePolicyRiskLevel;
}

export interface AdaptivePolicyDiff {
  readonly changes: readonly AdaptivePolicyDiffChange[];
  readonly createdAt: string;
  readonly id: string;
  readonly summary: string;
  readonly version: AdaptivePolicyDiffVersion;
}

export const ADAPTIVE_POLICY_PROPOSAL_STATUSES = [
  "proposed",
  "rejected",
  "validated",
] as const;

export type AdaptivePolicyProposalStatus =
  (typeof ADAPTIVE_POLICY_PROPOSAL_STATUSES)[number];

export const ADAPTIVE_POLICY_VALIDATION_STATUSES = [
  "failed",
  "not_run",
  "passed",
] as const;

export type AdaptivePolicyValidationStatus =
  (typeof ADAPTIVE_POLICY_VALIDATION_STATUSES)[number];

export interface AdaptivePolicyCreatedFrom {
  readonly metaObservationIds: readonly string[];
  readonly policyBundleIds?: readonly string[];
  readonly runIds?: readonly string[];
}

export interface AdaptivePolicyProposalValidation {
  readonly status: AdaptivePolicyValidationStatus;
  readonly validatorRefs: readonly string[];
}

export const ADAPTIVE_POLICY_EFFECT_MODES = ["advice_only"] as const;

export type AdaptivePolicyEffectMode =
  (typeof ADAPTIVE_POLICY_EFFECT_MODES)[number];

export const ADAPTIVE_POLICY_PROHIBITED_EFFECTS = [
  "cache",
  "parallelize",
  "replay",
  "skip_reads",
] as const;

export type AdaptivePolicyProhibitedEffect =
  (typeof ADAPTIVE_POLICY_PROHIBITED_EFFECTS)[number];

export interface AdaptivePolicySafety {
  readonly effectMode: AdaptivePolicyEffectMode;
  readonly prohibitedEffects: readonly AdaptivePolicyProhibitedEffect[];
  readonly rollback: string;
}

export interface AdaptivePolicyProposal {
  readonly createdAt: string;
  readonly createdFrom: AdaptivePolicyCreatedFrom;
  readonly diff: AdaptivePolicyDiff;
  readonly id: string;
  readonly privacy: EvidencePrivacyMetadata;
  readonly rationale: string;
  readonly redaction: EvidenceRedactionMetadata;
  readonly safety: AdaptivePolicySafety;
  readonly scope: AdaptivePolicyScope;
  readonly status: AdaptivePolicyProposalStatus;
  readonly summary: string;
  readonly validation: AdaptivePolicyProposalValidation;
  readonly version: AdaptivePolicyProposalVersion;
}

export const ADAPTIVE_POLICY_BUNDLE_STATUSES = [
  "accepted",
  "disabled",
  "superseded",
] as const;

export type AdaptivePolicyBundleStatus =
  (typeof ADAPTIVE_POLICY_BUNDLE_STATUSES)[number];

export interface AdaptivePolicyBundleCreatedFrom {
  readonly metaObservationIds: readonly string[];
  readonly policyDiffId: string;
  readonly proposalId: string;
}

export interface AdaptivePolicyBundle {
  readonly acceptedAt?: string;
  readonly createdAt: string;
  readonly createdFrom: AdaptivePolicyBundleCreatedFrom;
  readonly evidenceRefs: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly privacy: EvidencePrivacyMetadata;
  readonly redaction: EvidenceRedactionMetadata;
  readonly rules: readonly AdaptivePolicyRule[];
  readonly safety: AdaptivePolicySafety;
  readonly scope: AdaptivePolicyScope;
  readonly status: AdaptivePolicyBundleStatus;
  readonly version: AdaptivePolicyBundleVersion;
}

export type AdaptivePolicyValidationErrorCode =
  | "invalid_enum"
  | "invalid_json"
  | "invalid_type"
  | "missing_required"
  | "unsafe_effect"
  | "unknown_version";

export interface AdaptivePolicyValidationError {
  readonly code: AdaptivePolicyValidationErrorCode;
  readonly message: string;
  readonly path: string;
}

export type MetaObservationValidationResult =
  | {
      readonly errors: readonly [];
      readonly metaObservation: MetaObservation;
      readonly success: true;
    }
  | {
      readonly errors: readonly AdaptivePolicyValidationError[];
      readonly success: false;
    };

export type AdaptivePolicyProposalValidationResult =
  | {
      readonly errors: readonly [];
      readonly proposal: AdaptivePolicyProposal;
      readonly success: true;
    }
  | {
      readonly errors: readonly AdaptivePolicyValidationError[];
      readonly success: false;
    };

export type AdaptivePolicyBundleValidationResult =
  | {
      readonly bundle: AdaptivePolicyBundle;
      readonly errors: readonly [];
      readonly success: true;
    }
  | {
      readonly errors: readonly AdaptivePolicyValidationError[];
      readonly success: false;
    };

export class AdaptivePolicyValidationFailure extends Error {
  readonly errors: readonly AdaptivePolicyValidationError[];

  constructor(errors: readonly AdaptivePolicyValidationError[]) {
    super("Invalid adaptive policy artifact.");
    this.name = "AdaptivePolicyValidationFailure";
    this.errors = errors;
  }
}

const metaObservationSignals = new Set<string>(META_OBSERVATION_SIGNALS);
const metaObservationSourceKinds = new Set<string>(
  META_OBSERVATION_SOURCE_KINDS,
);
const metaObservationSubjectKinds = new Set<string>(
  META_OBSERVATION_SUBJECT_KINDS,
);
const adaptivePolicyScopes = new Set<string>(ADAPTIVE_POLICY_SCOPES);
const adaptivePolicyRuleTargets = new Set<string>(ADAPTIVE_POLICY_RULE_TARGETS);
const adaptivePolicyActionKinds = new Set<string>(ADAPTIVE_POLICY_ACTION_KINDS);
const adaptivePolicyDiffOperations = new Set<string>(
  ADAPTIVE_POLICY_DIFF_OPERATIONS,
);
const adaptivePolicyRiskLevels = new Set<string>(ADAPTIVE_POLICY_RISK_LEVELS);
const adaptivePolicyProposalStatuses = new Set<string>(
  ADAPTIVE_POLICY_PROPOSAL_STATUSES,
);
const adaptivePolicyValidationStatuses = new Set<string>(
  ADAPTIVE_POLICY_VALIDATION_STATUSES,
);
const adaptivePolicyEffectModes = new Set<string>(ADAPTIVE_POLICY_EFFECT_MODES);
const adaptivePolicyProhibitedEffects = new Set<string>(
  ADAPTIVE_POLICY_PROHIBITED_EFFECTS,
);
const adaptivePolicyBundleStatuses = new Set<string>(
  ADAPTIVE_POLICY_BUNDLE_STATUSES,
);
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

export function serializeMetaObservation(
  metaObservation: MetaObservation,
): string {
  return JSON.stringify(toStableJsonValue(metaObservation));
}

export function parseMetaObservation(serialized: string): MetaObservation {
  const parsed = parseJson(serialized, "Meta-observation");
  const result = validateMetaObservation(parsed);

  if (!result.success) {
    throw new AdaptivePolicyValidationFailure(result.errors);
  }

  return result.metaObservation;
}

export function validateMetaObservation(
  input: unknown,
): MetaObservationValidationResult {
  const errors: AdaptivePolicyValidationError[] = [];
  const observation = requireRecord(input, "$", errors);

  if (observation === undefined) {
    return { errors, success: false };
  }

  validateVersion(
    observation,
    META_OBSERVATION_VERSION,
    "Unsupported meta-observation version.",
    errors,
  );
  requireString(observation, "id", "$.id", errors);
  requireString(observation, "observedAt", "$.observedAt", errors);
  requireString(observation, "summary", "$.summary", errors);
  requireEnum(
    observation,
    "signal",
    "$.signal",
    metaObservationSignals,
    errors,
  );
  requireStringArray(observation, "evidenceRefs", "$.evidenceRefs", errors);
  validateMetaObservationSource(observation.source, "$.source", errors);
  validateMetaObservationSubject(observation.subject, "$.subject", errors);
  validatePrivacy(observation, "$", errors);
  validateRedaction(observation, "$", errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    errors: [],
    metaObservation: input as MetaObservation,
    success: true,
  };
}

export function serializeAdaptivePolicyProposal(
  proposal: AdaptivePolicyProposal,
): string {
  return JSON.stringify(toStableJsonValue(proposal));
}

export function parseAdaptivePolicyProposal(
  serialized: string,
): AdaptivePolicyProposal {
  const parsed = parseJson(serialized, "Adaptive policy proposal");
  const result = validateAdaptivePolicyProposal(parsed);

  if (!result.success) {
    throw new AdaptivePolicyValidationFailure(result.errors);
  }

  return result.proposal;
}

export function validateAdaptivePolicyProposal(
  input: unknown,
): AdaptivePolicyProposalValidationResult {
  const errors: AdaptivePolicyValidationError[] = [];
  const proposal = requireRecord(input, "$", errors);

  if (proposal === undefined) {
    return { errors, success: false };
  }

  validateVersion(
    proposal,
    ADAPTIVE_POLICY_PROPOSAL_VERSION,
    "Unsupported adaptive policy proposal version.",
    errors,
  );
  requireString(proposal, "id", "$.id", errors);
  requireString(proposal, "createdAt", "$.createdAt", errors);
  requireString(proposal, "summary", "$.summary", errors);
  requireString(proposal, "rationale", "$.rationale", errors);
  requireEnum(proposal, "scope", "$.scope", adaptivePolicyScopes, errors);
  requireEnum(
    proposal,
    "status",
    "$.status",
    adaptivePolicyProposalStatuses,
    errors,
  );
  validateCreatedFrom(proposal.createdFrom, "$.createdFrom", errors);
  validatePolicyDiff(proposal.diff, "$.diff", errors);
  validateProposalValidation(proposal.validation, "$.validation", errors);
  validateSafety(proposal.safety, "$.safety", errors);
  validatePrivacy(proposal, "$", errors);
  validateRedaction(proposal, "$", errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    errors: [],
    proposal: input as AdaptivePolicyProposal,
    success: true,
  };
}

export function serializeAdaptivePolicyBundle(
  bundle: AdaptivePolicyBundle,
): string {
  return JSON.stringify(toStableJsonValue(bundle));
}

export function parseAdaptivePolicyBundle(
  serialized: string,
): AdaptivePolicyBundle {
  const parsed = parseJson(serialized, "Adaptive policy bundle");
  const result = validateAdaptivePolicyBundle(parsed);

  if (!result.success) {
    throw new AdaptivePolicyValidationFailure(result.errors);
  }

  return result.bundle;
}

export function validateAdaptivePolicyBundle(
  input: unknown,
): AdaptivePolicyBundleValidationResult {
  const errors: AdaptivePolicyValidationError[] = [];
  const bundle = requireRecord(input, "$", errors);

  if (bundle === undefined) {
    return { errors, success: false };
  }

  validateVersion(
    bundle,
    ADAPTIVE_POLICY_BUNDLE_VERSION,
    "Unsupported adaptive policy bundle version.",
    errors,
  );
  requireString(bundle, "id", "$.id", errors);
  requireString(bundle, "name", "$.name", errors);
  requireString(bundle, "createdAt", "$.createdAt", errors);
  requireEnum(bundle, "scope", "$.scope", adaptivePolicyScopes, errors);
  requireEnum(
    bundle,
    "status",
    "$.status",
    adaptivePolicyBundleStatuses,
    errors,
  );
  validateBundleCreatedFrom(bundle.createdFrom, "$.createdFrom", errors);
  validateRules(bundle.rules, "$.rules", errors);
  requireStringArray(bundle, "evidenceRefs", "$.evidenceRefs", errors);
  validateSafety(bundle.safety, "$.safety", errors);
  validatePrivacy(bundle, "$", errors);
  validateRedaction(bundle, "$", errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    bundle: input as AdaptivePolicyBundle,
    errors: [],
    success: true,
  };
}

function validateMetaObservationSource(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const source = requireRecord(value, path, errors);

  if (source === undefined) {
    return;
  }

  requireEnum(
    source,
    "kind",
    `${path}.kind`,
    metaObservationSourceKinds,
    errors,
  );
}

function validateMetaObservationSubject(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const subject = requireRecord(value, path, errors);

  if (subject === undefined) {
    return;
  }

  requireEnum(
    subject,
    "kind",
    `${path}.kind`,
    metaObservationSubjectKinds,
    errors,
  );
  requireString(subject, "ref", `${path}.ref`, errors);
}

function validateCreatedFrom(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const createdFrom = requireRecord(value, path, errors);

  if (createdFrom === undefined) {
    return;
  }

  requireStringArray(
    createdFrom,
    "metaObservationIds",
    `${path}.metaObservationIds`,
    errors,
  );
}

function validateBundleCreatedFrom(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const createdFrom = requireRecord(value, path, errors);

  if (createdFrom === undefined) {
    return;
  }

  requireString(createdFrom, "proposalId", `${path}.proposalId`, errors);
  requireString(createdFrom, "policyDiffId", `${path}.policyDiffId`, errors);
  requireStringArray(
    createdFrom,
    "metaObservationIds",
    `${path}.metaObservationIds`,
    errors,
  );
}

function validatePolicyDiff(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const diff = requireRecord(value, path, errors);

  if (diff === undefined) {
    return;
  }

  validateVersion(
    diff,
    ADAPTIVE_POLICY_DIFF_VERSION,
    "Unsupported adaptive policy diff version.",
    errors,
    path,
  );
  requireString(diff, "id", `${path}.id`, errors);
  requireString(diff, "createdAt", `${path}.createdAt`, errors);
  requireString(diff, "summary", `${path}.summary`, errors);
  const changes = requireArray(diff, "changes", `${path}.changes`, errors);

  if (changes === undefined) {
    return;
  }

  changes.forEach((change, index) => {
    validatePolicyDiffChange(change, `${path}.changes[${index}]`, errors);
  });
}

function validatePolicyDiffChange(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const change = requireRecord(value, path, errors);

  if (change === undefined) {
    return;
  }

  requireEnum(
    change,
    "operation",
    `${path}.operation`,
    adaptivePolicyDiffOperations,
    errors,
  );
  requireEnum(change, "risk", `${path}.risk`, adaptivePolicyRiskLevels, errors);
  requireString(change, "path", `${path}.path`, errors);
  requireString(change, "rationale", `${path}.rationale`, errors);
  requireStringArray(change, "evidenceRefs", `${path}.evidenceRefs`, errors);
}

function validateProposalValidation(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const validation = requireRecord(value, path, errors);

  if (validation === undefined) {
    return;
  }

  requireEnum(
    validation,
    "status",
    `${path}.status`,
    adaptivePolicyValidationStatuses,
    errors,
  );
  requireStringArray(
    validation,
    "validatorRefs",
    `${path}.validatorRefs`,
    errors,
  );
}

function validateRules(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const rules = requireArrayValue(value, path, errors);

  if (rules === undefined) {
    return;
  }

  rules.forEach((rule, index) => {
    validateRule(rule, `${path}[${index}]`, errors);
  });
}

function validateRule(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const rule = requireRecord(value, path, errors);

  if (rule === undefined) {
    return;
  }

  requireString(rule, "id", `${path}.id`, errors);
  requireString(rule, "description", `${path}.description`, errors);
  requireBoolean(rule, "enabled", `${path}.enabled`, errors);
  requireEnum(
    rule,
    "target",
    `${path}.target`,
    adaptivePolicyRuleTargets,
    errors,
  );
  requireRecord(rule.match, `${path}.match`, errors);
  validateRuleAction(rule.action, `${path}.action`, errors);
  requireStringArray(rule, "evidenceRefs", `${path}.evidenceRefs`, errors);
}

function validateRuleAction(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const action = requireRecord(value, path, errors);

  if (action === undefined) {
    return;
  }

  requireEnum(
    action,
    "kind",
    `${path}.kind`,
    adaptivePolicyActionKinds,
    errors,
  );
}

function validateSafety(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const safety = requireRecord(value, path, errors);

  if (safety === undefined) {
    return;
  }

  requireEnum(
    safety,
    "effectMode",
    `${path}.effectMode`,
    adaptivePolicyEffectModes,
    errors,
  );
  const effects = requireStringArray(
    safety,
    "prohibitedEffects",
    `${path}.prohibitedEffects`,
    errors,
  );
  requireString(safety, "rollback", `${path}.rollback`, errors);

  if (effects === undefined) {
    return;
  }

  effects.forEach((effect, index) => {
    if (!adaptivePolicyProhibitedEffects.has(effect)) {
      errors.push({
        code: "invalid_enum",
        message: "Unsupported enum value.",
        path: `${path}.prohibitedEffects[${index}]`,
      });
    }
  });

  for (const prohibitedEffect of ADAPTIVE_POLICY_PROHIBITED_EFFECTS) {
    if (!effects.includes(prohibitedEffect)) {
      errors.push({
        code: "unsafe_effect",
        message: `Adaptive policy artifacts must forbid ${prohibitedEffect} effects.`,
        path: `${path}.prohibitedEffects`,
      });
    }
  }
}

function validatePrivacy(
  parent: Readonly<Record<string, unknown>>,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const privacy = requireRecord(parent.privacy, `${path}.privacy`, errors);

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
  parent: Readonly<Record<string, unknown>>,
  path: string,
  errors: AdaptivePolicyValidationError[],
): void {
  const redaction = requireRecord(
    parent.redaction,
    `${path}.redaction`,
    errors,
  );

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

function validateVersion(
  parent: Readonly<Record<string, unknown>>,
  expectedVersion: string,
  message: string,
  errors: AdaptivePolicyValidationError[],
  basePath = "$",
): void {
  const version = requireString(
    parent,
    "version",
    `${basePath}.version`,
    errors,
  );

  if (version !== undefined && version !== expectedVersion) {
    errors.push({
      code: "unknown_version",
      message,
      path: `${basePath}.version`,
    });
  }
}

function parseJson(serialized: string, artifactName: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new AdaptivePolicyValidationFailure([
      {
        code: "invalid_json",
        message: `${artifactName} is not valid JSON.`,
        path: "$",
      },
    ]);
  }
}

function requireEnum(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
  errors: AdaptivePolicyValidationError[],
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
  errors: AdaptivePolicyValidationError[],
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

function requireBoolean(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: AdaptivePolicyValidationError[],
): boolean | undefined {
  const value = parent[key];

  if (value === undefined) {
    errors.push({
      code: "missing_required",
      message: "Missing required boolean.",
      path,
    });
    return undefined;
  }

  if (typeof value !== "boolean") {
    errors.push({
      code: "invalid_type",
      message: "Expected boolean.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireStringArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: AdaptivePolicyValidationError[],
): readonly string[] | undefined {
  const values = requireArray(parent, key, path, errors);

  if (values === undefined) {
    return undefined;
  }

  values.forEach((value, index) => {
    if (typeof value !== "string") {
      errors.push({
        code: "invalid_type",
        message: "Expected string.",
        path: `${path}[${index}]`,
      });
    }
  });

  if (values.every((value) => typeof value === "string")) {
    return values as readonly string[];
  }

  return undefined;
}

function requireArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: AdaptivePolicyValidationError[],
): readonly unknown[] | undefined {
  return requireArrayValue(parent[key], path, errors);
}

function requireArrayValue(
  value: unknown,
  path: string,
  errors: AdaptivePolicyValidationError[],
): readonly unknown[] | undefined {
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
  errors: AdaptivePolicyValidationError[],
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
    return value.map(toStableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
