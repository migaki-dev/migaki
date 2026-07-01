import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const expectedWorkspacePackages: readonly PackageExpectation[] = [
  {
    category: "library",
    name: "@migaki/mir",
    path: "packages/mir/package.json",
  },
  {
    category: "library",
    name: "@migaki/providers",
    path: "packages/providers/package.json",
    workspaceDependencies: ["@migaki/mir"],
  },
  {
    category: "library",
    name: "@migaki/runtime",
    path: "packages/runtime/package.json",
    workspaceDependencies: ["@migaki/mir", "@migaki/providers"],
  },
  {
    category: "library",
    name: "@migaki/adapters",
    path: "packages/adapters/package.json",
  },
  {
    category: "cli",
    name: "@migaki/cli",
    path: "packages/cli/package.json",
    workspaceDependencies: ["@migaki/mir", "@migaki/runtime"],
  },
  {
    category: "sdk",
    name: "migaki-openai-agents-js",
    path: "packages/migaki-openai-agents-js/package.json",
  },
  {
    category: "example",
    name: "@migaki/example-rag-dedup-cache",
    path: "examples/rag-dedup-cache/package.json",
    workspaceDependencies: [
      "@migaki/mir",
      "@migaki/providers",
      "@migaki/runtime",
    ],
  },
  {
    category: "example",
    name: "@migaki/example-repo-agent-comparison",
    path: "examples/repo-agent-comparison/package.json",
    workspaceDependencies: [
      "@migaki/mir",
      "@migaki/providers",
      "@migaki/runtime",
    ],
  },
];

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

  it("pins pnpm as the workspace package manager", async () => {
    const manifest = await readJson<RootPackageManifest>("package.json");

    expect(manifest.private).toBe(true);
    expect(manifest.packageManager).toBe("pnpm@11.9.0");
    expect(manifest.engines).toEqual({
      node: ">=24.18.0",
      pnpm: ">=11.9.0",
    });

    const scriptText = Object.values(manifest.scripts ?? {}).join("\n");

    expect(scriptText).not.toMatch(/\b(?:bun|npm|yarn)\b/);
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

  it("keeps workspace package membership predictable", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: repositoryRoot,
    });
    const workspacePackageManifests = stdout
      .split("\n")
      .filter((path) =>
        /^(?:examples|packages)\/[^/]+\/package\.json$/.test(path),
      )
      .sort();

    expect(workspacePackageManifests).toEqual(
      expectedWorkspacePackages.map((manifest) => manifest.path).sort(),
    );
  });

  it("separates libraries, CLI, SDK integrations, examples, and root test helpers", async () => {
    for (const expectation of expectedWorkspacePackages) {
      await expectPackage(expectation);
    }

    const rootTestingReadme = await readFile(
      `${repositoryRoot}/src/testing/README.md`,
      "utf8",
    );

    expect(rootTestingReadme).toContain("Shared test helpers live here");
  });

  it("uses the pnpm workspace protocol for every local package dependency", async () => {
    const localPackageNames = new Set(
      expectedWorkspacePackages.map((manifest) => manifest.name),
    );

    for (const { path } of expectedWorkspacePackages) {
      const manifest = await readJson<PackageManifest>(path);
      const localDependencies = collectLocalDependencyRanges(
        localPackageNames,
        manifest,
      );

      for (const [dependencyName, dependencyRange] of localDependencies) {
        expect(dependencyRange, `${path} -> ${dependencyName}`).toBe(
          "workspace:*",
        );
      }
    }
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
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly files?: readonly string[];
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly private?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly sideEffects?: boolean;
  readonly type?: string;
  readonly version?: string;
}

interface RootPackageManifest extends PackageManifest {
  readonly engines?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
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

function collectLocalDependencyRanges(
  localPackageNames: ReadonlySet<string>,
  manifest: PackageManifest,
): ReadonlyArray<readonly [string, string]> {
  const dependencyGroups = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ];
  const localDependencies: Array<readonly [string, string]> = [];

  for (const dependencies of dependencyGroups) {
    for (const [dependencyName, dependencyRange] of Object.entries(
      dependencies ?? {},
    )) {
      if (localPackageNames.has(dependencyName)) {
        localDependencies.push([dependencyName, dependencyRange]);
      }
    }
  }

  return localDependencies;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(`${repositoryRoot}/${path}`, "utf8")) as T;
}
