# @migaki/cli

Owns developer-facing inspection surfaces, including report and replay command entrypoints for evidence bundles and deterministic runs.

## Report Command

`runCli(["report", "--input", "artifact.json"])` renders a human-readable
report for a v0 evidence bundle or mock trace artifact. Use
`--format json` for deterministic CI artifacts.

## Replay Command

`runCli(["replay", "--input", "trace.json"])` replays a v0 mock trace artifact
through the deterministic mock backend and reports mismatches. Successful
replays exit zero; mismatches and invalid trace artifacts exit non-zero.

## Task Suite Command

`runCli(["task-suite", "list", "--format", "json"])` lists deterministic
repo-agent task suites for automation. `runCli(["task-suite", "run", "--suite",
"repo-agent-mvp", "--output-dir", ".migaki/task-suites", "--format", "json"])`
runs the hermetic fixture harness and writes `events.jsonl`, `graph.json`,
`report.md`, `comparison.json`, and `reuse-decision.json` under the selected
output directory.

Incomplete suites exit non-zero and report missing fixture families explicitly.
Fixture comparison and reuse-decision artifacts use metadata-only privacy mode
and preserve the observation-only invariant. Metrics separate estimated
avoidable work from realized skips; deterministic fixtures do not skip actions.
The `repo-agent-implementation-debug` suite covers failing-then-passing patch
and focused-test work with retry boundaries and blocked side-effect decisions.
The `repo-agent-docs-wiki-alignment` suite covers repository docs, README,
wiki roadmap, and whitepaper-note alignment with provenance, freshness labels,
and conservative change/no-change report decisions.
The `repo-agent-issue-planning-blockers` suite covers issue metadata, blocker
parsing, status-label skips, and adoption-first decisions without live GitHub
mutation.
