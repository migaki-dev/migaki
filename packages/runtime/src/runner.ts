import type { MIRPlan } from "@migaki/mir";
import type { ProviderCapabilities } from "@migaki/providers";

import type {
  OptimizationPass,
  PassContext,
  PassEvidenceFragment,
  PassIdentity,
  PassResult,
  PassWarning,
} from "./pass.js";

export const PASS_RUNNER_VERSION = "migaki.pass-runner.v0";

export type PassRunnerVersion = typeof PASS_RUNNER_VERSION;

export interface PassRunnerClock {
  now(): number;
}

export type PassFailurePolicy = "continue" | "stop";

export interface DisabledPass {
  readonly name: string;
  readonly reason?: string;
  readonly version?: string;
}

export interface PassRunnerOptions {
  readonly clock: PassRunnerClock;
  readonly disabledPasses?: readonly DisabledPass[];
  readonly failurePolicy?: PassFailurePolicy;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly providerCapabilities?: readonly ProviderCapabilities[];
  readonly runId: string;
}

export interface PassRunReport {
  readonly completedAt: string;
  readonly durationMs: number;
  readonly evidence: readonly PassEvidenceFragment[];
  readonly passes: readonly PassRunRecord[];
  readonly plan: MIRPlan;
  readonly runId: string;
  readonly startedAt: string;
  readonly version: PassRunnerVersion;
  readonly warnings: readonly PassWarning[];
}

export type PassRunRecord =
  | DisabledPassRunRecord
  | FailedPassRunRecord
  | SuccessfulPassRunRecord;

interface BasePassRunRecord {
  readonly completedAt: string;
  readonly durationMs: number;
  readonly enabled: boolean;
  readonly evidence: readonly PassEvidenceFragment[];
  readonly pass: PassIdentity;
  readonly startedAt: string;
  readonly warnings: readonly PassWarning[];
}

export interface SuccessfulPassRunRecord extends BasePassRunRecord {
  readonly enabled: true;
  readonly result: PassResult;
}

export interface FailedPassRunRecord extends BasePassRunRecord {
  readonly enabled: true;
  readonly error: PassRunError;
}

export interface DisabledPassRunRecord extends BasePassRunRecord {
  readonly enabled: false;
  readonly reason?: string;
}

export interface PassRunError {
  readonly message: string;
  readonly name?: string;
}

export async function runOptimizationPasses(
  plan: MIRPlan,
  passes: readonly OptimizationPass[],
  options: PassRunnerOptions,
): Promise<PassRunReport> {
  const startedAtMs = options.clock.now();
  const records: PassRunRecord[] = [];
  const evidence: PassEvidenceFragment[] = [];
  const warnings: PassWarning[] = [];
  let currentPlan = plan;

  for (const pass of passes) {
    const disabled = findDisabledPass(pass, options.disabledPasses ?? []);

    if (disabled !== undefined) {
      const disabledAtMs = options.clock.now();
      records.push(createDisabledRecord(pass, disabled, disabledAtMs));
      continue;
    }

    const passStartedAtMs = options.clock.now();
    const passStartedAt = toIsoString(passStartedAtMs);

    try {
      const result = await pass.apply(
        currentPlan,
        createPassContext(options, passStartedAt, evidence),
      );
      const passCompletedAtMs = options.clock.now();
      currentPlan = result.plan;
      evidence.push(...result.evidence);
      warnings.push(...result.warnings);
      records.push({
        durationMs: passCompletedAtMs - passStartedAtMs,
        enabled: true,
        evidence: result.evidence,
        pass: toPassIdentity(pass),
        result,
        startedAt: passStartedAt,
        completedAt: toIsoString(passCompletedAtMs),
        warnings: result.warnings,
      });
    } catch (error) {
      const passCompletedAtMs = options.clock.now();
      records.push({
        durationMs: passCompletedAtMs - passStartedAtMs,
        enabled: true,
        error: toPassRunError(error),
        evidence: [],
        pass: toPassIdentity(pass),
        startedAt: passStartedAt,
        completedAt: toIsoString(passCompletedAtMs),
        warnings: [],
      });

      if ((options.failurePolicy ?? "stop") === "stop") {
        break;
      }
    }
  }

  const completedAtMs = options.clock.now();

  return {
    completedAt: toIsoString(completedAtMs),
    durationMs: completedAtMs - startedAtMs,
    evidence,
    passes: records,
    plan: currentPlan,
    runId: options.runId,
    startedAt: toIsoString(startedAtMs),
    version: PASS_RUNNER_VERSION,
    warnings,
  };
}

function createPassContext(
  options: PassRunnerOptions,
  startedAt: string,
  evidence: readonly PassEvidenceFragment[],
): PassContext {
  const context: PassContext = {
    previousEvidenceRefs: evidence.map((fragment) => fragment.id),
    runId: options.runId,
    startedAt,
  };

  if (options.metadata !== undefined) {
    return {
      ...context,
      metadata: options.metadata,
      ...(options.providerCapabilities !== undefined
        ? { providerCapabilities: options.providerCapabilities }
        : {}),
    };
  }

  if (options.providerCapabilities !== undefined) {
    return {
      ...context,
      providerCapabilities: options.providerCapabilities,
    };
  }

  return context;
}

function createDisabledRecord(
  pass: OptimizationPass,
  disabled: DisabledPass,
  disabledAtMs: number,
): DisabledPassRunRecord {
  const record: DisabledPassRunRecord = {
    completedAt: toIsoString(disabledAtMs),
    durationMs: 0,
    enabled: false,
    evidence: [],
    pass: toPassIdentity(pass),
    startedAt: toIsoString(disabledAtMs),
    warnings: [],
  };

  if (disabled.reason === undefined) {
    return record;
  }

  return {
    ...record,
    reason: disabled.reason,
  };
}

function findDisabledPass(
  pass: OptimizationPass,
  disabledPasses: readonly DisabledPass[],
): DisabledPass | undefined {
  return disabledPasses.find(
    (disabled) =>
      disabled.name === pass.name &&
      (disabled.version === undefined || disabled.version === pass.version),
  );
}

function toPassIdentity(pass: OptimizationPass): PassIdentity {
  return {
    name: pass.name,
    version: pass.version,
  };
}

function toPassRunError(error: unknown): PassRunError {
  if (error instanceof Error) {
    if (error.name === "") {
      return {
        message: error.message,
      };
    }

    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}

function toIsoString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
