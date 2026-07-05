import { pathToFileURL } from "node:url";

import { finishManualRun } from "./manual-exec.js";

export interface ManualFinishCliIO {
  readonly stderr: NodeJS.WritableStream;
  readonly stdout: NodeJS.WritableStream;
}

interface ParsedManualFinishArgs {
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

export async function runManualFinishCli(
  args: readonly string[],
  io: ManualFinishCliIO = {
    stderr: process.stderr,
    stdout: process.stdout,
  },
): Promise<number> {
  let parsed: ParsedManualFinishArgs;

  try {
    parsed = parseManualFinishArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n\n${manualFinishUsage()}`);

      return 2;
    }

    throw error;
  }

  if (parsed.help) {
    io.stdout.write(manualFinishUsage());

    return 0;
  }

  const result = await finishManualRun({
    ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
    ...(parsed.storeDirectory !== undefined
      ? { storeDirectory: parsed.storeDirectory }
      : {}),
  });

  if (!result.finished) {
    io.stderr.write("No running Codex turn was available to finish.\n");

    return 1;
  }

  io.stderr.write(`Migaki finished run ${result.runId}.\n`);

  return 0;
}

export function manualFinishUsage(): string {
  return [
    "Usage: scripts/migaki-finish [options]",
    "",
    "Mark a running Migaki Codex turn complete without running another command.",
    "",
    "Options:",
    "  --run <run-id>       Finish an explicit Migaki run id.",
    "  --store <directory>  Store root. Defaults to .migaki.",
    "  -h, --help           Show this help.",
    "",
  ].join("\n");
}

function parseManualFinishArgs(
  args: readonly string[],
): ParsedManualFinishArgs {
  let runId: string | undefined;
  let storeDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return {
        help: true,
      };
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

    throw new UsageError(`Unknown argument: ${arg}`);
  }

  return {
    help: false,
    ...(runId !== undefined ? { runId } : {}),
    ...(storeDirectory !== undefined ? { storeDirectory } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runManualFinishCli(process.argv.slice(2));
}
