import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_POLICY_BUNDLE_VERSION,
  ADAPTIVE_POLICY_PROHIBITED_EFFECTS,
  ADAPTIVE_POLICY_PROPOSAL_VERSION,
  META_OBSERVATION_VERSION,
  parseAdaptivePolicyBundle,
  parseAdaptivePolicyProposal,
  parseMetaObservation,
  serializeAdaptivePolicyBundle,
  serializeAdaptivePolicyProposal,
  serializeMetaObservation,
  validateAdaptivePolicyBundle,
  validateAdaptivePolicyProposal,
  validateMetaObservation,
  type AdaptivePolicyBundle,
  type AdaptivePolicyProposal,
  type MetaObservation,
} from "./index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/adaptive-policy-loop.json", import.meta.url),
);

describe("adaptive policy contracts", () => {
  it("validates the v0 self-observation to accepted-policy fixture", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      readonly acceptedBundle: AdaptivePolicyBundle;
      readonly metaObservation: MetaObservation;
      readonly proposal: AdaptivePolicyProposal;
    };
    const persisted = JSON.stringify(fixture);

    expect(validateMetaObservation(fixture.metaObservation)).toEqual({
      errors: [],
      metaObservation: fixture.metaObservation,
      success: true,
    });
    expect(validateAdaptivePolicyProposal(fixture.proposal)).toEqual({
      errors: [],
      proposal: fixture.proposal,
      success: true,
    });
    expect(validateAdaptivePolicyBundle(fixture.acceptedBundle)).toEqual({
      bundle: fixture.acceptedBundle,
      errors: [],
      success: true,
    });
    expect(fixture.metaObservation.version).toBe(META_OBSERVATION_VERSION);
    expect(fixture.proposal.version).toBe(ADAPTIVE_POLICY_PROPOSAL_VERSION);
    expect(fixture.acceptedBundle.version).toBe(ADAPTIVE_POLICY_BUNDLE_VERSION);
    expect(fixture.proposal.safety).toMatchObject({
      effectMode: "advice_only",
      prohibitedEffects: ADAPTIVE_POLICY_PROHIBITED_EFFECTS,
    });
    expect(fixture.acceptedBundle.rules).toHaveLength(1);
    expect(fixture.acceptedBundle.createdFrom).toMatchObject({
      proposalId: fixture.proposal.id,
    });
    expect(persisted).not.toContain("/tmp/repo");
    expect(persisted).not.toContain("secret-session-plan.ts");
    expect(persisted).not.toContain("cat ");
    expect(persisted).not.toContain("sed -n");
  });

  it("round-trips policy artifacts with deterministic serialization", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      readonly acceptedBundle: AdaptivePolicyBundle;
      readonly metaObservation: MetaObservation;
      readonly proposal: AdaptivePolicyProposal;
    };

    const serializedMetaObservation = serializeMetaObservation(
      fixture.metaObservation,
    );
    const serializedProposal = serializeAdaptivePolicyProposal(
      fixture.proposal,
    );
    const serializedBundle = serializeAdaptivePolicyBundle(
      fixture.acceptedBundle,
    );

    expect(
      serializeMetaObservation(parseMetaObservation(serializedMetaObservation)),
    ).toBe(serializedMetaObservation);
    expect(
      serializeAdaptivePolicyProposal(
        parseAdaptivePolicyProposal(serializedProposal),
      ),
    ).toBe(serializedProposal);
    expect(
      serializeAdaptivePolicyBundle(
        parseAdaptivePolicyBundle(serializedBundle),
      ),
    ).toBe(serializedBundle);
  });

  it("rejects proposals that can affect execution behavior", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      readonly proposal: AdaptivePolicyProposal;
    };
    const unsafeProposal: unknown = {
      ...fixture.proposal,
      safety: {
        ...fixture.proposal.safety,
        prohibitedEffects: ["cache", "replay", "skip_reads"],
      },
    };

    expect(validateAdaptivePolicyProposal(unsafeProposal)).toEqual({
      errors: [
        {
          code: "unsafe_effect",
          message: "Adaptive policy artifacts must forbid parallelize effects.",
          path: "$.safety.prohibitedEffects",
        },
      ],
      success: false,
    });
  });

  it("requires redaction metadata on meta-observations", () => {
    const observation: unknown = {
      ...validMetaObservation(),
      redaction: undefined,
    };

    expect(validateMetaObservation(observation)).toEqual({
      errors: [
        {
          code: "missing_required",
          message: "Missing required object.",
          path: "$.redaction",
        },
      ],
      success: false,
    });
  });
});

function validMetaObservation(): MetaObservation {
  return {
    evidenceRefs: ["execution-graph://codex-turn-fixture"],
    id: "meta-observation-fixture",
    observedAt: "2026-01-01T00:00:00.000Z",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "omitted",
      reason:
        "Raw prompts, file paths, commands, and tool outputs are omitted from adaptive policy observations.",
    },
    signal: "advice_outcome_observed",
    source: {
      kind: "advice",
      runId: "codex-turn-fixture",
    },
    subject: {
      kind: "opportunity",
      ref: "opportunity://file-reuse",
      safeLabel: "file_reuse",
    },
    summary:
      "Advice was emitted for repeated read-like file access using safe source labels only.",
    version: META_OBSERVATION_VERSION,
  };
}
