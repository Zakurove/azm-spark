/**
 * The session host (product v7 contract 2.11 CoachHost for the session block, C-15, C-16, C-17,
 * stream D, step D4): the coach's view of a coached workout. The workout screen tells it each step's
 * kind (setStep), the end of an active step (finished), its own pauses (screenPaused) and the safety
 * stops the person confirmed (safetyStop); the host applies the coach's tool calls at once and its
 * answer is final. Wiring it into Workout.tsx and Session.tsx is step D5.
 *
 * mark_pain (C-15, the mobility_pain painRule): painStopRule against the score before the workout, the
 * one tap pain question of D-025 CT-2, or 0 when it was skipped (section 12 item 10). At or above the
 * rule the exercise stops and the stop list opens with pain preselected; below it the exercise goes on
 * unchanged and the screen shows the pain_ok line (stay within comfort).
 * stop: the stop list opens with the coach's reason preselected and highlighted, the emergency options
 * first for chest, stroke_signs, faint, breath and fall; the person confirms there, and only then does
 * the screen call safetyStop() and push the P0. Pure, no DOM.
 */
import { safeToken } from "../../coach/events";
import { painStopRule } from "../../medical/pain-rule";
import type {
  CoachHost,
  CoachStepKind,
  CoachStopReason,
  ToolArgs,
  ToolName,
  ToolResult,
} from "../../coach/types";
import {
  EMERGENCY_REASONS,
  TAP_TO_CONFIRM,
  nextStepRefusal,
  pauseRefusal,
  resumeRefusal,
  type HostControl,
  type PausedBy,
} from "./hostRules";

/** What the session host asks of the workout screen. */
export interface SessionScreen {
  /** The coach paused the exercise or the rest timer. */
  pause(): void;
  /** The coach ended its own pause. */
  resume(): void;
  /** The next card, or the next exercise after a finished one. */
  next(): void;
  /** The text of the instruction card now on the screen. */
  instructions(): string;
  /** The stop list with this option preselected and highlighted; the emergency options first when asked. */
  openStopList(reason: CoachStopReason, emergencyFirst: boolean): void;
  /** A pain stop: the exercise stops now (the stop list follows with pain). */
  stopExercise(): void;
  /** Pain below the rule: the pain_ok line, stay within comfort. */
  painOk(): void;
  /**
   * False while the step on the screen has no pause the app can make (step D5: a camera set and a
   * guided card keep their own controls, STOP and the card's pause); the coach is then told to use them.
   * Absent: every active and timer step can pause.
   */
  canPause?(): boolean;
}

const yesNo = (v: boolean) => (v ? "yes" : "no");

export class SessionHost implements CoachHost {
  readonly block = "session" as const;
  private kind: CoachStepKind = "info";
  private ended = false;
  private pausedBy: PausedBy = null;
  private stopped = false;
  private label = "start";

  /** painBefore: the one tap pain answer before the workout (CT-2), null when skipped (counts as 0). */
  constructor(
    private readonly screen: SessionScreen,
    private readonly painBefore: number | null = null,
  ) {}

  /** The screen shows a new step; a new step is not paused. */
  setStep(kind: CoachStepKind, label: string): void {
    this.kind = kind;
    this.label = label;
    this.ended = false;
    this.pausedBy = null;
  }

  /** The active step on the screen has ended (the set is done). */
  finished(): void {
    this.ended = true;
  }

  /** The person paused (true) or went on (false) from the screen; going on also ends a coach pause. */
  screenPaused(paused: boolean): void {
    this.pausedBy = paused ? "screen" : null;
  }

  /** A safety stop ended the exercise (the person confirmed the stop list, or the trunk safety stop). */
  safetyStop(): void {
    this.stopped = true;
    this.kind = "safety";
    this.pausedBy = null;
  }

  /** The person chose to go on after a stop (the app, never the coach). */
  clearStop(): void {
    this.stopped = false;
  }

  step(): { kind: CoachStepKind; finished: boolean } {
    return { kind: this.kind, finished: this.ended };
  }

  snapshot(): string {
    return (
      `session step=${safeToken(this.label)} kind=${this.kind} finished=${yesNo(this.ended)}` +
      ` paused=${this.pausedBy ?? "no"} stopped=${yesNo(this.stopped)}`
    );
  }

  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    try {
      return this.apply(name, args);
    } catch {
      return { accepted: false, reason: "not_allowed" };
    }
  }

  private control(): HostControl {
    return { step: this.step(), pausedBy: this.pausedBy, stopped: this.stopped };
  }

  private apply<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    switch (name) {
      case "mark_pain": {
        const a = args as ToolArgs["mark_pain"];
        const rule = painStopRule(a.level, a.sharp === true, this.painBefore);
        if (!rule.stop) {
          this.screen.painOk();
          return { accepted: true, say: "pain_ok", data: { action: "continue" } };
        }
        if (!this.stopped) {
          this.safetyStop();
          this.screen.stopExercise();
          this.screen.openStopList("pain", false);
        }
        return { accepted: true, say: "pain_stop", data: { action: "stop_exercise" } };
      }
      case "stop": {
        const { reason } = args as ToolArgs["stop"];
        const emergencyFirst = EMERGENCY_REASONS.includes(reason);
        this.kind = "safety";
        this.pausedBy = null;
        this.screen.openStopList(reason, emergencyFirst);
        return { accepted: true, say: "tap_to_confirm", data: { reason, emergencyFirst } };
      }
      case "pause": {
        const no = pauseRefusal(this.control());
        if (no) return no;
        if (this.screen.canPause?.() === false)
          return { accepted: false, reason: "not_allowed", say: TAP_TO_CONFIRM };
        this.screen.pause();
        this.pausedBy = "coach";
        return { accepted: true };
      }
      case "resume": {
        const no = resumeRefusal(this.control());
        if (no) return no;
        this.screen.resume();
        this.pausedBy = null;
        return { accepted: true };
      }
      case "next_step": {
        const no = nextStepRefusal(this.control());
        if (no) return no;
        this.screen.next();
        return { accepted: true };
      }
      case "repeat_instructions":
        return { accepted: true, data: { text: this.screen.instructions() } };
    }
    return { accepted: false, reason: "not_in_block" };
  }
}
