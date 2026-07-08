# @migaki/runtime

Owns deterministic execution planning, optimization pass orchestration, plan diffs, evidence construction, tracing, and replay artifact handling.

The v0 public API exports the optimization pass contract. Passes must declare identity, version, capability metadata, safety expectations, and return an updated plan with diff, evidence, and warnings.

The v0 execution observation contract is `migaki.execution-event.v0`.
`MigakiRuntime` appends each event to a store, replays JSONL into
`migaki.execution-graph.v0`, and writes `graph.json` after every observation.
When an event marks the run complete, it also writes a Markdown
`migaki.execution-report.v0` report. The generic contracts are
`ExecutionEvent`, `ExecutionNode`, `ExecutionGraph`, `Operation`,
`Dependency`, `Artifact`, `Metrics`, and `Metadata`.

The strict native Desktop dogfood acceptance contract is intentionally narrower
than general readiness: `mise run migaki:dogfood` passes only when a fresh
normal Codex Desktop turn in this repository produces a completed organic
`codex-turn` with native prompt, tool, and stop hook coverage. Bridge evidence
from `MIGAKI_BRIDGE_RUN_ID`, `migaki:bridge`, manual attach/manual-exec, smoke
harness, hook probe, or CLI probe runs is diagnostic fallback evidence for
app-surface work; it can make `migaki:ready` pass but never satisfies the strict
dogfood gate.

`evaluateDogfoodRootCause` returns the JSON-friendly root-cause diagnostic used
by `migaki:doctor`, including a stable code, status, summary, next action, and
redacted details. The human doctor report renders the same diagnosis before the
raw hook/config/trust sections so Desktop verification starts from one concrete
fix.

`LocalStore(".migaki")` persists stateless hook invocations under
`.migaki/runs/<runId>/`, rejects unsafe run IDs, and intentionally has no cache
API. Reports are observation-only: they identify repeated fingerprints,
critical paths, failed nodes, possible cache points, possible parallelism, and
available token estimates without replaying or changing execution.
Opportunity reports include deterministic actionability metadata:
`actionable`, `needs_review`, or `blocked`, plus "why actionable" and "blocked
by" text so repeated work can be triaged without implying automatic caching,
replay, or parallelization. Report summaries also include actionability counts
and the top ranked opportunity so the first useful recommendation is visible
before the full opportunity list. When multiple sequence-only parallelism
candidates are observed, the opportunity list aggregates them into one blocked
candidate-review item while the Potential Parallelism section preserves the
individual pairs as raw evidence.
`renderExecutionAdvice` turns the same graph into next-session coaching text.
For repeated redacted file fingerprints, it emits `needs_review` coaching that
asks the next Codex turn to check prior context or read only the smallest missing
range once, without exposing raw paths or commands. File-reuse opportunities
carry explicit evidence for repeated redacted identity, freshness, source
equivalence, and automatic-skip safety. Codex hook read-like file artifacts
record safe freshness signals when stat or content-digest evidence is available
and source-equivalence keys when command shape, range, and output transform are
safely knowable. Automatic skip remains disallowed by default even when both
evidence fields are verified.

The v0 observed trajectory comparison contract is
`migaki.observed-trajectory-comparison.v0`. `compareObservedExecutionGraphs`
compares two `migaki.execution-graph.v0` runs as data only. It never executes,
replays, caches, or skips work. The result classifies exact reusable
`model_call` and `tool_call` nodes, changed nodes, and blocked reuse candidates
with blocker reasons, warning metadata, and estimated avoidable
tokens/cost/latency when the current graph provides those metrics. Candidates
must pass cache-key equality, dependency equality, runtime compatibility,
validator, policy, freshness, status, and side-effect checks. Missing or
unknown evidence fails closed into a blocked candidate instead of being treated
as replay permission. Comparison results carry a `metadata_only`
`privacyPolicy` reference to the shared evidence privacy export matrix.

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

The v0 evidence privacy policy contract is `migaki.evidence-privacy-policy.v0`.
`EVIDENCE_PRIVACY_EXPORT_MATRIX` defines metadata-only, redacted, and full
export behavior for prompts, tool inputs, tool outputs, provider responses, file
paths, customer data, credentials, and local machine paths.

The v0 evidence bundle contract is `migaki.evidence-bundle.v0`. Bundles carry
references to the original and optimized plans, inline plan and context diffs,
pass summaries, warnings, grouped evidence sections, replay metadata, and
explicit records for omitted or redacted data. Serialization is deterministic
for golden fixtures and CI artifacts. Bundles default to `metadata_only`; `full`
exports require explicit code opt-in.

The v0 mock trace artifact contract is `migaki.trace-artifact.v0`. It captures
mock-backed execution steps, fixture responses, timing, usage, validator
outcomes, replay metadata, and evidence bundle links so deterministic runs can
be loaded and replay-checked without live providers.

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

`migaki.runtime.static_routing_policy` reports constrained static routing
decisions for explicitly eligible classification and ranking nodes. It honors
required validators plus allowed and denied provider constraints, emitting
evidence for routed nodes and warnings when routing is skipped.
