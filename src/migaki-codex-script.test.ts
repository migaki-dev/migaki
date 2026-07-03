import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildExecutionGraph,
  EXECUTION_EVENT_VERSION,
  renderExecutionAdvice,
  stableExecutionHash,
  type ExecutionEvent,
} from "../packages/runtime/src/execution.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDirectories: string[] = [];
const runId = "run-a";

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

describe("migaki-codex wrapper", () => {
  it("builds an explicit guided prompt without injecting raw path or command strings", async () => {
    const directory = await tempRoot();
    const adviceCommand = join(directory, "advise");
    const rawPath = "/tmp/repo/src/secret-session-plan.ts";
    const rawCommand = "cat /tmp/repo/src/secret-session-plan.ts";
    const graph = buildExecutionGraph(runId, [
      promptEvent(),
      toolStartedEvent("tool-cat", "Bash", {
        fingerprint: stableExecutionHash({
          command: rawCommand,
        }),
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      toolFinishedEvent("tool-cat", "Bash", {
        artifacts: [
          fileArtifact("file-cat", stableExecutionHash({ path: rawPath }), {
            sourceCommand: "cat",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-cat", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          command: rawCommand,
        }),
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      toolStartedEvent("tool-sed", "Bash", {
        fingerprint: stableExecutionHash({
          command: "sed -n '1,80p' /tmp/repo/src/secret-session-plan.ts",
        }),
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
      toolFinishedEvent("tool-sed", "Bash", {
        artifacts: [
          fileArtifact("file-sed", stableExecutionHash({ path: rawPath }), {
            sourceCommand: "sed",
            sourceField: "command",
            toolName: "Bash",
          }),
          toolResultArtifact("tool-sed", "Bash"),
        ],
        fingerprint: stableExecutionHash({
          command: "sed -n '1,80p' /tmp/repo/src/secret-session-plan.ts",
        }),
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      runCompletedEvent(),
    ]);
    const advice = renderExecutionAdvice(graph);

    await writeFile(
      adviceCommand,
      ["#!/bin/sh", "cat <<'EOF'", advice, "EOF", ""].join("\n"),
      "utf8",
    );
    await chmod(adviceCommand, 0o755);

    const { stdout } = await execFileAsync(
      "sh",
      [
        join(repositoryRoot, "scripts/migaki-codex"),
        "--dry-run",
        "--",
        "Continue with the wrapper PR.",
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          MIGAKI_CODEX_ADVICE_COMMAND: adviceCommand,
        },
      },
    );

    expect(stdout).toContain("# Migaki Session Advice");
    expect(stdout).toContain("Safe source signals: Bash cat, Bash sed");
    expect(stdout).toContain("Use the Migaki session advice above");
    expect(stdout).toContain("# User Prompt");
    expect(stdout).toContain("Continue with the wrapper PR.");
    expect(stdout).not.toContain(rawPath);
    expect(stdout).not.toContain(rawCommand);
    expect(stdout).not.toContain("secret-session-plan.ts");
  });
});

function promptEvent(): ExecutionEvent {
  const prompt = "summarize the repository";

  return {
    version: EXECUTION_EVENT_VERSION,
    id: "event-prompt",
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
    occurredAt: "2026-01-01T00:00:00.000Z",
    runId,
    status: "ok",
  };
}

function toolStartedEvent(
  id: string,
  toolName: string,
  options: {
    readonly fingerprint: string;
    readonly timestamp: string;
  },
): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: `event-${id}-started`,
    lifecycle: "start",
    operation: {
      fingerprint: options.fingerprint,
      id,
      kind: "tool_call",
      name: toolName,
    },
    metadata: sequenceMetadata(),
    occurredAt: options.timestamp,
    runId,
  };
}

function toolFinishedEvent(
  id: string,
  toolName: string,
  options: {
    readonly artifacts: readonly NonNullable<
      ExecutionEvent["artifacts"]
    >[number][];
    readonly fingerprint: string;
    readonly timestamp: string;
  },
): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: `event-${id}-finished`,
    lifecycle: "finish",
    operation: {
      fingerprint: options.fingerprint,
      id,
      kind: "tool_call",
      name: toolName,
    },
    artifacts: options.artifacts,
    metadata: sequenceMetadata(),
    occurredAt: options.timestamp,
    runId,
    status: "ok",
  };
}

function runCompletedEvent(): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id: "event-turn",
    lifecycle: "point",
    operation: {
      id: "turn",
      kind: "turn",
      name: "Turn completed",
    },
    metadata: sequenceMetadata(),
    occurredAt: "2026-01-01T00:00:05.000Z",
    runId,
    runStatus: "ok",
    status: "ok",
  };
}

function fileArtifact(
  id: string,
  fingerprint: string,
  source: {
    readonly sourceCommand: string;
    readonly sourceField: string;
    readonly toolName: string;
  },
): NonNullable<ExecutionEvent["artifacts"]>[number] {
  return {
    fingerprint,
    id,
    kind: "file",
    metadata: {
      codex: source,
      redaction: "raw file path omitted; fingerprint only",
    },
  };
}

function toolResultArtifact(
  id: string,
  toolName: string,
): NonNullable<ExecutionEvent["artifacts"]>[number] {
  return {
    fingerprint: stableExecutionHash({
      status: "ok",
      tool: toolName,
    }),
    id: `${id}-output`,
    kind: "tool_result",
    metadata: {
      redaction: "raw tool output omitted",
    },
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

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-codex-test-"));
  tempDirectories.push(directory);
  return directory;
}
