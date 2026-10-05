/**
 * MicCapture (product v7 contract 2.11, stream D, step D3): the microphone as 16 kHz, 16 bit mono
 * frames of 20 ms, from the derived capture worklet (capture.worklet.ts) in the coach's AudioContext.
 * The browser's echo cancellation, noise suppression and gain control are asked for (the coach's own
 * voice plays from the same phone).
 *
 * gate(false) drops frames (nothing reaches onChunk) until gate(true); the capture keeps running, so
 * the level meter still moves. The bridge closes the gate while a local line plays and 300 ms after
 * it (rule 3), so Gemini never hears the app's own voice as the person's speech.
 */
import { CAPTURE_FRAME, CAPTURE_RATE, CAPTURE_WORKLET, captureWorkletSource } from "./capture.worklet";
import type { CaptureFrame, CaptureOptions } from "./capture.worklet";
import { createWorketFromSrc } from "./audioworklet-registry";
import { coachAudioContext } from "./context";

/** What the microphone is asked for. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
};

/** The browser parts MicCapture uses (tests give fakes). */
export interface MicDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  context(): AudioContext;
  /** Adds the capture worklet's module to a context (once per context). */
  addModule(ctx: AudioContext): Promise<void>;
  createNode(ctx: AudioContext, options: AudioWorkletNodeOptions): AudioWorkletNode;
}

const added = new WeakMap<AudioContext, Promise<void>>();

export const browserMicDeps: MicDeps = {
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  context: coachAudioContext,
  addModule(ctx) {
    let p = added.get(ctx);
    if (!p) {
      p = ctx.audioWorklet.addModule(createWorketFromSrc(CAPTURE_WORKLET, captureWorkletSource()));
      // A failed add is tried again next time.
      p.catch(() => added.delete(ctx));
      added.set(ctx, p);
    }
    return p;
  },
  createNode: (ctx, options) => new AudioWorkletNode(ctx, CAPTURE_WORKLET, options),
};

export class MicCapture {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private open = true;
  private stopped = false;
  private lastLevel = 0;

  constructor(private readonly deps: MicDeps = browserMicDeps) {}

  /** The RMS level of the last frame, 0 to 1 (also while the gate is closed). */
  get level(): number {
    return this.lastLevel;
  }

  /** Asks for the microphone and starts the frames. Rejects when the microphone is refused. */
  async start(onChunk: (pcm16k: ArrayBuffer) => void): Promise<void> {
    if (this.stopped || this.stream) return;
    const stream = await this.deps.getUserMedia(MIC_CONSTRAINTS);
    if (this.stopped) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.stream = stream;
    const ctx = this.deps.context();
    await this.deps.addModule(ctx);
    if (this.stopped) return;
    const options: CaptureOptions = { rate: CAPTURE_RATE, frame: CAPTURE_FRAME };
    const node = this.deps.createNode(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      processorOptions: options,
    });
    node.port.onmessage = (ev: MessageEvent<CaptureFrame>) => {
      if (this.stopped) return;
      this.lastLevel = ev.data.level;
      if (this.open) onChunk(ev.data.pcm);
    };
    const source = ctx.createMediaStreamSource(stream);
    source.connect(node);
    // The worklet writes no output: connected, it is pulled by the graph and plays silence.
    node.connect(ctx.destination);
    this.source = source;
    this.node = node;
  }

  /** Ends the capture and releases the microphone. */
  stop(): void {
    this.stopped = true;
    if (this.node) this.node.port.onmessage = null;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.source = null;
    this.node = null;
    this.lastLevel = 0;
  }

  /** Closed: frames are dropped until it opens again; the level still updates. */
  gate(open: boolean): void {
    this.open = open;
  }
}
