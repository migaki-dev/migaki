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
binary with `node packages/migaki-openai-agents-js/dist/cli.js`.

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

For the deterministic no-provider fixture, run:

```sh
pnpm exec migaki-openai-agents-js repo-agent-benchmark \
  --run-id repo-agent-fixture \
  --store .migaki
```

Add `--format json` to either command for machine-readable output.

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
