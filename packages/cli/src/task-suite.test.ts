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
          description: "One docs and wiki alignment repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-docs-wiki-alignment",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "issue-planning-and-blocker-maintenance",
            "pr-review-and-merge-readiness",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description:
            "One issue planning and blocker maintenance repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-issue-planning-blockers",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "pr-review-and-merge-readiness",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description: "One PR review and merge-readiness repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-pr-review-merge-readiness",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "issue-planning-and-blocker-maintenance",
            "evidence-promotion-and-handoff",
          ],
        },
        {
          description: "One evidence promotion and handoff repo-agent fixture.",
          fixtureCount: 1,
          id: "repo-agent-evidence-promotion-handoff",
          missingRequiredFamilies: [
            "read-only-reconnaissance",
            "implementation-and-debug",
            "ci-and-toolchain-triage",
            "docs-and-wiki-alignment",
            "issue-planning-and-blocker-maintenance",
            "pr-review-and-merge-readiness",
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

  it("writes docs/wiki alignment artifacts with provenance and conservative report decisions", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-docs-wiki-alignment",
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
        "out/repo-agent-docs-wiki-alignment/docs-and-wiki-alignment/graph.json",
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
          readonly docsWikiAlignment?: Readonly<Record<string, unknown>>;
          readonly reuse?: {
            readonly validatorsRequired?: readonly string[];
          };
        };
      }[];
    };
    const events = writtenFile(
      io.writes,
      "out/repo-agent-docs-wiki-alignment/docs-and-wiki-alignment/events.jsonl",
    );
    const fixtureReport = writtenFile(
      io.writes,
      "out/repo-agent-docs-wiki-alignment/docs-and-wiki-alignment/report.md",
    );
    const repoContractRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-repo-contract-claim"),
    );
    const wikiRoadmapRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-wiki-roadmap-claim"),
    );
    const whitepaperRead = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-whitepaper-only-claim"),
    );
    const summary = graph.nodes.find((node) =>
      node.id.endsWith("model-claim-alignment-summary"),
    );

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "docs-and-wiki-alignment",
      metrics: {
        actualSkippedActions: 0,
        allowed: 3,
        blocked: 1,
        changedNodes: 1,
        needsReview: 1,
      },
      reuseDecision: {
        summary: {
          allowed: 3,
          blocked: 1,
          needsReview: 1,
          totalCandidates: 5,
        },
      },
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual([
      expect.objectContaining({
        nodeId: "docs-and-wiki-alignment-tool-read-stale-readme-claim",
        reason: "cache_key_changed",
      }),
    ]);
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual([
      expect.objectContaining({
        nodeId: "docs-and-wiki-alignment-tool-read-stale-wiki-claim",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "freshness_unknown" }),
        ]),
      }),
    ]);
    expect(repoContractRead?.metadata.docsWikiAlignment).toMatchObject({
      claimStatus: "aligned",
      destination: "docs/README.md",
      sourceKind: "repo_contract_doc",
    });
    expect(repoContractRead?.artifacts[0]?.metadata?.codex).toMatchObject({
      sourceIdentity: "repo:docs/README.md",
      sourceLabel: "Repository docs README excerpt",
    });
    expect(wikiRoadmapRead?.metadata.docsWikiAlignment).toMatchObject({
      claimStatus: "aligned",
      sourceKind: "wiki_roadmap",
    });
    expect(whitepaperRead?.metadata.docsWikiAlignment).toMatchObject({
      claimStatus: "whitepaper_only",
      decision: "do_not_copy_to_repo_contract_docs",
      sourceKind: "whitepaper_note",
    });
    expect(whitepaperRead?.artifacts[0]?.metadata?.codex).toMatchObject({
      sourceIdentity: "external:whitepaper:v0.4",
      sourceLabel: "Whitepaper v0.4 notes excerpt",
    });
    expect(summary?.metadata.reuse?.validatorsRequired).toEqual([
      "claim-source-provenance",
      "no-whitepaper-prose-copy",
      "docs-change-plan-grounding",
    ]);
    expect(events).toContain("docsWikiAlignment");
    expect(events).toContain("sourceKind");
    expect(events).not.toContain("/Users/");
    expect(fixtureReport).toContain(
      "- Change docs/README.md: refresh stale README claim against repository contract docs.",
    );
    expect(fixtureReport).toContain(
      "- Do not change docs/evidence-bundles-v0.md: keep long-term whitepaper-only claims in wiki/whitepaper sources.",
    );
    expect(fixtureReport).toContain(
      "- Reuse source excerpts only when freshness is verified and source identity matches.",
    );
    expect(fixtureReport).toContain(
      "- Transformed alignment summaries remain needs_review until validators pass and a future replay policy exists.",
    );
    expect(fixtureReport).not.toContain("/Users/");
    expect(fixtureReport).not.toContain("whitepaper copied prose");
  });

  it("writes issue planning artifacts with blocker parsing and adoption-first decisions", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-issue-planning-blockers",
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
        "out/repo-agent-issue-planning-blockers/issue-planning-and-blocker-maintenance/graph.json",
      ),
    ) as {
      readonly nodes: readonly {
        readonly id: string;
        readonly metadata: {
          readonly issuePlanning?: Readonly<Record<string, unknown>>;
          readonly reuse?: {
            readonly validatorsRequired?: readonly string[];
          };
        };
      }[];
    };
    const events = writtenFile(
      io.writes,
      "out/repo-agent-issue-planning-blockers/issue-planning-and-blocker-maintenance/events.jsonl",
    );
    const fixtureReport = writtenFile(
      io.writes,
      "out/repo-agent-issue-planning-blockers/issue-planning-and-blocker-maintenance/report.md",
    );
    const blockerSummary = graph.nodes.find((node) =>
      node.id.endsWith("model-blocker-summary"),
    );
    const statusSkips = graph.nodes.find((node) =>
      node.id.endsWith("tool-status-label-scan"),
    );
    const adoptionGate = graph.nodes.find((node) =>
      node.id.endsWith("tool-adoption-gate"),
    );
    const issueBody = graph.nodes.find((node) =>
      node.id.endsWith("model-issue-body-draft"),
    );

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "issue-planning-and-blocker-maintenance",
      metrics: {
        actualSkippedActions: 0,
        allowed: 2,
        blocked: 1,
        changedNodes: 2,
        needsReview: 1,
      },
      reuseDecision: {
        summary: {
          allowed: 2,
          blocked: 1,
          needsReview: 1,
          totalCandidates: 4,
        },
      },
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId:
            "issue-planning-and-blocker-maintenance-tool-issue-metadata-snapshot",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId:
            "issue-planning-and-blocker-maintenance-model-blocker-summary",
          reason: "cache_key_changed",
        }),
      ]),
    );
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual([
      expect.objectContaining({
        nodeId: "issue-planning-and-blocker-maintenance-tool-adoption-gate",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "side_effect_policy_missing" }),
        ]),
        sideEffectClass: "approval_required",
      }),
    ]);
    expect(blockerSummary?.metadata.issuePlanning).toMatchObject({
      afterBlockerClosureEligibleIssues: ["#156"],
      blockerReferences: [{ blocker: "#155", issue: "#156" }],
      beforeBlockerClosureEligibleIssues: ["#154"],
      skippedOpenBlockers: ["#157"],
    });
    expect(statusSkips?.metadata.issuePlanning).toMatchObject({
      skippedStatusLabels: [
        "status:blocked",
        "status:claimed",
        "status:in-review",
      ],
    });
    expect(adoptionGate?.metadata.issuePlanning).toMatchObject({
      activeClaimIssue: "#158",
      adoptionDecision: "adopt_existing_work_before_new_issue",
      openPrIssue: "#159",
    });
    expect(issueBody?.metadata.issuePlanning).toMatchObject({
      bodyFields: [
        "project_purpose",
        "acceptance_criteria",
        "labels",
        "validation",
        "blocked_by",
      ],
      blockedByLines: ["Blocked by: #156"],
      labels: ["status:ready", "priority:p0", "stage:v0"],
    });
    expect(issueBody?.metadata.reuse?.validatorsRequired).toEqual([
      "blocker-graph-consistency",
      "issue-body-contract",
      "adoption-before-new-work",
    ]);
    expect(events).toContain("issuePlanning");
    expect(events).toContain("status:blocked");
    expect(events).not.toContain("/Users/");
    expect(fixtureReport).toContain(
      "- Before #155 closes: exactly one next eligible issue is #154.",
    );
    expect(fixtureReport).toContain(
      "- After #155 closes: exactly one next eligible issue is #156.",
    );
    expect(fixtureReport).toContain(
      "- Skip issues labeled status:blocked, status:claimed, or status:in-review.",
    );
    expect(fixtureReport).toContain(
      "- Adopt existing PR #159 or active claim #158 before creating new work.",
    );
    expect(fixtureReport).toContain("Blocked by: #156");
    expect(fixtureReport).not.toContain("/Users/");
  });

  it("writes PR review and merge-readiness artifacts with grounded review decisions", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-pr-review-merge-readiness",
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
        "out/repo-agent-pr-review-merge-readiness/pr-review-and-merge-readiness/graph.json",
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
          readonly prReview?: Readonly<Record<string, unknown>>;
          readonly reuse?: {
            readonly sideEffectClass?: string;
            readonly validatorsRequired?: readonly string[];
          };
        };
      }[];
    };
    const events = writtenFile(
      io.writes,
      "out/repo-agent-pr-review-merge-readiness/pr-review-and-merge-readiness/events.jsonl",
    );
    const fixtureReport = writtenFile(
      io.writes,
      "out/repo-agent-pr-review-merge-readiness/pr-review-and-merge-readiness/report.md",
    );
    const changedFiles = graph.nodes.find((node) =>
      node.id.endsWith("tool-read-changed-files"),
    );
    const finalComments = graph.nodes.find((node) =>
      node.id.endsWith("model-final-review-comments"),
    );
    const requestedChangeDecision = graph.nodes.find((node) =>
      node.id.endsWith("model-requested-change-decision"),
    );
    const reviewThreads = graph.nodes.find((node) =>
      node.id.endsWith("tool-review-thread-state"),
    );

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "pr-review-and-merge-readiness",
      metrics: {
        actualSkippedActions: 0,
        allowed: 3,
        blocked: 2,
        changedNodes: 4,
        needsReview: 2,
      },
      reuseDecision: {
        summary: {
          allowed: 3,
          blocked: 2,
          needsReview: 2,
          totalCandidates: 7,
        },
      },
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-tool-read-changed-files",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-model-review-findings",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-tool-check-summary",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-tool-merge-base-state",
          reason: "cache_key_changed",
        }),
      ]),
    );
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-tool-review-thread-state",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "freshness_unknown" }),
          ]),
          sideEffectClass: "read_only",
        }),
        expect.objectContaining({
          nodeId: "pr-review-and-merge-readiness-model-final-review-comments",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "validator_missing" }),
          ]),
        }),
      ]),
    );
    expect(changedFiles?.artifacts[0]?.metadata?.codex).toMatchObject({
      droppable: false,
      fileContentFingerprint: "changed-files-content-v2",
    });
    expect(finalComments?.metadata.reuse?.validatorsRequired).toEqual([
      "inline-comment-grounding",
      "changed-file-grounding",
      "check-evidence-grounding",
    ]);
    expect(requestedChangeDecision?.metadata.prReview).toMatchObject({
      decision: "request_changes",
      mergeAction: "none",
    });
    expect(reviewThreads?.metadata.prReview).toMatchObject({
      blockedBy: "unresolved_review_threads",
      scenario: "blocked_unresolved_threads",
    });
    expect(events).toContain("prReview");
    expect(events).toContain("missing_tests");
    expect(events).toContain("stale_base");
    expect(events).not.toContain("/Users/");
    expect(fixtureReport).toContain(
      "- Changed-file content: non-droppable; fingerprint drift blocks reuse.",
    );
    expect(fixtureReport).toContain(
      "- Stable review context: repository policy, style guide, and review rubric are reusable only with verified freshness.",
    );
    expect(fixtureReport).toContain(
      "- Blocked examples: missing tests, stale base, and unresolved review threads require fresh review evidence.",
    );
    expect(fixtureReport).toContain(
      "- Review advice is separated from merge action; fixture records no auto-merge or live SCM mutation.",
    );
    expect(events).not.toContain("non_idempotent_mutation");
    expect(events).not.toContain("idempotent_mutation");
    expect(fixtureReport).not.toContain("/Users/");
  });

  it("writes evidence promotion and handoff artifacts with redaction records", async () => {
    const io = fakeIo();
    const result = await runCli(
      [
        "task-suite",
        "run",
        "--suite",
        "repo-agent-evidence-promotion-handoff",
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
        "out/repo-agent-evidence-promotion-handoff/evidence-promotion-and-handoff/graph.json",
      ),
    ) as {
      readonly nodes: readonly {
        readonly artifacts: readonly {
          readonly kind: string;
          readonly metadata?: {
            readonly redaction?: Readonly<Record<string, unknown>> | string;
          };
        }[];
        readonly id: string;
        readonly metadata: {
          readonly evidencePromotion?: Readonly<Record<string, unknown>>;
          readonly handoff?: Readonly<Record<string, unknown>>;
          readonly reuse?: {
            readonly sideEffectClass?: string;
            readonly validatorsRequired?: readonly string[];
          };
        };
      }[];
    };
    const events = writtenFile(
      io.writes,
      "out/repo-agent-evidence-promotion-handoff/evidence-promotion-and-handoff/events.jsonl",
    );
    const fixtureReport = writtenFile(
      io.writes,
      "out/repo-agent-evidence-promotion-handoff/evidence-promotion-and-handoff/report.md",
    );
    const manifest = graph.nodes.find((node) =>
      node.id.endsWith("tool-promote-manifest"),
    );
    const graphSummary = graph.nodes.find((node) =>
      node.id.endsWith("tool-graph-summary"),
    );
    const advice = graph.nodes.find((node) =>
      node.id.endsWith("model-reuse-advice"),
    );
    const handoff = graph.nodes.find((node) =>
      node.id.endsWith("model-handoff-summary"),
    );
    const rawRun = graph.nodes.find((node) =>
      node.id.endsWith("tool-raw-run-inspection"),
    );

    expect(result.exitCode).toBe(1);
    expect(report.success).toBe(false);
    expect(report.fixtures[0]).toMatchObject({
      familyId: "evidence-promotion-and-handoff",
      metrics: {
        actualSkippedActions: 0,
        allowed: 3,
        blocked: 1,
        changedNodes: 2,
        needsReview: 2,
      },
      reuseDecision: {
        summary: {
          allowed: 3,
          blocked: 1,
          needsReview: 2,
          totalCandidates: 6,
        },
      },
    });
    expect(report.fixtures[0].comparison.changedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "evidence-promotion-and-handoff-tool-raw-run-inspection",
          reason: "cache_key_changed",
        }),
        expect.objectContaining({
          nodeId: "evidence-promotion-and-handoff-model-handoff-summary",
          reason: "cache_key_changed",
        }),
      ]),
    );
    expect(report.fixtures[0].comparison.blockedCandidates).toEqual([
      expect.objectContaining({
        nodeId: "evidence-promotion-and-handoff-tool-promote-command",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "side_effect_policy_missing" }),
        ]),
        sideEffectClass: "approval_required",
      }),
    ]);
    expect(manifest?.artifacts[0]).toMatchObject({
      kind: "manifest",
      metadata: {
        redaction: {
          mode: "omitted",
          reason:
            "Raw prompts, tool payloads, provider responses, credentials, and local paths are omitted.",
        },
      },
    });
    expect(graphSummary?.metadata.evidencePromotion).toMatchObject({
      redactionStatus: "passed",
      stateBoundary: "promoted_project_knowledge",
    });
    expect(advice?.metadata.reuse?.validatorsRequired).toEqual([
      "redaction-policy-check",
      "source-fingerprint-check",
      "handoff-completeness-check",
    ]);
    expect(handoff?.metadata.handoff).toMatchObject({
      checksBlocked: ["github-code-quality-pending-pr"],
      checksRun: ["focused-task-suite-test", "mise-run-check"],
      completedWork: ["manifest-metadata", "graph-summary", "reuse-advice"],
      nextEligibleIssue: "#159 after #158 merges",
      remainingBlockers: ["#159 blocked by #158"],
    });
    expect(rawRun?.metadata.evidencePromotion).toMatchObject({
      stateBoundary: "short_lived_local_session_state",
    });
    expect(events).toContain("evidencePromotion");
    expect(events).toContain("handoff");
    expect(events).not.toContain("raw customer prompt");
    expect(events).not.toContain("tool-input-secret");
    expect(events).not.toContain("tool-output-secret");
    expect(events).not.toContain("provider-response-secret");
    expect(events).not.toContain("sk-live-promotion-fixture");
    expect(events).not.toContain("/Users/");
    expect(fixtureReport).toContain(
      "- Promoted artifacts are preserved project knowledge; raw `.migaki/runs` evidence remains short-lived local session state.",
    );
    expect(fixtureReport).toContain(
      "- Handoff output names completed work, checks run, checks blocked, remaining blockers, and next eligible issue.",
    );
    expect(fixtureReport).toContain(
      "- Reuse advice inherits metadata_only privacy and records explicit omissions for prompts, tool payloads, provider responses, credentials, and local paths.",
    );
    expect(fixtureReport).toContain(
      "- Next eligible issue: #159 after #158 merges.",
    );
    expect(fixtureReport).not.toContain("/Users/");
    expect(fixtureReport).not.toContain("sk-live-promotion-fixture");
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
