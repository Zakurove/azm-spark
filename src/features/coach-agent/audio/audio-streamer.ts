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
 * Vendored for Azm from google-gemini/live-api-web-console
 * (https://github.com/google-gemini/live-api-web-console), file src/lib/audio-streamer.ts at commit
 * 0a4542fe0e39d07956ea7af5de45d7c81fde8960 (the file last changed in
 * ac84a937e0047b03519cb76e3a1ffebbbc5c5e62, 2025-05-19). Licence: Apache License 2.0, the header above
 * kept verbatim (copyright line from the upstream file header: "Copyright 2024 Google LLC").
 * NOTICE: none (the repository has no NOTICE file at that commit).
 * Modified for Azm:
 *   - reformatted with prettier and tightened for strict TypeScript (no any; setInterval and
 *     setTimeout without window; the usage example at the end of the file removed);
 *   - stop() ends every scheduled chunk at once (a 15 ms fade) and a new chunk plays right after it,
 *     on a fresh gain node: the coach's voice is flushed when the person cuts in and on a safety stop
 *     (product v7 contract 2.11 rule 1). Upstream ramped the gain down over 100 ms and swapped the node
 *     200 ms later, so a reply that began within those 200 ms played silent;
 *   - setVolume() for the ducking of rule 3 (30% while a local line plays), kept by stop() and resume();
 *   - every turn gets the 100 ms initial buffer (section 9): once the last chunk has played the
 *     streamer is quiet and stops polling, and the next chunk, or one that comes after the voice ran
 *     dry inside a turn, is scheduled at once after a fresh buffer. Upstream kept polling every 100 ms
 *     and played a later turn's first chunk at the next poll with no buffer;
 *   - a playing flag, and onComplete also after stop() when something was playing; close();
 *   - a chunk is read through its own byte offset, and an odd last byte is dropped instead of throwing.
 */

import { createWorketFromSrc, registeredWorklets } from "./audioworklet-registry";

/** Modified for Azm: the fade of stop(), in seconds. */
const STOP_FADE = 0.015;

export class AudioStreamer {
  private sampleRate: number = 24000;
  private bufferSize: number = 7680;
  // A queue of audio buffers to be played. Each buffer is a Float32Array.
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  // Indicates if the stream has finished playing, e.g., interrupted.
  private isStreamComplete: boolean = false;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1; //0.1 // 100ms initial buffer
  // Web Audio API nodes. source => gain => destination
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;
  /** Modified for Azm: the chunks scheduled and not yet ended, so stop() can end them at once. */
  private scheduled = new Set<AudioBufferSourceNode>();
  /** Modified for Azm: the volume, 1 or the duck level. */
  private volume = 1;

  public onComplete = () => {};

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  /** Modified for Azm: true while a chunk is queued or playing. */
  get playing(): boolean {
    return this.scheduled.size > 0 || this.audioQueue.length > 0;
  }

  async addWorklet<T extends (this: MessagePort, ev: MessageEvent) => unknown>(
    workletName: string,
    workletSrc: string,
    handler: T,
  ): Promise<this> {
    let workletsRecord = registeredWorklets.get(this.context);
    if (workletsRecord && workletsRecord[workletName]) {
      // the worklet already exists on this context
      // add the new handler to it
      workletsRecord[workletName].handlers.push(handler);
      return Promise.resolve(this);
      //throw new Error(`Worklet ${workletName} already exists on context`);
    }

    if (!workletsRecord) {
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    // create new record to fill in as becomes available
    workletsRecord[workletName] = { handlers: [handler] };

    const src = createWorketFromSrc(workletName, workletSrc);
    await this.context.audioWorklet.addModule(src);
    const worklet = new AudioWorkletNode(this.context, workletName);

    //add the node into the map
    workletsRecord[workletName].node = worklet;

    return this;
  }

  /**
   * Converts a Uint8Array of PCM16 audio data into a Float32Array.
   * PCM16 is a common raw audio format, but the Web Audio API generally
   * expects audio data as Float32Arrays with samples normalized between -1.0 and 1.0.
   * This function handles that conversion.
   * @param chunk The Uint8Array containing PCM16 audio data.
   * @returns A Float32Array representing the converted audio data.
   */
  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(Math.floor(chunk.length / 2));
    const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    for (let i = 0; i < float32Array.length; i++) {
      const int16 = dataView.getInt16(i * 2, true);
      float32Array[i] = int16 / 32768;
    }
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    // Reset the stream complete flag when a new chunk is added.
    this.isStreamComplete = false;
    // Process the chunk into a Float32Array
    let processingBuffer = this._processPCM16Chunk(chunk);
    // Add the processed buffer to the queue if it's larger than the buffer size.
    // This is to ensure that the buffer is not too large.
    while (processingBuffer.length >= this.bufferSize) {
      const buffer = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    // Add the remaining buffer to the queue if it's not empty.
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }
    // Modified for Azm: a chunk that finds everything scheduled already played (the voice ran dry
    // inside a turn) starts again like a new turn, after a fresh initial buffer, at once.
    const ranDry = this.isPlaying && this.scheduledTime <= this.context.currentTime;
    // Start playing if not already playing.
    if (!this.isPlaying || ranDry) {
      this.isPlaying = true;
      // Initialize scheduledTime only when we start playing
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      if (this.scheduleTimer) {
        clearTimeout(this.scheduleTimer);
        this.scheduleTimer = null;
      }
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    const SCHEDULE_AHEAD_TIME = 0.2;
    this.scheduleTimer = null;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        this.endOfQueueAudioSource = source;
      }
      // Modified for Azm: every chunk is tracked until it ends; the last one of the queue completes,
      // and the streamer is quiet until the next chunk, which starts a new turn after a fresh initial
      // buffer (nothing polls while the coach is quiet).
      this.scheduled.add(source);
      source.onended = () => {
        this.scheduled.delete(source);
        if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
          this.endOfQueueAudioSource = null;
          this.isPlaying = false;
          if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
          }
          this.onComplete();
        }
      };

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const worklets = registeredWorklets.get(this.context);

      if (worklets) {
        Object.entries(worklets).forEach(([, graph]) => {
          const { node, handlers } = graph;
          if (node) {
            source.connect(node);
            node.port.onmessage = function (ev: MessageEvent) {
              handlers.forEach((handler) => {
                handler.call(node.port, ev);
              });
            };
            node.connect(this.context.destination);
          }
        });
      }
      // Ensure we never schedule in the past
      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    }

    if (this.audioQueue.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          this.checkInterval = setInterval(() => {
            if (this.audioQueue.length > 0) {
              this.scheduleNextBuffer();
            }
          }, 100);
        }
      }
    } else {
      const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
      this.scheduleTimer = setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
    }
  }

  stop() {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Modified for Azm: the scheduled chunks end now, under a short fade on the old gain node, and the
    // next chunk plays at once on a fresh one at the current volume.
    const sources = [...this.scheduled];
    this.scheduled.clear();
    this.endOfQueueAudioSource = null;
    const old = this.gainNode;
    const now = this.context.currentTime;
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.linearRampToValueAtTime(0, now + STOP_FADE);
    for (const s of sources) {
      s.onended = null;
      try {
        s.stop(now + STOP_FADE);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => old.disconnect(), STOP_FADE * 1000 + 50);
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.context.destination);
    if (sources.length) this.onComplete();
  }

  /** Modified for Azm: the playback volume (rule 3 ducks it to 30% while a local line plays). */
  setVolume(volume: number) {
    this.volume = volume;
    const now = this.context.currentTime;
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.05);
  }

  async resume() {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(this.volume, this.context.currentTime);
  }

  complete() {
    this.isStreamComplete = true;
    this.onComplete();
  }

  /** Modified for Azm: the end of a coach segment. */
  close() {
    this.stop();
    this.gainNode.disconnect();
  }
}
