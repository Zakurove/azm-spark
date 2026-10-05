/**
 * evaluateGait (product v7 contract 2.9 and 8.1 C, stream C, step C3; gait-rules 5): each pattern's
 * thresholds equal the data, the firing rule (the side's median and 60% of its clean cycles), the
 * views and gates, each confidence cap and downgrade, the pain day rule, the one sided rule, the
 * speed rules, contributor ordering from the history and the range profile, the targets and
 * referrals, the support findings, and the person's lines (Arabic first, complete English, the
 * wording rules).
 */
import { describe, expect, it } from "vitest";
import {
  COPY_TARGET_IDS,
  HANDLED_TARGET_WHENS,
  evaluateGait,
  gaitPatternLines,
  gaitPatternShown,
  withGaitLines,
} from "../../src/medical/gait-rules";
import { GAIT_DATA, GAIT_RULES_VERSION, gaitFinding, gaitPattern } from "../../src/movements/gait";
import {
  GAIT_CONTRIBUTOR_IDS,
  GAIT_COPY_TARGET_KEYS,
  GAIT_PATTERN_IDS,
  GAIT_REFERRAL_IDS,
  type GaitPatternDef,
} from "../../src/movements/gait/types";
import { TARGETS_DATA } from "../../src/movements/targets";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import {
  KNEES_BOTH,
  PAD_SETUP,
  SETUP,
  fired,
  input,
  on,
  of,
  romEntry,
  view,
  walk,
  type InputSpec,
} from "./c-gait-rules-fixtures";

const run = (s: InputSpec = {}) => evaluateGait(input(s));
const patterns = (s: InputSpec = {}) => run(s).patterns;

const num = (set: unknown, key: string): number => {
  const v = (set as Record<string, unknown>)[key];
  if (typeof v !== "number") throw new Error(`no ${key}`);
  return v;
};
const possible = (id: GaitPatternDef["id"]) => gaitPattern(id).thresholds.possible;
const likely = (id: GaitPatternDef["id"]) => gaitPattern(id).thresholds.likely!;
const FIRING = GAIT_DATA.confidenceModel.firingSharePct / 100;

describe("a typical walk", () => {
  it("gives every pattern once, not seen, with no finding", () => {
    const out = run();
    expect(out.rulesVersion).toBe(GAIT_RULES_VERSION);
    expect(out.findings).toEqual([]);
    expect(out.patterns.map((p) => p.pattern)).toEqual([...GAIT_PATTERN_IDS]);
    for (const p of out.patterns) {
      expect(p).toMatchObject({ status: "not_seen", side: "none", confidence: null, label: p.pattern });
      expect(p.evidence).toEqual([]);
      expect(p.contributors).toEqual([]);
      expect(p.targets).toEqual([]);
      expect(gaitPatternShown(p)).toBe(false);
    }
  });

  it("is the same on the walking pad", () => {
    const out = run({ mode: "walking_pad" });
    expect(fired(out.patterns)).toEqual([]);
    expect(out.findings).toEqual([]);
  });
});

describe("views and gates", () => {
  it("does not assess a pattern without a view of its own", () => {
    const out = patterns({ views: [] });
    for (const p of out) expect(p).toMatchObject({ status: "not_assessed", notAssessed: "wrong_view" });
    // Only the front and back: the side view patterns are not assessed.
    const front = patterns({ views: [view({ view: "front" }), view({ view: "back" })] });
    expect(on(front, "stiff_knee", "none")).toMatchObject({
      status: "not_assessed",
      notAssessed: "wrong_view",
    });
    expect(on(front, "trendelenburg", "none")).toMatchObject({ status: "not_seen" });
  });

  it("does not assess the patterns of a view group short of 6 clean cycles a side", () => {
    const out = patterns({
      views: [
        view({ view: "side" }),
        view({ view: "front", cycles: { left: 2, right: 3 } }),
        view({ view: "back", cycles: { left: 3, right: 2 } }),
      ],
    });
    for (const id of ["trendelenburg", "duchenne_lean", "waddling"] as const)
      expect(on(out, id, "none")).toMatchObject({ status: "not_assessed", notAssessed: "gate_failed" });
    expect(on(out, "stiff_knee", "none")?.status).toBe("not_seen");
  });

  it("passes a view group on the clean cycles of its views together (per side and per view group)", () => {
    // Toward passes give the right side's steady cycles and away passes the left's: neither view alone
    // has 6 a side, the group has 10.
    const dip = { pelvic_drop: { left: 3, right: 14, shareLeft: 0, shareRight: 1 } };
    const out = patterns({
      views: [
        view({ view: "side" }),
        view({ view: "front", metrics: dip, cycles: { left: 0, right: 10 } }),
        view({ view: "back", metrics: dip, cycles: { left: 10, right: 0 } }),
      ],
    });
    expect(fired(out)).toEqual(["trendelenburg:right:possible"]);
  });

  it("leaves out a view under 20 fps", () => {
    const dip = { pelvic_drop: { left: 3, right: 14, shareLeft: 0, shareRight: 1 } };
    const out = patterns({
      views: [view({ view: "side" }), view({ view: "front", metrics: dip, fps: 18 }), view({ view: "back" })],
    });
    expect(fired(out)).toEqual([]);
  });

  it("reads a limb's kinematics on the pad only with its own clean cycles where it was nearest", () => {
    const stiff = { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } };
    const out = patterns({
      mode: "walking_pad",
      setup: PAD_SETUP,
      views: [
        view({ view: "pad_side", nearSide: "right", metrics: stiff, cycles: { left: 9, right: 5 } }),
        view({ view: "pad_side", nearSide: "left", metrics: stiff, cycles: { left: 9, right: 9 } }),
        view({ view: "pad_front" }),
      ],
    });
    expect(fired(out)).toEqual([]);
    expect(on(out, "stiff_knee", "none")?.status).toBe("not_seen");
  });

  it("treats a view showing the other body view as the wrong view", () => {
    const out = patterns({
      views: [view({ view: "side" }), view({ view: "front", issues: ["wrong_view"] })],
    });
    expect(on(out, "duchenne_lean", "none")).toMatchObject({
      status: "not_assessed",
      notAssessed: "wrong_view",
    });
  });
});

describe("the firing rule (confidenceModel.firing)", () => {
  it("needs the side's median beyond the threshold and the sign in 60% of its clean cycles", () => {
    const at = num(possible("crouch"), "knee_stance_min_gte");
    const crouch = (right: number, share: number) =>
      fired(patterns({ side: { knee_stance_min: { left: 5, right, shareLeft: 0, shareRight: share } } }));
    expect(crouch(at, FIRING)).toEqual(["crouch:right:possible"]);
    expect(crouch(at, FIRING - 0.01)).toEqual([]);
    expect(crouch(at - 0.1, 1)).toEqual([]);
  });
});

describe("5.1 shorter stance", () => {
  const ratio = (r: number) => ({ sr_single_support: { value: r, left: r, right: 1 / r } });

  it("fires on the short single support side at the data thresholds", () => {
    const p = num(possible("shorter_stance"), "sr_single_support_gte");
    const l = num(likely("shorter_stance"), "sr_single_support_gte");
    expect(fired(patterns({ side: ratio(p) }))).toEqual(["shorter_stance:right:possible"]);
    expect(fired(patterns({ side: ratio(l) }))).toEqual(["shorter_stance:right:likely"]);
    expect(fired(patterns({ side: ratio(p - 0.005) }))).toEqual([]);
    const r = on(patterns({ side: ratio(l) }), "shorter_stance", "right")!;
    expect(r.evidence).toEqual([
      { metric: "sr_single_support", side: "right", value: l, threshold: l, share: null },
    ]);
    // Cap moderate (grade B): likely moderate; possible one level lower.
    expect(r.confidence).toBe("moderate");
    expect(on(patterns({ side: ratio(p) }), "shorter_stance", "right")!.confidence).toBe("low");
  });

  it("labels the side short stance without pain, with weakness as the possible reason", () => {
    const r = on(patterns({ side: ratio(1.2) }), "shorter_stance", "right")!;
    expect(r).toMatchObject({ label: "short_stance", contributors: ["weak_stance_leg"], referrals: [] });
    expect(r.targets).toEqual([
      { id: "balance:single_leg_stance", side: "right" },
      { id: "strengthen:hip_abductors", side: "right" },
      { id: "strengthen:hip_extensors", side: "right" },
      { id: "strengthen:quadriceps", side: "right" },
      { id: "practice:walking", side: "right" },
    ]);
  });

  it("labels it antalgic with pain on that side today, with gentle range of the painful joint", () => {
    const r = on(
      patterns({
        side: ratio(1.2),
        intake: { regions: [{ region: "knee", side: "right", problems: ["pain"], origin: "person" }] },
        pain: { knee: 3 },
      }),
      "shorter_stance",
      "right",
    )!;
    expect(r).toMatchObject({ label: "antalgic", contributors: ["pain_side"] });
    expect(r.targets).toEqual([
      { id: "mobility:knee_flexion", side: "right" },
      { id: "mobility:knee_extension", side: "right" },
      { id: "practice:gradual_loading", side: "right" },
    ]);
  });

  it("labels it antalgic for pain marked during the walk on that side", () => {
    const r = on(
      patterns({ side: ratio(1.2), walkPain: [{ side: "right", level: 3 }] }),
      "shorter_stance",
      "right",
    )!;
    expect(r.label).toBe("antalgic");
  });

  it("labels a prosthetic side, with the prosthesis reasons and the prosthetist", () => {
    const r = on(
      patterns({
        side: ratio(1.2),
        intake: {
          conditions: ["lower_limb_unilateral"],
          regions: [
            {
              region: "hip",
              side: "right",
              problems: ["limb_loss"],
              origin: "condition",
              limbLoss: { level: "below_knee" },
            },
            {
              region: "knee",
              side: "right",
              problems: ["limb_loss"],
              origin: "condition",
              limbLoss: { level: "below_knee" },
            },
          ],
        },
      }),
      "shorter_stance",
      "right",
    )!;
    expect(r).toMatchObject({
      label: "prosthetic_side",
      contributors: ["prosthesis_fit", "prosthesis_comfort"],
      referrals: ["refer_prosthetist"],
      targets: [{ id: "practice:gradual_loading", side: "right" }],
    });
  });

  it("caps it at possible with a handrail held, touched, or one pad side view", () => {
    const pad = (flags: ("handrail_firm" | "handrail_light" | "far_limb")[]) =>
      on(
        patterns({ mode: "walking_pad", side: ratio(1.2), flags, setup: PAD_SETUP }),
        "shorter_stance",
        "right",
      );
    expect(pad([])).toMatchObject({ status: "likely", confidence: "moderate" });
    // Light touch: possible (low).
    expect(pad(["handrail_light"])).toMatchObject({ status: "possible", confidence: "low" });
    // A firm hold: possible and one level lower for a timing and symmetry rule: below low, not shown.
    expect(pad(["handrail_firm"])).toMatchObject({ status: "possible", confidence: null });
    // One pad side view: possible and one level lower for a between limb rule.
    expect(pad(["far_limb"])).toMatchObject({ status: "possible", confidence: null });
  });
});

describe("5.2 hip dip (Trendelenburg)", () => {
  const dip = (right: number, left = 4, share = 1) => ({
    pelvic_drop: { left, right, shareLeft: left >= 10 ? 1 : 0, shareRight: share },
  });
  const lean = {
    trunk_sway_range: { value: 12, left: 6, right: 12, shareLeft: 0, shareRight: 1 },
    trunk_lean_peak: { left: 1, right: 6, shareLeft: 0.2, shareRight: 1 },
  };

  it("is possible at the data threshold when the other side stays under it", () => {
    const at = num(possible("trendelenburg"), "pelvic_drop_gte");
    expect(num(possible("trendelenburg"), "otherSide_lt")).toBe(at);
    expect(fired(patterns({ front: dip(at) }))).toEqual(["trendelenburg:right:possible"]);
    expect(fired(patterns({ front: dip(at - 0.1) }))).toEqual([]);
    // Without the static check: possible, low (gait-rules 5.2).
    expect(on(patterns({ front: dip(14) }), "trendelenburg", "right")).toMatchObject({
      status: "possible",
      confidence: "low",
      contributors: ["weak_hip_abductors"],
      targets: [
        { id: "strengthen:hip_abductors", side: "right" },
        { id: "balance:single_leg_stance", side: "right" },
      ],
    });
  });

  it("is likely with the static single leg stance drop and the trunk lean on that side, still low", () => {
    const stance = [{ side: "right" as const, pelvicDropDeg: 12, ok: true }];
    const r = on(
      patterns({ front: { ...dip(14), ...lean }, staticStance: stance }),
      "trendelenburg",
      "right",
    )!;
    expect(r).toMatchObject({ status: "likely", confidence: "low" });
    expect(r.evidence.map((e) => e.metric)).toEqual([
      "pelvic_drop",
      "pelvic_drop",
      "static_pelvic_drop",
      "trunk_sway_range",
      "trunk_lean_peak",
    ]);
    // Without the lean, or with a static check that failed: possible.
    expect(on(patterns({ front: dip(14), staticStance: stance }), "trendelenburg", "right")?.status).toBe(
      "possible",
    );
    expect(
      on(
        patterns({
          front: { ...dip(14), ...lean },
          staticStance: [{ side: "right", pelvicDropDeg: null, ok: false }],
        }),
        "trendelenburg",
        "right",
      )?.status,
    ).toBe("possible");
  });

  it("is not a one sided dip when both sides drop (waddling)", () => {
    expect(of(patterns({ front: dip(12, 12) }), "trendelenburg").map((p) => p.status)).toEqual(["not_seen"]);
  });

  it("is not assessed with a firm hold on the pad and capped at possible with a light touch", () => {
    const pad = (flag: "handrail_firm" | "handrail_light") =>
      patterns({ mode: "walking_pad", front: dip(14), flags: [flag], setup: PAD_SETUP });
    expect(on(pad("handrail_firm"), "trendelenburg", "none")).toMatchObject({
      status: "not_assessed",
      notAssessed: "handrail_held",
    });
    expect(on(pad("handrail_light"), "trendelenburg", "right")?.status).toBe("possible");
  });

  it("names hip pain and the prosthesis on that side as possible reasons, history first", () => {
    const r = on(
      patterns({
        front: dip(14),
        intake: {
          regions: [KNEES_BOTH, { region: "hip", side: "right", problems: ["pain"], origin: "person" }],
        },
      }),
      "trendelenburg",
      "right",
    )!;
    expect(r.contributors).toEqual(["hip_pain", "weak_hip_abductors"]);
    // Hip pain on the other side is not a reason for this side.
    const left = on(
      patterns({
        front: dip(14),
        intake: {
          regions: [KNEES_BOTH, { region: "hip", side: "left", problems: ["pain"], origin: "person" }],
        },
      }),
      "trendelenburg",
      "right",
    )!;
    expect(left.contributors).toEqual(["weak_hip_abductors"]);
  });
});

describe("5.3 trunk lean (Duchenne)", () => {
  const leanRight = (sway: number) => ({
    trunk_sway_range: { value: sway, left: 6, right: sway, shareLeft: 0, shareRight: 1 },
    trunk_lean_peak: { left: 1, right: 6, shareLeft: 0.2, shareRight: 0.8 },
  });

  it("fires on the stance side of the peak lean at the data thresholds", () => {
    const p = num(possible("duchenne_lean"), "trunk_sway_range_gte");
    const l = num(likely("duchenne_lean"), "trunk_sway_range_gte");
    expect(fired(patterns({ front: leanRight(p) }))).toEqual(["duchenne_lean:right:possible"]);
    expect(fired(patterns({ front: leanRight(l) }))).toEqual(["duchenne_lean:right:likely"]);
    expect(fired(patterns({ front: leanRight(p - 0.1) }))).toEqual([]);
    expect(on(patterns({ front: leanRight(l) }), "duchenne_lean", "right")?.confidence).toBe("moderate");
    // The lean toward the side in under 60% of cycles is no lean toward it.
    const weak = { ...leanRight(l), trunk_lean_peak: { left: 1, right: 6, shareLeft: 0.2, shareRight: 0.5 } };
    expect(fired(patterns({ front: weak }))).toEqual([]);
  });

  it("is not assessed with a walker and capped at possible with a cane", () => {
    const walker = patterns({
      front: leanRight(16),
      intake: { walking: { status: "with_aid", aid: "walker" } },
    });
    expect(on(walker, "duchenne_lean", "none")).toMatchObject({
      status: "not_assessed",
      notAssessed: "aid_or_orthosis",
    });
    const cane = patterns({ front: leanRight(16), intake: { walking: { status: "with_aid", aid: "cane" } } });
    expect(on(cane, "duchenne_lean", "right")).toMatchObject({ status: "possible", confidence: "low" });
  });

  it("adds gentle hip range for hip pain on that side", () => {
    const r = on(
      patterns({
        front: leanRight(16),
        intake: {
          regions: [KNEES_BOTH, { region: "hip", side: "right", problems: ["pain"], origin: "person" }],
        },
      }),
      "duchenne_lean",
      "right",
    )!;
    expect(r.contributors).toEqual(["hip_pain", "weak_hip_abductors"]);
    expect(r.targets.map((t) => t.id)).toEqual([
      "strengthen:hip_abductors",
      "balance:single_leg_stance",
      "mobility:hip_flexion",
      "mobility:hip_extension",
      "mobility:hip_abduction",
    ]);
  });
});

describe("5.4 side to side sway (waddling)", () => {
  const sway = (leftShare: number, rightShare: number) => ({
    pelvic_drop: { left: 12, right: 12, shareLeft: 1, shareRight: 1 },
    trunk_sway_range: { value: 13, left: 13, right: 13, shareLeft: 1, shareRight: 1 },
    trunk_lean_peak: { left: 5, right: 5, shareLeft: leftShare, shareRight: rightShare },
  });

  it("is possible only, both sides, low, and the lean of each side is part of it", () => {
    const out = patterns({ front: sway(1, 1) });
    expect(fired(out)).toEqual([
      "duchenne_lean:right:possible",
      "duchenne_lean:left:possible",
      "waddling:both:possible",
    ]);
    expect(on(out, "waddling", "both")).toMatchObject({
      label: "waddling",
      confidence: "low",
      contributors: ["hip_girdle_weakness"],
      referrals: ["refer_care_team"],
      targets: [
        { id: "strengthen:hip_abductors", side: "both" },
        { id: "strengthen:hip_extensors", side: "both" },
      ],
    });
    // The lean on both sides is the sway waddling describes: those results are not shown.
    for (const side of ["right", "left"] as const)
      expect(on(out, "duchenne_lean", side)?.confidence).toBeNull();
  });

  it("needs the sway without a one sided peak", () => {
    const out = patterns({ front: sway(0.2, 0.9) });
    expect(fired(out)).toEqual(["duchenne_lean:right:possible"]);
  });

  it("needs pain in both hips to name hip pain", () => {
    const hip = (side: "both" | "right") =>
      on(
        patterns({
          front: sway(1, 1),
          intake: { regions: [KNEES_BOTH, { region: "hip", side, problems: ["pain"], origin: "person" }] },
        }),
        "waddling",
        "both",
      )!.contributors;
    expect(hip("both")).toEqual(["hip_pain", "hip_girdle_weakness"]);
    expect(hip("right")).toEqual(["hip_girdle_weakness"]);
  });
});

describe("5.5 stiff knee", () => {
  const knee = (right: number, left = 60, shareRight = 1) => ({
    knee_swing_peak: { left, right, shareLeft: left < 45 ? 1 : 0, shareRight },
  });
  const speed = (v: number) => ({ speed_mps: { value: v } });

  it("fires on a low peak or a between limb difference at the data thresholds", () => {
    const anyOf = possible("stiff_knee").any as Record<string, number>[];
    const allOf = likely("stiff_knee").all as Record<string, number>[];
    const peak = anyOf.find((x) => "knee_swing_peak_lt" in x)!.knee_swing_peak_lt;
    const diff = anyOf.find((x) => "between_limb_diff_gte" in x)!.between_limb_diff_gte;
    const likelyPeak = allOf.find((x) => "knee_swing_peak_lt" in x)!.knee_swing_peak_lt;
    const likelyDiff = allOf.find((x) => "between_limb_diff_gte" in x)!.between_limb_diff_gte;
    // The peak alone (a 6 degree difference).
    expect(fired(patterns({ side: knee(peak - 0.1, peak + 6) }))).toEqual(["stiff_knee:right:possible"]);
    expect(fired(patterns({ side: knee(peak, peak + 6) }))).toEqual([]);
    // The difference alone (the peak above the cut).
    expect(fired(patterns({ side: knee(50, 50 + diff, 0) }))).toEqual(["stiff_knee:right:possible"]);
    expect(fired(patterns({ side: knee(50, 50 + diff - 0.1, 0) }))).toEqual([]);
    // Likely: both.
    expect(fired(patterns({ side: knee(likelyPeak - 0.1, likelyPeak - 0.1 + likelyDiff) }))).toEqual([
      "stiff_knee:right:likely",
    ]);
    expect(fired(patterns({ side: knee(likelyPeak - 0.1, likelyPeak - 0.1 + likelyDiff - 0.2) }))).toEqual([
      "stiff_knee:right:possible",
    ]);
    const r = on(patterns({ side: knee(35) }), "stiff_knee", "right")!;
    expect(r).toMatchObject({ confidence: "high", label: "stiff_knee" });
    expect(r.evidence).toEqual([
      { metric: "knee_swing_peak", side: "right", value: 35, threshold: likelyPeak, share: 1 },
      {
        metric: "knee_swing_peak_between_limb_diff",
        side: "right",
        value: 25,
        threshold: likelyDiff,
        share: null,
      },
    ]);
  });

  it("is bilateral and likely with both knees under 40 only at 0.6 m/s or more", () => {
    const both = { ...knee(38, 37), ...speed(1) };
    const out = patterns({ side: both });
    expect(fired(out)).toEqual(["stiff_knee:both:likely"]);
    expect(on(out, "stiff_knee", "both")).toMatchObject({ label: "stiff_knee_both", confidence: "high" });
    const slow = patterns({ side: { ...knee(38, 37), ...speed(0.55) } });
    expect(on(slow, "stiff_knee", "both")).toMatchObject({
      status: "not_assessed",
      notAssessed: "slow_speed",
    });
  });

  it("caps one side at possible below 0.5 m/s, where it needs the difference", () => {
    expect(fired(patterns({ side: { ...knee(35), ...speed(0.45) } }))).toEqual(["stiff_knee:right:possible"]);
    // The peak alone does not count below 0.5 m/s.
    expect(on(patterns({ side: { ...knee(44, 50), ...speed(0.45) } }), "stiff_knee", "right")).toMatchObject({
      status: "not_assessed",
      notAssessed: "slow_speed",
    });
  });

  it("counts the peak alone in a one sided condition only at 0.8 m/s or more", () => {
    const oneSided = {
      regions: [
        {
          region: "knee" as const,
          side: "right" as const,
          problems: ["weakness" as const],
          origin: "person" as const,
        },
      ],
    };
    const at = GAIT_DATA.confidenceModel.unilateralAbsoluteFrom_mps;
    expect(
      on(
        patterns({ side: { ...knee(44, 50), ...speed(at - 0.1) }, intake: oneSided }),
        "stiff_knee",
        "right",
      ),
    ).toMatchObject({ status: "not_assessed", notAssessed: "slow_speed" });
    expect(fired(patterns({ side: { ...knee(44, 50), ...speed(at) }, intake: oneSided }))).toEqual([
      "stiff_knee:right:possible",
    ]);
    // With the difference it fires at any speed from 0.5.
    expect(fired(patterns({ side: { ...knee(44, 62), ...speed(0.6) }, intake: oneSided }))).toEqual([
      "stiff_knee:right:possible",
    ]);
  });

  it("is not assessed on a prosthetic side or with a knee orthosis on that side", () => {
    const prosthetic = patterns({
      side: knee(35),
      intake: {
        regions: [
          {
            region: "hip",
            side: "right",
            problems: ["limb_loss"],
            origin: "condition",
            limbLoss: { level: "above_knee" },
          },
        ],
      },
    });
    expect(on(prosthetic, "stiff_knee", "right")).toMatchObject({
      status: "not_assessed",
      notAssessed: "prosthetic_side",
    });
    const braced = patterns({ side: knee(35), setup: { ...SETUP, orthosis: { right: "kafo" } } });
    expect(on(braced, "stiff_knee", "right")).toMatchObject({
      status: "not_assessed",
      notAssessed: "knee_orthosis_on_S",
    });
    expect(fired(patterns({ side: knee(35), setup: { ...SETUP, orthosis: { right: "afo" } } }))).toEqual([
      "stiff_knee:right:likely",
    ]);
  });

  it("orders the possible reasons by the history and the range profile", () => {
    const r = (s: InputSpec) => on(patterns({ side: knee(35), ...s }), "stiff_knee", "right")!.contributors;
    // Unknown knee bend: after the reasons without a condition.
    expect(r({})).toEqual(["weak_push_off", "weak_hip_flexors", "knee_bend_limited"]);
    // An upper motor neuron condition: thigh muscle stiffness first.
    expect(r({ intake: { conditions: ["stroke"] } })).toEqual([
      "quad_stiffness",
      "weak_push_off",
      "weak_hip_flexors",
      "knee_bend_limited",
    ]);
    // Knee bend limited in the range profile: first; within normal: not a reason.
    expect(r({ rom: [romEntry("knee_flexion", "right", 100, "mild")] })).toEqual([
      "knee_bend_limited",
      "weak_push_off",
      "weak_hip_flexors",
    ]);
    expect(r({ rom: [romEntry("knee_flexion", "right", 140, "within")] })).toEqual([
      "weak_push_off",
      "weak_hip_flexors",
    ]);
    // Clearing the foot by swinging the leg out or lifting the hip: the front view's support signs.
    expect(r({ front: { hip_hike: { value: 0.5, left: 0.1, right: 0.9 } } })).toEqual([
      "clearance_compensation",
      "weak_push_off",
      "weak_hip_flexors",
      "knee_bend_limited",
    ]);
  });

  it("adds knee bend range when the profile limits it and the thigh stretch only with spasticity", () => {
    const ids = (s: InputSpec) =>
      on(patterns({ side: knee(35), ...s }), "stiff_knee", "right")!.targets.map((t) => t.id);
    expect(ids({})).toEqual([
      "strengthen:calf",
      "practice:push_off",
      "strengthen:hip_flexors",
      "practice:walking",
    ]);
    expect(
      ids({ rom: [romEntry("knee_flexion", "right", 100, "marked")], intake: { conditions: ["ms"] } }),
    ).toEqual([
      "strengthen:calf",
      "practice:push_off",
      "strengthen:hip_flexors",
      "mobility:knee_flexion",
      "practice:walking",
      "stretch:quadriceps",
    ]);
  });
});

describe("5.6 high step with forefoot landing (steppage)", () => {
  const foot = (pitch = -2, thighRight = 40, speed = 1.2) => ({
    foot_pitch_ic: { left: 20, right: pitch, shareLeft: 0, shareRight: 1 },
    thigh_swing_peak: { left: 30, right: thighRight },
    speed_mps: { value: speed },
  });

  it("needs both the flat or forefoot contact and the higher thigh swing", () => {
    const pitch = num(possible("steppage"), "foot_pitch_ic_lte");
    const diff = num(possible("steppage"), "thigh_swing_peak_diff_gte");
    expect(fired(patterns({ side: foot(pitch, 30 + diff) }))).toEqual(["steppage:right:likely"]);
    expect(fired(patterns({ side: foot(pitch + 0.1, 30 + diff) }))).toEqual([]);
    expect(fired(patterns({ side: foot(pitch, 30 + diff - 0.1) }))).toEqual([]);
    // Likely needs 0.6 m/s or more.
    const fast = num(likely("steppage"), "speed_mps_gte");
    expect(fired(patterns({ side: foot(-2, 40, fast - 0.01) }))).toEqual(["steppage:right:possible"]);
    expect(on(patterns({ side: foot() }), "steppage", "right")).toMatchObject({
      label: "steppage",
      confidence: "low",
      referrals: ["refer_afo", "refer_new_or_worse"],
    });
  });

  it("is a support finding, not a pattern, when the thigh swing is not higher", () => {
    const out = run({ side: foot(-2, 31) });
    expect(fired(out.patterns)).toEqual([]);
    expect(out.findings).toEqual([{ id: "flat_or_forefoot_contact", side: "right", value: -2 }]);
  });

  it("is not assessed with Parkinson's, an ankle foot orthosis, a prosthesis or crouch on that side", () => {
    expect(
      on(patterns({ side: foot(), intake: { conditions: ["parkinsons"] } }), "steppage", "none"),
    ).toMatchObject({
      status: "not_assessed",
      notAssessed: "parkinsons_flat_contact",
    });
    for (const o of ["afo", "kafo"] as const)
      expect(
        on(patterns({ side: foot(), setup: { ...SETUP, orthosis: { right: o } } }), "steppage", "right"),
      ).toMatchObject({ status: "not_assessed", notAssessed: "aid_or_orthosis" });
    const crouch = { ...foot(), knee_stance_min: { left: 5, right: 18, shareLeft: 0, shareRight: 1 } };
    expect(on(patterns({ side: crouch }), "steppage", "right")).toMatchObject({
      status: "not_assessed",
      notAssessed: "crouch_or_short_steps_on_S",
    });
  });

  it("puts tight calf first when the lunge is limited, calf stiffness first with spasticity, else the foot lifters", () => {
    const r = (s: InputSpec) => on(patterns({ side: foot(), ...s }), "steppage", "right")!.contributors;
    expect(r({})).toEqual(["weak_dorsiflexors", "tight_calf"]);
    expect(r({ rom: [romEntry("ankle_dorsiflexion_lunge", "right", 25, "mild")] })).toEqual([
      "tight_calf",
      "weak_dorsiflexors",
    ]);
    expect(r({ rom: [romEntry("ankle_dorsiflexion_lunge", "right", 45, "within")] })).toEqual([
      "weak_dorsiflexors",
    ]);
    expect(r({ intake: { conditions: ["stroke"] } })).toEqual([
      "calf_stiffness",
      "weak_dorsiflexors",
      "tight_calf",
    ]);
  });

  it("lifts the front of the foot only when likely and the person can lift it, and stretches a tight calf", () => {
    const ids = (s: InputSpec) =>
      on(patterns({ side: foot(), ...s }), "steppage", "right")!.targets.map((t) => t.id);
    expect(ids({})).toEqual([]);
    expect(
      ids({ intake: { romFlags: { osteoporosis: false, neckCaution: false, footLift: { right: true } } } }),
    ).toEqual(["strengthen:ankle_dorsiflexors"]);
    expect(ids({ rom: [romEntry("ankle_dorsiflexion_lunge", "right", 25, "marked")] })).toEqual([
      "stretch:calf",
    ]);
  });

  it("is one level lower on a walking pad the person was not familiar with", () => {
    const pad = (flags: "not_familiarised"[]) =>
      on(patterns({ mode: "walking_pad", side: foot(), flags, setup: PAD_SETUP }), "steppage", "right");
    expect(pad([])).toMatchObject({ status: "likely", confidence: "low" });
    expect(pad(["not_familiarised"])).toMatchObject({ status: "likely", confidence: null });
  });
});

describe("5.7 knee stays bent (crouch)", () => {
  const bent = (right: number, left = 5) => ({
    knee_stance_min: { left, right, shareLeft: left >= 15 ? 1 : 0, shareRight: right >= 15 ? 1 : 0 },
  });

  it("fires at the data thresholds; one side is the knee that stays bent", () => {
    const p = num(possible("crouch"), "knee_stance_min_gte");
    const l = num(likely("crouch"), "knee_stance_min_gte");
    expect(fired(patterns({ side: bent(p) }))).toEqual(["crouch:right:possible"]);
    expect(fired(patterns({ side: bent(l) }))).toEqual(["crouch:right:likely"]);
    const r = on(patterns({ side: bent(l) }), "crouch", "right")!;
    expect(r).toMatchObject({ label: "knee_stays_bent", confidence: "high" });
    expect(on(patterns({ side: bent(p) }), "crouch", "right")?.confidence).toBe("moderate");
  });

  it("is crouch on both sides", () => {
    const out = patterns({ side: bent(22, 17) });
    expect(fired(out)).toEqual(["crouch:both:possible"]);
    expect(on(out, "crouch", "both")?.label).toBe("crouch");
    expect(fired(patterns({ side: bent(22, 21) }))).toEqual(["crouch:both:likely"]);
  });

  it("counts the bent knee alone in a one sided condition only at 0.8 m/s or more", () => {
    const oneSided = {
      regions: [
        {
          region: "knee" as const,
          side: "right" as const,
          problems: ["weakness" as const],
          origin: "person" as const,
        },
      ],
    };
    expect(
      on(patterns({ side: { ...bent(22), speed_mps: { value: 0.7 } }, intake: oneSided }), "crouch", "right"),
    ).toMatchObject({ status: "not_assessed", notAssessed: "slow_speed" });
    expect(fired(patterns({ side: { ...bent(22), speed_mps: { value: 0.8 } }, intake: oneSided }))).toEqual([
      "crouch:right:likely",
    ]);
  });

  it("ranks the knee that cannot straighten first only when the range profile shows a lack of 10 or more", () => {
    const at = gaitPattern("crouch").contributorThresholds!.knee_straighten_limited!.gte!;
    const r = (rom?: ReturnType<typeof romEntry>[]) =>
      on(patterns({ side: bent(22), ...(rom ? { rom } : {}) }), "crouch", "right")!.contributors;
    // Not measured yet (the lying block runs after the walk, C-13).
    expect(r()).toEqual([
      "weak_quadriceps",
      "weak_push_off",
      "tight_hip_flexors",
      "weak_hip_extensors",
      "knee_straighten_limited",
    ]);
    expect(r([romEntry("knee_extension", "right", at, "mild")])).toEqual([
      "knee_straighten_limited",
      "weak_quadriceps",
      "weak_push_off",
      "tight_hip_flexors",
      "weak_hip_extensors",
    ]);
    expect(r([romEntry("knee_extension", "right", at - 1, "within")])).toEqual([
      "weak_quadriceps",
      "weak_push_off",
      "tight_hip_flexors",
      "weak_hip_extensors",
    ]);
  });

  it("stretches the back of the thigh only when the profile shows the knee straightening limited", () => {
    const ids = (rom: ReturnType<typeof romEntry>[]) =>
      on(patterns({ side: bent(22), rom }), "crouch", "right")!.targets.map((t) => t.id);
    expect(ids([])).toEqual([
      "strengthen:quadriceps",
      "strengthen:calf",
      "mobility:knee_extension",
      "stretch:hip_flexors",
    ]);
    expect(ids([romEntry("knee_extension", "right", 14, "mild")])).toEqual([
      "strengthen:quadriceps",
      "strengthen:calf",
      "mobility:knee_extension",
      "stretch:hip_flexors",
      "stretch:hamstrings",
    ]);
  });

  it("is not assessed on a prosthetic side", () => {
    const out = patterns({
      side: bent(22),
      intake: {
        regions: [
          {
            region: "knee",
            side: "right",
            problems: ["limb_loss"],
            origin: "condition",
            limbLoss: { level: "below_knee" },
          },
        ],
      },
    });
    expect(on(out, "crouch", "right")).toMatchObject({
      status: "not_assessed",
      notAssessed: "prosthetic_side",
    });
  });
});

describe("5.8 knee bends backwards (recurvatum)", () => {
  const back = (right: number) => ({
    knee_stance_min: { left: 5, right, shareLeft: 0, shareRight: 1 },
  });

  it("fires on the hyperextension past straight at the data thresholds", () => {
    const p = num(possible("recurvatum"), "hyperextension_gte");
    const l = num(likely("recurvatum"), "hyperextension_gte");
    expect(fired(patterns({ side: back(-p) }))).toEqual(["recurvatum:right:possible"]);
    expect(fired(patterns({ side: back(-l) }))).toEqual(["recurvatum:right:likely"]);
    expect(fired(patterns({ side: back(-p + 0.1) }))).toEqual([]);
    expect(on(patterns({ side: back(-l) }), "recurvatum", "right")).toMatchObject({
      confidence: "moderate",
      referrals: ["refer_knee_brace"],
      contributors: ["weak_quadriceps", "weak_hamstrings", "tight_calf"],
    });
  });

  it("names spasticity only with an upper motor neuron condition, and a tight calf from the lunge", () => {
    expect(
      on(patterns({ side: back(-16), intake: { conditions: ["cerebral_palsy"] } }), "recurvatum", "right")!
        .contributors,
    ).toEqual(["calf_stiffness", "quad_stiffness", "weak_quadriceps", "weak_hamstrings", "tight_calf"]);
    expect(
      on(
        patterns({ side: back(-16), rom: [romEntry("ankle_dorsiflexion_lunge", "right", 20, "marked")] }),
        "recurvatum",
        "right",
      )!.contributors,
    ).toEqual(["tight_calf", "weak_quadriceps", "weak_hamstrings"]);
  });
});

describe("5.9 straight knee at landing (quadriceps avoidance)", () => {
  const landing = (right: number, left: number) => ({
    knee_loading_peak: { left, right, shareLeft: 0, shareRight: 1 },
  });

  it("is possible only, low, with the knee 10 or more below the other side", () => {
    const peak = num(possible("quad_avoidance"), "knee_loading_peak_lte");
    const lower = num(possible("quad_avoidance"), "lowerThanOtherSide_gte");
    expect(fired(patterns({ side: landing(peak, peak + lower) }))).toEqual(["quad_avoidance:right:possible"]);
    expect(fired(patterns({ side: landing(peak, peak + lower - 0.1) }))).toEqual([]);
    expect(fired(patterns({ side: landing(peak + 0.1, peak + 20) }))).toEqual([]);
    expect(on(patterns({ side: landing(2, 18) }), "quad_avoidance", "right")).toMatchObject({
      status: "possible",
      confidence: "low",
      contributors: ["weak_quadriceps"],
    });
    expect(
      on(
        patterns({
          side: landing(2, 18),
          intake: { regions: [{ region: "knee", side: "right", problems: ["pain"], origin: "person" }] },
        }),
        "quad_avoidance",
        "right",
      )!.contributors,
    ).toEqual(["knee_pain", "weak_quadriceps"]);
  });
});

describe("5.10 leg does not reach behind (reduced extension)", () => {
  const tla = (right: number, left = 20) => ({ tla_peak: { left, right } });
  const shortOther = { sr_step_length: { value: 1.14, left: 1 / 1.14, right: 1.14 } };

  it("is possible at the data difference and likely with one corroboration, always low", () => {
    const diff = num(possible("reduced_extension"), "tla_lower_than_other_gte");
    expect(fired(patterns({ side: tla(20 - diff) }))).toEqual(["reduced_extension:right:possible"]);
    expect(fired(patterns({ side: tla(20 - diff + 0.1) }))).toEqual([]);
    // The other leg's step is shorter.
    expect(fired(patterns({ side: { ...tla(10), ...shortOther } }))).toEqual([
      "reduced_extension:right:likely",
    ]);
    // The thigh cannot reach the trunk line in the range profile.
    const out = patterns({ side: tla(10), rom: [romEntry("hip_extension", "right", -3, "marked")] });
    expect(on(out, "reduced_extension", "right")).toMatchObject({
      status: "likely",
      confidence: "low",
      contributors: ["tight_hip_flexors", "weak_push_off", "weak_hip_extensors"],
    });
    expect(on(out, "reduced_extension", "right")!.evidence.at(-1)).toEqual({
      metric: "pillar1_hip_extension",
      side: "right",
      value: -3,
      threshold: 0,
      share: null,
    });
  });

  it("keeps tight hip flexors as a possible reason after a standing test at or past the trunk line", () => {
    expect(
      on(
        patterns({ side: tla(10), rom: [romEntry("hip_extension", "right", 6, "within")] }),
        "reduced_extension",
        "right",
      )!.contributors,
    ).toEqual(["weak_push_off", "weak_hip_extensors", "tight_hip_flexors"]);
  });

  it("is capped at possible on the walking pad", () => {
    expect(
      on(
        patterns({ mode: "walking_pad", side: { ...tla(10), ...shortOther }, setup: PAD_SETUP }),
        "reduced_extension",
        "right",
      )?.status,
    ).toBe("possible");
  });
});

describe("5.11 short steps", () => {
  // A 58 year old man, 172 cm: Fang 2018 men 50 to 59, adjusted to his height.
  const short = (o: { step?: number; stride?: number; cadence?: number; speed?: number } = {}) => ({
    step_length_m: { value: o.step ?? 0.4, left: o.step ?? 0.4, right: o.step ?? 0.4 },
    stride_length_m: { value: o.stride ?? 0.8 },
    cadence: { value: o.cadence ?? 118 },
    speed_mps: { value: o.speed ?? 0.8 },
  });

  it("is likely with all three signs and possible with the speed and height sign alone", () => {
    expect(fired(patterns({ side: short() }))).toEqual(["short_steps:both:likely"]);
    expect(on(patterns({ side: short() }), "short_steps", "both")).toMatchObject({
      confidence: "high",
      contributors: [],
      targets: [
        { id: "practice:step_length", side: "both" },
        { id: "practice:walking", side: "both" },
        { id: "balance:weight_shift", side: "both" },
      ],
    });
    // (b) alone: steps normal for the age, cadence low.
    expect(fired(patterns({ side: short({ step: 0.6, cadence: 100 }) }))).toEqual([
      "short_steps:both:possible",
    ]);
    // (a) and (c) without (b): not with a height.
    expect(fired(patterns({ side: short({ stride: 1.1 }) }))).toEqual([]);
  });

  it("reads the Mikos expected stride for the speed and height (b) at the data margin", () => {
    const b = gaitPattern("short_steps").signs.find((s) => s.id === "b")!.belowExpected_m!;
    const m = GAIT_DATA.scaling.speedMatched.strideLength_m;
    const expected = m.intercept + m.speed * 0.8 + m.height_cm * 172;
    expect(
      fired(patterns({ side: short({ step: 0.6, cadence: 100, stride: expected - b - 0.001 }) })),
    ).toEqual(["short_steps:both:possible"]);
    expect(
      fired(patterns({ side: short({ step: 0.6, cadence: 100, stride: expected - b + 0.001 }) })),
    ).toEqual([]);
  });

  it("is not assessed overground without a height and capped at possible on the pad without one", () => {
    expect(
      on(
        patterns({ side: short(), intake: { heightCm: undefined }, flags: ["no_height"] }),
        "short_steps",
        "none",
      ),
    ).toMatchObject({ status: "not_assessed", notAssessed: "no_height" });
    // A height in the intake, but the walk gave no metres (the capture's setup had none).
    expect(
      on(
        patterns({ side: { ...short(), step_length_m: null, stride_length_m: null } }),
        "short_steps",
        "none",
      ),
    ).toMatchObject({ status: "not_assessed", notAssessed: "no_height" });
    const pad = patterns({
      mode: "walking_pad",
      side: short(),
      intake: { heightCm: undefined },
      setup: { ...PAD_SETUP, heightCm: null },
    });
    expect(on(pad, "short_steps", "both")).toMatchObject({ status: "possible" });
    expect(on(pad, "short_steps", "both")!.targets[0]).toEqual({
      id: "practice:step_length_pad",
      side: "both",
    });
  });

  it("names the condition, a fall and reduced extension as possible reasons", () => {
    expect(
      on(patterns({ side: short(), intake: { conditions: ["parkinsons"] } }), "short_steps", "both")!
        .contributors,
    ).toEqual(["small_movements_condition"]);
    expect(
      on(patterns({ side: short(), steadi: { fell: true, worry: false } }), "short_steps", "both")!
        .contributors,
    ).toEqual(["careful_walking"]);
    const withTla = patterns({ side: { ...short(), tla_peak: { left: 20, right: 10 } } });
    expect(on(withTla, "short_steps", "both")!.contributors).toEqual(["tight_hip_flexors"]);
    expect(on(withTla, "short_steps", "both")!.targets.map((t) => t.id)).toContain("stretch:hip_flexors");
  });
});

describe("5.12 support findings", () => {
  it("finds a slower than typical speed overground", () => {
    expect(run({ side: { speed_mps: { value: 0.85 } } }).findings).toEqual([
      { id: "slow_speed", side: "none", value: 0.85 },
    ]);
    expect(run({ side: { speed_mps: { value: 0.95 } } }).findings).toEqual([]);
    // On the pad the speed is the person's choice.
    expect(
      run({ mode: "walking_pad", side: { speed_mps: { value: 0.5 } }, setup: PAD_SETUP }).findings,
    ).toEqual([]);
  });

  it("finds uneven step length on the shorter side at the data threshold", () => {
    const at = num(gaitFinding("uneven_step_length").thresholds.possible, "sr_step_length_gte");
    expect(run({ side: { sr_step_length: { value: at, left: 1 / at, right: at } } }).findings).toEqual([
      { id: "uneven_step_length", side: "left", value: at },
    ]);
    expect(
      run({ side: { sr_step_length: { value: at - 0.01, left: 1, right: at - 0.01 } } }).findings,
    ).toEqual([]);
  });
});

describe("confidence (confidenceModel)", () => {
  const stiff = { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } };

  it("never exceeds the data cap of the pattern or the weakest sign's grade", () => {
    for (const p of GAIT_DATA.patterns) {
      const caps = p.signGrades.map((g) => GAIT_DATA.confidenceModel.capFromGrade[g]);
      const order = GAIT_DATA.confidenceModel.levels;
      const weakest = Math.min(...caps.map((c) => (c === null ? -1 : order.indexOf(c))));
      expect(order.indexOf(p.confidenceCap), p.id).toBeLessThanOrEqual(weakest);
    }
    // A measured grade lower than the rule's own lowers the cap (the knee near 0 degrees is B).
    const graded = {
      knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1, grade: "B" as const },
    };
    expect(on(patterns({ side: graded }), "stiff_knee", "right")?.confidence).toBe("moderate");
  });

  it("is one level lower under 10 clean cycles, at 20 to 24 fps and on a side with nothing in the history", () => {
    const at = (s: InputSpec) => on(patterns({ side: stiff, ...s }), "stiff_knee", "right")?.confidence;
    expect(at({})).toBe("high");
    expect(at({ views: [view({ view: "side", metrics: stiff, cycles: { left: 9, right: 9 } })] })).toBe(
      "moderate",
    );
    expect(at({ views: [view({ view: "side", metrics: stiff, fps: 24 })] })).toBe("moderate");
    expect(at({ intake: { regions: [] } })).toBe("moderate");
    expect(at({ intake: { regions: [], conditions: ["ms"] } })).toBe("high");
    expect(
      at({ intake: { regions: [{ region: "knee", side: "left", problems: ["pain"], origin: "person" }] } }),
    ).toBe("moderate");
    expect(
      at({
        intake: { regions: [{ region: "back_trunk", side: "axial", problems: ["pain"], origin: "person" }] },
      }),
    ).toBe("high");
    expect(
      at({
        intake: { regions: [] },
        views: [view({ view: "side", metrics: stiff, cycles: { left: 9, right: 9 }, fps: 22 })],
      }),
    ).toBeNull();
  });

  it("is not shown below low", () => {
    const r = on(
      patterns({
        side: { sr_single_support: { value: 1.12, left: 1.12, right: 1 / 1.12 } },
        views: [
          view({
            view: "side",
            metrics: { sr_single_support: { value: 1.12, left: 1.12, right: 1 / 1.12 } },
            cycles: { left: 8, right: 8 },
          }),
        ],
      }),
      "shorter_stance",
      "right",
    )!;
    expect(r).toMatchObject({ status: "possible", confidence: null });
    expect(gaitPatternShown(r)).toBe(false);
    expect(r.lines).toEqual({ pattern: { ar: "", en: "" }, reasons: null, targets: [], confidence: null });
  });

  it("caps every rule at possible with a light touch on the handrail", () => {
    const out = patterns({ mode: "walking_pad", side: stiff, flags: ["handrail_light"], setup: PAD_SETUP });
    expect(on(out, "stiff_knee", "right")).toMatchObject({ status: "possible", confidence: "moderate" });
  });
});

describe("the pain day rule (painDayRule)", () => {
  const stiff = { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } };
  const ratio = { sr_single_support: { value: 1.2, left: 1.2, right: 1 / 1.2 } };
  const kneePainRight = {
    regions: [
      {
        region: "knee" as const,
        side: "right" as const,
        problems: ["pain" as const],
        origin: "person" as const,
      },
    ],
  };

  it("shows only the antalgic label on a leg, hip or back pain of 4 or 5 today", () => {
    for (const day of [{ plan: { antalgicOnly: true } }, { pain: { knee: 4 } }] as InputSpec[]) {
      const out = patterns({
        side: { ...stiff, ...ratio },
        intake: kneePainRight,
        pain: { knee: 2 },
        ...day,
      });
      expect(on(out, "shorter_stance", "right")).toMatchObject({ label: "antalgic", confidence: "moderate" });
      // Other patterns stay in the record, not shown, without weakness or tightness reasons.
      expect(on(out, "stiff_knee", "right")).toMatchObject({ status: "likely", confidence: null });
      expect(on(out, "stiff_knee", "right")!.contributors).toEqual(["knee_bend_limited"]);
    }
  });

  it("does not show a shorter stance on a pain day when the pain is not on that side", () => {
    const out = patterns({ side: ratio, plan: { antalgicOnly: true } });
    expect(on(out, "shorter_stance", "right")).toMatchObject({ status: "likely", confidence: null });
  });

  it("follows the data's pain day scores", () => {
    expect(GAIT_DATA.confidenceModel.painDayAntalgic).toEqual([4, 5]);
    const at = (score: number) =>
      on(patterns({ side: stiff, pain: { back_trunk: score } }), "stiff_knee", "right")!.confidence;
    expect(at(3)).toBe("high");
    expect(at(4)).toBeNull();
    expect(at(5)).toBeNull();
  });
});

describe("the person's lines (gait-rules 6)", () => {
  const C = GAIT_DATA.copy;
  const stiff = { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } };

  it("write the pattern on its side, the possible reasons, the program lines and how sure we are", () => {
    const r = on(patterns({ side: stiff, intake: { conditions: ["stroke"] } }), "stiff_knee", "right")!;
    expect(r.lines.pattern).toEqual({
      ar: C.patterns.stiff_knee.ar.replace("{side_ar}", C.placeholders.side_ar[0]),
      en: C.patterns.stiff_knee.en.replace("{side_en}", C.placeholders.side_en[0]),
    });
    expect(r.lines.reasons).toEqual({
      ar: C.contributorsLead.ar.replace(
        "{list}",
        [
          C.contributors.quad_stiffness,
          C.contributors.weak_push_off,
          C.contributors.weak_hip_flexors,
          C.contributors.knee_bend_limited,
        ]
          .map((t) => t.ar)
          .join(" و"),
      ),
      en: C.contributorsLead.en.replace(
        "{list}",
        `${C.contributors.quad_stiffness.en}, ${C.contributors.weak_push_off.en}, ${C.contributors.weak_hip_flexors.en} and ${C.contributors.knee_bend_limited.en}`,
      ),
    });
    expect(r.lines.targets).toEqual([
      C.targets.strengthen_calf_push_off,
      C.targets.strengthen_hip_flexors,
      C.targets.walking_practice,
    ]);
    expect(r.lines.confidence).toEqual({
      ar: `${C.confidence.label.ar}: ${C.confidence.high.ar}`,
      en: `${C.confidence.label.en}: ${C.confidence.high.en}`,
    });
  });

  it("add the possible line and only the first program line when possible with low confidence", () => {
    const r = on(
      patterns({ front: { pelvic_drop: { left: 4, right: 14, shareLeft: 0, shareRight: 1 } } }),
      "trendelenburg",
      "right",
    )!;
    expect(r).toMatchObject({ status: "possible", confidence: "low" });
    expect(r.lines.pattern.en).toBe(
      `${C.patterns.trendelenburg.en.replace("{side_en}", "right")} ${C.patterns.possible_suffix.en}`,
    );
    expect(r.lines.pattern.ar).toBe(
      `${C.patterns.trendelenburg.ar.replace("{side_ar}", C.placeholders.side_ar[0])} ${C.patterns.possible_suffix.ar}`,
    );
    expect(r.lines.targets).toEqual([C.targets.strengthen_hip_abductors]);
  });

  it("use the side words of the left side, the bilateral lines and the steppage line by status", () => {
    const left = on(
      patterns({ side: { knee_swing_peak: { left: 35, right: 60, shareLeft: 1, shareRight: 0 } } }),
      "stiff_knee",
      "left",
    )!;
    expect(left.lines.pattern.ar).toContain(C.placeholders.side_ar[1]);
    expect(left.lines.pattern.en).toContain("left");
    const both = on(
      patterns({ side: { knee_swing_peak: { left: 37, right: 38, shareLeft: 1, shareRight: 1 } } }),
      "stiff_knee",
      "both",
    )!;
    expect(both.lines.pattern).toEqual(C.patterns.stiff_knee_both);
    const steppage = on(
      patterns({
        side: {
          foot_pitch_ic: { left: 20, right: -2, shareLeft: 0, shareRight: 1 },
          thigh_swing_peak: { left: 30, right: 40 },
        },
      }),
      "steppage",
      "right",
    )!;
    expect(steppage.status).toBe("likely");
    expect(steppage.lines.pattern.en).toBe(C.patterns.steppage_likely.en.replace("{side_en}", "right"));
  });

  it("are recomputed from a stored result without its lines", () => {
    const out = run({
      side: {
        ...stiff,
        knee_stance_min: { left: 18, right: 22, shareLeft: 1, shareRight: 1 },
        sr_single_support: { value: 1.2, left: 1 / 1.2, right: 1.2 },
      },
      front: { pelvic_drop: { left: 4, right: 14, shareLeft: 0, shareRight: 1 } },
      intake: { conditions: ["stroke"] },
    });
    const stored = out.patterns.map(({ lines: _lines, ...rest }) => rest);
    expect(withGaitLines(stored)).toEqual(out.patterns);
    for (const p of out.patterns) expect(gaitPatternLines(stored[out.patterns.indexOf(p)])).toEqual(p.lines);
  });

  it("keep the wording rules and leave no placeholder", () => {
    const out = run({
      side: {
        ...stiff,
        knee_stance_min: { left: 18, right: 22, shareLeft: 1, shareRight: 1 },
        sr_single_support: { value: 1.2, left: 1 / 1.2, right: 1.2 },
        tla_peak: { left: 20, right: 9 },
        knee_loading_peak: { left: 18, right: 3, shareLeft: 0, shareRight: 1 },
      },
      front: {
        pelvic_drop: { left: 4, right: 14, shareLeft: 0, shareRight: 1 },
        trunk_sway_range: { value: 13, left: 6, right: 13, shareLeft: 0, shareRight: 1 },
        trunk_lean_peak: { left: 1, right: 6, shareLeft: 0.2, shareRight: 1 },
      },
      intake: {
        conditions: ["stroke"],
        regions: [KNEES_BOTH, { region: "hip", side: "right", problems: ["pain"], origin: "person" }],
      },
    });
    const shown = out.patterns.filter(gaitPatternShown);
    expect(shown.length).toBeGreaterThan(4);
    for (const p of shown) {
      const texts = [p.lines.pattern, p.lines.reasons, p.lines.confidence, ...p.lines.targets].filter(
        (t): t is NonNullable<typeof t> => t !== null,
      );
      for (const t of texts)
        for (const s of [t.ar, t.en]) {
          expect(s.length, p.pattern).toBeGreaterThan(0);
          expect(s, p.pattern).not.toMatch(/[{}]/);
          expect(wordingProblems(s), s).toEqual([]);
        }
    }
  });
});

describe("rules and data stay in step", () => {
  const allTargets = () =>
    GAIT_DATA.patterns.flatMap((p) =>
      Array.isArray(p.targets) ? p.targets : Object.values(p.targets).flat(),
    );

  it("knows every condition a pattern target is written with", () => {
    const whens = new Set(allTargets().flatMap((t) => (t.when ? [t.when] : [])));
    expect([...whens].sort()).toEqual([...HANDLED_TARGET_WHENS].sort());
  });

  it("turns every pattern target into a target of the program's vocabulary or a referral line", () => {
    const vocabulary = new Set<string>([
      ...TARGETS_DATA.taxonomy.muscleGroups.flatMap((m) => [`strengthen:${m.id}`, `stretch:${m.id}`]),
      ...TARGETS_DATA.taxonomy.jointMovements.map((j) => `mobility:${j.id}`),
      ...TARGETS_DATA.taxonomy.balanceTargets.map((b) => `balance:${b.id}`),
      ...TARGETS_DATA.taxonomy.practiceTargets.map((p) => `practice:${p.id}`),
    ]);
    const lines = [
      // Every pattern firing with every condition of its targets met.
      ...patterns({
        side: {
          knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 },
          knee_stance_min: { left: 5, right: -16, shareLeft: 0, shareRight: 1 },
          sr_single_support: { value: 1.2, left: 1 / 1.2, right: 1.2 },
          tla_peak: { left: 20, right: 9 },
          step_length_m: { value: 0.4, left: 0.4, right: 0.4 },
          stride_length_m: { value: 0.8 },
          cadence: { value: 118 },
          speed_mps: { value: 0.8 },
        },
        rom: [
          romEntry("knee_flexion", "right", 100, "mild"),
          romEntry("knee_extension", "right", 15, "mild"),
        ],
        intake: { conditions: ["stroke"] },
      }),
    ];
    for (const p of lines) {
      for (const t of p.targets) expect(vocabulary.has(t.id), `${p.pattern} ${t.id}`).toBe(true);
      for (const r of p.referrals) expect(GAIT_REFERRAL_IDS as readonly string[]).toContain(r);
    }
    for (const t of allTargets().filter((x) => x.action === "refer"))
      expect(GAIT_REFERRAL_IDS as readonly string[]).toContain(`refer_${t.target}`);
  });

  it("maps every program line of the data to the targets it names", () => {
    expect(Object.keys(COPY_TARGET_IDS).sort()).toEqual([...GAIT_COPY_TARGET_KEYS].sort());
    for (const p of [...GAIT_DATA.patterns, ...GAIT_DATA.findings]) {
      const keys = Array.isArray(p.copyTargets) ? p.copyTargets : Object.values(p.copyTargets).flat();
      for (const k of keys) expect(COPY_TARGET_IDS[k], `${p.id} ${k}`).toBeDefined();
    }
  });

  it("names only the contributors of the data, and only in the pattern's own list", () => {
    const out = patterns({
      side: { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } },
      intake: { conditions: ["stroke"] },
    });
    for (const p of out) {
      const def = gaitPattern(p.pattern);
      const own = Array.isArray(def.contributors) ? def.contributors : (def.contributors[p.label] ?? []);
      for (const c of p.contributors) {
        expect(GAIT_CONTRIBUTOR_IDS as readonly string[]).toContain(c);
        expect(own, `${p.pattern} ${c}`).toContain(c);
      }
    }
  });

  it("reads the upper motor neuron conditions of the data", () => {
    for (const c of GAIT_DATA.confidenceModel.spasticityOnlyWith) {
      const r = on(
        patterns({
          side: { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } },
          intake: { conditions: [c] },
        }),
        "stiff_knee",
        "right",
      )!;
      expect(r.contributors[0], c).toBe("quad_stiffness");
    }
    const sci = on(
      patterns({
        side: { knee_swing_peak: { left: 60, right: 35, shareLeft: 0, shareRight: 1 } },
        intake: { conditions: ["sci_complete"] },
      }),
      "stiff_knee",
      "right",
    )!;
    expect(sci.contributors).not.toContain("quad_stiffness");
  });
});

describe("contributors that change when the lying block's rows arrive (C-13)", () => {
  it("re-rank the crouch reasons once the knee straightening is measured", () => {
    const analysis = walk({ side: { knee_stance_min: { left: 5, right: 22, shareLeft: 0, shareRight: 1 } } });
    const before = on(evaluateGait(input({ analysis })).patterns, "crouch", "right")!;
    const after = on(
      evaluateGait(input({ analysis, rom: [romEntry("knee_extension", "right", 15, "mild")] })).patterns,
      "crouch",
      "right",
    )!;
    expect(before.contributors[0]).toBe("weak_quadriceps");
    expect(after.contributors[0]).toBe("knee_straighten_limited");
    expect(after.lines.reasons).not.toEqual(before.lines.reasons);
  });
});
