import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONTROLLED_REUSE_AUTHORIZATION_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  validateControlledReuseAuthorization,
  type ControlledReuseAuthorizationInput,
  type ReuseDecisionArtifact,
} from "./index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/controlled-reuse-authorization.json", import.meta.url),
);

describe("controlled reuse authorization", () => {
  it("authorizes only the exact read-only tool-call fixture", async () => {
    const fixture = await loadFixture();
    const input = withArtifact(fixture, fixture.cases.allowed);

    expect(validateControlledReuseAuthorization(input, fixture.now)).toEqual({
      authorization: {
        authorized: true,
        decisionNodeId: "tool-read",
        reasons: [],
        reusableValue: input.reusableValue,
        status: "allowed",
        version: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
      },
      errors: [],
      success: true,
    });
  });

  it("fails closed for stale evidence", async () => {
    const fixture = await loadFixture();
    const result = validateControlledReuseAuthorization(
      withArtifact(fixture, fixture.cases.blocked),
      fixture.now,
    );

    expect(result).toMatchObject({
      authorization: {
        authorized: false,
        status: "blocked",
        reasons: [{ code: "freshness_stale" }],
      },
      errors: [],
      success: true,
    });
  });

  it("requires review for uncertain evidence without authorizing reuse", async () => {
    const fixture = await loadFixture();
    const result = validateControlledReuseAuthorization(
      withArtifact(fixture, fixture.cases.needsReview),
      fixture.now,
    );

    expect(result).toMatchObject({
      authorization: {
        authorized: false,
        status: "needs_review",
        reasons: [{ code: "source_equivalence_needs_review" }],
      },
      errors: [],
      success: true,
    });
  });

  it.each([
    [
      "missing opt-in",
      (input: MutableInput) => delete input.mode,
      "missing_required",
    ],
    [
      "unknown authorization version",
      (input: MutableInput) => {
        input.version = "migaki.controlled-reuse-authorization.v99";
      },
      "incompatible_version",
    ],
    [
      "unknown decision artifact version",
      (input: MutableInput) => {
        if (typeof input.decisionArtifact !== "string") {
          input.decisionArtifact.version = "migaki.reuse-decision.v99";
        }
      },
      "incompatible_version",
    ],
    [
      "malformed untrusted input",
      (input: MutableInput) => {
        input.decisionArtifact = "not-an-artifact";
      },
      "invalid_type",
    ],
    [
      "malformed reuse decision",
      (input: MutableInput) => {
        if (typeof input.decisionArtifact !== "string") {
          input.decisionArtifact.decisions = [null];
        }
      },
      "invalid_type",
    ],
  ])("rejects %s", async (_name, mutate, expectedCode) => {
    const fixture = await loadFixture();
    const input = structuredClone(
      withArtifact(fixture, fixture.cases.allowed),
    ) as unknown as MutableInput;
    mutate(input);

    const result = validateControlledReuseAuthorization(input, fixture.now);

    expect(result.success).toBe(false);
    expect(result.authorization).toMatchObject({
      authorized: false,
      status: "blocked",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
    );
  });

  it.each([
    [
      "disabled by default",
      (input: MutableInput) => {
        input.mode = "disabled";
      },
      "opt_in_required",
    ],
    [
      "unsupported operation kind",
      (input: MutableInput) => {
        input.eligibility.operationKind = "model_call";
      },
      "operation_kind_unsupported",
    ],
    [
      "non-read-only side effects",
      (input: MutableInput) => {
        input.eligibility.sideEffectClass = "idempotent_mutation";
      },
      "side_effect_unsupported",
    ],
    [
      "missing validators",
      (input: MutableInput) => {
        input.validators.passed = [];
      },
      "validator_missing",
    ],
    [
      "incomplete dependency evidence",
      (input: MutableInput) => {
        input.evidence.dependencies.status = "unknown";
      },
      "dependency_evidence_needs_review",
    ],
    [
      "incomplete policy evidence",
      (input: MutableInput) => {
        input.evidence.policy.status = "unknown";
      },
      "policy_evidence_needs_review",
    ],
    [
      "non-exact fingerprints",
      (input: MutableInput) => {
        input.evidence.source.currentFingerprint = "sha256:changed";
      },
      "source_fingerprint_mismatch",
    ],
    [
      "expired reusable values",
      (input: MutableInput) => {
        input.reusableValue.lifetime.expiresAt = "2026-01-01T00:04:59.999Z";
      },
      "reusable_value_expired",
    ],
    [
      "future-created reusable values",
      (input: MutableInput) => {
        input.reusableValue.lifetime.createdAt = "2026-01-01T00:05:00.001Z";
      },
      "reusable_value_not_yet_valid",
    ],
  ])("does not authorize %s", async (_name, mutate, expectedCode) => {
    const fixture = await loadFixture();
    const input = structuredClone(
      withArtifact(fixture, fixture.cases.allowed),
    ) as unknown as MutableInput;
    mutate(input);

    const result = validateControlledReuseAuthorization(input, fixture.now);

    expect(result.success).toBe(true);
    expect(result.authorization.authorized).toBe(false);
    expect(result.authorization.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
    );
  });

  it("fails closed when no authorization input is supplied", () => {
    const result = validateControlledReuseAuthorization(undefined, {
      now: "2026-01-01T00:05:00.000Z",
    });

    expect(result).toMatchObject({
      authorization: { authorized: false, status: "blocked" },
      errors: [{ code: "invalid_type", path: "$" }],
      success: false,
    });
  });

  it("uses fixture-declared incompatible versions and malformed input", async () => {
    const fixture = await loadFixture();
    const incompatible = structuredClone(
      withArtifact(fixture, fixture.cases.allowed),
    ) as unknown as MutableInput;
    incompatible.version = fixture.invalid.authorizationVersion;
    const incompatibleArtifact = structuredClone(
      withArtifact(fixture, fixture.cases.allowed),
    ) as unknown as MutableInput;
    if (typeof incompatibleArtifact.decisionArtifact !== "string") {
      incompatibleArtifact.decisionArtifact.version =
        fixture.invalid.decisionArtifactVersion;
    }

    expect(
      validateControlledReuseAuthorization(incompatible, fixture.now).errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "incompatible_version" }),
      ]),
    );
    expect(
      validateControlledReuseAuthorization(incompatibleArtifact, fixture.now)
        .errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "incompatible_version" }),
      ]),
    );
    expect(
      validateControlledReuseAuthorization(
        fixture.invalid.malformedInput,
        fixture.now,
      ),
    ).toMatchObject({
      authorization: { authorized: false },
      errors: [{ code: "invalid_type" }],
      success: false,
    });
  });
});

interface Fixture {
  readonly cases: {
    readonly allowed: Omit<
      ControlledReuseAuthorizationInput,
      "decisionArtifact"
    >;
    readonly blocked: Omit<
      ControlledReuseAuthorizationInput,
      "decisionArtifact"
    >;
    readonly needsReview: Omit<
      ControlledReuseAuthorizationInput,
      "decisionArtifact"
    >;
  };
  readonly decisionArtifact: ReuseDecisionArtifact;
  readonly invalid: {
    readonly authorizationVersion: string;
    readonly decisionArtifactVersion: string;
    readonly malformedInput: unknown;
  };
  readonly now: { readonly now: string };
}

type MutableInput = {
  decisionArtifact: MutableRecord | string;
  eligibility: MutableRecord;
  evidence: {
    dependencies: MutableRecord;
    policy: MutableRecord;
    source: MutableRecord;
  };
  mode?: string;
  reusableValue: {
    lifetime: MutableRecord;
  };
  validators: { passed: string[] };
  version: string;
};

type MutableRecord = Record<string, unknown>;

async function loadFixture(): Promise<Fixture> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
}

function withArtifact(
  fixture: Fixture,
  input: Omit<ControlledReuseAuthorizationInput, "decisionArtifact">,
): ControlledReuseAuthorizationInput {
  expect(fixture.decisionArtifact.version).toBe(
    REUSE_DECISION_ARTIFACT_VERSION,
  );
  return { ...input, decisionArtifact: fixture.decisionArtifact };
}
