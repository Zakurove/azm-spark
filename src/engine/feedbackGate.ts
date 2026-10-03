/**
 * Calm feedback (booth v2, contract A5). Pure TS, no DOM.
 *
 * The camera screen has ONE caption line. Candidate messages arrive every frame and the gate lets
 * out stable ones:
 *   - a condition (out of the picture, move closer, move back) shows only after it has been the
 *     candidate for DWELL (2 s); a dropped frame shorter than GRACE does not restart the wait;
 *   - whatever shows stays at least MIN_SHOW (3 s), and a condition then leaves once it has cleared;
 *   - one slot at a time: a coaching event that arrives while the slot is taken waits (the newest of
 *     the highest severity, for at most PENDING_MAX) instead of replacing it;
 *   - a safety message shows and is spoken at once, always;
 *   - speech: framing hints at most every FRAMING_SPEECH (12 s), every other line at least
 *     SPEECH_GAP (2.5 s) after the last one; safety lines are never held back.
 * The distance hints have a dead band (`FramingHinter`), so "move closer" and "move back" never flip.
 * The rep count is spoken by the player's count channel, outside this gate (audio.ts).
 */
import { Severity } from "./types";

export interface GateMessage {
  /** A cue id (types.ts CueId) or a screen message id (no_person, move_closer, ...). */
  id: string;
  severity: Severity;
  /** The voice line to speak when the message shows; none means a silent caption. */
  voice?: string;
  /** Framing hints share their own, longer speech limit. */
  group?: "framing";
}

export const GATE_RULES = {
  dwellMs: 2000,
  graceMs: 250,
  minShowMs: 3000,
  /** How long a one off message (an engine cue, praise) stays on screen. */
  eventShowMs: 3500,
  pendingMaxMs: 3000,
  framingSpeechMs: 12000,
  speechGapMs: 2500,
} as const;

const RANK: Record<Severity, number> = { praise: 0, info: 1, warn: 2, safety: 3 };

interface Slot {
  msg: GateMessage;
  kind: "condition" | "event";
  shownAt: number;
}

export interface GateOutput {
  /** The one caption line now, or null. */
  shown: GateMessage | null;
  /** Lines to speak now (at most one, except a safety line with another). */
  speak: GateMessage[];
}

export class FeedbackGate {
  private cand: { msg: GateMessage; since: number; lastSeen: number } | null = null;
  private slot: Slot | null = null;
  private pending: { msg: GateMessage; at: number } | null = null;
  private lastSpeech = -Infinity;
  private lastFramingSpeech = -Infinity;

  /**
   * One frame: the most important condition true now (or null) and the one off messages of this
   * frame. Returns the caption and the lines to speak.
   */
  step(t: number, condition: GateMessage | null, events: GateMessage[] = []): GateOutput {
    const speak: GateMessage[] = [];
    this.track(t, condition);

    for (const ev of events) {
      if (ev.severity === "safety") {
        this.show(t, ev, "event", speak);
        this.pending = null;
        continue;
      }
      if (!this.pending || RANK[ev.severity] >= RANK[this.pending.msg.severity])
        this.pending = { msg: ev, at: t };
    }
    if (this.pending && t - this.pending.at > GATE_RULES.pendingMaxMs) this.pending = null;

    // An event leaves after its time; a condition after MIN_SHOW once it is no longer the candidate.
    if (this.slot) {
      const age = t - this.slot.shownAt;
      const gone =
        this.slot.kind === "event"
          ? age >= GATE_RULES.eventShowMs
          : age >= GATE_RULES.minShowMs && (!this.cand || this.cand.msg.id !== this.slot.msg.id);
      if (gone) this.slot = null;
    }
    // A waiting event takes a free slot, or one whose line has had its MIN_SHOW (a condition comes
    // back afterwards if it still holds); a safety line keeps its full time. A condition takes only
    // a free slot, after DWELL.
    const free = !this.slot;
    const age = this.slot ? t - this.slot.shownAt : 0;
    const yields =
      !!this.slot &&
      age >= GATE_RULES.minShowMs &&
      (this.slot.msg.severity !== "safety" || age >= GATE_RULES.eventShowMs);
    if (this.pending && (free || yields)) {
      this.show(t, this.pending.msg, "event", speak);
      this.pending = null;
    } else if (free && this.cand && t - this.cand.since >= GATE_RULES.dwellMs) {
      this.show(t, this.cand.msg, "condition", speak);
    }
    return { shown: this.slot?.msg ?? null, speak };
  }

  /**
   * The speech limits for a line spoken without a caption (a stage line such as "Let's find your
   * range"): true when it may be spoken now, and then it counts as the last line.
   */
  maySpeak(t: number, msg: GateMessage): boolean {
    if (!this.speechAllowed(t, msg)) return false;
    this.spoke(t, msg);
    return true;
  }

  /** Clears the caption and every waiting message (a new stage, the end of the set). */
  clear(): void {
    this.cand = null;
    this.slot = null;
    this.pending = null;
  }

  private track(t: number, condition: GateMessage | null): void {
    if (condition) {
      if (this.cand && this.cand.msg.id === condition.id) this.cand.lastSeen = t;
      else this.cand = { msg: condition, since: t, lastSeen: t };
    } else if (this.cand && t - this.cand.lastSeen > GATE_RULES.graceMs) {
      this.cand = null;
    }
  }

  private show(t: number, msg: GateMessage, kind: Slot["kind"], speak: GateMessage[]): void {
    this.slot = { msg, kind, shownAt: t };
    if (msg.voice && this.speechAllowed(t, msg)) {
      this.spoke(t, msg);
      speak.push(msg);
    }
  }

  private speechAllowed(t: number, msg: GateMessage): boolean {
    if (msg.severity === "safety") return true;
    if (t - this.lastSpeech < GATE_RULES.speechGapMs) return false;
    return msg.group !== "framing" || t - this.lastFramingSpeech >= GATE_RULES.framingSpeechMs;
  }

  private spoke(t: number, msg: GateMessage): void {
    this.lastSpeech = t;
    if (msg.group === "framing") this.lastFramingSpeech = t;
  }
}

/**
 * Distance hints with a dead band. `size` is the trunk length in image heights (pixel space). A
 * person is "far" below farEnter and stays far until above farExit; "near" above nearEnter until
 * below nearExit. Between the bands nothing is said. Required joints out of the picture
 * (presence "partial") mean "move back", unless the person is far: the two never alternate.
 */
export const DISTANCE_BANDS = { farEnter: 0.1, farExit: 0.125, nearEnter: 0.42, nearExit: 0.36 } as const;

export type Presence = "none" | "partial" | "ok";
export type DistanceHint = "move_closer" | "move_back" | null;

export class FramingHinter {
  private far = false;
  private near = false;

  hint(presence: Presence, size: number | undefined): DistanceHint {
    if (presence === "none" || size === undefined || !Number.isFinite(size)) return null;
    if (this.far) this.far = size < DISTANCE_BANDS.farExit;
    else this.far = size < DISTANCE_BANDS.farEnter;
    if (this.near) this.near = size > DISTANCE_BANDS.nearExit;
    else this.near = size > DISTANCE_BANDS.nearEnter;
    if (this.far) return "move_closer";
    if (this.near || presence === "partial") return "move_back";
    return null;
  }
}
