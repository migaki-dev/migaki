# Pass Contracts v0

## Contracts

- Pass result contract: `migaki.pass.v0`
- Pass runner report: `migaki.pass-runner.v0`
- Plan diff contract: `migaki.plan-diff.v0`
- Owning package: `@migaki/runtime`
- Source of truth: `packages/runtime/src/pass.ts`,
  `packages/runtime/src/runner.ts`, and `packages/runtime/src/diff.ts`

The living design context is in the
[Optimization Passes wiki page](https://github.com/migaki-dev/migaki/wiki/Optimization-Passes).
This document describes the implemented repository contract.

## Optimization Passes

An `OptimizationPass` must declare:

- `contractVersion`: `migaki.pass.v0`
- `name` and pass `version`
- optional input and output capability metadata
- a safety declaration with level `deterministic`, `lossless`, `lossy`, or
  `experimental`
- an `apply(plan, context)` function

`apply` returns a `PassResult` with:

- `version`: `migaki.pass.v0`
- `pass`: name and version
- `plan`: the resulting `MIRPlan`
- `diff`: inline `MIRPlanDiff` or an external diff reference
- `evidence`: evidence event fragments
- `warnings`: structured warnings with severity, code, message, optional path,
  and optional assumption

Lossy passes must declare validators or acceptance criteria before being used.
The implemented v0 passes are deterministic or report-only.

## Pass Runner

`runOptimizationPasses` executes passes in order with a caller-provided clock,
run id, optional provider capabilities, metadata, disabled pass list, and
failure policy.

The runner returns a `PassRunReport` with `migaki.pass-runner.v0`, the final
plan, pass records, combined evidence, warnings, start and completion times, and
duration. Disabled passes produce disabled records. Failed passes produce error
records and stop or continue according to `failurePolicy`.

## Plan Diffs

`diffMIRPlans` returns an inline diff with `migaki.plan-diff.v0`. Diff entries
cover metadata, constraints, context, nodes, edges, and warnings. Entries name
the artifact kind, change kind, path, optional artifact id, optional field, and
description.

Diff entries use `valueMode: "omitted"`. They identify what changed without
copying prompt, context, provider, warning, or policy values into report
artifacts by default.

## Implemented v0 Passes

- `migaki.context.exact_duplicate_elimination`: removes only exact duplicate
  context blocks that are deduplicable, non-sensitive, and
  provenance-compatible. Unsafe candidates are preserved with warnings and
  evidence.
- `migaki.context.stable_prefix_detection`: reports fixed system, developer,
  and example context that can form a stable prefix. It does not rewrite prompts
  or provider requests.
- `migaki.context.prompt_cache_layout_reporting`: reports provider-aware prompt
  cache opportunities and downgrade warnings without mutating requests.
- `migaki.runtime.static_routing_policy`: reports static routing decisions for
  eligible classification and ranking nodes while respecting provider
  constraints and validators.
- `migaki.runtime.retry_fallback_planning`: reports retry and fallback planning
  boundaries, blocks unsafe side-effecting retries, and filters fallbacks
  through provider constraints.

## Compatibility

Changing required fields of `OptimizationPass`, `PassResult`, `PassRunReport`,
or `MIRPlanDiff` is breaking. So is changing whether a pass mutates a plan,
changing warning severity semantics, or changing diff redaction behavior.

Compatible additions must be optional or additive and must preserve deterministic
ordering. New passes must declare contract version, safety level, evidence, and
warnings. Breaking changes require a new contract version, migration notes, and
tests that show old and new behavior.
