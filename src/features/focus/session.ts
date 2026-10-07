/**
 * One focus check on the phone (product v7 contract B3): the shell's state machine (flow.ts) with its
 * calls, and the RomController of the range parts. The FocusApp renders it and hands it the person's
 * taps and the camera frames; nothing here touches the DOM, so the tests run a whole check on the real
 * focus routes with a simulated person (tests/v7/b-shell.test.ts).
 *
 *   - The day's one screen and the start: flow.ts, with the start call when the state asks for it. A
 *     yes to the worry question shows the calm skip screen at once and the start call records it and
 *     its next day lock in the background (D-032 item 2).
 *   - The range parts: one RomController for the whole check (the same joint re-ask crosses blocks);
 *     each range part starts its block and ends at the block's end step.
 *   - Each saved movement is posted in order (POST /api/focus/:id/rom); a failed post is tried again
 *     at the next movement and before the complete call, so nothing is lost offline for a while.
 *   - The stop list: the phone routes the answer with the v1 rules at once (stopRoute, C-2) and posts
 *     it (POST /api/focus/:id/stop), which stores the stopped movement's row, the locks and the counts.
 *     A stop screen is a red flag for the coach (P0, after the screen shows). A stop during the walk
 *     for tiredness rests a minute before the next range block's card; one for pain re-asks the pain
 *     before the next movement of each joint the walk loads.
 *   - The complete call (POST /api/focus/:id/complete) once every part is done; then the findings.
 *   - D-032 item 3, a person whose program waits for the check: the build (POST /api/program/targets
 *     after the check, POST /api/program/history when nothing can be measured or there is no
 *     camera), while the build animation plays; the program opens once both are done.
 */
import type { Lang } from "../../app/i18n";
import type { BridgeEvent, CoachStopReason } from "../../coach/types";
import type { RomMeasureResult } from "../../engine/rom/types";
import { emergencyAlsoShow, stopRoute, type StopRoute } from "../../medical/precheck";
import type { RegionId } from "../../medical/body-map";
import type { RomProtocolItem } from "../../medical/rom-protocol";
import type { StopOptionId } from "../../movements/types";
import type { FocusApi, RomSaved } from "./api";
import { jointsOf } from "./joints";
import {
  initialModel,
  leanBestOf,
  reduce,
  startBody,
  type FocusEvent,
  type FocusModel,
  type FocusStopRoute,
} from "./flow";
import {
  itemKey,
  RomController,
  type Line,
  type PoseModel,
  type RomControllerOptions,
} from "./romController";

export interface FocusSessionOptions {
  lang: Lang;
  /** The clock (performance time for frames, Date.now for the 48 hours and locks). */
  now?: () => number;
  device?: { os: string; browser: string };
  /** The camera's pose model (C-10), read at each movement's start. */
  poseModel?: () => PoseModel;
  /** The person's program waits for the check (D-032 item 3): the end builds it. */
  onboarding?: boolean;
  /** Controller timing (E2E fast timing). */
  restSec?: number;
  sitSeconds?: number;
  stopRestSeconds?: number;
}

/** A local line to say and caption now (the shell plays it when the voice is on). */
export interface SpokenLine {
  line: Line;
  severity: "info" | "warn" | "safety";
  at: number;
}

/**
 * The regions a walk loads (contract 2.5: a red flag in one of them removes the walk). After a walk
 * stopped for pain, their joints ask the pain question before their next movement (2.6's re-ask).
 */
export const WALK_REGIONS: readonly RegionId[] = ["hip", "knee", "ankle_foot", "back_trunk"];

/**
 * What the build animation shows (D-032 item 3): the joints measured, the walk, the exercises chosen
 * (none counted: the build answers them later, see buildProgram).
 */
export interface BuildSummary {
  joints: number;
  walk: boolean;
  exercises: number;
}

export class FocusSession {
  model: FocusModel;
  /**
   * The program's build (D-032 item 3): null before it, then whether the call is done and, after a
   * check, what the build animation shows.
   */
  build: { done: boolean; summary?: BuildSummary } | null = null;
  /** The movements the server saved with a value, by movement and side (the build's joints). */
  private readonly measuredKeys = new Set<string>();
  /** The completed check kept a walk (the build's summary). */
  private walked = false;
  ctl: RomController | null = null;
  /** The server's grade of each saved movement (C-3), by movement and side. */
  readonly grades = new Map<string, RomSaved>();
  /**
   * Movements the server refused (an http answer that a retry will not change): kept here with the
   * refusal's code, never dropped silently (the E2E hook and the review scripts read it).
   */
  readonly refused: { movementId: string; side: string; code: string }[] = [];
  /** A stop list opened outside a range part (the walk), with the coach's preselection. */
  stopOutside: { preselect: CoachStopReason | null } | null = null;
  /** The last local line, for the caption. */
  spoken: SpokenLine | null = null;
  private readonly api: FocusApi;
  private readonly opts: FocusSessionOptions;
  private readonly listeners = new Set<() => void>();
  private readonly bridgeListeners = new Set<(e: BridgeEvent) => void>();
  private readonly lineListeners = new Set<(l: SpokenLine) => void>();
  private readonly outbox: { item: RomProtocolItem; result: RomMeasureResult }[] = [];
  private flushing: Promise<void> | null = null;
  private busy = false;
  /** The walk stopped for tiredness or something else: the next range block starts with a rest. */
  private restBeforeNext = false;

  constructor(api: FocusApi, opts: FocusSessionOptions) {
    this.api = api;
    this.opts = opts;
    this.model = initialModel(opts.onboarding === true);
  }

  /** The language changed on the page (the coach's repeated instructions follow it). */
  setLang(lang: Lang): void {
    (this.opts as { lang: Lang }).lang = lang;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The coach's events (useCoach.push). */
  onBridge(fn: (e: BridgeEvent) => void): () => void {
    this.bridgeListeners.add(fn);
    return () => this.bridgeListeners.delete(fn);
  }

  /** The local lines to play (the voice pack, when the voice is on). */
  onLine(fn: (l: SpokenLine) => void): () => void {
    this.lineListeners.add(fn);
    return () => this.lineListeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Applies an event and runs the call its new state asks for. */
  dispatch(e: FocusEvent): void {
    const before = this.model.state;
    this.model = reduce(this.model, e);
    const s = this.model.state;
    if (s !== before) this.enter();
    this.changed();
  }

  /** Starts the session: the intake and the context. */
  async load(): Promise<void> {
    const [me, context] = await Promise.all([this.api.me(), this.api.context()]);
    if (!context.ok) {
      const code = context.error.kind === "http" ? context.error.code : undefined;
      this.dispatch({ type: "LOAD_FAILED", ...(code ? { code } : {}) });
      return;
    }
    const intake = me.ok && me.value.intake?.sex ? (me.value.intake as never) : null;
    this.dispatch({ type: "LOADED", context: context.value, intake, now: Date.now() });
  }

  /** The focus_check consent (C-8). */
  async consent(): Promise<void> {
    this.dispatch({ type: "CONSENT_SAVING" });
    const r = await this.api.consent();
    this.dispatch(r.ok ? { type: "CONSENT_SAVED" } : { type: "CONSENT_FAILED" });
  }

  private enter(): void {
    const s = this.model.state;
    if (s.kind === "loading") void this.load();
    if (s.kind === "starting" && s.error === null) void this.start();
    if (s.kind === "skip_today") void this.recordPostpone();
    if (s.kind === "completing" && !s.error) void this.complete();
    if (s.kind === "build" && !this.build) void this.buildProgram(s.from);
    if (s.kind === "part" && this.model.data.parts[s.index]?.kind === "gait") {
      // The walk's pain gate: a pain stop in a region the walk loads earlier in the check postpones
      // the walk (6 or more, sharp, a region not measured today for pain) or asks its pain first.
      if (!this.model.data.walkGated) {
        const gate = this.ctl?.walkGate(WALK_REGIONS) ?? { skip: false, ask: [] };
        this.dispatch({ type: "WALK_GATE", skip: gate.skip, ask: gate.ask });
        return;
      }
    }
    if (s.kind === "part") {
      const part = this.model.data.parts[s.index];
      if (part?.kind === "range") {
        const restFirst = this.restBeforeNext;
        this.restBeforeNext = false;
        this.controller().startBlock(part.block, this.now(), { restFirst });
      }
    }
  }

  private controller(): RomController {
    if (this.ctl) return this.ctl;
    const check = this.model.data.check!;
    const opts = this.opts;
    const leanBest = leanBestOf(check);
    const options: RomControllerOptions = {
      protocol: check.protocol,
      ...(leanBest ? { sideLeanBest: leanBest } : {}),
      painByRegion: this.model.data.today.painByRegion,
      intake: this.model.data.intake,
      get lang() {
        return opts.lang;
      },
      ...(this.opts.poseModel ? { poseModel: this.opts.poseModel } : {}),
      ...(this.opts.restSec !== undefined ? { restSec: this.opts.restSec } : {}),
      ...(this.opts.sitSeconds !== undefined ? { sitSeconds: this.opts.sitSeconds } : {}),
      ...(this.opts.stopRestSeconds !== undefined ? { stopRestSeconds: this.opts.stopRestSeconds } : {}),
    };
    this.ctl = new RomController(options);
    this.ctl.subscribe(() => this.pump());
    return this.ctl;
  }

  private async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await this.api.start(
      startBody(this.model.data, this.opts.device ?? { os: "unknown", browser: "unknown" }),
    );
    this.busy = false;
    if (r.ok) this.dispatch({ type: "START_OK", response: r.value });
    else if (r.error.kind === "http")
      this.dispatch({ type: "START_FAILED", kind: "http", code: r.error.code, body: r.error.body });
    else this.dispatch({ type: "START_FAILED", kind: "network" });
  }

  /** A yes to the worry question: the calm screen shows at once, the start call records the skip. */
  private async recordPostpone(): Promise<void> {
    if (this.model.data.check || this.busy) return;
    this.busy = true;
    // The walk is left out: after the worry question's yes the screen asks nothing else.
    const body = startBody(this.model.data, this.opts.device ?? { os: "unknown", browser: "unknown" });
    const r = await this.api.start({ ...body, include: { rom: true, gait: false } });
    this.busy = false;
    // The server's answer brings the lock's {when} line (409 POSTPONE); the local screen stays.
    if (!r.ok && r.error.kind === "http" && r.error.code === "POSTPONE")
      this.dispatch({ type: "START_FAILED", kind: "http", code: "POSTPONE", body: r.error.body });
  }

  private async complete(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Every saved movement reaches the server first: the complete call writes the rest as not reached.
    await this.flush();
    const check = this.model.data.check;
    const r = check && this.outbox.length === 0 ? await this.api.complete(check.id) : null;
    this.busy = false;
    if (r?.ok) this.walked = r.value.gait !== null;
    this.dispatch(r?.ok ? { type: "COMPLETED" } : { type: "COMPLETE_FAILED" });
  }

  /**
   * The program's build (D-032 item 3): the targeted week after the check, or the history's program.
   * A network failure is tried again twice; the program page then shows its own way on, and the server
   * reads a completed check as the end of the wait in any case.
   *
   * The animation's summary is set once, as the build starts: the animation plans its beats from it and
   * would start again on a new one. The week's exercises are known only when the build answers (after
   * the weekly AI, usually once the animation has ended), so the summary counts none (the animation's
   * fewest cards).
   */
  private async buildProgram(from: "check" | "history"): Promise<void> {
    // From the history: nothing measured and no walk, so the animation builds on the history.
    const summary = from === "check" ? this.summaryOf() : { joints: 0, walk: false, exercises: 0 };
    this.build = { done: false, summary };
    this.changed();
    for (let i = 0; i < 3; i++) {
      const r = from === "check" ? await this.api.programTargets() : await this.api.programHistory();
      if (r.ok || r.error.kind === "http") break;
    }
    this.build = { done: true, summary };
    this.changed();
  }

  /**
   * The build animation's summary after a check: the joints measured (a movement the server saved with
   * a value) and whether the check kept a walk.
   */
  private summaryOf(): BuildSummary {
    const items =
      this.model.data.check?.protocol.items.filter((i) => this.measuredKeys.has(itemKey(i))) ?? [];
    return { joints: jointsOf(items).length, walk: this.walked, exercises: 0 };
  }

  /** The controller's output: results to post, the coach's events, the local lines, the part's end. */
  pump(): void {
    const ctl = this.ctl;
    if (!ctl) return;
    for (const e of ctl.drain()) {
      if (e.kind === "save") {
        this.outbox.push({ item: e.item, result: e.result });
        void this.flush();
      } else if (e.kind === "bridge") for (const fn of this.bridgeListeners) fn(e.event);
      else {
        this.spoken = { line: e.line, severity: e.severity, at: this.now() };
        for (const fn of this.lineListeners) fn(this.spoken);
      }
    }
    const s = this.model.state;
    if (s.kind === "part" && this.model.data.parts[s.index]?.kind === "range" && ctl.current.kind === "end")
      this.dispatch({ type: "PART_DONE" });
    else this.changed();
  }

  /**
   * Posts the saved movements in order; resolves when the outbox is empty or a post failed on the
   * network (it stays queued for the next try). One sender at a time: a call while it runs waits for it.
   */
  flush(): Promise<void> {
    this.flushing ??= this.sendAll().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendAll(): Promise<void> {
    const check = this.model.data.check;
    if (!check) return;
    while (this.outbox.length) {
      const { item, result } = this.outbox[0];
      const r = await this.api.saveRom(check.id, result);
      if (r.ok) {
        this.grades.set(itemKey(item), r.value);
        if (result.value !== null) this.measuredKeys.add(itemKey(item));
      } else if (r.error.kind !== "http")
        return; // offline or a network error: try again later
      else {
        // An http refusal (a skipped item, already saved, a result out of bounds) will not change on a
        // retry: kept, not dropped silently.
        this.refused.push({ movementId: item.movementId, side: item.side, code: r.error.code ?? "http" });
      }
      this.outbox.shift();
      this.changed();
    }
  }

  /** Movements saved on the phone and not yet on the server. */
  get unsent(): number {
    return this.outbox.length;
  }

  private bridge(e: BridgeEvent): void {
    for (const fn of this.bridgeListeners) fn(e);
  }

  /** The answer to the walk's pain question (walk_pain): the region's pain now, before the walk. */
  answerWalkPain(value: number): void {
    const s = this.model.state;
    if (s.kind !== "walk_pain") return;
    this.ctl?.answerWalkPain(s.regions[s.k], value, this.now());
    this.dispatch({ type: "WALK_PAIN", value });
  }

  /**
   * The walk's score before (C-15: the rise of 2 counts from it): the highest pain now of the regions
   * a walk loads, from the day's answers and the re-asks; null when none was asked.
   */
  get walkBefore(): number | null {
    if (this.ctl) return this.ctl.walkGate(WALK_REGIONS).before;
    const day = this.model.data.today.painByRegion;
    const scores = WALK_REGIONS.map((r) => day[r]).filter((n): n is number => n !== undefined);
    return scores.length ? Math.max(...scores) : null;
  }

  /** The walk is done or not taken today: the next part. */
  gaitDone(): void {
    const s = this.model.state;
    if (s.kind === "part" && this.model.data.parts[s.index]?.kind === "gait")
      this.dispatch({ type: "PART_DONE" });
  }

  /** STOP outside a range part (the walk's step): the stop list with nothing to stop on the phone. */
  requestStop(preselect: CoachStopReason | null = null): void {
    const s = this.model.state;
    const range = s.kind === "part" && this.model.data.parts[s.index]?.kind === "range";
    if (range && this.ctl) this.ctl.requestStop(this.now(), preselect);
    else this.stopOutside = { preselect };
    this.changed();
  }

  /** The stop list is open (the controller's, or the walk's). */
  get stopListOpen(): boolean {
    return !!this.stopOutside || !!this.ctl?.stopList;
  }

  /**
   * The person's stop list answer: routed at once with the v1 rules (the server answers the same
   * route and stores the stop), then the range blocks or the walk go on, rest, or the check ends.
   */
  async chooseStop(option: StopOptionId): Promise<StopRoute | null> {
    const env = this.model.data.context?.env;
    const check = this.model.data.check;
    // One answer per stop list: a second tap after the list closed does nothing.
    if (!env || !this.stopListOpen) return null;
    const local = stopRoute(option, env);
    const item = this.ctl?.stopList?.item ?? null;
    const route: FocusStopRoute = {
      option: local.option,
      screen: local.screen,
      // The emergency screen carries v1's dysreflexia screen for a spinal cord injury, as v1's flow and
      // the server's stop route add it (O12 (1), D5-10).
      alsoShow:
        local.screen === "scr_emergency"
          ? [...new Set([...local.alsoShow, ...emergencyAlsoShow(env)])]
          : local.alsoShow,
      endsCheck: local.endsCheck,
      reason: local.reason,
      ...(local.then ? { then: local.then } : {}),
      afterRest: local.afterRest,
    };
    const t = this.now();
    if (this.ctl?.stopList) this.ctl.stopRouted(route, t);
    const outside = this.stopOutside;
    this.stopOutside = null;
    if (route.endsCheck) this.dispatch({ type: "CHECK_ENDED", route });
    else if (outside) {
      // The walk ends; the next part follows after a rest, or asks the pain first (v1 then).
      if (route.afterRest) this.restBeforeNext = true;
      if (route.then === "bt_pain_after") this.controller().reaskRegions(WALK_REGIONS, t);
      this.gaitDone();
    }
    // Bridge rule 1: the app shows the screen first, then the coach hears the red flag.
    if (route.screen) this.bridge({ p: 0, type: "red_flag", screen: route.screen, t });
    this.changed();
    if (check) {
      // The stop always reaches the server: it stores the movement's row, the dates and the locks.
      const ref = item ? { movementId: item.movementId, side: item.side } : null;
      for (let i = 0; i < 3; i++) {
        const r = await this.api.stop(check.id, option, ref);
        if (r.ok || r.error.kind === "http") break;
      }
    }
    return local;
  }
}
