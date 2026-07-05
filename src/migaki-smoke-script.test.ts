import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-smoke script", () => {
  it("documents the fresh real smoke report output", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-smoke`,
      "--help",
    ]);

    expect(stdout).toContain("Usage: scripts/migaki-smoke");
    expect(stdout).toContain("Run a trusted Codex CLI smoke turn");
    expect(stdout).toContain(
      "prints the fresh real Codex smoke report path and contents",
    );
    expect(stdout).toContain("marks that report as smoke-harness evidence");
  });
});
