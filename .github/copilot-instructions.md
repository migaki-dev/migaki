# GitHub Copilot Instructions

Follow `AGENTS.md` as the canonical repository guidance. This file exists so
GitHub Copilot and Copilot coding agent can find the same engineering contract
from the `.github` directory.

## Repository Context

Migaki is a TypeScript project using pnpm and mise. It is an execution optimizer
for AI agent workflows: portable execution graphs, provider-aware lowering, and
evidence traces.

Keep the core boundary clear:

- agent applications decide strategy
- Migaki represents, optimizes, lowers, executes, and emits evidence for plans
- provider, gateway, and runtime behavior belongs behind versioned adapters

## Working Rules

- Use `mise` tasks for setup and verification.
- Use `pnpm` only. Do not use `npm`, `yarn`, or `bun`.
- Keep `mise.toml`, `mise.lock`, `pnpm-lock.yaml`, and workflow action pins
  authoritative and reproducible.
- Make small, reviewable changes that match existing repository style.
- Do not introduce frameworks, services, or runtime dependencies without a
  documented reason and tests.
- Keep credentials, real prompts, provider responses, traces, customer data,
  generated output, and machine-local paths out of Git.

## Testing and Quality

- Start behavior changes with a failing test or fixture.
- Prefer fakes over mocks for providers, gateways, filesystems, clocks,
  transports, caches, and container runtimes.
- Do not hit live model providers, registries, Docker networks, or cloud
  services in unit tests.
- Keep TypeScript strict. Avoid `any`; use `unknown` plus narrowing when needed.
- Validate untrusted input at boundaries.
- Version public schemas, adapter contracts, evidence bundle formats, CLI
  behavior, and serialized artifacts with strict semantic versioning.

Before handing off, run the relevant narrow checks and then:

```sh
mise run check
```

If a command is missing or cannot run, say exactly what happened instead of
claiming it passed.
