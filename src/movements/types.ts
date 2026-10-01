/**
 * Types for the runtime movement check data, src/movements/check-v1.json (contract v2, section A).
 *
 * The JSON is written by scripts/clinical/export-check.mjs from the clinical spec
 * (local-docs/clinical/movement-check-v1.1.json: movement check version 1, revision 1.1, contract v3
 * H). Closed sets in the JSON are literal unions here.
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
  "pc_faint_since",
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
  "pc_helper",
  "pc_after_last",
] as const;
export type PrecheckId = (typeof PRECHECK_IDS)[number];
export const BETWEEN_TEST_IDS = ["bt_pain_after"] as const;
export type BetweenTestId = (typeof BETWEEN_TEST_IDS)[number];
export const AFTER_CHECK_IDS = ["ac_next_day"] as const;
export type AfterCheckId = (typeof AFTER_CHECK_IDS)[number];
/** The faint follow up after a faint or a fall stop (S38b, Q33 (3), O42). */
export const STOP_FOLLOW_UP_IDS = ["sf_faint_loc"] as const;
export type StopFollowUpId = (typeof STOP_FOLLOW_UP_IDS)[number];
/** The end of check symptom question, asked before results (S49, Q23 (7)). */
export const END_OF_CHECK_IDS = ["ec_symptoms"] as const;
export type EndOfCheckId = (typeof END_OF_CHECK_IDS)[number];
/** The chair stand setup questions at home (Q9). */
export const SETUP_QUESTION_IDS = ["su_chair_gate", "su_same_chair"] as const;
export type SetupQuestionId = (typeof SETUP_QUESTION_IDS)[number];
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
  "scr_booth_no_check",
  "scr_sound_off",
  "scr_sound_still_off",
  "scr_early_start",
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

/** Skip, variant and stop reasons shown with a result (spec 3.6). */
export const REASON_IDS = [
  "restriction_overhead",
  "restriction_weight_bearing",
  "restriction_balance",
  "pain_area",
  "pain_today",
  "pain_more",
  "flare",
  "limb_loss_arm",
  "limb_loss_leg",
  "position_seated",
  "clearance",
  "clearance_booth",
  "booth_offer",
  "helper_needed",
  "booth_only_trunk",
  "armrests_needed",
  "chair_needed",
  "pusher",
  "weak_shoulder",
  "arm_not_able",
  "pressure_sore",
  "recent_surgery",
  "by_choice",
  "quality",
  "stopped_symptom",
  "needed_arms",
  "needed_support",
  "motion_needed",
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
// SPEC-GAP: stop-symptom-id. The lock for a symptom stop is stop_symptom here, while the reason shown
// with the stopped test is stopped_symptom (reasons); the two ids are kept apart as in the data.
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
/** Lock durations (locks.rules). The {when} line of a lock comes from pausedWhenTokens (Q33 (4)). */
export type LockKind = "next_day" | "60_min";
/** The lock of an action; none means allowed again at once (pc_sci_ready). */
export type ActionLock = LockKind | "none";

export const CHECK_CUE_IDS = [
  "check_intro",
  "check_sound",
  "check_stop_any_time",
  "check_phone_steady",
  "check_phone_level",
  "check_phone_still",
  "check_whole_body",
  "check_face_phone",
  "check_left_side_to_phone",
  "check_right_side_to_phone",
  "check_phone_angle_right",
  "check_phone_angle_left",
  "check_move_back",
  "check_move_closer",
  "check_light",
  "check_one_person",
  "check_clear_view",
  "check_sleeves",
  "check_ready",
  "check_go",
  "check_ten_left",
  "check_time_up_stand",
  "check_time_up_curl",
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
  "check_stop_why",
  "check_are_you_ok",
  "check_faint_loc",
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
/** Cues retired in revision 1.1 (cuesRetired): never generated, shipped or played. */
export const RETIRED_CUE_IDS = ["check_time_stop"] as const;
export type RetiredCueId = (typeof RETIRED_CUE_IDS)[number];

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
  /** R3C-27: loads the chair stand. */
  "ankle_foot",
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
  "ankle_foot",
  "chest_belly",
  /** R3C-27: an area the check cannot place, with the widest listed restriction. */
  "other",
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
// SPEC-GAP: contract-variants. Contract v2 B types ProtocolItem.variant as arm_only, arms_assisted,
// one_arm_cross, standard or hands_allowed; the data has no hands_allowed (its label for
// arms_assisted is "Hands allowed") and adds held, cuff and arms_assisted_steady.
export type VariantId = ArmCurlVariantId | ChairStandVariantId;
/**
 * Variants set by pre-check actions. Besides test variants these include two modifiers that are not
 * variant ids of any test: push_stronger_hand_only (the hands allowed chair stand pushes with the
 * stronger hand, stored as pushHand) and cuff_or_arm_only (the arm curl load is limited to a wrist
 * weight or none).
 */
// SPEC-GAP: variant-modifiers (push_stronger_hand_only, cuff_or_arm_only are not test variant ids).
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
  | "lasting"
  | "done"
  | "not_yet";
export type PdDoseBucket = "lt1h" | "1to2h" | "2to3h" | "gt3h";

/* ---------------------------------------------------------------- top level */

/** A user facing line with its fully vocalized Arabic speech form, when it is spoken. */
export interface SpokenText extends Text {
  arTts?: string;
}
/** A spoken line whose speech form exists (arTts is required). */
export interface Spoken extends Text {
  arTts: string;
}
/** A spoken list: display items in both languages and the speech form of each Arabic item. */
export interface SpokenList extends TextList {
  arTts?: string[];
}

export interface Signoff {
  status: SignoffStatus;
  medical: string | null;
  fitness: string | null;
  date: string | null;
  /** Revision 1.1: approved only when Nasser (medical) and Chaker (fitness) ratify. */
  approved: boolean;
  approvers: string[];
  ratification: string;
  council: string;
}

export type BoundaryId =
  "line" | "notMedical" | "firstResult" | "consent" | "storageNotice" | "precheckNotice" | "resultsFooter";

/** Boundary lines, placement rules and the public wording guard (spec 1, Q23, Q29, H5). */
export type Boundary = Record<BoundaryId, Text> & {
  /** Where the not intended for medical purposes line sits (Q23 (2)). */
  notMedicalPlacement: string;
  /** The 18 or older confirmation (Q2 (5), Q32 (6), 7.2-6). */
  adultConfirm: Text & { when: string; status: string };
  /** The research opt in (phase 2, Q1 (3)). */
  researchOptIn: Text & { phase: number; rule: string };
  /** Words no public copy uses (Q23 (6), H2). */
  bannedPublicWording: { rule: string; enWords: string[]; arWords: string[]; manual: string };
};

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
  /** Prose (Another area, R3C-27). */
  rule?: string;
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
  /** S14b sound check on the intro of every check (Q31 (1)). */
  soundCheck: {
    cue: CheckCueId;
    options: { value: "yes" | "no"; label: Text }[];
    onNo: string;
    audioSession: string;
  };
  /** The workout trunk safety stop (S0), for src/exercises/defs.ts and the rep engine. */
  coachingTrunkStop: CoachingTrunkStop;
}

/** S0: the relative 15 degree stop and the absolute caps of the seated press and curl. */
export interface CoachingTrunkStop {
  appliesTo: string[];
  keepCoachingValuesAsTrueAngles: {
    pressSteadyTrunkDeg: number;
    curlSteadyTrunkDeg: number;
    sitToStandStandFullyDeg: number;
    pressEvenArmsDeg: number;
    curlEvenArmsDeg: number;
    shoulderHike: number;
  };
  replaces: string;
  relativeDeg: number;
  relativeRule: string;
  absoluteCapDeg: { press: { either: number }; curl: { forward: number; backward: number } };
  curlForward: string;
  whicheverFirst: boolean;
  blockStart: string;
  cue: Spoken & { short: Text; status: string };
  ship: string;
  record: string;
  tests: string;
  retune: string;
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
  | "list_confirm"
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
  previousFollowUp?: "lasting_unresolved";
  /** A faint stop stored faintReported and no pc_faint_since answer has cleared it (Q33 (3)). */
  faintReportedUnresolved?: true;
  /** The person declared a weaker side (chronicNote display rule, O37). */
  weakerSide?: true;
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
  /** pc_steadi: any of the three answers is yes. */
  anyYes?: true;
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
  | "assessment.followUp"
  | "faintReported"
  | "faintReported cleared";

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
  /** pc_urgent yes also stores changeReported (Q33 (2)). */
  stores?: StoreKey;
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
  /** The helper briefing screen of each test (helperBriefing). */
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
  label: SpokenText;
}

/** Examples under a question at home (O45): the question alone, then a read list. */
export interface QuestionExamples {
  heading: Spoken;
  ask: Spoken;
  askFirstCheck?: Spoken;
  list: SpokenList;
  rule: string;
}
/** A line shown above the answers for long standing signs (O37), not shown until tested. */
export interface ChronicNote extends Spoken {
  showIf: ShowIf;
  display: string;
  status: string;
  /** endOfCheck: the forms it is shown with. */
  appliesTo?: string;
}
/** A wording change still waiting for another seat (the v1.1 text stands until then). */
export interface WordingPending {
  status: string;
  problem: string;
  proposal: { ask: Text; listItem: Spoken; why: string };
  alternatives: string[];
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
  ask?: SpokenText & {
    /** pc_helper: the speech form per {test} token. */
    arTtsByTest?: Partial<Record<TestId, string>>;
  };
  /** Asked instead of ask at the first check of a series. */
  askFirstCheck?: Text;
  /** pc_trunk_armrests: the question by position (Q12 (1)); a standing person sits on a chair. */
  askByPosition?: Record<"chair" | "wheelchair", Text>;
  /** pc_change_cleared: the form asked directly for an unresolved changeReported (Q33 (2)). */
  askDirect?: Text;
  /** A list shown with the question (pc_urgent symptoms, pc_sci_ready items). */
  list?: SpokenList;
  /** Display rule of the question (one answer under a list, a read aloud list). */
  display?: string;
  /** pc_urgent: the long standing signs line (O37). */
  chronicNote?: ChronicNote;
  /** pc_change, pc_unwell: the examples list at home (O45). */
  examples?: QuestionExamples;
  /** pc_ms_heat: why it stays one sentence (O45). */
  examplesNote?: string;
  /** pc_unwell: the faint wording the medical seat still decides. */
  faintWordingPending?: WordingPending;
  /** Prose: the input control (the pain scale, Q7). */
  input?: string;
  /** pc_helper: which tests it is asked for (O34-2). */
  perTestRule?: string;
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
  timingTokens?: Record<PdDoseBucket, SpokenText>;
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
  ask: SpokenText;
  options: AnswerOption[];
  actions: QuestionAction[];
}

/* ---------------------------------------------------------- stops and locks */

export interface StopOption {
  id: StopOptionId;
  label: Text;
  /** The urgent options come first as one group (Q31 (3)). */
  group: "urgent" | "other";
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
  /** The question after the stop: bt_pain_after, or the faint follow up (sf_faint_loc, Q33, O42). */
  then?: BetweenTestId | StopFollowUpId;
  reason?: ReasonId;
  /** What the stop keeps: changeReported (chest, stroke_signs, breath) or faintReported (Q33). */
  stores?: StoreKey;
}
/**
 * The optional check in (D-016): off by default, a per device setting, never at the booth. During a
 * camera test the person out of the picture for leftFrameSec, or no movement for noMovementSec, pauses
 * the test and asks with `cue`; no answer within noAnswerSec plays one chime.
 */
export interface CheckIn {
  decision: string;
  setting: string;
  triggers: string[];
  leftFrameSec: number;
  noMovementSec: number;
  cue: CheckCueId;
  answers: string;
  noAnswerSec: number;
  noAnswer: string;
  off: string;
}
export interface StopRouting {
  ask: Text;
  /** The one cue that asks the list (check_stop_why, Q31 (3)). */
  askCue: CheckCueId;
  layout: string;
  options: StopOption[];
  checkIn: CheckIn;
  resultOnStop: string;
}
export interface Locks {
  /** Prose per lock reason: next_day, 60_min or none, some with a release rule. */
  rules: Record<LockReasonId, string>;
  /** The lock record: { until, releasableByClearance }, without the reason id (Q25 (c)). */
  record: string;
  /** Next day: the later of local midnight and 8 hours after the start (Q33 (1)). */
  nextDay: string;
  minHoursBetweenChecks: string;
  tune: string;
  api: string;
  screen: ScreenId;
}
/** {when} of scr_paused_today, chosen by when the lock ends (Q33 (4)). */
export type PausedWhenId =
  "min60_start" | "min60_active" | "nextDay_midnight" | "nextDay_clock" | "sameDay_clock";
export type PausedWhenTokens = Record<PausedWhenId, Text & { when: string }> & {
  timeSuffix: { am: Text; pm: Text };
};

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
  /** Intake clearance answers that exclude this test at home and at the booth (D-016). */
  clearance?: Clearance[];
  /** Exclusions that apply at home only (the booth allows them with staff). */
  homeOnlyExclusion?: { restrictions?: Restriction[] };
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
  /** Chair stand (P4): the top down setup picture, the clear view cue rule, the booth layout. */
  picture?: string;
  clearView?: string;
  booth?: string;
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
  /** Replaces step i (0 based) of the instruction card, with its speech form (and a short form). */
  stepsReplace?: Record<string, SpokenText & { short?: Text }>;
  /** Prose: the arm cue of the camera part (one_arm_cross, R3C-26). */
  armCue?: string;
}
/** A line on the instruction card (S28) with the safety notes, shown when its condition holds. */
export interface CardNote<
  S = string | { variant: VariantId } | { answer: Partial<Record<PrecheckId, OptionValue>> },
> extends Spoken {
  id: string;
  /** Prose, a variant, or a pre-check answer. */
  showIf: S;
  rule?: string;
  /** Pending lines are not shown until the named seat confirms them. */
  status?: string;
}
/** A safety note whose new text waits for confirmation; safety[index] stands until then (7.2-13). */
export interface SafetyPending extends Spoken {
  index: number;
  replaces: Text;
  status: string;
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
  /**
   * The card's three steps (S28, C12): where to sit, where the phone goes, the movement, with the
   * speech form of each Arabic step (O24-7).
   */
  steps: SpokenList;
  stepsRule: string;
  /** Safety notes, spoken with the steps (O24-7). */
  safety: SpokenList;
  /** The safety note that names every stop condition: the card's one stop block (C12). */
  safetyStop: number;
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
    /** Council F-1 outcome W: the ratio booth staff may switch the plane check to (never at home). */
    upperArmLengthMinRatioBoothFallback: number;
    boothFallback: string;
    shoulderWidthShrinkInvalid: number;
    elbowFlagBelowDeg: number;
    attemptSpreadFlagDeg: number;
    otherHandNearTestedArmInvalid: boolean;
    wrongArmRaisedRetry: boolean;
    shrug: string;
    tune_at_booth: boolean;
    configurable: string;
    /** Each coaching cue plays at most this often per attempt (Q14). */
    cueMaxPerAttempt: Partial<Record<CheckCueId, number>>;
    verification: string;
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
  safetyPending: SafetyPending[];
}

export interface ArmCurlDef extends TestDefBase<"arm_curl_30s", "timed_count"> {
  /** The safety notes about the load: shown only when an arm runs with a load (C13). */
  safetyLoadOnly: number[];
  safetyLoadOnlyRule: string;
  viewAllowance: string;
  sideOrder: "weaker_first";
  durationSec: number;
  restSec: { betweenSidesMin: number; betweenSidesMax: number };
  variants: TestVariant<ArmCurlVariantId>[];
  load: {
    ask: Text;
    options: { value: "dumbbell" | "bottle" | "cuff" | "none"; label: Text; detail?: string }[];
    /** Bottle sizes in liters, shown and spoken in words (Q30). */
    bottleSizes: { value: 0.5 | 1 | 1.5; label: Text }[];
    help: Text;
    helpWeakerArm: Text;
    gripAsk: Text;
    practiceCheck: Spoken;
    stepDown: Text;
    rules: string[];
    /** Phase 2: the one step heavier load offer (Q26). */
    progression: LoadProgression;
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
    /** The counter freezes at 30.0 s (Q4). */
    display: string;
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
    /** Q27: the band widening at the first re-test of a series, in counts. */
    firstRetest: string;
    firstRetestAdd: number;
  };
  resultTokens: SideTokens & {
    load: Record<"held" | "bottle_half" | "bottle_1" | "bottle_1_5" | "cuff" | "none", Text>;
  };
  cardNotes: CardNote<string>[];
  cardNotesPending: CardNote<string>[];
  safetyPending: SafetyPending[];
}

/** Q26: offer, never impose, one load step heavier on an arm (phase 2, home). */
export interface LoadProgression {
  phase: number;
  setting: Setting;
  triggers: string[];
  step: string;
  neverOffered: string[];
  then: string;
  offer: Text;
  buttons: { value: "heavier" | "same"; label: Text }[];
  buttonRule: string;
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
    contactAsk: Spoken;
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
  /** P3: a large attempt counter readable from 2 m, {n} of 3. */
  attemptCounter: Text & { rule: string };
  /** P3: the practice lean can be skipped for fatigue. */
  practiceSkippableForFatigue: boolean;
}

export interface ChairStandDef extends TestDefBase<"chair_stand_30s", "timed_count"> {
  /** The chair and support setup our team does at the booth: the S58 staff tips (R3C-33, C12). */
  boothSetup: SpokenList & { rule: string };
  cameraAngleDeg: number;
  viewNote: string;
  durationSec: number;
  restSec: { afterPractice: number; seatedAfterTest: number };
  variants: TestVariant<ChairStandVariantId>[];
  variantRules: string[];
  pushedAsk: Spoken;
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
    /** The counter freezes at 30.0 s (Q4). */
    display: string;
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
    /** Q27: the band widening at the first re-test of a series, in counts. */
    firstRetest: string;
    firstRetestAdd: number;
  };
  resultTokens: { variant: Record<ChairStandVariantId, Text> };
  cardNotes: CardNote<{ variant: VariantId } | { answer: Partial<Record<PrecheckId, OptionValue>> }>[];
  safetyPending: SafetyPending[];
  /** Recorded for phase 3 (Q10, P6). */
  phase3: string[];
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
  /** symptomAsk is prose in revision 1.1: the end of check question (endOfCheck) replaced it (Q23). */
  largeDrop: { rule: string; text: Text; oneSidedRule: string; symptomAsk: string };
  noVerdict: Record<NoVerdictId, Text>;
  startingPointSet: Text;
  notComparable: Text;
  nearFullRange: Text;
  unconfirmed: Text;
  milestone: Text;
  nextDue: Text;
  /** Stems that never appear in progress copy. */
  forbiddenInProgressText: { matching: string; en: string[]; ar: string[] };
  /** Q1: the bands are provisional; the rules for a band of Azm's own. */
  bandReplacement: {
    provisional: boolean;
    mdc: string;
    replacesOnlyWhen: string;
    floors: Record<TestId, number>;
    floorRule: string;
    dataSource: string;
  };
  /** Q12 (2): the side lean only session that sets the second baseline check. */
  sideLeanSecondBaseline: { window: string; rule: string; offer: Text; ships: string };
  /** Q27: the band widening at the first re-test of the timed tests. */
  firstRetest: string;
  shaddaRule: string;
  noVerdictDisplay: string;
  boothExample: string;
  boothToHome: string;
  clinicianInterval: string;
  skippedTests: string;
}

/* ----------------------------------------------------------- cues, selection */

/** A voice cue: display text, fully vocalized Arabic for speech, and English. */
export interface CueLine {
  id: CheckCueId;
  ar: string;
  arTts: string;
  en: string;
  /** The caption short form, display only, at most 3 words (O24-1, cueShortRule). */
  short: Text;
}
/** A retired cue (cuesRetired): kept for the record, never generated, shipped or played. */
export interface RetiredCue {
  id: RetiredCueId;
  ar: string;
  arTts: string;
  en: string;
  replacedBy: CheckCueId[];
  decision: string;
  why: string;
}

export interface Selection {
  gate: string;
  basePerPosition: Record<SelectionPosition, TestId[]>;
  substitution: string;
  order: string;
  setting: Record<Setting, string>;
  clearance: string;
  guestBooth: GuestBooth;
  /** Q31 (6): home checks open only when every gate is recorded as met. */
  homeGates: { boothBuild: string; gates: string[]; target: string; cognitiveTestMethod: string };
  /** O40: the duration is computed per person (estimateMinutes in src/medical/assessment.ts). */
  sessionMinutes: SessionMinutes;
  conditionNotes: Record<ConditionId, string>;
}

/** Starting estimates of estimateMinutes, [from, to] in minutes (O40, UX spec S27). */
export interface SessionMinutes {
  computed: string;
  includes: string;
  startingEstimatesMinutes: {
    overhead: [number, number];
    guestSteps: [number, number];
    precheck: [number, number];
    precheckWithConditionQuestions: [number, number];
    shoulder_abduction: [number, number];
    arm_curl_30s_noLoad: [number, number];
    arm_curl_30s_withLoad: [number, number];
    trunk_control_seated: [number, number];
    helperBriefing: [number, number];
    chair_stand_30s: [number, number];
  };
  status: string;
  target: string;
  replaces: string;
}

/** The guest steps at the booth (Q19). */
export interface GuestBooth {
  conditionsStep: { title: Text; helper: Text; chips: string; noneChip: Text };
  clearance: {
    ask: Text;
    hint: Text & { status: string };
    options: { value: Clearance; label: Text }[];
    rule: string;
  };
  answering: string;
  privacy: string;
  /** Prose: routing (a) no check, (b) the booth arm raise only, (c) everyone else. */
  routing: string[];
  signedIn: string;
  afterEachTest: { buttons: { value: "next" | "results"; label: Text }[]; rule: string };
}

/* ---------------------------------------------------- revision 1.1 sections */

/** Pre-check presentation rules (Q18, O11b), prose for the UI. */
export interface PrecheckRules {
  interaction: string;
  timeBudget: string;
  fixedItems: string;
  /** Day of items asked at every check they apply to (Q18 (7)). */
  everyTimeItems: string[];
  everyTimeRule: string;
  review: string;
  interactionStatus: string;
}
/** The 0 to 10 pain scale (Q7). */
export interface PainScale {
  buttons: number;
  rows: number[][];
  minSizePx: number;
  order: string;
  anchors: { zero: Text; ten: Text };
  preselected: "none";
  never: string;
}
/** The faint follow up (S38b): after scr_faint, and after every fall stop (Q33 (3), O42). */
export interface StopFollowUp {
  id: StopFollowUpId;
  type: "yes_no_unsure";
  when: string;
  ask: Text;
  options: AnswerOption[];
  actions: (
    | { if: { in: OptionValue[] }; do: "emergency"; screen: ScreenId; stores: StoreKey }
    | { if: { equals: OptionValue }; do: "record"; lock: LockKind }
  )[];
}
/**
 * The end of check symptom question (S49, Q23 (7)): a short lead and the signs as a list (C18), in
 * the general form and the side form.
 */
export interface EndOfCheckQuestion {
  id: EndOfCheckId;
  type: "yes_no";
  when: string;
  ask: Spoken;
  list: SpokenList;
  /** The side form: {side} in the first line, the speech of each line per side. */
  listSide: TextList & { arTtsBySide: Record<Side, string[]> };
  display: string;
  sideTokens: Record<Side, Spoken>;
  speech: string;
  chronicNote: ChronicNote;
  sideTrigger: string;
  options: AnswerOption[];
  actions: { if: { equals: OptionValue }; do: "emergency"; screen: ScreenId; stores: StoreKey }[];
}
/** The helper briefing (Q11). */
export interface HelperBriefing {
  heading: Text;
  voice: string;
  picture: string;
  steadyRule: string;
  closing: string;
  confirmButton: Text;
  startGate: string;
  pronouns: string;
}
/** The call button of every screen that names 997 (Q22). */
export interface EmergencyCall {
  button: Text & { href: string };
  firstActionOn: string;
  bigNumberOn: ScreenId[];
  bigNumberMinPx: number;
  bigNumberRule: string;
  numbers: string;
}
/** The chair stand setup questions at home (Q9). */
export interface SetupQuestion {
  id: SetupQuestionId;
  test: TestId;
  type: "yes_no" | "yes_no_unsure";
  showIf: ShowIf;
  screen: string;
  ask: Text;
  options: AnswerOption[];
  actions: (
    | { if: { equals: OptionValue }; do: "skip"; tests: TestRef[]; reason: ReasonId }
    | { if: { in: OptionValue[] }; do: "record"; stores: string }
  )[];
}
/** Voice lines still waiting for generation or approval by ear. */
export interface VoicePending {
  rule: string;
  lines: string[];
  copyPass: string;
  ttsConvention: string;
  earCheckFirst: string;
}
/** Phase 2: how the person likes to be addressed in Arabic (Q24). */
export interface AddressPreference {
  phase: number;
  ask: Text;
  options: { value: "masculine" | "feminine"; label: Text }[];
  v1: string;
  set: string;
  storage: string;
}
/** A screen or warning: display text, speech form and the extras some screens carry. */
export interface Screen extends Spoken {
  /** scr_paused_today: only the first sentence is spoken (O24-2). */
  arTtsScope?: string;
  /** warn_pd_timing: where the speech form of {x} comes from. */
  arTtsTokens?: string;
  /** scr_ad: the conditional lead of the AD card on S36 (O12 (3)), pending the medical seat. */
  emergencyLead?: Spoken & { showOn: string; status: string };
  /** scr_ad: the card after scr_faint_sci for sci_t6 (O24-6). */
  cardOnFaintSci?: string;
}

/* -------------------------------------------------------------------- root */

export interface CheckData {
  id: "movement_check";
  version: number;
  /** "1.1": movement check version 1, revision 1.1 (contract v3 H). */
  specVersion: string;
  status: SignoffStatus;
  signoff: Signoff;
  boundary: Boundary;
  areas: Area[];
  surgeryAreas: SurgeryArea[];
  engine: EngineConfig;
  precheckRules: PrecheckRules;
  painScale: PainScale;
  precheck: PrecheckItem[];
  betweenTests: FollowQuestion<BetweenTestId>[];
  stopFollowUps: StopFollowUp[];
  endOfCheck: EndOfCheckQuestion[];
  afterCheck: FollowQuestion<AfterCheckId>[];
  stopRouting: StopRouting;
  locks: Locks;
  screens: Record<ScreenId, Screen>;
  earlyStartButtons: { value: "start" | "later"; label: Text }[];
  helperBriefing: HelperBriefing;
  emergencyCall: EmergencyCall;
  pausedWhenTokens: PausedWhenTokens;
  reasons: Record<ReasonId, Text & { when?: string }>;
  /** Every reason id, sorted (O33 (m)); equals REASON_IDS as a set. */
  reasonIds: ReasonId[];
  reasonSuffixes: { substituteRan: Text & { appendTo: ReasonId[]; rule: string } };
  postponeReasons: Record<PostponeReasonId, ScreenId>;
  setupQuestions: SetupQuestion[];
  tests: TestDef[];
  progress: ProgressRules;
  cues: CueLine[];
  cueShortRule: string;
  cuesRetired: RetiredCue[];
  voicePending: VoicePending;
  addressPreference: AddressPreference;
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
