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
