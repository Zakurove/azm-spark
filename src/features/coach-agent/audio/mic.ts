/**
 * MicCapture (product v7 contract 2.11, stream D, step D3): the microphone as 16 kHz, 16 bit mono
 * frames of 20 ms, from the derived capture worklet (capture.worklet.ts) in the coach's AudioContext.
 * The browser's echo cancellation, noise suppression and gain control are asked for (the coach's own
 * voice plays from the same phone).
 *
 * gate(false) drops frames (nothing reaches onChunk) until gate(true); the capture keeps running, so
 * the level meter still moves. The bridge closes the gate while a local line plays and 300 ms after
 * it (rule 3), so Gemini never hears the app's own voice as the person's speech.
 *
 * D-035 item 3 (the coach never connected on iPhone Safari):
 *   - the audio session is set to play-and-record BEFORE the microphone is asked: the check's taps set
 *     navigator.audioSession.type to "playback" for the voice, which WebKit on iOS keeps as a category
 *     override, and with it the capture's PlayAndRecord category is never applied;
 *   - a failure names its stage: getUserMedia is the mic stage, the context, the worklet's module and
 *     its node are the audio stage (CoachStageError), and a microphone granted before an audio failure
 *     is released at once;
 *   - the worklet's module loads from a blob URL, and from a data URL where a browser refuses the blob;
 *   - a context iOS left suspended or interrupted is resumed once the microphone runs.
 */
import { CoachStageError } from "../../../coach/failure";
import { CAPTURE_FRAME, CAPTURE_RATE, CAPTURE_WORKLET, captureWorkletSource } from "./capture.worklet";
import type { CaptureFrame, CaptureOptions } from "./capture.worklet";
import { createWorketFromSrc } from "./audioworklet-registry";
import { coachAudioContext, setCaptureAudioSession } from "./context";

/** What the microphone is asked for. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
};

/** The browser parts MicCapture uses (tests give fakes). */
export interface MicDeps {
  /** Called right before getUserMedia: the audio session that allows a capture (play-and-record). */
  prepare?(): void;
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  context(): AudioContext;
  /** Adds the capture worklet's module to a context (once per context). */
  addModule(ctx: AudioContext): Promise<void>;
  createNode(ctx: AudioContext, options: AudioWorkletNodeOptions): AudioWorkletNode;
}

/** How the capture worklet's module was loaded: a blob URL, or a data URL after the blob was refused. */
export type ModuleSource = "blob" | "data";

const added = new WeakMap<AudioContext, Promise<ModuleSource>>();

/** The capture worklet's module as a data URL. */
const dataUrl = (src: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;

/**
 * Adds the capture worklet's module to a context: from a blob URL (the upstream registry's way), and
 * from a data URL when the blob URL is refused. Rejects with the data URL's error when both fail.
 */
export async function addCaptureModule(ctx: AudioContext): Promise<ModuleSource> {
  const src = `registerProcessor("${CAPTURE_WORKLET}", ${captureWorkletSource()})`;
  const blob = createWorketFromSrc(CAPTURE_WORKLET, captureWorkletSource());
  try {
    await ctx.audioWorklet.addModule(blob);
    return "blob";
  } catch {
    await ctx.audioWorklet.addModule(dataUrl(src));
    return "data";
  } finally {
    try {
      URL.revokeObjectURL(blob);
    } catch {
      /* nothing to free */
    }
  }
}

/** The capture module of a context, added once (a failed add is tried again next time). */
export function captureModule(ctx: AudioContext): Promise<ModuleSource> {
  let p = added.get(ctx);
  if (!p) {
    p = addCaptureModule(ctx);
    p.catch(() => added.delete(ctx));
    added.set(ctx, p);
  }
  return p;
}

export const browserMicDeps: MicDeps = {
  prepare: () => setCaptureAudioSession(),
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  context: coachAudioContext,
  addModule: async (ctx) => {
    await captureModule(ctx);
  },
  createNode: (ctx, options) => new AudioWorkletNode(ctx, CAPTURE_WORKLET, options),
};

const nameOf = (e: unknown, fallback: string) =>
  e && typeof e === "object" && "name" in e && typeof e.name === "string" ? e.name : fallback;
const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : e && typeof e === "object" && "message" in e
      ? String(e.message)
      : String(e);
/** A failure of one stage, keeping the browser's error name. */
const stageError = (stage: "mic" | "audio", e: unknown) =>
  e instanceof CoachStageError ? e : new CoachStageError(stage, nameOf(e, "Error"), messageOf(e));

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

  /** The microphone's stream while it runs (the lab page reads its track). */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Asks for the microphone and starts the frames. Rejects with a CoachStageError: the mic stage when
   * the microphone is refused or cannot start, the audio stage when Web Audio cannot run the capture.
   */
  async start(onChunk: (pcm16k: ArrayBuffer) => void): Promise<void> {
    if (this.stopped || this.stream) return;
    try {
      this.deps.prepare?.();
    } catch {
      /* no audio session API */
    }
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      throw stageError("mic", e);
    }
    if (this.stopped) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.stream = stream;
    try {
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
      // iOS may leave the context suspended, or interrupted while the session changes for the capture.
      const state = ctx.state as string;
      if (state === "suspended" || state === "interrupted") void ctx.resume().catch(() => undefined);
    } catch (e) {
      // A microphone granted before an audio failure is never left open.
      this.stop();
      throw stageError("audio", e);
    }
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
