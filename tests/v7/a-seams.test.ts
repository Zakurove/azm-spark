/**
 * The seams stream A plants at Gate A (product v7 contract 1.3): every placeholder exists with its
 * final signature and a safe body, so streams B to F compile against them and fill them later; the
 * fixture catalogues and their two hunks; the v7 copy namespaces, registered in src/i18n/v7.ts and
 * never in the landing's dictionaries; the build flag; and the lazy v7 page entries of App.tsx.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileRoutes } from "../../server/modules/focus/profile";
import { agentRoutes } from "../../server/modules/agent/routes";
import { programRoutes } from "../../server/modules/program/routes";
import { afterIntakeSaved } from "../../server/modules/program/hooks";
import { bodyMapSummary, buildRomProfile, compareRom, romFindings } from "../../src/medical/rom-profile";
import type { StoredRomRow } from "../../src/medical/rom-types";
import { evaluateGait } from "../../src/medical/gait-rules";
import { collectTargets, selectForTargets, targetedWeekly, whyLine } from "../../src/medical/targets";
import { V7_ONLY_IDS, v7Contraindications } from "../../src/medical/contraindications";
import { createPlan, type Intake } from "../../src/medical/plan";
import { engineWeekly } from "../../src/medical/weekly";
import { RomRunner } from "../../src/engine/rom/runner";
import { analyseGaitView, analyseStaticStance, combineViews } from "../../src/engine/gait/analyse";
import { GaitStep } from "../../src/features/gait/GaitStep";
import { GaitFindingsCard } from "../../src/features/gait/GaitFindingsCard";
import { useCoach } from "../../src/features/coach-agent/useCoach";
import { TargetsSummary } from "../../src/features/program-v7/TargetsSummary";
import { MovementPicture } from "../../src/features/focus/MovementPicture";
import FocusApp from "../../src/features/focus/FocusApp";
import FindingsPage from "../../src/features/focus/FindingsPage";
import ProgramPage from "../../src/features/program-v7/ProgramPage";
import ShowcaseEntry from "../../src/features/showcase/ShowcaseEntry";
import { V7_UI } from "../../src/app/v7flag";
import { DICTIONARIES, NAMESPACES } from "../../src/i18n";
import { V7_DICTIONARIES, V7_NAMESPACES } from "../../src/i18n/v7";
import { CATALOG } from "../fixtures/catalog";
import { ROM_CATALOG } from "../fixtures/rom/catalog";
import { gaitFixtureFrames } from "../fixtures/gait/catalog";
import { fixtureFrames } from "../../src/features/assessment/e2e/FixturePoseSource";
import { GAIT_RULES_VERSION } from "../../src/movements/gait";
import { NORMS_VERSION, ROM_DATA } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import type { GaitAnalysis } from "../../src/engine/gait/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { TargetRequest } from "../../src/medical/target-types";

const ROOT = join(__dirname, "../..");
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const INTAKE: Intake & { sex: "female" } = {
  age: 58,
  conditions: ["stroke"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "right",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["chair"],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
  sex: "female",
  regions: [{ region: "knee", side: "right", problems: ["weakness"], origin: "condition" }],
  walking: { status: "without_aid" },
};

const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: true,
  views: { overground: ["side", "front"], walking_pad: [] },
};

function storedRow(over: Partial<StoredRomRow>): StoredRomRow {
  return {
    id: "r1",
    checkId: "c1",
    movementId: "knee_flexion",
    side: "right",
    position: "lying_back",
    value: 110,
    source: "measured",
    reason: null,
    pain: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    percentNormal: 81,
    finding: "mild",
    gradeIgnoringPain: "mild",
    norm: null,
    median: 108,
    nValid: 3,
    flags: [],
    poseModel: "full",
    movementVersion: 1,
    normsVersion: NORMS_VERSION,
    engineVersion: "rom_engine_1",
    created: 1000,
    ...over,
  };
}

describe("server seams", () => {
  it("plants empty route lists for the profile, agent and program routes", () => {
    expect(profileRoutes).toEqual([]);
    expect(agentRoutes).toEqual([]);
    expect(programRoutes).toEqual([]);
  });

  it("plants afterIntakeSaved, which changes nothing", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t(x INTEGER)");
    expect(afterIntakeSaved(db, "u1")).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("medical seams", () => {
  it("builds a profile of computed defaults for every joint movement and side without rows", () => {
    const p = buildRomProfile({ intake: INTAKE, rows: [], now: 5 });
    expect(p).toMatchObject({ sex: "female", age: 58, normsVersion: NORMS_VERSION, created: 5 });
    expect(p.entries.every((e) => e.source === "default" && e.finding === "default")).toBe(true);
    for (const id of ROM_MOVEMENT_IDS) expect(p.entries.some((e) => e.movementId === id)).toBe(true);
    for (const d of ROM_DATA.defaultMovements)
      expect(p.entries.some((e) => e.movementId === d.id)).toBe(true);
    // Limb movements have both sides; one entry per movement and side.
    expect(p.entries.filter((e) => e.movementId === "knee_flexion").map((e) => e.side)).toEqual([
      "left",
      "right",
    ]);
    const keys = p.entries.map((e) => `${e.movementId}:${e.side}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a stored row's own source in the profile, never reported as a default (section 4)", () => {
    const rows = [
      storedRow({}),
      storedRow({
        id: "r2",
        movementId: "wrist_flexion",
        position: null,
        value: null,
        source: "not_measured_camera",
        reason: "not_measured_camera",
        finding: "not_today",
        gradeIgnoringPain: null,
        percentNormal: null,
        median: null,
        nValid: 0,
        movementVersion: 1,
      }),
    ];
    const p = buildRomProfile({ intake: INTAKE, rows, now: 5 });
    expect(p.entries.find((e) => e.movementId === "knee_flexion" && e.side === "right")).toMatchObject({
      source: "measured",
      value: 110,
      finding: "mild",
      measuredAt: 1000,
      checkId: "c1",
    });
    expect(p.entries.find((e) => e.movementId === "wrist_flexion" && e.side === "right")).toMatchObject({
      source: "not_measured_camera",
      measuredAt: null,
      finding: "not_today",
    });
    expect(p.entries.find((e) => e.movementId === "knee_flexion" && e.side === "left")?.source).toBe(
      "default",
    );
  });

  it("plants romFindings, bodyMapSummary and compareRom with no finding, colour or change", () => {
    const p = buildRomProfile({ intake: INTAKE, rows: [storedRow({})], now: 5 });
    expect(romFindings(p, INTAKE)).toEqual([]);
    expect(bodyMapSummary(p)).toEqual({});
    expect(compareRom([storedRow({})], [storedRow({ value: 130 })], ["stroke"])).toEqual([]);
  });

  it("plants evaluateGait with no pattern and the gait rules version", () => {
    const analysis = { mode: "overground" } as GaitAnalysis;
    expect(
      evaluateGait({ analysis, intake: INTAKE, romProfile: null, today: { painByRegion: {} }, plan: PLAN }),
    ).toEqual({ patterns: [], findings: [], rulesVersion: GAIT_RULES_VERSION });
  });

  it("plants the target functions: no target, every request unmet, and the engine's weekly", () => {
    const plan = createPlan(INTAKE);
    expect(collectTargets({ intake: INTAKE, rom: [], gait: [] })).toEqual({ targets: [], referrals: [] });
    const request: TargetRequest = {
      id: "stretch:hip_flexors",
      side: "right",
      priority: 1,
      painFriendlyOnly: false,
      reasons: [],
      evidence: "Moderate",
    };
    expect(selectForTargets(INTAKE, plan, [], [request])).toEqual({
      selection: { days: [] },
      items: [],
      unmet: [request],
    });
    expect(whyLine([])).toEqual({ ar: "", en: "" });
    const ref = { checkId: "c1", romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 1 };
    expect(targetedWeekly(INTAKE, plan, [], [], ref)).toEqual(engineWeekly(INTAKE, plan));
    expect(targetedWeekly(INTAKE, { ...plan, status: "review" }, [], [], ref)).toBeNull();
  });

  it("plants the v7 contraindications with no id", () => {
    expect(v7Contraindications(INTAKE, null, null)).toEqual(new Set());
    expect(V7_ONLY_IDS.size).toBe(0);
  });
});

describe("engine seams", () => {
  it("plants a RomRunner and the gait analysis that throw until streams B and C build them", () => {
    expect(() => new RomRunner({} as never)).toThrow(/not built/);
    expect(() => analyseGaitView({} as never)).toThrow(/not built/);
    expect(() => analyseStaticStance({} as never)).toThrow(/not built/);
    expect(() => combineViews([], [], {} as never)).toThrow(/not built/);
  });
});

describe("UI seams", () => {
  it("renders nothing for the gait step, the gait card, the targets summary and the v7 pages", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, [
        createElement(GaitStep, {
          key: 1,
          plan: PLAN,
          checkId: "c1",
          lang: "ar",
          coach: () => {},
          onDone: () => {},
          onStop: () => {},
        }),
        createElement(GaitFindingsCard, { key: 2, gait: {} as never, lang: "ar" }),
        createElement(TargetsSummary, { key: 3, lang: "en", checkId: "c1", onOpenProgram: () => {} }),
        createElement(FocusApp, { key: 4, lang: "ar", onLanguage: () => {}, owner: "u1", onExit: () => {} }),
        createElement(FindingsPage, {
          key: 5,
          lang: "ar",
          onLanguage: () => {},
          checkId: null,
          onExit: () => {},
        }),
        createElement(ProgramPage, { key: 6, lang: "ar", onLanguage: () => {}, onExit: () => {} }),
        createElement(ShowcaseEntry, { key: 7, lang: "ar", onLanguage: () => {}, onExit: () => {} }),
      ]),
    );
    expect(html).toBe("<div></div>");
  });

  it("keeps the coach off in the useCoach placeholder", () => {
    const state = useCoach(null);
    expect(state).toMatchObject({ mode: "off", speaking: false, captions: [] });
    expect(() => state.push({ p: 3, type: "reps", exercise: "x", count: 1, target: 2, t: 0 })).not.toThrow();
    expect(() => state.end("done")).not.toThrow();
  });

  it("draws a movement as a labelled skeleton line figure, mirrored for the left side", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const html = renderToStaticMarkup(createElement(MovementPicture, { movementId: id, lang: "ar" }));
      expect(html).toMatch(/^<svg[^>]*role="img"/);
      expect(html).toContain(`aria-label="${ROM_DATA.movements.find((m) => m.id === id)!.name.ar}"`);
      expect(html).not.toMatch(/NaN/);
    }
    const left = renderToStaticMarkup(
      createElement(MovementPicture, { movementId: "knee_flexion", side: "left", lang: "en" }),
    );
    expect(left).toContain('transform="matrix(-1 0 0 1 120 0)"');
    expect(left).toContain('aria-label="Knee bend"');
  });
});

describe("fixture catalogues", () => {
  it("plants an empty range of motion catalogue that CATALOG spreads", () => {
    expect(ROM_CATALOG).toEqual([]);
    for (const e of ROM_CATALOG) expect(CATALOG).toContain(e);
    expect(source("tests/fixtures/catalog.ts")).toContain("...ROM_CATALOG,");
  });

  it("plants gaitFixtureFrames, which FixturePoseSource reads for a gait/ name", () => {
    expect(gaitFixtureFrames("gait/side/able-1")).toBeNull();
    expect(() => fixtureFrames("gait/side/able-1")).toThrow(RangeError);
    expect(fixtureFrames("seated-still").length).toBeGreaterThan(0);
  });
});

describe("v7 copy namespaces", () => {
  it("registers the six namespaces in src/i18n/v7.ts, empty until their owners fill them", () => {
    expect([...V7_NAMESPACES].sort()).toEqual(["coach", "gait", "intake7", "rom", "showcase", "targets"]);
    for (const ns of V7_NAMESPACES) {
      expect(V7_DICTIONARIES.ar[ns]).toBeDefined();
      expect(V7_DICTIONARIES.en[ns]).toBeDefined();
    }
  });

  it("keeps them out of the landing's dictionaries and src/i18n/index.ts", () => {
    for (const ns of V7_NAMESPACES) {
      expect(NAMESPACES as string[]).not.toContain(ns);
      expect(Object.keys(DICTIONARIES.en)).not.toContain(ns);
    }
    const index = source("src/i18n/index.ts");
    expect(index).not.toMatch(/from "\.\/v7"|intake7|showcase\.json/);
  });
});

describe("the v7 build flag and the lazy page entries", () => {
  it("is off unless the build sets VITE_V7=1", () => {
    expect(V7_UI).toBe(process.env.VITE_V7 === "1");
    expect(source("src/app/v7flag.ts")).toMatch(
      /export const V7_UI(: boolean)? = import\.meta\.env\.VITE_V7 === "1";/,
    );
  });

  it("declares every v7 page lazily behind the same test, so a default build has no v7 chunk", () => {
    const app = source("src/app/App.tsx");
    const pages = [
      "../features/focus/FocusApp",
      "../features/focus/FindingsPage",
      "../features/program-v7/ProgramPage",
      "../features/showcase/ShowcaseEntry",
    ];
    for (const page of pages)
      expect(app).toMatch(
        new RegExp(
          `import\\.meta\\.env\\.VITE_V7 === "1" \\? lazy\\(\\(\\) => import\\("${page}"\\)\\) : null`,
        ),
      );
    // Every other mention of the env variable is the flag's own test.
    for (const m of app.matchAll(/import\.meta\.env\.VITE_V7(.{0,8})/g)) expect(m[1]).toBe(' === "1"');
    // The landing's first script imports no v7 module but the flag: App.tsx takes only the types of
    // the pages (erased at build), and the landing and the shared copy take nothing of v7.
    const V7_MODULE =
      /features\/(focus|gait|coach-agent|program-v7|showcase|body-map)\/|i18n\/v7|movements\/(rom|gait|targets)|medical\/(rom-|gait-|target|body-map|focus-|pain-rule|contraindications)/;
    const imports = (file: string) =>
      [...source(file).matchAll(/^import (type )?[^;]*? from "([^"]+)";/gms)].map((m) => ({
        typeOnly: m[1] !== undefined,
        from: m[2],
      }));
    for (const file of ["src/app/Landing.tsx", "src/i18n/index.ts"])
      expect(imports(file).filter((i) => V7_MODULE.test(i.from) || i.from.endsWith("v7flag"))).toEqual([]);
    const fromApp = imports("src/app/App.tsx").filter((i) => V7_MODULE.test(i.from));
    expect(fromApp.length).toBe(4);
    expect(fromApp.every((i) => i.typeOnly)).toBe(true);
    expect(imports("src/app/App.tsx").some((i) => i.from === "./v7flag" && !i.typeOnly)).toBe(true);
  });
});
