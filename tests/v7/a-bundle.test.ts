/**
 * Step A6 (product v7 contract C-9 and 8.8; A2-1 and A5-12; D-024 item 5): a default build has no v7
 * chunk. Three production builds are made here (each well under a second) and their chunks read from
 * the bundler's own output:
 *
 *   - the default build (no flag): no chunk is a v7 module's lazy chunk, and no chunk renders code of
 *     a v7 module (tests/v7/a-v7-paths.ts lists them; body-map.ts, which validateIntake uses in every
 *     build, and the v7flag constant are shared on purpose), nor of the smoke page or the overlay;
 *   - the VITE_V7=1 build: every v7 page, link slot and the intake step has its own chunk, so the
 *     default build's check above is not vacuous;
 *   - the VITE_E2E=1 build: the smoke page and the performance overlay have their own chunks, which
 *     the default and v7 builds never have.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";
import { E2E_ONLY, V7_ONLY } from "./a-v7-paths";

const ROOT = join(__dirname, "../..");

interface Chunk {
  file: string;
  /** The module a lazy import points at, from the repository root; null for a shared chunk. */
  facade: string | null;
  /** The modules with rendered code in the chunk, from the repository root. */
  modules: string[];
  code: string;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function chunks(flags: { VITE_V7?: string; VITE_E2E?: string }): Promise<Chunk[]> {
  const outDir = mkdtempSync(join(tmpdir(), "azm-a6-build-"));
  dirs.push(outDir);
  const keys = ["VITE_V7", "VITE_E2E", "NODE_ENV"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of ["VITE_V7", "VITE_E2E"] as const)
    if (flags[k] === undefined) delete process.env[k];
    else process.env[k] = flags[k];
  // NODE_ENV production as `npm run build` has it (vitest sets "test", which Vite reads as DEV).
  process.env.NODE_ENV = "production";
  const found: Chunk[] = [];
  const capture: Plugin = {
    name: "a6-capture-chunks",
    generateBundle(_options, bundle) {
      for (const f of Object.values(bundle))
        if (f.type === "chunk")
          found.push({
            file: f.fileName,
            facade: f.facadeModuleId ? relative(ROOT, f.facadeModuleId) : null,
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
  return found;
}

const V7_FACADES = [
  "src/features/focus/FocusApp.tsx",
  "src/features/focus/FindingsPage.tsx",
  "src/features/program-v7/ProgramPage.tsx",
  "src/features/showcase/ShowcaseEntry.tsx",
  "src/features/focus/FocusTodayEntry.tsx",
  "src/features/focus/FindingsLink.tsx",
  "src/features/program-v7/ProgramLink.tsx",
  "src/app/IntakeV7.tsx",
  "src/app/LandingV7.tsx",
];
const E2E_FACADES = ["src/features/smoke/SmokePage.tsx", "src/features/smoke/PerfOverlay.tsx"];

let plain: Chunk[] = [];
let v7: Chunk[] = [];
let e2e: Chunk[] = [];
beforeAll(async () => {
  plain = await chunks({});
  v7 = await chunks({ VITE_V7: "1" });
  e2e = await chunks({ VITE_E2E: "1" });
}, 120_000);

describe("the default build (no flag)", () => {
  it("has no v7 chunk and renders no v7 code", () => {
    expect(plain.length).toBeGreaterThan(10);
    const v7Chunks = plain.filter((c) => c.facade && (V7_ONLY.test(c.facade) || E2E_ONLY.test(c.facade)));
    expect(v7Chunks.map((c) => c.file)).toEqual([]);
    const v7Code = plain.flatMap((c) =>
      c.modules.filter((m) => V7_ONLY.test(m) || E2E_ONLY.test(m)).map((m) => `${c.file}: ${m}`),
    );
    expect(v7Code).toEqual([]);
  });

  it("keeps the v7 entries' names out of every script", () => {
    const js = plain.map((c) => c.code).join("\n");
    for (const name of ["e2eSmoke", "focus=1", "findings=1", "targets=1", "showcase"])
      expect(js, name).not.toContain(name);
  });
});

describe("the VITE_V7=1 build", () => {
  it("gives every v7 page, link slot and the intake step a chunk of its own", () => {
    const facades = v7.map((c) => c.facade);
    for (const f of V7_FACADES) expect(facades, f).toContain(f);
    for (const f of E2E_FACADES) expect(facades, f).not.toContain(f);
  });
});

describe("the VITE_E2E=1 build", () => {
  it("gives the smoke page and the overlay chunks of their own, and no v7 page", () => {
    const facades = e2e.map((c) => c.facade);
    for (const f of E2E_FACADES) expect(facades, f).toContain(f);
    for (const f of V7_FACADES) expect(facades, f).not.toContain(f);
    expect(e2e.map((c) => c.code).join("\n")).toContain("e2eSmoke");
  });
});
