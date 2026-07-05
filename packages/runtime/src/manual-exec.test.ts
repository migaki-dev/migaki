import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  finishManualRun,
  manualFileArtifacts,
  ManualRunTargetNotFoundError,
  runManualCommand,
  selectManualRunTarget,
} from "./manual-exec.js";
import type { ExecutionGraph } from "./execution.js";

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

describe("manual Migaki command execution", () => {
  it("records a completed command run without persisting raw command args", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");

    const result = await runManualCommand({
      commandArgs: [process.execPath, "-e", "", "SECRET_MANUAL_EXEC_ARG"],
      runId: "manual-test-run",
      stdio: "ignore",
      storeDirectory,
    });

    const runDirectory = join(storeDirectory, "runs", "manual-test-run");
    const graph = JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph;
    const persisted = [
      await readFile(join(runDirectory, "events.jsonl"), "utf8"),
      await readFile(join(runDirectory, "graph.json"), "utf8"),
      await readFile(join(runDirectory, "report.md"), "utf8"),
    ].join("\n");

    expect(result).toMatchObject({
      exitCode: 0,
      runId: "manual-test-run",
      status: "ok",
    });
    expect(graph.status).toBe("ok");
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      operation: {
        kind: "tool_call",
      },
      status: "ok",
    });
    expect(persisted).toContain("manual-exec");
    expect(persisted).not.toContain(process.execPath);
    expect(persisted).not.toContain("SECRET_MANUAL_EXEC_ARG");
  });

  it("records repeated read-like file fingerprints for local file reuse advice", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");
    const fixturePath = join(root, "private-plan.txt");

    await writeFile(fixturePath, "keep this local\n", "utf8");

    await runManualCommand({
      commandArgs: ["cat", fixturePath],
      runId: "manual-file-reuse",
      stdio: "ignore",
      storeDirectory,
    });
    await runManualCommand({
      commandArgs: ["sed", "-n", "1p", fixturePath],
      runId: "manual-file-reuse",
      stdio: "ignore",
      storeDirectory,
    });

    const runDirectory = join(storeDirectory, "runs", "manual-file-reuse");
    const graph = JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph;
    const report = await readFile(join(runDirectory, "report.md"), "utf8");
    const persisted = [
      await readFile(join(runDirectory, "events.jsonl"), "utf8"),
      JSON.stringify(graph),
      report,
    ].join("\n");

    expect(graph.nodes).toHaveLength(2);
    expect(report).toContain("file_reuse");
    expect(report).toContain("Sources: Shell cat, Shell sed");
    expect(report).toContain("Freshness: verified");
    expect(report).toContain("Automatic skip: disallowed");
    expect(report).toContain("file fingerprint was observed 2 times");
    expect(persisted).not.toContain(fixturePath);
    expect(persisted).not.toContain("private-plan.txt");
    expect(persisted).not.toContain("keep this local");
    expect(persisted).not.toContain("sed -n");
  });

  it("detects read-like file artifacts without exposing raw paths", async () => {
    const root = await tempRoot();
    const fixturePath = join(root, "private-artifact.txt");

    await writeFile(fixturePath, "local only\n", "utf8");

    const artifacts = manualFileArtifacts({
      commandArgs: ["cat", fixturePath],
      cwd: root,
      operationId: "manual-tool",
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: "manual-tool-file-path",
      kind: "file",
      metadata: {
        codex: {
          fingerprintVersion: "manual.file_path.v0",
          sourceCommand: "cat",
          sourceField: "argv",
          toolName: "Shell",
        },
      },
    });
    expect(JSON.stringify(artifacts)).not.toContain(fixturePath);
    expect(JSON.stringify(artifacts)).not.toContain("private-artifact.txt");
  });

  it("prefers an explicit run id over latest-running attachment", () => {
    expect(
      selectManualRunTarget({
        attachLatestRunning: true,
        finishAttachedRun: true,
        runId: "manual-explicit",
      }),
    ).toEqual({
      attachedToRunningTurn: false,
      completeRun: true,
      runId: "manual-explicit",
    });
  });

  it("fails closed when latest-running attachment has no running turn", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");

    expect(() =>
      selectManualRunTarget({
        attachLatestRunning: true,
        storeDirectory,
      }),
    ).toThrow(ManualRunTargetNotFoundError);
    await expect(
      runManualCommand({
        attachLatestRunning: true,
        commandArgs: [process.execPath, "-e", ""],
        stdio: "ignore",
        storeDirectory,
      }),
    ).rejects.toBeInstanceOf(ManualRunTargetNotFoundError);
  });

  it("can finish an attached latest running Codex turn explicitly", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");
    const runId = "codex-turn-active-desktop";
    const runDirectory = join(storeDirectory, "runs", runId);

    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      join(runDirectory, "graph.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        edges: [],
        metadata: {},
        nodes: [],
        runId,
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        version: "migaki.execution-graph.v0",
      })}\n`,
      "utf8",
    );

    expect(
      selectManualRunTarget({
        attachLatestRunning: true,
        finishAttachedRun: true,
        storeDirectory,
      }),
    ).toEqual({
      attachedToRunningTurn: true,
      completeRun: true,
      runId,
    });

    const result = await runManualCommand({
      attachLatestRunning: true,
      commandArgs: [process.execPath, "-e", ""],
      finishAttachedRun: true,
      stdio: "ignore",
      storeDirectory,
    });

    const graph = JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph;
    const report = await readFile(join(runDirectory, "report.md"), "utf8");

    expect(result).toMatchObject({
      attachedToRunningTurn: true,
      exitCode: 0,
      finishedRun: true,
      runId,
      status: "ok",
    });
    expect(graph.status).toBe("ok");
    expect(report).toContain("Status: ok");
    expect(report).toContain("Tool calls: 1");
  });

  it("can finish the latest running Codex turn without running another command", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");
    const runId = "codex-turn-finish-only";
    const runDirectory = join(storeDirectory, "runs", runId);

    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      join(runDirectory, "graph.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        edges: [],
        metadata: {},
        nodes: [],
        runId,
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        version: "migaki.execution-graph.v0",
      })}\n`,
      "utf8",
    );

    await runManualCommand({
      attachLatestRunning: true,
      commandArgs: [process.execPath, "-e", ""],
      stdio: "ignore",
      storeDirectory,
    });

    const result = await finishManualRun({
      storeDirectory,
    });
    const graph = JSON.parse(
      await readFile(join(runDirectory, "graph.json"), "utf8"),
    ) as ExecutionGraph;
    const report = await readFile(join(runDirectory, "report.md"), "utf8");

    expect(result).toEqual({
      finished: true,
      runId,
    });
    expect(graph.status).toBe("ok");
    expect(graph.nodes.map((node) => node.id)).toContain("turn");
    expect(report).toContain("- turn: Turn completed (turn, ok");
  });

  it("reports when no running Codex turn is available to finish", async () => {
    const root = await tempRoot();

    expect(
      await finishManualRun({
        storeDirectory: join(root, ".migaki"),
      }),
    ).toEqual({
      finished: false,
    });
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-manual-exec-"));

  tempDirectories.push(directory);

  return directory;
}
