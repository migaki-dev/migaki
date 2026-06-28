import { MIR_V0_VERSION, type MIRPlan } from "./types.js";

export type MIRValidationErrorCode =
  | "duplicate_id"
  | "invalid_constraint"
  | "invalid_enum"
  | "invalid_reference"
  | "invalid_type"
  | "missing_required"
  | "unknown_node_kind"
  | "unknown_version";

export interface MIRValidationError {
  readonly code: MIRValidationErrorCode;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly path: string;
}

export type MIRValidationResult =
  | {
      readonly errors: readonly [];
      readonly plan: MIRPlan;
      readonly success: true;
    }
  | {
      readonly errors: readonly MIRValidationError[];
      readonly success: false;
    };

export class MIRValidationFailure extends Error {
  readonly errors: readonly MIRValidationError[];

  constructor(errors: readonly MIRValidationError[]) {
    super("Invalid mIR plan.");
    this.name = "MIRValidationFailure";
    this.errors = errors;
  }
}

const nodeKinds = new Set([
  "approval",
  "branch",
  "cache_read",
  "cache_write",
  "context_transform",
  "join",
  "model_call",
  "retrieval_call",
  "tool_call",
  "validator",
]);

const contextRoles = new Set([
  "developer_instruction",
  "example",
  "memory",
  "retrieved_document",
  "scratchpad",
  "system_instruction",
  "tool_result",
  "user_input",
  "validator_output",
]);

const contextMutabilities = new Set([
  "compressible",
  "deduplicable",
  "droppable",
  "fixed",
  "summarizable",
]);

const provenanceSources = new Set([
  "cache",
  "developer",
  "generated",
  "memory",
  "retrieval",
  "system",
  "tool",
  "user",
  "validator",
]);

const privacyClasses = new Set([
  "confidential",
  "internal",
  "public",
  "restricted",
  "secret",
]);

const cacheModes = new Set(["eligible", "forbidden", "none", "required"]);
const cacheScopes = new Set(["context", "node", "plan", "session"]);
const retentionModes = new Set([
  "ephemeral",
  "full",
  "metadata_only",
  "redacted",
]);
const auditLevels = new Set(["evidence_bundle", "none", "summary"]);
const replayPolicies = new Set(["full_trace", "metadata", "none"]);
const edgeKinds = new Set(["control", "data", "fallback", "validation"]);
const modelTasks = new Set([
  "classification",
  "embedding",
  "general",
  "ranking",
  "reasoning",
  "synthesis",
]);
const modelCapabilities = new Set([
  "json_mode",
  "prompt_caching",
  "reasoning_controls",
  "structured_output",
  "tool_calling",
]);
const transformKinds = new Set([
  "assemble",
  "compress",
  "deduplicate",
  "filter",
  "redact",
  "summarize",
]);
const validatorKinds = new Set([
  "custom",
  "policy",
  "schema",
  "source_grounding",
]);
const validatorFailurePolicies = new Set(["fail_plan", "retry_node", "warn"]);
const joinStrategies = new Set(["all", "first_success", "quorum"]);

export function validateMIRPlan(input: unknown): MIRValidationResult {
  const errors: MIRValidationError[] = [];
  const plan = asRecord(input, "$", errors);

  if (plan === undefined) {
    return { errors, success: false };
  }

  requireString(plan, "id", "$.id", errors);

  const version = requireString(plan, "version", "$.version", errors);

  if (version !== undefined && version !== MIR_V0_VERSION) {
    addError(errors, {
      code: "unknown_version",
      context: {
        actual: version,
        expected: MIR_V0_VERSION,
      },
      message: "Unsupported mIR version.",
      path: "$.version",
    });
  }

  validateMetadata(plan, errors);
  validateConstraints(plan, errors);

  const contextIds = validateContextBlocks(plan, errors);
  const nodeRecords = collectNodeRecords(plan, errors);
  const nodeIds = collectIds(nodeRecords, "$.nodes", errors);

  validateNodes(nodeRecords, nodeIds, contextIds, errors);
  validateEdges(plan, nodeIds, contextIds, errors);

  if (errors.length > 0) {
    return { errors, success: false };
  }

  return {
    errors: [],
    plan: input as MIRPlan,
    success: true,
  };
}

export function isMIRPlan(input: unknown): input is MIRPlan {
  return validateMIRPlan(input).success;
}

export function assertMIRPlan(input: unknown): MIRPlan {
  const result = validateMIRPlan(input);

  if (!result.success) {
    throw new MIRValidationFailure(result.errors);
  }

  return result.plan;
}

function validateMetadata(
  plan: Readonly<Record<string, unknown>>,
  errors: MIRValidationError[],
): void {
  const metadata = requireRecord(plan, "metadata", "$.metadata", errors);

  if (metadata === undefined) {
    return;
  }

  requireString(metadata, "createdAt", "$.metadata.createdAt", errors);
  optionalString(metadata, "application", "$.metadata.application", errors);
  optionalString(metadata, "description", "$.metadata.description", errors);
  optionalString(metadata, "framework", "$.metadata.framework", errors);
  optionalString(metadata, "traceId", "$.metadata.traceId", errors);
  optionalStringArray(metadata, "tags", "$.metadata.tags", errors);
}

function validateConstraints(
  plan: Readonly<Record<string, unknown>>,
  errors: MIRValidationError[],
): void {
  const constraints = requireRecord(
    plan,
    "constraints",
    "$.constraints",
    errors,
  );

  if (constraints === undefined) {
    return;
  }

  validateNonNegativeConstraint(
    constraints,
    "maxCostUsd",
    "$.constraints.maxCostUsd",
    errors,
  );
  validateNonNegativeConstraint(
    constraints,
    "maxLatencyMs",
    "$.constraints.maxLatencyMs",
    errors,
  );
  validateUnitConstraint(
    constraints,
    "allowedRegression",
    "$.constraints.allowedRegression",
    errors,
  );
  validateUnitConstraint(
    constraints,
    "minEvalScore",
    "$.constraints.minEvalScore",
    errors,
  );
  validateUnitConstraint(
    constraints,
    "minValidatorPassRate",
    "$.constraints.minValidatorPassRate",
    errors,
  );

  const allowedProviders = optionalStringArray(
    constraints,
    "allowedProviders",
    "$.constraints.allowedProviders",
    errors,
  );
  const deniedProviders = optionalStringArray(
    constraints,
    "deniedProviders",
    "$.constraints.deniedProviders",
    errors,
  );

  if (allowedProviders !== undefined && deniedProviders !== undefined) {
    const allowedProviderSet = new Set(allowedProviders);

    deniedProviders.forEach((provider, index) => {
      if (allowedProviderSet.has(provider)) {
        addError(errors, {
          code: "invalid_constraint",
          context: { provider },
          message: "Provider cannot be both allowed and denied.",
          path: `$.constraints.deniedProviders[${index}]`,
        });
      }
    });
  }

  optionalEnum(
    constraints,
    "auditLevel",
    "$.constraints.auditLevel",
    auditLevels,
    errors,
  );
  optionalEnum(
    constraints,
    "replayPolicy",
    "$.constraints.replayPolicy",
    replayPolicies,
    errors,
  );
  optionalStringArray(
    constraints,
    "requiredHumanApprovals",
    "$.constraints.requiredHumanApprovals",
    errors,
  );
  optionalStringArray(
    constraints,
    "requiredValidators",
    "$.constraints.requiredValidators",
    errors,
  );
  optionalCachePolicy(
    constraints,
    "cachePolicy",
    "$.constraints.cachePolicy",
    errors,
  );
  optionalRetentionPolicy(
    constraints,
    "retentionPolicy",
    "$.constraints.retentionPolicy",
    errors,
  );
}

function validateContextBlocks(
  plan: Readonly<Record<string, unknown>>,
  errors: MIRValidationError[],
): Set<string> {
  const contextIds = new Set<string>();
  const contextBlocks = requireArray(plan, "context", "$.context", errors);

  if (contextBlocks === undefined) {
    return contextIds;
  }

  contextBlocks.forEach((value, index) => {
    const path = `$.context[${index}]`;
    const contextBlock = asRecord(value, path, errors);

    if (contextBlock === undefined) {
      return;
    }

    const id = requireString(contextBlock, "id", `${path}.id`, errors);

    if (id !== undefined) {
      addUniqueId(contextIds, id, `${path}.id`, errors);
    }

    requireString(contextBlock, "contentRef", `${path}.contentRef`, errors);
    optionalString(contextBlock, "contentHash", `${path}.contentHash`, errors);
    requiredEnum(contextBlock, "role", `${path}.role`, contextRoles, errors);
    requiredEnum(
      contextBlock,
      "mutability",
      `${path}.mutability`,
      contextMutabilities,
      errors,
    );
    optionalEnum(
      contextBlock,
      "privacyClass",
      `${path}.privacyClass`,
      privacyClasses,
      errors,
    );
    optionalNonNegativeNumber(
      contextBlock,
      "tokenEstimate",
      `${path}.tokenEstimate`,
      errors,
    );
    optionalCachePolicy(
      contextBlock,
      "cachePolicy",
      `${path}.cachePolicy`,
      errors,
    );
    optionalRetentionPolicy(
      contextBlock,
      "retentionPolicy",
      `${path}.retentionPolicy`,
      errors,
    );
    validateProvenance(contextBlock, `${path}.provenance`, errors);
  });

  return contextIds;
}

function validateProvenance(
  contextBlock: Readonly<Record<string, unknown>>,
  path: string,
  errors: MIRValidationError[],
): void {
  const provenance = requireRecord(contextBlock, "provenance", path, errors);

  if (provenance === undefined) {
    return;
  }

  requiredEnum(
    provenance,
    "source",
    `${path}.source`,
    provenanceSources,
    errors,
  );
  optionalString(provenance, "createdAt", `${path}.createdAt`, errors);
  optionalString(provenance, "nodeId", `${path}.nodeId`, errors);
  optionalString(provenance, "sourceRef", `${path}.sourceRef`, errors);
  optionalStringArray(
    provenance,
    "derivedFromContextIds",
    `${path}.derivedFromContextIds`,
    errors,
  );
}

function collectNodeRecords(
  plan: Readonly<Record<string, unknown>>,
  errors: MIRValidationError[],
): readonly Readonly<Record<string, unknown>>[] {
  const nodes = requireArray(plan, "nodes", "$.nodes", errors);

  if (nodes === undefined) {
    return [];
  }

  const records: Readonly<Record<string, unknown>>[] = [];

  nodes.forEach((value, index) => {
    const node = asRecord(value, `$.nodes[${index}]`, errors);

    if (node !== undefined) {
      records.push(node);
    }
  });

  return records;
}

function collectIds(
  records: readonly Readonly<Record<string, unknown>>[],
  basePath: string,
  errors: MIRValidationError[],
): Set<string> {
  const ids = new Set<string>();

  records.forEach((record, index) => {
    const id = requireString(record, "id", `${basePath}[${index}].id`, errors);

    if (id !== undefined) {
      addUniqueId(ids, id, `${basePath}[${index}].id`, errors);
    }
  });

  return ids;
}

function validateNodes(
  nodes: readonly Readonly<Record<string, unknown>>[],
  nodeIds: ReadonlySet<string>,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    const kind = requireString(node, "kind", `${path}.kind`, errors);

    if (kind === undefined) {
      return;
    }

    if (!nodeKinds.has(kind)) {
      addError(errors, {
        code: "unknown_node_kind",
        context: { kind },
        message: "Unknown mIR node kind.",
        path: `${path}.kind`,
      });
      return;
    }

    validateNodeBase(node, path, contextIds, errors);

    switch (kind) {
      case "approval":
        validateApprovalNode(node, path, contextIds, errors);
        break;
      case "branch":
        validateBranchNode(node, path, nodeIds, errors);
        break;
      case "cache_read":
        validateCacheReadNode(node, path, contextIds, errors);
        break;
      case "cache_write":
        validateCacheWriteNode(node, path, contextIds, errors);
        break;
      case "context_transform":
        validateContextTransformNode(node, path, contextIds, errors);
        break;
      case "join":
        validateJoinNode(node, path, nodeIds, errors);
        break;
      case "model_call":
        validateModelCallNode(node, path, errors);
        break;
      case "retrieval_call":
        validateRetrievalCallNode(node, path, contextIds, errors);
        break;
      case "tool_call":
        validateToolCallNode(node, path, errors);
        break;
      case "validator":
        validateValidatorNode(node, path, contextIds, errors);
        break;
    }
  });
}

function validateNodeBase(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  optionalString(node, "label", `${path}.label`, errors);
  validateOptionalContextArray(
    node,
    "inputContext",
    `${path}.inputContext`,
    contextIds,
    errors,
  );
  validateOptionalContextRef(
    node,
    "outputContext",
    `${path}.outputContext`,
    contextIds,
    errors,
  );
}

function validateModelCallNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  errors: MIRValidationError[],
): void {
  const model = requireRecord(node, "model", `${path}.model`, errors);

  if (model === undefined) {
    return;
  }

  requiredEnum(model, "task", `${path}.model.task`, modelTasks, errors);
  validateOptionalEnumArray(
    model,
    "requiredCapabilities",
    `${path}.model.requiredCapabilities`,
    modelCapabilities,
    errors,
  );

  const parameters = optionalRecord(
    node,
    "parameters",
    `${path}.parameters`,
    errors,
  );

  if (parameters !== undefined) {
    optionalNonNegativeNumber(
      parameters,
      "maxOutputTokens",
      `${path}.parameters.maxOutputTokens`,
      errors,
    );
    optionalNonNegativeNumber(
      parameters,
      "temperature",
      `${path}.parameters.temperature`,
      errors,
    );
    optionalNonNegativeNumber(
      parameters,
      "topP",
      `${path}.parameters.topP`,
      errors,
    );
  }

  optionalStringArray(node, "validators", `${path}.validators`, errors);
}

function validateToolCallNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  errors: MIRValidationError[],
): void {
  const tool = requireRecord(node, "tool", `${path}.tool`, errors);

  if (tool === undefined) {
    return;
  }

  requireString(tool, "name", `${path}.tool.name`, errors);
  optionalString(tool, "inputRef", `${path}.tool.inputRef`, errors);
  optionalString(
    tool,
    "requiresApprovalId",
    `${path}.tool.requiresApprovalId`,
    errors,
  );
  optionalString(tool, "schemaRef", `${path}.tool.schemaRef`, errors);
}

function validateRetrievalCallNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  validateRequiredContextRef(
    node,
    "queryContext",
    `${path}.queryContext`,
    contextIds,
    errors,
  );
  validateRequiredContextRef(
    node,
    "resultContext",
    `${path}.resultContext`,
    contextIds,
    errors,
  );

  const retrieval = requireRecord(
    node,
    "retrieval",
    `${path}.retrieval`,
    errors,
  );

  if (retrieval === undefined) {
    return;
  }

  requireString(retrieval, "source", `${path}.retrieval.source`, errors);
  optionalString(retrieval, "filterRef", `${path}.retrieval.filterRef`, errors);
  optionalNonNegativeNumber(
    retrieval,
    "topK",
    `${path}.retrieval.topK`,
    errors,
  );
}

function validateContextTransformNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  validateRequiredContextArray(
    node,
    "inputContext",
    `${path}.inputContext`,
    contextIds,
    errors,
  );
  validateRequiredContextRef(
    node,
    "outputContext",
    `${path}.outputContext`,
    contextIds,
    errors,
  );

  const transform = requireRecord(
    node,
    "transform",
    `${path}.transform`,
    errors,
  );

  if (transform === undefined) {
    return;
  }

  requiredEnum(
    transform,
    "kind",
    `${path}.transform.kind`,
    transformKinds,
    errors,
  );
  requireBoolean(transform, "lossy", `${path}.transform.lossy`, errors);
  optionalStringArray(
    transform,
    "requiresValidatorIds",
    `${path}.transform.requiresValidatorIds`,
    errors,
  );
}

function validateValidatorNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  validateRequiredContextArray(
    node,
    "inputContext",
    `${path}.inputContext`,
    contextIds,
    errors,
  );
  optionalEnum(
    node,
    "failurePolicy",
    `${path}.failurePolicy`,
    validatorFailurePolicies,
    errors,
  );

  const validator = requireRecord(
    node,
    "validator",
    `${path}.validator`,
    errors,
  );

  if (validator === undefined) {
    return;
  }

  requiredEnum(
    validator,
    "kind",
    `${path}.validator.kind`,
    validatorKinds,
    errors,
  );
  requireString(validator, "name", `${path}.validator.name`, errors);
  optionalString(validator, "schemaRef", `${path}.validator.schemaRef`, errors);
}

function validateApprovalNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  validateRequiredContextArray(
    node,
    "inputContext",
    `${path}.inputContext`,
    contextIds,
    errors,
  );

  const approval = requireRecord(node, "approval", `${path}.approval`, errors);

  if (approval === undefined) {
    return;
  }

  requireString(approval, "approvalId", `${path}.approval.approvalId`, errors);
  optionalString(
    approval,
    "approverRef",
    `${path}.approval.approverRef`,
    errors,
  );
  requireString(approval, "reason", `${path}.approval.reason`, errors);
}

function validateCacheReadNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  requireString(node, "cacheKeyRef", `${path}.cacheKeyRef`, errors);
  validateRequiredContextRef(
    node,
    "outputContext",
    `${path}.outputContext`,
    contextIds,
    errors,
  );
  optionalCachePolicy(node, "cachePolicy", `${path}.cachePolicy`, errors);
}

function validateCacheWriteNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  requireString(node, "cacheKeyRef", `${path}.cacheKeyRef`, errors);
  validateRequiredContextArray(
    node,
    "inputContext",
    `${path}.inputContext`,
    contextIds,
    errors,
  );
  optionalCachePolicy(node, "cachePolicy", `${path}.cachePolicy`, errors);
}

function validateBranchNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const branches = requireArray(node, "branches", `${path}.branches`, errors);

  if (branches === undefined) {
    return;
  }

  branches.forEach((value, index) => {
    const branchPath = `${path}.branches[${index}]`;
    const branch = asRecord(value, branchPath, errors);

    if (branch === undefined) {
      return;
    }

    requireString(branch, "id", `${branchPath}.id`, errors);
    optionalString(
      branch,
      "conditionRef",
      `${branchPath}.conditionRef`,
      errors,
    );
    validateRequiredNodeRef(
      branch,
      "targetNodeId",
      `${branchPath}.targetNodeId`,
      nodeIds,
      errors,
    );
  });
}

function validateJoinNode(
  node: Readonly<Record<string, unknown>>,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  requiredEnum(node, "strategy", `${path}.strategy`, joinStrategies, errors);
  validateRequiredNodeArray(
    node,
    "inputNodeIds",
    `${path}.inputNodeIds`,
    nodeIds,
    errors,
  );
}

function validateEdges(
  plan: Readonly<Record<string, unknown>>,
  nodeIds: ReadonlySet<string>,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const edges = requireArray(plan, "edges", "$.edges", errors);

  if (edges === undefined) {
    return;
  }

  const edgeIds = new Set<string>();

  edges.forEach((value, index) => {
    const path = `$.edges[${index}]`;
    const edge = asRecord(value, path, errors);

    if (edge === undefined) {
      return;
    }

    const id = requireString(edge, "id", `${path}.id`, errors);

    if (id !== undefined) {
      addUniqueId(edgeIds, id, `${path}.id`, errors);
    }

    requiredEnum(edge, "kind", `${path}.kind`, edgeKinds, errors);
    optionalString(edge, "conditionRef", `${path}.conditionRef`, errors);
    validateRequiredNodeRef(
      edge,
      "fromNodeId",
      `${path}.fromNodeId`,
      nodeIds,
      errors,
    );
    validateRequiredNodeRef(
      edge,
      "toNodeId",
      `${path}.toNodeId`,
      nodeIds,
      errors,
    );
    validateOptionalContextArray(
      edge,
      "contextIds",
      `${path}.contextIds`,
      contextIds,
      errors,
    );
  });
}

function optionalCachePolicy(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  const cachePolicy = optionalRecord(parent, key, path, errors);

  if (cachePolicy === undefined) {
    return;
  }

  requiredEnum(cachePolicy, "mode", `${path}.mode`, cacheModes, errors);
  optionalEnum(cachePolicy, "scope", `${path}.scope`, cacheScopes, errors);
  optionalString(cachePolicy, "keyRef", `${path}.keyRef`, errors);
  optionalNonNegativeNumber(cachePolicy, "ttlMs", `${path}.ttlMs`, errors);
}

function optionalRetentionPolicy(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  const retentionPolicy = optionalRecord(parent, key, path, errors);

  if (retentionPolicy === undefined) {
    return;
  }

  requiredEnum(retentionPolicy, "mode", `${path}.mode`, retentionModes, errors);
  optionalString(retentionPolicy, "reason", `${path}.reason`, errors);
  optionalNonNegativeNumber(retentionPolicy, "ttlMs", `${path}.ttlMs`, errors);
}

function validateNonNegativeConstraint(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  const value = parent[key];

  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    addError(errors, {
      code: "invalid_constraint",
      context: { actual: value },
      message: "Constraint must be a non-negative number.",
      path,
    });
  }
}

function validateUnitConstraint(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  const value = parent[key];

  if (value === undefined) {
    return;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    addError(errors, {
      code: "invalid_constraint",
      context: { actual: value },
      message: "Constraint must be between 0 and 1.",
      path,
    });
  }
}

function validateOptionalContextArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const values = optionalStringArray(parent, key, path, errors);

  if (values === undefined) {
    return;
  }

  values.forEach((contextId, index) => {
    validateContextReference(
      contextId,
      `${path}[${index}]`,
      contextIds,
      errors,
    );
  });
}

function validateRequiredContextArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const values = requireStringArray(parent, key, path, errors);

  if (values === undefined) {
    return;
  }

  values.forEach((contextId, index) => {
    validateContextReference(
      contextId,
      `${path}[${index}]`,
      contextIds,
      errors,
    );
  });
}

function validateOptionalEnumArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowedValues: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const values = optionalStringArray(parent, key, path, errors);

  if (values === undefined) {
    return;
  }

  values.forEach((value, index) => {
    if (!allowedValues.has(value)) {
      addError(errors, {
        code: "invalid_enum",
        context: { actual: value },
        message: "Value is not one of the allowed enum values.",
        path: `${path}[${index}]`,
      });
    }
  });
}

function validateRequiredNodeArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const values = requireStringArray(parent, key, path, errors);

  if (values === undefined) {
    return;
  }

  values.forEach((nodeId, index) => {
    validateNodeReference(nodeId, `${path}[${index}]`, nodeIds, errors);
  });
}

function validateOptionalContextRef(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const contextId = optionalString(parent, key, path, errors);

  if (contextId !== undefined) {
    validateContextReference(contextId, path, contextIds, errors);
  }
}

function validateRequiredContextRef(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const contextId = requireString(parent, key, path, errors);

  if (contextId !== undefined) {
    validateContextReference(contextId, path, contextIds, errors);
  }
}

function validateRequiredNodeRef(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const nodeId = requireString(parent, key, path, errors);

  if (nodeId !== undefined) {
    validateNodeReference(nodeId, path, nodeIds, errors);
  }
}

function validateContextReference(
  contextId: string,
  path: string,
  contextIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  if (!contextIds.has(contextId)) {
    addError(errors, {
      code: "invalid_reference",
      context: { contextId },
      message: "Referenced context block does not exist.",
      path,
    });
  }
}

function validateNodeReference(
  nodeId: string,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  if (!nodeIds.has(nodeId)) {
    addError(errors, {
      code: "invalid_reference",
      context: { nodeId },
      message: "Referenced node does not exist.",
      path,
    });
  }
}

function addUniqueId(
  ids: Set<string>,
  id: string,
  path: string,
  errors: MIRValidationError[],
): void {
  if (ids.has(id)) {
    addError(errors, {
      code: "duplicate_id",
      context: { id },
      message: "Identifier must be unique within this collection.",
      path,
    });
    return;
  }

  ids.add(id);
}

function requireRecord(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): Readonly<Record<string, unknown>> | undefined {
  if (!(key in parent)) {
    addError(errors, {
      code: "missing_required",
      message: "Required field is missing.",
      path,
    });
    return undefined;
  }

  return asRecord(parent[key], path, errors);
}

function optionalRecord(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): Readonly<Record<string, unknown>> | undefined {
  if (!(key in parent)) {
    return undefined;
  }

  return asRecord(parent[key], path, errors);
}

function asRecord(
  value: unknown,
  path: string,
  errors: MIRValidationError[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "object" },
      message: "Expected an object.",
      path,
    });
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): readonly unknown[] | undefined {
  if (!(key in parent)) {
    addError(errors, {
      code: "missing_required",
      message: "Required field is missing.",
      path,
    });
    return undefined;
  }

  const value = parent[key];

  if (!Array.isArray(value)) {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "array" },
      message: "Expected an array.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireStringArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): readonly string[] | undefined {
  const values = requireArray(parent, key, path, errors);

  if (values === undefined) {
    return undefined;
  }

  return validateStringArrayItems(values, path, errors);
}

function optionalStringArray(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): readonly string[] | undefined {
  if (!(key in parent)) {
    return undefined;
  }

  const value = parent[key];

  if (!Array.isArray(value)) {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "array" },
      message: "Expected an array.",
      path,
    });
    return undefined;
  }

  return validateStringArrayItems(value, path, errors);
}

function validateStringArrayItems(
  values: readonly unknown[],
  path: string,
  errors: MIRValidationError[],
): readonly string[] | undefined {
  const strings: string[] = [];
  let valid = true;

  values.forEach((value, index) => {
    if (typeof value !== "string") {
      addError(errors, {
        code: "invalid_type",
        context: { expected: "string" },
        message: "Expected a string.",
        path: `${path}[${index}]`,
      });
      valid = false;
      return;
    }

    strings.push(value);
  });

  return valid ? strings : undefined;
}

function requireString(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): string | undefined {
  if (!(key in parent)) {
    addError(errors, {
      code: "missing_required",
      message: "Required field is missing.",
      path,
    });
    return undefined;
  }

  return validateStringValue(parent[key], path, errors);
}

function optionalString(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): string | undefined {
  if (!(key in parent)) {
    return undefined;
  }

  return validateStringValue(parent[key], path, errors);
}

function validateStringValue(
  value: unknown,
  path: string,
  errors: MIRValidationError[],
): string | undefined {
  if (typeof value !== "string") {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "string" },
      message: "Expected a string.",
      path,
    });
    return undefined;
  }

  return value;
}

function requireBoolean(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  if (!(key in parent)) {
    addError(errors, {
      code: "missing_required",
      message: "Required field is missing.",
      path,
    });
    return;
  }

  if (typeof parent[key] !== "boolean") {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "boolean" },
      message: "Expected a boolean.",
      path,
    });
  }
}

function optionalNonNegativeNumber(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MIRValidationError[],
): void {
  if (!(key in parent)) {
    return;
  }

  const value = parent[key];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    addError(errors, {
      code: "invalid_type",
      context: { expected: "non-negative number" },
      message: "Expected a non-negative number.",
      path,
    });
  }
}

function requiredEnum(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowedValues: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const value = requireString(parent, key, path, errors);

  if (value !== undefined) {
    validateEnumValue(value, path, allowedValues, errors);
  }
}

function optionalEnum(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowedValues: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  const value = optionalString(parent, key, path, errors);

  if (value !== undefined) {
    validateEnumValue(value, path, allowedValues, errors);
  }
}

function validateEnumValue(
  value: string,
  path: string,
  allowedValues: ReadonlySet<string>,
  errors: MIRValidationError[],
): void {
  if (!allowedValues.has(value)) {
    addError(errors, {
      code: "invalid_enum",
      context: { actual: value },
      message: "Value is not one of the allowed enum values.",
      path,
    });
  }
}

function addError(
  errors: MIRValidationError[],
  error: MIRValidationError,
): void {
  errors.push(error);
}
