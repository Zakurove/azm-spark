import { CueId, EngineEvent, Severity } from "./types";

export interface CueRequest {
  cue: CueId | { count: number }; // spoken rep count or named cue
  severity: Severity;
  t: number;
}

const PRIORITY: Record<Severity, number> = { safety: 3, warn: 2, info: 1, praise: 0 };
const MIN_GAP_MS = 2500;

/**
 * Feedback orchestrator: one voice, never chatty.
 * safety > warn > info > praise; global rate limit; rep counts always speak
 * (they are short and are the strongest motivator).
 */
export class CueOrchestrator {
  private lastSpokenT = -Infinity;
  private pending: CueRequest | null = null;

  push(ev: EngineEvent): CueRequest | null {
    if (ev.kind === "rep") {
      // a deferred warning outranks the count — coaching must never be starved
      // by the rep cadence (reps land every ~2.4s, just under the speech gap)
      if (this.pending && PRIORITY[this.pending.severity] >= PRIORITY.warn) {
        const out = this.pending;
        this.pending = null;
        this.lastSpokenT = ev.t;
        return out;
      }
      // otherwise rep counts speak directly (short, expected, motivating)
      this.lastSpokenT = ev.t;
      this.pending = null;
      return { cue: { count: ev.count }, severity: "praise", t: ev.t };
    }
    if (ev.kind !== "flag") return null;
    const req: CueRequest = { cue: ev.cue, severity: ev.severity, t: ev.t };
    if (ev.severity === "safety") {
      this.lastSpokenT = ev.t;
      this.pending = null;
      return req; // safety speaks immediately, always
    }
    if (ev.t - this.lastSpokenT >= MIN_GAP_MS) {
      this.lastSpokenT = ev.t;
      return req;
    }
    // keep only the highest-priority pending cue
    if (!this.pending || PRIORITY[req.severity] > PRIORITY[this.pending.severity]) this.pending = req;
    return null;
  }

  /** call periodically; releases a deferred cue once the gap has passed */
  tick(t: number): CueRequest | null {
    if (this.pending && t - this.lastSpokenT >= MIN_GAP_MS) {
      const out = this.pending;
      this.pending = null;
      this.lastSpokenT = t;
      return out;
    }
    return null;
  }
}
