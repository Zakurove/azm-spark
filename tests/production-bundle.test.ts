/**
 * The default production build (`npm run build`, no flags), as a booth deploy makes it.
 *
 * Phase 1 acceptance F-3: the then and now example for the booth (S54, D-008), My results (S53) and
 * the Today slot (S01) must be in it without VITE_CHECK_UI, so a deploy built the default way keeps
 * the F2 deliverable.
 *
 * Phase 1 acceptance F-4 (F15: Lighthouse on mobile 90 or more): the landing loads only what it
 * shows. The check, the camera and pose runtime, the booth and the portal pages come in later chunks.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const ROOT = join(__dirname, "..");
let outDir = "";
let js = "";
let html = "";

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
  html = readFileSync(join(outDir, "index.html"), "utf8");
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

/** The files index.html makes the browser fetch before the app can paint: scripts, preloads, styles. */
function firstLoad(kind: "js" | "css"): { names: string[]; text: string } {
  const re =
    kind === "js"
      ? /<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/(assets\/[^"]+\.js)"/g
      : /<link[^>]*rel="stylesheet"[^>]*\shref="\/([^"]+\.css)"/g;
  const names = [...html.matchAll(re)].map((m) => m[1]);
  return { names, text: names.map((n) => readFileSync(join(outDir, n), "utf8")).join("\n") };
}
const gzipKb = (text: string) => gzipSync(text).length / 1024;

describe("the landing's first load (F15 Lighthouse, acceptance F-4)", () => {
  it("leaves the check, the camera, the pose runtime, the booth and the portal pages to later chunks", () => {
    const first = firstLoad("js");
    expect(first.names.length).toBeGreaterThan(0);
    const inFirst = [
      ["the check flow (S27 plan)", screen("S27")],
      ["the camera screen (S34)", /s34-stage/],
      ["the pose runtime", /FilesetResolver|PoseLandmarker/],
      ["the booth staff page (S55)", screen("S55")],
      ["My results (S53)", screen("S53")],
      ["the example (S54)", screen("S54")],
    ].filter(([, re]) => (re as RegExp).test(first.text));
    expect(inFirst.map(([name]) => name)).toEqual([]);
    // They are still in the build, in their own chunks.
    expect(js).toMatch(/FilesetResolver|PoseLandmarker/);
    expect(js).toMatch(screen("S27"));
  });

  it("keeps the first script under 130 KB and the first styles under 25 KB, gzip", () => {
    expect(gzipKb(firstLoad("js").text)).toBeLessThan(130);
    expect(gzipKb(firstLoad("css").text)).toBeLessThan(25);
  });

  it("inlines the Cairo faces of public/fonts/cairo.css in the page", () => {
    const squash = (css: string) => css.replace(/\s+/g, "");
    const inline = /<style>([\s\S]*?)<\/style>/.exec(html);
    expect(inline).not.toBeNull();
    expect(squash(inline![1])).toBe(squash(readFileSync(join(ROOT, "public/fonts/cairo.css"), "utf8")));
  });

  it("has no render blocking stylesheet besides the app's own, and names a real icon", () => {
    expect(firstLoad("css").names.every((n) => n.startsWith("assets/"))).toBe(true);
    const icon = /<link[^>]*rel="icon"[^>]*href="\/([^"]+)"/.exec(html);
    expect(icon).not.toBeNull();
    expect(statSync(join(ROOT, "public", icon![1])).isFile()).toBe(true);
  });
});
