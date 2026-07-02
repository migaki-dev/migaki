import { describe, expect, it } from "vitest";

import { FakeClock } from "../../../src/testing/index.js";
import {
  EXECUTION_EVENT_VERSION,
  EXECUTION_GRAPH_VERSION,
  EXECUTION_REPORT_VERSION,
  MigakiRuntime,
  buildExecutionGraph,
  createExecutionReportSummary,
  renderExecutionReport,
  stableExecutionHash,
  type ExecutionEvent,
  type ExecutionStore,
} from "./index.js";

describe("execution graph runtime", () => {
  it("replays events into deterministic nodes, edges, statuses, durations, and reports", () => {
    const events = [
      promptEvent(),
      toolStartedEvent("tool-read", "Read", {
        explicitDependencies: ["prompt"],
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-read", "Read", {
        inputTokens: 5,
        outputTokens: 7,
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-test", "Bash", {
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-test", "Bash", {
        timestamp: "2026-01-01T00:00:11.000Z",
      }),
      runCompletedEvent("stop", "2026-01-01T00:00:12.000Z"),
    ];

    const graph = buildExecutionGraph("run-a", events);

    expect(graph).toMatchObject({
      version: EXECUTION_GRAPH_VERSION,
      runId: "run-a",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:12.000Z",
    });
    expect(
      graph.nodes.map((node) => ({
        id: node.id,
        status: node.status,
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        durationMs: node.durationMs,
      })),
    ).toEqual([
      {
        durationMs: 0,
        endedAt: "2026-01-01T00:00:00.000Z",
        id: "prompt",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "ok",
      },
      {
        durationMs: 3000,
        endedAt: "2026-01-01T00:00:04.000Z",
        id: "tool-read",
        startedAt: "2026-01-01T00:00:01.000Z",
        status: "ok",
      },
      {
        durationMs: 6000,
        endedAt: "2026-01-01T00:00:11.000Z",
        id: "tool-test",
        startedAt: "2026-01-01T00:00:05.000Z",
        status: "ok",
      },
      {
        durationMs: 0,
        endedAt: "2026-01-01T00:00:12.000Z",
        id: "stop",
        startedAt: "2026-01-01T00:00:12.000Z",
        status: "ok",
      },
    ]);
    expect(
      graph.edges.map((edge) => ({
        from: edge.from,
        kind: edge.kind,
        to: edge.to,
      })),
    ).toEqual([
      {
        from: "prompt",
        kind: "explicit",
        to: "tool-read",
      },
      {
        from: "tool-read",
        kind: "sequence",
        to: "tool-test",
      },
      {
        from: "tool-test",
        kind: "sequence",
        to: "stop",
      },
    ]);

    const summary = createExecutionReportSummary(graph);

    expect(summary).toMatchObject({
      criticalPath: {
        durationMs: 9000,
        nodeIds: ["prompt", "tool-read", "tool-test", "stop"],
      },
      edgeCount: 3,
      nodeCount: 4,
      status: "ok",
      toolCalls: 2,
      tokenEstimates: {
        inputTokens: 5,
        outputTokens: 7,
      },
      version: EXECUTION_REPORT_VERSION,
    });
    expect(renderExecutionReport(graph)).toContain("## Critical Path");
  });

  it("ignores duplicate event ids during graph construction", () => {
    const graph = buildExecutionGraph("run-a", [
      promptEvent({ eventId: "same" }),
      promptEvent({
        eventId: "same",
        prompt: "duplicate should not replace the first event",
      }),
    ]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.operation.fingerprint).toBe(
      stableExecutionHash({ prompt: "summarize the repository" }),
    );
  });

  it("reports failed operations and repeated fingerprints", () => {
    const repeatedFingerprint = stableExecutionHash({
      tool: "Bash",
      input: {
        command: "pnpm test",
      },
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-test-1", "Bash", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-test-1", "Bash", {
        fingerprint: repeatedFingerprint,
        status: "error",
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-test-2", "Bash", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-test-2", "Bash", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:07.000Z",
      }),
      runCompletedEvent("stop", "2026-01-01T00:00:08.000Z"),
    ]);

    const summary = createExecutionReportSummary(graph);
    const report = renderExecutionReport(graph);

    expect(graph.nodes.find((node) => node.id === "tool-test-1")).toMatchObject(
      {
        status: "error",
      },
    );
    expect(summary.repeatedOperations).toEqual([
      {
        count: 2,
        fingerprint: repeatedFingerprint,
        nodeIds: ["tool-test-1", "tool-test-2"],
        operationKind: "tool_call",
      },
    ]);
    expect(summary.potentialCachePoints).toMatchObject([
      {
        avoidableLatencyMs: 2000,
        fingerprint: repeatedFingerprint,
      },
    ]);
    expect(summary.estimatedAvoidableLatencyMs).toBe(2000);
    expect(report).toContain("- tool-test-1: Bash");
  });

  it("identifies deterministic parallelism candidates from sequence-only edges", () => {
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-a", "Read", {
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-a", "Read", {
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolStartedEvent("tool-b", "Read", {
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolFinishedEvent("tool-b", "Read", {
        timestamp: "2026-01-01T00:00:06.000Z",
      }),
    ]);

    expect(createExecutionReportSummary(graph).potentialParallelism).toEqual([
      {
        nodeIds: ["tool-a", "tool-b"],
        reason:
          "Adjacent operations are ordered only by observation sequence; verify side effects before parallelizing.",
      },
    ]);
  });

  it("appends events, reloads prior JSONL events, and writes reports only when the run completes", async () => {
    const store = new MemoryExecutionStore();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const runtime = new MigakiRuntime({
      clock: {
        now: () => new Date(clock.now()),
      },
      store,
    });

    await runtime.onExecutionEvent(
      promptEvent({ eventId: "prompt-event", timestamp: undefined }),
    );
    clock.advanceBy(1000);
    await runtime.onExecutionEvent(
      runCompletedEvent("stop", undefined, {
        eventId: "stop-event",
      }),
    );

    expect(store.eventsJsonl("run-a")).toHaveLength(2);
    expect(store.graphs).toHaveLength(2);
    expect(store.reports).toHaveLength(1);
    expect(store.graphs.at(-1)?.status).toBe("ok");
  });
});

function promptEvent(
  overrides: {
    readonly eventId?: string;
    readonly prompt?: string;
    readonly timestamp?: string | undefined;
  } = {},
): ExecutionEvent {
  const prompt = overrides.prompt ?? "summarize the repository";

  return {
    version: EXECUTION_EVENT_VERSION,
    id: overrides.eventId ?? "event-prompt",
    lifecycle: "point",
    operation: {
      fingerprint: stableExecutionHash({ prompt }),
      id: "prompt",
      kind: "user_prompt",
      name: "User prompt",
    },
    artifacts: [
      {
        fingerprint: stableExecutionHash({ prompt }),
        id: "prompt-input",
        kind: "prompt",
        metadata: {
          redaction: "raw prompt omitted",
        },
      },
    ],
    metadata: sequenceMetadata(),
    occurredAt: overrides.timestamp ?? "2026-01-01T00:00:00.000Z",
    runId: "run-a",
    status: "ok",
  };
}

function toolStartedEvent(
  id: string,
  toolName: string,
  options: {
    readonly explicitDependencies?: readonly string[];
    readonly fingerprint?: string;
    readonly timestamp: string;
  },
): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: `event-${id}-started`,
    lifecycle: "start",
    operation: {
      fingerprint:
        options.fingerprint ??
        stableExecutionHash({
          input: {
            command: "fixture",
          },
          tool: toolName,
        }),
      id,
      kind: "tool_call",
      name: toolName,
    },
    dependencies:
      options.explicitDependencies?.map((operationId) => ({
        kind: "explicit",
        operationId,
      })) ?? [],
    metadata: sequenceMetadata(),
    occurredAt: options.timestamp,
    runId: "run-a",
  };
}

function toolFinishedEvent(
  id: string,
  toolName: string,
  options: {
    readonly fingerprint?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly status?: "error" | "ok";
    readonly timestamp: string;
  },
): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: `event-${id}-finished`,
    lifecycle: "finish",
    operation: {
      fingerprint:
        options.fingerprint ??
        stableExecutionHash({
          input: {
            command: "fixture",
          },
          tool: toolName,
        }),
      id,
      kind: "tool_call",
      name: toolName,
    },
    artifacts: [
      {
        fingerprint: stableExecutionHash({
          status: options.status ?? "ok",
          tool: toolName,
        }),
        id: `${id}-output`,
        kind: "tool_result",
        metadata: {
          redaction: "raw tool output omitted",
        },
      },
    ],
    metrics: {
      ...(options.inputTokens !== undefined
        ? { inputTokens: options.inputTokens }
        : {}),
      ...(options.outputTokens !== undefined
        ? { outputTokens: options.outputTokens }
        : {}),
    },
    metadata: sequenceMetadata(),
    occurredAt: options.timestamp,
    runId: "run-a",
    status: options.status ?? "ok",
  };
}

function runCompletedEvent(
  id: string,
  timestamp: string | undefined,
  overrides: {
    readonly eventId?: string;
  } = {},
): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: overrides.eventId ?? `event-${id}`,
    lifecycle: "point",
    operation: {
      id,
      kind: "turn",
      name: "Turn completed",
    },
    metadata: sequenceMetadata(),
    occurredAt: timestamp ?? "2026-01-01T00:00:00.000Z",
    runId: "run-a",
    runStatus: "ok",
    status: "ok",
  };
}

function sequenceMetadata(): Record<string, unknown> {
  return {
    sequence: {
      scope: "turn",
    },
    source: {
      adapter: "test",
    },
  };
}

class MemoryExecutionStore implements ExecutionStore {
  readonly graphs = [] as unknown as ReturnType<typeof buildExecutionGraph>[];
  readonly reports: string[] = [];
  readonly #events = new Map<string, ExecutionEvent[]>();

  async appendEvent(runId: string, event: ExecutionEvent): Promise<void> {
    this.#events.set(runId, [...(this.#events.get(runId) ?? []), event]);
  }

  async readEvents(runId: string): Promise<readonly ExecutionEvent[]> {
    return this.#events.get(runId) ?? [];
  }

  async writeGraph(
    _runId: string,
    graph: ReturnType<typeof buildExecutionGraph>,
  ): Promise<void> {
    this.graphs.push(graph);
  }

  async writeReport(_runId: string, report: string): Promise<void> {
    this.reports.push(report);
  }

  eventsJsonl(runId: string): readonly ExecutionEvent[] {
    return this.#events.get(runId) ?? [];
  }
}
