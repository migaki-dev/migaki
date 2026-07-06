# Migaki

Execution optimizer for AI agent workflows: portable execution graphs,
provider-aware lowering, and evidence traces.

Migaki is a TypeScript workspace for representing agent work as explicit
execution plans, optimizing those plans, lowering them to provider or gateway
capabilities, and emitting evidence about what changed and why.

## Project Scope

Migaki is intended to sit between an agent application and the execution
backends it uses. Applications and agent frameworks decide strategy; Migaki
focuses on plan representation, deterministic optimization, provider-aware
execution, and auditable traces.

Core areas:

- portable execution graph and mIR schema design
- deterministic optimization passes with plan diffs and warnings
- provider, gateway, and runtime adapters behind versioned contracts
- evidence bundles for decisions, assumptions, costs, and lossy behavior
- container-backed e2e tests and evals for adapter/runtime behavior

The implemented v0 contract docs live under `docs/`. The wiki holds living
product design and roadmap context, including the v0.4 evidence-first loop:
observed trajectories -> reusable evidence graphs -> optimized mIR plans ->
capability-aware execution -> new evidence. Repository docs hold technical
contracts that ship with code.

This repository is still early scaffolding. Public package boundaries, schemas,
and adapters should be treated as pre-release unless a repository contract doc
names the implemented v0 surface.

## Toolchain

Tool versions are managed by [mise](https://mise.jdx.dev/) and pinned in
`mise.toml` plus `mise.lock`.

Current workspace tools:

- Node.js 24.18.0
- pnpm 11.9.0
- TypeScript 6.0.3
- GitHub CLI 2.95.0
- Colima 0.10.3 for Docker-compatible local container workflows

Use `pnpm` only. Do not use `npm`, `yarn`, or `bun` for installs, scripts, or
lockfile updates.

## Bootstrap

For a new machine, run the bootstrap script from the repository root:

```sh
scripts/bootstrap
```

The script is POSIX `sh` and can be launched from common Unix shells, including
`sh`, `bash`, `zsh`, `fish`, and `nushell`. It installs or updates mise through
the native mise installer when needed, optionally offers to configure shell
activation, trusts the local mise config, installs the pinned toolchain,
installs workspace dependencies, and runs the quality gate. The gate builds the
Migaki Codex hook entrypoint used by `.codex/hooks.json`; after bootstrap,
review and trust the project hooks in Codex, for example with `/hooks`.

Useful options:

```sh
scripts/bootstrap --help
scripts/bootstrap --force
```

If mise is already available, the manual flow is:

```sh
mise trust
mise install
mise run setup
mise run check
```

## Common Commands

```sh
mise run setup
mise run check
mise run hooks:install
mise run format:check
mise run lint
mise run typecheck
mise run test
mise run test:e2e
mise run build
mise run migaki:latest
mise run migaki:doctor
mise run migaki:advise
mise run migaki:doctor
mise run migaki:ready
mise run migaki:hook-probe
mise run migaki:bridge-session
eval "$(mise run migaki:bridge-session -- --shell)"
mgb cat README.md
mise run migaki:bridge -- -- cat README.md
mise run migaki:exec -- --run dogfood-read cat README.md
mise run migaki:finish
mise run migaki:promote -- --latest --name <slug>
mise run migaki:runs
mise run migaki:smoke
mise run migaki:feature-smoke
mise run migaki:provider-smoke
mise run benchmark:openai-agents repo-agent-benchmark --run-id repo-agent-fixture
mise run bootstrap:check
mise tasks
```

Use `mise run setup:update-lockfile` after intentional dependency changes.

## Codex Hook Dogfooding

The repository includes `.codex/hooks.json` for recording local Codex lifecycle
events into `.migaki/runs/<runId>/`.

Setup:

```sh
mise run build
codex -C "$PWD"
```

In the interactive Codex CLI, run `/hooks` and trust the Migaki project hooks.
Codex records trust per hook definition, so changed hook commands must be
reviewed again. Trust is path-scoped; each Codex-created worktree must be
trusted separately before normal Desktop or CLI turns in that worktree will
emit Migaki runs.

Verification:

```sh
mise run migaki:doctor
mise run migaki:smoke
mise run migaki:runs
mise run migaki:latest
mise run migaki:advise
mise run migaki:doctor
mise run migaki:ready
mise run migaki:hook-probe
```

`migaki:doctor` checks this exact worktree path, hook trust, the built hook
entrypoint, `.migaki` writability, the latest real run, and whether default
advice is driven by real or fixture evidence. The smoke first verifies a trusted
Codex CLI turn and asserts that the real turn writes a redacted Migaki report,
then records a deterministic file-reuse fixture through the built Codex hook.
The fixture report should contain a prompt node, repeated read-like tool call
nodes, a turn completion node, an `Opportunity Summary`, and a `file_reuse` top
recommendation. `migaki:smoke` marks its real CLI report as smoke-harness
evidence, so default `runs`, `latest`, `advise`, `doctor`, and `dogfood`
selection does not mistake it for organic Codex work. Historical smoke harness
turns are also recognized by their redacted prompt fingerprint. Pass
`--include-smoke` to inspect fixtures explicitly. Raw prompt text, tool input,
tool output, and file paths are omitted by default; Migaki stores stable
fingerprints instead.

Codex Desktop uses the same project hook definitions. After trusting the
project hooks in Desktop, normal turns in this repository should emit reports
under `.migaki/runs/`; use `mise run migaki:runs` to scan recent runs and
`mise run migaki:doctor` to inspect whether the hook entrypoint exists, which
graph advice would use, whether the latest organic turn observed tool calls,
and which native hook events were present in the latest turn's `events.jsonl`. It
also verifies that `.codex/hooks.json` registers prompt, tool, and stop hooks
with the expected Migaki hook command and prints a trust fingerprint for the
current hook definitions. The CLI also checks local Codex trusted-hash records
for the project hook file, so missing `/hooks` trust shows up separately from a
Desktop hook-emission problem. The report includes smoke-harness proof, the
newest organic native-complete baseline, graph update timestamps, and ages, so
mixed Desktop/manual evidence can be compared against known-good plumbing
without mistaking a smoke harness for current-session signal. It also explains
when advice selection chose older useful evidence instead of the latest organic
turn, then prints a compact organic-turn verdict summary and matrix so native
coverage regressions show up as a trend instead of a single latest-run verdict.
When the hook config is valid but the newest organic turn is stale or not
native-complete, the doctor prints a Desktop verification checklist: review hook
trust in `/hooks`, confirm the hook probe, run one fresh normal Desktop turn
with the printed fresh-turn command, and rerun the strict gate.
Use `mise run migaki:doctor -- --strict --max-real-age-minutes 15` when you
want a hard preflight: it prints the same report, then exits nonzero unless the
latest organic turn has native prompt, tool, and stop coverage within the
requested age window.
Use `mise run migaki:dogfood` as the one-command Codex dogfooding gate: it runs
the native hook probe first, then runs the strict doctor with a 15-minute
organic-turn freshness window. A passing hook probe or smoke harness is not
enough; the gate only passes when the newest organic Codex turn is also
native-complete and fresh. When the gate fails on stale organic-turn evidence,
the report prints an exact fresh-turn command to ask Codex Desktop to run.
Use `mise run migaki:ready` as the practical working-mode gate. It still reports
strict dogfood failures, but exits successfully when either fresh organic native
dogfooding is available or the default bridge run has fresh active command
evidence. This is the gate to use during app-surface work while native project
hooks are not emitted.
Use `mise run migaki:hook-probe` when you need a fast deterministic check that
the built hook entrypoint can still record native prompt, tool, and stop events.
The probe uses a `migaki-smoke` run id, so default advice, latest-report, and
doctor selection ignore it instead of confusing probe evidence with organic
dogfooding turns. `migaki:doctor` still reports the latest probe separately so
you can distinguish a healthy built hook entrypoint from missing native events
in organic Desktop turns.
Use `mise run migaki:latest` to read the newest useful non-smoke, non-harness,
non-session report, or `mise run migaki:latest -- --chronological` to inspect
the newest eligible report even when it has no signal. Use
`mise run migaki:advise` before the next turn to print a short coaching prompt
from the newest useful completed, non-session graph, falling back to the newest
eligible graph when no run has a useful signal. If hook probe or smoke-harness
evidence is native-complete but the latest organic turn is missing, stale, or
mixed/manual, `migaki:advise` starts with `Dogfood Status: bridge-required`.
After fresh bridge evidence exists, it reports `bridge-active` and shows the
bridge proof line.

For normal interactive dogfooding while Desktop hooks are not emitting organic
tool events, start with the session-scoped shell setup:

```sh
eval "$(mise run migaki:bridge-session -- --shell)"
mgb cat README.md
mise run migaki:ready
```

That setup exports `MIGAKI_BRIDGE_RUN_ID` and defines `mgb` as a session-local
shortcut for routed shell work. When bridge mode is needed, `migaki:advise`,
`migaki:ready`, and `migaki:doctor` print the same shell setup pattern so the
bridge workflow is discoverable from the failing diagnostic.

For fresh-shell coding agents, or when you want to see the generated run id
before evaluating anything, ask Migaki to print a scoped run id and exact
commands:

```sh
mise run migaki:bridge-session
```

To start a scoped bridge and record the first command immediately:

```sh
mise run migaki:bridge-session -- sed -n 1,80p README.md
```

The lower-level bridge command is still available when you intentionally want
the default `codex-app-bridge` run or are scripting one command:

```sh
mise run migaki:bridge -- -- cat README.md
```

You can also pass `--bridge-run <run-id>` to `migaki:advise`, `migaki:ready`,
`migaki:doctor`, and `migaki:dogfood`. When
advice selection means choosing older useful evidence over the newest eligible
turn, or when selected evidence includes the manual bridge, `migaki:advise`
prints an `Advice Source` note. Repeated file-read evidence is `needs_review`
coaching: it can remind Codex to reuse prior context or read only the smallest
missing range once, but it is not proof that a future read can be skipped unless
freshness and command-output equivalence are captured. Advice skips
`migaki-smoke` fixture, smoke-harness, session-boundary, and running turn graphs
by default so normal dogfooding follows completed organic local work; use
`mise run migaki:advise -- --include-smoke` only when you intentionally want
fixture or harness advice.

If Desktop hook evidence is too thin, use the explicit manual wrapper while
debugging. Build once, then repeated `migaki:exec`, `migaki:finish`,
`migaki:advise`, and `migaki:doctor` calls reuse the built entrypoints instead
of rebuilding every command:

```sh
mise run build
mise run migaki:bridge -- -- cat README.md
mise run migaki:exec -- --run dogfood-manual cat README.md
mise run migaki:exec -- --run dogfood-manual sed -n 1,40p README.md
mise run migaki:latest -- --path
```

To attach manual command evidence to the latest running Desktop turn instead of
a separate manual run, use:

```sh
mise run migaki:exec -- --attach-latest-running cat README.md
mise run migaki:exec -- --attach-latest-running --finish-attached-run sed -n 1,40p README.md
```

Use `--finish-attached-run` only on the final manual command for that turn. It
marks the attached run complete so `migaki:latest` and `migaki:advise` can use
it even when Desktop did not emit a `Stop` hook.

`--attach-latest-running` fails when no running Codex turn is available instead
of silently creating a separate manual run. Omit it, or pass `--run <run-id>`,
when you intentionally want separate manual command evidence.

If you already attached the last command and forgot that flag, run:

```sh
mise run migaki:finish
```

`migaki:finish` marks the latest running non-smoke Codex turn complete without
running another command. Use `mise run migaki:finish -- --run <run-id>` to
finish a specific run.

`migaki:exec` runs the command normally and records redacted command evidence.
Explicit `--run` and generated manual runs are completed automatically;
attached Codex turns complete only when `--finish-attached-run` is used. Raw
command args, output, file paths, and file contents are omitted by default. For
simple read-like commands (`cat`, `sed`, `nl`, `head`, `tail`, and `wc`), it
records file fingerprints plus local freshness metadata so the normal report
path can surface repeated file reads even when Codex lifecycle hooks did not
emit tool events.

The repository hook commands opt into local-only dogfood context with
`MIGAKI_CODEX_LOCAL_CONTEXT=1`. Local `.migaki` graphs may include repo-relative
paths, simple line-range labels, safe command shapes, and git-blob or stat
version hints so advice can say which already-inspected range to reuse. Regular
reports stay redacted, and promoted artifacts omit raw event streams and graph
metadata by default. Repeated file-read evidence remains `needs_review`
coaching: it can remind Codex to reuse prior context or read only the smallest
missing range once, but it is not permission to skip reads unless freshness and
command-output equivalence are established.

Local run evidence under `.migaki/runs/<runId>/` is working-session state and
stays gitignored. To preserve selected findings as project knowledge, promote a
run into the tracked artifact area:

```sh
mise run migaki:promote -- --latest --name <slug>
```

Use `--run <run-id>` instead of `--latest` when promoting a specific run:

```sh
mise run migaki:promote -- --run <run-id> --name <slug>
```

Promotion writes `docs/migaki-artifacts/<slug>/manifest.json`, `report.md`, and
`graph-summary.json`. It validates the local run's `events.jsonl`,
`graph.json`, and `report.md`, records source fingerprints and provenance, and
omits raw event streams by default. The promoted graph summary includes only
selected redacted graph data; raw prompts, tool input/output, transcript paths,
file paths, and delegated task/result text remain omitted.

## Repository Layout

- `docs/` contains repository-versioned technical contract docs for v0.
- `docs/migaki-artifacts/` contains curated, promoted Migaki run artifacts that
  are safe and useful to preserve as project knowledge.
- `src/` contains root TypeScript exports and shared test helpers for the workspace.
- `packages/mir/` owns mIR schemas, validators, and example plan contracts.
- `packages/runtime/` owns planning, pass execution, evidence, tracing, and replay plumbing.
- `packages/providers/` owns provider capabilities and backend lowering contracts.
- `packages/adapters/` owns application and framework integration surfaces.
- `packages/codex/` owns the Codex lifecycle-hook adapter for observation-only
  execution reports.
- `packages/cli/` owns developer-facing report and replay command surfaces.
- `examples/rag-dedup-cache/` contains the v0 RAG deduplication, cache-layout, and provider-lowering example workspace.
- `examples/structured-output-validation/` contains the v0.4 structured-output validation example with provider fallback evidence.
- `scripts/bootstrap` bootstraps a development machine.
- `CONTRIBUTING.md` defines contribution standards for humans and coding
  agents.
- `.githooks/` contains tracked Git hooks installed by `mise run setup`.
- `mise.toml` defines tool versions and project tasks.
- `pnpm-workspace.yaml` defines the pnpm workspace.
- `.agents/AGENTS.md` is the canonical engineering guidance for AI coding
  agents and human contributors.
- `.codex/hooks.json` dogfoods `@migaki/codex` after `pnpm build`; review and
  trust project hooks in Codex before relying on it.
- `.github/workflows/code-quality.yml` runs the required repository quality
  gate.

## Engineering Bar

Read `AGENTS.md` before making non-trivial changes. The short version:

- use test-driven development for behavior changes
- prefer fakes over mocks and avoid live provider calls in unit tests
- use injected, time-travel-friendly clocks in testable code
- keep TypeScript strict and avoid `any`
- pin tools, actions, and build inputs
- version public schemas, adapters, evidence formats, and CLI contracts
- run the narrowest relevant checks plus `mise run check` before handoff
