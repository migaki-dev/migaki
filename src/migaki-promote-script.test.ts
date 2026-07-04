import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("migaki-promote wrapper", () => {
  it("documents latest-run promotion in help output", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-promote`,
      "--help",
    ]);

    expect(stdout).toContain("--latest");
    expect(stdout).toContain("--run <run-id>");
    expect(stdout).toContain("--name <slug>");
  });
});
