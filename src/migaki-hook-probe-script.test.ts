import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-hook-probe script", () => {
  it("documents the fast native hook probe", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-hook-probe`,
      "--help",
    ]);

    expect(stdout).toContain("Usage: scripts/migaki-hook-probe");
    expect(stdout).toContain(
      "Run a fast deterministic native Codex hook probe",
    );
    expect(stdout).toContain("smoke-prefixed run id");
  });
});
