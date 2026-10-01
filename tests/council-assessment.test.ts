/**
 * Council decisions applied to the context, the selection, the protocol and the schedule
 * (src/medical/assessment.ts) and to the typed data accessors (src/movements/assessments.ts). Every
 * test name cites the decision it proves: council/decisions.json (P, Q, H) and
 * council/decisions-ux-round.json (O, 7.2).
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA, skipReasonText } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import {
  MIN_HOURS_BETWEEN_CHECKS,
  RETEST_DAYS,
  allSkipped,
  allowedLoads,
  baseSelection,
  baseTests,
  boothClearanceRule,
  checkSchedule,
  contextFromIntake,
  estimateMinutes,
  finalizeProtocol,
  guestContext,
  isBlocked,
  repeatOfferWindow,
  sideLeanOnly,
  sideLeanRepeatOffer,
  type CheckContext,
  type GuestSteps,
  type ProtocolItem,
} from "../src/medical/assessment";
import { createPlan, type Intake } from "../src/medical/plan";
import { evaluatePrecheck, type PrecheckEnv } from "../src/medical/precheck";
import { NOW, ctxOf, fill } from "./precheck-fixtures";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EST = CHECK_DATA.selection.sessionMinutes.startingEstimatesMinutes;

const guest = (p: Partial<GuestSteps> = {}): GuestSteps => ({
  position: "chair",
  support: "none",
  pain: [],
  restrictions: [],
  conditions: [],
  clearance: "yes",
  ...p,
});

function contextOf(steps: GuestSteps): CheckContext {
  const c = guestContext(steps);
  if (isBlocked(c)) throw new Error(`blocked: ${c.blocked}`);
  return c;
}

const runs = (ctx: CheckContext, setting: "home" | "booth" = "booth") =>
  baseTests(baseSelection(ctx, setting, null));
const reasonOf = (ctx: CheckContext, test: TestId, setting: "home" | "booth" = "booth") =>
  baseSelection(ctx, setting, null).find((i) => i.testId === test)?.excluded;

/** A proceed protocol for a context: benign pre-check answers, then finalizeProtocol. */
function protocolOf(
  ctx: CheckContext,
  setting: "home" | "booth",
  answers: Record<string, unknown> = {},
  over: Partial<PrecheckEnv> = {},
): ProtocolItem[] {
  const base = baseSelection(ctx, setting, null);
  const env: PrecheckEnv = {
    setting,
    ctx,
    setup: null,
    firstCheck: true,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: baseTests(base),
    ...over,
  };
  const outcome = evaluatePrecheck(env, fill(env, answers as never), NOW);
  if (outcome.status !== "proceed") throw new Error(`not proceed: ${outcome.status} ${outcome.reason}`);
  return finalizeProtocol(base, outcome, ctx, setting, null);
}

/* ------------------------------------------------------------ Q19 guests */

describe("Q19: the guest booth context", () => {
  it("Q19 (5a): cardiac, other, cfs_moderate, bed or no_exercise get no movement check", () => {
    for (const c of ["cardiac", "other", "cfs_moderate"])
      expect(isBlocked(guestContext(guest({ conditions: [c] }))), c).toBe(true);
    expect(isBlocked(guestContext(guest({ position: "bed" })))).toBe(true);
    expect(isBlocked(guestContext(guest({ restrictions: ["no_exercise"] })))).toBe(true);
  });

  it("Q19 (5b): stroke or SCI with clearance no or not sure is not sent to staff: the seated arm raise only", () => {
    for (const conditions of [["stroke"], ["sci_complete"], ["sci_incomplete"]]) {
      for (const clearance of ["no", "unsure"] as const) {
        for (const position of ["chair", "wheelchair", "standing"] as const) {
          const ctx = contextOf(guest({ conditions, clearance, position, support: "left" }));
          expect(runs(ctx), `${conditions} ${clearance} ${position}`).toEqual(["shoulder_abduction"]);
          expect(reasonOf(ctx, "arm_curl_30s"), "curl").toBe("clearance_booth");
          const other = position === "standing" ? "chair_stand_30s" : "trunk_control_seated";
          expect(reasonOf(ctx, other), other).toBe("clearance_booth");
        }
      }
    }
  });

  it("Q19 (5b): no side lean takes the chair stand slot, because the side lean is skipped too", () => {
    const ctx = contextOf(guest({ conditions: ["stroke"], clearance: "no", position: "standing" }));
    const items = baseSelection(ctx, "booth", null);
    expect(items.filter((i) => i.substitute)).toEqual([]);
    expect(items.map((i) => `${i.testId}:${i.side}:${i.excluded ?? "runs"}`)).toEqual([
      "shoulder_abduction:right:runs",
      "shoulder_abduction:left:runs",
      "chair_stand_30s:none:clearance_booth",
      "arm_curl_30s:right:clearance_booth",
      "arm_curl_30s:left:clearance_booth",
    ]);
  });

  it("Q19 (5b): the booth arm raise keeps all its rules (pc_weak_lift, pc_weak_shoulder)", () => {
    const ctx = contextOf(guest({ conditions: ["stroke"], clearance: "unsure", support: "left" }));
    const p = protocolOf(ctx, "booth", { pc_weak_lift: "no" });
    expect(p.find((i) => i.testId === "shoulder_abduction" && i.side === "left")?.skipped).toBe(
      "arm_not_able",
    );
    expect(p.find((i) => i.testId === "shoulder_abduction" && i.side === "right")?.skipped).toBeUndefined();
  });

  it("Q19 (5b) and O33 (k): the booth rule never opens a home check", () => {
    const ctx = contextOf(guest({ conditions: ["stroke"], clearance: "no" }));
    expect(baseSelection(ctx, "home", null)).toEqual([]);
    expect(boothClearanceRule(ctx)).toBe(true);
    expect(boothClearanceRule({ ...ctx, clearance: "yes" })).toBe(false);
  });

  it("Q19 (2): every guest answers the clearance question; a skipped answer counts as not sure", () => {
    expect(contextOf(guest({ clearance: "yes" })).clearance).toBe("yes");
    expect(contextOf(guest({ clearance: "no" })).clearance).toBe("no");
    expect(contextOf(guest({ clearance: undefined })).clearance).toBe("unsure");
    expect(contextOf(guest({ clearance: null })).clearance).toBe("unsure");
  });

  it("Q19 (5c) with Q6 and D-016: clearance no without stroke or SCI, the arm curl without weight and no chair stand", () => {
    const ctx = contextOf(guest({ conditions: ["ms"], clearance: "no", position: "standing" }));
    expect(runs(ctx)).toEqual(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"]);
    expect(reasonOf(ctx, "chair_stand_30s")).toBe("clearance");
    expect(reasonOf(ctx, "chair_stand_30s", "home")).toBe("clearance");
    const p = protocolOf(ctx, "booth");
    for (const s of ["left", "right"])
      expect(p.find((i) => i.testId === "arm_curl_30s" && i.side === s)?.variant).toBe("arm_only");
  });

  it("Q19 (5c): stroke with clearance yes follows 3.1 and 3.3", () => {
    const ctx = contextOf(guest({ conditions: ["stroke"], clearance: "yes", support: "right" }));
    expect(runs(ctx)).toEqual(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"]);
  });

  it("O20: the guest chip sci_unsure maps to sci_complete, the stricter rules", () => {
    const ctx = contextOf(guest({ conditions: ["sci_unsure"], clearance: "yes", position: "standing" }));
    expect(ctx.conditions).toEqual(["sci_complete"]);
    expect(reasonOf(ctx, "chair_stand_30s")).toBe("position_seated");
    const uncleared = contextOf(guest({ conditions: ["sci_unsure"], clearance: "unsure" }));
    expect(runs(uncleared)).toEqual(["shoulder_abduction"]);
  });

  it("Q19 (1): none is exclusive, and unknown answers are refused", () => {
    expect(isBlocked(guestContext(guest({ conditions: ["none", "stroke"] })))).toBe(true);
    expect(isBlocked(guestContext(guest({ conditions: ["flu"] })))).toBe(true);
    expect(isBlocked(guestContext(guest({ clearance: "maybe" as never })))).toBe(true);
    expect(contextOf(guest({ conditions: ["none"] })).conditions).toEqual(["none"]);
  });
});

describe("Q19 (6) and Q20: a signed in visitor at the booth", () => {
  const intake: Intake = {
    age: 50,
    conditions: ["stroke"],
    diagnosisNotes: "",
    medications: "",
    mobility: "seated",
    support: "left",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "no",
    equipment: [],
    goal: "mobility",
    days: [0, 2, 4],
    time: "18:00",
    sessionMinutes: 30,
    consent: true,
  };

  it("Q20: at home stroke without clearance yes gets no check (clearance)", () => {
    const c = contextFromIntake(intake, createPlan(intake));
    expect(c).toEqual({ blocked: "clearance" });
    expect(contextFromIntake(intake, createPlan(intake), "home")).toEqual({ blocked: "clearance" });
  });

  it("Q19 (6) and 3.1: at the booth the same person runs the seated arm raise only", () => {
    const c = contextFromIntake(intake, createPlan(intake), "booth");
    if (isBlocked(c)) throw new Error(c.blocked);
    expect(baseTests(baseSelection(c, "booth", null))).toEqual(["shoulder_abduction"]);
  });

  it("Q20: every other clinical review reason still blocks at the booth", () => {
    const cardiac = { ...intake, conditions: ["stroke", "cardiac"] };
    expect(contextFromIntake(cardiac, createPlan(cardiac), "booth")).toEqual({ blocked: "cardiac" });
    const symptoms = { ...intake, symptoms: "yes" as const };
    expect(contextFromIntake(symptoms, createPlan(symptoms), "booth")).toEqual({ blocked: "symptoms" });
  });
});

/* ------------------------------------------------------------ P6 suffix */

describe("P6: the substitute sentence on the chair stand's skip reason", () => {
  const standingCtx = (p: Partial<CheckContext>) => ctxOf({ position: "standing", ...p });

  it("P6: appended when the side lean actually runs in the chair stand slot", () => {
    const p = protocolOf(standingCtx({ pain: ["knee"] }), "home");
    const stand = p.find((i) => i.testId === "chair_stand_30s")!;
    expect(stand).toMatchObject({ skipped: "pain_area", substituteRan: true });
    expect(skipReasonText(stand.skipped!, "en", { substituteRan: stand.substituteRan })).toBe(
      "Skipped because of pain in this area. We use the seated side lean instead.",
    );
    expect(skipReasonText(stand.skipped!, "ar", { substituteRan: true })).toBe(
      `${CHECK_DATA.reasons.pain_area.ar} ${CHECK_DATA.reasonSuffixes.substituteRan.ar}`,
    );
  });

  it("P6: not appended when the substitute is skipped today", () => {
    const p = protocolOf(standingCtx({ pain: ["knee"] }), "home", { "pc_trunk_armrests:chair": "no" });
    expect(p.find((i) => i.testId === "chair_stand_30s")?.substituteRan).toBeUndefined();
  });

  it("P6: not appended when the side lean is excluded too (back pain)", () => {
    const p = protocolOf(standingCtx({ pain: ["back"] }), "home");
    expect(p.find((i) => i.testId === "chair_stand_30s")).toMatchObject({ skipped: "pain_area" });
    expect(p.find((i) => i.testId === "chair_stand_30s")?.substituteRan).toBeUndefined();
  });

  it("P6: restriction_balance carries it at the booth only, where the side lean runs", () => {
    const booth = protocolOf(standingCtx({ restrictions: ["balance_support"] }), "booth");
    expect(booth.find((i) => i.testId === "chair_stand_30s")).toMatchObject({
      skipped: "restriction_balance",
      substituteRan: true,
    });
    const home = protocolOf(standingCtx({ restrictions: ["balance_support"] }), "home");
    expect(home.find((i) => i.testId === "chair_stand_30s")?.substituteRan).toBeUndefined();
  });

  it("P6: limb_loss_leg and position_seated carry the sentence in their own text, so no flag", () => {
    const p = protocolOf(standingCtx({ conditions: ["lower_limb_unilateral"] }), "home");
    expect(p.find((i) => i.testId === "chair_stand_30s")).toMatchObject({ skipped: "limb_loss_leg" });
    expect(p.find((i) => i.testId === "chair_stand_30s")?.substituteRan).toBeUndefined();
    expect(skipReasonText("limb_loss_leg", "en", { substituteRan: true })).toBe(
      CHECK_DATA.reasons.limb_loss_leg.en,
    );
  });
});

/* -------------------------------------------------------- O40 duration */

describe("O40: estimateMinutes, the computed duration", () => {
  const add = (...xs: [number, number][]) =>
    xs.reduce<[number, number]>((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);

  it("O40: a wheelchair user at home with three tests and no weight gets 16 to 21 minutes", () => {
    const ctx = ctxOf({ position: "wheelchair", clearance: "unsure" });
    const p = protocolOf(ctx, "home");
    expect(estimateMinutes(p, ctx, "home")).toEqual([16, 21]);
    expect(estimateMinutes(p, ctx, "home")).toEqual(
      add(
        EST.overhead,
        EST.precheckWithConditionQuestions,
        EST.shoulder_abduction,
        EST.trunk_control_seated,
        EST.helperBriefing,
        EST.arm_curl_30s_noLoad,
      ),
    );
  });

  it("O40: a load adds the load minutes; a guest adds the guest steps", () => {
    const ctx = ctxOf({ position: "standing" });
    const home = protocolOf(ctx, "home");
    expect(estimateMinutes(home, ctx, "home")).toEqual(
      add(
        EST.overhead,
        EST.precheckWithConditionQuestions,
        EST.shoulder_abduction,
        EST.chair_stand_30s,
        EST.arm_curl_30s_withLoad,
      ),
    );
    // D-016: a guest who is not cleared gets the side lean in the chair stand slot, with no staff
    // measurement minutes.
    const g = ctxOf({ position: "standing", clearance: "unsure" });
    const booth = protocolOf(g, "booth");
    expect(estimateMinutes(booth, g, "booth", true)).toEqual(
      add(
        EST.overhead,
        EST.guestSteps,
        EST.precheckWithConditionQuestions,
        EST.shoulder_abduction,
        EST.trunk_control_seated,
        EST.arm_curl_30s_noLoad,
      ),
    );
  });

  it("O40: skipped tests add nothing; rests and practice are inside each test's minutes and never cut", () => {
    // Stroke with no weaker side and only the arm raise: no condition question can appear.
    const ctx = contextOf(guest({ conditions: ["stroke"], clearance: "no" }));
    const p = protocolOf(ctx, "booth");
    expect(estimateMinutes(p, ctx, "booth", true)).toEqual(
      add(EST.overhead, EST.guestSteps, EST.precheck, EST.shoulder_abduction),
    );
    // With a weaker side the arm questions appear (pc_weak_lift, pc_weak_shoulder).
    const weak = contextOf(guest({ conditions: ["stroke"], clearance: "no", support: "left" }));
    expect(estimateMinutes(protocolOf(weak, "booth"), weak, "booth", true)).toEqual(
      add(EST.overhead, EST.guestSteps, EST.precheckWithConditionQuestions, EST.shoulder_abduction),
    );
  });

  it("O40: before the pre-check a list of test ids gives the upper reading (load at home, helper for the side lean)", () => {
    const ctx = ctxOf();
    expect(
      estimateMinutes(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"], ctx, "home"),
    ).toEqual(
      add(
        EST.overhead,
        EST.precheckWithConditionQuestions,
        EST.shoulder_abduction,
        EST.trunk_control_seated,
        EST.helperBriefing,
        EST.arm_curl_30s_withLoad,
      ),
    );
    expect(estimateMinutes(["shoulder_abduction"], null, "booth", true)).toEqual(
      add(EST.overhead, EST.guestSteps, EST.precheckWithConditionQuestions, EST.shoulder_abduction),
    );
  });
});

/* ------------------------------------------------ H9, Q12, Q33 schedule */

describe("H9 and Q33: when the next check may start and is due", () => {
  const t = Date.UTC(2026, 9, 1, 9);

  it("H9: due 28 days after the last completed home check", () => {
    const s = checkSchedule([{ completed: t, setting: "home" }], t + DAY);
    expect(s.retestDue).toBe(t + RETEST_DAYS * DAY);
    expect(RETEST_DAYS).toBe(28);
  });

  it("H9 and Q33: an earlier check may start from 48 hours after any completed check, with the early start screen", () => {
    expect(MIN_HOURS_BETWEEN_CHECKS).toBe(48);
    const checks = [{ completed: t, setting: "home" as const }];
    expect(checkSchedule(checks, t + 47 * HOUR)).toMatchObject({
      canStart: false,
      earliestNext: t + 48 * HOUR,
    });
    expect(checkSchedule(checks, t + 48 * HOUR)).toMatchObject({ canStart: true, early: true });
    expect(checkSchedule(checks, t + 28 * DAY)).toMatchObject({ canStart: true, early: false });
  });

  it("H9: a booth check does not set the home due date, but the 48 hours count from it", () => {
    const s = checkSchedule([{ completed: t, setting: "booth" }], t + DAY);
    expect(s.retestDue).toBeNull();
    expect(s.earliestNext).toBe(t + 48 * HOUR);
    expect(s.canStart).toBe(false);
    expect(checkSchedule([{ completed: t, setting: "booth" }], t + 49 * HOUR)).toMatchObject({
      canStart: true,
      early: false,
    });
  });

  it("Q12 (2): the side lean only session counts for the 48 hours and does not move the due date", () => {
    const checks = [
      { completed: t, setting: "home" as const },
      { completed: t + 3 * DAY, setting: "home" as const, session: "side_lean_only" as const },
    ];
    const s = checkSchedule(checks, t + 4 * DAY);
    expect(s.retestDue).toBe(t + 28 * DAY);
    expect(s.earliestNext).toBe(t + 5 * DAY);
    expect(s.canStart).toBe(false);
  });

  it("H9: nothing completed yet: no due date and no wait", () => {
    expect(checkSchedule([], t)).toEqual({
      retestDue: null,
      earliestNext: null,
      canStart: true,
      early: false,
    });
  });
});

describe("Q12 (2): the side lean only session for the second baseline", () => {
  const first = Date.UTC(2026, 9, 1, 9);
  const base = {
    firstHomeCheck: first,
    homeChecksWithSideLean: 1,
    lockActive: false,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
  };

  it("Q12 (2): offered from 48 hours to 7 days after the first completed home check", () => {
    expect(sideLeanRepeatOffer({ ...base, now: first + 47 * HOUR })).toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now: first + 48 * HOUR })).toEqual({
      from: first + 48 * HOUR,
      to: first + 7 * DAY,
    });
    expect(sideLeanRepeatOffer({ ...base, now: first + 7 * DAY })).not.toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now: first + 7 * DAY + 1 })).toBeNull();
  });

  it("Q12 (2): not offered while a lock, an uncleared changeReported or a lasting answer is active", () => {
    const now = first + 3 * DAY;
    expect(sideLeanRepeatOffer({ ...base, now, lockActive: true })).toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now, unresolvedChangeReported: true })).toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now, lastCheckLasting: true })).toBeNull();
  });

  it("Q12 (2): not offered once a second side lean exists, or when the first check had none", () => {
    const now = first + 3 * DAY;
    expect(sideLeanRepeatOffer({ ...base, now, homeChecksWithSideLean: 2 })).toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now, homeChecksWithSideLean: 0 })).toBeNull();
    expect(sideLeanRepeatOffer({ ...base, now, firstHomeCheck: null })).toBeNull();
  });
});

describe("Q12 (2): the side lean only session runs the side lean alone", () => {
  it("Q12 (2): sideLeanOnly keeps the side lean items, renumbered, and drops the substitute mark", () => {
    const standingKnee = baseSelection(ctxOf({ position: "standing", pain: ["knee"] }), "home", null);
    const only = sideLeanOnly(standingKnee);
    expect(only.map((i) => `${i.order} ${i.testId} ${i.side}`)).toEqual([
      "1 trunk_control_seated right",
      "2 trunk_control_seated left",
    ]);
    expect(only.every((i) => !i.substitute && !i.excluded)).toBe(true);
    expect(baseTests(only)).toEqual(["trunk_control_seated"]);
    expect(sideLeanOnly(baseSelection(ctxOf({ pain: ["back"] }), "home", null))).toEqual([]);
  });
});

describe("H9: the repeat offer after a lower, large drop or not comparable result", () => {
  const last = Date.UTC(2026, 9, 1, 9);

  it("H9: offers a repeat 2 to 7 days after the check", () => {
    expect(repeatOfferWindow(last, { repeat: true, lastCheckLasting: false })).toEqual({
      from: last + 2 * DAY,
      to: last + 7 * DAY,
    });
    expect(repeatOfferWindow(last, { repeat: false, lastCheckLasting: false })).toBeNull();
  });

  it("H9: no early repeat while a lasting ac_next_day answer is unresolved", () => {
    expect(repeatOfferWindow(last, { repeat: true, lastCheckLasting: true })).toBeNull();
  });
});

/* ----------------------------------------------------------- Q5 loads */

describe("Q5: the loads an arm may use", () => {
  const home = ctxOf();

  it("Q5: the booth runs without weight for everyone", () => {
    expect(allowedLoads({ ctx: home, setting: "booth" })).toEqual(["none"]);
  });

  it("Q5: at home the four kinds, and none of the dumbbells for Parkinson's, MS, CP and SCI", () => {
    expect(allowedLoads({ ctx: home, setting: "home" })).toEqual(["dumbbell", "bottle", "cuff", "none"]);
    for (const c of ["parkinsons", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete"])
      expect(allowedLoads({ ctx: ctxOf({ conditions: [c] }), setting: "home" }), c).toEqual([
        "bottle",
        "cuff",
        "none",
      ]);
  });

  it("Q5: a grip yes allows a wrist weight, a closed bottle or nothing", () => {
    expect(allowedLoads({ ctx: home, setting: "home", gripYes: true })).toEqual(["bottle", "cuff", "none"]);
  });

  it("Q5, Q6, Q8 and P2: a rule variant limits the load", () => {
    expect(allowedLoads({ ctx: home, setting: "home", variant: "arm_only" })).toEqual(["none"]);
    expect(allowedLoads({ ctx: home, setting: "home", variant: "cuff_or_arm_only" })).toEqual([
      "cuff",
      "none",
    ]);
  });
});

describe("O21: every test skipped today", () => {
  it("O21: allSkipped is true only when no item runs", () => {
    const ctx = ctxOf({ position: "standing" });
    const p = protocolOf(ctx, "home");
    expect(allSkipped(p)).toBe(false);
    expect(allSkipped(p.map((i) => ({ ...i, skipped: i.skipped ?? ("pain_today" as const) })))).toBe(true);
    expect(allSkipped([])).toBe(true);
  });
});
