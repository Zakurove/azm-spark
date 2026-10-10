/**
 * React side of the safety screens: the spoken sequence with its captions, the chime, the wake lock,
 * the double tap guard and fitting the answers above the fold (UX spec S36 to S49, 4.3, 4.6, 5.10
 * useCues, useWakeLock). Every timer runs on the phone and never waits for the network.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { localizeDigits } from "../../../i18n";
import { useCheckUi } from "../shared/CheckUi";
import { SequencePlayer } from "./speechPlayer";
import type { SpeechLine } from "./speech";
import { SAFETY_TIMING } from "./timing";
import { chimeUri } from "./tones";

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
        // The caption's digits go through localizeDigits, so they are Western in Arabic too (D-036
        // item 3), whatever digits the line was written in.
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

/* ------------------------------------------------------------------ chime */

let chimeEl: HTMLAudioElement | null = null;

/** The soft two note chime (S43 after 30 s with no answer, S47 on arrival). It follows the Sound setting. */
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

/** A pointerdown this recent when a screen opens is the press that opened it (STOP, a tap on S43). */
const OPENER_MS = 1000;

/**
 * The guard against a double tap. A double tap on STOP sends its second tap to whatever now sits under
 * the finger, and a tremor or an anxious press is enough for that. So a press counts only when its
 * pointerdown started on the same control after the screen appeared, and, when a press opened the
 * screen, not within `minMs` of it appearing. Keyboard, switch and screen reader activation (a click
 * with no pointer) always counts. An ignored press does nothing visible.
 *
 * Returns a check for a control's click handler: `if (!armed(e)) return;`.
 */
export function useArmedPress(minMs: number) {
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
  return useCallback(
    (e: { detail: number; currentTarget: EventTarget | null }): boolean => {
      if (e.detail === 0) return true;
      const d = down.current;
      const own = e.currentTarget;
      if (!d || !(d.target instanceof Node) || !(own instanceof Node) || !own.contains(d.target))
        return false;
      if (!byPress.current) return true;
      return d.t - openedAt.current >= minMs;
    },
    [minMs],
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
