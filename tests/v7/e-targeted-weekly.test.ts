/**
 * Step E2 (product v7 contract 2.10, 8.1 E): targetedWeekly, the weekly plan built from a focus check's
 * findings: rules first (the finding items of selectForTargets, each with its why line), then the
 * existing goal and sport share (5.7: «Targets from the person's goal or sport ... keep their current
 * share of the session»), the week's findings ref, and null exactly when engineWeekly is null.
 */
import { describe, expect, it } from "vitest";
import { createPlan, type Intake, type Plan } from "../../src/medical/plan";
import { libraryById, libraryPool } from "../../src/medical/pool";
import { sportById } from "../../src/medical/sports";
import { SESSION_SLOTS, targetedWeekly } from "../../src/medical/targets";
import { engineWeekly, stepsOf, type WeeklyItem, type WeeklyPlan } from "../../src/medical/weekly";
import { TARGETS_DATA } from "../../src/movements/targets";
import { FAHD, finding, intake, pattern } from "./e-fixtures";

const REF = {
  checkId: "c1",
  romVersion: "rom_protocol_1.0.0",
  gaitVersion: null,
  targetsVersion: "targets_1.0.0",
  created: 5,
};
const planOf = (h: Intake): Plan => {
  const p = createPlan(h);
  if (p.status !== "ready") throw new Error(`plan in review: ${p.reasons.join(", ")}`);
  return p;
};
const ROM = [
  finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
  finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "umn" }),
];
const GAIT = [
  pattern({
    pattern: "stiff_knee",
    side: "right",
    targets: [
      { id: "strengthen:calf", side: "right" },
      { id: "practice:push_off", side: "right" },
      { id: "strengthen:hip_flexors", side: "right" },
    ],
  }),
];
const items = (w: WeeklyPlan) => w.days.flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown]);
const targeted = (i: WeeklyItem) => i.why !== undefined;

describe("targetedWeekly", () => {
  it("is null exactly when engineWeekly is null (the plan in review)", () => {
    const plan = planOf(FAHD);
    expect(targetedWeekly(FAHD, { ...plan, status: "review" }, ROM, GAIT, REF)).toBeNull();
    expect(engineWeekly(FAHD, { ...plan, status: "review" })).toBeNull();
    expect(targetedWeekly(FAHD, plan, ROM, GAIT, REF)).not.toBeNull();
  });

  it("carries the findings ref, the rules as its source and a summary that names the results", () => {
    const w = targetedWeekly(FAHD, planOf(FAHD), ROM, GAIT, REF)!;
    expect(w.findings).toEqual(REF);
    expect(w.source).toBe("engine");
    expect(w.summary.en).toMatch(/your movement results/);
    expect(w.summary.ar).toMatch(/نتائج قياس حركتك/);
    expect(w.days).toHaveLength(FAHD.days.length);
  });

  it("each finding item has its why line, targets and reasons; the goal share has none", () => {
    const w = targetedWeekly(FAHD, planOf(FAHD), ROM, GAIT, REF)!;
    const finding = items(w).filter(targeted);
    expect(finding.length).toBeGreaterThan(0);
    for (const i of finding) {
      expect(i.why!.ar.length, i.id).toBeGreaterThan(0);
      expect(i.targets!.length, i.id).toBeGreaterThan(0);
      expect(i.reasonRefs!.length, i.id).toBeGreaterThan(0);
    }
    const share = items(w).filter((i) => !targeted(i));
    expect(share.length).toBeGreaterThan(0);
    for (const i of share) expect(i.targets, i.id).toBeUndefined();
  });

  it("fills at most half a session with finding items, and keeps the rest for the goal", () => {
    const w = targetedWeekly(FAHD, planOf(FAHD), ROM, GAIT, REF)!;
    const most = Math.floor(SESSION_SLOTS * TARGETS_DATA.mapping.selectionNumbers.findingSlotsShareMax);
    for (const d of w.days) {
      const all = [...d.warmup, ...d.extra, ...d.cooldown];
      expect(all.filter(targeted).length).toBeLessThanOrEqual(most);
      expect(d.warmup.length).toBeLessThanOrEqual(2);
      expect(d.extra.length).toBeLessThanOrEqual(3);
      expect(d.cooldown.length).toBeLessThanOrEqual(2);
      expect(all.length).toBe(SESSION_SLOTS);
      expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    }
  });

  it("the goal share comes from the default pool, never a draft; drafts are finding items only", () => {
    const w = targetedWeekly(FAHD, planOf(FAHD), ROM, GAIT, REF)!;
    const pool = new Set(libraryPool(FAHD).map((e) => e.id));
    for (const i of items(w)) {
      const e = libraryById(i.id)!;
      if (targeted(i)) continue;
      expect(pool.has(i.id), i.id).toBe(true);
      expect(e.status, i.id).not.toBe("draft");
    }
  });

  it("a goal of strength keeps its share: its categories fill the rest of each day", () => {
    const h = { ...FAHD, goal: "strength" as const, equipment: ["bands"] };
    const w = targetedWeekly(h, planOf(h), ROM, GAIT, REF)!;
    const extras = w.days.flatMap((d) => d.extra.filter((i) => !targeted(i)));
    expect(extras.length).toBeGreaterThan(0);
    for (const i of extras)
      expect(["upper_body", "core", "lower_body", "balance"]).toContain(libraryById(i.id)!.category);
  });

  it("a sport keeps its share: the rest of each day builds the sport's demands", () => {
    const sport = sportById("para_athletics");
    expect(sport).toBeDefined();
    const h: Intake = { ...FAHD, goal: "sport", sport: sport!.id, equipment: ["bands", "weights"] };
    const w = targetedWeekly(h, planOf(h), ROM, GAIT, REF)!;
    const share = w.days.flatMap((d) => d.extra.filter((i) => !targeted(i)));
    expect(share.some((i) => libraryById(i.id)!.demands.some((x) => sport!.demands.includes(x)))).toBe(true);
    expect(w.summary.en).toMatch(new RegExp(sport!.name.en.toLowerCase()));
  });

  it("without findings, the week is the goal's alone", () => {
    const w = targetedWeekly(FAHD, planOf(FAHD), [], [], REF)!;
    // The condition's regions still give their region defaults (the shoulder's outward turn).
    for (const i of items(w).filter(targeted))
      expect(i.reasonRefs!.every((r) => r.kind === "region_default")).toBe(true);
  });

  it("every step of the week reads whole: a targeted item's hold fills the steps' placeholders", () => {
    for (const h of [FAHD, intake({ age: 70, regions: FAHD.regions, conditions: ["stroke"] })]) {
      const w = targetedWeekly(
        h,
        planOf(h),
        [...ROM, finding("knee_flexion", "left", { path: "tight", cause: "tight" })],
        GAIT,
        REF,
      )!;
      for (const i of items(w)) {
        const e = libraryById(i.id)!;
        for (const lang of ["ar", "en"] as const)
          for (const s of stepsOf(e, i, lang)) expect(s, i.id).not.toMatch(/\{hold_/);
      }
    }
  });
});
