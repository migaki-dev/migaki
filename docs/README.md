# Migaki v0 Contract Docs

This directory contains repository-versioned technical contract documentation for
the code that ships in this repository. The wiki remains the living place for
product design, roadmap, and longer-form rationale.

The TypeScript exports are still the executable source of truth. These docs map
those exports into stable contract references for contributors, reviewers, and
downstream integrators.

## Contracts

- [mIR v0](./mir-v0.md) describes `migaki.mir.v0` plans, nodes, context blocks,
  constraints, and validation.
- [Pass Contracts v0](./pass-contracts-v0.md) describes optimization passes,
  the pass runner, plan diffs, and implemented deterministic passes.
- [Provider Capabilities v0](./provider-capabilities-v0.md) describes provider
  capability fixtures, backend lowering contracts, execution results, and
  adapter responsibilities.
- [Evidence Bundles v0](./evidence-bundles-v0.md) describes evidence events,
  evidence bundles, redaction behavior, and mock trace replay artifacts.
- [Gateway and Durable Replay Boundaries v0](./gateway-durable-boundaries-v0.md)
  describes which routing, fallback, budget, retry, cache, observability, and
  replay decisions belong to Migaki versus gateways and durable workflow
  engines.
- [CLI v0](./cli-v0.md) describes the `report` and `replay` command surfaces.
- [Adaptive Policies v0](./adaptive-policies-v0.md) describes
  meta-observations, policy proposals, policy diffs, and accepted policy
  bundles for auditable advice-only adaptation.
- [Repo-Agent Task Ladder v0](./repo-agent-task-ladder-v0.md) defines the MVP
  repo-agent task-family matrix, benchmark acceptance metrics, and
  observation-only reuse policy, including the
  `. scripts/env && mise run migaki:mvp-repo-agent-gate` completion gate.
- [Promoted Migaki Artifacts](./migaki-artifacts/README.md) describes the
  tracked location for curated project-level artifacts promoted from local
  `.migaki/runs` evidence.

## Wiki Context

- [Repository Shape](https://github.com/migaki-dev/migaki/wiki/Repository-Shape)
  explains why technical contracts live in the repository.
- [v0 Roadmap](https://github.com/migaki-dev/migaki/wiki/v0-Roadmap) tracks the
  v0.4 evidence-first product loop: observed trajectories -> reusable evidence
  graphs -> optimized mIR plans -> capability-aware execution -> new evidence.
  The repo-agent ladder matrix and v0 contract docs in this directory remain
  the repository-versioned technical surfaces that implement that direction.
- [mIR](https://github.com/migaki-dev/migaki/wiki/mIR),
  [Optimization Passes](https://github.com/migaki-dev/migaki/wiki/Optimization-Passes),
  [Provider Capabilities](https://github.com/migaki-dev/migaki/wiki/Provider-Capabilities),
  and
  [Execution Evidence Bundles](https://github.com/migaki-dev/migaki/wiki/Execution-Evidence-Bundles)
  provide living design context.

## Compatibility Policy

The workspace packages are currently `0.0.0`, and the public contracts are v0
pre-release contracts. Even before package publication, changes should follow
the repository's semantic-versioning rules:

- Adding optional fields or new enum values is a compatible v0 extension only
  when older consumers can safely ignore them.
- Removing fields, changing required fields, changing validation semantics, or
  changing serialized output meaning is breaking.
- Breaking changes require a new contract version string, migration notes, and
  tests that make old and new behavior explicit.
- Serialized artifacts must include version fields and must not silently change
  shape.
