/**
 * Why a live coach segment did not run (D-035 item 3): the stage that failed, and the error's name and
 * message, so the usage report (5.2) and its agent_sessions row say what happened on the phone instead
 * of only fallback_error. Shared by the client (session.ts, the lab page) and the server (validate.ts).
 *
 * The stages, in the order a segment meets them:
 *   token     POST /api/agent/token refused (the status and the server's code);
 *   sdk       the @google/genai chunk did not load;
 *   socket    the WebSocket failed or closed before it was set up (the close code and Google's reason);
 *   setup     no setupComplete within the connect limit;
 *   mic       getUserMedia for the microphone failed (NotAllowedError, NotReadableError, ...);
 *   audio     the AudioContext, the capture worklet's module or its node failed;
 *   live      the socket failed or closed after setupComplete;
 *   playback  questions sent and no coach audio heard (rule 6), or a context that cannot sound.
 *
 * C-12: never anything the person said, never the token, a key or a URL. The message is the browser's
 * or the socket's own text, reduced to printable ASCII, with every URL, token and key parameter
 * replaced, at most 200 characters. Pure, no DOM.
 */

export const COACH_FAIL_STAGES = [
  "token",
  "sdk",
  "socket",
  "setup",
  "mic",
  "audio",
  "live",
  "playback",
] as const;
export type CoachFailStage = (typeof COACH_FAIL_STAGES)[number];

export interface CoachFailure {
  stage: CoachFailStage;
  /** The error's name (NotAllowedError, closed_1008, HTTP_429, ...): [A-Za-z0-9_], 1 to 40. */
  name: string;
  /** The error's message, cleaned (cleanFailureMessage). */
  message: string;
}

export const FAILURE_NAME = /^[A-Za-z0-9_]{1,40}$/;
export const FAILURE_MESSAGE_MAX = 200;

/** An error that knows the stage it failed at (MicCapture's mic or audio, the transport's sdk to setup). */
export class CoachStageError extends Error {
  constructor(
    readonly stage: CoachFailStage,
    /** The name to report (a DOMException's name, a close code). */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoachStageError";
  }
}

/** A message as it may be stored: no URL, token or key, printable ASCII, one line, at most 200 characters. */
export function cleanFailureMessage(raw: string): string {
  return raw
    .replace(/auth_tokens\/[^\s"'&]+/gi, "<token>")
    .replace(/\b(?:wss?|https?|blob|data):[^\s"']+/gi, "<url>")
    .replace(/\b(access_token|api_?key|key|token)=[^\s&"']+/gi, "$1=<secret>")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]+/g, "?")
    .trim()
    .slice(0, FAILURE_MESSAGE_MAX);
}

/** A name as it may be stored: [A-Za-z0-9_], at most 40, "Error" when nothing is left. */
export function cleanFailureName(raw: string): string {
  const n = raw.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 40);
  return FAILURE_NAME.test(n) ? n : "Error";
}

const field = (v: unknown, key: "name" | "message"): string | null => {
  if (!v || typeof v !== "object" || !(key in v)) return null;
  const x = (v as Record<string, unknown>)[key];
  return typeof x === "string" ? x : null;
};

/**
 * The failure of a stage from whatever was thrown: a CoachStageError keeps its own stage and code; an
 * Error or a DOMException gives its name and message; anything else its text.
 */
export function coachFailure(stage: CoachFailStage, e: unknown): CoachFailure {
  if (e instanceof CoachStageError)
    return { stage: e.stage, name: cleanFailureName(e.code), message: cleanFailureMessage(e.message) };
  const name = field(e, "name") ?? (typeof e === "string" ? "Error" : typeof e);
  const message = field(e, "message") ?? (typeof e === "string" ? e : "");
  return { stage, name: cleanFailureName(name), message: cleanFailureMessage(message) };
}

/** The server's check of a reported failure: a known stage, a clean name, and a message already clean. */
export function isCoachFailure(v: unknown): v is CoachFailure {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "stage" && k !== "name" && k !== "message")) return false;
  return (
    typeof o.stage === "string" &&
    (COACH_FAIL_STAGES as readonly string[]).includes(o.stage) &&
    typeof o.name === "string" &&
    FAILURE_NAME.test(o.name) &&
    typeof o.message === "string" &&
    o.message.length <= FAILURE_MESSAGE_MAX &&
    cleanFailureMessage(o.message) === o.message
  );
}
