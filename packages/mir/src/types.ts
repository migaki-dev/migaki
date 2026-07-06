export const MIR_V0_VERSION = "migaki.mir.v0";

export type MIRVersion = typeof MIR_V0_VERSION;

export interface MIRPlan {
  readonly constraints: MIRConstraints;
  readonly context: readonly MIRContextBlock[];
  readonly edges: readonly MIREdge[];
  readonly id: string;
  readonly metadata: MIRPlanMetadata;
  readonly nodes: readonly MIRNode[];
  readonly version: MIRVersion;
}

export interface MIRPlanMetadata {
  readonly application?: string;
  readonly createdAt: string;
  readonly description?: string;
  readonly framework?: string;
  readonly tags?: readonly string[];
  readonly traceId?: string;
}

export type MIRNode =
  | MIRApprovalNode
  | MIRBranchNode
  | MIRCacheReadNode
  | MIRCacheWriteNode
  | MIRContextTransformNode
  | MIRJoinNode
  | MIRModelCallNode
  | MIRRetrievalCallNode
  | MIRToolCallNode
  | MIRValidatorNode;

export type MIRNodeKind = MIRNode["kind"];

export interface MIRNodeBase<TKind extends string> {
  readonly id: string;
  readonly inputContext?: readonly string[];
  readonly kind: TKind;
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly outputContext?: string;
}

export interface MIRModelCallNode extends MIRNodeBase<"model_call"> {
  readonly model: MIRModelRequirement;
  readonly parameters?: MIRModelParameters;
  readonly validators?: readonly string[];
}

export interface MIRModelRequirement {
  readonly requiredCapabilities?: readonly MIRModelCapability[];
  readonly task:
    | "classification"
    | "embedding"
    | "general"
    | "ranking"
    | "reasoning"
    | "synthesis";
}

export type MIRModelCapability =
  | "json_mode"
  | "prompt_caching"
  | "reasoning_controls"
  | "structured_output"
  | "tool_calling";

export interface MIRModelParameters {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
}

export interface MIRToolCallNode extends MIRNodeBase<"tool_call"> {
  readonly tool: MIRToolCall;
}

export interface MIRToolCall {
  readonly inputRef?: string;
  readonly name: string;
  readonly requiresApprovalId?: string;
  readonly schemaRef?: string;
  readonly sideEffects?: MIRToolSideEffects;
}

export interface MIRToolSideEffects {
  readonly approvalEvidenceRef?: string;
  readonly idempotencyKeyRef?: string;
  readonly policyEvidenceRef?: string;
  readonly sideEffectClass: MIRSideEffectClass;
}

export type MIRSideEffectClass =
  | "approval_required"
  | "idempotent_mutation"
  | "non_idempotent_mutation"
  | "read_only"
  | "unknown";

export interface MIRRetrievalCallNode extends MIRNodeBase<"retrieval_call"> {
  readonly queryContext: string;
  readonly resultContext: string;
  readonly retrieval: MIRRetrievalRequest;
}

export interface MIRRetrievalRequest {
  readonly filterRef?: string;
  readonly source: string;
  readonly topK?: number;
}

export interface MIRContextTransformNode extends MIRNodeBase<"context_transform"> {
  readonly inputContext: readonly string[];
  readonly outputContext: string;
  readonly transform: MIRContextTransform;
}

export interface MIRContextTransform {
  readonly kind:
    | "assemble"
    | "compress"
    | "deduplicate"
    | "filter"
    | "redact"
    | "summarize";
  readonly lossy: boolean;
  readonly requiresValidatorIds?: readonly string[];
}

export interface MIRValidatorNode extends MIRNodeBase<"validator"> {
  readonly failurePolicy?: MIRValidatorFailurePolicy;
  readonly inputContext: readonly string[];
  readonly validator: MIRValidator;
}

export interface MIRValidator {
  readonly kind: "custom" | "policy" | "schema" | "source_grounding";
  readonly name: string;
  readonly schemaRef?: string;
}

export type MIRValidatorFailurePolicy = "fail_plan" | "retry_node" | "warn";

export interface MIRApprovalNode extends MIRNodeBase<"approval"> {
  readonly approval: MIRApproval;
  readonly inputContext: readonly string[];
}

export interface MIRApproval {
  readonly approvalId: string;
  readonly approverRef?: string;
  readonly reason: string;
}

export interface MIRCacheReadNode extends MIRNodeBase<"cache_read"> {
  readonly cacheKeyRef: string;
  readonly cachePolicy?: MIRCachePolicy;
  readonly outputContext: string;
}

export interface MIRCacheWriteNode extends MIRNodeBase<"cache_write"> {
  readonly cacheKeyRef: string;
  readonly cachePolicy?: MIRCachePolicy;
  readonly inputContext: readonly string[];
}

export interface MIRBranchNode extends MIRNodeBase<"branch"> {
  readonly branches: readonly MIRBranch[];
}

export interface MIRBranch {
  readonly conditionRef?: string;
  readonly id: string;
  readonly targetNodeId: string;
}

export interface MIRJoinNode extends MIRNodeBase<"join"> {
  readonly inputNodeIds: readonly string[];
  readonly strategy: "all" | "first_success" | "quorum";
}

export interface MIREdge {
  readonly conditionRef?: string;
  readonly contextIds?: readonly string[];
  readonly fromNodeId: string;
  readonly id: string;
  readonly kind: MIREdgeKind;
  readonly toNodeId: string;
}

export type MIREdgeKind = "control" | "data" | "fallback" | "validation";

export interface MIRContextBlock {
  readonly cachePolicy?: MIRCachePolicy;
  readonly contentHash?: string;
  readonly contentRef: string;
  readonly id: string;
  readonly mutability: MIRContextMutability;
  readonly privacyClass?: MIRPrivacyClass;
  readonly provenance: MIRProvenance;
  readonly retentionPolicy?: MIRRetentionPolicy;
  readonly role: MIRContextRole;
  readonly tokenEstimate?: number;
}

export type MIRContextRole =
  | "developer_instruction"
  | "example"
  | "memory"
  | "retrieved_document"
  | "scratchpad"
  | "system_instruction"
  | "tool_result"
  | "user_input"
  | "validator_output";

export type MIRContextMutability =
  | "compressible"
  | "deduplicable"
  | "droppable"
  | "fixed"
  | "summarizable";

export interface MIRProvenance {
  readonly createdAt?: string;
  readonly derivedFromContextIds?: readonly string[];
  readonly nodeId?: string;
  readonly source: MIRProvenanceSource;
  readonly sourceRef?: string;
}

export type MIRProvenanceSource =
  | "cache"
  | "developer"
  | "generated"
  | "memory"
  | "retrieval"
  | "system"
  | "tool"
  | "user"
  | "validator";

export interface MIRCachePolicy {
  readonly keyRef?: string;
  readonly mode: "eligible" | "forbidden" | "none" | "required";
  readonly scope?: "context" | "node" | "plan" | "session";
  readonly ttlMs?: number;
}

export type MIRPrivacyClass =
  | "confidential"
  | "internal"
  | "public"
  | "restricted"
  | "secret";

export interface MIRRetentionPolicy {
  readonly mode: "ephemeral" | "full" | "metadata_only" | "redacted";
  readonly reason?: string;
  readonly ttlMs?: number;
}

export interface MIRConstraints {
  readonly allowedProviders?: readonly string[];
  readonly allowedRegression?: number;
  readonly auditLevel?: "evidence_bundle" | "none" | "summary";
  readonly cachePolicy?: MIRCachePolicy;
  readonly dataPolicy?: MIRDataPolicy;
  readonly deniedProviders?: readonly string[];
  readonly maxCostUsd?: number;
  readonly maxLatencyMs?: number;
  readonly minEvalScore?: number;
  readonly minValidatorPassRate?: number;
  readonly replayPolicy?: "full_trace" | "metadata" | "none";
  readonly requiredHumanApprovals?: readonly string[];
  readonly requiredValidators?: readonly string[];
  readonly retentionPolicy?: MIRRetentionPolicy;
}

export interface MIRDataPolicy {
  readonly allowModelTraining?: boolean;
  readonly allowPersistence?: boolean;
  readonly allowedPrivacyClasses?: readonly MIRPrivacyClass[];
  readonly redactionRequired?: boolean;
}
