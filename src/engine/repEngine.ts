import { CompensationRule, EngineEvent, ExerciseDef, ImpairmentProfile, MetricFrame, PRF, RepClass } from "./types";

/**
 * Rep state machine + compensation rule evaluator.
 * Hysteresis thresholds are percentages of the calibrated personal range (PRF):
 *   enter 50% (movement started) · count 85% (full rep) · reset 30%.
 * The engine ARMS only after the metric has first been seen below reset —
 * a calibration handover mid-movement can never open with a phantom rep.
 * A rep is: idle → lifting (≥ enter) → top (≥ count) → counted when back ≤ reset.
 * Classification: reached count = valid; crossed enter but not count = partial
 * (also fires a "fuller range" coaching cue); valid but a warn/safety rule TRUE
 * during the rep (or faster than minPhaseSec) = compensated.
 *
 * IMPORTANT: rule conditions are evaluated raw on every frame and feed
 * classification directly; the per-rule debounce applies ONLY to emitting
 * flag events (i.e. how often we nag), never to how reps are judged.
 * Sub-0.4s oscillations that never reach the count line are discarded as
 * tremor/jitter — they are not reps and are not announced.
 */
const ENTER = 0.5;
const COUNT = 0.85;
const RESET = 0.3;
const MIN_PARTIAL_SEC = 0.4;

export class RepEngine {
  private phase: "waiting" | "idle" | "lifting" | "top" | "lowering" = "waiting";
  private repStartT = 0;
  private reachedCount = false;
  private flaggedDuringRep = false;
  private peakPct = 0;
  private count = 0; // valid + compensated (announced, counts toward the set)
  private lastFlagT = new Map<string, number>();
  private bestRomPct = 0;

  constructor(
    private def: ExerciseDef,
    private prf: PRF,
    private profile: ImpairmentProfile,
  ) {}

  /** reps that count toward the set (valid + compensated) */
  get repCount(): number {
    return this.count;
  }
  get bestRom(): number {
    return this.bestRomPct;
  }

  /** normalized progress of primary metric through the calibrated range, 0..1+ */
  pct(mf: MetricFrame): number | undefined {
    const v = mf.values[this.def.primaryMetric];
    if (v === undefined) return undefined;
    const [lo, hi] = this.prf.range;
    // range may be inverted (e.g. curl: interior elbow angle decreases toward the top)
    if (Math.abs(hi - lo) < 1e-3) return undefined;
    return (v - lo) / (hi - lo);
  }

  step(mf: MetricFrame): EngineEvent[] {
    const events: EngineEvent[] = [];
    const pct = this.pct(mf);
    if (pct === undefined) return events;

    events.push({ kind: "progress", pct: Math.max(0, Math.min(1.15, pct)), t: mf.t });

    // --- compensation & safety rules: evaluated raw every frame ---
    for (const rule of this.def.rules) {
      if (rule.skipIfExpectedAsymmetry && this.profile.expectedAsymmetry) continue;
      const inRep = this.phase === "lifting" || this.phase === "top" || this.phase === "lowering";
      if (rule.duringRepOnly && !inRep) continue;
      const v = mf.values[rule.metric];
      if (v === undefined) continue;
      const base = rule.absolute ? 0 : (this.prf.baselines[rule.metric] ?? 0);
      const threshold = base + rule.delta;
      const fired = rule.op === ">" ? v > threshold : v < threshold;
      if (!fired) continue;
      // classification sees the raw condition — never debounced
      if (inRep && rule.severity !== "info") this.flaggedDuringRep = true;
      // event/cue emission is debounced per rule so coaching doesn't nag
      const last = this.lastFlagT.get(rule.id) ?? -Infinity;
      if (mf.t - last < 4000) continue;
      this.lastFlagT.set(rule.id, mf.t);
      events.push({ kind: "flag", ruleId: rule.id, cue: rule.cue, severity: rule.severity, value: v, t: mf.t });
    }

    // --- FSM ---
    switch (this.phase) {
      case "waiting":
        // arm only from a genuine bottom position (rising-edge requirement)
        if (pct <= RESET) this.phase = "idle";
        break;
      case "idle":
        if (pct >= ENTER) {
          this.phase = "lifting";
          this.repStartT = mf.t;
          this.reachedCount = false;
          this.flaggedDuringRep = false;
          this.peakPct = pct;
          events.push({ kind: "phase", phase: "lifting", t: mf.t });
        }
        break;
      case "lifting":
        this.peakPct = Math.max(this.peakPct, pct);
        if (pct >= COUNT) {
          this.phase = "top";
          this.reachedCount = true;
          events.push({ kind: "phase", phase: "top", t: mf.t });
        } else if (pct <= RESET) {
          // fell back without reaching count → partial rep (or discarded tremor)
          this.finishRep(mf.t, events);
        }
        break;
      case "top":
        this.peakPct = Math.max(this.peakPct, pct);
        if (pct < COUNT) {
          this.phase = "lowering";
          events.push({ kind: "phase", phase: "lowering", t: mf.t });
        }
        break;
      case "lowering":
        this.peakPct = Math.max(this.peakPct, pct);
        if (pct <= RESET) this.finishRep(mf.t, events);
        else if (pct >= COUNT) this.phase = "top"; // bounced back up
        break;
    }
    return events;
  }

  private finishRep(t: number, events: EngineEvent[]): void {
    const durSec = (t - this.repStartT) / 1000;
    this.phase = "idle";
    events.push({ kind: "phase", phase: "idle", t });

    if (!this.reachedCount && durSec < MIN_PARTIAL_SEC) return; // tremor/jitter — not a rep

    let cls: RepClass;
    if (!this.reachedCount) cls = "partial";
    else if (this.flaggedDuringRep || durSec < this.def.minPhaseSec) cls = "compensated";
    else cls = "valid";
    if (cls !== "partial") this.count += 1; // partials don't advance the set
    this.bestRomPct = Math.max(this.bestRomPct, this.peakPct);
    events.push({ kind: "rep", cls, count: this.count, t, durSec, peakPct: this.peakPct });
    if (cls === "partial") {
      const last = this.lastFlagT.get("__partial") ?? -Infinity;
      if (t - last >= 8000) {
        this.lastFlagT.set("__partial", t);
        events.push({ kind: "flag", ruleId: "__partial", cue: "fuller_range", severity: "info", value: this.peakPct, t });
      }
    }
  }
}

export function ruleThreshold(rule: CompensationRule, prf: PRF): number {
  return (rule.absolute ? 0 : (prf.baselines[rule.metric] ?? 0)) + rule.delta;
}
