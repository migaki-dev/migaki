import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDogfoodAdviceStatus,
  createDogfoodDoctorReport,
  evaluateDogfoodRootCause,
  evaluateDogfoodReadiness,
} from "./dogfood-doctor.js";
import { MIGAKI_SMOKE_REAL_TURN_MARKER } from "./execution-advice.js";
import type { ExecutionGraph } from "./execution.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("dogfood doctor report", () => {
  it("reports native hook coverage from events instead of merged graph metadata", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const runId = "codex-turn-native";

    await writeHookFiles(root);
    await writeRun({
      events: [
        event({
          hookEventName: "UserPromptSubmit",
          id: "prompt",
          lifecycle: "point",
          operationId: "prompt",
          operationKind: "user_prompt",
          runId,
        }),
        event({
          hookEventName: "PreToolUse",
          id: "tool-start",
          lifecycle: "start",
          operationId: "tool-1",
          operationKind: "tool_call",
          runId,
        }),
        event({
          hookEventName: "PostToolUse",
          id: "tool-finish",
          lifecycle: "finish",
          operationId: "tool-1",
          operationKind: "tool_call",
          runId,
          status: "ok",
        }),
        event({
          hookEventName: "Stop",
          id: "stop",
          lifecycle: "point",
          operationId: "turn",
          operationKind: "turn",
          runId,
          runStatus: "ok",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId,
        toolCalls: 1,
      }),
      runId,
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      strict: true,
      runsDirectory,
    });

    expect(report).toContain("Hook Coverage:");
    expect(report).toContain("Hook Config:");
    expect(report).toContain(
      "- Required events: ok (UserPromptSubmit, PreToolUse, PostToolUse, Stop)",
    );
    expect(report).toContain(
      "- Hook commands: 4/4 use the expected Migaki hook entrypoint command",
    );
    expect(report).toMatch(/- Trust fingerprint: sha256:[a-f0-9]{64}/u);
    expect(report).toContain(
      "- Hook events: UserPromptSubmit 1, PreToolUse 1, PostToolUse 1, Stop 1",
    );
    expect(report).toContain(
      "- Tool lifecycle: starts 1, finishes 1, completed turns 1",
    );
    expect(report).toContain(
      "- Native hook coverage: ok: prompt, tool, and stop hooks observed for the latest turn.",
    );
    expect(report).toContain("Native Baseline:");
    expect(report).toContain(
      "- Latest native-complete turn: codex-turn-native status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain("Strict Verification:");
    expect(report).toContain("- Result: ok");
    expect(report).toContain("- Failures: none");
    expect(
      createDogfoodAdviceStatus({
        hookConfigPath: join(root, ".codex", "hooks.json"),
        hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
        runsDirectory,
      }),
    ).toBeUndefined();
    expect(
      evaluateDogfoodReadiness({
        hookConfigPath: join(root, ".codex", "hooks.json"),
        hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
        runsDirectory,
      }),
    ).toMatchObject({
      mode: "organic-native",
      ok: true,
    });
  });

  it("recognizes the documented local-context hook command as the Migaki entrypoint", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const runId = "codex-turn-local-context-command";

    await writeHookFiles(root, {
      command:
        'MIGAKI_CODEX_LOCAL_CONTEXT=1 node "$(git rev-parse --show-toplevel)/packages/codex/dist/hook.js"',
    });
    await writeRun({
      events: nativeEvents(runId),
      graph: graph({
        nodeHookEventName: "Stop",
        runId,
        toolCalls: 1,
      }),
      runId,
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      strict: true,
      runsDirectory,
    });

    expect(report).toContain(
      "- Hook commands: 4/4 use the expected Migaki hook entrypoint command",
    );
    expect(report).toContain("- Unexpected commands: 0");
    expect(report).toContain("Strict Verification:");
    expect(report).toContain("- Result: ok");
    expect(report).not.toContain(
      "Hook config contains unexpected hook commands.",
    );
  });

  it("warns when the latest turn relies on manual exec supplementation", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const runId = "codex-turn-mixed";

    await writeHookFiles(root);
    await writeRun({
      events: [
        event({
          hookEventName: "UserPromptSubmit",
          id: "prompt",
          lifecycle: "point",
          operationId: "prompt",
          operationKind: "user_prompt",
          runId,
        }),
        event({
          adapter: "manual-exec",
          id: "manual-tool-start",
          lifecycle: "start",
          operationId: "manual-tool",
          operationKind: "tool_call",
          runId,
        }),
        event({
          adapter: "manual-exec",
          id: "manual-tool-finish",
          lifecycle: "finish",
          operationId: "manual-tool",
          operationKind: "tool_call",
          runId,
          status: "ok",
        }),
        event({
          adapter: "manual-exec",
          id: "manual-turn-finish",
          lifecycle: "point",
          operationId: "turn",
          operationKind: "turn",
          runId,
          runStatus: "ok",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "UserPromptSubmit",
        runId,
        toolCalls: 1,
      }),
      runId,
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      runsDirectory,
    });

    expect(report).toContain("- Hook events: UserPromptSubmit 1");
    expect(report).toContain("- Event sources: codex-hooks 1, manual-exec 3");
    expect(report).toContain(
      "- Native hook coverage: warning: missing PreToolUse, PostToolUse, Stop; latest turn includes manual-exec supplementation.",
    );
    expect(report).toContain("- Latest native-complete turn: none");
    expect(report).toContain(
      "- Keep using migaki:exec attachment as a bridge while verifying native Codex hook coverage above.",
    );
  });

  it("reports local Codex hook trust records for the project hook file", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const hookConfigPath = join(root, ".codex", "hooks.json");
    const codexConfigPath = join(root, "codex-home", "config.toml");

    await writeHookFiles(root);
    await writeCodexConfig({
      codexConfigPath,
      eventNames: ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"],
      hookConfigPath,
    });

    const report = createDogfoodDoctorReport({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      runsDirectory,
    });

    expect(report).toContain("Codex Hook Trust:");
    expect(report).toContain(
      "- Config: found (4 trusted hook record(s) for this hook file)",
    );
    expect(report).toContain(
      "- Required trust records: ok (UserPromptSubmit, PreToolUse, PostToolUse, Stop)",
    );
    expect(report).toContain(
      "- Trust note: this checks local Codex trusted-hash records only; review /hooks after hook definition changes.",
    );
  });

  it("explains when advice chooses older useful evidence over the latest native turn", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");

    await writeHookFiles(root);
    await writeRun({
      events: nativeEvents("codex-turn-useful-older"),
      graph: graphWithRepeatedFileOpportunity({
        runId: "codex-turn-useful-older",
      }),
      modifiedAt: new Date("2026-01-01T00:00:01.000Z"),
      runId: "codex-turn-useful-older",
      runsDirectory,
    });
    await writeRun({
      events: nativeEvents("codex-turn-native-newer"),
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-turn-native-newer",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:00:10.000Z"),
      runId: "codex-turn-native-newer",
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      nowMs: new Date("2026-01-01T00:00:15.000Z").getTime(),
      runsDirectory,
      strict: true,
    });

    expect(report).toContain(
      "- Selected: codex-turn-useful-older status=ok nodes=4 tools=2 opportunities=1",
    );
    expect(report).toContain(
      "- Selected updated: 2026-01-01T00:00:01.000Z (14s ago)",
    );
    expect(report).toContain(
      "- Selection note: selected advice is older than the latest organic turn because it has actionable signal and the latest organic turn has none.",
    );
    expect(report).toContain(
      "- Latest turn: codex-turn-native-newer status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain("- Result: ok");
  });

  it("does not treat smoke harness turns as organic dogfood proof", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const runId = "codex-turn-smoke-created-cli-proof";

    await writeHookFiles(root);
    await writeRun({
      events: nativeEvents(runId),
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId,
        toolCalls: 1,
      }),
      markerFiles: [MIGAKI_SMOKE_REAL_TURN_MARKER],
      modifiedAt: new Date("2026-01-01T00:00:10.000Z"),
      runId,
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:00:20.000Z").getTime(),
      runsDirectory,
      strict: true,
    });

    expect(report).toContain("- Skipped smoke-harness: 1");
    expect(report).toContain("Latest Turn Signal:");
    expect(report).toContain("- Status: missing");
    expect(report).toContain(
      "- Detail: no organic non-smoke codex-turn graph was found.",
    );
    expect(report).toContain("Smoke Harness:");
    expect(report).toContain(
      "- Latest smoke harness turn: codex-turn-smoke-created-cli-proof status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Harness result: ok: smoke-created CLI proof recorded native hooks; this is not accepted as organic dogfood evidence.",
    );
    expect(report).toContain("Strict Verification:");
    expect(report).toContain("- Result: failed");
    expect(report).toContain(
      "- Failure: No completed organic Codex turn was found.",
    );
  });

  it("identifies historical unmarked smoke harness turns by redacted prompt fingerprint", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const runId = "codex-turn-historical-smoke-created-cli-proof";

    await writeHookFiles(root);
    await writeRun({
      events: nativeEvents(runId),
      graph: smokeHarnessGraph({
        runId,
      }),
      modifiedAt: new Date("2026-01-01T00:00:10.000Z"),
      runId,
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      runsDirectory,
      strict: true,
    });

    expect(report).toContain("- Skipped smoke-harness: 1");
    expect(report).toContain(
      "- Latest smoke harness turn: codex-turn-historical-smoke-created-cli-proof status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Failure: No completed organic Codex turn was found.",
    );
  });

  it("defines the strict native Desktop dogfood acceptance matrix", async () => {
    const nowMs = new Date("2026-01-01T00:02:05.000Z").getTime();
    const maxRealAgeMs = 60_000;
    const scenarios: readonly {
      readonly adviceMode?: "bridge-active" | "bridge-required";
      readonly name: string;
      readonly readinessMode:
        | "bridge-active"
        | "bridge-required"
        | "organic-native";
      readonly readinessOk: boolean;
      readonly setup: (input: {
        readonly runsDirectory: string;
      }) => Promise<void>;
      readonly strictFailure?: string;
      readonly strictOk: boolean;
      readonly strictReportLine: string;
    }[] = [
      {
        name: "organic-native",
        readinessMode: "organic-native",
        readinessOk: true,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: nativeEvents("codex-turn-organic-native"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-organic-native",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-organic-native",
            runsDirectory,
          });
        },
        strictOk: true,
        strictReportLine: "- Strict dogfood: ok",
      },
      {
        adviceMode: "bridge-active",
        name: "bridge-active",
        readinessMode: "bridge-active",
        readinessOk: true,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-fresh"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-fresh",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:03.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-fresh",
            runsDirectory,
          });
          await writeRun({
            events: manualExecEvents("codex-app-bridge"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-app-bridge",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-app-bridge",
            runsDirectory,
          });
        },
        strictFailure: "No completed organic Codex turn was found.",
        strictOk: false,
        strictReportLine: "- Strict dogfood: failed",
      },
      {
        adviceMode: "bridge-required",
        name: "bridge-required",
        readinessMode: "bridge-required",
        readinessOk: false,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-only"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-only",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-only",
            runsDirectory,
          });
        },
        strictFailure: "No completed organic Codex turn was found.",
        strictOk: false,
        strictReportLine: "- Strict dogfood: failed",
      },
      {
        adviceMode: "bridge-required",
        name: "stale organic turns",
        readinessMode: "bridge-required",
        readinessOk: false,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: nativeEvents("codex-turn-organic-stale"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-organic-stale",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
            runId: "codex-turn-organic-stale",
            runsDirectory,
          });
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-stale"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-stale",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-stale",
            runsDirectory,
          });
        },
        strictFailure:
          "Latest organic Codex turn is stale: 2m 5s old exceeds 1m.",
        strictOk: false,
        strictReportLine: "- Strict dogfood: failed",
      },
      {
        adviceMode: "bridge-required",
        name: "mixed/manual turns",
        readinessMode: "bridge-required",
        readinessOk: false,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: [
              event({
                hookEventName: "UserPromptSubmit",
                id: "mixed-prompt",
                lifecycle: "point",
                operationId: "prompt",
                operationKind: "user_prompt",
                runId: "codex-turn-mixed-manual",
              }),
              ...manualExecEvents("codex-turn-mixed-manual"),
            ],
            graph: graph({
              nodeHookEventName: "UserPromptSubmit",
              runId: "codex-turn-mixed-manual",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-mixed-manual",
            runsDirectory,
          });
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-mixed"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-mixed",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:03.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-mixed",
            runsDirectory,
          });
        },
        strictFailure: "Latest organic Codex turn is not fully native.",
        strictOk: false,
        strictReportLine: "- Strict dogfood: failed",
      },
      {
        adviceMode: "bridge-required",
        name: "smoke/probe-only evidence",
        readinessMode: "bridge-required",
        readinessOk: false,
        setup: async ({ runsDirectory }) => {
          await writeRun({
            events: nativeEvents("codex-turn-smoke-created-cli-proof"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-smoke-created-cli-proof",
              toolCalls: 1,
            }),
            markerFiles: [MIGAKI_SMOKE_REAL_TURN_MARKER],
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-smoke-created-cli-proof",
            runsDirectory,
          });
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-only"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-only",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:03.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-only",
            runsDirectory,
          });
        },
        strictFailure: "No completed organic Codex turn was found.",
        strictOk: false,
        strictReportLine: "- Strict dogfood: failed",
      },
    ];

    for (const scenario of scenarios) {
      const root = await tempRoot();
      const runsDirectory = join(root, ".migaki", "runs");
      const hookConfigPath = join(root, ".codex", "hooks.json");
      const hookEntrypointPath = join(
        root,
        "packages",
        "codex",
        "dist",
        "hook.js",
      );

      await writeHookFiles(root);
      await scenario.setup({ runsDirectory });

      const report = createDogfoodDoctorReport({
        hookConfigPath,
        hookEntrypointPath,
        maxRealAgeMs,
        nowMs,
        runsDirectory,
        strict: true,
      });
      const readiness = evaluateDogfoodReadiness({
        hookConfigPath,
        hookEntrypointPath,
        maxRealAgeMs,
        nowMs,
        runsDirectory,
      });
      const adviceStatus = createDogfoodAdviceStatus({
        hookConfigPath,
        hookEntrypointPath,
        maxRealAgeMs,
        nowMs,
        runsDirectory,
      });

      expect(report, scenario.name).toContain("Strict Acceptance Contract:");
      expect(report, scenario.name).toContain(
        "- Terminal gate: `mise run migaki:dogfood` passes only after a fresh normal Codex Desktop turn in this repository records completed organic native hook evidence.",
      );
      expect(report, scenario.name).toContain(
        "- Not accepted: MIGAKI_BRIDGE_RUN_ID, migaki:bridge, manual attach/manual-exec, smoke harness, hook probe, CLI probe, or --include-smoke evidence.",
      );
      expect(report, scenario.name).toContain(
        scenario.strictOk ? "- Result: ok" : "- Result: failed",
      );

      if (scenario.strictFailure !== undefined) {
        expect(report, scenario.name).toContain(
          `- Failure: ${scenario.strictFailure}`,
        );
      }

      expect(readiness, scenario.name).toMatchObject({
        mode: scenario.readinessMode,
        ok: scenario.readinessOk,
      });
      expect(readiness.report, scenario.name).toContain(
        scenario.strictReportLine,
      );

      if (scenario.adviceMode === undefined) {
        expect(adviceStatus, scenario.name).toBeUndefined();
      } else {
        expect(adviceStatus, scenario.name).toContain(
          `- Mode: ${scenario.adviceMode}.`,
        );
      }
    }
  });

  it("reports stable root-cause diagnostics for Desktop native hook emission gaps", async () => {
    const nowMs = new Date("2026-01-01T00:02:05.000Z").getTime();
    const maxRealAgeMs = 60_000;
    const scenarios: readonly {
      readonly code: string;
      readonly expectedDetail?: string;
      readonly expectedNextAction: string;
      readonly name: string;
      readonly skipDefaultTrust?: boolean;
      readonly setup: (input: {
        readonly codexConfigPath: string;
        readonly hookConfigPath: string;
        readonly root: string;
        readonly runsDirectory: string;
      }) => Promise<void>;
      readonly summary: string;
    }[] = [
      {
        code: "native_complete",
        expectedNextAction:
          "Continue normal Desktop dogfooding; strict native evidence is fresh.",
        name: "fresh native success",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: nativeEvents("codex-turn-native"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-native",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-native",
            runsDirectory,
          });
        },
        summary: "Latest organic Desktop turn is native-complete and fresh.",
      },
      {
        code: "stale_organic_turn",
        expectedNextAction:
          "Run one fresh normal Desktop turn in this repository, then rerun migaki:dogfood.",
        name: "stale native evidence",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: nativeEvents("codex-turn-stale-native"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-stale-native",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
            runId: "codex-turn-stale-native",
            runsDirectory,
          });
        },
        summary: "Latest organic Desktop turn is native-complete but stale.",
      },
      {
        code: "mixed_manual_evidence",
        expectedNextAction:
          "Keep bridge/manual evidence separate and run a fresh normal Desktop turn with native tool hooks.",
        name: "mixed/manual turns",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: [
              event({
                hookEventName: "UserPromptSubmit",
                id: "mixed-prompt",
                lifecycle: "point",
                operationId: "prompt",
                operationKind: "user_prompt",
                runId: "codex-turn-mixed",
              }),
              ...manualExecEvents("codex-turn-mixed"),
            ],
            graph: graph({
              nodeHookEventName: "UserPromptSubmit",
              runId: "codex-turn-mixed",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-mixed",
            runsDirectory,
          });
        },
        summary: "Latest organic Desktop turn includes manual-exec evidence.",
      },
      {
        code: "bridge_only_readiness",
        expectedNextAction:
          "Use the bridge for app-surface work, but run a fresh normal Desktop turn before claiming strict dogfood.",
        name: "bridge-active fallback",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: manualExecEvents("codex-app-bridge"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-app-bridge",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-app-bridge",
            runsDirectory,
          });
        },
        summary:
          "Only bridge evidence is ready; strict Desktop dogfood still needs organic native hooks.",
      },
      {
        code: "hook_config_mismatch",
        expectedDetail: "unexpectedCommands=4",
        expectedNextAction:
          "Fix .codex/hooks.json so required events use the built Migaki hook command.",
        name: "hook-command mismatch",
        setup: async ({ root }) => {
          await writeHookFiles(root, {
            command: "node wrong-hook.js",
          });
        },
        summary:
          "Hook config does not match the expected Migaki Desktop hook command.",
      },
      {
        code: "missing_hook_trust",
        expectedDetail: "missingTrust=PreToolUse, PostToolUse",
        expectedNextAction:
          "Open /hooks in Codex Desktop and trust the missing Migaki hook events.",
        name: "missing trust records",
        setup: async ({ codexConfigPath, hookConfigPath, root }) => {
          await writeHookFiles(root);
          await writeCodexConfig({
            codexConfigPath,
            eventNames: ["UserPromptSubmit", "Stop"],
            hookConfigPath,
          });
        },
        skipDefaultTrust: true,
        summary:
          "Codex Desktop has not trusted all required Migaki hook events.",
      },
      {
        code: "no_organic_turn",
        expectedNextAction:
          "Run one normal Codex Desktop turn in this repository, then rerun migaki:doctor.",
        name: "no organic turn",
        setup: async ({ root }) => {
          await writeHookFiles(root);
        },
        summary: "No completed organic Desktop turn was found.",
      },
      {
        code: "missing_tool_hooks",
        expectedDetail: "missingHooks=PreToolUse, PostToolUse",
        expectedNextAction:
          "Run a fresh normal Desktop turn with a tool call and verify PreToolUse/PostToolUse emission.",
        name: "missing PreToolUse/PostToolUse",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: [
              event({
                hookEventName: "UserPromptSubmit",
                id: "prompt",
                lifecycle: "point",
                operationId: "prompt",
                operationKind: "user_prompt",
                runId: "codex-turn-no-tool-hooks",
              }),
              event({
                hookEventName: "Stop",
                id: "stop",
                lifecycle: "point",
                operationId: "turn",
                operationKind: "turn",
                runId: "codex-turn-no-tool-hooks",
                runStatus: "ok",
                status: "ok",
              }),
            ],
            graph: graph({
              nodeHookEventName: "Stop",
              runId: "codex-turn-no-tool-hooks",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-no-tool-hooks",
            runsDirectory,
          });
        },
        summary: "Latest organic Desktop turn is missing native tool hooks.",
      },
      {
        code: "missing_stop_hook",
        expectedDetail: "missingHooks=Stop",
        expectedNextAction:
          "Let the Desktop turn finish and verify Stop hook emission before rerunning migaki:dogfood.",
        name: "missing Stop",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: [
              event({
                hookEventName: "UserPromptSubmit",
                id: "prompt",
                lifecycle: "point",
                operationId: "prompt",
                operationKind: "user_prompt",
                runId: "codex-turn-no-stop",
              }),
              event({
                hookEventName: "PreToolUse",
                id: "tool-start",
                lifecycle: "start",
                operationId: "tool-1",
                operationKind: "tool_call",
                runId: "codex-turn-no-stop",
              }),
              event({
                hookEventName: "PostToolUse",
                id: "tool-finish",
                lifecycle: "finish",
                operationId: "tool-1",
                operationKind: "tool_call",
                runId: "codex-turn-no-stop",
                status: "ok",
              }),
            ],
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-no-stop",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-no-stop",
            runsDirectory,
          });
        },
        summary: "Latest organic Desktop turn is missing the Stop hook.",
      },
      {
        code: "app_surface_non_emission",
        expectedNextAction:
          "Use migaki:bridge for this app surface while verifying why normal Desktop turns are not emitting project hooks.",
        name: "app-surface non-emission",
        setup: async ({ root, runsDirectory }) => {
          await writeHookFiles(root);
          await writeRun({
            events: nativeEvents("codex-turn-migaki-smoke-hook-probe-ok"),
            graph: graph({
              nodeHookEventName: "PostToolUse",
              runId: "codex-turn-migaki-smoke-hook-probe-ok",
              toolCalls: 1,
            }),
            modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
            runId: "codex-turn-migaki-smoke-hook-probe-ok",
            runsDirectory,
          });
        },
        summary:
          "Hook probe is native-complete, but no organic Desktop turn is reaching the dogfood gate.",
      },
    ];

    for (const scenario of scenarios) {
      const root = await tempRoot();
      const runsDirectory = join(root, ".migaki", "runs");
      const hookConfigPath = join(root, ".codex", "hooks.json");
      const codexConfigPath = join(root, "codex-home", "config.toml");
      const hookEntrypointPath = join(
        root,
        "packages",
        "codex",
        "dist",
        "hook.js",
      );

      await scenario.setup({
        codexConfigPath,
        hookConfigPath,
        root,
        runsDirectory,
      });
      if (scenario.skipDefaultTrust !== true) {
        await writeCodexConfig({
          codexConfigPath,
          eventNames: ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"],
          hookConfigPath,
        });
      }

      const diagnostic = evaluateDogfoodRootCause({
        bridgeRunId: "codex-app-bridge",
        codexConfigPath,
        hookConfigPath,
        hookEntrypointPath,
        maxRealAgeMs,
        nowMs,
        runsDirectory,
      });
      const report = createDogfoodDoctorReport({
        bridgeRunId: "codex-app-bridge",
        codexConfigPath,
        hookConfigPath,
        hookEntrypointPath,
        maxRealAgeMs,
        nowMs,
        runsDirectory,
      });

      expect(diagnostic, scenario.name).toMatchObject({
        code: scenario.code,
        nextAction: scenario.expectedNextAction,
        summary: scenario.summary,
      });
      expect(report, scenario.name).toContain("Root Cause:");
      expect(report, scenario.name).toContain(`- Code: ${scenario.code}`);
      expect(report, scenario.name).toContain(`- Summary: ${scenario.summary}`);
      expect(report, scenario.name).toContain(
        `- Next action: ${scenario.expectedNextAction}`,
      );
      expect(report, scenario.name).not.toContain(root);

      if (scenario.expectedDetail !== undefined) {
        expect(report, scenario.name).toContain(
          `- Detail: ${scenario.expectedDetail}`,
        );
      }
    }
  });

  it("points at missing local Codex hook trust records before fresh-turn diagnosis", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const hookConfigPath = join(root, ".codex", "hooks.json");
    const codexConfigPath = join(root, "codex-home", "config.toml");

    await writeHookFiles(root);
    await writeCodexConfig({
      codexConfigPath,
      eventNames: ["UserPromptSubmit", "Stop"],
      hookConfigPath,
    });

    const report = createDogfoodDoctorReport({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      runsDirectory,
    });

    expect(report).toContain(
      "- Required trust records: missing PreToolUse, PostToolUse",
    );
    expect(report).toContain(
      "- Trust missing Migaki hook events in Codex Desktop with /hooks: PreToolUse, PostToolUse.",
    );
  });

  it("reports missing required hook config events in strict mode", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");

    await writeHookFiles(root, {
      eventNames: ["UserPromptSubmit", "Stop"],
    });
    await writeRun({
      events: nativeEvents("codex-turn-native"),
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-turn-native",
        toolCalls: 1,
      }),
      runId: "codex-turn-native",
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      hookConfigPath: join(root, ".codex", "hooks.json"),
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      runsDirectory,
      strict: true,
    });

    expect(report).toContain(
      "- Required events: missing PreToolUse, PostToolUse",
    );
    expect(report).toContain(
      "- Failure: Hook config is missing required events: PreToolUse, PostToolUse.",
    );
  });

  it("points to an older native-complete turn when the newest turn is mixed", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const hookConfigPath = join(root, ".codex", "hooks.json");
    const codexConfigPath = join(root, "codex-home", "config.toml");

    await writeHookFiles(root);
    await writeCodexConfig({
      codexConfigPath,
      eventNames: ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"],
      hookConfigPath,
    });
    await writeRun({
      events: nativeEvents("codex-turn-native-older"),
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-turn-native-older",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:00:01.000Z"),
      runId: "codex-turn-native-older",
      runsDirectory,
    });
    await writeRun({
      events: [
        event({
          hookEventName: "UserPromptSubmit",
          id: "prompt",
          lifecycle: "point",
          operationId: "prompt",
          operationKind: "user_prompt",
          runId: "codex-turn-mixed-newer",
        }),
        event({
          adapter: "manual-exec",
          id: "manual-tool-start",
          lifecycle: "start",
          operationId: "manual-tool",
          operationKind: "tool_call",
          runId: "codex-turn-mixed-newer",
        }),
        event({
          adapter: "manual-exec",
          id: "manual-tool-finish",
          lifecycle: "finish",
          operationId: "manual-tool",
          operationKind: "tool_call",
          runId: "codex-turn-mixed-newer",
          status: "ok",
        }),
        event({
          adapter: "manual-exec",
          id: "manual-turn-finish",
          lifecycle: "point",
          operationId: "turn",
          operationKind: "turn",
          runId: "codex-turn-mixed-newer",
          runStatus: "ok",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "UserPromptSubmit",
        runId: "codex-turn-mixed-newer",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:00:02.000Z"),
      runId: "codex-turn-mixed-newer",
      runsDirectory,
    });
    await writeRun({
      events: nativeEvents("codex-turn-migaki-smoke-hook-probe-newest"),
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-turn-migaki-smoke-hook-probe-newest",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:00:03.000Z"),
      runId: "codex-turn-migaki-smoke-hook-probe-newest",
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
      strict: true,
    });

    expect(report).toContain(
      "- Latest turn: codex-turn-mixed-newer status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Latest turn updated: 2026-01-01T00:00:02.000Z (2m 3s ago)",
    );
    expect(report).toContain("Hook Probe:");
    expect(report).toContain(
      "- Latest probe: codex-turn-migaki-smoke-hook-probe-newest status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Probe updated: 2026-01-01T00:00:03.000Z (2m 2s ago)",
    );
    expect(report).toContain(
      "- Probe result: ok: built hook entrypoint recorded native prompt, tool, and stop hooks.",
    );
    expect(report).toContain(
      "- Latest native-complete turn: codex-turn-native-older status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Native baseline updated: 2026-01-01T00:00:01.000Z (2m 4s ago)",
    );
    expect(report).toContain(
      "- Local hook trust records and the hook probe are ok; run a fresh normal Desktop turn with a tool call, then rerun migaki:dogfood.",
    );
    expect(report).toContain("Recent Organic Turns:");
    expect(report).toContain("- Verdicts: mixed-manual 1, native-complete 1");
    expect(report).toContain("- Newest streak: mixed-manual x1");
    expect(report).toContain(
      "- Pattern: recent-regression: newest 1 organic turn(s) are mixed-manual; older native-complete evidence exists.",
    );
    expect(report).toContain(
      "- codex-turn-mixed-newer: mixed-manual; updated 2026-01-01T00:00:02.000Z (2m 3s ago); hooks UserPromptSubmit 1; sources codex-hooks 1, manual-exec 3",
    );
    expect(report).toContain(
      "- codex-turn-native-older: native-complete; updated 2026-01-01T00:00:01.000Z (2m 4s ago); hooks UserPromptSubmit 1, PreToolUse 1, PostToolUse 1, Stop 1; sources codex-hooks 4",
    );
    expect(report).not.toContain(
      "- codex-turn-migaki-smoke-hook-probe-newest: native-complete;",
    );
    expect(report).toContain("Strict Verification:");
    expect(report).toContain("- Result: failed");
    expect(report).toContain(
      "- Failure: Latest organic Codex turn is not fully native.",
    );
    expect(report).toContain(
      "- Failure: Latest organic Codex turn is stale: 2m 3s old exceeds 1m.",
    );
    expect(report).toContain("Desktop Verification:");
    expect(report).toContain(
      "- State: latest organic turn is mixed-manual and stale for the strict window.",
    );
    expect(report).toContain(
      "- Trust check: local Codex config has trusted-hash records for the required Migaki hook events; if Desktop still prompts, re-review /hooks for the fingerprint shown above.",
    );
    expect(report).toContain(
      "- Entrypoint check: latest hook probe is native-complete, so focus on Desktop trust/context rather than hook code.",
    );
    expect(report).toContain(
      "- Fresh-turn check: start one normal Codex Desktop turn in this repository and ask it to run `. scripts/env && printf migaki-dogfood-fresh-turn >/dev/null`, then let the turn finish.",
    );
    expect(report).toContain(
      "- Gate: rerun mise run migaki:dogfood; success means the latest organic turn is native-complete and fresh.",
    );
    expect(report).toContain("Surface Reality:");
    expect(report).toContain(
      "- Infrastructure proof: hook probe is native-complete.",
    );
    expect(report).toContain(
      "- Organic proof: latest organic turn is mixed-manual and stale for the strict window.",
    );
    expect(report).toContain(
      "- Interpretation: hook plumbing works in controlled probes, but no fresh organic Codex turn is reaching the dogfood gate yet.",
    );
    expect(report).toContain(
      "- App-surface check: if you just ran a tool in this Codex app thread, this surface is not emitting project hooks for those tool calls; use migaki:bridge as an explicit bridge while fixing native emission.",
    );
    expect(report).toContain("Bridge Evidence:");
    expect(report).toContain("- Mode: bridge-required");
    expect(report).toContain("- Bridge run id: `codex-app-bridge`");
    expect(report).toContain(
      "- Result: missing: no graph exists for this bridge run.",
    );
    expect(report).toContain(
      "- Command pattern: run shell work through `mise run migaki:bridge -- -- <command> [args...]` until native app hooks appear.",
    );
    expect(report).toContain(
      "- Shell setup: run `eval \"$(mise run migaki:bridge-session -- --shell --run 'codex-app-bridge')\"`, then `mgb <command> [args...]`.",
    );
    expect(report).toContain(
      "- Diagnostic pattern: run `export MIGAKI_BRIDGE_RUN_ID='codex-app-bridge'` once, or pass `--bridge-run 'codex-app-bridge'` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.",
    );

    const adviceStatus = createDogfoodAdviceStatus({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(adviceStatus).toContain("Dogfood Status:");
    expect(adviceStatus).toContain("- Mode: bridge-required.");
    expect(adviceStatus).toContain(
      "- Infrastructure proof: hook probe is native-complete.",
    );
    expect(adviceStatus).toContain(
      "- Organic proof: latest organic turn is mixed-manual and stale for the strict window.",
    );
    expect(adviceStatus).toContain("- Bridge run id: `codex-app-bridge`.");
    expect(adviceStatus).toContain(
      "- Command pattern: run shell work through `mise run migaki:bridge -- -- <command> [args...]` until native app hooks appear.",
    );
    expect(adviceStatus).toContain(
      "- Shell setup: run `eval \"$(mise run migaki:bridge-session -- --shell --run 'codex-app-bridge')\"`, then `mgb <command> [args...]`.",
    );
    expect(adviceStatus).toContain(
      "- Diagnostic pattern: run `export MIGAKI_BRIDGE_RUN_ID='codex-app-bridge'` once, or pass `--bridge-run 'codex-app-bridge'` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.",
    );
    expect(adviceStatus).not.toContain("<bridge-run-id>");
    expect(
      evaluateDogfoodReadiness({
        codexConfigPath,
        hookConfigPath,
        hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
        maxRealAgeMs: 60_000,
        nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
        runsDirectory,
      }),
    ).toMatchObject({
      mode: "bridge-required",
      ok: false,
    });

    await writeRun({
      events: [
        event({
          adapter: "manual-exec",
          id: "bridge-tool-start",
          lifecycle: "start",
          operationId: "bridge-tool",
          operationKind: "tool_call",
          runId: "codex-app-bridge",
        }),
        event({
          adapter: "manual-exec",
          id: "bridge-tool-finish",
          lifecycle: "finish",
          operationId: "bridge-tool",
          operationKind: "tool_call",
          runId: "codex-app-bridge",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-app-bridge",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
      runId: "codex-app-bridge",
      runsDirectory,
    });

    const activeReport = createDogfoodDoctorReport({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
      strict: true,
    });
    const activeAdviceStatus = createDogfoodAdviceStatus({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(activeReport).toContain("Bridge Evidence:");
    expect(activeReport).toContain("- Mode: bridge-active");
    expect(activeReport).toContain(
      "- Bridge proof: codex-app-bridge status=ok nodes=3 tools=1 opportunities=0 updated 2026-01-01T00:02:04.000Z (1s ago); sources manual-exec 2.",
    );
    expect(activeReport).toContain(
      "- Result: ok: bridge evidence is fresh, completed, and manual-exec-backed.",
    );
    expect(activeAdviceStatus).toContain("- Mode: bridge-active.");
    expect(activeAdviceStatus).toContain(
      "- Bridge proof: codex-app-bridge status=ok nodes=3 tools=1 opportunities=0 updated 2026-01-01T00:02:04.000Z (1s ago); sources manual-exec 2.",
    );
    const activeReadiness = evaluateDogfoodReadiness({
      codexConfigPath,
      hookConfigPath,
      hookEntrypointPath: join(root, "packages", "codex", "dist", "hook.js"),
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(activeReadiness).toMatchObject({
      mode: "bridge-active",
      ok: true,
    });
    expect(activeReadiness.report).toContain("# Migaki Ready Gate");
    expect(activeReadiness.report).toContain("- Result: ok");
    expect(activeReadiness.report).toContain("- Mode: bridge-active");
    expect(activeReadiness.report).toContain(
      "- Diagnostic pattern: run `export MIGAKI_BRIDGE_RUN_ID='codex-app-bridge'` once, or pass `--bridge-run 'codex-app-bridge'` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.",
    );
    expect(activeReadiness.report).toContain(
      "- Shell setup: run `eval \"$(mise run migaki:bridge-session -- --shell --run 'codex-app-bridge')\"`, then `mgb <command> [args...]`.",
    );
    expect(activeReadiness.report).toContain(
      "- Note: strict migaki:dogfood still requires fresh organic native hooks.",
    );
  });

  it("uses an explicit bridge run id for bridge diagnostics", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const hookConfigPath = join(root, ".codex", "hooks.json");
    const hookEntrypointPath = join(
      root,
      "packages",
      "codex",
      "dist",
      "hook.js",
    );

    await writeHookFiles(root);
    await writeRun({
      events: [
        event({
          adapter: "manual-exec",
          id: "custom-bridge-tool-start",
          lifecycle: "start",
          operationId: "custom-bridge-tool",
          operationKind: "tool_call",
          runId: "custom-bridge-run",
        }),
        event({
          adapter: "manual-exec",
          id: "custom-bridge-tool-finish",
          lifecycle: "finish",
          operationId: "custom-bridge-tool",
          operationKind: "tool_call",
          runId: "custom-bridge-run",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "custom-bridge-run",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:02:04.000Z"),
      runId: "custom-bridge-run",
      runsDirectory,
    });
    await writeRun({
      events: [
        event({
          adapter: "manual-exec",
          id: "default-bridge-tool-start",
          lifecycle: "start",
          operationId: "default-bridge-tool",
          operationKind: "tool_call",
          runId: "codex-app-bridge",
        }),
        event({
          adapter: "manual-exec",
          id: "default-bridge-tool-finish",
          lifecycle: "finish",
          operationId: "default-bridge-tool",
          operationKind: "tool_call",
          runId: "codex-app-bridge",
          status: "ok",
        }),
      ],
      graph: graph({
        nodeHookEventName: "PostToolUse",
        runId: "codex-app-bridge",
        toolCalls: 1,
      }),
      modifiedAt: new Date("2026-01-01T00:02:05.000Z"),
      runId: "codex-app-bridge",
      runsDirectory,
    });

    const report = createDogfoodDoctorReport({
      bridgeRunId: "custom-bridge-run",
      hookConfigPath,
      hookEntrypointPath,
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });
    const readiness = evaluateDogfoodReadiness({
      bridgeRunId: "custom-bridge-run",
      hookConfigPath,
      hookEntrypointPath,
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(report).toContain(
      "- Selected: custom-bridge-run status=ok nodes=3 tools=1 opportunities=0",
    );
    expect(report).toContain(
      "- Selection note: selected advice is the requested bridge run; strict organic dogfood status is reported separately below.",
    );
    expect(report).toContain("- Mode: bridge-active");
    expect(report).toContain(
      "- Bridge proof: custom-bridge-run status=ok nodes=3 tools=1 opportunities=0 updated 2026-01-01T00:02:04.000Z (1s ago); sources manual-exec 2.",
    );
    expect(report).toContain(
      "- Command pattern: run shell work through `mise run migaki:bridge -- --run 'custom-bridge-run' -- <command> [args...]` until native app hooks appear.",
    );
    expect(report).toContain(
      "- Shell setup: run `eval \"$(mise run migaki:bridge-session -- --shell --run 'custom-bridge-run')\"`, then `mgb <command> [args...]`.",
    );
    expect(report).toContain(
      "- Diagnostic pattern: run `export MIGAKI_BRIDGE_RUN_ID='custom-bridge-run'` once, or pass `--bridge-run 'custom-bridge-run'` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.",
    );
    expect(readiness).toMatchObject({
      mode: "bridge-active",
      ok: true,
    });
  });

  it("prints a scoped next command when an explicit bridge run is missing", async () => {
    const root = await tempRoot();
    const runsDirectory = join(root, ".migaki", "runs");
    const hookConfigPath = join(root, ".codex", "hooks.json");
    const hookEntrypointPath = join(
      root,
      "packages",
      "codex",
      "dist",
      "hook.js",
    );

    await writeHookFiles(root);

    const readiness = evaluateDogfoodReadiness({
      bridgeRunId: "missing-bridge-run",
      hookConfigPath,
      hookEntrypointPath,
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(readiness).toMatchObject({
      mode: "bridge-required",
      ok: false,
    });
    expect(readiness.report).toContain("- Bridge run id: `missing-bridge-run`");
    expect(readiness.report).toContain(
      "- Next: run `mise run migaki:bridge -- --run 'missing-bridge-run' -- <command> [args...]`, then rerun this gate.",
    );
    expect(readiness.report).toContain(
      "- Shell setup: run `eval \"$(mise run migaki:bridge-session -- --shell --run 'missing-bridge-run')\"`, then `mgb <command> [args...]`.",
    );
    expect(readiness.report).toContain(
      "- Diagnostic pattern: run `export MIGAKI_BRIDGE_RUN_ID='missing-bridge-run'` once, or pass `--bridge-run 'missing-bridge-run'` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.",
    );

    const quotedRunReadiness = evaluateDogfoodReadiness({
      bridgeRunId: "bridge'run",
      hookConfigPath,
      hookEntrypointPath,
      maxRealAgeMs: 60_000,
      nowMs: new Date("2026-01-01T00:02:05.000Z").getTime(),
      runsDirectory,
    });

    expect(quotedRunReadiness.report).toContain(
      "--shell --run 'bridge'\\''run'",
    );
    expect(quotedRunReadiness.report).toContain(
      "--run 'bridge'\\''run' -- <command>",
    );
    expect(quotedRunReadiness.report).toContain(
      "MIGAKI_BRIDGE_RUN_ID='bridge'\\''run'",
    );
    expect(quotedRunReadiness.report).toContain(
      "export MIGAKI_BRIDGE_RUN_ID='bridge'\\''run'",
    );
    expect(quotedRunReadiness.report).toContain(
      "--bridge-run 'bridge'\\''run'",
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "migaki-dogfood-doctor-"));

  tempDirectories.push(directory);

  return directory;
}

async function writeRun(input: {
  readonly events: readonly unknown[];
  readonly graph: ExecutionGraph;
  readonly markerFiles?: readonly string[];
  readonly modifiedAt?: Date;
  readonly runId: string;
  readonly runsDirectory: string;
}): Promise<void> {
  const runDirectory = join(input.runsDirectory, input.runId);
  const graphPath = join(runDirectory, "graph.json");

  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    join(runDirectory, "events.jsonl"),
    `${input.events.map((eventLine) => JSON.stringify(eventLine)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    graphPath,
    `${JSON.stringify(input.graph, null, 2)}\n`,
    "utf8",
  );
  await Promise.all(
    (input.markerFiles ?? []).map((markerFile) =>
      writeFile(
        join(runDirectory, markerFile),
        '{"version":"migaki.smoke-real-turn.v0","origin":"migaki:smoke"}\n',
        "utf8",
      ),
    ),
  );

  if (input.modifiedAt !== undefined) {
    await utimes(graphPath, input.modifiedAt, input.modifiedAt);
  }
}

async function writeHookFiles(
  root: string,
  options: {
    readonly command?: string;
    readonly eventNames?: readonly string[];
  } = {},
): Promise<void> {
  const hookConfigPath = join(root, ".codex", "hooks.json");
  const hookEntrypointPath = join(root, "packages", "codex", "dist", "hook.js");
  const eventNames = options.eventNames ?? [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
  ];
  const command =
    options.command ??
    'node "$(git rev-parse --show-toplevel)/packages/codex/dist/hook.js"';

  await mkdir(join(root, ".codex"), { recursive: true });
  await mkdir(join(root, "packages", "codex", "dist"), { recursive: true });
  await writeFile(
    hookConfigPath,
    `${JSON.stringify(
      {
        hooks: Object.fromEntries(
          eventNames.map((eventName) => [
            eventName,
            [
              {
                hooks: [
                  {
                    command,
                    type: "command",
                  },
                ],
              },
            ],
          ]),
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(hookEntrypointPath, "#!/usr/bin/env node\n", "utf8");
}

async function writeCodexConfig(input: {
  readonly codexConfigPath: string;
  readonly eventNames: readonly string[];
  readonly hookConfigPath: string;
}): Promise<void> {
  await mkdir(join(input.codexConfigPath, ".."), { recursive: true });
  await writeFile(
    input.codexConfigPath,
    [
      "[hooks.state]",
      ...input.eventNames.flatMap((eventName) => [
        `[hooks.state."${input.hookConfigPath}:${codexHookStateEventName(eventName)}:0:0"]`,
        `trusted_hash = "${trustedHashFor(eventName)}"`,
      ]),
      "",
    ].join("\n"),
    "utf8",
  );
}

function codexHookStateEventName(eventName: string): string {
  return eventName.replace(
    /[A-Z]/gu,
    (character, offset) =>
      `${offset === 0 ? "" : "_"}${character.toLowerCase()}`,
  );
}

function trustedHashFor(eventName: string): string {
  return `sha256:${eventName
    .padEnd(64, eventName.toLowerCase())
    .slice(0, 64)
    .replace(/[^a-f0-9]/gu, "a")}`;
}

function graph(input: {
  readonly nodeHookEventName: string;
  readonly runId: string;
  readonly toolCalls: number;
}): ExecutionGraph {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    edges: [],
    endedAt: "2026-01-01T00:00:03.000Z",
    metadata: {},
    nodes: [
      node({
        hookEventName: "UserPromptSubmit",
        id: "prompt",
        kind: "user_prompt",
        name: "User prompt",
      }),
      ...Array.from({ length: input.toolCalls }, (_, index) =>
        node({
          hookEventName: input.nodeHookEventName,
          id: `tool-${index + 1}`,
          kind: "tool_call",
          name: "Bash",
        }),
      ),
      node({
        hookEventName: "Stop",
        id: "turn",
        kind: "turn",
        name: "Turn completed",
      }),
    ],
    runId: input.runId,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "ok",
    version: "migaki.execution-graph.v0",
  };
}

function graphWithRepeatedFileOpportunity(input: {
  readonly runId: string;
}): ExecutionGraph {
  const baseGraph = graph({
    nodeHookEventName: "PostToolUse",
    runId: input.runId,
    toolCalls: 2,
  });

  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((graphNode) => {
      if (graphNode.operation.kind !== "tool_call") {
        return graphNode;
      }

      return {
        ...graphNode,
        artifacts: [
          {
            fingerprint: "sha256:repeated-file",
            id: `${graphNode.id}-file`,
            kind: "file",
          },
        ],
      };
    }),
  };
}

function smokeHarnessGraph(input: { readonly runId: string }): ExecutionGraph {
  const baseGraph = graph({
    nodeHookEventName: "PostToolUse",
    runId: input.runId,
    toolCalls: 1,
  });

  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((graphNode) => {
      if (graphNode.operation.kind !== "user_prompt") {
        return graphNode;
      }

      return {
        ...graphNode,
        artifacts: [
          {
            fingerprint:
              "sha256:2a3576df2778c886810e72ffc355841b8b4c499eee6cad5e16227d968cc1adc9",
            id: "prompt-input",
            kind: "prompt",
          },
        ],
        operation: {
          ...graphNode.operation,
          fingerprint:
            "sha256:2a3576df2778c886810e72ffc355841b8b4c499eee6cad5e16227d968cc1adc9",
        },
      };
    }),
  };
}

function node(input: {
  readonly hookEventName: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}): ExecutionGraph["nodes"][number] {
  return {
    artifacts: [],
    dependencies: [],
    endedAt: "2026-01-01T00:00:01.000Z",
    id: input.id,
    metadata: {
      source: {
        adapter: "codex-hooks",
        hookEventName: input.hookEventName,
      },
    },
    metrics: {},
    operation: {
      id: input.id,
      kind: input.kind,
      name: input.name,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "ok",
  };
}

function nativeEvents(runId: string): readonly unknown[] {
  return [
    event({
      hookEventName: "UserPromptSubmit",
      id: `${runId}-prompt`,
      lifecycle: "point",
      operationId: "prompt",
      operationKind: "user_prompt",
      runId,
    }),
    event({
      hookEventName: "PreToolUse",
      id: `${runId}-tool-start`,
      lifecycle: "start",
      operationId: "tool-1",
      operationKind: "tool_call",
      runId,
    }),
    event({
      hookEventName: "PostToolUse",
      id: `${runId}-tool-finish`,
      lifecycle: "finish",
      operationId: "tool-1",
      operationKind: "tool_call",
      runId,
      status: "ok",
    }),
    event({
      hookEventName: "Stop",
      id: `${runId}-stop`,
      lifecycle: "point",
      operationId: "turn",
      operationKind: "turn",
      runId,
      runStatus: "ok",
      status: "ok",
    }),
  ];
}

function manualExecEvents(runId: string): readonly unknown[] {
  return [
    event({
      adapter: "manual-exec",
      id: `${runId}-manual-tool-start`,
      lifecycle: "start",
      operationId: "manual-tool",
      operationKind: "tool_call",
      runId,
    }),
    event({
      adapter: "manual-exec",
      id: `${runId}-manual-tool-finish`,
      lifecycle: "finish",
      operationId: "manual-tool",
      operationKind: "tool_call",
      runId,
      status: "ok",
    }),
    event({
      adapter: "manual-exec",
      id: `${runId}-manual-turn-finish`,
      lifecycle: "point",
      operationId: "turn",
      operationKind: "turn",
      runId,
      runStatus: "ok",
      status: "ok",
    }),
  ];
}

function event(input: {
  readonly adapter?: string;
  readonly hookEventName?: string;
  readonly id: string;
  readonly lifecycle: "finish" | "point" | "start";
  readonly operationId: string;
  readonly operationKind: string;
  readonly runId: string;
  readonly runStatus?: "ok";
  readonly status?: "ok";
}): unknown {
  return {
    id: input.id,
    lifecycle: input.lifecycle,
    metadata: {
      source: {
        adapter: input.adapter ?? "codex-hooks",
        ...(input.hookEventName !== undefined
          ? { hookEventName: input.hookEventName }
          : {}),
      },
    },
    occurredAt: "2026-01-01T00:00:00.000Z",
    operation: {
      id: input.operationId,
      kind: input.operationKind,
    },
    runId: input.runId,
    ...(input.runStatus !== undefined ? { runStatus: input.runStatus } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    version: "migaki.execution-event.v0",
  };
}
