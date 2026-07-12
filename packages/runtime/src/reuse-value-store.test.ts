import { describe, expect, it } from "vitest";

import {
  REUSE_DECISION_ARTIFACT_VERSION,
  REUSE_VALUE_STORE_VERSION,
  createEphemeralReuseValueStore,
  type ReuseValueCodec,
  type ReuseValueProvenance,
} from "./index.js";

const NOW = "2026-01-01T00:05:00.000Z";
const provenance: ReuseValueProvenance = {
  decisionArtifactVersion: REUSE_DECISION_ARTIFACT_VERSION,
  fingerprint: "sha256:exact-read",
  nodeId: "tool-read",
  previousRunId: "previous-run",
};
const stringCodec: ReuseValueCodec<string> = {
  isValue: (value): value is string => typeof value === "string",
  version: "example.string.v1",
};

describe("ephemeral reuse value store", () => {
  it("inserts and returns a typed, fresh value under exact provenance", () => {
    const store = createStore();

    expect(
      store.insert(
        {
          freshness: {
            maximumAgeMs: 60_000,
            observedAt: "2026-01-01T00:04:30.000Z",
          },
          provenance,
          value: "private tool output",
          version: REUSE_VALUE_STORE_VERSION,
        },
        stringCodec,
        { now: NOW },
      ),
    ).toMatchObject({ reasonCodes: [], status: "inserted" });

    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: NOW },
      ),
    ).toMatchObject({
      metadata: {
        freshness: {
          maximumAgeMs: 60_000,
          observedAt: "2026-01-01T00:04:30.000Z",
        },
        provenance,
        valueSchemaVersion: "example.string.v1",
      },
      reasonCodes: [],
      status: "hit",
      value: "private tool output",
    });
  });

  it("returns deterministic misses for absent and mismatched provenance", () => {
    const store = createStore();

    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["not_found"], status: "miss" });

    insert(store, "value");
    expect(
      store.lookup(
        {
          provenance: { ...provenance, fingerprint: "sha256:changed" },
          version: REUSE_VALUE_STORE_VERSION,
        },
        stringCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["provenance_mismatch"], status: "miss" });
  });

  it("invalidates expired entries and expired store lifetimes", () => {
    const store = createStore();
    insert(
      store,
      "value",
      {
        maximumAgeMs: 1_000,
        observedAt: "2026-01-01T00:04:00.000Z",
      },
      "2026-01-01T00:04:00.000Z",
    );

    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["freshness_expired"], status: "invalidated" });
    expect(store.size).toBe(0);

    const expiredStore = createEphemeralReuseValueStore({
      lifetime: {
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:04:59.999Z",
        id: "expired-session",
      },
      maxEntries: 2,
    });
    expect(
      expiredStore.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["store_expired"], status: "invalidated" });
  });

  it("rejects inserts and clears existing values at exact store expiry", () => {
    const expiresAt = "2026-01-01T01:00:00.000Z";
    const store = createStore();
    insert(store, "value");

    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: expiresAt },
      ),
    ).toEqual({ reasonCodes: ["store_expired"], status: "invalidated" });
    expect(store.size).toBe(0);
    expect(
      insert(
        store,
        "replacement",
        { maximumAgeMs: 60_000, observedAt: expiresAt },
        expiresAt,
      ),
    ).toEqual({ reasonCodes: ["store_expired"], status: "rejected" });
  });

  it("clears values at lifecycle end and never uses process-global state", () => {
    const first = createStore();
    const second = createStore();
    insert(first, "value");

    expect(second.size).toBe(0);
    expect(first.close()).toEqual({ invalidated: 1, status: "closed" });
    expect(first.size).toBe(0);
    expect(
      first.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        stringCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["store_closed"], status: "invalidated" });
  });

  it.each([
    [
      "an unknown request version",
      { provenance, version: "migaki.reuse-value-store.v99" },
      "incompatible_version",
    ],
    [
      "an unknown provenance version",
      {
        provenance: {
          ...provenance,
          decisionArtifactVersion: "migaki.reuse-decision.v99",
        },
        version: REUSE_VALUE_STORE_VERSION,
      },
      "incompatible_version",
    ],
    ["malformed provenance", { provenance: null }, "invalid_request"],
  ] as const)("fails closed for %s", (_name, request, reason) => {
    const store = createStore();
    insert(store, "value");

    expect(store.lookup(request, stringCodec, { now: NOW })).toEqual({
      reasonCodes: [reason],
      status: "miss",
    });
  });

  it("invalidates values that fail the typed codec or use an unknown schema", () => {
    const mutableValue: { secret: unknown } = { secret: "safe at insertion" };
    const objectCodec: ReuseValueCodec<{ secret: string }> = {
      isValue: (value): value is { secret: string } =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { secret?: unknown }).secret === "string",
      version: "example.object.v1",
    };
    const store = createStore();
    store.insert(
      {
        freshness: { maximumAgeMs: 60_000, observedAt: NOW },
        provenance,
        value: mutableValue,
        version: REUSE_VALUE_STORE_VERSION,
      },
      objectCodec,
      { now: NOW },
    );
    mutableValue.secret = 42;

    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        objectCodec,
        { now: NOW },
      ),
    ).toEqual({ reasonCodes: ["corrupt_value"], status: "invalidated" });

    insert(store, "value");
    expect(
      store.lookup(
        { provenance, version: REUSE_VALUE_STORE_VERSION },
        { ...stringCodec, version: "example.string.v99" },
        { now: NOW },
      ),
    ).toEqual({
      reasonCodes: ["value_schema_mismatch"],
      status: "invalidated",
    });
  });

  it("exports metadata-only descriptions without raw values or local paths", () => {
    const store = createStore();
    insert(store, "secret output at /Users/alice/private.txt");

    const description = JSON.stringify(store.describe());

    expect(description).toContain("sha256:exact-read");
    expect(description).toContain("previous-run");
    expect(description).not.toContain("secret output");
    expect(description).not.toContain("/Users/alice");
    expect(store.describe()).toMatchObject({
      entries: [{ provenance, valueSchemaVersion: "example.string.v1" }],
      lifetime: { id: "test-session" },
      version: REUSE_VALUE_STORE_VERSION,
    });
    expect(() =>
      createEphemeralReuseValueStore({
        lifetime: {
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T01:00:00.000Z",
          id: "/Users/alice/private-session",
        },
        maxEntries: 2,
      }),
    ).toThrow(TypeError);
  });
});

function createStore() {
  return createEphemeralReuseValueStore({
    lifetime: {
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T01:00:00.000Z",
      id: "test-session",
    },
    maxEntries: 2,
  });
}

function insert(
  store: ReturnType<typeof createStore>,
  value: string,
  freshness = { maximumAgeMs: 60_000, observedAt: NOW },
  now = NOW,
) {
  return store.insert(
    { freshness, provenance, value, version: REUSE_VALUE_STORE_VERSION },
    stringCodec,
    { now },
  );
}
