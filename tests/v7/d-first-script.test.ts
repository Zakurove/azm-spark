/**
 * D-026 item 2 (change log A6b-1 and F2-1): the voice script stays out of the landing's first script.
 * `src/app/i18n.ts`, which the landing loads, no longer holds the voice lines (`CUE_TEXT`); their one
 * reader, the camera screen (`src/app/Session.tsx`, a lazy chunk), imports the voice script itself, so
 * every voice line ships in a later chunk with the voice packs and the first script keeps its room for
 * the landing's own copy (section 9: at most 3 KB over the script before v7).
 *
 * One default production build (no flag, as a booth deploy makes it), its chunks read from the
 * bundler's output: the first load is the entry chunk and every chunk it imports statically (the
 * module preloads of index.html).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

const ROOT = join(__dirname, "../..");
const VOICE_SCRIPT = "src/app/voice-script.json";

interface Chunk {
  file: string;
  isEntry: boolean;
  imports: string[];
  /** The modules with rendered code in the chunk, from the repository root. */
  modules: string[];
  code: string;
}

let outDir = "";
let chunks: Chunk[] = [];

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "azm-d26-first-script-"));
  const keys = ["VITE_V7", "VITE_E2E", "VITE_CHECK_UI", "NODE_ENV"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of ["VITE_V7", "VITE_E2E", "VITE_CHECK_UI"] as const) delete process.env[k];
  // NODE_ENV production as `npm run build` has it (vitest sets "test", which Vite reads as DEV).
  process.env.NODE_ENV = "production";
  const capture: Plugin = {
    name: "d26-capture-chunks",
    generateBundle(_options, bundle) {
      for (const f of Object.values(bundle))
        if (f.type === "chunk")
          chunks.push({
            file: f.fileName,
            isEntry: f.isEntry,
            imports: f.imports,
            modules: Object.entries(f.modules)
              .filter(([, m]) => m.renderedLength > 0)
              .map(([id]) => relative(ROOT, id)),
            code: f.code,
          });
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
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** The entry chunk and every chunk it imports statically, transitively. */
function firstLoad(): Chunk[] {
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

describe("the landing's first script (D-026 item 2)", () => {
  it("holds no voice line: the voice script ships in a later chunk", () => {
    const first = firstLoad();
    expect(first.some((c) => c.isEntry)).toBe(true);
    const voiced = first.filter((c) => c.modules.includes(VOICE_SCRIPT)).map((c) => c.file);
    expect(voiced).toEqual([]);
    // Still in the build, for the camera screen and the voice packs.
    expect(chunks.some((c) => c.modules.includes(VOICE_SCRIPT))).toBe(true);
  });

  it("leaves the camera screen's caption lines to the camera screen's own chunk", () => {
    const first = new Set(firstLoad().map((c) => c.file));
    const session = chunks.filter((c) => c.modules.includes("src/app/Session.tsx"));
    expect(session.length).toBeGreaterThan(0);
    for (const c of session) expect(first.has(c.file), c.file).toBe(false);
    // For the record: the entry chunk's gzip size, as Vite reports it.
    const entry = chunks.find((c) => c.isEntry)!;
    expect(gzipSync(entry.code, { level: 9 }).length / 1024).toBeLessThan(130);
  });
});
