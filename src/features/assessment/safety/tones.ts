/**
 * The soft chime of S43 and S47 (UX spec S43, S47, Appendix B), made on the phone as WAV sound: no file
 * to fetch, so it plays offline and never waits for the network (UX 0.7, O18). Pure: bytes and a data
 * URI, no DOM. A soft two note chime under 1 s, with a gentle decay (every tone starts and ends at
 * zero with a short ramp, so there is no click).
 *
 * It plays through an HTML media element (never Web Audio, which iOS mutes with the silent switch).
 * Appendix B still asks for a produced /cues/chime.mp3 (loudness normalised); this tone stands in
 * until that file exists.
 */

export const TONE_RATE = 22050;

export interface ToneSegment {
  /** Frequency in Hz; 0 is silence. */
  freq: number;
  ms: number;
  /** Peak level, 0 to 1. */
  gain: number;
  /** "flat" holds the level (alarm); "bell" decays from the start (chime). */
  envelope?: "flat" | "bell";
}

/** Samples of the segments, as 16 bit mono PCM values (ramps of 8 ms at each edge, no click). */
export function toneSamples(segments: readonly ToneSegment[], rate = TONE_RATE): Int16Array {
  const total = segments.reduce((n, s) => n + Math.round((s.ms / 1000) * rate), 0);
  const out = new Int16Array(total);
  let at = 0;
  const ramp = Math.round(0.008 * rate);
  for (const s of segments) {
    const n = Math.round((s.ms / 1000) * rate);
    for (let i = 0; i < n; i++) {
      if (s.freq <= 0) continue;
      const t = i / rate;
      const edge = Math.min(1, i / ramp, (n - 1 - i) / ramp);
      const shape = s.envelope === "bell" ? Math.exp((-3.2 * i) / n) : 1;
      // A little third harmonic flattens the top so the tone carries on small phone speakers; the sum
      // (0.4 sin + 0.6 sin cubed) peaks at exactly 1.
      const wave = Math.sin(2 * Math.PI * s.freq * t) * 0.85 - Math.sin(6 * Math.PI * s.freq * t) * 0.15;
      out[at + i] = Math.round(wave * s.gain * edge * shape * 32767);
    }
    at += n;
  }
  return out;
}

/** A WAV file (RIFF, PCM 16 bit mono) of the samples. */
export function wavBytes(samples: Int16Array, rate = TONE_RATE): Uint8Array {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return bytes;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 of the bytes (no dependency on btoa or Buffer, so it runs the same everywhere). */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

/** The S43 and S47 chime: two soft notes, under 1 s in all. */
export const CHIME_SEGMENTS: readonly ToneSegment[] = [
  { freq: 660, ms: 320, gain: 0.35, envelope: "bell" },
  { freq: 880, ms: 480, gain: 0.35, envelope: "bell" },
];

let chime: string | null = null;

/** The chime as a data URI, made once. */
export function chimeUri(): string {
  chime ??= `data:audio/wav;base64,${base64(wavBytes(toneSamples(CHIME_SEGMENTS)))}`;
  return chime;
}
