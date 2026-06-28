import type { MIRPlan } from "@migaki/mir";
import type {
  ProviderCapabilities,
  ProviderCapabilityAssumption,
} from "@migaki/providers";

export const PASS_CONTRACT_VERSION = "migaki.pass.v0";

export type PassContractVersion = typeof PASS_CONTRACT_VERSION;

export interface OptimizationPass {
  readonly contractVersion: PassContractVersion;
  readonly inputCapabilities?: readonly PassCapabilityMetadata[];
  readonly name: string;
  readonly outputCapabilities?: readonly PassCapabilityMetadata[];
  readonly safety: PassSafetyDeclaration;
  readonly version: string;
  apply(plan: MIRPlan, context: PassContext): Promise<PassResult>;
}

export interface PassCapabilityMetadata {
  readonly description?: string;
  readonly name: string;
  readonly required?: boolean;
  readonly source: "custom" | "mir" | "provider" | "runtime";
}

export interface PassSafetyDeclaration {
  readonly level: "deterministic" | "experimental" | "lossless" | "lossy";
  readonly notes?: string;
  readonly requiresValidators?: readonly string[];
}

export interface PassContext {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly previousEvidenceRefs?: readonly string[];
  readonly providerCapabilities?: readonly ProviderCapabilities[];
  readonly runId: string;
  readonly startedAt: string;
}

export interface PassIdentity {
  readonly name: string;
  readonly version: string;
}

export interface PassResult {
  readonly diff: PassDiff;
  readonly evidence: readonly PassEvidenceFragment[];
  readonly pass: PassIdentity;
  readonly plan: MIRPlan;
  readonly version: PassContractVersion;
  readonly warnings: readonly PassWarning[];
}

export type PassDiff = InlinePassDiff | ReferencedPassDiff;

export interface InlinePassDiff {
  readonly changes: readonly PassDiffChange[];
  readonly kind: "inline";
}

export interface ReferencedPassDiff {
  readonly hash?: string;
  readonly kind: "ref";
  readonly mediaType?: string;
  readonly ref: string;
}

export interface PassDiffChange {
  readonly afterRef?: string;
  readonly beforeRef?: string;
  readonly description: string;
  readonly kind:
    | "constraint_changed"
    | "context_added"
    | "context_changed"
    | "context_removed"
    | "edge_added"
    | "edge_removed"
    | "metadata_changed"
    | "node_added"
    | "node_changed"
    | "node_removed";
  readonly path: string;
}

export interface PassEvidenceFragment {
  readonly data?: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly kind: "artifact" | "assumption" | "decision" | "measurement";
  readonly providerAssumptions?: readonly ProviderCapabilityAssumption[];
  readonly refs?: readonly string[];
  readonly summary: string;
}

export interface PassWarning {
  readonly assumption?: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity: "error" | "info" | "warning";
}
