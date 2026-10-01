/**
 * Formatting rules of the results and My results screens (UX spec 0.2, S50 to S54), pure:
 *   dayLabel          a date in Gregorian with Arabic month names (Q30), in Asia/Riyadh
 *   valueParts        a number and its unit word, as the big result value shows them
 *   resultSentence    data:tests.<id>.resultSentence with its tokens (side, load, variant, seconds)
 *   sideLabel         the side of a result row in the S27 words («ذراعك اليمنى», «الميل إلى يمينك»)
 *   whenText          the {when} line of a lock (Q33 (4), pausedWhenTokens)
 * Every text comes from the copy (t) or the check data; nothing here writes words of its own.
 */
import { fmtDate, type Lang } from "../../app/i18n";
import { countPhrase, formatNumber, interpolate, pluralForm, t, unitWord } from "../../i18n";
import { CHECK_DATA, pausedWhenText, testDef } from "../../movements/assessments";
import type { ReasonId, Side, TestId, Text, UnitFormId } from "../../movements/types";
import type { LockWhen } from "../assessment/api";

/** The person's time zone (UX spec S01: Asia/Riyadh by default). */
export const TIME_ZONE = "Asia/Riyadh";

/** The seconds of the timed tests, the {seconds} token of their result sentences. */
export const TIMED_SECONDS = 30;

/**
 * A date as the check shows it (Q30): Gregorian in both languages, Arabic month names and Arabic Indic
 * digits in Arabic, in Asia/Riyadh. The weekday is shown by default («الأحد، ٢٥ أكتوبر»); the example
 * page adds the year so its fixed dates never look like live data (S54).
 */
export function dayLabel(lang: Lang, at: number, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return fmtDate(at, lang, {
    ...(opts.weekday === false ? {} : { weekday: "long" }),
    day: "numeric",
    month: "long",
    ...(opts.year ? { year: "numeric" } : {}),
    timeZone: TIME_ZONE,
  });
}

/** The unit form of a test's result value (data:tests.<id>.resultUnit: deg, bends or stands). */
export function resultUnitOf(testId: TestId): UnitFormId {
  return testDef(testId).resultUnit;
}

/** Counts are compared without the unit word (O8: «زيادة ٣ عن البداية»). */
export function isCountUnit(unit: UnitFormId): boolean {
  return unit === "bends" || unit === "stands";
}

export interface ValueParts {
  /** The number in the page's digits, never negative. */
  number: string;
  /** The unit word shown beside the big number. */
  unit: string;
  /** The number and its unit read together («١٢٠ درجة», «درجتين», "120 degrees"). */
  phrase: string;
}

/**
 * A result value for the big number display (S51): the number at 56 px and the unit word beside it.
 * The Arabic one and two forms stand for the number and the word together («درجتين»), so a number
 * shown on its own beside its unit takes the unit's counted form instead: the visible pair reads as a
 * label («٢ درجة»), and the phrase is what a screen reader hears.
 */
// SPEC-GAP: big-number-dual. The spec shows the number at 56 px with the unit word beside it; Arabic
// never writes ١ or ٢ before the noun, so the visible label uses the counted form and the accessible
// text is the full phrase from countPhrase («درجتين»).
export function valueParts(lang: Lang, unit: UnitFormId, n: number): ValueParts {
  const value = Math.round(Math.abs(n));
  const form = pluralForm(lang, value);
  const label =
    lang === "ar" && (form === "one" || form === "two")
      ? unitWord(lang, unit, 0)
      : unitWord(lang, unit, value);
  return { number: formatNumber(lang, value), unit: label, phrase: countPhrase(lang, unit, value) };
}

/** "more than {value}" of a censored side lean value (data:progress.noVerdict.censored). */
export function moreThan(lang: Lang, value: number): string {
  return interpolate(lang, CHECK_DATA.progress.noVerdict.censored[lang], { value: Math.round(value) });
}

/** The H9 next check line (data:progress.nextDue) with its date. */
export function nextDueText(lang: Lang, due: number): string {
  return interpolate(lang, CHECK_DATA.progress.nextDue[lang], { date: dayLabel(lang, due) });
}

/** The side of a result row: «ذراعك اليمنى» for the arm tests, «الميل إلى يمينك» for the side lean. */
export function sideLabel(lang: Lang, testId: TestId, side: string): string | null {
  if (side !== "left" && side !== "right") return null;
  if (testId === "trunk_control_seated")
    return t(lang, side === "left" ? "assessment.plan.sideLeanLeft" : "assessment.plan.sideLeanRight");
  return t(lang, side === "left" ? "assessment.plan.sideArmLeft" : "assessment.plan.sideArmRight");
}

type Tokens = { side?: Record<Side, Text>; load?: Record<string, Text>; variant?: Record<string, Text> };

/** The details of a result the sentence reads (ResultPayload.detail and variant). */
export interface SentenceDetail {
  loadObject?: unknown;
  loadKg?: unknown;
  loadL?: unknown;
}

/** The load token of an arm curl result (resultTokens.load), from the stored load details. */
function loadToken(detail: SentenceDetail, variant: string | null | undefined): string {
  if (variant === "arm_only") return "none";
  switch (detail.loadObject) {
    case "dumbbell":
      return "held";
    case "cuff":
      return "cuff";
    case "bottle":
      return detail.loadL === 0.5 ? "bottle_half" : detail.loadL === 1.5 ? "bottle_1_5" : "bottle_1";
    default:
      return "none";
  }
}

/**
 * The result sentence under a value (data:tests.<id>.resultSentence), with its tokens: the side
 * (resultTokens.side), the arm curl load (resultTokens.load, with {kg}), the chair stand variant
 * (resultTokens.variant), the 30 seconds of the timed tests and the value with its unit words.
 */
export function resultSentence(
  lang: Lang,
  testId: TestId,
  side: string,
  value: number,
  o: { detail?: SentenceDetail; variant?: string | null } = {},
): string {
  const def = testDef(testId);
  const tokens = def.resultTokens as Tokens;
  const vars: Record<string, string | number> = {
    value: Math.round(Math.abs(value)),
    unit: def.resultUnit,
    seconds: TIMED_SECONDS,
  };
  if ((side === "left" || side === "right") && tokens.side) vars.side = tokens.side[side][lang];
  if (tokens.load) {
    const load = tokens.load[loadToken(o.detail ?? {}, o.variant)] ?? tokens.load.none;
    const kg = typeof o.detail?.loadKg === "number" ? o.detail.loadKg : 0;
    vars.load = interpolate(lang, load[lang], { kg });
  }
  if (tokens.variant)
    vars.variant = (tokens.variant[o.variant ?? "standard"] ?? tokens.variant.standard)[lang];
  // A unit word that does not follow its number («you did {value} full {unit}») agrees with the
  // value («1 full bend», "12 full bends"); a {value} {unit} pair is phrased by interpolate.
  let template = def.resultSentence[lang];
  if (!template.includes("{value} {unit}"))
    template = template.replaceAll("{unit}", unitWord(lang, def.resultUnit, Math.round(Math.abs(value))));
  return interpolate(lang, template, vars);
}

/** {time} of a clock form of a lock end: «٧:٥٠ صباحًا», "7:50 am". */
function clockText(lang: Lang, time: NonNullable<LockWhen["time"]>): string {
  const suffix = CHECK_DATA.pausedWhenTokens.timeSuffix[time.suffix][lang];
  const minute = String(Math.max(0, Math.min(59, Math.round(time.minute)))).padStart(2, "0");
  // A clock time reads hour then minutes from the left in both languages: in Arabic the time is an
  // isolated left to right run (LRI ... PDI), so the colon never flips it («٧:٥٠» not «٥٠:٧»).
  const clock = interpolate(lang, `{hour}:${minute}`, { hour: time.hour });
  return `${lang === "ar" ? `\u2066${clock}\u2069` : clock} ${suffix}`;
}

/** The {when} line of a lock (Q33 (4), data:pausedWhen.*), or null when the server sent none. */
export function whenText(lang: Lang, when: LockWhen | null | undefined): string | null {
  if (!when) return null;
  const line = pausedWhenText(when.token, lang);
  return when.time
    ? interpolate(lang, line, { time: clockText(lang, when.time) })
    : line.replace("{time}", "");
}

/** Whether a reason id has a text in the check data (a skip reason the UI can name, P6). */
export function isReasonId(id: string): id is ReasonId {
  return id in CHECK_DATA.reasons;
}

/** A week start as the server sends it (an ISO day or epoch ms) as epoch ms at Riyadh noon. */
export function weekStartMs(start: number | string): number | null {
  if (typeof start === "number") return Number.isFinite(start) ? start : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
}
