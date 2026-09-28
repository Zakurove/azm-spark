/**
 * Movement check progress rules (contract v2, section D; clinical spec 5 and the noise band,
 * comparability and no verdict rules of 4.1 to 4.4).
 *
 *   seriesKey        the comparison series of a result: the blocking comparability fields of its
 *                    test (tests[].comparability.blocking), with the setting, so booth and home
 *                    are separate series
 *   compareSeries    start, now, change, band and verdict of one series (higher, same or lower,
 *                    never better), with the no verdict, agreement, confirmation, censoring, large
 *                    drop and near full range rules
 *   symptomAskSides  the one sided large drop question (spec 5), asked whatever the quality flags
 *   startsNewSeries  "not comparable": a blocking field changed, a new series starts
 *   checkTimeBand    the band of a protocol item from what is known when the check starts
 *
 * Every progress claim is relative to the person's own baseline: no norms anywhere. Numbers (bands,
 * floors, percentages, multiples, the near full range line) come from src/movements/check-v1.json;
 * the prose lists of the data (wideWhen, noVerdictWhen, blocking) are implemented by hand below, and
 * tests/progress-rules.test.ts fails when the data lists change, so code and data stay together.
 * Pure TypeScript, no DOM and no window: shared by the client and the server.
 */
import { CHECK_DATA } from "../movements/assessments";
import type {
  CheckPosition,
  NoVerdictId,
  Setting,
  Side,
  TestDef,
  TestId,
  TestUnit,
  Verdict,
} from "../movements/types";
import type { CheckContext, StoredSetup } from "./assessment";

/* ------------------------------------------------------------------ types */

export type ResultSide = Side | "none";
export type DetailValue = number | boolean | string;
export type BandKind = "default" | "wide";

/**
 * A stored result of one test side at one check (contract v2 D and the assessment_results row).
 * `detail` holds the setup fingerprint and the engine details the rules read (DETAIL_KEYS);
 * `flags` holds the engine flags (RESULT_FLAGS). `value` is the displayed value: the best valid
 * attempt of a range test or the count of a timed test, whole numbers; null when not measured.
 */
export interface StoredResult {
  testId: TestId;
  side: ResultSide;
  value: number | null;
  unit: TestUnit;
  created: number;
  setting: Setting;
  seriesKey: string;
  detail: Record<string, DetailValue>;
  flags: string[];
  nValid: number;
  /** Median of the valid attempts (range tests). */
  median?: number | null;
  poseModel: string;
  movementVersion: number;
  band: BandKind;
  /**
   * Contract additions: the check position and the variant (assessment_results.variant), and the
   * limb loss of the stored setup, all read by seriesKey.
   */
  // SPEC-GAP: result-position. Contract D's StoredResult has no position, variant or limb loss,
  // which are blocking comparability fields (spec 4.1 to 4.4).
  position: CheckPosition;
  variant?: string | null;
  limbLoss?: StoredSetup["limbLoss"];
}

/** Engine flags the progress rules read (spec 4.1 to 4.4, Appendix B 13). */
export const RESULT_FLAGS = {
  /** Abduction: valid attempts spread over 15 degrees. */
  inconsistent: "inconsistent",
  /** Abduction: elbow angle below 150 degrees. */
  bentElbow: "bentElbow",
  /** Side lean: no still upright window, the lowest SD window was used. */
  uprightUnsteady: "upright_unsteady",
  /** Side lean: the leaning side elbow over 150 degrees at the peak of the best attempt. */
  armSupportLikely: "arm_support_likely",
  /** Arm curl: practice bends did not reach the baseline count line (D-009). */
  rangeBelowBaseline: "range_below_baseline",
  /** Chair stand: today's rise outside 0.85 to 1.15 of the baseline rise (D-009). */
  rangeMismatch: "range_mismatch",
} as const;

/**
 * Detail keys the progress rules read. Setup fingerprint (blocking fields): reference (trunk or
 * gravity), bentElbowAccepted, loadKg, loadL, loadObject (dumbbell, bottle, cuff, none), armrest
 * (removed or in_place), view (side or anterolateral), chair (an opaque id of the chair: the server
 * keeps it while the person says it is the same chair and gives a new one when not), armrests,
 * armMode, legProsthesis, pivot (hip or fixed), footwear (shoes or barefoot), pdState (yes or unsure).
 * Engine details: countSource (auto, staff, self), compensated (compensated reps among the counted
 * ones; missing when not known), unscoredShare (0 to 1), censored and contact (side lean best
 * attempt), pushHand (left or right, hands allowed chair stand).
 */
// SPEC-GAP: same-chair-token. "Same chair (yes or no)" is blocking; a key needs a lasting id, so the
// server keeps detail.chair across checks while the answer is yes and starts a new id on no.
export const DETAIL_KEYS = [
  "reference",
  "bentElbowAccepted",
  "loadKg",
  "loadL",
  "loadObject",
  "armrest",
  "view",
  "chair",
  "armrests",
  "armMode",
  "legProsthesis",
  "pivot",
  "footwear",
  "pdState",
  "countSource",
  "compensated",
  "unscoredShare",
  "censored",
  "contact",
  "pushHand",
] as const;

/* ------------------------------------------------------------ series key */

type KeyField =
  | "position"
  | "setting"
  | "poseModel"
  | "versionMajor"
  | "variant"
  | "limbLoss"
  | "reference"
  | "bentElbowAccepted"
  | "loadKg"
  | "loadL"
  | "loadObject"
  | "armrest"
  | "view"
  | "chair"
  | "armrests"
  | "armMode"
  | "legProsthesis"
  | "pivot"
  | "footwear"
  | "pdState";

/**
 * The blocking comparability fields of each test (tests[].comparability.blocking, word for word) and
 * the key fields that carry them. The tested side is always part of the key.
 */
// SPEC-GAP: position-key. The data names the seat (chair or wheelchair) for the seated tests; the key
// uses the check position, so a standing person doing the seated tests is its own series and a
// change of intake mobility starts a new series (the safe reading: never compare across it).
export const BLOCKING_FIELDS: Record<TestId, Record<string, readonly KeyField[]>> = {
  shoulder_abduction: {
    "position (chair or wheelchair)": ["position"],
    "angle reference (trunk or gravity)": ["reference"],
    "bent elbow accepted versus straight": ["bentElbowAccepted"],
    "setup.limbLoss": ["limbLoss"],
    "setting (booth or home)": ["setting"],
    "poseModel (lite, full or heavy)": ["poseModel"],
    "movement_version major": ["versionMajor"],
  },
  arm_curl_30s: {
    "load kg, object, held versus cuff, variant": ["loadKg", "loadL", "loadObject", "variant"],
    "chair versus wheelchair": ["position"],
    "armrest removed versus in place": ["armrest"],
    "tested arm": [],
    "side view versus anterolateral view": ["view"],
    "setting (booth or home)": ["setting"],
    "movement_version major": ["versionMajor"],
  },
  trunk_control_seated: {
    "chair versus wheelchair": ["position"],
    "same chair (yes or no)": ["chair"],
    "armrests or side guards present": ["armrests"],
    // Chest straps and lateral supports exclude the test (spec 4.3), so no result carries them.
    "chest strap or lateral supports (excluded anyway)": [],
    "arm mode": ["armMode"],
    "leg prosthesis worn": ["legProsthesis"],
    "pivot method (visible hip versus fixed pivot)": ["pivot"],
    "setting (booth or home)": ["setting"],
    "poseModel (lite, full or heavy)": ["poseModel"],
    "movement_version major": ["versionMajor"],
  },
  chair_stand_30s: {
    "variant (standard, arms_assisted, one_arm_cross)": ["variant"],
    "chair (same chair yes or no, armrests)": ["chair", "armrests"],
    "footwear versus barefoot": ["footwear"],
    "Parkinson on state": ["pdState"],
    "setting (booth or home)": ["setting"],
    "movement_version major": ["versionMajor"],
  },
};

export type SeriesKeyInput = Pick<
  StoredResult,
  | "testId"
  | "side"
  | "setting"
  | "poseModel"
  | "movementVersion"
  | "detail"
  | "position"
  | "variant"
  | "limbLoss"
>;

function enc(v: unknown): string {
  if (v === undefined || v === null || v === "") return "-";
  if (typeof v === "boolean") return v ? "1" : "0";
  return encodeURIComponent(String(v));
}

/** Variant as a series sees it: arms_assisted_steady is a modifier of arms_assisted (spec 4.4). */
function seriesVariant(r: SeriesKeyInput): string | null | undefined {
  return r.variant === "arms_assisted_steady" ? "arms_assisted" : r.variant;
}

const KEY_READERS: Record<KeyField, (r: SeriesKeyInput) => unknown> = {
  position: (r) => r.position,
  setting: (r) => r.setting,
  poseModel: (r) => r.poseModel,
  versionMajor: (r) => Math.trunc(r.movementVersion),
  variant: seriesVariant,
  limbLoss: (r) => `${r.limbLoss?.arm ?? "-"}.${r.limbLoss?.leg ?? "-"}`,
  reference: (r) => r.detail.reference,
  bentElbowAccepted: (r) => r.detail.bentElbowAccepted === true,
  loadKg: (r) => r.detail.loadKg,
  loadL: (r) => r.detail.loadL,
  loadObject: (r) => r.detail.loadObject,
  armrest: (r) => r.detail.armrest,
  view: (r) => r.detail.view,
  chair: (r) => r.detail.chair,
  armrests: (r) => r.detail.armrests,
  armMode: (r) => r.detail.armMode,
  legProsthesis: (r) => r.detail.legProsthesis,
  pivot: (r) => r.detail.pivot,
  footwear: (r) => r.detail.footwear,
  pdState: (r) => r.detail.pdState,
};

/**
 * The comparison series of a result (spec 5 "Like with like"): the test, the side and every blocking
 * field of the test. Results compare only within one key; any difference starts a new series.
 * A missing field reads as unknown, which matches only another unknown.
 */
export function seriesKey(r: SeriesKeyInput): string {
  const blocking = BLOCKING_FIELDS[r.testId];
  if (!blocking) throw new RangeError(`Unknown test ${String(r.testId)}`);
  const fields = [...new Set(Object.values(blocking).flat())];
  return [r.testId, r.side, ...fields.map((f) => `${f}=${enc(KEY_READERS[f](r))}`)].join("|");
}

/** Results grouped by series key, each series in chronological order. */
export function groupBySeries(results: readonly StoredResult[]): Map<string, StoredResult[]> {
  const out = new Map<string, StoredResult[]>();
  for (const r of [...results].sort((a, b) => a.created - b.created)) {
    const list = out.get(r.seriesKey) ?? [];
    list.push(r);
    out.set(r.seriesKey, list);
  }
  return out;
}

/* ------------------------------------------------------------------ bands */

/** Context for the band and no verdict rules: the person's current context and stored setup. */
export interface SeriesContext extends Pick<CheckContext, "position" | "support" | "conditions" | "pain"> {
  setup?: StoredSetup | null;
}

const WIDE_CONDITIONS: Record<TestId, readonly string[]> = {
  shoulder_abduction: ["stroke", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete", "parkinsons"],
  arm_curl_30s: ["ms", "parkinsons"],
  trunk_control_seated: ["parkinsons", "cerebral_palsy"],
  chair_stand_30s: ["ms"],
};
const ARM_PAIN = ["shoulder", "elbow", "wrist"];

/**
 * Whether a side has arm pain: setup.painSides (shoulder, elbow or wrist, spec 2.2). When the side
 * is not known yet, arm pain in the intake counts for both sides.
 */
// SPEC-GAP: pain-side-unknown. Without setup.painSides an intake arm pain covers both sides (the safe
// reading: no verdict and the wide band on either side rather than on neither).
export function painfulArm(side: ResultSide, ctx: SeriesContext): boolean {
  if (side === "none") return false;
  const sides = ctx.setup?.painSides;
  if (sides !== undefined) return sides.includes(side);
  return ctx.pain.some((p) => ARM_PAIN.includes(p));
}

/**
 * The wide band rules that are known when the check starts (wideWhen of each test, the parts that
 * depend on the person, not on a result): abduction in a wheelchair, with the listed conditions or
 * on the declared weaker side; arm curl with MS or Parkinson's, or arthritis with pain on that arm;
 * side lean with Parkinson's or CP; chair stand with MS.
 */
export function checkTimeBand(
  testId: TestId,
  side: ResultSide,
  ctx: Pick<CheckContext, "position" | "support" | "conditions" | "pain">,
  setup: StoredSetup | null,
): BandKind {
  const c: SeriesContext = { ...ctx, setup };
  const has = (list: readonly string[]) => list.some((x) => ctx.conditions.includes(x));
  let wide = has(WIDE_CONDITIONS[testId]);
  if (testId === "shoulder_abduction") {
    wide ||= ctx.position === "wheelchair" || (side !== "none" && ctx.support === side);
  }
  if (testId === "arm_curl_30s") wide ||= ctx.conditions.includes("arthritis") && painfulArm(side, c);
  return wide ? "wide" : "default";
}

const hasFlag = (r: StoredResult, f: string) => r.flags.includes(f);
const detailOf = (r: StoredResult, k: (typeof DETAIL_KEYS)[number]) => r.detail[k];

/** The wide band of a comparison: the check time rules, the stored band, and the result flags. */
function isWide(def: TestDef, side: ResultSide, base: StoredResult[], cur: StoredResult, ctx: SeriesContext) {
  const rows = [...base, cur];
  if (rows.some((r) => r.band === "wide")) return true;
  if (checkTimeBand(def.id, side, ctx, ctx.setup ?? null) === "wide") return true;
  const poseModelChanged = base.some((r) => r.poseModel !== cur.poseModel);
  switch (def.id) {
    case "shoulder_abduction":
      return rows.some(
        (r) =>
          r.position === "wheelchair" ||
          hasFlag(r, RESULT_FLAGS.inconsistent) ||
          hasFlag(r, RESULT_FLAGS.bentElbow) ||
          detailOf(r, "reference") === "gravity",
      );
    case "arm_curl_30s":
      return poseModelChanged;
    case "trunk_control_seated":
      return rows.some((r) => hasFlag(r, RESULT_FLAGS.uprightUnsteady));
    case "chair_stand_30s":
      return poseModelChanged || base.some((r) => detailOf(r, "pushHand") !== detailOf(cur, "pushHand"));
  }
}

/** round(p x base) with p as a whole percent, so 0.35 x 30 is 10.5 and rounds to 11 exactly. */
function pctOf(p: number, base: number): number {
  return Math.round((Math.round(p * 100) * base) / 100);
}

/** The "about the same" band for a baseline value (noiseBandRules of the test). */
export function bandOf(def: TestDef, baseline: number, wide: boolean): number {
  if (def.id === "chair_stand_30s") {
    const r = def.noiseBandRules;
    const row = r.byBaseline.find(
      (b) => (b.min === undefined || baseline >= b.min) && (b.max === undefined || baseline <= b.max),
    );
    // A baseline between two rows (not a whole count) takes the widest row: the safe side.
    const abs = row?.abs ?? Math.max(...r.byBaseline.map((b) => b.abs));
    return abs + (wide ? r.wide.add : 0);
  }
  const b = wide ? def.noiseBandRules.wide : def.noiseBandRules.default;
  return Math.max(b.abs, b.pctOfBaseline ? pctOf(b.pctOfBaseline, baseline) : 0);
}

/* ------------------------------------------------------------- comparison */

export interface SeriesPoint {
  value: number;
  date: number;
  setting: Setting;
  /** Shown as "more than {value}" (side lean). */
  censored?: true;
}

export interface SeriesComparison {
  testId: TestId;
  side: ResultSide;
  unit: TestUnit;
  /** The starting point: the first result (the mean of the first two for the side lean). */
  baseline: SeriesPoint | null;
  latest: SeriesPoint;
  previous?: SeriesPoint;
  /** latest minus baseline, whole numbers; null before there is a baseline to compare with. */
  change: number | null;
  band: number;
  bandKind: BandKind;
  verdict: Verdict | null;
  /** Why the values are shown without a verdict (progress.noVerdict). */
  noVerdict?: NoVerdictId;
  /** First check of the series: boundary.firstResult. */
  firstResult?: true;
  /** Side lean, second check: progress.startingPointSet. */
  startingPointSet?: true;
  /** Side lean: beyond the band but not confirmed by the mean of two checks (progress.unconfirmed). */
  unconfirmed?: true;
  /** No verdict label, the neutral large drop text (progress.largeDrop.text). */
  largeDrop?: true;
  /** A large drop repeated at the re-check: lower with progress.lowerExtra. */
  lowerExtra?: true;
  /** Abduction at 160 degrees or more at both checks (progress.nearFullRange), no verdict. */
  nearFullRange?: true;
  /** Offer a repeat in 2 to 7 days (after a lower or a large drop). */
  repeatOffer?: true;
  /**
   * Lower than the starting point by more than the large drop multiple of the band, whatever the
   * flags: the input of the one sided symptom question (symptomAskSides).
   */
  symptomDrop?: true;
  /** The person's own points, only from the third check of the series (progress.trendsFromCheck). */
  points?: SeriesPoint[];
}

/** Side lean: censored by an abort or by armrest contact (shown as "more than {value}"). */
const isCensored = (r: StoredResult) => r.detail.censored === true || r.detail.contact === true;
/**
 * Side lean armrest contact that may have happened: yes, or not answered. The engine stores an
 * unanswered contactAsk as "unknown" (flag contact_unknown), never as no.
 */
// SPEC-GAP: contact-unknown. Spec 4.3 censors a side on a yes to contactAsk. Not answered is read as
// possible contact for the rules (no higher, no lower, no verdict from a baseline with it, the
// chairLimit sentence), but the value is not shown as "more than", which only a yes establishes.
const maybeContact = (r: StoredResult) =>
  r.detail.contact === true || r.detail.contact === "unknown" || r.flags.includes("contact_unknown");
/** Censored for the rules: an abort, or possible armrest contact. */
const maybeCensored = (r: StoredResult) => r.detail.censored === true || maybeContact(r);
const isSelfCount = (r: StoredResult) => r.detail.countSource === "self";
const COMPENSATION_LIMIT_PCT = 25;
const UNSCORED_LIMIT = 0.1;

function point(r: StoredResult, value = r.value as number): SeriesPoint {
  return { value, date: r.created, setting: r.setting, ...(isCensored(r) ? { censored: true } : {}) };
}

/** Share of compensated reps in percent, or undefined when not known. */
function compensatedPct(r: StoredResult): number | undefined {
  const c = r.detail.compensated;
  if (typeof c !== "number" || !Number.isFinite(c)) return undefined;
  const v = r.value ?? 0;
  return v > 0 ? (100 * c) / v : 0;
}

function minValid(def: TestDef): number | undefined {
  return "minValidAttempts" in def.noiseBandRules ? def.noiseBandRules.minValidAttempts : undefined;
}

/**
 * The first no verdict condition of the test that holds, from baseline and now (noVerdictWhen of
 * each test and spec 5). "Either check" covers every baseline check (two for the side lean).
 */
function noVerdictFor(
  def: TestDef,
  side: ResultSide,
  base: StoredResult[],
  cur: StoredResult,
  ctx: SeriesContext,
): NoVerdictId | undefined {
  const rows = [...base, cur];
  const min = minValid(def);
  const fewValid = min !== undefined && rows.some((r) => r.nValid < min);
  switch (def.id) {
    case "shoulder_abduction":
      if (painfulArm(side, ctx)) return "shoulderPain";
      if (fewValid) return "oneValid";
      return undefined;
    case "arm_curl_30s": {
      if (rows.some(isSelfCount)) return "selfCount";
      if (rows.some((r) => hasFlag(r, RESULT_FLAGS.rangeBelowBaseline))) return "setupDiffers";
      const shares = rows.map(compensatedPct);
      const [b, n] = [shares[0], shares[shares.length - 1]];
      if (b !== undefined && n !== undefined && Math.abs(n - b) > COMPENSATION_LIMIT_PCT + 1e-9) {
        return "movementDifferent";
      }
      // SPEC-GAP: compensation-unknown. A verdict needs the compensated share within 25 points; when
      // it is not known (hips hidden in a wheelchair side view) the rule cannot hold, so no verdict,
      // with the sentence that the setup may differ.
      if (b === undefined || n === undefined) return "setupDiffers";
      return undefined;
    }
    case "trunk_control_seated":
      if (fewValid) return "oneValid";
      if (base.some(maybeContact) && maybeContact(cur)) return "chairLimit";
      // SPEC-GAP: baseline-contact-sentence. A baseline censored by armrest contact shows chairLimit,
      // one censored by an abort shows the censored form ("more than {value}").
      if (base.some(maybeCensored)) return base.some(maybeContact) ? "chairLimit" : "censored";
      // SPEC-GAP: arm-support-sentence. arm_support_likely has no sentence of its own; the movement
      // may have been pushed through the arm, so movementDifferent is shown.
      if (rows.some((r) => hasFlag(r, RESULT_FLAGS.armSupportLikely))) return "movementDifferent";
      return undefined;
    case "chair_stand_30s":
      if (rows.some(isSelfCount)) return "selfCount";
      if (rows.some((r) => hasFlag(r, RESULT_FLAGS.rangeMismatch))) return "setupDiffers";
      return undefined;
  }
}

/**
 * The quality flags that keep the large drop text away (spec 5): range_below_baseline,
 * range_mismatch, gravity reference, a self count, more than 10 percent unscored, fewer than 2
 * valid attempts (range tests), at either check.
 */
function hasQualityFlag(def: TestDef, base: StoredResult[], cur: StoredResult): boolean {
  const min = minValid(def);
  return [...base, cur].some(
    (r) =>
      hasFlag(r, RESULT_FLAGS.rangeBelowBaseline) ||
      hasFlag(r, RESULT_FLAGS.rangeMismatch) ||
      r.detail.reference === "gravity" ||
      isSelfCount(r) ||
      (typeof r.detail.unscoredShare === "number" && r.detail.unscoredShare > UNSCORED_LIMIT) ||
      (min !== undefined && r.nValid < min),
  );
}

const beyond = (delta: number, band: number, dir: Verdict) =>
  dir === "higher" ? delta > band : dir === "lower" ? delta < -band : false;

interface Judgement {
  change: number;
  band: number;
  bandKind: BandKind;
  verdict: Verdict | null;
  noVerdict?: NoVerdictId;
  unconfirmed?: true;
  nearFullRange?: true;
  /** The large drop text is shown (no quality flag, no no verdict condition). */
  largeDrop?: true;
  /** The verdict the rules give before the large drop text replaces it. */
  dropVerdict?: Verdict;
  symptomDrop?: true;
}

/** One check against the baseline (spec 5 and the rules of each test). */
function judge(
  def: TestDef,
  side: ResultSide,
  base: StoredResult[],
  baseValue: number,
  cur: StoredResult,
  prev: StoredResult | undefined,
  ctx: SeriesContext,
): Judgement {
  const value = cur.value as number;
  const wide = isWide(def, side, base, cur, ctx);
  const band = bandOf(def, baseValue, wide);
  const change = value - baseValue;
  const out: Judgement = { change, band, bandKind: wide ? "wide" : "default", verdict: null };
  const dropLine = -def.noiseBandRules.largeDropMultiple * band;
  if (change < dropLine) out.symptomDrop = true;

  const noVerdict = noVerdictFor(def, side, base, cur, ctx);
  if (noVerdict) return { ...out, noVerdict };
  if (
    def.id === "shoulder_abduction" &&
    baseValue >= def.noiseBandRules.nearFullRangeDeg &&
    value >= def.noiseBandRules.nearFullRangeDeg
  ) {
    return { ...out, nearFullRange: true };
  }

  let verdict: Verdict = Math.abs(change) <= band ? "same" : change > 0 ? "higher" : "lower";
  // Side lean censoring (spec 4.3): armrest contact now cannot give higher; a censored best (contact
  // or abort) cannot give lower. Within the band it reads about the same, shown as "more than".
  if (def.id === "trunk_control_seated") {
    if (verdict === "higher" && maybeContact(cur)) return { ...out, noVerdict: "chairLimit" };
    if (verdict === "lower" && maybeCensored(cur)) {
      return { ...out, noVerdict: isCensored(cur) ? "censored" : "chairLimit" };
    }
  }
  // Abduction agreement (spec 4.1): the median of valid attempts must also differ from the
  // baseline by more than the band, in the same direction.
  // SPEC-GAP: missing-median. Without a median the agreement cannot hold, so it reads about the same.
  if (verdict !== "same" && def.id === "shoulder_abduction") {
    const median = cur.median;
    if (typeof median !== "number" || !beyond(median - baseValue, band, verdict)) verdict = "same";
  }
  // Side lean confirmation (spec 4.3): the mean of this and the previous check must also be beyond
  // the band, in the same direction; otherwise about the same with the unconfirmed sentence.
  if (verdict !== "same" && def.id === "trunk_control_seated") {
    // SPEC-GAP: censored-previous. A censored previous check is a lower bound, so it never confirms
    // a lower verdict.
    const ok =
      prev !== undefined &&
      prev.value !== null &&
      beyond(((prev.value as number) + value) / 2 - baseValue, band, verdict) &&
      !(verdict === "lower" && maybeCensored(prev));
    if (!ok) {
      verdict = "same";
      out.unconfirmed = true;
    }
  }
  if (change < dropLine) {
    // SPEC-GAP: large-drop-flag-sentence. A quality flag without its own no verdict sentence (gravity
    // reference, more than 10 percent unscored) shows setupDiffers instead of the large drop text.
    if (hasQualityFlag(def, base, cur)) return { ...out, noVerdict: "setupDiffers" };
    return { ...out, largeDrop: true, dropVerdict: verdict };
  }
  return { ...out, verdict };
}

/**
 * Start, now, change, band and verdict of one series (spec 5), for one test side.
 *
 * `series` holds the results of one series key (chronological; sorted here). Results without a
 * value (not measured) are left out. The baseline is the first result that is not a self count
 * (never a baseline, spec 4.4); for the side lean it is the mean of the first two, rounded to a
 * whole degree, and the second check shows startingPointSet. Every later check is judged against
 * the baseline: "about the same" when |change| is at or below the band, else higher or lower, with
 * the no verdict conditions of the test first, then near full range, censoring, agreement and
 * confirmation. A drop of more than twice the band shows the large drop text instead of a verdict;
 * when the previous check was such a drop too, the verdict is lower with lowerExtra. Returns null
 * when no result of the series has a value.
 */
// SPEC-GAP: two-check-baseline-rounding. The side lean baseline is the mean of two checks; it is
// rounded half up so start, now and change add up in whole degrees (spec 5 "Values").
// SPEC-GAP: large-drop-repeat-window. Any next check after a large drop counts as "that re-check".
export function compareSeries(
  def: TestDef,
  side: ResultSide,
  series: readonly StoredResult[],
  ctx: SeriesContext,
): SeriesComparison | null {
  const key = series[0]?.seriesKey;
  for (const r of series) {
    if (r.testId !== def.id || r.side !== side || r.seriesKey !== key) {
      throw new RangeError(`compareSeries takes one series of ${def.id} ${side}`);
    }
  }
  const measured = [...series]
    .sort((a, b) => a.created - b.created)
    .filter((r) => typeof r.value === "number" && Number.isFinite(r.value));
  if (measured.length === 0) return null;

  const latest = measured[measured.length - 1];
  const previous = measured.length > 1 ? measured[measured.length - 2] : undefined;
  const baselineCount = def.id === "trunk_control_seated" ? 2 : 1;
  const base = measured.filter((r) => !isSelfCount(r)).slice(0, baselineCount);
  const baseValue =
    base.length === 0
      ? undefined
      : Math.round(base.reduce((n, r) => n + (r.value as number), 0) / base.length);
  const out: SeriesComparison = {
    testId: def.id,
    side,
    unit: def.unit,
    baseline: null,
    latest: point(latest),
    change: null,
    band: 0,
    bandKind: "default",
    verdict: null,
  };
  if (previous) out.previous = point(previous);
  if (measured.length >= CHECK_DATA.progress.trendsFromCheck) out.points = measured.map((r) => point(r));

  const provisional = (from: StoredResult[], value: number) => {
    const wide = isWide(def, side, from.slice(0, -1), from[from.length - 1], ctx);
    out.band = bandOf(def, value, wide);
    out.bandKind = wide ? "wide" : "default";
  };

  // No baseline yet: every result so far is a self count.
  if (base.length === 0 || baseValue === undefined) {
    provisional([latest], latest.value as number);
    return { ...out, noVerdict: "selfCount" };
  }
  const baselinePoint: SeriesPoint = {
    value: baseValue,
    date: base[base.length - 1].created,
    setting: base[base.length - 1].setting,
    ...(base.some(isCensored) ? { censored: true } : {}),
  };

  // The latest check is part of the baseline.
  const inBase = base.indexOf(latest);
  if (inBase === 0) {
    provisional([latest], latest.value as number);
    return { ...out, baseline: point(latest), firstResult: true };
  }
  if (inBase === 1) {
    // Side lean, second check: the starting point is now set. The first check stands in as the
    // starting point for the one sided symptom question only.
    // SPEC-GAP: trunk-second-check-drop. A large drop against the first check still feeds
    // symptomAskSides, so a sudden one sided loss is asked about before the starting point is set.
    provisional(base, baseValue);
    const first = base[0].value as number;
    const firstBand = bandOf(def, first, isWide(def, side, [base[0]], latest, ctx));
    const dropped = (latest.value as number) - first < -def.noiseBandRules.largeDropMultiple * firstBand;
    return {
      ...out,
      baseline: baselinePoint,
      startingPointSet: true,
      ...(dropped ? { symptomDrop: true } : {}),
    };
  }
  if (base.length < baselineCount) {
    // Only reachable with self counts among the first checks of a two check baseline.
    provisional(base, baseValue);
    return { ...out, baseline: baselinePoint, noVerdict: "selfCount" };
  }

  const j = judge(def, side, base, baseValue, latest, previous, ctx);
  const res: SeriesComparison = {
    ...out,
    baseline: baselinePoint,
    change: j.change,
    band: j.band,
    bandKind: j.bandKind,
    verdict: j.verdict,
  };
  if (j.noVerdict) res.noVerdict = j.noVerdict;
  if (j.unconfirmed) res.unconfirmed = true;
  if (j.nearFullRange) res.nearFullRange = true;
  if (j.symptomDrop) res.symptomDrop = true;
  if (j.largeDrop) {
    const prevIndex = measured.length - 2;
    const prevAfterBase = previous !== undefined && !base.includes(previous);
    const pj = prevAfterBase
      ? judge(def, side, base, baseValue, previous, measured[prevIndex - 1], ctx)
      : undefined;
    if (pj?.largeDrop && j.dropVerdict === "lower") {
      res.verdict = "lower";
      res.lowerExtra = true;
    } else {
      res.largeDrop = true;
    }
  }
  if (res.verdict === "lower" || res.largeDrop) res.repeatOffer = true;
  return res;
}

/* ------------------------------------------------------ across series */

/**
 * The one sided large drop question (spec 5, progress.largeDrop.oneSidedRule): for a test with
 * sides, the sides with a drop of more than twice the band (whatever the quality flags) while the
 * other side of the same test is not lower, or was not measured today. Pass the comparisons whose
 * latest result is today's check; leave a side out when it was not measured today. The question
 * (progress.largeDrop.symptomAsk) is asked before the results are shown; yes opens scr_emergency.
 */
export function symptomAskSides(today: Partial<Record<Side, SeriesComparison | null>>): Side[] {
  const out: Side[] = [];
  for (const side of ["left", "right"] as const) {
    const c = today[side];
    if (!c?.symptomDrop) continue;
    const o = today[side === "left" ? "right" : "left"];
    const otherLower = o != null && (o.symptomDrop === true || (o.change !== null && o.change < -o.band));
    if (!otherLower) out.push(side);
  }
  return out;
}

/**
 * "Not comparable" (spec 5): the latest result starts a new series although an earlier result of the
 * same test and side in the same setting exists. Booth and home are separate series by design, so a
 * first home check after booth checks is a first result. `history` holds every result of one test
 * side, any series, chronological.
 */
export function startsNewSeries(
  history: readonly Pick<StoredResult, "seriesKey" | "setting" | "value" | "created">[],
): boolean {
  const measured = [...history]
    .sort((a, b) => a.created - b.created)
    .filter((r) => typeof r.value === "number" && Number.isFinite(r.value));
  const latest = measured[measured.length - 1];
  if (!latest) return false;
  const earlier = measured.slice(0, -1).filter((r) => r.setting === latest.setting);
  return earlier.length > 0 && earlier.every((r) => r.seriesKey !== latest.seriesKey);
}

/**
 * The chair stand milestone (spec 4.4): moving from the hands allowed version to the standard one is
 * shown as a milestone, not as a change in count (the variants are separate series).
 */
export function chairStandMilestone(previousVariant: string | null | undefined, latestVariant: string) {
  const handsAllowed = previousVariant === "arms_assisted" || previousVariant === "arms_assisted_steady";
  return handsAllowed && latestVariant === "standard";
}
