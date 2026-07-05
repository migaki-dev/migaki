import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-bridge script", () => {
  it("documents the short Codex app bridge command wrapper", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-bridge [--run <run-id>] [--] <command> [args...]",
    );
    expect(stdout).toContain(
      "Run a command through the Codex app bridge evidence run.",
    );
    expect(stdout).toContain("codex-app-bridge");
    expect(stdout).toContain("MIGAKI_BRIDGE_RUN_ID");
    expect(stdout).toContain("--run <run-id>");
  });
});
