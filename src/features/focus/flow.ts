/**
 * The focus check's shell (product v7 contract B3, C-2, C-13, 2.5 and section 4; D-032): everything
 * around the range blocks, as a pure state machine the FocusApp renders. Pure, no DOM.
 *
 *   loading      GET /api/auth/me (the intake) and GET /api/focus/context
 *   closed       nothing can start today: the v7 body questions are missing (health), a lock, the 48
 *                hours, no plan, a plan in review (home is open for v7, D-032 item 1; home_closed stays
 *                for an older server)
 *   consent      the focus_check consent (C-8), once
 *   intro        which joints we will check, and why (plan 1.7), with the safety lines once
 *   today        the day's one screen (D-032 item 2): today's pain in the areas of the check, one yes
 *                or no question for anything new or worrying, and only the walk's questions the walk
 *                plan needs, someone with the person asked once (focus-precheck.ts dayItems)
 *   skip_today   a yes to the worry question: one calm screen, the check skipped today (the start call
 *                records it and its next day lock); its «الأمر عاجل الآن» opens the emergency screen
 *   starting     POST /api/focus (setting booth on a booth pass, else home)
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
 *   build        D-032 item 3, a person whose program waits for the check: the build animation while
 *                the program is built, from the check's findings, or from the history when nothing can
 *                be measured or the person cannot use a camera; then the program opens
 */
import type { LockView } from "../assessment/api";
import type { GaitPlan } from "../../medical/gait-eligibility";
import { emergencyAlsoShow, faintFollowUp, type PrecheckEnv } from "../../medical/precheck";
import { dayItems, missingDayItems, type DayItem } from "../../medical/focus-precheck";
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
  /** The v1 helper briefing screens (none since D-032 item 2: the part's card says who stands beside). */
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

/** A part of the check after the start, in C-13 order. */
export type FocusPart = { kind: "range"; block: RomBlock } | { kind: "gait" };

/**
 * Where the program of a person awaiting the check comes from (D-032 item 3): the check's findings, or
 * the history when nothing can be measured or the person cannot use a camera.
 */
export type BuildFrom = "check" | "history";

export type FocusState =
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "closed"; why: ClosedWhy; until?: number | null; lock?: LockView | null }
  | { kind: "consent"; saving: boolean; error: boolean }
  | { kind: "intro" }
  | { kind: "today" }
  | { kind: "skip_today"; lock: LockView | null }
  | { kind: "starting"; error: "network" | "server" | null }
  | {
      kind: "postponed";
      status: "postpone" | "emergency" | "ad";
      screen: ScreenId | null;
      alsoShow: ScreenId[];
      lock: LockView | null;
    }
  | { kind: "part"; index: number }
  | { kind: "walk_pain"; index: number; regions: RegionId[]; k: number }
  | { kind: "walk_skipped"; index: number }
  | { kind: "stop_screen"; route: FocusStopRoute }
  | { kind: "faint_ask"; route: FocusStopRoute }
  | { kind: "completing"; error: boolean }
  | { kind: "done" }
  | { kind: "build"; from: BuildFrom }
  | { kind: "exit"; to: FocusExitTo };

/**
 * Where the focus check leaves to: the portal's Today, the findings or the health form; after a build
 * (D-032 item 3) the program page of the findings, or the portal's Program tab for the history's.
 */
export type FocusExitTo = "today" | "findings" | "health" | "program" | "program_tab";

export interface FocusData {
  context: FocusContext | null;
  intake: (Intake & { sex: Sex }) | null;
  /** The day's answers (the day's one screen). */
  today: FocusToday;
  check: StartResponse | null;
  parts: FocusPart[];
  /** The walk's pain gate ran (the session's WALK_GATE, once per check). */
  walkGated?: boolean;
  /** The person's program waits for the check (D-032 item 3): the end builds it. */
  onboarding?: boolean;
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
  /** The day's one screen is answered (D-032 item 2). */
  | { type: "DAY_DONE"; today: FocusToday }
  /** «الأمر عاجل الآن» on the calm skip screen: the emergency screen. */
  | { type: "URGENT" }
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
  /** The walk's pain gate (RomController.walkGate), when the walk's part opens. */
  | { type: "WALK_GATE"; skip: boolean; ask: RegionId[] }
  /** The pain now of the region walk_pain asks about (0 to 10). */
  | { type: "WALK_PAIN"; value: number }
  | { type: "PART_DONE" }
  | { type: "CHECK_ENDED"; route: FocusStopRoute }
  | { type: "STOP_SCREEN"; route: FocusStopRoute }
  | { type: "FAINT_ANSWER"; value: "yes" | "no" | "unsure"; now: number }
  | { type: "COMPLETED" }
  | { type: "COMPLETE_FAILED" }
  /** «لا أستطيع استخدام الكاميرا» (D-032 item 3): the history builds the program now. */
  | { type: "BUILD"; from: BuildFrom }
  /** The build animation ended and the program is built: the program opens. */
  | { type: "BUILT" }
  | { type: "EXIT"; to: FocusExitTo };

export const EMPTY_TODAY: FocusToday = { painByRegion: {}, redFlagRegions: [] };

export function initialModel(onboarding = false): FocusModel {
  return {
    state: { kind: "loading" },
    data: {
      context: null,
      intake: null,
      today: { ...EMPTY_TODAY, painByRegion: {}, redFlagRegions: [] },
      check: null,
      parts: [],
      ...(onboarding ? { onboarding: true } : {}),
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

/** The day's one screen's items for these answers (focus-precheck.ts dayItems on the context's preview). */
export function todayItems(d: Pick<FocusData, "context" | "intake">, today: FocusToday): DayItem[] {
  const ctx = d.context;
  if (!ctx?.protocol || !d.intake) return ["worry"];
  return dayItems({ intake: d.intake, setting: ctx.setting, protocol: ctx.protocol, gait: ctx.gait, today });
}

/** The day items of these answers still without one (the start needs every one). */
export function todayMissing(d: Pick<FocusData, "context" | "intake">, today: FocusToday): DayItem[] {
  const ctx = d.context;
  if (!ctx?.protocol || !d.intake) return typeof today.worrying === "boolean" ? [] : ["worry"];
  return missingDayItems({
    intake: d.intake,
    setting: ctx.setting,
    protocol: ctx.protocol,
    gait: ctx.gait,
    today,
  });
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

/**
 * Whether the intro's safety card carries v1's warn_sci_t6 (D-032 item 2: once, not before every
 * part): the stop list shows the dysreflexia signs, a spinal cord injury at T6 or above or of an
 * unknown level (precheck.ts stopSciT6).
 */
export function sciWarningOnce(env: PrecheckEnv | null): boolean {
  if (!env) return false;
  const sci = env.ctx.conditions.some((c) => c === "sci_complete" || c === "sci_incomplete");
  const flag = env.setup?.sciT6;
  return flag === true || (flag === undefined && sci);
}

/** The start body of POST /api/focus: the day's one screen's answers. */
export function startBody(d: FocusData, device: { os: string; browser: string }) {
  const ctx = d.context!;
  return {
    setting: ctx.setting,
    today: d.today,
    device,
    include: { rom: true, gait: ctx.gait?.offered === true },
  };
}

/* ------------------------------------------------------------- the machine */

const go = (m: FocusModel, state: FocusState, data: Partial<FocusData> = {}): FocusModel => ({
  state,
  data: { ...m.data, ...data },
});

/** A part of the check, or the end once every part ran. */
function toPart(m: FocusModel, index: number): FocusModel {
  if (index >= m.data.parts.length) return go(m, { kind: "completing", error: false });
  return go(m, { kind: "part", index });
}

/** The state after a context: closed, the consent, or the intro. */
function opened(m: FocusModel, context: FocusContext, now: number): FocusState {
  if (!context.intakeReady || !context.env || !context.protocol) return { kind: "closed", why: "intake" };
  // No camera movement in any marked joint (a wrist only map: forearm_wrist measures nothing) and no
  // walk: another day would not help, so this is not the safety line of «nothing to measure today».
  // D-032 item 3: for a person whose program waits for the check, the history builds it at once.
  if (!context.protocol.items.length && !context.protocol.deferred.length && !context.gait?.offered)
    return m.data.onboarding ? { kind: "build", from: "history" } : { kind: "closed", why: "no_camera" };
  if (context.setting === "home" && !context.homeOpen) return { kind: "closed", why: "home_closed" };
  if (context.lock) return { kind: "closed", why: "locked", lock: context.lock };
  if (context.earliestNext !== null && now < context.earliestNext)
    return { kind: "closed", why: "too_soon", until: context.earliestNext };
  if (!context.adultConfirmed) return { kind: "closed", why: "adult" };
  if (!context.consent.focus_check) return { kind: "consent", saving: false, error: false };
  return { kind: "intro" };
}

export function reduce(m: FocusModel, e: FocusEvent): FocusModel {
  const s = m.state;
  switch (e.type) {
    case "LOADED":
      return go(m, opened(m, e.context, e.now), { context: e.context, intake: e.intake });
    case "LOAD_FAILED":
      if (e.code === "PLAN_REQUIRED") return go(m, { kind: "closed", why: "plan" });
      // A ready plan whose person the check cannot measure (a bed user, D-032 item 3): the history
      // builds the program at once.
      if (e.code === "REVIEW")
        return go(
          m,
          m.data.onboarding ? { kind: "build", from: "history" } : { kind: "closed", why: "review" },
        );
      return go(m, { kind: "load_error" });
    case "CONSENT_SAVING":
      return s.kind === "consent" ? go(m, { kind: "consent", saving: true, error: false }) : m;
    case "CONSENT_SAVED":
      return s.kind === "consent" ? go(m, { kind: "intro" }) : m;
    case "CONSENT_FAILED":
      return s.kind === "consent" ? go(m, { kind: "consent", saving: false, error: true }) : m;
    case "BEGIN":
      return s.kind === "intro" && m.data.context?.env ? go(m, { kind: "today" }) : m;
    case "DAY_DONE": {
      if (s.kind !== "today") return m;
      const today: FocusToday = { ...e.today, redFlagRegions: [...e.today.redFlagRegions] };
      // Every item the screen shows needs its answer; a yes to the worry question needs no other.
      if (todayMissing(m.data, today).length) return m;
      if (today.worrying === true) return go(m, { kind: "skip_today", lock: null }, { today });
      return go(m, { kind: "starting", error: null }, { today });
    }
    case "URGENT":
      // The emergency screen with v1's dysreflexia screen for a spinal cord injury (D5-10).
      return s.kind === "skip_today"
        ? go(m, {
            kind: "postponed",
            status: "emergency",
            screen: "scr_emergency",
            alsoShow: emergencyAlsoShow(m.data.context?.env ?? null),
            lock: s.lock,
          })
        : m;
    case "BACK":
      return s.kind === "today" ? go(m, { kind: "intro" }) : m;
    case "START_OK": {
      if (s.kind !== "starting") return m;
      const r = e.response;
      const parts = checkParts(r.protocol, r.gait);
      return toPart(go(m, s, { check: { ...r, helperBriefing: r.helperBriefing ?? {} }, parts }), 0);
    }
    case "START_FAILED": {
      if (s.kind !== "starting" && s.kind !== "skip_today" && s.kind !== "postponed") return m;
      if (e.kind === "network")
        return s.kind === "starting" ? go(m, { kind: "starting", error: "network" }) : m;
      const body = e.body ?? {};
      switch (e.code) {
        case "POSTPONE": {
          // The server's lock (its {when} line) joins the screen the phone already shows.
          const lock = (body.lock as LockView | null) ?? null;
          if (s.kind === "postponed") return go(m, { ...s, lock });
          return go(m, { kind: "skip_today", lock });
        }
        case "NOTHING_TO_MEASURE":
          return go(m, { kind: "closed", why: "nothing" });
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
          return s.kind === "starting" ? go(m, { kind: "starting", error: "server" }) : m;
      }
    }
    case "RETRY":
      if (s.kind === "starting") return go(m, { kind: "starting", error: null });
      if (s.kind === "completing") return go(m, { kind: "completing", error: false });
      if (s.kind === "load_error") return go(m, { kind: "loading" });
      return m;
    case "SEEN":
      if (s.kind === "walk_skipped") return toPart(m, s.index + 1);
      if (s.kind === "stop_screen") {
        // A faint or a fall: the follow up once the person is settled (v1 S38b), then Today.
        if (s.route.then === "sf_faint_loc") return go(m, { kind: "faint_ask", route: s.route });
        return s.route.endsCheck ? go(m, { kind: "exit", to: "today" }) : m;
      }
      return m;
    case "WALK_GATE": {
      if (s.kind !== "part" || m.data.parts[s.index]?.kind !== "gait") return m;
      if (e.skip) return go(m, { kind: "walk_skipped", index: s.index }, { walkGated: true });
      if (e.ask.length)
        return go(m, { kind: "walk_pain", index: s.index, regions: [...e.ask], k: 0 }, { walkGated: true });
      return go(m, s, { walkGated: true });
    }
    case "WALK_PAIN": {
      if (s.kind !== "walk_pain") return m;
      // The one shared rule's cut (C-15, gait-rules eligibility.today): 6 or more postpones the walk.
      if (e.value >= PAIN_TODAY_SKIP_AT) return go(m, { kind: "walk_skipped", index: s.index });
      if (s.k + 1 < s.regions.length) return go(m, { ...s, k: s.k + 1 });
      return go(m, { kind: "part", index: s.index });
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
      // The emergency screen carries v1's dysreflexia screen for a spinal cord injury (O12 (1), D5-10).
      return out.status === "emergency"
        ? go(m, {
            kind: "stop_screen",
            route: {
              ...route,
              screen: out.screen ?? "scr_emergency",
              alsoShow: emergencyAlsoShow(m.data.context?.env ?? null),
            },
          })
        : go(m, { kind: "stop_screen", route });
    }
    case "CHECK_ENDED":
      // A stop ended the check (the server closed it): its screen, else back to Today.
      return e.route.screen
        ? go(m, { kind: "stop_screen", route: e.route })
        : go(m, { kind: "exit", to: "today" });
    case "COMPLETED":
      // D-032 item 3: the program's build first, then the program page with each exercise's why line.
      if (s.kind !== "completing") return m;
      return go(m, m.data.onboarding ? { kind: "build", from: "check" } : { kind: "done" });
    case "COMPLETE_FAILED":
      return s.kind === "completing" ? go(m, { kind: "completing", error: true }) : m;
    case "BUILD":
      // «لا أستطيع استخدام الكاميرا»: before the check, or on a camera that cannot open.
      if (!m.data.onboarding || e.from !== "history") return m;
      return s.kind === "intro" || s.kind === "today" || s.kind === "part"
        ? go(m, { kind: "build", from: "history" })
        : m;
    case "BUILT":
      return s.kind === "build"
        ? go(m, { kind: "exit", to: s.from === "check" ? "program" : "program_tab" })
        : m;
    case "EXIT":
      return go(m, { kind: "exit", to: e.to });
  }
}
