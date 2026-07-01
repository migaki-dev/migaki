import { createHash } from "node:crypto";

import {
  MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION,
  OPENAI_AGENTS_SDK_VERSION,
  type MigakiCacheKey,
} from "./types.js";

export const MIGAKI_HASH_ALGORITHM = "sha256";

export interface ModelCallCacheKeyInput {
  readonly instrumentationVersion?: string | undefined;
  readonly modelName: string;
  readonly modelParams?: unknown | undefined;
  readonly normalizedInput: unknown;
  readonly outputSchema?: unknown | undefined;
  readonly sdkPackageVersion?: string | undefined;
}

export interface ToolCallCacheKeyInput {
  readonly instrumentationVersion?: string | undefined;
  readonly sdkPackageVersion?: string | undefined;
  readonly toolArgs: unknown;
  readonly toolName: string;
  readonly toolVersion?: string | undefined;
}

export interface MigakiHashEvidence {
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly runtimeHash: string;
}

export function createModelCallCacheKey(
  input: ModelCallCacheKeyInput,
): MigakiCacheKey {
  const evidence = createModelCallHashEvidence(input);

  return {
    dependencyHash: evidence.dependencyHash,
    inputHash: evidence.inputHash,
    name: input.modelName,
    op: "model_call",
    runtimeHash: evidence.runtimeHash,
  };
}

export function createToolCallCacheKey(
  input: ToolCallCacheKeyInput,
): MigakiCacheKey {
  const evidence = createToolCallHashEvidence(input);

  return {
    dependencyHash: evidence.dependencyHash,
    inputHash: evidence.inputHash,
    name: input.toolName,
    op: "tool_call",
    runtimeHash: evidence.runtimeHash,
  };
}

export function createModelCallHashEvidence(
  input: ModelCallCacheKeyInput,
): MigakiHashEvidence {
  return {
    dependencyHash: stableHash({
      modelName: input.modelName,
      modelParams: input.modelParams ?? null,
      outputSchema: input.outputSchema ?? null,
    }),
    inputHash: stableHash(input.normalizedInput),
    runtimeHash: createRuntimeHash(input),
  };
}

export function createToolCallHashEvidence(
  input: ToolCallCacheKeyInput,
): MigakiHashEvidence {
  return {
    dependencyHash: stableHash({
      toolName: input.toolName,
      toolVersion: input.toolVersion ?? null,
    }),
    inputHash: stableHash(input.toolArgs),
    runtimeHash: createRuntimeHash(input),
  };
}

export function createRuntimeHash(input: {
  readonly instrumentationVersion?: string | undefined;
  readonly sdkPackageVersion?: string | undefined;
}): string {
  return stableHash({
    instrumentationVersion:
      input.instrumentationVersion ?? MIGAKI_AGENTS_JS_INSTRUMENTATION_VERSION,
    sdkPackageVersion: input.sdkPackageVersion ?? OPENAI_AGENTS_SDK_VERSION,
  });
}

export function stableHash(value: unknown): string {
  return `${MIGAKI_HASH_ALGORITHM}:${createHash(MIGAKI_HASH_ALGORITHM)
    .update(serializeStableJson(value))
    .digest("hex")}`;
}

export function serializeStableJson(value: unknown, space?: number): string {
  return JSON.stringify(toStableJsonValue(value), null, space);
}

export function toStableJsonValue(value: unknown): unknown {
  return normalizeStableJsonValue(value, new WeakSet<object>());
}

function normalizeStableJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }

  if (typeof value === "function") {
    return { $function: value.name || "anonymous" };
  }

  if (typeof value === "symbol") {
    return { $symbol: String(value) };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return { $circular: true };
    }

    seen.add(value);
    const normalized = value.map((item) =>
      normalizeStableJsonValue(item, seen),
    );
    seen.delete(value);

    return normalized;
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return { $circular: true };
  }

  seen.add(value);
  const stable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    const child = value[key];

    if (child !== undefined) {
      stable[key] = normalizeStableJsonValue(child, seen);
    }
  }

  seen.delete(value);

  return stable;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
