import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
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

describe("migaki-bridge-session script", () => {
  it("documents scoped bridge session startup", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge-session`,
      "--help",
    ]);

    expect(stdout).toContain(
      "Usage: scripts/migaki-bridge-session [--shell] [--run <run-id>] [--prefix <prefix>] [--] [command] [args...]",
    );
    expect(stdout).toContain("Print a scoped Codex app bridge run id");
    expect(stdout).toContain("record it immediately");
    expect(stdout).toContain("--shell");
    expect(stdout).toContain("--run <run-id>");
    expect(stdout).toContain("--prefix <prefix>");
  });

  it("prints exact fresh-shell commands for an explicit run id", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge-session`,
      "--run",
      "codex-app-bridge-example",
    ]);

    expect(stdout).toContain("# Migaki Bridge Session");
    expect(stdout).toContain("- Run id: codex-app-bridge-example");
    expect(stdout).toContain(
      "mise run migaki:bridge -- --run 'codex-app-bridge-example' -- <command> [args...]",
    );
    expect(stdout).toContain(
      "export MIGAKI_BRIDGE_RUN_ID='codex-app-bridge-example'",
    );
    expect(stdout).toContain('mgb() { mise run migaki:bridge -- -- "$@"; }');
    expect(stdout).toContain(
      "mise run migaki:advise -- --bridge-run 'codex-app-bridge-example'",
    );
    expect(stdout).toContain(
      "mise run migaki:ready -- --bridge-run 'codex-app-bridge-example'",
    );
    expect(stdout).toContain(
      "mise run migaki:doctor -- --bridge-run 'codex-app-bridge-example'",
    );
    expect(stdout).toContain(
      "mise run migaki:dogfood -- --bridge-run 'codex-app-bridge-example'",
    );
    expect(stdout).toContain(
      "MIGAKI_BRIDGE_RUN_ID='codex-app-bridge-example' mise run migaki:ready",
    );
  });

  it("shell-quotes the run id in normal command output", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge-session`,
      "--run",
      "bridge'run",
    ]);

    expect(stdout).toContain("--run 'bridge'\\''run' -- <command>");
    expect(stdout).toContain("export MIGAKI_BRIDGE_RUN_ID='bridge'\\''run'");
    expect(stdout).toContain("--bridge-run 'bridge'\\''run'");
  });

  it("prints eval-able interactive shell setup", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge-session`,
      "--shell",
      "--run",
      "codex-app-bridge-example",
    ]);

    expect(stdout).toBe(
      [
        "export MIGAKI_BRIDGE_RUN_ID='codex-app-bridge-example'",
        'mgb() { mise run migaki:bridge -- -- "$@"; }',
        "",
      ].join("\n"),
    );
  });

  it("shell-quotes the run id in eval-able output", async () => {
    const { stdout } = await execFileAsync("sh", [
      `${repositoryRoot}/scripts/migaki-bridge-session`,
      "--shell",
      "--run",
      "bridge'run",
    ]);

    expect(stdout).toContain("export MIGAKI_BRIDGE_RUN_ID='bridge'\\''run'");
  });

  it("rejects first-command recording in shell mode", async () => {
    await expect(
      execFileAsync("sh", [
        `${repositoryRoot}/scripts/migaki-bridge-session`,
        "--shell",
        "--run",
        "codex-app-bridge-example",
        "sed",
        "-n",
        "1,1p",
        "README.md",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--shell cannot record a first command."),
    });
  });

  it("rejects unknown session options before the command", async () => {
    await expect(
      execFileAsync("sh", [
        `${repositoryRoot}/scripts/migaki-bridge-session`,
        "--rnu",
        "typo",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown option: --rnu"),
    });
  });

  it("records the first command through the scoped bridge run", async () => {
    const root = await tempRoot();
    const scriptsDirectory = join(root, "scripts");
    const bridgeArgsPath = join(root, "bridge-args.txt");
    await mkdir(scriptsDirectory);
    await writeFile(
      join(scriptsDirectory, "migaki-bridge"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(bridgeArgsPath)}\n`,
    );
    await chmod(join(scriptsDirectory, "migaki-bridge"), 0o755);

    const { stdout } = await execFileAsync(
      "sh",
      [
        `${repositoryRoot}/scripts/migaki-bridge-session`,
        "--run",
        "codex-app-bridge-recording-test",
        "sed",
        "-n",
        "1,1p",
        "README.md",
      ],
      {
        cwd: root,
      },
    );

    expect(stdout).toContain("# Recording First Command");
    await expect(readFile(bridgeArgsPath, "utf8")).resolves.toBe(
      [
        "--run",
        "codex-app-bridge-recording-test",
        "--",
        "sed",
        "-n",
        "1,1p",
        "README.md",
        "",
      ].join("\n"),
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-bridge-session-"));

  tempDirectories.push(directory);

  return directory;
}
