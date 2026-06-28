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
