# Migaki Agent Instructions

Migaki is a TypeScript project using pnpm. Treat this repository as infrastructure-grade code: small changes, tight tests, reproducible tools, and no hidden behavior.

## Canonical File

- Edit `.agents/AGENTS.md` as the single source of truth.
- Root-level files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
  `.windsurfrules`, and `.github/copilot-instructions.md` are compatibility
  symlinks for coding harnesses. Do not replace them with divergent copies.

## Operating Posture

- Read `CONTRIBUTING.md` before non-trivial implementation work. It defines the
  shared standards for TDD, invariant testing, fakes, package boundaries,
  commit hygiene, and handoff.
- Read the relevant code and existing docs before changing files.
- Make the smallest coherent change that satisfies the task.
- Prefer boring, explicit designs over clever abstractions.
- Do not introduce new frameworks, runtimes, package managers, or services without a documented reason.
- Keep generated output, caches, credentials, and local machine paths out of Git.
- If the repo lacks a command you need, add the command as part of the change instead of relying on an ad hoc local invocation.

## Bootstrap

- Use `pnpm` only. Do not use `npm`, `yarn`, or `bun` for install, script execution, or lockfile updates.
- Use `mise` for tool versions across modern shells. Keep `mise.toml` authoritative for Node.js, pnpm, and any other required CLI tools.
- When editing tools in `mise.toml`, regenerate and commit `mise.lock` in the
  same change so every supported platform keeps the same pinned toolchain.
- Coding agents run many commands through non-interactive shells. Before
  invoking workspace tools in a shell that has not activated mise, source the
  repo-local helper with `. scripts/env`; it exposes mise shims for the current
  shell without editing contributor startup files.
- Keep bootstrapping simple: a new contributor should be able to run `mise install`, `corepack enable`, `pnpm install --frozen-lockfile`, and then the documented checks.
- Pin tool versions. Avoid floating versions such as `latest`, broad Docker tags, or unbounded GitHub Actions versions.
- Prefer package-manager and toolchain pins with integrity/hash support when the ecosystem provides it. Lockfiles are required and must be committed.

## Required Checks

Before considering work complete, run the narrowest relevant checks and then the full project gate when available.

Expected project gate:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

If a command does not exist yet, either add it as part of repository setup work or explicitly report that it is not yet available. Do not pretend a check passed.

## Test-Driven Development

- Start with a failing test or fixture for behavior changes.
- Use regression tests for every bug fix.
- Keep tests deterministic, isolated, and fast by default.
- Prefer fakes over mocks. A fake should model the behavior of a provider, gateway, clock, filesystem, cache, or transport closely enough to catch contract mistakes.
- Avoid assertion-light tests that only prove code ran. Check observable behavior, error paths, edge cases, and evidence artifacts.
- Do not hit live model providers, gateways, registries, Docker networks, or cloud services in unit tests.
- E2E tests and evals may use containers or local services, but they must be opt-in, documented, reproducible, and safe to run repeatedly.

## TypeScript Standards

- Use strict TypeScript. Do not weaken compiler options to land a change.
- Model domain concepts with explicit types rather than loose records.
- Avoid `any`; use `unknown` plus narrowing when the shape is not known.
- Keep public APIs narrow, documented, and hard to misuse.
- Validate untrusted input at boundaries.
- Make impossible states unrepresentable where reasonable.
- Prefer pure functions for planning, passes, schema transforms, and evidence generation.
- Keep side effects at the edges: provider calls, filesystem access, network access, timers, and process state.

## Architecture Standards

- Preserve Migaki's core boundary: applications and agent frameworks decide strategy; Migaki represents, optimizes, lowers, executes, and emits evidence for execution plans.
- Keep mIR provider-neutral and provider-capability-aware. Do not bake one provider's request shape into core IR.
- Every optimization pass must emit a plan diff, evidence, and warnings for assumptions or lossy behavior.
- Never perform lossy optimization without declared validators, evals, or acceptance criteria.
- Prefer deterministic passes first: exact deduplication, stable prefix detection, token/cost estimation, schema validation, retry boundaries, and explicit routing policy.
- Keep provider, gateway, and runtime adapters behind versioned contracts.

## Versioning and Compatibility

- Use strict semantic versioning for any public package, mIR schema, provider adapter, gateway adapter, backend interface, evidence bundle format, or CLI contract.
- Treat provider and gateway integrations as compatibility surfaces. Version them, test them with contract fixtures, and document capability assumptions.
- Breaking changes require a major version bump, migration notes, and tests that make the old/new behavior explicit.
- Minor versions may add backward-compatible capabilities. Patch versions may fix behavior without changing contracts.
- Do not silently change serialized formats. Include version fields in schemas and artifacts.

## Provider and Gateway Work

- Never put real API keys, customer data, prompts, traces, or provider responses in tests or fixtures.
- Use fakes, recorded redacted fixtures, or local mock transports for provider behavior.
- Capability registries must be versioned and covered by tests.
- Provider-specific behavior belongs in adapters/backends, not in core planning logic.
- If a provider capability is uncertain, fail closed or emit a warning in evidence rather than assuming support.

## Containers, E2E, and Evals

- E2E tests and evals must work with Docker-compatible runtimes: Docker, OrbStack, Colima, Rancher Desktop, and Podman.
- Avoid host-specific assumptions such as hard-coded socket paths, absolute home directories, or Docker Desktop-only behavior.
- Keep container images pinned by digest where practical.
- E2E fixtures must be hermetic: fixed data, deterministic ports or allocated ports, explicit cleanup, and no dependency on a developer's private services.
- Long-running evals should be separate from normal test gates and clearly labeled.

## Style and Formatting

- Formatting is tooling-owned. Do not hand-format against the configured formatter.
- Lint rules are mandatory. Do not suppress a rule unless the suppression is narrow and justified in code.
- Prefer clear names over comments. Add comments only when they explain a non-obvious invariant or tradeoff.
- Keep modules cohesive. Split files when behavior has separate reasons to change.
- Avoid broad reformatting or unrelated refactors in task branches.

## Dependency Policy

- Add dependencies reluctantly.
- Prefer standard library, existing dependencies, and small well-maintained packages.
- New runtime dependencies require a clear reason, license compatibility, active maintenance, and a test proving the integration.
- Keep one version of each tool in the workspace unless there is a documented compatibility reason.
- Do not use floating dependency ranges for tools that affect builds, tests, formatting, code generation, schemas, or releases.

## Git and Review Hygiene

- Keep commits focused and reviewable.
- Use the repository Git hooks installed by `mise run setup`; they run the
  project quality gate before commit and push.
- Do not rewrite user changes or unrelated files.
- Include tests with behavior changes.
- Include docs when changing setup, public APIs, CLI behavior, schemas, or compatibility contracts.
- Before handing off, report exactly which checks ran and which checks could not run.

## Skills

Reusable task-specific instructions belong in `.agents/skills/`. Keep always-on guidance here concise; move long procedures, domain playbooks, and tool-specific workflows into skills so agents can load them only when relevant.
