import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXECUTION_EVENT_VERSION,
  EVIDENCE_PRIVACY_POLICY_VERSION,
  PROMOTED_ARTIFACT_VERSION,
  buildExecutionGraph,
  findLatestExecutionRun,
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
    await writeRun(sourceRoot, runId, [
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
      privacyPolicy: {
        exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
        exportMode: "redacted",
        fullTraceOptIn: false,
      },
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

  it("keeps raw file paths and commands out of promoted file-reuse artifacts", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, ".migaki");
    const artifactRoot = join(root, "docs", "migaki-artifacts");
    const rawPath = "/tmp/repo/README.md";
    const catCommand = "cat README.md";
    const sedCommand = "sed -n 1,20p README.md";
    await writeRun(sourceRoot, runId, [
      promptEvent(),
      bashToolStartEvent("tool-cat", catCommand, "2026-01-01T00:00:01.000Z"),
      bashToolFinishEvent({
        command: catCommand,
        eventId: "event-tool-cat-finish",
        fileArtifactId: "tool-cat-file-path",
        operationId: "tool-cat",
        rawPath,
        sourceCommand: "cat",
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
      bashToolStartEvent("tool-sed", sedCommand, "2026-01-01T00:00:03.000Z"),
      bashToolFinishEvent({
        command: sedCommand,
        eventId: "event-tool-sed-finish",
        fileArtifactId: "tool-sed-file-path",
        operationId: "tool-sed",
        rawPath,
        sourceCommand: "sed",
        timestamp: "2026-01-01T00:00:04.000Z",
      }),
      stopEvent(runId, "2026-01-01T00:00:05.000Z"),
    ]);

    const result = await promoteExecutionRun({
      artifactRoot,
      clock: fixedClock(),
      name: "redacted-file-reuse",
      runId,
      sourceRoot,
    });
    const promotedContents = (
      await Promise.all(
        ["manifest.json", "report.md", "graph-summary.json"].map((fileName) =>
          readFile(join(result.bundleDirectory, fileName), "utf8"),
        ),
      )
    ).join("\n");

    expect(promotedContents).toContain("file_reuse");
    expect(promotedContents).toContain("Freshness: unknown");
    expect(promotedContents).toContain("Source equivalence: unknown");
    expect(promotedContents).not.toContain(rawPath);
    expect(promotedContents).not.toContain("README.md");
    expect(promotedContents).not.toContain(catCommand);
    expect(promotedContents).not.toContain(sedCommand);
    expect(promotedContents).not.toContain("sed -n");
  });

  it("selects the newest local run by report mtime", async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, ".migaki");

    await writeRun(sourceRoot, "older-run", [
      promptEvent("older-run"),
      stopEvent("older-run"),
    ]);
    await writeRun(sourceRoot, "newer-run", [
      promptEvent("newer-run"),
      stopEvent("newer-run"),
    ]);
    await utimes(
      join(sourceRoot, "runs", "older-run", "report.md"),
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    );
    await utimes(
      join(sourceRoot, "runs", "newer-run", "report.md"),
      new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
      new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
    );

    await expect(findLatestExecutionRun({ sourceRoot })).resolves.toBe(
      "newer-run",
    );
  });

  it("fails closed when latest promotion has no local reports", async () => {
    const root = await tempRoot();

    await expect(
      findLatestExecutionRun({ sourceRoot: join(root, ".migaki") }),
    ).rejects.toMatchObject({
      code: "missing_required_artifact",
    });
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
  writeRunId: string,
  events: readonly ExecutionEvent[],
): Promise<void> {
  const runDirectory = join(sourceRoot, "runs", writeRunId);
  const graph = buildExecutionGraph(writeRunId, events);
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

function promptEvent(eventRunId = runId): ExecutionEvent {
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
    runId: eventRunId,
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}

function toolStartEvent(eventRunId = runId): ExecutionEvent {
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
    runId: eventRunId,
    version: EXECUTION_EVENT_VERSION,
  };
}

function toolFinishEvent(eventRunId = runId): ExecutionEvent {
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
    runId: eventRunId,
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}

function bashToolStartEvent(
  operationId: string,
  command: string,
  timestamp: string,
  eventRunId = runId,
): ExecutionEvent {
  return {
    id: `event-${operationId}-start`,
    lifecycle: "start",
    occurredAt: timestamp,
    operation: {
      fingerprint: stableExecutionHash({ command }),
      id: operationId,
      kind: "tool_call",
      name: "Bash",
    },
    runId: eventRunId,
    version: EXECUTION_EVENT_VERSION,
  };
}

function bashToolFinishEvent(input: {
  readonly command: string;
  readonly eventId: string;
  readonly eventRunId?: string;
  readonly fileArtifactId: string;
  readonly operationId: string;
  readonly rawPath: string;
  readonly sourceCommand: string;
  readonly timestamp: string;
}): ExecutionEvent {
  return {
    artifacts: [
      {
        fingerprint: stableExecutionHash({
          kind: "codex.file_path.v0",
          path: input.rawPath,
        }),
        id: input.fileArtifactId,
        kind: "file",
        metadata: {
          codex: {
            fingerprintVersion: "codex.file_path.v0",
            sourceCommand: input.sourceCommand,
            sourceField: "command",
            toolName: "Bash",
          },
          redaction: {
            mode: "omitted",
            reason: "Raw Codex file path is not persisted by default.",
          },
        },
      },
      {
        fingerprint: stableExecutionHash({
          operationId: input.operationId,
          output: "redacted",
        }),
        id: `${input.operationId}-output`,
        kind: "tool_result",
        metadata: {
          redaction: {
            mode: "omitted",
            reason: "Raw tool output omitted in fixture.",
          },
        },
      },
    ],
    id: input.eventId,
    lifecycle: "finish",
    occurredAt: input.timestamp,
    operation: {
      fingerprint: stableExecutionHash({ command: input.command }),
      id: input.operationId,
      kind: "tool_call",
      name: "Bash",
    },
    runId: input.eventRunId ?? runId,
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}

function stopEvent(
  eventRunId = runId,
  timestamp = "2026-01-01T00:00:03.000Z",
): ExecutionEvent {
  return {
    id: "event-stop",
    lifecycle: "point",
    occurredAt: timestamp,
    operation: {
      id: "turn",
      kind: "turn",
      name: "Turn completed",
    },
    runId: eventRunId,
    runStatus: "ok",
    status: "ok",
    version: EXECUTION_EVENT_VERSION,
  };
}
