/**
 * FakeLiveTransport (product v7 contract 8.6, stream D, step D3): a LiveTransport that plays a
 * scripted timeline (setupComplete after n ms, audio chunks, transcripts, toolCall,
 * toolCallCancellation, interrupted, goAway, error, close) and records what the app sends. The agent
 * tests drive the coach with it on fake timers, and a VITE_E2E build uses it for ?e2eCoach=fake, so
 * the A to Z run needs no network and no key. Like the real transport it reports setupComplete only
 * after the history, and nothing after close.
 */
import type { LiveConnectOptions, LiveTransport, ToolResult, TransportEvent } from "../../coach/types";
import { TransportError } from "./transport";

/** One thing the app sent, in order. */
export type FakeSent =
  | { kind: "history"; turns: LiveConnectOptions["history"] }
  | { kind: "audio"; bytes: number }
  | { kind: "audioStreamEnd" }
  | { kind: "context"; text: string; turnComplete: boolean }
  | {
      kind: "toolResponse";
      responses: {
        id: string;
        name: string;
        response: ToolResult;
        scheduling?: "SILENT" | "WHEN_IDLE" | "INTERRUPT";
      }[];
    }
  | { kind: "close" };

export interface FakeScript {
  /** setupComplete this long after connect (default 300 ms); null: it never arrives. */
  setupMs?: number | null;
  /** connect fails at once with this code, as a socket that cannot open. */
  failConnect?: string;
  /** Events played this long after connect. */
  timeline?: { at: number; event: TransportEvent }[];
  /** Called after each thing the app sends, to answer it (fake.after schedules a reply). */
  respond?: (sent: FakeSent, fake: FakeLiveTransport) => void;
}

export class FakeLiveTransport implements LiveTransport {
  /** Everything the app sent, the history first. */
  readonly sent: FakeSent[] = [];
  /** The options of the connect call, or null before it. */
  options: LiveConnectOptions | null = null;
  private listeners = new Set<(e: TransportEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private open = false;
  private ended = false;

  constructor(private readonly script: FakeScript = {}) {}

  /** True between setupComplete and close. */
  get connected(): boolean {
    return this.open && !this.ended;
  }

  connect(opts: LiveConnectOptions): Promise<void> {
    this.options = opts;
    if (this.script.failConnect) return Promise.reject(new TransportError(this.script.failConnect));
    for (const step of this.script.timeline ?? []) this.after(step.at, step.event);
    const setupMs = this.script.setupMs === undefined ? 300 : this.script.setupMs;
    if (setupMs === null) return new Promise<void>(() => undefined);
    return new Promise<void>((resolve, reject) => {
      this.schedule(setupMs, () => {
        if (this.ended) return reject(new TransportError("closed"));
        this.record({ kind: "history", turns: opts.history });
        this.open = true;
        this.emit({ type: "setupComplete", ms: setupMs });
        resolve();
      });
    });
  }

  sendAudio(pcm16k: ArrayBuffer): void {
    if (this.connected) this.record({ kind: "audio", bytes: pcm16k.byteLength });
  }

  audioStreamEnd(): void {
    if (this.connected) this.record({ kind: "audioStreamEnd" });
  }

  sendContext(text: string, turnComplete: boolean): void {
    if (this.connected) this.record({ kind: "context", text, turnComplete });
  }

  sendToolResponse(responses: Extract<FakeSent, { kind: "toolResponse" }>["responses"]): void {
    if (this.connected && responses.length) this.record({ kind: "toolResponse", responses });
  }

  close(): void {
    if (this.ended) return;
    this.sent.push({ kind: "close" });
    this.ended = true;
    this.open = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  on(fn: (e: TransportEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Delivers a server event now (a test or the e2e page plays the coach). Nothing after close. */
  emit(e: TransportEvent): void {
    if (this.ended && e.type !== "close") return;
    if (e.type === "close") {
      if (this.ended) return;
      this.ended = true;
      this.open = false;
    }
    for (const fn of [...this.listeners]) fn(e);
  }

  /** Delivers a server event this long from now. */
  after(ms: number, e: TransportEvent): void {
    this.schedule(ms, () => this.emit(e));
  }

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private record(s: FakeSent): void {
    this.sent.push(s);
    this.script.respond?.(s, this);
  }
}

/** 0.4 s of 24 kHz silence, as one coach audio chunk. */
const SPOKEN = () => new ArrayBuffer(24_000 * 2 * 0.4);

/**
 * The e2e coach (?e2eCoach=fake): every line sent with turnComplete true (a P0 or a P1) is answered
 * like a quick coach, with audio 400 ms later, its caption, then the end of the turn. It never calls a
 * tool by itself; an e2e spec plays the person's answers through window.e2eCoach (useCoach).
 */
export function e2eResponder(sent: FakeSent, fake: FakeLiveTransport): void {
  if (sent.kind !== "context" || !sent.turnComplete) return;
  fake.after(400, { type: "audio", pcm24k: SPOKEN() });
  fake.after(450, { type: "outputTranscript", text: "…" });
  fake.after(900, { type: "turnComplete" });
}
