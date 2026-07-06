import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FakeClock } from "../../../src/testing/index.js";
import {
  EXECUTION_EVENT_VERSION,
  EXECUTION_GRAPH_VERSION,
  EXECUTION_REPORT_VERSION,
  MigakiRuntime,
  buildExecutionGraph,
  createExecutionReportSummary,
  renderExecutionAdvice,
  renderExecutionReport,
  stableExecutionHash,
  type AdaptivePolicyBundle,
  type ExecutionEvent,
  type ExecutionStore,
} from "./index.js";

const adaptivePolicyFixturePath = fileURLToPath(
  new URL("./fixtures/adaptive-policy-loop.json", import.meta.url),
);

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

  it("reports repeated successful operations as cache opportunities", () => {
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
    const cacheOpportunityId = `cache-${stableExecutionHash({
      fingerprint: repeatedFingerprint,
      nodeIds: ["tool-test-1", "tool-test-2"],
    }).slice("sha256:".length, "sha256:".length + 12)}`;

    expect(summary.repeatedOperations).toEqual([
      {
        count: 2,
        displayName: "Bash",
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
    expect(summary.opportunities[0]).toEqual({
      actionability: "needs_review",
      blockedBy: [
        "Verify input equivalence, side effects, and freshness requirements before adding a cache.",
      ],
      category: "cache",
      confidence: "high",
      estimatedAvoidableLatencyMs: 2000,
      id: cacheOpportunityId,
      nodeIds: ["tool-test-1", "tool-test-2"],
      priority: "high",
      reason:
        "Bash repeated the same successful tool_call operation 2 times; later runs may be cacheable.",
      safetyNotes: [
        "Observation only: verify inputs, side effects, and freshness requirements before caching.",
      ],
      whyActionable:
        "The same successful tool_call fingerprint repeated with measured later-run latency.",
    });
    expect(summary.opportunitySummary).toEqual({
      actionabilityCounts: {
        actionable: 0,
        blocked: 1,
        needsReview: 1,
      },
      topOpportunityId: cacheOpportunityId,
      topRecommendation: "needs_review cache on nodes tool-test-1, tool-test-2",
      total: 2,
    });
    expect(summary.estimatedAvoidableLatencyMs).toBe(2000);
    expect(report).toContain("## Opportunity Summary");
    expect(report).toContain("- Total: 2");
    expect(report).toContain(
      "- Actionability: actionable 0, needs_review 1, blocked 1",
    );
    expect(report).toContain(
      "- Top recommendation: needs_review cache on nodes tool-test-1, tool-test-2",
    );
    expect(report).toContain("## Opportunities");
    expect(report).toContain(
      "- [needs_review high/high] cache: Bash repeated the same successful tool_call operation 2 times; later runs may be cacheable. Nodes: tool-test-1, tool-test-2; avoidable latency 2000 ms",
    );
    expect(report).toContain(
      "Why actionable: The same successful tool_call fingerprint repeated with measured later-run latency.",
    );
    expect(report).toContain(
      "Blocked by: Verify input equivalence, side effects, and freshness requirements before adding a cache.",
    );
    expect(report).toContain("- tool-test-1: Bash");
  });

  it("reports repeated failures separately from clean cache opportunities", () => {
    const repeatedFingerprint = stableExecutionHash({
      input: {
        command: "pnpm test",
      },
      tool: "Bash",
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
        status: "error",
        timestamp: "2026-01-01T00:00:07.000Z",
      }),
    ]);

    const summary = createExecutionReportSummary(graph);

    expect(summary.potentialCachePoints).toEqual([]);
    expect(summary.estimatedAvoidableLatencyMs).toBeUndefined();
    expect(summary.opportunities).toContainEqual(
      expect.objectContaining({
        actionability: "actionable",
        blockedBy: ["Inspect the failure cause before choosing a fix."],
        category: "failure",
        confidence: "high",
        estimatedAvoidableLatencyMs: 5000,
        nodeIds: ["tool-test-1", "tool-test-2"],
        priority: "high",
        reason:
          "Bash failed repeatedly for the same tool_call operation fingerprint.",
        whyActionable:
          "The same tool_call fingerprint failed more than once, creating a concrete reliability group to investigate.",
      }),
    );
  });

  it("uses conservative opportunity caveats for mixed-status repeated operations", () => {
    const repeatedFingerprint = stableExecutionHash({
      input: {
        command: "pnpm test",
      },
      tool: "Bash",
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
    ]);

    const summary = createExecutionReportSummary(graph);

    expect(summary.potentialCachePoints).toEqual([]);
    expect(summary.opportunities).toContainEqual(
      expect.objectContaining({
        actionability: "needs_review",
        blockedBy: [
          "Mixed success and failure statuses must be explained before retry, cache, or fallback work.",
        ],
        category: "failure",
        confidence: "medium",
        nodeIds: ["tool-test-1", "tool-test-2"],
        priority: "medium",
        safetyNotes: [
          "Mixed success and failure statuses: inspect reliability before treating this as reusable work.",
        ],
        whyActionable:
          "The same tool_call fingerprint produced both success and failure, making the reliability boundary visible.",
      }),
    );
  });

  it("reports repeated file artifacts without raw file paths", () => {
    const fileFingerprint = stableExecutionHash({
      path: "src/execution.ts",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-read-1", "Read", {
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-read-1", "Read", {
        artifacts: [
          fileArtifact("file-read-1", fileFingerprint),
          toolResultArtifact("tool-read-1", "Read"),
        ],
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-read-2", "Read", {
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-read-2", "Read", {
        artifacts: [
          fileArtifact("file-read-2", fileFingerprint),
          toolResultArtifact("tool-read-2", "Read"),
        ],
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
    ]);

    const summary = createExecutionReportSummary(graph);
    const report = renderExecutionReport(graph);

    expect(summary.repeatedFiles).toEqual([
      {
        artifactIds: ["file-read-1", "file-read-2"],
        count: 2,
        fingerprint: fileFingerprint,
        kind: "file",
        nodeIds: ["tool-read-1", "tool-read-2"],
      },
    ]);
    expect(summary.opportunities).toContainEqual(
      expect.objectContaining({
        actionability: "needs_review",
        artifactIds: ["file-read-1", "file-read-2"],
        blockedBy: [
          "Raw file paths are omitted.",
          "A caller-safe file identity and freshness policy is required before reuse.",
          "Command-output equivalence must be verified before avoiding a read.",
        ],
        category: "file_reuse",
        confidence: "medium",
        nodeIds: ["tool-read-1", "tool-read-2"],
        priority: "medium",
        safetyNotes: [
          "Raw file paths and commands are omitted; this fingerprint alone does not prove cacheable tool input or output.",
        ],
        whyActionable:
          "The same redacted file identity was reopened through read-like tool calls.",
      }),
    );
    expect(report).toContain("file fingerprint was observed 2 times");
    expect(report).not.toContain("src/execution.ts");
  });

  it("renders next-session advice for repeated file artifacts using only safe source labels", () => {
    const rawPath = "src/secret-session-plan.ts";
    const fileFingerprint = stableExecutionHash({
      path: rawPath,
    });
    const catFingerprint = stableExecutionHash({
      input: "cat",
      tool: "Bash",
    });
    const sedFingerprint = stableExecutionHash({
      input: "sed",
      tool: "Bash",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-cat", "Bash", {
        fingerprint: catFingerprint,
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-cat", "Bash", {
        artifacts: [
          fileArtifact("file-cat", fileFingerprint, {
            sourceCommand: "cat",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-cat", "Bash"),
        ],
        fingerprint: catFingerprint,
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-sed", "Bash", {
        fingerprint: sedFingerprint,
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-sed", "Bash", {
        artifacts: [
          fileArtifact("file-sed", fileFingerprint, {
            sourceCommand: "sed",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-sed", "Bash"),
        ],
        fingerprint: sedFingerprint,
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
    ]);

    const summary = createExecutionReportSummary(graph);
    const report = renderExecutionReport(graph);
    const advice = renderExecutionAdvice(graph);

    expect(summary.repeatedFiles).toEqual([
      {
        artifactIds: ["file-cat", "file-sed"],
        count: 2,
        fingerprint: fileFingerprint,
        kind: "file",
        nodeIds: ["tool-cat", "tool-sed"],
        sourceLabels: ["Bash cat", "Bash sed"],
      },
    ]);
    expect(summary.opportunitySummary).toMatchObject({
      topRecommendation:
        "needs_review file_reuse across 2 read-like calls (Bash cat, Bash sed)",
    });
    expect(
      summary.opportunities.find(
        (opportunity) => opportunity.category === "file_reuse",
      ),
    ).toMatchObject({
      actionability: "needs_review",
      fileReuseEvidence: {
        automaticSkip: {
          allowed: false,
          reason: "Freshness and source equivalence are unknown.",
        },
        freshness: {
          evidence:
            "No file version, content digest, or modification timestamp was captured for each read-like call.",
          status: "unknown",
        },
        repeatedIdentity: {
          mode: "redacted_fingerprint",
          status: "observed",
        },
        sourceEquivalence: {
          evidence:
            "Safe source labels identify the read-like caller, not equivalent bytes, ranges, or output transforms.",
          status: "unknown",
        },
      },
    });
    expect(report).toContain("Sources: Bash cat, Bash sed");
    expect(report).toContain("Freshness: unknown");
    expect(report).toContain("Source equivalence: unknown");
    expect(report).toContain("Automatic skip: disallowed");
    expect(advice).toContain("# Migaki Session Advice");
    expect(advice).toContain(
      "Top signal: needs_review file_reuse across 2 read-like calls.",
    );
    expect(advice).toContain("Safe source signals: Bash cat, Bash sed");
    expect(advice).toContain("Freshness: unknown");
    expect(advice).toContain("Source equivalence: unknown");
    expect(advice).toContain(
      "Before continuing, check the prior context for files already inspected.",
    );
    expect(advice).toContain(
      "do not cache, replay, or skip reads automatically",
    );
    expect([report, advice].join("\n")).not.toContain(rawPath);
    expect([report, advice].join("\n")).not.toContain("secret-session-plan.ts");
    expect([report, advice].join("\n")).not.toContain("cat src/");
    expect([report, advice].join("\n")).not.toContain("sed -n");
  });

  it("prefers verified file-reuse evidence over unknown file-reuse advice", () => {
    const unknownFileFingerprint = stableExecutionHash({
      path: "src/unknown-freshness.ts",
    });
    const verifiedFileFingerprint = stableExecutionHash({
      path: "src/verified-freshness.ts",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-cat-a", "Bash", {
        fingerprint: stableExecutionHash({
          input: "cat unknown",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-cat-a", "Bash", {
        artifacts: [
          fileArtifact("file-cat-a", unknownFileFingerprint, {
            sourceCommand: "cat",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-cat-a", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          input: "cat unknown",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-cat-b", "Bash", {
        fingerprint: stableExecutionHash({
          input: "cat unknown again",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-cat-b", "Bash", {
        artifacts: [
          fileArtifact("file-cat-b", unknownFileFingerprint, {
            sourceCommand: "cat",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-cat-b", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          input: "cat unknown again",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-sed-a", "Bash", {
        fingerprint: stableExecutionHash({
          input: "sed verified",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-sed-a", "Bash", {
        artifacts: [
          fileArtifact("file-sed-a", verifiedFileFingerprint, {
            commandShape: "sed -n RANGE FILE",
            contentFingerprint: "sha256:verified",
            fileMtimeMs: 1,
            fileSizeBytes: 17,
            rangeLabel: "lines 1-20",
            sourceEquivalenceKey: "sha256:sed-lines-1-20",
            sourceCommand: "sed",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-sed-a", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          input: "sed verified",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:06.000Z",
      }),
      toolStartedEvent("tool-sed-b", "Bash", {
        fingerprint: stableExecutionHash({
          input: "sed verified again",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:07.000Z",
      }),
      toolFinishedEvent("tool-sed-b", "Bash", {
        artifacts: [
          fileArtifact("file-sed-b", verifiedFileFingerprint, {
            commandShape: "sed -n RANGE FILE",
            contentFingerprint: "sha256:verified",
            fileMtimeMs: 1,
            fileSizeBytes: 17,
            rangeLabel: "lines 1-20",
            sourceEquivalenceKey: "sha256:sed-lines-1-20",
            sourceCommand: "sed",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-sed-b", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          input: "sed verified again",
          tool: "Bash",
        }),
        timestamp: "2026-01-01T00:00:08.000Z",
      }),
    ]);

    const fileReuseOpportunities = createExecutionReportSummary(
      graph,
    ).opportunities.filter(
      (opportunity) => opportunity.category === "file_reuse",
    );
    const advice = renderExecutionAdvice(graph);

    expect(fileReuseOpportunities[0]?.fileReuseEvidence).toMatchObject({
      automaticSkip: {
        allowed: false,
        reason: "Automatic skip is disabled by default.",
      },
      freshness: {
        evidence:
          "Matching content fingerprints were captured for each read-like call.",
        status: "verified",
      },
      sourceEquivalence: {
        evidence:
          "Matching command shapes, ranges, and output transforms were captured for each read-like call.",
        status: "verified",
      },
    });
    expect(advice).toContain("Safe source signals: Bash sed");
    expect(advice).toContain("Freshness: verified.");
    expect(advice).toContain("Source equivalence: verified.");
    expect(advice).toContain("Automatic skip: disallowed.");
  });

  it("renders unavailable file-reuse evidence separately from unknown", () => {
    const fileFingerprint = stableExecutionHash({
      path: "src/unavailable-freshness.ts",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-read-a", "Read", {
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-read-a", "Read", {
        artifacts: [
          fileArtifact("file-read-a", fileFingerprint, {
            fileFreshnessUnavailableReason: "stat_failed",
            sourceEquivalenceUnavailableReason: "shape_unavailable",
            sourceField: "file_path",
            toolName: "Read",
          }),
          toolResultArtifact("tool-read-a", "Read"),
        ],
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-read-b", "Read", {
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-read-b", "Read", {
        artifacts: [
          fileArtifact("file-read-b", fileFingerprint, {
            fileFreshnessUnavailableReason: "stat_failed",
            sourceEquivalenceUnavailableReason: "shape_unavailable",
            sourceField: "file_path",
            toolName: "Read",
          }),
          toolResultArtifact("tool-read-b", "Read"),
        ],
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
    ]);

    const opportunity = createExecutionReportSummary(graph).opportunities.find(
      (candidate) => candidate.category === "file_reuse",
    );
    const advice = renderExecutionAdvice(graph);
    const report = renderExecutionReport(graph);

    expect(opportunity?.fileReuseEvidence).toMatchObject({
      automaticSkip: {
        allowed: false,
        reason: "Freshness and source equivalence are unavailable.",
      },
      freshness: {
        evidence: "Freshness evidence unavailable: stat_failed.",
        status: "unavailable",
      },
      sourceEquivalence: {
        evidence: "Source equivalence evidence unavailable: shape_unavailable.",
        status: "unavailable",
      },
    });
    expect(report).toContain("Freshness: unavailable");
    expect(report).toContain("Source equivalence: unavailable");
    expect(advice).toContain("Freshness: unavailable.");
    expect(advice).toContain("Source equivalence: unavailable.");
  });

  it("renders opt-in local dogfood read context in advice only", () => {
    const fileFingerprint = stableExecutionHash({
      path: "/tmp/repo/packages/codex/src/hook.ts",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-read-1", "Read", {
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-read-1", "Read", {
        artifacts: [
          fileArtifact("file-read-1", fileFingerprint, {
            commandShape: "Read.file_path",
            localDogfood: {
              commandShape: "Read.file_path",
              fileVersion: {
                kind: "git_blob",
                value: "sha1:1111111111111111111111111111111111111111",
              },
              rangeLabel: "lines 1-80",
              relativePath: "packages/codex/src/hook.ts",
            },
            sourceField: "file_path",
            toolName: "Read",
          }),
          toolResultArtifact("tool-read-1", "Read"),
        ],
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-read-2", "Read", {
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-read-2", "Read", {
        artifacts: [
          fileArtifact("file-read-2", fileFingerprint, {
            commandShape: "sed -n RANGE FILE",
            localDogfood: {
              commandShape: "sed -n RANGE FILE",
              fileVersion: {
                kind: "git_blob",
                value: "sha1:1111111111111111111111111111111111111111",
              },
              rangeLabel: "lines 1-80",
              relativePath: "packages/codex/src/hook.ts",
            },
            sourceCommand: "sed",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-read-2", "Bash"),
        ],
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
    ]);

    const report = renderExecutionReport(graph);
    const advice = renderExecutionAdvice(graph);

    expect(report).not.toContain("packages/codex/src/hook.ts");
    expect(report).not.toContain("lines 1-80");
    expect(advice).toContain("Local dogfood context:");
    expect(advice).toContain(
      "- Already inspected packages/codex/src/hook.ts (lines 1-80) via Read.file_path, sed -n RANGE FILE; version git_blob sha1:1111111111111111111111111111111111111111.",
    );
    expect(advice).toContain(
      "- Reuse the prior context unless that file changed or the current task needs a missing range.",
    );
  });

  it("keeps advice rendering unchanged without policy input", () => {
    const graph = fileReuseGraphWithRawSourceMetadata();

    expect(renderExecutionAdvice(graph)).toBe(
      renderExecutionAdvice(graph, { policies: [] }),
    );
  });

  it("renders accepted advice-only file_reuse policy provenance without raw graph strings", async () => {
    const graph = fileReuseGraphWithRawSourceMetadata();
    const bundle = await acceptedAdaptivePolicyBundle();
    const advice = renderExecutionAdvice(graph, {
      policies: [bundle],
    });

    expect(advice).toContain("# Migaki Session Advice");
    expect(advice).toContain(
      "Top signal: needs_review file_reuse across 2 read-like calls.",
    );
    expect(advice).toContain("Safe source signals: Bash cat, Bash sed");
    expect(advice).toContain("Policy:");
    expect(advice).toContain(
      "- Applied policy-bundle-file-reuse-priority-001: emphasized file_reuse advice.",
    );
    expect(advice).not.toContain("/tmp/private/secret-session-plan.ts");
    expect(advice).not.toContain("cat /tmp/private");
    expect(advice).not.toContain("sed -n");
    expect(advice).not.toContain("raw prompt secret");
    expect(advice).not.toContain(bundle.rules[0]?.action.note);
  });

  it("ignores disabled, superseded, non-advice, and unsafe policy bundles", async () => {
    const graph = fileReuseGraphWithRawSourceMetadata();
    const acceptedBundle = await acceptedAdaptivePolicyBundle();
    const disabledBundle = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-disabled",
      status: "disabled",
    });
    const supersededBundle = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-superseded",
      status: "superseded",
    });
    const nonAdviceBundle = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-execution-scope",
      scope: "execution",
    });
    const unsafeBundle = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-unsafe",
      safety: {
        ...acceptedBundle.safety,
        prohibitedEffects: ["cache", "parallelize", "replay"],
      },
    });

    const advice = renderExecutionAdvice(graph, {
      policies: [
        disabledBundle,
        supersededBundle,
        nonAdviceBundle,
        unsafeBundle,
      ],
    });

    expect(advice).not.toContain("Policy:");
    expect(advice).not.toContain("policy-bundle-disabled");
    expect(advice).not.toContain("policy-bundle-superseded");
    expect(advice).not.toContain("policy-bundle-execution-scope");
    expect(advice).not.toContain("policy-bundle-unsafe");
  });

  it("renders applicable policy provenance in deterministic order", async () => {
    const graph = fileReuseGraphWithRawSourceMetadata();
    const acceptedBundle = await acceptedAdaptivePolicyBundle();
    const bundleB = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-b",
    });
    const bundleA = policyBundleVariant(acceptedBundle, {
      id: "policy-bundle-a",
    });
    const advice = renderExecutionAdvice(graph, {
      policies: [bundleB, acceptedBundle, bundleA],
    });

    expect(policyLines(advice)).toEqual([
      "- Applied policy-bundle-a: emphasized file_reuse advice.",
      "- Applied policy-bundle-b: emphasized file_reuse advice.",
      "- Applied policy-bundle-file-reuse-priority-001: emphasized file_reuse advice.",
    ]);
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

  it("aggregates multiple blocked parallelism candidates into one opportunity", () => {
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-a", "Read", {
        fingerprint: stableExecutionHash({ input: "a", tool: "Read" }),
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-a", "Read", {
        fingerprint: stableExecutionHash({ input: "a", tool: "Read" }),
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-b", "Read", {
        fingerprint: stableExecutionHash({ input: "b", tool: "Read" }),
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-b", "Read", {
        fingerprint: stableExecutionHash({ input: "b", tool: "Read" }),
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-c", "Read", {
        fingerprint: stableExecutionHash({ input: "c", tool: "Read" }),
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-c", "Read", {
        fingerprint: stableExecutionHash({ input: "c", tool: "Read" }),
        timestamp: "2026-01-01T00:00:06.000Z",
      }),
      toolStartedEvent("tool-d", "Read", {
        fingerprint: stableExecutionHash({ input: "d", tool: "Read" }),
        timestamp: "2026-01-01T00:00:07.000Z",
      }),
      toolFinishedEvent("tool-d", "Read", {
        fingerprint: stableExecutionHash({ input: "d", tool: "Read" }),
        timestamp: "2026-01-01T00:00:08.000Z",
      }),
    ]);

    const summary = createExecutionReportSummary(graph);
    const report = renderExecutionReport(graph);
    const parallelismOpportunities = summary.opportunities.filter(
      (opportunity) => opportunity.category === "parallelism",
    );

    expect(
      summary.potentialParallelism.map((candidate) => candidate.nodeIds),
    ).toEqual([
      ["tool-a", "tool-b"],
      ["tool-b", "tool-c"],
      ["tool-c", "tool-d"],
    ]);
    expect(summary.opportunitySummary).toMatchObject({
      topRecommendation:
        "blocked parallelism across 3 related candidates on 4 nodes",
      total: 1,
    });
    expect(parallelismOpportunities).toHaveLength(1);
    expect(parallelismOpportunities[0]).toMatchObject({
      actionability: "blocked",
      category: "parallelism",
      confidence: "low",
      nodeIds: ["tool-a", "tool-b", "tool-c", "tool-d"],
      priority: "low",
      reason:
        "3 adjacent tool-call pairs are ordered only by observation sequence; verify side effects before parallelizing.",
      relatedCandidateCount: 3,
      whyActionable:
        "Multiple adjacent tool-call pairs were observed with only sequence-order evidence, so they are candidates for dependency review.",
    });
    expect(
      parallelismOpportunities[0]?.estimatedAvoidableLatencyMs,
    ).toBeUndefined();
    expect(report).toContain(
      "- Top recommendation: blocked parallelism across 3 related candidates on 4 nodes",
    );
    expect(report).toContain("Nodes: 4 unique nodes");
    expect(report).toContain("Related candidates: 3");
    expect(report).toContain("- tool-a + tool-b:");
    expect(report).toContain("- tool-b + tool-c:");
    expect(report).toContain("- tool-c + tool-d:");
  });

  it("does not flag adjacent tool calls with explicit dependencies as parallelism candidates", () => {
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-a", "Read", {
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-a", "Read", {
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolStartedEvent("tool-b", "Bash", {
        explicitDependencies: ["tool-a"],
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolFinishedEvent("tool-b", "Bash", {
        timestamp: "2026-01-01T00:00:06.000Z",
      }),
    ]);

    expect(createExecutionReportSummary(graph).potentialParallelism).toEqual(
      [],
    );
  });

  it("sorts opportunities deterministically when scores match", () => {
    const firstFingerprint = stableExecutionHash({
      input: "a",
      tool: "Read",
    });
    const secondFingerprint = stableExecutionHash({
      input: "b",
      tool: "Read",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-c", "Read", {
        fingerprint: secondFingerprint,
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-c", "Read", {
        fingerprint: secondFingerprint,
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-d", "Read", {
        fingerprint: secondFingerprint,
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-d", "Read", {
        fingerprint: secondFingerprint,
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-a", "Read", {
        fingerprint: firstFingerprint,
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-a", "Read", {
        fingerprint: firstFingerprint,
        timestamp: "2026-01-01T00:00:06.000Z",
      }),
      toolStartedEvent("tool-b", "Read", {
        fingerprint: firstFingerprint,
        timestamp: "2026-01-01T00:00:07.000Z",
      }),
      toolFinishedEvent("tool-b", "Read", {
        fingerprint: firstFingerprint,
        timestamp: "2026-01-01T00:00:08.000Z",
      }),
    ]);

    expect(
      createExecutionReportSummary(graph).opportunities.map(
        (opportunity) => opportunity.nodeIds,
      ),
    ).toEqual([
      ["tool-a", "tool-b"],
      ["tool-c", "tool-d"],
      ["tool-c", "tool-d", "tool-a", "tool-b"],
    ]);
    expect(createExecutionReportSummary(graph).opportunities[2]).toMatchObject({
      category: "parallelism",
      relatedCandidateCount: 3,
    });
  });

  it("ranks blocked opportunities after actionable repeated work even when latency is higher", () => {
    const repeatedFingerprint = stableExecutionHash({
      input: "same",
      tool: "Read",
    });
    const slowAFingerprint = stableExecutionHash({
      input: "slow-a",
      tool: "Read",
    });
    const slowBFingerprint = stableExecutionHash({
      input: "slow-b",
      tool: "Read",
    });
    const graph = buildExecutionGraph("run-a", [
      promptEvent(),
      toolStartedEvent("tool-cache-1", "Read", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-cache-1", "Read", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-cache-2", "Read", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-cache-2", "Read", {
        fingerprint: repeatedFingerprint,
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      toolStartedEvent("tool-slow-a", "Read", {
        fingerprint: slowAFingerprint,
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
      toolFinishedEvent("tool-slow-a", "Read", {
        fingerprint: slowAFingerprint,
        timestamp: "2026-01-01T00:00:15.000Z",
      }),
      toolStartedEvent("tool-slow-b", "Read", {
        fingerprint: slowBFingerprint,
        timestamp: "2026-01-01T00:00:16.000Z",
      }),
      toolFinishedEvent("tool-slow-b", "Read", {
        fingerprint: slowBFingerprint,
        timestamp: "2026-01-01T00:00:24.000Z",
      }),
    ]);

    const opportunities = createExecutionReportSummary(graph).opportunities;
    const firstBlockedIndex = opportunities.findIndex(
      (opportunity) => opportunity.actionability === "blocked",
    );
    const parallelismIndex = opportunities.findIndex(
      (opportunity) =>
        opportunity.category === "parallelism" &&
        opportunity.relatedCandidateCount === 3,
    );

    expect(firstBlockedIndex).toBeGreaterThan(0);
    expect(parallelismIndex).toBe(firstBlockedIndex);
    expect(
      opportunities
        .slice(0, firstBlockedIndex)
        .every((opportunity) => opportunity.actionability === "needs_review"),
    ).toBe(true);
    expect(
      opportunities
        .slice(firstBlockedIndex)
        .every((opportunity) => opportunity.actionability === "blocked"),
    ).toBe(true);
    expect(opportunities[0]).toMatchObject({
      actionability: "needs_review",
      category: "cache",
      estimatedAvoidableLatencyMs: 1000,
    });
    expect(opportunities[1]).toMatchObject({
      actionability: "blocked",
      category: "parallelism",
      relatedCandidateCount: 3,
    });
    expect(opportunities[1]?.estimatedAvoidableLatencyMs).toBeUndefined();
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
    readonly artifacts?: readonly NonNullable<
      ExecutionEvent["artifacts"]
    >[number][];
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
    artifacts: options.artifacts ?? [
      toolResultArtifact(id, toolName, options.status),
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

function fileArtifact(
  id: string,
  fingerprint: string,
  source:
    | {
        readonly commandShape?: string;
        readonly contentFingerprint?: string;
        readonly fileFreshnessUnavailableReason?: string;
        readonly fileMtimeMs?: number;
        readonly fileSizeBytes?: number;
        readonly localDogfood?: Readonly<Record<string, unknown>>;
        readonly rangeLabel?: string;
        readonly sourceCommand?: string;
        readonly sourceEquivalenceKey?: string;
        readonly sourceEquivalenceUnavailableReason?: string;
        readonly sourceField: string;
        readonly toolName: string;
      }
    | undefined = undefined,
): NonNullable<ExecutionEvent["artifacts"]>[number] {
  return {
    fingerprint,
    id,
    kind: "file",
    metadata: {
      ...(source === undefined
        ? {}
        : {
            codex: {
              ...(source.commandShape === undefined
                ? {}
                : { commandShape: source.commandShape }),
              ...(source.contentFingerprint === undefined
                ? {}
                : { contentFingerprint: source.contentFingerprint }),
              ...(source.fileFreshnessUnavailableReason === undefined
                ? {}
                : {
                    fileFreshnessUnavailableReason:
                      source.fileFreshnessUnavailableReason,
                  }),
              ...(source.fileMtimeMs === undefined
                ? {}
                : { fileMtimeMs: source.fileMtimeMs }),
              ...(source.fileSizeBytes === undefined
                ? {}
                : { fileSizeBytes: source.fileSizeBytes }),
              ...(source.localDogfood === undefined
                ? {}
                : { localDogfood: source.localDogfood }),
              ...(source.sourceCommand === undefined
                ? {}
                : { sourceCommand: source.sourceCommand }),
              ...(source.rangeLabel === undefined
                ? {}
                : { rangeLabel: source.rangeLabel }),
              ...(source.sourceEquivalenceKey === undefined
                ? {}
                : { sourceEquivalenceKey: source.sourceEquivalenceKey }),
              ...(source.sourceEquivalenceUnavailableReason === undefined
                ? {}
                : {
                    sourceEquivalenceUnavailableReason:
                      source.sourceEquivalenceUnavailableReason,
                  }),
              sourceField: source.sourceField,
              toolName: source.toolName,
            },
          }),
      redaction: "raw file path omitted; fingerprint only",
    },
  };
}

function toolResultArtifact(
  id: string,
  toolName: string,
  status: "error" | "ok" = "ok",
): NonNullable<ExecutionEvent["artifacts"]>[number] {
  return {
    fingerprint: stableExecutionHash({
      status,
      tool: toolName,
    }),
    id: `${id}-output`,
    kind: "tool_result",
    metadata: {
      redaction: "raw tool output omitted",
    },
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

async function acceptedAdaptivePolicyBundle(): Promise<AdaptivePolicyBundle> {
  const fixture = JSON.parse(
    await readFile(adaptivePolicyFixturePath, "utf8"),
  ) as {
    readonly acceptedBundle: AdaptivePolicyBundle;
  };

  return fixture.acceptedBundle;
}

function policyBundleVariant(
  bundle: AdaptivePolicyBundle,
  overrides: Readonly<Record<string, unknown>>,
): unknown {
  return {
    ...bundle,
    ...overrides,
  };
}

function policyLines(advice: string): readonly string[] {
  const lines = advice.split("\n");
  const policyIndex = lines.indexOf("Policy:");

  if (policyIndex === -1) {
    return [];
  }

  return lines
    .slice(policyIndex + 1)
    .filter((line) => line.startsWith("- Applied "));
}

function fileReuseGraphWithRawSourceMetadata(): ReturnType<
  typeof buildExecutionGraph
> {
  const rawPath = "/tmp/private/secret-session-plan.ts";
  const fileFingerprint = stableExecutionHash({
    path: rawPath,
  });

  return buildExecutionGraph("run-a", [
    promptEvent({ prompt: "raw prompt secret about private files" }),
    toolStartedEvent("tool-cat", "Bash", {
      fingerprint: stableExecutionHash({
        input: `cat ${rawPath}`,
        tool: "Bash",
      }),
      timestamp: "2026-01-01T00:00:01.000Z",
    }),
    toolFinishedEvent("tool-cat", "Bash", {
      artifacts: [
        fileArtifact("file-cat", fileFingerprint, {
          sourceCommand: `cat ${rawPath}`,
          sourceField: "command",
          toolName: "Bash",
        }),
        toolResultArtifact("tool-cat", "Bash"),
      ],
      fingerprint: stableExecutionHash({
        input: `cat ${rawPath}`,
        tool: "Bash",
      }),
      timestamp: "2026-01-01T00:00:02.000Z",
    }),
    toolStartedEvent("tool-sed", "Bash", {
      fingerprint: stableExecutionHash({
        input: `sed -n '1,2p' ${rawPath}`,
        tool: "Bash",
      }),
      timestamp: "2026-01-01T00:00:03.000Z",
    }),
    toolFinishedEvent("tool-sed", "Bash", {
      artifacts: [
        fileArtifact("file-sed", fileFingerprint, {
          sourceCommand: `sed -n '1,2p' ${rawPath}`,
          sourceField: "command",
          toolName: "Bash",
        }),
        toolResultArtifact("tool-sed", "Bash"),
      ],
      fingerprint: stableExecutionHash({
        input: `sed -n '1,2p' ${rawPath}`,
        tool: "Bash",
      }),
      timestamp: "2026-01-01T00:00:05.000Z",
    }),
  ]);
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
