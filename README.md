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
product design and roadmap context; repository docs hold technical contracts
that ship with code.

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
mise run migaki:advise
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
reviewed again.

Verification:

```sh
mise run migaki:smoke
mise run migaki:runs
mise run migaki:latest
mise run migaki:advise
```

The smoke first verifies a trusted Codex CLI turn and asserts that the real turn
writes a redacted Migaki report, then records a deterministic file-reuse fixture
through the built Codex hook. The latest report should contain a prompt node,
repeated read-like tool call nodes, a turn completion node, an
`Opportunity Summary`, and a `file_reuse` top recommendation. Raw prompt text,
tool input, tool output, and file paths are omitted by default; Migaki stores
stable fingerprints instead.

Codex Desktop uses the same project hook definitions. After trusting the
project hooks in Desktop, normal turns in this repository should emit reports
under `.migaki/runs/`; use `mise run migaki:runs` to scan recent runs and
`mise run migaki:latest` to read the newest report. Use
`mise run migaki:advise` before the next turn to print a short coaching prompt
from the newest graph; repeated file-read evidence tells Codex to reuse prior
context or read only the smallest missing range once.

## Repository Layout

- `docs/` contains repository-versioned technical contract docs for v0.
- `src/` contains root TypeScript exports and shared test helpers for the workspace.
- `packages/mir/` owns mIR schemas, validators, and example plan contracts.
- `packages/runtime/` owns planning, pass execution, evidence, tracing, and replay plumbing.
- `packages/providers/` owns provider capabilities and backend lowering contracts.
- `packages/adapters/` owns application and framework integration surfaces.
- `packages/codex/` owns the Codex lifecycle-hook adapter for observation-only
  execution reports.
- `packages/cli/` owns developer-facing report and replay command surfaces.
- `examples/rag-dedup-cache/` contains the v0 RAG deduplication, cache-layout, and provider-lowering example workspace.
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
