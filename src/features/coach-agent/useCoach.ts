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
 *   - push every BridgeEvent; say the corrections (P2) and the safety lines (P0) through the LocalVoice
 *     given in the options, as without a coach; while mode is not off, never ask a P1 question aloud:
 *     the coach asks it, or the local voice when the coach is late or the mode is local;
 *   - after a P0 call reopen() when the person goes on (the coach can never reopen);
 *   - call end("done") when the segment is over ("user_end" when the person leaves it); unmounting ends
 *     it as the person's;
 *   - call unlockCoachAudio() (audio/context.ts) inside the tap that starts a coached block.
 * The returned state is CoachState (2.11) plus reopen, which 2.11's rule 1 needs and CoachState lacks.
 *
 * VITE_E2E builds only: ?e2eCoach=fake runs the segment on FakeLiveTransport with the e2e responder,
 * no token, no microphone and a silent speaker; window.e2eCoach plays the coach's events in a spec.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BridgeEvent, CoachOptions, CoachState, TransportEvent } from "../../coach/types";
import { coachDeviceId, mintCoachToken, sendUsageReport } from "./api";
import { coachAudioSupported } from "./audio/context";
import { MicCapture } from "./audio/mic";
import { Speaker } from "./audio/speaker";
import { FakeLiveTransport, e2eResponder } from "./fake";
import { CoachSession, type CoachDeps, type CoachSnapshot, type SpeakerLike } from "./session";
import { GenaiTransport } from "./transport";

/** CoachState and reopen (rule 1: after a P0 only the app opens the bridge again). */
export type CoachControl = CoachState & { reopen(): void };

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
  const ref = "checkId" in o.ref ? `c:${o.ref.checkId}` : `w:${o.ref.workoutId}`;
  return `${o.block}|${o.segment}|${o.lang}|${ref}`;
}

/**
 * null options: coach off (preference off, no consent, flag off, or offline). Prewarms (token and
 * connect) when the segment's setup card shows (bridge rule 8).
 */
export function useCoach(opts: CoachOptions | null): CoachControl {
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

/** Rule 3: play-and-record while the coach is live (where supported), playback after. Never throws. */
export function setCoachAudioSession(live: boolean): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = live ? "play-and-record" : "playback";
  } catch {
    /* not supported */
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

function coachDeps(): CoachDeps {
  if (
    import.meta.env.VITE_E2E === "1" &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("e2eCoach") === "fake"
  )
    return e2eDeps();
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
  };
}

/* ----------------------------------------------- the e2e fake coach */

/** Plays nothing; speaking for as long as the chunks would have lasted. */
class SilentSpeaker implements SpeakerLike {
  private until = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  get playing(): boolean {
    return this.timer !== null;
  }
  play(pcm24k: ArrayBuffer): void {
    this.until = Math.max(this.until, performance.now()) + (pcm24k.byteLength / 48_000) * 1000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.idle(), this.until - performance.now());
  }
  flush(): void {
    if (this.timer) this.idle();
  }
  duck(): void {}
  onIdle(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
  private idle(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.until = 0;
    for (const fn of [...this.listeners]) fn();
  }
}

function e2eDeps(): CoachDeps {
  let last: FakeLiveTransport | null = null;
  (window as unknown as { e2eCoach?: unknown }).e2eCoach = {
    emit: (e: TransportEvent) => last?.emit(e),
    sent: () => last?.sent ?? [],
  };
  return {
    now: () => performance.now(),
    wallNow: () => Date.now(),
    online: () => true,
    async mint(req) {
      const now = Date.now();
      return {
        ok: true,
        serverDate: now,
        token: {
          sessionId: "00000000-0000-4000-8000-000000000000",
          token: "auth_tokens/e2e",
          model: "fake",
          apiVersion: "v1beta",
          voice: "Achird",
          expiresAt: new Date(now + 12 * 60_000).toISOString(),
          newSessionExpiresAt: new Date(now + 120_000).toISOString(),
          history: [
            { role: "user", text: `[CTX block=${req.block} segment=${req.segment} lang=${req.lang}]` },
            { role: "model", text: req.lang === "ar" ? "جاهز." : "Ready." },
          ],
          minutesLeft: 45,
        },
      };
    },
    // The fake segment has no session on the server, so it reports nothing.
    report: noop,
    transport: () => (last = new FakeLiveTransport({ setupMs: 300, respond: e2eResponder })),
    mic: () => null,
    speaker: () => new SilentSpeaker(),
    deviceId: () => "e2e_device_000000000000",
    listen: windowEvents,
  };
}
