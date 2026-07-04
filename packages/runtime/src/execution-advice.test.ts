import { describe, expect, it } from "vitest";

import {
  isSmokeExecutionRunId,
  selectExecutionAdviceGraphCandidate,
  type ExecutionAdviceGraphCandidate,
} from "./execution-advice.js";

describe("execution advice graph selection", () => {
  it("selects the newest non-smoke graph by default", () => {
    const realRun = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-real-work",
    });
    const newerSmokeRun = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-migaki-smoke-file-reuse-12345",
    });

    expect(
      selectExecutionAdviceGraphCandidate([newerSmokeRun, realRun]),
    ).toEqual(realRun);
  });

  it("includes smoke runs only when explicitly requested", () => {
    const realRun = candidate({
      modifiedAtMs: 1_000,
      runId: "codex-turn-real-work",
    });
    const newerSmokeRun = candidate({
      modifiedAtMs: 2_000,
      runId: "codex-turn-migaki-smoke-file-reuse-12345",
    });

    expect(
      selectExecutionAdviceGraphCandidate([newerSmokeRun, realRun], {
        includeSmoke: true,
      }),
    ).toEqual(newerSmokeRun);
  });

  it("returns undefined when there are no non-smoke candidates", () => {
    expect(selectExecutionAdviceGraphCandidate([])).toBeUndefined();
    expect(
      selectExecutionAdviceGraphCandidate([
        candidate({
          modifiedAtMs: 2_000,
          runId: "codex-session-migaki-smoke-session-12345",
        }),
        candidate({
          modifiedAtMs: 1_000,
          runId: "codex-turn-migaki-smoke-expanded-hooks-12345",
        }),
      ]),
    ).toBeUndefined();
  });

  it("recognizes the smoke run id prefixes emitted by migaki:smoke", () => {
    expect(
      isSmokeExecutionRunId("codex-turn-migaki-smoke-file-reuse-12345"),
    ).toBe(true);
    expect(
      isSmokeExecutionRunId("codex-session-migaki-smoke-session-12345"),
    ).toBe(true);
    expect(isSmokeExecutionRunId("codex-turn-real-work")).toBe(false);
  });
});

function candidate(input: {
  readonly modifiedAtMs: number;
  readonly runId: string;
}): ExecutionAdviceGraphCandidate {
  return {
    graphPath: `/tmp/.migaki/runs/${input.runId}/graph.json`,
    modifiedAtMs: input.modifiedAtMs,
    runId: input.runId,
  };
}
