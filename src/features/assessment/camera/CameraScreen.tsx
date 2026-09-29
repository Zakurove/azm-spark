/**
 * S34, the camera sequence of one test (UX spec S34c to S34k, 4.1 to 4.8), on one CameraStage.
 *
 * The flow (useCheckFlow) says which part shows: cam.setup, cam.calibrate, cam.practice,
 * cam.countdown, cam.measure, cam.saved, cam.retry or cam.rest. The CameraController of the test
 * side (registry.ts) turns camera frames into flow events through the engine (createRunner, the
 * setup check, SubjectLock, QualityMonitor inside the runners, the check in detectors), and this
 * screen dispatches them, plays the cues through CuePlayer with their captions, and draws the value
 * card of the part (CameraView, shared with the E2E previews). Video never leaves the phone.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { countPhrase, t } from "../../../i18n";
import type { Frame, Landmark } from "../../../engine/types";
import { testDef } from "../../../movements/assessments";
import { usesWheelchair } from "../booth/SetupTips";
import { StaffCountCorrection } from "../booth/StaffCountCorrection";
import { outcomeKey, testCounter, type FlowEvent, type FlowModel } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { useCheckUi, type CaptionSeverity } from "../shared/CheckUi";
import { CameraStage, type StageCaption } from "./CameraStage";
import { CameraVideo } from "./CameraVideo";
import {
  IDLE_ENV,
  triesLeft,
  type CamEnv,
  type CamOutput,
  type CamSnapshot,
  type CamTest,
} from "./controller";
import {
  speakText,
  useCameraCues,
  useOrientation,
  useReducedMotion,
  useTouching,
  useViewport,
  useWakeLock,
} from "./hooks";
import {
  CalibratePanel,
  LeanPanel,
  LoadingPanel,
  ModelErrorPanel,
  RangePanel,
  RestPanel,
  RetryPanel,
  SavedPanel,
  SetupPanel,
  TimedPanel,
  TipsSheet,
  UprightPanel,
} from "./panels";
import { controllerFor } from "./registry";
import { cameraSession, useCameraSession, type CamError, type CamStatus } from "./session";
import { camTiming, e2eFastTiming, type CamTiming } from "./timing";
import { ARM_KEY, framingViewOf, PHASE_KEY, SETUP_TITLE, type AttemptDot } from "./view";

/**
 * O3: live degrees during the arm raise are off at the booth and at home (council UX round). The
 * flag stays so a later council decision can turn them on; the HUD then shows them beside the ring.
 */
export const SHOW_LIVE_DEGREES = false;

/** E2E builds only: the static previews of every part and state for the review screenshots. */
const CameraPreview = import.meta.env.VITE_E2E === "1" ? lazy(() => import("./e2e/CameraPreview")) : null;

function previewName(): string | null {
  if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined") return null;
  return new URLSearchParams(location.search).get("e2eCamPreview");
}

export function CameraScreen(props: ScreenProps) {
  const preview = previewName();
  if (preview && CameraPreview)
    return (
      <Suspense fallback={null}>
        <CameraPreview name={preview} {...props} />
      </Suspense>
    );
  return <LiveCamera {...props} />;
}

/* ================================================================ the live screen */

function LiveCamera({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const timing: CamTiming = useMemo(() => camTiming(e2eFastTiming()), []);
  const ctrl = controllerFor(model, timing)!;
  // E2E builds only: the specs read the controller's snapshot (VITE_E2E is replaced at build time).
  if (import.meta.env.VITE_E2E === "1") (window as unknown as { __s34?: unknown }).__s34 = ctrl;
  const orientation = useOrientation();
  const viewport = useViewport();
  const reduced = useReducedMotion();
  const touching = useTouching();
  useWakeLock();
  const cues = useCameraCues(true);
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const langRef = useRef(lang);
  langRef.current = lang;
  const soundRef = useRef(ui.sound.on);
  soundRef.current = ui.sound.on;
  const [snap, setSnap] = useState<CamSnapshot>(() => ctrl.snapshot(performance.now()));
  const [tips, setTips] = useState(false);
  // S57: our staff correct a timed count on S34h; the saved screen waits while the dialog is open.
  const [staffCounting, setStaffCounting] = useState(false);
  const lastFrame = useRef<Frame | null>(null);
  const envRef = useRef<CamEnv>(IDLE_ENV);
  envRef.current = {
    tilt: orientation.tilt,
    landscape: viewport.phoneLandscape,
    // A dialog over the stage (the tips) holds the retry count like a finger on the screen (S34i).
    touching: touching || tips,
    cueEndsAt: cues.busyUntil(),
    holdSaved: staffCounting,
  };

  const apply = useCallback(
    (out: CamOutput) => {
      for (const e of out.events) dispatch(e);
      if (out.cues.length) cuesRef.current.push(out.cues);
      for (const n of out.notes) {
        cuesRef.current.note(n);
        if (n.speak) speakText(t(langRef.current, n.key), langRef.current, soundRef.current);
      }
    },
    [dispatch],
  );

  // The flow model moved on (an answer, a dialog, STOP): the controller follows it.
  useEffect(() => {
    apply(ctrl.sync(model, performance.now()));
  }, [model, ctrl, apply]);

  // Frames from the camera (or the E2E fixture source) go to the controller as they come.
  const session = useCameraSession((f) => {
    lastFrame.current = f;
    apply(ctrl.frame(f, envRef.current, f.t));
  });

  // The screen's own clock: timers run without frames, and the HUD redraws ten times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      apply(ctrl.tick(now, envRef.current));
      setSnap(ctrl.snapshot(now));
      // No frame for a while although the camera runs: it stopped (S34 errors).
      if (cameraSession.stalled(now)) dispatch({ type: "CAMERA_ERROR", problem: "stopped" });
    }, 100);
    return () => clearInterval(id);
  }, [ctrl, apply, dispatch]);

  // Camera problems go to S32; a model that did not load stays here with Try again (S34 Er).
  useEffect(() => {
    if (session.status !== "error" || !session.error || session.error === "model") return;
    dispatch({ type: "CAMERA_ERROR", problem: session.error });
  }, [session.status, session.error, dispatch]);

  // Page hidden (a call, another app): the attempt is discarded and the camera stops (4.6).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      cameraSession.stop();
      dispatch({ type: "CAMERA_ERROR", problem: "stopped" });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dispatch]);

  // STOP, the stop list and the check in silence the current line (principle 6).
  const overlay = model.overlay?.kind ?? null;
  useEffect(() => {
    if (overlay) cuesRef.current.silence();
  }, [overlay]);

  // Map 2.9: motion access refused after asking again skips the arm raise (motion_needed).
  const motionFirst = snap.kind === "cam.setup" && snap.setup.issues[0] === "motion";
  const motionNeeded = motionFirst && orientation.gate.status === "motion_needed";
  useEffect(() => {
    if (motionNeeded) dispatch({ type: "MOTION_REFUSED" });
  }, [motionNeeded, dispatch]);

  // O35: the stillness offer is said with a voice on the device and captioned.
  const offer = snap.calibrationOffer;
  useEffect(() => {
    if (!offer) return;
    cuesRef.current.note({ key: "assessment.setup.stillness.body", severity: "info" });
    speakText(t(lang, "assessment.setup.stillness.body"), lang, ui.sound.on);
  }, [offer]);

  useAnnouncements(snap, ctrl.test, model, lang, ui.showCaption);

  return (
    <CameraView
      model={model}
      dispatch={dispatch}
      snap={snap}
      test={ctrl.test}
      timed={ctrl.timed}
      session={session}
      device={{
        phoneLandscape: viewport.phoneLandscape,
        compact: viewport.compact,
        scale: viewport.scale,
        reduced,
      }}
      caption={cues.caption}
      blocked={cues.blocked}
      timing={timing}
      tips={tips}
      onTips={setTips}
      onStaffCount={setStaffCounting}
      video={{ frame: lastFrame, subject: () => ctrl.subject() }}
      motion={motionFirst ? { onAllow: orientation.askAgain } : null}
      practiceSkippable={!ctrl.practiceWasSkipped}
      on={{
        stop: () => {
          cues.silence();
          dispatch({ type: "STOP" });
        },
        replay: () => cues.replay(),
        unblock: () => {
          cues.unblock();
          cues.replay();
        },
        skipPractice: () => apply(ctrl.skipPractice(performance.now())),
        retryModel: () => cameraSession.restart(),
      }}
    />
  );
}

/* ================================================================ the view (live and previews) */

export type StageKind = "setup" | "range" | "timed" | "lean" | "rest" | "saved" | "retry" | "calibrate";

export interface CameraViewProps {
  model: FlowModel;
  dispatch(e: FlowEvent): void;
  snap: CamSnapshot;
  test: CamTest;
  timed: boolean;
  session: { status: CamStatus; error: CamError | null; video: HTMLVideoElement | null; hasPicture: boolean };
  device: { phoneLandscape: boolean; compact: boolean; scale: number; reduced: boolean };
  caption: StageCaption | null;
  blocked: boolean;
  timing: Pick<CamTiming, "tipsAfterSec" | "skipAfterSec">;
  tips: boolean;
  onTips(open: boolean): void;
  /** S57: the staff count dialog opened or closed (booth, S34h of a timed test). */
  onStaffCount?: (open: boolean) => void;
  video: { frame: { current: Frame | null }; subject(): Landmark[] | null };
  /** A stand in for the camera picture (the E2E previews have no camera). */
  picture?: ReactNode;
  motion: { onAllow(): void } | null;
  practiceSkippable: boolean;
  on: { stop(): void; replay(): void; unblock(): void; skipPractice(): void; retryModel(): void };
  /** The Large captions choice, when the person made one (E2E previews set it). */
  largeCaptions?: boolean;
}

export function CameraView(p: CameraViewProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const { model, dispatch, snap, test, session, device } = p;
  const [largeChoice, setLargeChoice] = useState<boolean | null>(p.largeCaptions ?? null);
  // The compact sizes of 4.2 on short screens, and whenever the content does not fit the screen.
  const [fitCompact, setFitCompact] = useState(false);
  const compact = device.compact || fitCompact;
  const stopRef = useRef<HTMLButtonElement>(null);

  // STOP takes focus when the screen opens (it is first in the focus order, principle 6).
  useEffect(() => {
    stopRef.current?.focus({ preventScroll: true });
  }, []);

  const s = model.state;
  const def = testDef(test.testId);
  const counter = testCounter(model);
  const title = counter ? [t(lang, "assessment.common.testOf", counter), def.name[lang]] : [def.name[lang]];
  const measuring =
    snap.part === "attempt" || snap.part === "hold" || snap.part === "practice" || snap.part === "countdown";
  const large = largeChoice ?? (!ui.sound.on || (model.data.soundMode ?? "voice") !== "voice");
  const running = session.status === "running";
  const setupPart = s.kind === "cam.setup" || s.kind === "cam.calibrate" || snap.part === "calibrate";
  const item = model.data.tests[test.i]?.sides[test.sideIndex];
  const staffShown = item ? (model.data.staffCount[outcomeKey(item.testId, item.side)] ?? null) : null;
  const side: "left" | "right" = test.side === "left" ? "left" : "right";

  const hud = (): { kind: StageKind; card: ReactNode } => {
    if (def.kind === "range_test")
      return {
        kind: "range",
        card: (
          <RangePanel
            snap={snap}
            lang={lang}
            side={side}
            showDegrees={SHOW_LIVE_DEGREES}
            reducedMotion={device.reduced}
          />
        ),
      };
    if (def.kind === "timed_count")
      return {
        kind: "timed",
        card: (
          <TimedPanel snap={snap} lang={lang} test={test} compact={compact} reducedMotion={device.reduced} />
        ),
      };
    return {
      kind: "lean",
      card: (
        <LeanPanel
          snap={snap}
          lang={lang}
          test={test}
          otherDots={otherDots(model, test)}
          reducedMotion={device.reduced}
        />
      ),
    };
  };

  const part = (): { kind: StageKind; card: ReactNode } => {
    switch (s.kind) {
      case "cam.setup":
        return {
          kind: "setup",
          card: (
            <SetupPanel
              snap={snap}
              test={test}
              lang={lang}
              motion={p.motion}
              onTips={() => p.onTips(true)}
              onSkip={() => dispatch({ type: "SKIP" })}
              tipsAfterSec={p.timing.tipsAfterSec}
              skipAfterSec={p.timing.skipAfterSec}
              reducedMotion={device.reduced}
            />
          ),
        };
      case "cam.calibrate":
        return {
          kind: "calibrate",
          card: (
            <CalibratePanel
              snap={snap}
              lang={lang}
              sideLabel={test.side === "none" ? null : t(lang, ARM_KEY[side])}
              offer={{
                onTryAgain: () => dispatch({ type: "RETRY" }),
                onSkip: () => dispatch({ type: "SKIP" }),
              }}
              reducedMotion={device.reduced}
            />
          ),
        };
      case "cam.saved":
        return {
          kind: "saved",
          card: (
            <SavedPanel
              snap={staffShown === null ? snap : { ...snap, count: staffShown }}
              lang={lang}
              timed={p.timed}
            />
          ),
        };
      case "cam.retry":
        return {
          kind: "retry",
          card: (
            <RetryPanel
              snap={snap}
              lang={lang}
              test={test}
              issue={s.issue}
              exhausted={s.exhausted}
              // The retry being offered is one of the extra tries: at the first failure two remain.
              triesLeft={triesLeft(test.testId, Math.max(0, model.data.run.retriesUsed - 1))}
              onNow={() => dispatch({ type: "RETRY" })}
              onSkip={() => dispatch({ type: "SKIP" })}
              onTips={() => p.onTips(true)}
              reducedMotion={device.reduced}
            />
          ),
        };
      case "cam.rest": {
        // The runner's own rests (between attempts, after the practice, before a repeat) show the
        // HUD once the runner moves on; until then the rest card.
        const runnerRest = s.purpose === "attempt" || s.purpose === "practice" || s.purpose === "retryRest";
        if (runnerRest && snap.part !== "rest") return hud();
        const wheelchair =
          test.testId === "arm_curl_30s" && s.purpose === "sideChange" && test.position === "wheelchair";
        const next =
          s.purpose === "sideChange" && test.side !== "none"
            ? t(lang, ARM_KEY[side])
            : s.purpose === "attempt"
              ? nextTryLabel(snap, lang)
              : null;
        return {
          kind: "rest",
          card: (
            <RestPanel
              snap={snap}
              lang={lang}
              next={next}
              wheelchairDiagram={wheelchair}
              reducedMotion={device.reduced}
            />
          ),
        };
      }
      default:
        return hud();
    }
  };

  let kind: StageKind = "setup";
  let card: ReactNode;
  if (session.status === "error" && session.error === "model") {
    card = (
      <ModelErrorPanel
        lang={lang}
        onRetry={p.on.retryModel}
        onLater={() => {
          dispatch({ type: "CAMERA_ERROR", problem: "stopped" });
          dispatch({ type: "LATER" });
        }}
      />
    );
  } else if (!running) {
    card = (
      <LoadingPanel
        text={t(
          lang,
          session.status === "camera" ? "assessment.state.loading.camera" : "assessment.state.loading.model",
        )}
      />
    );
  } else if (device.phoneLandscape) {
    card = <UprightPanel lang={lang} />;
  } else {
    const r = part();
    kind = r.kind;
    card = r.card;
  }

  const guideState: "none" | "adjust" | "ready" = snap.setup.ok
    ? "ready"
    : (snap.setup.issues[0] ?? "no_person") === "no_person"
      ? "none"
      : "adjust";
  const video =
    running && !device.phoneLandscape ? (
      <CameraVideo
        video={session.hasPicture ? session.video : null}
        frame={p.video.frame}
        subject={p.video.subject}
        skeleton={setupPart}
        picture={p.picture}
        guide={s.kind === "cam.setup" ? { view: framingViewOf(test.testId), state: guideState } : null}
        armMarker={
          def.kind === "range_test" && !setupPart && test.side !== "none"
            ? { side: test.side, label: t(lang, ARM_KEY[test.side]) }
            : null
        }
        replayLabel={t(lang, "assessment.hud.replay")}
        onReplay={p.on.replay}
      />
    ) : null;

  // S57: at the booth our staff may correct the count of a timed test on S34h (countSource staff).
  const staffCount =
    ui.booth && p.timed && s.kind === "cam.saved" ? (
      <StaffCountCorrection
        autoCount={staffShown ?? snap.count}
        onSave={(n) => dispatch({ type: "STAFF_COUNT", count: n })}
        onOpenChange={(open) => p.onStaffCount?.(open)}
      />
    ) : null;

  const skipPractice =
    test.testId === "trunk_control_seated" && s.kind === "cam.practice" && p.practiceSkippable ? (
      <button type="button" className="check-text-button s34-text-button" onClick={p.on.skipPractice}>
        {t(lang, "assessment.test.skipPractice")}
      </button>
    ) : null;

  const caption =
    device.phoneLandscape && running
      ? { text: t(lang, "assessment.setup.turnUpright"), severity: "warn" as const }
      : p.caption;

  return (
    <>
      <CameraStage
        title={title}
        helperChip={model.data.helperRequired.includes(test.testId)}
        sound={{ blocked: p.blocked, onUnblock: p.on.unblock }}
        largeCaptions={{ on: large, onToggle: () => setLargeChoice(!large) }}
        caption={caption}
        onReplay={p.on.replay}
        video={video}
        videoMode={large && measuring ? "thumb" : fitCompact && measuring ? "strip" : "full"}
        card={card}
        actions={skipPractice ?? staffCount}
        compact={compact}
        scale={device.scale}
        onOverflow={() => setFitCompact(true)}
        kind={kind}
        onStop={p.on.stop}
        stopRef={stopRef}
      />
      {p.tips && (
        <TipsSheet
          lang={lang}
          meters={def.setup.distanceM}
          wheelchair={usesWheelchair(model)}
          onBack={() => p.onTips(false)}
        />
      )}
    </>
  );
}

/** "Try 2 of 3" after a rest between attempts. */
function nextTryLabel(snap: CamSnapshot, lang: Lang): string | null {
  const n = snap.dots.filter((d) => d === "saved").length + 1;
  if (n > snap.dots.length) return null;
  return t(lang, "assessment.common.tryOf", { n, total: snap.dots.length });
}

/** The side lean's dots of the other side: saved when that side was measured today. */
export function otherDots(model: FlowModel, test: CamTest): AttemptDot[] {
  const def = testDef(test.testId);
  const other = test.side === "left" ? "right" : "left";
  const outcome = model.data.outcomes[outcomeKey(test.testId, other)];
  const dot: AttemptDot = outcome?.status === "measured" ? "saved" : "pending";
  return Array.from({ length: def.attempts }, () => dot);
}

/* ================================================================ announcements */

/**
 * The screen reader announcements of S34 (UX spec S34 accessibility, 4.3), through the one hidden
 * announcer: a setup title once it held 2 s (at most every 6 s), "Try 2, saved" when an attempt of
 * the arm raise is saved (never the value), the final count once at time up, and the side lean's
 * phase word when it changes (at most every 3 s). Nothing while an overlay is open.
 */
function useAnnouncements(
  snap: CamSnapshot,
  test: CamTest,
  model: FlowModel,
  lang: Lang,
  announce: (text: string, severity?: CaptionSeverity, speaking?: boolean) => void,
) {
  const last = useRef({ key: "", at: -Infinity, since: 0, said: "" });
  const saved = useRef(0);
  const timeUpSaid = useRef(false);
  useEffect(() => {
    if (model.overlay) return;
    const now = performance.now();
    const say = (text: string) => {
      last.current.said = text;
      last.current.at = now;
      announce(text, "info", false);
    };
    if (model.state.kind === "cam.setup") {
      const key = snap.setup.ok ? "ready" : (snap.setup.issues[0] ?? "no_person");
      if (key !== last.current.key) {
        last.current.key = key;
        last.current.since = now;
      }
      const text =
        key === "ready"
          ? t(lang, "assessment.setup.ready")
          : t(lang, SETUP_TITLE[key as keyof typeof SETUP_TITLE]);
      if (now - last.current.since >= 2000 && now - last.current.at >= 6000 && text !== last.current.said)
        say(text);
      return;
    }
    const n = snap.dots.filter((d) => d === "saved").length;
    if (test.testId === "shoulder_abduction" && n > saved.current)
      say(t(lang, "assessment.hud.dotSaved", { n }));
    saved.current = n;
    if (snap.timeUp && !timeUpSaid.current) {
      timeUpSaid.current = true;
      say(countPhrase(lang, testDef(test.testId).resultUnit, snap.count));
    }
    if (!snap.timeUp) timeUpSaid.current = false;
    if (test.testId === "trunk_control_seated" && snap.phaseWord && snap.phaseWord !== last.current.key) {
      if (now - last.current.at >= 3000) {
        last.current.key = snap.phaseWord;
        say(t(lang, PHASE_KEY[snap.phaseWord]));
      }
    }
  }, [snap, model.overlay, model.state, lang, test.testId, announce]);
}
