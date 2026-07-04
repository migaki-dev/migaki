import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  promoteExecutionRun,
  type PromotedArtifactManifest,
} from "@migaki/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../../src/testing/index.js";
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

describe("Codex promoted artifacts", () => {
  it("omits raw prompt, tool, summary, transcript, path, and delegated text from promoted bundles", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");
    const artifactRoot = join(root, "docs", "migaki-artifacts");
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
    const secrets = [
      "secret prompt body",
      "secret tool intent command",
      "secret tool output body",
      "secret compact summary",
      "secret transcript path",
      "secret file path",
      "secret delegated prompt",
      "secret delegated task",
      "secret delegated result",
      "secret subagent transcript",
      "secret assistant summary",
    ];

    await runAt(clock, storeDirectory, {
      hook_event_name: "UserPromptSubmit",
      prompt: "secret prompt body",
      transcript_path: "/tmp/repo/secret transcript path.jsonl",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "PreToolUse",
      tool_input: {
        command: "cat /tmp/repo/secret tool intent command.txt",
      },
      tool_name: "Bash",
      tool_use_id: "bash-1",
      transcript_path: "/tmp/repo/secret transcript path.jsonl",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "PostToolUse",
      tool_input: {
        command: "cat /tmp/repo/secret tool intent command.txt",
      },
      tool_name: "Bash",
      tool_response: {
        exit_code: 0,
        stdout: "secret tool output body",
      },
      tool_use_id: "bash-1",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "PreToolUse",
      tool_input: {
        file_path: "/tmp/repo/secret file path.md",
      },
      tool_name: "Read",
      tool_use_id: "read-1",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "PostToolUse",
      tool_input: {
        file_path: "/tmp/repo/secret file path.md",
      },
      tool_name: "Read",
      tool_response: {
        text: "secret read result",
      },
      tool_use_id: "read-1",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      acceptance_criteria: "secret compact acceptance",
      compaction_id: "compact-1",
      hook_event_name: "PreCompact",
      inspected_files_summary: "secret compact inspected files",
      reason: "secret compact reason",
      summary: "secret compact summary",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      compaction_id: "compact-1",
      hook_event_name: "PostCompact",
      summary: "secret compact summary",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      delegated_prompt: "secret delegated prompt",
      hook_event_name: "SubagentStart",
      subagent_id: "subagent-1",
      task: "secret delegated task",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "SubagentStop",
      result: "secret delegated result",
      status: "success",
      subagent_id: "subagent-1",
      transcript: "secret subagent transcript",
      turn_id: "turn-1",
    });
    await runAt(clock, storeDirectory, {
      hook_event_name: "Stop",
      last_assistant_message: "secret assistant summary",
      turn_id: "turn-1",
    });

    const result = await promoteExecutionRun({
      artifactRoot,
      clock: {
        now: () => new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
      },
      name: "codex-privacy-fixture",
      runId: "codex-turn-turn-1",
      sourceRoot: storeDirectory,
    });

    await expect(readdir(result.bundleDirectory)).resolves.not.toContain(
      "events.jsonl",
    );
    const promoted = await readPromotedBundle(result.bundleDirectory);
    for (const secret of secrets) {
      expect(promoted).not.toContain(secret);
    }
    expect(promoted).toContain("sha256:");

    const manifest = JSON.parse(
      await readFile(join(result.bundleDirectory, "manifest.json"), "utf8"),
    ) as PromotedArtifactManifest;
    expect(manifest.redactions.map((redaction) => redaction.kind)).toEqual(
      expect.arrayContaining([
        "assistant_message",
        "compact_context",
        "delegated_prompt",
        "file",
        "prompt",
        "subagent_result",
        "subagent_task",
        "summary",
        "tool_input",
        "tool_result",
        "transcript",
      ]),
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-codex-promotion-"));
  tempDirectories.push(directory);

  return directory;
}

async function runAt(
  clock: FakeClock,
  storeDirectory: string,
  input: Readonly<Record<string, unknown>>,
): Promise<void> {
  const result = await runCodexHook(JSON.stringify(input), {
    clock: {
      now: () => new Date(clock.now()),
    },
    storeDirectory,
  });

  clock.advanceBy(1000);
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "",
  });
}

async function readPromotedBundle(bundleDirectory: string): Promise<string> {
  const fileNames = await readdir(bundleDirectory);
  const contents = await Promise.all(
    fileNames.map((fileName) =>
      readFile(join(bundleDirectory, fileName), "utf8"),
    ),
  );

  return contents.join("\n");
}
