/**
 * The voice and captions of the camera screens (UX spec 4.3, principle 4). Pure: no DOM.
 *
 *   captionOf(id, lang)   the caption card of a cue: the short form (at most 3 words, O24-1) and the
 *                         full display sentence (never arTts)
 *   cueSeverity(id)       info for instructions, warn for coaching and setup issues, safety for the
 *                         stop and urgent lines only
 *   CueQueue              the priority queue of 4.3: safety, then stop list and check in, then setup
 *                         issues, then retry fixes, then phase and coaching cues. A higher class
 *                         interrupts a lower one; a lower one waits its turn; a stale line is dropped.
 *
 * CuePlayer (src/app/audio.ts) reports when a line starts but not when it ends, so the queue spaces
 * lines by an estimate of their length. Every spoken line is captioned at the moment it starts, and
 * a prompt (a line of a timed trial, D-009) is captioned without being spoken.
 */
import type { Lang } from "../../../app/i18n";
import { cueLine } from "../../../movements/assessments";
import type { CheckCueId } from "../../../movements/types";

export type CueSeverity = "info" | "warn" | "safety";

/**
 * Cues of the priority classes of 4.3, from the highest. The timer lines of a timed trial (go, ten
 * seconds left, the end cue) come right after the setup issues: their moment is the measure.
 */
export type CueClass = "safety" | "checkin" | "setup" | "timer" | "retry" | "phase";
const CLASS_RANK: Record<CueClass, number> = {
  safety: 6,
  checkin: 5,
  setup: 4,
  timer: 3,
  retry: 2,
  phase: 1,
};

const SAFETY_CUES: ReadonlySet<string> = new Set([
  "check_stop_now",
  "check_urgent_call",
  "check_are_you_ok",
  "check_are_you_ok_noraise",
  "check_are_you_ok_zone",
  "check_are_you_ok_zone_speech",
  "check_are_you_ok_helper",
]);

/** Coaching lines and setup fixes: the warn bar and triangle (4.3, S34g). */
const WARN_CUES: ReadonlySet<string> = new Set([
  "test_abd_still",
  "test_abd_relax_shoulder",
  "test_abd_side",
  "test_trunk_to_middle",
  "test_curl_full",
  "test_stand_full",
  "test_stand_hands_needed",
  "check_one_person",
  "check_phone_still",
  "check_phone_level",
  "check_whole_body",
  "check_move_back",
  "check_move_closer",
  "check_light",
  "check_face_phone",
  "check_left_side_to_phone",
  "check_right_side_to_phone",
  "check_phone_angle_right",
  "check_phone_angle_left",
  "check_clear_view",
  "check_sleeves",
  "check_try_again",
]);

export function cueSeverity(id: CheckCueId | string): CueSeverity {
  if (SAFETY_CUES.has(id)) return "safety";
  if (WARN_CUES.has(id)) return "warn";
  return "info";
}

/** The priority class of a cue by its source. */
export function cueClass(id: CheckCueId | string, source: "runner" | "setup" | "retry"): CueClass {
  if (SAFETY_CUES.has(id))
    return id === "check_stop_now" || id === "check_urgent_call" ? "safety" : "checkin";
  if (source === "setup") return "setup";
  if (source === "retry") return "retry";
  return "phase";
}

export interface CaptionLine {
  /** The cue, when the line is a check cue (tap to hear it again). */
  cue?: CheckCueId;
  /** The short form, at most 3 words, shown at 56 px. */
  short?: string;
  /** The full display sentence (never the vocalised speech text). */
  text: string;
  severity: CueSeverity;
}

export function captionOf(id: CheckCueId, lang: Lang): CaptionLine {
  const line = cueLine(id);
  return {
    cue: id,
    short: line.short?.[lang] || undefined,
    text: lang === "ar" ? line.ar : line.en,
    severity: cueSeverity(id),
  };
}

/**
 * How long a line is taken to last before its voice starts: about as long as a calm voice needs for
 * its display text (Arabic about 13 characters a second, English about 15), plus half a second. Once
 * the voice plays, its end (CuePlayer onEnd) ends the line in the queue (spoken, heardEnd), so the no
 * movement grace (4.8) and the queue follow the real line; a line never heard to its end is held at
 * most SPOKEN_EXTRA_MS past the estimate.
 */
export function cueDurationMs(id: CheckCueId | string, lang: Lang): number {
  let text = "";
  try {
    const line = cueLine(id as CheckCueId);
    text = lang === "ar" ? line.ar : line.en;
  } catch {
    // count_1 to count_3 and other voice lines outside the check data: about half a second.
    return 700;
  }
  const perChar = lang === "ar" ? 75 : 65;
  return 500 + text.length * perChar;
}

export interface CueRequest {
  id: CheckCueId | string;
  cls: CueClass;
  /** False for a prompt: captioned, never spoken (timed trials, D-009). */
  speak: boolean;
  /** When it was asked for (ms). */
  at: number;
  /** Dropped when it could not start within this long (the countdown numbers); default 8 s. */
  staleMs?: number;
}

export interface CueStart {
  id: CheckCueId | string;
  speak: boolean;
  /** The line playing before this one is cut off (a higher class interrupts it). */
  interrupt: boolean;
  /** Estimated end (ms). */
  endsAt: number;
}

/** Lines older than this are dropped rather than played late. */
const STALE_MS = 8000;

/** A spoken line whose end is never heard is taken to have ended this long after its estimate. */
export const SPOKEN_EXTRA_MS = 5000;

/**
 * The cue queue of 4.3. `push` adds lines, `next(now)` returns the line to start now (or null).
 * One line of the setup class waits at a time: a newer setup issue replaces the waiting one.
 */
export class CueQueue {
  private waiting: CueRequest[] = [];
  private current: { req: CueRequest; endsAt: number; spoken?: boolean; heardAt?: number } | null = null;

  constructor(private readonly lang: () => Lang) {}

  push(req: CueRequest): void {
    if (req.cls === "setup") this.waiting = this.waiting.filter((w) => w.cls !== "setup");
    // The same line already waiting is not queued twice.
    if (this.waiting.some((w) => w.id === req.id)) return;
    this.waiting.push(req);
  }

  /** Clears everything (STOP silences the current cue, a new screen drops what waits). */
  clear(): void {
    this.waiting = [];
    this.current = null;
  }

  get playing(): CueRequest | null {
    return this.current?.req ?? null;
  }

  /** When the current line is expected to end (ms), or 0. */
  get busyUntil(): number {
    return this.current?.endsAt ?? 0;
  }

  /** The voice started the current line: it lasts until its end is heard (heardEnd). */
  spoken(id: CheckCueId | string): void {
    const c = this.current;
    if (!c || c.req.id !== id || c.spoken) return;
    c.spoken = true;
    // Its end may already have been heard (a very short line).
    c.endsAt = c.heardAt !== undefined ? Math.min(c.endsAt, c.heardAt) : c.endsAt + SPOKEN_EXTRA_MS;
  }

  /** The voice said the line to its end (or it was cut off): the queue moves on from now. */
  heardEnd(id: CheckCueId | string, now: number): void {
    const c = this.current;
    if (!c || c.req.id !== id) return;
    c.heardAt = now;
    if (c.spoken) c.endsAt = Math.min(c.endsAt, now);
  }

  next(now: number): CueStart | null {
    this.waiting = this.waiting.filter((w) => now - w.at <= (w.staleMs ?? STALE_MS));
    if (!this.waiting.length) {
      if (this.current && now >= this.current.endsAt) this.current = null;
      return null;
    }
    // Highest class first; within a class, first asked first played.
    let best = 0;
    for (let k = 1; k < this.waiting.length; k++)
      if (CLASS_RANK[this.waiting[k].cls] > CLASS_RANK[this.waiting[best].cls]) best = k;
    const cand = this.waiting[best];
    const busy = this.current && now < this.current.endsAt;
    const interrupt = !!busy && CLASS_RANK[cand.cls] > CLASS_RANK[this.current!.req.cls];
    if (busy && !interrupt) return null;
    this.waiting.splice(best, 1);
    const endsAt = now + (cand.speak ? cueDurationMs(cand.id, this.lang()) : 1500);
    this.current = { req: cand, endsAt };
    return { id: cand.id, speak: cand.speak, interrupt, endsAt };
  }
}
