import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
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

describe("Migaki dogfood scripts", () => {
  it("prints setup guidance instead of failing when no local evidence exists", async () => {
    const sourceRoot = await tempRoot();

    const { stdout } = await execFileAsync("sh", [
      join(repositoryRoot, "scripts/migaki-advise"),
      "--source-root",
      sourceRoot,
    ]);

    expect(stdout).toContain("# Migaki Session Advice");
    expect(stdout).toContain("Top signal: no local evidence");
    expect(stdout).toContain("Run `mise run migaki:doctor`");
  });

  it("filters smoke runs from run listings by default", async () => {
    const sourceRoot = await tempRoot();

    await writeRun(sourceRoot, {
      runId: "codex-turn-real-1",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    await writeRun(sourceRoot, {
      runId: "codex-turn-migaki-smoke-file-reuse-1",
      startedAt: "2026-01-01T00:00:01.000Z",
    });

    const defaultResult = await execFileAsync("sh", [
      join(repositoryRoot, "scripts/migaki-runs"),
      "--source-root",
      sourceRoot,
      "--limit",
      "10",
    ]);
    const includeSmokeResult = await execFileAsync("sh", [
      join(repositoryRoot, "scripts/migaki-runs"),
      "--source-root",
      sourceRoot,
      "--include-smoke",
      "--limit",
      "10",
    ]);

    expect(defaultResult.stdout).toContain("codex-turn-real-1");
    expect(defaultResult.stdout).not.toContain("migaki-smoke");
    expect(includeSmokeResult.stdout).toContain("codex-turn-real-1");
    expect(includeSmokeResult.stdout).toContain(
      "codex-turn-migaki-smoke-file-reuse-1",
    );
  });

  it("selects the newest real report unless smoke reports are explicitly included", async () => {
    const sourceRoot = await tempRoot();

    await writeRun(sourceRoot, {
      runId: "codex-turn-real-1",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    await writeRun(sourceRoot, {
      runId: "codex-turn-migaki-smoke-file-reuse-1",
      startedAt: "2026-01-01T00:00:01.000Z",
    });

    const defaultResult = await execFileAsync("sh", [
      join(repositoryRoot, "scripts/migaki-latest-report"),
      "--source-root",
      sourceRoot,
      "--path",
    ]);
    const includeSmokeResult = await execFileAsync("sh", [
      join(repositoryRoot, "scripts/migaki-latest-report"),
      "--source-root",
      sourceRoot,
      "--include-smoke",
      "--path",
    ]);

    expect(defaultResult.stdout.trim()).toBe(
      join(sourceRoot, "runs/codex-turn-real-1/report.md"),
    );
    expect(includeSmokeResult.stdout.trim()).toBe(
      join(sourceRoot, "runs/codex-turn-migaki-smoke-file-reuse-1/report.md"),
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-dogfood-scripts-"));
  tempDirectories.push(directory);

  return directory;
}

async function writeRun(
  sourceRoot: string,
  input: {
    readonly runId: string;
    readonly startedAt: string;
  },
): Promise<void> {
  const runDirectory = join(sourceRoot, "runs", input.runId);

  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    join(runDirectory, "report.md"),
    [
      "# Migaki Execution Report",
      "",
      `Run: ${input.runId}`,
      "Status: ok",
      `Started: ${input.startedAt}`,
      "- Nodes: 1",
      "- Tool calls: 0",
      "- Duration ms: 0",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(runDirectory, "graph.json"),
    [
      "{",
      `  "runId": ${JSON.stringify(input.runId)},`,
      '  "version": "migaki.execution-graph.v0",',
      `  "startedAt": ${JSON.stringify(input.startedAt)},`,
      `  "createdAt": ${JSON.stringify(input.startedAt)},`,
      '  "status": "ok",',
      '  "metadata": {},',
      '  "nodes": [],',
      '  "edges": []',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}
