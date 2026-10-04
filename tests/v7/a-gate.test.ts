/**
 * Gate A (product v7 contract section 10, change log A5-1): when the A steps meet, the app's focus
 * routes take the real rules of steps A2 (hasV7Fields) and A4 (the range protocol, gait eligibility,
 * the pre-check bridge and the norms) through FOCUS_RULES in server/modules/focus/precheck.ts. A5's
 * route tests run on the small test rules of a-focus-rules.ts; this file runs a booth focus check
 * from the context to complete on the rules the app ships.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { hasV7Fields } from "../../src/medical/plan";
import { buildRomProtocol, type RomProtocol, type RomProtocolItem } from "../../src/medical/rom-protocol";
import { gaitPlanFor, type GaitPlan } from "../../src/medical/gait-eligibility";
import { applyPrecheckOutcome, focusPrecheckEnv } from "../../src/medical/focus-precheck";
import { gradeMeasurement, typicalValue } from "../../src/medical/rom-norms";
import { ROM_RULES_VERSION } from "../../src/movements/rom";
import { GAIT_RULES_VERSION } from "../../src/movements/gait";
import type { ToolResult } from "../../src/coach/types";
import { fill } from "../precheck-fixtures";
import { gaitBody, romBody } from "./a-focus-bodies";
import { MINUTE, T0, boothPass, member, startV7Api, v7Intake, type V7Harness } from "./a-harness";

describe("the section 2 types frozen at Gate A", () => {
  it("let a host reject an answer tool nobody answered (D-022, S0-2: no_answer_heard)", () => {
    // Checked by npm run check: the reason must be a member of ToolResult["reason"].
    const r: ToolResult = { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" };
    expect(r.reason).toBe("no_answer_heard");
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
        answers: fill(c.data.env),
        today: { painByRegion: {}, redFlagRegions: [], walk10m: true },
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
