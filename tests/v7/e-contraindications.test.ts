/**
 * Step E1 (product v7 contract 2.10): v7Contraindications, the ids of the exercise targets
 * contraindication vocabulary that hold for a person, from the intake alone (what libraryPool applies
 * in every build), the range profile and the gait plan (what selectForTargets adds on top).
 *
 * The module reads no v7 data at runtime (libraryPool runs in every build), so its id lists and
 * numbers are parity tested here against TARGETS_DATA (C-1), and every rule is tested on its own.
 */
import { describe, expect, it } from "vitest";
import {
  FORM_ONLY_IDS,
  ID_WINDOWS,
  KNEE_PAST_STRAIGHT_GTE,
  POSITION_IDS,
  REGION_ID_KINDS,
  SEATED_LEAN_BACK_PAIN_AT,
  V7_ONLY_IDS,
  WINDOW_BUCKETS,
  canClearV7Ids,
  openPositions,
  recentHipReplacement,
  v7Contraindications,
} from "../../src/medical/contraindications";
import { REGION_IDS, SINCE_BUCKETS, type SinceBucket } from "../../src/medical/body-map";
import { hasV7Fields, painOptions, type Intake } from "../../src/medical/plan";
import type { RomProfile, RomProfileEntry } from "../../src/medical/rom-types";
import type { GaitNotOffered, GaitPlan } from "../../src/medical/gait-eligibility";
import { TARGETS_DATA } from "../../src/movements/targets";
import { corpus, entry, flags, hipReplacement, v1, v7 } from "./e-corpus";

const VOCABULARY = TARGETS_DATA.contraindicationVocabulary;
const term = (id: string) => {
  const t = VOCABULARY.find((v) => v.id === id);
  if (!t) throw new Error(`not in the vocabulary: ${id}`);
  return t;
};
const TEMPLATE = ":<region>";
const isTemplate = (id: string) => id.endsWith(TEMPLATE);
/** Every id the vocabulary names, with its region templates expanded and its {area}_injury rule. */
const VOCABULARY_IDS = new Set([
  ...VOCABULARY.filter((t) => !isTemplate(t.id)).map((t) => t.id),
  ...VOCABULARY.filter((t) => isTemplate(t.id)).flatMap((t) =>
    REGION_IDS.map((r) => t.id.replace("<region>", r)),
  ),
  // «pool.ts: built from the intake pain areas ({area}_injury)»
  ...painOptions.map((p) => `${p}_injury`),
]);

const ids = (h: Intake, profile: RomProfile | null = null, gait: GaitPlan | null = null) =>
  [...v7Contraindications(h, profile, gait)].sort();
const holds = (h: Intake, id: string, profile: RomProfile | null = null, gait: GaitPlan | null = null) =>
  v7Contraindications(h, profile, gait).has(id);

const profileEntry = (over: Partial<RomProfileEntry>): RomProfileEntry => ({
  movementId: "shoulder_flexion",
  side: "right",
  region: "shoulder",
  source: "measured",
  kind: "flexion",
  value: 150,
  typical: 165,
  percentOfNormal: 91,
  z: -0.8,
  finding: "within",
  gradeIgnoringPain: null,
  painLimited: false,
  painLevel: null,
  cause: null,
  provisional: false,
  approximate: false,
  noActiveMovement: false,
  flags: [],
  reason: null,
  measuredAt: 1,
  checkId: "check-1",
  ...over,
});
const profile = (...entries: Partial<RomProfileEntry>[]): RomProfile => ({
  sex: "female",
  age: 52,
  normsVersion: "norms_test",
  created: 1,
  entries: entries.map(profileEntry),
});
const gaitPlan = (over: Partial<GaitPlan> = {}): GaitPlan => ({
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: true,
  views: { overground: ["front", "back", "side"], walking_pad: [] },
  ...over,
});
const notOffered = (reason: GaitNotOffered) =>
  gaitPlan({ offered: false, reason, modes: [], padAllowed: false, staticStance: false });

/* ------------------------------------------------------------- parity */

describe("the id lists and numbers against TARGETS_DATA (C-1)", () => {
  it("V7_ONLY_IDS are the vocabulary ids of kind new, each region template once per body map region", () => {
    const fresh = VOCABULARY.filter((t) => t.kind.startsWith("new"));
    const expected = [
      ...fresh.filter((t) => !isTemplate(t.id)).map((t) => t.id),
      ...fresh
        .filter((t) => isTemplate(t.id))
        .flatMap((t) => REGION_IDS.map((r) => t.id.replace("<region>", r))),
    ];
    expect([...V7_ONLY_IDS].sort()).toEqual(expected.sort());
    // The existing ids stay out: the v1 pool knows them.
    for (const t of VOCABULARY.filter((t) => t.kind.startsWith("existing")))
      expect(V7_ONLY_IDS.has(t.id)).toBe(false);
  });

  it("generates the region ids of the vocabulary's templates", () => {
    expect([...REGION_ID_KINDS].sort()).toEqual(
      VOCABULARY.filter((t) => isTemplate(t.id))
        .map((t) => t.id.replace(TEMPLATE, ""))
        .sort(),
    );
  });

  it("reads each dated id with the months or weeks of the vocabulary", () => {
    const dated = VOCABULARY.filter((t) => t.months !== undefined || t.weeks !== undefined);
    expect(dated.length).toBeGreaterThan(5);
    for (const t of dated) {
      const key = t.id.replace(TEMPLATE, "") as keyof typeof ID_WINDOWS;
      expect(ID_WINDOWS[key], t.id).toBe(t.months !== undefined ? `${t.months}m` : `${t.weeks}w`);
    }
    expect(Object.keys(ID_WINDOWS).sort()).toEqual(dated.map((t) => t.id.replace(TEMPLATE, "")).sort());
  });

  it("maps each window to the body map's since buckets (12 weeks at the 3 month boundary, A2-6)", () => {
    expect(WINDOW_BUCKETS).toEqual({
      "6w": ["lt6w"],
      "12w": ["lt6w", "6w_3m"],
      "3m": ["lt6w", "6w_3m"],
      "6m": ["lt6w", "6w_3m", "3m_6m"],
    });
    for (const list of Object.values(WINDOW_BUCKETS))
      for (const b of list) expect(SINCE_BUCKETS).toContain(b);
  });

  it("copies the knee and back pain numbers", () => {
    expect(KNEE_PAST_STRAIGHT_GTE).toBe(term("knee_hyperextension").kneePastStraightGte);
    expect(SEATED_LEAN_BACK_PAIN_AT).toBe(term("seated_lean_gate").backPainAtOrAbove);
  });

  it("scopes only vocabulary ids to positions or forms", () => {
    for (const id of [...Object.keys(POSITION_IDS), ...FORM_ONLY_IDS]) expect(VOCABULARY_IDS).toContain(id);
    // The meanings the scopes come from.
    expect(term("standing_gate").meaning).toContain("for standing items");
    expect(term("sitting_balance").meaning).toContain("(seated_forward) are removed");
    expect(term("pad_not_eligible").meaning).toContain("Applies to the walking pad form only");
  });

  it("names only vocabulary ids, for every corpus intake and every profile and gait rule", () => {
    const all = new Set<string>();
    for (const { h } of corpus()) for (const id of v7Contraindications(h, null, null)) all.add(id);
    const p = profile(
      { reason: "weak_shoulder" },
      { noActiveMovement: true },
      { region: "knee", movementId: "knee_extension", kind: "lack", value: -8 },
      { region: "hip", reason: "red_flag", source: "not_measured_today", value: null },
    );
    for (const id of v7Contraindications(v7({ conditions: ["stroke"] }), p, notOffered("prosthesis_off")))
      all.add(id);
    for (const id of all) expect(VOCABULARY_IDS, id).toContain(id);
    // Not vacuous: most of the vocabulary is reached.
    expect(all.size).toBeGreaterThan(25);
  });
});

/* ------------------------------------------------------- the intake alone */

describe("the ids the intake decides (what libraryPool applies, 2.10 rule 2)", () => {
  it("holds nothing for a v7 intake without a finding", () => {
    expect(ids(v7())).toEqual([]);
  });

  it("builds the existing ids as pool.ts does: the pain areas and the two restrictions", () => {
    expect(ids(v1({ pain: ["shoulder", "wrist"] }))).toEqual(["shoulder_injury", "wrist_injury"]);
    // Knee pain also closes the standing items (the v1.1 chair stand pain areas).
    expect(ids(v1({ pain: ["knee"] }))).toEqual(["knee_injury", "standing_gate"]);
    expect(holds(v1({ restrictions: ["balance_support"] }), "severe_balance_issues")).toBe(true);
    expect(holds(v1({ restrictions: ["no_overhead"] }), "no_overhead")).toBe(true);
    expect(holds(v1({ restrictions: ["no_weight_bearing"] }), "no_weight_bearing")).toBe(true);
  });

  it("osteoporosis_spine and neck_caution come from the safety answers", () => {
    expect(holds(v7({ romFlags: flags({ osteoporosis: true }) }), "osteoporosis_spine")).toBe(true);
    expect(holds(v7({ romFlags: flags({ neckCaution: true }) }), "neck_caution")).toBe(true);
    // «rheumatoid or another inflammatory arthritis unless a doctor confirmed the neck is stable»
    for (const inflammatoryArthritis of ["yes", "unsure"] as const) {
      const h = (neckCleared?: boolean) =>
        v7({ conditions: ["arthritis"], romFlags: flags({ inflammatoryArthritis, neckCleared }) });
      expect(holds(h(false), "neck_caution")).toBe(true);
      expect(holds(h(true), "neck_caution")).toBe(false);
    }
    expect(holds(v7({ romFlags: flags({ inflammatoryArthritis: "no" }) }), "neck_caution")).toBe(false);
  });

  it("a v7 intake without its safety answers clears neither; a v1 intake leaves them to the pool rule", () => {
    const missing = v7({ romFlags: undefined });
    expect(holds(missing, "osteoporosis_spine")).toBe(true);
    expect(holds(missing, "neck_caution")).toBe(true);
    expect(holds(v1(), "osteoporosis_spine")).toBe(false);
    expect(canClearV7Ids(missing)).toBe(true);
    expect(canClearV7Ids(v1())).toBe(false);
  });

  it("canClearV7Ids is plan.ts hasV7Fields (this module cannot import plan.ts)", () => {
    for (const { h } of corpus().filter((_, i) => i % 97 === 0))
      expect(canClearV7Ids(h)).toBe(hasV7Fields(h));
    const { sex: _sex, ...noSex } = v7();
    expect(canClearV7Ids(noSex as Intake)).toBe(false);
  });

  it("spine_surgery_recent: neck or back surgery in the last 3 months", () => {
    const back = (since: SinceBucket) =>
      v7({
        regions: [
          entry("back_trunk", "axial", ["after_surgery"], {
            surgery: since === "lt6w" || since === "6w_3m" ? { since, cleared: "yes", avoid: [] } : { since },
          }),
        ],
      });
    expect(holds(back("lt6w"), "spine_surgery_recent")).toBe(true);
    expect(holds(back("6w_3m"), "spine_surgery_recent")).toBe(true);
    expect(holds(back("3m_6m"), "spine_surgery_recent")).toBe(false);
    expect(holds(back("gt6m"), "spine_surgery_recent")).toBe(false);
    const knee = v7({
      regions: [
        entry("knee", "left", ["after_surgery"], { surgery: { since: "lt6w", cleared: "yes", avoid: [] } }),
      ],
    });
    expect(holds(knee, "spine_surgery_recent")).toBe(false);
  });

  it("the region ids: not cleared, early after surgery, acute injury", () => {
    const surgery = (since: "lt6w" | "6w_3m" | "3m_6m", cleared?: "yes" | "no" | "unsure") =>
      v7({
        regions: [
          entry("knee", "right", ["after_surgery"], {
            surgery: cleared ? { since, cleared, ...(cleared === "yes" ? { avoid: [] } : {}) } : { since },
          }),
        ],
      });
    expect(ids(surgery("lt6w", "no"))).toEqual(
      expect.arrayContaining(["region_not_cleared:knee", "region_early_post_op:knee"]),
    );
    expect(holds(surgery("6w_3m", "unsure"), "region_not_cleared:knee")).toBe(true);
    expect(holds(surgery("6w_3m", "yes"), "region_not_cleared:knee")).toBe(false);
    // «Surgery in that region under 12 weeks»: cleared or not.
    expect(holds(surgery("6w_3m", "yes"), "region_early_post_op:knee")).toBe(true);
    expect(holds(surgery("3m_6m"), "region_early_post_op:knee")).toBe(false);
    expect(holds(surgery("3m_6m"), "region_not_cleared:knee")).toBe(false);
    const injury = (since: "lt6w" | "6w_3m") =>
      v7({ regions: [entry("shoulder", "left", ["injury"], { injury: { since } })] });
    expect(holds(injury("lt6w"), "region_acute_injury:shoulder")).toBe(true);
    expect(holds(injury("6w_3m"), "region_acute_injury:shoulder")).toBe(false);
    // A missing answer reads as recent (the safe reading, as rom-protocol.ts).
    const unanswered = v7({ regions: [entry("hip", "left", ["after_surgery", "injury"])] });
    expect(ids(unanswered)).toEqual(
      expect.arrayContaining([
        "region_acute_injury:hip",
        "region_early_post_op:hip",
        "region_not_cleared:hip",
      ]),
    );
  });

  it("achilles: a tear or repair in the last 6 months", () => {
    const ankle = (since: "lt6w" | "6w_3m" | "3m_6m" | "gt6m", achilles: boolean) =>
      v7({ regions: [entry("ankle_foot", "right", ["injury"], { injury: { since, achilles } })] });
    for (const since of ["lt6w", "6w_3m", "3m_6m"] as const)
      expect(holds(ankle(since, true), "achilles")).toBe(true);
    expect(holds(ankle("gt6m", true), "achilles")).toBe(false);
    expect(holds(ankle("lt6w", false), "achilles")).toBe(false);
  });

  it("the hip precautions after a hip replacement under 3 months: on by default, the ticked lists, none", () => {
    const both = [
      "hip_precautions_anterior",
      "hip_precautions_posterior",
      "hip_precautions_posterior_unless_raised_seat",
    ];
    const hip = (avoid?: Parameters<typeof hipReplacement>[0]) =>
      ids(v7({ regions: [hipReplacement(avoid)] })).filter((id) => id.startsWith("hip_"));
    expect(hip()).toEqual(both);
    expect(hip(["none"])).toEqual([]);
    for (const posterior of ["flex90", "cross", "turn_in"] as const)
      expect(hip([posterior])).toEqual([
        "hip_precautions_posterior",
        "hip_precautions_posterior_unless_raised_seat",
      ]);
    expect(hip(["back_out"])).toEqual(["hip_precautions_anterior"]);
    expect(hip(["flex90", "back_out"])).toEqual(both);
    // Not a replacement, or 3 months ago or more: no hip precaution.
    const notReplaced = v7({
      regions: [
        entry("hip", "right", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: [], hipReplacement: false },
        }),
      ],
    });
    expect(ids(notReplaced).filter((id) => id.startsWith("hip_"))).toEqual([]);
    const older = v7({
      regions: [entry("hip", "right", ["after_surgery"], { surgery: { since: "3m_6m" } })],
    });
    expect(ids(older).filter((id) => id.startsWith("hip_"))).toEqual([]);
  });

  it("recentHipReplacement: any hip replacement under 3 months, whatever the limits", () => {
    expect(recentHipReplacement(v7({ regions: [hipReplacement(["none"])] }))).toBe(true);
    expect(recentHipReplacement(v7({ regions: [hipReplacement(["back_out"], "left")] }))).toBe(true);
    expect(
      recentHipReplacement(
        v7({ regions: [entry("hip", "right", ["after_surgery"], { surgery: { since: "3m_6m" } })] }),
      ),
    ).toBe(false);
    expect(recentHipReplacement(v1())).toBe(false);
  });

  it("standing_gate: the v1.1 chair stand exclusions for standing items, at home", () => {
    expect(holds(v7(), "standing_gate")).toBe(false);
    for (const over of [
      { mobility: "seated" },
      { mobility: "wheelchair" },
      { mobility: "bed" },
      { pain: ["hip"] },
      { pain: ["knee"] },
      { pain: ["back"] },
      { restrictions: ["no_weight_bearing"] },
      { restrictions: ["balance_support"] },
      { conditions: ["sci_complete"] },
      { clearance: "no" },
      { clearance: "unsure" },
    ] as Partial<Intake>[])
      expect(holds(v7(over), "standing_gate"), JSON.stringify(over)).toBe(true);
    // Shoulder pain and SCI incomplete do not close standing.
    expect(holds(v7({ pain: ["shoulder"] }), "standing_gate")).toBe(false);
    expect(holds(v7({ conditions: ["sci_incomplete"] }), "standing_gate")).toBe(false);
  });

  it("walk_not_eligible: does not walk, or a gait gate the intake answers", () => {
    expect(holds(v7(), "walk_not_eligible")).toBe(false);
    expect(holds(v7({ walking: { status: "no" } }), "walk_not_eligible")).toBe(true);
    expect(holds(v7({ walking: { status: "with_aid", aid: "walker" } }), "walk_not_eligible")).toBe(false);
    expect(holds(v7({ restrictions: ["no_weight_bearing"] }), "walk_not_eligible")).toBe(true);
    expect(holds(v7({ restrictions: ["no_exercise"] }), "walk_not_eligible")).toBe(true);
    // «clearance no or unsure: stroke or SCI: no gait test»; other conditions walk.
    expect(holds(v7({ conditions: ["stroke"], clearance: "unsure" }), "walk_not_eligible")).toBe(true);
    expect(holds(v7({ conditions: ["sci_incomplete"], clearance: "no" }), "walk_not_eligible")).toBe(true);
    expect(holds(v7({ conditions: ["arthritis"], clearance: "no" }), "walk_not_eligible")).toBe(false);
    // «pc_surgery_recent with back, hip, knee, ankle or foot not cleared», from the body map.
    const leg = (cleared: "yes" | "no") =>
      v7({
        regions: [
          entry("ankle_foot", "left", ["after_surgery"], {
            surgery: { since: "6w_3m", cleared, ...(cleared === "yes" ? { avoid: [] } : {}) },
          }),
        ],
      });
    expect(holds(leg("no"), "walk_not_eligible")).toBe(true);
    expect(holds(leg("yes"), "walk_not_eligible")).toBe(false);
    const arm = v7({
      regions: [entry("elbow", "left", ["after_surgery"], { surgery: { since: "lt6w", cleared: "no" } })],
    });
    expect(holds(arm, "walk_not_eligible")).toBe(false);
  });

  it("wheelchair_needs_transfer: a wheelchair user only with the chair transfer answered yes", () => {
    expect(holds(v7({ mobility: "wheelchair" }), "wheelchair_needs_transfer")).toBe(true);
    expect(
      holds(
        v7({ mobility: "wheelchair", romFlags: flags({ transferChair: false }) }),
        "wheelchair_needs_transfer",
      ),
    ).toBe(true);
    expect(
      holds(
        v7({ mobility: "wheelchair", romFlags: flags({ transferChair: true }) }),
        "wheelchair_needs_transfer",
      ),
    ).toBe(false);
    expect(holds(v7({ mobility: "seated" }), "wheelchair_needs_transfer")).toBe(false);
  });

  it("sitting_balance: sit_unsupported_ask no or not sure; not asked: no with mobility bed or SCI", () => {
    for (const sitUnsupported of ["no", "unsure"] as const)
      expect(holds(v7({ romFlags: flags({ sitUnsupported }) }), "sitting_balance")).toBe(true);
    expect(
      holds(
        v7({ romFlags: flags({ sitUnsupported: "yes" }), conditions: ["sci_incomplete"] }),
        "sitting_balance",
      ),
    ).toBe(false);
    expect(holds(v7(), "sitting_balance")).toBe(false);
    expect(holds(v7({ mobility: "bed", walking: { status: "no" } }), "sitting_balance")).toBe(true);
    expect(holds(v7({ conditions: ["sci_complete"] }), "sitting_balance")).toBe(true);
  });

  it("seated_lean_gate: sitting unsupported not possible, and balance_support at home", () => {
    expect(holds(v7({ romFlags: flags({ sitUnsupported: "unsure" }) }), "seated_lean_gate")).toBe(true);
    expect(holds(v7({ restrictions: ["balance_support"] }), "seated_lean_gate")).toBe(true);
    expect(holds(v7({ conditions: ["stroke"] }), "seated_lean_gate")).toBe(false);
  });

  it("overhead_load_wheelchair_sci: mobility wheelchair or any SCI condition", () => {
    expect(holds(v7({ mobility: "wheelchair" }), "overhead_load_wheelchair_sci")).toBe(true);
    expect(holds(v7({ conditions: ["sci_incomplete"] }), "overhead_load_wheelchair_sci")).toBe(true);
    expect(
      holds(v7({ conditions: ["sci_complete"], mobility: "seated" }), "overhead_load_wheelchair_sci"),
    ).toBe(true);
    expect(holds(v7({ conditions: ["stroke"] }), "overhead_load_wheelchair_sci")).toBe(false);
  });

  it("no_active_movement: «foot_lift_ask ... 'no' means no_active_movement for the ankle»", () => {
    expect(holds(v7({ romFlags: flags({ footLift: { right: false } }) }), "no_active_movement")).toBe(true);
    expect(
      holds(v7({ romFlags: flags({ footLift: { right: true, left: true } }) }), "no_active_movement"),
    ).toBe(false);
  });

  it("never decides from the intake what only a day answer, the profile or the gait plan holds", () => {
    // pusher (pc_stroke_push), no_trunk_armrests (pc_trunk_armrests), weak_shoulder (pc_weak_shoulder),
    // the pad (gait-rules 1.3) and the prosthesis (pc_limb_leg_prosthesis) are not intake answers.
    const h = v7({
      conditions: ["stroke", "lower_limb_unilateral"],
      regions: [entry("shoulder", "right", ["weakness", "pain"])],
      walking: { status: "with_aid", aid: "cane" },
    });
    for (const id of [
      "pusher",
      "no_trunk_armrests",
      "weak_shoulder",
      "pad_not_eligible",
      "knee_hyperextension",
    ])
      expect(holds(h, id), id).toBe(false);
    expect(holds(h, "walk_not_eligible")).toBe(false);
  });
});

/* ------------------------------------------------------- profile and gait */

describe("the ids the range profile and the gait plan add (selectForTargets, E2)", () => {
  const h = v7({ conditions: ["stroke"] });

  it("weak_shoulder: the shoulder not measured for a painful or loose weaker shoulder", () => {
    expect(
      holds(
        h,
        "weak_shoulder",
        profile({ reason: "weak_shoulder", source: "not_measured_today", value: null }),
      ),
    ).toBe(true);
    expect(holds(h, "weak_shoulder", profile({}))).toBe(false);
  });

  it("no_active_movement and, after a stroke, weak_arm_no_active_shoulder", () => {
    const shoulder = profile({
      noActiveMovement: true,
      value: null,
      source: "not_measured_today",
      reason: "no_active_movement",
    });
    expect(ids(h, shoulder)).toEqual(["no_active_movement", "weak_arm_no_active_shoulder"]);
    expect(ids(v7({ conditions: ["ms"] }), shoulder)).toEqual(["no_active_movement"]);
    const knee = profile({ region: "knee", movementId: "knee_flexion", noActiveMovement: true });
    expect(ids(h, knee)).toEqual(["no_active_movement"]);
  });

  it("region_red_flag: a red flag in a region today", () => {
    const p = profile({
      region: "knee",
      movementId: "knee_flexion",
      reason: "red_flag",
      source: "not_measured_today",
      value: null,
    });
    expect(ids(h, p)).toEqual(["region_red_flag:knee"]);
  });

  it("knee_hyperextension: a measured knee past straight by 5 or more", () => {
    const knee = (value: number, source: RomProfileEntry["source"] = "measured") =>
      profile({ region: "knee", movementId: "knee_extension", kind: "lack", value, source });
    expect(holds(h, "knee_hyperextension", knee(-KNEE_PAST_STRAIGHT_GTE))).toBe(true);
    expect(holds(h, "knee_hyperextension", knee(-12))).toBe(true);
    expect(holds(h, "knee_hyperextension", knee(-4))).toBe(false);
    expect(holds(h, "knee_hyperextension", knee(10))).toBe(false);
    expect(holds(h, "knee_hyperextension", knee(-8, "default"))).toBe(false);
  });

  it("walk_not_eligible from the gait gate (gait-rules 1.1), not from the day's postponements", () => {
    const gate: GaitNotOffered[] = [
      "not_walking",
      "walk_needs_hands_on_help",
      "restriction",
      "prosthesis_off",
      "surgery_not_cleared",
      "clearance_needed",
      "global_gate",
    ];
    const day: GaitNotOffered[] = ["helper_needed", "pain_today", "red_flag"];
    for (const reason of gate)
      expect(holds(h, "walk_not_eligible", null, notOffered(reason)), reason).toBe(true);
    for (const reason of day)
      expect(holds(h, "walk_not_eligible", null, notOffered(reason)), reason).toBe(false);
    expect(holds(h, "walk_not_eligible", null, gaitPlan())).toBe(false);
  });

  it("pad_not_eligible when the pad is not allowed; standing_gate when the prosthesis was off", () => {
    expect(holds(h, "pad_not_eligible", null, gaitPlan({ padAllowed: false, modes: ["overground"] }))).toBe(
      true,
    );
    expect(holds(h, "pad_not_eligible", null, gaitPlan())).toBe(false);
    const amputee = v7({ conditions: ["lower_limb_unilateral"] });
    expect(holds(amputee, "standing_gate")).toBe(false);
    expect(holds(amputee, "standing_gate", null, notOffered("prosthesis_off"))).toBe(true);
    expect(holds(amputee, "standing_gate", null, gaitPlan())).toBe(false);
  });

  it("adds on top of the intake's ids, never takes one away", () => {
    for (const { h: x } of corpus().filter((_, i) => i % 211 === 0)) {
      const alone = v7Contraindications(x, null, null);
      const more = v7Contraindications(x, profile({ reason: "weak_shoulder" }), notOffered("prosthesis_off"));
      for (const id of alone) expect(more.has(id)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------ positions */

describe("openPositions: the forms an exercise keeps", () => {
  const open = (positions: string[], contraindications: string[], hold: string[]) =>
    openPositions({ positions, contraindications } as never, new Set(hold));

  it("closes the standing forms for standing_gate and the chair front for sitting_balance", () => {
    expect(open(["seated", "standing"], ["standing_gate"], ["standing_gate"])).toEqual(["seated"]);
    expect(open(["standing_supported"], ["standing_gate"], ["standing_gate"])).toBeNull();
    expect(
      open(["seated_forward", "standing"], ["sitting_balance", "standing_gate"], ["sitting_balance"]),
    ).toEqual(["standing"]);
    expect(
      open(
        ["seated_forward", "standing"],
        ["sitting_balance", "standing_gate"],
        ["sitting_balance", "standing_gate"],
      ),
    ).toBeNull();
  });

  it("closes the whole exercise for every other id that holds, and keeps it for ids that do not", () => {
    expect(open(["seated", "standing"], ["weak_shoulder", "standing_gate"], ["weak_shoulder"])).toBeNull();
    expect(open(["seated"], ["weak_shoulder"], ["standing_gate"])).toEqual(["seated"]);
    expect(open(["seated"], [], ["weak_shoulder"])).toEqual(["seated"]);
  });

  it("never closes for a form only id (the walking pad)", () => {
    expect(open(["standing"], ["pad_not_eligible"], ["pad_not_eligible"])).toEqual(["standing"]);
  });

  it("closes an exercise without positions for a position id", () => {
    expect(openPositions({ contraindications: ["standing_gate"] }, new Set(["standing_gate"]))).toBeNull();
    expect(openPositions({ contraindications: [] }, new Set(["standing_gate"]))).toEqual([]);
  });
});
