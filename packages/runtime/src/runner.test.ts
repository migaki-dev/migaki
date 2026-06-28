import { describe, expect, it } from "vitest";

import { MIR_V0_VERSION, type MIRPlan } from "@migaki/mir";
import { FakeClock } from "../../../src/testing/index.js";
import {
  PASS_CONTRACT_VERSION,
  runOptimizationPasses,
  type OptimizationPass,
  type PassResult,
} from "./index.js";

const basePlan = {
  id: "runner-plan",
  version: MIR_V0_VERSION,
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
    tags: [],
  },
  constraints: {},
  context: [],
  nodes: [],
  edges: [],
} satisfies MIRPlan;

describe("runOptimizationPasses", () => {
  it("runs passes in order and records deterministic fake-clock timing", async () => {
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
    const order: string[] = [];
    const firstPass = createTaggingPass("first", "first-tag", () => {
      order.push("first");
      clock.advanceBy(5);
    });
    const secondPass = createTaggingPass("second", "second-tag", () => {
      order.push("second");
      clock.advanceBy(7);
    });

    const report = await runOptimizationPasses(
      basePlan,
      [firstPass, secondPass],
      {
        clock,
        runId: "runner-test",
      },
    );

    expect(order).toEqual(["first", "second"]);
    expect(report.plan.metadata.tags).toEqual(["first-tag", "second-tag"]);
    expect(report.passes.map((pass) => pass.durationMs)).toEqual([5, 7]);
    expect(report.passes.map((pass) => pass.enabled)).toEqual([true, true]);
    expect(
      report.passes.map((pass) =>
        pass.enabled && "result" in pass ? pass.result.pass.name : undefined,
      ),
    ).toEqual(["first", "second"]);
  });

  it("represents disabled passes in metadata without running them", async () => {
    const clock = new FakeClock(0);
    const disabledPass = createTaggingPass("disabled", "should-not-appear");

    const report = await runOptimizationPasses(basePlan, [disabledPass], {
      clock,
      disabledPasses: [
        {
          name: "disabled",
          reason: "Not needed for this fixture.",
        },
      ],
      runId: "disabled-test",
    });

    expect(report.plan).toBe(basePlan);
    expect(report.passes).toEqual([
      {
        durationMs: 0,
        enabled: false,
        pass: {
          name: "disabled",
          version: "0.0.0",
        },
        reason: "Not needed for this fixture.",
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: "1970-01-01T00:00:00.000Z",
        warnings: [],
        evidence: [],
      },
    ]);
  });

  it("stops on failure and preserves prior successful pass output", async () => {
    const clock = new FakeClock(0);
    const firstPass = createTaggingPass("first", "first-tag", () => {
      clock.advanceBy(3);
    });
    const failingPass = createFailingPass("failing", () => {
      clock.advanceBy(2);
    });
    const neverPass = createTaggingPass("never", "never-tag");

    const report = await runOptimizationPasses(
      basePlan,
      [firstPass, failingPass, neverPass],
      {
        clock,
        failurePolicy: "stop",
        runId: "failure-test",
      },
    );

    expect(report.plan.metadata.tags).toEqual(["first-tag"]);
    expect(report.passes).toHaveLength(2);
    expect(report.passes[1]).toMatchObject({
      durationMs: 2,
      enabled: true,
      error: {
        message: "Pass failed intentionally.",
      },
      pass: {
        name: "failing",
        version: "0.0.0",
      },
    });
  });

  it("continues after failure when policy allows it", async () => {
    const clock = new FakeClock(0);
    const firstPass = createTaggingPass("first", "first-tag", () => {
      clock.advanceBy(3);
    });
    const failingPass = createFailingPass("failing", () => {
      clock.advanceBy(2);
    });
    const finalPass = createTaggingPass("final", "final-tag", () => {
      clock.advanceBy(5);
    });

    const report = await runOptimizationPasses(
      basePlan,
      [firstPass, failingPass, finalPass],
      {
        clock,
        failurePolicy: "continue",
        runId: "continue-test",
      },
    );

    expect(report.plan.metadata.tags).toEqual(["first-tag", "final-tag"]);
    expect(report.passes).toHaveLength(3);
    expect(report.passes.map((pass) => pass.durationMs)).toEqual([3, 2, 5]);
    expect(report.passes[1]).toMatchObject({
      error: {
        message: "Pass failed intentionally.",
      },
      pass: {
        name: "failing",
        version: "0.0.0",
      },
    });
  });
});

function createTaggingPass(
  name: string,
  tag: string,
  beforeReturn: () => void = () => undefined,
): OptimizationPass {
  return {
    name,
    version: "0.0.0",
    contractVersion: PASS_CONTRACT_VERSION,
    safety: {
      level: "deterministic",
    },
    async apply(plan: MIRPlan): Promise<PassResult> {
      beforeReturn();

      return {
        version: PASS_CONTRACT_VERSION,
        pass: {
          name,
          version: "0.0.0",
        },
        plan: {
          ...plan,
          metadata: {
            ...plan.metadata,
            tags: [...(plan.metadata.tags ?? []), tag],
          },
        },
        diff: {
          kind: "inline",
          changes: [
            {
              kind: "metadata_changed",
              path: "$.metadata.tags",
              description: `Added ${tag}.`,
            },
          ],
        },
        evidence: [
          {
            id: `evidence-${name}`,
            kind: "decision",
            summary: `Applied ${name}.`,
          },
        ],
        warnings: [],
      };
    },
  };
}

function createFailingPass(
  name: string,
  beforeThrow: () => void,
): OptimizationPass {
  return {
    name,
    version: "0.0.0",
    contractVersion: PASS_CONTRACT_VERSION,
    safety: {
      level: "deterministic",
    },
    async apply(): Promise<PassResult> {
      beforeThrow();
      throw new Error("Pass failed intentionally.");
    },
  };
}
