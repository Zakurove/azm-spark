import {
  CompensationRule,
  CueId,
  EngineEvent,
  ExerciseDef,
  ImpairmentProfile,
  MetricFrame,
  PRF,
  RepClass,
  SessionMeasure,
} from "./types";
import {
  capStopFor,
  presetBlock,
  PRESET_BLOCK_ID,
  trunkStopFor,
  TrunkStopLimits,
  trunkStopLimits,
} from "./trunkSafety";

/**
 * Version of the workout engine, stored with every saved set. Bump on any change to how a rep is
 * judged or when a safety stop fires.
 *   1  up to the D-003 aspect fix and the absolute 25 degree trunk stop
 *   2  S0: the trunk stop 15 degrees from the calibrated posture plus the absolute caps, the stop
 *      ends the set, and the pre-set block (council 2026-09-28)
 *   3  booth v2 A: the press counts on wrist height, calibration starts in the start position and
 *      takes the first 2 comfortable reps, the count line is 80% of the personal range, and the
 *      range adapts down to 3 consistent shorter reps and extends up past its top
 */
export const WORKOUT_ENGINE_VERSION = "workout_engine_3";

/**
 * Rep state machine + compensation rule evaluator.
 * Hysteresis thresholds are percentages of the calibrated personal range (PRF):
 *   enter 50% (movement started) · count 80% (full rep) · reset 30%.
 * The personal range moves with the person (booth v2 A3), and every move is a `range` event:
 *   extend up    a counted rep that went past the top makes its peak the new top;
 *   adapt down   3 consecutive reps peaking at 55 to 80% within 12 points of each other make
 *                their median peak the new top, never closer than 15% of the default range to
 *                the bottom. Those 3 stay partial; the reps after them count.
 * The summary measure (A4) reads `def.measure.metric` over each counted rep: its bottom near the
 * start of the movement (pct between minus 25% and 50%, so resting arms far below are left out) and
 * its top during the rep.
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
 *
 * Trunk safety stop (S0, trunkSafety.ts): evaluated raw on every frame, in or out of a rep. When it
 * fires the engine emits the safety flag and a `stop` event and counts nothing more (the rep in
 * progress is dropped). A calibration whose posture is at or beyond the absolute limit never
 * starts: the engine only repeats the pre-set block cue.
 */
const ENTER = 0.5;
export const COUNT = 0.8;
export const RESET = 0.3;
const MIN_PARTIAL_SEC = 0.4;
/** Adapt down (booth v2 A3): reps peaking in [ADAPT_LO, COUNT), ADAPT_REPS in a row, within ADAPT_SPREAD. */
const ADAPT_LO = 0.55;
const ADAPT_REPS = 3;
const ADAPT_SPREAD = 0.12;
/** The adapted range is never smaller than this share of the default range. */
const ADAPT_FLOOR_SHARE = 0.15;
/** The measure's bottom is read where pct lies in [MEASURE_LOW, ENTER]. */
const MEASURE_LOW = -0.25;

export class RepEngine {
  private phase: "waiting" | "idle" | "lifting" | "top" | "lowering" = "waiting";
  private repStartT = 0;
  private reachedCount = false;
  private flaggedDuringRep = false;
  private peakPct = 0;
  private count = 0; // valid + compensated (announced, counts toward the set)
  private lastFlagT = new Map<string, number>();
  private bestRomPct = 0;
  private readonly limits: TrunkStopLimits | null;
  private readonly blockCue: CueId | null;
  private stopId: string | null = null;
  /** The personal range now: [bottom, top] in metric units, oriented like the PRF range. */
  private r: [number, number];
  private shortPeaks: number[] = [];
  private valid = 0;
  /** The measure metric over the current rep window: bottom near the start, top during the rep. */
  private win = { bottom: [] as number[], top: [] as number[] };
  private measured: { bottom: number; top: number }[] = [];

  constructor(
    private def: ExerciseDef,
    private prf: PRF,
    private profile: ImpairmentProfile,
  ) {
    this.limits = trunkStopLimits(def, prf);
    this.blockCue = presetBlock(def, prf);
    this.r = [prf.range[0], prf.range[1]];
  }

  /** The personal range now, [bottom, top]; it moves when the top extends up or adapts down. */
  get range(): [number, number] {
    return [this.r[0], this.r[1]];
  }

  /** Counted reps without a flag (valid reps): the summary's steady reps. */
  get steadyReps(): number {
    return this.valid;
  }

  /** The summary measure over the counted reps (booth v2 A4), or undefined before the first. */
  measure(): SessionMeasure | undefined {
    if (!this.measured.length) return undefined;
    const kind = this.def.measure.kind;
    const round = (v: number) => (kind === "hip_rise" ? Math.round(v * 100) / 100 : Math.round(v));
    const bottomDeg = round(median(this.measured.map((m) => m.bottom)));
    const topDeg = round(median(this.measured.map((m) => m.top)));
    return { kind, bottomDeg, topDeg, rangeDeg: round(Math.abs(topDeg - bottomDeg)) };
  }

  /** The pre-set block cue when the calibrated posture does not allow the set to start. */
  get blocked(): CueId | null {
    return this.blockCue;
  }

  /** The rule id of the safety stop that ended the set, or null. */
  get stoppedBy(): string | null {
    return this.stopId;
  }

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
    const [lo, hi] = this.r;
    // range may be inverted (e.g. curl: interior elbow angle decreases toward the top)
    if (Math.abs(hi - lo) < 1e-3) return undefined;
    return (v - lo) / (hi - lo);
  }

  /**
   * The trunk safety stop (S0) alone, for a frame the session does not pass to step() (the framing
   * gate wants the wrists; the stop needs only both shoulders and both hips). The stop events, or
   * none; once stopped the set counts nothing more.
   */
  safetyStep(mf: MetricFrame): EngineEvent[] {
    const lean = mf.values.trunk_lean;
    if (this.stopId || this.blockCue || !this.limits || !this.def.trunkSafety || lean === undefined)
      return [];
    const hit = trunkStopFor(this.limits, lean);
    if (!hit) return [];
    this.stopId = hit;
    return stopEvents(this.def, hit, lean, mf.t);
  }

  step(mf: MetricFrame): EngineEvent[] {
    const events: EngineEvent[] = [];
    if (this.stopId) return events;
    if (this.blockCue) {
      const last = this.lastFlagT.get(PRESET_BLOCK_ID) ?? -Infinity;
      if (mf.t - last >= 4000) {
        this.lastFlagT.set(PRESET_BLOCK_ID, mf.t);
        const base = this.limits?.base ?? 0;
        events.push({
          kind: "flag",
          ruleId: PRESET_BLOCK_ID,
          cue: this.blockCue,
          severity: "safety",
          value: base,
          t: mf.t,
        });
      }
      return events;
    }

    // --- trunk safety stop (S0): raw, every frame, in or out of a rep ---
    const stop = this.safetyStep(mf);
    if (stop.length) return [...events, ...stop];

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
      events.push({
        kind: "flag",
        ruleId: rule.id,
        cue: rule.cue,
        severity: rule.severity,
        value: v,
        t: mf.t,
      });
    }

    // --- the measure window (A4) ---
    const mv = mf.values[this.def.measure.metric];
    if (mv !== undefined && Number.isFinite(mv) && this.phase !== "waiting") {
      if (this.phase === "idle" && pct >= MEASURE_LOW && pct <= ENTER) this.win.bottom.push(mv);
      else if (this.phase !== "idle") this.win.top.push(mv);
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
    if (cls === "valid") this.valid += 1;
    this.bestRomPct = Math.max(this.bestRomPct, this.peakPct);
    events.push({ kind: "rep", cls, count: this.count, t, durSec, peakPct: this.peakPct });
    if (cls !== "partial") this.keepMeasure();
    this.win = { bottom: [], top: [] };
    this.moveRange(cls, t, events);
    if (cls === "partial") {
      const last = this.lastFlagT.get("__partial") ?? -Infinity;
      if (t - last >= 8000) {
        this.lastFlagT.set("__partial", t);
        events.push({
          kind: "flag",
          ruleId: "__partial",
          cue: "fuller_range",
          severity: "info",
          value: this.peakPct,
          t,
        });
      }
    }
  }

  /** Keeps the bottom and top of the measure metric for a counted rep. */
  private keepMeasure(): void {
    const { bottom, top } = this.win;
    if (!bottom.length || !top.length) return;
    // elbow flexion (the curl): the bottom is the straightest arm, the top the most bent
    const flex = this.def.measure.kind === "elbow_flexion";
    this.measured.push({
      bottom: flex ? Math.max(...bottom) : Math.min(...bottom),
      top: flex ? Math.min(...top) : Math.max(...top),
    });
  }

  /** Extend up and adapt down (booth v2 A3). */
  private moveRange(cls: RepClass, t: number, events: EngineEvent[]): void {
    const [lo, hi] = this.r;
    const span = hi - lo;
    if (cls !== "partial") {
      this.shortPeaks = [];
      if (this.peakPct > 1) {
        this.r = [lo, lo + this.peakPct * span];
        events.push({ kind: "range", range: this.range, reason: "extend_up", t });
      }
      return;
    }
    if (this.peakPct < ADAPT_LO || this.peakPct >= COUNT) {
      this.shortPeaks = [];
      return;
    }
    this.shortPeaks.push(this.peakPct);
    if (this.shortPeaks.length > ADAPT_REPS) this.shortPeaks.shift();
    if (this.shortPeaks.length < ADAPT_REPS) return;
    if (Math.max(...this.shortPeaks) - Math.min(...this.shortPeaks) > ADAPT_SPREAD) return;
    const [dLo, dHi] = this.def.defaultRange;
    const floor = Math.abs(dHi - dLo) * ADAPT_FLOOR_SHARE;
    const reach = Math.max(Math.abs(median(this.shortPeaks) * span), floor);
    this.r = [lo, lo + Math.sign(span) * reach];
    this.shortPeaks = [];
    events.push({ kind: "range", range: this.range, reason: "adapt_down", t });
  }
}

export function ruleThreshold(rule: CompensationRule, prf: PRF): number {
  return (rule.absolute ? 0 : (prf.baselines[rule.metric] ?? 0)) + rule.delta;
}

function stopEvents(def: ExerciseDef, hit: string, lean: number, t: number): EngineEvent[] {
  return [
    { kind: "flag", ruleId: hit, cue: def.trunkSafety!.cue, severity: "safety", value: lean, t },
    { kind: "stop", ruleId: hit, t },
  ];
}

/**
 * S0 on every frame the workout session sees, before its framing gate (Session.tsx): "whichever is
 * reached first stops the set" holds whatever the framing says. In training, the engine's full stop
 * (relative and absolute, from the calibration); during calibration (`engine` null), the absolute
 * cap (b), which needs no calibration, so repeated loaded reps beyond it never go on unchecked.
 */
export function frameTrunkStop(def: ExerciseDef, mf: MetricFrame, engine: RepEngine | null): EngineEvent[] {
  if (engine) return engine.safetyStep(mf);
  const lean = mf.values.trunk_lean;
  if (lean === undefined) return [];
  const hit = capStopFor(def, lean, mf.values.nose_offset);
  return hit ? stopEvents(def, hit, lean, mf.t) : [];
}

/**
 * S0 while the workout calibrates (Session.tsx, stage "calibrating"): a posture at or beyond the
 * absolute cap before the set has started is the pre-set block (council S0: the set does not start;
 * "Sit as upright as you comfortably can, then we will start"), never a stop with its RPE. Returns the
 * block's cue, or null. The stop with stop_rest stays for the set itself (training).
 */
export function calibrationBlock(def: ExerciseDef, mf: MetricFrame): CueId | null {
  const lean = mf.values.trunk_lean;
  if (lean === undefined || !def.trunkSafety) return null;
  return capStopFor(def, lean, mf.values.nose_offset) ? def.trunkSafety.presetCue : null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
