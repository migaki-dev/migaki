# @migaki/example-rag-dedup-cache

Owns the deterministic v0 RAG example workspace for duplicate context elimination, cache-layout reporting, evidence generation, and benchmark fixtures.

The baseline runner exports cited document chunks with an intentional exact
duplicate, executes the naive RAG plan through the deterministic mock backend,
and returns token, cost, latency, validation, evidence, and replay metadata for
later optimized-run comparison.

Run the feature smoke from the repository root:

```sh
mise run migaki:feature-smoke
```

The smoke exercises the baseline and optimized RAG paths, then fails if duplicate
context elimination, stable-prefix detection, prompt-cache layout reporting,
source-grounding retry scope, or benchmark acceptance criteria regress.

Run the provider lowering smoke from the repository root:

```sh
mise run migaki:provider-smoke
```

The provider smoke lowers the optimized synthesis node into Anthropic-style,
OpenAI-style, and LiteLLM-compatible request shapes without live provider calls,
then fails if cache policy handling, context refs, gateway delegation, or
provider warning evidence regress.
