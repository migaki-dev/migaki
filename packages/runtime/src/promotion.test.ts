import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXECUTION_EVENT_VERSION,
  PROMOTED_ARTIFACT_VERSION,
  buildExecutionGraph,
  promoteExecutionRun,
  renderExecutionReport,
  serializeExecutionJson,
  stableExecutionHash,
  type ExecutionEvent,
  type PromotedArtifactManifest,
} from "./index.js";

const tempDirectories: string[] = [];
const runId = "codex-turn-fixture-run";

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

describe("promoteExecutionRun", () => {
  it("promotes a deterministic local run into a curated project artifact bundle", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, ".migaki");
    const artifactRoot = join(root, "docs", "migaki-artifacts");
    await writeRun(sourceRoot, [
      promptEvent(),
      toolStartEvent(),
      toolFinishEvent(),
      stopEvent(),
    ]);

    const result = await promoteExecutionRun({
      artifactRoot,
      clock: fixedClock(),
      name: "fixture-promotion",
      runId,
      sourceRoot,
    });

    expect(result.bundleDirectory).toBe(
      join(artifactRoot, "fixture-promotion"),
    );
    await expect(
      readdir(result.bundleDirectory).then((fileNames) => fileNames.sort()),
    ).resolves.toEqual(["graph-summary.json", "manifest.json", "report.md"]);

    const manifest = JSON.parse(
      await readFile(join(result.bundleDirectory, "manifest.json"), "utf8"),
    ) as PromotedArtifactManifest;

    expect(manifest).toMatchObject({
      createdAt: "2026-01-01T00:00:00.000Z",
      name: "fixture-promotion",
      source: {
        localRunPath: `.migaki/runs/${runId}`,
        runId,
      },
      version: PROMOTED_ARTIFACT_VERSION,
    });
    expect(manifest.sourceArtifacts.map((artifact) => artifact.path)).toEqual([
      `.migaki/runs/${runId}/events.jsonl`,
      `.migaki/runs/${runId}/graph.json`,
      `.migaki/runs/${runId}/report.md`,
    ]);
    expect(
      manifest.sourceArtifacts.find((artifact) =>
        artifact.path.endsWith("events.jsonl"),
      ),
    ).toMatchObject({
      promoted: false,
      reason: "Raw local event streams are not promoted by default.",
    });
    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual([
      "manifest.json",
      "report.md",
      "graph-summary.json",
    ]);
    expect(
      manifest.redactions.some(
        (redaction) =>
          redaction.kind === "prompt" &&
          redaction.reason === "Raw prompt omitted in fixture.",
      ),
    ).toBe(true);

    const graphSummary = await readFile(
      join(result.bundleDirectory, "graph-summary.json"),
      "utf8",
    );
    expect(graphSummary).toContain("migaki.promoted-graph-summary.v0");
    expect(graphSummary).toContain("tool_call");
    expect(graphSummary).toContain("sha256:");
  });

  it("fails closed when a required source artifact is missing", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, ".migaki");
    await mkdir(join(sourceRoot, "runs", runId), { recursive: true });
    await writeFile(
      join(sourceRoot, "runs", runId, "report.md"),
      "# Migaki Execution Report\n",
      "utf8",
    );

    await expect(
      promoteExecutionRun({
        artifactRoot: join(root, "docs", "migaki-artifacts"),
        name: "missing-graph",
        runId,
        sourceRoot,
      }),
    ).rejects.toMatchObject({
      code: "missing_required_artifact",
    });
  });

  it("fails closed when a required source artifact is malformed", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, ".migaki");
    const runDirectory = join(sourceRoot, "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "events.jsonl"), "{}\n", "utf8");
    await writeFile(join(runDirectory, "graph.json"), "{not-json", "utf8");
    await writeFile(
      join(runDirectory, "report.md"),
      "# Migaki Execution Report\n",
      "utf8",
    );

    await expect(
      promoteExecutionRun({
        artifactRoot: join(root, "docs", "migaki-artifacts"),
        name: "malformed-graph",
        runId,
        sourceRoot,
      }),
    ).rejects.toMatchObject({
      code: "malformed_source_artifact",
    });
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-promotion-"));
  tempDirectories.push(directory);

  return directory;
}

async function writeRun(
  sourceRoot: string,
  events: readonly ExecutionEvent[],
): Promise<void> {
  const runDirectory = join(sourceRoot, "runs", runId);
  const graph = buildExecutionGraph(runId, events);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    join(runDirectory, "events.jsonl"),
    `${events.map((event) => serializeExecutionJson(event)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(runDirectory, "graph.json"),
    `${serializeExecutionJson(graph, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(runDirectory, "report.md"),
    renderExecutionReport(graph),
    "utf8",
  );
}

function fixedClock(): { readonly now: () => Date } {
  return {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  };
}

function promptEvent(): ExecutionEvent {
  const promptFingerprint = stableExecutionHash({
    prompt: "secret prompt",
  });

  return {
    artifacts: [
      {
        fingerprint: promptFingerprint,
        id: "prompt-input",
        kind: "prompt",
        metadata: {
          redaction: {
            mode: "omitted",
            reason: "Raw prompt omitted in fixture.",
          },
        },
      },
    ],
    id: "event-prompt",
    lifecycle: "point",
    occurredAt: "2026-01-01T00:00:00.000Z",
    operation: {
      fingerprint: promptFingerprint,
      id: "prompt",
      kind: "user_prompt",
      name: "User prompt",
    },
    runId,
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}

function toolStartEvent(): ExecutionEvent {
  return {
    artifacts: [
      {
        fingerprint: stableExecutionHash({ command: "cat secret.txt" }),
        id: "tool-1-input",
        kind: "tool_input",
        metadata: {
          redaction: {
            mode: "omitted",
            reason: "Raw tool input omitted in fixture.",
          },
        },
      },
    ],
    id: "event-tool-start",
    lifecycle: "start",
    occurredAt: "2026-01-01T00:00:01.000Z",
    operation: {
      fingerprint: stableExecutionHash({ command: "cat secret.txt" }),
      id: "tool-1",
      kind: "tool_call",
      name: "Bash",
    },
    runId,
    version: EXECUTION_EVENT_VERSION,
  };
}

function toolFinishEvent(): ExecutionEvent {
  return {
    artifacts: [
      {
        fingerprint: stableExecutionHash({ stdout: "secret output" }),
        id: "tool-1-output",
        kind: "tool_result",
        metadata: {
          redaction: {
            mode: "omitted",
            reason: "Raw tool output omitted in fixture.",
          },
        },
      },
    ],
    id: "event-tool-finish",
    lifecycle: "finish",
    occurredAt: "2026-01-01T00:00:02.000Z",
    operation: {
      fingerprint: stableExecutionHash({ command: "cat secret.txt" }),
      id: "tool-1",
      kind: "tool_call",
      name: "Bash",
    },
    runId,
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}

function stopEvent(): ExecutionEvent {
  return {
    id: "event-stop",
    lifecycle: "point",
    occurredAt: "2026-01-01T00:00:03.000Z",
    operation: {
      id: "turn",
      kind: "turn",
      name: "Turn completed",
    },
    runId,
    runStatus: "ok",
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}
