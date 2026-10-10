/**
 * The live coach hook (product v7 contract 2.11 useCoach, stream D, step D4): one Live session per
 * coach segment (C-6), prewarmed when the segment's setup card shows, with the event bridge, the tool
 * executor and the local voice fallback (session.ts). The coach is an enhancement, never a dependency
 * (C-5): with null options it is off and every host runs on its buttons and its local voice.
 *
 * How a host uses it (B3's RomController, C4's GaitController, D5's workout):
 *   - pass null while the coach is off (the preference, no live_coach consent, the v7 flag, offline);
 *     with options the segment mints and connects at once (the prewarm), on the next task, so React's
 *     development double mount never mints twice;
 *   - keep the same host and LocalVoice objects for the whole segment (useMemo or useRef): a new host
 *     or local voice, like a new block, segment, language or check, ends the session and starts
 *     another, which costs a re-mint;
 *   - push every BridgeEvent; every host gives SILENT_VOICE (D-036 item 1, D-038 item 3: only the
 *     coach speaks); while mode is not off, never ask a P1 question aloud: the coach asks it;
 *   - register the screen's buttons the coach may press in host.actions (useScreenActions, D-036
 *     item 2);
 *   - after a P0 call reopen() when the person goes on (the coach can never reopen);
 *   - call end("done") when the segment is over ("user_end" when the person leaves it); unmounting ends
 *     it as the person's;
 *   - call unlockCoachAudio() (audio/context.ts) inside the tap that starts a coached block.
 * The returned state is CoachState (2.11), reopen included (D-026 item 8, DG-4).
 *
 * VITE_E2E builds only: ?e2eCoach=fake runs the segment on FakeLiveTransport with the e2e responder,
 * no token, no microphone and a silent speaker; window.e2eCoach plays the coach's events in a spec, and
 * the usage reports go to the route for the row the e2e seed writes (e2eCoach.ts).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BridgeEvent, CoachOptions, CoachState } from "../../coach/types";
import { coachDeviceId, mintCoachToken, readCoachStatus, sendUsageReport, type CoachStatus } from "./api";
import { coachAudioSupported } from "./audio/context";
import { MicCapture } from "./audio/mic";
import { Speaker } from "./audio/speaker";
import { e2eCoachDeps } from "./e2eCoach";
import { CoachSession, type CoachDeps, type CoachSnapshot } from "./session";
import { GenaiTransport, preloadGenai } from "./transport";

const OFF: CoachSnapshot = Object.freeze({ mode: "off", speaking: false, captions: [] }) as CoachSnapshot;
const CONNECTING: CoachSnapshot = Object.freeze({
  mode: "connecting",
  speaking: false,
  captions: [],
}) as CoachSnapshot;
const offSnapshot = () => OFF;
const connectingSnapshot = () => CONNECTING;
const noSubscribe = () => () => undefined;
const noop = () => undefined;
const noPush: (e: BridgeEvent) => void = noop;
const noEnd: (reason: string) => void = noop;

/** The key of a segment: a new session for a new block, segment, language or check. */
function segmentKey(o: CoachOptions): string {
  const ref =
    "checkId" in o.ref
      ? `c:${o.ref.checkId}`
      : "demo" in o.ref
        ? `d:${o.ref.demo}:${o.ref.run}`
        : `w:${o.ref.workoutId}`;
  return `${o.block}|${o.segment}|${o.lang}|${ref}`;
}

/**
 * null options: coach off (preference off, no consent, flag off, or offline). Prewarms (token and
 * connect) when the segment's setup card shows (bridge rule 8).
 */
export function useCoach(opts: CoachOptions | null): CoachState {
  const [session, setSession] = useState<CoachSession | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const key = opts ? segmentKey(opts) : null;
  const host = opts?.host ?? null;
  const local = opts?.local ?? null;

  useEffect(() => {
    const o = latest.current;
    if (!o || !key) return;
    const s = new CoachSession(o, coachDeps());
    setSession(s);
    const timer = setTimeout(() => s.start(), 0);
    return () => {
      clearTimeout(timer);
      s.dispose();
      setSession((current) => (current === s ? null : current));
    };
  }, [key, host, local]);

  const subscribe = session?.subscribe ?? noSubscribe;
  const getSnapshot = session?.getSnapshot ?? (opts ? connectingSnapshot : offSnapshot);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({
      ...snap,
      push: session?.push ?? noPush,
      end: session?.end ?? noEnd,
      reopen: session?.reopen ?? noop,
    }),
    [snap, session],
  );
}

/* --------------------------------------------------- the browser */

/**
 * Rule 3: play-and-record while the coach's microphone is open (set before it is asked: iOS cannot
 * start a capture in a playback session, D-035 item 3), playback after. Never throws.
 */
export function setCoachAudioSession(live: boolean): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = live ? "play-and-record" : "playback";
  } catch {
    /* not supported */
  }
}

/**
 * A section 9 timing as a User Timing measure (performance.measure, on the performance.now clock the
 * session uses), which the perf overlay of VITE_E2E builds reads by its azm: name (DG-1). Never throws.
 */
export function userTiming(name: string, start: number, duration: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < 0) return;
  try {
    performance.measure(name, { start, duration });
  } catch {
    /* a browser without measure options */
  }
}

/** The page's offline, online and hide events. */
function windowEvents(h: { offline(): void; online(): void; hidden(): void }): () => void {
  if (typeof window === "undefined") return noop;
  const offline = () => h.offline();
  const online = () => h.online();
  const visibility = () => {
    if (document.visibilityState === "hidden") h.hidden();
  };
  const hide = () => h.hidden();
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", hide);
  return () => {
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", hide);
  };
}

/** A microphone that cannot start: the segment falls back to the local voice at once. */
const NO_MIC = {
  start: () => Promise.reject(new Error("no audio")),
  stop: noop,
  gate: noop,
};

/**
 * GET /api/agent/status while `wanted` (the switch on and the consent given; D-030 D5-12): whether the
 * server can run the coach now. null until it answers, or when it cannot be read. A new `key` reads it
 * again (D-034 item 3: the focus check reads it once its start recorded the live_coach consent).
 */
export function useCoachStatus(wanted: boolean, key: string | null = null): CoachStatus | null {
  const [status, setStatus] = useState<CoachStatus | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void readCoachStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [wanted, key]);
  return wanted ? status : null;
}

/** VITE_E2E builds only: ?e2eCoach=fake runs every segment on the fake transport (no key, no Google). */
export function fakeCoachRun(): boolean {
  return (
    import.meta.env.VITE_E2E === "1" &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("e2eCoach") === "fake"
  );
}

function coachDeps(): CoachDeps {
  if (fakeCoachRun())
    return {
      ...e2eCoachDeps({
        hooks: window as unknown as Record<string, unknown>,
        listen: windowEvents,
        report: (r) => sendUsageReport(r),
        measure: userTiming,
      }),
    };
  return {
    now: () => performance.now(),
    wallNow: () => Date.now(),
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    mint: (req) => mintCoachToken(req),
    report: (r) => sendUsageReport(r),
    transport: () => new GenaiTransport(),
    mic: () => (coachAudioSupported() ? new MicCapture() : NO_MIC),
    speaker: () => new Speaker(),
    deviceId: () => coachDeviceId(),
    listen: windowEvents,
    audioSession: setCoachAudioSession,
    prepare: preloadGenai,
    measure: userTiming,
    log: coachLog,
  };
}

/** D-034 item 3: the coach's refusals and fallbacks in the console, never silent (no token, no key). */
export function coachLog(message: string, data?: Record<string, unknown>): void {
  try {
    console.warn(`[azm coach] ${message}`, data ?? {});
  } catch {
    /* no console */
  }
}
