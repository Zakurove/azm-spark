/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Derived for Azm from google-gemini/live-api-web-console
 * (https://github.com/google-gemini/live-api-web-console), file src/lib/worklets/audio-processing.ts
 * at commit 0a4542fe0e39d07956ea7af5de45d7c81fde8960 (the file last changed in
 * 630a0330a04cde36b87b979f2db1e7bae95aa2fe, 2024-12-11). Licence: Apache License 2.0, the header above
 * kept verbatim (copyright line from the upstream file header: "Copyright 2024 Google LLC").
 * NOTICE: none (the repository has no NOTICE file at that commit).
 * Modified for Azm (product v7 contract 6.1 "Derive"): rewritten. The upstream worklet runs in a
 * 16 kHz AudioContext, converts each float sample to 16 bit and posts every 2048 samples (128 ms).
 * This one runs in the device's own context (a 16 kHz context fails beside a microphone at another
 * rate in some browsers, live.md 14), downsamples to 16 kHz inside the worklet with an area average
 * over each output sample (which also low passes before the rate drop), clamps instead of wrapping at
 * full scale, and posts 20 ms frames (320 samples, live.md 6) with their RMS level for the meter. It
 * is written as a function whose source text is the processor class, so the processor is type
 * checked; the function never runs on the page, only inside the AudioWorkletGlobalScope (it uses no
 * name from this module). Reformatted with prettier, strict TypeScript.
 */

/** The audio thread's globals (AudioWorkletGlobalScope), used only inside captureProcessor. */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

/** What the microphone frames are (live.md 6): 16 kHz, 20 ms, 16 bit mono. */
export const CAPTURE_RATE = 16_000;
export const CAPTURE_FRAME = 320;
/** The processor's registered name. */
export const CAPTURE_WORKLET = "azm-capture";

/** One 20 ms frame from the worklet: the 16 bit samples and their RMS level from 0 to 1. */
export interface CaptureFrame {
  pcm: ArrayBuffer;
  level: number;
}
/** The worklet's options (processorOptions). */
export interface CaptureOptions {
  rate: number;
  frame: number;
}

/**
 * The capture processor class. Called inside the AudioWorkletGlobalScope only (registerProcessor
 * takes its result); it reads sampleRate there and nothing from this module.
 */
export function captureProcessor() {
  return class AzmCaptureProcessor extends AudioWorkletProcessor {
    /** Input samples per output sample (3 at 48 kHz, 2.75625 at 44.1 kHz). */
    private ratio: number;
    /** The input span still owed to the output sample being built. */
    private need: number;
    private acc: number;
    private out: Int16Array;
    private n: number;
    private sumSq: number;

    constructor(options?: { processorOptions?: Partial<CaptureOptions> }) {
      super(options);
      const o = options && options.processorOptions ? options.processorOptions : {};
      const rate = o.rate && o.rate > 0 ? o.rate : 16000;
      this.ratio = sampleRate / rate;
      this.need = this.ratio;
      this.acc = 0;
      this.out = new Int16Array(o.frame && o.frame > 0 ? o.frame : 320);
      this.n = 0;
      this.sumSq = 0;
    }

    process(inputs: Float32Array[][]): boolean {
      const channel = inputs[0] && inputs[0][0];
      if (channel) for (let i = 0; i < channel.length; i++) this.take(channel[i]);
      return true;
    }

    /** One input sample: its span goes to the output samples it covers. */
    private take(x: number): void {
      let left = 1;
      while (left > 0) {
        const part = left < this.need ? left : this.need;
        this.acc += x * part;
        this.need -= part;
        left -= part;
        if (this.need <= 1e-9) {
          this.emit(this.acc / this.ratio);
          this.acc = 0;
          this.need += this.ratio;
        }
      }
    }

    private emit(v: number): void {
      const s = v > 1 ? 1 : v < -1 ? -1 : v;
      this.out[this.n++] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      this.sumSq += s * s;
      if (this.n === this.out.length) {
        const pcm = this.out.buffer;
        const level = Math.sqrt(this.sumSq / this.n);
        this.port.postMessage({ pcm, level }, [pcm]);
        this.out = new Int16Array(this.n);
        this.n = 0;
        this.sumSq = 0;
      }
    }
  };
}

/** The processor's source text, for createWorketFromSrc (registerProcessor(name, source)). */
export function captureWorkletSource(): string {
  return `(${captureProcessor.toString()})()`;
}
