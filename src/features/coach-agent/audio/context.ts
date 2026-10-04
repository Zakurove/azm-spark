/**
 * The coach's one AudioContext (product v7 contract 2.11, stream D, step D3), shared by the
 * microphone capture and the coach's playback. One context at the device's own rate: the capture
 * worklet downsamples to 16 kHz and the 24 kHz chunks are resampled by Web Audio, so no context is
 * forced to a rate the microphone does not run at (live.md 14). iOS starts a context only from a tap:
 * unlockCoachAudio() is called inside the tap that starts a coached block, beside CuePlayer.unlock().
 */

let shared: AudioContext | null = null;

/** The coach's AudioContext, created on first use (and again after a close). */
export function coachAudioContext(): AudioContext {
  if (!shared || shared.state === "closed") shared = new AudioContext({ latencyHint: "interactive" });
  return shared;
}

/** Inside a tap: creates or resumes the coach's AudioContext. Never throws. */
export function unlockCoachAudio(): void {
  try {
    const c = coachAudioContext();
    if (c.state === "suspended") void c.resume().catch(() => undefined);
  } catch {
    /* no Web Audio: the coach falls back to the local voice */
  }
}

/** Whether this browser can run the coach's audio (Web Audio with AudioWorklet, and a microphone). */
export function coachAudioSupported(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}
