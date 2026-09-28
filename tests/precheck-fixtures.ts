/**
 * Shared builders for the pre-check tests: environments, a stand in base selection (spec 3.2 with
 * the intake exclusions that matter for the pre-check), benign answers, and a seeded random
 * answerer for the property tests.
 */
import { CHECK_DATA, precheckItem } from "../src/movements/assessments";
import type { CheckContext } from "../src/medical/assessment";
import {
  evaluatePrecheck,
  parseQuestionId,
  visibleQuestions,
  type AnswerValue,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
} from "../src/medical/precheck";
import { AREA_IDS, SURGERY_AREA_IDS, type TestId } from "../src/movements/types";

export const NOW = Date.UTC(2026, 8, 27, 9, 0, 0); // 2026-09-27 12:00 in Riyadh
export const TODAY = "2026-09-27";

/**
 * Base tests for a context: spec 3.2 order, intake exclusions and the trunk substitute for standing
 * users. Written apart from baseSelection (src/medical/assessment.ts) and kept as an independent
 * oracle: tests/assessment.test.ts proves the two agree for every context that gets a check.
 */
export function baseTestsFor(ctx: CheckContext, setting: "home" | "booth" = "home"): TestId[] {
  // Q19 (5b): at the booth stroke or SCI without clearance yes runs the seated arm raise only.
  const boothOnlyArmRaise =
    setting === "booth" &&
    ctx.clearance !== "yes" &&
    ctx.conditions.some((c) => ["stroke", "sci_complete", "sci_incomplete"].includes(c));
  if (boothOnlyArmRaise) return ctx.restrictions.includes("no_overhead") ? [] : ["shoulder_abduction"];
  let tests: TestId[] = [...CHECK_DATA.selection.basePerPosition[ctx.position]];
  const pain = (a: string) => ctx.pain.includes(a);
  const restr = (r: string) => ctx.restrictions.includes(r);
  const cond = (c: string) => ctx.conditions.includes(c);
  const trunkExcluded = pain("back") || (restr("balance_support") && setting === "home");
  if (ctx.position === "standing") {
    const chairExcluded =
      pain("hip") ||
      pain("knee") ||
      pain("back") ||
      restr("no_weight_bearing") ||
      restr("balance_support") ||
      cond("sci_complete") ||
      cond("lower_limb_unilateral") ||
      (ctx.clearance !== "yes" && setting === "home");
    if (chairExcluded) {
      tests = tests.flatMap((t) =>
        t !== "chair_stand_30s" ? [t] : trunkExcluded ? [] : ["trunk_control_seated" as const],
      );
    }
  } else if (trunkExcluded) {
    tests = tests.filter((t) => t !== "trunk_control_seated");
  }
  if (restr("no_overhead")) tests = tests.filter((t) => t !== "shoulder_abduction");
  return tests;
}

export function ctxOf(p: Partial<CheckContext> = {}): CheckContext {
  return {
    position: "chair",
    support: "none",
    pain: [],
    restrictions: [],
    conditions: ["none"],
    clearance: "yes",
    ...p,
  };
}

export function envOf(ctx: Partial<CheckContext> = {}, over: Partial<PrecheckEnv> = {}): PrecheckEnv {
  const c = ctxOf(ctx);
  const setting = over.setting ?? "home";
  return {
    setting,
    ctx: c,
    setup: null,
    firstCheck: true,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: baseTestsFor(c, setting),
    ...over,
  };
}

/** The answer that lets the check go ahead with nothing changed. */
export function benign(id: string): AnswerValue {
  const parsed = parseQuestionId(id);
  if (!parsed) throw new Error(`unknown question ${id}`);
  const { base, part } = parsed;
  switch (base) {
    case "pc_pain_now":
      return 0;
    case "pc_pain_areas":
      return {};
    case "pc_sci_ready":
      return "done";
    case "pc_booth_vitals":
      return {
        systolic1: 120,
        diastolic1: 80,
        systolic2: 122,
        diastolic2: 80,
        restingHeartRate: 72,
        irregularHeartbeat: false,
      };
    case "pc_change_cleared":
    case "pc_trunk_armrests":
    case "pc_helper":
    case "pc_after_last":
    case "pc_weak_lift":
    case "pc_stand_no_hands":
    case "pc_sit_unsupported":
    case "pc_pd_on":
      return "yes";
    case "pc_arm_pain_side":
    case "pc_limb_arm_side":
    case "pc_limb_leg_side":
      return "right";
    case "pc_arm_function":
      return "bend_hold";
    case "pc_ms_one_arm":
      return "both";
    case "pc_pd_dose":
      return "1to2h";
    case "pc_sci_ad_since":
    case "pc_sci_level":
      return "no";
    case "pc_surgery_recent":
    case "pc_arthritis_flare":
      if (part === "areas") return [];
      return part === undefined ? "no" : "yes";
    default:
      return "no";
  }
}

/**
 * Answers every visible question: the given answers first, benign answers for the rest.
 * Follow up questions that the given answers open are answered too.
 */
export function fill(env: PrecheckEnv, given: Answers = {}): Answers {
  const answers: Answers = { ...given };
  for (let round = 0; round < 12; round++) {
    const missing = visibleQuestions(env, answers).filter((id) => !(id in answers));
    if (missing.length === 0) return answers;
    for (const id of missing) answers[id] = benign(id);
  }
  throw new Error("answers did not settle");
}

/** evaluatePrecheck on filled answers. */
export function run(env: PrecheckEnv, given: Answers = {}): PrecheckOutcome {
  return evaluatePrecheck(env, fill(env, given), NOW);
}

export const skipOf = (o: PrecheckOutcome, testId: string, side: string) =>
  o.skips.find((s) => s.testId === testId && s.side === side)?.reason;
export const variantsOf = (o: PrecheckOutcome, testId: string, side: string) =>
  o.variants.filter((v) => v.testId === testId && v.side === side).map((v) => v.variant);

/* ------------------------------------------------------------ randomness */

/** mulberry32, a small seeded generator, so property runs are repeatable. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  const subset = <T>(xs: readonly T[], p = 0.3): T[] => xs.filter(() => next() < p);
  return { next, int, pick, subset };
}
export type Rng = ReturnType<typeof rng>;

const CONDITION_POOL = [
  "none",
  "stroke",
  "ms",
  "cerebral_palsy",
  "sci_complete",
  "sci_incomplete",
  "parkinsons",
  "lower_limb_unilateral",
  "upper_limb_unilateral",
  "arthritis",
] as const;

export function randomEnv(r: Rng): PrecheckEnv {
  const conditions = r.subset(CONDITION_POOL.slice(1), 0.15);
  const ctx: CheckContext = {
    position: r.pick(["chair", "wheelchair", "standing"] as const),
    support: r.pick(["none", "left", "right"] as const),
    pain: r.subset(["shoulder", "elbow", "wrist", "back", "hip", "knee"], 0.15),
    restrictions: r.subset(["no_overhead", "no_resistance", "no_weight_bearing", "balance_support"], 0.1),
    conditions: conditions.length ? conditions : ["none"],
    clearance: r.pick(["yes", "yes", "yes", "no", "unsure"] as const),
  };
  const setting = r.next() < 0.2 ? "booth" : "home";
  const firstCheck = r.next() < 0.5;
  const setup =
    firstCheck || r.next() < 0.3
      ? null
      : {
          ...(r.next() < 0.5 ? { painSides: r.subset(["left", "right"] as const, 0.5) } : {}),
          ...(r.next() < 0.3 ? { sciT6: r.next() < 0.5 } : {}),
          ...(r.next() < 0.3 ? { limbLoss: { arm: r.pick(["left", "right"] as const) } } : {}),
        };
  return {
    setting,
    ctx,
    setup,
    firstCheck,
    unresolvedChangeReported: !firstCheck && r.next() < 0.2,
    lastCheckLasting: !firstCheck && r.next() < 0.2,
    baseTests: baseTestsFor(ctx, setting),
    ...(r.next() < 0.5 ? { sideLeanDoneAtHome: r.next() < 0.5 } : {}),
  };
}

/** A random valid answer for a visible question id. */
export function randomAnswer(r: Rng, id: string): AnswerValue {
  const parsed = parseQuestionId(id)!;
  const item = precheckItem(parsed.base);
  const options = item.options?.map((o) => o.value as string) ?? ["yes", "no"];
  switch (item.type) {
    case "scale_0_10":
      return r.next() < 0.5 ? 0 : r.int(11);
    case "area_scale_0_10": {
      const out: Record<string, number> = {};
      for (const a of r.subset(AREA_IDS, 0.2)) out[a] = r.int(11);
      return out;
    }
    case "list_confirm":
      return r.next() < 0.7 ? "done" : "not_yet";
    case "system": {
      if (r.next() < 0.2) return "unavailable";
      const systolic = 85 + r.int(90);
      const diastolic = 60 + r.int(50);
      return {
        systolic1: systolic,
        diastolic1: diastolic,
        systolic2: systolic + r.int(9) - 4,
        diastolic2: diastolic + r.int(9) - 4,
        restingHeartRate: 50 + r.int(90),
        irregularHeartbeat: r.next() < 0.1,
      };
    }
    case "yes_no_then_areas":
      if (parsed.part === "areas") return r.subset(item.surgeryAreas ? SURGERY_AREA_IDS : AREA_IDS, 0.2);
      return r.next() < 0.25 ? "yes" : "no";
    default:
      // Lean toward the benign answer so that many random runs reach proceed.
      return r.next() < 0.6 ? benign(id) : r.pick(options);
  }
}

/** Answers every visible question at random, following the follow ups. */
export function randomAnswers(r: Rng, env: PrecheckEnv): Answers {
  const answers: Answers = {};
  for (let round = 0; round < 12; round++) {
    const missing = visibleQuestions(env, answers).filter((id) => !(id in answers));
    if (missing.length === 0) break;
    for (const id of missing) answers[id] = randomAnswer(r, id);
  }
  return answers;
}
