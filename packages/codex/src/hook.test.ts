import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../../src/testing/index.js";
import {
  EXECUTION_GRAPH_VERSION,
  createExecutionReportSummary,
  renderExecutionAdvice,
  type ExecutionGraph,
} from "@migaki/runtime";
import { runCodexHook } from "./index.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("Codex hook adapter", () => {
  it("records a hook sequence as JSONL, graph, and report artifacts", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(clock, storeDirectory, userPromptSubmit());
    await runAt(clock, storeDirectory, preToolUse());
    await runAt(clock, storeDirectory, postToolUse());
    await runAt(clock, storeDirectory, stop());

    const runDirectory = join(storeDirectory, "runs", "codex-turn-turn-1");
    const eventsJsonl = await readFile(
      join(runDirectory, "events.jsonl"),
      "utf8",
    );
    const graph = JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph;
    const report = await readFile(join(runDirectory, "report.md"), "utf8");

    expect(eventsJsonl.trim().split("\n")).toHaveLength(4);
    expect(graph).toMatchObject({
      runId: "codex-turn-turn-1",
      status: "ok",
      version: EXECUTION_GRAPH_VERSION,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "prompt",
      "tool-tool-1",
      "turn",
    ]);
    expect(graph.nodes.find((node) => node.id === "tool-tool-1")).toMatchObject(
      {
        durationMs: 1000,
        operation: {
          kind: "tool_call",
          name: "Bash",
        },
        status: "ok",
      },
    );
    expect(report).toContain("## Potential Cache Points");
  });

  it("marks nonzero tool responses as failed without failing the hook command", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(clock, storeDirectory, preToolUse());
    const result = await runAt(
      clock,
      storeDirectory,
      postToolUse({
        tool_response: {
          exit_code: 1,
          stderr: "fixture command failed",
        },
      }),
    );

    const graph = JSON.parse(
      await readFile(
        join(storeDirectory, "runs", "codex-turn-turn-1", "graph.json"),
        "utf8",
      ),
    ) as ExecutionGraph;

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    expect(graph.nodes.find((node) => node.id === "tool-tool-1")).toMatchObject(
      {
        status: "error",
      },
    );
  });

  it("fingerprints prompt, tool input, and tool output bodies instead of persisting raw text", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(
      clock,
      storeDirectory,
      userPromptSubmit({
        prompt: "secret prompt body",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      preToolUse({
        tool_input: {
          command: "echo secret command body",
        },
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      postToolUse({
        tool_response: {
          exit_code: 0,
          stdout: "secret output body",
        },
      }),
    );

    const runDirectory = join(storeDirectory, "runs", "codex-turn-turn-1");
    const persisted = [
      await readFile(join(runDirectory, "events.jsonl"), "utf8"),
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ].join("\n");

    expect(persisted).toContain("sha256:");
    expect(persisted).not.toContain("secret prompt body");
    expect(persisted).not.toContain("secret command body");
    expect(persisted).not.toContain("secret output body");
  });

  it("records PermissionRequest decisions and friction without persisting raw intent", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(
      clock,
      storeDirectory,
      permissionRequest({
        approval_status: "approved",
        permission_decision: "allow",
        permission_request_id: "approval-1",
        pause_reason: "secret approval pause reason",
        sandbox_mode: "workspace-write",
        sandbox_permissions: "require_escalated",
        tool_input: {
          command: "cat /tmp/repo/packages/codex/src/secret-permission.ts",
          justification: "secret escalation justification",
        },
        tool_name: "Bash",
        tool_use_id: "tool-approval-1",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      permissionRequest({
        approval_status: "denied",
        permission_decision: "deny",
        permission_request_id: "approval-2",
        pause_reason: "secret denial pause reason",
        sandbox_mode: "read-only",
        tool_input: {
          command: "rm -rf /tmp/repo/secret-permission-target",
        },
        tool_name: "Bash",
        tool_use_id: "tool-approval-2",
      }),
    );
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph } = await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph)].join("\n");
    const permissionNodes = graph.nodes.filter(
      (node) => node.operation.kind === "permission_request",
    );

    expect(permissionNodes.map((node) => node.id)).toEqual([
      "permission-approval-1",
      "permission-approval-2",
    ]);
    expect(permissionNodes.map((node) => node.status)).toEqual(["ok", "error"]);
    expect(permissionNodes.map((node) => node.metadata.codex)).toEqual([
      expect.objectContaining({
        approvalStatus: "approved",
        permissionDecision: "allow",
        permissionRequestId: "approval-1",
        sandboxMode: "workspace-write",
        sandboxPermissions: "require_escalated",
        toolName: "Bash",
        toolUseId: "tool-approval-1",
      }),
      expect.objectContaining({
        approvalStatus: "denied",
        permissionDecision: "deny",
        permissionRequestId: "approval-2",
        sandboxMode: "read-only",
        toolName: "Bash",
        toolUseId: "tool-approval-2",
      }),
    ]);
    for (const node of permissionNodes) {
      expect(node.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
        "pause_reason",
        "permission_request",
        "tool_intent",
      ]);
    }
    expect(
      permissionNodes
        .flatMap((node) => node.artifacts)
        .every((artifact) => isSha256Fingerprint(artifact.fingerprint)),
    ).toBe(true);
    expect(persisted).not.toContain("secret approval pause reason");
    expect(persisted).not.toContain("secret denial pause reason");
    expect(persisted).not.toContain("secret escalation justification");
    expect(persisted).not.toContain("secret-permission.ts");
    expect(persisted).not.toContain("secret-permission-target");
  });

  it("ignores malformed PermissionRequest payloads without failing the hook command", async () => {
    const storeDirectory = await tempRoot();
    const result = await runCodexHook(
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        turn_id: "turn-1",
      }),
      {
        storeDirectory,
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(readRunArtifacts(storeDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records compact boundaries and pressure without persisting raw context text", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(
      clock,
      storeDirectory,
      preCompact({
        acceptance_criteria: "secret acceptance criteria",
        compaction_id: "compact-1",
        context_window_percent: 91,
        inspected_files_summary: "secret inspected file summary",
        reason: "secret compaction reason",
        trigger: "context_pressure",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      postCompact({
        acceptance_criteria: "secret updated criteria",
        compaction_id: "compact-1",
        context_window_percent: 43,
        inspected_files_summary: "secret preserved file summary",
        summary: "secret compacted transcript summary",
        trigger: "context_pressure",
      }),
    );
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const compactNode = graph.nodes.find(
      (node) => node.operation.kind === "context_compaction",
    );

    expect(compactNode).toMatchObject({
      durationMs: 1000,
      id: "compaction-compact-1",
      operation: {
        kind: "context_compaction",
        name: "Context compaction",
      },
      status: "ok",
    });
    expect(compactNode?.metadata.codex).toMatchObject({
      compactPhase: "post",
      compactionId: "compact-1",
      contextWindowPercent: 43,
      trigger: "context_pressure",
    });
    expect(
      compactNode?.artifacts.map((artifact) => artifact.kind).sort(),
    ).toEqual([
      "acceptance_criteria",
      "compact_context",
      "compact_context",
      "inspected_files_summary",
      "summary",
    ]);
    expect(
      compactNode?.artifacts.every((artifact) =>
        isSha256Fingerprint(artifact.fingerprint),
      ),
    ).toBe(true);
    expect(persisted).not.toContain("secret acceptance criteria");
    expect(persisted).not.toContain("secret updated criteria");
    expect(persisted).not.toContain("secret inspected file summary");
    expect(persisted).not.toContain("secret preserved file summary");
    expect(persisted).not.toContain("secret compacted transcript summary");
    expect(persisted).not.toContain("secret compaction reason");
  });

  it("ignores malformed compact hook payloads without failing the hook command", async () => {
    const storeDirectory = await tempRoot();

    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "PreCompact",
          turn_id: "turn-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "PostCompact",
          turn_id: "turn-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(readRunArtifacts(storeDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records subagent boundaries separately from main-session work without raw delegated text", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(clock, storeDirectory, userPromptSubmit());
    await runAt(
      clock,
      storeDirectory,
      subagentStart({
        agent_name: "repo-researcher",
        delegated_prompt: "secret delegated prompt",
        parent_turn_id: "turn-1",
        subagent_id: "agent-1",
        task: "secret delegated task",
      }),
    );
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "cat packages/codex/src/main-session.ts",
      },
      toolName: "Bash",
      toolUseId: "main-tool-1",
    });
    await runAt(
      clock,
      storeDirectory,
      subagentStop({
        agent_name: "repo-researcher",
        parent_turn_id: "turn-1",
        result: "secret delegated result",
        status: "success",
        subagent_id: "agent-1",
        transcript: "secret subagent transcript",
      }),
    );
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const subagentNode = graph.nodes.find(
      (node) => node.operation.kind === "subagent",
    );

    expect(graph.nodes.map((node) => node.operation.kind)).toContain(
      "tool_call",
    );
    expect(subagentNode).toMatchObject({
      durationMs: 3000,
      id: "subagent-agent-1",
      operation: {
        kind: "subagent",
        name: "Subagent work",
      },
      status: "ok",
    });
    expect(subagentNode?.metadata.codex).toMatchObject({
      agentName: "repo-researcher",
      parentTurnId: "turn-1",
      subagentId: "agent-1",
      subagentPhase: "stop",
      workScope: "subagent",
    });
    expect(
      subagentNode?.artifacts.map((artifact) => artifact.kind).sort(),
    ).toEqual([
      "delegated_prompt",
      "subagent_result",
      "subagent_task",
      "transcript",
    ]);
    expect(
      subagentNode?.artifacts.every((artifact) =>
        isSha256Fingerprint(artifact.fingerprint),
      ),
    ).toBe(true);
    expect(report).toContain("- subagent-agent-1: Subagent work (subagent, ok");
    expect(persisted).not.toContain("secret delegated prompt");
    expect(persisted).not.toContain("secret delegated task");
    expect(persisted).not.toContain("secret delegated result");
    expect(persisted).not.toContain("secret subagent transcript");
  });

  it("ignores malformed subagent hook payloads without failing the hook command", async () => {
    const storeDirectory = await tempRoot();

    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "SubagentStart",
          turn_id: "turn-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "SubagentStop",
          turn_id: "turn-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(readRunArtifacts(storeDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records SessionStart boundaries in a session-scoped run without a turn id", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await runAt(
      clock,
      storeDirectory,
      sessionStart({
        prompt: "secret startup prompt",
        reason: "secret startup reason",
        session_start_kind: "startup",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      sessionStart({
        reason: "secret resume reason",
        session_start_kind: "resume",
        transcript_path: "/tmp/repo/secret-resume-transcript.jsonl",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      sessionStart({
        reason: "secret clear reason",
        session_start_kind: "clear",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      sessionStart({
        reason: "secret compact reason",
        session_start_kind: "compact",
        summary: "secret compact session summary",
      }),
    );

    const { eventsJsonl, graph, report } = await readRunArtifactsByRunId(
      storeDirectory,
      "codex-session-session-1",
    );
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");

    expect(graph).toMatchObject({
      runId: "codex-session-session-1",
      status: "ok",
      version: EXECUTION_GRAPH_VERSION,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "session-startup",
      "session-resume",
      "session-clear",
      "session-compact",
    ]);
    expect(graph.nodes.map((node) => node.operation.kind)).toEqual([
      "session_boundary",
      "session_boundary",
      "session_boundary",
      "session_boundary",
    ]);
    expect(graph.nodes.map((node) => node.metadata.codex)).toEqual([
      expect.objectContaining({
        sessionBoundaryKind: "startup",
        sessionId: "session-1",
        workScope: "session",
      }),
      expect.objectContaining({
        sessionBoundaryKind: "resume",
        sessionId: "session-1",
        workScope: "session",
      }),
      expect.objectContaining({
        sessionBoundaryKind: "clear",
        sessionId: "session-1",
        workScope: "session",
      }),
      expect.objectContaining({
        sessionBoundaryKind: "compact",
        sessionId: "session-1",
        workScope: "session",
      }),
    ]);
    expect(
      graph.nodes
        .flatMap((node) => node.artifacts)
        .every((artifact) => isSha256Fingerprint(artifact.fingerprint)),
    ).toBe(true);
    expect(report).toContain("- session-startup: Session boundary");
    expect(persisted).not.toContain("secret startup prompt");
    expect(persisted).not.toContain("secret startup reason");
    expect(persisted).not.toContain("secret resume reason");
    expect(persisted).not.toContain("secret-resume-transcript");
    expect(persisted).not.toContain("secret clear reason");
    expect(persisted).not.toContain("secret compact reason");
    expect(persisted).not.toContain("secret compact session summary");
  });

  it("ignores malformed SessionStart payloads without failing the hook command", async () => {
    const storeDirectory = await tempRoot();

    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "session-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(
      readRunArtifactsByRunId(storeDirectory, "codex-session-session-1"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records repeated Read file fingerprints without persisting raw file paths", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const rawPath = "/tmp/repo/packages/codex/src/secret-plan.md";

    await runAt(clock, storeDirectory, userPromptSubmit());
    await runAt(
      clock,
      storeDirectory,
      preToolUse({
        tool_input: {
          file_path: rawPath,
        },
        tool_name: "Read",
        tool_use_id: "read-1",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      postToolUse({
        tool_input: {
          file_path: rawPath,
        },
        tool_name: "Read",
        tool_use_id: "read-1",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      preToolUse({
        tool_input: {
          file_path: rawPath,
        },
        tool_name: "Read",
        tool_use_id: "read-2",
      }),
    );
    await runAt(
      clock,
      storeDirectory,
      postToolUse({
        tool_input: {
          file_path: rawPath,
        },
        tool_name: "Read",
        tool_use_id: "read-2",
      }),
    );
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const fileArtifacts = graphFileArtifacts(graph);
    const fingerprints = fileArtifacts.map(
      ({ artifact }) => artifact.fingerprint,
    );

    expect(persisted).toContain("sha256:");
    expect(persisted).not.toContain(rawPath);
    expect(persisted).not.toContain("secret-plan.md");
    expect(fileArtifacts.map(({ nodeId }) => nodeId)).toEqual([
      "tool-read-1",
      "tool-read-2",
    ]);
    expect(fileArtifacts.map(({ artifact }) => artifact.id)).toEqual([
      "tool-read-1-file-path",
      "tool-read-2-file-path",
    ]);
    expect(fingerprints.every(isSha256Fingerprint)).toBe(true);
    expect(new Set(fingerprints).size).toBe(1);
    for (const { artifact } of fileArtifacts) {
      expect(artifact).toMatchObject({
        kind: "file",
        metadata: {
          codex: {
            fingerprintVersion: "codex.file_path.v0",
            sourceField: "file_path",
            toolName: "Read",
          },
          redaction: {
            mode: "omitted",
            reason: "Raw Codex file path is not persisted by default.",
          },
        },
      });
    }
    expect(report).toContain("file_reuse");
    expect(report).toContain("file fingerprint was observed 2 times");
    expect(report).toContain("Raw file paths are omitted");
    expect(report).not.toContain(rawPath);
    expect(report).not.toContain("secret-plan.md");
  });

  it("surfaces file reuse as the top report recommendation when repeated reads differ only by safe metadata", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const rawPath = "/tmp/repo/packages/codex/src/secret-plan.md";

    await runAt(clock, storeDirectory, userPromptSubmit());
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        file_path: rawPath,
        offset: 1,
      },
      toolName: "Read",
      toolUseId: "read-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        file_path: rawPath,
        offset: 2,
      },
      toolName: "Read",
      toolUseId: "read-2",
    });
    await runAt(clock, storeDirectory, stop());

    const { report } = await readRunArtifacts(storeDirectory);

    expect(report).toContain("## Opportunity Summary");
    expect(report).toContain("- Total: 2");
    expect(report).toContain(
      "- Actionability: actionable 0, needs_review 1, blocked 1",
    );
    expect(report).toContain(
      "- Top recommendation: needs_review file_reuse across 2 read-like calls (Read.file_path)",
    );
    expect(report).toContain("[needs_review medium/medium] file_reuse");
    expect(report).toContain("Sources: Read.file_path");
    expect(report).not.toContain(rawPath);
    expect(report).not.toContain("secret-plan.md");
  });

  it("records repeated Bash read-like file fingerprints without persisting raw commands or paths", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const rawPath = "/tmp/repo/packages/codex/src/secret-bash-plan.md";
    const rawCommand = `cat ${rawPath}`;

    await runAt(clock, storeDirectory, userPromptSubmit());
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: rawCommand,
      },
      toolName: "Bash",
      toolUseId: "bash-read-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: rawCommand,
      },
      toolName: "Bash",
      toolUseId: "bash-read-2",
    });
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const fileArtifacts = graphFileArtifacts(graph);
    const fingerprints = fileArtifacts.map(
      ({ artifact }) => artifact.fingerprint,
    );

    expect(persisted).toContain("sha256:");
    expect(persisted).not.toContain(rawCommand);
    expect(persisted).not.toContain(rawPath);
    expect(persisted).not.toContain("secret-bash-plan.md");
    expect(fileArtifacts.map(({ nodeId }) => nodeId)).toEqual([
      "tool-bash-read-1",
      "tool-bash-read-2",
    ]);
    expect(fileArtifacts.map(({ artifact }) => artifact.id)).toEqual([
      "tool-bash-read-1-file-path",
      "tool-bash-read-2-file-path",
    ]);
    expect(fingerprints.every(isSha256Fingerprint)).toBe(true);
    expect(new Set(fingerprints).size).toBe(1);
    for (const { artifact } of fileArtifacts) {
      expect(artifact).toMatchObject({
        kind: "file",
        metadata: {
          codex: {
            fingerprintVersion: "codex.file_path.v0",
            sourceCommand: "cat",
            sourceField: "command",
            toolName: "Bash",
          },
          redaction: {
            mode: "omitted",
            reason: "Raw Codex file path is not persisted by default.",
          },
        },
      });
    }
    expect(report).toContain("file_reuse");
    expect(report).toContain("file fingerprint was observed 2 times");
    expect(report).toContain("Raw file paths are omitted");
    expect(report).not.toContain(rawCommand);
    expect(report).not.toContain(rawPath);
    expect(report).not.toContain("secret-bash-plan.md");
  });

  it("keeps cat and sed reads of the same redacted file identity advisory only", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const catCommand = "cat README.md";
    const sedCommand = "sed -n 1,20p README.md";

    await runAt(clock, storeDirectory, userPromptSubmit());
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: catCommand,
      },
      toolName: "Bash",
      toolUseId: "bash-cat",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: sedCommand,
      },
      toolName: "Bash",
      toolUseId: "bash-sed",
    });
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const summary = createExecutionReportSummary(graph);
    const advice = renderExecutionAdvice(graph);
    const persisted = [eventsJsonl, JSON.stringify(graph), report, advice].join(
      "\n",
    );
    const fileArtifacts = graphFileArtifacts(graph);
    const fingerprints = fileArtifacts.map(
      ({ artifact }) => artifact.fingerprint,
    );

    expect(fileArtifacts.map(({ nodeId }) => nodeId)).toEqual([
      "tool-bash-cat",
      "tool-bash-sed",
    ]);
    expect(fileArtifacts.map(({ artifact }) => artifact.id)).toEqual([
      "tool-bash-cat-file-path",
      "tool-bash-sed-file-path",
    ]);
    expect(fingerprints.every(isSha256Fingerprint)).toBe(true);
    expect(new Set(fingerprints).size).toBe(1);
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
          status: "unknown",
        },
        sourceEquivalence: {
          status: "unknown",
        },
      },
      sourceLabels: ["Bash cat", "Bash sed"],
    });
    expect(report).toContain(
      "- Top recommendation: needs_review file_reuse across 2 read-like calls (Bash cat, Bash sed)",
    );
    expect(report).toContain("Freshness: unknown");
    expect(report).toContain("Source equivalence: unknown");
    expect(report).toContain("Automatic skip: disallowed");
    expect(advice).toContain(
      "Top signal: needs_review file_reuse across 2 read-like calls.",
    );
    expect(advice).toContain("Freshness: unknown");
    expect(advice).toContain("Source equivalence: unknown");
    expect(advice).toContain("do not skip reads automatically");
    expect(persisted).not.toContain("README.md");
    expect(persisted).not.toContain(catCommand);
    expect(persisted).not.toContain(sedCommand);
    expect(persisted).not.toContain("sed -n");
  });

  it("records safe Grep, Glob, and LS path fields as file artifacts", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        path: "packages/codex/src",
        pattern: "secret grep pattern",
      },
      toolName: "Grep",
      toolUseId: "grep-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        path: "/tmp/repo/packages/runtime/src",
        pattern: "**/secret-glob-pattern.ts",
      },
      toolName: "Glob",
      toolUseId: "glob-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        path: "/tmp/repo/packages/codex",
      },
      toolName: "LS",
      toolUseId: "ls-1",
    });
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const fileArtifacts = graphFileArtifacts(graph);

    expect(fileArtifacts.map(({ nodeId }) => nodeId)).toEqual([
      "tool-grep-1",
      "tool-glob-1",
      "tool-ls-1",
    ]);
    expect(
      fileArtifacts.map(({ artifact }) => artifact.metadata?.codex),
    ).toEqual([
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceField: "path",
        toolName: "Grep",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceField: "path",
        toolName: "Glob",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceField: "path",
        toolName: "LS",
      },
    ]);
    expect(
      fileArtifacts
        .map(({ artifact }) => artifact.fingerprint)
        .every(isSha256Fingerprint),
    ).toBe(true);
    expect(persisted).not.toContain("secret grep pattern");
    expect(persisted).not.toContain("secret-glob-pattern.ts");
  });

  it("records safe Bash read-like command paths as file artifacts", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "cat packages/codex/src/cat-file.ts",
      },
      toolName: "Bash",
      toolUseId: "cat-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "sed -n '1,80p' packages/codex/src/sed-file.ts",
      },
      toolName: "Bash",
      toolUseId: "sed-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "nl -ba packages/codex/src/nl-file.ts",
      },
      toolName: "Bash",
      toolUseId: "nl-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "head -40 packages/codex/src/head-file.ts",
      },
      toolName: "Bash",
      toolUseId: "head-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "tail -n 40 packages/codex/src/tail-file.ts",
      },
      toolName: "Bash",
      toolUseId: "tail-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "wc -l packages/codex/src/wc-file.ts",
      },
      toolName: "Bash",
      toolUseId: "wc-1",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command:
          ". scripts/env && sed -n '1,80p' packages/codex/src/env-file.ts",
      },
      toolName: "Bash",
      toolUseId: "env-1",
    });
    await runAt(clock, storeDirectory, stop());

    const { eventsJsonl, graph, report } =
      await readRunArtifacts(storeDirectory);
    const persisted = [eventsJsonl, JSON.stringify(graph), report].join("\n");
    const fileArtifacts = graphFileArtifacts(graph);

    expect(fileArtifacts.map(({ nodeId }) => nodeId)).toEqual([
      "tool-cat-1",
      "tool-sed-1",
      "tool-nl-1",
      "tool-head-1",
      "tool-tail-1",
      "tool-wc-1",
      "tool-env-1",
    ]);
    expect(
      fileArtifacts.map(({ artifact }) => artifact.metadata?.codex),
    ).toEqual([
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "cat",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "sed",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "nl",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "head",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "tail",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "wc",
        sourceField: "command",
        toolName: "Bash",
      },
      {
        fingerprintVersion: "codex.file_path.v0",
        sourceCommand: "sed",
        sourceField: "command",
        toolName: "Bash",
      },
    ]);
    expect(
      fileArtifacts
        .map(({ artifact }) => artifact.fingerprint)
        .every(isSha256Fingerprint),
    ).toBe(true);
    expect(persisted).not.toContain("cat-file.ts");
    expect(persisted).not.toContain("sed-file.ts");
    expect(persisted).not.toContain("nl-file.ts");
    expect(persisted).not.toContain("head-file.ts");
    expect(persisted).not.toContain("tail-file.ts");
    expect(persisted).not.toContain("wc-file.ts");
    expect(persisted).not.toContain("env-file.ts");
  });

  it("does not emit file artifacts for unsafe or irrelevant path-like fields", async () => {
    const storeDirectory = await tempRoot();
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));

    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        file_path: "   ",
      },
      toolName: "Read",
      toolUseId: "blank-read",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        path: ["/tmp/repo/packages/codex/src/array-path.ts"],
        pattern: "/tmp/repo/packages/codex/src/pattern-only.ts",
      },
      toolName: "Grep",
      toolUseId: "array-grep",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        include: "/tmp/repo/packages/codex/src/include-only.ts",
        pattern: "/tmp/repo/packages/codex/src/glob-pattern-only.ts",
      },
      toolName: "Glob",
      toolUseId: "pattern-glob",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        path: {
          value: "/tmp/repo/packages/codex/src/object-path.ts",
        },
      },
      toolName: "LS",
      toolUseId: "object-ls",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command:
          "cat /tmp/repo/packages/codex/src/bash-command.ts | sed -n '1p'",
      },
      toolName: "Bash",
      toolUseId: "bash-pipe",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "cat /tmp/repo/packages/codex/src/bash-command.ts > /tmp/out",
      },
      toolName: "Bash",
      toolUseId: "bash-redirect",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "cat $(pwd)/packages/codex/src/bash-command.ts",
      },
      toolName: "Bash",
      toolUseId: "bash-substitution",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command:
          "python -c 'print(1)' /tmp/repo/packages/codex/src/bash-command.ts",
      },
      toolName: "Bash",
      toolUseId: "bash-unknown",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "sed -n '1,80p'",
      },
      toolName: "Bash",
      toolUseId: "bash-no-path",
    });
    await recordToolCall(clock, storeDirectory, {
      toolInput: {
        command: "cat /tmp/repo/packages/codex/src/*.ts",
      },
      toolName: "Bash",
      toolUseId: "bash-glob",
    });
    await runAt(clock, storeDirectory, stop());

    const { graph } = await readRunArtifacts(storeDirectory);

    expect(graphFileArtifacts(graph)).toEqual([]);
  });

  it("exits successfully with no stdout for unsupported or invalid hook input", async () => {
    const storeDirectory = await tempRoot();

    await expect(
      runCodexHook("not-json", {
        storeDirectory,
      }),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(
      runCodexHook(
        JSON.stringify({
          hook_event_name: "UnknownEvent",
          session_id: "session-1",
        }),
        {
          storeDirectory,
        },
      ),
    ).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
  });
});

async function runAt(
  clock: FakeClock,
  storeDirectory: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Awaited<ReturnType<typeof runCodexHook>>> {
  const result = await runCodexHook(JSON.stringify(input), {
    clock: {
      now: () => new Date(clock.now()),
    },
    storeDirectory,
  });

  clock.advanceBy(1000);

  expect(result.stdout).toBe("");

  return result;
}

async function recordToolCall(
  clock: FakeClock,
  storeDirectory: string,
  input: {
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly toolName: string;
    readonly toolUseId: string;
  },
): Promise<void> {
  await runAt(
    clock,
    storeDirectory,
    preToolUse({
      tool_input: input.toolInput,
      tool_name: input.toolName,
      tool_use_id: input.toolUseId,
    }),
  );
  await runAt(
    clock,
    storeDirectory,
    postToolUse({
      tool_input: input.toolInput,
      tool_name: input.toolName,
      tool_use_id: input.toolUseId,
    }),
  );
}

async function readRunArtifacts(storeDirectory: string): Promise<{
  readonly eventsJsonl: string;
  readonly graph: ExecutionGraph;
  readonly report: string;
}> {
  const runDirectory = join(storeDirectory, "runs", "codex-turn-turn-1");

  return {
    eventsJsonl: await readFile(join(runDirectory, "events.jsonl"), "utf8"),
    graph: JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph,
    report: await readFile(join(runDirectory, "report.md"), "utf8"),
  };
}

async function readRunArtifactsByRunId(
  storeDirectory: string,
  runId: string,
): Promise<{
  readonly eventsJsonl: string;
  readonly graph: ExecutionGraph;
  readonly report: string;
}> {
  const runDirectory = join(storeDirectory, "runs", runId);

  return {
    eventsJsonl: await readFile(join(runDirectory, "events.jsonl"), "utf8"),
    graph: JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph,
    report: await readFile(join(runDirectory, "report.md"), "utf8"),
  };
}

function graphFileArtifacts(graph: ExecutionGraph): readonly {
  readonly artifact: ExecutionGraph["nodes"][number]["artifacts"][number];
  readonly nodeId: string;
}[] {
  return graph.nodes.flatMap((node) =>
    node.artifacts
      .filter((artifact) => artifact.kind === "file")
      .map((artifact) => ({
        artifact,
        nodeId: node.id,
      })),
  );
}

function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("sha256:");
}

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-codex-hook-"));
  tempDirectories.push(directory);

  return directory;
}

function userPromptSubmit(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "UserPromptSubmit",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    prompt: "summarize the repository",
    session_id: "session-1",
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}

function sessionStart(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "SessionStart",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    session_id: "session-1",
    transcript_path: null,
    ...overrides,
  };
}

function preToolUse(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "PreToolUse",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    session_id: "session-1",
    tool_input: {
      command: "pnpm test",
    },
    tool_name: "Bash",
    tool_use_id: "tool-1",
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}

function preCompact(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "PreCompact",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    session_id: "session-1",
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}

function permissionRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "PermissionRequest",
    model: "gpt-5.1-codex",
    permission_mode: "on-request",
    session_id: "session-1",
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}

function postCompact(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...preCompact(),
    hook_event_name: "PostCompact",
    ...overrides,
  };
}

function subagentStart(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "SubagentStart",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    session_id: "session-1",
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}

function subagentStop(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...subagentStart(),
    hook_event_name: "SubagentStop",
    ...overrides,
  };
}

function postToolUse(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...preToolUse(),
    hook_event_name: "PostToolUse",
    tool_response: {
      exit_code: 0,
      stdout: "tests passed",
    },
    ...overrides,
  };
}

function stop(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwd: "/tmp/repo",
    hook_event_name: "Stop",
    last_assistant_message: "Done.",
    model: "gpt-5.1-codex",
    permission_mode: "default",
    session_id: "session-1",
    stop_hook_active: false,
    transcript_path: null,
    turn_id: "turn-1",
    ...overrides,
  };
}
