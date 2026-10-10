/**
 * D-035 item 4: the walk lab, /?gaitlab=side|front (src/features/gait/GaitLab.tsx). Its verdict line,
 * that it never saves (no call to the server at all), and that only a VITE_V7 build has it (its own
 * lazy chunk; the default build holds neither its code nor its entry's name).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";
import { verdictLine } from "../../src/features/gait/GaitLab";
import type { WalkVerdict } from "../../src/engine/gait/verdict";

const ROOT = join(__dirname, "../..");

const timing: WalkVerdict = {
  level: "timing",
  cleanCycles: { left: 3, right: 4 },
  cadence: 104.2,
  stepTime: { left: 0.62, right: 0.58 },
  reasons: [],
  fps: 30,
};

describe("the lab's verdict line", () => {
  it("names the cadence and each side's step time, in English and Arabic", () => {
    expect(verdictLine(timing, "en")).toBe(
      "Cadence 104 steps a minute, right step 0.58 s, left 0.62 s, timing only.",
    );
    expect(verdictLine(timing, "ar")).toBe(
      "الإيقاع 104 خطوة في الدقيقة، الخطوة اليمنى 0.58 ث، اليسرى 0.62 ث، توقيت فقط.",
    );
    expect(verdictLine({ ...timing, level: "full" }, "en", ["shorter_stance:right:possible"])).toContain(
      "possible shorter_stance:right:possible",
    );
  });

  it("says why nothing was analysed", () => {
    const none: WalkVerdict = {
      ...timing,
      level: "none",
      cadence: null,
      reasons: ["wrong_view", "too_few_steps"],
    };
    expect(verdictLine(none, "en")).toBe(
      "Not analysed because the wrong view for this recording, fewer than 2 clean cycles a side, or 5 in all.",
    );
    expect(verdictLine(none, "ar").startsWith("لم يُحلَّل لأن")).toBe(true);
  });

  it("never calls the server: no fetch, no save, no intake", () => {
    const src = readFileSync(join(ROOT, "src/features/gait/GaitLab.tsx"), "utf8");
    for (const word of ["fetch(", "saveGait", "readIntake", "/api/"]) expect(src, word).not.toContain(word);
  });
});

describe("only a VITE_V7 build has the lab", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  async function chunks(v7: boolean) {
    const outDir = mkdtempSync(join(tmpdir(), "azm-gaitlab-build-"));
    dirs.push(outDir);
    const saved = {
      VITE_V7: process.env.VITE_V7,
      VITE_E2E: process.env.VITE_E2E,
      NODE_ENV: process.env.NODE_ENV,
    };
    if (v7) process.env.VITE_V7 = "1";
    else delete process.env.VITE_V7;
    delete process.env.VITE_E2E;
    process.env.NODE_ENV = "production";
    const found: { facade: string | null; modules: string[]; code: string }[] = [];
    const capture: Plugin = {
      name: "gaitlab-capture",
      generateBundle(_o, bundle) {
        for (const f of Object.values(bundle))
          if (f.type === "chunk")
            found.push({
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
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return found;
  }

  it("the default build holds neither the lab nor its name; the v7 build gives it a chunk", async () => {
    const plain = await chunks(false);
    expect(plain.flatMap((c) => c.modules).filter((m) => m.includes("GaitLab"))).toEqual([]);
    expect(plain.map((c) => c.code).join("\n")).not.toContain("gaitlab");
    const v7 = await chunks(true);
    expect(v7.map((c) => c.facade)).toContain("src/features/gait/GaitLab.tsx");
  }, 120_000);
});
