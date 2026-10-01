/**
 * Pure rules of the flow screens (S04 to S33, S35): what each screen says and lists, computed from
 * the flow model, the check data and the copy. No DOM, no clock of its own (a `now` comes in), so
 * every rule here is unit tested (tests/flow-copy.test.ts).
 *
 * Clinical texts come from the check data (src/movements/assessments.ts), interface copy from t().
 * Nothing here writes a user facing sentence of its own.
 */
import type { Lang } from "../../../app/i18n";
import { localizeDigits, t, type I18nKey, type Vars } from "../../../i18n";
import {
  allowedLoads,
  statedMinutes,
  LOAD_LIMITS,
  type CheckContext,
  type LoadKind,
  type ProtocolItem,
  type Setting,
} from "../../../medical/assessment";
import {
  lockKind,
  parseQuestionId,
  pausedWhen,
  questionForm,
  type Answers,
  type ClockTime,
  type PrecheckEnv,
} from "../../../medical/precheck";
import {
  CHECK_DATA,
  cueLine,
  isCheckCueId,
  pausedWhenText,
  precheckItem,
  screenText,
  skipReasonText,
  testDef,
} from "../../../movements/assessments";
import type {
  AreaId,
  CheckCueId,
  CheckPosition,
  LockReasonId,
  PdDoseBucket,
  PrecheckItem,
  ReasonId,
  ScreenId,
  Side,
  TestId,
} from "../../../movements/types";
import type { LockWhen } from "../api";
import { oneTest } from "../booth/settings";

/* ================================================================ general */

/** A line to show and speak: its display text and, where the data has one, its speech form. */
export interface SpeechLine {
  display: string;
  /** The fully vocalised Arabic line (arTts) or the English speech; else the display text is read. */
  speech?: string;
}

/** A spoken cue of the check data, or a text line. */
export type SpeechItem = { cue: CheckCueId } | SpeechLine;

/** The display and speech of a cue in a language (ar shown, arTts spoken; en both). */
export function cueSpeech(id: CheckCueId, lang: Lang): SpeechLine {
  const c = cueLine(id);
  return lang === "ar" ? { display: c.ar, speech: c.arTts } : { display: c.en, speech: c.en };
}

/** Only cue ids the data has; anything else is dropped (never a missing line at runtime). */
export function knownCues(ids: readonly string[]): CheckCueId[] {
  return ids.filter((id): id is CheckCueId => isCheckCueId(id));
}

/**
 * Answer labels for the shared answer rows, which show their label as plain text: the digits of an
 * Arabic label in Arabic Indic digits (Q30), as t() and bidiText show every other number.
 */
export function localLabels<T extends { label: string }>(lang: Lang, options: readonly T[]): T[] {
  return options.map((o) => ({ ...o, label: localizeDigits(lang, o.label) }));
}

/** A list of labels in running text: «الكتف، الركبة» · "Shoulder, Knee". */
export function joinList(lang: Lang, items: readonly string[]): string {
  return items.join(lang === "ar" ? "، " : ", ");
}

/** "a and b" / «أ و ب» for the helper need line ({tests}). */
export function joinAnd(lang: Lang, items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  const head = items.slice(0, -1).join(lang === "ar" ? "، " : ", ");
  const last = items[items.length - 1];
  return lang === "ar" ? `${head} و${last}` : `${head} and ${last}`;
}

/**
 * Splits a text into sentences after a full stop or a question mark followed by a space (SentenceStack,
 * UX spec S33; 7.2-12). Nothing is reordered or dropped.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.؟?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The display text and its speech split at the same full stops (7.2-12). When the counts differ the
 * line plays whole with no highlight (`aligned` false).
 */
export function alignedSentences(
  display: string,
  speech?: string,
): { lines: SpeechLine[]; aligned: boolean } {
  const shown = splitSentences(display);
  if (!speech) return { lines: shown.map((d) => ({ display: d })), aligned: true };
  const spoken = splitSentences(speech);
  if (spoken.length !== shown.length) return { lines: [{ display, speech }], aligned: false };
  return { lines: shown.map((d, i) => ({ display: d, speech: spoken[i] })), aligned: true };
}

/**
 * Whether a data text names the 937 advice line: its call control follows the text (Q22). 997 is on
 * the emergency screens only (D-016), never on the postpone screens.
 */
export const names937 = (text: string) => /937|٩٣٧/.test(text);

/* ================================================================ emphasis (0.2) */

/**
 * Words bolded in data questions without changing the text (UX spec 0.2, S17): «الآن» and «مفاجئ» in
 * pc_urgent, «اليوم» in pc_unwell. The UI finds them in the text; a word that is not there is ignored.
 */
export const EMPHASIS: Record<string, { ar: string[]; en: string[] }> = {
  pc_urgent: { ar: ["الآن", "مفاجئ", "مفاجئة"], en: ["now", "Now", "sudden", "Sudden"] },
  pc_unwell: { ar: ["اليوم"], en: ["today"] },
};

export type EmphasisPart = { text: string; strong: boolean };

/** Splits a text into plain and emphasised parts (whole words only). */
export function emphasize(text: string, words: readonly string[]): EmphasisPart[] {
  if (!words.length) return [{ text, strong: false }];
  const escaped = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A word boundary that works for Arabic too: not preceded or followed by a letter.
  const re = new RegExp(`(?<![\\p{L}\\p{M}])(${escaped.join("|")})(?![\\p{L}\\p{M}])`, "gu");
  const out: EmphasisPart[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), strong: false });
    out.push({ text: m[0], strong: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), strong: false });
  return out;
}

/* ================================================================ durations (S05, S14, S27) */

/** Vars of a duration range for t(): {minutesFrom} to {minutesTo} {unit}. */
export function rangeVars([from, to]: readonly [number, number]): Vars {
  return { minutesFrom: from, minutesTo: to, unit: "min" };
}

const POSITIONS: readonly CheckPosition[] = ["chair", "wheelchair", "standing"];

/**
 * The guest's two paths on S05 (O40, F-2, C11), from the tests that run at this booth (D-016 item 4),
 * each the stated range of its tests (statedMinutes): the one test path is its one test alone (the
 * arm raise, or the first test still on, F-1 D), at its upper minutes; until the position is known the
 * full check spans the three positions' base selections, so the range S27 states for any visitor's
 * tests lies inside it. A path with no test to run is null, and S05 does not offer it.
 */
export function guestMinutes(testsOff: readonly TestId[]): {
  quick: number | null;
  full: [number, number] | null;
} {
  const one = oneTest(testsOff);
  const quick = one ? statedMinutes([one], "booth")[1] : null;
  let from = Infinity;
  let to = 0;
  for (const position of POSITIONS) {
    const all = CHECK_DATA.selection.basePerPosition[position] as readonly TestId[];
    const tests = all.filter((t) => !testsOff.includes(t));
    if (!tests.length) continue;
    const [a, b] = statedMinutes(tests, "booth");
    from = Math.min(from, a);
    to = Math.max(to, b);
  }
  return { quick, full: to > 0 ? [from, to] : null };
}

/* ================================================================ guest steps (S06 to S11) */

export type GuestStepNo = 1 | 2 | 3 | 4 | 5 | 6;

export interface GuestStepView {
  /** Screen id of the step. */
  screen: "S06" | "S07" | "S08" | "S08b" | "S10" | "S11";
  question: string;
  hint?: string;
  multiple: boolean;
  exclusive?: string;
  exclusiveFirst?: boolean;
  options: { value: string; label: string }[];
}

const CONDITION_IDS = [
  "stroke",
  "ms",
  "cerebral_palsy",
  "sci_complete",
  "sci_incomplete",
  "sci_unsure",
  "parkinsons",
  "upper_limb_unilateral",
  "lower_limb_unilateral",
  "arthritis",
  "cfs_moderate",
  "cardiac",
  "other",
] as const;
const PAIN_IDS = ["shoulder", "elbow", "wrist", "back", "hip", "knee", "none"] as const;
const RESTRICTION_IDS = [
  "no_overhead",
  "no_resistance",
  "no_weight_bearing",
  "balance_support",
  "no_exercise",
  "none",
] as const;

const opt = (lang: Lang, key: string) => t(lang, `assessment.options.${key}` as I18nKey);

/**
 * One guest step (UX spec S06 to S11, Q19): the question, its hint and its options in the spec order.
 * The conditions step reads its title, helper line and "None of these" from the check data (Q19 (1));
 * clearance reads the Q19 question and its three answers from the data, word for word.
 */
export function guestStepView(lang: Lang, step: GuestStepNo): GuestStepView {
  const gb = CHECK_DATA.selection.guestBooth;
  switch (step) {
    case 1:
      return {
        screen: "S06",
        question: t(lang, "assessment.guest.position.ask"),
        hint: t(lang, "assessment.guest.position.hint"),
        multiple: false,
        options: (["chair", "wheelchair", "standing", "bed"] as const).map((v) => ({
          value: v,
          label: opt(lang, `position.${v}`),
        })),
      };
    case 2:
      return {
        screen: "S07",
        question: t(lang, "assessment.guest.support.ask"),
        multiple: false,
        options: (["right", "left", "none"] as const).map((v) => ({
          value: v,
          label: opt(lang, `support.${v}`),
        })),
      };
    case 3:
      return {
        screen: "S08",
        question: gb.conditionsStep.title[lang],
        hint: gb.conditionsStep.helper[lang],
        multiple: true,
        exclusive: "none",
        exclusiveFirst: true,
        options: [
          { value: "none", label: gb.conditionsStep.noneChip[lang] },
          ...CONDITION_IDS.map((v) => ({ value: v, label: opt(lang, `condition.${v}`) })),
        ],
      };
    case 4:
      return {
        screen: "S08b",
        question: gb.clearance.ask[lang],
        multiple: false,
        options: gb.clearance.options.map((o) => ({ value: o.value, label: o.label[lang] })),
      };
    case 5:
      return {
        screen: "S10",
        question: t(lang, "assessment.guest.pain.ask"),
        hint: t(lang, "assessment.guest.chooseAll"),
        multiple: true,
        exclusive: "none",
        options: PAIN_IDS.map((v) => ({ value: v, label: opt(lang, `pain.${v}`) })),
      };
    case 6:
      return {
        screen: "S11",
        question: t(lang, "assessment.guest.restrictions.ask"),
        hint: t(lang, "assessment.guest.chooseAll"),
        multiple: true,
        exclusive: "none",
        options: RESTRICTION_IDS.map((v) => ({ value: v, label: opt(lang, `restriction.${v}`) })),
      };
  }
}

/**
 * O39: the clearance hint ships in the guest step once Nasser ratifies it as an addition to Q19 (its
 * data status says so). Until then it is not shown.
 */
export const CLEARANCE_HINT_RATIFIED = false;

/* ================================================================ context summary (S13) */

export interface ContextRow {
  label: string;
  value: string;
}

/**
 * The four rows of S13 in the person's own words (the copy labels, O44). Conditions are never listed
 * (privacy on a screen others may see). An intake value without a label is left out, never shown as
 * an id.
 */
export function contextRows(lang: Lang, ctx: CheckContext): ContextRow[] {
  const none = t(lang, "assessment.context.none");
  const labelsOf = (group: "pain" | "restriction", ids: readonly string[]) =>
    ids
      .filter((id) => id !== "none")
      .map((id) => opt(lang, `${group}.${id}`))
      .filter((label) => !label.startsWith("assessment."));
  const pain = labelsOf("pain", ctx.pain);
  const restrictions = labelsOf("restriction", ctx.restrictions);
  return [
    { label: t(lang, "assessment.context.position"), value: opt(lang, `position.${ctx.position}`) },
    {
      label: t(lang, "assessment.context.support"),
      value:
        ctx.support === "left"
          ? t(lang, "assessment.context.sideLeft")
          : ctx.support === "right"
            ? t(lang, "assessment.context.sideRight")
            : none,
    },
    { label: t(lang, "assessment.context.pain"), value: pain.length ? joinList(lang, pain) : none },
    {
      label: t(lang, "assessment.context.restrictions"),
      value: restrictions.length ? joinList(lang, restrictions) : none,
    },
  ];
}

/* ================================================================ intro (S14) */

export type IntroNeed =
  | "chairSteady"
  | "chairArmrests"
  | "chairArmless"
  | "chairStand"
  | "wheelchair"
  | "phone"
  | "space"
  | "helper"
  | "loadFirst"
  | "loadSame"
  | "shoes";

/**
 * "What you need today" (S14): one line per need in the spec order, from the base tests and the
 * position. At the booth the list is replaced by need.booth (the caller shows that line instead).
 */
export function introNeeds(o: {
  tests: readonly TestId[];
  position: CheckPosition;
  setting: Setting;
  retest: boolean;
  /** Tests that may need a helper at home (the side lean, and the chair stand for the listed groups). */
  helperTests: readonly TestId[];
  /** The arm curl may run with a load (no rule forbids it). */
  loadPossible: boolean;
}): IntroNeed[] {
  const has = (id: TestId) => o.tests.includes(id);
  const out: IntroNeed[] = [];
  if (o.position === "wheelchair") {
    if (has("trunk_control_seated")) out.push("wheelchair");
  } else {
    if (has("trunk_control_seated")) out.push("chairArmrests");
    if (has("arm_curl_30s")) out.push("chairArmless");
    if (has("chair_stand_30s")) out.push("chairStand");
    if (
      !has("trunk_control_seated") &&
      !has("arm_curl_30s") &&
      !has("chair_stand_30s") &&
      has("shoulder_abduction")
    )
      out.push("chairSteady");
  }
  out.push("phone", "space");
  if (o.setting === "home" && o.helperTests.length > 0) out.push("helper");
  if (o.setting === "home" && has("arm_curl_30s") && o.loadPossible)
    out.push(o.retest ? "loadSame" : "loadFirst");
  if (has("chair_stand_30s")) out.push("shoes");
  return out;
}

/** Conditions after which the chair stand needs a helper at home (Q11), for the need line only. */
const STAND_HELPER_CONDITIONS = ["parkinsons", "stroke", "sci_incomplete", "cerebral_palsy"];

/** Tests that may need a helper at home, before the pre-check (Q11: every first home side lean). */
export function introHelperTests(tests: readonly TestId[], ctx: CheckContext, setting: Setting): TestId[] {
  if (setting !== "home") return [];
  return tests.filter(
    (id) =>
      id === "trunk_control_seated" ||
      (id === "chair_stand_30s" && STAND_HELPER_CONDITIONS.some((c) => ctx.conditions.includes(c))),
  );
}

/* ================================================================ pre-check questions (S17 to S24) */

export type QuestionKind =
  | "yes_no"
  | "yes_no_unsure"
  | "scale"
  | "areaScale"
  | "single"
  | "listConfirm"
  | "subYesNo"
  | "areaChips"
  | "areaClear";

export interface AreaChoice {
  id: string;
  label: string;
}

export interface QuestionView {
  id: string;
  item: PrecheckItem;
  kind: QuestionKind;
  /** Small heading above the question (pc_steadi, a surgery area). */
  groupHeading?: string;
  question: string;
  /** Words to bold (0.2). */
  emphasis: string[];
  /** A non interactive list under the question (pc_urgent, pc_sci_ready, examples at home). */
  list?: string[];
  listHeading?: string;
  options: { value: string; label: string }[];
  /** Area chips (pc_pain_areas, the areas follow up). */
  areas?: AreaChoice[];
  /** What Listen reads, in order: the question, the list, each answer. */
  speech: SpeechLine[];
}

/** Every pain area in data order (shoulders, elbows, wrists, back, hip, knee). */
export function areaChoices(lang: Lang): AreaChoice[] {
  return CHECK_DATA.areas.map((a) => ({ id: a.id, label: a.label[lang] }));
}

/** The label of a surgery area: its own, or the pain area it uses. */
export function surgeryAreaLabel(id: string, lang: Lang): string {
  const s = CHECK_DATA.surgeryAreas.find((a) => a.id === id);
  if (!s) return id;
  if (s.label) return s.label[lang];
  const area = CHECK_DATA.areas.find((a) => a.id === s.usesArea);
  return area ? area.label[lang] : id;
}

export function surgeryAreaChoices(lang: Lang): AreaChoice[] {
  return CHECK_DATA.surgeryAreas.map((a) => ({ id: a.id, label: surgeryAreaLabel(a.id, lang) }));
}

/** Fills {name} tokens of a data text; an unknown token is left in place. */
export function fillTokens(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/**
 * The long standing signs line (O37): not shown anywhere, the booth included, until the Q18 (6)
 * cognitive testing of the line is complete (its data status).
 */
export const CHRONIC_NOTE_SHOWN = false;

/**
 * Everything a question screen shows and reads for one question instance (S17 to S24): the data
 * text in the form questionForm chooses (askFirstCheck, askDirect, the position form, the examples
 * at home), its tokens filled, the list, the answers in data order and the speech lines.
 */
export function questionView(env: PrecheckEnv, answers: Answers, id: string, lang: Lang): QuestionView {
  const parsed = parseQuestionId(id);
  if (!parsed) throw new RangeError(`Unknown question ${id}`);
  const item = precheckItem(parsed.base) as PrecheckItem;
  const part = parsed.part;
  const form = questionForm(env, answers, id);
  const optionsOf = (): { value: string; label: string }[] =>
    localLabels(
      lang,
      (item.options ?? []).map((o) => ({ value: String(o.value), label: o.label[lang] })),
    );
  const optionSpeech = (): SpeechLine[] =>
    (item.options ?? []).map((o) => ({
      display: o.label[lang],
      speech: lang === "ar" ? (o.label.arTts ?? o.label.ar) : o.label.en,
    }));
  const emphasis = EMPHASIS[item.id]?.[lang] ?? [];

  // pc_steadi: one sub question per instance, with the group heading.
  if (item.type === "three_yes_no") {
    const sub = item.items?.find((x) => x.id === part);
    const text =
      (form.text === "askFirstCheck" && sub?.askFirstCheck ? sub.askFirstCheck : sub?.ask)?.[lang] ?? "";
    const heading = t(lang, "assessment.precheck.steadi.heading");
    return {
      id,
      item,
      kind: "subYesNo",
      groupHeading: heading,
      question: text,
      emphasis,
      options: optionsOf(),
      speech: [{ display: heading }, { display: text }, ...optionSpeech()],
    };
  }

  // yes_no_then_areas: the areas follow up (chips) and, for surgery, the clearance per area.
  if (item.type === "yes_no_then_areas" && part) {
    if (part === "areas") {
      const text = item.followUp?.[lang] ?? "";
      return {
        id,
        item,
        kind: "areaChips",
        question: text,
        emphasis,
        options: [],
        areas: item.surgeryAreas ? surgeryAreaChoices(lang) : areaChoices(lang),
        speech: [{ display: text }],
      };
    }
    const heading = surgeryAreaLabel(part, lang);
    const text = item.clearAsk?.[lang] ?? "";
    return {
      id,
      item,
      kind: "areaClear",
      groupHeading: heading,
      question: text,
      emphasis,
      options: optionsOf(),
      speech: [{ display: heading }, { display: text }, ...optionSpeech()],
    };
  }

  // The question text in the form this person sees.
  let text = "";
  let speech: string | undefined;
  let list: string[] | undefined;
  let listSpeech: string[] | undefined;
  let listHeading: string | undefined;
  if (form.examples && item.examples) {
    const ex = item.examples;
    const ask = form.text === "askFirstCheck" && ex.askFirstCheck ? ex.askFirstCheck : ex.ask;
    text = ask[lang];
    speech = lang === "ar" ? ask.arTts : ask.en;
    list = ex.list[lang];
    listSpeech = lang === "ar" ? ex.list.arTts : ex.list.en;
    listHeading = ex.heading[lang];
  } else if (form.text === "askByPosition" && item.askByPosition) {
    text = item.askByPosition[form.position ?? "chair"][lang];
  } else if (form.text === "askDirect" && item.askDirect) {
    text = item.askDirect[lang];
  } else if (form.text === "askFirstCheck" && item.askFirstCheck) {
    text = item.askFirstCheck[lang];
  } else if (item.ask) {
    text = item.ask[lang];
    speech = lang === "ar" ? (part && item.ask.arTtsByTest?.[part as TestId]) || item.ask.arTts : item.ask.en;
  }
  if (!list && item.list) {
    list = item.list[lang];
    listSpeech = lang === "ar" ? item.list.arTts : item.list.en;
  }
  // Tokens of instance questions: {area}, {side}, {test}.
  const vars: Record<string, string> = {};
  if (part && item.areaTokens?.[part as keyof typeof item.areaTokens])
    vars.area = item.areaTokens[part as keyof typeof item.areaTokens]![lang];
  if (part && item.sideTokens?.[part as Side]) vars.side = item.sideTokens[part as Side][lang];
  if (part && item.testTokens?.[part as TestId]) vars.test = item.testTokens[part as TestId]![lang];
  text = fillTokens(text, vars);
  if (speech && lang === "en") speech = fillTokens(speech, vars);
  // An Arabic speech line with an unfilled token is not used (the display text is read instead).
  if (speech && /\{\w+\}/.test(speech)) speech = undefined;

  const kind: QuestionKind =
    item.type === "scale_0_10"
      ? "scale"
      : item.type === "area_scale_0_10"
        ? "areaScale"
        : item.type === "list_confirm"
          ? "listConfirm"
          : item.type === "yes_no_unsure"
            ? "yes_no_unsure"
            : item.type === "single"
              ? "single"
              : "yes_no";

  const lines: SpeechLine[] = [{ display: text, ...(speech ? { speech } : {}) }];
  if (listHeading) lines.push({ display: listHeading });
  (list ?? []).forEach((l, i) =>
    lines.push({ display: l, ...(listSpeech?.[i] ? { speech: listSpeech[i] } : {}) }),
  );
  if (kind !== "scale" && kind !== "areaScale") lines.push(...optionSpeech());

  return {
    id,
    item,
    kind,
    question: text,
    emphasis,
    ...(list ? { list } : {}),
    ...(listHeading ? { listHeading } : {}),
    options: optionsOf(),
    ...(kind === "areaScale" ? { areas: areaChoices(lang) } : {}),
    speech: lines,
  };
}

/** The 0 to 10 scale rows of the data (Q7): 0 to 5, then 6 to 10. */
export const SCALE_ROWS: readonly (readonly number[])[] = CHECK_DATA.painScale.rows;

/**
 * Whether an area scale answer can be sent (S20): "none" (an empty record) or every chosen area with
 * a score. Returns the first area without a score, or null when it is complete.
 */
export function firstAreaWithoutScore(value: Record<string, number | null>): string | null {
  for (const [area, score] of Object.entries(value)) if (score === null || score === undefined) return area;
  return null;
}

/* ================================================================ locks and {when} (S33, S35) */

/** A clock time in the page's language: «٣:١٥ مساءً» · "3:15 pm". */
export function clockText(lang: Lang, time: ClockTime): string {
  const mm = String(time.minute).padStart(2, "0");
  const suffix = CHECK_DATA.pausedWhenTokens.timeSuffix[time.suffix][lang];
  return `${time.hour}:${mm} ${suffix}`;
}

/** {when} of scr_paused_today (Q33 (4)) as text, digits localized by the caller's t() or bidiText. */
export function whenText(lang: Lang, when: LockWhen): string {
  const line = pausedWhenText(when.token, lang);
  return when.time ? fillTokens(line, { time: clockText(lang, when.time) }) : line;
}

/** The paused line (scr_paused_today) with its {when}. */
export function pausedLine(lang: Lang, when: LockWhen | null): string {
  const text = screenText("scr_paused_today", lang);
  if (!when) return splitSentences(text)[0] ?? text;
  return fillTokens(text, { when: whenText(lang, when) });
}

/**
 * {when} of a lock the phone knows (a postpone just now: "start"; a return while it runs: "return").
 * Null when the lock has no end (sci_ready) or its kind is not known.
 */
export function whenOfLock(
  lock: { reason: string; until: number | null } | null,
  now: number,
  shown: "start" | "return",
): LockWhen | null {
  if (!lock || lock.until === null) return null;
  const kind = lockKind(lock.reason as LockReasonId);
  if (!kind) {
    // A lock whose reason the phone does not know (the server's): an hour or less reads as the 60
    // minute form, anything longer as the next day form.
    const guess = lock.until - now <= 61 * 60_000 ? "60_min" : "next_day";
    return pausedWhen({ kind: guess, until: lock.until }, now, shown) as LockWhen;
  }
  return pausedWhen({ kind, until: lock.until }, now, shown) as LockWhen;
}

/** The body screen of a postpone reason (data postponeReasons). */
export function postponeScreen(reason: string, given: ScreenId | null): ScreenId {
  if (given) return given;
  const map = CHECK_DATA.postponeReasons as Record<string, ScreenId>;
  return map[reason] ?? "scr_postpone_care";
}

/* ================================================================ warnings (S25, S28) */

/** Screens shown at a test (S28, S26), not before the check (S25). */
export const WARNINGS_AT_TEST: readonly string[] = [
  "warn_sci_t6",
  "warn_weak_shoulder",
  "scr_helper_brief_stand",
  "scr_helper_brief_trunk",
];

export type Tone = "warn" | "info";

/** The tone of a warning before the check (S25): pain high is a caution, the rest good to know. */
export function warningTone(id: string): Tone {
  return id === "warn_pain_high" ? "warn" : "info";
}

/** The warnings of S25, in the order the outcome lists them, without those shown at a test. */
export function checkWarnings(warnings: readonly string[]): ScreenId[] {
  return warnings.filter((w) => !WARNINGS_AT_TEST.includes(w)) as ScreenId[];
}

/** The {x} of warn_pd_timing: the timing token of a dose bucket, or null when it is not known. */
export function pdTimingToken(bucket: string | null | undefined, lang: Lang): string | null {
  if (!bucket) return null;
  const item = precheckItem("pc_pd_dose") as PrecheckItem;
  const tok = item.timingTokens?.[bucket as PdDoseBucket];
  return tok ? tok[lang] : null;
}

/** The warnings on a test's instruction card (S28): warn_sci_t6 on every card, weak shoulder on the arm tests. */
export function testWarnings(warnings: readonly string[], testId: TestId): ScreenId[] {
  const out: ScreenId[] = [];
  if (warnings.includes("warn_sci_t6")) out.push("warn_sci_t6");
  if (
    warnings.includes("warn_weak_shoulder") &&
    (testId === "shoulder_abduction" || testId === "arm_curl_30s")
  )
    out.push("warn_weak_shoulder");
  return out;
}

/* ================================================================ the plan (S27) */

/** Skip groups (S27): day level reasons are "Not today", intake level reasons "Not part of your check". */
const NOT_TODAY: readonly string[] = [
  "pain_today",
  "pain_more",
  "flare",
  "helper_needed",
  "armrests_needed",
  "chair_needed",
  "weak_shoulder",
  "arm_not_able",
  "pressure_sore",
  "recent_surgery",
  "clearance_booth",
  "motion_needed",
  "by_choice",
  "quality",
  "stopped_symptom",
  "needed_arms",
  "needed_support",
];

export function skipGroup(reason: string): "notToday" | "notPart" {
  return NOT_TODAY.includes(reason) ? "notToday" : "notPart";
}

export type VariantWhy = "booth" | "painArm" | "noResistance" | "safety" | "handsAllowed";

/**
 * Why a rule set a test's variant (S27 variant reasons): the booth arm curl without weight (Q5), pain
 * in that arm (P2), no resistance (P2), otherwise safety (clearance, the stroke weaker arm,
 * pc_weak_shoulder, Q6, Q8); hands allowed for the chair stand. Default variants have none.
 */
export function variantWhy(
  item: Pick<ProtocolItem, "testId" | "side" | "variant">,
  env: Pick<PrecheckEnv, "setting" | "ctx" | "setup">,
): VariantWhy | null {
  const v = item.variant;
  if (!v || v === "standard") return null;
  if (item.testId === "chair_stand_30s")
    return v === "arms_assisted" || v === "arms_assisted_steady" ? "handsAllowed" : null;
  if (item.testId !== "arm_curl_30s" || (v !== "arm_only" && v !== "cuff_or_arm_only")) return null;
  if (env.setting === "booth") return "booth";
  if (env.ctx.restrictions.includes("no_resistance")) return "noResistance";
  const side = item.side;
  if (side !== "none" && env.setup?.painSides?.includes(side)) return "painArm";
  return "safety";
}

/** The data label of a variant chip, or null for a default variant (held, standard) or no data label. */
export function variantLabel(testId: TestId, variant: string | undefined, lang: Lang): string | null {
  if (!variant || variant === "standard" || variant === "held") return null;
  const def = testDef(testId) as { variants?: { id: string; label: { ar: string; en: string } }[] };
  const found = def.variants?.find((x) => x.id === variant);
  return found ? found.label[lang] : null;
}

export interface PlanRow {
  testId: TestId;
  name: string;
  purpose: string;
  /** "Each arm" or "Each side" when the test runs per side. */
  perSide: "arm" | "side" | null;
  helper: boolean;
  variant: string | null;
  variantWhy: VariantWhy | null;
  /** One line per side skipped while another side runs: {side}. {reason}. */
  sideLines: string[];
}

export interface PlanSkip {
  testId: TestId;
  name: string;
  reason: string;
  boothOffer: boolean;
}

export interface PlanView {
  rows: PlanRow[];
  notToday: PlanSkip[];
  notPart: PlanSkip[];
  minutes: [number, number];
}

/** The booth days (S27 booth_offer): the offer line shows only while they include today. */
export const BOOTH_DATES = { from: "2026-10-11", to: "2026-10-13" } as const;

/** The date in Riyadh as yyyy-mm-dd. */
export function riyadhDay(now: number): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function boothDaysNow(now: number): boolean {
  const day = riyadhDay(now);
  return day >= BOOTH_DATES.from && day <= BOOTH_DATES.to;
}

const ARM_TESTS: readonly TestId[] = ["shoulder_abduction", "arm_curl_30s"];

/** The side label of a test side (S27, S28): your left arm, leaning to your right. */
export function sideLabel(testId: TestId, side: Side, lang: Lang): string {
  if (testId === "trunk_control_seated")
    return t(lang, side === "left" ? "assessment.plan.sideLeanLeft" : "assessment.plan.sideLeanRight");
  return t(lang, side === "left" ? "assessment.plan.sideArmLeft" : "assessment.plan.sideArmRight");
}

/**
 * The frozen protocol as S27 shows it: the tests that run in order, each with its chips and side
 * lines, and the skipped tests in two groups with the reason in plain words (P6).
 */
export function planView(
  protocol: readonly ProtocolItem[],
  env: Pick<PrecheckEnv, "setting" | "ctx" | "setup">,
  lang: Lang,
  now: number,
): PlanView {
  const byTest = new Map<TestId, ProtocolItem[]>();
  for (const item of [...protocol].sort((a, b) => a.order - b.order)) {
    const list = byTest.get(item.testId) ?? [];
    list.push(item);
    byTest.set(item.testId, list);
  }
  const rows: PlanRow[] = [];
  const notToday: PlanSkip[] = [];
  const notPart: PlanSkip[] = [];
  const offerNow = boothDaysNow(now);
  for (const [testId, items] of byTest) {
    const def = testDef(testId);
    const running = items.filter((i) => !i.skipped);
    if (running.length === 0) {
      const first = items[0];
      const reason = first.skipped as ReasonId;
      const skip: PlanSkip = {
        testId,
        name: def.name[lang],
        reason: skipReasonText(reason, lang, { substituteRan: items.some((i) => i.substituteRan) }),
        // D-016: a test skipped for clearance is not offered at the booth either.
        boothOffer: offerNow && reason === "booth_only_trunk",
      };
      (skipGroup(reason) === "notToday" ? notToday : notPart).push(skip);
      continue;
    }
    const sides = items.filter((i) => i.side !== "none");
    const main = running[0];
    const variant = variantLabel(testId, main.variant, lang);
    rows.push({
      testId,
      name: def.name[lang],
      purpose: def.purpose[lang],
      perSide: sides.length > 1 ? (ARM_TESTS.includes(testId) ? "arm" : "side") : null,
      helper: env.setting === "home" && running.some((i) => i.helperRequired),
      variant,
      variantWhy: variant || main.variant === "cuff_or_arm_only" ? variantWhy(main, env) : null,
      sideLines: items
        .filter((i) => i.skipped && i.side !== "none")
        .map((i) =>
          t(lang, "assessment.plan.sideLine", {
            side: sideLabel(testId, i.side as Side, lang),
            reason: skipReasonText(i.skipped as ReasonId, lang),
          }),
        ),
    });
  }
  return {
    rows,
    notToday,
    notPart,
    // C11: the tests that run, read as every screen reads them (statedMinutes).
    minutes: statedMinutes(
      rows.map((r) => r.testId),
      env.setting,
    ),
  };
}

/* ================================================================ instruction card (S28) */

/** Summary cues spoken on the card (S28 table), by test and variant. */
export function summaryCues(testId: TestId, variant?: string): CheckCueId[] {
  switch (testId) {
    case "shoulder_abduction":
      return knownCues(["test_abd_start", "test_abd_thumb", "test_abd_raise"]);
    case "arm_curl_30s":
      return knownCues(["test_curl_start", "test_curl_elbow", "test_curl_full"]);
    case "trunk_control_seated":
      return knownCues(["test_trunk_start", "test_trunk_light_touch", "test_trunk_seat"]);
    case "chair_stand_30s":
      // one_arm_cross has no arm cue (test_stand_arms_cross asks for both arms): its step line on the
      // card says where the hand goes (R3C-26).
      return knownCues([
        "test_stand_start",
        ...(variant === "one_arm_cross"
          ? []
          : [
              variant === "arms_assisted" || variant === "arms_assisted_steady"
                ? ("test_stand_hands_ok" as const)
                : ("test_stand_arms_cross" as const),
            ]),
        "test_stand_full",
      ]);
  }
}

/** The step that tells the person to place the phone (replaced at the booth: primer.placeBooth). */
export const PHONE_STEP: Record<TestId, number> = {
  shoulder_abduction: 1,
  arm_curl_30s: 1,
  trunk_control_seated: 2,
  chair_stand_30s: 2,
};

/**
 * The steps of a test with today's variant applied (S28): stepsReplace keys are zero based step
 * indexes, and at the booth the phone step becomes primer.placeBooth (the phone is already mounted).
 */
// R3C-33 (2): the arm curl's phone step also says to turn side on to the phone; at the booth the whole
// step is replaced as the spec says, and the setup check's side view cue asks for the turn.
export function instructionSteps(
  testId: TestId,
  variant: string | undefined,
  booth: boolean,
  lang: Lang,
): string[] {
  const def = testDef(testId) as {
    steps: { ar: string[]; en: string[] };
    variants?: { id: string; stepsReplace?: Record<string, { ar: string; en: string }> }[];
    boothStepsFrom?: number;
  };
  const steps = [...def.steps[lang]];
  // The arm curl variant is the load kind: a cuff_or_arm_only arm still lists the held steps until
  // the load is chosen, arm_only replaces the hold step.
  const v = def.variants?.find((x) => x.id === variant);
  for (const [k, text] of Object.entries(v?.stepsReplace ?? {})) steps[Number(k)] = text[lang];
  if (booth) steps[PHONE_STEP[testId]] = t(lang, "assessment.primer.placeBooth");
  // R3C-33: at the booth our team sets up the chair and the support in front (the staff brief and the
  // S58 staff tips), so the chair stand's two home setup steps are left out: the steps start at the
  // phone step, already the booth line (tests.chair_stand_30s.boothStepsFrom).
  if (booth && def.boothStepsFrom !== undefined) return steps.slice(def.boothStepsFrom);
  return steps;
}

/** The card notes of a test that apply (S28, O24-5, O41), as data texts with their speech. */
export function cardNotes(
  testId: TestId,
  variant: string | undefined,
  position: CheckPosition,
  lang: Lang,
): SpeechLine[] {
  const def = testDef(testId) as {
    cardNotes?: { id: string; ar: string; arTts?: string; en: string }[];
  };
  const notes = def.cardNotes ?? [];
  const show = (id: string): boolean => {
    if (id === "fixed_armrest") return position !== "wheelchair";
    // The steady support note goes with the arms_assisted_steady variant; the walking aid note is shown
    // with it too, since that variant is set by pc_walking_aid yes.
    // R3C-33 (3): the pc_walking_aid answer is cleared at the protocol freeze, so the walking aid note
    // shows where arms_assisted_steady tells that the answer was yes.
    if (id === "steady_support" || id === "walking_aid") return variant === "arms_assisted_steady";
    return false;
  };
  return notes
    .filter((n) => show(n.id))
    .map((n) => (lang === "ar" ? { display: n.ar, speech: n.arTts } : { display: n.en, speech: n.en }));
}

export type AltPosition = "chair" | "wheelchair";

/** The alt key of the test drawing (Appendix B): test × position × variant. */
export function illustrationAlt(
  testId: TestId,
  position: CheckPosition,
  variant: string | undefined,
  lang: Lang,
): string {
  const seat: AltPosition = position === "wheelchair" ? "wheelchair" : "chair";
  switch (testId) {
    case "shoulder_abduction":
      return t(lang, `assessment.test.illustrationAlt.shoulder_abduction.${seat}` as I18nKey);
    case "trunk_control_seated":
      return t(lang, `assessment.test.illustrationAlt.trunk_control_seated.${seat}` as I18nKey);
    case "arm_curl_30s": {
      const load = t(
        lang,
        variant === "arm_only"
          ? "assessment.test.altLoad.none"
          : variant === "cuff"
            ? "assessment.test.altLoad.cuff"
            : "assessment.test.altLoad.weight",
      );
      return t(lang, `assessment.test.illustrationAlt.arm_curl_30s.${seat}` as I18nKey, { load });
    }
    case "chair_stand_30s": {
      const v =
        variant === "arms_assisted" || variant === "arms_assisted_steady"
          ? "arms_assisted"
          : variant === "one_arm_cross"
            ? "one_arm_cross"
            : "standard";
      return t(lang, `assessment.test.illustrationAlt.chair_stand_30s.${v}` as I18nKey);
    }
  }
}

/* ================================================================ loads (S29, S30) */

export interface Load {
  kind: LoadKind;
  kg?: number;
  liters?: 0.5 | 1 | 1.5;
}

/** The kilogram range of a load kind (Q5). */
export function kgRange(kind: "dumbbell" | "cuff"): {
  min: number;
  max: number;
  step: number;
  start: number;
} {
  const lim = kind === "dumbbell" ? LOAD_LIMITS.dumbbell : LOAD_LIMITS.cuff;
  return { min: lim.minKg, max: lim.maxKg, step: lim.stepKg, start: kind === "dumbbell" ? 1 : 0.5 };
}

/** A kilogram value brought into range and onto the 0.5 kg grid. */
export function snapKg(kind: "dumbbell" | "cuff", kg: number, max?: number): number {
  const r = kgRange(kind);
  const top = Math.min(r.max, max ?? r.max);
  const snapped = Math.round(kg / r.step) * r.step;
  return Math.min(top, Math.max(r.min, Math.round(snapped * 100) / 100));
}

/** The arms of the arm curl that choose a load (not arm_only), in protocol order. */
export function loadArms(items: readonly ProtocolItem[]): Side[] {
  return items.filter((i) => i.side !== "none" && i.variant !== "arm_only").map((i) => i.side as Side);
}

/** The loads offered on S30 for one arm (allowedLoads, Q5), in the data order. */
export function loadChoices(o: {
  ctx: CheckContext;
  setting: Setting;
  variant?: string;
  gripYes?: boolean;
}): LoadKind[] {
  const allowed = allowedLoads(o);
  // A grip yes also rules out a glass bottle; the bottle row stays (the help says a closed plastic one).
  return allowed;
}

/**
 * The lighter choices after a practice that was not easy (Q5 step down, S30): the same kind with a
 * lower value, then nothing. From nothing there is no lighter choice but nothing itself.
 */
export function stepDownChoices(from: Load | undefined): {
  kinds: LoadKind[];
  maxKg?: number;
  bottles?: number[];
} {
  if (!from || from.kind === "none") return { kinds: ["none"] };
  if (from.kind === "bottle") {
    const bottles = LOAD_LIMITS.bottleLiters.filter((l) => l < (from.liters ?? 0));
    return { kinds: bottles.length ? ["bottle", "none"] : ["none"], bottles };
  }
  const r = kgRange(from.kind);
  const maxKg = Math.round(((from.kg ?? r.min) - r.step) * 100) / 100;
  return maxKg >= r.min ? { kinds: [from.kind, "none"], maxKg } : { kinds: ["none"] };
}

/** The load of a result as the data words it (resultTokens.load), for the re-test summary. */
export function loadSummary(load: Load, lang: Lang): string {
  const tokens = testDef("arm_curl_30s").resultTokens.load;
  const kgText = (kg: number) => String(kg);
  switch (load.kind) {
    case "none":
      return tokens.none[lang];
    case "cuff":
      return fillTokens(tokens.cuff[lang], { kg: kgText(load.kg ?? 0) });
    case "dumbbell":
      return fillTokens(tokens.held[lang], { kg: kgText(load.kg ?? 0) });
    case "bottle": {
      const key = load.liters === 0.5 ? "bottle_half" : load.liters === 1.5 ? "bottle_1_5" : "bottle_1";
      return fillTokens(tokens[key][lang], { l: String(load.liters ?? 1) });
    }
  }
}

/** The result detail fields of a load (progress-rules loadOf): loadObject, loadKg, loadL. */
export function loadDetail(load: Load): Record<string, string | number> {
  const out: Record<string, string | number> = { loadObject: load.kind };
  if ((load.kind === "dumbbell" || load.kind === "cuff") && load.kg !== undefined) out.loadKg = load.kg;
  if (load.kind === "bottle" && load.liters !== undefined) out.loadL = load.liters;
  return out;
}

/* ================================================================ helper briefing (S26) */

/** The helper briefing of a test (Q11, O34-2): the stand or trunk briefing, or the arm tests' line only. */
export function helperBriefScreen(
  testId: TestId,
): "scr_helper_brief_stand" | "scr_helper_brief_trunk" | null {
  if (testId === "chair_stand_30s") return "scr_helper_brief_stand";
  if (testId === "trunk_control_seated") return "scr_helper_brief_trunk";
  return null;
}

/* ================================================================ camera (S31, S32) */

export type CameraProblemKind = "denied" | "none" | "busy";

/** The S32 variant of a getUserMedia error (map 2.9). */
export function cameraProblemOf(error: unknown): CameraProblemKind {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return "none";
  return "busy";
}

/* ================================================================ answers (the same press rule) */

/**
 * O11a: an answer counts only when the press starts and ends on the same button, so a press that
 * slides in from a neighbouring button does nothing. A click from the keyboard (detail 0) always counts.
 */
export function samePress(pressed: Element | null, clicked: Element | null, detail: number): boolean {
  if (detail === 0) return true;
  if (!pressed || !clicked) return true;
  return pressed === clicked;
}

/* ================================================================ areas */

/** An area id of the data, for typing. */
export const isAreaId = (id: string): id is AreaId => CHECK_DATA.areas.some((a) => a.id === id);
