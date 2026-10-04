/**
 * The live coach's transport (product v7 contract 2.11 LiveTransport, stream D, step D3): one Gemini
 * Live session over @google/genai, opened with the one use ephemeral token that POST /api/agent/token
 * mints (5.1). The token locks the model, the system instruction, the tools, the voice and the voice
 * activity settings, so the client sends no setup of its own (an empty config; a client setup cannot
 * replace the locked one, live-spike.md 2).
 *
 * The S0 findings (D-022, live-spike.md 1, 2 and 6):
 *   - the server's opening history is sent before anything else (initialHistoryInClientContent: the
 *     first client content is taken as history and gets no reply), and only then is setupComplete
 *     reported, so nothing the app sends can come first;
 *   - S0-5: Google sends a resumable handle about 100 ms after setupComplete although no resumption is
 *     configured; the message is ignored and the handle is never read or kept;
 *   - S0-6: an output transcription is passed on only when its message carries audio (the junk caption
 *     arrives alone, about 2 s after the speech); the rest of the caption filter is captions.ts;
 *   - the empty messages Google sends between content messages are ignored.
 *
 * C-12: the only things that leave the phone are the 16 kHz microphone audio, the end of the audio
 * stream, the bridge's text lines and the tool results. No method sends a picture, a video or
 * landmarks. The SDK is imported lazily, so it lives in the coach's own chunk (8.8).
 */
import type { LiveServerMessage } from "@google/genai";
import type { LiveConnectOptions, LiveTransport, ToolResult, TransportEvent } from "../../coach/types";

/** What the microphone frames are declared as (live.md 6: 16 kHz mono 16 bit little endian). */
export const MIC_MIME = "audio/pcm;rate=16000";
/** A socket that has not completed its setup by then is given up (the session falls back at 3 s). */
export const CONNECT_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------- base64 */

/** Base64 of raw bytes (the API carries audio as base64 text). */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(s);
}

/** The bytes of base64 text. */
export function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** A protobuf JSON duration ("10s", "0.500s") in milliseconds; 0 when it cannot be read. */
export function parseDurationMs(v: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v ?? "");
  return m ? Math.round(Number(m[1]) * 1000) : 0;
}

/* ---------------------------------------------------- server messages */

/** A server message as the SDK delivers it (only the fields this transport reads). */
export type ServerMessage = Pick<
  LiveServerMessage,
  | "setupComplete"
  | "serverContent"
  | "toolCall"
  | "toolCallCancellation"
  | "goAway"
  | "usageMetadata"
  | "sessionResumptionUpdate"
>;

/**
 * The transport events of one server message, in a fixed order: audio, the person's transcription,
 * the coach's transcription (only with audio in the same message, S0-6), interrupted, turnComplete,
 * then tool calls, cancellations, goAway and usage. setupComplete is reported by connect (after the
 * history); sessionResumptionUpdate is ignored (S0-5).
 */
export function mapServerMessage(msg: ServerMessage): TransportEvent[] {
  const out: TransportEvent[] = [];
  const sc = msg.serverContent;
  if (sc) {
    let audio = false;
    for (const part of sc.modelTurn?.parts ?? []) {
      const d = part.inlineData;
      if (d?.data && (d.mimeType ?? "").startsWith("audio/pcm")) {
        out.push({ type: "audio", pcm24k: fromBase64(d.data) });
        audio = true;
      }
    }
    const heard = sc.inputTranscription?.text;
    if (heard)
      out.push({ type: "inputTranscript", text: heard, final: sc.inputTranscription?.finished === true });
    const said = sc.outputTranscription?.text;
    if (said && audio) out.push({ type: "outputTranscript", text: said });
    if (sc.interrupted) out.push({ type: "interrupted" });
    if (sc.turnComplete) out.push({ type: "turnComplete" });
  }
  const calls = (msg.toolCall?.functionCalls ?? [])
    .filter((c) => typeof c.name === "string" && c.name.length > 0)
    .map((c) => ({ id: c.id ?? "", name: c.name as string, args: (c.args ?? {}) as unknown }));
  if (calls.length) out.push({ type: "toolCall", calls });
  const ids = msg.toolCallCancellation?.ids ?? [];
  if (ids.length) out.push({ type: "toolCallCancellation", ids: [...ids] });
  if (msg.goAway) out.push({ type: "goAway", timeLeftMs: parseDurationMs(msg.goAway.timeLeft) });
  const u = msg.usageMetadata;
  if (u)
    out.push({
      type: "usage",
      promptTokens: u.promptTokenCount ?? 0,
      responseTokens: u.responseTokenCount ?? 0,
    });
  return out;
}

/* ------------------------------------------------------------ the SDK */

/** The session methods this transport calls (a subset of the SDK's Session). */
export interface GenaiSession {
  sendClientContent(p: {
    turns: { role: "user" | "model"; parts: { text: string }[] }[];
    turnComplete: boolean;
  }): void;
  sendRealtimeInput(p: { audio: { data: string; mimeType: string } } | { audioStreamEnd: true }): void;
  sendToolResponse(p: {
    functionResponses: {
      id: string;
      name: string;
      response: Record<string, unknown>;
      scheduling?: "SILENT" | "WHEN_IDLE" | "INTERRUPT";
    }[];
  }): void;
  close(): void;
}
/** The part of the @google/genai module this transport uses. */
export interface GenaiSdk {
  GoogleGenAI: new (o: { apiKey: string; httpOptions: { apiVersion: string } }) => {
    live: {
      connect(p: {
        model: string;
        config: Record<string, never>;
        callbacks: {
          onmessage: (m: ServerMessage) => void;
          onerror?: ((e: unknown) => void) | null;
          onclose?: ((e: { code: number; reason: string }) => void) | null;
        };
      }): Promise<GenaiSession>;
    };
  };
}

/** A connect that did not reach setupComplete (the session falls back to the local voice). */
export class TransportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TransportError";
  }
}

const loadGenai = async (): Promise<GenaiSdk> => (await import("@google/genai")) as unknown as GenaiSdk;

/**
 * GenaiTransport: one connection per instance (a new segment session is a new transport). Events are
 * delivered only between setupComplete and close; after close() nothing is sent or emitted.
 */
export class GenaiTransport implements LiveTransport {
  private session: GenaiSession | null = null;
  private listeners = new Set<(e: TransportEvent) => void>();
  private open = false;
  private ended = false;
  private giveUp: ((e: TransportError) => void) | null = null;

  constructor(
    private readonly load: () => Promise<GenaiSdk> = loadGenai,
    private readonly clock: () => number = () => performance.now(),
    private readonly timeoutMs = CONNECT_TIMEOUT_MS,
  ) {}

  async connect(opts: LiveConnectOptions): Promise<void> {
    if (this.session || this.ended) throw new TransportError("connect_once");
    const t0 = this.clock();
    let sdk: GenaiSdk;
    try {
      sdk = await this.load();
    } catch {
      throw new TransportError("sdk_load");
    }
    if (this.ended) throw new TransportError("closed");
    const ai = new sdk.GoogleGenAI({ apiKey: opts.token, httpOptions: { apiVersion: opts.apiVersion } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = new Promise<never>((_, reject) => {
      this.giveUp = reject;
      timer = setTimeout(() => reject(new TransportError("connect_timeout")), this.timeoutMs);
    });
    const opening = ai.live.connect({
      model: opts.model,
      config: {},
      callbacks: {
        onmessage: (m) => {
          if (!this.open || this.ended) return;
          for (const e of mapServerMessage(m)) this.emit(e);
        },
        onerror: () => {
          if (!this.open) this.giveUp?.(new TransportError("socket_error"));
          else if (!this.ended) this.emit({ type: "error", code: "socket_error" });
        },
        onclose: (e) => {
          if (!this.open) this.giveUp?.(new TransportError(`closed_${e?.code ?? 0}`));
          else if (!this.ended) {
            this.ended = true;
            this.emit({ type: "close", code: e?.code ?? 0, reason: e?.reason ?? "" });
          }
        },
      },
    });
    let session: GenaiSession;
    try {
      session = await Promise.race([opening, failed]);
    } catch (error) {
      // A session that completes after the app gave up is closed at once.
      void opening.then((s) => s.close()).catch(() => undefined);
      throw error instanceof TransportError ? error : new TransportError("connect_failed");
    } finally {
      clearTimeout(timer);
      this.giveUp = null;
    }
    if (this.ended) {
      session.close();
      throw new TransportError("closed");
    }
    this.session = session;
    // The history first (initialHistoryInClientContent): it is taken as history and gets no reply.
    this.safe(() =>
      session.sendClientContent({
        turns: opts.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        turnComplete: true,
      }),
    );
    this.open = true;
    this.emit({ type: "setupComplete", ms: Math.round(this.clock() - t0) });
  }

  sendAudio(pcm16k: ArrayBuffer): void {
    const s = this.live();
    if (s) this.safe(() => s.sendRealtimeInput({ audio: { data: toBase64(pcm16k), mimeType: MIC_MIME } }));
  }

  audioStreamEnd(): void {
    const s = this.live();
    if (s) this.safe(() => s.sendRealtimeInput({ audioStreamEnd: true }));
  }

  sendContext(text: string, turnComplete: boolean): void {
    const s = this.live();
    if (s)
      this.safe(() => s.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete }));
  }

  sendToolResponse(
    r: {
      id: string;
      name: string;
      response: ToolResult;
      scheduling?: "SILENT" | "WHEN_IDLE" | "INTERRUPT";
    }[],
  ): void {
    const s = this.live();
    if (!s || r.length === 0) return;
    this.safe(() =>
      s.sendToolResponse({
        functionResponses: r.map((x) => ({
          id: x.id,
          name: x.name,
          response: { ...x.response },
          ...(x.scheduling ? { scheduling: x.scheduling } : {}),
        })),
      }),
    );
  }

  close(): void {
    if (this.ended && !this.session) {
      this.giveUp?.(new TransportError("closed"));
      return;
    }
    const s = this.session;
    this.ended = true;
    this.open = false;
    this.session = null;
    this.giveUp?.(new TransportError("closed"));
    if (s) this.safe(() => s.close());
  }

  on(fn: (e: TransportEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private live(): GenaiSession | null {
    return this.open && !this.ended ? this.session : null;
  }

  private emit(e: TransportEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  /** A send on a socket that is closing must never break the test the person is doing. */
  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* the close event follows */
    }
  }
}
