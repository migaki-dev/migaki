# CLI v0

## Contracts

- Report output contract: `migaki.cli-report.v0`
- Replay output contract: `migaki.cli-replay.v0`
- Task-suite output contract: `migaki.cli-task-suite.v0`
- Owning package: `@migaki/cli`
- Source of truth: `packages/cli/src/index.ts`

The v0 CLI surface is the exported `runCli(argv, io)` entrypoint. A packaged
shell binary is not part of the implemented contract yet.

The CLI supports three command surfaces:

```sh
migaki report --input artifact.json [--format human|json]
migaki replay --input trace.json [--format human|json]
migaki task-suite list [--format human|json]
migaki task-suite run --suite suite-id [--output-dir dir] [--format human|json]
```

## Report

`report` accepts artifacts with these versions:

- `migaki.evidence-bundle.v0`
- `migaki.trace-artifact.v0`
- `migaki.reuse-decision.v0`

The default format is `human`. `--format json` returns stable JSON with
`migaki.cli-report.v0`.

For evidence bundles, the report includes:

- original and optimized plan ids
- plan diff change count
- pass summaries
- warnings
- token and cost estimates
- routing decisions
- validator results
- replay mode and handles
- report warnings for missing evidence sections

For mock trace artifacts, the report includes trace id, plan id, backend,
result status, step count, duration when known, validator results, evidence
bundle reference warnings, and `migaki.cli-report.v0` in JSON mode.

For reuse decision artifacts, the report includes comparison run ids, allowed /
needs-review / blocked counts, per-node decision status, reason codes, and the
observation-only invariant. Human output includes the full decision artifact
rendering; JSON output returns a compact `migaki.cli-report.v0` summary.

Unsupported artifact versions and invalid artifacts exit non-zero with stderr.

## Replay

`replay` accepts `migaki.trace-artifact.v0` mock trace artifacts. It replays the
trace through the deterministic mock backend and emits a report with
`migaki.cli-replay.v0` in JSON mode.

Successful matched replays exit `0`. Mismatches, invalid trace artifacts, and
input errors exit non-zero. Replay output includes backend, plan id, trace id,
replay status, result status, mismatch count and details, output count, and
validator results.

## Task Suite

`task-suite` provides deterministic repo-agent fixture harnesses for the MVP
task ladder. It is hermetic by default: built-in fixtures do not call live
providers, registries, Docker, private services, or mutable external
repositories.

`task-suite list --format json` returns available suite ids, fixture counts, and
missing required repo-agent fixture families. `task-suite run --format json`
returns automation-safe `migaki.cli-task-suite.v0` output with coverage status,
missing family warnings, fixture metrics, privacy mode, redaction mode, and
local artifact links. Fixture metrics report potential avoided-work estimates
separately from realized behavior; `actualSkippedActions` remains `0` unless a
future controlled-replay policy explicitly allows skipping work.

The built-in suites are:

- `repo-agent-empty`: no fixtures; exits non-zero when run and reports every
  missing required family.
- `repo-agent-readonly`: one read-only reconnaissance fixture; exits non-zero
  because the full MVP ladder is still incomplete.
- `repo-agent-implementation-debug`: one implementation-and-debug fixture;
  exits non-zero because the full MVP ladder is still incomplete.
- `repo-agent-ci-toolchain-triage`: one CI and toolchain triage fixture; exits
  non-zero because the full MVP ladder is still incomplete.
- `repo-agent-docs-wiki-alignment`: one docs and wiki alignment fixture; exits
  non-zero because the full MVP ladder is still incomplete.
- `repo-agent-issue-planning-blockers`: one issue planning and blocker
  maintenance fixture; exits non-zero because the full MVP ladder is still
  incomplete.
- `repo-agent-mvp`: all MVP repo-agent fixture families; exits zero when all
  deterministic fixture artifacts are written.

Each fixture writes these local artifacts under
`<output-dir>/<suite-id>/<family-id>/`:

- `events.jsonl`
- `graph.json`
- `report.md`
- `comparison.json`
- `reuse-decision.json`

Reports explicitly preserve the observation-only invariant: the harness records
and compares deterministic fixture trajectories, but it never skips model calls,
tool calls, file reads, provider requests, replay, cache lookup, or user-visible
actions.

Implementation-and-debug fixture artifacts identify reusable read/search
context nodes, blocked apply-patch and focused-test side effects, retry
boundaries, validator requirements, changed debug inputs, and estimated
avoidable tokens, cost, and latency without replaying or mutating work.

CI and toolchain triage fixture artifacts distinguish reusable log and check
status parsing from fresh local command execution, record the defended
`code-quality` gate contract, block reuse when command, lockfile, tool version,
or environment fingerprints drift, and report a local rerun next action when CI
evidence is insufficient.

Docs and wiki alignment fixture artifacts compare repository contract docs,
README claims, wiki roadmap excerpts, and whitepaper-note provenance. The
report names docs that should change, docs that should not receive
whitepaper-only claims, freshness/source-identity requirements for reusable
excerpts, and `needs_review` handling for transformed summaries.

## Argument Contract

`report` and `replay` require `--input`. `task-suite run` requires `--suite`.
`--format` must be `human` or `json`. Unknown arguments, missing values, invalid
JSON, unsupported versions, unreadable inputs, and unknown suite ids are command
errors.

The `io` argument can inject a fake filesystem in tests. Production callers may
use the default filesystem implementation.

## Compatibility

Changing command names, required arguments, accepted format values, exit-code
meaning, JSON output fields, or supported artifact versions is breaking.
Adding new optional JSON fields is compatible when older consumers can ignore
them. Human output is intended for inspection, but material changes still need
tests because it is part of the developer-facing surface.

Breaking CLI changes require a new output contract version, migration notes,
and tests for old and new behavior.
