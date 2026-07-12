import { describe, expect, it } from "vitest";

import {
  CONTROLLED_REUSE_AUTHORIZATION_VERSION,
  CONTROLLED_REUSE_PLAN_VERSION,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  OBSERVED_TRAJECTORY_COMPARISON_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  planControlledReuse,
  type ControlledReusePlanningInput,
} from "./index.js";

describe("planControlledReuse", () => {
  it("plans reuse only for an exact, allowed, read-only tool call under explicit opt-in", () => {
    const result = planControlledReuse(createInput(), { now: NOW });

    expect(result).toEqual({
      nodes: [
        {
          action: "reuse",
          nodeId: "tool-read",
          previousNodeId: "previous-tool-read",
          provenance: {
            authorizationVersion: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
            comparisonVersion: OBSERVED_TRAJECTORY_COMPARISON_VERSION,
            currentRunId: "current-run",
            decisionArtifactVersion: REUSE_DECISION_ARTIFACT_VERSION,
            decisionNodeId: "tool-read",
            fingerprint: "sha256:exact-read",
            plannerVersion: CONTROLLED_REUSE_PLAN_VERSION,
            previousNodeId: "previous-tool-read",
            previousRunId: "previous-run",
          },
          reasonCodes: [],
        },
      ],
      version: CONTROLLED_REUSE_PLAN_VERSION,
      warnings: [],
    });
  });

  it.each([
    [
      "disabled opt-in",
      (input: MutableInput) => {
        input.policy.mode = "disabled";
      },
      "execute_normally",
      "opt_in_required",
    ],
    [
      "non-exact source equivalence",
      (input: MutableInput) => {
        firstCandidate(input).eligibility.match = "semantic";
      },
      "execute_normally",
      "source_equivalence_needs_review",
    ],
    [
      "a review-required decision",
      (input: MutableInput) => {
        firstDecision(input).status = "needs_review";
      },
      "execute_normally",
      "decision_artifact_needs_review",
    ],
    [
      "a missing decision",
      (input: MutableInput) => {
        firstCandidate(input).nodeId = "missing-node";
      },
      "execute_normally",
      "decision_not_found",
    ],
    [
      "a blocked decision",
      (input: MutableInput) => {
        firstDecision(input).status = "blocked";
      },
      "blocked",
      "decision_artifact_blocked",
    ],
    [
      "a model call",
      (input: MutableInput) => {
        firstCandidate(input).eligibility.operationKind = "model_call";
      },
      "blocked",
      "operation_kind_unsupported",
    ],
    [
      "a mutation",
      (input: MutableInput) => {
        firstCandidate(input).eligibility.sideEffectClass =
          "idempotent_mutation";
      },
      "blocked",
      "side_effect_unsupported",
    ],
    [
      "stale freshness evidence",
      (input: MutableInput) => {
        firstCandidate(input).evidence.freshness.maximumAgeMs = 1;
      },
      "blocked",
      "freshness_stale",
    ],
    [
      "a changed source fingerprint",
      (input: MutableInput) => {
        firstCandidate(input).evidence.source.currentFingerprint =
          "sha256:changed";
      },
      "blocked",
      "source_fingerprint_mismatch",
    ],
    [
      "failed dependency evidence",
      (input: MutableInput) => {
        firstCandidate(input).evidence.dependencies.status = "failed";
      },
      "blocked",
      "dependency_evidence_failed",
    ],
    [
      "failed policy evidence",
      (input: MutableInput) => {
        firstCandidate(input).evidence.policy.status = "failed";
      },
      "blocked",
      "policy_evidence_failed",
    ],
    [
      "an omitted required validator outcome",
      (input: MutableInput) => {
        firstCandidate(input).validators.passed = [];
      },
      "blocked",
      "validator_missing",
    ],
    [
      "validator outcomes that drift from the decision artifact",
      (input: MutableInput) => {
        firstCandidate(input).validators = {
          passed: ["different-validator"],
          required: ["different-validator"],
        };
      },
      "blocked",
      "validator_contract_mismatch",
    ],
    [
      "a changed previous-node identity",
      (input: MutableInput) => {
        firstCandidate(input).previousNodeId = "different-previous-node";
      },
      "blocked",
      "previous_node_mismatch",
    ],
  ] as const)(
    "plans deterministic fallback for %s",
    (_name, mutate, expectedAction, expectedReason) => {
      const input = structuredClone(createInput()) as unknown as MutableInput;
      mutate(input);

      const result = planControlledReuse(
        input as unknown as ControlledReusePlanningInput,
        { now: NOW },
      );

      expect(result.nodes[0]).toMatchObject({
        action: expectedAction,
        reasonCodes: expect.arrayContaining([expectedReason]),
      });
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedReason,
            nodeId: firstCandidate(input).nodeId,
          }),
        ]),
      );
    },
  );

  it.each([
    [
      "planner version",
      (input: MutableInput) => {
        input.version = "migaki.controlled-reuse-plan.v99";
      },
      "incompatible_plan_version",
    ],
    [
      "authorization policy version",
      (input: MutableInput) => {
        input.policy.authorizationVersion =
          "migaki.controlled-reuse-authorization.v99";
      },
      "incompatible_authorization_input",
    ],
    [
      "decision artifact version",
      (input: MutableInput) => {
        input.decisionArtifact.version = "migaki.reuse-decision.v99";
      },
      "incompatible_authorization_input",
    ],
  ] as const)(
    "fails closed for an incompatible %s",
    (_name, mutate, reason) => {
      const input = structuredClone(createInput()) as unknown as MutableInput;
      mutate(input);

      expect(
        planControlledReuse(input as unknown as ControlledReusePlanningInput, {
          now: NOW,
        }).nodes[0],
      ).toMatchObject({ action: "blocked", reasonCodes: [reason] });
    },
  );

  it.each([
    ["missing planner input", undefined, "planner-input"],
    [
      "missing candidates",
      { ...createInput(), candidates: undefined },
      "planner-input",
    ],
    [
      "non-array candidates",
      { ...createInput(), candidates: {} },
      "planner-input",
    ],
    [
      "a null candidate",
      { ...createInput(), candidates: [null] },
      "candidate-0",
    ],
    [
      "a candidate without node identity",
      { ...createInput(), candidates: [{}] },
      "candidate-0",
    ],
  ] as const)("blocks %s without throwing", (_name, input, nodeId) => {
    const result = planControlledReuse(
      input as unknown as ControlledReusePlanningInput,
      { now: NOW },
    );

    expect(result.nodes).toEqual([
      {
        action: "blocked",
        nodeId,
        previousNodeId: "unknown",
        reasonCodes: ["incompatible_authorization_input"],
      },
    ]);
    expect(result.warnings).toEqual([
      {
        code: "incompatible_authorization_input",
        message:
          "The authorization policy or decision artifact is malformed or incompatible.",
        nodeId,
      },
    ]);
  });

  it.each([
    [
      "a decision without required validators",
      (input: MutableInput) => {
        delete firstDecision(input).requiredValidators;
      },
    ],
    [
      "a decision with malformed required validators",
      (input: MutableInput) => {
        firstDecision(input).requiredValidators = ["source-exact", 1];
      },
    ],
    [
      "a decision without previous-node provenance",
      (input: MutableInput) => {
        delete firstDecision(input).previousNodeId;
      },
    ],
    [
      "an artifact without the current run identifier",
      (input: MutableInput) => {
        delete input.decisionArtifact.comparisonRef.currentRunId;
      },
    ],
  ] as const)("blocks %s as malformed nested input", (_name, mutate) => {
    const input = structuredClone(createInput()) as unknown as MutableInput;
    mutate(input);

    expect(planControlledReuse(input, { now: NOW })).toMatchObject({
      nodes: [
        {
          action: "blocked",
          nodeId: "tool-read",
          previousNodeId: "previous-tool-read",
          reasonCodes: ["incompatible_authorization_input"],
        },
      ],
      warnings: [
        {
          code: "incompatible_authorization_input",
          nodeId: "tool-read",
        },
      ],
    });
  });

  it("is deterministic and does not mutate inputs or perform work", () => {
    const input = deepFreeze(createInput());
    const before = structuredClone(input);

    const first = planControlledReuse(input, { now: NOW });
    const second = planControlledReuse(input, { now: NOW });

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.nodes).toHaveLength(1);
  });
});

const NOW = "2026-01-01T00:05:00.000Z";

function createInput(): ControlledReusePlanningInput {
  return {
    version: CONTROLLED_REUSE_PLAN_VERSION,
    policy: {
      authorizationVersion: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
      mode: "exact_read_only_tool_call",
    },
    decisionArtifact: {
      comparisonRef: {
        currentRunId: "current-run",
        previousRunId: "previous-run",
        version: OBSERVED_TRAJECTORY_COMPARISON_VERSION,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      decisions: [
        {
          cacheKey: "sha256:exact-read",
          dependencyEvidence: { message: "Exact.", status: "passed" },
          estimates: {},
          freshnessEvidence: { message: "Current.", status: "passed" },
          nodeId: "tool-read",
          operationKind: "tool_call",
          policyConstraints: { message: "Allowed.", status: "passed" },
          previousNodeId: "previous-tool-read",
          reasons: [],
          requiredValidators: ["source-exact"],
          sideEffectClass: "read_only",
          status: "allowed",
        },
      ],
      invariant: "This artifact never skips work.",
      privacyPolicy: {
        exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
        exportMode: "metadata_only",
        fullTraceOptIn: false,
      },
      redaction: {
        mode: "metadata_only",
        omittedFields: ["prompt", "tool_input", "tool_output"],
        reason: "Metadata only.",
      },
      summary: { allowed: 1, blocked: 0, needsReview: 0, totalCandidates: 1 },
      version: REUSE_DECISION_ARTIFACT_VERSION,
    },
    candidates: [
      {
        nodeId: "tool-read",
        previousNodeId: "previous-tool-read",
        eligibility: {
          decisionStatus: "allowed",
          match: "exact",
          operationKind: "tool_call",
          sideEffectClass: "read_only",
        },
        evidence: {
          dependencies: { status: "passed" },
          freshness: {
            maximumAgeMs: 600_000,
            observedAt: "2026-01-01T00:00:00.001Z",
            status: "passed",
          },
          policy: { status: "passed" },
          source: {
            currentFingerprint: "sha256:exact-read",
            equivalence: "exact",
            previousFingerprint: "sha256:exact-read",
          },
        },
        reusableValue: {
          lifetime: {
            createdAt: "2026-01-01T00:00:00.001Z",
            expiresAt: "2026-01-01T00:10:00.001Z",
          },
          provenance: {
            decisionArtifactVersion: REUSE_DECISION_ARTIFACT_VERSION,
            fingerprint: "sha256:exact-read",
            nodeId: "tool-read",
            previousRunId: "previous-run",
          },
          storage: "memory_only",
        },
        validators: { passed: ["source-exact"], required: ["source-exact"] },
      },
    ],
  };
}

interface MutableInput {
  candidates: Array<{
    eligibility: Record<string, string>;
    evidence: {
      dependencies: Record<string, string>;
      freshness: Record<string, number | string>;
      policy: Record<string, string>;
      source: Record<string, string>;
    };
    nodeId: string;
    previousNodeId: string;
    validators: { passed: string[]; required: string[] };
  }>;
  decisionArtifact: {
    comparisonRef: Record<string, unknown>;
    decisions: Array<Record<string, unknown>>;
    version: string;
  };
  policy: { authorizationVersion: string; mode: string };
  version: string;
}

function firstCandidate(
  input: MutableInput,
): MutableInput["candidates"][number] {
  const candidate = input.candidates[0];
  if (candidate === undefined) {
    throw new Error("Expected one controlled-reuse candidate.");
  }
  return candidate;
}

function firstDecision(
  input: MutableInput,
): MutableInput["decisionArtifact"]["decisions"][number] {
  const decision = input.decisionArtifact.decisions[0];
  if (decision === undefined) {
    throw new Error("Expected one reuse decision.");
  }
  return decision;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
