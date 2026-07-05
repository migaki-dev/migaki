import { describe, expect, it } from "vitest";

import {
  createExecutionAdviceGraphCandidate,
  createExecutionAdviceGraphCandidateSelection,
  executionAdviceGraphCandidateSkipReasons,
  formatExecutionAdviceSelectionNote,
  formatNamedCounts,
  isSmokeHarnessExecutionRun,
  isSessionExecutionRunId,
  isSmokeExecutionRunId,
  isTurnExecutionRunId,
  selectExecutionAdviceGraphCandidate,
  sortExecutionAdviceGraphCandidatesByModifiedTime,
  summarizeExecutionAdviceSources,
  type ExecutionAdviceGraphCandidate,
} from "./execution-advice.js";

describe("execution advice graph selection", () => {
  it("selects the newest non-smoke graph by default", () => {
    const realRun = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-real-work",
      status: "ok",
    });
    const newerSmokeRun = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-migaki-smoke-file-reuse-12345",
      status: "ok",
    });

    expect(
      selectExecutionAdviceGraphCandidate([newerSmokeRun, realRun]),
    ).toEqual(realRun);
  });

  it("prefers the newest useful candidate over a newer no-signal candidate", () => {
    const olderUsefulRun = candidate({
      modifiedAtMs: 1_000,
      opportunityCount: 1,
      runId: "codex-turn-useful",
      status: "ok",
      toolCalls: 2,
    });
    const newerNoSignalRun = candidate({
      modifiedAtMs: 2_000,
      opportunityCount: 0,
      runId: "codex-turn-no-signal",
      status: "ok",
      toolCalls: 1,
    });

    expect(
      selectExecutionAdviceGraphCandidate([newerNoSignalRun, olderUsefulRun]),
    ).toEqual(olderUsefulRun);
    expect(
      sortExecutionAdviceGraphCandidatesByModifiedTime([
        newerNoSignalRun,
        olderUsefulRun,
      ])[0],
    ).toEqual(newerNoSignalRun);
  });

  it("includes smoke runs only when explicitly requested", () => {
    const realRun = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-real-work",
      status: "ok",
    });
    const newerSmokeRun = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-migaki-smoke-file-reuse-12345",
      status: "ok",
    });

    expect(
      selectExecutionAdviceGraphCandidate([newerSmokeRun, realRun], {
        includeSmoke: true,
      }),
    ).toEqual(newerSmokeRun);
  });

  it("skips smoke harness turns unless smoke evidence is explicitly requested", () => {
    const realRun = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-real-work",
      status: "ok",
    });
    const newerSmokeHarnessRun = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-smoke-created-cli-proof",
      smokeHarness: true,
      status: "ok",
    });

    const defaultSelection = createExecutionAdviceGraphCandidateSelection([
      newerSmokeHarnessRun,
      realRun,
    ]);

    expect(defaultSelection.selected).toEqual(realRun);
    expect(defaultSelection.rejectedCandidates).toEqual([
      {
        candidate: newerSmokeHarnessRun,
        reasons: ["smoke_harness_run"],
      },
    ]);
    expect(
      selectExecutionAdviceGraphCandidate([newerSmokeHarnessRun, realRun], {
        includeSmoke: true,
      }),
    ).toEqual(newerSmokeHarnessRun);
  });

  it("returns undefined when there are no non-smoke candidates", () => {
    expect(selectExecutionAdviceGraphCandidate([])).toBeUndefined();
    expect(
      selectExecutionAdviceGraphCandidate([
        candidate({
          modifiedAtMs: 2_000,
          runId: "codex-session-migaki-smoke-session-12345",
          status: "ok",
        }),
        candidate({
          modifiedAtMs: 1_000,
          runId: "codex-turn-migaki-smoke-expanded-hooks-12345",
          status: "ok",
        }),
      ]),
    ).toBeUndefined();
  });

  it("skips session and running graphs so advice follows completed turns", () => {
    const completedTurn = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-completed",
      status: "ok",
      toolCalls: 2,
    });
    const newerSession = candidate({
      modifiedAtMs: 3_000,
      runId: "codex-session-latest",
      status: "ok",
      toolCalls: 0,
    });
    const newerRunningTurn = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-current",
      status: "running",
      toolCalls: 0,
    });

    const selection = createExecutionAdviceGraphCandidateSelection([
      newerSession,
      newerRunningTurn,
      completedTurn,
    ]);

    expect(selection.selected).toEqual(completedTurn);
    expect(selection.eligibleCandidates).toEqual([completedTurn]);
    expect(selection.rejectedCandidates).toEqual([
      {
        candidate: newerSession,
        reasons: ["session_run"],
      },
      {
        candidate: newerRunningTurn,
        reasons: ["running_run"],
      },
    ]);
  });

  it("recognizes the smoke run id prefixes emitted by migaki:smoke", () => {
    expect(
      isSmokeExecutionRunId("codex-turn-migaki-smoke-file-reuse-12345"),
    ).toBe(true);
    expect(
      isSmokeExecutionRunId("codex-session-migaki-smoke-session-12345"),
    ).toBe(true);
    expect(isSmokeExecutionRunId("codex-turn-real-work")).toBe(false);
    expect(isSessionExecutionRunId("codex-session-real-work")).toBe(true);
    expect(isSessionExecutionRunId("codex-turn-real-work")).toBe(false);
    expect(isTurnExecutionRunId("codex-turn-real-work")).toBe(true);
    expect(isTurnExecutionRunId("codex-session-real-work")).toBe(false);
  });

  it("recognizes historical smoke harness turns from redacted prompt fingerprints", () => {
    const candidate = createExecutionAdviceGraphCandidate({
      graph: {
        nodes: [
          {
            artifacts: [
              {
                fingerprint:
                  "sha256:2a3576df2778c886810e72ffc355841b8b4c499eee6cad5e16227d968cc1adc9",
                id: "prompt-input",
                kind: "prompt",
              },
            ],
            operation: {
              fingerprint:
                "sha256:2a3576df2778c886810e72ffc355841b8b4c499eee6cad5e16227d968cc1adc9",
              kind: "user_prompt",
            },
          },
        ],
        status: "ok",
      },
      graphPath: "/tmp/.migaki/runs/codex-turn-smoke-created/graph.json",
      modifiedAtMs: 1_000,
      runId: "codex-turn-smoke-created",
    });

    expect(isSmokeHarnessExecutionRun(candidate)).toBe(true);
    expect(executionAdviceGraphCandidateSkipReasons(candidate)).toEqual([
      "smoke_harness_run",
    ]);
  });

  it("summarizes graph status and tool counts for script diagnostics", () => {
    expect(
      createExecutionAdviceGraphCandidate({
        graph: {
          nodes: [
            {
              artifacts: [
                {
                  fingerprint: "sha256:file-a",
                  kind: "file",
                },
              ],
              operation: {
                kind: "user_prompt",
              },
            },
            {
              artifacts: [
                {
                  fingerprint: "sha256:file-a",
                  kind: "file",
                },
              ],
              operation: {
                kind: "tool_call",
              },
            },
          ],
          status: "ok",
        },
        graphPath: "/tmp/.migaki/runs/codex-turn-a/graph.json",
        modifiedAtMs: 1_000,
        runId: "codex-turn-a",
      }),
    ).toEqual({
      graphPath: "/tmp/.migaki/runs/codex-turn-a/graph.json",
      modifiedAtMs: 1_000,
      nodeCount: 2,
      opportunityCount: 1,
      runId: "codex-turn-a",
      status: "ok",
      toolCalls: 1,
    });
  });

  it("reports all default skip reasons for a candidate", () => {
    expect(
      executionAdviceGraphCandidateSkipReasons(
        candidate({
          modifiedAtMs: 1_000,
          runId: "codex-session-migaki-smoke-session-12345",
          status: "running",
        }),
      ),
    ).toEqual(["smoke_run", "session_run", "running_run"]);
  });

  it("explains when advice chooses older useful evidence over the latest eligible turn", () => {
    const olderUsefulRun = candidate({
      modifiedAtMs: 1_000,
      opportunityCount: 1,
      runId: "codex-turn-useful",
      status: "ok",
      toolCalls: 2,
    });
    const newerNoSignalRun = candidate({
      modifiedAtMs: 2_000,
      opportunityCount: 0,
      runId: "codex-turn-no-signal",
      status: "ok",
      toolCalls: 1,
    });

    expect(
      formatExecutionAdviceSelectionNote(olderUsefulRun, newerNoSignalRun),
    ).toBe(
      "selected advice is older than the latest eligible turn because it has actionable signal and the latest eligible turn has none.",
    );
    expect(
      formatExecutionAdviceSelectionNote(newerNoSignalRun, newerNoSignalRun),
    ).toBeUndefined();
  });

  it("summarizes selected advice evidence sources and warns on manual bridge evidence", () => {
    const summary = summarizeExecutionAdviceSources(
      [
        eventLine({ adapter: "codex-hooks" }),
        eventLine({ adapter: "manual-exec" }),
        eventLine({ adapter: "manual-exec" }),
      ].join("\n"),
    );

    expect(formatNamedCounts(summary.sourceAdapters)).toBe(
      "manual-exec 2, codex-hooks 1",
    );
    expect(summary.warning).toBe(
      "selected advice includes manual-exec bridge evidence; use it as coaching, not as native hook proof.",
    );
  });

  it("summarizes native-only advice evidence without a bridge warning", () => {
    const summary = summarizeExecutionAdviceSources(
      [
        eventLine({ adapter: "codex-hooks" }),
        eventLine({ adapter: "codex-hooks" }),
      ].join("\n"),
    );

    expect(formatNamedCounts(summary.sourceAdapters)).toBe("codex-hooks 2");
    expect(summary.warning).toBeUndefined();
  });
});

function candidate(input: {
  readonly modifiedAtMs: number;
  readonly nodeCount?: number;
  readonly opportunityCount?: number;
  readonly runId: string;
  readonly smokeHarness?: boolean;
  readonly status?: string;
  readonly toolCalls?: number;
}): ExecutionAdviceGraphCandidate {
  return {
    graphPath: `/tmp/.migaki/runs/${input.runId}/graph.json`,
    modifiedAtMs: input.modifiedAtMs,
    ...(input.nodeCount !== undefined ? { nodeCount: input.nodeCount } : {}),
    ...(input.opportunityCount !== undefined
      ? { opportunityCount: input.opportunityCount }
      : {}),
    runId: input.runId,
    ...(input.smokeHarness === true ? { smokeHarness: true } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
  };
}

function eventLine(input: { readonly adapter: string }): string {
  return JSON.stringify({
    metadata: {
      source: {
        adapter: input.adapter,
      },
    },
  });
}
