import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION } from "@migaki/mir";
import {
  serializeMockExecutionTraceArtifact,
  type MockExecutionTraceArtifact,
} from "@migaki/runtime";

import { CLI_REPLAY_VERSION, runCli } from "./index.js";

const startedAt = "2026-01-01T00:00:00.000Z";
const completedAt = "2026-01-01T00:00:00.003Z";
const usage = {
  latencyMs: 3,
};
const validation = {
  status: "passed",
  targetRef: "ctx-answer",
  validatorId: "source-grounding",
} as const;

describe("replay command", () => {
  it("replays a known-good mock trace as deterministic JSON", async () => {
    const trace = createReplayTrace();
    const result = await runCli(
      ["replay", "--input", "trace.json", "--format", "json"],
      fakeIo({
        "trace.json": serializeMockExecutionTraceArtifact(trace),
      }),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "mock_trace_replay",
      backend: "mock",
      mismatchCount: 0,
      mismatches: [],
      outputCount: 1,
      planId: "rag-replay",
      replayStatus: "matched",
      resultStatus: "succeeded",
      traceId: "trace-rag-replay",
      validatorResults: [
        {
          status: "passed",
          validatorId: "source-grounding",
        },
      ],
      version: CLI_REPLAY_VERSION,
    });
  });

  it("renders mismatch reports with clear paths", async () => {
    const trace = createReplayTrace();
    const mutatedTrace: MockExecutionTraceArtifact = {
      ...trace,
      result: {
        ...trace.result,
        outputs: [
          {
            nodeId: "node-validate",
            outputRef: "fixture://changed-validation",
          },
        ],
      },
    };
    const result = await runCli(
      ["replay", "--input", "trace.json"],
      fakeIo({
        "trace.json": serializeMockExecutionTraceArtifact(mutatedTrace),
      }),
    );

    expect(result).toEqual({
      exitCode: 1,
      stderr: "",
      stdout: [
        "Migaki Replay",
        "Artifact: mock_trace",
        "Trace: trace-rag-replay",
        "Plan: rag-replay",
        "Backend: mock",
        "Replay: mismatched",
        "Result: succeeded",
        "Mismatches:",
        "- result.outputs",
        "Validators:",
        "- source-grounding: passed",
        "",
      ].join("\n"),
    });
  });

  it("exits non-zero for incompatible trace artifacts", async () => {
    const result = await runCli(
      ["replay", "--input", "trace.json", "--format", "json"],
      fakeIo({
        "trace.json": JSON.stringify({
          version: "migaki.trace-artifact.v99",
        }),
      }),
    );

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        "Invalid input artifact: Invalid mock execution trace artifact.\n",
      stdout: "",
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

function createReplayTrace(): MockExecutionTraceArtifact {
  return {
    artifactId: "trace-artifact-rag-replay",
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
      ref: "evidence://bundle/rag-replay",
    },
    plan: {
      planId: "rag-replay",
      version: MIR_V0_VERSION,
    },
    redactions: [],
    responses: [
      {
        contextId: "ctx-validation",
        nodeId: "node-validate",
        outputRef: "fixture://validation",
        usage,
        validation,
      },
    ],
    result: {
      loweredPlanId: "mock-lowered-rag-replay",
      outputs: [
        {
          contextId: "ctx-validation",
          metadata: {
            validation,
          },
          nodeId: "node-validate",
          outputRef: "fixture://validation",
        },
      ],
      status: "succeeded",
      usage,
      version: "migaki.providers.v0",
      warnings: [],
    },
    steps: [
      {
        completedAt,
        id: "mock-step-001-node-validate",
        kind: "validator",
        nodeId: "node-validate",
        outputRef: "fixture://validation",
        requestRef: "mock://requests/node-validate",
        sourceNodeId: "node-validate",
        startedAt,
        status: "succeeded",
        usage,
        validation,
      },
    ],
    timing: {
      completedAt,
      durationMs: 3,
      startedAt,
    },
    traceId: "trace-rag-replay",
    validatorResults: [validation],
    version: "migaki.trace-artifact.v0",
  };
}
