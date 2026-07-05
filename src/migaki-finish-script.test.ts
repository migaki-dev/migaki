import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-finish script", () => {
  it("documents explicit finish-only capture", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-finish`,
      "--help",
    ]);

    expect(stdout).toContain("Usage: scripts/migaki-finish [options]");
    expect(stdout).toContain(
      "Mark a running Migaki Codex turn complete without running another command.",
    );
    expect(stdout).toContain("--run <run-id>");
  });
});
