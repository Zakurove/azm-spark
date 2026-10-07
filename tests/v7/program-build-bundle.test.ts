/**
 * D-032 item 4: the program build animation (src/features/onboarding/ProgramBuild.tsx) is a lazy chunk
 * of VITE_V7=1 builds only, at most 20 KB gzip with its styles, and never in the landing's first
 * script. Two production builds (the default and VITE_V7=1), their chunks read from the bundler's own
 * output as tests/v7/a-bundle.test.ts reads them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

const ROOT = join(__dirname, "../..");
const FACADE = "src/features/onboarding/ProgramBuild.tsx";
const ONBOARDING = /^src\/features\/onboarding\//;
/** The animation's own words: none may reach a script it does not load. */
const CAPTIONS = ["نقرأ حالتك الطبية", "نصمم برنامجك", "Engineering your program"];
const BUDGET_KB = 20;

interface Chunk {
  file: string;
  isEntry: boolean;
  imports: string[];
  /** The module a lazy import points at, from the repository root; null for a shared chunk. */
  facade: string | null;
  /** The modules with rendered code in the chunk, from the repository root. */
  modules: string[];
  /** The style sheets the chunk brings with it. */
  css: string[];
  code: string;
}
interface Output {
  chunks: Chunk[];
  styles: Map<string, string>;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function output(flags: { VITE_V7?: string }): Promise<Output> {
  const outDir = mkdtempSync(join(tmpdir(), "azm-build-anim-"));
  dirs.push(outDir);
  const keys = ["VITE_V7", "VITE_E2E", "NODE_ENV"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.VITE_E2E;
  if (flags.VITE_V7 === undefined) delete process.env.VITE_V7;
  else process.env.VITE_V7 = flags.VITE_V7;
  // NODE_ENV production as `npm run build` has it (vitest sets "test", which Vite reads as DEV).
  process.env.NODE_ENV = "production";
  const out: Output = { chunks: [], styles: new Map() };
  const capture: Plugin = {
    name: "build-anim-capture",
    generateBundle(_options, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type === "asset") {
          if (f.fileName.endsWith(".css"))
            out.styles.set(
              f.fileName,
              typeof f.source === "string" ? f.source : Buffer.from(f.source).toString(),
            );
          continue;
        }
        const meta = (f as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
        out.chunks.push({
          file: f.fileName,
          isEntry: f.isEntry,
          imports: f.imports,
          facade: f.facadeModuleId ? relative(ROOT, f.facadeModuleId) : null,
          modules: Object.entries(f.modules)
            .filter(([, m]) => m.renderedLength > 0)
            .map(([id]) => relative(ROOT, id)),
          css: [...(meta?.importedCss ?? [])],
          code: f.code,
        });
      }
    },
  };
  try {
    await build({
      root: ROOT,
      configFile: join(ROOT, "vite.config.ts"),
      logLevel: "silent",
      mode: "production",
      plugins: [capture],
      build: { outDir, emptyOutDir: true, copyPublicDir: false, write: false },
    });
  } finally {
    for (const k of keys)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
  return out;
}

/** The entry chunk and every chunk it imports statically: what the landing loads first. */
function firstLoad(chunks: Chunk[]): Chunk[] {
  const byFile = new Map(chunks.map((c) => [c.file, c]));
  const seen = new Set<string>();
  const walk = (c: Chunk) => {
    if (seen.has(c.file)) return;
    seen.add(c.file);
    for (const f of c.imports) {
      const next = byFile.get(f);
      if (next) walk(next);
    }
  };
  chunks.filter((c) => c.isEntry).forEach(walk);
  return [...seen].map((f) => byFile.get(f)!);
}

const gzipKb = (text: string) => gzipSync(text, { level: 9 }).length / 1024;

let plain: Output;
let v7: Output;
beforeAll(async () => {
  plain = await output({});
  v7 = await output({ VITE_V7: "1" });
}, 120_000);

describe("the default build (no flag)", () => {
  it("has no code of the animation, its preview entry or its words", () => {
    expect(plain.chunks.length).toBeGreaterThan(10);
    const found = plain.chunks.flatMap((c) =>
      c.modules.filter((m) => ONBOARDING.test(m)).map((m) => `${c.file}: ${m}`),
    );
    expect(found).toEqual([]);
    const js = plain.chunks.map((c) => c.code).join("\n");
    expect(js).not.toContain("programBuild");
    for (const words of CAPTIONS) expect(js, words).not.toContain(words);
  });
});

describe("the VITE_V7=1 build", () => {
  it("gives the animation a lazy chunk of its own, outside the first script", () => {
    const own = v7.chunks.filter((c) => c.facade === FACADE);
    expect(own).toHaveLength(1);
    const first = firstLoad(v7.chunks);
    expect(first.some((c) => c.isEntry)).toBe(true);
    expect(first.map((c) => c.file)).not.toContain(own[0].file);
    // No part of it, and none of its words, is in the first load.
    expect(first.flatMap((c) => c.modules.filter((m) => ONBOARDING.test(m)))).toEqual([]);
    const firstJs = first.map((c) => c.code).join("\n");
    for (const words of CAPTIONS) expect(firstJs, words).not.toContain(words);
    // The preview entry is only its name and a dynamic import in the first script.
    expect(firstJs).toContain("programBuild");
  });

  it(`stays within ${BUDGET_KB} KB gzip with its styles`, () => {
    const own = v7.chunks.find((c) => c.facade === FACADE)!;
    expect(own.modules).toEqual(
      expect.arrayContaining([
        "src/features/onboarding/ProgramBuild.tsx",
        "src/features/onboarding/programBuildCopy.ts",
        "src/features/onboarding/programBuildScene.ts",
      ]),
    );
    expect(own.css.length).toBe(1);
    const js = gzipKb(own.code);
    const css = own.css.reduce((kb, f) => kb + gzipKb(v7.styles.get(f) ?? ""), 0);
    expect(css).toBeGreaterThan(0.5);
    expect(js + css).toBeLessThanOrEqual(BUDGET_KB);
  });
});
