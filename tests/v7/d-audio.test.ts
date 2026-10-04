/**
 * Stream D, step D3: the coach's audio (product v7 contract 2.11 MicCapture and Speaker, 6.1, section
 * 9): the capture worklet derived from live-api-web-console downsamples the device rate to 16 kHz and
 * posts 20 ms frames (320 samples) with their level; MicCapture asks for echo cancellation and drops
 * frames while its gate is closed; Speaker plays 24 kHz chunks through the vendored AudioStreamer,
 * flushes at once and ducks to 30% (rules 1 and 3). Web Audio is replaced by small fakes in node.
 */
import { resolveObjectURL } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_FRAME,
  CAPTURE_RATE,
  CAPTURE_WORKLET,
  captureProcessor,
  captureWorkletSource,
} from "../../src/features/coach-agent/audio/capture.worklet";
import { createWorketFromSrc } from "../../src/features/coach-agent/audio/audioworklet-registry";
import { MIC_CONSTRAINTS, MicCapture, type MicDeps } from "../../src/features/coach-agent/audio/mic";
import { Speaker } from "../../src/features/coach-agent/audio/speaker";
import { AudioStreamer } from "../../src/features/coach-agent/audio/audio-streamer";
import { DUCK_VOLUME } from "../../src/coach/events";

/* ------------------------------------------------ the capture worklet */

interface Posted {
  msg: { pcm: ArrayBuffer; level: number };
  transfer: unknown[];
}
class FakeProcessor {
  posted: Posted[] = [];
  port = {
    postMessage: (msg: Posted["msg"], transfer: unknown[]) => this.posted.push({ msg, transfer }),
  };
}
type Processor = FakeProcessor & { process(inputs: Float32Array[][]): boolean };

const g = globalThis as unknown as { sampleRate?: number; AudioWorkletProcessor?: unknown };
function processorAt(rate: number): Processor {
  g.sampleRate = rate;
  g.AudioWorkletProcessor = FakeProcessor;
  const Cls = captureProcessor() as unknown as new (o: unknown) => Processor;
  return new Cls({ processorOptions: { rate: CAPTURE_RATE, frame: CAPTURE_FRAME } });
}
/** Plays `samples` through the processor in render quanta of 128, as the audio thread does. */
function feed(p: Processor, samples: Float32Array) {
  for (let i = 0; i < samples.length; i += 128)
    expect(p.process([[samples.subarray(i, i + 128)]])).toBe(true);
}
const tone = (rate: number, hz: number, seconds: number, amp: number) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );
const frames = (p: Processor) => p.posted.map((x) => new Int16Array(x.msg.pcm));
const joined = (p: Processor) => Int16Array.from(frames(p).flatMap((f) => [...f]));
const rms = (xs: ArrayLike<number>, scale = 1) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] / scale) ** 2;
  return Math.sqrt(s / xs.length);
};

afterEach(() => {
  delete g.sampleRate;
  delete g.AudioWorkletProcessor;
});

describe("the capture worklet", () => {
  it("posts 20 ms frames of 320 samples at 16 kHz, transferred, with their level", () => {
    expect(CAPTURE_RATE).toBe(16_000);
    expect(CAPTURE_FRAME).toBe(320);
    const p = processorAt(48_000);
    feed(p, new Float32Array(960).fill(0.5));
    expect(p.posted).toHaveLength(1);
    const f = frames(p)[0];
    expect(f.length).toBe(320);
    expect(new Set(f)).toEqual(new Set([16384]));
    expect(p.posted[0].msg.level).toBeCloseTo(0.5, 6);
    expect(p.posted[0].transfer).toEqual([p.posted[0].msg.pcm]);
  });

  it("downsamples 44.1 kHz and 48 kHz to exactly 16000 samples a second", () => {
    for (const rate of [44_100, 48_000]) {
      const p = processorAt(rate);
      feed(p, tone(rate, 440, 1, 0.3));
      expect(p.posted, String(rate)).toHaveLength(50);
    }
  });

  it("keeps a speech band tone's pitch and level", () => {
    const p = processorAt(48_000);
    feed(p, tone(48_000, 1000, 1, 0.5));
    const out = joined(p);
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 !== out[i] < 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(1990);
    expect(crossings).toBeLessThanOrEqual(2010);
    expect(rms(out, 32768)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("lowers a tone above 8 kHz before the rate drop", () => {
    const p = processorAt(48_000);
    feed(p, tone(48_000, 12_000, 0.5, 0.5));
    expect(rms(joined(p), 32768)).toBeLessThan((0.5 / Math.SQRT2) * 0.4);
  });

  it("clamps at full scale instead of wrapping", () => {
    const p = processorAt(16_000);
    feed(
      p,
      Float32Array.from({ length: 320 }, (_, i) => (i % 2 ? 1.5 : -1.5)),
    );
    expect(new Set(frames(p)[0])).toEqual(new Set([32767, -32768]));
  });

  it("runs from its source text alone, registered by the vendored registry", async () => {
    const url = createWorketFromSrc(CAPTURE_WORKLET, captureWorkletSource());
    const text = await resolveObjectURL(url)!.text();
    let registered: { name: string; cls: new (o: unknown) => Processor } | null = null;
    // Only the worklet scope's globals are given: the source uses nothing from the page.
    new Function("registerProcessor", "AudioWorkletProcessor", "sampleRate", text)(
      (name: string, cls: new (o: unknown) => Processor) => (registered = { name, cls }),
      FakeProcessor,
      48_000,
    );
    expect(registered!.name).toBe("azm-capture");
    const p = new registered!.cls({ processorOptions: { rate: 16_000, frame: 320 } });
    feed(p, new Float32Array(960).fill(-0.25));
    expect(new Set(frames(p)[0])).toEqual(new Set([-8192]));
  });
});

/* ------------------------------------------------------- MicCapture */

class FakePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  frame(level: number) {
    this.onmessage?.({ data: { pcm: new Int16Array(320).buffer, level } } as MessageEvent);
  }
}
function micDeps(opts: { refuse?: boolean } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const port = new FakePort();
  const node = { port, connect: vi.fn(), disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const ctx = { destination: { kind: "out" }, createMediaStreamSource: vi.fn(() => source) };
  const deps: MicDeps & { [k: string]: unknown } = {
    getUserMedia: vi.fn(async () => {
      if (opts.refuse) throw new DOMException("denied", "NotAllowedError");
      return stream;
    }),
    context: () => ctx as unknown as AudioContext,
    addModule: vi.fn(async () => undefined),
    createNode: vi.fn(() => node as unknown as AudioWorkletNode),
  };
  return { deps, track, port, node, source, ctx, stream };
}

describe("MicCapture", () => {
  it("asks for echo cancellation, noise suppression and gain control on one channel", async () => {
    const m = micDeps();
    await new MicCapture(m.deps).start(() => undefined);
    expect(m.deps.getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    expect(m.deps.addModule).toHaveBeenCalledTimes(1);
    expect(m.deps.createNode).toHaveBeenCalledWith(
      m.ctx,
      expect.objectContaining({ processorOptions: { rate: 16_000, frame: 320 } }),
    );
    expect(m.source.connect).toHaveBeenCalledWith(m.node);
    expect(m.node.connect).toHaveBeenCalledWith(m.ctx.destination);
  });

  it("drops frames while the gate is closed and keeps the level moving", async () => {
    const m = micDeps();
    const mic = new MicCapture(m.deps);
    const got: ArrayBuffer[] = [];
    await mic.start((pcm) => got.push(pcm));
    m.port.frame(0.1);
    mic.gate(false);
    m.port.frame(0.4);
    m.port.frame(0.3);
    expect(got).toHaveLength(1);
    expect(mic.level).toBe(0.3);
    mic.gate(true);
    m.port.frame(0.2);
    expect(got).toHaveLength(2);
    expect(got[1].byteLength).toBe(640);
  });

  it("stops the microphone and sends nothing more", async () => {
    const m = micDeps();
    const mic = new MicCapture(m.deps);
    const got: ArrayBuffer[] = [];
    await mic.start((pcm) => got.push(pcm));
    const handler = m.port.onmessage;
    mic.stop();
    handler?.({ data: { pcm: new ArrayBuffer(640), level: 0.5 } } as MessageEvent);
    expect(got).toEqual([]);
    expect(m.track.stop).toHaveBeenCalled();
    expect(m.source.disconnect).toHaveBeenCalled();
    expect(mic.level).toBe(0);
    await mic.start(() => undefined);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("rejects when the microphone is refused, and releases a stream granted after a stop", async () => {
    await expect(new MicCapture(micDeps({ refuse: true }).deps).start(() => undefined)).rejects.toThrow(
      "denied",
    );
    const m = micDeps();
    const mic = new MicCapture(m.deps);
    const started = mic.start(() => undefined);
    mic.stop();
    await started;
    expect(m.track.stop).toHaveBeenCalled();
    expect(m.deps.createNode).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------- Speaker */

class FakeParam {
  value = 1;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(["ramp", v, t]);
  }
}
class FakeGain {
  gain = new FakeParam();
  connected = true;
  connect() {}
  disconnect() {
    this.connected = false;
  }
}
class FakeSource {
  buffer: { duration: number; length: number } | null = null;
  onended: (() => void) | null = null;
  started: number | null = null;
  stopped: number | null = null;
  out: unknown = null;
  connect(n: unknown) {
    this.out = n;
  }
  disconnect() {}
  start(t: number) {
    this.started = t;
  }
  stop(t: number) {
    this.stopped = t;
  }
}
class FakeContext {
  currentTime = 10;
  state = "running";
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  buffers: { channels: number; length: number; rate: number }[] = [];
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, rate: number) {
    this.buffers.push({ channels, length, rate });
    const data = new Float32Array(length);
    return { duration: length / rate, length, getChannelData: () => data };
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
}

describe("Speaker", () => {
  let ctx: FakeContext;
  let speaker: Speaker;
  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeContext();
    speaker = new Speaker(() => ctx as unknown as AudioContext);
  });
  afterEach(() => vi.useRealTimers());
  /** Sources that were given a buffer (the streamer's own spare source is not one). */
  const played = () => ctx.sources.filter((s) => s.buffer);
  const pcm = (seconds: number) => new Int16Array(Math.round(24_000 * seconds)).buffer;

  it("plays 24 kHz chunks after a 100 ms buffer, split at 7680 samples, 200 ms ahead", () => {
    speaker.play(pcm(0.4));
    expect(ctx.buffers.map((b) => [b.rate, b.length])).toEqual([[24_000, 7680]]);
    expect(played()[0].started).toBeCloseTo(10.1, 6);
    expect(speaker.playing).toBe(true);
    // The rest is scheduled once the first part is within 200 ms of its end.
    ctx.currentTime = 10.37;
    vi.advanceTimersByTime(370);
    expect(ctx.buffers.map((b) => [b.rate, b.length])).toEqual([
      [24_000, 7680],
      [24_000, 1920],
    ]);
    expect(played()[1].started).toBeCloseTo(10.1 + 0.32, 6);
  });

  it("tells when the last chunk has played", () => {
    const idle = vi.fn();
    speaker.onIdle(idle);
    speaker.play(pcm(0.1));
    expect(idle).not.toHaveBeenCalled();
    played()[0].onended?.();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(speaker.playing).toBe(false);
  });

  it("flushes at once and plays the next chunk right away on a fresh gain", () => {
    const idle = vi.fn();
    speaker.onIdle(idle);
    speaker.play(pcm(1));
    const before = played().length;
    expect(before).toBeGreaterThan(0);
    speaker.flush();
    expect(played().every((s) => s.stopped !== null && s.stopped <= ctx.currentTime + 0.02)).toBe(true);
    expect(speaker.playing).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
    speaker.play(pcm(0.1));
    const next = played().at(-1)!;
    expect(next.out).toBe(ctx.gains.at(-1));
    expect(next.started).toBeCloseTo(10.1, 6);
  });

  it("ducks to 30% while a local line plays, through a flush, and back to full", () => {
    speaker.play(pcm(0.1));
    speaker.duck(true);
    expect(DUCK_VOLUME).toBe(0.3);
    expect(ctx.gains.at(-1)!.gain.value).toBeCloseTo(0.3, 6);
    speaker.flush();
    expect(ctx.gains.at(-1)!.gain.value).toBeCloseTo(0.3, 6);
    speaker.duck(false);
    expect(ctx.gains.at(-1)!.gain.value).toBe(1);
  });

  it("resumes a suspended context, and plays nothing after close", () => {
    ctx.state = "suspended";
    speaker.play(pcm(0.1));
    expect(ctx.resume).toHaveBeenCalled();
    speaker.close();
    const n = ctx.buffers.length;
    speaker.play(pcm(0.1));
    expect(ctx.buffers.length).toBe(n);
    expect(speaker.playing).toBe(false);
  });

  it("reads a chunk through its own offset and drops an odd last byte", () => {
    const s = new AudioStreamer(ctx as unknown as AudioContext);
    const bytes = new Uint8Array([9, 0x00, 0x40, 0x00, 0xc0, 7]);
    s.addPCM16(bytes.subarray(1, 6));
    expect(ctx.buffers.at(-1)!.length).toBe(2);
  });
});
