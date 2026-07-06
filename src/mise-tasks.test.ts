import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("mise tasks", () => {
  it("installs dependencies once before quality check fanout", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const setupTask = readTask(config, "setup");
    const installTask = readTask(config, "install");
    const checkTask = readTask(config, "check");
    const checkTasksTask = readTask(config, "check:tasks");

    expect(setupTask).toContain('depends = ["hooks:install", "install"]');
    expect(installTask).toContain(
      'description = "Install pnpm workspace dependencies from the lockfile"',
    );
    expect(installTask).toContain('run = "pnpm install --frozen-lockfile"');
    expect(checkTask).toContain('depends = ["install"]');
    expect(checkTask).toContain('run = "mise run check:tasks"');

    for (const task of [
      "format:check",
      "lint",
      "typecheck",
      "test",
      "test:e2e",
      "build",
      "bootstrap:check",
    ]) {
      expect(checkTasksTask).toContain(`"${task}"`);
    }

    expect(checkTasksTask).not.toContain('"install"');
  });

  it("wires OpenAI Agents benchmark CLI execution", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "benchmark:openai-agents");

    expect(task).toContain(
      'description = "Run the OpenAI Agents benchmark CLI"',
    );
    expect(task).toContain('depends = ["build"]');
    expect(task).toContain(
      'run = "node packages/migaki-openai-agents-js/dist/cli.js"',
    );
  });

  it("wires the Codex advice wrapper behind a build", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:codex");

    expect(task).toContain(
      'description = "Run codex exec with latest Migaki session advice prepended"',
    );
    expect(task).toContain('depends = ["build"]');
    expect(task).toContain('run = "scripts/migaki-codex"');
  });

  it("wires Migaki advice without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:advise");

    expect(task).toContain(
      'description = "Print next-session advice from the newest local Migaki execution graph"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-advise"');
  });

  it("wires the Codex dogfood doctor without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:doctor");

    expect(task).toContain(
      'description = "Inspect local Migaki Codex dogfooding health"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-doctor"');
  });

  it("wires the Codex dogfood gate without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:dogfood");

    expect(task).toContain('description = "Run the Codex dogfooding gate"');
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-dogfood"');
  });

  it("wires the practical Migaki readiness gate without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:ready");

    expect(task).toContain(
      'description = "Check whether Migaki is usable in the current session"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-ready"');
  });

  it("wires the fast native hook probe without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:hook-probe");

    expect(task).toContain(
      'description = "Run a fast deterministic native Codex hook probe"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-hook-probe"');
  });

  it("wires manual command evidence capture without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:exec");

    expect(task).toContain(
      'description = "Run a command while recording redacted Migaki command evidence"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-exec"');
  });

  it("wires the default Codex app bridge without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:bridge");

    expect(task).toContain(
      'description = "Run a command through the default Codex app bridge evidence run"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-bridge"');
  });

  it("wires scoped Codex app bridge session startup without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:bridge-session");

    expect(task).toContain(
      'description = "Print a scoped Codex app bridge session run id and commands"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-bridge-session"');
  });

  it("wires finish-only command evidence capture without forcing a rebuild", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:finish");

    expect(task).toContain(
      'description = "Mark a running Migaki Codex turn complete"',
    );
    expect(task).not.toContain("depends");
    expect(task).toContain('run = "scripts/migaki-finish"');
  });

  it("wires project artifact promotion behind a build", async () => {
    const config = await readFile(`${repositoryRoot}/mise.toml`, "utf8");
    const task = readTask(config, "migaki:promote");

    expect(task).toContain(
      'description = "Promote a local Migaki run into tracked project artifacts"',
    );
    expect(task).toContain('depends = ["build"]');
    expect(task).toContain('run = "scripts/migaki-promote"');
  });
});

function readTask(config: string, taskName: string): string {
  const escapedBareHeader = escapeRegExp(`[tasks.${taskName}]`);
  const escapedQuotedHeader = escapeRegExp(`[tasks."${taskName}"]`);
  const match = new RegExp(
    String.raw`(?:${escapedBareHeader}|${escapedQuotedHeader})\n(?<task>[\s\S]*?)(?=\n\[tasks[.\"]|\n$)`,
  ).exec(config);

  if (match?.groups?.task === undefined) {
    throw new Error(`Missing mise task ${taskName}.`);
  }

  return match.groups.task;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
