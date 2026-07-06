# @migaki/example-structured-output-validation

Owns the deterministic structured-output validation example for Migaki v0.4.

The baseline fixture asks a mock model for JSON, parses the output, and retries
the whole prompt after an invalid first result. The Migaki fixture represents
the invoice schema requirement in mIR, records provider-native structured output
when the provider capability fixture allows it, downgrades to post-validation
when it does not, and records retry evidence for only the invalid extraction
node.

The example is fully hermetic. It uses provider capability fixtures and local
schema checks only; it does not call live providers, gateways, registries, or
cloud services.
