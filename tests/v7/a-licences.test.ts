/**
 * The v7 dependency and licence duties (product v7 contract 6.1 and 6.3): @google/genai is pinned
 * exactly at 2.27.0 (below 3.0.0) in package.json and the lockfile, and THIRD_PARTY_LICENSES.md
 * carries the v7 section with every upstream of 6.1 named, the runtime dependency's notice and the
 * Gemini terms, the publications whose GPL code was not used, and the reference and test data. The
 * bracketed fields are filled by the tech lead at each merge (contract 1.4, 6.3).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("v7 dependency", () => {
  it("pins @google/genai exactly at 2.27.0 in package.json and the lockfile", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@google/genai"]).toBe("2.27.0");
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string; license?: string; dependencies?: Record<string, string> }>;
    };
    expect(lock.packages[""].dependencies?.["@google/genai"]).toBe("2.27.0");
    expect(lock.packages["node_modules/@google/genai"]).toMatchObject({
      version: "2.27.0",
      license: "Apache-2.0",
    });
  });
});

describe("THIRD_PARTY_LICENSES.md, the v7 section", () => {
  const text = read("THIRD_PARTY_LICENSES.md");
  const v7 = text.slice(text.indexOf("## Azm v7 (range of motion, gait, live coach)"));

  it("is appended after the existing notices, which stay as they were", () => {
    expect(text.indexOf("## Azm v7")).toBeGreaterThan(text.indexOf("## Demo video"));
    expect(text).toContain("**MediaPipe Tasks Vision**");
    expect(v7.length).toBeGreaterThan(1000);
  });

  it("names every ported and vendored upstream with its licence and repository", () => {
    const entries: [string, string, string][] = [
      ["**Pose2Sim**", "BSD 3-Clause License", "https://github.com/perfanalytics/pose2sim"],
      ["**Sports2D**", "BSD 3-Clause License", "https://github.com/davidpagnon/Sports2D"],
      ["**SciPy**", "BSD 3-Clause License", "https://github.com/scipy/scipy"],
      ["**digital-filter** 2.4.2", "MIT License", "https://github.com/scijs/digital-filter"],
      ["**myogait**", "MIT License", "https://github.com/IDMDataHub/myogait"],
      ["**OpenCap processing**", "Apache License 2.0", "https://github.com/opencap-org/opencap-processing"],
      [
        "**Gemini Live API Web Console**",
        "Apache License 2.0",
        "https://github.com/google-gemini/live-api-web-console",
      ],
    ];
    for (const [name, licence, url] of entries) {
      const line = v7.split("\n").find((l) => l.startsWith(`- ${name}`));
      expect(line, name).toBeDefined();
      expect(line).toContain(licence);
      expect(line).toContain(url);
    }
  });

  it("names the runtime dependency with its licence and the Gemini terms", () => {
    const line = v7.split("\n").find((l) => l.startsWith("- **@google/genai** 2.27.0"));
    expect(line).toBeDefined();
    expect(line).toContain("Apache License 2.0");
    expect(line).toContain("Loaded only when the live coach is on.");
    expect(line).toContain("https://ai.google.dev/gemini-api/terms");
  });

  it("credits the publications, says their GPL code was not used, and lists the data", () => {
    expect(v7).toContain("The authors' GPL-3.0 code was not used.");
    expect(v7).toContain("Zeni JA, Richards JG, Higginson JS.");
    expect(v7).toContain("`src/movements/rom/rom-v7.json`");
    expect(v7).toContain("`src/movements/gait/gait-v7.json`");
    expect(v7).toContain("Van Criekinge T et al.");
    expect(v7).toContain("Fukuchi CA, Fukuchi RK, Duarte M.");
  });
});
