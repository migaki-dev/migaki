# @migaki/example-rag-dedup-cache

Owns the deterministic v0 RAG example workspace for duplicate context elimination, cache-layout reporting, evidence generation, and benchmark fixtures.

The baseline runner exports cited document chunks with an intentional exact
duplicate, executes the naive RAG plan through the deterministic mock backend,
and returns token, cost, latency, validation, evidence, and replay metadata for
later optimized-run comparison.

The scenario benchmark runner exports a deterministic matrix that varies
duplicate-context ratio, cache eligibility/provider support, validator behavior,
and request-lowering path. It reports acceptance criteria before results,
baseline versus optimized estimates, warnings, passes applied or skipped, retry
scope, and replay/evidence references without claiming live-provider savings or
identical answers.
