import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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

describe("migaki-latest-report script", () => {
  it("documents default filtering for dogfooding reports", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-latest-report`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-latest-report [--path] [--chronological] [--include-smoke] [--include-session]",
    );
    expect(stdout).toContain(
      "Print the newest useful Migaki Codex execution report",
    );
    expect(stdout).toContain(
      "Smoke fixture, smoke-harness, and session-boundary reports are skipped by default.",
    );
    expect(stdout).toContain("--chronological");
    expect(stdout).toContain("--include-session");
  });

  it("prefers a useful report over a newer no-signal report by default", async () => {
    const runsDirectory = await tempRunsDirectory();
    const usefulReport = await writeReportFixture({
      body: "- Top recommendation: needs_review file_reuse across 2 read-like calls\n",
      mtime: new Date("2026-01-01T00:00:00.000Z"),
      runId: "codex-turn-useful",
      runsDirectory,
    });
    const noSignalReport = await writeReportFixture({
      body: "- Top recommendation: none\n",
      mtime: new Date("2026-01-01T00:00:10.000Z"),
      runId: "codex-turn-no-signal",
      runsDirectory,
    });

    const { stdout: defaultStdout } = await execLatestReport(
      ["--path"],
      runsDirectory,
    );
    const { stdout: chronologicalStdout } = await execLatestReport(
      ["--chronological", "--path"],
      runsDirectory,
    );

    expect(defaultStdout.trim()).toBe(usefulReport);
    expect(chronologicalStdout.trim()).toBe(noSignalReport);
  });

  it("skips smoke harness reports by default", async () => {
    const runsDirectory = await tempRunsDirectory();
    const organicReport = await writeReportFixture({
      body: "- Top recommendation: none\n",
      mtime: new Date("2026-01-01T00:00:00.000Z"),
      runId: "codex-turn-organic",
      runsDirectory,
    });
    await writeReportFixture({
      body: "- Top recommendation: needs_review file_reuse across 2 read-like calls\n",
      markerFiles: [".migaki-smoke-real-turn"],
      mtime: new Date("2026-01-01T00:00:10.000Z"),
      runId: "codex-turn-smoke-created-cli-proof",
      runsDirectory,
    });

    const { stdout: defaultStdout } = await execLatestReport(
      ["--chronological", "--path"],
      runsDirectory,
    );
    const { stdout: includeSmokeStdout } = await execLatestReport(
      ["--include-smoke", "--chronological", "--path"],
      runsDirectory,
    );

    expect(defaultStdout.trim()).toBe(organicReport);
    expect(includeSmokeStdout.trim()).toContain(
      "codex-turn-smoke-created-cli-proof/report.md",
    );
  });
});

async function execLatestReport(
  args: readonly string[],
  runsDirectory: string,
): Promise<{
  readonly stderr: string;
  readonly stdout: string;
}> {
  const result = await execFileAsync(
    "sh",
    [`${repositoryRoot}/scripts/migaki-latest-report`, ...args],
    {
      env: {
        ...process.env,
        MIGAKI_RUNS_DIR: runsDirectory,
      },
    },
  );

  return {
    stderr: String(result.stderr),
    stdout: String(result.stdout),
  };
}

async function tempRunsDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-latest-report-"));
  const runsDirectory = join(directory, "runs");

  tempDirectories.push(directory);
  await mkdir(runsDirectory, { recursive: true });

  return runsDirectory;
}

async function writeReportFixture(input: {
  readonly body: string;
  readonly markerFiles?: readonly string[];
  readonly mtime: Date;
  readonly runId: string;
  readonly runsDirectory: string;
}): Promise<string> {
  const runDirectory = join(input.runsDirectory, input.runId);
  const reportPath = join(runDirectory, "report.md");

  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    reportPath,
    ["# Migaki Execution Report", "", input.body].join("\n"),
    "utf8",
  );
  await writeFile(
    join(runDirectory, "graph.json"),
    '{"version":"migaki.execution-graph.v0","nodes":[]}\n',
    "utf8",
  );
  await Promise.all(
    (input.markerFiles ?? []).map((markerFile) =>
      writeFile(
        join(runDirectory, markerFile),
        '{"version":"migaki.smoke-real-turn.v0","origin":"migaki:smoke"}\n',
        "utf8",
      ),
    ),
  );
  await utimes(reportPath, input.mtime, input.mtime);

  return reportPath;
}
