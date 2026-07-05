import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-advise script", () => {
  it("documents the explicit smoke-run opt-in", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-advise`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-advise [--include-smoke] [--source-root <path>] [--bridge-run <run-id>]",
    );
    expect(stdout).toContain(
      "Smoke fixture, smoke-harness, session-boundary, and running turn graphs are skipped by default.",
    );
    expect(stdout).toContain("Advice Source note");
    expect(stdout).toContain("Dogfood Status bridge-required note");
    expect(stdout).toContain("accepted advice-only file-reuse policy");
    expect(stdout).toContain("manual bridge");
    expect(stdout).toContain("--include-smoke");
    expect(stdout).toContain("--source-root");
    expect(stdout).toContain("--bridge-run");
    expect(stdout).toContain("MIGAKI_BRIDGE_RUN_ID");
  });
});
