import { Preferences, RepMoment, ui, insight } from "./experience";
import RepReview from "./RepReview";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GateMessage, Presence } from "../engine/feedbackGate";
import { unscoredLandmarks } from "../engine/profiles";
import { WORKOUT_ENGINE_VERSION } from "../engine/repEngine";
import { CueId, EngineEvent, ExerciseDef, Frame, LM, SessionSummary, Severity } from "../engine/types";
import type { BridgeEvent, CoachPush } from "../coach/types";
import { FlowStage, FlowView, WorkoutFlow } from "../engine/workoutFlow";
import { EXERCISES, variantForProfile } from "../exercises/defs";
import { CuePlayer, isVoiceLine } from "./audio";
import { fmtNum, Lang, pct as fmtPct, T } from "./i18n";
import voiceScript from "./voice-script.json";
import { drawOverlay } from "./overlay";
import { CameraPoseSource, CameraStatus, PoseSource, TracePoseSource } from "./poseSource";
import type { TraceOpts } from "../engine/traces";
import { camCopy } from "./camera-copy";
import { sessionCopy } from "./session-copy";
import { copy, sessionProfile, Setup } from "./product";
import Icon from "./Icon";
import Dialog from "./Dialog";
import { CheckRoot } from "../features/assessment/shared/CheckRoot";
import { StopButton } from "../features/assessment/safety/parts";
import "../features/assessment/safety/safety.css";
import "./session.css";

/**
 * The camera screen (booth v2, contract A7): the trial, the workouts and the booth.
 *
 *   full bleed live video (a calm mannequin on a light stage in the demo);
 *   a light glass panel with the range arc, the large rep count and the person's own top;
 *   one caption line from the calm feedback gate (feedbackGate.ts);
 *   a large speaker button (the voice is off by default, remembered per device) and Stop.
 *
 * The set itself runs in WorkoutFlow (engine/workoutFlow.ts): the outline, the start position,
 * the 2 rep calibration and the counted set. `variant` "booth" ends with `onComplete(summary)` and
 * no dialogs; the trial and the workouts keep the effort and summary dialogs, then call it too.
 */
export type SessionVariant = "trial" | "workout" | "booth";

/**
 * The caption of every voice line, read from the voice script here (D-026 item 2): the camera screen
 * is its only reader, so the lines ship in this lazy chunk and never in the landing's first script.
 */
const CUE_TEXT: Record<CueId, { ar: string; en: string }> = voiceScript;

/** The standing figure of the sit to stand trace, head to feet (demo). */
const STAND_BOX = { x0: 0.2, y0: 0.06, x1: 0.8, y1: 0.92 };

/** The personal top sits at this share of the arc: room to show a rep that goes beyond it. */
const TOP_AT = 0.8;

const FLAG_JOINTS: Partial<Record<CueId, number[]>> = {
  sit_tall: [LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip],
  relax_shoulders: [LM.l_shoulder, LM.r_shoulder],
  even_arms: [LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist],
  fuller_range: [LM.l_wrist, LM.r_wrist],
  stand_fully: [LM.l_hip, LM.r_hip, LM.l_knee, LM.r_knee],
};

const qs = new URLSearchParams(location.search);
/**
 * E2E builds only (VITE_E2E is replaced at build time): ?e2eTrace= plays a synthetic trace in place
 * of the camera, so the camera screen can be walked and photographed without a person.
 */
const E2E_TRACES: Record<string, TraceOpts> = {
  nasser: { restSec: 3, leadInSec: 2, effort: 0.45 },
  full: { leadInSec: 2.5 },
  limited: { leadInSec: 2.5, effort: 0.35 },
  lean: { leadInSec: 2.5, leanDeg: 12, leanFromRep: 3 },
};
const e2eTrace = import.meta.env.VITE_E2E === "1" ? qs.get("e2eTrace") : null;

type Ui = {
  stage: FlowStage;
  presence: Presence;
  holding: boolean;
  calReps: number;
  count: number;
  caption: { id: string; text: string; severity: Severity } | null;
};
const INITIAL_UI: Ui = {
  stage: "framing",
  presence: "none",
  holding: false,
  calReps: 0,
  count: 0,
  caption: null,
};

/**
 * Step D5 (contract 2.11, the WorkoutFlow row): a set's engine events as the coach hears them: a
 * counted rep as the count (P3), a correction (P2, the gate has said it already), the trunk safety
 * stop (P0).
 */
export function flowCoachEvents(
  events: EngineEvent[],
  exercise: string,
  target: number,
  t: number,
): BridgeEvent[] {
  const out: BridgeEvent[] = [];
  for (const ev of events) {
    if (ev.kind === "rep" && ev.cls !== "partial")
      out.push({ p: 3, type: "reps", exercise, count: ev.count, target, t });
    else if (ev.kind === "flag") out.push({ p: 2, type: "compensation", kind: ev.cue, value: ev.value, t });
    else if (ev.kind === "stop") out.push({ p: 0, type: "safety_stop", reason: "trunk_safety", t });
  }
  return out;
}

export default function SessionScreen(props: {
  lang: Lang;
  setup: Setup;
  exerciseId: string;
  demo: boolean;
  /**
   * D-037 item 6: a demo exercise with the real camera, from the demo list. The caller passes no
   * onSave, so nothing is recorded; the screen tags it and its dialogs say it is not saved.
   */
  unsaved?: boolean;
  targetReps?: number;
  setNumber?: number;
  onSave?: (summary: SessionSummary, moments: RepMoment[]) => Promise<void>;
  onContinue?: () => void;
  preferences: Preferences;
  onPreferences: (p: Preferences) => void;
  onExit: () => void;
  onRestart: () => void;
  onDemo: () => void;
  /** Which screen this is: the trial, a workout set, or the booth (no dialogs; ends with onComplete). */
  variant?: SessionVariant;
  /** Called once with the set's summary when it ends (after the dialogs, or at once at the booth). */
  onComplete?: (summary: SessionSummary) => void;
  /** The trial (older callers); same as variant "trial". */
  trial?: boolean;
  onRegister?: () => void;
  /** Step D5: a coached workout's set hands the coach its events (flowCoachEvents). */
  coach?: CoachPush;
  /**
   * D-036 item 2: a coached workout's set offers the coach its summary's Continue program to press on
   * the person's spoken words (null when there is none, or after the set's safety stop).
   */
  onCoachButton?: (button: { name: "continue"; press(): void } | null) => void;
}) {
  const { lang, setup, exerciseId, demo, preferences, onPreferences, onExit, onRestart, onDemo } = props;
  const variant: SessionVariant = props.variant ?? (props.trial ? "trial" : "workout");
  const trial = variant === "trial";
  const c = copy(lang),
    x = ui(lang),
    k = camCopy(lang),
    s = sessionCopy(lang);
  const profile = useMemo(() => sessionProfile(setup), [setup]);
  const profileId = profile.id;
  const def = useMemo<ExerciseDef>(
    () => ({
      ...EXERCISES.find((e) => e.id === exerciseId)!,
      ...(props.targetReps ? { targetReps: props.targetReps } : {}),
    }),
    [exerciseId, props.targetReps],
  );
  const variantDef = useMemo(() => variantForProfile(def, profileId), [def, profileId]);
  const contextSet = useMemo(
    () => new Set([...variantDef.contextLandmarks, ...unscoredLandmarks(profile)]),
    [variantDef, profile],
  );
  const t = useCallback(
    <K extends keyof typeof T>(key: K) => (T[key] as { ar: string; en: string })[lang] ?? "",
    [lang],
  );
  const noVideo = demo || !!e2eTrace;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  const holdRef = useRef<SVGCircleElement>(null);

  const [source, setSource] = useState<"loading" | "running" | "error">("loading");
  const [camStatus, setCamStatus] = useState<CameraStatus>("model");
  const [errKind, setErrKind] = useState<"denied" | "none" | "generic" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<Ui>(INITIAL_UI);
  const [end, setEnd] = useState<null | "rpe" | "summary" | "done">(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [muted, setMuted] = useState(preferences.voice === "off");
  const [moments, setMoments] = useState<RepMoment[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  // S0: the set ended on the trunk safety stop (the RPE and summary dialogs say so).
  const [safetyStop, setSafetyStop] = useState(false);
  const player = useMemo(() => new CuePlayer(lang), [lang]);
  const coachRef = useRef(props.coach);
  coachRef.current = props.coach;
  // D-036 item 2: the summary's Continue program for a coached workout's coach (never after a safety
  // stop: going on is then the person's own tap), the same call as the button.
  const continueRef = useRef(props.onContinue);
  continueRef.current = props.onContinue;
  const offerButton = props.onCoachButton;
  const canGoOn = end === "summary" && !trial && !safetyStop && !!props.onContinue;
  useEffect(() => {
    if (!offerButton) return;
    offerButton(canGoOn ? { name: "continue", press: () => continueRef.current?.() } : null);
    return () => offerButton(null);
  }, [offerButton, canGoOn]);

  const pipe = useRef({
    flow: null as WorkoutFlow | null,
    over: false,
    startedAt: 0,
    flash: new Set<number>(),
    flashUntil: 0,
    captionId: null as string | null,
    ui: INITIAL_UI,
    fit: "cover" as "cover" | "contain",
    stopSource: null as null | (() => void),
  });

  const captionText = useCallback(
    (m: GateMessage): string => s.messages[m.id] ?? (m.id in CUE_TEXT ? CUE_TEXT[m.id as CueId][lang] : ""),
    [s, lang],
  );

  const say = useCallback(
    (m: GateMessage) => {
      if (!m.voice || !isVoiceLine(m.voice)) return;
      void player.line(m.voice, m.severity);
    },
    [player],
  );

  /** The set's summary from the flow, with the fields every save carries. */
  const buildSummary = useCallback(
    (rpeVal: number | null): SessionSummary => {
      const P = pipe.current;
      const r = P.flow?.summary();
      return {
        exerciseId,
        profileId,
        startedAt: P.startedAt || Date.now(),
        endedAt: Date.now(),
        reps: r?.reps ?? { valid: 0, partial: 0, compensated: 0 },
        flags: r?.flags ?? {},
        rpe: rpeVal ?? undefined,
        romPct: r?.romPct,
        engineVersion: WORKOUT_ENGINE_VERSION,
        ...(r?.measure ? { measure: r.measure } : {}),
        steadyReps: r?.steadyReps ?? 0,
      };
    },
    [exerciseId, profileId],
  );

  /** The set is over: the target is reached, Stop was pressed in the set, or the safety stop. */
  const finishSet = useCallback(
    (how: "done" | "stopped" | "safety") => {
      const P = pipe.current;
      if (P.over) return;
      P.over = true;
      P.stopSource?.();
      if (how === "done") void player.cue("set_done", "praise");
      if (how === "safety") setSafetyStop(true);
      setMoments([...(P.flow?.moments ?? [])]);
      if (variant === "booth") {
        setEnd("done");
        props.onComplete?.(buildSummary(null));
        return;
      }
      setEnd("rpe");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, variant, buildSummary, props.onComplete],
  );

  const onFrame = useCallback(
    (raw: Frame) => {
      const P = pipe.current;
      if (P.over || !P.flow) return;
      const v: FlowView = P.flow.step(raw);
      const now = performance.now();

      // The caption: a new cue about a joint makes that joint glow for 2 s.
      const cap = v.caption;
      if ((cap?.id ?? null) !== P.captionId) {
        P.captionId = cap?.id ?? null;
        const joints = cap ? FLAG_JOINTS[cap.id as CueId] : undefined;
        if (joints) {
          P.flash = new Set(joints);
          P.flashUntil = now + 2000;
        }
      }
      if (now > P.flashUntil) P.flash = new Set();

      // How the video fills the screen: full bleed unless the picture's shape is far from the
      // screen's (then the whole picture, so nobody is cut off).
      const video = videoRef.current,
        wrap = wrapRef.current;
      if (!noVideo && video && wrap && video.videoWidth && wrap.clientWidth) {
        const ratio = video.videoWidth / video.videoHeight / (wrap.clientWidth / wrap.clientHeight);
        const next = ratio > 1.6 || ratio < 1 / 1.6 ? "contain" : "cover";
        if (next !== P.fit) {
          P.fit = next;
          setFit(next);
        }
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) {
        const portrait = canvas.height > canvas.width;
        // On a wide screen the panel floats at the inline end: the figure keeps the rest.
        const cssWidth = wrap?.clientWidth ?? 0;
        const side = !portrait && cssWidth >= 900 ? 448 / cssWidth : 0;
        const rtl = lang === "ar";
        drawOverlay(ctx, v.frame, {
          contextLandmarks: contextSet,
          flashJoints: P.flash,
          mirrored: !noVideo,
          demo: noVideo,
          sourceWidth: video?.videoWidth,
          sourceHeight: video?.videoHeight,
          fit: P.fit,
          // the demo figure sits between the caption and the panel (beside the panel when wide)
          demoBox: exerciseId === "sit_to_stand" ? STAND_BOX : undefined,
          demoArea: portrait
            ? { top: 0.17, bottom: 0.61 }
            : { top: 0.2, bottom: 0.96, left: rtl ? side : 0, right: rtl ? 1 : 1 - side },
        });
      }

      // The arc: the live position, the personal top at TOP_AT once the range is set.
      const fill = fillRef.current;
      if (fill) {
        let f = 0;
        if (v.pct !== null) f = v.pct * TOP_AT;
        else if (v.stage === "calibrating") {
          const val = v.mf.values[def.primaryMetric];
          const [lo, hi] = def.defaultRange;
          if (val !== undefined) f = ((val - lo) / (hi - lo)) * TOP_AT;
        }
        const share = Math.max(0, Math.min(1, f));
        fill.style.strokeDasharray = `${share * 100} 100`;
        fill.style.opacity = share > 0.01 ? "1" : "0";
      }
      const hold = holdRef.current;
      if (hold) {
        hold.style.strokeDasharray = `${v.startHold * 100} 100`;
        hold.style.opacity = v.startHold > 0.01 ? "1" : "0";
      }

      for (const m of v.speak) say(m);
      for (const ev of v.events) if (ev.kind === "rep" && ev.cls !== "partial") void player.count(ev.count);
      const push = coachRef.current;
      if (push) for (const e of flowCoachEvents(v.events, exerciseId, v.target, now)) push(e);
      if (v.stage === "training" && !P.startedAt) P.startedAt = Date.now();

      const next: Ui = {
        stage: v.stage,
        presence: v.presence,
        holding: v.stage === "start" && v.startHold > 0,
        calReps: v.calReps,
        count: v.count,
        caption: cap ? { id: cap.id, text: captionText(cap), severity: cap.severity } : null,
      };
      const prev = P.ui;
      if (
        prev.stage !== next.stage ||
        prev.presence !== next.presence ||
        prev.holding !== next.holding ||
        prev.calReps !== next.calReps ||
        prev.count !== next.count ||
        prev.caption?.id !== next.caption?.id ||
        prev.caption?.text !== next.caption?.text
      ) {
        P.ui = next;
        setView(next);
      }
      if (v.stage === "finished") finishSet("done");
      else if (v.stage === "stopped") finishSet("safety");
    },
    [contextSet, def, noVideo, say, player, captionText, finishSet, exerciseId, lang],
  );

  // source lifecycle
  useEffect(() => {
    let src: PoseSource | undefined;
    let cancelled = false;
    const P = pipe.current;
    P.flow = new WorkoutFlow(def, profile, variantDef.requiredLandmarks, def.targetReps);
    P.over = false;
    P.startedAt = 0;
    P.ui = INITIAL_UI;
    P.captionId = null;
    setView(INITIAL_UI);
    (async () => {
      try {
        if (demo) {
          src = new TracePoseSource(
            exerciseId,
            exerciseId === "seated_shoulder_press" ? E2E_TRACES.lean : { leadInSec: 2.5 },
          );
        } else if (e2eTrace) {
          src =
            e2eTrace === "nobody"
              ? new EmptyPoseSource()
              : new TracePoseSource(exerciseId, E2E_TRACES[e2eTrace] ?? {});
        } else {
          const cam = new CameraPoseSource(videoRef.current!);
          cam.onStatus = setCamStatus;
          src = cam;
        }
        setSource("loading");
        P.stopSource = () => src?.stop();
        await src.start(onFrame);
        if (cancelled) {
          src.stop();
          return;
        }
        setSource("running");
      } catch (e) {
        src?.stop();
        if (cancelled) return;
        console.error(e);
        const name = (e as { name?: string })?.name;
        setErrKind(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "none"
              : "generic",
        );
        setSource("error");
      }
    })();
    return () => {
      cancelled = true;
      src?.stop();
    };
  }, [demo, exerciseId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => player.stop(), [player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  // A propped phone must not dim or lock mid set.
  useEffect(() => {
    if (noVideo) return;
    let lock: { release: () => Promise<void> } | null = null,
      active = true;
    const request = async () => {
      try {
        lock =
          (await (
            navigator as unknown as {
              wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
            }
          ).wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVisible = () => {
      if (active && document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [noVideo]);

  // canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = Math.round(wrap.clientWidth * window.devicePixelRatio);
      canvas.height = Math.round(wrap.clientHeight * window.devicePixelRatio);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const stopNow = useCallback(() => {
    player.stop();
    const P = pipe.current;
    const stage = P.flow?.stage;
    if (!P.over && (stage === "training" || stage === "finished")) {
      finishSet("stopped");
      return;
    }
    P.over = true;
    P.stopSource?.(); // camera and pose halt at once: privacy and battery
    onExit();
  }, [onExit, player, finishSet]);

  // Escape always stops; focus lands on STOP when the set starts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !end) stopNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopNow, end]);
  const stopBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (view.stage === "training") stopBtnRef.current?.focus({ preventScroll: true });
  }, [view.stage]);

  const toggleSound = () => {
    const next = !muted;
    // Inside the tap: iOS lets the voice play later only if a tap started the audio.
    if (!next) CuePlayer.unlock();
    setMuted(next);
    onPreferences({ ...preferences, voice: next ? "off" : "full" });
  };

  const saveAndSummarize = async (rpeVal: number | null) => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    const sum = buildSummary(rpeVal);
    if (props.onSave) {
      try {
        await props.onSave(sum, pipe.current.flow?.moments ?? []);
        setSaved(!demo);
      } catch {
        setSaved(false);
        setSaving(false);
        setSaveError(true);
        return;
      }
    }
    setSaving(false);
    setSummary(sum);
    setEnd("summary");
    props.onComplete?.(sum);
  };

  const stage = view.stage;
  const live = source === "running" && !end;
  const panelKey = source !== "running" ? source : stage === "framing" || stage === "start" ? stage : "gauge";
  const ranged = stage === "training" || stage === "finished" || stage === "stopped";

  return (
    <div
      className={`cam2${noVideo ? " no-video" : ""}${demo ? " is-demo" : ""}`}
      data-stage={source === "running" ? stage : source}
      data-presence={view.presence}
      data-variant={variant}
      data-count={view.count}
    >
      <div className="cam2-stage" ref={wrapRef} data-fit={fit}>
        {noVideo && <div className="cam2-backdrop" aria-hidden />}
        <video ref={videoRef} className="cam2-video" playsInline muted hidden={noVideo} />
        <canvas ref={canvasRef} className="cam2-overlay" aria-hidden />
        {live && stage === "framing" && (
          <Outline presence={view.presence} rise={exerciseId === "sit_to_stand"} />
        )}
      </div>

      <header className="cam2-top">
        <div className="cam2-title cam2-glass">
          <b>{def.name[lang]}</b>
          {demo ? (
            <span className="cam2-tag">{s.demo}</span>
          ) : props.unsaved ? (
            <span className="cam2-tag">{s.demoRun}</span>
          ) : props.setNumber ? (
            <span className="cam2-tag">
              {s.setLabel} {fmtNum(props.setNumber, lang)}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={`cam2-sound cam2-glass${muted ? "" : " on"}`}
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={muted ? s.soundOff : s.soundOn}
        >
          <SpeakerIcon muted={muted} />
          <span>{s.sound}</span>
        </button>
      </header>

      <div
        className="cam2-caption-slot"
        aria-live={view.caption?.severity === "safety" ? "assertive" : "polite"}
      >
        {live && view.caption && (
          <p key={view.caption.id} className={`cam2-caption ${view.caption.severity}`}>
            {view.caption.text}
          </p>
        )}
      </div>

      <section className="cam2-panel cam2-glass" aria-label={def.name[lang]}>
        <div className="cam2-panel-body" key={panelKey} data-panel={panelKey}>
          {source === "loading" && (
            <div className="cam2-status" role="status">
              <span className="cam2-spinner" aria-hidden />
              <b>{camStatus === "camera" ? k.loadingCam : k.loadingModel}</b>
            </div>
          )}
          {source === "error" && (
            <div className="cam2-status cam2-error" role="alert">
              <b>{errKind === "denied" ? k.errDenied : errKind === "none" ? k.errNone : k.errGeneric}</b>
              <p>{errKind === "denied" ? k.errDeniedBody : k.errGenericBody}</p>
              <div className="cam2-error-actions">
                <button
                  className="cta"
                  onClick={() => {
                    setErrKind(null);
                    setAttempt((a) => a + 1);
                  }}
                >
                  {k.retry}
                </button>
                <button className="ghost" onClick={onDemo}>
                  {k.watchDemo}
                </button>
              </div>
            </div>
          )}
          {source === "running" && stage === "framing" && (
            <div className="cam2-instruct" role="status">
              <span className={`cam2-frame-icon ${view.presence}`} aria-hidden>
                <OutlineGlyph />
              </span>
              <div>
                <h2>{exerciseId === "sit_to_stand" ? s.framingTitleRise : s.framingTitle}</h2>
                <p>
                  {exerciseId === "sit_to_stand"
                    ? s.framingBodyRise
                    : exerciseId === "seated_biceps_curl"
                      ? s.framingBodySide
                      : s.framingBody}
                </p>
              </div>
            </div>
          )}
          {source === "running" && stage === "start" && (
            <div className={`cam2-instruct cam2-start${view.holding ? " holding" : ""}`} role="status">
              <span className="cam2-pose" aria-hidden>
                <svg viewBox="0 0 120 120" className="cam2-hold">
                  <circle className="track" cx="60" cy="60" r="56" pathLength={100} />
                  <circle
                    className="fill"
                    cx="60"
                    cy="60"
                    r="56"
                    pathLength={100}
                    ref={holdRef}
                    style={{ strokeDasharray: "0 100" }}
                  />
                </svg>
                <StartPicture exerciseId={exerciseId} />
              </span>
              <div>
                <h2>{view.holding ? s.startHold : s.startTitle}</h2>
                <p>{s.start[exerciseId] ?? ""}</p>
              </div>
            </div>
          )}
          {source === "running" && panelKey === "gauge" && (
            <div className={`cam2-meter${ranged ? " ranged" : " measuring"}`}>
              <Gauge
                fillRef={fillRef}
                ranged={ranged}
                lang={lang}
                count={view.count}
                target={def.targetReps}
                calReps={view.calReps}
                of={s.of}
                reps={s.reps}
                measured={s.measured}
                topLabel={s.yourTop}
              />
              {ranged ? (
                <p className="cam2-legend">
                  <i aria-hidden />
                  {s.yourTop}
                </p>
              ) : (
                <div className="cam2-measure-text" role="status">
                  <h2>{s.measureTitle}</h2>
                  <p>{s.measureBody}</p>
                </div>
              )}
            </div>
          )}
        </div>
        {/* C49: the check's STOP «توقف», the same control everywhere. */}
        <CheckRoot ui={{ lang }} page={false} className="cam2-stop">
          <StopButton onPress={stopNow} buttonRef={stopBtnRef} />
        </CheckRoot>
      </section>

      {end === "rpe" && (
        <Dialog titleId="rpe-title">
          {safetyStop ? (
            <SafetyStopCard lang={lang} />
          ) : (
            <div className="result-symbol">
              <Icon name="check" size={30} />
            </div>
          )}
          <p className="eyebrow">{demo ? c.demoSummary : c.resultIntro}</p>
          <h2 id="rpe-title">{t("rpeTitle")}</h2>
          {demo ? <p>{c.demoNotSaved}</p> : props.unsaved && <p>{s.demoRunNote}</p>}
          <div className="rpe-grid">
            {Array.from({ length: 11 }, (_, i) => (
              <button
                key={i}
                className={`rpe-btn ${rpe === i ? "sel" : ""}`}
                aria-pressed={rpe === i}
                onClick={() => setRpe(i)}
              >
                {fmtNum(i, lang)}
              </button>
            ))}
          </div>
          <div className="rpe-labels">
            <span>{c.easy}</span>
            <span>{c.hard}</span>
          </div>
          {rpe !== null && rpe >= 8 && (
            <p className="rpe-warn" role="status">
              {t("rpeHigh")}
            </p>
          )}
          {saveError && (
            <p className="form-error" role="alert">
              {lang === "ar" ? "تعذّر حفظ المجموعة. حاول مجددًا." : "Could not save this set. Please retry."}
            </p>
          )}
          <div className="modal-actions">
            <button className="cta" disabled={rpe === null || saving} onClick={() => saveAndSummarize(rpe)}>
              {saving ? (lang === "ar" ? "جارٍ الحفظ…" : "Saving…") : c.finish}
            </button>
            <button className="ghost" disabled={saving} onClick={() => saveAndSummarize(null)}>
              {t("skip")}
            </button>
          </div>
        </Dialog>
      )}
      {end === "summary" && summary && (
        <Dialog titleId="sum-title">
          {safetyStop ? (
            <SafetyStopCard lang={lang} />
          ) : (
            <div className="result-symbol">
              <Icon name="check" size={30} />
            </div>
          )}
          <p className="eyebrow">{demo ? c.demoSummary : c.resultIntro}</p>
          <h2 id="sum-title">{t("summaryTitle")}</h2>
          <p>{def.name[lang]}</p>
          <div className="sum-grid">
            <div>
              <b>{fmtNum(summary.reps.valid, lang)}</b>
              <span>{t("validReps")}</span>
            </div>
            <div>
              <b>{fmtNum(summary.reps.compensated, lang)}</b>
              <span>{t("compReps")}</span>
            </div>
            <div>
              <b>{fmtNum(summary.reps.partial, lang)}</b>
              <span>{t("partialReps")}</span>
            </div>
            {summary.measure && summary.measure.kind !== "hip_rise" ? (
              <div>
                <b>{fmtNum(summary.measure.rangeDeg, lang)}°</b>
                <span>{s.rangeMeasure}</span>
              </div>
            ) : (
              <div>
                <b>{summary.romPct != null ? fmtPct(summary.romPct / 100, lang) : "·"}</b>
                <span>{t("bestRom")}</span>
              </div>
            )}
          </div>
          <p className="micro">{t("ofYourRange")}</p>
          {summary.rpe != null && (
            <p>
              {t("rpeLabel")}: {fmtNum(summary.rpe, lang)}/{fmtNum(10, lang)}
            </p>
          )}
          <div className="summary-insight">
            <Icon name="spark" size={20} />
            <div>
              <h3>{x.insight}</h3>
              <p>{insight(summary.reps, lang)}</p>
            </div>
          </div>
          <RepReview reps={moments} lang={lang} demo={demo} />
          <p className="sum-note">
            {demo
              ? c.demoNotSaved
              : props.unsaved
                ? s.demoRunNote
                : trial
                  ? k.trialNote
                  : saved
                    ? t("saveNote")
                    : c.saveFailed}
          </p>
          <div className="modal-actions">
            {trial ? (
              <>
                <button className="cta" onClick={props.onRegister}>
                  {k.register}
                  <Icon name="arrow" size={16} />
                </button>
                {/* After a safety stop the set is not offered again at once (S0). */}
                {!safetyStop && (
                  <button className="ghost" onClick={onRestart}>
                    {k.tryAgain}
                  </button>
                )}
              </>
            ) : safetyStop ? (
              <>
                {/* After a safety stop: rest first. Leaving is the primary; going on is secondary and
                    a repeat of the same set is not offered at once (S0). */}
                <button className="cta" onClick={onExit}>
                  {c.newSession}
                </button>
                {props.onContinue && (
                  <button className="ghost" onClick={props.onContinue}>
                    {lang === "ar" ? "متابعة البرنامج" : "Continue program"}
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="cta" onClick={props.onContinue ?? onRestart}>
                  {props.onContinue ? (lang === "ar" ? "متابعة البرنامج" : "Continue program") : c.repeat}
                </button>
                <button className="ghost" onClick={onExit}>
                  {c.newSession}
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** The range arc with the count in its middle (training) or the measured reps (calibrating). */
function Gauge(p: {
  fillRef: React.RefObject<SVGPathElement>;
  ranged: boolean;
  lang: Lang;
  count: number;
  target: number;
  calReps: number;
  of: string;
  reps: string;
  measured: string;
  topLabel: string;
}) {
  const C = 120,
    R = 98,
    A0 = 150,
    SWEEP = 240;
  const at = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [C + R * Math.cos(r), C + R * Math.sin(r)] as const;
  };
  const [x0, y0] = at(A0);
  const [x1, y1] = at(A0 + SWEEP);
  const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  const [mx, my] = at(A0 + SWEEP * TOP_AT);
  return (
    <div className="cam2-gauge">
      <svg viewBox="0 0 240 240" aria-hidden>
        <defs>
          <linearGradient id="cam2-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#f6d36b" />
            <stop offset="1" stopColor="#e9b52c" />
          </linearGradient>
        </defs>
        <g className="cam2-arc">
          <path d={d} className="track" pathLength={100} />
          <path
            d={d}
            className="fill"
            pathLength={100}
            ref={p.fillRef}
            style={{ strokeDasharray: "0 100" }}
          />
          {p.ranged && (
            <g className="cam2-top-mark">
              <circle cx={mx} cy={my} r="13" className="halo" />
              <circle cx={mx} cy={my} r="6.5" className="dot" />
            </g>
          )}
        </g>
      </svg>
      <div className="cam2-gauge-center">
        {p.ranged ? (
          <>
            <b className={`cam2-count${p.count ? "" : " zero"}`} key={p.count}>
              {fmtNum(p.count, p.lang)}
            </b>
            <span className="cam2-target">
              {p.of} {fmtNum(p.target, p.lang)}
            </span>
          </>
        ) : (
          <span
            className="cam2-dots"
            role="img"
            aria-label={`${p.measured} ${fmtNum(p.calReps, p.lang)} ${p.of} ${fmtNum(2, p.lang)}`}
          >
            {[0, 1].map((i) => (
              <i key={i} className={i < p.calReps ? "on" : ""} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** The calm outline the person fits into while the camera finds them. */
function Outline({ presence, rise }: { presence: Presence; rise: boolean }) {
  return (
    <svg className={`cam2-outline ${presence}`} viewBox="0 0 200 260" aria-hidden>
      {rise ? (
        <>
          <circle cx="100" cy="34" r="20" />
          <path d="M62 250 C62 170 70 82 100 70 C130 82 138 170 138 250" />
        </>
      ) : (
        <>
          <circle cx="100" cy="60" r="30" />
          <path d="M28 258 C28 176 56 122 100 114 C144 122 172 176 172 258" />
        </>
      )}
    </svg>
  );
}

function OutlineGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <circle cx="24" cy="16" r="7" />
      <path d="M9 44 C9 31 15 25 24 24 C33 25 39 31 39 44" />
    </svg>
  );
}

/** A simple picture of the start position. */
function StartPicture({ exerciseId }: { exerciseId: string }) {
  if (exerciseId === "seated_biceps_curl")
    return (
      <svg viewBox="0 0 120 120" className="cam2-pose-art">
        <circle cx="62" cy="26" r="11" className="head" />
        <path d="M60 40 L58 80 L84 82 L86 104" className="body" />
        <path d="M60 46 L60 70 L62 88" className="arm" />
        <circle cx="62" cy="90" r="5" className="hand" />
        <path d="M44 84 H90" className="seat" />
      </svg>
    );
  if (exerciseId === "sit_to_stand")
    return (
      <svg viewBox="0 0 120 120" className="cam2-pose-art">
        <circle cx="52" cy="24" r="11" className="head" />
        <path d="M52 38 L52 74 L80 76 L80 104" className="body" />
        <path d="M52 46 L64 62 L76 60" className="arm" />
        <path d="M38 78 H86 M40 78 V106 M84 78 V106" className="seat" />
      </svg>
    );
  return (
    <svg viewBox="0 0 120 120" className="cam2-pose-art">
      <circle cx="60" cy="28" r="11" className="head" />
      <path d="M60 42 L60 84" className="body" />
      <path d="M42 46 L78 46" className="body" />
      <path d="M42 46 L26 62 L28 38" className="arm" />
      <path d="M78 46 L94 62 L92 38" className="arm" />
      <circle cx="28" cy="35" r="5" className="hand" />
      <circle cx="92" cy="35" r="5" className="hand" />
      <path d="M38 88 H82" className="seat" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden className="cam2-speaker">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {muted ? (
        <path d="m16 9.5 5 5m0 -5-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
          <path d="M18.2 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}

/** E2E only: a source in which nobody is in the picture (the outline). */
class EmptyPoseSource implements PoseSource {
  kind = "trace" as const;
  private timer = 0;
  async start(onFrame: (f: Frame) => void): Promise<void> {
    const step = () => {
      onFrame({
        t: performance.now(),
        lm: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
      });
      this.timer = requestAnimationFrame(step);
    };
    this.timer = requestAnimationFrame(step);
  }
  stop(): void {
    cancelAnimationFrame(this.timer);
  }
}

/**
 * The line that stays on the RPE and summary dialogs after the trunk safety stop (S0): a cream card
 * with the info icon and «توقف الآن واسترح.» · Stop now and rest., since the caption goes behind
 * the dialog and is the only signal with the voice off. Never the check mark of a finished set.
 */
function SafetyStopCard({ lang }: { lang: Lang }) {
  return (
    <div className="safety-stop-card" role="status">
      <Icon name="info" size={24} />
      <p>{CUE_TEXT.stop_rest[lang]}</p>
    </div>
  );
}
