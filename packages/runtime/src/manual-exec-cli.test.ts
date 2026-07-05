import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runManualExecCli } from "./manual-exec-cli.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("manual Migaki exec CLI", () => {
  it("reports a missing running turn instead of creating an implicit manual run", async () => {
    const root = await tempRoot();
    const storeDirectory = join(root, ".migaki");
    const stdout = collectStream();
    const stderr = collectStream();

    const exitCode = await runManualExecCli(
      [
        "--store",
        storeDirectory,
        "--attach-latest-running",
        process.execPath,
        "-e",
        "",
      ],
      {
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
      {
        cwd: root,
        env: process.env,
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.text()).toBe("");
    expect(stderr.text()).toContain(
      "No running Codex turn was available to attach.",
    );
    expect(stderr.text()).toContain("pass --run <run-id>");
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-manual-exec-cli-"));

  tempDirectories.push(directory);

  return directory;
}

function collectStream(): {
  readonly stream: NodeJS.WritableStream;
  readonly text: () => string;
} {
  let output = "";
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    text() {
      return output;
    },
  };
}
