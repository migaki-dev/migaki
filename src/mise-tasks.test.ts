import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("mise tasks", () => {
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
});

function readTask(config: string, taskName: string): string {
  const escapedName = escapeRegExp(taskName);
  const match = new RegExp(
    String.raw`\[tasks\."${escapedName}"\]\n(?<task>[\s\S]*?)(?=\n\[tasks[.\"]|\n$)`,
  ).exec(config);

  if (match?.groups?.task === undefined) {
    throw new Error(`Missing mise task ${taskName}.`);
  }

  return match.groups.task;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
