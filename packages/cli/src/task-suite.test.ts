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
          description: "One implementation-and-debug repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-implementation-debug",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "issue-planning-and-blocker-maintenance",
            "pr-review-and-merge-readiness",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description: "One CI and toolchain triage repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-ci-toolchain-triage",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
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
            readonly summary: {
              readonly totalEstimatedAvoidableLatencyMs?: number;
              readonly totalEstimatedAvoidableTokens?: number;
            };
            readonly warnings: readonly { readonly code: string }[];
          };
          readonly familyId: string;
          readonly metrics: {
            readonly actualSkippedActions: number;
            readonly allowed: number;
            readonly blocked: number;
            readonly changedNodes: number;
            readonly estimatedAvoidableLatencyMs?: number;
            readonly estimatedAvoidableTokens?: number;
            readonly needsReview: number;
          };
          readonly reuseDecision: {
            readonly privacyPolicy: { readonly exportMode: string };
            readonly redaction: { readonly mode: string };
            readonly summary: {
              readonly allowed: number;
              readonly blocked: number;
              readonly needsReview: number;
              readonly totalCandidates: number;
            };
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
        allowed: 2,
        blocked: 1,
        changedNodes: 1,
        estimatedAvoidableLatencyMs: 30,
        estimatedAvoidableTokens: 144,
        needsReview: 1,
      },
    });
    expect(report.fixtures[0].comparison.summary).toMatchObject({
      totalEstimatedAvoidableLatencyMs: 30,
      totalEstimatedAvoidableTokens: 144,
    });
    expect(report.fixtures[0].reuseDecision.summary).toEqual({
      allowed: 2,
      blocked: 1,
      needsReview: 1,
      totalCandidates: 4,
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
      io.writes["out/repo-agent-readonly/read-only-reconnaissance/report.md"],
    ).toContain("- Estimated avoidable latency: 30 ms");
    expect(
      io.writes["out/repo-agent-readonly/read-only-reconnaissance/report.md"],
    ).toContain("- Actual skipped actions: 0");
    expect(
      io.writes[
        "out/repo-agent-readonly/read-only-reconnaissance/events.jsonl"
      ],
    ).not.toContain("/Users/");
    const graph = JSON.parse(
      writtenFile(
        io.writes,
        "out/repo-agent-readonly/read-only-reconnaissance/graph.json",
      ),
    ) as {
      readonly nodes: readonly {
        readonly artifacts: readonly {
          readonly metadata?: {
            readonly codex?: Readonly<Record<string, unknown>>;
            readonly reuse?: Readonly<Record<string, unknown>>;
          };
        }[];
        readonly id: string;
        readonly metadata: {
          readonly reconnaissance?: Readonly<Record<string, unknown>>;
          readonly reuse?: {
            readonly validatorsRequired?: readonly string[];
          };
        };
        readonly operation: { readonly name: string };
      }[];
    };
    const stableSearch = graph.nodes.find((node) =>
      node.id.endsWith("tool-search-stable"),
    );
    const changedSearch = graph.nodes.find((node) =>
      node.id.endsWith("tool-search-changed-fingerprint"),
    );
    const stableRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-unchanged-range"),
    );
    const staleRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-stale-range"),
    );
    const summary = graph.nodes.find((node) =>
      node.id.endsWith("model-source-summary"),
    );

    expect(stableSearch?.metadata.reconnaissance).toMatchObject({
      commit: "repo-fingerprint-a",
      query: "repo-agent task-suite fixture",
      resultSetFingerprint: "search-results-a",
    });
    expect(changedSearch?.metadata.reconnaissance).toMatchObject({
      commit: "repo-fingerprint-b",
      query: "repo-agent task-suite fixture",
      resultSetFingerprint: "search-results-b",
    });
    expect(stableRead?.metadata.reconnaissance).toMatchObject({
      commit: "repo-fingerprint-a",
      pathFingerprint: "docs-repo-agent-task-ladder",
      range: "1-40",
    });
    expect(staleRead?.artifacts[0]?.metadata?.reuse).toMatchObject({
      freshnessStatus: "unknown",
    });
    expect(staleRead?.artifacts[0]?.metadata?.codex).toMatchObject({
      sourceEquivalenceKey: "read:docs/repo-agent-task-ladder-v0.md:41-80",
    });
    expect(summary?.metadata.reuse?.validatorsRequired).toEqual([
      "cited-source-coverage",
    ]);
  });

  it("writes implementation-and-debug artifacts with blocked side effects and retry evidence", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-implementation-debug",
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
          readonly comparison: {
            readonly blockedCandidates: readonly {
              readonly nodeId: string;
              readonly reasons: readonly { readonly code: string }[];
              readonly sideEffectClass?: string;
            }[];
            readonly changedNodes: readonly {
              readonly nodeId: string;
              readonly reason: string;
            }[];
            readonly summary: {
              readonly totalEstimatedAvoidableCostUsd?: number;
              readonly totalEstimatedAvoidableLatencyMs?: number;
              readonly totalEstimatedAvoidableTokens?: number;
            };
          };
          readonly familyId: string;
          readonly metrics: {
            readonly actualSkippedActions: number;
            readonly allowed: number;
            readonly blocked: number;
            readonly changedNodes: number;
            readonly estimatedAvoidableCostUsd?: number;
            readonly estimatedAvoidableLatencyMs?: number;
            readonly estimatedAvoidableTokens?: number;
            readonly needsReview: number;
          };
          readonly reuseDecision: {
            readonly summary: {
              readonly allowed: number;
              readonly blocked: number;
              readonly needsReview: number;
              readonly totalCandidates: number;
            };
          };
        },
      ];
      readonly success: boolean;
    };

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "implementation-and-debug",
      metrics: {
        actualSkippedActions: 0,
        allowed: 2,
        blocked: 2,
        changedNodes: 3,
        estimatedAvoidableCostUsd: 0.002,
        estimatedAvoidableLatencyMs: 30,
        estimatedAvoidableTokens: 132,
        needsReview: 1,
      },
      reuseDecision: {
        summary: {
          allowed: 2,
          blocked: 2,
          needsReview: 1,
          totalCandidates: 5,
        },
      },
    });
    expect(report.fixtures[0].comparison.summary).toMatchObject({
      totalEstimatedAvoidableCostUsd: 0.002,
      totalEstimatedAvoidableLatencyMs: 30,
      totalEstimatedAvoidableTokens: 132,
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "implementation-and-debug-model-debug-diagnosis",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "implementation-and-debug-tool-apply-patch-retry",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "implementation-and-debug-tool-focused-test-pass",
          reason: "cache_key_changed",
        }),
      ]),
    );
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "implementation-and-debug-tool-apply-patch-initial",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "side_effecting_tool" }),
          ]),
          sideEffectClass: "non_idempotent_mutation",
        }),
        expect.objectContaining({
          nodeId: "implementation-and-debug-tool-focused-test-fail",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "side_effect_policy_missing" }),
          ]),
          sideEffectClass: "approval_required",
        }),
      ]),
    );
    expect(
      io.writes[
        "out/repo-agent-implementation-debug/implementation-and-debug/events.jsonl"
      ],
    ).toContain("retryBoundary");
    expect(
      io.writes[
        "out/repo-agent-implementation-debug/implementation-and-debug/report.md"
      ],
    ).toContain("validator_requirements");
    expect(
      io.writes[
        "out/repo-agent-implementation-debug/implementation-and-debug/report.md"
      ],
    ).toContain("side_effecting_tool");
  });

  it("writes CI/toolchain triage artifacts with fresh command and drift blockers", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-ci-toolchain-triage",
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
          readonly comparison: {
            readonly blockedCandidates: readonly {
              readonly nodeId: string;
              readonly reasons: readonly { readonly code: string }[];
              readonly sideEffectClass?: string;
            }[];
            readonly changedNodes: readonly {
              readonly nodeId: string;
              readonly reason: string;
            }[];
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
            readonly summary: {
              readonly allowed: number;
              readonly blocked: number;
              readonly needsReview: number;
              readonly totalCandidates: number;
            };
          };
        },
      ];
      readonly success: boolean;
    };
    const graph = JSON.parse(
      writtenFile(
        io.writes,
        "out/repo-agent-ci-toolchain-triage/ci-and-toolchain-triage/graph.json",
      ),
    ) as {
      readonly nodes: readonly {
        readonly artifacts: readonly {
          readonly metadata?: Readonly<Record<string, unknown>>;
        }[];
        readonly id: string;
        readonly metadata: {
          readonly ciToolchainTriage?: Readonly<Record<string, unknown>>;
        };
      }[];
    };
    const events = writtenFile(
      io.writes,
      "out/repo-agent-ci-toolchain-triage/ci-and-toolchain-triage/events.jsonl",
    );
    const fixtureReport = writtenFile(
      io.writes,
      "out/repo-agent-ci-toolchain-triage/ci-and-toolchain-triage/report.md",
    );
    const logClassification = graph.nodes.find((node) =>
      node.id.endsWith("model-log-classification"),
    );
    const localGate = graph.nodes.find((node) =>
      node.id.endsWith("tool-local-check"),
    );
    const environmentRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-environment-read"),
    );

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "ci-and-toolchain-triage",
      metrics: {
        actualSkippedActions: 0,
        allowed: 2,
        blocked: 2,
        changedNodes: 4,
        needsReview: 1,
      },
      reuseDecision: {
        summary: {
          allowed: 2,
          blocked: 2,
          needsReview: 1,
          totalCandidates: 5,
        },
      },
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "ci-and-toolchain-triage-tool-local-check",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "ci-and-toolchain-triage-tool-environment-read",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "ci-and-toolchain-triage-model-next-action",
          reason: "cache_key_changed",
        }),
      ]),
    );
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "ci-and-toolchain-triage-tool-local-rerun-required",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "side_effect_policy_missing" }),
          ]),
          sideEffectClass: "approval_required",
        }),
        expect.objectContaining({
          nodeId: "ci-and-toolchain-triage-tool-install",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "side_effecting_tool" }),
          ]),
          sideEffectClass: "non_idempotent_mutation",
        }),
      ]),
    );
    expect(logClassification?.metadata.ciToolchainTriage).toMatchObject({
      checkContract:
        "github-check:code-quality:. scripts/env && mise run check",
      evidenceKind: "log_classification",
      rawLogStorage: "omitted",
    });
    expect(localGate?.metadata.ciToolchainTriage).toMatchObject({
      commandFingerprint: "mise-run-check-v2",
      evidenceKind: "fresh_local_execution",
      localExecutionRequired: true,
      lockfileFingerprint: "pnpm-lock-v2",
    });
    expect(environmentRead?.metadata.ciToolchainTriage).toMatchObject({
      environmentFingerprint: "env:node-24.3.0:pnpm-10.12.1",
      hostSpecificPaths: "omitted",
      toolVersionFingerprint: "mise-node-24.3.0-pnpm-10.12.1",
    });
    expect(events).toContain("checkContract");
    expect(events).toContain("fresh_local_execution");
    expect(events).not.toContain("/Users/");
    expect(events).not.toContain("sk-live");
    expect(fixtureReport).toContain(
      "Next action: rerun `. scripts/env && mise run check` locally because CI evidence is incomplete.",
    );
    expect(fixtureReport).toContain("check/gate contract");
    expect(fixtureReport).not.toContain("/Users/");
    expect(fixtureReport).not.toMatch(/\binfer(?:red)? success\b/i);
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

function writtenFile(writes: Record<string, string>, path: string): string {
  const contents = writes[path];

  if (contents === undefined) {
    throw new Error(`Expected write for ${path}.`);
  }

  return contents;
}

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
