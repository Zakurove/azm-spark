/**
 * Strict validation of the focus check request bodies (product v7 contract section 4). Pure: no DB.
 *
 * Hand written, no new server dependency. Every body is a closed object (an unknown key is refused),
 * numbers are finite and inside the bounds of their unit, strings are ids from an enumeration (so no
 * free text and no health text reaches the database through them), lists are bounded, and a failed
 * check names the first bad field, never the value: 400 { error, field }.
 *
 * Bounds (section 4): range values flexion 0 to 180, signed -90 to 90, lack -30 to 150, whole
 * numbers; pain 0 to 10 integers; at most 3 scored attempts and 1 practice (ROM_DATA.engine, read from
 * the data) and 2 retries. Gait: at most
 * 3 views, 200 events and 120 cycles per view, every per view replay null, one replay cycle of at most
 * 45 frames (24 KB), metric values inside the bounds of their unit (cadence 20 to 250, times 0.1 to
 * 5 s, percent 0 to 100, ratios 0 to 5, degrees -90 to 120, speed 0 to 3 m/s, lengths 0 to 2.5 m),
 * so the largest valid gait body stays under the route's 160 KB body limit.
 */
import { REGION_IDS, type RegionId } from "../../../src/medical/body-map";
import { walkingAids, type WalkingAid } from "../../../src/medical/plan";
import type { Answers } from "../../../src/medical/precheck";
import type { FocusToday, RomProtocolItem, RomReasonId } from "../../../src/medical/rom-protocol";
import type { GaitMode, GaitPlan } from "../../../src/medical/gait-eligibility";
import type {
  AnswerSource,
  LimitCause,
  RomAnswer,
  RomAttempt,
  RomFlag,
  RomMeasureResult,
} from "../../../src/engine/rom/types";
import type { QualityIssue, QualityReport, ViewClass } from "../../../src/engine/quality";
import type { QualitySummary } from "../../../src/engine/modes/types";
import type {
  GaitAnalysis,
  GaitCycle,
  GaitEvent,
  GaitMetricId,
  GaitMetricValue,
  GaitQuality,
  GaitQualityIssue,
  GaitSetup,
  GaitView,
  GaitViewResult,
  GaitWalkPain,
  ReplayCycle,
  StaticStanceResult,
} from "../../../src/engine/gait/types";
import { GAIT_DATA } from "../../../src/movements/gait";
import { GAIT_METRIC_IDS } from "../../../src/movements/gait/types";
import { ROM_DATA, movementDef } from "../../../src/movements/rom";
import {
  COMPENSATION_IDS,
  ROM_MOVEMENT_IDS,
  ROM_POSITION_IDS,
  ROM_REASON_IDS,
  type RomKind,
  type RomMovementId,
  type RomSide,
} from "../../../src/movements/rom/types";
import { REASON_IDS, STOP_OPTION_IDS, type StopOptionId } from "../../../src/movements/types";
import {
  checkAnswers,
  isId,
  isPlainObject,
  jsonBytes,
  unknownKeys,
  type Check,
} from "../assessments/validate";

const fail = (field: string) => ({ ok: false, field }) as const;
const ok = <T>(value: T) => ({ ok: true, value }) as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => finite(v) && v >= lo && v <= hi;
const intIn = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && inRange(v, lo, hi);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && (values as readonly string[]).includes(v);
const bool = (v: unknown): v is boolean => typeof v === "boolean";
/** The first key of `body` outside `allowed`, as a field name (never an arbitrary string). */
function extraKey(body: Record<string, unknown>, allowed: readonly string[], prefix: string): string | null {
  const extra = unknownKeys(body, allowed);
  if (!extra.length) return null;
  if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(extra[0])) return `${prefix}${extra[0]}`;
  return prefix ? prefix.slice(0, -1) : "body";
}
/** A list of unique values from an enumeration, at most `max` long. */
const uniqueOf = <T extends string>(v: unknown, values: readonly T[], max: number): v is T[] =>
  Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every((x) => oneOf(x, values));

/** Compile time: a literal list holds exactly the members of a union. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/* ---------------------------------------------------------- id lists */

/** RomFlag (contract 2.6). */
export const ROM_FLAGS = [
  "smallExcursion",
  "wideHold",
  "elevationOverRead",
  "gravityMode",
  "approximate",
  "bentElbow",
  "unconfirmed",
  "inconsistent",
  "provisional",
  "ageOutsideBand",
  "modelLite",
  "helperPresent",
  "censored",
] as const;
const romFlagsExact: Exact<(typeof ROM_FLAGS)[number], RomFlag> = true;
/** QualityIssue (engine/quality.ts). */
export const QUALITY_ISSUES = [
  "not_visible",
  "out_of_frame",
  "wrong_view",
  "too_close",
  "too_far",
  "low_fps",
  "paused",
  "touched",
] as const;
const qualityIssuesExact: Exact<(typeof QUALITY_ISSUES)[number], QualityIssue> = true;
const VIEW_CLASSES = ["front", "side", "oblique", "unknown"] as const;
const viewClassesExact: Exact<(typeof VIEW_CLASSES)[number], ViewClass> = true;
const ROM_ANSWERS = ["yes", "not_yet", "hurts"] as const;
const romAnswersExact: Exact<(typeof ROM_ANSWERS)[number], RomAnswer> = true;
const ANSWER_SOURCES = ["button", "voice", "timeout"] as const;
const answerSourcesExact: Exact<(typeof ANSWER_SOURCES)[number], AnswerSource> = true;
const LIMIT_CAUSES = ["tight", "pain", "weak"] as const;
const limitCausesExact: Exact<(typeof LIMIT_CAUSES)[number], LimitCause> = true;
const ROM_SIDES = ["left", "right", "none"] as const;
const romSidesExact: Exact<(typeof ROM_SIDES)[number], RomSide> = true;
/** A range reason: the v7 reason ids and the v1 reasons a pre-check or stop carries (RomReasonId). */
const ROM_REASONS: readonly RomReasonId[] = [...ROM_REASON_IDS, ...REASON_IDS];
/** What an attempt's reasons hold: compensation ids, quality issues and no_hold (contract 2.6). */
const ATTEMPT_REASONS: readonly string[] = [...COMPENSATION_IDS, ...QUALITY_ISSUES, "no_hold"];

const GAIT_VIEWS = ["front", "back", "side", "pad_side", "pad_front"] as const;
const gaitViewsExact: Exact<(typeof GAIT_VIEWS)[number], GaitView> = true;
const OVERGROUND_VIEWS: readonly GaitView[] = ["front", "back", "side"];
const PAD_VIEWS: readonly GaitView[] = ["pad_side", "pad_front"];
const GAIT_MODES = ["overground", "walking_pad"] as const;
const gaitModesExact: Exact<(typeof GAIT_MODES)[number], GaitMode> = true;
const gaitMetricIdsExact: Exact<(typeof GAIT_METRIC_IDS)[number], GaitMetricId> = true;
const GAIT_GRADES = ["A", "B", "B-", "C+", "C", "D"] as const;
const gaitGradesExact: Exact<(typeof GAIT_GRADES)[number], GaitMetricValue["grade"]> = true;
const GAIT_QUALITY_ISSUES = [
  "too_few_cycles",
  "low_fps",
  "gaps",
  "visibility",
  "swap",
  "not_one_person",
  "wrong_view",
  "turns_only",
] as const;
const gaitQualityIssuesExact: Exact<(typeof GAIT_QUALITY_ISSUES)[number], GaitQualityIssue> = true;
const DETECTORS = ["zeni", "ankle", "stenum_front"] as const;
const detectorsExact: Exact<(typeof DETECTORS)[number], GaitEvent["detector"]> = true;
const CYCLE_DROPS = ["order", "duration", "visibility", "swap", "turn", "pass_edge"] as const;
const cycleDropsExact: Exact<(typeof CYCLE_DROPS)[number], NonNullable<GaitCycle["drop"]>> = true;
const ANALYSIS_FLAGS = [
  "far_limb",
  "handrail_light",
  "handrail_firm",
  "not_familiarised",
  "model_lite",
  "no_height",
] as const;
const analysisFlagsExact: Exact<(typeof ANALYSIS_FLAGS)[number], GaitAnalysis["flags"][number]> = true;
const ORTHOSES = ["afo", "kafo", "knee_brace"] as const;
const LIMB_SIDES = ["left", "right"] as const;
void [
  romFlagsExact,
  qualityIssuesExact,
  viewClassesExact,
  romAnswersExact,
  answerSourcesExact,
  limitCausesExact,
  romSidesExact,
  gaitViewsExact,
  gaitModesExact,
  gaitMetricIdsExact,
  gaitGradesExact,
  gaitQualityIssuesExact,
  detectorsExact,
  cycleDropsExact,
  analysisFlagsExact,
];

/* ------------------------------------------------------- start body */

export interface FocusDeviceBody {
  os: string;
  browser: string;
}

export interface FocusStartBody {
  setting: "home" | "booth";
  answers: Answers;
  today: FocusToday;
  device: FocusDeviceBody;
  include: { rom: boolean; gait: boolean };
}

/** The day's answers (rom-protocol 6 and gait-rules eligibility.today): ids and numbers only. */
export function checkToday(v: unknown): Check<FocusToday> {
  if (!isPlainObject(v)) return fail("today");
  const extra = extraKey(
    v,
    [
      "painByRegion",
      "redFlagRegions",
      "prosthesisOn",
      "transferChair",
      "helperPresent",
      "walk10m",
      "pdFreezing",
      "orthosis",
    ],
    "today.",
  );
  if (extra) return fail(extra);
  const pain = v.painByRegion;
  if (!isPlainObject(pain)) return fail("today.painByRegion");
  for (const [region, level] of Object.entries(pain))
    if (!oneOf(region, REGION_IDS) || !intIn(level, 0, 10)) return fail("today.painByRegion");
  if (!uniqueOf(v.redFlagRegions, REGION_IDS, REGION_IDS.length)) return fail("today.redFlagRegions");
  const out: FocusToday = {
    painByRegion: pain as Partial<Record<RegionId, number>>,
    redFlagRegions: [...(v.redFlagRegions as RegionId[])],
  };
  for (const key of ["prosthesisOn", "transferChair", "helperPresent", "walk10m", "pdFreezing"] as const) {
    const x = v[key];
    if (x === undefined) continue;
    if (!bool(x)) return fail(`today.${key}`);
    out[key] = x;
  }
  if (v.orthosis !== undefined) {
    const o = v.orthosis;
    if (!isPlainObject(o) || unknownKeys(o, LIMB_SIDES).length) return fail("today.orthosis");
    for (const x of Object.values(o)) if (!oneOf(x, ORTHOSES)) return fail("today.orthosis");
    out.orthosis = o as FocusToday["orthosis"];
  }
  return ok(out);
}

export function checkFocusDevice(v: unknown): Check<FocusDeviceBody> {
  if (!isPlainObject(v) || unknownKeys(v, ["os", "browser"]).length) return fail("device");
  if (!isId(v.os)) return fail("device.os");
  if (!isId(v.browser)) return fail("device.browser");
  return ok({ os: v.os, browser: v.browser });
}

const START_KEYS = ["setting", "answers", "today", "device", "include"] as const;

export function checkFocusStart(body: Record<string, unknown>): Check<FocusStartBody> {
  const extra = extraKey(body, START_KEYS, "");
  if (extra) return fail(extra);
  if (!oneOf(body.setting, ["home", "booth"] as const)) return fail("setting");
  const answers = checkAnswers(body.answers);
  if (!answers.ok) return answers;
  const today = checkToday(body.today);
  if (!today.ok) return today;
  const device = checkFocusDevice(body.device);
  if (!device.ok) return device;
  const include = body.include;
  if (!isPlainObject(include) || unknownKeys(include, ["rom", "gait"]).length) return fail("include");
  if (!bool(include.rom)) return fail("include.rom");
  if (!bool(include.gait)) return fail("include.gait");
  return ok({
    setting: body.setting,
    answers: answers.value,
    today: today.value,
    device: device.value,
    include: { rom: include.rom, gait: include.gait },
  });
}

/* ------------------------------------------------- range measurement */

/** Value bounds per movement kind (section 4): flexion 0 to 180, signed -90 to 90, lack -30 to 150. */
export const ROM_VALUE_BOUNDS: Record<RomKind, [number, number]> = {
  flexion: [0, 180],
  signed: [-90, 90],
  lack: [-30, 150],
};
/** Scored attempts per movement and side: ROM_DATA.engine.scoredAttemptsMax (C-1, read from the data). */
export const MAX_SCORED_ATTEMPTS: number = ROM_DATA.engine.scoredAttemptsMax;
/** Practice attempts per movement and side: ROM_DATA.engine.practice. */
export const MAX_PRACTICE: number = ROM_DATA.engine.practice;
/** Quality retries per movement and side: the v1.1 range tests' maxRetries (contract 2.6, at most 2). */
export const MAX_RETRIES = 2;

/** The engine's quality report of one attempt: ok, fps, view and issues checked, the rest bounded. */
function checkQualityReport(v: unknown, field: string): Check<QualityReport> {
  if (!isPlainObject(v) || jsonBytes(v) > 2048 || Object.keys(v).length > 30) return fail(field);
  if (!bool(v.ok)) return fail(`${field}.ok`);
  if (!inRange(v.fps, 0, 240)) return fail(`${field}.fps`);
  if (!oneOf(v.view, VIEW_CLASSES)) return fail(`${field}.view`);
  if (!uniqueOf(v.issues, QUALITY_ISSUES, QUALITY_ISSUES.length)) return fail(`${field}.issues`);
  const scalar = (x: unknown) => x === null || bool(x) || finite(x) || isId(x);
  for (const [k, x] of Object.entries(v)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) return fail(field);
    if (scalar(x)) continue;
    if (Array.isArray(x) && x.length <= 40 && x.every(scalar)) continue;
    if (
      isPlainObject(x) &&
      Object.keys(x).length <= 40 &&
      Object.entries(x).every(([kk, xx]) => isId(kk) && finite(xx))
    )
      continue;
    return fail(`${field}.${k}`);
  }
  return ok(v as unknown as QualityReport);
}

const ATTEMPT_KEYS = [
  "index",
  "outcome",
  "value",
  "answer",
  "answerSource",
  "painLimited",
  "painLevel",
  "reasons",
  "flags",
  "quality",
  "t0",
  "t1",
] as const;

function checkAttempt(
  v: unknown,
  field: string,
  bounds: [number, number],
  practice: boolean,
): Check<RomAttempt> {
  if (!isPlainObject(v)) return fail(field);
  const extra = extraKey(v, ATTEMPT_KEYS, `${field}.`);
  if (extra) return fail(extra);
  if (practice ? v.index !== 0 : !intIn(v.index, 1, MAX_SCORED_ATTEMPTS)) return fail(`${field}.index`);
  const outcomes = practice ? (["practice"] as const) : (["valid", "invalid", "retry"] as const);
  if (!oneOf(v.outcome, outcomes)) return fail(`${field}.outcome`);
  if (!(v.value === null || intIn(v.value, bounds[0], bounds[1]))) return fail(`${field}.value`);
  if (v.outcome === "valid" && v.value === null) return fail(`${field}.value`);
  if (!(v.answer === null || oneOf(v.answer, [...ROM_ANSWERS, "unconfirmed"])))
    return fail(`${field}.answer`);
  if (!(v.answerSource === null || oneOf(v.answerSource, ANSWER_SOURCES)))
    return fail(`${field}.answerSource`);
  if (!bool(v.painLimited)) return fail(`${field}.painLimited`);
  if (!(v.painLevel === null || intIn(v.painLevel, 0, 10))) return fail(`${field}.painLevel`);
  if (!uniqueOf(v.reasons, ATTEMPT_REASONS, 10)) return fail(`${field}.reasons`);
  if (!uniqueOf(v.flags, ROM_FLAGS, ROM_FLAGS.length)) return fail(`${field}.flags`);
  const quality = checkQualityReport(v.quality, `${field}.quality`);
  if (!quality.ok) return quality;
  if (!inRange(v.t0, 0, 1e13)) return fail(`${field}.t0`);
  if (!inRange(v.t1, v.t0, 1e13)) return fail(`${field}.t1`);
  return ok(v as unknown as RomAttempt);
}

function checkQualitySummary(v: unknown): Check<QualitySummary> {
  if (!isPlainObject(v)) return fail("quality");
  const extra = extraKey(v, ["ok", "retries", "issues", "medianFps", "maxPausedShare"], "quality.");
  if (extra) return fail(extra);
  if (!bool(v.ok)) return fail("quality.ok");
  if (!intIn(v.retries, 0, MAX_RETRIES + MAX_SCORED_ATTEMPTS)) return fail("quality.retries");
  if (!uniqueOf(v.issues, QUALITY_ISSUES, QUALITY_ISSUES.length)) return fail("quality.issues");
  if (!(v.medianFps === null || inRange(v.medianFps, 0, 240))) return fail("quality.medianFps");
  if (!inRange(v.maxPausedShare, 0, 1)) return fail("quality.maxPausedShare");
  return ok(v as unknown as QualitySummary);
}

const RESULT_KEYS = [
  "movementId",
  "side",
  "position",
  "status",
  "reason",
  "value",
  "median",
  "nValid",
  "painLimited",
  "painLevel",
  "painBefore",
  "cause",
  "attempts",
  "practice",
  "retries",
  "flags",
  "quality",
  "poseModel",
  "movementVersion",
  "engineVersion",
  "durationSec",
] as const;

/** The protocol item a result names (movementId and side), or the field that does not name one. */
export function resultRef(
  body: Record<string, unknown>,
): Check<{ movementId: RomMovementId; side: RomSide }> {
  if (!oneOf(body.movementId, ROM_MOVEMENT_IDS)) return fail("movementId");
  if (!oneOf(body.side, ROM_SIDES)) return fail("side");
  return ok({ movementId: body.movementId, side: body.side });
}

/**
 * A range result for one protocol item (the route found the item by movementId and side). Checks
 * every field, then the rules that tie them together: a measured value is the best valid attempt
 * (the largest, or the smallest lack) and the median lies between the valid attempts; a not
 * measured result has no value; the position is the item's. The movement version is compared with
 * the movement's definition by the route (409 STALE_CLIENT), not here.
 */
export function checkRomResult(
  body: Record<string, unknown>,
  item: RomProtocolItem,
): Check<RomMeasureResult> {
  const extra = extraKey(body, RESULT_KEYS, "");
  if (extra) return fail(extra);
  const def = movementDef(item.movementId);
  const bounds = ROM_VALUE_BOUNDS[def.kind];
  if (body.movementId !== item.movementId) return fail("movementId");
  if (body.side !== item.side) return fail("side");
  if (!oneOf(body.position, ROM_POSITION_IDS) || body.position !== item.position) return fail("position");
  if (!oneOf(body.status, ["measured", "not_measured", "stopped"] as const)) return fail("status");
  if (!(body.reason === null || oneOf(body.reason, ROM_REASONS))) return fail("reason");
  if (!(body.value === null || intIn(body.value, bounds[0], bounds[1]))) return fail("value");
  if (!(body.median === null || inRange(body.median, bounds[0], bounds[1]))) return fail("median");
  if (!intIn(body.nValid, 0, MAX_SCORED_ATTEMPTS)) return fail("nValid");
  if (!bool(body.painLimited)) return fail("painLimited");
  if (!(body.painLevel === null || intIn(body.painLevel, 0, 10))) return fail("painLevel");
  if (!(body.painBefore === null || intIn(body.painBefore, 0, 10))) return fail("painBefore");
  if (!(body.cause === null || oneOf(body.cause, LIMIT_CAUSES))) return fail("cause");
  if (!Array.isArray(body.attempts) || body.attempts.length > MAX_SCORED_ATTEMPTS) return fail("attempts");
  for (let i = 0; i < body.attempts.length; i++) {
    const a = checkAttempt(body.attempts[i], "attempts", bounds, false);
    if (!a.ok) return a;
  }
  const indexes = (body.attempts as RomAttempt[]).map((a) => a.index);
  if (new Set(indexes).size !== indexes.length) return fail("attempts.index");
  if (!Array.isArray(body.practice) || body.practice.length > MAX_PRACTICE) return fail("practice");
  for (const p of body.practice) {
    const a = checkAttempt(p, "practice", bounds, true);
    if (!a.ok) return a;
  }
  if (!intIn(body.retries, 0, MAX_RETRIES)) return fail("retries");
  if (!uniqueOf(body.flags, ROM_FLAGS, ROM_FLAGS.length)) return fail("flags");
  const quality = checkQualitySummary(body.quality);
  if (!quality.ok) return quality;
  if (!oneOf(body.poseModel, ["lite", "full"] as const)) return fail("poseModel");
  if (!intIn(body.movementVersion, 1, 1000)) return fail("movementVersion");
  if (!isId(body.engineVersion)) return fail("engineVersion");
  if (!inRange(body.durationSec, 0, 3600)) return fail("durationSec");

  const attempts = body.attempts as RomAttempt[];
  const valid = attempts.filter((a) => a.outcome === "valid").map((a) => a.value as number);
  if (body.nValid !== valid.length) return fail("nValid");
  if (body.value === null) {
    if (body.status === "measured") return fail("value");
    if (body.median !== null) return fail("median");
  } else {
    if (body.status === "not_measured") return fail("value");
    // A stop keeps a value only as the last valid hold, pain limited (contract 2.6 answerPain).
    if (body.status === "stopped" && !body.painLimited) return fail("value");
    if (!valid.length) return fail("nValid");
    const best = def.kind === "lack" ? Math.min(...valid) : Math.max(...valid);
    if (body.value !== best) return fail("value");
    if (body.median !== null && (body.median < Math.min(...valid) || body.median > Math.max(...valid)))
      return fail("median");
  }
  if (body.status !== "measured" && body.reason === null) return fail("reason");
  return ok(body as unknown as RomMeasureResult);
}

/* ------------------------------------------------------------- gait */

/** Gait limits (section 4): what keeps the largest valid body under the route's 160 KB body limit. */
export const GAIT_LIMITS = {
  views: 3,
  eventsPerView: 200,
  cyclesPerView: 120,
  replayFrames: 45,
  replayBytes: 24 * 1024,
  stance: 2,
  /** Pain marks during the walk (CG-8, GaitAnalysis.walkPain): a list bound, not a clinical number. */
  walkPain: 10,
  /**
   * The whole analysis, serialized: the largest valid body (about 122 KB with numbers rounded as the
   * engine stores them, section 4) stays under it, and with the setup it stays under the route's
   * 160 KB body limit, so a body the validator accepts is never refused as too large (413).
   */
  analysisBytes: 150 * 1024,
} as const;
/** The landmarks of a replay cycle: 0, 11 to 16 and 23 to 32 (contract 2.8). */
export const REPLAY_LANDMARKS: readonly number[] = [
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];

/**
 * Metric value bounds per unit (section 4). A share (hip_hike, the share of clean cycles with the
 * sign) is a fraction, 0 to 1 by definition.
 */
export const GAIT_UNIT_BOUNDS: Record<string, [number, number]> = {
  "steps/min": [20, 250],
  s: [0.1, 5],
  "%": [0, 100],
  ratio: [0, 5],
  deg: [-90, 120],
  "m/s": [0, 3],
  m: [0, 2.5],
  share: [0, 1],
};
/** Each metric's unit, from the gait data (gait-rules metrics). */
const METRIC_UNITS = new Map(GAIT_DATA.metrics.map((m) => [m.id as string, m.unit]));

function checkMetricValue(id: GaitMetricId, v: unknown, field: string): Check<GaitMetricValue> {
  if (!isPlainObject(v)) return fail(field);
  const extra = extraKey(v, ["id", "value", "sides", "share", "n", "unit", "grade"], `${field}.`);
  if (extra) return fail(extra);
  if (v.id !== id) return fail(`${field}.id`);
  const unit = METRIC_UNITS.get(id);
  const bounds = unit === undefined ? undefined : GAIT_UNIT_BOUNDS[unit];
  if (!bounds || v.unit !== unit) return fail(`${field}.unit`);
  const inBounds = (x: unknown) => x === null || inRange(x, bounds[0], bounds[1]);
  if (!inBounds(v.value)) return fail(`${field}.value`);
  for (const key of ["sides", "share"] as const) {
    const s = v[key];
    if (s === undefined) continue;
    if (!isPlainObject(s) || unknownKeys(s, LIMB_SIDES).length !== 0 || !("left" in s) || !("right" in s))
      return fail(`${field}.${key}`);
    const fits = key === "sides" ? inBounds : (x: unknown) => x === null || inRange(x, 0, 1);
    if (!fits(s.left) || !fits(s.right)) return fail(`${field}.${key}`);
  }
  if (!intIn(v.n, 0, 1000)) return fail(`${field}.n`);
  if (!oneOf(v.grade, GAIT_GRADES)) return fail(`${field}.grade`);
  return ok(v as unknown as GaitMetricValue);
}

function checkMetrics(v: unknown, field: string): Check<Partial<Record<GaitMetricId, GaitMetricValue>>> {
  if (!isPlainObject(v)) return fail(field);
  for (const [id, m] of Object.entries(v)) {
    if (!oneOf(id, GAIT_METRIC_IDS)) return fail(field);
    const checked = checkMetricValue(id, m, `${field}.${id}`);
    if (!checked.ok) return checked;
  }
  return ok(v as Partial<Record<GaitMetricId, GaitMetricValue>>);
}

/** Event and cycle times: the walk's timestamps, milliseconds, never negative. */
const time = (v: unknown) => inRange(v, 0, 1e13);

function checkEvent(v: unknown): boolean {
  if (!isPlainObject(v) || unknownKeys(v, ["side", "type", "t", "index", "confidence", "detector"]).length)
    return false;
  return (
    oneOf(v.side, LIMB_SIDES) &&
    oneOf(v.type, ["ic", "to"] as const) &&
    time(v.t) &&
    intIn(v.index, 0, 1e6) &&
    inRange(v.confidence, 0, 1) &&
    oneOf(v.detector, DETECTORS)
  );
}

function checkCycle(v: unknown): boolean {
  if (!isPlainObject(v) || unknownKeys(v, ["side", "icStart", "to", "icEnd", "clean", "drop"]).length)
    return false;
  return (
    oneOf(v.side, LIMB_SIDES) &&
    time(v.icStart) &&
    (v.to === null || time(v.to)) &&
    time(v.icEnd) &&
    (v.icEnd as number) >= (v.icStart as number) &&
    bool(v.clean) &&
    (v.drop === undefined || oneOf(v.drop, CYCLE_DROPS))
  );
}

function checkGaitQuality(v: unknown, field: string): Check<GaitQuality> {
  if (!isPlainObject(v)) return fail(field);
  const extra = extraKey(
    v,
    ["cleanCycles", "medianFps", "gapShare", "gatePassed", "timingOnly", "issues"],
    `${field}.`,
  );
  if (extra) return fail(extra);
  const c = v.cleanCycles;
  if (
    !isPlainObject(c) ||
    unknownKeys(c, LIMB_SIDES).length ||
    !intIn(c.left, 0, GAIT_LIMITS.cyclesPerView) ||
    !intIn(c.right, 0, GAIT_LIMITS.cyclesPerView)
  )
    return fail(`${field}.cleanCycles`);
  if (!inRange(v.medianFps, 0, 240)) return fail(`${field}.medianFps`);
  if (!inRange(v.gapShare, 0, 1)) return fail(`${field}.gapShare`);
  if (!bool(v.gatePassed)) return fail(`${field}.gatePassed`);
  if (!bool(v.timingOnly)) return fail(`${field}.timingOnly`);
  if (!uniqueOf(v.issues, GAIT_QUALITY_ISSUES, GAIT_QUALITY_ISSUES.length)) return fail(`${field}.issues`);
  return ok(v as unknown as GaitQuality);
}

function checkReplay(v: unknown): Check<ReplayCycle | null> {
  if (v === null) return ok(null);
  if (!isPlainObject(v) || unknownKeys(v, ["side", "fps", "landmarks", "frames"]).length)
    return fail("analysis.replay");
  if (!oneOf(v.side, LIMB_SIDES)) return fail("analysis.replay.side");
  if (v.fps !== 15) return fail("analysis.replay.fps");
  const lm = v.landmarks;
  if (
    !Array.isArray(lm) ||
    lm.length !== REPLAY_LANDMARKS.length ||
    lm.some((x, i) => x !== REPLAY_LANDMARKS[i])
  )
    return fail("analysis.replay.landmarks");
  const frames = v.frames;
  if (!Array.isArray(frames) || frames.length > GAIT_LIMITS.replayFrames)
    return fail("analysis.replay.frames");
  for (const f of frames) {
    if (!Array.isArray(f) || f.length !== REPLAY_LANDMARKS.length) return fail("analysis.replay.frames");
    for (const p of f)
      if (!Array.isArray(p) || p.length !== 2 || !inRange(p[0], -1, 2) || !inRange(p[1], -1, 2))
        return fail("analysis.replay.frames");
  }
  if (jsonBytes(v) > GAIT_LIMITS.replayBytes) return fail("analysis.replay");
  return ok(v as unknown as ReplayCycle);
}

function checkView(v: unknown, mode: GaitMode): Check<GaitViewResult> {
  const field = `analysis.views`;
  if (!isPlainObject(v)) return fail(field);
  const extra = extraKey(
    v,
    ["view", "nearSide", "poseModel", "events", "cycles", "metrics", "quality", "replay"],
    `${field}.`,
  );
  if (extra) return fail(extra);
  const views = mode === "overground" ? OVERGROUND_VIEWS : PAD_VIEWS;
  if (!oneOf(v.view, GAIT_VIEWS) || !views.includes(v.view)) return fail(`${field}.view`);
  if (v.nearSide !== undefined && (v.view !== "pad_side" || !oneOf(v.nearSide, LIMB_SIDES)))
    return fail(`${field}.nearSide`);
  // The model of each view (C-10; D-024, A5-9): Heavy is not shipped.
  if (!oneOf(v.poseModel, ["lite", "full"] as const)) return fail(`${field}.poseModel`);
  if (!Array.isArray(v.events) || v.events.length > GAIT_LIMITS.eventsPerView) return fail(`${field}.events`);
  if (!v.events.every(checkEvent)) return fail(`${field}.events`);
  if (!Array.isArray(v.cycles) || v.cycles.length > GAIT_LIMITS.cyclesPerView) return fail(`${field}.cycles`);
  if (!v.cycles.every(checkCycle)) return fail(`${field}.cycles`);
  const metrics = checkMetrics(v.metrics, `${field}.metrics`);
  if (!metrics.ok) return metrics;
  const quality = checkGaitQuality(v.quality, `${field}.quality`);
  if (!quality.ok) return quality;
  // The one kept replay cycle is the analysis's own; every per view replay is null (section 4).
  if (v.replay !== null) return fail(`${field}.replay`);
  return ok(v as unknown as GaitViewResult);
}

function checkStance(v: unknown): Check<StaticStanceResult[]> {
  if (!Array.isArray(v) || v.length > GAIT_LIMITS.stance) return fail("analysis.staticStance");
  for (const s of v)
    if (
      !isPlainObject(s) ||
      unknownKeys(s, ["side", "pelvicDropDeg", "ok"]).length ||
      !oneOf(s.side, LIMB_SIDES) ||
      !(s.pelvicDropDeg === null || inRange(s.pelvicDropDeg, -90, 120)) ||
      !bool(s.ok)
    )
      return fail("analysis.staticStance");
  const sides = (v as StaticStanceResult[]).map((s) => s.side);
  if (new Set(sides).size !== sides.length) return fail("analysis.staticStance");
  return ok(v as StaticStanceResult[]);
}

/** The pain marked during the walk (CG-8): at most 10, each a side or none and a whole level 0 to 10. */
function checkWalkPain(v: unknown): Check<GaitWalkPain[] | undefined> {
  if (v === undefined) return ok(undefined);
  if (!Array.isArray(v) || v.length > GAIT_LIMITS.walkPain) return fail("analysis.walkPain");
  for (const p of v)
    if (
      !isPlainObject(p) ||
      unknownKeys(p, ["side", "level"]).length ||
      !(p.side === null || oneOf(p.side, LIMB_SIDES)) ||
      !intIn(p.level, 0, 10)
    )
      return fail("analysis.walkPain");
  return ok(v as GaitWalkPain[]);
}

const SETUP_KEYS = [
  "mode",
  "aid",
  "orthosis",
  "prosthesis",
  "shoes",
  "heightCm",
  "padSpeedKmh",
  "padCorrection",
  "handrail",
  "familiarised",
] as const;

/**
 * The walk's setup. The pad speed (0.5 to 6.0 km/h, entered), the belt check factor and the handrail
 * belong to the walking pad only; the height is the intake's range (120 to 220 cm).
 */
// SPEC-GAP: pad-correction-bounds. The contract names padCorrection "booth belt check factor" without
// bounds; a factor is accepted from 0.5 to 2 (a belt reading half or twice the entered speed), the
// engineering bound that keeps a mistyped factor out. Written in the contract change log.
export function checkGaitSetup(v: unknown, plan: GaitPlan): Check<GaitSetup> {
  if (!isPlainObject(v)) return fail("setup");
  const extra = extraKey(v, SETUP_KEYS, "setup.");
  if (extra) return fail(extra);
  if (!oneOf(v.mode, GAIT_MODES) || !plan.modes.includes(v.mode)) return fail("setup.mode");
  const pad = v.mode === "walking_pad";
  if (!(v.aid === "none" || oneOf(v.aid, walkingAids))) return fail("setup.aid");
  const o = v.orthosis;
  if (
    !isPlainObject(o) ||
    unknownKeys(o, LIMB_SIDES).length ||
    !Object.values(o).every((x) => oneOf(x, ORTHOSES))
  )
    return fail("setup.orthosis");
  if (!(v.prosthesis === null || oneOf(v.prosthesis, LIMB_SIDES))) return fail("setup.prosthesis");
  if (!bool(v.shoes)) return fail("setup.shoes");
  if (!(v.heightCm === null || intIn(v.heightCm, 120, 220))) return fail("setup.heightCm");
  if (pad ? !inRange(v.padSpeedKmh, 0.5, 6) : v.padSpeedKmh !== null) return fail("setup.padSpeedKmh");
  if (!(v.padCorrection === null || (pad && inRange(v.padCorrection, 0.5, 2))))
    return fail("setup.padCorrection");
  if (pad ? !oneOf(v.handrail, ["none", "light", "firm"] as const) : v.handrail !== null)
    return fail("setup.handrail");
  if (!(v.familiarised === null || (pad && bool(v.familiarised)))) return fail("setup.familiarised");
  return ok({ ...(v as unknown as GaitSetup), aid: v.aid as WalkingAid | "none" });
}

const ANALYSIS_KEYS = [
  "mode",
  "views",
  "replay",
  "staticStance",
  "combined",
  "flags",
  "engineVersion",
  "walkPain",
  "outcome",
] as const;

/** The gait body: the setup and the analysis, which must match the plan's mode and views. */
export function checkGaitBody(
  body: Record<string, unknown>,
  plan: GaitPlan,
): Check<{ setup: GaitSetup; analysis: GaitAnalysis }> {
  const extra = extraKey(body, ["setup", "analysis"], "");
  if (extra) return fail(extra);
  const setup = checkGaitSetup(body.setup, plan);
  if (!setup.ok) return setup;
  const a = body.analysis;
  if (!isPlainObject(a)) return fail("analysis");
  const aExtra = extraKey(a, ANALYSIS_KEYS, "analysis.");
  if (aExtra) return fail(aExtra);
  if (a.mode !== setup.value.mode) return fail("analysis.mode");
  if (!Array.isArray(a.views) || a.views.length < 1 || a.views.length > GAIT_LIMITS.views)
    return fail("analysis.views");
  for (const v of a.views) {
    const view = checkView(v, setup.value.mode);
    if (!view.ok) return view;
  }
  // Only the plan's views, each once (the pad side views once per near side).
  const keys = (a.views as GaitViewResult[]).map((v) => `${v.view}:${v.nearSide ?? ""}`);
  if (new Set(keys).size !== keys.length) return fail("analysis.views");
  const planned =
    setup.value.mode === "overground"
      ? (a.views as GaitViewResult[]).every((v) =>
          plan.views.overground.includes(v.view as "front" | "back" | "side"),
        )
      : (a.views as GaitViewResult[]).every((v) =>
          plan.views.walking_pad.some(
            (p) => p.view === v.view && (p.nearSide ?? null) === (v.nearSide ?? null),
          ),
        );
  if (!planned) return fail("analysis.views");
  const replay = checkReplay(a.replay);
  if (!replay.ok) return replay;
  const stance = checkStance(a.staticStance);
  if (!stance.ok) return stance;
  const combined = checkMetrics(a.combined, "analysis.combined");
  if (!combined.ok) return combined;
  if (!uniqueOf(a.flags, ANALYSIS_FLAGS, ANALYSIS_FLAGS.length)) return fail("analysis.flags");
  if (!isId(a.engineVersion)) return fail("analysis.engineVersion");
  const walkPain = checkWalkPain(a.walkPain);
  if (!walkPain.ok) return walkPain;
  if (a.outcome !== undefined && a.outcome !== "pain_limited" && a.outcome !== "stopped")
    return fail("analysis.outcome");
  if (jsonBytes(a) > GAIT_LIMITS.analysisBytes) return fail("analysis");
  return ok({ setup: setup.value, analysis: a as unknown as GaitAnalysis });
}

/* ------------------------------------------------------------- stop */

export interface FocusStopBody {
  option: StopOptionId;
  movementId?: RomMovementId;
  side?: RomSide;
}

/** The stop list answer: a v1 stop option and, during a movement, that movement and side. */
export function checkFocusStop(body: Record<string, unknown>): Check<FocusStopBody> {
  const extra = extraKey(body, ["option", "movementId", "side"], "");
  if (extra) return fail(extra);
  if (!oneOf(body.option, STOP_OPTION_IDS)) return fail("option");
  if (body.movementId === undefined && body.side === undefined) return ok({ option: body.option });
  if (!oneOf(body.movementId, ROM_MOVEMENT_IDS)) return fail("movementId");
  if (!oneOf(body.side, ROM_SIDES)) return fail("side");
  return ok({ option: body.option, movementId: body.movementId, side: body.side });
}
