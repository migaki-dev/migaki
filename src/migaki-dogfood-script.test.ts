import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-dogfood script", () => {
  it("documents the one-command Codex dogfooding gate", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-dogfood`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-dogfood [--max-real-age-minutes <minutes>] [--bridge-run <run-id>]",
    );
    expect(stdout).toContain("Run the Codex dogfooding gate");
    expect(stdout).toContain("runs migaki:hook-probe first");
    expect(stdout).toContain("organic native Codex turn");
    expect(stdout).toContain("--max-real-age-minutes");
    expect(stdout).toContain("--bridge-run");
    expect(stdout).toContain("MIGAKI_BRIDGE_RUN_ID");
  });
});
