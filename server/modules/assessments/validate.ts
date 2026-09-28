/**
 * Strict validation of the movement check request bodies (contract v2, section E). Pure: no DB.
 *
 * Every body is a closed object: an unknown key is refused. Strings the server keeps are ids (no
 * free text, so no health text can enter the database through them), numbers are finite and within
 * the bounds of their unit, lists are bounded, and every JSON field has a size cap. A failed check
 * names the field, never the value.
 */
import { testDef } from "../../../src/movements/assessments";
import type { ProtocolItem } from "../../../src/medical/assessment";
import { parseQuestionId, type Answers } from "../../../src/medical/precheck";
import { DETAIL_KEYS } from "../../../src/medical/progress-rules";
import { type ReasonId, type Setting, type TestId, type TestUnit } from "../../../src/movements/types";

export type Check<T> = { ok: true; value: T } | { ok: false; field: string };
const fail = (field: string) => ({ ok: false, field }) as const;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
  );
}

export function jsonBytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v) ?? "", "utf8");
}

/** Keys of `body` outside `allowed`, in order. */
export function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((k) => !allowed.includes(k));
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const FLAG = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const isId = (v: unknown, re = ID): v is string => typeof v === "string" && re.test(v);
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const intInRange = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && inRange(v, lo, hi);

/* -------------------------------------------------------------- start body */

export const POSE_MODELS = ["lite", "full", "heavy"] as const;
export type PoseModel = (typeof POSE_MODELS)[number];

export interface Device {
  model: PoseModel;
  aspect: number;
  fps: number;
  engineVersion: string;
  appVersion: string;
}

const DEVICE_KEYS = ["model", "aspect", "fps", "engineVersion", "appVersion"] as const;

export function checkDevice(v: unknown): Check<Device> {
  if (!isPlainObject(v) || unknownKeys(v, DEVICE_KEYS).length) return fail("device");
  if (!(POSE_MODELS as readonly unknown[]).includes(v.model)) return fail("device.model");
  // Width over height of the camera frame: portrait phones are about 0.56, landscape about 1.78.
  if (!inRange(v.aspect, 0.2, 5)) return fail("device.aspect");
  if (!inRange(v.fps, 1, 240)) return fail("device.fps");
  if (!isId(v.engineVersion)) return fail("device.engineVersion");
  if (!isId(v.appVersion)) return fail("device.appVersion");
  return {
    ok: true,
    value: {
      model: v.model as PoseModel,
      aspect: v.aspect,
      fps: v.fps,
      engineVersion: v.engineVersion,
      appVersion: v.appVersion,
    },
  };
}

export const MAX_ANSWERS = 80;
export const MAX_ANSWERS_BYTES = 8192;

/**
 * Raw pre-check answers: a map of known question ids (instance ids included) to answer shaped
 * values. Whether a value is a valid option is decided by evaluatePrecheck, which treats a value
 * that does not fit as not answered. pc_setting is set by the route, never by the client.
 */
export function checkAnswers(v: unknown): Check<Answers> {
  if (!isPlainObject(v)) return fail("answers");
  const entries = Object.entries(v);
  if (entries.length > MAX_ANSWERS || jsonBytes(v) > MAX_ANSWERS_BYTES) return fail("answers");
  for (const [id, raw] of entries) {
    const q = id.length <= 80 ? parseQuestionId(id) : null;
    if (!q || q.base === "pc_setting") return fail("answers");
    if (q.part !== undefined && !isId(q.part)) return fail("answers");
    if (!answerShaped(raw)) return fail("answers");
  }
  return { ok: true, value: v as Answers };
}

function answerShaped(raw: unknown): boolean {
  if (typeof raw === "boolean") return true;
  if (typeof raw === "number") return Number.isFinite(raw);
  if (typeof raw === "string") return isId(raw);
  if (Array.isArray(raw)) return raw.length <= 20 && raw.every((x) => isId(x));
  if (isPlainObject(raw)) {
    const e = Object.entries(raw);
    return e.length <= 20 && e.every(([k, x]) => isId(k) && typeof x === "number" && Number.isFinite(x));
  }
  return false;
}

export interface StartBody {
  answers: Answers;
  device: Device;
  setting: Setting;
  boothCode?: string;
  faceCovered?: boolean;
}

const START_KEYS = ["answers", "device", "setting", "boothCode", "faceCovered"] as const;

export function checkStart(body: Record<string, unknown>): Check<StartBody> {
  if (unknownKeys(body, START_KEYS).length) return fail(unknownKeys(body, START_KEYS)[0]);
  const answers = checkAnswers(body.answers);
  if (!answers.ok) return answers;
  const device = checkDevice(body.device);
  if (!device.ok) return device;
  const setting = body.setting ?? "home";
  if (setting !== "home" && setting !== "booth") return fail("setting");
  if (body.boothCode !== undefined && (typeof body.boothCode !== "string" || body.boothCode.length > 64))
    return fail("boothCode");
  if (body.faceCovered !== undefined && typeof body.faceCovered !== "boolean") return fail("faceCovered");
  const out: StartBody = { answers: answers.value, device: device.value, setting };
  if (typeof body.boothCode === "string") out.boothCode = body.boothCode;
  if (typeof body.faceCovered === "boolean") out.faceCovered = body.faceCovered;
  return { ok: true, value: out };
}

/* ------------------------------------------------------------- result body */

/** Per unit bounds of a stored value (contract E): degrees 0 to 180, counts 0 to 60. */
export const UNIT_BOUNDS: Record<TestUnit, [number, number]> = { deg: [0, 180], count: [0, 60] };

/**
 * Skip reasons the client may post for a protocol item during the check (spec 3.6): the ones that
 * arise in a test or at its setup. Every other reason comes from the protocol (intake and pre-check
 * skips) or from the server (between tests), and those items take no result.
 */
// SPEC-GAP: client-skip-reasons. Contract E says "skip reasons enum" without the list; these are
// the reasons of spec 3.6 that arise during a test (stop list, quality, pushedAsk, steady support,
// armrests at setup).
export const CLIENT_SKIP_REASONS = [
  "by_choice",
  "quality",
  "stopped_symptom",
  "needed_arms",
  "needed_support",
  "armrests_needed",
] as const satisfies readonly ReasonId[];

const ARM_CURL_VARIANTS = ["held", "cuff", "arm_only"] as const;
/** Arm curl loads never offered at home in v1 for these conditions (spec 4.2 load rules). */
export const NO_DUMBBELL_AT_HOME = ["parkinsons", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete"];

type DetailCheck = (v: unknown) => boolean;
const oneOf =
  (...values: readonly (string | boolean)[]): DetailCheck =>
  (v) =>
    values.includes(v as string | boolean);
const num =
  (lo: number, hi: number): DetailCheck =>
  (v) =>
    inRange(v, lo, hi);
const int =
  (lo: number, hi: number): DetailCheck =>
  (v) =>
    intInRange(v, lo, hi);
const bool: DetailCheck = (v) => typeof v === "boolean";
/** A measured value may be "unknown": an optional landmark that was not seen (spec 4.0). */
const measured =
  (check: DetailCheck): DetailCheck =>
  (v) =>
    v === "unknown" || check(v);

/**
 * The detail keys a result may carry and the check of each value: the setup fingerprint and engine
 * details the progress rules read (DETAIL_KEYS of src/medical/progress-rules.ts) and the numbers each
 * test stores (tests[].metric.stored). `chair` is set by the server (see sameChair); `sameChair` is
 * the person's answer "same chair as last time" and is not stored.
 */
// SPEC-GAP: detail-allowlist. The contract types detail as a record; the engine must use these keys
// (a new key is added here with its check), so free text can never be stored as a detail.
export const DETAIL_SPEC: Record<string, DetailCheck> = {
  // Setup fingerprint and the person's choices: never unknown.
  bentElbowAccepted: bool,
  loadKg: num(0, 10),
  loadL: num(0, 2),
  loadObject: oneOf("dumbbell", "bottle", "cuff", "none"),
  armrest: oneOf("removed", "in_place"),
  armrests: bool,
  armMode: (v) => isId(v),
  legProsthesis: bool,
  footwear: oneOf("shoes", "barefoot"),
  pdState: oneOf("yes", "unsure"),
  countSource: oneOf("auto", "staff", "self"),
  pushHand: oneOf("left", "right"),
  sameChair: bool,
  // Measured by the engine (src/engine/modes): a value, or "unknown".
  reference: measured(oneOf("trunk", "gravity")),
  view: measured(oneOf("side", "anterolateral")),
  pivot: measured(oneOf("hip", "fixed", "visible_hip", "fixed_pivot")),
  compensated: measured(int(0, 60)),
  unscoredShare: measured(num(0, 1)),
  censored: bool,
  contact: measured(bool),
  rangeLo: measured(num(-1000, 1000)),
  rangeHi: measured(num(-1000, 1000)),
  partial: measured(int(0, 100)),
  first10sCount: measured(int(0, 60)),
  last10sCount: measured(int(0, 60)),
  viewAngle: measured(num(0, 90)),
  medianFps: measured(num(0, 240)),
  returnSec: measured(num(0, 300)),
  shoulderShift: measured(num(-1000, 1000)),
  hSit: measured(num(-10, 10)),
  rise: measured(num(-10, 10)),
  riseToday: measured(num(-10, 10)),
  halfwayCredited: bool,
  stoppedEarly: bool,
  secondsCompleted: measured(num(0, 300)),
  // Arm raise (rangeTest.ts): best attempt and side details.
  bentElbow: measured(bool),
  pastVertical: measured(bool),
  planeZ: measured((v) => bool(v) || inRange(v, -1000, 1000)),
  planeOkSec: measured(num(0, 300)),
  spreadDeg: measured(num(0, 180)),
  elbowDeg: measured(num(0, 180)),
  shrug: measured(num(-10, 10)),
  shoulderShrinkMax: measured(num(0, 10)),
  trunkLeanAtPeak: measured(num(-180, 180)),
  trunkLeanMax: measured(num(-180, 180)),
  leanShiftAtPeak: measured(num(-10, 10)),
  leanShiftMax: measured(num(-10, 10)),
  phoneRollDeg: measured(num(-180, 180)),
  shoulderHike: measured(num(-1000, 1000)),
  // Seated side lean (trunkControl.ts): upright baseline, band, supports and aborts.
  upright: measured(num(-180, 180)),
  uprightSd: measured(num(0, 180)),
  band: measured(num(0, 180)),
  abortLimit: measured(num(0, 180)),
  abort: oneOf("none", "speed", "limit", "loss", "slide"),
  armSupportLikely: measured(bool),
  wristSupport: measured(bool),
  trunkShrinkMax: measured(num(0, 10)),
  widthChangeMax: measured(num(0, 10)),
  hipShiftMax: measured(num(-10, 10)),
};
/** Detail keys only the server writes. */
export const SERVER_DETAIL_KEYS = ["chair"] as const;
// Every key the progress rules read is either accepted from the client or written by the server.
for (const k of DETAIL_KEYS)
  if (!(k in DETAIL_SPEC) && !(SERVER_DETAIL_KEYS as readonly string[]).includes(k))
    throw new Error(`Detail key ${k} has no check`);

export type DetailValue = number | boolean | string;

function checkDetail(v: unknown): Check<Record<string, DetailValue>> {
  if (!isPlainObject(v) || jsonBytes(v) > 2048) return fail("detail");
  for (const [k, x] of Object.entries(v)) {
    const check = Object.hasOwn(DETAIL_SPEC, k) ? DETAIL_SPEC[k] : undefined;
    if (!check || !check(x)) return fail(`detail.${KEY.test(k) ? k : "key"}`);
  }
  return { ok: true, value: v as Record<string, DetailValue> };
}

/** The quality report of the engine: flat numbers, flags, ids, short lists and one level of maps. */
function checkQuality(v: unknown): Check<Record<string, unknown>> {
  if (!isPlainObject(v) || jsonBytes(v) > 4096 || Object.keys(v).length > 30) return fail("quality");
  if (typeof v.ok !== "boolean") return fail("quality.ok");
  const scalar = (x: unknown) =>
    x === null || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || isId(x);
  for (const [k, x] of Object.entries(v)) {
    if (!KEY.test(k)) return fail("quality");
    if (scalar(x)) continue;
    if (Array.isArray(x) && x.length <= 40 && x.every(scalar)) continue;
    if (
      isPlainObject(x) &&
      Object.keys(x).length <= 40 &&
      Object.entries(x).every(([kk, xx]) => isId(kk) && typeof xx === "number" && Number.isFinite(xx))
    )
      continue;
    return fail(`quality.${k}`);
  }
  return { ok: true, value: v };
}

// SPEC-GAP: attempt-shape. The contract lists attempts[] (at most 3 scored) without a shape. An
// attempt is { value (whole, in the unit bounds, or null), valid, durationSec?, flags? }; at most
// the test's own attempts (3 for the range tests, 1 for the timed tests).
export interface Attempt {
  value: number | null;
  valid: boolean;
  durationSec?: number;
  flags?: string[];
}

function checkFlags(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 20 && new Set(v).size === v.length && v.every((f) => isId(f, FLAG));
}

function checkAttempts(v: unknown, unit: TestUnit, max: number): Check<Attempt[]> {
  if (!Array.isArray(v) || v.length > max) return fail("attempts");
  const [lo, hi] = UNIT_BOUNDS[unit];
  const out: Attempt[] = [];
  for (const a of v) {
    if (!isPlainObject(a) || unknownKeys(a, ["value", "valid", "durationSec", "flags"]).length)
      return fail("attempts");
    if (typeof a.valid !== "boolean") return fail("attempts.valid");
    if (!(a.value === null || intInRange(a.value, lo, hi))) return fail("attempts.value");
    if (a.valid && a.value === null) return fail("attempts.value");
    if (a.durationSec !== undefined && !inRange(a.durationSec, 0, 300)) return fail("attempts.durationSec");
    if (a.flags !== undefined && !checkFlags(a.flags)) return fail("attempts.flags");
    const attempt: Attempt = { value: a.value as number | null, valid: a.valid };
    if (a.durationSec !== undefined) attempt.durationSec = a.durationSec as number;
    if (a.flags !== undefined) attempt.flags = a.flags as string[];
    out.push(attempt);
  }
  return { ok: true, value: out };
}

export interface ResultBody {
  testId: TestId;
  side: "left" | "right" | "none";
  value: number | null;
  unit: TestUnit;
  attempts: Attempt[];
  quality: Record<string, unknown>;
  detail: Record<string, DetailValue>;
  flags: string[];
  nValid: number;
  median: number | null;
  skippedReason: ReasonId | null;
  variant: string | null;
  poseModel: PoseModel;
  movementVersion: number;
  engineVersion: string;
}

const RESULT_KEYS = [
  "testId",
  "side",
  "value",
  "unit",
  "attempts",
  "quality",
  "detail",
  "flags",
  "nValid",
  "median",
  "skippedReason",
  "variant",
  "poseModel",
  "movementVersion",
  "engineVersion",
] as const;

/** What the check needs to know about the person and the check to validate a result. */
export interface ResultScope {
  item: ProtocolItem;
  setting: Setting;
  conditions: readonly string[];
}

/**
 * A result for one protocol item (the caller found the item by testId and side and passes it in
 * `scope`). Checks every field, then the rules that tie them together: a skip has no score and no
 * attempts; a score has valid attempts, is the best of them (max) or the single trial, and passed
 * the quality gate; the unit, version, variant and push hand follow the frozen protocol item.
 */
export function checkResult(body: Record<string, unknown>, scope: ResultScope): Check<ResultBody> {
  const extra = unknownKeys(body, RESULT_KEYS);
  if (extra.length) return fail(KEY.test(extra[0]) ? extra[0] : "body");
  const { item } = scope;
  const def = testDef(item.testId);
  if (body.unit !== def.unit) return fail("unit");
  if (body.movementVersion !== item.version) return fail("movementVersion");
  if (!isId(body.engineVersion)) return fail("engineVersion");
  if (!(POSE_MODELS as readonly unknown[]).includes(body.poseModel)) return fail("poseModel");
  const [lo, hi] = UNIT_BOUNDS[def.unit];

  const skippedReason = body.skippedReason ?? null;
  if (skippedReason !== null && !(CLIENT_SKIP_REASONS as readonly unknown[]).includes(skippedReason))
    return fail("skippedReason");
  const value = body.value;
  if (!(value === null || intInRange(value, lo, hi))) return fail("value");
  const median = body.median ?? null;
  if (!(median === null || inRange(median, lo, hi))) return fail("median");
  if (!intInRange(body.nValid, 0, def.attempts)) return fail("nValid");
  const attempts = checkAttempts(body.attempts, def.unit, def.attempts);
  if (!attempts.ok) return attempts;
  const quality = checkQuality(body.quality);
  if (!quality.ok) return quality;
  const detail = checkDetail(body.detail);
  if (!detail.ok) return detail;
  if (!checkFlags(body.flags)) return fail("flags");

  if (skippedReason !== null) {
    if (value !== null) return fail("value");
    if (median !== null) return fail("median");
    if (body.nValid !== 0) return fail("nValid");
    // The stopped or skipped test stores no score (spec 4.0), so no attempts either.
    if (attempts.value.length !== 0) return fail("attempts");
  } else {
    if (value === null) return fail("value");
    const valid = attempts.value.filter((a) => a.valid).map((a) => a.value as number);
    if (valid.length === 0 || body.nValid !== valid.length) return fail("nValid");
    const best = def.best === "max" ? Math.max(...valid) : valid.length === 1 ? valid[0] : NaN;
    if (value !== best) return fail("value");
    if (median !== null && (median < Math.min(...valid) || median > Math.max(...valid)))
      return fail("median");
    // An attempt that fails the quality gate is repeated, never stored with a score (spec 4.0).
    if (quality.value.ok !== true) return fail("quality.ok");
  }

  const variant = checkVariant(body.variant ?? null, skippedReason !== null, scope.item);
  if (!variant.ok) return variant;

  const d = detail.value;
  if (d.countSource === "staff" && scope.setting !== "booth") return fail("detail.countSource");
  if (d.pushHand !== undefined) {
    const handsAllowed = variant.value === "arms_assisted" || variant.value === "arms_assisted_steady";
    if (!handsAllowed || (item.pushHand !== undefined && d.pushHand !== item.pushHand))
      return fail("detail.pushHand");
  }
  // Spec 4.2 load rules. A scored arm curl names its load object, so the rules below cannot be
  // skipped by leaving it out: kilograms go with a dumbbell or a wrist weight (cuff), litres with a
  // bottle, and no load with arm_only.
  const scoredCurl = item.testId === "arm_curl_30s" && skippedReason === null;
  if (scoredCurl && d.loadObject === undefined) return fail("detail.loadObject");
  if (item.testId === "arm_curl_30s" && d.loadObject !== undefined) {
    const v = variant.value;
    const fits =
      v === null ||
      (v === "arm_only" && d.loadObject === "none") ||
      (v === "cuff" && d.loadObject === "cuff") ||
      (v === "held" && (d.loadObject === "dumbbell" || d.loadObject === "bottle"));
    if (!fits) return fail("detail.loadObject");
    const noDumbbell = NO_DUMBBELL_AT_HOME.some((c) => scope.conditions.includes(c));
    if (d.loadObject === "dumbbell" && scope.setting === "home" && noDumbbell)
      return fail("detail.loadObject");
  }
  if (d.loadKg !== undefined && d.loadObject !== "dumbbell" && d.loadObject !== "cuff")
    return fail("detail.loadKg");
  if (d.loadL !== undefined && d.loadObject !== "bottle") return fail("detail.loadL");

  return {
    ok: true,
    value: {
      testId: item.testId,
      side: item.side,
      value: value as number | null,
      unit: def.unit,
      attempts: attempts.value,
      quality: quality.value,
      detail: d,
      flags: body.flags as string[],
      nValid: body.nValid as number,
      median: median as number | null,
      skippedReason: skippedReason as ReasonId | null,
      variant: variant.value,
      poseModel: body.poseModel as PoseModel,
      movementVersion: item.version,
      engineVersion: body.engineVersion as string,
    },
  };
}

/**
 * The variant of a result against the frozen protocol item. The arm raise and the side lean have no
 * variant. The arm curl stores the load kind (held, cuff or arm_only; spec 4.2), limited by the day's
 * variant: arm_only forces arm_only, cuff_or_arm_only allows a wrist weight or none. The chair stand
 * stores the variant of its protocol item.
 */
function checkVariant(raw: unknown, skipped: boolean, item: ProtocolItem): Check<string | null> {
  if (raw !== null && typeof raw !== "string") return fail("variant");
  switch (item.testId) {
    case "shoulder_abduction":
    case "trunk_control_seated":
      return raw === null ? { ok: true, value: null } : fail("variant");
    case "arm_curl_30s": {
      if (raw === null) return skipped ? { ok: true, value: null } : fail("variant");
      if (!(ARM_CURL_VARIANTS as readonly string[]).includes(raw)) return fail("variant");
      if (item.variant === "arm_only" && raw !== "arm_only") return fail("variant");
      if (item.variant === "cuff_or_arm_only" && raw === "held") return fail("variant");
      return { ok: true, value: raw };
    }
    case "chair_stand_30s":
      if (raw === null) return skipped ? { ok: true, value: null } : fail("variant");
      return raw === item.variant ? { ok: true, value: raw } : fail("variant");
  }
}
