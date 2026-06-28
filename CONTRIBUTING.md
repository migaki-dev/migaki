# Contributing

Migaki is infrastructure-grade TypeScript. Contributions should be small,
tested, reproducible, and explicit about the contracts they change.

This guide is written for both humans and coding agents. Treat it as the
working agreement for designing, implementing, testing, and handing off changes.

## Start Here

Before changing code:

1. Read `README.md` for project scope and setup.
2. Read `AGENTS.md` for always-on engineering guidance.
3. Run `scripts/bootstrap` on a new machine, or run the manual setup:

```sh
mise trust
mise install
mise run setup
mise run check
```

`mise run setup` also installs the repository Git hooks by setting
`core.hooksPath` to `.githooks`.

When changing tool versions or tools in `mise.toml`, regenerate and commit
`mise.lock` in the same change. Tool edits without the matching lockfile update
are incomplete.

## Definition of Done

A change is not done until:

- behavior is covered by tests or the absence of tests is explicitly justified
- invariants and edge cases have been exercised before implementation settles
- public contracts are versioned or documented as pre-release
- docs are updated for setup, commands, schemas, public APIs, or behavior
- `mise run check` passes locally
- the branch passes the required GitHub `code-quality` check
- commits are focused, reviewable, and verified-signature compatible

Local hooks run `mise run check` before commit and push. They are guardrails, not
a substitute for CI. Emergency bypass is possible with Git's `--no-verify`, but
the next push or PR must still pass the same checks.

## TDD Idiom

For behavior changes, work in this order:

1. Write the smallest failing test, fixture, or executable example that proves
   the desired behavior or bug.
2. Add invariant tests for the rules that must hold across inputs.
3. Implement the smallest code change that makes the tests pass.
4. Refactor only after the tests are green.
5. Run the narrowest affected checks, then `mise run check`.

Good tests should prove observable behavior, not implementation trivia. Avoid
tests that only assert a function was called or that code executed without
checking the result.

## Invariant Testing

Before implementation, identify the invariants the code must preserve. For
Migaki, invariants are often more important than example cases.

Examples of invariants to test:

- plan transforms preserve semantic equivalence unless a lossy change is
  declared with evidence and acceptance criteria
- optimization passes are deterministic for the same input and capabilities
- plan diffs account for every material change
- warnings are emitted for uncertainty, unsupported capabilities, or lossy
  lowering
- provider and gateway adapters fail closed when a capability is unknown
- serialized artifacts include explicit schema or contract versions
- retry, timeout, cancellation, and evidence boundaries remain stable

Use table tests, property-style generators, fixtures, and round-trip tests where
they make invariants clearer. Exhaustive does not mean huge; it means the
meaningful state space and boundary conditions have been named and exercised.

## Fakes Over Mocks

Prefer fakes over mocks wherever possible.

A fake is a small implementation of a boundary that behaves like the real
thing. A mock is usually an assertion script about calls. Fakes catch contract
mistakes; mocks often only catch implementation changes.

Use fakes for:

- model providers and gateways
- clocks, timers, and schedulers
- filesystems and object stores
- caches and queues
- transports and retrying clients
- container runtimes and local services

Keep fakes deterministic, inspectable, and deliberately limited. If a fake
cannot model a behavior honestly, name that limitation in the test or fixture.

## Time and Clocks

Time must be easy to control in tests.

- Inject clocks instead of calling `Date.now()`, `new Date()`, timers, or sleep
  functions from domain logic.
- Use fake clocks that can move forward instantly.
- Test timeout, retry, backoff, expiry, cancellation, and ordering behavior with
  time travel rather than real waiting.
- Keep wall-clock time at process and adapter boundaries.

If code needs real time, make the boundary explicit and keep it out of core
planning, optimization, schema transform, and evidence generation logic.

## Package Boundaries

Split packages only when the boundary is semantically meaningful.

A package split is justified when it creates a stable contract, isolates a
runtime or dependency surface, separates ownership, or allows independent
versioning. Do not split packages merely to make directories look tidy.

Before adding or moving a package, document:

- what contract the package owns
- who depends on it
- what it must not import
- whether it is public, internal, or experimental
- how semantic versioning applies
- which tests prove the package boundary

Avoid circular package relationships, hidden singleton state, and cross-package
imports that bypass public APIs.

## Versioning and Compatibility

Use strict semantic versioning for anything another package, adapter, workflow,
or user can depend on:

- public TypeScript APIs
- mIR schemas
- provider and gateway adapter contracts
- runtime backend interfaces
- evidence bundle formats
- CLI commands and output
- serialized fixtures and artifacts

Breaking changes require a major version bump or an explicit pre-release
contract note, migration guidance, and tests that show old and new behavior.
Do not silently change serialized formats.

## Commit and Push Hygiene

Each commit should be coherent and independently understandable.

Before committing:

```sh
mise run check
```

Before pushing:

```sh
git status --short
mise run check
```

The installed Git hooks run the same quality gate on pre-commit and pre-push.
For now, `mise run check` covers the repository's available quality tasks. As
formatters, linters, unit tests, e2e tests, and build tasks are added, they must
be included in the check graph so hooks and CI enforce them together.

## Coding Agent Handoff

When acting as a coding agent:

- state the files and behavior you changed
- state which tests or checks you ran
- state any checks you could not run and why
- do not claim missing commands passed
- do not leave generated files, caches, credentials, or unrelated edits behind
- keep PR descriptions focused on behavior, validation, and compatibility risk

If instructions conflict, prefer the most specific user request. Then update
the relevant docs so the next contributor does not inherit the ambiguity.
