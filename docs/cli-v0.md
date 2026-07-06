# CLI v0

## Contracts

- Report output contract: `migaki.cli-report.v0`
- Replay output contract: `migaki.cli-replay.v0`
- Owning package: `@migaki/cli`
- Source of truth: `packages/cli/src/index.ts`

The v0 CLI surface is the exported `runCli(argv, io)` entrypoint. A packaged
shell binary is not part of the implemented contract yet.

The CLI supports two command surfaces:

```sh
migaki report --input artifact.json [--format human|json]
migaki replay --input trace.json [--format human|json]
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

## Argument Contract

Both commands require `--input`. `--format` must be `human` or `json`. Unknown
arguments, missing values, invalid JSON, unsupported versions, and unreadable
inputs are command errors.

The `io` argument can inject a fake filesystem in tests. Production callers may
use the default `readFile` implementation.

## Compatibility

Changing command names, required arguments, accepted format values, exit-code
meaning, JSON output fields, or supported artifact versions is breaking.
Adding new optional JSON fields is compatible when older consumers can ignore
them. Human output is intended for inspection, but material changes still need
tests because it is part of the developer-facing surface.

Breaking CLI changes require a new output contract version, migration notes,
and tests for old and new behavior.
