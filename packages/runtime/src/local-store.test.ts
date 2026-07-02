import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXECUTION_EVENT_VERSION,
  LocalStore,
  buildExecutionGraph,
  stableExecutionHash,
  type ExecutionEvent,
} from "./index.js";

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

describe("LocalStore", () => {
  it("preserves duplicate event ids in JSONL while replay ignores duplicates", async () => {
    const root = await tempRoot();
    const store = new LocalStore(root);
    const first = event("event-same", "prompt-a");
    const duplicate = event("event-same", "prompt-b");

    await store.appendEvent("safe-run", first);
    await store.appendEvent("safe-run", duplicate);

    const jsonl = await readFile(
      join(root, "runs", "safe-run", "events.jsonl"),
      "utf8",
    );
    const loaded = await store.readEvents("safe-run");
    const graph = buildExecutionGraph("safe-run", loaded);

    expect(jsonl.trim().split("\n")).toHaveLength(2);
    expect(loaded).toEqual([first, duplicate]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.operation.fingerprint).toBe(
      stableExecutionHash({ prompt: "prompt-a" }),
    );
  });

  it("rejects unsafe run ids", async () => {
    const root = await tempRoot();
    const store = new LocalStore(root);

    await expect(store.readEvents("../escape")).rejects.toThrow(
      "Migaki runId may contain only letters, numbers, dots, underscores, and hyphens.",
    );
    await expect(store.appendEvent("../escape", event())).rejects.toThrow(
      "Migaki runId may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-runtime-store-"));
  tempDirectories.push(directory);

  return directory;
}

function event(id = "event-prompt", prompt = "prompt-a"): ExecutionEvent {
  return {
    version: EXECUTION_EVENT_VERSION,
    id,
    lifecycle: "point",
    operation: {
      fingerprint: stableExecutionHash({ prompt }),
      id: "prompt",
      kind: "user_prompt",
      name: "User prompt",
    },
    occurredAt: "2026-01-01T00:00:00.000Z",
    runId: "safe-run",
    status: "ok",
  };
}
