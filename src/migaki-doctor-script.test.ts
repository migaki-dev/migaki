import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-doctor script", () => {
  it("documents the local dogfooding health check", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-doctor`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-doctor [--include-smoke] [--strict] [--max-real-age-minutes <minutes>] [--bridge-run <run-id>]",
    );
    expect(stdout).toContain("Inspect local Migaki Codex dogfooding health");
    expect(stdout).toContain("checks local Codex trusted-hash records");
    expect(stdout).toContain("latest organic turn");
    expect(stdout).toContain("smoke-harness");
    expect(stdout).toContain("--include-smoke");
    expect(stdout).toContain("--strict");
    expect(stdout).toContain("--max-real-age-minutes");
    expect(stdout).toContain("--bridge-run");
    expect(stdout).toContain("MIGAKI_BRIDGE_RUN_ID");
  });
});
