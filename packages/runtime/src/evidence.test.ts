import { describe, expect, it } from "vitest";

import {
  EVIDENCE_EVENT_KINDS,
  EVIDENCE_EVENT_VERSION,
  isEvidenceEvent,
  parseEvidenceEvent,
  serializeEvidenceEvent,
  validateEvidenceEvent,
  type EvidenceEvent,
} from "./index.js";

const passIdentity = {
  name: "test.pass",
  version: "0.0.0",
};

describe("evidence events", () => {
  it("round-trips a serializable event", () => {
    const event = createBaseEvent("pass-decision-1", "pass_decision", {
      passDecision: {
        decision: "applied",
        pass: passIdentity,
      },
    });

    expect(parseEvidenceEvent(serializeEvidenceEvent(event))).toEqual(event);
  });

  it("covers every v0 evidence event kind with source, privacy, and redaction metadata", () => {
    const events: readonly EvidenceEvent[] = [
      createBaseEvent("pass-decision", "pass_decision", {
        passDecision: {
          decision: "applied",
          pass: passIdentity,
        },
      }),
      createBaseEvent("warning", "warning", {
        warning: {
          code: "capability_unknown",
          severity: "warning",
        },
      }),
      createBaseEvent("capability-assumption", "capability_assumption", {
        capabilityAssumption: {
          capability: "prompt_caching",
          description: "Fixture assumes prompt caching support.",
          provider: "mock-provider",
        },
      }),
      createBaseEvent("context-change", "context_change", {
        contextChange: {
          changeKind: "deduplicated",
          contextIds: ["ctx-a", "ctx-b"],
        },
      }),
      createBaseEvent("estimate", "estimate", {
        estimate: {
          confidence: "estimated",
          estimateKind: "token",
          subjectRef: "$.context[0]",
          unit: "tokens",
          value: 42,
        },
      }),
      createBaseEvent("validator-result", "validator_result", {
        validatorResult: {
          status: "passed",
          validatorId: "source-grounding",
        },
      }),
      createBaseEvent("routing-decision", "routing_decision", {
        routingDecision: {
          nodeId: "rank-documents",
          reason: "Classification is eligible for mock routing.",
          target: "mock-provider",
        },
      }),
      createBaseEvent("retry-fallback", "retry_fallback_decision", {
        retryFallbackDecision: {
          decision: "retry",
          nodeId: "synthesize-answer",
          scope: "node",
        },
      }),
      createBaseEvent("policy-decision", "policy_decision", {
        policyDecision: {
          outcome: "allowed",
          policyRef: "$.constraints.auditLevel",
        },
      }),
    ];

    expect(new Set(events.map((event) => event.kind))).toEqual(
      new Set(EVIDENCE_EVENT_KINDS),
    );
    expect(
      events.every((event) => event.version === EVIDENCE_EVENT_VERSION),
    ).toBe(true);
    expect(events.every((event) => isEvidenceEvent(event))).toBe(true);
    expect(
      events.every(
        (event) =>
          event.source.kind === "pass" &&
          event.privacy.privacyClass === "internal" &&
          event.redaction.mode === "none",
      ),
    ).toBe(true);
  });

  it("rejects events that omit redaction metadata", () => {
    const event = createBaseEvent("missing-redaction", "pass_decision", {
      passDecision: {
        decision: "applied",
        pass: passIdentity,
      },
    });
    const withoutRedaction: unknown = {
      ...event,
      redaction: undefined,
    };

    expect(validateEvidenceEvent(withoutRedaction)).toEqual({
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

function createBaseEvent<TKind extends EvidenceEvent["kind"]>(
  id: string,
  kind: TKind,
  detail: Omit<
    Extract<EvidenceEvent, { kind: TKind }>,
    "id" | "kind" | "privacy" | "redaction" | "source" | "summary" | "version"
  >,
): Extract<EvidenceEvent, { kind: TKind }> {
  return {
    id,
    kind,
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: "evidence-test-run",
    },
    summary: `Evidence event ${id}.`,
    version: EVIDENCE_EVENT_VERSION,
    ...detail,
  } as Extract<EvidenceEvent, { kind: TKind }>;
}
