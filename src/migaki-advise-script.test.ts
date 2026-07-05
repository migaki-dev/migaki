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

    expect(stdout).toContain("Usage: scripts/migaki-advise [--include-smoke]");
    expect(stdout).toContain("Smoke fixture runs are skipped by default.");
    expect(stdout).toContain("--include-smoke");
  });
});
