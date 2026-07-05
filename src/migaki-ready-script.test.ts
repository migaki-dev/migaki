import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-ready script", () => {
  it("documents the practical session readiness gate", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-ready`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-ready [--max-real-age-minutes <minutes>] [--bridge-run <run-id>]",
    );
    expect(stdout).toContain(
      "passes for fresh organic native dogfooding or for fresh active bridge evidence",
    );
    expect(stdout).toContain("--bridge-run");
    expect(stdout).toContain("MIGAKI_BRIDGE_RUN_ID");
    expect(stdout).toContain("codex-app-bridge");
  });
});
