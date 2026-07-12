import { REUSE_DECISION_ARTIFACT_VERSION } from "./observed-trajectory-comparison.js";

export const REUSE_VALUE_STORE_VERSION = "migaki.reuse-value-store.v0";

export type ReuseValueStoreVersion = typeof REUSE_VALUE_STORE_VERSION;

export interface ReuseValueProvenance {
  readonly decisionArtifactVersion: typeof REUSE_DECISION_ARTIFACT_VERSION;
  readonly fingerprint: string;
  readonly nodeId: string;
  readonly previousRunId: string;
}

export interface ReuseValueFreshness {
  readonly maximumAgeMs: number;
  readonly observedAt: string;
}

export interface ReuseValueStoreLifetime {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
}

export interface ReuseValueCodec<T> {
  readonly isValue: (value: unknown) => value is T;
  readonly version: string;
}

export interface ReuseValueStoreRequest {
  readonly provenance: ReuseValueProvenance;
  readonly version: ReuseValueStoreVersion;
}

export interface ReuseValueInsertion<T> extends ReuseValueStoreRequest {
  readonly freshness: ReuseValueFreshness;
  readonly value: T;
}

export type ReuseValueStoreReasonCode =
  | "capacity_exceeded"
  | "corrupt_value"
  | "freshness_expired"
  | "freshness_not_yet_valid"
  | "incompatible_version"
  | "invalid_request"
  | "not_found"
  | "provenance_mismatch"
  | "store_closed"
  | "store_expired"
  | "store_not_yet_active"
  | "value_schema_mismatch";

export interface ReuseValueMetadata {
  readonly freshness: ReuseValueFreshness;
  readonly provenance: ReuseValueProvenance;
  readonly valueSchemaVersion: string;
}

export type ReuseValueLookupResult<T> =
  | {
      readonly metadata: ReuseValueMetadata;
      readonly reasonCodes: readonly [];
      readonly status: "hit";
      readonly value: T;
    }
  | {
      readonly reasonCodes: readonly ReuseValueStoreReasonCode[];
      readonly status: "invalidated" | "miss";
    };

export type ReuseValueInsertionResult =
  | {
      readonly metadata: ReuseValueMetadata;
      readonly reasonCodes: readonly [];
      readonly status: "inserted";
    }
  | {
      readonly reasonCodes: readonly ReuseValueStoreReasonCode[];
      readonly status: "rejected";
    };

export interface ReuseValueStoreDescription {
  readonly entries: readonly ReuseValueMetadata[];
  readonly lifetime: ReuseValueStoreLifetime;
  readonly maxEntries: number;
  readonly version: ReuseValueStoreVersion;
}

export interface EphemeralReuseValueStore {
  readonly size: number;
  close(): { readonly invalidated: number; readonly status: "closed" };
  describe(): ReuseValueStoreDescription;
  insert<T>(
    input: unknown,
    codec: ReuseValueCodec<T>,
    options: { readonly now: string },
  ): ReuseValueInsertionResult;
  invalidate(input: unknown): {
    readonly invalidated: number;
    readonly reasonCodes: readonly ReuseValueStoreReasonCode[];
    readonly status: "invalidated";
  };
  lookup<T>(
    input: unknown,
    codec: ReuseValueCodec<T>,
    options: { readonly now: string },
  ): ReuseValueLookupResult<T>;
}

interface StoredReuseValue {
  readonly metadata: ReuseValueMetadata;
  readonly value: unknown;
}

/**
 * Creates an injected, process-memory-only value store. Every instance owns its
 * entries and requires an explicit lifetime; no process-global state is used.
 */
export function createEphemeralReuseValueStore(options: {
  readonly lifetime: ReuseValueStoreLifetime;
  readonly maxEntries: number;
}): EphemeralReuseValueStore {
  assertOptions(options);

  const lifetime = copyLifetime(options.lifetime);
  const entries = new Map<string, StoredReuseValue>();
  let closed = false;

  function invalidateAll(
    reason: ReuseValueStoreReasonCode,
  ): ReuseValueStoreReasonCode {
    entries.clear();
    return reason;
  }

  function stateReason(now: string): ReuseValueStoreReasonCode | undefined {
    if (closed) {
      return "store_closed";
    }

    const timestamp = parseTimestamp(now);
    if (timestamp === undefined) {
      return "invalid_request";
    }
    if (timestamp < Date.parse(lifetime.createdAt)) {
      return "store_not_yet_active";
    }
    if (timestamp > Date.parse(lifetime.expiresAt)) {
      return invalidateAll("store_expired");
    }
    return undefined;
  }

  return {
    get size() {
      return entries.size;
    },

    close() {
      const invalidated = entries.size;
      entries.clear();
      closed = true;
      return { invalidated, status: "closed" };
    },

    describe() {
      return {
        entries: [...entries.values()]
          .map((entry) => copyMetadata(entry.metadata))
          .sort((left, right) =>
            provenanceKey(left.provenance).localeCompare(
              provenanceKey(right.provenance),
            ),
          ),
        lifetime: copyLifetime(lifetime),
        maxEntries: options.maxEntries,
        version: REUSE_VALUE_STORE_VERSION,
      };
    },

    insert<T>(
      input: unknown,
      codec: ReuseValueCodec<T>,
      insertOptions: { readonly now: string },
    ): ReuseValueInsertionResult {
      const parsed = readInsertion(input);
      if (parsed.reason !== undefined) {
        return rejected(parsed.reason);
      }
      if (!isCodec(codec) || !codec.isValue(parsed.input.value)) {
        return rejected("corrupt_value");
      }

      const storeReason = stateReason(insertOptions.now);
      if (storeReason !== undefined) {
        return rejected(storeReason);
      }
      const freshnessReason = freshnessReasonAt(
        parsed.input.freshness,
        insertOptions.now,
      );
      if (freshnessReason !== undefined) {
        return rejected(freshnessReason);
      }

      const key = provenanceKey(parsed.input.provenance);
      if (!entries.has(key) && entries.size >= options.maxEntries) {
        return rejected("capacity_exceeded");
      }

      const metadata = {
        freshness: { ...parsed.input.freshness },
        provenance: { ...parsed.input.provenance },
        valueSchemaVersion: codec.version,
      };
      entries.set(key, { metadata, value: parsed.input.value });
      return {
        metadata: copyMetadata(metadata),
        reasonCodes: [],
        status: "inserted",
      };
    },

    invalidate(input: unknown) {
      const parsed = readRequest(input);
      if (parsed.reason !== undefined) {
        return {
          invalidated: 0,
          reasonCodes: [parsed.reason],
          status: "invalidated",
        };
      }
      const invalidated = entries.delete(provenanceKey(parsed.input.provenance))
        ? 1
        : 0;
      return {
        invalidated,
        reasonCodes: invalidated === 0 ? (["not_found"] as const) : [],
        status: "invalidated",
      };
    },

    lookup<T>(
      input: unknown,
      codec: ReuseValueCodec<T>,
      lookupOptions: { readonly now: string },
    ): ReuseValueLookupResult<T> {
      const parsed = readRequest(input);
      if (parsed.reason !== undefined) {
        return miss(parsed.reason);
      }

      const storeReason = stateReason(lookupOptions.now);
      if (storeReason !== undefined) {
        return invalidated(storeReason);
      }

      const key = provenanceKey(parsed.input.provenance);
      const entry = entries.get(key);
      if (entry === undefined) {
        const sameSlot = [...entries.values()].some(
          (candidate) =>
            candidate.metadata.provenance.nodeId ===
              parsed.input.provenance.nodeId &&
            candidate.metadata.provenance.previousRunId ===
              parsed.input.provenance.previousRunId,
        );
        return miss(sameSlot ? "provenance_mismatch" : "not_found");
      }

      if (
        !isCodec(codec) ||
        codec.version !== entry.metadata.valueSchemaVersion
      ) {
        entries.delete(key);
        return invalidated("value_schema_mismatch");
      }
      if (!codec.isValue(entry.value)) {
        entries.delete(key);
        return invalidated("corrupt_value");
      }

      const freshnessReason = freshnessReasonAt(
        entry.metadata.freshness,
        lookupOptions.now,
      );
      if (freshnessReason !== undefined) {
        entries.delete(key);
        return invalidated(freshnessReason);
      }

      return {
        metadata: copyMetadata(entry.metadata),
        reasonCodes: [],
        status: "hit",
        value: entry.value,
      };
    },
  };
}

function readRequest(
  input: unknown,
):
  | { readonly input: ReuseValueStoreRequest; readonly reason?: undefined }
  | { readonly input?: undefined; readonly reason: ReuseValueStoreReasonCode } {
  if (!isRecord(input)) {
    return { reason: "invalid_request" };
  }
  if (input.version !== REUSE_VALUE_STORE_VERSION) {
    return {
      reason:
        typeof input.version === "string"
          ? "incompatible_version"
          : "invalid_request",
    };
  }
  if (
    isRecord(input.provenance) &&
    typeof input.provenance.decisionArtifactVersion === "string" &&
    input.provenance.decisionArtifactVersion !== REUSE_DECISION_ARTIFACT_VERSION
  ) {
    return { reason: "incompatible_version" };
  }
  if (!isProvenance(input.provenance)) {
    return { reason: "invalid_request" };
  }
  return { input: input as unknown as ReuseValueStoreRequest };
}

function readInsertion(input: unknown):
  | {
      readonly input: ReuseValueInsertion<unknown>;
      readonly reason?: undefined;
    }
  | { readonly input?: undefined; readonly reason: ReuseValueStoreReasonCode } {
  const request = readRequest(input);
  if (request.reason !== undefined) {
    return request;
  }
  if (
    !isRecord(input) ||
    !isFreshness(input.freshness) ||
    !("value" in input)
  ) {
    return { reason: "invalid_request" };
  }
  return { input: input as unknown as ReuseValueInsertion<unknown> };
}

function isProvenance(value: unknown): value is ReuseValueProvenance {
  return (
    isRecord(value) &&
    value.decisionArtifactVersion === REUSE_DECISION_ARTIFACT_VERSION &&
    safeReference(value.fingerprint) &&
    safeReference(value.nodeId) &&
    safeReference(value.previousRunId)
  );
}

function isFreshness(value: unknown): value is ReuseValueFreshness {
  return (
    isRecord(value) &&
    typeof value.maximumAgeMs === "number" &&
    Number.isFinite(value.maximumAgeMs) &&
    value.maximumAgeMs >= 0 &&
    parseTimestamp(value.observedAt) !== undefined
  );
}

function freshnessReasonAt(
  freshness: ReuseValueFreshness,
  now: string,
): ReuseValueStoreReasonCode | undefined {
  const timestamp = parseTimestamp(now);
  const observedAt = parseTimestamp(freshness.observedAt);
  if (timestamp === undefined || observedAt === undefined) {
    return "invalid_request";
  }
  if (timestamp < observedAt) {
    return "freshness_not_yet_valid";
  }
  if (timestamp - observedAt > freshness.maximumAgeMs) {
    return "freshness_expired";
  }
  return undefined;
}

function assertOptions(options: {
  readonly lifetime: ReuseValueStoreLifetime;
  readonly maxEntries: number;
}): void {
  const createdAt = parseTimestamp(options.lifetime.createdAt);
  const expiresAt = parseTimestamp(options.lifetime.expiresAt);
  if (
    createdAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= createdAt ||
    !safeReference(options.lifetime.id) ||
    !Number.isSafeInteger(options.maxEntries) ||
    options.maxEntries <= 0
  ) {
    throw new TypeError(
      "Ephemeral reuse store options require a valid explicit lifetime and positive capacity.",
    );
  }
}

function isCodec<T>(codec: unknown): codec is ReuseValueCodec<T> {
  return (
    isRecord(codec) &&
    safeReference(codec.version) &&
    typeof codec.isValue === "function"
  );
}

function provenanceKey(provenance: ReuseValueProvenance): string {
  return JSON.stringify([
    provenance.decisionArtifactVersion,
    provenance.previousRunId,
    provenance.nodeId,
    provenance.fingerprint,
  ]);
}

function copyMetadata(metadata: ReuseValueMetadata): ReuseValueMetadata {
  return {
    freshness: { ...metadata.freshness },
    provenance: { ...metadata.provenance },
    valueSchemaVersion: metadata.valueSchemaVersion,
  };
}

function copyLifetime(
  lifetime: ReuseValueStoreLifetime,
): ReuseValueStoreLifetime {
  return { ...lifetime };
}

function rejected(
  reason: ReuseValueStoreReasonCode,
): ReuseValueInsertionResult {
  return { reasonCodes: [reason], status: "rejected" };
}

function miss<T>(reason: ReuseValueStoreReasonCode): ReuseValueLookupResult<T> {
  return { reasonCodes: [reason], status: "miss" };
}

function invalidated<T>(
  reason: ReuseValueStoreReasonCode,
): ReuseValueLookupResult<T> {
  return { reasonCodes: [reason], status: "invalidated" };
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeReference(value: unknown): value is string {
  return nonEmptyString(value) && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
