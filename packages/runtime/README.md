# @migaki/runtime

Owns deterministic execution planning, optimization pass orchestration, plan diffs, evidence construction, tracing, and replay artifact handling.

The v0 public API exports the optimization pass contract. Passes must declare identity, version, capability metadata, safety expectations, and return an updated plan with diff, evidence, and warnings.

The v0 plan diff contract is `migaki.plan-diff.v0`. Generated diffs report
metadata, constraint, context, node, edge, and warning changes in deterministic
order. Diff entries identify changed artifacts and fields, but omit before and
after values so sensitive prompt, context, provider, or warning content is not
copied into report artifacts by default.

The v0 evidence event contract is `migaki.evidence-event.v0`. Events cover pass
decisions, warnings, capability assumptions, context changes, estimates,
validator results, routing, retry/fallback decisions, and policy decisions.
Every event carries source, privacy, and redaction metadata so later evidence
bundles can say what was included, omitted, or redacted.

The v0 constraint evaluation contract is `migaki.constraint-evaluation.v0`.
It checks supported cost, latency, quality, provider, replay, audit, retention,
validator, privacy, and redaction constraints deterministically. Required
constraints fail closed when the evaluator lacks the inputs needed to prove they
passed, and each checked policy emits evidence.

The v0 context ledger contract is `migaki.context-ledger.v0`. It provides
deterministic lookup indexes over mIR context blocks by id, role, provenance,
mutability, cache policy, privacy class, retention policy, and content
reference. Ledger diagnostics flag duplicate ids, missing content references,
and unsafe mutability for context roles that must remain fixed.

The first v0 optimization pass is `migaki.context.exact_duplicate_elimination`.
It removes only exact duplicate context blocks that are marked deduplicable,
non-sensitive, and provenance-compatible, then rewrites input references to the
kept context id. Unsafe duplicate candidates are preserved with warnings and
evidence instead of being silently optimized.

`migaki.context.stable_prefix_detection` reports cacheable prefix opportunities
for fixed system, developer, and example context in model input order. It does
not rewrite prompts or lower provider-specific cache breakpoints; provider cache
capabilities are recorded as evidence and unsupported breakpoint behavior is
reported as informational warnings.

The v0 token estimation contract is `migaki.token-estimation.v0`. It exposes
metadata-only context block, context group, plan, and before/after delta
estimates with estimator identity, source, confidence, and limitations. The
default deterministic estimator is fixture-oriented and does not claim
provider-exact tokenization; unknown inputs keep aggregate totals unknown rather
than inventing precision.

The v0 cost estimation contract is `migaki.cost-estimation.v0`. It combines
plan token estimates with explicit node provider/model selections and versioned
provider cost-rate fixtures. Estimates include rate citations, confidence,
limitations, stale-rate warnings, and unknown-cost warnings so constrained plans
fail closed when cost cannot be proven.

`migaki.context.prompt_cache_layout_reporting` reports provider-aware prompt
cache layout opportunities from stable-prefix detection output. It distinguishes
automatic cache behavior from explicit breakpoint placement, estimates cacheable
prefix tokens where metadata is available, and records capability assumptions or
downgrade warnings as evidence without mutating provider requests.

`migaki.runtime.retry_fallback_planning` reports retry boundaries and fallback
choices without executing them. It can represent validator-triggered retries of
the failed model node, blocks unsafe side-effecting tool retries unless
idempotency or approval metadata is present, and filters fallback providers
through allowed/denied provider constraints.
