import type {
  MIRCachePolicy,
  MIRContextBlock,
  MIRContextMutability,
  MIRContextRole,
  MIRPlan,
  MIRPrivacyClass,
  MIRProvenanceSource,
  MIRRetentionPolicy,
} from "@migaki/mir";

export const CONTEXT_LEDGER_VERSION = "migaki.context-ledger.v0";

export type ContextLedgerVersion = typeof CONTEXT_LEDGER_VERSION;

export type ContextLedgerDiagnosticCode =
  | "duplicate_id"
  | "missing_content_ref"
  | "unsafe_mutability";

export interface ContextLedgerDiagnostic {
  readonly code: ContextLedgerDiagnosticCode;
  readonly contextId?: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "error";
}

export interface SafeContentRef {
  readonly containsRawContent: false;
  readonly ref: string;
  readonly scheme: string;
}

export interface ContextLedger {
  readonly diagnostics: readonly ContextLedgerDiagnostic[];
  readonly valid: boolean;
  readonly version: ContextLedgerVersion;
  all(): readonly MIRContextBlock[];
  byCacheMode(mode: MIRCachePolicy["mode"]): readonly MIRContextBlock[];
  byCacheScope(
    scope: NonNullable<MIRCachePolicy["scope"]>,
  ): readonly MIRContextBlock[];
  byContentRef(contentRef: string): readonly MIRContextBlock[];
  byId(id: string): MIRContextBlock | undefined;
  byMutability(mutability: MIRContextMutability): readonly MIRContextBlock[];
  byPrivacyClass(privacyClass: MIRPrivacyClass): readonly MIRContextBlock[];
  byProvenanceSource(source: MIRProvenanceSource): readonly MIRContextBlock[];
  byRetentionMode(mode: MIRRetentionPolicy["mode"]): readonly MIRContextBlock[];
  byRole(role: MIRContextRole): readonly MIRContextBlock[];
  contentRefFor(id: string): SafeContentRef | undefined;
}

const rolesThatRequireFixedMutability = new Set<MIRContextRole>([
  "developer_instruction",
  "system_instruction",
  "user_input",
]);

export function createContextLedger(
  input: MIRPlan | readonly MIRContextBlock[],
): ContextLedger {
  return new ContextLedgerImpl(
    isContextBlockArray(input) ? input : input.context,
  );
}

class ContextLedgerImpl implements ContextLedger {
  readonly #all: readonly MIRContextBlock[];
  readonly #byCacheMode = new Map<MIRCachePolicy["mode"], MIRContextBlock[]>();
  readonly #byCacheScope = new Map<
    NonNullable<MIRCachePolicy["scope"]>,
    MIRContextBlock[]
  >();
  readonly #byContentRef = new Map<string, MIRContextBlock[]>();
  readonly #byId = new Map<string, MIRContextBlock>();
  readonly #byMutability = new Map<MIRContextMutability, MIRContextBlock[]>();
  readonly #byPrivacyClass = new Map<MIRPrivacyClass, MIRContextBlock[]>();
  readonly #byProvenanceSource = new Map<
    MIRProvenanceSource,
    MIRContextBlock[]
  >();
  readonly #byRetentionMode = new Map<
    MIRRetentionPolicy["mode"],
    MIRContextBlock[]
  >();
  readonly #byRole = new Map<MIRContextRole, MIRContextBlock[]>();
  readonly diagnostics: readonly ContextLedgerDiagnostic[];
  readonly version = CONTEXT_LEDGER_VERSION;

  constructor(blocks: readonly MIRContextBlock[]) {
    const diagnostics: ContextLedgerDiagnostic[] = [];
    this.#all = [...blocks].sort(compareContextBlocks);

    for (const block of this.#all) {
      if (this.#byId.has(block.id)) {
        diagnostics.push({
          code: "duplicate_id",
          contextId: block.id,
          message: "Context block id must be unique.",
          path: contextPath(block.id),
          severity: "error",
        });
      } else {
        this.#byId.set(block.id, block);
      }

      if (block.contentRef.trim() === "") {
        diagnostics.push({
          code: "missing_content_ref",
          contextId: block.id,
          message: "Context block must use a non-empty content reference.",
          path: `${contextPath(block.id)}.contentRef`,
          severity: "error",
        });
      }

      if (isUnsafeMutability(block)) {
        diagnostics.push({
          code: "unsafe_mutability",
          contextId: block.id,
          message: "Context role requires fixed mutability.",
          path: `${contextPath(block.id)}.mutability`,
          severity: "error",
        });
      }

      addIndexValue(this.#byContentRef, block.contentRef, block);
      addIndexValue(this.#byMutability, block.mutability, block);
      addIndexValue(this.#byProvenanceSource, block.provenance.source, block);
      addIndexValue(this.#byRole, block.role, block);

      if (block.cachePolicy?.mode !== undefined) {
        addIndexValue(this.#byCacheMode, block.cachePolicy.mode, block);
      }

      if (block.cachePolicy?.scope !== undefined) {
        addIndexValue(this.#byCacheScope, block.cachePolicy.scope, block);
      }

      if (block.privacyClass !== undefined) {
        addIndexValue(this.#byPrivacyClass, block.privacyClass, block);
      }

      if (block.retentionPolicy?.mode !== undefined) {
        addIndexValue(this.#byRetentionMode, block.retentionPolicy.mode, block);
      }
    }

    this.diagnostics = diagnostics;
  }

  get valid(): boolean {
    return this.diagnostics.length === 0;
  }

  all(): readonly MIRContextBlock[] {
    return this.#all;
  }

  byCacheMode(mode: MIRCachePolicy["mode"]): readonly MIRContextBlock[] {
    return lookupIndex(this.#byCacheMode, mode);
  }

  byCacheScope(
    scope: NonNullable<MIRCachePolicy["scope"]>,
  ): readonly MIRContextBlock[] {
    return lookupIndex(this.#byCacheScope, scope);
  }

  byContentRef(contentRef: string): readonly MIRContextBlock[] {
    return lookupIndex(this.#byContentRef, contentRef);
  }

  byId(id: string): MIRContextBlock | undefined {
    return this.#byId.get(id);
  }

  byMutability(mutability: MIRContextMutability): readonly MIRContextBlock[] {
    return lookupIndex(this.#byMutability, mutability);
  }

  byPrivacyClass(privacyClass: MIRPrivacyClass): readonly MIRContextBlock[] {
    return lookupIndex(this.#byPrivacyClass, privacyClass);
  }

  byProvenanceSource(source: MIRProvenanceSource): readonly MIRContextBlock[] {
    return lookupIndex(this.#byProvenanceSource, source);
  }

  byRetentionMode(
    mode: MIRRetentionPolicy["mode"],
  ): readonly MIRContextBlock[] {
    return lookupIndex(this.#byRetentionMode, mode);
  }

  byRole(role: MIRContextRole): readonly MIRContextBlock[] {
    return lookupIndex(this.#byRole, role);
  }

  contentRefFor(id: string): SafeContentRef | undefined {
    const block = this.byId(id);

    if (block === undefined || block.contentRef.trim() === "") {
      return undefined;
    }

    return {
      containsRawContent: false,
      ref: block.contentRef,
      scheme: contentRefScheme(block.contentRef),
    };
  }
}

function addIndexValue<TKey>(
  index: Map<TKey, MIRContextBlock[]>,
  key: TKey,
  block: MIRContextBlock,
): void {
  const blocks = index.get(key);

  if (blocks === undefined) {
    index.set(key, [block]);
    return;
  }

  blocks.push(block);
}

function lookupIndex<TKey>(
  index: ReadonlyMap<TKey, readonly MIRContextBlock[]>,
  key: TKey,
): readonly MIRContextBlock[] {
  return index.get(key) ?? [];
}

function compareContextBlocks(
  left: MIRContextBlock,
  right: MIRContextBlock,
): number {
  return left.id.localeCompare(right.id);
}

function contentRefScheme(contentRef: string): string {
  const schemeSeparatorIndex = contentRef.indexOf("://");

  if (schemeSeparatorIndex <= 0) {
    return "unknown";
  }

  return contentRef.slice(0, schemeSeparatorIndex);
}

function contextPath(id: string): string {
  return `$.context[?(@.id==${JSON.stringify(id)})]`;
}

function isUnsafeMutability(block: MIRContextBlock): boolean {
  return (
    rolesThatRequireFixedMutability.has(block.role) &&
    block.mutability !== "fixed"
  );
}

function isContextBlockArray(
  input: MIRPlan | readonly MIRContextBlock[],
): input is readonly MIRContextBlock[] {
  return Array.isArray(input);
}
