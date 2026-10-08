/**
 * Gate A (product v7 contract section 10, change log A5-1): when the A steps meet, the app's focus
 * routes take the real rules of steps A2 (hasV7Fields) and A4 (the range protocol, gait eligibility,
 * the pre-check bridge and the norms) through FOCUS_RULES in server/modules/focus/precheck.ts. A5's
 * route tests run on the small test rules of a-focus-rules.ts; this file runs a booth focus check
 * from the context to complete on the rules the app ships, and runs the body map of every condition
 * answer (A2) through the range protocol and the gait plan (A4). It also holds what the merge adds
 * to the shared files: the type the change log asked for before the freeze, and the licence fields
 * of the code stream A ported or added (contract 1.4).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { createPlan, hasV7Fields, validateIntake } from "../../src/medical/plan";
import { autoFillRegions, painIdsFromRegions, type AutoFillAnswer } from "../../src/medical/body-map";
import {
  MAX_MEASURED_PER_CHECK,
  buildRomProtocol,
  type RomProtocol,
  type RomProtocolItem,
} from "../../src/medical/rom-protocol";
import { gaitPlanFor, type GaitPlan } from "../../src/medical/gait-eligibility";
import { applyPrecheckOutcome, focusPrecheckEnv } from "../../src/medical/focus-precheck";
import { gradeMeasurement, typicalValue } from "../../src/medical/rom-norms";
import { ROM_RULES_VERSION } from "../../src/movements/rom";
import { GAIT_RULES_VERSION } from "../../src/movements/gait";
import type { ToolResult } from "../../src/coach/types";
import { gaitBody, romBody } from "./a-focus-bodies";
import { MINUTE, T0, boothPass, member, startV7Api, v7Intake, type V7Harness } from "./a-harness";

describe("the section 2 types frozen at Gate A", () => {
  it("let a host reject an answer tool nobody answered (D-022, S0-2: no_answer_heard)", () => {
    // Checked by npm run check: the reason must be a member of ToolResult["reason"].
    const r: ToolResult = { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" };
    expect(r.reason).toBe("no_answer_heard");
  });
});

describe("THIRD_PARTY_LICENSES.md after the A merges", () => {
  it("fills the bracketed fields of the code stream A ported, vendored or added (contract 1.4, 6.3)", () => {
    const lines = readFileSync(join(__dirname, "../..", "THIRD_PARTY_LICENSES.md"), "utf8").split("\n");
    const filled = [
      "**Pose2Sim**",
      "**Sports2D**",
      "**SciPy**",
      "**digital-filter** 2.4.2",
      "**@google/genai** 2.27.0",
    ];
    for (const name of filled) {
      const line = lines.find((l) => l.startsWith(`- ${name}`));
      expect(line, name).toBeDefined();
      expect(line, name).not.toMatch(/\[[^\]]*\]/);
    }
  });

  it("fills the bracketed fields of the code stream C ported, from its file headers (wave 2 merge)", () => {
    const lines = readFileSync(join(__dirname, "../..", "THIRD_PARTY_LICENSES.md"), "utf8").split("\n");
    const expected: [string, string[]][] = [
      [
        "**myogait**",
        ["Copyright (c) 2024 Frederic Fer, Institut de Myologie", "695ca8636d071f7c84374f2e0bdd48caeb1b869a"],
      ],
      [
        "**OpenCap processing**",
        [
          "Copyright 2023 Stanford University and the Authors",
          "72b5416bf6172fe3d9b42b01e1a02252362b20fc",
          "NOTICE: none",
        ],
      ],
      ["**Pose2Sim**", ["`src/engine/gait/scale.ts`"]],
    ];
    for (const [name, parts] of expected) {
      const line = lines.find((l) => l.startsWith(`- ${name}`));
      expect(line, name).toBeDefined();
      expect(line, name).not.toMatch(/\[[^\]]*\]/);
      for (const part of parts) expect(line, name).toContain(part);
    }
  });

  it("fills the bracketed fields of the code stream D vendored, from its file headers (wave 2 merge)", () => {
    const text = readFileSync(join(__dirname, "../..", "THIRD_PARTY_LICENSES.md"), "utf8");
    const line = text.split("\n").find((l) => l.startsWith("- **Gemini Live API Web Console**"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\[[^\]]*\]/);
    for (const part of [
      "Copyright 2024 Google LLC",
      "0a4542fe0e39d07956ea7af5de45d7c81fde8960",
      "NOTICE: none",
      "`src/features/coach-agent/audio/`",
    ])
      expect(line).toContain(part);
    // No bracketed field is left anywhere in the v7 section once C and D are merged.
    const v7 = text.slice(text.indexOf("## Azm v7 (range of motion, gait, live coach)"));
    expect(v7).not.toMatch(/\[(copyright|sha|x|text or none|or: )[^\]]*\]/);
  });
});

describe("FOCUS_RULES", () => {
  it("binds the real rules of steps A2 and A4", () => {
    expect(FOCUS_RULES).not.toBeNull();
    const rules = FOCUS_RULES!;
    expect(rules.hasV7Fields).toBe(hasV7Fields);
    expect(rules.buildRomProtocol).toBe(buildRomProtocol);
    expect(rules.gaitPlanFor).toBe(gaitPlanFor);
    expect(rules.focusPrecheckEnv).toBe(focusPrecheckEnv);
    expect(rules.applyPrecheckOutcome).toBe(applyPrecheckOutcome);
    expect(rules.gradeMeasurement).toBe(gradeMeasurement);
    expect(rules.typicalValue).toBe(typicalValue);
  });
});

describe("the app's focus routes on the real rules", () => {
  let h: V7Harness;
  let pass = "";
  beforeAll(async () => {
    h = await startV7Api(FOCUS_RULES);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    process.env.AZM_V7 = "1";
    pass = await boothPass(h, T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
  });

  it("run a booth focus check from the context to complete", async () => {
    // The showcase shape (D-020): weaker right side after a stroke, walks without an aid.
    const intake = v7Intake();
    const cookie = await member(h, "gate-a@example.test", intake, ["focus_check"]);
    const booth = { "x-azm-booth": pass };

    const c = await h.call("/focus/context", undefined, cookie, "GET", booth);
    expect(c.status).toBe(200);
    expect(c.data).toMatchObject({ intakeReady: true, setting: "booth" });
    expect((c.data.protocol as RomProtocol).items.length).toBeGreaterThan(0);

    const start = await h.call(
      "/focus",
      {
        setting: "booth",
        today: { painByRegion: {}, redFlagRegions: [], worrying: false, unsteady: false, walk10m: true },
        device: { os: "iOS", browser: "Safari" },
        include: { rom: true, gait: true },
      },
      cookie,
      "POST",
      booth,
    );
    expect(start.status).toBe(200);
    const s = start.data as { id: string; protocol: RomProtocol; gait: GaitPlan | null };
    expect(s.protocol.rulesVersion).toBe(ROM_RULES_VERSION);
    const runs = s.protocol.items.filter((i) => !i.skipped);
    expect(runs.length).toBeGreaterThan(0);
    // Only the body map's regions are measured (D-019), seated before standing before lying (C-13).
    expect(new Set(runs.map((i) => i.region))).toEqual(new Set(["knee", "shoulder"]));
    const blocks = runs.map((i) => ["seated", "standing", "lying"].indexOf(i.block));
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
    expect(s.gait?.offered).toBe(true);

    // The server grades with the real norms: the typical value of the person's sex and age is within.
    const first: RomProtocolItem = runs[0];
    const typical = typicalValue(
      first.movementId,
      "male",
      intake.age,
      first.side === "none" ? undefined : first.side,
    );
    expect(typical).not.toBeNull();
    const rom = await h.call(`/focus/${s.id}/rom`, romBody(first, typical!), cookie);
    expect(rom.status).toBe(200);
    expect(rom.data).toMatchObject({ saved: true, typical, grade: { finding: "within" } });

    const gait = await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "overground"), cookie);
    expect(gait.status).toBe(200);
    expect(gait.data).toMatchObject({ provisional: true, rulesVersion: GAIT_RULES_VERSION });

    vi.setSystemTime(T0 + 20 * MINUTE);
    const done = await h.call(`/focus/${s.id}/complete`, {}, cookie);
    expect(done.status).toBe(200);
    expect(done.data.status).toBe("completed");
    expect(done.data.gait).toMatchObject({ provisional: false });

    // Every entry of the protocol has its row: the measured item, the rest not measured today.
    const rows = h
      .db()
      .prepare("SELECT movement_id, side, source FROM rom_measurements WHERE check_id=?")
      .all(s.id) as { movement_id: string; side: string; source: string }[];
    const sourceOf = (m: string, side: string) =>
      rows.find((r) => r.movement_id === m && r.side === side)?.source;
    expect(sourceOf(first.movementId, first.side)).toBe("measured");
    for (const i of [...runs.slice(1), ...s.protocol.deferred])
      expect(sourceOf(i.movementId, i.side), `${i.movementId}:${i.side}`).toBe("not_measured_today");
    for (const n of s.protocol.notMeasured)
      expect(sourceOf(n.movementId, n.side), `${n.movementId}:${n.side}`).toBe(n.source);
  });
});

describe("the day answers a focus check keeps, from the day's one screen (D-026 item 9, D-032 item 2)", () => {
  let h: V7Harness;
  beforeAll(async () => {
    h = await startV7Api(FOCUS_RULES);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    process.env.AZM_V7 = "1";
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
  });

  it("a stroke in a wheelchair bends seated on armrests at home with a helper line, never a question (D-034 item 2)", async () => {
    // A stroke in a wheelchair with the back on the map: the side bend runs seated on armrests, and
    // the side lean's helper rule marks it as needing someone beside the person: a line on its card,
    // not a gate (no day screen asks any more).
    const intake = v7Intake({
      mobility: "wheelchair",
      walking: { status: "no" },
      romFlags: { osteoporosis: false, neckCaution: false, transferChair: false, sitUnsupported: "yes" },
      regions: [{ region: "back_trunk", side: "axial", problems: ["stiffness"], origin: "person" }],
    });
    const cookie = await member(h, "gate-lean@example.test", intake, ["focus_check"]);
    const c = await h.call("/focus/context", undefined, cookie);
    expect(c.status).toBe(200);
    const r = await h.call(
      "/focus",
      {
        setting: "home",
        today: { painByRegion: { back_trunk: 0 }, redFlagRegions: [] },
        device: { os: "iOS", browser: "Safari" },
        include: { rom: true, gait: false },
      },
      cookie,
    );
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const lean = (p: RomProtocol) => p.items.filter((i) => i.position === "seated_armrests");
    expect(lean(r.data.protocol).length).toBeGreaterThan(0);
    expect(lean(r.data.protocol).every((i) => !i.skipped && i.helperRequired)).toBe(true);
    expect(r.data.helperRequired).toContain("rom_seated");
    const row = h.db().prepare("SELECT today FROM focus_checks WHERE id=?").get(r.data.id) as {
      today: string;
    };
    // Only the pain before (0, D-034) is kept; no helper answer was asked, no red flag, no worry.
    expect(JSON.parse(row.today)).toEqual({ painByRegion: { back_trunk: 0 } });
  });
});

describe("A2's body map feeds A4's range protocol (the seam the parallel steps never ran)", () => {
  /** One answer of each kind of rom-protocol 2.3, as the intake form's condition questions give them. */
  const ANSWERS: AutoFillAnswer[] = [
    { condition: "stroke", weakerSide: "left" },
    { condition: "stroke", weakerSide: "right" },
    { condition: "cerebral_palsy", pattern: "one_side", side: "left" },
    { condition: "cerebral_palsy", pattern: "both_legs" },
    { condition: "cerebral_palsy", pattern: "all_limbs" },
    { condition: "ms", limbs: ["right_arm", "left_leg"] },
    { condition: "ms", limbs: ["right_arm", "left_arm", "right_leg", "left_leg"] },
    { condition: "parkinsons", confirmed: true },
    { condition: "sci_complete", level: "neck" },
    { condition: "sci_incomplete", level: "back" },
    { condition: "lower_limb_unilateral", side: "left", level: "below_knee" },
    { condition: "lower_limb_unilateral", side: "right", level: "above_knee" },
    { condition: "upper_limb_unilateral", side: "left", level: "below_elbow" },
    { condition: "upper_limb_unilateral", side: "right", level: "above_elbow" },
  ];
  const day = { painByRegion: {}, redFlagRegions: [] };

  for (const answer of ANSWERS)
    it(`${answer.condition} ${JSON.stringify(answer).slice(1, -1)}`, () => {
      const regions = autoFillRegions([answer]);
      const wheelchair = answer.condition === "sci_complete" || answer.condition === "sci_incomplete";
      const intake = v7Intake({
        conditions: [answer.condition],
        regions,
        pain: painIdsFromRegions(regions),
        mobility: wheelchair ? "wheelchair" : "standing",
        walking: wheelchair ? { status: "no" } : { status: "without_aid" },
        romFlags: { osteoporosis: false, neckCaution: false },
      });
      expect(regions.length).toBeGreaterThan(0);
      expect(validateIntake(intake)).toBe(true);
      expect(hasV7Fields(intake)).toBe(true);
      expect(() => createPlan(intake)).not.toThrow();
      if (!hasV7Fields(intake)) return;
      const onMap = new Set(regions.map((r) => r.region));
      for (const setting of ["home", "booth"] as const) {
        const p = buildRomProtocol({ intake, setting, today: day });
        const all = [...p.items, ...p.deferred];
        // Only the body map's regions are planned. The joints below an amputation are the one record
        // off the map (rom-protocol 2.4: not applicable, limb absent), and every region on the map
        // is accounted for: planned, or not measured with its reason (above the knee or the elbow
        // nothing is left to measure, and the start answers NOTHING_TO_MEASURE).
        for (const i of all) expect(onMap.has(i.region), `${i.movementId} ${i.region}`).toBe(true);
        for (const n of p.notMeasured)
          if (!onMap.has(n.region))
            expect(`${n.source}:${n.reason}`, `${n.movementId} ${n.region}`).toBe(
              "not_applicable:limb_absent",
            );
        const accounted = new Set([...all, ...p.notMeasured].map((x) => x.region));
        for (const r of onMap) expect(accounted.has(r), r).toBe(true);
        // Each movement and side once, at most 8 running, in block order.
        const keys = all.map((i) => `${i.movementId}:${i.side}`);
        expect(new Set(keys).size).toBe(keys.length);
        const runs = p.items.filter((i) => !i.skipped);
        expect(runs.length).toBeLessThanOrEqual(MAX_MEASURED_PER_CHECK);
        const blocks = runs.map((i) => ["seated", "standing", "lying"].indexOf(i.block));
        expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
        const gait = gaitPlanFor(intake, day, setting, {});
        if (wheelchair) expect(gait).toMatchObject({ offered: false, reason: "not_walking" });
      }
    });
});
