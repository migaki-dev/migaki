# Repo-Agent Task Ladder v0

This document is the repository-versioned acceptance matrix for the MVP
repo-agent task ladder tracked by the
[v0 Roadmap](https://github.com/migaki-dev/migaki/wiki/v0-Roadmap) and the
[MVP repo-agent task ladder](https://github.com/migaki-dev/migaki/milestone/3)
milestone.

The ladder proves realistic coding-agent work can be observed as redacted
evidence graphs, compared across changed inputs, and converted into conservative
advice. It does not claim actual avoided work. Every fixture reports potential
reuse, blocked reuse, and changed nodes before any later issue enables
controlled replay.

## Acceptance Baseline

Every task-family fixture must declare these metrics before optimization:

- validator quality: required validators, pass/fail status, and quality proxies
  such as review grounding, task completion, or fixture acceptance rate
- changed-input handling: changed file, issue, PR, check, doc, or artifact
  fingerprints that block unsafe reuse
- reuse decision counts: allowed, blocked, and `needs_review` candidate counts,
  plus changed-node counts
- privacy/redaction expectations: default artifacts omit raw prompts, tool
  input, tool output, provider responses, secrets, and local file paths

Potential reuse means a node or context unit may be reusable if validators,
freshness, privacy, dependency, and side-effect evidence allow it. Actual
avoided work remains zero for this MVP gate unless a future controlled-replay
issue explicitly changes the policy.

## Matrix

| Family                                 | Why it is realistic for coding agents                                                                                     | Observable nodes                                                                           | Potential reuse candidates                                                                      | Blocked-reuse reasons                                                                                                 | Validators, metrics, and artifacts                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read-only reconnaissance               | Agents routinely search, read targeted ranges, and summarize where to work before editing.                                | search calls, file-read ranges, summary model calls, final orientation answer              | stable searches, unchanged file ranges, cache-keyed summary calls                               | unknown file freshness, changed source fingerprints, missing source-equivalence proof, privacy limits                 | validates cited source coverage; reports changed-input fingerprints, reuse decision counts, and redacted `comparison.json`, `reuse-decision.json`, `metrics.json`, `report.md` |
| Implementation and debug               | Patch work includes planning edits, applying diffs, running focused tests, diagnosing failures, and retrying.             | patch-plan model calls, file edits, test commands, failure-analysis calls, retry decisions | reusable plan fragments, repeated diagnostics, deterministic test metadata                      | side effects from edits, stale tests, changed failures, missing validator evidence, non-idempotent commands           | validates patch applies and focused tests pass; reports validator quality, blocked mutation replay, changed inputs, and evidence artifacts                                     |
| CI and toolchain triage                | Agents inspect CI logs, reproduce local gates, identify setup drift, and rerun checks.                                    | check-log reads, environment/tool version reads, install/check commands, triage summaries  | stable log classification, unchanged toolchain facts, repeated remediation guidance             | fresh execution required, command side effects, changed lockfiles, host-specific environment, incomplete logs         | validates local reproduction or explicit blocker; reports check status, environment fingerprints, reuse counts, and redacted command evidence                                  |
| Docs and wiki alignment                | Agents compare repository docs, wiki pages, whitepaper notes, and package READMEs for stale or unsupported claims.        | doc reads, wiki reads, claim-comparison model calls, README edits, link checks             | stable source-of-truth summaries, repeated glossary/roadmap context, unchanged docs index reads | stale wiki or issue state, duplicated whitepaper prose, missing provenance, changed public API claims                 | validates links and source provenance; reports stale-claim counts, changed source fingerprints, reuse decisions, and docs artifacts                                            |
| Issue planning and blocker maintenance | Main-loop agents choose PR-sized work, maintain `Blocked by` links, and update issue state.                               | issue reads, label reads, milestone reads, blocker graph summaries, issue comments         | reusable blocker graph shape, known label taxonomy, repeated readiness rubric                   | live issue mutation risk, stale labels, open blockers, duplicate issue uncertainty, missing coordinator lock evidence | validates one unblocked issue is selected or a blocker is named; reports eligible/blocked issue counts, decision counts, and issue-state artifacts                             |
| PR review and merge readiness          | Agents inspect linked issues, changed files, checks, comments, and merge state before requesting changes or merging.      | PR metadata reads, diff reads, review-thread reads, check summaries, review comments       | stable review rubric, unchanged style guidance, deterministic check interpretation              | changed files are non-droppable, unresolved review threads, failing checks, merge conflicts, missing issue linkage    | validates comments are grounded in changed files and checks; reports validator pass rate, false-positive proxy, changed inputs, and review artifacts                           |
| Evidence promotion and handoff         | Agents summarize work, decide whether a local run is safe to preserve, promote redacted artifacts, and hand off blockers. | local run reads, redaction checks, promotion commands, manifest writes, handoff summaries  | stable manifest metadata, reusable report summaries, known promotion policy                     | raw data exposure, local-only path leakage, unverified source fingerprints, stale run selection, missing provenance   | validates promoted artifacts omit prohibited data; reports redaction status, artifact provenance, reuse counts, and `manifest.json`, `graph-summary.json`, `report.md`         |

## Gate Policy

The MVP gate must fail when a required family is missing, when a fixture claims
actual savings from potential reuse, when replay/cache/skip behavior occurs
without an explicit controlled-replay policy, or when a default artifact leaks
prohibited raw data. Advice stays observation-only until a later issue adds
controlled replay with declared validators, freshness checks, dependency
evidence, and privacy policy.
