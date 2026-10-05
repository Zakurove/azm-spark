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
 * (https://github.com/google-gemini/live-api-web-console), file src/lib/audioworklet-registry.ts at
 * commit 0a4542fe0e39d07956ea7af5de45d7c81fde8960 (the file last changed in
 * 630a0330a04cde36b87b979f2db1e7bae95aa2fe, 2024-12-11). Licence: Apache License 2.0, the header
 * above kept verbatim (copyright line from the upstream file header: "Copyright 2024 Google LLC").
 * NOTICE: none (the repository has no NOTICE file at that commit).
 * Modified for Azm: reformatted with prettier; the handler's return type is unknown instead of any
 * (strict TypeScript). The capture worklet (capture.worklet.ts) is created with createWorketFromSrc
 * but is never put in registeredWorklets: AudioStreamer connects every playback source to the nodes
 * of that map, and the coach's own voice must never reach the microphone frames.
 */

/**
 * A registry to map attached worklets by their audio-context
 * any module using `audioContext.audioWorklet.addModule(` should register the worklet here
 */
export type WorkletGraph = {
  node?: AudioWorkletNode;
  handlers: Array<(this: MessagePort, ev: MessageEvent) => unknown>;
};

export const registeredWorklets: Map<AudioContext, Record<string, WorkletGraph>> = new Map();

export const createWorketFromSrc = (workletName: string, workletSrc: string) => {
  const script = new Blob([`registerProcessor("${workletName}", ${workletSrc})`], {
    type: "application/javascript",
  });

  return URL.createObjectURL(script);
};
