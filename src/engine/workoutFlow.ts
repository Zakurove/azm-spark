/**
 * One workout set as the camera screen runs it (booth v2, contract A2, A3 and A5). Pure TS, no DOM:
 * the camera screen (Session.tsx) feeds every pose frame and draws what comes back, and the tests
 * run the same flow on synthetic traces.
 *
 *   framing      the person fits the calm outline (required joints seen for FRAMED_MS);
 *   start        the start position, held 1 s (startPosition.ts); a posture beyond the trunk cap
 *                is the pre-set block (S0) and the hold starts again;
 *   calibrating  the first 2 comfortable reps set the personal range (calibration.ts); a posture
 *                beyond the cap, or a calibrated posture beyond it, goes back to the start;
 *   training     the rep engine counts on the personal range (repEngine.ts); the trunk safety stop
 *                (S0) acts on every frame, framed or not;
 *   finished     the target reps are counted;  stopped  the safety stop ended the set.
 *
 * Every caption and spoken line goes through the calm feedback gate (feedbackGate.ts). Stage lines
 * (the start position, "let's find your range") are spoken only when the gate's limits allow.
 */
import { Calibrator } from "./calibration";
import { FeedbackGate, FramingHinter, type GateMessage, type Presence } from "./feedbackGate";
import { computeMetrics, trunkLength } from "./geometry";
import { PoseSmoother } from "./oneEuro";
import { calibrationBlock, frameTrunkStop, RepEngine } from "./repEngine";
import { StartGate } from "./startPosition";
import { presetBlock } from "./trunkSafety";
import {
  CueId,
  EngineEvent,
  ExerciseDef,
  Frame,
  ImpairmentProfile,
  LM,
  MetricFrame,
  RepClass,
  SessionSummary,
} from "./types";

export type FlowStage = "framing" | "start" | "calibrating" | "training" | "finished" | "stopped";
export type RepPhase = "idle" | "lifting" | "top" | "lowering";

/**
 * Presence (none, partial, ok) as the screen and the hints use it is the value of most of the last
 * PRESENCE_MS of frames, so a joint blinking at the frame edge never reads as out of the picture.
 * The engine itself still skips every frame whose required joints are not seen.
 */
export const PRESENCE_MS = 400;
export const PRESENCE_SHARE = 0.7;
/** The required joints must be seen this long before the start position is looked for. */
export const FRAMED_MS = 500;
/** Lost this long during the start position, the screen goes back to the outline. */
export const UNFRAMED_MS = 1000;
/** S0: at most one pre-set block line every 4 s while the person settles (council S0). */
export const PRESET_CUE_EVERY_MS = 4000;

export interface FlowView {
  /** The smoothed frame, for the overlay. */
  frame: Frame;
  mf: MetricFrame;
  stage: FlowStage;
  presence: Presence;
  /** 0..1 of the start position hold. */
  startHold: number;
  /** Comfortable reps measured, of `calNeeded`. */
  calReps: number;
  calNeeded: number;
  /** Position in the personal range while training (0 bottom, 1 top, up to 1.15), else null. */
  pct: number | null;
  phase: RepPhase;
  /** Counted reps (valid and compensated) and the target. */
  count: number;
  target: number;
  /** The one caption line, from the gate. */
  caption: GateMessage | null;
  /** Lines to speak now (gate approved). */
  speak: GateMessage[];
  /** Engine events of this frame (reps, flags, the stop, range moves). */
  events: EngineEvent[];
}

export interface RepRecord {
  cls: RepClass;
  durSec: number;
  peakPct: number;
}

const cueMessage = (cue: CueId, severity: GateMessage["severity"]): GateMessage => ({
  id: cue,
  severity,
  voice: cue,
});

export class WorkoutFlow {
  private smoother = new PoseSmoother();
  private gate = new FeedbackGate();
  private hinter = new FramingHinter();
  private startGate: StartGate;
  private calibrator: Calibrator | null = null;
  private eng: RepEngine | null = null;
  private st: FlowStage = "framing";
  private framedSince: number | null = null;
  private unframedSince: number | null = null;
  private shown: Presence = "none";
  private recent: { t: number; value: Presence }[] = [];
  private lastPresetCue = -Infinity;
  private ph: RepPhase = "idle";
  private lastPct: number | null = null;
  private counted = 0;
  readonly counts = { valid: 0, partial: 0, compensated: 0 };
  readonly flags: Record<string, number> = {};
  readonly moments: RepRecord[] = [];
  /** The time (ms, frame clock) training began, or null. */
  trainingSince: number | null = null;

  constructor(
    private def: ExerciseDef,
    private profile: ImpairmentProfile,
    private required: number[],
    private target = def.targetReps,
    private calReps = 2,
  ) {
    this.startGate = new StartGate(def, profile);
  }

  get stage(): FlowStage {
    return this.st;
  }
  get engine(): RepEngine | null {
    return this.eng;
  }

  step(raw: Frame): FlowView {
    const sm = this.smoother.smoothFrame(raw);
    const mf = computeMetrics(sm, this.def.metrics, this.required);
    const t = raw.t;
    const shoulders = mf.usable[LM.l_shoulder] && mf.usable[LM.r_shoulder];
    const presence = this.debounce(mf.framingOk ? "ok" : shoulders ? "partial" : "none", t);
    const size = presence === "none" ? undefined : trunkLength(sm.lm, sm.aspect);
    const distance = this.hinter.hint(presence, size);
    const events: EngineEvent[] = [];
    const said: GateMessage[] = [];
    const gateEvents: GateMessage[] = [];
    let condition: GateMessage | null = null;

    if (presence === "ok") {
      this.framedSince ??= t;
      this.unframedSince = null;
    } else {
      this.unframedSince ??= t;
      this.framedSince = null;
    }
    const framingHint = (): GateMessage | null =>
      distance === "move_closer"
        ? { id: "move_closer", severity: "info", group: "framing" }
        : distance === "move_back"
          ? { id: "move_back", severity: "info", voice: "move_back", group: "framing" }
          : null;

    switch (this.st) {
      case "framing": {
        condition = framingHint();
        if (this.framedSince !== null && t - this.framedSince >= FRAMED_MS) this.enter("start", t, said);
        break;
      }
      case "start": {
        condition = framingHint();
        if (this.unframedSince !== null && t - this.unframedSince >= UNFRAMED_MS) {
          this.startGate.reset();
          this.enter("framing", t, said);
          break;
        }
        if (this.blocked(mf, t, gateEvents)) {
          this.startGate.reset();
          break;
        }
        if (presence !== "ok") break;
        this.startGate.feed(mf);
        if (this.startGate.ready) {
          this.calibrator = new Calibrator(this.def, {
            reps: this.calReps,
            startValue: this.startGate.startValue,
          });
          this.enter("calibrating", t, said);
        }
        break;
      }
      case "calibrating": {
        if (this.blocked(mf, t, gateEvents)) {
          this.backToStart(t, said);
          break;
        }
        if (!mf.framingOk) {
          if (presence !== "ok") condition = this.lostHint();
          break;
        }
        this.calibrator!.feed(mf);
        if (!this.calibrator!.ready()) break;
        const prf = this.calibrator!.build(t);
        const block = presetBlock(this.def, prf);
        if (block) {
          gateEvents.push(cueMessage(block, "safety"));
          this.lastPresetCue = t;
          this.backToStart(t, said);
          break;
        }
        this.eng = new RepEngine(this.def, prf, this.profile);
        this.calibrator = null;
        this.trainingSince = t;
        this.st = "training";
        this.gate.clear();
        gateEvents.push({ id: "range_ready", severity: "praise", voice: "training" });
        break;
      }
      case "training": {
        const stop = frameTrunkStop(this.def, mf, this.eng);
        if (stop.length) {
          this.handle(stop, events, gateEvents);
          break;
        }
        if (!mf.framingOk) {
          if (presence !== "ok") condition = this.lostHint();
          break;
        }
        this.handle(this.eng!.step(mf), events, gateEvents);
        break;
      }
      default:
        break;
    }

    const out = this.gate.step(t, condition, gateEvents);
    return {
      frame: sm,
      mf,
      stage: this.st,
      presence,
      startHold: this.st === "start" ? this.startGate.hold(t) : this.st === "framing" ? 0 : 1,
      calReps: this.calibrator?.reps ?? (this.eng ? this.calReps : 0),
      calNeeded: this.calReps,
      pct: this.st === "training" || this.st === "finished" ? this.lastPct : null,
      phase: this.ph,
      count: this.counted,
      target: this.target,
      caption: out.shown,
      speak: [...said, ...out.speak],
      events,
    };
  }

  /** The set's results: reps, flags, best range share, the measure and the steady reps (A4). */
  summary(): Pick<SessionSummary, "reps" | "flags" | "romPct" | "measure" | "steadyReps"> {
    return {
      reps: { ...this.counts },
      flags: { ...this.flags },
      romPct: this.eng ? Math.min(100, Math.round(this.eng.bestRom * 100)) : undefined,
      measure: this.eng?.measure(),
      steadyReps: this.eng?.steadyReps ?? 0,
    };
  }

  private lostHint(): GateMessage {
    return { id: "get_in_frame", severity: "warn", voice: "get_in_frame", group: "framing" };
  }

  /**
   * The presence the screen shows: the value seen in at least PRESENCE_SHARE of the frames of the
   * last PRESENCE_MS. A joint that blinks out one frame in four keeps the person "ok"; a person who
   * steps out turns "partial" within PRESENCE_MS.
   */
  private debounce(raw: Presence, t: number): Presence {
    this.recent.push({ t, value: raw });
    while (this.recent.length && t - this.recent[0].t > PRESENCE_MS) this.recent.shift();
    for (const value of ["ok", "partial", "none"] as const) {
      const share = this.recent.filter((r) => r.value === value).length / this.recent.length;
      if (share >= PRESENCE_SHARE) this.shown = value;
    }
    return this.shown;
  }

  /** S0 pre-set block before the set starts; true when the posture is beyond the cap. */
  private blocked(mf: MetricFrame, t: number, gateEvents: GateMessage[]): boolean {
    const block = calibrationBlock(this.def, mf);
    if (!block) return false;
    if (t - this.lastPresetCue >= PRESET_CUE_EVERY_MS) {
      this.lastPresetCue = t;
      gateEvents.push(cueMessage(block, "safety"));
    }
    return true;
  }

  private backToStart(t: number, said: GateMessage[]): void {
    this.calibrator = null;
    this.startGate.reset();
    this.enter("start", t, said);
  }

  private enter(stage: FlowStage, t: number, said: GateMessage[]): void {
    this.st = stage;
    const line: GateMessage | null =
      stage === "start"
        ? { id: "start_position", severity: "info", voice: `${this.def.id}_0` }
        : stage === "calibrating"
          ? { id: "calibration", severity: "info", voice: "calibration" }
          : null;
    if (line && this.gate.maySpeak(t, line)) said.push(line);
  }

  private handle(evs: EngineEvent[], events: EngineEvent[], gateEvents: GateMessage[]): void {
    for (const ev of evs) {
      events.push(ev);
      if (ev.kind === "progress") this.lastPct = ev.pct;
      else if (ev.kind === "phase") this.ph = ev.phase;
      else if (ev.kind === "flag") {
        this.flags[ev.ruleId] = (this.flags[ev.ruleId] ?? 0) + 1;
        gateEvents.push(cueMessage(ev.cue, ev.severity));
      } else if (ev.kind === "stop") {
        this.st = "stopped";
      } else if (ev.kind === "rep") {
        this.counts[ev.cls] += 1;
        this.moments.push({ cls: ev.cls, durSec: ev.durSec, peakPct: ev.peakPct });
        if (ev.cls !== "partial") {
          this.counted = ev.count;
          if (this.counted >= this.target) this.st = "finished";
        }
      }
    }
  }
}
