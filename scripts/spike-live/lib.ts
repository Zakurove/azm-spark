/**
 * Helpers of the live spike suite (`npm run spike:live`, product v7 contract 8.6; DG-2, D-026 item 1
 * and D-027 item 7). The suite keeps the S0 measurements repeatable on the production setup: these are
 * its pure parts (tested in tests/v7/d-spike-live.test.ts) and the recorder of a transport's events.
 *
 * The API key is read from the environment only and never printed: every string the suite writes
 * passes through scrub(). Synthetic voices (macOS `say`) speak the person's answers; they are not
 * people, and the human test set of live.md 3 stays a device check.
 */
import type { TransportEvent } from "../../src/coach/types";

/* ------------------------------------------------------------ secrets */

/** A string without the key or a token name (auth_tokens/...), for every line the suite writes. */
export function scrub(text: unknown, key: string): string {
  let s = String(text);
  if (key) s = s.split(key).join("[key]");
  return s.replace(/auth_tokens\/[A-Za-z0-9_\-.]+/g, "auth_tokens/[token]");
}

/* ------------------------------------------------------------- numbers */

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

/** The nearest rank percentile of the values. */
export function percentile(xs: readonly number[], p: number): number | null {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Whole millisecond statistics of the measured values (null values are trials that measured nothing). */
export function stats(values: readonly (number | null | undefined)[]): Stats | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  return {
    n: v.length,
    min: Math.round(Math.min(...v)),
    p50: Math.round(percentile(v, 50)!),
    p90: Math.round(percentile(v, 90)!),
    max: Math.round(Math.max(...v)),
    mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
  };
}

/* --------------------------------------------------------------- cost */

/**
 * Dollars per million tokens of gemini-3.8-live on the paid tier (live.md 12, as S0 used them). The
 * transport reports totals without the modality split, so the guard counts every prompt token at the
 * audio input rate and every response token at the audio output rate: an upper bound.
 */
export const RATES = { audioIn: 3.0, audioOut: 12.0 } as const;

/** The upper bound cost of one usage report. */
export function usageUsd(u: { promptTokens: number; responseTokens: number }): number {
  return (u.promptTokens * RATES.audioIn + u.responseTokens * RATES.audioOut) / 1e6;
}

/* --------------------------------------------------------------- audio */

/** The 16 bit mono PCM of a WAV file: the bytes of its data chunk (macOS `say` writes LEI16@16000). */
export function wavPcm(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (at: number) => String.fromCharCode(...file.subarray(at, at + 4));
  if (file.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  while (at + 8 <= file.byteLength) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt ") {
      const channels = view.getUint16(at + 10, true);
      const rate = view.getUint32(at + 12, true);
      const bits = view.getUint16(at + 22, true);
      if (channels !== 1 || rate !== 16000 || bits !== 16)
        throw new Error(`WAV is ${channels} channel, ${rate} Hz, ${bits} bit; 1, 16000 and 16 needed`);
    }
    if (tag(at) === "data") return file.subarray(at + 8, Math.min(file.byteLength, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV without a data chunk");
}

/** Where speech starts and ends in 16 kHz PCM: 10 ms windows whose peak passes the threshold. */
export function speechBounds(pcm: Uint8Array, threshold = 500): { startMs: number; endMs: number; totalMs: number } {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const n = Math.floor(pcm.byteLength / 2);
  const win = 160;
  let first = -1;
  let last = -1;
  for (let i = 0; i + win <= n; i += win) {
    let peak = 0;
    for (let j = i; j < i + win; j++) peak = Math.max(peak, Math.abs(view.getInt16(j * 2, true)));
    if (peak > threshold) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  const ms = (samples: number) => (samples / 16000) * 1000;
  return { startMs: first < 0 ? 0 : ms(first), endMs: last < 0 ? 0 : ms(last), totalMs: ms(n) };
}

/** 20 ms frames of 16 kHz PCM (640 bytes), the last one padded with silence (live.md 6: 20 to 40 ms). */
export function frames(pcm: Uint8Array, frameMs = 20): ArrayBuffer[] {
  const bytes = Math.round((16000 * frameMs) / 1000) * 2;
  const out: ArrayBuffer[] = [];
  for (let off = 0; off < pcm.byteLength; off += bytes) {
    const f = new Uint8Array(bytes);
    f.set(pcm.subarray(off, Math.min(off + bytes, pcm.byteLength)));
    out.push(f.buffer);
  }
  return out;
}

/* -------------------------------------------------------------- judging */

/** What a spoken answer should give: a tool with these arguments, or no tool at all (a dose prompt). */
export type Expect = { tool: null } | ({ tool: string } & Record<string, unknown>);

/** A call matches when its name is the expected tool and every expected argument is equal. */
export function judge(expect: Expect, calls: readonly { name: string; args: unknown }[]): boolean {
  if (expect.tool === null) return calls.length === 0;
  const call = calls.find((c) => c.name === expect.tool);
  if (!call) return false;
  const args = (call.args ?? {}) as Record<string, unknown>;
  return Object.entries(expect)
    .filter(([k]) => k !== "tool")
    .every(([k, v]) => args[k] === v);
}

/** The share of Arabic letters among the letters of a reply (the reply language check). */
export function arabicShare(text: string): number | null {
  const letters = (text.match(/[؀-ۿA-Za-z]/g) ?? []).length;
  return letters ? (text.match(/[؀-ۿ]/g) ?? []).length / letters : null;
}

/* ------------------------------------------------------------ recorder */

/** A transport event with its time since the recorder started, in milliseconds. */
export type Timed = TransportEvent & { at: number };

/** Records a transport's events with their times, and waits for the next one that matches. */
export class Recorder {
  readonly events: Timed[] = [];
  private readonly t0: number;
  private readonly waiters = new Set<(e: Timed) => void>();

  constructor(now: () => number = () => performance.now()) {
    this.now = () => now() - this.t0;
    this.t0 = now();
  }

  readonly now: () => number;

  push(e: TransportEvent): void {
    const timed = { ...e, at: Math.round(this.now()) } as Timed;
    this.events.push(timed);
    for (const w of [...this.waiters]) w(timed);
  }

  /** The first event from `from` on that matches, or null after the timeout. */
  waitFor(match: (e: Timed) => boolean, from: number, timeoutMs: number): Promise<Timed | null> {
    const had = this.events.find((e) => e.at >= from && match(e));
    if (had) return Promise.resolve(had);
    return new Promise((resolve) => {
      const done = (e: Timed | null) => {
        this.waiters.delete(waiter);
        clearTimeout(timer);
        resolve(e);
      };
      const waiter = (e: Timed) => {
        if (e.at >= from && match(e)) done(e);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /** The tool calls from `from` on. */
  toolCalls(from: number): { id: string; name: string; args: unknown; at: number }[] {
    return this.events.flatMap((e) =>
      e.type === "toolCall" && e.at >= from ? e.calls.map((c) => ({ ...c, at: e.at })) : [],
    );
  }

  /** The coach's caption text between two times. */
  said(from: number, to = Number.POSITIVE_INFINITY): string {
    return this.events
      .filter((e): e is Timed & { type: "outputTranscript" } => e.type === "outputTranscript")
      .filter((e) => e.at >= from && e.at <= to)
      .map((e) => e.text)
      .join("");
  }

  /** What the transcription heard the person say between two times. */
  heard(from: number, to = Number.POSITIVE_INFINITY): string {
    return this.events
      .filter((e): e is Timed & { type: "inputTranscript" } => e.type === "inputTranscript")
      .filter((e) => e.at >= from && e.at <= to)
      .map((e) => e.text)
      .join("");
  }

  /** Bytes of coach audio between two times. */
  audioBytes(from: number, to = Number.POSITIVE_INFINITY): number {
    return this.events
      .filter((e): e is Timed & { type: "audio" } => e.type === "audio")
      .filter((e) => e.at >= from && e.at <= to)
      .reduce((s, e) => s + e.pcm24k.byteLength, 0);
  }

  /** The usage reports, in order. */
  usage(): { at: number; promptTokens: number; responseTokens: number }[] {
    return this.events.flatMap((e) =>
      e.type === "usage" ? [{ at: e.at, promptTokens: e.promptTokens, responseTokens: e.responseTokens }] : [],
    );
  }
}
