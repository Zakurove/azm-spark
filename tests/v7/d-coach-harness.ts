/**
 * Stream D: fakes for the coach tests (product v7 contract 8.6), shared by the executor and session
 * tests and open to the host streams (B3's RomController and C4's GaitController can drive their real
 * hosts through the same session with FakeLiveTransport):
 *   - FakeVoice, a LocalVoice whose lines play until the test ends them;
 *   - FakeMic and FakeSpeaker, the microphone and the coach's playback without Web Audio;
 *   - RefRomHost, a reference range host that follows the 2.11 host table (phases, the hold, the
 *     answers by voice and by button, keep_reaching, painStopRule with painBefore), so the executor and
 *     the session are tested against the table before B3 builds the real one;
 *   - RefGaitHost, a reference gait host that follows the same table for the gait block (any
 *     mark_pain or stop ends the recording, the score before from the named region or the highest leg,
 *     hip or back score today, a pain stop ends the test pain_limited, the setup and pad safety taps
 *     are confirm steps), before C4 builds the real GaitController;
 *   - ControlHost, a host made of the shared step kind rules only, for any block.
 */
import { painStopRule } from "../../src/medical/pain-rule";
import {
  EMERGENCY_REASONS,
  nextStepRefusal,
  pauseRefusal,
  resumeRefusal,
  type PausedBy,
} from "../../src/features/coach-agent/hostRules";
import type {
  CoachBlock,
  CoachHost,
  CoachStepKind,
  LocalVoice,
  ToolArgs,
  ToolName,
  ToolResult,
} from "../../src/coach/types";
import type { Severity } from "../../src/engine/types";
import type { LimitCause, RomAnswer } from "../../src/engine/rom/types";
import type { RomMovementId, RomSide } from "../../src/movements/rom/types";
import type { RegionId } from "../../src/medical/body-map";

/* ----------------------------------------------------------- the voice */

export class FakeVoice implements LocalVoice {
  said: { line: string; severity: Severity }[] = [];
  stops = 0;
  private fns = new Set<(p: boolean) => void>();
  private active = 0;
  get playing() {
    return this.active > 0;
  }
  say(line: string, severity: Severity) {
    this.said.push({ line, severity });
    this.active++;
    if (this.active === 1) for (const fn of [...this.fns]) fn(true);
  }
  /** The line playing now ends. */
  end() {
    if (this.active === 0) return;
    this.active--;
    if (this.active === 0) for (const fn of [...this.fns]) fn(false);
  }
  stopAll() {
    this.stops++;
    if (this.active === 0) return;
    this.active = 1;
    this.end();
  }
  onPlaying(fn: (p: boolean) => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

/* ------------------------------------------------- mic and speaker */

export class FakeMic {
  open = true;
  started = false;
  stopped = false;
  refuse = false;
  gates: boolean[] = [];
  level = 0;
  private onChunk: ((pcm: ArrayBuffer) => void) | null = null;
  async start(onChunk: (pcm: ArrayBuffer) => void) {
    if (this.refuse) throw new Error("NotAllowedError");
    this.started = true;
    this.onChunk = onChunk;
  }
  stop() {
    this.stopped = true;
    this.onChunk = null;
  }
  gate(open: boolean) {
    this.open = open;
    this.gates.push(open);
  }
  /** One 20 ms frame from the microphone (dropped by the gate, like MicCapture). */
  frame() {
    if (this.open && !this.stopped) this.onChunk?.(new ArrayBuffer(640));
  }
}

export class FakeSpeaker {
  /** False: the context is suspended (never unlocked by a tap), so nothing is heard. */
  audible = true;
  chunks = 0;
  flushes = 0;
  ducks: boolean[] = [];
  closed = false;
  private active = false;
  private fns = new Set<() => void>();
  get playing() {
    return this.active;
  }
  play(_pcm: ArrayBuffer) {
    if (this.closed) return;
    this.chunks++;
    this.active = true;
  }
  flush() {
    this.flushes++;
    if (this.active) this.idle();
  }
  duck(on: boolean) {
    this.ducks.push(on);
  }
  onIdle(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  close() {
    this.closed = true;
  }
  /** The last chunk has played. */
  idle() {
    this.active = false;
    for (const fn of [...this.fns]) fn();
  }
}

/* --------------------------------------------- the reference hosts */

type Phase = "attempt" | "ask_max" | "ask_can_move" | "ask_cause" | "done" | "stopped";

/**
 * A range host as the 2.11 host table writes it, for one item. The test opens the hold
 * (openHold), the can move question (askCanMove) and the cause question (askCause), and plays the
 * buttons (button*). It records who answered: voice or button.
 */
export class RefRomHost implements CoachHost {
  readonly block = "rom" as const;
  phase: Phase = "attempt";
  item: { movement: RomMovementId; side: RomSide } = { movement: "shoulder_flexion", side: "right" };
  hold: { holdId: string; deg: number; answered: boolean } | null = null;
  painBefore: number | null = 2;
  answers: { answer: RomAnswer; via: "voice" | "button"; deg: number }[] = [];
  canMove: { value: boolean; via: "voice" | "button" }[] = [];
  causes: LimitCause[] = [];
  pains: number[] = [];
  /** keep_reaching is open right after not_yet, while the attempt is open and no pain was reported. */
  reachOpen = false;
  pausedBy: PausedBy = null;
  stopList: string[] = [];
  calls: ToolName[] = [];

  step(): { kind: CoachStepKind; finished: boolean } {
    if (this.phase === "stopped") return { kind: "safety", finished: false };
    if (this.phase === "done") return { kind: "active", finished: true };
    return { kind: this.phase === "attempt" ? "active" : "question", finished: false };
  }
  snapshot(): string {
    return `rom item=${this.item.movement}_${this.item.side} phase=${this.phase}`;
  }
  openHold(holdId: string, deg: number) {
    this.phase = "ask_max";
    this.hold = { holdId, deg, answered: false };
  }
  askCanMove() {
    this.phase = "ask_can_move";
  }
  askCause() {
    this.phase = "ask_cause";
  }
  /** The person taps an answer of the maximum question; false when the screen has none open. */
  buttonMax(answer: RomAnswer): boolean {
    if (this.phase !== "ask_max" || !this.hold || this.hold.answered) return false;
    this.answerMax(answer, "button");
    return true;
  }
  buttonCanMove(value: boolean): boolean {
    if (this.phase !== "ask_can_move") return false;
    this.canMove.push({ value, via: "button" });
    this.phase = value ? "attempt" : "done";
    return true;
  }

  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    this.calls.push(name);
    const control = { step: this.step(), pausedBy: this.pausedBy, stopped: this.phase === "stopped" };
    switch (name) {
      case "confirm_max": {
        const a = args as ToolArgs["confirm_max"];
        if (this.phase !== "ask_max" || !this.hold)
          return this.phase === "attempt"
            ? { accepted: false, reason: "wrong_phase", say: "hold_still" }
            : { accepted: false, reason: "wrong_phase" };
        if (a.movement !== this.item.movement || a.side !== this.item.side)
          return { accepted: false, reason: "stale_hold" };
        if (this.hold.answered) return { accepted: false, reason: "already_answered" };
        return this.answerMax(a.answer, "voice");
      }
      case "answer_can_move": {
        const a = args as ToolArgs["answer_can_move"];
        if (this.phase !== "ask_can_move") return { accepted: false, reason: "wrong_phase" };
        if (a.movement !== this.item.movement || a.side !== this.item.side)
          return { accepted: false, reason: "stale_hold" };
        this.canMove.push({ value: a.canMove, via: "voice" });
        this.phase = a.canMove ? "attempt" : "done";
        return { accepted: true, say: a.canMove ? "lets_begin" : "not_today" };
      }
      case "keep_reaching":
        if (!this.reachOpen)
          return { accepted: false, reason: this.pains.length ? "after_pain" : "wrong_phase" };
        return { accepted: true, say: "keep_going" };
      case "mark_pain": {
        const a = args as ToolArgs["mark_pain"];
        this.pains.push(a.level);
        this.reachOpen = false;
        const rule = painStopRule(a.level, a.sharp === true, this.painBefore);
        if (rule.stop) {
          this.phase = "stopped";
          return { accepted: true, say: "pain_stop", data: { action: "stop_movement" } };
        }
        return { accepted: true, data: { action: "continue" } };
      }
      case "set_limit_cause":
        if (this.phase !== "ask_cause") return { accepted: false, reason: "wrong_phase" };
        this.causes.push((args as ToolArgs["set_limit_cause"]).cause);
        this.phase = "done";
        return { accepted: true, say: "recorded" };
      case "pause": {
        const no = pauseRefusal(control);
        if (no) return no;
        this.pausedBy = "coach";
        return { accepted: true };
      }
      case "resume": {
        const no = resumeRefusal(control);
        if (no) return no;
        this.pausedBy = null;
        return { accepted: true };
      }
      case "next_step":
        return nextStepRefusal(control) ?? { accepted: true };
      case "stop":
        this.stopList.push((args as ToolArgs["stop"]).reason);
        return { accepted: true, say: "tap_to_confirm" };
      case "repeat_instructions":
        return { accepted: true, data: { text: "Raise your arm forward slowly." } };
    }
    return { accepted: false, reason: "unknown_tool" };
  }

  private answerMax(answer: RomAnswer, via: "voice" | "button"): ToolResult {
    const hold = this.hold!;
    hold.answered = true;
    this.answers.push({ answer, via, deg: hold.deg });
    if (answer === "yes") {
      this.phase = "done";
      return { accepted: true, say: "recorded", data: { recorded: true, deg: hold.deg } };
    }
    if (answer === "not_yet") {
      this.phase = "attempt";
      this.reachOpen = true;
      return { accepted: true, say: "keep_going", data: { recorded: false, deg: hold.deg } };
    }
    this.phase = "attempt";
    return { accepted: true, say: "pain_ask", data: { recorded: false, deg: hold.deg } };
  }
}

/** The regions of "the highest leg, hip or back score today" (2.11 host table, gait mark_pain). */
const LEG_HIP_BACK: readonly RegionId[] = ["back_trunk", "hip", "knee", "ankle_foot"];

/**
 * The gait steps a reference capture shows, with their kinds (C-16): the clear path, the support
 * nearby, the helper present and each pad safety step of gait-rules eligibility.padSafety are taps the
 * person or the helper must make; the handrail question is a question; the warm up and the rest are
 * timers; a walk is active.
 */
export const GAIT_STEPS = {
  intro: "info",
  clear_path: "confirm",
  support_nearby: "confirm",
  helper_present: "confirm",
  pad_floor_and_stop_key: "confirm",
  pad_auto_speed_off: "confirm",
  pad_step_on_stopped: "confirm",
  pad_handrail: "question",
  pad_support_side: "confirm",
  pad_warm_up: "timer",
  walk: "active",
  rest: "timer",
  walk_again: "confirm",
} as const satisfies Record<string, CoachStepKind>;
export type GaitStepId = keyof typeof GAIT_STEPS;

/**
 * A gait host as the 2.11 host table writes it. The test shows steps (show), starts a walk (walk),
 * counts its clean cycles (cycle) and ends a pass (passDone). Any mark_pain or stop ends the
 * recording (gait-rules stops); a pain at or above painStopRule ends the test pain_limited with the
 * completed clean cycles kept, else the screen asks for a tap to walk again.
 */
export class RefGaitHost implements CoachHost {
  readonly block = "gait" as const;
  stepId: GaitStepId = "intro";
  finished = false;
  recording = false;
  cleanCycles = 0;
  pausedBy: PausedBy = null;
  stopped = false;
  /** Today's pain answers per region (the pre-check's painByRegion). */
  painToday: Partial<Record<RegionId, number>> = {};
  /** The walks a pain or a stop ended, with the clean cycles each had. */
  recordingsEnded: number[] = [];
  outcome: { label: "pain_limited"; cleanCycles: number } | null = null;
  stopList: { reason: string; emergencyFirst: boolean }[] = [];
  calls: ToolName[] = [];

  show(id: GaitStepId) {
    this.stepId = id;
    this.finished = false;
    this.pausedBy = null;
  }
  walk() {
    this.show("walk");
    this.recording = true;
  }
  cycle() {
    if (this.recording && !this.pausedBy) this.cleanCycles++;
  }
  passDone() {
    this.recording = false;
    this.finished = true;
  }
  step(): { kind: CoachStepKind; finished: boolean } {
    if (this.stopped) return { kind: "safety", finished: false };
    return { kind: GAIT_STEPS[this.stepId], finished: this.finished };
  }
  snapshot(): string {
    return `gait step=${this.stepId} cycles=${this.cleanCycles}`;
  }
  /** The score before (2.11): the named region's today, else the highest leg, hip or back score, else 0. */
  before(location?: RegionId): number {
    const named = location === undefined ? undefined : this.painToday[location];
    if (named !== undefined) return named;
    return Math.max(0, ...LEG_HIP_BACK.map((r) => this.painToday[r] ?? 0));
  }

  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    this.calls.push(name);
    const control = { step: this.step(), pausedBy: this.pausedBy, stopped: this.stopped };
    switch (name) {
      case "mark_pain": {
        const a = args as ToolArgs["mark_pain"];
        const ended = this.endRecording();
        const rule = painStopRule(a.level, a.sharp === true, this.before(a.location));
        if (rule.stop) {
          if (!this.stopped) {
            this.stopped = true;
            this.outcome = { label: "pain_limited", cleanCycles: this.cleanCycles };
          }
          return { accepted: true, say: "pain_stop", data: { action: "stop_test" } };
        }
        if (!ended) return { accepted: true, say: "pain_ok", data: { action: "continue" } };
        this.show("walk_again");
        return { accepted: true, say: "pain_ok", data: { action: "recording_ended" } };
      }
      case "stop": {
        const { reason } = args as ToolArgs["stop"];
        this.endRecording();
        const emergencyFirst = EMERGENCY_REASONS.includes(reason);
        this.stopList.push({ reason, emergencyFirst });
        return { accepted: true, say: "tap_to_confirm", data: { reason, emergencyFirst } };
      }
      case "pause": {
        const no = pauseRefusal(control);
        if (no) return no;
        this.pausedBy = "coach";
        return { accepted: true };
      }
      case "resume": {
        const no = resumeRefusal(control);
        if (no) return no;
        this.pausedBy = null;
        return { accepted: true };
      }
      case "next_step":
        return nextStepRefusal(control) ?? { accepted: true };
      case "repeat_instructions":
        return { accepted: true, data: { text: "Walk at your own comfortable pace." } };
    }
    return { accepted: false, reason: "not_in_block" };
  }

  /** gait-rules stops: a coach stop and mark_pain end the recording; the clean cycles are kept. */
  private endRecording(): boolean {
    if (!this.recording) return false;
    this.recording = false;
    this.recordingsEnded.push(this.cleanCycles);
    return true;
  }
}

/** A host made of the shared step kind rules only (any block), for the control tool matrix. */
export class ControlHost implements CoachHost {
  kind: CoachStepKind = "info";
  finished = false;
  pausedBy: PausedBy = null;
  stopped = false;
  constructor(readonly block: CoachBlock) {}
  step() {
    return { kind: this.kind, finished: this.finished };
  }
  snapshot() {
    return `${this.block} kind=${this.kind}`;
  }
  handleTool<N extends ToolName>(name: N, _args: ToolArgs[N]): ToolResult {
    const control = { step: this.step(), pausedBy: this.pausedBy, stopped: this.stopped };
    if (name === "pause") {
      const no = pauseRefusal(control);
      if (!no) this.pausedBy = "coach";
      return no ?? { accepted: true };
    }
    if (name === "resume") {
      const no = resumeRefusal(control);
      if (!no) this.pausedBy = null;
      return no ?? { accepted: true };
    }
    if (name === "next_step") return nextStepRefusal(control) ?? { accepted: true };
    return { accepted: true };
  }
}
