/**
 * Who walks for the gait test today, how and with whom (product v7 contract 2.5; gait-rules
 * eligibility.gate, eligibility.today and modeChoice; review A08, A17, B12). Pure, no DOM: the start
 * route plans the gait test on the server, and the client may build the same preview.
 *
 * Rules before AI: the clinical source writes eligibility in words (GAIT_DATA.eligibility). Each rule
 * is written here by hand quoting its row, and tests/v7/a-gait-eligibility.test.ts reads the
 * thresholds and the lists back from the data. The day's answers come from FocusToday: since D-032
 * item 2 the focus check's one day screen fills it (the pain per area, unsteady, the walk's items, the
 * prosthesis and someone with the person). The v1 pre-check answers (pc_steadi, pc_walking_aid,
 * pc_pd_dizzy_standing, pc_pain_now, pc_pain_areas, pc_surgery_recent, pc_arthritis_flare,
 * pc_limb_leg_prosthesis and pc_helper) are still read when given, as before.
 *
 * D-034 item 2 (Nasser's first real test: a stroke with no helper got no walk): the overground walk is
 * offered to everyone who walks, with or without an aid. A helper is a line on the walk's screens
 * (helperRequired, GaitCapture's helper note), never a gate: no one there today, or «لا» to walking 10
 * metres without someone holding you, keeps the walk overground with that line and no pad. Only the
 * hard stops of the rules remain: the intake's walking, a red flag today, the restrictions, the
 * prosthesis, a surgery not cleared, the clearance and the global gate, and the pain of the day. The
 * walking pad keeps its rules and its checklist (modeChoice, padSafety).
 */
import { globalGate, standingGate, type FocusToday } from "./rom-protocol";
import type { Intake } from "./plan";
import type { RegionId } from "./body-map";
import type { AnswerValue, Answers } from "./precheck";

export type GaitMode = "overground" | "walking_pad";
export type GaitNotOffered =
  | "not_walking"
  /** Not returned since D-034 item 2 (a helper line); kept for plans stored before. */
  | "walk_needs_hands_on_help"
  /**
   * A required helper is not there today: «pc_helper ... no -> skip with reason helper_needed» (D-024,
   * A4-2). Not returned since D-034 item 2 (a helper line); kept for plans stored before.
   */
  | "helper_needed"
  | "restriction"
  | "prosthesis_off"
  | "surgery_not_cleared"
  | "clearance_needed"
  | "pain_today"
  | "global_gate"
  | "red_flag";
export interface GaitPlan {
  offered: boolean;
  reason?: GaitNotOffered;
  /** allowed today */
  modes: GaitMode[];
  /** overground */
  defaultMode: GaitMode;
  /** modeChoice.padAllowedWhenAll */
  padAllowed: boolean;
  helperRequired: boolean;
  /** Leg, hip or back pain 4 or 5 today: only the antalgic label can show (painDayRule). */
  antalgicOnly: boolean;
  /** the single leg stance check (capture.staticSingleLegStance) runs */
  staticStance: boolean;
  /**
   * Views in capture order per mode (capture.walking_pad: the affected side first, then the other side,
   * then the front; overground, D-035 item 2: the side view first, the front and back offered after it).
   */
  views: {
    overground: ("front" | "back" | "side")[];
    walking_pad: { view: "pad_side" | "pad_front"; nearSide?: "left" | "right" }[];
  };
}

/* ------------------------------------------------------------ constants */

/** eligibility.today: «leg, hip or back pain 6 or more today: postpone the gait test» (the shared cut). */
export const GAIT_PAIN_SKIP_AT = 6;
/** eligibility.today: «leg, hip or back pain 4 or 5 today: test runs; only the antalgic label can be shown». */
export const GAIT_ANTALGIC_PAIN: readonly [number, number] = [4, 5];
/** eligibility.today: «pc_pain_now 6 to 8 elsewhere (not a leg, hip or back): ... pad not offered» (9 postpones). */
export const GAIT_PAD_PAIN_NOW_FROM = 6;

/** The legs and the back: the body map regions and the v1 pain areas of «leg, hip or back». */
const LEG_BACK_REGIONS: readonly RegionId[] = ["back_trunk", "hip", "knee", "ankle_foot"];
const LEG_BACK_AREAS: readonly string[] = ["back", "hip", "knee", "ankle_foot"];
/** «pc_surgery_recent with back, hip, knee, ankle or foot not cleared»; other is the v1 unlisted area (widest). */
const GAIT_SURGERY_AREAS: readonly string[] = ["spine", "hip", "knee", "ankle_foot", "other"];
/** «pc_arthritis_flare in hip, knee, ankle or foot». */
const LEG_FLARE_AREAS: readonly string[] = ["hip", "knee", "ankle_foot"];
const LEG_REGIONS: readonly RegionId[] = ["hip", "knee", "ankle_foot"];
const UNDER_3_MONTHS = new Set(["lt6w", "6w_3m"]);

/**
 * modeChoice.padAllowedWhenAll, each with where it is checked: gaitPlanFor decides from the intake and
 * the day's answers; the pad's support and lowest speed are setup checks of the capture (C).
 */
export const GAIT_PAD_CONDITIONS: readonly {
  text: string;
  checkedBy: "gaitPlanFor" | "capture setup (C)";
}[] = Object.freeze([
  { text: "no walking aid", checkedBy: "gaitPlanFor" },
  { text: "day_unsteady_ask no", checkedBy: "gaitPlanFor" },
  { text: "no balance_support restriction", checkedBy: "gaitPlanFor" },
  { text: "no freezing", checkedBy: "gaitPlanFor" },
  {
    text: "no dizziness on standing (Parkinson's: not asked since D-032, so no pad)",
    checkedBy: "gaitPlanFor",
  },
  { text: "leg, hip or back pain 5 or less today", checkedBy: "gaitPlanFor" },
  { text: "clearance yes", checkedBy: "gaitPlanFor" },
  { text: "pain today in another area no higher than padPainAtOrBelow", checkedBy: "gaitPlanFor" },
  {
    text: "pad has a front bar, or a stable support on the side away from the phone, within reach (review B12)",
    checkedBy: "capture setup (C)",
  },
  { text: "comfortable speed not below the pad's lowest speed", checkedBy: "capture setup (C)" },
  {
    text: "booth or clinic staff present, or a helper at home (day_helper_ask yes)",
    checkedBy: "gaitPlanFor",
  },
]);

/* --------------------------------------------------------------- answers */

const answer = (answers: Answers, id: string): AnswerValue | undefined => answers[id];
const yes = (answers: Answers, id: string) => answer(answers, id) === "yes";
const STEADI = ["fell", "unsteady", "worry"].map((part) => `pc_steadi:${part}`);

/**
 * The highest pain today in an area that is not a leg, hip or back (the day's pain question, D-032):
 * «pc_pain_now 6 to 8 elsewhere» when the v1 pain now is not given.
 */
function painElsewhere(today: FocusToday): number {
  return Math.max(
    0,
    ...Object.entries(today.painByRegion)
      .filter(([r]) => !LEG_BACK_REGIONS.includes(r as RegionId))
      .map(([, v]) => v ?? 0),
  );
}

/** The highest leg, hip or back pain today, from the body map pain questions and the v1 pain areas. */
function legPainToday(today: FocusToday, answers: Answers): number {
  const scores: number[] = LEG_BACK_REGIONS.map((r) => today.painByRegion[r] ?? 0);
  const areas = answer(answers, "pc_pain_areas");
  if (areas && typeof areas === "object" && !Array.isArray(areas))
    for (const a of LEG_BACK_AREAS) {
      const v = (areas as Record<string, unknown>)[a];
      if (typeof v === "number") scores.push(v);
    }
  return Math.max(0, ...scores);
}

/**
 * Recent surgery to the back or a leg not cleared: the v1 answer, or the body map (under 3 months, not
 * cleared). The body map stores the clearance exactly under 3 months (D-024, A2-8): an older surgery
 * has none and is no restriction.
 */
function surgeryNotCleared(intake: Intake, answers: Answers): boolean {
  if (yes(answers, "pc_surgery_recent")) {
    const areas = answer(answers, "pc_surgery_recent:areas");
    const list = Array.isArray(areas) ? areas : [];
    // Yes with none of the listed areas: the v1 unlisted area «other», the widest restriction.
    if (list.length === 0) return true;
    if (
      list.some((a) => GAIT_SURGERY_AREAS.includes(a) && answer(answers, `pc_surgery_recent:${a}`) !== "yes")
    )
      return true;
  }
  return (intake.regions ?? []).some(
    (e) =>
      LEG_BACK_REGIONS.includes(e.region) &&
      e.problems.includes("after_surgery") &&
      (!e.surgery || UNDER_3_MONTHS.has(e.surgery.since)) &&
      e.surgery?.cleared !== "yes",
  );
}

function legFlare(answers: Answers): boolean {
  if (!yes(answers, "pc_arthritis_flare")) return false;
  const areas = answer(answers, "pc_arthritis_flare:areas");
  return Array.isArray(areas) && areas.some((a) => LEG_FLARE_AREAS.includes(a));
}

function lowerLimbLoss(intake: Intake): boolean {
  return (
    intake.conditions.includes("lower_limb_unilateral") ||
    (intake.regions ?? []).some(
      (e) =>
        e.problems.includes("limb_loss") &&
        (e.limbLoss?.level === "below_knee" || e.limbLoss?.level === "above_knee"),
    )
  );
}

/** «first the affected side (both or none: the right)»: the side of the body map's leg regions. */
function affectedLegSide(intake: Intake): "left" | "right" {
  const sides = new Set<string>();
  for (const e of intake.regions ?? []) {
    if (!LEG_REGIONS.includes(e.region)) continue;
    if (e.side === "left" || e.side === "right") sides.add(e.side);
    else sides.add("both");
  }
  return sides.size === 1 && sides.has("left") ? "left" : "right";
}

const NOT_OFFERED_VIEWS: GaitPlan["views"] = { overground: [], walking_pad: [] };

function notOffered(reason: GaitNotOffered): GaitPlan {
  return {
    offered: false,
    reason,
    modes: [],
    defaultMode: "overground",
    padAllowed: false,
    helperRequired: false,
    antalgicOnly: false,
    staticStance: false,
    views: { ...NOT_OFFERED_VIEWS },
  };
}

/* ------------------------------------------------------------------ plan */

/** gait-rules eligibility.gate, eligibility.today and modeChoice. */
export function gaitPlanFor(
  intake: Intake,
  today: FocusToday,
  setting: "home" | "booth",
  precheckAnswers: Answers,
): GaitPlan {
  const answers = precheckAnswers ?? {};
  // gate: «intake.walking: no -> not offered; without_aid or with_aid -> continue».
  const walking = intake.walking?.status;
  if (walking !== "with_aid" && walking !== "without_aid") return notOffered("not_walking");
  // «clearance no or unsure: stroke or SCI: no gait test (reason clearance_needed), as the global gate».
  const gate = globalGate(intake);
  if (gate) return notOffered(gate);
  // rf_region (contract 2.5): a red flag in a leg region or the back today.
  if (today.redFlagRegions.some((r) => LEG_BACK_REGIONS.includes(r))) return notOffered("red_flag");
  // «restriction no_weight_bearing or no_exercise: not offered».
  if (intake.restrictions.includes("no_weight_bearing") || intake.restrictions.includes("no_exercise"))
    return notOffered("restriction");
  // «lower limb loss: only with the prosthesis on (pc_limb_leg_prosthesis yes); never on crutches without a prosthesis».
  const prosthesisOn = today.prosthesisOn ?? (yes(answers, "pc_limb_leg_prosthesis") ? true : undefined);
  if (lowerLimbLoss(intake) && prosthesisOn !== true) return notOffered("prosthesis_off");
  // «pc_surgery_recent with back, hip, knee, ankle or foot not cleared: not offered today».
  if (surgeryNotCleared(intake, answers)) return notOffered("surgery_not_cleared");
  // today: «leg, hip or back pain 6 or more today: postpone the gait test».
  const legPain = legPainToday(today, answers);
  if (legPain >= GAIT_PAIN_SKIP_AT) return notOffered("pain_today");

  // today: who needs a helper beside them («helper required; pad not offered»).
  const parkinsons = intake.conditions.includes("parkinsons");
  const aid = walking === "with_aid" || yes(answers, "pc_walking_aid");
  // day_unsteady_ask (D-032 item 2) stands for the STEADI three; their v1 answers still count when given.
  const steadiYes = today.unsteady === true || STEADI.some((id) => yes(answers, id));
  const steadiNo = today.unsteady === false || STEADI.every((id) => answer(answers, id) === "no");
  const balance = intake.restrictions.includes("balance_support");
  const dizzy = yes(answers, "pc_pd_dizzy_standing");
  const freezing = today.pdFreezing === true;
  // «pc_walk_10m: no -> not offered, reason walk_needs_hands_on_help» was a gate: since D-034 item 2 it
  // is someone beside the walker, as a line (FAC 0 to 2 need another person's hands).
  const handsOnHelp = today.walk10m === false;
  const helperRequired = steadiYes || aid || balance || dizzy || freezing || handsOnHelp;
  // «staff count as helper at the booth». A required helper who is not there no longer skips the walk
  // (D-034 item 2: «pc_helper ... no -> skip» is a line, never a gate); the pad still needs someone.
  const helperPresent =
    setting === "booth" || today.helperPresent === true || yes(answers, "pc_helper:chair_stand_30s");

  const painNow = answer(answers, "pc_pain_now") ?? painElsewhere(today);
  // modeChoice.padAllowedWhenAll (the setup items are the capture's): every answer must be a calm one.
  const padAllowed =
    !handsOnHelp &&
    !aid &&
    steadiNo &&
    !balance &&
    (parkinsons ? today.pdFreezing === false : !freezing) &&
    (parkinsons ? answer(answers, "pc_pd_dizzy_standing") === "no" : !dizzy) &&
    legPain < GAIT_PAIN_SKIP_AT &&
    intake.clearance === "yes" &&
    !legFlare(answers) &&
    helperPresent &&
    !(typeof painNow === "number" && painNow >= GAIT_PAD_PAIN_NOW_FROM);

  const near = affectedLegSide(intake);
  const other = near === "left" ? "right" : "left";
  return {
    offered: true,
    modes: padAllowed ? ["overground", "walking_pad"] : ["overground"],
    defaultMode: "overground",
    padAllowed,
    helperRequired,
    antalgicOnly: legPain >= GAIT_ANTALGIC_PAIN[0] && legPain <= GAIT_ANTALGIC_PAIN[1],
    // capture.staticSingleLegStance: «under the v1.1 standing gate (H6 rule 2)».
    staticStance: standingGate(intake, setting, { ...today, prosthesisOn }) === null,
    views: {
      overground: ["side", "front", "back"],
      walking_pad: padAllowed
        ? [{ view: "pad_side", nearSide: near }, { view: "pad_side", nearSide: other }, { view: "pad_front" }]
        : [],
    },
  };
}

/**
 * D-032 item 1: the walking pad is offered at home too, with its existing steps and a helper beside
 * the person (modeChoice: «booth or clinic staff present, or a helper at home»). Whether the day's one
 * helper question can change today's walk: with someone there, the pad would be offered. The
 * overground walk is offered either way (a helper is a line, D-034 item 2). Never at the booth, where
 * the staff count as the helper.
 */
export function helperMattersForWalk(
  intake: Intake,
  today: FocusToday,
  setting: "home" | "booth",
  precheckAnswers: Answers = {},
): boolean {
  if (setting === "booth") return false;
  const withHelper = gaitPlanFor(intake, { ...today, helperPresent: true }, setting, precheckAnswers);
  return withHelper.offered && withHelper.padAllowed;
}
