import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requiredProfileFields = [
  "project_name",
  "project_slug",
  "scm",
  "repo",
  "repo_path",
  "default_branch",
  "worktree_parent",
  "objective",
  "source_policy",
  "required_sources",
  "local_ci",
  "status_labels",
  "priority_labels",
  "area_labels",
  "kind_labels",
  "scm_commands",
  "domain_focus",
  "completion_criteria",
] as const;

const requiredProfileSources = [
  "README.md",
  "CONTRIBUTING.md",
  ".agents/AGENTS.md",
  "Project Scope",
  "v0 Roadmap",
  "Whitepaper Notes",
  "Risks",
  "Examples",
  "Benchmarks",
  "whitepaper v0.4 Initial Scope",
  "whitepaper v0.4 Verification",
  "whitepaper v0.4 Long-Term Vision",
  "docs/mir-v0.md",
  "docs/pass-contracts-v0.md",
  "docs/provider-capabilities-v0.md",
  "docs/evidence-bundles-v0.md",
  "docs/adaptive-policies-v0.md",
  "docs/cli-v0.md",
  "docs/repo-agent-task-ladder-v0.md",
] as const;

const repoAgentTaskFamilies = [
  "Read-only reconnaissance",
  "Implementation and debug",
  "CI and toolchain triage",
  "Docs and wiki alignment",
  "Issue planning and blocker maintenance",
  "PR review and merge readiness",
  "Evidence promotion and handoff",
] as const;

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

  it("publishes a discoverable project profile for generic automation skills", async () => {
    const [agentsInstructions, projectProfile] = await Promise.all([
      readFile(`${repositoryRoot}/.agents/AGENTS.md`, "utf8"),
      readFile(`${repositoryRoot}/.agents/project-profile.md`, "utf8"),
    ]);

    expect(agentsInstructions).toContain(".agents/project-profile.md");

    for (const field of requiredProfileFields) {
      expect(projectProfile).toContain(`${field}:`);
    }

    for (const source of requiredProfileSources) {
      expect(projectProfile).toContain(source);
    }

    expect(projectProfile).toContain("dependency text in issue bodies");
    expect(projectProfile).toContain("native GitHub issue dependencies");
    expect(projectProfile).toContain("repository-wide semaphore");
    expect(projectProfile).toContain("status:claimed");
    expect(projectProfile).toContain("status:in-review");
    expect(projectProfile).not.toContain("/Users/");
  });

  it("publishes the repo-agent task ladder acceptance matrix", async () => {
    const [matrix, docsIndex, packageReadme] = await Promise.all([
      readFile(`${repositoryRoot}/docs/repo-agent-task-ladder-v0.md`, "utf8"),
      readFile(`${repositoryRoot}/docs/README.md`, "utf8"),
      readFile(
        `${repositoryRoot}/packages/migaki-openai-agents-js/README.md`,
        "utf8",
      ),
    ]);

    expect(docsIndex).toContain("./repo-agent-task-ladder-v0.md");
    expect(packageReadme).toContain("repo-agent-task-ladder-v0.md");
    expect(matrix).toContain("MVP repo-agent task ladder");
    expect(matrix).toContain(
      "https://github.com/migaki-dev/migaki/milestone/3",
    );
    expect(matrix).toContain(
      "https://github.com/migaki-dev/migaki/wiki/v0-Roadmap",
    );
    expect(matrix).toContain("potential reuse");
    expect(matrix).toContain("actual avoided work");
    expect(matrix).toContain("observation-only");
    expect(matrix).toContain("validator quality");
    expect(matrix).toContain("changed-input handling");
    expect(matrix).toContain("reuse decision counts");
    expect(matrix).toContain("privacy/redaction");

    for (const family of repoAgentTaskFamilies) {
      expect(matrix).toContain(family);
    }
  });
});
