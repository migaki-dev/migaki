import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../../src/testing/index.js";
import { EXECUTION_GRAPH_VERSION, type ExecutionGraph } from "@migaki/runtime";
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
