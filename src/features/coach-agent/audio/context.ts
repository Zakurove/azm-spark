/**
 * The coach's one AudioContext (product v7 contract 2.11, stream D, step D3), shared by the
 * microphone capture and the coach's playback. One context at the device's own rate: the capture
 * worklet downsamples to 16 kHz and the 24 kHz chunks are resampled by Web Audio, so no context is
 * forced to a rate the microphone does not run at (live.md 14). iOS starts a context only from a tap:
 * unlockCoachAudio() is called inside the tap that starts a coached block, beside CuePlayer.unlock().
 *
 * The audio session (D-035 item 3): the check's taps set navigator.audioSession.type to "playback" so
 * the iOS silent switch does not mute the voice. WebKit on iOS keeps that type as a category override
 * and then never applies PlayAndRecord when a capture starts, so the coach's microphone cannot run.
 * setCaptureAudioSession() sets play-and-record right before the microphone is asked (MicCapture), and
 * the session sets playback again when the coach stops listening (useCoach setCoachAudioSession).
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
    const state = c.state as string;
    if (state === "suspended" || state === "interrupted") void c.resume().catch(() => undefined);
  } catch {
    /* no Web Audio: the coach falls back to the local voice */
  }
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** navigator.audioSession.type, or null where the browser has no audio session API (all but Safari). */
export function audioSessionType(): string | null {
  try {
    const nav = navigator as AudioSessionNavigator;
    return nav.audioSession ? nav.audioSession.type : null;
  } catch {
    return null;
  }
}

/** Before the microphone is asked: the audio session allows a capture (play-and-record). Never throws. */
export function setCaptureAudioSession(): void {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession && nav.audioSession.type !== "play-and-record")
      nav.audioSession.type = "play-and-record";
  } catch {
    /* not supported */
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
