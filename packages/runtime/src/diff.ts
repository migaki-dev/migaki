import type { MIRContextBlock, MIREdge, MIRNode, MIRPlan } from "@migaki/mir";

export const PLAN_DIFF_VERSION = "migaki.plan-diff.v0";

export type PlanDiffVersion = typeof PLAN_DIFF_VERSION;

export interface MIRPlanDiff {
  readonly changes: readonly MIRPlanDiffEntry[];
  readonly kind: "inline";
  readonly version: PlanDiffVersion;
}

export interface MIRPlanDiffEntry {
  readonly artifactId?: string;
  readonly artifactKind: MIRPlanDiffArtifactKind;
  readonly description: string;
  readonly field?: string;
  readonly kind: MIRPlanDiffChangeKind;
  readonly path: string;
  readonly valueMode: "omitted";
}

export type MIRPlanDiffArtifactKind =
  | "constraint"
  | "context"
  | "edge"
  | "metadata"
  | "node"
  | "warning";

export type MIRPlanDiffChangeKind =
  | "constraint_changed"
  | "context_added"
  | "context_changed"
  | "context_removed"
  | "edge_added"
  | "edge_changed"
  | "edge_removed"
  | "metadata_changed"
  | "node_added"
  | "node_changed"
  | "node_removed"
  | "warning_added"
  | "warning_changed"
  | "warning_removed";

export interface MIRPlanDiffWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity: "error" | "info" | "warning";
}

export interface MIRPlanDiffOptions {
  readonly afterWarnings?: readonly MIRPlanDiffWarning[];
  readonly beforeWarnings?: readonly MIRPlanDiffWarning[];
}

interface IdentifiedArtifact {
  readonly id: string;
}

interface ChangedField {
  readonly field: string;
}

export function diffMIRPlans(
  before: MIRPlan,
  after: MIRPlan,
  options: MIRPlanDiffOptions = {},
): MIRPlanDiff {
  return {
    changes: [
      ...diffRecord({
        after: after.metadata,
        artifactKind: "metadata",
        before: before.metadata,
        changeKind: "metadata_changed",
        descriptionPrefix: "metadata",
        pathPrefix: "$.metadata",
      }),
      ...diffRecord({
        after: after.constraints,
        artifactKind: "constraint",
        before: before.constraints,
        changeKind: "constraint_changed",
        descriptionPrefix: "constraint",
        pathPrefix: "$.constraints",
      }),
      ...diffCollection({
        addedKind: "context_added",
        after: after.context,
        artifactKind: "context",
        before: before.context,
        changedKind: "context_changed",
        collectionPath: "$.context",
        removedKind: "context_removed",
      }),
      ...diffCollection({
        addedKind: "node_added",
        after: after.nodes,
        artifactKind: "node",
        before: before.nodes,
        changedKind: "node_changed",
        collectionPath: "$.nodes",
        removedKind: "node_removed",
      }),
      ...diffCollection({
        addedKind: "edge_added",
        after: after.edges,
        artifactKind: "edge",
        before: before.edges,
        changedKind: "edge_changed",
        collectionPath: "$.edges",
        removedKind: "edge_removed",
      }),
      ...diffWarnings(
        options.beforeWarnings ?? [],
        options.afterWarnings ?? [],
      ),
    ],
    kind: "inline",
    version: PLAN_DIFF_VERSION,
  };
}

function diffRecord(input: {
  readonly after: unknown;
  readonly artifactKind: MIRPlanDiffArtifactKind;
  readonly before: unknown;
  readonly changeKind: MIRPlanDiffChangeKind;
  readonly descriptionPrefix: string;
  readonly pathPrefix: string;
}): MIRPlanDiffEntry[] {
  return collectChangedFields(input.before, input.after).map((change) =>
    createChange({
      artifactKind: input.artifactKind,
      description: `Changed ${input.descriptionPrefix} ${change.field}.`,
      field: change.field,
      kind: input.changeKind,
      path: `${input.pathPrefix}.${change.field}`,
    }),
  );
}

function diffCollection<
  TArtifact extends MIRContextBlock | MIREdge | MIRNode | IdentifiedArtifact,
>(input: {
  readonly addedKind: MIRPlanDiffChangeKind;
  readonly after: readonly TArtifact[];
  readonly artifactKind: MIRPlanDiffArtifactKind;
  readonly before: readonly TArtifact[];
  readonly changedKind: MIRPlanDiffChangeKind;
  readonly collectionPath: string;
  readonly removedKind: MIRPlanDiffChangeKind;
}): MIRPlanDiffEntry[] {
  const beforeById = indexById(input.before);
  const afterById = indexById(input.after);
  const changes: MIRPlanDiffEntry[] = [];

  for (const artifactId of sortedIds(beforeById)) {
    if (afterById.has(artifactId)) {
      continue;
    }

    changes.push(
      createChange({
        artifactId,
        artifactKind: input.artifactKind,
        description: `Removed ${input.artifactKind} ${artifactId}.`,
        kind: input.removedKind,
        path: artifactPath(input.collectionPath, artifactId),
      }),
    );
  }

  for (const artifactId of sortedIds(afterById)) {
    if (beforeById.has(artifactId)) {
      continue;
    }

    changes.push(
      createChange({
        artifactId,
        artifactKind: input.artifactKind,
        description: `Added ${input.artifactKind} ${artifactId}.`,
        kind: input.addedKind,
        path: artifactPath(input.collectionPath, artifactId),
      }),
    );
  }

  for (const artifactId of sortedIds(beforeById)) {
    const beforeArtifact = beforeById.get(artifactId);
    const afterArtifact = afterById.get(artifactId);

    if (beforeArtifact === undefined || afterArtifact === undefined) {
      continue;
    }

    for (const change of collectChangedFields(beforeArtifact, afterArtifact)) {
      changes.push(
        createChange({
          artifactId,
          artifactKind: input.artifactKind,
          description: `Changed ${input.artifactKind} ${artifactId} field ${change.field}.`,
          field: change.field,
          kind: input.changedKind,
          path: `${artifactPath(input.collectionPath, artifactId)}.${change.field}`,
        }),
      );
    }
  }

  return changes;
}

function diffWarnings(
  beforeWarnings: readonly MIRPlanDiffWarning[],
  afterWarnings: readonly MIRPlanDiffWarning[],
): MIRPlanDiffEntry[] {
  const beforeById = indexWarnings(beforeWarnings);
  const afterById = indexWarnings(afterWarnings);
  const changes: MIRPlanDiffEntry[] = [];

  for (const artifactId of sortedIds(beforeById)) {
    if (afterById.has(artifactId)) {
      continue;
    }

    const warning = beforeById.get(artifactId);

    if (warning === undefined) {
      continue;
    }

    changes.push(
      createChange({
        artifactId,
        artifactKind: "warning",
        description: `Removed warning ${warning.code}.`,
        kind: "warning_removed",
        path: warningPath(warning),
      }),
    );
  }

  for (const artifactId of sortedIds(afterById)) {
    if (beforeById.has(artifactId)) {
      continue;
    }

    const warning = afterById.get(artifactId);

    if (warning === undefined) {
      continue;
    }

    changes.push(
      createChange({
        artifactId,
        artifactKind: "warning",
        description: `Added warning ${warning.code}.`,
        kind: "warning_added",
        path: warningPath(warning),
      }),
    );
  }

  for (const artifactId of sortedIds(beforeById)) {
    const beforeWarning = beforeById.get(artifactId);
    const afterWarning = afterById.get(artifactId);

    if (
      beforeWarning === undefined ||
      afterWarning === undefined ||
      stableValueKey(beforeWarning) === stableValueKey(afterWarning)
    ) {
      continue;
    }

    changes.push(
      createChange({
        artifactId,
        artifactKind: "warning",
        description: `Changed warning ${afterWarning.code}.`,
        kind: "warning_changed",
        path: warningPath(afterWarning),
      }),
    );
  }

  return changes;
}

function collectChangedFields(before: unknown, after: unknown): ChangedField[] {
  return collectChangedFieldsAt(before, after, []);
}

function collectChangedFieldsAt(
  before: unknown,
  after: unknown,
  path: readonly string[],
): ChangedField[] {
  if (stableValueKey(before) === stableValueKey(after)) {
    return [];
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    keys.sort(compareStrings);

    return keys.flatMap((key) =>
      collectChangedFieldsAt(before[key], after[key], [...path, key]),
    );
  }

  return [
    {
      field: path.join("."),
    },
  ];
}

function indexById<TArtifact extends IdentifiedArtifact>(
  artifacts: readonly TArtifact[],
): Map<string, TArtifact> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function indexWarnings(
  warnings: readonly MIRPlanDiffWarning[],
): Map<string, MIRPlanDiffWarning> {
  return new Map(
    warnings.map((warning) => [warningArtifactId(warning), warning]),
  );
}

function sortedIds(map: ReadonlyMap<string, unknown>): string[] {
  return [...map.keys()].sort(compareStrings);
}

function createChange(input: {
  readonly artifactId?: string;
  readonly artifactKind: MIRPlanDiffArtifactKind;
  readonly description: string;
  readonly field?: string;
  readonly kind: MIRPlanDiffChangeKind;
  readonly path: string;
}): MIRPlanDiffEntry {
  return {
    ...("artifactId" in input ? { artifactId: input.artifactId } : {}),
    artifactKind: input.artifactKind,
    description: input.description,
    ...("field" in input ? { field: input.field } : {}),
    kind: input.kind,
    path: input.path,
    valueMode: "omitted",
  };
}

function artifactPath(collectionPath: string, artifactId: string): string {
  return `${collectionPath}[?(@.id==${JSON.stringify(artifactId)})]`;
}

function warningArtifactId(warning: MIRPlanDiffWarning): string {
  return `${warning.code}|${warning.severity}|${warning.path ?? ""}`;
}

function warningPath(warning: MIRPlanDiffWarning): string {
  const clauses = [
    `@.code==${JSON.stringify(warning.code)}`,
    `@.severity==${JSON.stringify(warning.severity)}`,
  ];

  if (warning.path !== undefined) {
    clauses.push(`@.path==${JSON.stringify(warning.path)}`);
  }

  return `$.warnings[?(${clauses.join("&&")})]`;
}

function stableValueKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const canonical: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort(compareStrings)) {
    canonical[key] = canonicalize(value[key]);
  }

  return canonical;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
