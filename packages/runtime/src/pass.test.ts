import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";
import {
  EVIDENCE_EVENT_VERSION,
  PASS_CONTRACT_VERSION,
  PLAN_DIFF_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassResult,
} from "./index.js";

const plan = {
  id: "pass-contract-plan",
  version: MIR_V0_VERSION,
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  constraints: {},
  context: [],
  nodes: [],
  edges: [],
} satisfies MIRPlan;

const fakePass = {
  name: "fake.noop",
  version: "0.0.0",
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.plan.validated",
      required: true,
      source: "mir",
    },
  ],
  outputCapabilities: [
    {
      name: "mir.plan.unchanged",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes: "No-op fake pass for contract coverage.",
  },
  async apply(inputPlan: MIRPlan, context: PassContext): Promise<PassResult> {
    return {
      version: PASS_CONTRACT_VERSION,
      pass: {
        name: "fake.noop",
        version: "0.0.0",
      },
      plan: inputPlan,
      diff: {
        version: PLAN_DIFF_VERSION,
        kind: "inline",
        changes: [],
      },
      evidence: [
        {
          version: EVIDENCE_EVENT_VERSION,
          id: "evidence-noop",
          kind: "pass_decision",
          passDecision: {
            decision: "applied",
            pass: {
              name: "fake.noop",
              version: "0.0.0",
            },
          },
          privacy: {
            privacyClass: "internal",
            replayMode: "metadata",
          },
          redaction: {
            mode: "none",
          },
          source: {
            kind: "pass",
            pass: {
              name: "fake.noop",
              version: "0.0.0",
            },
            runId: context.runId,
          },
          summary: `No changes for ${context.runId}.`,
        },
      ],
      warnings: [
        {
          code: "noop",
          message: "Fake pass emitted a warning fixture.",
          severity: "info",
        },
      ],
    };
  },
} satisfies OptimizationPass;

describe("optimization pass contract", () => {
  it("allows a tiny fake pass to return a complete result", async () => {
    const result = await fakePass.apply(plan, {
      runId: "pass-run-001",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      version: PASS_CONTRACT_VERSION,
      pass: {
        name: "fake.noop",
        version: "0.0.0",
      },
      plan,
      diff: {
        kind: "inline",
        version: PLAN_DIFF_VERSION,
        changes: [],
      },
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});
