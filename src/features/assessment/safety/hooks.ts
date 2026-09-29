/**
 * React side of the safety screens: the spoken sequence with its captions, the alarm tone, the chime,
 * the wake lock and the no answer timers (UX spec S36 to S49, 4.3, 4.6, 5.10 useCues, useAlarm,
 * useWakeLock). Every timer runs on the phone and never waits for the network.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCheckUi } from "../shared/CheckUi";
import { SequencePlayer } from "./speechPlayer";
import type { SpeechLine } from "./speech";
import { SAFETY_TIMING } from "./timing";
import { alarmUri, chimeUri } from "./tones";

/** The latest value of `v`, for callbacks that outlive a render. */
export function useLatest<T>(v: T) {
  const ref = useRef(v);
  ref.current = v;
  return ref;
}

export interface SequenceState {
  /** The mark of the sentence being shown ("<block>:<index>"), or null. */
  mark: string | null;
  /** The index of the line being shown, or null. */
  index: number | null;
  /** True once every line has been shown. */
  done: boolean;
  /** Listen again: from the first line (of `lines`, or of other lines such as a longer Listen form). */
  replay(other?: readonly SpeechLine[]): void;
  stop(): void;
}

/**
 * Plays `lines` once when the screen opens (after `delayMs`, so a screen reader reads the focused
 * heading first), showing each line in the caption slot while it plays. Listen again replays. The
 * Sound setting is read at each line; turning it off silences the voice and the text keeps stepping.
 * `key` changes when the text changes (a new screen or language), which starts it over.
 */
export function useSpeechSequence(
  lines: readonly SpeechLine[],
  opts: { key: string; autoplay?: boolean; delayMs?: number; onEnd?: () => void },
): SequenceState {
  const ui = useCheckUi();
  const uiRef = useLatest(ui);
  const linesRef = useLatest(lines);
  const onEndRef = useLatest(opts.onEnd);
  const player = useRef<SequencePlayer | null>(null);
  const playing = useRef<readonly SpeechLine[]>(lines);
  const [index, setIndex] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const start = useCallback((other?: readonly SpeechLine[]) => {
    player.current ??= new SequencePlayer();
    setDone(false);
    const list = other ?? linesRef.current;
    playing.current = list;
    player.current.play(list, {
      lang: uiRef.current.lang,
      soundOn: () => uiRef.current.sound.on,
      onLine(i, speaking) {
        const line = list[i];
        setIndex(i);
        if (line) uiRef.current.showCaption(line.display, line.severity, speaking);
      },
      onEnd() {
        setIndex(null);
        setDone(true);
        uiRef.current.clearCaption();
        onEndRef.current?.();
      },
    });
  }, []);

  useEffect(() => {
    if (opts.autoplay === false) return;
    const timer = setTimeout(() => start(), opts.delayMs ?? SAFETY_TIMING.speechDelayMs);
    return () => {
      clearTimeout(timer);
      player.current?.stop();
      setIndex(null);
    };
  }, [opts.key]);

  // The caption belongs to this screen: cleared when it goes.
  useEffect(
    () => () => {
      player.current?.stop();
      uiRef.current.clearCaption();
    },
    [],
  );

  // Sound off: the voice stops at once; the text keeps stepping (captions carry everything).
  useEffect(() => {
    if (!ui.sound.on) player.current?.silence();
  }, [ui.sound.on]);

  const stop = useCallback(() => {
    player.current?.stop();
    setIndex(null);
    uiRef.current.clearCaption();
  }, []);

  return {
    mark: index === null ? null : (playing.current[index]?.mark ?? null),
    index,
    done,
    replay: start,
    stop,
  };
}

/* ------------------------------------------------------------------ alarm and chime */

export type AlarmStatus = "sounding" | "blocked" | "stopped";

let primed: HTMLAudioElement | null = null;

/**
 * The alarm element is primed by the first tap in the check (4.6), so it can sound later without a
 * tap (iOS lets an element play only when a tap started it once). Installed once when the safety
 * screens load; the element stays silent until the alarm.
 */
export function installAlarmPrimer(doc: Document | undefined = globalThis.document): void {
  if (!doc || typeof Audio === "undefined") return;
  const prime = () => {
    doc.removeEventListener("pointerdown", prime, true);
    doc.removeEventListener("keydown", prime, true);
    if (primed) return;
    const el = new Audio(alarmUri());
    el.muted = true;
    el.loop = true;
    primed = el;
    void el
      .play()
      .then(() => {
        if (el !== primed || !el.muted) return;
        el.pause();
        el.currentTime = 0;
      })
      .catch(() => undefined);
  };
  doc.addEventListener("pointerdown", prime, true);
  doc.addEventListener("keydown", prime, true);
}

function alarmElement(): HTMLAudioElement {
  primed ??= new Audio(alarmUri());
  return primed;
}

/**
 * The no response alarm (S45, 5.10 useAlarm): a looped tone at full element volume whatever the Sound
 * setting, captionsOnly or screen reader mode, faded in from 30% over 3 s, with vibration on Android.
 * If the browser refuses to start it (no tap yet), it starts on the next touch anywhere. `stop()`
 * silences it (the fine button, the 997 call).
 */
export function useAlarmTone(active: boolean): { status: AlarmStatus; stop(): void } {
  const [status, setStatus] = useState<AlarmStatus>("stopped");
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!active || typeof Audio === "undefined") return;
    const el = alarmElement();
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }
    let stopped = false;
    let fade: ReturnType<typeof setInterval> | undefined;
    let buzz: ReturnType<typeof setInterval> | undefined;
    const vibrate = (p: number | number[]) => {
      // Browsers refuse vibration before the first tap in the page (and log it): wait for it.
      const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
        .userActivation;
      if (activation && !activation.hasBeenActive) return;
      try {
        if (typeof navigator.vibrate === "function") navigator.vibrate(p);
      } catch {
        /* not supported */
      }
    };
    const begin = () => {
      if (stopped) return;
      el.muted = false;
      el.loop = true;
      el.volume = SAFETY_TIMING.alarmStartVolume;
      try {
        el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      void el
        .play()
        .then(() => {
          if (stopped) return el.pause();
          setStatus("sounding");
          const t0 = Date.now();
          clearInterval(fade);
          fade = setInterval(() => {
            const k = Math.min(1, (Date.now() - t0) / SAFETY_TIMING.alarmFadeMs);
            el.volume = SAFETY_TIMING.alarmStartVolume + (1 - SAFETY_TIMING.alarmStartVolume) * k;
            if (k >= 1) clearInterval(fade);
          }, 100);
        })
        .catch(() => {
          if (stopped) return;
          setStatus("blocked");
          // Starts on the next touch or key press anywhere (the touch itself is not a fine).
          const retry = () => {
            document.removeEventListener("pointerdown", retry, true);
            document.removeEventListener("keydown", retry, true);
            begin();
          };
          document.addEventListener("pointerdown", retry, true);
          document.addEventListener("keydown", retry, true);
        });
      const [on, off] = SAFETY_TIMING.vibration;
      vibrate([on, off]);
      clearInterval(buzz);
      buzz = setInterval(() => vibrate([on, off]), on + off);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(fade);
      clearInterval(buzz);
      vibrate(0);
      el.pause();
      setStatus("stopped");
    };
    stopRef.current = stop;
    begin();
    return stop;
  }, [active]);

  return { status, stop: useCallback(() => stopRef.current(), []) };
}

let chimeEl: HTMLAudioElement | null = null;

/** The soft two note chime (S43 at 7 s, S47 on arrival). It follows the Sound setting. */
export function playChime(soundOn: boolean): void {
  if (!soundOn || typeof Audio === "undefined") return;
  chimeEl ??= new Audio(chimeUri());
  try {
    chimeEl.currentTime = 0;
  } catch {
    /* not seekable yet */
  }
  void chimeEl.play().catch(() => undefined);
}

/* ------------------------------------------------------------------ device */

/**
 * Keeps the screen on while a safety screen is open (4.6, S36: the wake lock is kept and released
 * only when the person leaves the screen), and asks again when the page is shown again.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    };
    if (!active || !nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      void nav
        .wakeLock!.request("screen")
        .then((l) => {
          if (gone) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/* ------------------------------------------------------------------ timers */

/**
 * A no answer timer (S41 30 s, S38b 30 s): `onExpire` runs once `ms` pass with no touch, scroll, key
 * press or focus change inside `root` (each restarts it, Q31 (2)). `restart()` restarts it (Listen to
 * the choices). Off while `enabled` is false.
 */
export function useNoAnswerTimer(
  root: RefObject<HTMLElement>,
  ms: number,
  onExpire: () => void,
  enabled: boolean,
): { restart(): void } {
  const expire = useLatest(onExpire);
  const enabledRef = useLatest(enabled);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restart = useCallback(() => {
    clearTimeout(timer.current);
    if (!enabledRef.current) return;
    timer.current = setTimeout(() => expire.current(), ms);
  }, [ms]);

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timer.current);
      return;
    }
    restart();
    const el = root.current;
    const events = ["pointerdown", "keydown", "focusin", "scroll", "wheel", "touchmove"] as const;
    for (const e of events) el?.addEventListener(e, restart, { capture: true, passive: true });
    // The overlay layer itself scrolls (check-overlay), so its scroll counts too.
    const scroller = el?.closest(".check-overlay");
    scroller?.addEventListener("scroll", restart, { passive: true });
    window.addEventListener("scroll", restart, { passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const e of events) el?.removeEventListener(e, restart, { capture: true });
      scroller?.removeEventListener("scroll", restart);
      window.removeEventListener("scroll", restart);
    };
  }, [enabled, restart]);

  return { restart };
}

/** Seconds left of a countdown that started when `running` turned true (rings, rests). */
export function useCountdown(totalMs: number, running = true): number {
  const [left, setLeft] = useState(totalMs);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setLeft(totalMs);
    const id = setInterval(() => {
      const l = Math.max(0, totalMs - (Date.now() - t0));
      setLeft(l);
      if (l <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [totalMs, running]);
  return left;
}
