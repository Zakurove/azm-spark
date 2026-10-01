/**
 * Device hooks of the camera screens (UX spec 4.2, 4.3, 4.6, 5.10): the phone's orientation, the
 * viewport (compact, landscape, the 2 m type scale), the screen wake lock, a finger on the screen,
 * and the voice with its captions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../../app/i18n";
import { CuePlayer, isVoiceLine, primeAudio } from "../../../app/audio";
import { t as translate } from "../../../i18n";
import { MotionGateTracker, type MotionGate } from "../../../engine/motion";
import { phoneTilt, type Tilt } from "../../../engine/quality";
import { isCheckCueId } from "../../../movements/assessments";
import { useCheckUi } from "../shared/CheckUi";
import type { CamNote } from "./controller";
import { captionOf, CueQueue, type CaptionLine, type CueRequest } from "./cues";

/* ------------------------------------------------------------ orientation (4.6, map 2.9) */

type PermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

export interface OrientationState {
  tilt: Tilt | null;
  gate: MotionGate;
  /** The at the phone «اسمح بقراءة الحركة» tap: asks again (the tap is the gesture iOS needs). */
  askAgain(): void;
}

export function useOrientation(): OrientationState {
  const tracker = useMemo(() => new MotionGateTracker(), []);
  const [tilt, setTilt] = useState<Tilt | null>(null);
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (window as unknown as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
    tracker.permission(api?.requestPermission ? "prompt" : "not_needed", performance.now());
    let last = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      const now = performance.now();
      tracker.reading({ t: now, beta: e.beta, gamma: e.gamma });
      // 10 Hz is enough for the level check and a moved phone (4.6).
      if (now - last < 100 || e.beta === null || e.gamma === null) return;
      last = now;
      const angle = screen.orientation?.angle ?? 0;
      setTilt(phoneTilt(e.beta, e.gamma, angle));
    };
    window.addEventListener("deviceorientation", onOrient);
    const id = setInterval(() => setVersion((v) => v + 1), 1000);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      clearInterval(id);
    };
  }, [tracker]);
  const askAgain = useCallback(() => {
    const api = (window as unknown as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
    tracker.askedAgain(performance.now());
    if (!api?.requestPermission) {
      tracker.permission("not_needed", performance.now());
      return;
    }
    api
      .requestPermission()
      .then((r) => tracker.permission(r, performance.now()))
      .catch(() => tracker.permission("denied", performance.now()));
  }, [tracker]);
  const angle = typeof screen === "undefined" ? 0 : (screen.orientation?.angle ?? 0);
  return { tilt, gate: tracker.status(performance.now(), angle), askAgain };
}

/* ------------------------------------------------------------ viewport (4.1, 4.2) */

export interface ViewportState {
  /** Under 700 px tall: the video shrinks first, the count and degrees use their compact sizes. */
  compact: boolean;
  /** A phone held sideways: only "Turn the phone upright" shows, and the test pauses. */
  phoneLandscape: boolean;
  /** A tablet or desktop in landscape: video at the inline end, cards at the inline start. */
  wide: boolean;
  /** Larger screens scale the 2 m sizes up by min(1.6, height ÷ 812), never down. */
  scale: number;
}

function readViewport(): ViewportState {
  if (typeof window === "undefined") return { compact: false, phoneLandscape: false, wide: false, scale: 1 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const landscape = w > h;
  const phoneLandscape = coarse && landscape && h < 600;
  return {
    compact: h < 700,
    phoneLandscape,
    wide: landscape && !phoneLandscape && w >= 900,
    scale: Math.min(1.6, Math.max(1, h / 812)),
  };
}

export function useViewport(): ViewportState {
  const [v, setV] = useState(readViewport);
  useEffect(() => {
    const on = () => setV(readViewport());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return v;
}

/* ------------------------------------------------------------ wake lock (4.6) */

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockApi = { request(type: "screen"): Promise<WakeLockSentinelLike> };

/** Keeps the screen on while the camera screen shows; asks again when the page is shown again. */
export function useWakeLock(): void {
  useEffect(() => {
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    let lock: WakeLockSentinelLike | null = null;
    let live = true;
    const ask = () => {
      api
        .request("screen")
        .then((l) => {
          if (live) lock = l;
          else void l.release();
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    ask();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/* ------------------------------------------------------------ a finger on the screen (S34i) */

export function useTouching(): boolean {
  const [touching, setTouching] = useState(false);
  useEffect(() => {
    const down = () => setTouching(true);
    const up = () => setTouching(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
  return touching;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------ voice and captions (4.3) */

export interface CameraCaption extends CaptionLine {
  /** Changes with every line, so a repeated line shows again. */
  n: number;
  /** When its line was asked for (ms), so the screen shows it only in that part (R-11). */
  at: number;
}

export interface CameraCues {
  caption: CameraCaption | null;
  /** A cue failed to play (autoplay blocked, no voice): "Tap to turn on the sound" shows. */
  blocked: boolean;
  push(reqs: readonly CueRequest[]): void;
  note(n: CamNote): void;
  /** STOP and overlays: the current line stops and nothing waiting plays. */
  silence(): void;
  replay(): void;
  unblock(): void;
  busyUntil(): number;
}

/**
 * The cue queue on the phone: plays lines through CuePlayer (recorded files, the device voice as a
 * fallback), shows each line in the caption card as it starts, and feeds the one hidden announcer
 * only when the line is not heard (sound off, a failed play). Timed tests never get a spoken count:
 * the runner sends no count cue (D-009).
 */
export function useCameraCues(active: boolean): CameraCues {
  const ui = useCheckUi();
  const langRef = useRef<Lang>(ui.lang);
  langRef.current = ui.lang;
  const soundRef = useRef(ui.sound.on);
  soundRef.current = ui.sound.on;
  const showRef = useRef(ui.showCaption);
  showRef.current = ui.showCaption;
  const player = useMemo(() => new CuePlayer(ui.lang), []);
  const queue = useMemo(() => new CueQueue(() => langRef.current), []);
  const [caption, setCaption] = useState<CameraCaption | null>(null);
  const [blocked, setBlocked] = useState(false);
  const counter = useRef(0);
  const failures = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => player.setLang(ui.lang), [ui.lang, player]);
  useEffect(() => {
    player.muted = !ui.sound.on;
  }, [ui.sound.on, player]);
  useEffect(() => () => player.stop(), [player]);

  const show = useCallback((line: CaptionLine, at: number, speaking: boolean, clearAfterMs?: number) => {
    counter.current += 1;
    setCaption({ ...line, n: counter.current, at });
    showRef.current(line.text, line.severity, speaking);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = clearAfterMs
      ? setTimeout(() => {
          setCaption(null);
          clearTimer.current = null;
        }, clearAfterMs)
      : null;
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const next = queue.next(performance.now());
      if (!next) return;
      if (next.interrupt) player.stop();
      const cue = String(next.id);
      const line = isCheckCueId(cue) ? captionOf(cue, langRef.current) : null;
      const speak = next.speak && soundRef.current && isVoiceLine(cue);
      // The caption shows as the line starts; the hidden announcer hears it only when no voice says
      // it (sound off, a prompt of a timed trial, or a failed play), so nothing is announced twice.
      if (line) show(line, next.at, speak);
      if (!speak) return;
      // The line lasts until its voice ends (CuePlayer onEnd), not an estimate.
      void player
        .line(cue as Parameters<CuePlayer["line"]>[0], "safety", () => queue.heardEnd(cue, performance.now()))
        .then((ok) => {
          failures.current = ok ? 0 : failures.current + 1;
          setBlocked(failures.current >= 2);
          if (ok) queue.spoken(cue);
          if (!ok && line) showRef.current(line.text, line.severity, false);
        });
    }, 100);
    return () => clearInterval(id);
  }, [active, queue, player, show]);

  return {
    caption,
    blocked,
    push: (reqs) => {
      for (const r of reqs) queue.push(r);
    },
    note: (n) => {
      const text = n.text ? n.text[langRef.current] : n.key ? translate(langRef.current, n.key) : "";
      if (!text) return;
      show({ text, severity: n.severity }, performance.now(), false, n.clearAfterMs);
    },
    silence: () => {
      queue.clear();
      player.stop();
    },
    replay: () => {
      const c = caption;
      if (!c) return;
      const speak = !!c.cue && soundRef.current && isVoiceLine(c.cue);
      if (speak) void player.line(c.cue as Parameters<CuePlayer["line"]>[0], "safety");
      show(c, c.at, speak);
    },
    unblock: () => {
      primeAudio(langRef.current);
      failures.current = 0;
      setBlocked(false);
    },
    busyUntil: () => queue.busyUntil,
  };
}

/**
 * Speaks an interface line with a voice on the device (never a speech service), for the one line the
 * spec asks to hear that has no recording: the stillness offer of the calibration (S34d, O35).
 */
export function speakText(text: string, lang: Lang, soundOn: boolean): void {
  if (!soundOn || typeof speechSynthesis === "undefined") return;
  const tag = lang === "ar" ? "ar" : "en";
  const voice = speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.toLowerCase().startsWith(tag));
  if (!voice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang;
  u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
