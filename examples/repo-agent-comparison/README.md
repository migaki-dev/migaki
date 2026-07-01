# @migaki/example-repo-agent-comparison

Owns the deterministic v0 two-run repo-agent trajectory comparison benchmark.

The benchmark runs the same mock-backed repo-agent graph twice, emits both run
graphs, compares exact model and tool nodes with deterministic fingerprints, and
produces comparison JSON plus a Markdown report for
`.migaki/comparisons/repo-agent-two-run-exact/`.

Metrics are reported as potentially avoidable work only. This example proves
that Migaki can identify reusable agent trajectory nodes; it does not claim
live-provider latency, cost, or realized replay wins.

Run it with:

```sh
pnpm run benchmark:repo-agent-comparison
```

The live OpenAI benchmark is opt-in and redacts raw prompts/responses from
artifacts:

```sh
OPENAI_API_KEY=... pnpm run benchmark:repo-agent-live
```
