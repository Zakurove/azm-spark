/**
 * The pre-check bridge of the focus check (product v7 contract C-2 and 2.5, 8.1 A "the pre-check
 * bridge (proxy tests, skip mapping, helper mapping, a postpone path end to end)" and "rf_region"):
 * the v1 pre-check runs unchanged on proxy base tests chosen from the day's protocol and gait plan, and
 * its skips and helper requirements come back onto the v7 items. The gait day items and the region red
 * flag item are checked against the data.
 */
import { describe, expect, it } from "vitest";
import {
  GAIT_DAY_ITEMS,
  RF_REGION_ITEM,
  RF_REGION_LEG,
  applyPrecheckOutcome,
  focusPrecheckEnv,
  gaitDayItems,
  missingGaitDayItems,
  proxyBaseTests,
  redFlagWarnings,
  rfRegionsToAsk,
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
import { V7_DICTIONARIES, tV7 } from "../../src/i18n/v7";
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
      GAIT_DATA.eligibility.today.some((r) =>
        r.item.startsWith("pc_pd_freezing yes (new, Parkinson's only)"),
      ),
    ).toBe(true);
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

/* ---------------------------------------------------- region red flags today */

describe("rf_region (contract 2.5)", () => {
  /** The rf_region lines of the rom namespace (D-024, A4-7), as the dictionaries hold them. */
  const line = (lang: "ar" | "en", key: "rf_region_ask" | "rf_region_ask_leg") =>
    (V7_DICTIONARIES[lang].rom as Record<string, string>)[key];

  it("is the item id rf_region, with Arabic and English copy in the rom namespace that passes the wording rules", () => {
    expect(RF_REGION_ITEM).toBe("rf_region");
    for (const key of ["rf_region_ask", "rf_region_ask_leg"] as const) {
      for (const lang of ["ar", "en"] as const) {
        expect(line(lang, key).trim().length, `${key} ${lang}`).toBeGreaterThan(0);
        expect(wordingProblems(line(lang, key)), `${key} ${lang}`).toEqual([]);
        expect(line(lang, key), `${key} ${lang}`).toContain("{region}");
      }
    }
    expect(tV7("en", "rom.rf_region_ask", { region: "knee" })).toMatch(/^Today, in your knee: /);
    // The leg version adds the weight bearing sign; the answers are the data's yes and no.
    expect(line("en", "rf_region_ask_leg")).toContain("stand on");
    expect(line("en", "rf_region_ask")).not.toContain("stand on");
    expect(RF_REGION_LEG).toEqual(["hip", "knee", "ankle_foot"]);
    expect(ROM_DATA.copy.ans_yes.ar).toBe("نعم");
    expect(ROM_DATA.copy.ans_no.ar).toBe("لا");
  });

  it("covers every sign of the red_flags rule", () => {
    const rule = ROM_DATA.safety.find((s) => s.id === "red_flags")!.rule;
    for (const sign of [
      "hot",
      "red",
      "swollen",
      "fever",
      "new deformity",
      "cannot take weight on the leg",
      "new numbness or weakness",
    ])
      expect(rule, sign).toContain(sign);
    const en = line("en", "rf_region_ask_leg").toLowerCase();
    for (const word of ["hot", "red", "swollen", "fever", "shape", "stand on", "numbness", "weakness"])
      expect(en, word).toContain(word);
  });

  it("asks once for each affected region with a movement to run today, and the leg and back regions when the gait test is planned", () => {
    const h = intake({
      regions: [
        entry("knee", "both", ["pain"]),
        entry("forearm_wrist", "right", ["pain"]),
        entry("shoulder", "right", ["injury"], { injury: { since: "lt6w" } }),
        entry("hip", "left", ["stiffness"]),
      ],
    });
    expect(rfRegionsToAsk(build(h), noGait)).toEqual(["hip", "knee"]);
    expect(rfRegionsToAsk(build(h, { painByRegion: { knee: 8 } }), noGait)).toEqual(["hip"]);
    const ankle = intake({
      regions: [entry("ankle_foot", "right", ["injury"], { injury: { since: "lt6w" } })],
    });
    expect(rfRegionsToAsk(build(ankle), noGait)).toEqual([]);
    expect(rfRegionsToAsk(build(ankle), gaitOf(ankle))).toEqual(["ankle_foot"]);
  });

  it("a yes skips the region (red_flag), removes the gait test for a leg or the back, and names the seek care screen", () => {
    const h = intake({ regions: [entry("knee", "right", ["pain"]), entry("elbow", "right", ["pain"])] });
    const t = { redFlagRegions: ["knee" as const] };
    const p = build(h, t);
    expect(itemOf(p, "knee_flexion").skipped).toBe("red_flag");
    expect(itemOf(p, "elbow_extension").skipped).toBeUndefined();
    expect(gaitOf(h, t).reason).toBe("red_flag");
    expect(redFlagWarnings(today(t))).toEqual(["scr_stop_seek_care"]);
    expect(redFlagWarnings(today())).toEqual([]);
    // Every measurable item skipped: the start answers NOTHING_TO_MEASURE after the seek care screen.
    const all = build(intake({ regions: [entry("knee", "right", ["pain"])] }), t);
    expect(all.items.every((i) => i.skipped === "red_flag")).toBe(true);
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
