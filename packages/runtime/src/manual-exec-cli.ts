import { pathToFileURL } from "node:url";

import {
  ManualRunTargetNotFoundError,
  runManualCommand,
  type ManualCommandRunResult,
} from "./manual-exec.js";

export interface ManualExecCliIO {
  readonly stderr: NodeJS.WritableStream;
  readonly stdout: NodeJS.WritableStream;
}

export interface ManualExecCliEnvironment {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

interface ParsedManualExecArgs {
  readonly attachLatestRunning: boolean;
  readonly commandArgs: readonly string[];
  readonly finishAttachedRun: boolean;
  readonly help: boolean;
  readonly runId?: string;
  readonly storeDirectory?: string;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export async function runManualExecCli(
  args: readonly string[],
  io: ManualExecCliIO = {
    stderr: process.stderr,
    stdout: process.stdout,
  },
  environment: ManualExecCliEnvironment = {
    cwd: process.cwd(),
    env: process.env,
  },
): Promise<number> {
  let parsed: ParsedManualExecArgs;

  try {
    parsed = parseManualExecArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n\n${manualExecUsage()}`);

      return 2;
    }

    throw error;
  }

  if (parsed.help) {
    io.stdout.write(manualExecUsage());

    return 0;
  }

  let result: ManualCommandRunResult;

  try {
    result = await runManualCommand({
      attachLatestRunning: parsed.attachLatestRunning,
      commandArgs: parsed.commandArgs,
      cwd: environment.cwd,
      env: environment.env,
      finishAttachedRun: parsed.finishAttachedRun,
      ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
      stdio: "inherit",
      ...(parsed.storeDirectory !== undefined
        ? { storeDirectory: parsed.storeDirectory }
        : {}),
    });
  } catch (error) {
    if (error instanceof ManualRunTargetNotFoundError) {
      io.stderr.write(
        `${error.message} Omit --attach-latest-running or pass --run <run-id> to create a separate manual run.\n`,
      );

      return 1;
    }

    throw error;
  }

  io.stderr.write(
    `Migaki recorded command evidence in ${result.runId} (${result.status}${result.finishedRun ? ", completed run" : ""}).\n`,
  );

  return result.exitCode;
}

export function manualExecUsage(): string {
  return [
    "Usage: scripts/migaki-exec [options] [--] <command> [args...]",
    "",
    "Run a command normally while recording redacted Migaki command evidence.",
    "",
    "Options:",
    "  --run <run-id>             Record into an explicit Migaki run id.",
    "  --store <directory>        Store root. Defaults to .migaki.",
    "  --attach-latest-running    Attach to the newest running non-smoke Codex turn; fail if none exists.",
    "  --finish-attached-run      Mark an attached running turn complete after the command.",
    "  -h, --help                 Show this help.",
    "",
  ].join("\n");
}

function parseManualExecArgs(args: readonly string[]): ParsedManualExecArgs {
  let attachLatestRunning = false;
  let finishAttachedRun = false;
  let runId: string | undefined;
  let storeDirectory: string | undefined;
  const commandArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return {
        attachLatestRunning: false,
        commandArgs: [],
        finishAttachedRun: false,
        help: true,
      };
    }

    if (arg === "--") {
      commandArgs.push(...args.slice(index + 1));
      break;
    }

    if (arg === "--attach-latest-running") {
      attachLatestRunning = true;
      continue;
    }

    if (arg === "--finish-attached-run") {
      finishAttachedRun = true;
      continue;
    }

    if (arg === "--run") {
      const value = args[index + 1];

      if (value === undefined) {
        throw new UsageError("--run requires a value.");
      }

      runId = value;
      index += 1;
      continue;
    }

    if (arg === "--store") {
      const value = args[index + 1];

      if (value === undefined) {
        throw new UsageError("--store requires a value.");
      }

      storeDirectory = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new UsageError(`Unknown option: ${arg}`);
    }

    commandArgs.push(arg, ...args.slice(index + 1));
    break;
  }

  if (commandArgs.length === 0) {
    throw new UsageError("Command is required.");
  }

  if (finishAttachedRun && !attachLatestRunning) {
    throw new UsageError(
      "--finish-attached-run requires --attach-latest-running.",
    );
  }

  return {
    attachLatestRunning,
    commandArgs,
    finishAttachedRun,
    help: false,
    ...(runId !== undefined ? { runId } : {}),
    ...(storeDirectory !== undefined ? { storeDirectory } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runManualExecCli(process.argv.slice(2));
}
