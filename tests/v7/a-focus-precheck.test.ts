/**
 * The pre-check of the focus check (product v7 contract C-2 and 2.5; D-032 item 2): the day's one
 * screen (dayAreas, dayItems, missingDayItems, dayOutcome, keptDay), and the v1 bridge it goes through
 * unchanged (proxy tests, skip mapping, helper mapping), which the v1 pre-check also drives. The gait
 * day items and the day's copy are checked against the data.
 */
import { describe, expect, it } from "vitest";
import {
  GAIT_DAY_ITEMS,
  applyPrecheckOutcome,
  dayAreas,
  dayItems,
  dayOutcome,
  focusPrecheckEnv,
  gaitDayItems,
  keptDay,
  missingDayItems,
  missingGaitDayItems,
  proxyBaseTests,
  type DayInput,
} from "../../src/medical/focus-precheck";
import { buildRomProtocol, type FocusToday, type RomProtocol } from "../../src/medical/rom-protocol";
import { autoFillRegions } from "../../src/medical/body-map";
import { gaitPlanFor, type GaitPlan } from "../../src/medical/gait-eligibility";
import {
  evaluatePrecheck,
  visibleQuestions,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
} from "../../src/medical/precheck";
import type { CheckContext } from "../../src/medical/assessment";
import { GAIT_DATA } from "../../src/movements/gait";
import { ROM_DATA } from "../../src/movements/rom";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { NOW, fill } from "../precheck-fixtures";
import { entry, intake, itemOf, running, today, type V7Intake } from "./a-fixtures";

const build = (h: V7Intake, t: Partial<FocusToday> = {}, setting: "home" | "booth" = "booth") =>
  buildRomProtocol({ intake: h, setting, today: today(t) });
const gaitOf = (
  h: V7Intake,
  t: Partial<FocusToday> = {},
  setting: "home" | "booth" = "booth",
  answers: Answers = {},
) => gaitPlanFor(h, today(t), setting, answers);

const ctxFor = (h: V7Intake): CheckContext => ({
  position: h.mobility === "standing" ? "standing" : h.mobility === "wheelchair" ? "wheelchair" : "chair",
  support: h.support,
  pain: [...h.pain],
  restrictions: [...h.restrictions],
  conditions: [...h.conditions],
  clearance: h.clearance,
});
const baseEnv = (h: V7Intake, setting: "home" | "booth" = "booth"): Omit<PrecheckEnv, "baseTests"> => ({
  setting,
  ctx: ctxFor(h),
  setup: null,
  firstCheck: true,
  unresolvedChangeReported: false,
  lastCheckLasting: false,
  completedBefore: false,
});
const outcome = (over: Partial<PrecheckOutcome>): PrecheckOutcome => ({
  status: "proceed",
  skips: [],
  variants: [],
  helperRequired: [],
  warnings: [],
  setupUpdates: {},
  stored: {},
  ...over,
});
const noGait: GaitPlan | null = null;

/* ------------------------------------------- Parkinson's leg back (A10) */

describe("Parkinson's leg back: a helper beside it (rom-protocol 2.3 movementSet, review A10)", () => {
  const pd = intake({
    conditions: ["parkinsons"],
    regions: autoFillRegions([{ condition: "parkinsons", confirmed: true }]),
  });
  it("at home, pc_steadi yes or no: the v1 chair stand rule asks a helper for every Parkinson's standing test", () => {
    for (const fell of ["yes", "no"] as const) {
      const protocol = build(pd, { helperPresent: true }, "home");
      const env = focusPrecheckEnv(baseEnv(pd, "home"), protocol, noGait);
      const o = evaluatePrecheck(env, fill(env, { "pc_steadi:fell": fell, pc_helper: "yes" }), NOW);
      expect(o.status, fell).toBe("proceed");
      const r = applyPrecheckOutcome(protocol, noGait, o);
      expect(itemOf(r.protocol, "hip_extension"), fell).toMatchObject({
        position: "standing_supported",
        helperRequired: true,
      });
      expect(r.helperRequired, fell).toContain("rom_standing");
    }
  });
});

/* ------------------------------------------------------------ proxy tests */

describe("proxyBaseTests: the v1 tests whose pre-check items the focus check needs", () => {
  it("upper limb seated items: the arm raise", () => {
    expect(
      proxyBaseTests(build(intake({ regions: [entry("shoulder", "right", ["pain"])] })), noGait),
    ).toEqual(["shoulder_abduction"]);
    expect(
      proxyBaseTests(build(intake({ regions: [entry("elbow", "left", ["stiffness"])] })), noGait),
    ).toEqual(["shoulder_abduction"]);
  });

  it("the seated side bend on armrests: the side lean", () => {
    const p = build(
      intake({ mobility: "wheelchair", regions: [entry("back_trunk", "axial", ["stiffness"])] }),
    );
    expect(proxyBaseTests(p, noGait)).toEqual(["trunk_control_seated"]);
  });

  it("standing items and the gait test: the chair stand", () => {
    expect(
      proxyBaseTests(build(intake({ regions: [entry("hip", "right", ["stiffness"])] })), noGait),
    ).toEqual(["chair_stand_30s"]);
    const knee = intake({ regions: [entry("knee", "right", ["stiffness"])] });
    expect(proxyBaseTests(build(knee), noGait)).toEqual([]);
    expect(proxyBaseTests(build(knee), gaitOf(knee))).toEqual(["chair_stand_30s"]);
    expect(proxyBaseTests(build(knee), gaitOf(intake({ walking: { status: "no" } })))).toEqual([]);
  });

  it("lying items and the neck add none; skipped and deferred items add none", () => {
    expect(
      proxyBaseTests(build(intake({ regions: [entry("neck", "axial", ["stiffness"])] })), noGait),
    ).toEqual([]);
    const sore = build(intake({ regions: [entry("shoulder", "right", ["pain"])] }), {
      painByRegion: { shoulder: 7 },
    });
    expect(proxyBaseTests(sore, noGait)).toEqual([]);
    const capped = buildRomProtocol({
      intake: intake({
        regions: [entry("hip", "right", ["stiffness"]), entry("shoulder", "right", ["stiffness"])],
      }),
      setting: "booth",
      today: today(),
      maxMeasured: 2,
    });
    expect(running(capped).map((i) => i.movementId)).toEqual(["shoulder_flexion", "shoulder_abduction"]);
    expect(proxyBaseTests(capped, noGait)).toEqual(["shoulder_abduction"]);
  });

  it("all three, in the v1 test order", () => {
    const h = intake({
      mobility: "standing",
      regions: [entry("shoulder", "right", ["pain"]), entry("hip", "right", ["stiffness"])],
    });
    expect(proxyBaseTests(build(h), gaitOf(h))).toEqual(["shoulder_abduction", "chair_stand_30s"]);
    const chair = intake({
      mobility: "wheelchair",
      walking: { status: "with_aid", aid: "walker" },
      regions: [entry("shoulder", "left", ["pain"]), entry("back_trunk", "axial", ["pain"])],
    });
    expect(proxyBaseTests(build(chair), gaitOf(chair))).toEqual([
      "shoulder_abduction",
      "trunk_control_seated",
      "chair_stand_30s",
    ]);
  });

  it("focusPrecheckEnv is the base env with the proxy base tests", () => {
    const h = intake({ regions: [entry("shoulder", "right", ["pain"])] });
    const base = baseEnv(h);
    const env = focusPrecheckEnv(base, build(h), noGait);
    expect(env).toEqual({ ...base, baseTests: ["shoulder_abduction"] });
  });
});

/* ------------------------------------------------------------ skip mapping */

describe("applyPrecheckOutcome: skips", () => {
  const both = intake({
    regions: [
      entry("shoulder", "both", ["stiffness"]),
      entry("elbow", "right", ["stiffness"]),
      entry("hip", "right", ["stiffness"]),
      entry("neck", "axial", ["stiffness"]),
    ],
  });

  it("an arm raise skip skips the upper limb seated items of that side with the same reason", () => {
    const p = build(both);
    const out = applyPrecheckOutcome(
      p,
      noGait,
      outcome({ skips: [{ testId: "shoulder_abduction", side: "right", reason: "weak_shoulder" }] }),
    );
    for (const i of out.protocol.items.filter(
      (x) => x.side === "right" && ["shoulder", "elbow"].includes(x.region),
    ))
      expect(i.skipped, i.movementId).toBe("weak_shoulder");
    expect(itemOf(out.protocol, "shoulder_flexion", "left").skipped).toBeUndefined();
    expect(itemOf(out.protocol, "neck_lateral_flexion").skipped).toBeUndefined();
    expect(itemOf(out.protocol, "hip_flexion").skipped).toBeUndefined();
    // Pure: the input protocol is unchanged.
    expect(itemOf(p, "shoulder_flexion").skipped).toBeUndefined();
  });

  it("a side lean skip skips the seated side bend of that side", () => {
    const p = build(
      intake({ mobility: "wheelchair", regions: [entry("back_trunk", "axial", ["stiffness"])] }),
    );
    const out = applyPrecheckOutcome(
      p,
      noGait,
      outcome({ skips: [{ testId: "trunk_control_seated", side: "left", reason: "pusher" }] }),
    );
    expect(itemOf(out.protocol, "trunk_lateral_flexion", "left").skipped).toBe("pusher");
    expect(itemOf(out.protocol, "trunk_lateral_flexion", "right").skipped).toBeUndefined();
    expect(itemOf(out.protocol, "trunk_flexion", "none").skipped).toBeUndefined();
  });

  it("a chair stand skip skips every standing item; the lying and seated items run", () => {
    const p = build(both);
    const g = gaitOf(both);
    const out = applyPrecheckOutcome(
      p,
      g,
      outcome({ skips: [{ testId: "chair_stand_30s", side: "none", reason: "recent_surgery" }] }),
    );
    for (const i of out.protocol.items.filter((x) => x.block === "standing"))
      expect(i.skipped).toBe("recent_surgery");
    expect(itemOf(out.protocol, "hip_flexion").skipped).toBeUndefined();
    // The gait test follows its own eligibility rows (gaitPlanFor reads the same answers).
    expect(out.gait).toEqual(g);
  });

  it("no helper for the chair stand at home: the standing items and the gait test do not run", () => {
    const h = intake({
      walking: { status: "with_aid", aid: "cane" },
      regions: [entry("hip", "right", ["stiffness"])],
    });
    const p = build(h, {}, "home");
    const g = gaitOf(h, { helperPresent: true }, "home");
    const out = applyPrecheckOutcome(
      p,
      g,
      outcome({ skips: [{ testId: "chair_stand_30s", side: "none", reason: "helper_needed" }] }),
    );
    expect(itemOf(out.protocol, "hip_extension").skipped).toBe("helper_needed");
    expect(out.gait!.offered).toBe(false);
    // The gait test's own reason is the same helper_needed (D-024, A4-2).
    expect(out.gait!.reason).toBe("helper_needed");
  });

  it("the v7 limb loss rule decides the arm with limb loss, not the v1 arm raise skip", () => {
    const h = intake({
      conditions: ["upper_limb_unilateral"],
      regions: [entry("shoulder", "left", ["limb_loss"], { limbLoss: { level: "below_elbow" } })],
    });
    const out = applyPrecheckOutcome(
      build(h),
      noGait,
      outcome({ skips: [{ testId: "shoulder_abduction", side: "left", reason: "limb_loss_arm" }] }),
    );
    expect(running(out.protocol).map((i) => i.movementId)).toEqual([
      "shoulder_flexion",
      "shoulder_abduction",
      "shoulder_extension",
    ]);
  });

  it("an item the v7 rules skipped keeps its reason; deferred items stay deferred", () => {
    const p = build(
      intake({ restrictions: ["no_overhead"], regions: [entry("shoulder", "right", ["stiffness"])] }),
    );
    const out = applyPrecheckOutcome(
      p,
      noGait,
      outcome({ skips: [{ testId: "shoulder_abduction", side: "right", reason: "pain_today" }] }),
    );
    expect(itemOf(out.protocol, "shoulder_flexion").skipped).toBe("no_overhead");
    expect(itemOf(out.protocol, "shoulder_extension").skipped).toBe("pain_today");
  });
});

/* ---------------------------------------------------------- helper mapping */

describe("applyPrecheckOutcome: helpers", () => {
  it("a chair stand helper: the standing items and the gait test need someone beside; the pad is not offered", () => {
    const h = intake({
      regions: [entry("hip", "right", ["stiffness"]), entry("shoulder", "right", ["stiffness"])],
    });
    const g = gaitOf(h, {}, "booth", {
      "pc_steadi:fell": "no",
      "pc_steadi:unsteady": "no",
      "pc_steadi:worry": "no",
      pc_walking_aid: "no",
      pc_pain_now: 0,
    });
    expect(g.padAllowed).toBe(true);
    const out = applyPrecheckOutcome(build(h), g, outcome({ helperRequired: ["chair_stand_30s"] }));
    expect(itemOf(out.protocol, "hip_extension").helperRequired).toBe(true);
    expect(itemOf(out.protocol, "hip_flexion").helperRequired).toBe(false);
    expect(itemOf(out.protocol, "shoulder_flexion").helperRequired).toBe(false);
    expect(out.gait).toMatchObject({ helperRequired: true, padAllowed: false, modes: ["overground"] });
    expect(out.gait!.views.walking_pad).toEqual([]);
    expect(out.helperRequired).toEqual(["rom_standing", "gait"]);
  });

  it("a side lean helper: the seated side bend", () => {
    const p = build(
      intake({ mobility: "wheelchair", regions: [entry("back_trunk", "axial", ["stiffness"])] }),
    );
    const out = applyPrecheckOutcome(p, noGait, outcome({ helperRequired: ["trunk_control_seated"] }));
    expect(itemOf(out.protocol, "trunk_lateral_flexion").helperRequired).toBe(true);
    expect(itemOf(out.protocol, "trunk_flexion", "none").helperRequired).toBe(false);
    expect(out.helperRequired).toEqual(["rom_seated"]);
  });

  it("lists the blocks the v7 rules already need a helper for", () => {
    const h = intake({ restrictions: ["balance_support"], regions: [entry("hip", "right", ["stiffness"])] });
    const out = applyPrecheckOutcome(build(h), gaitOf(h), outcome({}));
    expect(out.helperRequired).toEqual(["rom_standing", "gait"]);
    expect(
      applyPrecheckOutcome(build(intake({ regions: [entry("knee", "left", ["pain"])] })), noGait, outcome({}))
        .helperRequired,
    ).toEqual([]);
  });
});

/* --------------------------------------------- end to end with the v1 rules */

describe("end to end: the v1 pre-check on the proxy tests", () => {
  const fahd = intake({
    age: 58,
    conditions: ["stroke"],
    support: "right",
    regions: (["shoulder", "elbow", "hip", "knee", "ankle_foot"] as const).map((r) =>
      entry(r, "right", ["weakness"]),
    ),
  });

  const start = (
    h: V7Intake,
    given: Answers,
    setting: "home" | "booth" = "booth",
    t: Partial<FocusToday> = {},
  ) => {
    const protocol = build(h, t, setting);
    const gait = gaitOf(h, t, setting, given);
    const env = focusPrecheckEnv(baseEnv(h, setting), protocol, gait);
    const answers = fill(env, given);
    return { protocol, gait, env, answers, outcome: evaluatePrecheck(env, answers, NOW) };
  };

  it("asks the arm raise, chair stand and condition items the protocol needs", () => {
    const { env, answers } = start(fahd, {});
    expect(env.baseTests).toEqual(["shoulder_abduction", "chair_stand_30s"]);
    const shown = visibleQuestions(env, answers);
    for (const id of ["pc_urgent", "pc_weak_shoulder", "pc_weak_lift", "pc_steadi:fell", "pc_walking_aid"])
      expect(shown, id).toContain(id);
  });

  it("a postpone path: unwell today postpones the focus check with the v1 screen and lock", () => {
    const { outcome: o } = start(fahd, { pc_unwell: "yes" });
    expect(o).toMatchObject({
      status: "postpone",
      reason: "unwell",
      screen: "scr_postpone_unwell",
      lock: { reason: "unwell", until: "next_day" },
    });
  });

  it("an emergency answer routes to the emergency screen", () => {
    const { outcome: o } = start(fahd, { pc_urgent: "yes" });
    expect(o.status).toBe("emergency");
    expect(o.screen).toBe("scr_emergency");
  });

  it("weak_shoulder: a painful or loose weaker shoulder is not measured", () => {
    const { protocol, gait, outcome: o } = start(fahd, { pc_weak_shoulder: "yes" });
    expect(o.status).toBe("proceed");
    const out = applyPrecheckOutcome(protocol, gait, o);
    expect(itemOf(out.protocol, "shoulder_flexion").skipped).toBe("weak_shoulder");
    expect(itemOf(out.protocol, "elbow_extension").skipped).toBe("weak_shoulder");
    expect(itemOf(out.protocol, "knee_flexion").skipped).toBeUndefined();
  });

  it("sci_t6: warn_sci_t6 before the tests", () => {
    const sci = intake({
      conditions: ["sci_incomplete"],
      mobility: "wheelchair",
      walking: { status: "no" },
      regions: [entry("shoulder", "both", ["weakness"])],
    });
    const { outcome: o } = start(sci, { pc_sci_level: "yes" });
    expect(o.status).toBe("proceed");
    expect(o.warnings).toContain("warn_sci_t6");
  });

  it("knee pain 6 in the v1 areas skips the standing items through the chair stand", () => {
    const h = intake({
      regions: [entry("hip", "right", ["stiffness"]), entry("shoulder", "right", ["stiffness"])],
    });
    const { protocol, gait, outcome: o } = start(h, { pc_pain_now: 6, pc_pain_areas: { knee: 6 } });
    expect(o.status).toBe("proceed");
    const out = applyPrecheckOutcome(protocol, gait, o);
    expect(itemOf(out.protocol, "hip_extension").skipped).toBe("pain_today");
    expect(itemOf(out.protocol, "hip_flexion").skipped).toBeUndefined();
    expect(out.gait!.offered).toBe(false);
    expect(out.gait!.reason).toBe("pain_today");
  });
});

/* ------------------------------------------------------- gait day items */

describe("GAIT_DAY_ITEMS: asked when the gait test is planned", () => {
  it("are pc_walk_10m and pc_pd_freezing, with their copy in the gait data", () => {
    expect(GAIT_DAY_ITEMS).toEqual(["pc_walk_10m", "pc_pd_freezing"]);
    for (const id of GAIT_DAY_ITEMS) {
      const line = GAIT_DATA.copy.setup[id];
      expect(line.ar.length, id).toBeGreaterThan(0);
      expect(line.en.length, id).toBeGreaterThan(0);
    }
    expect(
      GAIT_DATA.eligibility.today.some((r) => r.item.startsWith("pc_pd_freezing yes (Parkinson's only")),
    ).toBe(true);
    expect(GAIT_DATA.eligibility.gate.some((r) => r.item.startsWith("pc_walk_10m"))).toBe(true);
  });

  it("pc_walk_10m for every walker; pc_pd_freezing for Parkinson's only; none without a gait test", () => {
    const walker = intake();
    expect(gaitDayItems(gaitOf(walker), walker)).toEqual(["pc_walk_10m"]);
    const pd = intake({ conditions: ["parkinsons"] });
    expect(gaitDayItems(gaitOf(pd), pd)).toEqual(["pc_walk_10m", "pc_pd_freezing"]);
    const no = intake({ walking: { status: "no" } });
    expect(gaitDayItems(gaitOf(no), no)).toEqual([]);
    expect(gaitDayItems(null, walker)).toEqual([]);
  });

  it("missingGaitDayItems names the items still unanswered", () => {
    const pd = intake({ conditions: ["parkinsons"] });
    const g = gaitOf(pd);
    expect(missingGaitDayItems(g, pd, today())).toEqual(["pc_walk_10m", "pc_pd_freezing"]);
    expect(missingGaitDayItems(g, pd, today({ walk10m: true, pdFreezing: false }))).toEqual([]);
  });
});

/* ------------------------------------------------ the day's one screen (D-032 item 2) */

/** The preview of the context (someone there, the prosthesis on) and the answers so far. */
const PREVIEW: Partial<FocusToday> = { helperPresent: true, prosthesisOn: true };
const dayOf = (
  h: V7Intake,
  answers: Partial<FocusToday> = {},
  setting: "home" | "booth" = "home",
): DayInput => ({
  intake: h,
  setting,
  protocol: build(h, PREVIEW, setting),
  gait: gaitOf(h, PREVIEW, setting),
  today: today(answers),
});
const back = [entry("back_trunk", "axial", ["stiffness"])];
const knee = [entry("knee", "right", ["pain"])];

describe("dayAreas: the areas of today's check, which the one pain question covers", () => {
  it("each affected region with a movement to run today, and the leg and back regions when the walk is planned", () => {
    const h = intake({
      regions: [
        entry("knee", "both", ["pain"]),
        entry("forearm_wrist", "right", ["pain"]),
        entry("shoulder", "right", ["injury"], { injury: { since: "lt6w" } }),
        entry("hip", "left", ["stiffness"]),
      ],
    });
    expect(dayAreas(build(h), noGait)).toEqual(["hip", "knee"]);
    expect(dayAreas(build(h, { painByRegion: { knee: 8 } }), noGait)).toEqual(["hip"]);
    const ankle = intake({
      regions: [entry("ankle_foot", "right", ["injury"], { injury: { since: "lt6w" } })],
    });
    expect(dayAreas(build(ankle), noGait)).toEqual([]);
    expect(dayAreas(build(ankle), gaitOf(ankle))).toEqual(["ankle_foot"]);
  });
});

describe("dayItems: one short screen (D-032 item 2)", () => {
  it("a walker with knee pain: the pain, the worry question, the walk, unsteadiness, and someone with them for the pad", () => {
    expect(dayItems(dayOf(intake({ regions: knee })))).toEqual([
      "pain",
      "worry",
      "walk10m",
      "unsteady",
      "helper",
    ]);
    // At the booth the staff stand beside the person: nobody is asked about.
    expect(dayItems(dayOf(intake({ regions: knee }), {}, "booth"))).toEqual([
      "pain",
      "worry",
      "walk10m",
      "unsteady",
    ]);
  });

  it("after a yes to the worry question nothing else is asked", () => {
    expect(dayItems(dayOf(intake({ regions: knee }), { worrying: true }))).toEqual(["pain", "worry"]);
  });

  it("no walk and nothing standing: the pain and the worry question only", () => {
    const seated = intake({
      mobility: "seated",
      walking: { status: "no" },
      regions: [entry("elbow", "right", ["pain"])],
    });
    expect(dayItems(dayOf(seated))).toEqual(["pain", "worry"]);
    // A body map without pain or a measured area: the worry question alone has nothing before it.
    const none = intake({
      mobility: "seated",
      walking: { status: "no" },
      regions: [entry("forearm_wrist", "right", ["pain"])],
    });
    expect(dayItems(dayOf(none))).toEqual(["worry"]);
  });

  it("Parkinson's: freezing after the walk question; a helper rule asks for someone at home", () => {
    const pd = intake({ conditions: ["parkinsons"], regions: [entry("hip", "right", ["stiffness"])] });
    expect(dayItems(dayOf(pd))).toEqual(["pain", "worry", "walk10m", "pdFreezing", "unsteady", "helper"]);
  });

  it("a leg limb loss: the prosthesis first; without it no walk and no standing items, so nothing more", () => {
    const loss = intake({
      conditions: ["lower_limb_unilateral"],
      regions: [
        entry("knee", "left", ["stiffness"]),
        entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
      ],
    });
    const on = dayItems(dayOf(loss, { prosthesisOn: true }));
    expect(on.slice(0, 4)).toEqual(["pain", "worry", "prosthesis", "walk10m"]);
    expect(dayItems(dayOf(loss, { prosthesisOn: false }))).not.toContain("walk10m");
    expect(dayItems(dayOf(loss, { prosthesisOn: false }))).not.toContain("unsteady");
  });

  it("a walk that cannot be done today (no to the 10 metres) asks no more about the walk", () => {
    const seatedWalker = intake({ mobility: "seated", regions: [entry("elbow", "right", ["pain"])] });
    expect(dayItems(dayOf(seatedWalker, { walk10m: false }))).toEqual(["pain", "worry", "walk10m"]);
  });

  it("missingDayItems names each item without its answer; the pain has none to miss", () => {
    const d = dayOf(intake({ regions: knee }));
    expect(missingDayItems(d)).toEqual(["worry", "walk10m", "unsteady", "helper"]);
    expect(
      missingDayItems({
        ...d,
        today: today({ worrying: false, walk10m: true, unsteady: false, helperPresent: false }),
      }),
    ).toEqual([]);
    expect(missingDayItems({ ...d, today: today({ worrying: true }) })).toEqual([]);
  });

  it("the day's copy is the data's, Arabic first with complete English, and passes the wording rules", () => {
    for (const key of [
      "day_pain_ask",
      "day_pain_none",
      "day_worry_ask",
      "day_skip_title",
      "day_skip_body",
      "day_skip_urgent",
      "day_prosthesis_ask",
      "day_unsteady_ask",
      "day_helper_ask",
      "day_helper_note",
    ] as const)
      for (const lang of ["ar", "en"] as const) {
        const text = ROM_DATA.copy[key][lang];
        expect(text.trim().length, `${key} ${lang}`).toBeGreaterThan(0);
        expect(wordingProblems(text), `${key} ${lang}`).toEqual([]);
      }
    // The one worry question names the signs D-032 names.
    for (const sign of ["chest pain", "fainting", "hot swollen joint", "new weakness or numbness"])
      expect(ROM_DATA.copy.day_worry_ask.en, sign).toContain(sign);
    expect(ROM_DATA.copy.day_helper_ask.en).toBe("Is someone with you today?");
  });
});

describe("dayOutcome: the day's answers as a pre-check outcome", () => {
  it("a yes to the worry question skips the check today with a next day lock", () => {
    const o = dayOutcome({
      intake: intake({ regions: knee }),
      setting: "home",
      today: today({ worrying: true }),
    });
    expect(o).toMatchObject({ status: "postpone", lock: { until: "next_day" }, skips: [] });
  });

  it("proceeds and keeps the highest pain today and the leg prosthesis in the data map", () => {
    const o = dayOutcome({
      intake: intake({ regions: knee }),
      setting: "home",
      today: today({ worrying: false, painByRegion: { knee: 4, back_trunk: 2 } }),
    });
    expect(o).toMatchObject({ status: "proceed", skips: [], helperRequired: [] });
    expect(o.stored.painNow).toBe(4);
  });

  it("the chair stand's helper rule at home: unsteady, an aid or the conditions need someone; a line, never a skip (D-034 item 2)", () => {
    const steady = intake({ regions: knee });
    expect(
      dayOutcome({ intake: steady, setting: "home", today: today({ unsteady: false }) }).helperRequired,
    ).toEqual([]);
    const unsteady = dayOutcome({ intake: steady, setting: "home", today: today({ unsteady: true }) });
    expect(unsteady.helperRequired).toEqual(["chair_stand_30s"]);
    expect(unsteady.skips).toEqual([]);
    const helped = dayOutcome({
      intake: steady,
      setting: "home",
      today: today({ unsteady: true, helperPresent: true }),
    });
    expect(helped.skips).toEqual([]);
    expect(helped.stored["fingerprint.helperPresent"]).toEqual(["chair_stand_30s"]);
    const aid = intake({ walking: { status: "with_aid", aid: "cane" }, regions: knee });
    expect(dayOutcome({ intake: aid, setting: "home", today: today() }).helperRequired).toEqual([
      "chair_stand_30s",
    ]);
    // At the booth the staff are there: no helper rule.
    expect(dayOutcome({ intake: aid, setting: "booth", today: today({ unsteady: true }) }).skips).toEqual([]);
  });

  it("the side lean's helper rule at home: SCI, stroke, CP, Parkinson's and MS", () => {
    const stroke = intake({
      conditions: ["stroke"],
      mobility: "wheelchair",
      walking: { status: "no" },
      regions: back,
    });
    const alone = dayOutcome({ intake: stroke, setting: "home", today: today() });
    expect(alone.helperRequired).toContain("trunk_control_seated");
    // D-034 item 2: a helper is a line, not a gate: nothing is skipped for want of one.
    expect(alone.skips).toEqual([]);
    // Applied through the bridge: the seated side bend runs, with someone beside the person.
    const protocol = build(stroke, {}, "home");
    const applied = applyPrecheckOutcome(protocol, noGait, alone);
    expect(
      applied.protocol.items
        .filter((i) => i.position === "seated_armrests")
        .every((i) => !i.skipped && i.helperRequired),
    ).toBe(true);
    const helped = applyPrecheckOutcome(
      protocol,
      noGait,
      dayOutcome({ intake: stroke, setting: "home", today: today({ helperPresent: true }) }),
    );
    expect(
      helped.protocol.items
        .filter((i) => i.position === "seated_armrests")
        .every((i) => !i.skipped && i.helperRequired),
    ).toBe(true);
  });
});

describe("keptDay: the day answers a later step reads (D-026 items 7 and 9)", () => {
  it("keeps the pain per region, and someone with the person, unsteadiness and the prosthesis when asked", () => {
    const t = today({
      painByRegion: { knee: 3 },
      worrying: false,
      unsteady: true,
      helperPresent: true,
      walk10m: true,
    });
    expect(keptDay(t, ["pain", "worry", "walk10m", "unsteady", "helper"])).toEqual({
      painByRegion: { knee: 3 },
      helperPresent: true,
      steadi: { fell: true, worry: true },
    });
    expect(keptDay(today({ prosthesisOn: false }), ["worry", "prosthesis"])).toEqual({
      painByRegion: {},
      prosthesisOn: false,
    });
  });

  it("never keeps the worry answer, a red flag, the walk or freezing answers, a transfer or an orthosis (data minimisation)", () => {
    const kept = keptDay(
      today({
        worrying: false,
        redFlagRegions: ["shoulder"],
        walk10m: true,
        pdFreezing: true,
        transferChair: true,
        orthosis: { right: "afo" },
        helperPresent: true,
      }),
      ["worry", "walk10m", "pdFreezing"],
    );
    expect(kept).toEqual({ painByRegion: {} });
  });
});

// The bridge keeps the protocol's invariants: unique movement and side, sitBeforeStand recomputed.
describe("invariants", () => {
  it("keeps one entry per movement and side, and recomputes sitBeforeStand", () => {
    const h = intake({
      regions: [entry("knee", "right", ["stiffness"]), entry("hip", "right", ["stiffness"])],
    });
    const p: RomProtocol = build(h);
    const out = applyPrecheckOutcome(
      p,
      noGait,
      outcome({ skips: [{ testId: "chair_stand_30s", side: "none", reason: "flare" }] }),
    );
    const keysOf = [...out.protocol.items, ...out.protocol.deferred, ...out.protocol.notMeasured].map(
      (i) => `${i.movementId}:${i.side}`,
    );
    expect(new Set(keysOf).size).toBe(keysOf.length);
    expect(out.protocol.sitBeforeStand).toBe(true);
  });
});
