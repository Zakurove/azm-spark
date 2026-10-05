/**
 * The focus check's shell (product v7 contract B3, C-2, C-13, C-14, 2.5 and section 4): everything
 * around the range blocks, as a pure state machine the FocusApp renders. Pure, no DOM.
 *
 *   loading      GET /api/auth/me (the intake) and GET /api/focus/context
 *   closed       nothing can start today: the v7 body questions are missing (health), home checks are
 *                closed without a booth pass (C-14), a lock, the 48 hours, no plan, a plan in review
 *   consent      the focus_check consent (C-8), once
 *   intro        which joints we will check, and why (plan 1.7)
 *   question     the v1 pre-check through the bridge (C-2): visibleQuestions of the context's env, one
 *                a screen; the phone evaluates the answers at once (evaluatePrecheck), so an emergency,
 *                an AD answer or a postpone shows its screen without waiting for the network
 *   today        the day's questions (2.5): the pain now of each body map pain region, rf_region for
 *                each region of the day (rfRegionsToAsk), the transfer to a steady chair, the gait day
 *                items when the walk is planned
 *   starting     POST /api/focus (setting booth on a booth pass, else home)
 *   seek_care    a red flag region (rf_region yes): scr_stop_seek_care once, then the other regions
 *   part         the parts in C-13 order: seated range, standing range, the walk (C's GaitStep slot),
 *                lying range (then sit before stand, in the RomController)
 *   stop_screen  a stop list answer with a screen (emergency, faint, fall, seek care)
 *   faint_ask    after a faint or fall stop's screen, the v1 faint follow up (sf_faint_loc, Q33 (3),
 *                O42): yes or not sure opens the emergency screen, no shows the stop's screen again
 *   completing   POST /api/focus/:id/complete, then the findings
 */
import type { LockView } from "../assessment/api";
import type { GaitPlan } from "../../medical/gait-eligibility";
import {
  evaluatePrecheck,
  faintFollowUp,
  visibleQuestions,
  type Answers,
  type AnswerValue,
  type PrecheckEnv,
} from "../../medical/precheck";
import { gaitDayItems, rfRegionsToAsk } from "../../medical/focus-precheck";
import { REGION_IDS, type RegionId } from "../../medical/body-map";
import type { Intake, Sex } from "../../medical/plan";
import {
  BLOCK_RUN_ORDER,
  type FocusToday,
  type RomBlock,
  type RomProtocol,
} from "../../medical/rom-protocol";
import type { ScreenId } from "../../movements/types";

/** GET /api/focus/context as the server sends it (server/modules/focus/routes.ts). */
export interface FocusContext {
  intakeReady: boolean;
  setting: "home" | "booth";
  homeOpen: boolean;
  adultConfirmed: boolean;
  consent: { focus_check: boolean; live_coach: boolean };
  env: PrecheckEnv | null;
  protocol: RomProtocol | null;
  gait: GaitPlan | null;
  lock: LockView | null;
  open: { id: string } | null;
  lastCompleted: number | null;
  earliestNext: number | null;
}

/** The 200 answer of POST /api/focus. */
export interface StartResponse {
  id: string;
  kind: "baseline" | "retest";
  protocol: RomProtocol;
  gait: GaitPlan | null;
  warnings: ScreenId[];
  helperRequired: string[];
  helperBriefing: Record<string, unknown>;
}

/** The v1 stop route the stop answer gives (POST /api/focus/:id/stop). */
export interface FocusStopRoute {
  option: string;
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  endsCheck: boolean;
  reason: string;
  then?: string;
  afterRest: boolean;
}

/** Why no check can start now. */
export type ClosedWhy =
  "intake" | "home_closed" | "locked" | "too_soon" | "plan" | "review" | "adult" | "rate" | "nothing";

/** A day question of the focus check (2.5). */
export type TodayQuestion =
  | { kind: "pain"; region: RegionId }
  | { kind: "rf"; region: RegionId }
  | { kind: "transfer" }
  | { kind: "walk10m" }
  | { kind: "pdFreezing" };

/** A part of the check after the start, in C-13 order. */
export type FocusPart = { kind: "range"; block: RomBlock } | { kind: "gait" };

export type FocusState =
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "closed"; why: ClosedWhy; until?: number | null; lock?: LockView | null }
  | { kind: "consent"; saving: boolean; error: boolean }
  | { kind: "intro" }
  | { kind: "question"; id: string }
  | { kind: "today"; index: number }
  | { kind: "starting"; error: "network" | "server" | null }
  | {
      kind: "postponed";
      status: "postpone" | "emergency" | "ad";
      screen: ScreenId | null;
      alsoShow: ScreenId[];
      lock: LockView | null;
    }
  | { kind: "seek_care"; then: "parts" | "nothing" }
  | { kind: "part"; index: number }
  | { kind: "stop_screen"; route: FocusStopRoute }
  | { kind: "faint_ask"; route: FocusStopRoute }
  | { kind: "completing"; error: boolean }
  | { kind: "done" }
  | { kind: "exit"; to: "today" | "findings" | "health" };

export interface FocusData {
  context: FocusContext | null;
  intake: (Intake & { sex: Sex }) | null;
  answers: Answers;
  today: FocusToday;
  /** The day questions of this check, fixed when the pre-check ends. */
  todayQs: TodayQuestion[];
  /** The screens visited, for Back (question ids, or today:<index>). */
  trail: string[];
  check: StartResponse | null;
  parts: FocusPart[];
}

export interface FocusModel {
  state: FocusState;
  data: FocusData;
}

export type FocusEvent =
  | { type: "LOADED"; context: FocusContext; intake: (Intake & { sex: Sex }) | null; now: number }
  | { type: "LOAD_FAILED"; code?: string }
  | { type: "CONSENT_SAVING" }
  | { type: "CONSENT_SAVED" }
  | { type: "CONSENT_FAILED" }
  | { type: "BEGIN" }
  | { type: "ANSWER"; id: string; value: AnswerValue; now: number }
  | { type: "TODAY"; value: number | boolean }
  | { type: "BACK" }
  | { type: "START_OK"; response: StartResponse }
  | {
      type: "START_FAILED";
      kind: "network" | "http";
      code?: string;
      body?: Record<string, unknown>;
    }
  | { type: "RETRY" }
  | { type: "SEEN" }
  | { type: "PART_DONE" }
  | { type: "CHECK_ENDED"; route: FocusStopRoute }
  | { type: "STOP_SCREEN"; route: FocusStopRoute }
  | { type: "FAINT_ANSWER"; value: "yes" | "no" | "unsure"; now: number }
  | { type: "COMPLETED" }
  | { type: "COMPLETE_FAILED" }
  | { type: "EXIT"; to: "today" | "findings" | "health" };

export const EMPTY_TODAY: FocusToday = { painByRegion: {}, redFlagRegions: [] };

export function initialModel(): FocusModel {
  return {
    state: { kind: "loading" },
    data: {
      context: null,
      intake: null,
      answers: {},
      today: { ...EMPTY_TODAY, painByRegion: {}, redFlagRegions: [] },
      todayQs: [],
      trail: [],
      check: null,
      parts: [],
    },
  };
}

/* --------------------------------------------------------------- the day */

/**
 * The body map's pain regions in body order (2.5 painByRegion: «pain_ask per pain region of the body
 * map»): every region with pain or an injury, the problems the v1 pain mirror counts as pain
 * (body-map.ts painIdsFromRegions).
 */
export function painRegions(intake: Pick<Intake, "regions">): RegionId[] {
  const marked = new Set(
    (intake.regions ?? [])
      .filter((e) => e.problems.includes("pain") || e.problems.includes("injury"))
      .map((e) => e.region),
  );
  return REGION_IDS.filter((r) => marked.has(r));
}

/**
 * The day questions, in order (2.5): the pain now of each pain region, then rf_region for each region
 * of the day's protocol and walk, then the transfer to a steady chair (a wheelchair user who can
 * transfer, rom-protocol transfer_chair_ask), then the gait day items when the walk is planned.
 */
export function todayQuestions(
  intake: Intake,
  protocol: RomProtocol,
  gait: GaitPlan | null,
): TodayQuestion[] {
  const qs: TodayQuestion[] = painRegions(intake).map((region) => ({ kind: "pain" as const, region }));
  for (const region of rfRegionsToAsk(protocol, gait)) qs.push({ kind: "rf", region });
  if (intake.mobility === "wheelchair" && intake.romFlags?.transferChair === true)
    qs.push({ kind: "transfer" });
  for (const id of gaitDayItems(gait, intake))
    qs.push({ kind: id === "pc_walk_10m" ? "walk10m" : "pdFreezing" });
  return qs;
}

/** The day's answers with one more answer. */
export function answerToday(today: FocusToday, q: TodayQuestion, value: number | boolean): FocusToday {
  switch (q.kind) {
    case "pain":
      return { ...today, painByRegion: { ...today.painByRegion, [q.region]: Number(value) } };
    case "rf": {
      const others = today.redFlagRegions.filter((r) => r !== q.region);
      return { ...today, redFlagRegions: value === true ? [...others, q.region] : others };
    }
    case "transfer":
      return { ...today, transferChair: value === true };
    case "walk10m":
      return { ...today, walk10m: value === true };
    case "pdFreezing":
      return { ...today, pdFreezing: value === true };
  }
}

/** pc_helper answered yes for any test: someone is beside the person today (FocusToday.helperPresent). */
export function helperPresentOf(answers: Answers): boolean {
  return Object.entries(answers).some(([id, v]) => id.startsWith("pc_helper") && v === "yes");
}

/** The parts of the check in C-13 order: seated, standing, the walk, lying (the blocks with a movement today). */
export function checkParts(protocol: RomProtocol, gait: GaitPlan | null): FocusPart[] {
  const blocks = BLOCK_RUN_ORDER.filter((b) => protocol.items.some((i) => i.block === b && !i.skipped));
  const parts: FocusPart[] = [];
  for (const block of blocks) {
    if (block === "lying" && gait?.offered) parts.push({ kind: "gait" });
    parts.push({ kind: "range", block });
  }
  if (gait?.offered && !parts.some((p) => p.kind === "gait")) parts.push({ kind: "gait" });
  return parts;
}

/** The start body of POST /api/focus. */
export function startBody(d: FocusData, device: { os: string; browser: string }) {
  const ctx = d.context!;
  return {
    setting: ctx.setting,
    answers: d.answers,
    today: { ...d.today, ...(helperPresentOf(d.answers) ? { helperPresent: true } : {}) },
    device,
    include: { rom: true, gait: ctx.gait?.offered === true },
  };
}

/* ------------------------------------------------------------- the machine */

const go = (m: FocusModel, state: FocusState, data: Partial<FocusData> = {}): FocusModel => ({
  state,
  data: { ...m.data, ...data },
});

/** The screen after the pre-check question `answered`: the next one, the day questions, or the start. */
function afterPrecheck(m: FocusModel, answers: Answers, now: number): FocusModel {
  const ctx = m.data.context!;
  const env = ctx.env!;
  const outcome = evaluatePrecheck(env, answers, now);
  if (outcome.status === "emergency" || outcome.status === "ad" || outcome.status === "postpone")
    // The screen shows at once; the start call records the stop and its lock (the server's own
    // evaluation of the same answers answers 409 POSTPONE).
    return go(
      m,
      {
        kind: "postponed",
        status: outcome.status,
        screen: outcome.screen ?? null,
        alsoShow: outcome.alsoShow ?? [],
        lock: null,
      },
      { answers },
    );
  const next = visibleQuestions(env, answers).find((id) => !(id in answers));
  if (next) return go(m, { kind: "question", id: next }, { answers });
  return toToday(go(m, m.state, { answers }));
}

function toToday(m: FocusModel): FocusModel {
  const ctx = m.data.context!;
  const qs = m.data.intake ? todayQuestions(m.data.intake, ctx.protocol!, ctx.gait) : [];
  if (qs.length === 0) return go(m, { kind: "starting", error: null }, { todayQs: qs });
  return go(m, { kind: "today", index: 0 }, { todayQs: qs });
}

/** The state after a context: closed, the consent, or the intro. */
function opened(m: FocusModel, context: FocusContext, now: number): FocusState {
  if (!context.intakeReady || !context.env || !context.protocol) return { kind: "closed", why: "intake" };
  if (context.setting === "home" && !context.homeOpen) return { kind: "closed", why: "home_closed" };
  if (context.lock) return { kind: "closed", why: "locked", lock: context.lock };
  if (context.earliestNext !== null && now < context.earliestNext)
    return { kind: "closed", why: "too_soon", until: context.earliestNext };
  if (!context.adultConfirmed) return { kind: "closed", why: "adult" };
  if (!context.consent.focus_check) return { kind: "consent", saving: false, error: false };
  void m;
  return { kind: "intro" };
}

export function reduce(m: FocusModel, e: FocusEvent): FocusModel {
  const s = m.state;
  switch (e.type) {
    case "LOADED":
      return go(m, opened(m, e.context, e.now), { context: e.context, intake: e.intake });
    case "LOAD_FAILED":
      if (e.code === "PLAN_REQUIRED") return go(m, { kind: "closed", why: "plan" });
      if (e.code === "REVIEW") return go(m, { kind: "closed", why: "review" });
      return go(m, { kind: "load_error" });
    case "CONSENT_SAVING":
      return s.kind === "consent" ? go(m, { kind: "consent", saving: true, error: false }) : m;
    case "CONSENT_SAVED":
      return s.kind === "consent" ? go(m, { kind: "intro" }) : m;
    case "CONSENT_FAILED":
      return s.kind === "consent" ? go(m, { kind: "consent", saving: false, error: true }) : m;
    case "BEGIN": {
      if (s.kind !== "intro" || !m.data.context?.env) return m;
      const first = visibleQuestions(m.data.context.env, m.data.answers).find(
        (id) => !(id in m.data.answers),
      );
      return first ? go(m, { kind: "question", id: first }, { trail: [] }) : toToday(go(m, s, { trail: [] }));
    }
    case "ANSWER": {
      if (s.kind !== "question" || s.id !== e.id) return m;
      const answers = { ...m.data.answers, [e.id]: e.value };
      // Answers of questions no longer shown are dropped (a changed earlier answer hides them).
      const env = m.data.context!.env!;
      const shown = new Set(visibleQuestions(env, answers));
      for (const id of Object.keys(answers)) if (!shown.has(id)) delete answers[id];
      return afterPrecheck(go(m, s, { trail: [...m.data.trail, e.id] }), answers, e.now);
    }
    case "TODAY": {
      if (s.kind !== "today") return m;
      const q = m.data.todayQs[s.index];
      const today = answerToday(m.data.today, q, e.value);
      const trail = [...m.data.trail, `today:${s.index}`];
      if (s.index + 1 < m.data.todayQs.length)
        return go(m, { kind: "today", index: s.index + 1 }, { today, trail });
      return go(m, { kind: "starting", error: null }, { today, trail });
    }
    case "BACK": {
      if (s.kind !== "question" && s.kind !== "today") return m;
      const trail = [...m.data.trail];
      const prev = trail.pop();
      if (prev === undefined) return go(m, { kind: "intro" }, { trail });
      if (prev.startsWith("today:")) return go(m, { kind: "today", index: Number(prev.slice(6)) }, { trail });
      return go(m, { kind: "question", id: prev }, { trail });
    }
    case "START_OK": {
      if (s.kind !== "starting") return m;
      const r = e.response;
      const parts = checkParts(r.protocol, r.gait);
      const data = { check: r, parts };
      if (r.warnings.includes("scr_stop_seek_care")) return go(m, { kind: "seek_care", then: "parts" }, data);
      return go(m, parts.length ? { kind: "part", index: 0 } : { kind: "completing", error: false }, data);
    }
    case "START_FAILED": {
      if (s.kind !== "starting" && s.kind !== "postponed") return m;
      if (e.kind === "network")
        return s.kind === "postponed" ? m : go(m, { kind: "starting", error: "network" });
      const body = e.body ?? {};
      switch (e.code) {
        case "POSTPONE": {
          const status = (body.status as "postpone" | "emergency" | "ad") ?? "postpone";
          return go(m, {
            kind: "postponed",
            status,
            screen: (body.screen as ScreenId | null) ?? null,
            alsoShow: (body.alsoShow as ScreenId[]) ?? [],
            lock: (body.lock as LockView | null) ?? null,
          });
        }
        case "NOTHING_TO_MEASURE": {
          const warnings = (body.warnings as ScreenId[] | undefined) ?? [];
          return warnings.includes("scr_stop_seek_care")
            ? go(m, { kind: "seek_care", then: "nothing" })
            : go(m, { kind: "closed", why: "nothing" });
        }
        case "LOCKED": {
          const { error: _e, ...lock } = body as Record<string, unknown>;
          void _e;
          return go(m, { kind: "closed", why: "locked", lock: lock as unknown as LockView });
        }
        case "TOO_SOON":
          return go(m, { kind: "closed", why: "too_soon", until: (body.until as number) ?? null });
        case "HOME_CLOSED":
        case "BOOTH_REQUIRED":
          return go(m, { kind: "closed", why: "home_closed" });
        case "CONSENT_REQUIRED":
          return go(m, { kind: "consent", saving: false, error: false });
        case "ADULT_REQUIRED":
          return go(m, { kind: "closed", why: "adult" });
        case "INTAKE_UPDATE_REQUIRED":
          return go(m, { kind: "closed", why: "intake" });
        case "PLAN_REQUIRED":
          return go(m, { kind: "closed", why: "plan" });
        case "REVIEW":
          return go(m, { kind: "closed", why: "review" });
        case "RATE_LIMIT":
          return go(m, { kind: "closed", why: "rate" });
        default:
          return s.kind === "postponed" ? m : go(m, { kind: "starting", error: "server" });
      }
    }
    case "RETRY":
      if (s.kind === "starting") return go(m, { kind: "starting", error: null });
      if (s.kind === "completing") return go(m, { kind: "completing", error: false });
      if (s.kind === "load_error") return go(m, { kind: "loading" });
      return m;
    case "SEEN":
      if (s.kind === "seek_care")
        return s.then === "nothing"
          ? go(m, { kind: "closed", why: "nothing" })
          : go(m, m.data.parts.length ? { kind: "part", index: 0 } : { kind: "completing", error: false });
      if (s.kind === "stop_screen") {
        // A faint or a fall: the follow up once the person is settled (v1 S38b), then Today.
        if (s.route.then === "sf_faint_loc") return go(m, { kind: "faint_ask", route: s.route });
        return s.route.endsCheck ? go(m, { kind: "exit", to: "today" }) : m;
      }
      return m;
    case "PART_DONE": {
      if (s.kind !== "part") return m;
      const next = s.index + 1;
      return next < m.data.parts.length
        ? go(m, { kind: "part", index: next })
        : go(m, { kind: "completing", error: false });
    }
    case "STOP_SCREEN":
      return go(m, { kind: "stop_screen", route: e.route });
    case "FAINT_ANSWER": {
      if (s.kind !== "faint_ask") return m;
      // The pure rule the v1 server runs (faintFollowUp): yes or not sure is an emergency.
      const out = faintFollowUp(e.value, e.now);
      const { then: _then, ...route } = s.route;
      void _then;
      return out.status === "emergency"
        ? go(m, {
            kind: "stop_screen",
            route: { ...route, screen: out.screen ?? "scr_emergency", alsoShow: [] },
          })
        : go(m, { kind: "stop_screen", route });
    }
    case "CHECK_ENDED":
      // A stop ended the check (the server closed it): its screen, else back to Today.
      return e.route.screen
        ? go(m, { kind: "stop_screen", route: e.route })
        : go(m, { kind: "exit", to: "today" });
    case "COMPLETED":
      return s.kind === "completing" ? go(m, { kind: "done" }) : m;
    case "COMPLETE_FAILED":
      return s.kind === "completing" ? go(m, { kind: "completing", error: true }) : m;
    case "EXIT":
      return go(m, { kind: "exit", to: e.to });
  }
}
