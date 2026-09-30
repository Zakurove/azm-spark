/**
 * React side of the safety screens: the spoken sequence with its captions, the alarm tone, the chime,
 * the wake lock and the no answer timers (UX spec S36 to S49, 4.3, 4.6, 5.10 useCues, useAlarm,
 * useWakeLock). Every timer runs on the phone and never waits for the network.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { localizeDigits } from "../../../i18n";
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
  /** Whether a voice is reading the line being shown now (read at the moment of the call). */
  speaking(): boolean;
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
  opts: {
    key: string;
    autoplay?: boolean;
    delayMs?: number;
    onEnd?: () => void;
    /** Asked before each line after the first: false ends the sequence at the end of the line before. */
    beforeLine?: () => boolean;
  },
): SequenceState {
  const ui = useCheckUi();
  const uiRef = useLatest(ui);
  const linesRef = useLatest(lines);
  const onEndRef = useLatest(opts.onEnd);
  const beforeRef = useLatest(opts.beforeLine);
  const speakingNow = useRef(false);
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
      beforeLine() {
        const go = beforeRef.current?.() ?? true;
        if (!go) speakingNow.current = false;
        return go;
      },
      onLine(i, speaking) {
        const line = list[i];
        speakingNow.current = speaking;
        setIndex(i);
        // The caption's tap plays this line again (3.0). A line already on the screen as its heading
        // is not repeated in the strip above it.
        // The caption is kept in the page's digits, so its replay name never reads «997» inside
        // Arabic (Q30).
        if (line?.onScreen) uiRef.current.clearCaption();
        else if (line)
          uiRef.current.showCaption(
            localizeDigits(uiRef.current.lang, line.display),
            line.severity,
            speaking,
            () => start([line]),
          );
      },
      onEnd() {
        speakingNow.current = false;
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
    speakingNow.current = false;
    setIndex(null);
    uiRef.current.clearCaption();
  }, []);
  const speaking = useCallback(() => speakingNow.current && uiRef.current.sound.on, []);

  return {
    mark: index === null ? null : (playing.current[index]?.mark ?? null),
    index,
    done,
    speaking,
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
 * silences it (the fine button).
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
 * A no answer timer (S41 30 s, S38b 30 s, S44 30 s): `onExpire` runs once `ms` pass with no touch,
 * scroll, key press or focus change by the person (each restarts it, Q31 (2)). `restart()` restarts it
 * (Listen to the choices). Off while `enabled` is false. With `pauseHidden` it pauses while the page is
 * hidden and resumes with the time left (the S44 timer, R3C-01 (7)).
 */
export function useNoAnswerTimer(
  ms: number,
  onExpire: () => void,
  enabled: boolean,
  opts: { pauseHidden?: boolean } = {},
): { restart(): void } {
  const expire = useLatest(onExpire);
  const enabledRef = useLatest(enabled);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** When the running timer ends (epoch ms), and the time left while the page is hidden. */
  const endsAt = useRef(0);
  const left = useRef<number | null>(null);
  const start = useCallback((after: number) => {
    clearTimeout(timer.current);
    left.current = null;
    if (!enabledRef.current) return;
    endsAt.current = Date.now() + after;
    timer.current = setTimeout(() => expire.current(), after);
  }, []);
  const restart = useCallback(() => start(ms), [ms, start]);

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timer.current);
      return;
    }
    restart();
    // Any input on the page counts (the list is the page, or the overlay layer over the inert stage).
    // A scroll by the person is a wheel, a touch move, a key or a press on the scroll bar; a bare
    // "scroll" event is not listened to, because the page also scrolls by itself when a caption comes
    // or goes, and that must never hold the check in back.
    const events = ["pointerdown", "keydown", "focusin", "wheel", "touchmove"] as const;
    for (const e of events) window.addEventListener(e, restart, { capture: true, passive: true });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (left.current !== null) return;
        clearTimeout(timer.current);
        left.current = Math.max(0, endsAt.current - Date.now());
      } else if (left.current !== null) start(left.current);
    };
    if (opts.pauseHidden) document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer.current);
      for (const e of events) window.removeEventListener(e, restart, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
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

/* ------------------------------------------------------------------ armed presses */

type Down = { x: number; y: number; t: number };

/** The last pointerdown anywhere in the page, recorded before any handler runs. */
let lastDown: Down | null = null;
if (typeof document !== "undefined")
  document.addEventListener(
    "pointerdown",
    (e) => {
      lastDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    true,
  );

/** A pointerdown this recent when a screen opens is the press that opened it (STOP, «أحتاج مساعدة»). */
const OPENER_MS = 1000;

/**
 * Answers arm only for a new, deliberate press. A double tap on STOP or «أحتاج مساعدة» sends its second
 * tap to whatever now sits under the finger, and a tremor or an anxious press is enough for that; a
 * screen that appears under a finger already moving toward a control does the same. So a press counts
 * only when its pointerdown started on the same control after the screen appeared, and not within
 * `minMs` of it appearing, anywhere on the control:
 *   - `always` (the «أنا بخير» of S43 and S45, R3C-03): whatever opened the screen (a press, the 15 s
 *     timeout, a camera trigger);
 *   - otherwise (S41, and S44 when a fine tap opened it): only when a press opened the screen.
 * Keyboard, switch and screen reader activation (a click with no pointer) always counts. An ignored
 * press does nothing visible.
 *
 * Returns a check for a control's click handler: `if (!armed(e)) return;`.
 */
export function useArmedPress(minMs: number, opts: { always?: boolean } = {}) {
  const openedAt = useRef(0);
  const byPress = useRef(false);
  const down = useRef<(Down & { target: EventTarget | null }) | null>(null);
  useLayoutEffect(() => {
    const now = performance.now();
    openedAt.current = now;
    byPress.current = !!lastDown && now - lastDown.t < OPENER_MS;
    const onDown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY, t: performance.now(), target: e.target };
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);
  const always = opts.always === true;
  return useCallback(
    (e: { detail: number; currentTarget: EventTarget | null }): boolean => {
      if (e.detail === 0) return true;
      const d = down.current;
      const own = e.currentTarget;
      if (!d || !(d.target instanceof Node) || !(own instanceof Node) || !own.contains(d.target))
        return false;
      if (!always && !byPress.current) return true;
      return d.t - openedAt.current >= minMs;
    },
    [minMs, always],
  );
}

/* ------------------------------------------------------------------ fitting the fold */

/**
 * Steps a screen answered from the chair through its fit levels (data-fit, safety.css) until every
 * element marked data-fold (the answers, the fine button) ends above the fold: the sticky STOP zone or
 * footer, or the bottom of the viewport. A person 2 m away cannot scroll (principles 6 and 7). Starts
 * again at level 0 when `key` (the text) or the viewport changes, and measures again once the fonts
 * have loaded.
 */
export function useFoldFit(ref: RefObject<HTMLElement>, max: number, key: string): number {
  const [size, setSize] = useState(() => viewportKey());
  // Levels 4 to 6 shrink zones under 120 px: compact mode only (under 700 px tall, 4.2).
  const top = typeof window !== "undefined" && window.innerHeight < COMPACT_HEIGHT ? max : Math.min(max, 3);
  const [fonts, setFonts] = useState(0);
  const k = `${key}|${size}|${fonts}`;
  const [fit, setFit] = useState({ k, level: 0 });
  const level = fit.k === k ? fit.level : 0;
  useEffect(() => {
    const on = () => setSize(viewportKey());
    window.addEventListener("resize", on);
    let live = true;
    void document.fonts?.ready.then(() => live && setFonts((n) => n + 1));
    return () => {
      live = false;
      window.removeEventListener("resize", on);
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (level < top && belowFold(el)) setFit({ k, level: level + 1 });
    else if (fit.k !== k) setFit({ k, level });
  });
  return level;
}

/** Compact mode: a viewport under 700 px tall (the 375 x 667 phones, 4.2). */
const COMPACT_HEIGHT = 700;

const viewportKey = () => (typeof window === "undefined" ? "" : `${window.innerWidth}x${window.innerHeight}`);

/** Whether any data-fold element of `root` ends below the fold, measured as if scrolled to the top. */
export function belowFold(root: HTMLElement): boolean {
  const scroller = (root.closest(".check-overlay") as HTMLElement | null) ?? document.scrollingElement;
  const scrollTop = scroller?.scrollTop ?? 0;
  const layer = root.closest(".check-overlay") ?? document;
  const sticky = [...layer.querySelectorAll<HTMLElement>(".safety-stop-zone, .check-footer")]
    .map((z) => z.getBoundingClientRect().height)
    .reduce((a, b) => a + b, 0);
  const fold = window.innerHeight - sticky;
  return [...root.querySelectorAll<HTMLElement>("[data-fold]")].some(
    (el) => el.getBoundingClientRect().bottom + scrollTop > fold + 1,
  );
}
