import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-mvp-repo-agent-gate script", () => {
  it("documents the MVP repo-agent completion gate", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-mvp-repo-agent-gate`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-mvp-repo-agent-gate [--output-dir <dir>] [--format human|json] [--skip-strict-dogfood]",
    );
    expect(stdout).toContain("Run the MVP repo-agent completion gate");
    expect(stdout).toContain("repo-agent MVP task-suite fixtures");
    expect(stdout).toContain("strict dogfood status");
    expect(stdout).toContain("--skip-strict-dogfood");
  });
});
