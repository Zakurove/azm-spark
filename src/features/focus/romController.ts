/**
 * The range blocks of a focus check (product v7 contract B3, C-13, C-15, C-16, 2.6 and 2.11): one
 * controller for the whole check, which runs each range block's movements in protocol order with one
 * RomRunner per movement, and implements CoachHost for the range blocks. Pure, no DOM: the shell
 * (FocusApp) renders its view, feeds it the camera frames and the person's taps, posts what it saves,
 * and passes its bridge events to the coach.
 *
 * A block, step by step (each step has the C-16 kind the coach reads):
 *   block    the block's card: the position, the support and helper lines (confirm: «جاهز»)
 *   reask    the same joint re-ask (contract 2.6): after a pain stop on a movement, the next movement of
 *            the same region and side asks the pain question first (question); 6 or more skips the
 *            region's remaining movements (pain_today), else the answer is that movement's painBefore
 *   setup    the movement's card: the picture, the instructions, turn your other side (confirm)
 *   measure  the runner: calibrating, practice and attempts (active), its questions (question), the
 *            rest between attempts (timer); a pain stop is its own step (safety)
 *   result   the movement's result (info)
 *   rest     after a stop for tiredness or something else, the v1 minute (timer); also before a block's
 *            card when the walk before it stopped for tiredness
 *   sit      after the lying block, sit on the edge of the bed for a minute before standing (timer,
 *            rom-protocol 6 sit_before_stand, engine.sitBeforeStandSeconds)
 *   end      the block is done; the shell moves to the next part of the check
 * The stop list opens over any step (safety). STOP stops the movement at once and for good (v1 O43:
 * there is no way back into a stopped test); the stop list's answer is routed by the shell (the server
 * stores the stopped movement's not measured row) and given back with `stopRouted`.
 *
 * The coach never advances past a confirmation (C-16): next_step moves only a result card (info) or a
 * finished measurement, resume resumes only a pause the coach made, and every tool call is applied at
 * once and final (C-17). The app is authoritative: the coach's answers go through the same runner
 * methods as the buttons.
 */
import type { Lang } from "../../app/i18n";
import type {
  BridgeEvent,
  CoachHost,
  CoachStepKind,
  CoachStopReason,
  ToolArgs,
  ToolName,
  ToolResult,
} from "../../coach/types";
import { FeedbackGate, type GateMessage } from "../../engine/feedbackGate";
import { setupCheck, type SetupFrame, type SetupIssue } from "../../engine/quality";
import { romSetupConfig } from "../../engine/rom/quality";
import { RomRunner } from "../../engine/rom/runner";
import type {
  AnswerResult,
  AnswerSource,
  LimitCause,
  RomAnswer,
  RomEvent,
  RomHold,
  RomMeasureResult,
  RomPhase,
} from "../../engine/rom/types";
import type { Frame } from "../../engine/types";
import type { FeedEnv } from "../../engine/modes/types";
import { AXIAL_REGIONS, type RegionId } from "../../medical/body-map";
import { painStopRule } from "../../medical/pain-rule";
import type { Intake, Sex } from "../../medical/plan";
import {
  BLOCK_RUN_ORDER,
  PAIN_TODAY_SKIP_AT,
  type RomBlock,
  type RomProtocol,
  type RomProtocolItem,
  type RomReasonId,
} from "../../medical/rom-protocol";
import { gradeBand, gradeMeasurement, normFor } from "../../medical/rom-norms";
import type { RomFindingId } from "../../medical/rom-types";
import { movementDef, ROM_DATA } from "../../movements/rom";
import type { RomCopyKey, RomCueId } from "../../movements/rom/types";
import type { CheckCueId } from "../../movements/types";
import { instructionLines } from "./copy";

export type PoseModel = "lite" | "full";
export type Line = RomCueId | RomCopyKey | CheckCueId;
export type PausedBy = "coach" | "screen";

/** The v1 rest after a stop for tiredness or something else (SAFETY_TIMING.stopRestSec, check_rest_minute). */
export const STOP_REST_SECONDS = 60;
/** How much of the last frames the live setup check reads while the start pose is taken (v1: the last second). */
const SETUP_WINDOW_MS = 1000;

export interface RomControllerOptions {
  /** The check's protocol as the start answered it (skips and helpers applied). */
  protocol: RomProtocol;
  /** Today's pain per body map pain region (FocusToday.painByRegion). */
  painByRegion: Partial<Record<RegionId, number>>;
  /** The saved intake (sex and age): the typical value, the normal band, the grade and the cause question; null: none. */
  intake: (Intake & { sex: Sex }) | null;
  /** The language of the instruction text the coach can ask for (repeat_instructions). */
  lang: Lang;
  /** The camera's pose model at each movement's start (C-10: recorded per measurement). */
  poseModel?: () => PoseModel;
  /** Seconds between attempts (default the data's 5); the E2E fast timing passes less. */
  restSec?: number;
  /** The sit before stand minute (default engine.sitBeforeStandSeconds). */
  sitSeconds?: number;
  /** The rest after a stop for tiredness or something else (default the v1 minute). */
  stopRestSeconds?: number;
}

export type RomStep =
  | { kind: "idle" }
  | { kind: "block"; block: RomBlock; items: RomProtocolItem[]; helper: boolean }
  | { kind: "reask"; item: RomProtocolItem }
  | { kind: "setup"; item: RomProtocolItem; turnSide: boolean }
  | { kind: "measure"; item: RomProtocolItem }
  | { kind: "pain_stop"; item: RomProtocolItem; result: RomMeasureResult }
  | { kind: "result"; item: RomProtocolItem; result: RomMeasureResult }
  /** `then: "block"`: a rest before the block's card (the walk before it stopped for tiredness). */
  | { kind: "rest"; until: number; total: number; then?: "block" }
  | { kind: "sit"; until: number; total: number }
  | { kind: "end"; block: RomBlock }
  | { kind: "ended" };

/** How a block starts. */
export interface BlockStart {
  /** The v1 minute's rest before the card (a stop for tiredness or something else just before). */
  restFirst?: boolean;
}

/** What the shell does with the controller's output. */
export type RomControllerEvent =
  /** POST /api/focus/:id/rom (never for a movement the stop list stopped: the server stored its row). */
  | { kind: "save"; item: RomProtocolItem; result: RomMeasureResult }
  /** For the coach (useCoach.push). */
  | { kind: "bridge"; event: BridgeEvent }
  /** A local voice pack line (and its caption) to play now. */
  | { kind: "line"; line: Line; severity: "info" | "warn" | "safety" };

/** The stop list over a step: the option the coach preselected, and the movement the stop names. */
export interface StopListState {
  preselect: CoachStopReason | null;
  item: RomProtocolItem | null;
}

/** What a stop list answer does to the range blocks (the v1 StopRoute the shell received). */
export interface StopOutcome {
  endsCheck: boolean;
  /** v1 then: bt_pain_after is the same joint re-ask in v7. */
  then?: string;
  afterRest: boolean;
}

/** The dial of a movement: the typical value and the normal band for the person (rom-protocol 1.1 step 3). */
export interface DialNorm {
  typical: number | null;
  /** within normal from (flexion and signed movements) or up to (lack movements); null without a graded norm */
  withinFrom: number | null;
  withinUpTo: number | null;
}

export const itemKey = (i: Pick<RomProtocolItem, "movementId" | "side">) => `${i.movementId}:${i.side}`;
/**
 * The joint of the same joint re-ask and of the pain now: the body map cell (rom-protocol 6
 * pain_during, «any other movement of the same joint»). The neck and the back are one cell whatever
 * the bend's direction, so a pain stop on a side bend or the forward bend asks before every other
 * movement of that spine region; a limb region is its region and side (rom-profile's profileCell,
 * kept out of this chunk).
 */
const jointKey = (i: Pick<RomProtocolItem, "region" | "side">): string =>
  AXIAL_REGIONS.includes(i.region) ? `${i.region}:axial` : `${i.region}:${i.side}`;

/** The C-16 kind of each runner phase in a measurement step. */
const PHASE_KIND: Record<RomPhase, CoachStepKind> = {
  idle: "active",
  calibrating: "active",
  practice: "active",
  attempt: "active",
  ask_can_move: "question",
  ask_max: "question",
  ask_pain: "question",
  ask_cause: "question",
  rest: "timer",
  paused: "active",
  stopped: "safety",
  done: "active",
};

/** The runner's own answer reasons as tool results (B1-14: stopped is safety_stop). */
function toolReason(r: AnswerResult["reason"]): ToolResult["reason"] {
  return r === "stopped" ? "safety_stop" : r;
}

export class RomController implements CoachHost {
  readonly block = "rom" as const;
  private readonly opts: RomControllerOptions;
  private readonly items: RomProtocolItem[];
  private stepNow: RomStep = { kind: "idle" };
  private blockNow: RomBlock | null = null;
  private queue: RomProtocolItem[] = [];
  private runner: RomRunner | null = null;
  private readonly results = new Map<string, RomMeasureResult>();
  /** Items the stop list stopped (the server stored their row). */
  private readonly stoppedByList = new Set<string>();
  /** Joints (body map cells, jointKey) whose next movement asks the pain question first. */
  private readonly reask = new Set<string>();
  /** The pain before the next movement of a joint, after a re-ask. */
  private readonly painNow = new Map<string, number>();
  private readonly skippedRegions = new Set<RegionId>();
  /** Regions with a pain report of 6 or more, or a sharp pain, during the range blocks today. */
  private readonly painHigh = new Set<RegionId>();
  private lastMeasured: RomProtocolItem | null = null;
  private sink: RomControllerEvent[] = [];
  private listeners = new Set<() => void>();
  private stopListNow: StopListState | null = null;
  /** The joint a stop for pain re-asks: the stopped movement's, else the one on the screen or next. */
  private stopJoint: RomProtocolItem | null = null;
  /** The instruction card over the measurement (the coach's repeat_instructions, or the screen). */
  private instructionsShown = false;
  private pausedBy: PausedBy | null = null;
  private timerLeftMs: number | null = null;
  /** A safety stop happened in the current step: the coach may not resume anything. */
  private safetyStopped = false;
  private readonly gate = new FeedbackGate();
  private captionNow: GateMessage | null = null;
  private liveDeg: number | null = null;
  private holdRing = { anchor: null as number | null, since: 0, start: null as number | null, progress: 0 };
  private setupFrames: SetupFrame[] = [];
  private setupIssueNow: SetupIssue | null = null;
  private attemptNow = 0;
  private validNow = 0;
  /** The value of the last valid attempt (the coach's confirm_max result). */
  private lastValid: number | null = null;
  /** The runner's rest between attempts: when it ends (the screen's ring). */
  private restUntil: { until: number; total: number } | null = null;
  private lastT = 0;

  constructor(opts: RomControllerOptions) {
    this.opts = opts;
    this.items = opts.protocol.items.map((i) => ({ ...i }));
  }

  /* ------------------------------------------------------------- the blocks */

  /** The range blocks with a movement that runs today, in the run order of C-13 (seated, standing, lying). */
  blocks(): RomBlock[] {
    return BLOCK_RUN_ORDER.filter((b) => this.items.some((i) => i.block === b && !i.skipped));
  }

  /**
   * Opens a block's card (confirm). The movements run in protocol order. A region the same joint
   * re-ask skipped earlier today (pain_today) is not measured in this block either: its movements are
   * saved as not measured at once, and a block left with nothing to measure ends without its card.
   */
  startBlock(block: RomBlock, t: number, how: BlockStart = {}): void {
    this.blockNow = block;
    this.lastT = t;
    this.runner = null;
    this.safetyStopped = false;
    this.pausedBy = null;
    this.timerLeftMs = null;
    const runs = this.items.filter((i) => i.block === block && !i.skipped);
    for (const item of runs)
      if (this.skippedRegions.has(item.region) && !this.results.has(itemKey(item)))
        this.saveSkipped(item, "pain_today", t);
    this.queue = runs.filter((i) => !this.skippedRegions.has(i.region));
    if (!this.queue.length) {
      this.go({ kind: "end", block });
      return;
    }
    if (how.restFirst) {
      const total = (this.opts.stopRestSeconds ?? STOP_REST_SECONDS) * 1000;
      this.go({ kind: "rest", until: t + total, total, then: "block" });
      return;
    }
    this.showBlock(t);
  }

  /**
   * The joints of these regions ask the pain question before their next movement (after the walk
   * stopped for pain: the walk loads every leg region and the back, contract 2.5's walk regions).
   */
  reaskRegions(regions: readonly RegionId[], t: number): void {
    this.lastT = t;
    for (const item of this.items)
      if (regions.includes(item.region) && !item.skipped && !this.results.has(itemKey(item)))
        this.reask.add(jointKey(item));
  }

  private showBlock(t: number): void {
    const block = this.blockNow ?? "seated";
    this.go({
      kind: "block",
      block,
      items: [...this.queue],
      helper: this.queue.some((i) => i.helperRequired),
    });
    this.bridge({ p: 3, type: "step_start", label: `block_${block}`, t });
  }

  /* ---------------------------------------------------------------- the view */

  /** The step now. */
  get current(): RomStep {
    return this.stepNow;
  }

  /** The runner's phase in a measurement step, else null. */
  get phase(): RomPhase | null {
    return this.stepNow.kind === "measure" && this.runner ? this.runner.phase : null;
  }

  /** The hold the maximum question is about. */
  get hold(): RomHold | null {
    return this.runner?.currentHold ?? null;
  }

  /** The dial's angle (the movement's convention), the last frame that saw the joint. */
  get live(): number | null {
    return this.liveDeg;
  }

  /** The hold ring, 0 to 1: how long the angle has stayed still near its end range (a picture only). */
  get holdProgress(): number {
    return this.holdRing.progress;
  }

  /** The attempt now (0 the practice, 1 to 3 scored) and the valid scored attempts so far. */
  get attempt(): { index: number; valid: number } {
    return { index: this.attemptNow, valid: this.validNow };
  }

  /** The one caption line of the camera (a correction, kept by the FeedbackGate), or null. */
  get caption(): Line | null {
    return (this.captionNow?.id as Line | undefined) ?? null;
  }

  /** The first live setup issue while the start pose is taken (calibrating), or null. */
  get setupIssue(): SetupIssue | null {
    return this.setupIssueNow;
  }

  get stopList(): StopListState | null {
    return this.stopListNow;
  }

  get paused(): PausedBy | null {
    return this.pausedBy;
  }

  /** The instruction card is open over the measurement. */
  get instructionsOpen(): boolean {
    return this.instructionsShown;
  }

  /** Opens or closes the instruction card (a measurement only; the setup card is the instructions). */
  showInstructions(open: boolean): void {
    const next = open && this.stepNow.kind === "measure";
    if (next === this.instructionsShown) return;
    this.instructionsShown = next;
    this.changed();
  }

  /** The milliseconds left of the runner's rest between attempts at `t`. */
  restLeft(t: number): number {
    return this.restUntil ? Math.max(0, this.restUntil.until - t) : 0;
  }

  /** The length of the runner's rest between attempts. */
  restTotal(): number {
    return (
      this.restUntil?.total ?? (this.opts.restSec ?? ROM_DATA.engine.restBetweenAttemptsSeconds.min) * 1000
    );
  }

  /** The milliseconds left of a timer step (rest or sit) at `t`, its pause kept. */
  timerLeft(t: number): number {
    const s = this.stepNow;
    if (s.kind !== "rest" && s.kind !== "sit") return 0;
    return this.timerLeftMs ?? Math.max(0, s.until - t);
  }

  /** Every result of the check so far, by movement and side. */
  resultOf(item: Pick<RomProtocolItem, "movementId" | "side">): RomMeasureResult | null {
    return this.results.get(itemKey(item)) ?? null;
  }

  /**
   * The typical value and the normal band of a movement for this person (the dial, the result card
   * and the coach), from the graded norm of the item's own position only: a position without one has
   * neither (rom-protocol 3.12 and 4.3 rule 7: «not graded (no matched norm): value and progress
   * only»), never another position's.
   */
  norm(item: RomProtocolItem): DialNorm {
    const p = this.opts.intake;
    if (!p) return { typical: null, withinFrom: null, withinUpTo: null };
    const side = item.side === "none" ? undefined : item.side;
    const pick = item.graded ? normFor(item.movementId, item.position, p.sex, p.age, side) : null;
    if (!pick || !pick.norm.graded) return { typical: null, withinFrom: null, withinUpTo: null };
    const typical = Math.round(pick.row.mean);
    if (!pick.row.limits) return { typical, withinFrom: null, withinUpTo: null };
    const band = gradeBand(movementDef(item.movementId), pick);
    return band.kind === "lack"
      ? { typical, withinFrom: null, withinUpTo: band.withinUpTo }
      : { typical, withinFrom: band.withinFrom, withinUpTo: null };
  }

  /** Subscribes to every change of the view; returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The output since the last call: what to save, what to tell the coach, what to say. */
  drain(): RomControllerEvent[] {
    return this.sink.splice(0, this.sink.length);
  }

  /* ----------------------------------------------------- the person's actions */

  /** «جاهز» on a confirm card: the block's card, or a movement's setup card. */
  ready(t: number): boolean {
    this.lastT = t;
    if (this.stopListNow) return false;
    const s = this.stepNow;
    if (s.kind === "block") {
      this.nextItem(t);
      return true;
    }
    if (s.kind === "setup") {
      this.startMeasure(s.item, t);
      return true;
    }
    return false;
  }

  /**
   * The answer to the same joint re-ask (0 to 10). A sudden sharp pain (the coach's mark_pain) stops
   * like a score of 6 (C-15: a sharp pain stops at any level).
   */
  answerReask(level: number, t: number, sharp = false): boolean {
    const s = this.stepNow;
    if (s.kind !== "reask" || this.stopListNow) return false;
    this.lastT = t;
    const score = Math.max(0, Math.min(10, Math.round(level)));
    this.reask.delete(jointKey(s.item));
    if (score >= PAIN_TODAY_SKIP_AT || sharp) {
      // rom-protocol 6 pain_today: «Region not measured today»: this movement and the region's others.
      this.painHigh.add(s.item.region);
      this.saveSkipped(s.item, "pain_today", t);
      this.skipRegion(s.item.region, "pain_today", t);
      this.nextItem(t);
      return true;
    }
    this.painNow.set(jointKey(s.item), score);
    this.toSetup(s.item, t);
    return true;
  }

  /** A camera frame (measure steps only; other steps ignore it). */
  feed(frame: Frame, env: FeedEnv = {}): void {
    const s = this.stepNow;
    if (s.kind !== "measure" || !this.runner || this.stopListNow) return;
    this.lastT = frame.t;
    const phase = this.runner.phase;
    if (phase === "calibrating") this.watchSetup(s.item, frame);
    else if (this.setupIssueNow !== null) this.setupIssueNow = null;
    const events = this.runner.feed(frame, env);
    this.take(s.item, events, frame.t, true);
  }

  /** Time passes without a frame (timers): ends a rest, the sit before stand minute. */
  tick(t: number): void {
    this.lastT = t;
    const s = this.stepNow;
    if (
      (s.kind === "rest" || s.kind === "sit") &&
      this.pausedBy === null &&
      !this.stopListNow &&
      t >= s.until
    ) {
      if (s.kind === "sit") this.go({ kind: "end", block: this.blockNow ?? "lying" });
      else if (s.then === "block") this.showBlock(t);
      else this.nextItem(t);
      return;
    }
    // The caption leaves on time even without frames.
    if (this.captionNow) {
      const out = this.gate.step(t, null, []);
      if ((out.shown?.id ?? null) !== this.captionNow.id) {
        this.captionNow = out.shown;
        this.changed();
      }
    }
  }

  answerCanMove(canMove: boolean, t: number): boolean {
    if (!this.runner || this.phase !== "ask_can_move" || this.stopListNow) return false;
    const item = this.currentItem()!;
    this.take(item, this.runner.answerCanMove(canMove, t), t);
    return true;
  }

  answerMax(answer: RomAnswer, source: AnswerSource, t: number): AnswerResult {
    const hold = this.runner?.currentHold;
    if (!this.runner || this.stopListNow) return { accepted: false, reason: "wrong_phase", events: [] };
    const res = this.runner.answerMax(hold?.holdId ?? "", answer, source, t);
    this.take(this.currentItem()!, res.events, t);
    return res;
  }

  answerPain(level: number, sharp: boolean, source: AnswerSource, t: number) {
    if (!this.runner || this.stopListNow)
      return { accepted: false, reason: "wrong_phase" as const, events: [], action: "continue" as const };
    const item = this.currentItem()!;
    const res = this.runner.answerPain(level, sharp, source, t);
    if (res.accepted && (level >= PAIN_TODAY_SKIP_AT || sharp)) this.painHigh.add(item.region);
    this.take(item, res.events, t);
    return res;
  }

  /**
   * The walk's pain gate after the range blocks so far (gait-rules eligibility.today: «leg, hip or
   * back pain 6 or more today: postpone the gait test», the one shared rule of C-15; rom-protocol 6
   * pain_during: ask before any other movement of the same joint). For the regions a walk loads:
   * skip when one was not measured today for pain (pain_today) or had a pain of 6 or more or a sharp
   * pain; else ask the pain first in each region whose next movement would re-ask; `before` is the
   * walk's score before, the highest pain now of those regions (the day's answers, then the re-asks).
   */
  walkGate(regions: readonly RegionId[]): { skip: boolean; ask: RegionId[]; before: number | null } {
    const skip = regions.some((r) => this.skippedRegions.has(r) || this.painHigh.has(r));
    const asking = new Set([...this.reask].map((k) => k.slice(0, k.indexOf(":")) as RegionId));
    const ask = skip ? [] : regions.filter((r) => asking.has(r));
    const scores: number[] = [];
    for (const r of regions) {
      const day = this.opts.painByRegion[r];
      const now = [...this.painNow].filter(([k]) => k.startsWith(`${r}:`)).map(([, v]) => v);
      if (now.length) scores.push(Math.max(...now));
      else if (day !== undefined) scores.push(day);
    }
    return { skip, ask, before: scores.length ? Math.max(...scores) : null };
  }

  /**
   * The walk's re-ask (walkGate's `ask`), answered before the walk: the region's pain now for its
   * joints' next movements; 6 or more (or a sharp pain) skips the region today (pain_today), its
   * later movements saved as not measured, and the walk with it.
   */
  answerWalkPain(region: RegionId, level: number, t: number, sharp = false): void {
    this.lastT = t;
    const score = Math.max(0, Math.min(10, Math.round(level)));
    for (const k of [...this.reask]) if (k.startsWith(`${region}:`)) this.reask.delete(k);
    const cells = new Set(this.items.filter((i) => i.region === region).map(jointKey));
    for (const cell of cells) this.painNow.set(cell, score);
    if (score >= PAIN_TODAY_SKIP_AT || sharp) {
      this.painHigh.add(region);
      this.skipRegion(region, "pain_today", t);
    }
    this.changed();
  }

  answerCause(cause: LimitCause, source: AnswerSource, t: number): AnswerResult {
    if (!this.runner || this.stopListNow) return { accepted: false, reason: "wrong_phase", events: [] };
    const res = this.runner.answerCause(cause, source, t);
    this.take(this.currentItem()!, res.events, t);
    return res;
  }

  keepReaching(t: number): AnswerResult {
    if (!this.runner || this.stopListNow) return { accepted: false, reason: "wrong_phase", events: [] };
    const res = this.runner.keepReaching(t);
    this.take(this.currentItem()!, res.events, t);
    return res;
  }

  /** Pause from the screen or the coach (a measurement or a timer). */
  pause(by: PausedBy, t: number): boolean {
    const kind = this.kindNow();
    if (this.pausedBy !== null || this.stopListNow || (kind !== "active" && kind !== "timer")) return false;
    const s = this.stepNow;
    if (s.kind === "measure" && this.runner) {
      const events = this.runner.pause(t);
      if (!events.length) return false;
      this.take(s.item, events, t);
    } else if (s.kind === "rest" || s.kind === "sit") {
      this.timerLeftMs = Math.max(0, s.until - t);
    } else return false;
    this.pausedBy = by;
    this.changed();
    return true;
  }

  /** Resume: the screen resumes any pause; the coach only its own (C-16). */
  resume(by: PausedBy, t: number): ToolResult {
    if (this.safetyStopped || this.stopListNow) return { accepted: false, reason: "safety_stop" };
    // D's host rules (hostRules.ts resumeRefusal): no pause to end is not_allowed.
    if (this.pausedBy === null) return { accepted: false, reason: "not_allowed" };
    if (by === "coach" && this.pausedBy === "screen") return { accepted: false, reason: "paused_on_screen" };
    const s = this.stepNow;
    if (s.kind === "measure" && this.runner) {
      const res = this.runner.resume(t);
      if (!res.accepted) return { accepted: false, reason: toolReason(res.reason) };
      this.pausedBy = null;
      this.take(s.item, res.events, t);
    } else if (s.kind === "rest" || s.kind === "sit") {
      const left = this.timerLeftMs ?? 0;
      this.timerLeftMs = null;
      this.pausedBy = null;
      this.go({ ...s, until: t + left });
    } else return { accepted: false, reason: "wrong_phase" };
    this.changed();
    return { accepted: true };
  }

  /** «التالي» on a result card (info), or after a finished measurement. */
  next(t: number): boolean {
    if (this.stopListNow) return false;
    this.lastT = t;
    const s = this.stepNow;
    if (s.kind === "result") {
      this.nextItem(t);
      return true;
    }
    if (s.kind === "measure" && this.runner?.done) {
      this.finishMeasure(s.item, t);
      return true;
    }
    return false;
  }

  /** «متابعة» after a pain stop (safety): the movement's result card follows. */
  acknowledge(t: number): boolean {
    const s = this.stepNow;
    if (s.kind !== "pain_stop" || this.stopListNow) return false;
    this.lastT = t;
    this.go({ kind: "result", item: s.item, result: s.result });
    return true;
  }

  /**
   * STOP (the person, or the coach's stop tool): the movement stops at once and is not measured
   * again today (v1 O43); the stop list opens, with the coach's reason preselected.
   */
  requestStop(t: number, preselect: CoachStopReason | null = null): void {
    this.lastT = t;
    if (this.stopListNow) {
      if (preselect) this.stopListNow = { ...this.stopListNow, preselect };
      this.changed();
      return;
    }
    const s = this.stepNow;
    let item: RomProtocolItem | null = null;
    if (s.kind === "measure" && this.runner) {
      // The movement stops for good and keeps no value: the server stores its not measured row with
      // the stop's reason (v1 resultOnStop), so nothing is saved from here.
      item = s.item;
      const r = this.runner;
      this.runner = null;
      if (!r.done && r.phase !== "stopped") r.stop("user_stop", t);
      this.liveDeg = null;
      this.captionNow = null;
    } else if (s.kind === "setup" || s.kind === "reask") item = s.item;
    // A stop for pain re-asks the stopped movement's joint, else the one on the screen, else the next.
    this.stopJoint =
      item ??
      (s.kind === "result" || s.kind === "pain_stop" ? s.item : null) ??
      this.queue[0] ??
      this.lastMeasured;
    this.timerLeftMs = s.kind === "rest" || s.kind === "sit" ? Math.max(0, s.until - t) : this.timerLeftMs;
    this.stopListNow = { preselect, item };
    this.safetyStopped = true;
    this.bridge({ p: 0, type: "safety_stop", reason: "user_stop", t });
    this.changed();
  }

  /**
   * The stop list's answer, routed by the shell (v1 stopRoute, the server's stop route). The stopped
   * movement keeps no value; a pain stop (bt_pain_after in v1) is the same joint re-ask here; a rest
   * follows a stop for tiredness or something else; a stop that ends the check ends the range blocks.
   */
  stopRouted(outcome: StopOutcome, t: number): void {
    const list = this.stopListNow;
    if (!list) return;
    this.lastT = t;
    this.stopListNow = null;
    const item = list.item;
    if (item) {
      this.stoppedByList.add(itemKey(item));
      this.queue = this.queue.filter((i) => itemKey(i) !== itemKey(item));
    }
    // v1 then bt_pain_after is the same joint re-ask in v7 (contract 2.6).
    if (outcome.then === "bt_pain_after" && this.stopJoint) this.reask.add(jointKey(this.stopJoint));
    this.stopJoint = null;
    if (outcome.endsCheck) {
      this.runner = null;
      this.go({ kind: "ended" });
      return;
    }
    const s = this.stepNow;
    if (outcome.afterRest) {
      // The person answered the stop list: the rest is a new timer step the coach may pause (it only
      // lengthens the rest); the stopped movement never resumes, and the next one waits for «جاهز».
      const total = (this.opts.stopRestSeconds ?? STOP_REST_SECONDS) * 1000;
      this.timerLeftMs = null;
      this.safetyStopped = false;
      this.pausedBy = null;
      this.go({ kind: "rest", until: t + total, total });
      return;
    }
    if (item) {
      this.nextItem(t);
      return;
    }
    // Nothing was running: the step goes on where it was (a timer keeps its time; a sit before stand
    // minute always runs to its end, so a standing test never follows a lying test directly).
    this.safetyStopped = false;
    if ((s.kind === "rest" || s.kind === "sit") && this.pausedBy === null) {
      const left = this.timerLeftMs ?? Math.max(0, s.until - t);
      this.timerLeftMs = null;
      this.go({ ...s, until: t + left });
      return;
    }
    this.changed();
  }

  /* -------------------------------------------------------------- CoachHost */

  /** The kind of the step now (C-16) and whether an active step has finished. */
  step(): { kind: CoachStepKind; finished: boolean } {
    return { kind: this.kindNow(), finished: this.stepNow.kind === "measure" && !!this.runner?.done };
  }

  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    try {
      return this.tool(name, args as ToolArgs[ToolName], this.lastT);
    } catch {
      return { accepted: false, reason: "invalid_args" };
    }
  }

  snapshot(): string {
    const s = this.stepNow;
    const parts = [`block=${this.blockNow ?? "none"}`, `step=${s.kind}`];
    if ("item" in s) parts.push(`movement=${s.item.movementId}`, `side=${s.item.side}`);
    const phase = this.phase;
    if (phase) parts.push(`phase=${phase}`, `attempt=${this.attemptNow}`);
    if (this.stopListNow) parts.push("stop_list=open");
    if (this.pausedBy) parts.push(`paused=${this.pausedBy}`);
    parts.push(`done=${this.results.size + this.stoppedByList.size}`);
    return parts.join(" ");
  }

  /* --------------------------------------------------------------- private */

  private kindNow(): CoachStepKind {
    if (this.stopListNow) return "safety";
    const s = this.stepNow;
    switch (s.kind) {
      case "block":
      case "setup":
        return "confirm";
      case "reask":
        return "question";
      case "measure":
        return this.runner ? PHASE_KIND[this.runner.phase] : "active";
      case "pain_stop":
        return "safety";
      case "rest":
      case "sit":
        return "timer";
      case "result":
      case "end":
      case "idle":
      case "ended":
        return "info";
    }
  }

  private tool(name: ToolName, args: ToolArgs[ToolName], t: number): ToolResult {
    const s = this.stepNow;
    const item = this.currentItem();
    switch (name) {
      case "confirm_max": {
        const a = args as ToolArgs["confirm_max"];
        if (this.stopListNow || this.safetyStopped) return { accepted: false, reason: "safety_stop" };
        if (!this.runner || s.kind !== "measure") return { accepted: false, reason: "wrong_phase" };
        // An answer about another movement or side belongs to an older question (D's reference host).
        if (!item || a.movement !== item.movementId || a.side !== item.side)
          return { accepted: false, reason: "stale_hold" };
        const phase = this.runner.phase;
        if (phase === "practice" || phase === "attempt" || phase === "calibrating")
          // Early answer: never buffered (a yes before the hold cannot be tied to a value).
          return { accepted: false, reason: "wrong_phase", say: "hold_still" };
        const held = this.runner.currentHold?.deg ?? null;
        this.lastValid = null;
        const res = this.answerMax(a.answer, "voice", t);
        if (!res.accepted) return { accepted: false, reason: toolReason(res.reason) };
        // Recorded now only with yes and a value that passed its quality gate; it hurts records after
        // the pain answer. The hold's degrees go back with every answer.
        const recorded = a.answer === "yes" && this.lastValid !== null;
        return {
          accepted: true,
          say: a.answer === "yes" ? "recorded" : a.answer === "not_yet" ? "keep_going" : "pain_ask",
          data: { recorded, deg: recorded ? this.lastValid : held },
        };
      }
      case "answer_can_move": {
        const a = args as ToolArgs["answer_can_move"];
        if (this.stopListNow || this.safetyStopped) return { accepted: false, reason: "safety_stop" };
        if (this.phase !== "ask_can_move") return { accepted: false, reason: "wrong_phase" };
        if (!item || a.movement !== item.movementId || a.side !== item.side)
          return { accepted: false, reason: "stale_hold" };
        this.answerCanMove(a.canMove, t);
        return { accepted: true, say: a.canMove ? "lets_begin" : "not_today" };
      }
      case "keep_reaching": {
        if (this.stopListNow || this.safetyStopped) return { accepted: false, reason: "safety_stop" };
        if (!this.runner) return { accepted: false, reason: "wrong_phase" };
        const res = this.keepReaching(t);
        return res.accepted
          ? { accepted: true, say: "keep_going" }
          : { accepted: false, reason: toolReason(res.reason) };
      }
      case "mark_pain": {
        const a = args as ToolArgs["mark_pain"];
        return this.markPain(a.level, a.sharp === true, t);
      }
      case "set_limit_cause": {
        const a = args as ToolArgs["set_limit_cause"];
        if (this.stopListNow || this.safetyStopped) return { accepted: false, reason: "safety_stop" };
        if (this.phase !== "ask_cause") return { accepted: false, reason: "wrong_phase" };
        const res = this.answerCause(a.cause, "voice", t);
        return res.accepted
          ? { accepted: true, say: "recorded" }
          : { accepted: false, reason: toolReason(res.reason) };
      }
      case "pause": {
        if (this.safetyStopped || this.stopListNow) return { accepted: false, reason: "safety_stop" };
        const kind = this.kindNow();
        if (kind !== "active" && kind !== "timer") return { accepted: false, reason: "not_allowed" };
        // D's host rules (pauseRefusal): a step already paused is not_allowed.
        return this.pause("coach", t) ? { accepted: true } : { accepted: false, reason: "not_allowed" };
      }
      case "resume":
        return this.resume("coach", t);
      case "stop": {
        const a = args as ToolArgs["stop"];
        this.requestStop(t, a.reason);
        // The person confirms the reason with a tap on the stop list (C-7).
        return { accepted: true, say: "tap_to_confirm", data: { preselected: a.reason } };
      }
      case "next_step": {
        const { kind, finished } = this.step();
        if (kind === "info" && s.kind === "result") {
          this.next(t);
          return { accepted: true };
        }
        if (kind === "active" && finished) {
          this.next(t);
          return { accepted: true };
        }
        if (kind === "confirm" || kind === "question" || kind === "timer" || kind === "safety")
          return { accepted: false, reason: "not_allowed", say: "tap_to_confirm" };
        return { accepted: false, reason: "not_allowed" };
      }
      case "repeat_instructions": {
        const shown = "item" in s ? s.item : (this.queue[0] ?? null);
        const text = shown
          ? instructionLines(shown.movementId, shown.side, shown.position, this.opts.lang).join(" ")
          : "";
        // 2.11: the instruction card shows (over a measurement; a setup card already is one).
        this.showInstructions(true);
        return { accepted: true, data: { text } };
      }
    }
  }

  /**
   * mark_pain at any step (2.11 host table, C-15): during a movement the runner's pain question and
   * rule; on the re-ask its answer; between movements the rule against the next movement's score
   * before, a stop making that joint's next movement ask first.
   */
  private markPain(level: number, sharp: boolean, t: number): ToolResult {
    if (!Number.isInteger(level) || level < 0 || level > 10)
      return { accepted: false, reason: "invalid_args" };
    const s = this.stepNow;
    if (s.kind === "reask") {
      this.answerReask(level, t, sharp);
      const stop = level >= PAIN_TODAY_SKIP_AT || sharp;
      return {
        accepted: true,
        say: stop ? "pain_stop" : "lets_begin",
        data: { action: stop ? "stop_movement" : "continue" },
      };
    }
    if (s.kind === "measure" && this.runner && this.runner.phase !== "stopped" && !this.runner.done) {
      const res = this.answerPain(level, sharp, "voice", t);
      if (!res.accepted) return { accepted: false, reason: toolReason(res.reason) };
      return {
        accepted: true,
        ...(res.action === "stop_movement" ? { say: "pain_stop" } : {}),
        data: { action: res.action },
      };
    }
    // Between movements: the rule against the score before the next movement of the joint.
    const near = "item" in s ? s.item : (this.queue[0] ?? this.lastMeasured);
    if (!near) return { accepted: true, data: { action: "continue" } };
    const rule = painStopRule(level, sharp, this.painBefore(near));
    if (rule.stop) {
      this.reask.add(jointKey(near));
      if (level >= PAIN_TODAY_SKIP_AT || sharp) this.painHigh.add(near.region);
      if (s.kind === "setup") {
        // The movement about to start asks first.
        this.go({ kind: "reask", item: s.item });
        this.bridge({ p: 1, type: "ask_pain", movement: s.item.movementId, side: s.item.side, t });
      }
      return { accepted: true, say: "pain_stop", data: { action: "stop_movement" } };
    }
    return { accepted: true, data: { action: "continue" } };
  }

  private currentItem(): RomProtocolItem | null {
    const s = this.stepNow;
    return "item" in s ? s.item : null;
  }

  private painBefore(item: RomProtocolItem): number | null {
    return this.painNow.get(jointKey(item)) ?? this.opts.painByRegion[item.region] ?? null;
  }

  /** The next movement of the block: a re-ask first where a pain stop asks for one, else its setup card. */
  private nextItem(t: number): void {
    this.runner = null;
    this.safetyStopped = false;
    this.pausedBy = null;
    this.timerLeftMs = null;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      if (this.skippedRegions.has(item.region)) {
        this.saveSkipped(item, "pain_today", t);
        continue;
      }
      if (this.reask.has(jointKey(item))) {
        this.go({ kind: "reask", item });
        this.bridge({ p: 1, type: "ask_pain", movement: item.movementId, side: item.side, t });
        return;
      }
      this.toSetup(item, t);
      return;
    }
    // The block is done: after the lying block, the sit before stand minute.
    const ranLying =
      this.blockNow === "lying" &&
      this.items.some(
        (i) =>
          i.block === "lying" &&
          !i.skipped &&
          (this.results.has(itemKey(i)) || this.stoppedByList.has(itemKey(i))),
      );
    if (this.blockNow === "lying" && this.opts.protocol.sitBeforeStand && ranLying) {
      const total = (this.opts.sitSeconds ?? ROM_DATA.engine.sitBeforeStandSeconds) * 1000;
      this.go({ kind: "sit", until: t + total, total });
      this.line("sit_before_stand", "info");
      return;
    }
    this.go({ kind: "end", block: this.blockNow ?? "seated" });
  }

  private toSetup(item: RomProtocolItem, t: number): void {
    const prev = this.lastMeasured;
    const def = movementDef(item.movementId);
    // rom-protocol turn_side: the camera side changes between two side view movements of a limb.
    const turnSide =
      !!prev &&
      def.view === "side" &&
      movementDef(prev.movementId).view === "side" &&
      prev.side !== "none" &&
      item.side !== "none" &&
      prev.side !== item.side;
    this.go({ kind: "setup", item, turnSide });
    this.bridge({ p: 3, type: "step_start", label: "setup", movement: item.movementId, side: item.side, t });
  }

  private startMeasure(item: RomProtocolItem, t: number): void {
    const def = movementDef(item.movementId);
    const norm = this.norm(item);
    const askCauseBelow = def.kind === "lack" ? norm.withinUpTo : norm.withinFrom;
    this.runner = new RomRunner({
      item,
      def,
      painBefore: this.painBefore(item),
      askCauseBelow,
      poseModel: this.opts.poseModel?.() ?? "full",
      ...(this.opts.restSec !== undefined ? { restSec: this.opts.restSec } : {}),
    });
    this.lastMeasured = item;
    this.liveDeg = null;
    this.attemptNow = 0;
    this.validNow = 0;
    this.captionNow = null;
    this.setupFrames = [];
    this.setupIssueNow = null;
    this.resetRing(null);
    this.go({ kind: "measure", item });
    this.bridge({
      p: 3,
      type: "step_start",
      label: "measure",
      movement: item.movementId,
      side: item.side,
      t,
    });
    this.take(item, this.runner.start(t), t);
  }

  /** A movement the region's pain skips: its not measured result is saved for the record. */
  private saveSkipped(item: RomProtocolItem, reason: RomReasonId, t: number): void {
    const r = new RomRunner({
      item: { ...item, skipped: reason },
      def: movementDef(item.movementId),
      painBefore: this.painBefore(item),
      askCauseBelow: null,
      poseModel: this.opts.poseModel?.() ?? "full",
    });
    r.start(t);
    const result = r.finish(t);
    this.results.set(itemKey(item), result);
    this.sink.push({ kind: "save", item, result });
  }

  private skipRegion(region: RegionId, reason: RomReasonId, t: number): void {
    this.skippedRegions.add(region);
    // The region's movements still waiting in this block are saved now; later blocks skip theirs.
    for (const item of this.queue.filter((i) => i.region === region)) this.saveSkipped(item, reason, t);
    this.queue = this.queue.filter((i) => i.region !== region);
  }

  /** The live setup check while the start pose is taken (rom-protocol 1.1 step 1). */
  private watchSetup(item: RomProtocolItem, frame: Frame): void {
    this.setupFrames.push({ t: frame.t, poses: frame.poses ?? [frame.lm], aspect: frame.aspect });
    while (this.setupFrames.length > 1 && frame.t - this.setupFrames[0].t > SETUP_WINDOW_MS)
      this.setupFrames.shift();
    const res = setupCheck(this.setupFrames, romSetupConfig(movementDef(item.movementId), item.side));
    const issue = res.ok ? null : (res.issues[0] ?? null);
    if (issue !== this.setupIssueNow) {
      this.setupIssueNow = issue;
      // P2: the coach hears a new setup issue silently, and voices it only if asked (bridge rule 3).
      if (issue) this.bridge({ p: 2, type: "setup_issue", issue, t: frame.t });
      this.changed();
    }
  }

  private resetRing(start: number | null): void {
    this.holdRing = { anchor: null, since: 0, start, progress: 0 };
  }

  /** The hold ring follows the dial: full after a still second near the end range (a picture only). */
  private ring(deg: number, t: number): void {
    const r = this.holdRing;
    if (r.start === null) r.start = deg;
    const band = ROM_DATA.engine.holdBandDeg;
    const moved = Math.abs(deg - r.start) >= ROM_DATA.engine.minExcursionDeg;
    if (r.anchor === null || Math.abs(deg - r.anchor) > band) {
      r.anchor = deg;
      r.since = t;
    }
    r.progress = moved ? Math.min(1, (t - r.since) / (ROM_DATA.engine.holdSeconds * 1000)) : 0;
  }

  /** The runner's events: the view, the lines, the coach's events, the end of the movement. */
  private take(item: RomProtocolItem, events: RomEvent[], t: number, frame = false): void {
    const gateEvents: GateMessage[] = [];
    let compensated = false;
    let changed = false;
    for (const e of events) {
      switch (e.kind) {
        case "phase":
          changed = true;
          if (e.phase === "practice" || e.phase === "attempt") {
            if (e.attempt !== this.attemptNow || e.phase === "practice") this.resetRing(null);
            this.attemptNow = e.attempt;
          }
          if (e.phase === "ask_can_move")
            this.bridge({ p: 1, type: "ask_can_move", movement: item.movementId, side: item.side, t: e.t });
          if (e.phase === "ask_pain")
            this.bridge({ p: 1, type: "ask_pain", movement: item.movementId, side: item.side, t: e.t });
          if (e.phase === "ask_cause")
            this.bridge({ p: 1, type: "ask_cause", movement: item.movementId, side: item.side, t: e.t });
          if (e.phase === "rest") {
            this.resetRing(null);
            const total = (this.opts.restSec ?? ROM_DATA.engine.restBetweenAttemptsSeconds.min) * 1000;
            this.restUntil = { until: e.t + total, total };
          }
          break;
        case "live":
          this.liveDeg = e.deg;
          this.ring(e.deg, e.t);
          changed = true;
          break;
        case "hold":
          this.holdRing.progress = 1;
          this.bridge({
            p: 1,
            type: "end_range_hold",
            holdId: e.hold.holdId,
            movement: item.movementId,
            side: item.side,
            deg: e.hold.deg,
            typical: this.norm(item).typical,
            t: e.hold.t,
          });
          changed = true;
          break;
        case "compensation":
          if (e.level === "cue") {
            compensated = true;
            this.bridge({
              p: 2,
              type: "compensation",
              movement: item.movementId,
              kind: e.id,
              value: e.value,
              t: e.t,
            });
          }
          break;
        case "cue":
          if (compensated) {
            // A compensation's line: a one off warn event of the gate, never a condition (2.6).
            gateEvents.push({ id: e.cue, severity: "warn", voice: e.cue });
            compensated = false;
          } else {
            this.line(e.cue, e.cue === "pain_stop" ? "safety" : "info");
          }
          break;
        case "quality":
          changed = true;
          break;
        case "attempt":
          if (e.record.outcome === "valid") {
            this.validNow++;
            this.lastValid = e.record.value;
            this.bridge({
              p: 3,
              type: "attempt_saved",
              movement: item.movementId,
              side: item.side,
              deg: e.record.value,
              t: e.record.t1,
            });
          }
          changed = true;
          break;
        case "stop":
          if (e.reason === "pain_stop")
            this.bridge({ p: 0, type: "safety_stop", reason: "pain_stop", t: e.t });
          changed = true;
          break;
        case "plateau":
        case "done":
          break;
      }
    }
    if (frame || gateEvents.length) {
      const out = this.gate.step(t, null, gateEvents);
      for (const m of out.speak) this.line(m.id as Line, m.severity === "safety" ? "safety" : "warn");
      if ((out.shown?.id ?? null) !== (this.captionNow?.id ?? null)) changed = true;
      this.captionNow = out.shown;
    }
    const r = this.runner;
    if (r && this.stepNow.kind === "measure") {
      if (r.phase === "stopped" && !this.stopListNow) {
        // A pain stop (C-15): the movement's result keeps the last valid hold as pain limited.
        const result = r.finish(t);
        this.record(item, result);
        this.reask.add(jointKey(item));
        this.safetyStopped = true;
        this.go({ kind: "pain_stop", item, result });
        return;
      }
      if (r.done) {
        this.finishMeasure(item, t);
        return;
      }
    }
    if (changed) this.changed();
  }

  private finishMeasure(item: RomProtocolItem, t: number): void {
    const r = this.runner;
    if (!r) return;
    const result = r.finish(t);
    this.record(item, result);
    this.go({ kind: "result", item, result });
  }

  private record(item: RomProtocolItem, result: RomMeasureResult): void {
    this.results.set(itemKey(item), result);
    this.sink.push({ kind: "save", item, result });
    this.bridge({
      p: 3,
      type: "movement_result",
      movement: item.movementId,
      side: item.side,
      deg: result.value,
      typical: this.norm(item).typical,
      finding: this.findingOf(result),
      t: this.lastT,
    });
  }

  /** The finding of a result, as the server will store it (C-3: the same pure grade). */
  findingOf(result: RomMeasureResult): RomFindingId {
    if (this.opts.intake) return gradeMeasurement(result, this.opts.intake).finding;
    if (result.value === null) return result.reason === "no_active_movement" ? "unknown" : "not_today";
    return result.painLimited ? "pain_limited" : "no_grade";
  }

  private line(line: Line, severity: "info" | "warn" | "safety"): void {
    this.sink.push({ kind: "line", line, severity });
  }

  private bridge(event: BridgeEvent): void {
    this.sink.push({ kind: "bridge", event });
  }

  private go(step: RomStep): void {
    this.stepNow = step;
    this.instructionsShown = false;
    if (step.kind !== "measure") {
      this.liveDeg = null;
      this.captionNow = null;
      this.setupIssueNow = null;
    }
    this.changed();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
