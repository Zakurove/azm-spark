/**
 * The default production build (`npm run build`, no flags), as a booth deploy makes it.
 *
 * Phase 1 acceptance F-3: the then and now example for the booth (S54, D-008), My results (S53) and
 * the Today slot (S01) must be in it without VITE_CHECK_UI, so a deploy built the default way keeps
 * the F2 deliverable.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const ROOT = join(__dirname, "..");
let outDir = "";
let js = "";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** A JSX attribute as the minifier writes it: "data-screen":`S54` (any quote). */
const screen = (id: string) => new RegExp(`"data-screen":[\`"']${id}[\`"']`);

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "azm-default-build-"));
  // NODE_ENV production as `npm run build` has it (vitest sets "test", which Vite reads as DEV).
  const saved = { e2e: process.env.VITE_E2E, ui: process.env.VITE_CHECK_UI, node: process.env.NODE_ENV };
  delete process.env.VITE_E2E;
  delete process.env.VITE_CHECK_UI;
  process.env.NODE_ENV = "production";
  try {
    await build({
      root: ROOT,
      configFile: join(ROOT, "vite.config.ts"),
      logLevel: "silent",
      mode: "production",
      build: { outDir, emptyOutDir: true, copyPublicDir: false },
    });
  } finally {
    if (saved.e2e !== undefined) process.env.VITE_E2E = saved.e2e;
    if (saved.ui !== undefined) process.env.VITE_CHECK_UI = saved.ui;
    process.env.NODE_ENV = saved.node;
  }
  js = filesUnder(outDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("the default production build", () => {
  it("carries the example page (S54), My results (S53) and the Today slot (S01) without VITE_CHECK_UI", () => {
    expect(js.length).toBeGreaterThan(10_000);
    // S05b keeps its "See an example" action too.
    const missing = ["S54", "S53", "S01", "S05b"].filter((id) => !screen(id).test(js));
    if (!js.includes("assessment.guest.boothOnly.example")) missing.push("S05b example action");
    expect(missing).toEqual([]);
  });
});
