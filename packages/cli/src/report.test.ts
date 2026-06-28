import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";
import {
  EVIDENCE_EVENT_VERSION,
  PASS_CONTRACT_VERSION,
  createEvidenceBundle,
  diffMIRPlans,
  serializeEvidenceBundle,
  serializeMockExecutionTraceArtifact,
  type EvidenceEvent,
  type MockExecutionTraceArtifact,
  type PassWarning,
} from "@migaki/runtime";

import { CLI_REPORT_VERSION, runCli } from "./index.js";

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

describe("report command", () => {
  it("renders evidence bundles as deterministic JSON", async () => {
    const bundle = createReportBundle();
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "json"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "evidence_bundle",
      costEstimates: [
        {
          subjectRef: "$.nodes[0]",
          unit: "usd",
          value: 0.01,
        },
      ],
      passCount: 1,
      passes: [
        {
          enabled: true,
          name: "test.pass",
          version: "0.0.0",
        },
      ],
      planDiffChangeCount: 1,
      plans: {
        optimized: "plan-after",
        original: "plan-before",
      },
      replay: {
        handles: ["trace://bundle-run"],
        mode: "metadata",
      },
      reportWarnings: [],
      routingDecisions: [
        {
          nodeId: "node-rank",
          reason: "Ranking can use the mock backend.",
          target: "mock/mock-ranker",
        },
      ],
      runId: "bundle-run",
      tokenEstimates: [
        {
          subjectRef: "$.nodes[0]",
          unit: "tokens",
          value: 42,
        },
      ],
      validatorResults: [
        {
          status: "passed",
          validatorId: "source-grounding",
        },
      ],
      version: CLI_REPORT_VERSION,
      warnings: [
        {
          code: "assumption_recorded",
          message: "A runtime assumption was recorded.",
          severity: "warning",
        },
      ],
    });
  });

  it("renders human-readable reports with obvious warnings and replay metadata", async () => {
    const bundle = createReportBundle();
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "human"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "Migaki Report",
        "Artifact: evidence_bundle",
        "Run: bundle-run",
        "Plans: plan-before -> plan-after",
        "Plan diff: 1 change",
        "Passes:",
        "- test.pass@0.0.0 enabled",
        "Warnings:",
        "- [warning] assumption_recorded: A runtime assumption was recorded.",
        "Estimates:",
        "- token $.nodes[0]: 42 tokens",
        "- cost $.nodes[0]: 0.01 usd",
        "Routing:",
        "- node-rank -> mock/mock-ranker: Ranking can use the mock backend.",
        "Validators:",
        "- source-grounding: passed",
        "Replay: metadata trace://bundle-run",
        "Report warnings: none",
        "",
      ].join("\n"),
    });
  });

  it("warns explicitly when optional evidence sections are missing", async () => {
    const bundle = createEvidenceBundle({
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
    const result = await runCli(
      ["report", "--input", "bundle.json", "--format", "json"],
      fakeIo({
        "bundle.json": serializeEvidenceBundle(bundle),
      }),
    );

    expect(JSON.parse(result.stdout).reportWarnings).toEqual([
      "Missing token estimates.",
      "Missing cost estimates.",
      "Missing routing decisions.",
      "Missing validator results.",
      "Missing replay handles.",
    ]);
  });

  it("renders mock trace run artifacts as JSON", async () => {
    const trace = createTraceArtifact();
    const result = await runCli(
      ["report", "--input", "trace.json", "--format", "json"],
      fakeIo({
        "trace.json": serializeMockExecutionTraceArtifact(trace),
      }),
    );

    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "mock_trace",
      backend: "mock",
      evidenceBundleRef: "evidence://bundle/rag-baseline",
      planId: "rag-baseline",
      reportWarnings: [],
      resultStatus: "succeeded",
      stepCount: 1,
      timing: {
        durationMs: 5,
      },
      traceId: "trace-rag-baseline",
      validatorResults: [
        {
          status: "passed",
          validatorId: "source-grounding",
        },
      ],
      version: CLI_REPORT_VERSION,
    });
  });
});

function fakeIo(files: Readonly<Record<string, string>>): {
  readonly readFile: (path: string) => Promise<string>;
} {
  return {
    async readFile(path: string): Promise<string> {
      const file = files[path];

      if (file === undefined) {
        throw new Error(`Missing test file ${path}.`);
      }

      return file;
    },
  };
}

function createReportBundle(): ReturnType<typeof createEvidenceBundle> {
  const before = createPlan("plan-before");
  const after = {
    ...createPlan("plan-after"),
    context: [
      {
        contentRef: "fixture://ctx-a",
        id: "ctx-a",
        mutability: "fixed",
        provenance: {
          source: "user",
        },
        role: "user_input",
      },
    ],
  } satisfies MIRPlan;

  return createEvidenceBundle({
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
      createEvent("cost-estimate", "estimate", {
        estimate: {
          confidence: "estimated",
          estimateKind: "cost",
          subjectRef: "$.nodes[0]",
          unit: "usd",
          value: 0.01,
        },
      }),
      createEvent("routing", "routing_decision", {
        routingDecision: {
          nodeId: "node-rank",
          reason: "Ranking can use the mock backend.",
          target: "mock/mock-ranker",
        },
      }),
      createEvent("validator", "validator_result", {
        validatorResult: {
          status: "passed",
          validatorId: "source-grounding",
        },
      }),
    ],
    optimizedPlan: {
      planId: after.id,
      version: after.version,
    },
    originalPlan: {
      planId: before.id,
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
    planDiff: diffMIRPlans(before, after),
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
}

function createPlan(id: string): MIRPlan {
  return {
    id,
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context: [],
    nodes: [],
    edges: [],
  };
}

function createTraceArtifact(): MockExecutionTraceArtifact {
  return {
    artifactId: "trace-artifact-rag-baseline",
    backend: {
      contractVersion: "migaki.providers.v0",
      id: "mock-backend",
      kind: "mock",
      mockBackendVersion: "migaki.mock-backend.v0",
      provider: "mock",
    },
    createdAt: "2026-01-01T00:00:01.000Z",
    evidenceBundleRef: {
      kind: "artifact",
      ref: "evidence://bundle/rag-baseline",
    },
    plan: {
      planId: "rag-baseline",
      version: MIR_V0_VERSION,
    },
    redactions: [],
    responses: [],
    result: {
      loweredPlanId: "mock-lowered-rag-baseline",
      outputs: [],
      status: "succeeded",
      version: "migaki.providers.v0",
      warnings: [],
    },
    steps: [
      {
        completedAt: "2026-01-01T00:00:00.005Z",
        id: "mock-step-001-node-validate",
        kind: "validator",
        nodeId: "node-validate",
        requestRef: "mock://requests/node-validate",
        sourceNodeId: "node-validate",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "succeeded",
      },
    ],
    timing: {
      durationMs: 5,
    },
    traceId: "trace-rag-baseline",
    validatorResults: [
      {
        status: "passed",
        validatorId: "source-grounding",
      },
    ],
    version: "migaki.trace-artifact.v0",
  };
}

function createEvent<TKind extends EvidenceEvent["kind"]>(
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
      runId: "bundle-run",
    },
    summary: `Evidence event ${id}.`,
    version: EVIDENCE_EVENT_VERSION,
    ...detail,
  } as Extract<EvidenceEvent, { kind: TKind }>;
}
