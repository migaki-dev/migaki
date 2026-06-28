import { describe, expect, it } from "vitest";

import { type MIRContextBlock } from "@migaki/mir";

import { createContextLedger } from "./index.js";

describe("createContextLedger", () => {
  it("indexes context blocks deterministically by execution metadata", () => {
    const ledger = createContextLedger([
      createBlock("ctx-retrieved", {
        cachePolicy: {
          mode: "eligible",
          scope: "context",
        },
        mutability: "deduplicable",
        provenance: {
          nodeId: "node-retrieve",
          source: "retrieval",
        },
        role: "retrieved_document",
      }),
      createBlock("ctx-system", {
        cachePolicy: {
          mode: "required",
          scope: "plan",
        },
        mutability: "fixed",
        privacyClass: "internal",
        retentionPolicy: {
          mode: "metadata_only",
        },
        role: "system_instruction",
      }),
      createBlock("ctx-question", {
        mutability: "fixed",
        privacyClass: "confidential",
        provenance: {
          source: "user",
        },
        retentionPolicy: {
          mode: "redacted",
        },
        role: "user_input",
      }),
    ]);

    expect(ledger.valid).toBe(true);
    expect(ledger.all().map((block) => block.id)).toEqual([
      "ctx-question",
      "ctx-retrieved",
      "ctx-system",
    ]);
    expect(ledger.byRole("user_input").map((block) => block.id)).toEqual([
      "ctx-question",
    ]);
    expect(
      ledger.byProvenanceSource("retrieval").map((block) => block.id),
    ).toEqual(["ctx-retrieved"]);
    expect(ledger.byMutability("fixed").map((block) => block.id)).toEqual([
      "ctx-question",
      "ctx-system",
    ]);
    expect(ledger.byCacheMode("required").map((block) => block.id)).toEqual([
      "ctx-system",
    ]);
    expect(
      ledger.byPrivacyClass("confidential").map((block) => block.id),
    ).toEqual(["ctx-question"]);
    expect(ledger.byRetentionMode("redacted").map((block) => block.id)).toEqual(
      ["ctx-question"],
    );
    expect(ledger.byId("ctx-question")?.retentionPolicy).toEqual({
      mode: "redacted",
    });
  });

  it("detects duplicate ids, missing content refs, and unsafe mutability", () => {
    const ledger = createContextLedger([
      createBlock("ctx-duplicate"),
      createBlock("ctx-duplicate"),
      createBlock("ctx-missing-ref", {
        contentRef: "",
      }),
      createBlock("ctx-unsafe", {
        mutability: "droppable",
        role: "system_instruction",
      }),
    ]);

    expect(ledger.valid).toBe(false);
    expect(ledger.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "duplicate_id",
      "missing_content_ref",
      "unsafe_mutability",
    ]);
    expect(ledger.byId("ctx-duplicate")?.id).toBe("ctx-duplicate");
  });

  it("returns safe content references without requiring raw prompt text", () => {
    const ledger = createContextLedger([
      createBlock("ctx-system", {
        contentRef: "fixture://system",
      }),
    ]);

    expect(ledger.contentRefFor("ctx-system")).toEqual({
      containsRawContent: false,
      ref: "fixture://system",
      scheme: "fixture",
    });
    expect(ledger.contentRefFor("missing")).toBeUndefined();
  });
});

function createBlock(
  id: string,
  overrides: Partial<Omit<MIRContextBlock, "id">> = {},
): MIRContextBlock {
  return {
    id,
    contentRef: `fixture://${id}`,
    mutability: "fixed",
    provenance: {
      source: "system",
    },
    role: "system_instruction",
    ...overrides,
  };
}
