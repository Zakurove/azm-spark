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
 *   warnings     the v1 pre-check's warnings for the whole check (v1 S25: warn_ms_cool, warn_pd_timing,
 *                scr_note_care and the rest), once before the first part; warn_sci_t6 and
 *                warn_weak_shoulder go with their parts instead (v1 S28, partWarnings)
 *   brief        the v1 helper briefing (S26, Q11) before a part the bridge maps it to: the chair
 *                stand's before the standing block and the walk, the side lean's before the seated
 *                block with the side bend in seated_armrests; a confirm step («المساعد بجانبي وقرأ
 *                التعليمات»): the part starts only after the tap (v1.1)
 *   part         the parts in C-13 order: seated range, standing range, the walk (C's GaitStep slot),
 *                lying range (then sit before stand, in the RomController)
 *   walk_pain    before the walk, after a pain stop in a region the walk loads (rom-protocol 6
 *                pain_during: ask before any other movement of the same joint): the pain now of each
 *                such region; 6 or more postpones the walk (gait-rules eligibility.today)
 *   walk_skipped the walk is postponed today for pain (a pain of 6 or more, a sharp pain or a region
 *                not measured today for pain, in the range blocks or at walk_pain): why, then on
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
  PAIN_TODAY_SKIP_AT,
  type FocusToday,
  type RomBlock,
  type RomProtocol,
} from "../../medical/rom-protocol";
import type { ScreenId, TestId } from "../../movements/types";
import { WARNINGS_AT_TEST } from "../assessment/flow/copy";

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
  /** The {x} of warn_pd_timing: the dose bucket kept with the last completed check, or null (v1). */
  lastPdDoseBucket?: string | null;
}

/** The 200 answer of POST /api/focus. */
export interface StartResponse {
  id: string;
  kind: "baseline" | "retest";
  protocol: RomProtocol;
  gait: GaitPlan | null;
  warnings: ScreenId[];
  helperRequired: string[];
  /** The v1 helper briefing screen of each proxy test that needs a helper today (precheck helperBriefing). */
  helperBriefing: Partial<Record<TestId, ScreenId>>;
  /**
   * Each side's best seated side bend at earlier checks, focus or v1 (D-027 item 2, W2-6): the runner's
   * limit is that best plus 15; null for a side never measured (the first check limit).
   */
  sideLeanBest?: { left: number | null; right: number | null };
}

/** The controller's sideLeanBest from the start response: the sides with an earlier best, or none. */
export function leanBestOf(check: StartResponse): Partial<Record<"left" | "right", number>> | undefined {
  const out: Partial<Record<"left" | "right", number>> = {};
  for (const side of ["left", "right"] as const) {
    const v = check.sideLeanBest?.[side];
    if (typeof v === "number" && Number.isFinite(v)) out[side] = v;
  }
  return Object.keys(out).length ? out : undefined;
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
  | "intake"
  | "home_closed"
  | "locked"
  | "too_soon"
  | "plan"
  | "review"
  | "adult"
  | "rate"
  | "nothing"
  /** The body map's joints have no camera movement and no walk is planned: nothing could ever start. */
  | "no_camera";

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
  | { kind: "warnings" }
  | { kind: "brief"; index: number; screen: HelperBriefScreen }
  | { kind: "part"; index: number }
  | { kind: "walk_pain"; index: number; regions: RegionId[]; k: number; then: "brief" | "part" }
  | { kind: "walk_skipped"; index: number }
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
  /** The walk's pain gate ran (the session's WALK_GATE, once per check). */
  walkGated?: boolean;
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
  /** The helper briefing's confirm tap (helperBriefing.confirmButton). */
  | { type: "HELPER_READY" }
  /** The walk's pain gate (RomController.walkGate), when the walk's part or its briefing opens. */
  | { type: "WALK_GATE"; skip: boolean; ask: RegionId[] }
  /** The pain now of the region walk_pain asks about (0 to 10). */
  | { type: "WALK_PAIN"; value: number }
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

/** The v1 helper briefings (S26). */
export type HelperBriefScreen = "scr_helper_brief_stand" | "scr_helper_brief_trunk";

/**
 * The warnings of the whole check (v1 S25, checkWarnings): every warning the start returned except
 * those shown with a part (WARNINGS_AT_TEST: warn_sci_t6, warn_weak_shoulder and the two helper
 * briefings) and the seek care screen of a red flag region, which has its own step.
 */
export function checkWarningsOf(warnings: readonly ScreenId[]): ScreenId[] {
  return warnings.filter((w) => !WARNINGS_AT_TEST.includes(w) && w !== "scr_stop_seek_care");
}

const ARM_REGIONS: readonly RegionId[] = ["shoulder", "elbow", "forearm_wrist"];

/**
 * The warnings shown with a part, on the card the person confirms before it starts (v1 S28
 * testWarnings: «warn_sci_t6 before every test», warn_weak_shoulder before the arm tests):
 * warn_sci_t6 with every range block and the walk; warn_weak_shoulder with a block that moves an arm.
 */
export function partWarnings(
  warnings: readonly ScreenId[],
  part: FocusPart,
  protocol: RomProtocol,
): ScreenId[] {
  const out: ScreenId[] = [];
  if (warnings.includes("warn_sci_t6")) out.push("warn_sci_t6");
  if (
    part.kind === "range" &&
    warnings.includes("warn_weak_shoulder") &&
    protocol.items.some((i) => i.block === part.block && !i.skipped && ARM_REGIONS.includes(i.region))
  )
    out.push("warn_weak_shoulder");
  return out;
}

/**
 * The helper briefing before a part (v1.1: «the test starts only after the tap on
 * helperBriefing.confirmButton»), as the pre-check bridge maps the proxy tests (focus-precheck.ts):
 * the chair stand's (chair_stand_30s) before a standing block and the walk; the side lean's
 * (trunk_control_seated) before the block with a side bend in seated_armrests. Null: none.
 */
export function briefFor(
  part: FocusPart | undefined,
  protocol: RomProtocol,
  briefing: StartResponse["helperBriefing"],
): HelperBriefScreen | null {
  if (!part) return null;
  const pick = (test: TestId): HelperBriefScreen | null => {
    const screen = briefing[test];
    return screen === "scr_helper_brief_stand" || screen === "scr_helper_brief_trunk" ? screen : null;
  };
  if (part.kind === "gait") return pick("chair_stand_30s");
  if (part.block === "standing") return pick("chair_stand_30s");
  const sideLean = protocol.items.some(
    (i) => i.block === part.block && !i.skipped && i.position === "seated_armrests",
  );
  return sideLean ? pick("trunk_control_seated") : null;
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

/** A part of the check: its helper briefing first when it has one, else the part. */
function toPart(m: FocusModel, index: number): FocusModel {
  const check = m.data.check;
  if (index >= m.data.parts.length) return go(m, { kind: "completing", error: false });
  const screen = check ? briefFor(m.data.parts[index], check.protocol, check.helperBriefing ?? {}) : null;
  return go(m, screen ? { kind: "brief", index, screen } : { kind: "part", index });
}

/** After the start (and the seek care screen): the warnings of the whole check, then the first part. */
function afterStart(m: FocusModel): FocusModel {
  const warnings = m.data.check ? checkWarningsOf(m.data.check.warnings) : [];
  return warnings.length ? go(m, { kind: "warnings" }) : toPart(m, 0);
}

/** The state after a context: closed, the consent, or the intro. */
function opened(m: FocusModel, context: FocusContext, now: number): FocusState {
  if (!context.intakeReady || !context.env || !context.protocol) return { kind: "closed", why: "intake" };
  // No camera movement in any marked joint (a wrist only map: forearm_wrist measures nothing) and no
  // walk: another day would not help, so this is not the safety line of «nothing to measure today».
  if (!context.protocol.items.length && !context.protocol.deferred.length && !context.gait?.offered)
    return { kind: "closed", why: "no_camera" };
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
      const data = { check: { ...r, helperBriefing: r.helperBriefing ?? {} }, parts };
      if (r.warnings.includes("scr_stop_seek_care")) return go(m, { kind: "seek_care", then: "parts" }, data);
      return afterStart(go(m, s, data));
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
        return s.then === "nothing" ? go(m, { kind: "closed", why: "nothing" }) : afterStart(m);
      if (s.kind === "warnings") return toPart(m, 0);
      if (s.kind === "walk_skipped") return toPart(m, s.index + 1);
      if (s.kind === "stop_screen") {
        // A faint or a fall: the follow up once the person is settled (v1 S38b), then Today.
        if (s.route.then === "sf_faint_loc") return go(m, { kind: "faint_ask", route: s.route });
        return s.route.endsCheck ? go(m, { kind: "exit", to: "today" }) : m;
      }
      return m;
    case "HELPER_READY":
      return s.kind === "brief" ? go(m, { kind: "part", index: s.index }) : m;
    case "WALK_GATE": {
      if ((s.kind !== "part" && s.kind !== "brief") || m.data.parts[s.index]?.kind !== "gait") return m;
      if (e.skip) return go(m, { kind: "walk_skipped", index: s.index }, { walkGated: true });
      if (e.ask.length)
        return go(
          m,
          { kind: "walk_pain", index: s.index, regions: [...e.ask], k: 0, then: s.kind },
          { walkGated: true },
        );
      return go(m, s, { walkGated: true });
    }
    case "WALK_PAIN": {
      if (s.kind !== "walk_pain") return m;
      // The one shared rule's cut (C-15, gait-rules eligibility.today): 6 or more postpones the walk.
      if (e.value >= PAIN_TODAY_SKIP_AT) return go(m, { kind: "walk_skipped", index: s.index });
      if (s.k + 1 < s.regions.length) return go(m, { ...s, k: s.k + 1 });
      return s.then === "brief" ? toPart(m, s.index) : go(m, { kind: "part", index: s.index });
    }
    case "PART_DONE": {
      if (s.kind !== "part") return m;
      return toPart(m, s.index + 1);
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
