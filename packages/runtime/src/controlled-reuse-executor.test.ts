import { describe, expect, it, vi } from "vitest";

import {
  CONTROLLED_REUSE_AUTHORIZATION_VERSION,
  CONTROLLED_REUSE_EXECUTION_VERSION,
  CONTROLLED_REUSE_PLAN_VERSION,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  OBSERVED_TRAJECTORY_COMPARISON_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  REUSE_VALUE_STORE_VERSION,
  createEphemeralReuseValueStore,
  executeControlledReuse,
  parseControlledReuseExecutionEvidence,
  planControlledReuse,
  renderControlledReuseExecutionEvidence,
  serializeControlledReuseExecutionEvidence,
  type ControlledReuseExecutionInput,
  type ControlledReusePlanningInput,
  type ReuseValueCodec,
} from "./index.js";

const NOW = "2026-01-01T00:05:00.000Z";
const stringCodec: ReuseValueCodec<string> = {
  isValue: (value): value is string => typeof value === "string",
  version: "repo-file-read.string.v1",
};

describe("executeControlledReuse", () => {
  it("parses legacy v0 evidence but rejects incompatible or privacy-unsafe serialized evidence", () => {
    const legacy = {
      action: "execute_normally",
      actualSkippedActions: 0,
      nodeId: "tool-read",
      previousNodeId: "previous-tool-read",
      reasonCodes: ["opt_in_required"],
      version: CONTROLLED_REUSE_EXECUTION_VERSION,
    } as const;

    expect(
      parseControlledReuseExecutionEvidence(JSON.stringify(legacy)),
    ).toEqual(legacy);
    expect(() =>
      parseControlledReuseExecutionEvidence(
        JSON.stringify({
          ...legacy,
          version: "migaki.controlled-reuse-execution.v99",
        }),
      ),
    ).toThrow(/Expected migaki\.controlled-reuse-execution\.v0 evidence/u);
    expect(() =>
      parseControlledReuseExecutionEvidence(
        JSON.stringify({ ...legacy, tool_input: "private tool input" }),
      ),
    ).toThrow(/Expected migaki\.controlled-reuse-execution\.v0 evidence/u);
    expect(() =>
      parseControlledReuseExecutionEvidence(
        JSON.stringify({ ...legacy, localPath: "/Users/alice/private.txt" }),
      ),
    ).toThrow(/Expected migaki\.controlled-reuse-execution\.v0 evidence/u);
  });

  it("returns one validated stored read and records exactly one skipped action", async () => {
    const current = createPlanningInput();
    const store = createStore();
    insert(store, "private contents at /Users/alice/secret.txt");
    const executeNormally = vi.fn(async () => "fresh contents");
    const validateBehaviorEquivalence = vi.fn(() => true);

    const result = await executeControlledReuse(createExecutionInput(current), {
      codec: stringCodec,
      executeNormally,
      now: NOW,
      store,
      validateBehaviorEquivalence,
    });

    expect(result).toMatchObject({
      evidence: {
        action: "reuse",
        actualSkippedActions: 1,
        decisionRef: {
          currentRunId: "current-run",
          nodeId: "tool-read",
          previousRunId: "previous-run",
          version: REUSE_DECISION_ARTIFACT_VERSION,
        },
        eligibilityChecks: [
          { name: "decision_status", status: "passed" },
          { name: "exact_match", status: "passed" },
          { name: "operation_kind", status: "passed" },
          { name: "side_effect_class", status: "passed" },
          { name: "source_equivalence", status: "passed" },
          { name: "freshness", status: "passed" },
          { name: "dependencies", status: "passed" },
          { name: "policy", status: "passed" },
        ],
        executionOutcome: "reused",
        invalidation: { count: 0, reasonCodes: [] },
        nodeId: "tool-read",
        planExecutionDiff: {
          changed: false,
          executedAction: "reuse",
          plannedAction: "reuse",
        },
        policyRef: {
          authorizationVersion: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
          mode: "exact_read_only_tool_call",
          plannerVersion: CONTROLLED_REUSE_PLAN_VERSION,
        },
        previousNodeId: "previous-tool-read",
        reasonCodes: [],
        realizedMetrics: {
          actualSkippedActions: 1,
          invalidations: 0,
          normalExecutions: 0,
          plannedReuse: 1,
          potentialReuse: 1,
        },
        storeRef: {
          id: "controlled-reuse-test",
          outcome: "hit",
          valueSchemaVersion: "repo-file-read.string.v1",
          version: REUSE_VALUE_STORE_VERSION,
        },
        validatorOutcomes: [
          { id: "source-exact", status: "passed" },
          { id: "behavior_equivalence", status: "passed" },
        ],
      },
      status: "reused",
      value: "private contents at /Users/alice/secret.txt",
    });
    expect(executeNormally).not.toHaveBeenCalled();
    expect(validateBehaviorEquivalence).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.evidence)).not.toContain("private contents");
    expect(JSON.stringify(result.evidence)).not.toContain("/Users/alice");
    expect(
      parseControlledReuseExecutionEvidence(
        serializeControlledReuseExecutionEvidence(result.evidence),
      ),
    ).toEqual(result.evidence);
    expect(renderControlledReuseExecutionEvidence(result.evidence, "human"))
      .toMatchInlineSnapshot(`
        "Migaki Controlled Reuse Execution
        Node: previous-tool-read -> tool-read
        Plan/execution: reuse -> reuse (unchanged)
        Outcomes: 1 potential, 1 planned, 1 skipped, 0 normal, 0 invalidated
        Store: hit (migaki.reuse-value-store.v0)
        Validators: source-exact passed; behavior_equivalence passed
        Estimates: none; realized metrics are reported separately
        Reasons: none
        "
      `);
  });

  it("executes normally when controlled reuse is disabled, even with a prior reuse plan", async () => {
    const current = createPlanningInput();
    const input = createExecutionInput(current);
    current.policy.mode = "disabled";
    const store = createStore();
    insert(store, "stored contents");
    const executeNormally = vi.fn(async () => "fresh contents");

    const result = await executeControlledReuse(input, {
      codec: stringCodec,
      executeNormally,
      now: NOW,
      store,
      validateBehaviorEquivalence: () => true,
    });

    expect(result).toMatchObject({
      evidence: {
        action: "execute_normally",
        actualSkippedActions: 0,
        nodeId: "tool-read",
        previousNodeId: "previous-tool-read",
        reasonCodes: ["opt_in_required"],
        version: CONTROLLED_REUSE_EXECUTION_VERSION,
      },
      status: "executed_normally",
      value: "fresh contents",
    });
    expect(executeNormally).toHaveBeenCalledOnce();
  });

  it("falls back exactly once for mismatched store provenance or behavior-equivalence failure", async () => {
    const current = createPlanningInput();
    const executeOnMiss = vi.fn(async () => "fresh after miss");
    const mismatchedStore = createStore();
    insert(mismatchedStore, "wrong source", "sha256:different-read");

    const miss = await executeControlledReuse(createExecutionInput(current), {
      codec: stringCodec,
      executeNormally: executeOnMiss,
      now: NOW,
      store: mismatchedStore,
      validateBehaviorEquivalence: () => true,
    });

    expect(miss).toMatchObject({
      evidence: {
        action: "execute_normally",
        actualSkippedActions: 0,
        reasonCodes: ["provenance_mismatch"],
      },
      status: "executed_normally",
      value: "fresh after miss",
    });
    expect(executeOnMiss).toHaveBeenCalledOnce();

    const store = createStore();
    insert(store, "stored contents");
    const executeOnInvalid = vi.fn(async () => "fresh after validation");
    const invalid = await executeControlledReuse(
      createExecutionInput(createPlanningInput()),
      {
        codec: stringCodec,
        executeNormally: executeOnInvalid,
        now: NOW,
        store,
        validateBehaviorEquivalence: () => false,
      },
    );

    expect(invalid).toMatchObject({
      evidence: {
        action: "execute_normally",
        actualSkippedActions: 0,
        executionOutcome: "executed_normally",
        invalidation: {
          count: 1,
          reasonCodes: ["behavior_equivalence_failed"],
        },
        realizedMetrics: {
          actualSkippedActions: 0,
          invalidations: 1,
          normalExecutions: 1,
          plannedReuse: 1,
          potentialReuse: 1,
        },
        storeRef: { outcome: "invalidated" },
        reasonCodes: ["behavior_equivalence_failed"],
      },
      status: "executed_normally",
      value: "fresh after validation",
    });
    expect(executeOnInvalid).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it("blocks changed operation identity before lookup or execution", async () => {
    const planned = createPlanningInput();
    const input = createExecutionInput(planned);
    firstCandidate(planned).evidence.source.currentFingerprint =
      "sha256:changed-read";
    const store = createStore();
    insert(store, "stored contents");
    const executeNormally = vi.fn(async () => "must not run");

    const result = await executeControlledReuse(input, {
      codec: stringCodec,
      executeNormally,
      now: NOW,
      store,
      validateBehaviorEquivalence: () => true,
    });

    expect(result).toMatchObject({
      evidence: {
        action: "blocked",
        actualSkippedActions: 0,
        nodeId: "tool-read",
        previousNodeId: "previous-tool-read",
        reasonCodes: ["source_fingerprint_mismatch"],
        version: CONTROLLED_REUSE_EXECUTION_VERSION,
      },
      status: "blocked",
    });
    expect(executeNormally).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a model call",
      "operationKind",
      "model_call",
      "operation_kind_unsupported",
    ],
    [
      "a permissioned operation",
      "sideEffectClass",
      "approval_required",
      "side_effect_unsupported",
    ],
  ] as const)(
    "blocks %s from the reuse path",
    async (_name, key, value, reason) => {
      const current = createPlanningInput();
      const input = createExecutionInput(current);
      (
        firstCandidate(current).eligibility as unknown as Record<string, string>
      )[key] = value;
      const executeNormally = vi.fn(async () => "must not run");

      const result = await executeControlledReuse(input, {
        codec: stringCodec,
        executeNormally,
        now: NOW,
        store: createStore(),
        validateBehaviorEquivalence: () => true,
      });

      expect(result).toMatchObject({
        evidence: { action: "blocked" },
        status: "blocked",
      });
      expect(result.evidence.reasonCodes).toContain(reason);
      expect(executeNormally).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "freshness",
      (input: MutablePlanningInput) => {
        firstCandidate(input).evidence.freshness.maximumAgeMs = 1;
      },
      "freshness_stale",
    ],
    [
      "dependencies",
      (input: MutablePlanningInput) => {
        firstCandidate(input).evidence.dependencies.status = "failed";
      },
      "dependency_evidence_failed",
    ],
    [
      "policy",
      (input: MutablePlanningInput) => {
        firstCandidate(input).evidence.policy.status = "failed";
      },
      "policy_evidence_failed",
    ],
    [
      "validators",
      (input: MutablePlanningInput) => {
        (firstCandidate(input).validators.passed as string[]).splice(0);
      },
      "validator_missing",
    ],
  ] as const)(
    "rechecks current %s evidence at the boundary",
    async (_name, mutate, reason) => {
      const current = createPlanningInput();
      const input = createExecutionInput(current);
      mutate(current);
      const executeNormally = vi.fn(async () => "must not run");

      const result = await executeControlledReuse(input, {
        codec: stringCodec,
        executeNormally,
        now: NOW,
        store: createStore(),
        validateBehaviorEquivalence: () => true,
      });

      expect(result).toMatchObject({
        evidence: { action: "blocked" },
        status: "blocked",
      });
      expect(result.evidence.reasonCodes).toContain(reason);
      expect(executeNormally).not.toHaveBeenCalled();
    },
  );

  it("fails closed for malformed execution input", async () => {
    const executeNormally = vi.fn(async () => "must not run");

    const result = await executeControlledReuse(null, {
      codec: stringCodec,
      executeNormally,
      now: NOW,
      store: createStore(),
      validateBehaviorEquivalence: () => true,
    });

    expect(result).toMatchObject({
      evidence: {
        action: "blocked",
        actualSkippedActions: 0,
        reasonCodes: ["incompatible_execution_input"],
      },
      status: "blocked",
    });
    expect(executeNormally).not.toHaveBeenCalled();

    const unsafe = createExecutionInput(createPlanningInput());
    (unsafe as { nodeId: string }).nodeId = "/Users/alice/private.txt";
    const unsafeResult = await executeControlledReuse(unsafe, {
      codec: stringCodec,
      executeNormally,
      now: NOW,
      store: createStore(),
      validateBehaviorEquivalence: () => true,
    });
    expect(JSON.stringify(unsafeResult.evidence)).not.toContain("/Users/alice");
  });

  it("blocks malformed non-reuse input without executing or echoing caller reasons", async () => {
    const executeNormally = vi.fn(async () => "must not run");
    const secretReason = "secret_reason_payload";

    const result = await executeControlledReuse(
      {
        current: {
          candidates: [
            {
              nodeId: "tool-read",
              previousNodeId: "previous-tool-read",
            },
          ],
        },
        nodeId: "tool-read",
        plan: {
          action: "execute_normally",
          nodeId: "tool-read",
          previousNodeId: "previous-tool-read",
          reasonCodes: [secretReason],
        },
        version: CONTROLLED_REUSE_EXECUTION_VERSION,
      },
      {
        codec: stringCodec,
        executeNormally,
        now: NOW,
        store: createStore(),
        validateBehaviorEquivalence: () => true,
      },
    );

    expect(result).toMatchObject({
      evidence: {
        action: "blocked",
        actualSkippedActions: 0,
        reasonCodes: ["incompatible_authorization_input"],
      },
      status: "blocked",
    });
    expect(executeNormally).not.toHaveBeenCalled();
    expect(JSON.stringify(result.evidence)).not.toContain(secretReason);
  });
});

function createExecutionInput(
  current: ControlledReusePlanningInput,
): ControlledReuseExecutionInput {
  return {
    current,
    nodeId: "tool-read",
    plan: firstPlan(current),
    version: CONTROLLED_REUSE_EXECUTION_VERSION,
  };
}

function firstPlan(current: ControlledReusePlanningInput) {
  const plan = planControlledReuse(current, { now: NOW }).nodes[0];
  if (plan === undefined) {
    throw new Error("Expected one controlled-reuse plan node.");
  }
  return plan;
}

function firstCandidate(input: MutablePlanningInput) {
  const candidate = input.candidates[0];
  if (candidate === undefined) {
    throw new Error("Expected one controlled-reuse candidate.");
  }
  return candidate;
}

function createStore() {
  return createEphemeralReuseValueStore({
    lifetime: {
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T01:00:00.000Z",
      id: "controlled-reuse-test",
    },
    maxEntries: 2,
  });
}

function insert(
  store: ReturnType<typeof createStore>,
  value: string,
  fingerprint = "sha256:exact-read",
) {
  return store.insert(
    {
      freshness: { maximumAgeMs: 600_000, observedAt: NOW },
      provenance: {
        decisionArtifactVersion: REUSE_DECISION_ARTIFACT_VERSION,
        fingerprint,
        nodeId: "tool-read",
        previousRunId: "previous-run",
      },
      value,
      version: REUSE_VALUE_STORE_VERSION,
    },
    stringCodec,
    { now: NOW },
  );
}

function createPlanningInput(): MutablePlanningInput {
  return {
    candidates: [
      {
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
        nodeId: "tool-read",
        previousNodeId: "previous-tool-read",
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
    policy: {
      authorizationVersion: CONTROLLED_REUSE_AUTHORIZATION_VERSION,
      mode: "exact_read_only_tool_call",
    },
    version: CONTROLLED_REUSE_PLAN_VERSION,
  };
}

interface MutablePlanningInput extends ControlledReusePlanningInput {
  candidates: Array<
    ControlledReusePlanningInput["candidates"][number] & {
      eligibility: Record<string, string>;
      evidence: {
        dependencies: { status: "failed" | "passed" | "unknown" };
        freshness: {
          maximumAgeMs: number;
          observedAt: string;
          status: "failed" | "passed" | "unknown";
        };
        policy: { status: "failed" | "passed" | "unknown" };
        source: {
          currentFingerprint: string;
          equivalence: "exact" | "unknown";
          previousFingerprint: string;
        };
      };
    }
  >;
  policy: {
    authorizationVersion: typeof CONTROLLED_REUSE_AUTHORIZATION_VERSION;
    mode: "disabled" | "exact_read_only_tool_call";
  };
}
