/**
 * gaitPlanFor (product v7 contract 2.5, 8.1 A "gaitPlanFor per eligibility item"): gait-rules
 * eligibility.gate, eligibility.today and modeChoice, one case per item, plus the views, the static
 * stance and the red flags of the day. Parity: the thresholds and the item lists are read back from
 * GAIT_DATA.eligibility, which writes them in words.
 */
import { describe, expect, it } from "vitest";
import {
  GAIT_ANTALGIC_PAIN,
  GAIT_PAD_CONDITIONS,
  GAIT_PAD_PAIN_NOW_FROM,
  GAIT_PAIN_SKIP_AT,
  gaitPlanFor,
  type GaitPlan,
} from "../../src/medical/gait-eligibility";
import type { Answers } from "../../src/medical/precheck";
import { PAIN_STOP } from "../../src/medical/pain-rule";
import { GAIT_DATA } from "../../src/movements/gait";
import { CHECK_DATA } from "../../src/movements/assessments";
import { entry, intake, today, type V7Intake } from "./a-fixtures";
import type { FocusToday } from "../../src/medical/rom-protocol";

/** The answers of a careful walker who passes every pad condition. */
const calm: Answers = {
  "pc_steadi:fell": "no",
  "pc_steadi:unsteady": "no",
  "pc_steadi:worry": "no",
  pc_walking_aid: "no",
  pc_pain_now: 0,
};
const plan = (
  h: V7Intake = intake(),
  t: Partial<FocusToday> = {},
  answers: Answers = calm,
  setting: "home" | "booth" = "booth",
): GaitPlan => gaitPlanFor(h, today(t), setting, answers);
const notOffered = (p: GaitPlan) => (p.offered ? null : p.reason);

describe("gait-rules eligibility.gate", () => {
  it("a walker with every answer calm: overground or the pad, with the default overground", () => {
    const p = plan();
    expect(p).toMatchObject({
      offered: true,
      modes: ["overground", "walking_pad"],
      defaultMode: "overground",
      padAllowed: true,
      helperRequired: false,
      antalgicOnly: false,
      staticStance: true,
    });
    expect(p.reason).toBeUndefined();
  });

  it("intake.walking no: not offered", () => {
    expect(notOffered(plan(intake({ walking: { status: "no" } })))).toBe("not_walking");
    expect(notOffered(plan(intake({ walking: undefined })))).toBe("not_walking");
    expect(plan(intake({ walking: { status: "with_aid", aid: "cane" } })).offered).toBe(true);
  });

  it("pc_walk_10m no: not offered (walk_needs_hands_on_help); not answered yet: still planned", () => {
    expect(notOffered(plan(intake(), { walk10m: false }))).toBe("walk_needs_hands_on_help");
    expect(plan(intake(), { walk10m: true }).offered).toBe(true);
    expect(plan(intake(), {}).offered).toBe(true);
  });

  it("restriction no_weight_bearing or no_exercise: not offered", () => {
    expect(notOffered(plan(intake({ restrictions: ["no_weight_bearing"] })))).toBe("restriction");
    expect(plan(intake({ restrictions: ["no_exercise"] })).offered).toBe(false);
    expect(plan(intake({ restrictions: ["no_overhead"] })).offered).toBe(true);
  });

  it("lower limb loss: only with the prosthesis on", () => {
    const h = intake({
      conditions: ["lower_limb_unilateral"],
      regions: [entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
    });
    expect(notOffered(plan(h, {}))).toBe("prosthesis_off");
    expect(notOffered(plan(h, { prosthesisOn: false }))).toBe("prosthesis_off");
    expect(plan(h, { prosthesisOn: true }).offered).toBe(true);
    expect(plan(h, {}, { ...calm, pc_limb_leg_prosthesis: "yes" }).offered).toBe(true);
  });

  it("recent surgery to the back, hip, knee, ankle or foot not cleared: not offered today", () => {
    const surgery = (area: string, cleared: "yes" | "no"): Answers => ({
      ...calm,
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": [area],
      [`pc_surgery_recent:${area}`]: cleared,
    });
    for (const area of ["spine", "hip", "knee", "ankle_foot", "other"])
      expect(notOffered(plan(intake(), {}, surgery(area, "no"))), area).toBe("surgery_not_cleared");
    expect(plan(intake(), {}, surgery("knee", "yes")).offered).toBe(true);
    expect(plan(intake(), {}, surgery("shoulder_right", "no")).offered).toBe(true);
    // Yes with no listed area: the widest restriction (the v1 unlisted area).
    expect(
      notOffered(plan(intake(), {}, { ...calm, pc_surgery_recent: "yes", "pc_surgery_recent:areas": [] })),
    ).toBe("surgery_not_cleared");
    // The body map says the same: surgery under 3 months on a leg or the back without clearance.
    const map = intake({
      regions: [
        entry("knee", "right", ["after_surgery"], {
          surgery: { since: "6w_3m", cleared: "unsure" },
        }),
      ],
    });
    expect(notOffered(plan(map))).toBe("surgery_not_cleared");
    // 3 months or more: no clearance is asked or stored (D-024, A2-8), and absent is no restriction.
    for (const since of ["3m_6m", "gt6m"] as const) {
      const older = intake({ regions: [entry("knee", "right", ["after_surgery"], { surgery: { since } })] });
      expect(plan(older).offered, since).toBe(true);
    }
  });

  it("clearance no or unsure: stroke or SCI not offered; others overground only", () => {
    expect(notOffered(plan(intake({ conditions: ["stroke"], clearance: "unsure" })))).toBe(
      "clearance_needed",
    );
    expect(notOffered(plan(intake({ conditions: ["sci_incomplete"], clearance: "no" })))).toBe(
      "clearance_needed",
    );
    const other = plan(intake({ conditions: ["arthritis"], clearance: "unsure" }));
    expect(other).toMatchObject({ offered: true, modes: ["overground"], padAllowed: false });
  });

  it("the global gate: no gait test", () => {
    expect(notOffered(plan(intake({ conditions: ["cardiac"] })))).toBe("global_gate");
    expect(notOffered(plan(intake({ symptoms: "yes" })))).toBe("global_gate");
  });
});

describe("gait-rules eligibility.today", () => {
  it("leg, hip or back pain 6 or more today: not offered (one shared rule)", () => {
    expect(GAIT_PAIN_SKIP_AT).toBe(PAIN_STOP.atOrAbove);
    expect(notOffered(plan(intake(), { painByRegion: { knee: 6 } }))).toBe("pain_today");
    expect(notOffered(plan(intake(), { painByRegion: { back_trunk: 7 } }))).toBe("pain_today");
    expect(
      notOffered(plan(intake(), {}, { ...calm, pc_pain_now: 6, pc_pain_areas: { ankle_foot: 6 } })),
    ).toBe("pain_today");
    expect(plan(intake(), { painByRegion: { shoulder: 8 } }).offered).toBe(true);
  });

  it("leg, hip or back pain 4 or 5 today: runs, only the antalgic label can show", () => {
    expect(GAIT_ANTALGIC_PAIN).toEqual([4, 5]);
    expect(plan(intake(), { painByRegion: { hip: 4 } }).antalgicOnly).toBe(true);
    expect(plan(intake(), {}, { ...calm, pc_pain_now: 5, pc_pain_areas: { knee: 5 } }).antalgicOnly).toBe(
      true,
    );
    expect(plan(intake(), { painByRegion: { hip: 3 } }).antalgicOnly).toBe(false);
    expect(plan(intake(), { painByRegion: { elbow: 5 } }).antalgicOnly).toBe(false);
  });

  it("pc_pain_now 6 to 8 elsewhere: overground allowed, the pad not offered", () => {
    expect(GAIT_PAD_PAIN_NOW_FROM).toBe(6);
    const p = plan(intake(), {}, { ...calm, pc_pain_now: 7, pc_pain_areas: { shoulder_right: 7 } });
    expect(p).toMatchObject({ offered: true, modes: ["overground"], padAllowed: false });
  });

  it.each([
    ["pc_steadi any yes", {}, { ...calm, "pc_steadi:worry": "yes" }, intake()],
    ["pc_walking_aid yes", {}, { ...calm, pc_walking_aid: "yes" }, intake()],
    ["an aid in the intake", {}, calm, intake({ walking: { status: "with_aid", aid: "walker" } })],
    ["restriction balance_support", {}, calm, intake({ restrictions: ["balance_support"] })],
    [
      "pc_pd_dizzy_standing yes",
      { pdFreezing: false },
      { ...calm, pc_pd_dizzy_standing: "yes" },
      intake({ conditions: ["parkinsons"] }),
    ],
    [
      "pc_pd_freezing yes",
      { pdFreezing: true },
      { ...calm, pc_pd_dizzy_standing: "no" },
      intake({ conditions: ["parkinsons"] }),
    ],
  ] as [string, Partial<FocusToday>, Answers, V7Intake][])(
    "%s: a helper walks beside; the pad not offered",
    (_, t, a, h) => {
      const p = plan(h, t, a);
      expect(p).toMatchObject({
        offered: true,
        helperRequired: true,
        padAllowed: false,
        modes: ["overground"],
      });
    },
  );

  it("pc_arthritis_flare in a hip, knee, ankle or foot: overground with the warning, the pad not offered", () => {
    const flare = (area: string): Answers => ({
      ...calm,
      pc_arthritis_flare: "yes",
      "pc_arthritis_flare:areas": [area],
    });
    const arthritis = intake({ conditions: ["arthritis"] });
    expect(plan(arthritis, {}, flare("knee"))).toMatchObject({ offered: true, padAllowed: false });
    expect(plan(arthritis, {}, flare("shoulder_left"))).toMatchObject({ offered: true, padAllowed: true });
  });

  it("pc_helper at home: a required helper must be present; at the booth the staff count", () => {
    const h = intake({ walking: { status: "with_aid", aid: "cane" } });
    expect(plan(h, {}, calm, "booth").offered).toBe(true);
    expect(plan(h, { helperPresent: true }, calm, "home").offered).toBe(true);
    const absent = plan(h, { helperPresent: false }, calm, "home");
    expect(absent.offered).toBe(false);
    // «pc_helper ... no -> skip with reason helper_needed» (D-024, A4-2).
    expect(notOffered(absent)).toBe("helper_needed");
    expect(plan(h, {}, { ...calm, "pc_helper:chair_stand_30s": "yes" }, "home").offered).toBe(true);
    // Without a helper requirement nothing is asked.
    expect(plan(intake(), {}, calm, "home").offered).toBe(true);
  });

  it("knee orthosis: recorded, the plan is unchanged", () => {
    expect(plan(intake(), { orthosis: { left: "kafo" } })).toEqual(plan(intake(), {}));
  });

  it("a red flag in a hip, knee, ankle or foot or the back: not offered (rf_region)", () => {
    for (const region of ["hip", "knee", "ankle_foot", "back_trunk"] as const)
      expect(notOffered(plan(intake(), { redFlagRegions: [region] })), region).toBe("red_flag");
    expect(plan(intake(), { redFlagRegions: ["shoulder", "neck"] }).offered).toBe(true);
  });
});

describe("gait-rules modeChoice", () => {
  it("lists the data's pad conditions, each checked here or at the capture setup", () => {
    expect(GAIT_PAD_CONDITIONS.map((c) => c.text)).toEqual(
      GAIT_DATA.eligibility.modeChoice.padAllowedWhenAll,
    );
    expect(GAIT_DATA.eligibility.modeChoice.default).toBe("overground");
  });

  it("the pad needs every answer: unanswered fall questions keep it off", () => {
    expect(plan(intake(), {}, {}).padAllowed).toBe(false);
    expect(
      plan(intake(), {}, { ...calm, "pc_steadi:fell": undefined } as unknown as Answers).padAllowed,
    ).toBe(false);
  });

  it("at home only with a helper present", () => {
    expect(plan(intake(), {}, calm, "home").padAllowed).toBe(false);
    expect(plan(intake(), { helperPresent: true }, calm, "home").padAllowed).toBe(true);
  });

  it("Parkinson's: the pad only when freezing and dizziness are answered no", () => {
    const pd = intake({ conditions: ["parkinsons"] });
    expect(plan(pd, {}, calm).padAllowed).toBe(false);
    expect(plan(pd, { pdFreezing: false }, { ...calm, pc_pd_dizzy_standing: "no" }).padAllowed).toBe(true);
  });
});

describe("views and the static stance", () => {
  it("overground toward and away, plus side passes; the pad's side views start with the affected side", () => {
    const left = plan(intake({ regions: [entry("knee", "left", ["pain"])] }));
    expect(left.views.overground).toEqual(["front", "back", "side"]);
    expect(left.views.walking_pad).toEqual([
      { view: "pad_side", nearSide: "left" },
      { view: "pad_side", nearSide: "right" },
      { view: "pad_front" },
    ]);
    // Both or none: the right first.
    const both = plan(
      intake({ regions: [entry("hip", "left", ["pain"]), entry("ankle_foot", "right", ["pain"])] }),
    );
    expect(both.views.walking_pad[0]).toEqual({ view: "pad_side", nearSide: "right" });
    expect(plan(intake()).views.walking_pad[0]).toEqual({ view: "pad_side", nearSide: "right" });
  });

  it("no pad views when the pad is not offered; no views at all when gait is not offered", () => {
    const aid = plan(intake({ walking: { status: "with_aid", aid: "cane" } }));
    expect(aid.views.walking_pad).toEqual([]);
    expect(aid.views.overground).toEqual(["front", "back", "side"]);
    const no = plan(intake({ walking: { status: "no" } }));
    expect(no).toMatchObject({ offered: false, modes: [], padAllowed: false, staticStance: false });
    expect(no.views).toEqual({ overground: [], walking_pad: [] });
  });

  it("the single leg stance runs under the v1.1 standing gate", () => {
    expect(plan(intake()).staticStance).toBe(true);
    expect(plan(intake({ pain: ["knee"], regions: [entry("knee", "right", ["pain"])] })).staticStance).toBe(
      false,
    );
    expect(plan(intake({ mobility: "wheelchair" })).staticStance).toBe(false);
    expect(plan(intake({ mobility: "wheelchair" })).offered).toBe(true); // short walks (2.2 rule 2)
    const leg = intake({
      conditions: ["lower_limb_unilateral"],
      regions: [entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
    });
    // The prosthesis answered in the v1 pre-check counts for the static stance too.
    expect(plan(leg, {}, { ...calm, pc_limb_leg_prosthesis: "yes" }).staticStance).toBe(true);
  });
});

describe("parity with the clinical text of eligibility", () => {
  const gate = GAIT_DATA.eligibility.gate;
  const todayRows = GAIT_DATA.eligibility.today;
  const row = (needle: string) => {
    const r = todayRows.find((x) => x.item.includes(needle));
    if (!r) throw new Error(`no today row with «${needle}»`);
    return r;
  };

  it("the gate rows", () => {
    expect(gate.map((g) => g.item)).toEqual([
      "intake.walking",
      "pc_walk_10m (new, asked at each gait test)",
      "restriction no_weight_bearing or no_exercise",
      "lower limb loss",
      "pc_surgery_recent with back, hip, knee, ankle or foot not cleared",
      "clearance no or unsure",
    ]);
    expect(gate[1].rule).toContain("walk_needs_hands_on_help");
    expect(gate[3].rule).toContain("pc_limb_leg_prosthesis yes");
    expect(gate[5].rule).toContain("stroke or SCI: no gait test (reason clearance_needed)");
    expect(gate[5].rule).toContain("walking pad not offered");
  });

  it("the pain thresholds of the day", () => {
    expect(row(`leg, hip or back pain ${GAIT_PAIN_SKIP_AT} or more today`).action).toContain(
      "postpone the gait test",
    );
    expect(
      row(`leg, hip or back pain ${GAIT_ANTALGIC_PAIN[0]} or ${GAIT_ANTALGIC_PAIN[1]} today`).action,
    ).toContain("only the antalgic label");
    expect(row(`pc_pain_now ${GAIT_PAD_PAIN_NOW_FROM} to 8 elsewhere`).action).toContain("pad not offered");
    expect(row("pc_pain_now >= 9").action).toContain("postpone");
    // pc_pain_now 9 or more postpones through the v1 pre-check itself.
    const v1 = CHECK_DATA.precheck.find((q) => q.id === "pc_pain_now")!;
    expect(v1.actions.some((a) => a.do === "postpone" && a.if.gte === 9)).toBe(true);
  });

  it("the helper rows: each one requires a helper and keeps the pad off", () => {
    for (const needle of [
      "pc_steadi any yes",
      "pc_walking_aid yes",
      "restriction balance_support",
      "pc_pd_dizzy_standing yes",
      "pc_pd_freezing yes",
    ]) {
      const action = row(needle).action;
      expect(action, needle).toContain("helper required");
      expect(action, needle).toContain("pad not offered");
    }
    expect(row("pc_arthritis_flare in hip, knee, ankle or foot").action).toContain("pad not offered");
    expect(row("pc_helper").action).toContain("no -> skip with reason helper_needed");
    expect(row("pc_helper").action).toContain("staff count as helper at the booth");
  });
});
