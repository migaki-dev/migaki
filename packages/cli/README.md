# @migaki/cli

Owns developer-facing inspection surfaces, including report and replay command entrypoints for evidence bundles and deterministic runs.

## Report Command

`runCli(["report", "--input", "artifact.json"])` renders a human-readable
report for a v0 evidence bundle or mock trace artifact. Use
`--format json` for deterministic CI artifacts.
