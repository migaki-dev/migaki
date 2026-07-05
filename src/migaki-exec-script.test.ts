import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-exec script", () => {
  it("documents explicit manual command evidence capture", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-exec`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-exec [options] [--] <command> [args...]",
    );
    expect(stdout).toContain(
      "Run a command normally while recording redacted Migaki command evidence.",
    );
    expect(stdout).toContain("--attach-latest-running");
    expect(stdout).toContain("--finish-attached-run");
  });
});
