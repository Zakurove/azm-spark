/**
 * The e2e coach (product v7 contract 8.7 and 5.4 VITE_E2E, stream D, step D4): with ?e2eCoach=fake in
 * a VITE_E2E build, useCoach runs its segment on FakeLiveTransport with the e2e responder, with no
 * token from Google, no microphone and a silent speaker, so the A to Z run needs no network and no
 * key. window.e2eCoach lets a spec play the coach's events (emit) and read what the app sent (sent).
 *
 * The fake mint returns E2E_COACH_SESSION_ID, the agent_sessions row the e2e seed writes for the
 * person (D-026 item 8, DG-6), and the usage reports go to POST /api/agent/usage like a real
 * segment's, so 8.7 can see the page hide report answer 200.
 */
import type { TransportEvent } from "../../coach/types";
import { FakeLiveTransport, e2eResponder } from "./fake";
import type { CoachDeps, SpeakerLike } from "./session";

/** The agent_sessions id of every e2e coach segment; the e2e seed writes a row with it. */
export const E2E_COACH_SESSION_ID = "00000000-0000-4000-8000-000000000000";

/** Plays nothing; it is busy for as long as the chunks would have lasted (24 kHz, 16 bit, mono). */
export class SilentSpeaker implements SpeakerLike {
  private until = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  get playing(): boolean {
    return this.timer !== null;
  }
  play(pcm24k: ArrayBuffer): void {
    this.until = Math.max(this.until, this.now()) + (pcm24k.byteLength / 48_000) * 1000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.idle(), this.until - this.now());
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

/** What the e2e coach needs from the page. */
export interface E2ePage {
  /** Where e2eCoach is put for the specs (window in the browser). */
  hooks: Record<string, unknown>;
  /** The page's offline, online and hide events. */
  listen: NonNullable<CoachDeps["listen"]>;
  /** POST /api/agent/usage (sendUsageReport in the browser). */
  report: CoachDeps["report"];
  /** The perf overlay's timings (User Timing in the browser). */
  measure?: CoachDeps["measure"];
}

/** The coach segment's parts for ?e2eCoach=fake. */
export function e2eCoachDeps(page: E2ePage): CoachDeps {
  let last: FakeLiveTransport | null = null;
  page.hooks.e2eCoach = {
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
          sessionId: E2E_COACH_SESSION_ID,
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
    report: page.report,
    transport: () => (last = new FakeLiveTransport({ setupMs: 300, respond: e2eResponder })),
    mic: () => null,
    speaker: () => new SilentSpeaker(),
    deviceId: () => "e2e_device_000000000000",
    listen: page.listen,
    ...(page.measure ? { measure: page.measure } : {}),
  };
}
