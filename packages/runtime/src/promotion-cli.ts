import { relative } from "node:path";
import { cwd, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  PromotedArtifactValidationFailure,
  findLatestExecutionRun,
  promoteExecutionRun,
} from "./promotion.js";

interface ParsedArgs {
  readonly artifactRoot?: string;
  readonly help: boolean;
  readonly latest: boolean;
  readonly name?: string;
  readonly runId?: string;
  readonly sourceRoot?: string;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export async function runPromotionCli(
  args: readonly string[],
): Promise<number> {
  let parsed: ParsedArgs;

  try {
    parsed = parseArgs(args);
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n`,
    );
    stderr.write(usage());

    return 2;
  }

  if (parsed.help) {
    stdout.write(usage());

    return 0;
  }

  if (parsed.name === undefined) {
    stderr.write("--name is required.\n\n");
    stderr.write(usage());

    return 2;
  }

  if (parsed.latest && parsed.runId !== undefined) {
    stderr.write("Use either --latest or --run, not both.\n\n");
    stderr.write(usage());

    return 2;
  }

  if (!parsed.latest && parsed.runId === undefined) {
    stderr.write("Either --latest or --run is required.\n\n");
    stderr.write(usage());

    return 2;
  }

  try {
    const runId = parsed.latest
      ? await findLatestExecutionRun({
          ...(parsed.sourceRoot !== undefined
            ? { sourceRoot: parsed.sourceRoot }
            : {}),
        })
      : parsed.runId;

    if (runId === undefined) {
      throw new UsageError("Either --latest or --run is required.");
    }

    const result = await promoteExecutionRun({
      ...(parsed.artifactRoot !== undefined
        ? { artifactRoot: parsed.artifactRoot }
        : {}),
      name: parsed.name,
      runId,
      ...(parsed.sourceRoot !== undefined
        ? { sourceRoot: parsed.sourceRoot }
        : {}),
    });
    stdout.write(
      [
        `Promoted Migaki run ${runId} to ${formatPath(result.bundleDirectory)}.`,
        `Manifest: ${formatPath(result.manifestPath)}`,
        `Report: ${formatPath(result.reportPath)}`,
        `Graph summary: ${formatPath(result.graphSummaryPath)}`,
        "",
      ].join("\n"),
    );

    return 0;
  } catch (error) {
    if (error instanceof PromotedArtifactValidationFailure) {
      stderr.write(`${error.message}\n`);

      return 1;
    }

    throw error;
  }
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: {
    artifactRoot?: string;
    help: boolean;
    latest: boolean;
    name?: string;
    runId?: string;
    sourceRoot?: string;
  } = {
    help: false,
    latest: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--") {
      continue;
    }

    const [name, inlineValue] = splitInlineOption(arg);
    if (name === "--latest") {
      if (inlineValue !== undefined) {
        throw new UsageError("--latest does not accept a value.");
      }

      parsed.latest = true;
      continue;
    }

    if (name === "--run") {
      parsed.runId = inlineValue ?? readOptionValue(args, index, name);
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    if (name === "--name") {
      parsed.name = inlineValue ?? readOptionValue(args, index, name);
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    if (name === "--source-root") {
      parsed.sourceRoot = inlineValue ?? readOptionValue(args, index, name);
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    if (name === "--artifact-root") {
      parsed.artifactRoot = inlineValue ?? readOptionValue(args, index, name);
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    throw new UsageError(`Unknown option ${arg}.`);
  }

  return parsed;
}

function splitInlineOption(arg: string): readonly [string, string | undefined] {
  const equalsIndex = arg.indexOf("=");

  if (equalsIndex === -1) {
    return [arg, undefined];
  }

  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function readOptionValue(
  args: readonly string[],
  index: number,
  optionName: string,
): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("-")) {
    throw new UsageError(`Missing value for ${optionName}.`);
  }

  return value;
}

function usage(): string {
  return [
    "Usage: scripts/migaki-promote (--run <run-id> | --latest) --name <slug> [options]",
    "",
    "Options:",
    "  --latest               Promote the newest local Migaki run with report.md.",
    "  --run <run-id>         Promote a specific local Migaki run.",
    "  --source-root <path>    Local Migaki store root. Defaults to .migaki.",
    "  --artifact-root <path>  Promoted artifact root. Defaults to docs/migaki-artifacts.",
    "  -h, --help              Show this help.",
    "",
  ].join("\n");
}

function formatPath(path: string): string {
  const relativePath = relative(cwd(), path);

  if (relativePath === "") {
    return ".";
  }

  return relativePath.startsWith("..") ? path : relativePath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPromotionCli(process.argv.slice(2));
}
