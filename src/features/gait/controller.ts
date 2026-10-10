/**
 * The walk of the focus check as a pure state machine (product v7 contract 2.8, 2.8.4, 2.9, C-15,
 * C-16, C-17; gait-rules capture, eligibility.padSafety and eligibility.stops; stream C, step C4).
 * GaitCapture.tsx renders it, hands it the person's taps and the camera frames, and posts its result;
 * nothing here touches the DOM, so the tests run whole walks on the gait fixtures.
 *
 * Steps, each with its C-16 kind (the coach presses a step's button only on the person's spoken words,
 * through the buttons the screen registers in `actions`, D-036 item 2; the pad's checklist stays a tap):
 *   - intro (info), the mode when both are allowed (question), the shoes and a leg brace (question);
 *   - overground (D-036 item 6: one walk, the side view only): the clear path (confirm); the side
 *     recording (the phone's placement, confirm; 3 s standing, active; the passes across the picture,
 *     active); the static single leg stance when planned (its place, confirm; the hold on each leg,
 *     active). The plan's front and back views are not walked: the findings that need them are not
 *     assessed, and the card simply leaves them out;
 *   - walking pad: the pad safety steps of gait-rules eligibility.padSafety as one checklist with one
 *     Ready (D-032 item 2: the floor, clear space and the stop control or safety key; the foot speed
 *     control off; the support away from the phone), a confirm step; then per planned view: the
 *     phone's placement (confirm), the person on the
 *     stopped belt (confirm), 3 s standing (active), the belt up to the comfortable speed (confirm),
 *     the 2 minute warm up before the first view (timer), the recording (active); the pad stopped
 *     (confirm); the static stance when planned; the speed and the handrail hold (question).
 * Capture (D-036 item 6): a fixed target that finishes. The side recording walks its fixed number of
 * passes (gait-rules capture.overground.side.passes, 4; each pass one walk across the picture, counted
 * by sidePasses.ts) and ends a moment after the last one; a pad view records its fixed seconds. The
 * target never grows. The recording is then read with whatever it holds (full, timing only, or not
 * enough). Not enough asks one calm «try once more», with «go on» always beside it; a second try that
 * gives too little goes on by itself. Every recording is kept and posted with its reasons (D-035 item
 * 4: stored on failure). «I have finished» on the walk's screen reads the recording at once, and an
 * overground recording ends at 2 minutes whatever happens. The analysis runs at the end only
 * (analyseGaitView is never fed live: the recorder and the live counter are, 2.8).
 * Pain (C-15, the 2.11 gait row): any mark_pain ends the recording and is kept for the rules
 * (GaitAnalysis.walkPain); painStopRule against the walk's score before (painBefore, W2-5, D-027
 * item 1) ends the test, labelled pain_limited, with the completed clean cycles kept; below it the
 * screen asks for a tap to walk again. STOP and the coach's stop end the recording and open the
 * shell's stop list; on the pad the stop line asks the person to hold the support and the helper to
 * stop the belt (eligibility.stops).
 */
import { capture as captureData, eligibility as eligibilityData } from "../../movements/gait/gait-v7.json";
import type { GaitData } from "../../movements/gait/types";
import { analyseGaitGroup, analyseStaticStance, combineViews } from "../../engine/gait/analyse";
import { LiveStepCounter, type LiveFacing } from "../../engine/gait/live";
import { CAPTURE_COUNT_MAX, ENGINE_VERSION, GAIT_ENGINE, GAIT_MVP } from "../../engine/gait/params";
import { GaitRecorder } from "../../engine/gait/recorder";
import {
  groupPassed,
  isTimingReading,
  walkVerdict,
  type WalkLevel,
  type WalkReason,
} from "../../engine/gait/verdict";
import type {
  GaitAnalysis,
  GaitCaptureCounts,
  GaitFrame,
  GaitSetup,
  GaitView,
  GaitViewResult,
  GaitWalkPain,
  StaticStanceResult,
} from "../../engine/gait/types";
import { posesOf, SUBJECT_RULES, SubjectLock } from "../../engine/subject";
import type { Frame, Landmark } from "../../engine/types";
import type { GaitMode, GaitPlan } from "../../medical/gait-eligibility";
import { painStopRule } from "../../medical/pain-rule";
import type { Intake, WalkingAid } from "../../medical/plan";
import type {
  BridgeEvent,
  CoachHost,
  CoachStepKind,
  CoachStopReason,
  ToolArgs,
  ToolName,
  ToolResult,
} from "../../coach/types";
import { EMERGENCY_REASONS, pauseRefusal, resumeRefusal, type PausedBy } from "../coach-agent/hostRules";
import { pressNextStep, ScreenActions } from "../../coach/actions";

const CAPTURE = captureData as unknown as GaitData["capture"];
const PAD_SAFETY = (eligibilityData as unknown as GaitData["eligibility"]).padSafety;

/* -------------------------------------------------------------- numbers */

/** gait-rules capture and eligibility.padSafety, as the capture uses them (held equal by c-gait-controller). */
export const CAPTURE_RULES = {
  /** «3 s standing calibration» */
  standingSec: CAPTURE.common.standingCalibration_s,
  /** «30 per side view» */
  padSideSec: CAPTURE.walking_pad.side.durationPerView_s,
  /** the pad front view's 20 s */
  padFrontSec: CAPTURE.walking_pad.front.duration_s,
  /** «hip, knee and ankle visibility >= 0.5 in 90% of warm up frames» */
  padGate: CAPTURE.walking_pad.setupGate,
  /** overground side passes: the walk's fixed target (D-036 item 6, it never grows) */
  sidePasses: CAPTURE.overground.side.passes,
  /** «single leg stance on each leg for up to 10 s» */
  stanceHoldSec: CAPTURE.staticSingleLegStance.holdMax_s,
  /** «warm up 2 min»; «familiarised flag only when total pad time >= 6 min» */
  warmUpMin: PAD_SAFETY.find((s) => s.warmUp_min !== undefined)?.warmUp_min ?? 2,
  familiarisedMin: PAD_SAFETY.find((s) => s.familiarisedFrom_min !== undefined)?.familiarisedFrom_min ?? 6,
  /** «6 or more clean cycles per side» (per view group) */
  cleanCycles: GAIT_ENGINE.cleanCyclesPerSide,
  /** «median processed fps 25 or more; 20 to 24 timing only; under 20 record again» */
  recordAgainBelowFps: GAIT_ENGINE.recordAgainBelowFps,
} as const;

/**
 * Engineering choices of the capture, no clinical number (D-036 item 6): the side recording ends 2 s
 * after its last pass is counted (the person reaches the end of the path); an overground recording
 * ends at 2 minutes whatever happens (and the recorder keeps no more); a recording is tried at most
 * twice (one «try once more»); the person has 3 s to change legs in the static stance. The walker is
 * followed by one lock for the whole walk (D-037 item 4, SubjectLock mode "walk": leaving the picture
 * at each pass's end is normal, so another person in the picture is never taken for the walker; "stay"
 * while they stand for a calibration or walk on the pad).
 */
export const CAPTURE_LIMITS = {
  afterLastPassMs: 2000,
  overgroundMaxSec: 120,
  maxTries: 2,
  stanceSwitchMs: 3000,
} as const;

/** The pad's speed bounds, km/h (the gait route's: 0.5 to 6.0). */
export const PAD_SPEED_KMH = { min: 0.5, max: 6, step: 0.1 } as const;
/** Kilometres in a mile, for a speed entered in mph. */
export const KM_PER_MILE = 1.609344;
/** The gait route's height bounds (cm). */
const HEIGHT_CM = { min: 120, max: 220 } as const;

/* ---------------------------------------------------------------- steps */

/** A recording of the walk: the overground side one (D-036 item 6), or a pad view. */
export type RecordingId = "overground_side" | "pad_side_a" | "pad_side_b" | "pad_front";

export type GaitStepId =
  | "intro"
  | "mode"
  | "gear"
  | "clear_path"
  | "pad_check"
  | "place"
  | "pad_on"
  | "stand"
  | "pad_start"
  | "pad_warm_up"
  | "walk"
  | "walk_again"
  | "retry"
  | "pad_stop"
  | "stance_place"
  | "stance"
  | "pad_details"
  | "saving"
  | "save_error"
  | "pain_stop"
  | "stopped"
  | "nothing"
  | "done";

export interface GaitStep {
  id: GaitStepId;
  /** The recording a place, stand, pad_start, walk or retry step belongs to. */
  rec?: RecordingId;
}

/** The kind of each step (C-16). */
export const STEP_KIND: Record<GaitStepId, CoachStepKind> = {
  intro: "info",
  mode: "question",
  gear: "question",
  clear_path: "confirm",
  pad_check: "confirm",
  place: "confirm",
  pad_on: "confirm",
  stand: "active",
  pad_start: "confirm",
  pad_warm_up: "timer",
  walk: "active",
  walk_again: "confirm",
  retry: "question",
  pad_stop: "confirm",
  stance_place: "confirm",
  stance: "active",
  pad_details: "question",
  saving: "info",
  save_error: "question",
  pain_stop: "safety",
  stopped: "safety",
  nothing: "info",
  done: "info",
};

/** The steps the camera runs for: placing the phone, standing, walking, the warm up, the stance. */
export const CAMERA_STEPS: ReadonlySet<GaitStepId> = new Set([
  "place",
  "pad_on",
  "stand",
  "pad_start",
  "pad_warm_up",
  "walk",
  "walk_again",
  "stance_place",
  "stance",
]);

/** The local voice line of a step, said when it opens (the voice script's gait lines, A6b). */
const STEP_LINE: Partial<Record<GaitStepId, string>> = {
  intro: "gait_stop_any_time",
  clear_path: "gait_clear_path",
  pad_check: "gait_pad_key",
  pad_on: "gait_pad_start",
  stance: "gait_single_leg_static",
  retry: "gait_quality_retry",
};

/**
 * The overground walk's line (gait.json walk.sideSay): shown on the walk's screen and given to the Live
 * coach, which says it in its own words (D-036 items 1 and 6: no phone speech, one side walk).
 */
export const WALK_LINE = { side: "gait.walk.sideSay" } as const;

/* ------------------------------------------------------------- recordings */

export type Orthosis = "afo" | "kafo" | "knee_brace";
export interface GearAnswer {
  shoes: boolean;
  brace: { kind: Orthosis; side: "left" | "right" | "both" } | null;
}

/** What the screen shows during a recording. */
export interface LiveView {
  /** Steps counted live (LiveStepCounter, never stored). */
  steps: number;
  /** Passes walked (never more than the target), and the fixed target (D-036 item 6; 0 on the pad). */
  passes: number;
  target: number;
  /** Pad views: seconds recorded, and the fixed seconds of the view. */
  seconds: number;
  plannedSeconds: number;
  facing: LiveFacing;
  /** «checking»: the target is reached (or the person finished) and the recording is being read. */
  phase: "standing" | "walking" | "checking";
  /** A calm hint about the picture, or null. */
  hint: GaitHint | null;
}

/**
 * «across»: the person walks toward or away from the phone in the side recording; «further»: they
 * turn back too soon for a walk across to count (D-036 item 6).
 */
export type GaitHint =
  "no_person" | "second_person" | "feet" | "legs" | "light" | "level" | "across" | "further";

/** The walker in one frame (GaitController.walker). */
interface Walker {
  lm: Landmark[] | null;
  counted: Landmark[] | null;
  crowded: boolean;
}
const NOBODY: Walker = { lm: null, counted: null, crowded: false };
/** The steps whose frames are the walker's: the lock is taken on the first of them. */
const PICK_STEPS: ReadonlySet<string> = new Set(["stand", "walk", "pad_warm_up", "stance"]);

interface Recording {
  id: RecordingId;
  /** The engine views this recording gives (the plan's, in order). */
  views: { view: GaitView; nearSide?: "left" | "right" }[];
  standing: GaitFrame[];
  recorder: GaitRecorder;
  counter: LiveStepCounter;
  rolls: number[];
  poseModel: "lite" | "full";
  /** The fixed target (D-036 item 6): overground the passes, on the pad the seconds. It never grows. */
  target: number;
  steps: number;
  /** Passes counted live (may pass the target while the walk ends; the screen never shows more). */
  passes: number;
  /** When the target was reached (overground), or null. */
  reachedAt: number | null;
  /** The try now: 1, or 2 after «try once more» (CAPTURE_LIMITS.maxTries). */
  tries: number;
  /** Active recording time (ms), pauses left out. */
  activeMs: number;
  lastT: number | null;
  /** The analysed views at the end of the recording. */
  results: GaitViewResult[];
  done: boolean;
  skipped: boolean;
  /** The recording passed its group's gate at its last check. */
  gatePassed: boolean;
  /**
   * Walk frames, those with both hips and both ankles seen, those with another person over the
   * walker, and those walking toward or away from the phone (the side walk).
   */
  walkFrames: number;
  seenFrames: number;
  crowdedFrames: number;
  depthFrames: number;
}

/** One leg of the static stance: its frames, from the person lifting it. */
interface StanceLeg {
  side: "left" | "right";
  frames: GaitFrame[];
  startedAt: number | null;
}

export type GaitOutcome = "done" | "pain_limited" | "stopped" | "nothing";

/** The body of POST /api/focus/:id/gait (2.8, section 4). */
export interface GaitBody {
  setup: GaitSetup;
  analysis: GaitAnalysis;
}

export interface GaitControllerOptions {
  plan: GaitPlan;
  /** C-15: the walk's score before (the highest pain now of the regions a walk loads); null counts as 0. */
  painBefore?: number | null;
  /** The intake's walking aid, height and body map (the setup's aid, height and prosthesis side). */
  intake?: Pick<Intake, "walking" | "heightCm" | "regions"> | null;
  /** The pose model of the camera now (C-10), recorded per view. */
  poseModel?: () => "lite" | "full";
  /** E2E fast timing: the warm up in seconds (default 2 minutes). */
  warmUpSec?: number;
  /**
   * Where the walk's diagnostic lines go (D-035 item 4): the end of each recording and of the walk, «[azm gait] ...»
   * with the passes counted, the clean cycles a side, the share of frames with the legs seen, the frame
   * rate and the reasons. Default: the browser console (never a landmark or a picture).
   */
  log?: (line: string) => void;
}

/** What a recording found (D-035 item 4): the lab shows it, the log writes it, the card reads its level. */
export interface RecordingDiagnostics {
  rec: RecordingId;
  /** Passes counted live (one walk across the picture each), and steps. */
  passes: number;
  steps: number;
  /** The fixed target, and the try (1, or 2 after «try once more»). */
  target: number;
  tries: number;
  /** Seconds walked (pauses left out). */
  seconds: number;
  /** The lowest frame rate of the recording's views (mean inside the passes), or null before its end. */
  fps: number | null;
  /** The share of the walk's frames with both hips and both ankles seen (0 to 1), or null before frames. */
  visibleShare: number | null;
  /** Clean cycles a side (the verdict's group). */
  cleanCycles: { left: number; right: number };
  level: WalkLevel | null;
  reasons: WalkReason[];
  cadence: number | null;
  stepTime: { left: number | null; right: number | null };
  /** Each view's quality issues. */
  views: {
    view: GaitView;
    issues: string[];
    cleanCycles: { left: number; right: number };
    gapShare: number;
  }[];
  skipped: boolean;
}

/** The calm line a failed recording shows: what to change (D-035 item 2). */
export type RetryReason = "side_on" | "no_person" | "light" | "whole_body" | "more_steps" | "one_person";

const EMPTY_LM = (): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const seen = (lm: Landmark[] | null | undefined, ids: readonly number[]) =>
  !!lm && ids.every((i) => (lm[i]?.visibility ?? 0) >= GAIT_ENGINE.visibilityMin);
/** The time a run of frames covers: first to last, plus the last frame's own interval (to the ms). */
function coveredMs(frames: readonly { t: number }[]): number {
  const n = frames.length;
  if (n < 2) return 0;
  return Math.round(frames[n - 1].t - frames[0].t + (frames[n - 1].t - frames[n - 2].t));
}
const HIPS_ANKLES = [23, 24, 27, 28] as const;
/** How long the «walk across» hint stays after the person last walked toward or away from the phone. */
const ACROSS_HINT_MS = 3000;
const FEET = [27, 28, 29, 30, 31, 32] as const;
const LEG_IDS = { left: [23, 25, 27], right: [24, 26, 28] } as const;

/**
 * The walk's controller: one per gait step of a check. It implements CoachHost for the gait block
 * (2.11), with every step's C-16 kind.
 */
export class GaitController implements CoachHost {
  readonly block = "gait" as const;
  /** The buttons of the step now that the coach may press (D-036 item 2), registered by the screen. */
  readonly actions = new ScreenActions();
  readonly plan: GaitPlan;
  mode: GaitMode;
  gear: GearAnswer | null = null;
  padSpeedKmh: number | null = null;
  handrail: "none" | "light" | "firm" | null = null;
  /** The person found the pad's slowest speed too fast (modeChoice: the pad is not used). */
  padTooFast = false;
  /** Pain marked during the walk, in order (CG-8). */
  readonly walkPain: GaitWalkPain[] = [];
  outcome: GaitOutcome | null = null;
  /** The stop list is open (STOP, or the coach's stop with its reason). */
  stopList: { preselect: CoachStopReason | null } | null = null;
  /** The stored result, once saved. */
  stored: unknown = null;
  /** The person (or the coach's next_step) left the result card: the screen hands the result to the shell. */
  leaving = false;

  private steps: GaitStep[] = [];
  private index = 0;
  private readonly painBefore: number | null;
  private readonly opts: GaitControllerOptions;
  /** The intake's walking aid, height and body map, for the setup (it may come after the walk starts). */
  private intake: GaitControllerOptions["intake"];
  private readonly recordings = new Map<RecordingId, Recording>();
  private stance: {
    standing: GaitFrame[];
    legs: StanceLeg[];
    leg: number;
    switchUntil: number | null;
  } | null = null;
  /**
   * The walker, one person for the whole walk (D-037 item 4: the booth, many people in the picture):
   * taken at the standing calibration (taken again at each calibration step, the walker kept while
   * there), followed through every pass, a try once more and the stance; another person is never
   * measured, drawn or counted. Released only after the walk's 10 s unseen.
   */
  private readonly lock = new SubjectLock(SUBJECT_RULES, {
    mode: "stay",
    releaseMs: SUBJECT_RULES.walkReleaseMs,
    ignoreBehind: true,
  });
  /** A calibration step started: the lock is taken again on its first frame (the walker kept when there). */
  private retake = false;
  private pausedByNow: PausedBy = null;
  private stoppedNow = false;
  private timer: { until: number; total: number; left: number | null } | null = null;
  private pendingCheck = false;
  private hintNow: GaitHint | null = null;
  /** The «walk across» hint shows until then (ms). */
  private acrossUntil = -Infinity;
  private padStartedAt: number | null = null;
  private padEndedAt: number | null = null;
  private warmGate: { seen: number; total: number } = { seen: 0, total: 0 };
  private lastT = 0;
  private readonly listeners = new Set<() => void>();
  private readonly bridges = new Set<(e: BridgeEvent) => void>();
  private readonly lines = new Set<(line: string, severity: "info" | "warn" | "safety") => void>();
  /** True while the live coach speaks for the app: setup lines are then the coach's, not the voice pack's. */
  coachLive = false;
  /** The live coach was asked for this walk (the screen starts its audio inside the first tap). */
  coachOn = false;

  constructor(opts: GaitControllerOptions) {
    this.opts = opts;
    this.intake = opts.intake ?? null;
    this.plan = opts.plan;
    this.painBefore = opts.painBefore ?? null;
    this.mode = opts.plan.modes.includes(opts.plan.defaultMode)
      ? opts.plan.defaultMode
      : (opts.plan.modes[0] ?? "overground");
    this.steps = this.build();
  }

  /* ------------------------------------------------------------ listeners */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** The coach's events (2.11 BridgeEvent): step starts, pass ends, setup issues, safety stops. */
  onBridge(fn: (e: BridgeEvent) => void): () => void {
    this.bridges.add(fn);
    return () => this.bridges.delete(fn);
  }
  /** The local voice lines to say (the voice pack, when the voice is on). */
  onLine(fn: (line: string, severity: "info" | "warn" | "safety") => void): () => void {
    this.lines.add(fn);
    return () => this.lines.delete(fn);
  }
  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }
  private bridge(e: BridgeEvent): void {
    for (const fn of [...this.bridges]) fn(e);
  }
  private say(line: string, severity: "info" | "warn" | "safety"): void {
    // While the live coach speaks for the app, it gives the instructions; safety lines stay local.
    if (this.coachLive && severity !== "safety") return;
    for (const fn of [...this.lines]) fn(line, severity);
  }

  /* --------------------------------------------------------------- the plan */

  /** The steps of the chosen mode (C-16 kinds in STEP_KIND). */
  private build(): GaitStep[] {
    const p = this.plan;
    const head: GaitStep[] = [{ id: "intro" }];
    if (p.modes.length > 1 && !this.padTooFast) head.push({ id: "mode" });
    head.push({ id: "gear" });
    if (this.mode === "overground") {
      // D-036 item 6: one walk, the side view only (across the picture and back). The plan's front
      // and back views are not walked.
      const out = [...head, { id: "clear_path" } as GaitStep];
      if (p.views.overground.includes("side")) out.push(...this.recordingSteps("overground_side"));
      if (p.staticStance) out.push({ id: "stance_place" }, { id: "stance" });
      out.push({ id: "saving" }, { id: "done" });
      return out;
    }
    // The pad safety steps as one checklist with one Ready (D-032 item 2).
    const out: GaitStep[] = [...head, { id: "pad_check" }];
    // Per view: the phone placed while the belt is stopped, 3 s standing on the stopped belt (the view's
    // calibration), the belt up to the comfortable speed, the recording, the belt stopped again. The
    // person steps on once, before the first view, and warms up once (contract gap C4-3).
    this.padRecordings().forEach((rec, i) => {
      out.push({ id: "place", rec });
      if (i === 0) out.push({ id: "pad_on", rec });
      out.push({ id: "stand", rec }, { id: "pad_start", rec });
      if (i === 0) out.push({ id: "pad_warm_up", rec });
      out.push({ id: "walk", rec }, { id: "pad_stop", rec });
    });
    if (p.staticStance) out.push({ id: "stance_place" }, { id: "stance" });
    out.push({ id: "pad_details" }, { id: "saving" }, { id: "done" });
    return out;
  }

  private recordingSteps(rec: RecordingId): GaitStep[] {
    return [
      { id: "place", rec },
      { id: "stand", rec },
      { id: "walk", rec },
    ];
  }

  /** The pad recordings of the plan, in its order (the affected side first, then the other, then the front). */
  private padRecordings(): RecordingId[] {
    const out: RecordingId[] = [];
    let sides = 0;
    for (const v of this.plan.views.walking_pad) {
      if (v.view === "pad_front") out.push("pad_front");
      else out.push(sides++ === 0 ? "pad_side_a" : "pad_side_b");
    }
    return out;
  }

  /** The engine views a recording gives, from the plan. */
  viewsOf(rec: RecordingId): { view: GaitView; nearSide?: "left" | "right" }[] {
    if (rec === "overground_side") return [{ view: "side" }];
    if (rec === "pad_front") return [{ view: "pad_front" }];
    const sides = this.plan.views.walking_pad.filter((v) => v.view === "pad_side");
    const v = sides[rec === "pad_side_a" ? 0 : 1];
    return v ? [{ view: "pad_side", ...(v.nearSide ? { nearSide: v.nearSide } : {}) }] : [];
  }

  /* ------------------------------------------------------------ the state */

  get current(): GaitStep {
    return this.steps[this.index] ?? { id: "done" };
  }
  /** The steps of the walk (for the screen's progress). */
  get plannedSteps(): readonly GaitStep[] {
    return this.steps;
  }
  get pausedBy(): PausedBy {
    return this.pausedByNow;
  }
  get stopped(): boolean {
    return this.stoppedNow;
  }
  /** The recording of the current step, or null. */
  get recording(): Recording | null {
    const rec = this.current.rec;
    return rec ? this.recOf(rec) : null;
  }
  /** The hint shown now (a calm line about the picture). */
  get hint(): GaitHint | null {
    return this.hintNow;
  }

  /** What the screen shows during a recording, or null. */
  live(): LiveView | null {
    const s = this.current;
    if (!s.rec || (s.id !== "stand" && s.id !== "walk")) return null;
    const r = this.recOf(s.rec);
    const pad = s.rec.startsWith("pad");
    return {
      steps: r.steps,
      // D-036 item 6: «pass N of 4», never beyond the target.
      passes: pad ? 0 : Math.min(r.passes, r.target),
      target: pad ? 0 : r.target,
      // The pad's fixed seconds, never more on the screen.
      seconds: pad ? Math.min(r.target, Math.round(r.activeMs / 1000)) : Math.round(r.activeMs / 1000),
      plannedSeconds: pad ? r.target : 0,
      facing: null,
      phase:
        s.id === "stand" ? "standing" : this.pendingCheck || r.reachedAt !== null ? "checking" : "walking",
      hint: this.hintNow,
    };
  }

  /** The stance step: the leg now, its seconds left, or the change of legs. */
  stanceNow(now: number): {
    phase: "standing" | "leg" | "switch" | "done";
    side: "left" | "right" | null;
    leftMs: number;
  } {
    const st = this.stance;
    if (!st || this.current.id !== "stance") return { phase: "done", side: null, leftMs: 0 };
    const standingMs = CAPTURE_RULES.standingSec * 1000;
    if (coveredMs(st.standing) < standingMs) return { phase: "standing", side: null, leftMs: standingMs };
    if (st.switchUntil !== null)
      return { phase: "switch", side: st.legs[st.leg]?.side ?? null, leftMs: st.switchUntil - now };
    const leg = st.legs[st.leg];
    if (!leg) return { phase: "done", side: null, leftMs: 0 };
    const hold = CAPTURE_RULES.stanceHoldSec * 1000;
    return {
      phase: "leg",
      side: leg.side,
      leftMs: leg.startedAt === null ? hold : hold - (now - leg.startedAt),
    };
  }

  /** How much of the 3 s standing calibration is recorded (0 to 1): the stand step, or the stance's. */
  standingShare(): number {
    const s = this.current;
    const frames =
      s.id === "stand" && s.rec
        ? this.recOf(s.rec).standing
        : s.id === "stance" && this.stance
          ? this.stance.standing
          : [];
    return Math.max(0, Math.min(1, coveredMs(frames) / (CAPTURE_RULES.standingSec * 1000)));
  }

  /** The timer step's time left (the warm up). */
  timerLeft(now: number): number {
    const t = this.timer;
    if (!t) return 0;
    if (t.left !== null) return t.left;
    return Math.max(0, t.until - now);
  }
  get timerTotal(): number {
    return this.timer?.total ?? 0;
  }
  /** The warm up's leg visibility share (the pad's setup gate), or null before frames. */
  get warmUpGate(): number | null {
    return this.warmGate.total ? this.warmGate.seen / this.warmGate.total : null;
  }

  private recOf(id: RecordingId): Recording {
    let r = this.recordings.get(id);
    if (!r) {
      const pad = id.startsWith("pad");
      const view: GaitView =
        id === "overground_side" ? "side" : id === "pad_front" ? "pad_front" : "pad_side";
      const maxSec = pad
        ? (id === "pad_front" ? CAPTURE_RULES.padFrontSec : CAPTURE_RULES.padSideSec) + 10
        : CAPTURE_LIMITS.overgroundMaxSec + 10;
      r = {
        id,
        views: this.viewsOf(id),
        standing: [],
        recorder: new GaitRecorder(maxSec),
        counter: new LiveStepCounter(view),
        rolls: [],
        poseModel: this.opts.poseModel?.() ?? "full",
        target: this.targetOf(id),
        steps: 0,
        passes: 0,
        reachedAt: null,
        tries: 1,
        activeMs: 0,
        lastT: null,
        results: [],
        done: false,
        skipped: false,
        gatePassed: false,
        walkFrames: 0,
        seenFrames: 0,
        crowdedFrames: 0,
        depthFrames: 0,
      };
      this.recordings.set(id, r);
    }
    return r;
  }

  /** The recording's fixed target (D-036 item 6): the side passes, or the pad view's seconds. */
  private targetOf(id: RecordingId): number {
    switch (id) {
      case "overground_side":
        return CAPTURE_RULES.sidePasses;
      case "pad_front":
        return CAPTURE_RULES.padFrontSec;
      default:
        return CAPTURE_RULES.padSideSec;
    }
  }

  /* ------------------------------------------------------------- moving on */

  /** Starts the walk (the intro shows): its first step's event. */
  start(now: number): void {
    this.lastT = now;
    this.enter(now);
  }

  private go(to: number, now: number): void {
    this.index = Math.min(to, this.steps.length - 1);
    this.enter(now);
  }

  private nextStep(now: number): void {
    this.go(this.index + 1, now);
  }

  private enter(now: number): void {
    const s = this.current;
    this.pausedByNow = null;
    this.hintNow = null;
    this.acrossUntil = -Infinity;
    this.timer = null;
    if (s.id === "pad_warm_up") {
      const total = (this.opts.warmUpSec ?? CAPTURE_RULES.warmUpMin * 60) * 1000;
      this.timer = { until: now + total, total, left: null };
      this.warmGate = { seen: 0, total: 0 };
    }
    if (s.id === "stand" || s.id === "stance") this.retake = true;
    if (s.id === "stand" && s.rec) {
      const r = this.recOf(s.rec);
      r.standing = [];
      r.poseModel = this.opts.poseModel?.() ?? r.poseModel;
    }
    if (s.id === "stance")
      this.stance = {
        standing: [],
        legs: [
          { side: "right", frames: [], startedAt: null },
          { side: "left", frames: [], startedAt: null },
        ],
        leg: 0,
        switchUntil: null,
      };
    if (s.id === "saving") this.logEnd();
    if (s.id === "pad_start" && this.padStartedAt === null) this.padStartedAt = now;
    if (s.id === "pad_stop") this.padEndedAt = now;
    const line = STEP_LINE[s.id];
    if (line) this.say(line, "info");
    // D-035 item 2: the walk's own line (the screen's copy, gait.walk.sideSay).
    if (s.id === "walk" && s.rec === "overground_side") this.say(WALK_LINE.side, "info");
    // The belt is stopped while the helper moves the phone to the pad's other side (D-030 C4-3).
    if (s.id === "place" && s.rec === "pad_side_b") this.say("gait_pad_other_side", "info");
    this.bridge({ p: 3, type: "step_start", label: s.rec ? `${s.id}_${s.rec}` : s.id, t: now });
    this.changed();
  }

  /** The person's tap on an info or confirm step («التالي», «جاهز»). */
  confirm(now: number): boolean {
    const s = this.current;
    if (this.stopList || this.stoppedNow) return false;
    const kind = STEP_KIND[s.id];
    if (kind !== "info" && kind !== "confirm") return false;
    if (s.id === "saving" || s.id === "nothing" || s.id === "done") return false;
    if (s.id === "walk_again") {
      // Back to the recording the pain report ended, which goes on where it was.
      this.go(
        this.steps.findIndex((x) => x.id === "walk" && x.rec === s.rec),
        now,
      );
      return true;
    }
    this.nextStep(now);
    return true;
  }

  /** The mode question (overground or the walking pad), when both are allowed. */
  chooseMode(mode: GaitMode, now: number): boolean {
    if (this.current.id !== "mode" || !this.plan.modes.includes(mode)) return false;
    this.mode = mode;
    this.steps = this.build();
    this.index = this.steps.findIndex((s) => s.id === "mode");
    this.nextStep(now);
    return true;
  }

  /** The shoes and a leg brace (the setup's shoes and orthosis). */
  setGear(gear: GearAnswer, now: number): boolean {
    if (this.current.id !== "gear") return false;
    this.gear = gear;
    this.nextStep(now);
    return true;
  }

  /**
   * «The slowest speed is too fast for me» (modeChoice: the comfortable speed is not below the pad's
   * lowest speed): the pad is not used today; the walk goes on overground, from the clear path.
   */
  padTooSlowForMe(now: number): boolean {
    if (this.mode !== "walking_pad" || !this.current.rec || !this.plan.modes.includes("overground"))
      return false;
    if (this.current.id !== "pad_start" && this.current.id !== "pad_on") return false;
    this.padTooFast = true;
    this.mode = "overground";
    for (const id of ["pad_side_a", "pad_side_b", "pad_front"] as const) this.recordings.delete(id);
    this.padStartedAt = null;
    this.steps = this.build();
    this.go(
      this.steps.findIndex((s) => s.id === "clear_path"),
      now,
    );
    return true;
  }

  /**
   * The calm «try once more» (D-036 item 6: offered once): walk the recording again (true), or go on
   * with what it holds (false), which is kept and posted with its reasons.
   */
  retry(again: boolean, now: number): boolean {
    const s = this.current;
    if (s.id !== "retry" || !s.rec) return false;
    const r = this.recOf(s.rec);
    if (again && r.tries < CAPTURE_LIMITS.maxTries) {
      this.resetRecording(r);
      r.tries++;
      // Overground: back to placing the phone; on the pad the person keeps walking, the recording restarts.
      const at = s.rec.startsWith("pad")
        ? this.steps.findIndex((x) => x.id === "walk" && x.rec === s.rec)
        : this.steps.findIndex((x) => x.id === "place" && x.rec === s.rec);
      this.steps.splice(this.index, 1);
      this.go(at, now);
      return true;
    }
    // Go on: the recording is kept with its reasons (D-035 item 4: a walk never ends with nothing).
    r.done = true;
    this.steps.splice(this.index, 1);
    this.go(this.index, now);
    return true;
  }

  /**
   * The calm line of the re-record step: what to change (D-035 item 2), from the recording's last
   * check, or null before one.
   */
  retryReason(): RetryReason | null {
    const s = this.current;
    const r = s.rec ? this.recordings.get(s.rec) : undefined;
    if (!r) return null;
    const reasons = walkVerdict(r.results).reasons;
    const fps = Math.min(...r.results.map((v) => v.quality.medianFps));
    const share = (n: number) => (r.walkFrames > 0 ? n / r.walkFrames : 0);
    if (r.results.some((v) => v.quality.issues.includes("not_one_person")) || share(r.crowdedFrames) > 0.3)
      return "one_person";
    if (!r.results.length || (r.walkFrames > 0 && r.seenFrames / r.walkFrames < 0.2)) return "no_person";
    // Walking toward or away from the phone in the side recording (Nasser's third test, D-036 item 6).
    if (reasons.includes("wrong_view") || share(r.depthFrames) > 0.3) return "side_on";
    if (Number.isFinite(fps) && fps < CAPTURE_RULES.recordAgainBelowFps) return "light";
    if (reasons.includes("visibility") || reasons.includes("tracking")) return "whole_body";
    return "more_steps";
  }

  /** A recording walked again: everything but its try (the target is the same fixed one). */
  private resetRecording(r: Recording): void {
    const fresh = this.recordings.get(r.id);
    if (!fresh) return;
    fresh.recorder.reset();
    fresh.counter = new LiveStepCounter(r.views[0]?.view ?? "side");
    fresh.target = this.targetOf(r.id);
    fresh.steps = 0;
    fresh.passes = 0;
    fresh.reachedAt = null;
    fresh.activeMs = 0;
    fresh.lastT = null;
    fresh.results = [];
    fresh.done = false;
    fresh.skipped = false;
    fresh.gatePassed = false;
    fresh.rolls = [];
    fresh.walkFrames = 0;
    fresh.seenFrames = 0;
    fresh.crowdedFrames = 0;
    fresh.depthFrames = 0;
  }

  /** The pad's speed (km/h or mph, as the pad shows it) and the handrail hold, after the walk. */
  setPadDetails(
    speed: number,
    unit: "kmh" | "mph",
    handrail: "none" | "light" | "firm",
    now: number,
  ): boolean {
    if (this.current.id !== "pad_details") return false;
    const kmh = Math.round((unit === "mph" ? speed * KM_PER_MILE : speed) * 10) / 10;
    if (!(kmh >= PAD_SPEED_KMH.min && kmh <= PAD_SPEED_KMH.max)) return false;
    this.padSpeedKmh = kmh;
    this.handrail = handrail;
    this.nextStep(now);
    return true;
  }

  /** The stance step's «انتهيت» for the leg now (the person put the foot down before the 10 s). */
  stanceLegDone(now: number): boolean {
    if (this.current.id !== "stance" || !this.stance) return false;
    if (this.stanceNow(now).phase !== "leg") return false;
    this.endStanceLeg(now);
    return true;
  }

  private endStanceLeg(now: number): void {
    const st = this.stance!;
    st.leg++;
    if (st.leg >= st.legs.length) {
      this.nextStep(now);
      return;
    }
    st.switchUntil = now + CAPTURE_LIMITS.stanceSwitchMs;
    this.changed();
  }

  /** The save went through: the stored result (GaitStoredView) and the done card. */
  saved(stored: unknown, now: number): void {
    this.stored = stored;
    if (this.outcome === null) this.outcome = "done";
    if (this.current.id === "saving" || this.current.id === "save_error") {
      this.index = this.steps.findIndex((s) => s.id === "done");
      this.enter(now);
    } else this.changed();
  }

  /** «متابعة» on the result card (or the coach's next_step there). */
  leave(): void {
    const id = this.current.id;
    if (id !== "done" && id !== "nothing") return;
    this.leaving = true;
    this.changed();
  }

  /** Nothing to save (every view left out): the walk ends with no result. */
  nothingSaved(now: number): void {
    if (this.current.id !== "saving") return;
    this.outcome = "nothing";
    this.steps.splice(this.index + 1, 0, { id: "nothing" });
    this.nextStep(now);
  }

  /** The save failed: the screen offers to try again. */
  saveFailed(now: number): void {
    if (this.current.id !== "saving") return;
    this.steps.splice(this.index + 1, 0, { id: "save_error" });
    this.nextStep(now);
  }

  /** «حاول مرة أخرى» after a failed save. */
  saveAgain(now: number): boolean {
    if (this.current.id !== "save_error") return false;
    this.steps.splice(this.index, 1);
    this.index = this.steps.findIndex((s) => s.id === "saving");
    this.enter(now);
    return true;
  }

  /* -------------------------------------------------------------- frames */

  /** One camera frame: the standing calibration, the recording, the warm up gate, the stance. */
  feed(
    frame: Frame,
    env: { rollDeg: number | null; tilt?: { rollDeg: number } | null } = { rollDeg: null },
  ): void {
    const now = frame.t;
    this.lastT = now;
    const s = this.current;
    if (this.stopList || this.stoppedNow || this.pausedByNow) return;
    // The walker in this frame: the lock is first taken at the standing calibration, then follows
    // them on every camera frame, whatever the step. Walking across the picture, leaving it at each
    // pass's end is normal (the lock's "walk" rules: back from the side they left by); standing for a
    // calibration or on the pad, the person stays (its "stay" rules).
    this.lock.setMode(s.id === "walk" && s.rec === "overground_side" ? "walk" : "stay");
    const picks = PICK_STEPS.has(s.id) || this.lock.locked;
    if (this.retake && (s.id === "stand" || s.id === "stance")) {
      const poses = posesOf(frame);
      if (poses.length && this.lock.lock(poses, frame.aspect, frame.t)) this.retake = false;
    }
    const who = picks ? this.walker(frame) : NOBODY;
    if (s.id === "stand" && s.rec) return this.feedStanding(this.recOf(s.rec), frame, env.rollDeg, who);
    if (s.id === "walk" && s.rec) return this.feedWalk(this.recOf(s.rec), frame, env.rollDeg, who);
    if (s.id === "pad_warm_up" && s.rec) return this.feedWarmUp(who);
    if (s.id === "stance") return this.feedStance(frame, who);
    if (s.id === "place") {
      // «level within 5 deg»: the phone's roll from the orientation, when the phone gives one.
      const level = env.tilt ? Math.abs(env.tilt.rollDeg) <= CAPTURE.walking_pad.side.levelWithinDeg : true;
      this.setHint(level ? null : "level");
    }
  }

  private setHint(h: GaitHint | null): void {
    if (h === this.hintNow) return;
    this.hintNow = h;
    if (h) this.bridge({ p: 2, type: "setup_issue", issue: h, t: this.lastT });
    this.changed();
  }

  /**
   * The walker in a frame (gait-rules capture.common.onePerson: «subject lock and overlap pause
   * apply»; D-037 item 4: one person per camera). The walk's one lock (mode "walk") is taken on the
   * person the walk is for (the one in the picture, of a size, nearest its centre: a helper or a
   * passer-by beside or behind is not) and follows them: across the picture, out of it at each
   * pass's end and back from that side, never handing the walk to someone standing in the picture.
   *   - `lm`: the lock's trusted walker (the recorder keeps only these, so the analysis never reads
   *     two people), null while the lock pauses (an overlap, a touch) or the walker is not seen;
   *   - `counted`: what the pass counter reads, also the walker while another person overlaps them (a
   *     helper beside the walker: the body's centre is the same);
   *   - `crowded`: the pause came from another person over the walker.
   */
  private walker(frame: Frame): { lm: Landmark[] | null; counted: Landmark[] | null; crowded: boolean } {
    const lock = this.lock;
    if (!lock.locked) {
      const poses = posesOf(frame);
      if (!poses.length || !lock.lock(poses, frame.aspect, frame.t))
        return { lm: null, counted: null, crowded: false };
    }
    const pick = lock.pickFrame(frame);
    const crowded = pick.paused && pick.others > 0 && (pick.touching || pick.overlap > 0);
    if (!pick.lm) return { lm: null, counted: null, crowded };
    if (pick.paused) return { lm: null, counted: pick.reason === "overlap" ? pick.lm : null, crowded };
    return { lm: pick.lm, counted: pick.lm, crowded: false };
  }

  private feedStanding(r: Recording, frame: Frame, roll: number | null, who: Walker): void {
    const { lm, crowded } = who;
    if (!lm || !seen(lm, HIPS_ANKLES))
      return this.setHint(lm ? "feet" : crowded ? "second_person" : "no_person");
    this.setHint(null);
    if (roll !== null && Number.isFinite(roll)) r.rolls.push(roll);
    r.standing.push({ t: frame.t, lm, aspect: frame.aspect ?? 1 });
    if (coveredMs(r.standing) >= CAPTURE_RULES.standingSec * 1000) {
      this.bridge({ p: 3, type: "step_start", label: `standing_done_${r.id}`, t: frame.t });
      this.nextStep(frame.t);
    }
  }

  private feedWalk(r: Recording, frame: Frame, roll: number | null, who: Walker): void {
    if (r.done || this.pendingCheck) return;
    const { lm, counted, crowded } = who;
    const g: GaitFrame = { t: frame.t, lm: lm ?? EMPTY_LM(), aspect: frame.aspect ?? 1 };
    r.recorder.push(g);
    r.walkFrames++;
    if (lm && seen(lm, HIPS_ANKLES)) r.seenFrames++;
    if (crowded) r.crowdedFrames++;
    if (roll !== null && Number.isFinite(roll)) r.rolls.push(roll);
    if (r.lastT !== null) r.activeMs += Math.min(500, Math.max(0, frame.t - r.lastT));
    r.lastT = frame.t;
    const live = r.counter.feed(counted && counted !== lm ? { ...g, lm: counted } : g);
    if (live.steps > r.steps) r.steps = live.steps;
    this.countPasses(r, live.passes, frame.t);
    if (live.depth) {
      r.depthFrames++;
      this.acrossUntil = frame.t + ACROSS_HINT_MS;
    }
    // A calm hint: another person over the walker; the side walk toward or away from the phone
    // (D-036 item 6: «walk across the picture, not toward the phone»); on the pad also the feet out of
    // the picture or nobody (overground the walker leaves the picture at the ends of the path).
    const pad = r.id.startsWith("pad");
    this.setHint(
      crowded
        ? "second_person"
        : pad
          ? lm
            ? seen(lm, FEET)
              ? null
              : "feet"
            : "no_person"
          : frame.t < this.acrossUntil
            ? "across"
            : live.short
              ? "further"
              : null,
    );
    if (this.finishDue(r, frame.t)) this.pendingCheck = true;
    this.changed();
  }

  /** The passes counted live; the time the fixed target was reached (overground). True on a change. */
  private countPasses(r: Recording, passes: number, t: number): boolean {
    if (passes <= r.passes) return false;
    r.passes = passes;
    if (!r.id.startsWith("pad") && r.reachedAt === null && r.passes >= r.target) r.reachedAt = t;
    return true;
  }

  /**
   * The recording is over (D-036 item 6): the pad view's fixed seconds; overground a moment after the
   * last pass of the fixed target, or at the most time.
   */
  private finishDue(r: Recording, t: number): boolean {
    if (r.id.startsWith("pad")) return r.activeMs >= r.target * 1000;
    if (r.activeMs >= CAPTURE_LIMITS.overgroundMaxSec * 1000) return true;
    return r.reachedAt !== null && t - r.reachedAt >= CAPTURE_LIMITS.afterLastPassMs;
  }

  private feedWarmUp(who: Walker): void {
    const r = this.current.rec ? this.recOf(this.current.rec) : null;
    if (!r) return;
    const near = r.views[0]?.nearSide ?? "right";
    const lm = who.lm;
    const ok = seen(lm, LEG_IDS[near]);
    this.warmGate.total++;
    if (ok) this.warmGate.seen++;
    const share = this.warmGate.seen / this.warmGate.total;
    this.setHint(
      this.warmGate.total > 30 && share < CAPTURE_RULES.padGate.warmUpFramesPct / 100 ? "legs" : null,
    );
  }

  private feedStance(frame: Frame, who: Walker): void {
    const st = this.stance;
    if (!st) return;
    const now = frame.t;
    const { lm, crowded } = who;
    if (!lm || !seen(lm, HIPS_ANKLES))
      return this.setHint(lm ? "feet" : crowded ? "second_person" : "no_person");
    this.setHint(null);
    const g: GaitFrame = { t: now, lm, aspect: frame.aspect ?? 1 };
    const phase = this.stanceNow(now).phase;
    if (phase === "standing") {
      st.standing.push(g);
      this.changed();
      return;
    }
    if (phase === "switch") return;
    const leg = st.legs[st.leg];
    if (!leg) return;
    leg.startedAt ??= now;
    leg.frames.push(g);
    if (now - leg.startedAt >= CAPTURE_RULES.stanceHoldSec * 1000) this.endStanceLeg(now);
    else this.changed();
  }

  /* ---------------------------------------------------------------- ticks */

  /** The clock: the warm up timer, the stance's change of legs, and the end of a recording. */
  tick(now: number): void {
    this.lastT = now;
    const s = this.current;
    if (this.stopList || this.stoppedNow) return;
    if (s.id === "pad_warm_up" && this.timer && !this.pausedByNow && now >= this.timer.until) {
      this.timer = null;
      this.nextStep(now);
      return;
    }
    if (s.id === "stance" && this.stance?.switchUntil != null && now >= this.stance.switchUntil) {
      this.stance.switchUntil = null;
      this.changed();
    }
    if (s.id !== "walk" || !s.rec || this.pausedByNow) return;
    const r = this.recOf(s.rec);
    if (this.pendingCheck) return this.check(r, now);
    if (r.done) return;
    // The person may leave the picture or stand still after a pass: no frame then says it ended.
    const counted = !r.id.startsWith("pad") && this.countPasses(r, r.counter.poll(now).passes, now);
    if (this.finishDue(r, now)) {
      this.pendingCheck = true;
      this.changed();
    } else if (counted) this.changed();
  }

  /**
   * «I have finished» on the walk's screen (D-036 item 6: always a way to go on): the recording is read
   * now with whatever it holds, as at its end.
   */
  finishWalk(now: number): boolean {
    const s = this.current;
    if (s.id !== "walk" || !s.rec || this.stopList || this.stoppedNow) return false;
    const r = this.recOf(s.rec);
    if (r.done) return false;
    this.pausedByNow = null;
    this.check(r, now);
    return true;
  }

  /**
   * The end of a recording: analyse its views, then go on with what they gave (full or timing only,
   * D-035 item 2; D-037 item 3: 2 clean cycles a side, or 5 in all with 1 on each side, across the
   * passes, GAIT_MVP). Only a walk that gave nothing usable asks one calm «try
   * once more» with what to change (D-036 item 6); after the second try the walk goes on with it
   * kept (D-035 item 4: stored on failure). The target is never raised.
   */
  private check(r: Recording, now: number): void {
    this.pendingCheck = false;
    r.results = this.analyseRecording(r, this.setup());
    // The wrong view, a frame rate under the floor or nothing read all give a level of none.
    const verdict = walkVerdict(r.results);
    r.gatePassed = verdict.level === "full";
    this.bridge({
      p: 3,
      type: "pass_done",
      view: r.views[0]?.view ?? "side",
      cleanCycles: Math.min(verdict.cleanCycles.left, verdict.cleanCycles.right),
      needed: GAIT_MVP.timingCyclesPerSide,
      t: now,
    });
    this.logCheck(r, "check");
    if (verdict.level !== "none" || r.tries >= CAPTURE_LIMITS.maxTries) return this.finishRecording(r, now);
    this.askRetry(r, now);
  }

  private askRetry(r: Recording, now: number): void {
    this.steps.splice(this.index + 1, 0, { id: "retry", rec: r.id });
    this.nextStep(now);
  }

  private finishRecording(r: Recording, now: number): void {
    r.done = true;
    this.nextStep(now);
  }

  /** The views of a recording with the setup so far (each view's own standing, roll and model). */
  private analyseRecording(r: Recording, setup: GaitSetup): GaitViewResult[] {
    const frames = r.recorder.frames();
    if (frames.length < 2) return [];
    const roll = median(r.rolls);
    // The recording's views read together (C3-1), timing only below the group's gate (D-035 item 2).
    return analyseGaitGroup(
      r.views.map((v) => ({
        view: v.view,
        ...(v.nearSide ? { nearSide: v.nearSide } : {}),
        setup,
        standing: r.standing,
        frames,
        poseModel: r.poseModel,
        rollDeg: roll,
      })),
    );
  }

  /**
   * The gait lab (D-035 item 4): the current or last recording read now, without changing the walk
   * (the capture itself reads only at a recording's end, 2.8).
   */
  analyseNow(): GaitViewResult[] {
    const s = this.current;
    const r = s.rec ? this.recordings.get(s.rec) : [...this.recordings.values()].pop();
    return r ? this.analyseRecording(r, this.setup()) : [];
  }

  /** The gait lab's kept landmarks (VITE_E2E builds, the real model smoke): each recording's frames. */
  recordedFrames(): { rec: RecordingId; standing: GaitFrame[]; frames: GaitFrame[] }[] {
    return [...this.recordings.values()].map((r) => ({
      rec: r.id,
      standing: [...r.standing],
      frames: r.recorder.frames(),
    }));
  }

  /** The gait lab's «finish now»: the recording is read as it is and the walk goes on, kept. */
  finishNow(now: number): boolean {
    const s = this.current;
    if (s.id !== "walk" || !s.rec) return false;
    const r = this.recOf(s.rec);
    this.pendingCheck = false;
    r.results = this.analyseRecording(r, this.setup());
    r.gatePassed = walkVerdict(r.results).level === "full";
    this.logCheck(r, "check");
    this.finishRecording(r, now);
    return true;
  }

  /* ---------------------------------------------------------- diagnostics */

  /** What each recording found so far (D-035 item 4): the gait lab shows it, the log writes it. */
  diagnostics(): RecordingDiagnostics[] {
    const out: RecordingDiagnostics[] = [];
    for (const r of this.recordings.values()) {
      const v = walkVerdict(r.results);
      const fps = r.results.length ? Math.min(...r.results.map((x) => x.quality.medianFps)) : null;
      out.push({
        rec: r.id,
        passes: r.passes,
        steps: r.steps,
        target: r.target,
        tries: r.tries,
        seconds: Math.round(r.activeMs / 100) / 10,
        fps: fps === null || !Number.isFinite(fps) ? null : Math.round(fps * 10) / 10,
        visibleShare: r.walkFrames ? Math.round((1000 * r.seenFrames) / r.walkFrames) / 1000 : null,
        cleanCycles: v.cleanCycles,
        level: r.results.length ? v.level : null,
        reasons: r.results.length ? v.reasons : [],
        cadence: v.cadence,
        stepTime: v.stepTime,
        views: r.results.map((x) => ({
          view: x.view,
          issues: [...x.quality.issues],
          cleanCycles: x.quality.cleanCycles,
          gapShare: x.quality.gapShare,
        })),
        skipped: r.skipped,
      });
    }
    return out;
  }

  /** A diagnostic line: the option's, else the browser console (none outside a browser, the tests). */
  private log(line: string): void {
    if (this.opts.log) this.opts.log(line);
    else if (typeof window !== "undefined") console.info(line);
  }

  /** The end of the walk's lines: each recording, or that nothing was recorded and why. */
  private logEnd(): void {
    const kept = [...this.recordings.values()].filter((r) => !r.skipped && r.recorder.seconds >= 1);
    for (const r of kept) this.logCheck(r, "end");
    if (!kept.length) {
      const left = [...this.recordings.values()].filter((r) => r.skipped).map((r) => r.id);
      this.log(
        `[azm gait] end: not analysed (nothing recorded${left.length ? `; left out ${left.join(", ")}` : ""})`,
      );
    }
  }

  /** One diagnostic line (D-035 item 4): numbers and reasons only, never a landmark. */
  private logCheck(r: Recording, what: "check" | "end"): void {
    const d = this.diagnostics().find((x) => x.rec === r.id);
    if (!d) return;
    const verdict =
      d.level === "none"
        ? `not analysed (${d.reasons.join(", ") || "no reason"})`
        : `${d.level}, cadence ${d.cadence ?? "none"}`;
    const line =
      `[azm gait] ${what} ${r.id}: try ${d.tries}, passes ${d.passes} of ${d.target}, steps ${d.steps}, ${d.seconds} s, ` +
      `cycles ${d.cleanCycles.left}/${d.cleanCycles.right}, visible ${d.visibleShare ?? "none"}, ` +
      `fps ${d.fps ?? "none"}, ${verdict}`;
    this.log(line);
  }

  /** Clean cycles a side over a recording's views together (the view group, C3-1). */
  private groupCycles(results: readonly GaitViewResult[]): { left: number; right: number } {
    return results.reduce(
      (a, v) => ({ left: a.left + v.quality.cleanCycles.left, right: a.right + v.quality.cleanCycles.right }),
      { left: 0, right: 0 },
    );
  }

  /* ---------------------------------------------------------- the result */

  /** The intake, read once the walk started (the setup's aid, height and prosthesis side). */
  setIntake(intake: GaitControllerOptions["intake"]): void {
    this.intake = intake ?? null;
    this.changed();
  }

  /** The walk's setup as captured (2.8 GaitSetup; the gait route's bounds). */
  setup(): GaitSetup {
    const intake = this.intake ?? null;
    const walking = intake?.walking;
    const aid: WalkingAid | "none" = walking?.status === "with_aid" ? walking.aid : "none";
    const height = intake?.heightCm;
    const heightCm =
      typeof height === "number" &&
      Number.isInteger(height) &&
      height >= HEIGHT_CM.min &&
      height <= HEIGHT_CM.max
        ? height
        : null;
    const orthosis: GaitSetup["orthosis"] = {};
    const brace = this.gear?.brace;
    if (brace) {
      if (brace.side === "left" || brace.side === "both") orthosis.left = brace.kind;
      if (brace.side === "right" || brace.side === "both") orthosis.right = brace.kind;
    }
    const pad = this.mode === "walking_pad";
    const padMinutes =
      this.padStartedAt !== null ? ((this.padEndedAt ?? this.lastT) - this.padStartedAt) / 60000 : 0;
    return {
      mode: this.mode,
      aid,
      orthosis,
      prosthesis: prosthesisSide(intake),
      shoes: this.gear?.shoes ?? true,
      heightCm,
      padSpeedKmh: pad ? (this.padSpeedKmh ?? null) : null,
      padCorrection: null,
      handrail: pad ? (this.handrail ?? null) : null,
      familiarised: pad ? padMinutes >= CAPTURE_RULES.familiarisedMin : null,
    };
  }

  /**
   * The body to post (2.8, section 4): every recording kept, analysed again with the final setup (the
   * pad speed, the handrail hold), the static stance, the views combined, and the pain marked during
   * the walk. Null when nothing was recorded (every view left out, or a stop before any walk).
   */
  body(): GaitBody | null {
    const setup = this.setup();
    const views: GaitViewResult[] = [];
    const order: RecordingId[] = this.mode === "overground" ? ["overground_side"] : this.padRecordings();
    for (const id of order) {
      const r = this.recordings.get(id);
      if (!r || r.skipped || r.recorder.seconds < 1) continue;
      const results = this.analyseRecording(r, setup);
      // D-035 item 4: a view that neither passed its group's gate nor gave a timing only reading keeps
      // its quality (the reasons, stored as the walk's diagnostic) and none of its numbers, so a walk
      // the model tracked badly never shows or stores a cadence. GW-3: each view's quality also keeps
      // what the capture counted, so a stored walk can be read again later.
      const passed = groupPassed(results);
      const capture: GaitCaptureCounts = {
        passes: Math.min(r.passes, CAPTURE_COUNT_MAX.passes),
        steps: Math.min(r.steps, CAPTURE_COUNT_MAX.steps),
        seconds: Math.min(Math.round(r.activeMs / 100) / 10, CAPTURE_COUNT_MAX.seconds),
        tries: r.tries,
      };
      views.push(
        ...results.map((v) => {
          const kept = passed || isTimingReading(v) ? v : { ...v, metrics: {} };
          return { ...kept, quality: { ...kept.quality, capture } };
        }),
      );
    }
    if (!views.length) return null;
    const stance: StaticStanceResult[] = [];
    if (this.stance && this.stance.standing.length > 1)
      for (const leg of this.stance.legs)
        if (leg.frames.length > 1)
          try {
            stance.push(
              analyseStaticStance({
                side: leg.side,
                support: "fingertip",
                frames: leg.frames,
                standing: this.stance.standing,
              }),
            );
          } catch {
            /* a hold the engine cannot read is left out */
          }
    const analysis = combineViews(views, stance, setup);
    analysis.engineVersion = analysis.engineVersion || ENGINE_VERSION;
    if (this.walkPain.length) analysis.walkPain = this.walkPain.slice(0, 10);
    // Why the walk ended early, kept with it (D-030 C4-5): the card says the pain line.
    if (this.outcome === "pain_limited" || this.outcome === "stopped") analysis.outcome = this.outcome;
    return { setup, analysis };
  }

  /** Whether a stop now leaves anything to post (a walk was recorded). */
  get anythingRecorded(): boolean {
    return [...this.recordings.values()].some((r) => !r.skipped && r.recorder.seconds >= 1);
  }

  /* --------------------------------------------------------- pause, stop */

  /** Pause from the screen or the coach: a recording, the standing, the stance or the warm up. */
  pause(by: "screen" | "coach", now: number): ToolResult {
    const no = pauseRefusal(this.control());
    if (no) return no;
    this.pausedByNow = by;
    if (this.timer) this.timer.left = Math.max(0, this.timer.until - now);
    const r = this.recording;
    if (r) r.lastT = null;
    this.changed();
    return { accepted: true };
  }

  /** Resume: the screen ends any pause, the coach only its own (C-16). */
  resume(by: "screen" | "coach", now: number): ToolResult {
    if (by === "coach") {
      const no = resumeRefusal(this.control());
      if (no) return no;
    } else if (this.stoppedNow || this.stopList) return { accepted: false, reason: "safety_stop" };
    else if (!this.pausedByNow) return { accepted: false, reason: "not_allowed" };
    this.pausedByNow = null;
    if (this.timer?.left != null) {
      this.timer = { ...this.timer, until: now + this.timer.left, left: null };
    }
    this.changed();
    return { accepted: true };
  }

  /**
   * STOP (the screen) or the coach's stop: the recording ends at once (gait-rules stops) and the stop
   * list opens, with the coach's reason preselected; the person confirms there (C-16). On the pad the
   * stop line asks the person to hold the support and the helper to stop the belt.
   */
  requestStop(now: number, preselect: CoachStopReason | null = null): void {
    if (this.stopList) {
      if (preselect) this.stopList = { preselect };
      this.changed();
      return;
    }
    this.endRecording();
    this.stopList = { preselect };
    if (this.mode === "walking_pad" && this.beltMayRun()) this.say("gait_pad_stop", "safety");
    this.bridge({ p: 0, type: "safety_stop", reason: "user_stop", t: now });
    if (this.outcome === null) this.outcome = "stopped";
    this.changed();
  }

  /** From the person stepping on the belt to the pad stopped: the belt may be running. */
  private beltMayRun(): boolean {
    const at = this.index;
    const first = this.steps.findIndex((s) => s.id === "pad_start");
    const last = this.steps.map((s) => s.id).lastIndexOf("pad_stop");
    return first >= 0 && at >= first && at <= last;
  }

  /** Ends the current recording: the frames so far stay (only completed clean cycles count). */
  private endRecording(): boolean {
    const s = this.current;
    this.pendingCheck = false;
    if (s.id === "walk" && s.rec) {
      const r = this.recOf(s.rec);
      r.lastT = null;
      return true;
    }
    if (s.id === "stance") return true;
    return false;
  }

  /* ------------------------------------------------------------ CoachHost */

  private control() {
    return {
      step: this.step(),
      pausedBy: this.pausedByNow,
      stopped: this.stoppedNow || !!this.stopList,
    };
  }

  step(): { kind: CoachStepKind; finished: boolean } {
    if (this.stopList || this.stoppedNow) return { kind: "safety", finished: false };
    const s = this.current;
    const r = s.rec ? this.recordings.get(s.rec) : undefined;
    return { kind: STEP_KIND[s.id], finished: s.id === "walk" && !!r?.done };
  }

  snapshot(): string {
    const s = this.current;
    const parts = [`gait step=${s.id}`, `mode=${this.mode}`];
    if (s.rec) parts.push(`recording=${s.rec}`);
    const r = s.rec ? this.recordings.get(s.rec) : undefined;
    if (r) {
      const c = this.groupCycles(r.results);
      const pad = r.id.startsWith("pad");
      parts.push(
        pad
          ? `seconds=${Math.round(r.activeMs / 1000)}/${r.target}`
          : `passes=${Math.min(r.passes, r.target)}/${r.target}`,
        `cycles=${c.left}/${c.right}`,
      );
      if (r.tries > 1) parts.push(`try=${r.tries}`);
    }
    if (this.pausedByNow) parts.push(`paused=${this.pausedByNow}`);
    if (this.stopList) parts.push("stop_list=open");
    return parts.join(" ");
  }

  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult {
    try {
      return this.tool(name, args as ToolArgs[ToolName], this.lastT);
    } catch {
      return { accepted: false, reason: "not_allowed" };
    }
  }

  /** The instruction text of the step now, for repeat_instructions (set by the screen in its language). */
  instructions: () => string = () => "";

  private tool(name: ToolName, args: ToolArgs[ToolName], now: number): ToolResult {
    switch (name) {
      case "mark_pain":
        return this.markPain(args as ToolArgs["mark_pain"], now);
      case "stop": {
        const { reason } = args as ToolArgs["stop"];
        this.requestStop(now, reason);
        return {
          accepted: true,
          say: "tap_to_confirm",
          data: { reason, emergencyFirst: EMERGENCY_REASONS.includes(reason) },
        };
      }
      case "pause":
        return this.pause("coach", now);
      case "resume":
        return this.resume("coach", now);
      case "next_step":
        return pressNextStep(this.actions, this.control(), (args as ToolArgs["next_step"]).intent);
      case "repeat_instructions":
        return { accepted: true, data: { text: this.instructions() } };
      default:
        return { accepted: false, reason: "not_in_block" };
    }
  }

  /**
   * C-15 and the 2.11 gait row: any mark_pain ends the recording and is kept for the rules; the
   * shared rule against the walk's score before ends the test (pain_limited, the clean cycles kept);
   * below it a confirm step to walk again.
   */
  markPain(a: ToolArgs["mark_pain"], now: number): ToolResult {
    const level = Math.max(0, Math.min(10, Math.round(a.level)));
    if (this.walkPain.length < 10) this.walkPain.push({ side: null, level });
    const recording = this.current.id === "walk" || this.current.id === "stance";
    const ended = this.endRecording() && recording;
    const rule = painStopRule(a.level, a.sharp === true, this.painBefore);
    if (rule.stop) {
      if (!this.stoppedNow) {
        this.stoppedNow = true;
        this.outcome = "pain_limited";
        this.pausedByNow = null;
        this.bridge({ p: 0, type: "safety_stop", reason: "pain_stop", t: now });
        this.say(
          this.mode === "walking_pad" && this.beltMayRun() ? "gait_pad_stop" : "gait_pain_limited",
          "safety",
        );
        this.steps.splice(this.index + 1, 0, { id: "pain_stop" });
        this.index++;
        this.changed();
      }
      return { accepted: true, say: "pain_stop", data: { action: "stop_test" } };
    }
    if (!ended) return { accepted: true, say: "pain_ok", data: { action: "continue" } };
    const s = this.current;
    if (s.id === "walk" && s.rec) {
      this.steps.splice(this.index + 1, 0, { id: "walk_again", rec: s.rec });
      this.nextStep(now);
    }
    return { accepted: true, say: "pain_ok", data: { action: "recording_ended" } };
  }
}

/** A leg prosthesis side from the body map (a limb loss below or above the knee on one side), else null. */
export function prosthesisSide(intake: Pick<Intake, "regions"> | null | undefined): "left" | "right" | null {
  const sides = new Set<string>();
  for (const e of intake?.regions ?? [])
    if (
      e.problems.includes("limb_loss") &&
      (e.limbLoss?.level === "below_knee" || e.limbLoss?.level === "above_knee") &&
      (e.side === "left" || e.side === "right")
    )
      sides.add(e.side);
  return sides.size === 1 ? ([...sides][0] as "left" | "right") : null;
}
