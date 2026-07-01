import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("repository source policy", () => {
  it("does not track JavaScript-family source files", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: repositoryRoot,
    });
    const javascriptFamilyFiles = stdout
      .split("\n")
      .filter((path) => /\.(?:c?m?js|jsx)$/.test(path));

    expect(javascriptFamilyFiles).toEqual([]);
  });

  it("keeps the canonical pnpm workspace shape explicit", async () => {
    const workspace = await readFile(
      `${repositoryRoot}/pnpm-workspace.yaml`,
      "utf8",
    );

    expect(workspace).toContain('- "packages/*"');
    expect(workspace).toContain('- "examples/*"');
    expect(workspace).toContain("engineStrict: true");
    expect(workspace).toContain("strictPeerDependencies: true");
    expect(workspace).toContain("autoInstallPeers: false");
    expect(workspace).toContain("saveExact: true");
    expect(workspace).toContain("managePackageManagerVersions: false");
  });

  it("separates libraries, CLI, SDK integrations, examples, and root test helpers", async () => {
    await expectPackage({
      category: "library",
      name: "@migaki/mir",
      path: "packages/mir/package.json",
    });
    await expectPackage({
      category: "library",
      name: "@migaki/providers",
      path: "packages/providers/package.json",
      workspaceDependencies: ["@migaki/mir"],
    });
    await expectPackage({
      category: "library",
      name: "@migaki/runtime",
      path: "packages/runtime/package.json",
      workspaceDependencies: ["@migaki/mir", "@migaki/providers"],
    });
    await expectPackage({
      category: "library",
      name: "@migaki/adapters",
      path: "packages/adapters/package.json",
    });
    await expectPackage({
      category: "cli",
      name: "@migaki/cli",
      path: "packages/cli/package.json",
      workspaceDependencies: ["@migaki/mir", "@migaki/runtime"],
    });
    await expectPackage({
      category: "sdk",
      name: "migaki-openai-agents-js",
      path: "packages/migaki-openai-agents-js/package.json",
    });
    await expectPackage({
      category: "example",
      name: "@migaki/example-rag-dedup-cache",
      path: "examples/rag-dedup-cache/package.json",
      workspaceDependencies: [
        "@migaki/mir",
        "@migaki/providers",
        "@migaki/runtime",
      ],
    });
    await expectPackage({
      category: "example",
      name: "@migaki/example-repo-agent-comparison",
      path: "examples/repo-agent-comparison/package.json",
      workspaceDependencies: [
        "@migaki/mir",
        "@migaki/providers",
        "@migaki/runtime",
      ],
    });

    const rootTestingReadme = await readFile(
      `${repositoryRoot}/src/testing/README.md`,
      "utf8",
    );

    expect(rootTestingReadme).toContain("Shared test helpers live here");
  });
});

interface PackageExpectation {
  readonly category: "cli" | "example" | "library" | "sdk";
  readonly name: string;
  readonly path: string;
  readonly workspaceDependencies?: readonly string[];
}

interface PackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly files?: readonly string[];
  readonly name?: string;
  readonly private?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly sideEffects?: boolean;
  readonly type?: string;
  readonly version?: string;
}

async function expectPackage(expectation: PackageExpectation): Promise<void> {
  const manifest = await readJson<PackageManifest>(expectation.path);

  expect(manifest.name).toBe(expectation.name);
  expect(manifest.version).toBe("0.0.0");
  expect(manifest.type).toBe("module");
  expect(manifest.description).toBeDefined();
  expect(manifest.sideEffects).toBe(false);

  switch (expectation.category) {
    case "cli":
    case "library":
      expect(manifest.private).toBeUndefined();
      expect(manifest.exports?.["."]).toBeDefined();
      expect(manifest.files).toEqual(["README.md", "src"]);
      break;
    case "sdk":
      expect(manifest.private).toBeUndefined();
      expect(manifest.exports?.["."]).toEqual({
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      });
      expect(manifest.bin).toEqual({
        "migaki-openai-agents-js": "./dist/cli.js",
      });
      expect(manifest.files).toEqual(["README.md", "dist"]);
      expect(manifest.scripts?.["build"]).toContain("tsc -p");
      break;
    case "example":
      expect(manifest.private).toBe(true);
      expect(manifest.name?.startsWith("@migaki/example-")).toBe(true);
      expect(manifest.exports?.["."]).toBeDefined();
      expect(manifest.files).toEqual(["README.md", "src"]);
      break;
  }

  for (const dependency of expectation.workspaceDependencies ?? []) {
    expect(manifest.dependencies?.[dependency]).toBe("workspace:*");
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(`${repositoryRoot}/${path}`, "utf8")) as T;
}
