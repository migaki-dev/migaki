import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";

import {
  EVIDENCE_BUNDLE_VERSION,
  EVIDENCE_PRIVACY_EXPORT_FIELDS,
  EVIDENCE_PRIVACY_EXPORT_MATRIX,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  EVIDENCE_EVENT_VERSION,
  PASS_CONTRACT_VERSION,
  createEvidenceBundle,
  diffMIRPlans,
  parseEvidenceBundle,
  serializeEvidenceBundle,
  validateEvidenceBundle,
  type EvidenceEvent,
  type PassWarning,
} from "./index.js";

const passIdentity = {
  name: "test.pass",
  version: "0.0.0",
};

const warning: PassWarning = {
  code: "assumption_recorded",
  message: "A runtime assumption was recorded.",
  path: "$.nodes[0]",
  severity: "warning",
};

describe("evidence bundles", () => {
  it("defines the v0 evidence privacy export matrix", () => {
    expect(EVIDENCE_PRIVACY_EXPORT_FIELDS).toEqual([
      "prompt",
      "tool_input",
      "tool_output",
      "provider_response",
      "file_path",
      "customer_data",
      "credential",
      "local_machine_path",
    ]);
    expect(EVIDENCE_PRIVACY_EXPORT_MATRIX.prompt).toMatchObject({
      metadata_only: { disposition: "omit" },
      redacted: { disposition: "redact" },
      full: { disposition: "include", requiresExplicitOptIn: true },
    });
    expect(EVIDENCE_PRIVACY_EXPORT_MATRIX.credential).toMatchObject({
      metadata_only: { disposition: "omit" },
      redacted: { disposition: "redact" },
      full: { disposition: "redact", requiresExplicitOptIn: true },
    });
    for (const field of EVIDENCE_PRIVACY_EXPORT_FIELDS) {
      expect(Object.keys(EVIDENCE_PRIVACY_EXPORT_MATRIX[field])).toEqual([
        "metadata_only",
        "redacted",
        "full",
      ]);
    }
  });

  it("builds v0 bundle sections from plan diffs, pass summaries, and evidence", () => {
    const before = createPlan("bundle-before", ["ctx-a", "ctx-b"]);
    const after = createPlan("bundle-after", ["ctx-a"]);
    const planDiff = diffMIRPlans(before, after, {
      afterWarnings: [warning],
    });

    const bundle = createEvidenceBundle({
      createdAt: "2026-01-01T00:00:00.000Z",
      events: [
        createEvent("token-estimate", "estimate", {
          estimate: {
            confidence: "estimated",
            estimateKind: "token",
            subjectRef: "$.nodes[0]",
            unit: "tokens",
            value: 42,
          },
        }),
        createEvent("provider-assumption", "capability_assumption", {
          capabilityAssumption: {
            capability: "prompt_caching",
            description: "Fixture declares prompt caching support.",
            provider: "mock-provider",
          },
        }),
        createEvent("validator-result", "validator_result", {
          validatorResult: {
            status: "passed",
            validatorId: "source-grounding",
          },
        }),
      ],
      exportMode: "full",
      allowFullTraceExport: true,
      optimizedPlan: {
        planId: after.id,
        ref: "mir://runs/bundle-run/optimized",
        version: after.version,
      },
      originalPlan: {
        planId: before.id,
        ref: "mir://runs/bundle-run/original",
        version: before.version,
      },
      passes: [
        {
          contractVersion: PASS_CONTRACT_VERSION,
          enabled: true,
          name: passIdentity.name,
          version: passIdentity.version,
        },
      ],
      planDiff,
      replay: {
        handles: [
          {
            kind: "trace",
            ref: "trace://bundle-run",
          },
        ],
        mode: "metadata",
      },
      runId: "bundle-run",
      warnings: [warning],
    });

    expect(bundle.version).toBe(EVIDENCE_BUNDLE_VERSION);
    expect(bundle.privacyPolicy).toEqual({
      exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
      exportMode: "full",
      fullTraceOptIn: true,
    });
    expect(bundle.contextDiff).toEqual(
      planDiff.changes.filter((change) => change.artifactKind === "context"),
    );
    expect(bundle.estimates).toMatchObject([
      {
        estimate: {
          estimateKind: "token",
          unit: "tokens",
          value: 42,
        },
      },
    ]);
    expect(bundle.providerAssumptions).toMatchObject([
      {
        capabilityAssumption: {
          provider: "mock-provider",
        },
      },
    ]);
    expect(bundle.validatorResults).toMatchObject([
      {
        validatorResult: {
          status: "passed",
          validatorId: "source-grounding",
        },
      },
    ]);
    expect(bundle.redactions).toEqual([]);
    expect(validateEvidenceBundle(bundle)).toEqual({
      bundle,
      errors: [],
      success: true,
    });
    expect(parseEvidenceBundle(serializeEvidenceBundle(bundle))).toEqual(
      bundle,
    );
  });

  it("serializes deterministically with stable object key ordering", () => {
    const bundle = createEvidenceBundle({
      createdAt: "2026-01-01T00:00:00.000Z",
      events: [
        createEvent("validator-result", "validator_result", {
          validatorResult: {
            status: "passed",
            validatorId: "source-grounding",
          },
        }),
      ],
      exportMode: "full",
      allowFullTraceExport: true,
      optimizedPlan: {
        planId: "plan-after",
        version: MIR_V0_VERSION,
      },
      originalPlan: {
        planId: "plan-before",
        version: MIR_V0_VERSION,
      },
      passes: [],
      planDiff: diffMIRPlans(
        createPlan("plan-before"),
        createPlan("plan-after"),
      ),
      replay: {
        handles: [],
        mode: "metadata",
      },
      runId: "bundle-run",
      warnings: [],
    });

    const serialized = serializeEvidenceBundle(bundle);

    expect(serializeEvidenceBundle(parseEvidenceBundle(serialized))).toBe(
      serialized,
    );
    expect(
      Object.keys(JSON.parse(serialized) as Record<string, unknown>),
    ).toEqual([
      "contextDiff",
      "costEstimates",
      "createdAt",
      "estimates",
      "events",
      "exportMode",
      "optimizedPlan",
      "originalPlan",
      "passes",
      "planDiff",
      "policyDecisions",
      "privacyPolicy",
      "providerAssumptions",
      "redactions",
      "replay",
      "retryFallbackDecisions",
      "routingDecisions",
      "runId",
      "validatorResults",
      "version",
      "warnings",
    ]);
  });

  it("omits full-trace events from metadata-only exports and records why", () => {
    const bundle = createEvidenceBundle({
      ...baseBundleInput(),
      events: [
        createEvent(
          "full-trace-event",
          "pass_decision",
          {
            passDecision: {
              decision: "applied",
              pass: passIdentity,
            },
          },
          {
            replayMode: "full_trace",
          },
        ),
        createEvent("metadata-event", "estimate", {
          estimate: {
            confidence: "estimated",
            estimateKind: "cost",
            subjectRef: "$.nodes[0]",
            unit: "usd",
            value: 0.01,
          },
        }),
      ],
      exportMode: "metadata_only",
    });

    expect(bundle.events.map((event) => event.id)).toEqual(["metadata-event"]);
    expect(bundle.redactions).toMatchObject([
      {
        mode: "omitted",
        path: '$.events[?(@.id=="full-trace-event")]',
        reason:
          "Event requires full trace replay and was omitted from metadata-only export.",
      },
    ]);
  });

  it("uses metadata-only export by default so raw full-trace events are omitted", () => {
    const rawPrompt = "raw customer prompt with sk-live-fixture";
    const bundle = createEvidenceBundle({
      ...baseBundleInput(),
      events: [
        {
          ...createEvent(
            "raw-prompt",
            "pass_decision",
            {
              passDecision: {
                decision: "applied",
                pass: passIdentity,
              },
            },
            {
              privacyClass: "confidential",
              replayMode: "full_trace",
            },
          ),
          summary: rawPrompt,
        },
      ],
    });
    const serialized = serializeEvidenceBundle(bundle);

    expect(bundle.exportMode).toBe("metadata_only");
    expect(bundle.events).toEqual([]);
    expect(bundle.redactions).toMatchObject([
      {
        eventId: "raw-prompt",
        mode: "omitted",
        path: '$.events[?(@.id=="raw-prompt")]',
        privacyClass: "confidential",
      },
    ]);
    expect(serialized).not.toContain(rawPrompt);
    expect(serialized).not.toContain("sk-live-fixture");
  });

  it("requires explicit code opt-in for full-trace exports", () => {
    const fullTraceInput = {
      ...baseBundleInput(),
      events: [
        createEvent(
          "full-trace-event",
          "pass_decision",
          {
            passDecision: {
              decision: "applied",
              pass: passIdentity,
            },
          },
          {
            replayMode: "full_trace",
          },
        ),
      ],
      exportMode: "full" as const,
    };

    expect(() => createEvidenceBundle(fullTraceInput)).toThrow(
      "Full-trace evidence bundle exports require explicit opt-in.",
    );

    expect(
      createEvidenceBundle({
        ...fullTraceInput,
        allowFullTraceExport: true,
      }).privacyPolicy,
    ).toMatchObject({
      fullTraceOptIn: true,
    });
  });

  it("redacts secret-bearing events even in full exports", () => {
    const rawSecret = "sk-live-secret-fixture";
    const bundle = createEvidenceBundle({
      ...baseBundleInput(),
      events: [
        {
          ...createEvent(
            "credential-warning",
            "warning",
            {
              warning: {
                code: rawSecret,
                severity: "warning",
              },
            },
            {
              privacyClass: "secret",
              replayMode: "full_trace",
            },
          ),
          summary: `Credential leaked: ${rawSecret}`,
        },
      ],
      exportMode: "full",
      allowFullTraceExport: true,
    });
    const serialized = serializeEvidenceBundle(bundle);

    expect(bundle.events).toMatchObject([
      {
        id: "credential-warning",
        kind: "warning",
        redaction: {
          mode: "redacted",
        },
        summary: "Redacted evidence event credential-warning.",
      },
    ]);
    const [redactedEvent] = bundle.events;

    expect(redactedEvent).toBeDefined();
    expect(redactedEvent !== undefined && "warning" in redactedEvent).toBe(
      false,
    );
    expect(bundle.redactions).toMatchObject([
      {
        eventId: "credential-warning",
        mode: "redacted",
        privacyClass: "secret",
      },
    ]);
    expect(serialized).not.toContain(rawSecret);
    expect(validateEvidenceBundle(bundle).success).toBe(true);
  });

  it("replaces sensitive events with redacted shells in redacted exports", () => {
    const bundle = createEvidenceBundle({
      ...baseBundleInput(),
      events: [
        createEvent(
          "secret-warning",
          "warning",
          {
            warning: {
              code: "contains_secret",
              severity: "warning",
            },
          },
          {
            privacyClass: "secret",
          },
        ),
      ],
      exportMode: "redacted",
    });

    expect(bundle.events).toMatchObject([
      {
        id: "secret-warning",
        kind: "warning",
        redaction: {
          mode: "redacted",
        },
        summary: "Redacted evidence event secret-warning.",
      },
    ]);
    const [redactedEvent] = bundle.events;

    expect(redactedEvent).toBeDefined();
    expect(redactedEvent !== undefined && "warning" in redactedEvent).toBe(
      false,
    );
    expect(bundle.redactions).toMatchObject([
      {
        mode: "redacted",
        path: '$.events[?(@.id=="secret-warning")]',
        privacyClass: "secret",
      },
    ]);
    expect(validateEvidenceBundle(bundle).success).toBe(true);
  });
});

function baseBundleInput(): Parameters<typeof createEvidenceBundle>[0] {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    events: [],
    optimizedPlan: {
      planId: "plan-after",
      version: MIR_V0_VERSION,
    },
    originalPlan: {
      planId: "plan-before",
      version: MIR_V0_VERSION,
    },
    passes: [],
    planDiff: diffMIRPlans(createPlan("plan-before"), createPlan("plan-after")),
    replay: {
      handles: [],
      mode: "metadata",
    },
    runId: "bundle-run",
    warnings: [],
  };
}

function createPlan(id: string, contextIds: readonly string[] = []): MIRPlan {
  return {
    id,
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: contextIds.map((contextId) => ({
      contentRef: `fixture://${contextId}`,
      id: contextId,
      mutability: "fixed",
      provenance: {
        source: "user",
      },
      role: "user_input",
    })),
    nodes: [],
    edges: [],
  };
}

function createEvent<TKind extends EvidenceEvent["kind"]>(
  id: string,
  kind: TKind,
  detail: Omit<
    Extract<EvidenceEvent, { kind: TKind }>,
    "id" | "kind" | "privacy" | "redaction" | "source" | "summary" | "version"
  >,
  options: {
    readonly privacyClass?: EvidenceEvent["privacy"]["privacyClass"];
    readonly replayMode?: EvidenceEvent["privacy"]["replayMode"];
  } = {},
): Extract<EvidenceEvent, { kind: TKind }> {
  return {
    id,
    kind,
    privacy: {
      privacyClass: options.privacyClass ?? "internal",
      replayMode: options.replayMode ?? "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: "bundle-run",
    },
    summary: `Evidence event ${id}.`,
    version: EVIDENCE_EVENT_VERSION,
    ...detail,
  } as Extract<EvidenceEvent, { kind: TKind }>;
}
