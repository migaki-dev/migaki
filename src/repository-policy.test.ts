import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("repository source policy", () => {
  it("does not track JavaScript-family source files", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: repositoryRoot,
    });
    const javascriptFamilyFiles = stdout
      .split("\n")
      .filter((path) => /\.(?:c?m?js|jsx)$/.test(path));

    expect(javascriptFamilyFiles).toEqual([]);
  });
});
