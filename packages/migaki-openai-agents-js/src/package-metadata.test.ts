import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("publishes the requested package name and OpenAI Agents SDK compatibility range", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      readonly devDependencies?: Readonly<Record<string, string>>;
      readonly files?: readonly string[];
      readonly name?: string;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };

    expect(manifest.name).toBe("migaki-openai-agents-js");
    expect(manifest.peerDependencies?.["@openai/agents"]).toBe(
      ">=0.10.0 <=0.12.0",
    );
    expect(manifest.devDependencies?.["@openai/agents"]).toBe("0.12.0");
    expect(manifest.files).toEqual([
      "README.md",
      "src/benchmark.ts",
      "src/hash.ts",
      "src/index.ts",
      "src/recorder.ts",
      "src/report.ts",
      "src/store.ts",
      "src/types.ts",
      "src/withMigaki.ts",
    ]);
    expect(manifest.files?.some((file) => file.endsWith(".test.ts"))).toBe(
      false,
    );
  });
});
