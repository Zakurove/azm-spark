/**
 * The seams stream A plants at Gate A (product v7 contract 1.3): every file streams B to F fill later
 * exists with its final exported signature, so they compile against it from day one. The tests here
 * hold for the placeholders and keep holding once the owners fill the files (a stream never edits
 * another stream's tests): the exports and their arities, the contract rules every implementation
 * keeps (a stored row keeps its own source in the profile; a targeted weekly is null exactly when the
 * engine's is), the fixture catalogues and their two hunks, the v7 copy namespaces (registered in
 * src/i18n/v7.ts, never in the landing's dictionaries), the build flag and App.tsx's lazy v7 entries.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileRoutes } from "../../server/modules/focus/profile";
import { agentRoutes } from "../../server/modules/agent/routes";
import { programRoutes } from "../../server/modules/program/routes";
import { afterIntakeSaved } from "../../server/modules/program/hooks";
import * as romProfile from "../../src/medical/rom-profile";
import type { StoredRomRow } from "../../src/medical/rom-types";
import * as gaitRules from "../../src/medical/gait-rules";
import * as targets from "../../src/medical/targets";
import * as contraindications from "../../src/medical/contraindications";
import { createPlan, type Intake } from "../../src/medical/plan";
import { RomRunner } from "../../src/engine/rom/runner";
import * as analyse from "../../src/engine/gait/analyse";
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
import { NORMS_VERSION, ROM_DATA } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";

const ROOT = join(__dirname, "../..");
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");

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

/** Each export is a function taking at least `n` parameters (the contract's signature). */
function functions(mod: Record<string, unknown>, names: Record<string, number>) {
  for (const [name, n] of Object.entries(names)) {
    expect(typeof mod[name], name).toBe("function");
    expect((mod[name] as (...a: unknown[]) => unknown).length, name).toBeGreaterThanOrEqual(n);
  }
}

describe("server seams", () => {
  it("plants the profile, agent and program route lists and the intake hook", () => {
    for (const routes of [profileRoutes, agentRoutes, programRoutes]) {
      expect(Array.isArray(routes)).toBe(true);
      for (const r of routes)
        expect(r).toMatchObject({ path: expect.any(RegExp), handle: expect.any(Function) });
    }
    expect(typeof afterIntakeSaved).toBe("function");
    expect(afterIntakeSaved.length).toBe(2);
  });
});

describe("medical seams", () => {
  it("export the functions of 2.7, 2.9 and 2.10 with their signatures", () => {
    functions(romProfile, { buildRomProfile: 1, romFindings: 2, bodyMapSummary: 1, compareRom: 3 });
    functions(gaitRules, { evaluateGait: 1 });
    functions(targets, { collectTargets: 1, selectForTargets: 4, whyLine: 1, targetedWeekly: 5 });
    functions(contraindications, { v7Contraindications: 3 });
    expect(contraindications.V7_ONLY_IDS).toBeInstanceOf(Set);
  });

  it("keeps a stored row under its own source in the profile, every joint movement listed", () => {
    const rows = [
      storedRow({}),
      storedRow({
        id: "r2",
        movementId: "wrist_flexion",
        position: null,
        value: null,
        source: "not_measured_camera",
        reason: "not_measured_camera",
        finding: "unknown",
        gradeIgnoringPain: null,
        percentNormal: null,
        median: null,
        nValid: 0,
      }),
    ];
    const p = romProfile.buildRomProfile({ intake: INTAKE, rows, now: 5 });
    expect(p).toMatchObject({ sex: "female", age: 58, normsVersion: NORMS_VERSION });
    expect(p.entries.find((e) => e.movementId === "knee_flexion" && e.side === "right")).toMatchObject({
      source: "measured",
      value: 110,
    });
    expect(p.entries.find((e) => e.movementId === "wrist_flexion" && e.side === "right")?.source).toBe(
      "not_measured_camera",
    );
    for (const id of ROM_MOVEMENT_IDS)
      expect(
        p.entries.some((e) => e.movementId === id),
        id,
      ).toBe(true);
    for (const d of ROM_DATA.defaultMovements)
      expect(
        p.entries.some((e) => e.movementId === d.id),
        d.id,
      ).toBe(true);
    const keys = p.entries.map((e) => `${e.movementId}:${e.side}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives no targeted weekly exactly when the plan is not ready (2.10)", () => {
    const plan = createPlan(INTAKE);
    const ref = { checkId: "c1", romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 1 };
    expect(targets.targetedWeekly(INTAKE, { ...plan, status: "review" }, [], [], ref)).toBeNull();
  });
});

describe("engine seams", () => {
  it("export the RomRunner class and the gait analysis of 2.6 and 2.8", () => {
    expect(typeof RomRunner).toBe("function");
    for (const m of [
      "start",
      "feed",
      "answerCanMove",
      "answerMax",
      "answerPain",
      "answerCause",
      "keepReaching",
    ])
      expect(typeof (RomRunner.prototype as unknown as Record<string, unknown>)[m], m).toBe("function");
    for (const m of ["pause", "resume", "stop", "finish"])
      expect(typeof (RomRunner.prototype as unknown as Record<string, unknown>)[m], m).toBe("function");
    functions(analyse, { analyseGaitView: 1, analyseStaticStance: 1, combineViews: 3 });
  });
});

describe("UI seams", () => {
  it("export the gait step and card, the coach hook, the targets summary and the four v7 pages", () => {
    for (const component of [GaitStep, GaitFindingsCard, TargetsSummary, MovementPicture])
      expect(typeof component).toBe("function");
    for (const page of [FocusApp, FindingsPage, ProgramPage, ShowcaseEntry])
      expect(typeof page).toBe("function");
    expect(typeof useCoach).toBe("function");
    expect(useCoach.length).toBe(1);
  });

  it("draws every movement with its name for assistive technology", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const name = ROM_DATA.movements.find((m) => m.id === id)!.name;
      for (const lang of ["ar", "en"] as const) {
        const html = renderToStaticMarkup(createElement(MovementPicture, { movementId: id, lang }));
        expect(html, `${id} ${lang}`).toContain(name[lang]);
        expect(html).not.toMatch(/NaN/);
      }
    }
  });
});

describe("fixture catalogues", () => {
  it("spreads the range of motion catalogue into CATALOG", () => {
    for (const e of ROM_CATALOG) expect(CATALOG).toContain(e);
    expect(source("tests/fixtures/catalog.ts")).toContain("...ROM_CATALOG,");
  });

  it("reads a gait/ name through gaitFixtureFrames in FixturePoseSource", () => {
    expect(gaitFixtureFrames("gait/no-such-fixture/none")).toBeNull();
    expect(() => fixtureFrames("gait/no-such-fixture/none")).toThrow(RangeError);
    expect(fixtureFrames("seated-still").length).toBeGreaterThan(0);
  });
});

describe("v7 copy namespaces", () => {
  it("registers the six namespaces in src/i18n/v7.ts", () => {
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
