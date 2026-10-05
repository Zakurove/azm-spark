/**
 * Drives B's RomRunner in a real model smoke run (product v7 contract 8.4 and 2.6, stream G, step
 * G1) as a person at the buttons would: yes at each maximum question, yes to "can you move it", no
 * pain (0, not sharp), "tight" if the cause is asked, each `answerDelayMs` after the question on the
 * runner's own clock (the frames' times). It records the events, the holds, the answers and the time
 * of every feed (section 9: RomRunner.feed 2 ms p95). Pure, no DOM; the smoke page feeds it frames.
 *
 * The runner type is the contract 2.6 class (src/engine/rom/runner.ts, B), so the driver compiles
 * against B's final class from Gate A.
 */
import type { RomRunner } from "../../engine/rom/runner";
import type { RomAttempt, RomEvent, RomHold, RomMeasureResult, RomPhase } from "../../engine/rom/types";
import type { Frame } from "../../engine/types";
import { spread, type Spread } from "./perf";

export type RomRunnerLike = Pick<
  RomRunner,
  | "start"
  | "feed"
  | "answerCanMove"
  | "answerMax"
  | "answerPain"
  | "answerCause"
  | "stop"
  | "finish"
  | "phase"
  | "done"
>;

export interface RomDriverOptions {
  /** How long the person takes to answer, ms (default 600). */
  answerDelayMs?: number;
  /** The clock of the feed timing, ms (default performance.now). */
  now?: () => number;
  /** Each feed's duration, ms (the page forwards it to User Timing as azm:rom_feed). */
  onFeed?: (ms: number) => void;
}

type AnswerKind = "can_move" | "max" | "pain" | "cause";

export interface RomDriverReport {
  status: "done" | "timeout" | "stopped" | "error";
  error?: string;
  result: RomMeasureResult | null;
  frames: number;
  feedMs: Spread;
  /** Count of each event kind. */
  events: Record<string, number>;
  /** Every phase the runner entered, with its time. */
  phases: [RomPhase, number][];
  holds: RomHold[];
  attempts: RomAttempt[];
  answers: { kind: AnswerKind; t: number; accepted: boolean; reason?: string }[];
  /** Quality issues by id, and the local lines the runner asked to play by id. */
  issues: Record<string, number>;
  cues: Record<string, number>;
  compensations: { id: string; level: "cue" | "invalid"; value: number; t: number }[];
}

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};

export class RomSmokeDriver {
  private readonly delay: number;
  private readonly now: () => number;
  private readonly pending: { kind: AnswerKind; due: number; holdId?: string }[] = [];
  private readonly feedDurations: number[] = [];
  private readonly log: Omit<RomDriverReport, "status" | "result" | "frames" | "feedMs" | "error"> = {
    events: {},
    phases: [],
    holds: [],
    attempts: [],
    answers: [],
    issues: {},
    cues: {},
    compensations: [],
  };
  private ended = false;
  private error: string | null = null;
  private finished: RomDriverReport | null = null;

  constructor(
    private readonly runner: RomRunnerLike,
    private readonly opts: RomDriverOptions = {},
  ) {
    this.delay = opts.answerDelayMs ?? 600;
    this.now = opts.now ?? (() => performance.now());
  }

  /** The runner finished (or stopped, or failed). */
  get done(): boolean {
    return this.ended || this.error !== null || this.safe(() => this.runner.done, false);
  }

  start(t: number): void {
    this.run(() => this.handle(this.runner.start(t), t));
  }

  feed(frame: Frame): void {
    if (this.done) return;
    this.answerDue(frame.t);
    if (this.done) return;
    const t0 = this.now();
    let events: RomEvent[] = [];
    try {
      events = this.runner.feed(frame, { rollDeg: null });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    } finally {
      const ms = this.now() - t0;
      this.feedDurations.push(ms);
      this.opts.onFeed?.(ms);
    }
    this.run(() => this.handle(events, frame.t));
  }

  /**
   * The run's report: stops a runner that has not finished (`status` timeout or stopped) and reads
   * its result. Called once; later calls give the same report.
   */
  report(t: number, status?: "timeout" | "stopped"): RomDriverReport {
    if (this.finished) return this.finished;
    if (!this.done) this.run(() => this.handle(this.runner.stop("user_stop", t), t));
    let result: RomMeasureResult | null = null;
    try {
      result = this.runner.finish(t);
    } catch (err) {
      this.error ??= err instanceof Error ? err.message : String(err);
    }
    this.finished = {
      status:
        this.error !== null ? "error" : (status ?? (this.ended || this.runner.done ? "done" : "stopped")),
      ...(this.error !== null ? { error: this.error } : {}),
      result,
      frames: this.feedDurations.length,
      feedMs: spread(this.feedDurations),
      ...this.log,
    };
    return this.finished;
  }

  private safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  private run(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  private schedule(kind: AnswerKind, t: number, holdId?: string): void {
    this.pending.push({ kind, due: t + this.delay, ...(holdId ? { holdId } : {}) });
  }

  private answerDue(t: number): void {
    for (;;) {
      const i = this.pending.findIndex((p) => p.due <= t);
      if (i < 0) return;
      const [a] = this.pending.splice(i, 1);
      this.run(() => this.answer(a, t));
      if (this.done) return;
    }
  }

  private answer(a: { kind: AnswerKind; holdId?: string }, t: number): void {
    const r = this.runner;
    if (a.kind === "can_move") {
      this.log.answers.push({ kind: a.kind, t, accepted: true });
      this.handle(r.answerCanMove(true, t), t);
      return;
    }
    const res =
      a.kind === "max"
        ? r.answerMax(a.holdId!, "yes", "button", t)
        : a.kind === "pain"
          ? r.answerPain(0, false, "button", t)
          : r.answerCause("tight", "button", t);
    this.log.answers.push({
      kind: a.kind,
      t,
      accepted: res.accepted,
      ...(res.reason ? { reason: res.reason } : {}),
    });
    this.handle(res.events, t);
  }

  private handle(events: RomEvent[], t: number): void {
    for (const e of events) {
      count(this.log.events, e.kind);
      switch (e.kind) {
        case "phase":
          this.log.phases.push([e.phase, e.t]);
          if (e.phase === "ask_can_move") this.schedule("can_move", t);
          else if (e.phase === "ask_pain") this.schedule("pain", t);
          else if (e.phase === "ask_cause") this.schedule("cause", t);
          break;
        case "hold":
          this.log.holds.push(e.hold);
          this.schedule("max", t, e.hold.holdId);
          break;
        case "quality":
          count(this.log.issues, e.issue);
          break;
        case "cue":
          count(this.log.cues, e.cue);
          break;
        case "compensation":
          this.log.compensations.push({ id: e.id, level: e.level, value: e.value, t: e.t });
          break;
        case "attempt":
          this.log.attempts.push(e.record);
          break;
        case "done":
        case "stop":
          this.ended = true;
          break;
        default:
          break;
      }
    }
  }
}
