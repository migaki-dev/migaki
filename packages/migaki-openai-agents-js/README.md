# migaki-openai-agents-js

First Migaki instrumentation layer for the OpenAI Agents SDK for JavaScript.

```ts
import { LocalMigakiStore, withMigaki } from "migaki-openai-agents-js";

const result = await withMigaki({
  runId: "repo-task-001",
  cache: new LocalMigakiStore(".migaki"),
}).run(agent, input);
```

The MVP records local observability artifacts only:

- `.migaki/runs/<runId>/events.jsonl`
- `.migaki/runs/<runId>/graph.json`
- `.migaki/runs/<runId>/report.md`

Cache keys are recorded for model and tool operations, but they are not replayed
or used to skip work.

## Parallel Benchmark Harness

Use `runParallelMigakiBenchmark` to run equivalent baseline and
Migaki-instrumented agent lanes concurrently:

```ts
import {
  LocalMigakiStore,
  runParallelMigakiBenchmark,
} from "migaki-openai-agents-js";

const result = await runParallelMigakiBenchmark({
  runId: "repo-task-001-comparison",
  store: new LocalMigakiStore(".migaki"),
  createRun(lane) {
    return {
      agent: createRepoAgent(lane),
      input: "Find the relevant files and propose the patch.",
      runConfig: { model: createDeterministicModel(lane) },
    };
  },
});
```

The baseline lane runs with SDK tracing disabled. The Migaki lane writes normal
run artifacts under `<runId>-migaki`, and the comparison report is written under
`<runId>`.

## CLI

Run the same benchmark through the package CLI by pointing it at a module that
exports `createRun(lane)`:

```sh
pnpm exec migaki-openai-agents-js benchmark \
  --module ./benchmarks/repo-agent.ts \
  --run-id repo-task-001-comparison \
  --store .migaki
```

When running from this repository before publishing, build first and replace the
binary with either `mise run benchmark:openai-agents` or
`node packages/migaki-openai-agents-js/dist/cli.js`.

The benchmark module uses the same contract as the library helper:

```js
import { Agent } from "@openai/agents";

export function createRun(lane) {
  return {
    agent: new Agent({
      name: `RepoAgent-${lane}`,
      instructions: "Find relevant files and propose the patch.",
    }),
    input: "Find the relevant files and propose the patch.",
    runConfig: {
      model: "gpt-4.1-mini",
    },
  };
}
```

For the deterministic no-provider repo-agent reuse fixture, run:

```sh
pnpm exec migaki-openai-agents-js repo-agent-benchmark \
  --run-id repo-agent-fixture \
  --store .migaki
```

From this repository, the same fixture can run through mise:

```sh
mise run benchmark:openai-agents repo-agent-benchmark \
  --run-id repo-agent-fixture \
  --store .migaki
```

Add `--format json` to either command for machine-readable output.

The fixture records two hermetic repo-agent trajectories under
`<runId>-a` and `<runId>-b`, then writes a comparison run under `<runId>`.
The comparison report links the local `events.jsonl`, `graph.json`,
`report.md`, `artifacts/comparison.json`, and
`artifacts/reuse-decision.json` files. The comparison identifies exact
reusable model and read-only tool nodes, changed nodes, blocked reuse
candidates, and estimated avoidable tokens, cost, and latency when available.
These estimates are observation metadata only; the fixture does not replay,
cache, skip, call live providers, call registries, use Docker, or contact
private services by default.

For the deterministic no-provider code-review workflow fixture, run:

```sh
mise run benchmark:openai-agents code-review-benchmark \
  --run-id code-review-fixture \
  --store .migaki
```

The code-review fixture records baseline context loading for repository
context, changed files, and style guidance, then compares a Migaki path that
marks style guidance as fixed/cacheable, changed files as non-droppable,
unrelated history as removable, static checks as deterministic, and final
comments as validator-bound. It writes comparison, reuse-decision, metrics, and
report artifacts with comment acceptance, false-positive, validator pass-rate,
context diff, cost delta, latency delta, and warning-list fields. The fixture is
hermetic and deterministic; it does not call live providers or repositories.

## Explicit Non-Goals

- semantic IR
- distributed cache
- vector database
- RAG framework
- model router
- actual cache replay
- graph optimizer
- UI
- Postgres backend
