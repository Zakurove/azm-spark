/**
 * The v7 contraindications (product v7 contract 2.10, stream E, step E1): which ids of the exercise
 * targets contraindication vocabulary hold for a person. libraryPool applies the ids the intake
 * decides, for every caller and in every build (2.10 rule 2); selectForTargets adds the ids of the
 * range profile and the gait plan on top.
 *
 * Rules before AI: the vocabulary writes each id's meaning in words
 * (TARGETS_DATA.contraindicationVocabulary), so each rule is written here quoting it. An answer the
 * intake never holds (a day answer of the pre-check, the range profile, the gait plan) is never
 * guessed from the intake.
 *
 * Shared like body-map.ts: libraryPool runs in every build, so this module reads no v7 data at
 * runtime. Its id lists and numbers are code constants that tests/v7/e-contraindications.test.ts
 * checks against TARGETS_DATA (C-1). Pure, no DOM.
 */
import { REGION_IDS, type RegionEntry, type RegionId, type SinceBucket } from "./body-map";
import type { GaitNotOffered, GaitPlan } from "./gait-eligibility";
import type { Intake } from "./plan";
import type { RomProfile } from "./rom-types";
import type { ExercisePosition } from "./target-types";

/* ------------------------------------------------------------- id lists */

/** The vocabulary ids of kind "new" that are not generated per region. */
const V7_FLAT_IDS = [
  "osteoporosis_spine",
  "spine_surgery_recent",
  "neck_caution",
  "weak_shoulder",
  "no_active_movement",
  "walk_not_eligible",
  "pad_not_eligible",
  "hip_precautions_posterior",
  "hip_precautions_anterior",
  "hip_precautions_posterior_unless_raised_seat",
  "achilles",
  "knee_hyperextension",
  "standing_gate",
  "seated_lean_gate",
  "pusher",
  "no_trunk_armrests",
  "weak_arm_no_active_shoulder",
  "wheelchair_needs_transfer",
  "sitting_balance",
  "overhead_load_wheelchair_sci",
] as const;

/** The ids the vocabulary generates from the body map, one per region: `<kind>:<region>`. */
export const REGION_ID_KINDS = [
  "region_not_cleared",
  "region_early_post_op",
  "region_acute_injury",
  "region_red_flag",
] as const;
export type RegionIdKind = (typeof REGION_ID_KINDS)[number];
export const regionId = (kind: RegionIdKind, region: RegionId): string => `${kind}:${region}`;

/** The vocabulary ids of kind "new" (the v1 pool does not know them), each region template per region. */
export const V7_ONLY_IDS: ReadonlySet<string> = new Set([
  ...V7_FLAT_IDS,
  ...REGION_ID_KINDS.flatMap((kind) => REGION_IDS.map((region) => regionId(kind, region))),
]);

/* --------------------------------------------------------------- numbers */

/** A window of the vocabulary: weeks or months since an injury or a surgery. */
export type SinceWindow = "6w" | "12w" | "3m" | "6m";

/**
 * The body map's since buckets inside each window. The intake asks in four buckets (lt6w, 6w_3m,
 * 3m_6m, gt6m), so 12 weeks reads as the 3 month boundary, as the intake asks it (A2-6).
 */
export const WINDOW_BUCKETS: Readonly<Record<SinceWindow, readonly SinceBucket[]>> = {
  "6w": ["lt6w"],
  "12w": ["lt6w", "6w_3m"],
  "3m": ["lt6w", "6w_3m"],
  "6m": ["lt6w", "6w_3m", "3m_6m"],
};

/** The window of each dated id (the vocabulary's months and weeks); a region kind stands for its ids. */
export const ID_WINDOWS = {
  spine_surgery_recent: "3m",
  hip_precautions_posterior: "3m",
  hip_precautions_anterior: "3m",
  achilles: "6m",
  region_not_cleared: "3m",
  region_early_post_op: "12w",
  region_acute_injury: "6w",
} as const satisfies Record<string, SinceWindow>;

/** knee_hyperextension: «Pillar 1 knee past straight by 5 or more» (a lack of minus 5 or less). */
export const KNEE_PAST_STRAIGHT_GTE = 5;

/** seated_lean_gate: «back pain 6 or more», a score of the day that selectForTargets reads (E2). */
export const SEATED_LEAN_BACK_PAIN_AT = 6;

/* --------------------------------------------------------- forms and positions */

/**
 * The ids that close forms of an exercise rather than the exercise, with the positions each closes:
 * standing_gate is «the v1.1 chair stand exclusions and helper rules for standing items», and
 * sitting_balance removes «items done near the front of a chair without the backrest
 * (seated_forward)». An exercise that has another position keeps it (the clinical notes: «mixed items
 * show only their seated form to people who do not stand»).
 */
export const POSITION_IDS: Readonly<Partial<Record<string, readonly ExercisePosition[]>>> = {
  standing_gate: ["standing", "standing_supported"],
  sitting_balance: ["seated_forward"],
};

/**
 * The ids that close a form no position names: pad_not_eligible «Applies to the walking pad form
 * only ...; the overground form stays available», so it never closes the exercise.
 */
export const FORM_ONLY_IDS: ReadonlySet<string> = new Set(["pad_not_eligible"]);

/**
 * The positions an exercise keeps once the ids that hold close theirs, or null when it is closed: any
 * other id that holds closes the whole exercise, as does a position id on an exercise without
 * positions. An exercise without positions and without a closing id is open ([]).
 */
export function openPositions(
  e: { positions?: readonly ExercisePosition[]; contraindications: readonly string[] },
  holding: ReadonlySet<string>,
): ExercisePosition[] | null {
  let open: ExercisePosition[] = [...(e.positions ?? [])];
  for (const id of e.contraindications) {
    if (!holding.has(id) || FORM_ONLY_IDS.has(id)) continue;
    const closes = POSITION_IDS[id];
    if (!closes || !open.length) return null;
    open = open.filter((p) => !closes.includes(p));
    if (!open.length) return null;
  }
  return open;
}

/* ---------------------------------------------------------------- regions */

/**
 * The body map region of each muscle group and joint movement of the targets taxonomy
 * (TARGETS_DATA.taxonomy muscleGroups and jointMovements, each with its region; a balance or practice
 * target has none). A code constant, so libraryPool reads no v7 data; tests/v7/e-contraindications
 * checks it against the taxonomy (C-1).
 */
export const TARGET_REGIONS: Readonly<Record<string, RegionId>> = {
  neck_side: "neck",
  neck_back: "neck",
  neck_deep_flexors: "neck",
  shoulder_flexors: "shoulder",
  shoulder_abductors: "shoulder",
  shoulder_extensors: "shoulder",
  shoulder_back: "shoulder",
  chest: "shoulder",
  scapular_retractors: "shoulder",
  elbow_flexors: "elbow",
  elbow_extensors: "elbow",
  forearm_grip: "forearm_wrist",
  abdominals: "back_trunk",
  trunk_side: "back_trunk",
  back_extensors: "back_trunk",
  hip_flexors: "hip",
  hip_extensors: "hip",
  hip_abductors: "hip",
  hip_adductors: "hip",
  quadriceps: "knee",
  hamstrings: "knee",
  calf: "ankle_foot",
  ankle_dorsiflexors: "ankle_foot",
  shoulder_external_rotators: "shoulder",
  shoulder_depressors: "shoulder",
  shoulder_flexion: "shoulder",
  shoulder_abduction: "shoulder",
  shoulder_extension: "shoulder",
  elbow_extension: "elbow",
  elbow_flexion: "elbow",
  wrist: "forearm_wrist",
  hand: "forearm_wrist",
  hip_flexion: "hip",
  hip_extension: "hip",
  hip_abduction: "hip",
  knee_flexion: "knee",
  knee_extension: "knee",
  ankle_dorsiflexion: "ankle_foot",
  ankle_plantarflexion: "ankle_foot",
  trunk_flexion: "back_trunk",
  trunk_lateral_flexion: "back_trunk",
  trunk_extension: "back_trunk",
  trunk_rotation: "back_trunk",
  neck_flexion: "neck",
  neck_extension: "neck",
  neck_lateral_flexion: "neck",
  shoulder_external_rotation: "shoulder",
  forearm_rotation: "forearm_wrist",
  hip_rotation: "hip",
  neck_rotation: "neck",
};

/** The region of a target id (`<action>:<target>`), or null for a balance or practice target. */
export function regionOfTarget(id: string): RegionId | null {
  return TARGET_REGIONS[id.slice(id.indexOf(":") + 1)] ?? null;
}

const LEG_REGION_IDS: readonly RegionId[] = ["hip", "knee", "ankle_foot"];
const STANDING_FORMS: readonly ExercisePosition[] = ["standing", "standing_supported"];
/** The equipment that loads an exercise: a band or a weight. */
const LOADS = ["resistance_bands", "dumbbells"];

/**
 * The positions an exercise keeps once the region ids that hold close theirs, or null when it is
 * closed (the vocabulary's ids generated from the body map, each read by the regions of the
 * exercise's primary and secondary targets, review C01):
 *   - region_not_cleared and region_red_flag: «every item whose primary or secondary target sits in
 *     that region is removed» («no exercise for the region»);
 *   - region_early_post_op and region_acute_injury: «only unloaded active range items from the pain
 *     friendly set; no bands, weights, isometric pushes or loaded standing work on that leg». Read
 *     as: pain friendly, no band or weight, every primary target in the region range of motion
 *     (mobility; a strengthening target there, isometric pushes included, closes it), and for a leg
 *     region no standing form (a seated or lying form stays).
 * An exercise that works none of the regions is open as it is. Contract gap W2-2 records the reading.
 */
export function regionOpenPositions(
  e: {
    positions?: readonly ExercisePosition[];
    targets?: readonly { id: string; role: "primary" | "secondary" }[];
    painFriendly?: boolean;
    equipment: readonly string[];
  },
  holding: ReadonlySet<string>,
): ExercisePosition[] | null {
  let open: ExercisePosition[] = [...(e.positions ?? [])];
  const regions = new Set((e.targets ?? []).map((t) => regionOfTarget(t.id)).filter((r) => r !== null));
  for (const region of regions) {
    if (holding.has(regionId("region_not_cleared", region))) return null;
    if (holding.has(regionId("region_red_flag", region))) return null;
    const early =
      holding.has(regionId("region_early_post_op", region)) ||
      holding.has(regionId("region_acute_injury", region));
    if (!early) continue;
    if (e.painFriendly !== true || e.equipment.some((x) => LOADS.includes(x))) return null;
    const primaryHere = (e.targets ?? []).filter(
      (t) => t.role === "primary" && regionOfTarget(t.id) === region,
    );
    if (primaryHere.some((t) => !t.id.startsWith("mobility:"))) return null;
    if (LEG_REGION_IDS.includes(region)) {
      open = open.filter((p) => !STANDING_FORMS.includes(p));
      if (!open.length) return null;
    }
  }
  return open;
}

/* -------------------------------------------------------------- the person */

/** A since answer inside a window; a missing answer reads as recent (the safe reading, as rom-protocol.ts). */
const within = (since: SinceBucket | undefined, window: SinceWindow) =>
  since === undefined || WINDOW_BUCKETS[window].includes(since);

const SCI = ["sci_complete", "sci_incomplete"];
/** The legs and the back: «pc_surgery_recent with back, hip, knee, ankle or foot not cleared». */
const LEG_BACK_REGIONS: readonly RegionId[] = ["back_trunk", "hip", "knee", "ankle_foot"];
/** The v1.1 chair stand pain areas: «hip, knee or back pain areas». */
const STANDING_PAIN_AREAS = ["hip", "knee", "back"];
/** «clearance no or unsure: stroke or SCI: no gait test (reason clearance_needed)». */
const GAIT_CLEARANCE_CONDITIONS = ["stroke", ...SCI];

/**
 * The gait plan's reasons from the gait eligibility gate (gait-rules section 1.1: walking, pc_walk_10m,
 * the restrictions, the prosthesis, a recent surgery not cleared, the clearance and the global gate),
 * which make walk_not_eligible; the day's postponements (pain, helper, a red flag) do not.
 */
export const GAIT_REASON_KIND: Readonly<Record<GaitNotOffered, "gate" | "today">> = {
  not_walking: "gate",
  walk_needs_hands_on_help: "gate",
  restriction: "gate",
  prosthesis_off: "gate",
  surgery_not_cleared: "gate",
  clearance_needed: "gate",
  global_gate: "gate",
  helper_needed: "today",
  pain_today: "today",
  red_flag: "today",
};

/**
 * An intake clears a v7 id only with the v7 fields: sex, the body map and walking (plan.ts
 * hasV7Fields, which this module cannot import, since plan.ts imports the pool). Without them
 * libraryPool drops every exercise that carries a v7 id (2.10 rule 2).
 */
export function canClearV7Ids(h: Pick<Intake, "sex" | "regions" | "walking">): boolean {
  return h.sex !== undefined && h.regions !== undefined && h.walking !== undefined;
}

const isRecentHipReplacement = (e: RegionEntry) =>
  e.region === "hip" &&
  e.problems.includes("after_surgery") &&
  within(e.surgery?.since, ID_WINDOWS.hip_precautions_posterior) &&
  e.surgery?.hipReplacement === true;

/**
 * A hip replacement under 3 months on the body map. libraryPool then drops every exercise with a hip
 * end range item, whatever limits were ticked (2.10 rule 2, gap 3 of D-023).
 */
export function recentHipReplacement(h: Pick<Intake, "regions">): boolean {
  return (h.regions ?? []).some(isRecentHipReplacement);
}

/** The ids the intake decides: the v1 answers, the body map, the safety answers and walking. */
function fromIntake(h: Intake, out: Set<string>): void {
  const restricted = (r: string) => h.restrictions.includes(r);
  const sci = h.conditions.some((c) => SCI.includes(c));

  // The existing ids, as pool.ts builds them: «built from the intake pain areas ({area}_injury)»;
  // severe_balance_issues «excluded with the balance_support restriction»; and the two restrictions
  // «listed explicitly here so the filter does not depend on wording».
  for (const area of h.pain) out.add(`${area}_injury`);
  if (restricted("balance_support")) out.add("severe_balance_issues");
  if (restricted("no_overhead")) out.add("no_overhead");
  if (restricted("no_weight_bearing")) out.add("no_weight_bearing");

  // The safety answers, asked of everyone with the body map (bones_ask, neck_ask): a v7 intake
  // without them clears neither; a v1 intake leaves them to libraryPool's rule for v1 intakes.
  const flags = h.romFlags;
  const unanswered = !flags && canClearV7Ids(h);
  // «Told of osteoporosis or a spine fracture».
  if (flags?.osteoporosis || unanswered) out.add("osteoporosis_spine");
  // «Neck instability, dizziness or vision change with head movement, or rheumatoid or another
  // inflammatory arthritis unless a doctor confirmed the neck is stable» (the arthritis type yes or
  // not sure, as rom-protocol.ts reads it).
  const inflammatory = flags?.inflammatoryArthritis === "yes" || flags?.inflammatoryArthritis === "unsure";
  if (flags?.neckCaution || (inflammatory && flags?.neckCleared !== true) || unanswered)
    out.add("neck_caution");
  // «offered to a wheelchair user only with pc_transfer_chair yes» (the intake's transfer_chair_ask).
  if (h.mobility === "wheelchair" && flags?.transferChair !== true) out.add("wheelchair_needs_transfer");
  // «sit_unsupported_ask no or not sure, or not asked with mobility bed or SCI at neck level»: absent
  // means yes except mobility bed and SCI, as rom-protocol.ts reads it (the intake asks it of every
  // other person with SCI and saves no for SCI at neck level).
  const sitAnswer = flags?.sitUnsupported;
  const sitsUnsupported = sitAnswer !== undefined ? sitAnswer === "yes" : !(h.mobility === "bed" || sci);
  if (!sitsUnsupported) out.add("sitting_balance");
  // The v1.1 seated side lean gate: «pc_sit_unsupported no or not sure» (the intake asks the same
  // question), and balance_support, the gate's home only exclusion (the program is done at home). Its
  // other items are day answers (pc_fall_sitting, pc_pressure_sore, back pain today, a helper).
  if (!sitsUnsupported || restricted("balance_support")) out.add("seated_lean_gate");
  // «Mobility wheelchair or any SCI condition».
  if (h.mobility === "wheelchair" || sci) out.add("overhead_load_wheelchair_sci");
  // «The v1.1 chair stand exclusions and helper rules for standing items (H6 rule 2): hip, knee or back
  // pain areas, no_weight_bearing, balance_support at home, sci_complete, clearance no or not sure at
  // home», for people who stand (rom-protocol.ts standingGate). «lower limb loss without the
  // prosthesis» is a day answer: the gait plan's.
  if (
    h.mobility !== "standing" ||
    h.pain.some((p) => STANDING_PAIN_AREAS.includes(p)) ||
    restricted("no_weight_bearing") ||
    restricted("balance_support") ||
    h.conditions.includes("sci_complete") ||
    h.clearance !== "yes"
  )
    out.add("standing_gate");
  // walk_not_eligible: «Does not walk, or fails the gait eligibility gate (gait-rules section 1.1)»,
  // the items the intake answers: «intake.walking: no», «restriction no_weight_bearing or no_exercise»,
  // «clearance no or unsure: stroke or SCI», and below a recent leg or back surgery not cleared.
  if (
    h.walking?.status === "no" ||
    restricted("no_weight_bearing") ||
    restricted("no_exercise") ||
    (h.clearance !== "yes" && h.conditions.some((c) => GAIT_CLEARANCE_CONDITIONS.includes(c)))
  )
    out.add("walk_not_eligible");
  // «foot_lift_ask ... 'no' means no_active_movement for the ankle» (exercise-targets romMovements).
  if (Object.values(flags?.footLift ?? {}).includes(false)) out.add("no_active_movement");

  for (const e of h.regions ?? []) {
    const surgery = e.problems.includes("after_surgery");
    const notCleared =
      surgery && within(e.surgery?.since, ID_WINDOWS.region_not_cleared) && e.surgery?.cleared !== "yes";
    // «Neck or back surgery in the last 3 months».
    if (
      surgery &&
      (e.region === "neck" || e.region === "back_trunk") &&
      within(e.surgery?.since, ID_WINDOWS.spine_surgery_recent)
    )
      out.add("spine_surgery_recent");
    // «Surgery in that region under 3 months without clearance for active movement».
    if (notCleared) out.add(regionId("region_not_cleared", e.region));
    // «Surgery in that region under 12 weeks, or no loading clearance» (asked only under 12 weeks).
    if (surgery && within(e.surgery?.since, ID_WINDOWS.region_early_post_op))
      out.add(regionId("region_early_post_op", e.region));
    // «Injury in that region under 6 weeks».
    if (e.problems.includes("injury") && within(e.injury?.since, ID_WINDOWS.region_acute_injury))
      out.add(regionId("region_acute_injury", e.region));
    // «Achilles tendon tear or repair in the last 6 months» (a repair is kept as injury.achilles, A2-9).
    if (
      e.region === "ankle_foot" &&
      e.injury?.achilles === true &&
      within(e.injury.since, ID_WINDOWS.achilles)
    )
      out.add("achilles");
    // «pc_surgery_recent with back, hip, knee, ankle or foot not cleared» (the body map, as gait-eligibility.ts).
    if (notCleared && LEG_BACK_REGIONS.includes(e.region)) out.add("walk_not_eligible");
    if (isRecentHipReplacement(e)) hipPrecautions(e, out);
  }
}

/**
 * hip_precautions_posterior: «Hip surgery with limits ticked in hip_avoid_ask: bending the hip past a
 * right angle, crossing the legs or turning the leg in; ON by default for 3 months after a hip
 * replacement unless the person was told of no limits»; hip_precautions_anterior: «the limit 'taking
 * the leg behind or turning it out' ticked; ON by default ... unless no limits». As rom-protocol.ts
 * reads R63: both by default, only the ticked lists once limits are ticked, none for «no limits».
 * hip_precautions_posterior_unless_raised_seat: «As hip_precautions_posterior».
 */
function hipPrecautions(e: RegionEntry, out: Set<string>): void {
  const answers = e.surgery?.hipAvoid ?? [];
  const ticked = answers.filter((a) => a !== "none");
  if (!ticked.length && answers.includes("none")) return;
  const byDefault = !ticked.length;
  if (byDefault || ticked.some((a) => a === "flex90" || a === "cross" || a === "turn_in")) {
    out.add("hip_precautions_posterior");
    out.add("hip_precautions_posterior_unless_raised_seat");
  }
  if (byDefault || ticked.includes("back_out")) out.add("hip_precautions_anterior");
}

/** The ids the range profile adds: the reasons a movement was not measured, and the measured knee. */
function fromProfile(h: Intake, profile: RomProfile, out: Set<string>): void {
  for (const e of profile.entries) {
    // «pc_weak_shoulder yes: a painful or loose weaker shoulder» (that shoulder not measured, R46).
    if (e.reason === "weak_shoulder") out.add("weak_shoulder");
    // «The person cannot move that joint on their own (rom-protocol reason no_active_movement)».
    const noActive = e.noActiveMovement || e.reason === "no_active_movement";
    if (noActive) out.add("no_active_movement");
    // «Stroke with a weaker arm that cannot move the shoulder on its own».
    if (noActive && e.region === "shoulder" && h.conditions.includes("stroke"))
      out.add("weak_arm_no_active_shoulder");
    // «A red flag in that region».
    if (e.reason === "red_flag") out.add(regionId("region_red_flag", e.region));
    // «Pillar 1 knee past straight by 5 or more»: a measured lack of minus 5 or less.
    if (
      e.movementId === "knee_extension" &&
      e.source === "measured" &&
      e.value !== null &&
      e.value <= -KNEE_PAST_STRAIGHT_GTE
    )
      out.add("knee_hyperextension");
  }
}

/** The ids the gait plan adds. Gait recurvatum (knee_hyperextension) is a gait result, not the plan's. */
function fromGait(gait: GaitPlan, out: Set<string>): void {
  if (!gait.offered && gait.reason && GAIT_REASON_KIND[gait.reason] === "gate") out.add("walk_not_eligible");
  // «the person does not meet gait-rules section 1.3» (modeChoice.padAllowedWhenAll).
  if (!gait.padAllowed) out.add("pad_not_eligible");
  // standing_gate's «lower limb loss without the prosthesis»: the gait plan found the prosthesis off.
  if (gait.reason === "prosthesis_off") out.add("standing_gate");
}

/**
 * The v7 contraindication ids of TARGETS_DATA.contraindicationVocabulary for this person, including
 * region_*:<region>. With profile and gait null it returns every id decidable from the intake alone
 * (body map, romFlags, walking, restrictions); the profile and the gait plan only add ids.
 */
export function v7Contraindications(
  h: Intake,
  profile: RomProfile | null,
  gait: GaitPlan | null,
): Set<string> {
  const out = new Set<string>();
  fromIntake(h, out);
  if (profile) fromProfile(h, profile, out);
  if (gait) fromGait(gait, out);
  return out;
}
