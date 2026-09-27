/**
 * Types for the runtime movement check data, src/movements/check-v1.json (contract v2, section A).
 *
 * The JSON is written by scripts/clinical/export-check.mjs from the clinical spec
 * (local-docs/clinical/movement-check-v1.json). Closed sets in the JSON are literal unions here.
 * The id lists are also exported as values, so tests/movement-data.test.ts can prove that each list
 * equals the ids in the data, in both directions. src/movements/assessments.ts checks the JSON
 * against these types at compile time (see Widen) and exports the typed accessors.
 *
 * Fields typed as plain string that hold English prose (rule, definition, when, the noiseBandRules
 * lists, ...) are engineering documentation of a rule, not machine readable input: the code that
 * implements the rule is written by hand from the clinical spec. They are never shown to a person.
 */
import type { conditions, painOptions, restrictionOptions } from "../medical/plan";

/* ------------------------------------------------------------------ basics */

export type Lang = "ar" | "en";
/** User facing copy: Arabic first with complete English. */
export interface Text {
  ar: string;
  en: string;
}
/** User facing lists (steps, safety, checklists), item i in Arabic matches item i in English. */
export interface TextList {
  ar: string[];
  en: string[];
}
export type Side = "left" | "right";
export type SignoffStatus = "draft" | "reviewed" | "approved";

/** Intake enums (src/medical/plan.ts). */
export type ConditionId = (typeof conditions)[number];
export type PainArea = (typeof painOptions)[number];
export type Restriction = (typeof restrictionOptions)[number];
export type Clearance = "yes" | "no" | "unsure";
export type Support = "none" | Side;

export type CheckPosition = "chair" | "wheelchair" | "standing";
/** Positions in selection.basePerPosition: the check positions plus bed (no check). */
export type SelectionPosition = CheckPosition | "bed";
export type Setting = "booth" | "home";

/* ------------------------------------------------------------------ id sets */

export const TEST_ID_LIST = [
  "shoulder_abduction",
  "arm_curl_30s",
  "trunk_control_seated",
  "chair_stand_30s",
] as const;
export type TestId = (typeof TEST_ID_LIST)[number];

export type TestKind = "range_test" | "timed_count" | "trunk_control";
/** Stored result unit of a test. */
export type TestUnit = "deg" | "count";
/** Unit word forms in progress.unitForms, used by resultUnit and the plural helper (src/i18n). */
export const UNIT_FORM_IDS = ["deg", "bends", "stands", "sec"] as const;
export type UnitFormId = (typeof UNIT_FORM_IDS)[number];

export const PRECHECK_IDS = [
  "pc_setting",
  "pc_urgent",
  "pc_unwell",
  "pc_change",
  "pc_change_cleared",
  "pc_surgery_recent",
  "pc_pain_now",
  "pc_pain_worse",
  "pc_pain_areas",
  "pc_arm_pain_side",
  "pc_weak_lift",
  "pc_weak_shoulder",
  "pc_limb_arm_side",
  "pc_limb_arm_prosthesis",
  "pc_limb_leg_side",
  "pc_limb_leg_prosthesis",
  "pc_sci_level",
  "pc_sci_ad_since",
  "pc_sci_ad_now",
  "pc_sci_ready",
  "pc_arm_function",
  "pc_pressure_sore",
  "pc_sit_unsupported",
  "pc_trunk_armrests",
  "pc_fall_sitting",
  "pc_stroke_push",
  "pc_ms_heat",
  "pc_ms_one_arm",
  "pc_pd_on",
  "pc_pd_dose",
  "pc_arthritis_flare",
  "pc_steadi",
  "pc_walking_aid",
  "pc_stand_no_hands",
  "pc_pd_dizzy_standing",
  "pc_booth_vitals",
  "pc_helper",
  "pc_after_last",
] as const;
export type PrecheckId = (typeof PRECHECK_IDS)[number];
export const BETWEEN_TEST_IDS = ["bt_pain_after"] as const;
export type BetweenTestId = (typeof BETWEEN_TEST_IDS)[number];
export const AFTER_CHECK_IDS = ["ac_next_day"] as const;
export type AfterCheckId = (typeof AFTER_CHECK_IDS)[number];
/** Any question of the check: pre-check, between tests or after the check. */
export type QuestionId = PrecheckId | BetweenTestId | AfterCheckId;

export const SCREEN_IDS = [
  "scr_emergency",
  "scr_ad",
  "scr_stop_ask",
  "scr_faint",
  "scr_faint_sci",
  "scr_fall",
  "scr_fall_seated",
  "scr_no_response",
  "scr_stop_seek_care",
  "scr_stop_pain",
  "scr_postpone_care",
  "scr_postpone_unwell",
  "scr_postpone_pain",
  "scr_postpone_cool",
  "scr_postpone_pd",
  "scr_postpone_sci",
  "scr_paused_today",
  "scr_note_care",
  "scr_after_lasting",
  "scr_helper_brief_stand",
  "scr_helper_brief_trunk",
  "warn_sci_t6",
  "warn_pain_high",
  "warn_weak_shoulder",
  "warn_ms_cool",
  "warn_pd_timing",
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

/** Skip, variant and stop reasons shown with a result (spec 3.6). */
export const REASON_IDS = [
  "restriction_overhead",
  "restriction_weight_bearing",
  "restriction_balance",
  "pain_area",
  "pain_today",
  "flare",
  "limb_loss_arm",
  "limb_loss_leg",
  "position_seated",
  "clearance",
  "booth_offer",
  "helper_needed",
  "booth_only_trunk",
  "armrests_needed",
  "pusher",
  "weak_shoulder",
  "arm_not_able",
  "pressure_sore",
  "recent_surgery",
  "booth_vitals",
  "by_choice",
  "quality",
  "stopped_symptom",
  "needed_arms",
  "needed_support",
] as const;
export type ReasonId = (typeof REASON_IDS)[number];

/** Reasons that postpone the whole check (spec 2.1), each with its screen. */
export const POSTPONE_REASON_IDS = [
  "unwell",
  "recent_change",
  "pain",
  "pain_worse",
  "sci_ready",
  "ms_heat",
  "pd_off",
  "after_last",
] as const;
export type PostponeReasonId = (typeof POSTPONE_REASON_IDS)[number];

/** Keys of locks.rules: the postpone reasons plus the emergency, AD and stop locks. */
export const LOCK_REASON_IDS = [
  "unwell",
  "pain",
  "pain_worse",
  "after_last",
  "ad",
  "urgent",
  "stop_symptom",
  "recent_change",
  "ms_heat",
  "pd_off",
  "sci_ready",
] as const;
export type LockReasonId = (typeof LOCK_REASON_IDS)[number];
/** Lock durations with a pausedWhenTokens line. */
export type LockKind = "next_day" | "60_min";
/** The lock of an action; none means allowed again at once (pc_sci_ready). */
export type ActionLock = LockKind | "none";

export const CHECK_CUE_IDS = [
  "check_intro",
  "check_stop_any_time",
  "check_phone_steady",
  "check_phone_level",
  "check_phone_still",
  "check_whole_body",
  "check_face_phone",
  "check_left_side_to_phone",
  "check_right_side_to_phone",
  "check_phone_angle",
  "check_move_back",
  "check_move_closer",
  "check_light",
  "check_one_person",
  "check_sleeves",
  "check_ready",
  "check_go",
  "check_ten_left",
  "check_time_stop",
  "check_practice",
  "check_practice_done",
  "check_rest_short",
  "check_rest_minute",
  "check_other_side",
  "check_left_arm",
  "check_right_arm",
  "check_saved",
  "check_try_again",
  "check_breathe",
  "check_stop_now",
  "check_are_you_ok",
  "check_urgent_call",
  "check_skip_ok",
  "check_postpone",
  "check_sit_minute",
  "check_done",
  "test_abd_start",
  "test_abd_arms_rest",
  "test_abd_thumb",
  "test_abd_raise",
  "test_abd_side",
  "test_abd_hold",
  "test_abd_lower",
  "test_abd_still",
  "test_abd_relax_shoulder",
  "test_curl_start",
  "test_curl_elbow",
  "test_curl_full",
  "test_curl_many",
  "test_curl_grip",
  "test_trunk_start",
  "test_trunk_still",
  "test_trunk_lean_left",
  "test_trunk_lean_right",
  "test_trunk_light_touch",
  "test_trunk_pause",
  "test_trunk_return",
  "test_trunk_seat",
  "test_trunk_to_middle",
  "test_stand_start",
  "test_stand_arms_cross",
  "test_stand_hands_ok",
  "test_stand_full",
  "test_stand_many",
  "test_stand_steady",
  "test_stand_dizzy",
  "test_stand_hands_needed",
] as const;
export type CheckCueId = (typeof CHECK_CUE_IDS)[number];

export const AREA_IDS = [
  "shoulder_right",
  "shoulder_left",
  "elbow_right",
  "elbow_left",
  "wrist_right",
  "wrist_left",
  "back",
  "hip",
  "knee",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
export const SURGERY_AREA_IDS = [
  "shoulder_right",
  "shoulder_left",
  "elbow_right",
  "elbow_left",
  "wrist_right",
  "wrist_left",
  "spine",
  "hip",
  "knee",
  "chest_belly",
] as const;
export type SurgeryAreaId = (typeof SURGERY_AREA_IDS)[number];

export const STOP_OPTION_IDS = [
  "chest",
  "stroke_signs",
  "ad_signs",
  "faint",
  "breath",
  "fall",
  "pain",
  "tired",
  "choice",
  "other",
] as const;
export type StopOptionId = (typeof STOP_OPTION_IDS)[number];

/** Test variants (tests[].variants[].id). */
export type ArmCurlVariantId = "held" | "cuff" | "arm_only";
export type ChairStandVariantId = "standard" | "arms_assisted" | "arms_assisted_steady" | "one_arm_cross";
export type VariantId = ArmCurlVariantId | ChairStandVariantId;
/**
 * Variants set by pre-check actions. Besides test variants these include two modifiers that are not
 * variant ids of any test: push_stronger_hand_only (the hands allowed chair stand pushes with the
 * stronger hand, stored as pushHand) and cuff_or_arm_only (the arm curl load is limited to a wrist
 * weight or none).
 */
export type ActionVariant = "arm_only" | "arms_assisted" | "push_stronger_hand_only" | "cuff_or_arm_only";

/** Answer values of the pre-check, between tests and after check options. */
export type OptionValue =
  | "yes"
  | "no"
  | "unsure"
  | "yes_cleared"
  | "right"
  | "left"
  | "both"
  | "weaker"
  | "bend_hold"
  | "bend_no_hold"
  | "no_bend"
  | "lt1h"
  | "1to2h"
  | "2to3h"
  | "gt3h"
  | "same"
  | "more"
  | "much"
  | "usual"
  | "settled"
  | "lasting";
export type PdDoseBucket = "lt1h" | "1to2h" | "2to3h" | "gt3h";

/* ---------------------------------------------------------------- top level */

export interface Signoff {
  status: SignoffStatus;
  medical: string | null;
  fitness: string | null;
  date: string | null;
  reviewers: string[];
}

export type BoundaryId =
  "line" | "notMedical" | "intro" | "firstResult" | "consent" | "precheckNotice" | "resultsFooter";

/** Which tests an area loads (pain areas, flare areas, surgery areas). */
export interface AreaLoad {
  test: TestId;
  /** each: both sides of a two sided test; none: a test without sides. */
  side: Side | "none" | "each";
  variant?: "arms_assisted";
  /** Prose: "push with the other hand only; both sides affected: skip". */
  action?: string;
}
export interface Area {
  id: AreaId;
  label: Text;
  loads: AreaLoad[];
}
export interface SurgeryLoad {
  test: TestId;
  side: "none" | "each";
  variant?: "arm_only";
  action?: "skip";
}
/** A surgery area either reuses a pain area's loads (usesArea) or lists its own. */
export interface SurgeryArea {
  id: SurgeryAreaId;
  usesArea?: AreaId;
  label?: Text;
  loads?: SurgeryLoad[];
}

export interface EngineConfig {
  pose: {
    numPoses: number;
    subjectLock: string;
    pauseWhen: string[];
    onPause: string;
    setupGate: string;
    tune_at_booth: boolean;
  };
  model: {
    choice: string;
    recorded: string[];
    minFps: Record<TestKind, number>;
    basis: string;
  };
  landmarks: string;
}

/* ---------------------------------------------------------------- questions */

export type PrecheckGroup = "system" | "every_check" | "baseline_setup" | "condition" | "standing";
export type PrecheckType =
  | "system"
  | "yes_no"
  | "yes_no_unsure"
  | "yes_no_then_areas"
  | "scale_0_10"
  | "area_scale_0_10"
  | "single"
  | "checklist"
  | "three_yes_no";

/**
 * When a question is shown. Every key present must hold (and); anyOf holds when one of its
 * conditions holds. null shows the question always.
 */
export interface ShowIf {
  anyOf?: ShowIf[];
  answer?: { id: QuestionId; equals?: OptionValue; gte?: number };
  noUnresolvedChangeReported?: true;
  unresolvedChangeReported?: true;
  painAny?: PainArea[];
  supportNot?: "none";
  conditionsAny?: ConditionId[];
  flag?: PrecheckFlag;
  notFirstCheck?: true;
  testSelected?: TestId;
  positionIn?: CheckPosition[];
  setting?: Setting;
  clearanceIn?: Clearance[];
  previousFollowUp?: "lasting_unresolved";
}
/** Flags set during the pre-check: sci_t6 (pc_sci_level) and helper_required (per test). */
export type PrecheckFlag = "sci_t6" | "helper_required";

/** When an action applies. Every key present must hold. */
export interface ActionIf {
  /** The answer equals this value (pc_setting: the setting). */
  equals?: OptionValue | Setting;
  /** pc_surgery_recent: the clearance follow up answer is not yes. */
  clearedNot?: "yes";
  gte?: number;
  /** pc_pain_areas: an area scores at least this. */
  areaScoreGte?: number;
  /** pc_pain_areas: that area is loaded by a selected test. */
  areaLoadsSelectedTest?: true;
  /** Any answer. */
  any?: true;
  in?: OptionValue[];
  /** pc_sci_ready: false means not every box is ticked. */
  allChecked?: false;
  /** pc_steadi: any of the three answers is yes. */
  anyYes?: true;
  /** pc_booth_vitals: any value above its limit. */
  vitalsAbove?: { restingHeartRate: number; systolic: number; diastolic: number };
  /** pc_booth_vitals: no validated cuff or no trained staff member. */
  vitalsUnavailable?: true;
}

/** Side of a test named by a pre-check action, relative to the person where needed. */
export type TestRefSide = "weaker" | "stronger" | "same" | "each" | "none";
export interface TestRef {
  test: TestId;
  /** same: the side the question was asked for (pc_arm_function asks per side). */
  side: TestRefSide;
}
/**
 * The tests an action applies to: a list, or a prose selector the code resolves by hand.
 * surgeryArea.loads and area.loads: the tests loaded by the chosen areas (areas, surgeryAreas).
 */
export type TestTargets =
  | TestRef[]
  | "surgeryArea.loads"
  | "area.loads"
  | "the test the question was asked for"
  | "remaining tests that load the same area";

/** Where an answer is kept (data map of spec 2.1); nothing else from the pre-check is stored. */
export type StoreKey =
  | "changeCleared"
  | "changeReported"
  | "setup.painSides"
  | "setup.limbLoss.arm"
  | "setup.limbLoss.leg"
  | "fingerprint.armProsthesis"
  | "fingerprint.legProsthesis"
  | "fingerprint.pdState"
  | "fingerprint.pdDoseBucket"
  | "fingerprint.helperPresent"
  | "followUpResolved"
  | "assessment.followUp";

interface ActionBase {
  if: ActionIf;
}
export interface RecordAction extends ActionBase {
  do: "record";
  /** Absent for pc_setting, which records the setting itself. */
  stores?: StoreKey;
}
export interface EmergencyAction extends ActionBase {
  do: "emergency";
  screen: ScreenId;
  lock: LockKind;
  /** Also show this screen when the condition holds (scr_ad for SCI). */
  alsoShowIf?: Pick<ShowIf, "anyOf" | "flag" | "conditionsAny"> & { screen: ScreenId };
}
export interface PostponeAction extends ActionBase {
  do: "postpone";
  reason: PostponeReasonId;
  screen: ScreenId;
  lock: ActionLock;
  stores?: StoreKey;
}
export interface AskAction extends ActionBase {
  do: "ask";
  next: QuestionId;
}
export interface SkipAction extends ActionBase {
  do: "skip";
  tests: TestTargets;
  reason: ReasonId;
  screen?: ScreenId;
}
export interface WarnAction extends ActionBase {
  do: "warn";
  screen: ScreenId;
}
export interface VariantAction extends ActionBase {
  do: "variant";
  tests: TestRef[];
  variant: ActionVariant;
  alsoDo?: "require_helper";
}
export interface FlagAction extends ActionBase {
  do: "flag";
  flag: "sci_t6";
}
export interface AdResponseAction extends ActionBase {
  do: "ad_response";
  screen: ScreenId;
  lock: LockKind;
}
export interface BoothOnlyAction extends ActionBase {
  do: "booth_only";
  tests: TestRef[];
  reason: ReasonId;
}
export interface RequireHelperAction extends ActionBase {
  do: "require_helper";
  tests: TestRef[];
}
export interface ShowAction extends ActionBase {
  do: "show";
  screenByTest: Partial<Record<TestId, ScreenId>>;
  stores?: StoreKey;
}
export interface StopCheckAction extends ActionBase {
  do: "stop_check";
  screen: ScreenId;
  lock: LockKind;
}
export interface NoteAction extends ActionBase {
  do: "note";
  screen: ScreenId;
  stores?: StoreKey;
}
export type QuestionAction =
  | RecordAction
  | EmergencyAction
  | PostponeAction
  | AskAction
  | SkipAction
  | WarnAction
  | VariantAction
  | FlagAction
  | AdResponseAction
  | BoothOnlyAction
  | RequireHelperAction
  | ShowAction
  | StopCheckAction
  | NoteAction;
export type ActionDo = QuestionAction["do"];

export interface AnswerOption {
  value: OptionValue;
  label: Text;
}

/** One of the three pc_steadi questions. */
export interface SubQuestion {
  id: "fell" | "unsteady" | "worry";
  ask: Text;
  askFirstCheck?: Text;
}

export interface PrecheckItem {
  id: PrecheckId;
  group: PrecheckGroup;
  type: PrecheckType;
  showIf: ShowIf | null;
  actions: QuestionAction[];
  ask?: Text;
  /** Asked instead of ask at the first check of a series. */
  askFirstCheck?: Text;
  /** A list shown with the question (pc_urgent symptoms, pc_sci_ready checklist). */
  list?: TextList;
  options?: AnswerOption[];
  /** The Precheck field of the contract this answer fills. */
  contractKey?: "unwell" | "painNow";
  /** System items (never asked): the values they carry. */
  values?: string[];
  /** Prose: how a system item is set. */
  rule?: string;
  /** yes_no_then_areas: the area question after yes. */
  followUp?: Text;
  /** pc_surgery_recent: the areas are surgeryAreas. */
  surgeryAreas?: true;
  /** pc_surgery_recent: the clearance question per area. */
  clearAsk?: Text;
  /** area_scale_0_10: the areas are the top level areas. */
  areas?: "see areas";
  /** Asked once per pain area (pc_arm_pain_side), with {area} from areaTokens. */
  perArea?: PainArea[];
  areaTokens?: Partial<Record<PainArea, Text>>;
  /** Asked once per side, with {side} from sideTokens. */
  perSide?: true;
  sideTokens?: Record<Side, Text>;
  /** pc_pd_dose: the {x} of warn_pd_timing per dose bucket. */
  timingTokens?: Record<PdDoseBucket, Text>;
  /** three_yes_no: the questions. */
  items?: SubQuestion[];
  /** Asked once per test in this list that needs a helper, with {test} from testTokens. */
  perTest?: TestId[];
  testTokens?: Partial<Record<TestId, Text>>;
}

/** bt_pain_after and ac_next_day. */
export interface FollowQuestion<I extends BetweenTestId | AfterCheckId = BetweenTestId | AfterCheckId> {
  id: I;
  type: "single";
  /** Prose: when the question is asked. */
  when: string;
  ask: Text;
  options: AnswerOption[];
  actions: QuestionAction[];
}

/* ---------------------------------------------------------- stops and locks */

export interface StopOption {
  id: StopOptionId;
  label: Text;
  showIf?: Pick<ShowIf, "flag">;
  screen?: ScreenId;
  alsoShowIf?: { flag: PrecheckFlag; screen: ScreenId };
  /** Show this screen instead when the position matches. */
  screenWhen?: { positionIn: CheckPosition[]; screen: ScreenId };
  check:
    | "ends"
    | "as bt_pain_after"
    | "may continue with the next test after a rest"
    | "may continue with the next test";
  lock?: LockKind;
  then?: BetweenTestId;
  reason?: ReasonId;
}
export interface StopRouting {
  ask: Text;
  options: StopOption[];
  noAnswerSec: number;
  noAnswer: string;
  checkIn: {
    cue: CheckCueId;
    triggers: string[];
    okWhen: string[];
    noResponseSec: number;
    noResponse: string;
    tune_at_booth: boolean;
  };
  resultOnStop: string;
}
export interface Locks {
  /** Prose per lock reason: next_day, 60_min or none, some with a release rule. */
  rules: Record<LockReasonId, string>;
  nextDay: string;
  tune: string;
  screen: ScreenId;
}

/* -------------------------------------------------------------------- tests */

export interface StopRule {
  sign: string;
  /** A stop option id, or prose for the signs that route elsewhere. */
  route: string;
}
export interface Exclusions {
  pain: PainArea[];
  restrictions: Restriction[];
  conditions: ConditionId[];
  limbLoss: ("arm" | "leg")[];
  /** Questions that can skip or change this test on the day. */
  precheck: QuestionId[];
  /** Exclusions that apply at home only (the booth allows them with staff). */
  homeOnlyExclusion?: { restrictions?: Restriction[]; clearance?: Clearance[] };
}
export interface Equipment {
  needs: string[];
  consistency: string;
}
export interface PhoneSetup {
  view: string;
  distanceM: [number, number];
  heightM: string;
  orientation: "portrait";
  level?: string;
  framing: string;
  other: string[];
}
export interface Comparability {
  blocking: string[];
  recorded: string[];
}
export interface TestVariant<V extends VariantId> {
  id: V;
  label: Text;
  /** Prose: when this variant applies. */
  when?: string;
  /** Replaces step i (0 based) of the instruction card. */
  stepsReplace?: Record<string, Text>;
}
/** A band that is a floor or a share of the baseline: max(abs, round(pctOfBaseline x baseline)). */
export interface Band {
  abs: number;
  pctOfBaseline?: number;
  formula?: string;
}
type SideTokens = { side: Record<Side, Text> };

interface TestDefBase<I extends TestId, K extends TestKind> {
  id: I;
  version: number;
  status: SignoffStatus;
  kind: K;
  positions: CheckPosition[];
  performedSeated: boolean;
  view: "front" | "side";
  sides: "each" | "none";
  unit: TestUnit;
  better: "higher";
  practice: number;
  attempts: number;
  best: "max" | "single";
  noiseBand: number;
  exclusions: Exclusions;
  sideRules: string[];
  equipment: Equipment;
  setup: PhoneSetup;
  stopRules: StopRule[];
  comparability: Comparability;
  name: Text;
  purpose: Text;
  steps: TextList;
  safety: TextList;
  resultSentence: Text;
  resultUnit: UnitFormId;
  cues: CheckCueId[];
}

export interface ShoulderAbductionDef extends TestDefBase<"shoulder_abduction", "range_test"> {
  sideOrder: "stronger_first";
  maxRetries: number;
  holdSec: number;
  restSec: { betweenAttempts: [number, number]; betweenSides: number };
  metric: {
    id: "shoulder_abduction_deg";
    definition: string;
    fallback: string;
    planeCheck: string;
    attemptValue: string;
    stored: string[];
  };
  calibration: string;
  requiredLandmarks: {
    gate: Record<Side, number[]>;
    /** Hips, required only in the calibration frames and only in trunk reference mode. */
    gateCalibrationTrunkMode: number[];
    optional: number[];
    minVisibility: number;
  };
  validity: {
    trunkLeanCoachDeg: number;
    trunkLeanInvalidDeg: number;
    planeCheck: string;
    upperArmLengthMinRatio: number;
    shoulderWidthShrinkInvalid: number;
    elbowFlagBelowDeg: number;
    attemptSpreadFlagDeg: number;
    otherHandNearTestedArmInvalid: boolean;
    wrongArmRaisedRetry: boolean;
    shrug: string;
    tune_at_booth: boolean;
  };
  noiseBandRules: {
    compare: string;
    default: Band;
    wide: Band;
    wideWhen: string[];
    noVerdictWhen: string[];
    agreement: string;
    minValidAttempts: number;
    nearFullRangeDeg: number;
    largeDropMultiple: number;
    provisional: boolean;
  };
  resultTokens: SideTokens;
}

export interface ArmCurlDef extends TestDefBase<"arm_curl_30s", "timed_count"> {
  viewAllowance: string;
  sideOrder: "weaker_first";
  durationSec: number;
  restSec: { betweenSidesMin: number; betweenSidesMax: number };
  variants: TestVariant<ArmCurlVariantId>[];
  load: {
    ask: Text;
    options: { value: "dumbbell" | "bottle" | "cuff" | "none"; label: Text; detail?: string }[];
    help: Text;
    helpWeakerArm: Text;
    gripAsk: Text;
    practiceCheck: Text;
    stepDown: Text;
    /** Booth staff only, never shown in the app. */
    staffGuidance: string;
    rules: string[];
  };
  metric: {
    id: "elbow_flexion_angle_deg";
    definition: string;
    personalRange: string;
    countLine: string;
    d009: string;
    endRule: string;
    partial: string;
    compensated: string;
    occlusion: string;
    stored: string[];
    minFps: number;
    tune_at_booth: boolean;
  };
  requiredLandmarks: { gate: Record<Side, number[]>; optional: number[]; minVisibility: number };
  noiseBandRules: {
    compare: string;
    default: Band;
    wide: Band;
    wideWhen: string[];
    noVerdictWhen: string[];
    largeDropMultiple: number;
    provisional: boolean;
    label: string;
  };
  resultTokens: SideTokens & { load: Record<"held" | "bottle" | "cuff" | "none", Text> };
}

export interface TrunkControlDef extends TestDefBase<"trunk_control_seated", "trunk_control"> {
  /** Takes the chair stand's slot for standing users excluded from it at intake level. */
  substituteFor: { position: CheckPosition; when: string };
  sideOrder: "toward_stronger_first";
  maxRetries: number;
  holdSec: number;
  restSec: { betweenAttempts: [number, number] };
  alternateSides: boolean;
  armMode: string;
  metric: {
    id: "trunk_lateral_lean_deg";
    definition: string;
    upright: string;
    attemptValue: string;
    pivot: string;
    returnBand: string;
    secondary: string;
    invalidWhen: string[];
    flags: string[];
    contactAsk: Text;
    contact: string;
    abort: string[];
    abortNature: string;
    censoring: string;
    stored: string[];
    tune_at_booth: boolean;
  };
  requiredLandmarks: {
    gate: number[];
    /** Hips, required only in the upright baseline window. */
    gateUprightWindow: number[];
    optional: number[];
    minVisibility: number;
    rejectIf: string;
  };
  noiseBandRules: {
    compare: string;
    baseline: string;
    default: Band;
    wide: Band;
    wideWhen: string[];
    confirmation: string;
    noVerdictWhen: string[];
    minValidAttempts: number;
    largeDropMultiple: number;
    provisional: boolean;
  };
  resultTokens: SideTokens;
}

export interface ChairStandDef extends TestDefBase<"chair_stand_30s", "timed_count"> {
  cameraAngleDeg: number;
  viewNote: string;
  durationSec: number;
  restSec: { afterPractice: number; seatedAfterTest: number };
  variants: TestVariant<ChairStandVariantId>[];
  variantRules: string[];
  pushedAsk: Text;
  helperRules: string[];
  metric: {
    id: "hip_rise_ratio";
    definition: string;
    personalRange: string;
    countLine: string;
    d009: string;
    endRule: string;
    armUse: string;
    flags: string[];
    countSource: string;
    stored: string[];
    minFps: number;
    tune_at_booth: boolean;
  };
  requiredLandmarks: { gate: number[]; optional: number[]; minVisibility: number };
  noiseBandRules: {
    compare: string;
    default: Band;
    /** Band by baseline count: the first row whose min and max hold. */
    byBaseline: { min?: number; max?: number; abs: number }[];
    wide: { add: number };
    wideWhen: string[];
    noVerdictWhen: string[];
    largeDropMultiple: number;
    provisional: boolean;
    label: string;
  };
  resultTokens: { variant: Record<ChairStandVariantId, Text> };
}

export interface TestDefById {
  shoulder_abduction: ShoulderAbductionDef;
  arm_curl_30s: ArmCurlDef;
  trunk_control_seated: TrunkControlDef;
  chair_stand_30s: ChairStandDef;
}
export type TestDef = TestDefById[TestId];

/* ----------------------------------------------------------------- progress */

export type Verdict = "higher" | "same" | "lower";
export type ProgressLabelId = "start" | "now" | "change" | "trend" | "notMeasured" | "boothPoint";
export type NoVerdictId =
  | "shoulderPain"
  | "setupDiffers"
  | "movementDifferent"
  | "chairLimit"
  | "oneValid"
  | "selfCount"
  | "censored";
/** Arabic plural categories of Intl.PluralRules("ar"). */
export type ArabicPluralForm = "zero" | "one" | "two" | "few" | "many" | "other";
export interface UnitForms {
  ar: Record<ArabicPluralForm, string>;
  en: Record<"one" | "other", string>;
}

export interface ProgressRules {
  retestDays: number;
  minHoursBetweenChecks: number;
  earlyCheck: string;
  trendsFromCheck: number;
  compareLikeWithLike: string;
  values: string;
  verdicts: Record<Verdict, Text>;
  labels: Record<ProgressLabelId, Text>;
  bandSentence: Text;
  unitForms: Record<UnitFormId, UnitForms>;
  /** Prose: how digits are shown in Arabic (implemented in src/i18n). */
  digits: string;
  lowerExtra: Text;
  largeDrop: { rule: string; text: Text; oneSidedRule: string; symptomAsk: Text };
  noVerdict: Record<NoVerdictId, Text>;
  startingPointSet: Text;
  notComparable: Text;
  nearFullRange: Text;
  unconfirmed: Text;
  milestone: Text;
  nextDue: Text;
  /** Stems that never appear in progress copy. */
  forbiddenInProgressText: { matching: string; en: string[]; ar: string[] };
}

/* ----------------------------------------------------------- cues, selection */

/** A voice cue: display text, fully vocalized Arabic for speech, and English. */
export interface CueLine {
  id: CheckCueId;
  ar: string;
  arTts: string;
  en: string;
}

export interface Selection {
  gate: string;
  basePerPosition: Record<SelectionPosition, TestId[]>;
  substitution: string;
  order: string;
  setting: Record<Setting, string>;
  clearance: string;
  guestBooth: string;
  sessionMinutes: [number, number];
  conditionNotes: Record<ConditionId, string>;
}

/* -------------------------------------------------------------------- root */

export interface CheckData {
  id: "movement_check";
  version: number;
  status: SignoffStatus;
  signoff: Signoff;
  boundary: Record<BoundaryId, Text>;
  areas: Area[];
  surgeryAreas: SurgeryArea[];
  engine: EngineConfig;
  precheck: PrecheckItem[];
  betweenTests: FollowQuestion<BetweenTestId>[];
  afterCheck: FollowQuestion<AfterCheckId>[];
  stopRouting: StopRouting;
  locks: Locks;
  screens: Record<ScreenId, Text>;
  pausedWhenTokens: Record<LockKind, Text>;
  reasons: Record<ReasonId, Text>;
  postponeReasons: Record<PostponeReasonId, ScreenId>;
  tests: TestDef[];
  progress: ProgressRules;
  cues: CueLine[];
  selection: Selection;
}

/**
 * The shape of T with every literal widened to its primitive (and tuples to arrays), which is how
 * TypeScript types an imported JSON file. `json satisfies Widen<CheckData>` checks at compile time
 * that the JSON has every field of the types, with the right nesting and primitive types; the
 * literal values are checked against the id lists above by tests/movement-data.test.ts.
 */
export type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null | undefined
        ? T
        : T extends readonly (infer U)[]
          ? Widen<U>[]
          : { [K in keyof T]: Widen<T[K]> };
