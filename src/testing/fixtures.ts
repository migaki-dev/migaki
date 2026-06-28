import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type FixturePath = URL | string;

export async function readTextFixture(path: FixturePath): Promise<string> {
  return readFile(path, "utf8");
}

export async function readJsonFixture<TValue = unknown>(
  path: FixturePath,
): Promise<TValue> {
  return JSON.parse(await readTextFixture(path)) as TValue;
}

export async function writeGoldenText(
  path: FixturePath,
  contents: string,
): Promise<void> {
  const filePath = toFilePath(path);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, ensureTrailingNewline(contents), "utf8");
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function ensureTrailingNewline(contents: string): string {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function toFilePath(path: FixturePath): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
