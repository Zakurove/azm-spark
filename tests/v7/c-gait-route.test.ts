/**
 * The server's evaluateGait in A's gait route (product v7 contract 2.9, section 4 and 10 step C3):
 * POST /api/focus/:id/gait runs the gait rules on the posted analysis with the range rows saved so
 * far and returns them provisional, with their lines; the row keeps them without lines; complete runs
 * them again with every range row of the check and replaces them (C-13). The test of 2.9: a knee
 * straightening lack saved after the gait POST changes the crouch possible reasons complete returns.
 * Runs on the app's rules (FOCUS_RULES) and the real gait rules, as a booth check on a booth pass (C-14).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { evaluateGait } from "../../src/medical/gait-rules";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { GaitPatternResult } from "../../src/medical/gait-types";
import type { RomProtocol } from "../../src/medical/rom-protocol";
import { GAIT_RULES_VERSION } from "../../src/movements/gait";
import type { GaitAnalysis } from "../../src/engine/gait/types";
import { fill } from "../precheck-fixtures";
import { romBody } from "./a-focus-bodies";
import { MINUTE, T0, boothPass, member, startV7Api, v7Intake, type V7Harness } from "./a-harness";
import { SETUP, view } from "./c-gait-rules-fixtures";

/** The showcase person's walk (D-020: weaker right side): the right knee stays bent in stance, 1 m/s. */
function analysis(plan: GaitPlan): GaitAnalysis {
  const side = {
    knee_stance_min: { left: 4, right: 22, shareLeft: 0, shareRight: 1 },
    speed_mps: { value: 1 },
  };
  return {
    mode: "overground",
    views: plan.views.overground.map((v) => view({ view: v, ...(v === "side" ? { metrics: side } : {}) })),
    replay: null,
    staticStance: [],
    combined: {},
    flags: [],
    engineVersion: "gait_engine_1",
  };
}

const crouchRight = (patterns: GaitPatternResult[]) =>
  patterns.find((p) => p.pattern === "crouch" && p.side === "right");

describe("the gait route runs the server's gait rules", () => {
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

  it("returns provisional findings at the gait POST and the final ones at complete", async () => {
    const intake = v7Intake();
    const cookie = await member(h, "c3-gait@example.test", intake, ["focus_check"]);
    const booth = { "x-azm-booth": pass };
    const c = await h.call("/focus/context", undefined, cookie, "GET", booth);
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
    const s = start.data as { id: string; protocol: RomProtocol; gait: GaitPlan };
    expect(s.gait.offered).toBe(true);

    // The gait POST: the rules on the analysis with the range rows so far (none), provisional.
    const body = { setup: SETUP, analysis: analysis(s.gait) };
    const gait = await h.call(`/focus/${s.id}/gait`, body, cookie);
    expect(gait.status).toBe(200);
    expect(gait.data).toMatchObject({ provisional: true, rulesVersion: GAIT_RULES_VERSION });
    // The route gives the rules the walk's setup (CG-7) and the kept day answers (D-026 item 7).
    const kept = JSON.parse(
      (h.db().prepare("SELECT today FROM focus_checks WHERE id=?").get(s.id) as { today: string }).today,
    );
    const expected = evaluateGait({
      analysis: body.analysis,
      intake,
      romProfile: null,
      today: kept,
      plan: s.gait,
      setup: body.setup,
    });
    const status = (ps: GaitPatternResult[]) =>
      ps.map((p) => `${p.pattern}:${p.side}:${p.status}:${p.confidence}`);
    expect(status(gait.data.patterns)).toEqual(status(expected.patterns));
    expect(gait.data.findings).toEqual(expected.findings);
    const before = crouchRight(gait.data.patterns)!;
    expect(before).toMatchObject({ label: "knee_stays_bent", status: "likely", confidence: "high" });
    expect(before.lines.pattern.en).toContain("right knee stays bent");
    // The knee straightening is measured in the lying block, after the walk (C-13): not in yet.
    expect(before.contributors.at(-1)).toBe("knee_straighten_limited");

    // The row keeps the results without their lines (section 3).
    const row = h
      .db()
      .prepare("SELECT findings, rules_version FROM gait_analyses WHERE check_id=?")
      .get(s.id) as {
      findings: string;
      rules_version: string;
    };
    const stored = JSON.parse(row.findings) as { patterns: Omit<GaitPatternResult, "lines">[] };
    expect(stored.patterns.every((p) => !("lines" in p))).toBe(true);
    expect(row.rules_version).toBe(GAIT_RULES_VERSION);

    // The lying block: the right knee does not straighten by 15 degrees.
    const item = s.protocol.items.find(
      (i) => i.movementId === "knee_extension" && i.side === "right" && !i.skipped,
    );
    expect(item).toBeDefined();
    const rom = await h.call(`/focus/${s.id}/rom`, romBody(item!, 15), cookie);
    expect(rom.status).toBe(200);

    vi.setSystemTime(T0 + 20 * MINUTE);
    const done = await h.call(`/focus/${s.id}/complete`, {}, cookie);
    expect(done.status).toBe(200);
    expect(done.data.gait).toMatchObject({ provisional: false, rulesVersion: GAIT_RULES_VERSION });
    const after = crouchRight(done.data.gait.patterns)!;
    expect(after.contributors[0]).toBe("knee_straighten_limited");
    expect(after.lines.reasons).not.toEqual(before.lines.reasons);
    const replaced = JSON.parse(
      (
        h.db().prepare("SELECT findings FROM gait_analyses WHERE check_id=?").get(s.id) as {
          findings: string;
        }
      ).findings,
    ) as { patterns: Omit<GaitPatternResult, "lines">[] };
    expect(crouchRight(replaced.patterns as GaitPatternResult[])!.contributors[0]).toBe(
      "knee_straighten_limited",
    );
  });
});
