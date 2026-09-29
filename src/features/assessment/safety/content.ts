/**
 * What each safety screen shows and says, computed from the flow model (UX spec S36 to S49, map 2.7,
 * council O12, O24-6, O34-4, O34-5, O42). Pure: no DOM, so every rule here is unit tested in both
 * languages. The components only lay these out.
 *
 * Clinical texts come from the check data (screenText, cueLine, stopFollowUp, endOfCheckQuestion,
 * precheckItem, testDef, reasonText); interface words from t(). Nothing is worded here.
 */
import type { Lang } from "../../../app/i18n";
import { selectCheckInCue } from "../../../engine/checkin";
import { localizeDigits, t, type I18nKey } from "../../../i18n";
import { ANSWER_ZONES } from "../../../medical/gates";
import { sameWords } from "../camera/cues";
import { pausedWhen, stopOptions } from "../../../medical/precheck";
import {
  CHECK_DATA,
  cueLine,
  cueShort,
  endOfCheckQuestion,
  pausedWhenText,
  reasonText,
  screenText,
  testDef,
} from "../../../movements/assessments";
import type { CheckCueId, ReasonId, ScreenId, Side, StopOptionId, TestId } from "../../../movements/types";
import {
  outcomeKey,
  stopEnv,
  type FlowData,
  type FlowModel,
  type FlowState,
  type SafetyFrom,
  type SafetyKind,
} from "../flowMachine";
import type { SafetyScreenId } from "../screenTypes";
import { copyLine, cueSpeech, screenLines, splitSentences, type SpeechLine } from "./speech";

/* ------------------------------------------------------------------ shared facts of the model */

/** A test side has a measured result today. */
export function anyMeasured(d: FlowData): boolean {
  return Object.values(d.outcomes).some((o) => o.status === "measured");
}

/** Anything was measured or tried today (the end question and S40b's way out, flowMachine finish). */
export function anyTried(d: FlowData): boolean {
  return Object.values(d.outcomes).some((o) => o.status === "measured" || o.status === "notMeasured");
}

/** The test sides still to run after test i: none means test i was the last one (S42 finish). */
export function isLastTest(d: FlowData, i: number): boolean {
  for (let j = i + 1; j < d.tests.length; j++) {
    if (d.tests[j].sides.some((item) => !(outcomeKey(item.testId, item.side) in d.outcomes))) return false;
  }
  return true;
}

/** Every test of today's protocol has an outcome for every side. */
export function allDone(d: FlowData): boolean {
  return d.tests.every((run) => run.sides.every((item) => outcomeKey(item.testId, item.side) in d.outcomes));
}

/** A lock that still runs at `now` (the paused line shows only then). */
export function activeLock(d: FlowData, now: number): { until: number } | null {
  const l = d.lock;
  if (!l || l.until === null || l.until <= now) return null;
  return { until: l.until };
}

/**
 * {when} of scr_paused_today (Q33 (4)): every lock a safety screen sets is a next day lock; its line
 * is chosen by pausedWhen with the time in Asia/Riyadh, digits per Q30.
 */
export function whenText(until: number, now: number, lang: Lang): string {
  const w = pausedWhen({ kind: "next_day", until }, now, "start");
  const line = pausedWhenText(w.token, lang);
  if (!w.time) return line;
  const suffix = CHECK_DATA.pausedWhenTokens.timeSuffix[w.time.suffix][lang];
  const time = `${w.time.hour}:${String(w.time.minute).padStart(2, "0")} ${suffix}`;
  return localizeDigits(lang, line.replace("{time}", time));
}

/** The paused line of a lock (scr_paused_today with {when}); its speech is its first sentence only. */
export function pausedLine(until: number, now: number, lang: Lang): string {
  return localizeDigits(
    lang,
    screenText("scr_paused_today", lang).replace("{when}", whenText(until, now, lang)),
  );
}

/** The name of a test (data). */
export function testName(testId: TestId, lang: Lang): string {
  return testDef(testId).name[lang];
}

/** The side words of a test side: the arm for the arm tests, the lean side for the side lean. */
export function sideWords(testId: TestId, side: "left" | "right" | "none", lang: Lang): string | null {
  if (side === "none") return null;
  const lean = testId === "trunk_control_seated";
  const key: I18nKey = lean
    ? side === "left"
      ? "assessment.plan.sideLeanLeft"
      : "assessment.plan.sideLeanRight"
    : side === "left"
      ? "assessment.plan.sideArmLeft"
      : "assessment.plan.sideArmRight";
  return t(lang, key);
}

/* ------------------------------------------------------------------ S36 to S40b */

export interface TextBlock {
  /** The data screen of the block; also the block id of its sentence marks. */
  screen: ScreenId;
  heading?: string;
  sentences: string[];
  /** Shown as its heading and first sentence, opening on tap (the AD card on S38, O24-6). */
  collapsed?: boolean;
}

export interface SafetyView {
  id: Extract<SafetyScreenId, "S36" | "S37" | "S38" | "S39" | "S40a" | "S40b">;
  kind: SafetyKind;
  heading: string;
  icon: string;
  /** The 4 px red band at the inline start of the card (S36, S37 only; decoration). */
  band: boolean;
  /** The 997 number as 64 px text with its label (S36, S39, Q22). */
  bigNumber: boolean;
  calls: ("997" | "937")[];
  blocks: TextBlock[];
  kept: string | null;
  paused: string | null;
  boothStaff: string | null;
  exitLabel: string;
  /** The way out goes on in the check (to S38b, or from S40b to the end question): the primary. */
  exitForward: boolean;
  /** Lines spoken when the screen opens, and on Listen again (which also reads a collapsed card). */
  speech: SpeechLine[];
  listen: SpeechLine[];
  /** The faint follow up (S38b) is still to be asked before leaving (S38, S39, O42). */
  askFaint: boolean;
}

const SAFETY_IDS: Record<SafetyKind, SafetyView["id"]> = {
  emergency: "S36",
  ad: "S37",
  faint: "S38",
  fall: "S39",
  seekCare: "S40a",
  pain: "S40b",
};

const HEADINGS: Record<SafetyKind, I18nKey> = {
  emergency: "assessment.safety.emergency.title",
  ad: "assessment.safety.ad.title",
  faint: "assessment.safety.faint.title",
  fall: "assessment.safety.fall.title",
  seekCare: "assessment.safety.seekCare.title",
  pain: "assessment.safety.pain.title",
};

const ICONS: Record<SafetyKind, string> = {
  emergency: "alert-triangle",
  ad: "alert-triangle",
  faint: "faint",
  fall: "fall",
  seekCare: "stop-square",
  pain: "stop-square",
};

/**
 * A screen that names 997 (emergencyCall.firstActionOn, prose in the data: "every screen that names
 * 997"): its text holds the number, so the call control comes first.
 */
export function names997(id: ScreenId): boolean {
  return screenText(id, "en").includes("997");
}
/** The screens with the 64 px number (emergencyCall.bigNumberOn). */
const BIG_NUMBER: ReadonlySet<string> = new Set(CHECK_DATA.emergencyCall.bigNumberOn);

/**
 * The entry cue of a safety screen (S36): check_stop_now when a test was running, check_urgent_call on
 * S39; none on routes from the pre-check or the end question, where nothing was running (O12 (5)).
 */
export function stopCueOf(kind: SafetyKind, d: FlowData, from?: SafetyFrom): CheckCueId | null {
  if (kind === "fall") return "check_urgent_call";
  // The flow records where the route started; an older state without it reads as before: no protocol
  // is the pre-check, every test done is the end question.
  if (from) return from === "test" ? "check_stop_now" : null;
  if (d.tests.length === 0 || allDone(d)) return null;
  return "check_stop_now";
}

export function safetyView(
  state: Extract<FlowState, { kind: "safety" }>,
  d: FlowData,
  lang: Lang,
  now: number,
): SafetyView {
  const kind = state.safety;
  const guest = d.config.mode === "guest";
  const screens = [state.screen, ...state.alsoShow];
  const blocks: TextBlock[] = [
    { screen: state.screen, sentences: splitSentences(screenText(state.screen, lang)) },
  ];
  for (const s of state.alsoShow) {
    if (s === "scr_ad")
      // O12 (1): the AD card under its heading, right after scr_emergency (its conditional lead is
      // pending the medical seat, emergencyLead.status, and is not shown).
      blocks.push({
        screen: s,
        heading: t(lang, "assessment.safety.adCard"),
        sentences: splitSentences(screenText(s, lang)),
      });
    else blocks.push({ screen: s, sentences: splitSentences(screenText(s, lang)) });
  }
  // O24-6: on S38 for sci_t6 (scr_faint_sci shown), the AD card follows it, collapsed to its heading
  // and first sentence, opening on tap and read on Listen, so the faint question is not delayed.
  if (kind === "faint" && state.alsoShow.includes("scr_faint_sci") && !state.alsoShow.includes("scr_ad"))
    blocks.push({
      screen: "scr_ad",
      heading: t(lang, "assessment.safety.adCard"),
      sentences: splitSentences(screenText("scr_ad", lang)),
      collapsed: true,
    });

  const calls: ("997" | "937")[] = screens.some(names997) ? ["997"] : [];
  if (state.screen === "scr_stop_seek_care") calls.push("937");
  const lock = activeLock(d, now);
  const askFaint = (state.askFaint === true || kind === "faint") && !state.faintAnswered;
  const exitForward = askFaint || (kind === "pain" && anyTried(d));
  const exitLabel = exitForward
    ? t(lang, "assessment.common.continue")
    : guest
      ? t(lang, "assessment.guest.staff.restart")
      : t(lang, "assessment.common.backToToday");

  // What is said: the entry cue, then every sentence of the body and of each open card (a card's
  // heading before its body, O12 (1)), then the paused line's first sentence (its {when} is display
  // only, O24-2) or at the booth the staff line.
  const cue = stopCueOf(kind, d, state.from);
  const said: SpeechLine[] = cue ? [cueSpeech(cue, lang, "safety")] : [];
  const listen: SpeechLine[] = [...said];
  for (const b of blocks) {
    const lines: SpeechLine[] = [];
    if (b.heading) lines.push({ ...copyLine(lang, b.heading, "safety"), mark: `${b.screen}:h` });
    lines.push(...screenLines(b.screen, lang, { block: b.screen }));
    if (!b.collapsed) said.push(...lines);
    listen.push(...lines);
  }
  const paused = !guest && lock ? pausedLine(lock.until, now, lang) : null;
  if (paused) {
    const first = screenLines("scr_paused_today", lang, { block: "paused", severity: "info" })[0];
    const tail: SpeechLine = { ...first, display: splitSentences(paused)[0] ?? first.display };
    said.push(tail);
    listen.push(tail);
  }
  const boothStaff = guest ? t(lang, "assessment.safety.boothStaff") : null;
  if (boothStaff) {
    said.push({ ...copyLine(lang, boothStaff), mark: "booth:0" });
    listen.push({ ...copyLine(lang, boothStaff), mark: "booth:0" });
  }
  const measured = anyMeasured(d);
  return {
    id: SAFETY_IDS[kind],
    kind,
    heading: t(lang, HEADINGS[kind]),
    icon: ICONS[kind],
    band: kind === "emergency" || kind === "ad",
    bigNumber: screens.some((s) => BIG_NUMBER.has(s)),
    calls,
    blocks,
    kept: measured ? t(lang, guest ? "assessment.safety.keptGuest" : "assessment.safety.kept") : null,
    paused,
    boothStaff,
    exitLabel,
    exitForward,
    speech: said,
    listen,
    askFaint,
  };
}

/* ------------------------------------------------------------------ S41 stop list */

export interface StopRow {
  id: StopOptionId;
  label: string;
  icon: string;
}

const STOP_ICONS: Record<StopOptionId, string> = {
  chest: "heart",
  stroke_signs: "bolt",
  ad_signs: "alert-triangle",
  faint: "faint",
  breath: "breath",
  fall: "fall",
  pain: "arrow-up",
  tired: "pause",
  choice: "stop-square",
  other: "help",
};

/**
 * The stop list for this person (Q31 (3)): the data's ten options in data order, ad_signs only with
 * sci_t6 (stopOptions), the urgent group first. Without a context the most conservative person
 * (stopEnv), so no symptom stop is ever left out.
 */
export function stopListView(d: FlowData, lang: Lang): { ask: string; urgent: StopRow[]; other: StopRow[] } {
  const shown = new Set(stopOptions(stopEnv(d)));
  const group = (g: "urgent" | "other"): StopRow[] =>
    CHECK_DATA.stopRouting.options
      .filter((o) => shown.has(o.id) && o.group === g)
      .map((o) => ({ id: o.id, label: o.label[lang], icon: STOP_ICONS[o.id] }));
  return { ask: CHECK_DATA.stopRouting.ask[lang], urgent: group("urgent"), other: group("other") };
}

/* ------------------------------------------------------------------ S43 and S45 */

/**
 * The check in cue for this person and setting (stopRouting.checkIn.cueSelection, O33 (f)). At the
 * booth: check_are_you_ok, or check_are_you_ok_noraise when a raised hand must not be asked for.
 */
// The check in inputs come from the start answer (signed in) or the guest pre-check (guests); without
// them the no raise form is used, the safer one: it never asks a person who must not lift an arm to
// raise a hand (O34-4 (3)).
// At home the zone forms («ضع يدك في مربع «أنا بخير»») are used only when the zones are drawn over the
// video (ANSWER_ZONES, phase 2); until then S43 is a sheet of tap buttons and no box exists to hold a
// hand in, so the cue names only what works (engine selectCheckInCue, zones false).
export function checkInCueId(d: FlowData): CheckCueId {
  const cfg = d.checkIn;
  return selectCheckInCue({
    setting: d.setting,
    raiseAllowed: cfg?.raiseAllowed ?? false,
    noArmSignal: cfg?.noArmSignal ?? false,
    speech: false,
    zones: ANSWER_ZONES,
  }) as CheckCueId;
}

/**
 * S43: the cue split after its first question (spec S43): the 56 px question, and the instruction
 * that follows it for the caption card, under the short form. The question is never repeated in it.
 */
export function checkInView(d: FlowData, lang: Lang) {
  const id = checkInCueId(d);
  const full = cueLine(id)[lang];
  const [question, ...rest] = splitSentences(full);
  const short = cueShort(id, lang);
  // A first sentence that is the short form itself («لا تنهض لتجيب») is not printed twice.
  if (rest.length > 1 && sameWords(rest[0], short)) rest.shift();
  return {
    cue: id,
    question: question ?? full,
    instruction: rest.join(" "),
    full,
    short,
  };
}

/**
 * S45: the heading is the first sentence of scr_no_response, the body the rest; the help variant
 * (O34-5) heads with "Get help now" and keeps the body from the second sentence on.
 */
export function alarmView(help: boolean, lang: Lang) {
  const all = screenLines("scr_no_response", lang, { block: "alarm" });
  const heading = help ? t(lang, "assessment.safety.emergency.title") : all[0].display;
  // The body's sentences are marked from 0 for its own sentence stack.
  const body = all.slice(1).map((l, i) => ({ ...l, mark: `alarm:${i}` }));
  const speech: SpeechLine[] = help
    ? [{ ...copyLine(lang, heading, "safety"), mark: "alarm:h" }, ...body]
    : [{ ...all[0], mark: "alarm:h" }, ...body];
  return { heading, body, speech };
}

/* ------------------------------------------------------------------ S46 skip notice */

export interface SkipNoticeView {
  title: string;
  /** The cue spoken and captioned on arrival (check_skip_ok when it is the title). */
  cue: CheckCueId | null;
  rows: { key: string; test: string; side: string | null; reason: string | null }[];
}

/**
 * The title of S46 by what skipped the test (S46 table): the pain answer (pain_more), pushed with the
 * hands (needed_arms), a reason that says it all (quality, needed_support), else check_skip_ok. A row
 * whose reason is already the title shows the test only.
 */
export function skipNoticeView(
  rows: { testId: TestId; side: string; reason: string }[],
  lang: Lang,
): SkipNoticeView {
  const reasons = new Set(rows.map((r) => r.reason));
  let title: string;
  let cue: CheckCueId | null = null;
  let titleReason: string | null = null;
  if (reasons.has("pain_more")) title = t(lang, "assessment.skipNotice.painTitle");
  else if (reasons.has("needed_arms")) title = t(lang, "assessment.skipNotice.handsTitle");
  else if (reasons.size === 1 && (reasons.has("quality") || reasons.has("needed_support"))) {
    titleReason = [...reasons][0];
    title = reasonText(titleReason as ReasonId, lang);
  } else {
    cue = "check_skip_ok";
    title = cueLine(cue)[lang];
  }
  return {
    title,
    cue,
    rows: rows.map((r) => ({
      key: `${r.testId}:${r.side}`,
      test: testName(r.testId, lang),
      side: sideWords(r.testId, r.side as "left" | "right" | "none", lang),
      reason: r.reason === titleReason ? null : safeReason(r.reason, lang),
    })),
  };
}

function safeReason(id: string, lang: Lang): string | null {
  return id in CHECK_DATA.reasons ? reasonText(id as ReasonId, lang) : null;
}

/* ------------------------------------------------------------------ S49 end question */

/** The end question (Q23 (7)): the general form, or the side form with its side token. */
export function endQuestionView(side: Side | null | undefined, lang: Lang) {
  const q = endOfCheckQuestion("ec_symptoms");
  if (!side) return { text: q.ask[lang], arTts: q.ask.arTts ?? null };
  const token = q.sideTokens[side][lang];
  return {
    text: q.askSide[lang].split("{side}").join(token),
    arTts: q.askSide.arTtsBySide?.[side] ?? null,
  };
}

/**
 * The words of the end question and the faint question that carry the meaning (0.2 EMPHASIS): the UI
 * bolds them without changing the text.
 */
export const EMPHASIS: Record<"ec_symptoms", Record<Lang, string[]>> = {
  ec_symptoms: { ar: ["اليوم", "جديد ومفاجئ"], en: ["today", "new, sudden"] },
};

/** A text split into plain and emphasised parts (each emphasis once, first match). */
export function emphasise(text: string, words: readonly string[]): { text: string; strong: boolean }[] {
  const out: { text: string; strong: boolean }[] = [];
  let rest = text;
  const pending = [...words];
  while (rest) {
    let best: { at: number; word: string } | null = null;
    for (const w of pending) {
      const at = rest.indexOf(w);
      if (at >= 0 && (!best || at < best.at)) best = { at, word: w };
    }
    if (!best) {
      out.push({ text: rest, strong: false });
      break;
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at), strong: false });
    out.push({ text: best.word, strong: true });
    rest = rest.slice(best.at + best.word.length);
    pending.splice(pending.indexOf(best.word), 1);
  }
  return out;
}

/* ------------------------------------------------------------------ helpers for the screens */

/** The test side of a state (i, side) of the model, or null. */
export function sideOfState(m: FlowModel): { testId: TestId; side: "left" | "right" | "none" } | null {
  const s = m.state as { i?: number; side?: number };
  if (typeof s.i !== "number") return null;
  const item = m.data.tests[s.i]?.sides[s.side ?? 0];
  return item ? { testId: item.testId, side: item.side } : null;
}
