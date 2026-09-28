/**
 * Protocol selection (src/medical/assessment.ts) against the clinical spec 3.1 to 3.4 and 5:
 *   1. the gate: contextFromIntake with real plans and single reasons, guestContext;
 *   2. baseSelection: order, sides, exclusions, the trunk substitute, the tie to the data;
 *   3. the matrix of spec 3.3, every row and every column, through the whole pipeline
 *      (baseSelection, evaluatePrecheck, finalizeProtocol);
 *   4. finalizeProtocol on its own, and property runs over random people and answers;
 *   5. the persona protocols as a snapshot;
 *   6. re-test timing.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import {
  CLINICAL_REVIEW_REASONS,
  MIN_HOURS_BETWEEN_CHECKS,
  RETEST_DAYS,
  SCHEDULING_REVIEW_REASONS,
  baseSelection,
  baseTests,
  canStartCheck,
  contextFromIntake,
  earliestNextCheck,
  finalizeProtocol,
  guestContext,
  intakeExclusion,
  isBlocked,
  retestDue,
  sideOrder,
  type CheckContext,
  type GuestSteps,
  type ProtocolItem,
  type SelectionItem,
  type StoredSetup,
} from "../src/medical/assessment";
import { createPlan, type Intake, type Plan } from "../src/medical/plan";
import {
  evaluatePrecheck,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
} from "../src/medical/precheck";
import { NOW, baseTestsFor, ctxOf, fill, randomAnswers, randomEnv, rng } from "./precheck-fixtures";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/* ---------------------------------------------------------------- helpers */

function intakeOf(p: Partial<Intake> = {}): Intake {
  return {
    age: 50,
    conditions: ["none"],
    diagnosisNotes: "",
    medications: "",
    mobility: "seated",
    support: "none",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: ["chair", "weights"],
    goal: "habit",
    days: [1, 4],
    time: "10:00",
    sessionMinutes: 30,
    consent: true,
    ...p,
  };
}

const readyPlan = (reasons: string[] = []): Plan => ({
  status: reasons.length ? "review" : "ready",
  reasons,
  notes: [],
  exclusions: [],
  exercises: [],
  days: [1, 4],
  time: "10:00",
  warmUpMinutes: 5,
  coolDownMinutes: 5,
  estimatedMinutes: 20,
  recoveryHours: 48,
});

interface Run {
  env: PrecheckEnv;
  base: SelectionItem[];
  outcome: PrecheckOutcome;
  protocol: ProtocolItem[] | null;
}

interface RunOpts {
  setting?: "home" | "booth";
  setup?: StoredSetup | null;
  answers?: Answers;
  firstCheck?: boolean;
  sideLeanDoneAtHome?: boolean;
}

/**
 * The whole pipeline for one person. Defaults: home, a later check of the series (setup kept, the
 * side lean done at home before), benign answers for every question not given.
 */
function pipeline(ctx: CheckContext, o: RunOpts = {}): Run {
  const setting = o.setting ?? "home";
  const setup = o.setup === undefined ? {} : o.setup;
  const base = baseSelection(ctx, setting, setup);
  const firstCheck = o.firstCheck ?? false;
  const env: PrecheckEnv = {
    setting,
    ctx,
    setup,
    firstCheck,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: baseTests(base),
    sideLeanDoneAtHome: o.sideLeanDoneAtHome ?? !firstCheck,
  };
  const outcome = evaluatePrecheck(env, fill(env, o.answers ?? {}), NOW);
  const protocol =
    base.length > 0 && outcome.status === "proceed"
      ? finalizeProtocol(base, outcome, ctx, setting, setup)
      : null;
  return { env, base, outcome, protocol };
}

/** A protocol item in words: side, then skip, variant, push hand, helper, wide band, substitute. */
function describeItem(p: ProtocolItem): string {
  const parts: string[] = [p.side];
  if (p.skipped) parts.push(`skip:${p.skipped}`);
  if (p.variant) parts.push(p.variant);
  if (p.pushHand) parts.push(`push:${p.pushHand}`);
  if (p.helperRequired) parts.push("helper");
  if (p.band === "wide" && !p.skipped) parts.push("wide");
  if (p.substitute) parts.push("substitute");
  return parts.join(" ");
}

const column = (r: Run, test: TestId): string[] | string =>
  r.base.length === 0
    ? "no check"
    : r.protocol === null
      ? `${r.outcome.status}:${r.outcome.reason}`
      : r.protocol.filter((p) => p.testId === test).map(describeItem);

/** The protocol in words, one line per item in check order. */
const lines = (r: Run) =>
  r.protocol?.map((p) => `${p.order} ${p.testId} ${describeItem(p)}`) ??
  `${r.outcome.status}:${r.outcome.reason}`;

/* ------------------------------------------------------------------ gate */

describe("contextFromIntake (spec 3.1)", () => {
  it("maps the intake, mobility seated to chair", () => {
    const i = intakeOf({ support: "left", pain: ["knee"], restrictions: ["no_resistance"] });
    expect(contextFromIntake(i, createPlan(i))).toEqual({
      position: "chair",
      support: "left",
      pain: ["knee"],
      restrictions: ["no_resistance"],
      conditions: ["none"],
      clearance: "yes",
    });
    for (const [mobility, position] of [
      ["wheelchair", "wheelchair"],
      ["standing", "standing"],
    ] as const) {
      const w = intakeOf({ mobility });
      expect(contextFromIntake(w, createPlan(w))).toMatchObject({ position });
    }
  });

  it("does not share arrays with the intake", () => {
    const i = intakeOf({ pain: ["hip"] });
    const ctx = contextFromIntake(i, createPlan(i)) as CheckContext;
    ctx.pain.push("knee");
    expect(i.pain).toEqual(["hip"]);
  });

  const clinical: [string, Partial<Intake>, string][] = [
    ["mobility bed", { mobility: "bed" }, "unsupported_position"],
    ["cardiac", { conditions: ["cardiac"] }, "cardiac"],
    ["warning symptoms yes", { symptoms: "yes" }, "symptoms"],
    ["recent change yes", { recentChange: "yes" }, "recent_change"],
    ["no_exercise", { restrictions: ["no_exercise"] }, "restriction"],
    ["other", { conditions: ["other"] }, "unknown_condition"],
    ["cfs_moderate", { conditions: ["cfs_moderate"] }, "pem"],
    ["stroke, clearance no", { conditions: ["stroke"], clearance: "no" }, "clearance"],
    ["stroke, clearance unsure", { conditions: ["stroke"], clearance: "unsure" }, "clearance"],
    ["sci_complete, clearance no", { conditions: ["sci_complete"], clearance: "no" }, "clearance"],
    [
      "sci_incomplete, clearance unsure",
      { conditions: ["sci_incomplete"], clearance: "unsure" },
      "clearance",
    ],
  ];

  it.each(clinical)("blocks %s with a real plan", (_, over, reason) => {
    const i = intakeOf(over);
    const plan = createPlan(i);
    expect(plan.reasons).toContain(reason);
    expect(contextFromIntake(i, plan)).toEqual({ blocked: reason });
  });

  it.each(clinical)("blocks %s from the intake alone, when the plan is older", (_, over, reason) => {
    expect(contextFromIntake(intakeOf(over), readyPlan())).toEqual({ blocked: reason });
  });

  it.each(CLINICAL_REVIEW_REASONS.map((r) => [r]))("blocks the plan reason %s", (reason) => {
    expect(contextFromIntake(intakeOf(), readyPlan([reason]))).toEqual({ blocked: reason });
  });

  it("never blocks on the scheduling reasons (Q20)", () => {
    expect(contextFromIntake(intakeOf(), readyPlan([...SCHEDULING_REVIEW_REASONS]))).toMatchObject({
      position: "chair",
    });
    // Real plans: upper limb loss seated has no exercises; stroke standing in 20 minutes runs over
    // the session length. (recovery is covered by the synthetic plan above.)
    const cases: [Partial<Intake>, string][] = [
      [{ conditions: ["upper_limb_unilateral"] }, "no_exercises"],
      [{ conditions: ["stroke"], mobility: "standing", sessionMinutes: 20 }, "duration"],
    ];
    for (const [over, reason] of cases) {
      const i = intakeOf(over);
      expect(createPlan(i).reasons).toEqual([reason]);
      expect(isBlocked(contextFromIntake(i, createPlan(i)))).toBe(false);
    }
  });

  it("clearance yes opens the check for stroke and SCI; conditions that need no clearance pass any answer", () => {
    for (const c of ["stroke", "sci_complete", "sci_incomplete"]) {
      const i = intakeOf({ conditions: [c], clearance: "yes" });
      expect(isBlocked(contextFromIntake(i, createPlan(i)))).toBe(false);
    }
    for (const c of ["ms", "parkinsons", "arthritis", "cerebral_palsy", "lower_limb_unilateral"]) {
      const i = intakeOf({ conditions: [c], clearance: "unsure" });
      expect(contextFromIntake(i, createPlan(i))).toMatchObject({ clearance: "unsure" });
    }
  });

  it("reports the first reason in the order of spec 3.1, the plan's unknown reasons after", () => {
    const i = intakeOf({ conditions: ["cardiac", "other"], symptoms: "yes" });
    expect(contextFromIntake(i, createPlan(i))).toEqual({ blocked: "cardiac" });
    expect(contextFromIntake(intakeOf(), readyPlan(["duration", "something_new"]))).toEqual({
      blocked: "something_new",
    });
  });

  it("blocks a plan in review without any reason, and an intake outside the allowed values", () => {
    expect(contextFromIntake(intakeOf(), { ...readyPlan(), status: "review" })).toEqual({
      blocked: "review",
    });
    const bad = [
      { conditions: ["flu"] },
      { pain: ["ankle"] },
      { restrictions: ["no_running"] },
      { support: "both" },
      { clearance: "maybe" },
      { pain: ["hip", "hip"] },
    ] as unknown as Partial<Intake>[];
    for (const over of bad) {
      expect(contextFromIntake(intakeOf(over), readyPlan())).toEqual({ blocked: "invalid_input" });
    }
  });

  it("the data's gate prose names exactly these reasons", () => {
    for (const r of [...CLINICAL_REVIEW_REASONS, ...SCHEDULING_REVIEW_REASONS]) {
      expect(CHECK_DATA.selection.gate).toContain(r);
    }
  });
});

describe("guestContext (booth guest steps, Q19)", () => {
  const steps = (p: Partial<GuestSteps> = {}): GuestSteps => ({
    position: "chair",
    support: "none",
    pain: [],
    restrictions: [],
    conditions: [],
    ...p,
  });

  it("Q19 (2): a skipped clearance answer counts as not sure; no condition is none", () => {
    expect(guestContext(steps({ position: "standing", support: "right", pain: ["knee"] }))).toEqual({
      position: "standing",
      support: "right",
      pain: ["knee"],
      restrictions: [],
      conditions: ["none"],
      clearance: "unsure",
    });
  });

  it.each([
    [{ conditions: ["cardiac"] }, "cardiac"],
    [{ conditions: ["other"] }, "unknown_condition"],
    [{ conditions: ["cfs_moderate"] }, "pem"],
    [{ restrictions: ["no_exercise"] }, "restriction"],
    [{ position: "bed" }, "unsupported_position"],
  ] as [Partial<GuestSteps>, string][])("Q19 (5a): blocks %o: %s", (over, reason) => {
    expect(guestContext(steps(over))).toEqual({ blocked: reason });
  });

  it.each([["stroke"], ["sci_complete"], ["sci_incomplete"]])(
    "Q19 (5b): %s without clearance yes is not blocked: the booth arm raise only",
    (condition) => {
      const ctx = guestContext(steps({ conditions: [condition] }));
      expect(ctx).toMatchObject({ conditions: [condition], clearance: "unsure" });
      expect(baseTests(baseSelection(ctx as CheckContext, "booth", null))).toEqual(["shoulder_abduction"]);
    },
  );

  it("refuses answers outside the allowed values", () => {
    for (const over of [
      { position: "sofa" },
      { support: "both" },
      { pain: ["ankle"] },
      { restrictions: ["x"] },
      { conditions: ["none", "ms"] },
      { conditions: ["ms", "ms"] },
    ] as unknown as Partial<GuestSteps>[]) {
      expect(guestContext(steps(over))).toEqual({ blocked: "invalid_input" });
    }
  });

  it("a standing guest gets the chair stand at the booth (after the staff vitals), arm curls without weight", () => {
    const ctx = guestContext(steps({ position: "standing" })) as CheckContext;
    const r = pipeline(ctx, { setting: "booth", setup: null, firstCheck: true });
    expect(lines(r)).toEqual([
      "1 shoulder_abduction right",
      "2 shoulder_abduction left",
      "3 chair_stand_30s none standard",
      "4 arm_curl_30s right arm_only",
      "5 arm_curl_30s left arm_only",
    ]);
  });
});

/* ------------------------------------------------------- base selection */

describe("baseSelection (spec 3.2 to 3.4)", () => {
  it("follows the fixed order of each position in the data", () => {
    for (const position of ["chair", "wheelchair", "standing"] as const) {
      const items = baseSelection(ctxOf({ position }), "home", null);
      const runs = baseTests(items);
      expect(runs).toEqual(CHECK_DATA.selection.basePerPosition[position]);
      expect(items.map((i) => i.order)).toEqual(items.map((_, n) => n + 1));
      for (const i of items) expect(i.version).toBe(1);
    }
  });

  it("orders the sides per test (spec 3.4)", () => {
    const order = (support: "none" | "left" | "right") =>
      ["shoulder_abduction", "arm_curl_30s", "trunk_control_seated", "chair_stand_30s"].map((t) =>
        sideOrder(t as TestId, support).join(" "),
      );
    // abduction stronger first, arm curl weaker first, lean toward the stronger side first.
    expect(order("none")).toEqual(["right left", "right left", "right left", "none"]);
    expect(order("left")).toEqual(["right left", "left right", "right left", "none"]);
    expect(order("right")).toEqual(["left right", "right left", "left right", "none"]);
  });

  it("lists the limb loss side of the stored setup as limb_loss_arm, in its place", () => {
    const items = baseSelection(ctxOf({ conditions: ["upper_limb_unilateral"] }), "home", {
      limbLoss: { arm: "right" },
    });
    expect(items.filter((i) => i.excluded).map((i) => `${i.testId} ${i.side} ${i.excluded}`)).toEqual([
      "shoulder_abduction right limb_loss_arm",
      "arm_curl_30s right limb_loss_arm",
      "chair_stand_30s none position_seated",
    ]);
    expect(baseTests(items)).toEqual(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"]);
  });

  it("puts the substitute side lean in the chair stand slot", () => {
    const items = baseSelection(ctxOf({ position: "standing", pain: ["knee"] }), "home", null);
    expect(items.map((i) => `${i.order} ${i.testId} ${i.side}${i.excluded ? ` ${i.excluded}` : ""}`)).toEqual(
      [
        "1 shoulder_abduction right",
        "2 shoulder_abduction left",
        "3 chair_stand_30s none pain_area",
        "4 trunk_control_seated right",
        "5 trunk_control_seated left",
        "6 arm_curl_30s right",
        "7 arm_curl_30s left",
      ],
    );
    expect(items.filter((i) => i.substitute).length).toBe(2);
  });

  it("a leg limb loss side in the setup excludes the chair stand even without the intake key", () => {
    const ctx = ctxOf({ position: "standing" });
    expect(intakeExclusion("chair_stand_30s", ctx, "home", { limbLoss: { leg: "left" } })).toBe(
      "limb_loss_leg",
    );
    expect(intakeExclusion("chair_stand_30s", ctx, "home", null)).toBeUndefined();
  });

  it("shows the first exclusion in the row order of the matrix", () => {
    const ctx = ctxOf({
      position: "standing",
      pain: ["knee"],
      restrictions: ["no_weight_bearing", "balance_support"],
      conditions: ["lower_limb_unilateral"],
      clearance: "no",
    });
    expect(intakeExclusion("chair_stand_30s", ctx, "home", null)).toBe("pain_area");
    expect(intakeExclusion("chair_stand_30s", { ...ctx, pain: [] }, "home", null)).toBe(
      "restriction_weight_bearing",
    );
    expect(intakeExclusion("chair_stand_30s", { ...ctx, pain: [], restrictions: [] }, "home", null)).toBe(
      "clearance",
    );
    expect(intakeExclusion("chair_stand_30s", { ...ctx, pain: [], restrictions: [] }, "booth", null)).toBe(
      "limb_loss_leg",
    );
  });

  it("every intake exclusion key of the data has a reason here (no key without a reason)", () => {
    const blocked = ["no_exercise", "cardiac", "other", "cfs_moderate"];
    for (const t of CHECK_DATA.tests) {
      const ex = t.exclusions;
      const cases: Partial<CheckContext>[] = [
        ...ex.pain.map((p) => ({ pain: [p] })),
        ...ex.restrictions.filter((r) => !blocked.includes(r)).map((r) => ({ restrictions: [r] })),
        ...ex.conditions.filter((c) => !blocked.includes(c)).map((c) => ({ conditions: [c] })),
        ...(ex.homeOnlyExclusion?.restrictions ?? []).map((r) => ({ restrictions: [r] })),
        ...(ex.homeOnlyExclusion?.clearance ?? []).map((c) => ({ clearance: c })),
      ];
      for (const over of cases) {
        expect(intakeExclusion(t.id, ctxOf({ position: "standing", ...over }), "home", null)).toBeDefined();
      }
      // Arm limb loss is per side, set from the setup (baseSelection) or the pre-check.
      expect(ex.limbLoss.filter((l) => l !== "arm" && l !== "leg")).toEqual([]);
    }
  });

  it("no check context, no items", () => {
    for (const over of [
      { restrictions: ["no_exercise"] },
      { conditions: ["cardiac"] },
      { conditions: ["other"] },
      { conditions: ["cfs_moderate"] },
      { conditions: ["stroke"], clearance: "unsure" as const },
    ]) {
      expect(baseSelection(ctxOf(over), "home", null)).toEqual([]);
    }
  });

  it("equals the pre-check tests' own stand in for every context that gets a check", () => {
    const r = rng(20260927);
    let compared = 0;
    for (let n = 0; n < 600; n++) {
      const env = randomEnv(r);
      const items = baseSelection(env.ctx, env.setting, null);
      if (items.length === 0) continue;
      compared++;
      expect(baseTests(items)).toEqual(baseTestsFor(env.ctx, env.setting));
    }
    expect(compared).toBeGreaterThan(300);
  });
});

/* ---------------------------------------------------------- the matrix */

/**
 * Spec 3.3, one case per row (and per variant of a row where the row names several), with the
 * expected items of every column. The first three columns run for a seated person (chair unless the
 * row says otherwise), the chair stand column for a standing person, where the substitute side lean
 * is listed too. "postpone:pain" and "no check" are the whole check.
 */
interface MatrixRow {
  row: string;
  ctx?: Partial<CheckContext>;
  seated?: "chair" | "wheelchair";
  /** Every column from one person (the mobility rows). */
  only?: "chair" | "wheelchair" | "standing";
  opts?: RunOpts;
  /** Extra answers for the standing person only (for example hands allowed). */
  standingAnswers?: Answers;
  abd: string[] | string;
  curl: string[] | string;
  trunk: string[] | string;
  chair: string[] | string;
}

const NONE_AB = ["right", "left"];
const HANDS = { pc_stand_no_hands: "no" };

const MATRIX: MatrixRow[] = [
  {
    row: "mobility seated",
    only: "chair",
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:position_seated"],
  },
  {
    row: "mobility wheelchair",
    only: "wheelchair",
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:position_seated"],
  },
  {
    row: "mobility standing (arm tests done seated, the side lean only as a substitute)",
    only: "standing",
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: [],
    chair: ["none standard"],
  },
  {
    row: "support none",
    abd: ["right", "left"],
    curl: ["right", "left"],
    trunk: ["right", "left"],
    chair: ["none standard"],
  },
  {
    row: "support left",
    ctx: { support: "left" },
    abd: ["right", "left wide"],
    curl: ["left", "right"],
    trunk: ["right", "left"],
    chair: ["none standard"],
  },
  {
    row: "support right",
    ctx: { support: "right" },
    abd: ["left", "right wide"],
    curl: ["right", "left"],
    trunk: ["left", "right"],
    chair: ["none standard"],
  },
  {
    row: "support left, pc_weak_lift no",
    ctx: { support: "left" },
    opts: { answers: { pc_weak_lift: "no" } },
    abd: ["right", "left skip:arm_not_able"],
    curl: ["left skip:arm_not_able", "right"],
    trunk: ["right", "left"],
    chair: ["none standard"],
  },
  {
    row: "support left, pc_weak_shoulder yes (hands allowed stands push with the stronger hand)",
    ctx: { support: "left" },
    opts: { answers: { pc_weak_shoulder: "yes" } },
    standingAnswers: HANDS,
    abd: ["right", "left skip:weak_shoulder"],
    curl: ["left arm_only", "right"],
    trunk: ["right", "left"],
    chair: ["none arms_assisted push:right helper"],
  },
  {
    row: "pain shoulder (right side)",
    ctx: { pain: ["shoulder"] },
    opts: { answers: { "pc_arm_pain_side:shoulder": "right" } },
    standingAnswers: HANDS,
    abd: NONE_AB,
    curl: ["right arm_only", "left"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:left helper"],
  },
  {
    row: "pain elbow (left side)",
    ctx: { pain: ["elbow"] },
    opts: { answers: { "pc_arm_pain_side:elbow": "left" } },
    standingAnswers: HANDS,
    abd: NONE_AB,
    curl: ["right", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:right helper"],
  },
  {
    row: "pain wrist (both sides: the hands allowed stand has no hand to push with)",
    ctx: { pain: ["wrist"] },
    opts: { answers: { "pc_arm_pain_side:wrist": "both" } },
    standingAnswers: HANDS,
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none skip:pain_area"],
  },
  {
    row: "pain back",
    ctx: { pain: ["back"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:pain_area", "left skip:pain_area"],
    chair: ["none skip:pain_area"],
  },
  {
    row: "pain hip",
    ctx: { pain: ["hip"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:pain_area", "right substitute", "left substitute"],
  },
  {
    row: "pain knee",
    ctx: { pain: ["knee"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:pain_area", "right substitute", "left substitute"],
  },
  {
    row: "today area score 6, right shoulder",
    opts: { answers: { pc_pain_now: 6, pc_pain_areas: { shoulder_right: 6 } } },
    standingAnswers: HANDS,
    abd: ["right skip:pain_today", "left"],
    curl: ["right skip:pain_today", "left"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:left helper"],
  },
  {
    row: "today area score 6, back",
    opts: { answers: { pc_pain_now: 6, pc_pain_areas: { back: 6 } } },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:pain_today", "left skip:pain_today"],
    chair: ["none skip:pain_today"],
  },
  {
    row: "today area score 6, hip",
    opts: { answers: { pc_pain_now: 6, pc_pain_areas: { hip: 6 } } },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:pain_today", "left skip:pain_today"],
    chair: ["none skip:pain_today"],
  },
  {
    row: "today area score 6, knee (no substitute for a same day skip)",
    opts: { answers: { pc_pain_now: 6, pc_pain_areas: { knee: 6 } } },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:pain_today"],
  },
  {
    row: "today area score 6, both wrists (hands allowed stand: skip)",
    opts: { answers: { pc_pain_now: 6, pc_pain_areas: { wrist_left: 6, wrist_right: 6 } } },
    standingAnswers: HANDS,
    abd: NONE_AB,
    curl: ["right skip:pain_today", "left skip:pain_today"],
    trunk: NONE_AB,
    chair: ["none skip:pain_today"],
  },
  {
    row: "today area score 7 in an area a selected test loads",
    opts: { answers: { pc_pain_now: 7, pc_pain_areas: { shoulder_left: 7 } } },
    abd: "postpone:pain",
    curl: "postpone:pain",
    trunk: "postpone:pain",
    chair: "postpone:pain",
  },
  {
    row: "surgery not cleared, right shoulder",
    opts: {
      answers: {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": ["shoulder_right"],
        "pc_surgery_recent:shoulder_right": "no",
      },
    },
    standingAnswers: HANDS,
    abd: ["right skip:recent_surgery", "left"],
    curl: ["right skip:recent_surgery", "left"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:left helper"],
  },
  {
    row: "surgery not cleared, chest or belly",
    opts: {
      answers: {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": ["chest_belly"],
        "pc_surgery_recent:chest_belly": "no",
      },
    },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: ["right skip:recent_surgery", "left skip:recent_surgery"],
    chair: ["none skip:recent_surgery"],
  },
  {
    row: "surgery not cleared, spine",
    opts: {
      answers: {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": ["spine"],
        "pc_surgery_recent:spine": "no",
      },
    },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:recent_surgery", "left skip:recent_surgery"],
    chair: ["none skip:recent_surgery"],
  },
  {
    row: "surgery not cleared, knee",
    opts: {
      answers: {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": ["knee"],
        "pc_surgery_recent:knee": "no",
      },
    },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:recent_surgery"],
  },
  {
    row: "surgery cleared by the surgeon: no change",
    opts: {
      answers: {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": ["hip"],
        "pc_surgery_recent:hip": "yes",
      },
    },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none standard"],
  },
  {
    row: "no_overhead",
    ctx: { restrictions: ["no_overhead"] },
    abd: ["right skip:restriction_overhead", "left skip:restriction_overhead"],
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none standard"],
  },
  {
    row: "no_resistance",
    ctx: { restrictions: ["no_resistance"] },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none standard"],
  },
  {
    row: "no_weight_bearing",
    ctx: { restrictions: ["no_weight_bearing"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:restriction_weight_bearing", "right substitute", "left substitute"],
  },
  {
    row: "balance_support at home",
    ctx: { restrictions: ["balance_support"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:restriction_balance", "left skip:restriction_balance"],
    chair: ["none skip:restriction_balance"],
  },
  {
    row: "balance_support at the booth (side lean staff guarded, substitute at the booth only; Q5 no weight)",
    ctx: { restrictions: ["balance_support"] },
    opts: { setting: "booth" },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none skip:restriction_balance", "right substitute", "left substitute"],
  },
  {
    row: "no_exercise",
    ctx: { restrictions: ["no_exercise"] },
    abd: "no check",
    curl: "no check",
    trunk: "no check",
    chair: "no check",
  },
  {
    row: "clearance no at home",
    ctx: { clearance: "no" },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none skip:clearance", "right substitute", "left substitute"],
  },
  {
    row: "clearance unsure at the booth (after the staff vitals)",
    ctx: { clearance: "unsure" },
    opts: { setting: "booth" },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none standard"],
  },
  {
    row: "clearance unsure at the booth, vitals above the Q21 limits",
    ctx: { clearance: "unsure" },
    opts: {
      setting: "booth",
      answers: {
        pc_booth_vitals: {
          systolic1: 130,
          diastolic1: 80,
          systolic2: 130,
          diastolic2: 80,
          restingHeartRate: 121,
          irregularHeartbeat: false,
        },
      },
    },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none skip:booth_vitals"],
  },
  {
    row: "clearance unsure at the booth, no validated cuff (O47 (4): clearance_booth)",
    ctx: { clearance: "unsure" },
    opts: { setting: "booth", answers: { pc_booth_vitals: "unavailable" } },
    abd: NONE_AB,
    curl: ["right arm_only", "left arm_only"],
    trunk: NONE_AB,
    chair: ["none skip:clearance_booth"],
  },
  {
    row: "Q19 (5b): booth, stroke with clearance no: the seated arm raise only",
    ctx: { conditions: ["stroke"], clearance: "no" },
    opts: { setting: "booth" },
    abd: ["right wide", "left wide"],
    curl: ["right skip:clearance_booth", "left skip:clearance_booth"],
    trunk: ["right skip:clearance_booth", "left skip:clearance_booth"],
    chair: ["none skip:clearance_booth"],
  },
  {
    row: "Q19 (5b): booth, SCI with clearance not sure: the seated arm raise only",
    ctx: { conditions: ["sci_incomplete"], clearance: "unsure" },
    opts: { setting: "booth", answers: { pc_sci_level: "no" } },
    abd: ["right wide", "left wide"],
    curl: ["right skip:clearance_booth", "left skip:clearance_booth"],
    trunk: ["right skip:clearance_booth", "left skip:clearance_booth"],
    chair: ["none skip:clearance_booth"],
  },
  {
    row: "upper_limb_unilateral, left",
    ctx: { conditions: ["upper_limb_unilateral"] },
    opts: { answers: { pc_limb_arm_side: "left" } },
    abd: ["right", "left skip:limb_loss_arm"],
    curl: ["right", "left skip:limb_loss_arm"],
    trunk: NONE_AB,
    chair: ["none one_arm_cross"],
  },
  {
    row: "lower_limb_unilateral",
    ctx: { conditions: ["lower_limb_unilateral"] },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: NONE_AB,
    chair: ["none skip:limb_loss_leg", "right substitute", "left substitute"],
  },
  {
    row: "stroke, weaker right side",
    ctx: { conditions: ["stroke"], support: "right" },
    abd: ["left wide", "right wide"],
    curl: ["right arm_only", "left"],
    trunk: ["left helper", "right helper"],
    chair: ["none arms_assisted helper"],
  },
  {
    row: "stroke, pusher behaviour",
    ctx: { conditions: ["stroke"], support: "right" },
    opts: { answers: { pc_stroke_push: "yes" } },
    abd: ["left wide", "right wide"],
    curl: ["right arm_only", "left"],
    trunk: ["left skip:pusher", "right skip:pusher"],
    chair: ["none arms_assisted helper"],
  },
  {
    row: "stroke without a declared weaker side (helper at home always)",
    ctx: { conditions: ["stroke"] },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right helper", "left helper"],
    chair: ["none standard helper"],
  },
  {
    row: "ms",
    ctx: { conditions: ["ms"] },
    abd: ["right wide", "left wide"],
    curl: ["right wide", "left wide"],
    trunk: ["right helper", "left helper"],
    chair: ["none standard wide"],
  },
  {
    row: "ms with a walking aid",
    ctx: { conditions: ["ms"] },
    standingAnswers: { pc_walking_aid: "yes" },
    abd: ["right wide", "left wide"],
    curl: ["right wide", "left wide"],
    trunk: ["right helper", "left helper"],
    chair: ["none arms_assisted_steady helper wide"],
  },
  {
    row: "cerebral_palsy",
    ctx: { conditions: ["cerebral_palsy"] },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right helper wide", "left helper wide"],
    chair: ["none arms_assisted helper"],
  },
  {
    row: "sci_complete",
    ctx: { conditions: ["sci_complete"] },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right helper", "left helper"],
    chair: ["none skip:position_seated", "right helper substitute", "left helper substitute"],
  },
  {
    row: "sci_complete, right hand cannot hold, left elbow cannot bend",
    ctx: { conditions: ["sci_complete"] },
    opts: { answers: { "pc_arm_function:right": "bend_no_hold", "pc_arm_function:left": "no_bend" } },
    abd: ["right wide", "left wide"],
    curl: ["right cuff_or_arm_only", "left skip:arm_not_able"],
    trunk: ["right helper", "left helper"],
    chair: ["none skip:position_seated", "right helper substitute", "left helper substitute"],
  },
  {
    row: "sci_complete, pressure sore",
    ctx: { conditions: ["sci_complete"] },
    opts: { answers: { pc_pressure_sore: "yes" } },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right skip:pressure_sore", "left skip:pressure_sore"],
    chair: [
      "none skip:position_seated",
      "right skip:pressure_sore substitute",
      "left skip:pressure_sore substitute",
    ],
  },
  {
    row: "sci_complete, cannot sit unsupported (booth only at home)",
    ctx: { conditions: ["sci_complete"] },
    opts: { answers: { pc_sit_unsupported: "no" } },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right skip:booth_only_trunk", "left skip:booth_only_trunk"],
    chair: [
      "none skip:position_seated",
      "right skip:booth_only_trunk substitute",
      "left skip:booth_only_trunk substitute",
    ],
  },
  {
    row: "sci_incomplete",
    ctx: { conditions: ["sci_incomplete"] },
    abd: ["right wide", "left wide"],
    curl: NONE_AB,
    trunk: ["right helper", "left helper"],
    chair: ["none arms_assisted helper"],
  },
  {
    row: "parkinsons",
    ctx: { conditions: ["parkinsons"] },
    abd: ["right wide", "left wide"],
    curl: ["right wide", "left wide"],
    trunk: ["right helper wide", "left helper wide"],
    chair: ["none standard helper"],
  },
  {
    row: "arthritis with wrist pain on the right (wide curl band on that arm)",
    ctx: { conditions: ["arthritis"], pain: ["wrist"] },
    opts: { answers: { "pc_arm_pain_side:wrist": "right" } },
    standingAnswers: HANDS,
    abd: NONE_AB,
    curl: ["right arm_only wide", "left"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:left helper"],
  },
  {
    row: "arthritis, hip flare",
    ctx: { conditions: ["arthritis"] },
    opts: { answers: { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": ["hip"] } },
    abd: NONE_AB,
    curl: NONE_AB,
    trunk: ["right skip:flare", "left skip:flare"],
    chair: ["none skip:flare"],
  },
  {
    row: "arthritis, left shoulder flare",
    ctx: { conditions: ["arthritis"] },
    opts: { answers: { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": ["shoulder_left"] } },
    standingAnswers: HANDS,
    abd: ["right", "left skip:flare"],
    curl: ["right", "left skip:flare"],
    trunk: NONE_AB,
    chair: ["none arms_assisted push:right helper"],
  },
  {
    row: "cfs_moderate",
    ctx: { conditions: ["cfs_moderate"] },
    abd: "no check",
    curl: "no check",
    trunk: "no check",
    chair: "no check",
  },
  {
    row: "cardiac",
    ctx: { conditions: ["cardiac"] },
    abd: "no check",
    curl: "no check",
    trunk: "no check",
    chair: "no check",
  },
  {
    row: "other",
    ctx: { conditions: ["other"] },
    abd: "no check",
    curl: "no check",
    trunk: "no check",
    chair: "no check",
  },
  {
    row: "setting booth: booth only side lean answers are allowed with staff, no helper question",
    ctx: { conditions: ["ms"] },
    opts: { setting: "booth", answers: { pc_sit_unsupported: "no", pc_fall_sitting: "yes" } },
    abd: ["right wide", "left wide"],
    curl: ["right arm_only wide", "left arm_only wide"],
    trunk: NONE_AB,
    chair: ["none standard wide"],
  },
  {
    row: "setting booth: pusher behaviour is still excluded",
    ctx: { conditions: ["stroke"], support: "left" },
    opts: { setting: "booth", answers: { pc_stroke_push: "yes" } },
    abd: ["right wide", "left wide"],
    curl: ["left arm_only", "right arm_only"],
    trunk: ["right skip:pusher", "left skip:pusher"],
    chair: ["none arms_assisted"],
  },
];

describe("spec 3.3 matrix, every row and column", () => {
  it.each(MATRIX.map((m) => [m.row, m]))("%s", (_, m) => {
    if (m.only) {
      const r = pipeline(ctxOf({ position: m.only, ...m.ctx }), m.opts);
      expect({
        abd: column(r, "shoulder_abduction"),
        curl: column(r, "arm_curl_30s"),
        trunk: column(r, "trunk_control_seated"),
        chair: column(r, "chair_stand_30s"),
      }).toEqual({ abd: m.abd, curl: m.curl, trunk: m.trunk, chair: m.chair });
      return;
    }
    const seated = pipeline(ctxOf({ position: m.seated ?? "chair", ...m.ctx }), m.opts);
    const standing = pipeline(ctxOf({ position: "standing", ...m.ctx }), {
      ...m.opts,
      answers: { ...m.opts?.answers, ...m.standingAnswers },
    });
    const chair = (): string[] | string => {
      const c = column(standing, "chair_stand_30s");
      if (typeof c === "string") return c;
      const subs = standing.protocol!.filter((p) => p.substitute).map(describeItem);
      return [...c, ...subs];
    };
    const seatedChair = column(seated, "chair_stand_30s");
    expect({
      abd: column(seated, "shoulder_abduction"),
      curl: column(seated, "arm_curl_30s"),
      trunk: column(seated, "trunk_control_seated"),
      chair: chair(),
    }).toEqual({ abd: m.abd, curl: m.curl, trunk: m.trunk, chair: m.chair });
    // Seated people are never offered the chair stand (position_seated).
    if (Array.isArray(seatedChair)) expect(seatedChair).toEqual(["none skip:position_seated"]);
    // Standing people do the arm tests seated, in the same form as seated people.
    if (Array.isArray(m.abd) && m.seated === undefined) {
      expect(column(standing, "shoulder_abduction")).toEqual(m.abd);
    }
  });

  it("covers every intake key of the matrix at least once", () => {
    const keys = new Set<string>();
    for (const m of MATRIX) {
      for (const v of [
        ...(m.ctx?.pain ?? []),
        ...(m.ctx?.restrictions ?? []),
        ...(m.ctx?.conditions ?? []),
      ]) {
        keys.add(v);
      }
      if (m.ctx?.clearance) keys.add(`clearance:${m.ctx.clearance}`);
      if (m.ctx?.support) keys.add(`support:${m.ctx.support}`);
      if (m.opts?.setting) keys.add(`setting:${m.opts.setting}`);
    }
    for (const k of [
      "shoulder",
      "elbow",
      "wrist",
      "back",
      "hip",
      "knee",
      "no_overhead",
      "no_resistance",
      "no_weight_bearing",
      "balance_support",
      "no_exercise",
      "clearance:no",
      "clearance:unsure",
      "upper_limb_unilateral",
      "lower_limb_unilateral",
      "stroke",
      "ms",
      "cerebral_palsy",
      "sci_complete",
      "sci_incomplete",
      "parkinsons",
      "arthritis",
      "cfs_moderate",
      "cardiac",
      "other",
      "support:left",
      "support:right",
      "setting:booth",
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });
});

/* ------------------------------------------------------ finalizeProtocol */

describe("finalizeProtocol", () => {
  it("needs a proceed outcome", () => {
    const r = pipeline(ctxOf(), { answers: { pc_unwell: "yes" } });
    expect(r.outcome.status).toBe("postpone");
    expect(() => finalizeProtocol(r.base, r.outcome, ctxOf(), "home", {})).toThrow(RangeError);
  });

  it("never adds a substitute for a day level skip", () => {
    const ms = ctxOf({ position: "standing", conditions: ["ms"] });
    const r = pipeline(ms, { answers: { pc_walking_aid: "yes", "pc_helper:chair_stand_30s": "no" } });
    expect(lines(r)).toEqual([
      "1 shoulder_abduction right wide",
      "2 shoulder_abduction left wide",
      "3 chair_stand_30s none skip:helper_needed",
      "4 arm_curl_30s right wide",
      "5 arm_curl_30s left wide",
    ]);
  });

  it("applies a limb loss side answered today (setupUpdates) even when the outcome did not list it", () => {
    const ctx = ctxOf({ conditions: ["upper_limb_unilateral"] });
    const base = baseSelection(ctx, "home", null);
    const outcome: PrecheckOutcome = {
      status: "proceed",
      skips: [],
      variants: [],
      helperRequired: [],
      warnings: [],
      setupUpdates: { limbLoss: { arm: "right" } },
      stored: {},
    };
    const p = finalizeProtocol(base, outcome, ctx, "home", null);
    expect(p.filter((i) => i.skipped).map((i) => `${i.testId} ${i.side} ${i.skipped}`)).toEqual([
      "shoulder_abduction right limb_loss_arm",
      "arm_curl_30s right limb_loss_arm",
      "chair_stand_30s none position_seated",
    ]);
  });

  it("keeps the intake reason of an excluded item, and a skipped item carries no variant or helper", () => {
    const ctx = ctxOf({ position: "standing", conditions: ["parkinsons"], pain: ["back"] });
    const r = pipeline(ctx);
    const chair = r.protocol!.find((p) => p.testId === "chair_stand_30s")!;
    expect(chair).toEqual({
      testId: "chair_stand_30s",
      side: "none",
      version: 1,
      order: 3,
      band: "default",
      skipped: "pain_area",
    });
  });

  it("asks for a helper only at home", () => {
    const pd = ctxOf({ position: "standing", conditions: ["parkinsons"] });
    const outcome: PrecheckOutcome = {
      status: "proceed",
      skips: [],
      variants: [],
      helperRequired: ["chair_stand_30s"],
      warnings: [],
      setupUpdates: {},
      stored: {},
    };
    const base = baseSelection(pd, "booth", null);
    expect(finalizeProtocol(base, outcome, pd, "booth", null).some((p) => p.helperRequired)).toBe(false);
    expect(finalizeProtocol(base, outcome, pd, "home", null).some((p) => p.helperRequired)).toBe(true);
  });

  it("first home side lean needs a helper for everyone", () => {
    const r = pipeline(ctxOf(), { firstCheck: true, setup: null });
    expect(column(r, "trunk_control_seated")).toEqual(["right helper", "left helper"]);
  });

  it("property: the protocol keeps the base items and never runs what the outcome skips", () => {
    const r = rng(9271);
    let proceeded = 0;
    for (let n = 0; n < 500; n++) {
      const env0 = randomEnv(r);
      const base = baseSelection(env0.ctx, env0.setting, env0.setup);
      const env: PrecheckEnv = { ...env0, baseTests: baseTests(base) };
      const outcome = evaluatePrecheck(env, randomAnswers(r, env), NOW);
      if (outcome.status !== "proceed") continue;
      proceeded++;
      const p = finalizeProtocol(base, outcome, env.ctx, env.setting, env.setup);
      expect(p.map((i) => [i.testId, i.side, i.order])).toEqual(base.map((i) => [i.testId, i.side, i.order]));
      for (const s of outcome.skips) {
        expect(p.find((i) => i.testId === s.testId && i.side === s.side)?.skipped).toBeDefined();
      }
      for (const i of p) {
        if (i.substitute)
          expect(base.find((b) => b.testId === i.testId && b.side === i.side)?.substitute).toBe(true);
        if (i.skipped) expect(i.variant ?? i.helperRequired ?? i.pushHand).toBeUndefined();
        if (i.testId === "chair_stand_30s" && !i.skipped) expect(i.variant).toBeDefined();
        if (env.setting === "booth") expect(i.helperRequired).toBeUndefined();
      }
      // At most three tests run, and never both the side lean and the chair stand.
      const running = new Set(p.filter((i) => !i.skipped).map((i) => i.testId));
      expect(running.size).toBeLessThanOrEqual(3);
      expect(running.has("trunk_control_seated") && running.has("chair_stand_30s")).toBe(false);
    }
    expect(proceeded).toBeGreaterThan(100);
  });
});

/* --------------------------------------------------------------- personas */

describe("persona protocols", () => {
  it("Faisal, 58, stroke, weaker right side, wheelchair, first check", () => {
    const r = pipeline(ctxOf({ position: "wheelchair", support: "right", conditions: ["stroke"] }), {
      setup: null,
      firstCheck: true,
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction left wide",
        "2 shoulder_abduction right wide",
        "3 trunk_control_seated left helper",
        "4 trunk_control_seated right helper",
        "5 arm_curl_30s right arm_only",
        "6 arm_curl_30s left",
        "7 chair_stand_30s none skip:position_seated",
      ]
    `);
  });

  it("Noura, 31, incomplete SCI, wheelchair, not sure whether T6 or higher", () => {
    const r = pipeline(ctxOf({ position: "wheelchair", conditions: ["sci_incomplete"] }), {
      setup: null,
      firstCheck: true,
      answers: { pc_sci_level: "unsure" },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right wide",
        "2 shoulder_abduction left wide",
        "3 trunk_control_seated right helper",
        "4 trunk_control_seated left helper",
        "5 arm_curl_30s right",
        "6 arm_curl_30s left",
        "7 chair_stand_30s none skip:position_seated",
      ]
    `);
  });

  it("Khalid, 44, MS, uses a cane, standing, weaker left side", () => {
    const r = pipeline(ctxOf({ position: "standing", support: "left", conditions: ["ms"] }), {
      answers: { pc_walking_aid: "yes" },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right wide",
        "2 shoulder_abduction left wide",
        "3 chair_stand_30s none arms_assisted_steady helper wide",
        "4 arm_curl_30s left wide",
        "5 arm_curl_30s right wide",
      ]
    `);
  });

  it("a person with no condition, standing", () => {
    expect(lines(pipeline(ctxOf({ position: "standing" })))).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right",
        "2 shoulder_abduction left",
        "3 chair_stand_30s none standard",
        "4 arm_curl_30s right",
        "5 arm_curl_30s left",
      ]
    `);
  });

  it("upper limb loss, left, later check with the side in the setup", () => {
    const r = pipeline(ctxOf({ position: "standing", conditions: ["upper_limb_unilateral"] }), {
      setup: { limbLoss: { arm: "left" } },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right",
        "2 shoulder_abduction left skip:limb_loss_arm",
        "3 chair_stand_30s none one_arm_cross",
        "4 arm_curl_30s right",
        "5 arm_curl_30s left skip:limb_loss_arm",
      ]
    `);
  });

  it("lower limb loss, right, with a prosthesis, standing, first check", () => {
    const r = pipeline(ctxOf({ position: "standing", conditions: ["lower_limb_unilateral"] }), {
      setup: null,
      firstCheck: true,
      answers: { pc_limb_leg_side: "right", pc_limb_leg_prosthesis: "yes" },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right",
        "2 shoulder_abduction left",
        "3 chair_stand_30s none skip:limb_loss_leg",
        "4 trunk_control_seated right helper substitute",
        "5 trunk_control_seated left helper substitute",
        "6 arm_curl_30s right",
        "7 arm_curl_30s left",
      ]
    `);
  });

  it("Parkinson's, standing", () => {
    const r = pipeline(ctxOf({ position: "standing", conditions: ["parkinsons"] }), {
      answers: { pc_pd_dose: "2to3h" },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right wide",
        "2 shoulder_abduction left wide",
        "3 chair_stand_30s none standard helper",
        "4 arm_curl_30s right wide",
        "5 arm_curl_30s left wide",
      ]
    `);
  });

  it("arthritis with a knee flare, standing", () => {
    const r = pipeline(ctxOf({ position: "standing", conditions: ["arthritis"] }), {
      answers: { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": ["knee"] },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right",
        "2 shoulder_abduction left",
        "3 chair_stand_30s none skip:flare",
        "4 arm_curl_30s right",
        "5 arm_curl_30s left",
      ]
    `);
  });

  it("booth guest, wheelchair, weaker left side, shoulder pain", () => {
    const ctx = guestContext({
      position: "wheelchair",
      support: "left",
      pain: ["shoulder"],
      restrictions: [],
      conditions: ["ms"],
    }) as CheckContext;
    const r = pipeline(ctx, {
      setting: "booth",
      setup: null,
      firstCheck: true,
      answers: { "pc_arm_pain_side:shoulder": "left" },
    });
    expect(lines(r)).toMatchInlineSnapshot(`
      [
        "1 shoulder_abduction right wide",
        "2 shoulder_abduction left wide",
        "3 trunk_control_seated right",
        "4 trunk_control_seated left",
        "5 arm_curl_30s left arm_only wide",
        "6 arm_curl_30s right arm_only wide",
        "7 chair_stand_30s none skip:position_seated",
      ]
    `);
  });
});

/* ---------------------------------------------------------------- re-test */

describe("re-test timing (spec 5)", () => {
  it("reads the intervals from the data", () => {
    expect(RETEST_DAYS).toBe(28);
    expect(RETEST_DAYS).toBe(CHECK_DATA.progress.retestDays);
    expect(MIN_HOURS_BETWEEN_CHECKS).toBe(48);
    expect(MIN_HOURS_BETWEEN_CHECKS).toBe(CHECK_DATA.progress.minHoursBetweenChecks);
  });

  it("is due 28 days after the last completed check; none before a first check", () => {
    expect(retestDue(NOW)).toBe(NOW + 28 * DAY);
    expect(retestDue(null)).toBeNull();
    expect(retestDue(undefined)).toBeNull();
    expect(retestDue(Number.NaN)).toBeNull();
  });

  it("allows an earlier check, but not within 48 hours of the last completed one", () => {
    expect(earliestNextCheck(NOW)).toBe(NOW + 48 * HOUR);
    expect(earliestNextCheck(null)).toBeNull();
    expect(canStartCheck(null, NOW)).toBe(true);
    expect(canStartCheck(NOW, NOW + 48 * HOUR - 1)).toBe(false);
    expect(canStartCheck(NOW, NOW + 48 * HOUR)).toBe(true);
    expect(canStartCheck(NOW, NOW + 28 * DAY)).toBe(true);
  });
});
