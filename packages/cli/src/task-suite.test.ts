import { describe, expect, it } from "vitest";

import { runCli } from "./index.js";

describe("task-suite command", () => {
  it("lists deterministic repo-agent task suites as JSON", async () => {
    const result = await runCli(["task-suite", "list", "--format", "json"]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({
      artifactKind: "task_suite_list",
      suites: [
        {
          description: "No repo-agent fixtures; useful for coverage gates.",
          fixtureCount: 0,
          id: "repo-agent-empty",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "issue-planning-and-blocker-maintenance",
            "pr-review-and-merge-readiness",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description: "One read-only repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-readonly",
          missingRequiredFamilies: [
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "issue-planning-and-blocker-maintenance",
            "pr-review-and-merge-readiness",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description: "All MVP repo-agent task ladder fixture families.",
          fixtureCount: 7,
          id: "repo-agent-mvp",
          missingRequiredFamilies: [],
        },
      ],
      version: "migaki.cli-task-suite.v0",
    });
  });

  it("does not claim success for an empty suite and reports missing fixture coverage", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-empty",
        "--output-dir",
        "out",
        "--format",
        "json",
      ],
      io,
    );

    expect(result.exitCode).toBe(1);
    expect(io.writes).toEqual({});
    expect(JSON.parse(result.stdout)).toMatchObject({
      artifactKind: "task_suite_run",
      coverage: {
        fixtureCount: 0,
        missingRequiredFamilies: [
          "read-only-reconnaissance",
          "implementation-and-debug",
          "ci-and-toolchain-triage",
          "docs-and-wiki-alignment",
          "issue-planning-and-blocker-maintenance",
          "pr-review-and-merge-readiness",
          "evidence-promotion-and-handoff",
        ],
        status: "missing",
      },
      fixtures: [],
      success: false,
      suiteId: "repo-agent-empty",
      warnings: [
        "Missing fixture coverage for read-only-reconnaissance, implementation-and-debug, ci-and-toolchain-triage, docs-and-wiki-alignment, issue-planning-and-blocker-maintenance, pr-review-and-merge-readiness, evidence-promotion-and-handoff.",
      ],
    });
  });

  it("writes stable artifacts for a single-fixture suite while keeping coverage incomplete", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-readonly",
        "--output-dir",
        "out",
        "--format",
        "json",
      ],
      io,
    );
    const report = JSON.parse(result.stdout) as {
      readonly fixtures: readonly [
        {
          readonly artifacts: Readonly<Record<string, string>>;
          readonly comparison: {
            readonly privacyPolicy: { readonly exportMode: string };
            readonly warnings: readonly { readonly code: string }[];
          };
          readonly familyId: string;
          readonly metrics: {
            readonly actualSkippedActions: number;
            readonly allowed: number;
            readonly blocked: number;
            readonly changedNodes: number;
            readonly needsReview: number;
          };
          readonly reuseDecision: {
            readonly privacyPolicy: { readonly exportMode: string };
            readonly redaction: { readonly mode: string };
          };
        },
      ];
      readonly success: boolean;
    };

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      artifacts: {
        comparisonJson:
          "out/repo-agent-readonly/read-only-reconnaissance/comparison.json",
        eventsJsonl:
          "out/repo-agent-readonly/read-only-reconnaissance/events.jsonl",
        graphJson:
          "out/repo-agent-readonly/read-only-reconnaissance/graph.json",
        reportMd: "out/repo-agent-readonly/read-only-reconnaissance/report.md",
        reuseDecisionJson:
          "out/repo-agent-readonly/read-only-reconnaissance/reuse-decision.json",
      },
      familyId: "read-only-reconnaissance",
      metrics: {
        actualSkippedActions: 0,
        allowed: 1,
        blocked: 1,
        changedNodes: 1,
        needsReview: 1,
      },
    });
    expect(report.fixtures[0].comparison.privacyPolicy.exportMode).toBe(
      "metadata_only",
    );
    expect(report.fixtures[0].comparison.warnings).toEqual([
      { code: "potential_reuse_only" },
    ]);
    expect(report.fixtures[0].reuseDecision.privacyPolicy.exportMode).toBe(
      "metadata_only",
    );
    expect(report.fixtures[0].reuseDecision.redaction.mode).toBe(
      "metadata_only",
    );
    expect(Object.keys(io.writes).sort()).toEqual([
      "out/repo-agent-readonly/read-only-reconnaissance/comparison.json",
      "out/repo-agent-readonly/read-only-reconnaissance/events.jsonl",
      "out/repo-agent-readonly/read-only-reconnaissance/graph.json",
      "out/repo-agent-readonly/read-only-reconnaissance/report.md",
      "out/repo-agent-readonly/read-only-reconnaissance/reuse-decision.json",
    ]);
    expect(
      io.writes["out/repo-agent-readonly/read-only-reconnaissance/report.md"],
    ).toContain("comparison.json");
    expect(
      io.writes["out/repo-agent-readonly/read-only-reconnaissance/report.md"],
    ).toContain(
      "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    );
    expect(
      io.writes[
        "out/repo-agent-readonly/read-only-reconnaissance/events.jsonl"
      ],
    ).not.toContain("/Users/");
  });

  it("runs all repo-agent fixture families through one command", async () => {
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-mvp",
        "--output-dir",
        "out",
        "--format",
        "json",
      ],
      fakeIo(),
    );
    const report = JSON.parse(result.stdout) as {
      readonly coverage: {
        readonly missingRequiredFamilies: readonly string[];
        readonly status: string;
      };
      readonly fixtures: readonly unknown[];
      readonly success: boolean;
    };

    expect(result.exitCode).toBe(0);
    expect(report.success).toBe(true);
    expect(report.coverage).toEqual({
      fixtureCount: 7,
      missingRequiredFamilies: [],
      status: "complete",
    });
    expect(report.fixtures).toHaveLength(7);
  });
});

function fakeIo(): {
  readonly mkdir: (path: string) => Promise<void>;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
  readonly writes: Record<string, string>;
} {
  const writes: Record<string, string> = {};

  return {
    async mkdir(): Promise<void> {},
    async readFile(path: string): Promise<string> {
      throw new Error(`Unexpected read ${path}.`);
    },
    async writeFile(path: string, contents: string): Promise<void> {
      writes[path] = contents;
    },
    writes,
  };
}
