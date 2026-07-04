# Promoted Migaki Artifacts

This directory is the tracked home for curated Migaki run artifacts that are
useful as project knowledge.

Local hook evidence stays in `.migaki/runs/<runId>/` and remains gitignored.
Those local runs may include raw working-session streams such as
`events.jsonl`; they are for short-lived Codex continuity in one checkout, not
for review or long-term repository memory.

Use promotion to graduate a selected run:

```sh
mise run migaki:promote -- --latest --name <slug>
```

Use `--run <run-id>` instead of `--latest` to promote a specific local run.

Each promoted bundle is written to `docs/migaki-artifacts/<slug>/` and includes:

- `manifest.json` with schema version, source run id, promotion timestamp,
  source fingerprints, artifact list, and redaction records
- `report.md` copied from the validated local run report
- `graph-summary.json` with selected redacted graph metadata

Promotion validates that the source run has `events.jsonl`, `graph.json`, and
`report.md`, then fails closed if any required artifact is missing or malformed.
It does not promote raw `events.jsonl` by default. Raw prompts, tool input and
output, transcript paths, file paths, summaries, and delegated task/result text
must stay omitted or represented only by fingerprints and explicit redaction
metadata.
