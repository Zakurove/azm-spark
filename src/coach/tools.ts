/**
 * The live coach's tools (product v7 contract 2.11 and C-7, stream D): the tool set of each block,
 * their behaviour, the REST shaped declarations the server locks inside the token (5.1), the strict
 * argument parser, and the checks a call passes before a host sees it. Shared by the client (the tool
 * executor) and the server (the token). Pure, no DOM.
 *
 * The app is authoritative: a tool call is a request. A host validates it against the engine state,
 * applies it at once and answers (C-17); the model says what the app decided. The descriptions say
 * when to call each tool and when never to (live.md 8: the model performs best with precise tools
 * and single calls). They are copy the model reads, so they keep the wording rules (5.3).
 */
import { REGION_IDS, type RegionId } from "../medical/body-map";
import { ROM_MOVEMENT_IDS, type RomMovementId, type RomSide } from "../movements/rom/types";
import type { LimitCause, RomAnswer } from "../engine/rom/types";
import { PAIN_STOP } from "../medical/pain-rule";
import { COACH_INTENTS } from "./actions";
import type {
  BridgeEvent,
  CoachBlock,
  CoachIntent,
  CoachStopReason,
  ToolArgs,
  ToolName,
  ToolResult,
} from "./types";

/* ------------------------------------------------------------ the sets */

export const TOOL_SETS: Record<CoachBlock, readonly ToolName[]> = {
  rom: [
    "confirm_max",
    "answer_can_move",
    "keep_reaching",
    "mark_pain",
    "set_limit_cause",
    "pause",
    "resume",
    "stop",
    "next_step",
    "repeat_instructions",
  ],
  gait: ["mark_pain", "pause", "resume", "stop", "next_step", "repeat_instructions"],
  session: ["mark_pain", "pause", "resume", "stop", "next_step", "repeat_instructions"],
};

export const TOOL_BEHAVIOR: Record<
  ToolName,
  { behavior: "BLOCKING" | "NON_BLOCKING"; scheduling?: "SILENT" | "WHEN_IDLE" | "INTERRUPT" }
> = {
  confirm_max: { behavior: "BLOCKING" },
  answer_can_move: { behavior: "BLOCKING" },
  mark_pain: { behavior: "BLOCKING" },
  set_limit_cause: { behavior: "BLOCKING" },
  stop: { behavior: "BLOCKING" },
  keep_reaching: { behavior: "NON_BLOCKING", scheduling: "SILENT" },
  repeat_instructions: { behavior: "NON_BLOCKING", scheduling: "WHEN_IDLE" },
  pause: { behavior: "NON_BLOCKING", scheduling: "WHEN_IDLE" },
  resume: { behavior: "NON_BLOCKING", scheduling: "WHEN_IDLE" },
  next_step: { behavior: "NON_BLOCKING", scheduling: "WHEN_IDLE" },
};

const TOOL_NAMES = Object.keys(TOOL_BEHAVIOR) as ToolName[];

/** True for the ten tool names of 2.11 (a model may call any name). */
export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && (TOOL_NAMES as string[]).includes(name);
}

/* ------------------------------------------------------- the unions */

const SIDES: readonly RomSide[] = ["left", "right", "none"];
const ANSWERS: readonly RomAnswer[] = ["yes", "not_yet", "hurts"];
const CAUSES: readonly LimitCause[] = ["tight", "pain", "weak"];
/** The stop options the coach may preselect (C-7): v1 StopOptionId without ad_signs. */
export const COACH_STOP_REASONS: readonly CoachStopReason[] = [
  "chest",
  "stroke_signs",
  "faint",
  "breath",
  "fall",
  "pain",
  "tired",
  "choice",
  "other",
];
/** The pain scale of mark_pain (C-15: whole numbers 0 to 10). */
export const PAIN_SCALE = { min: 0, max: 10 } as const;

/* ------------------------------------------------- the declarations */

type Schema =
  | { type: "STRING"; enum: string[]; description?: string }
  | { type: "BOOLEAN"; description?: string }
  | { type: "INTEGER"; minimum: number; maximum: number; description?: string };
interface Declaration {
  name: ToolName;
  description: string;
  behavior: "BLOCKING" | "NON_BLOCKING";
  parameters?: { type: "OBJECT"; properties: Record<string, Schema>; required: string[] };
}

const movement: Schema = {
  type: "STRING",
  enum: [...ROM_MOVEMENT_IDS],
  description: "The movement id of the event that opened the question (mv).",
};
const side: Schema = {
  type: "STRING",
  enum: [...SIDES],
  description: "The side of the event that opened the question.",
};

const DECLARATIONS: Record<ToolName, Omit<Declaration, "name" | "behavior">> = {
  confirm_max: {
    description:
      "Call right after the person answers the question «هل هذا أقصى ما تستطيع؟» (Is this as far as you can go?), " +
      "with their answer in their own words. yes: this is their maximum. not_yet: they will try a little further. " +
      "hurts: they could go further but it hurts. Never call it before an end_range_hold event, never answer for " +
      "the person, and never suggest pushing further after pain.",
    parameters: {
      type: "OBJECT",
      properties: {
        movement,
        side,
        answer: { type: "STRING", enum: [...ANSWERS], description: "yes, not_yet or hurts." },
      },
      required: ["movement", "side", "answer"],
    },
  },
  answer_can_move: {
    description:
      "Call after an ask_can_move event, once the person says in their own words whether they can move this " +
      "joint on their own today. canMove true: they can, even a little. canMove false: they cannot. Never call " +
      "it before they answer.",
    parameters: {
      type: "OBJECT",
      properties: { movement, side, canMove: { type: "BOOLEAN" } },
      required: ["movement", "side", "canMove"],
    },
  },
  keep_reaching: {
    description:
      "Call right after the person answered not_yet, while they try to reach a little further, then say only " +
      "the gentle keep going line. Never call it after hurts, after any pain, or after a maximum was recorded.",
  },
  mark_pain: {
    description:
      "Call whenever the person tells you in their own words about pain, with the level from 0 to 10 they give " +
      "(0 no pain, 10 the worst pain they can imagine). sharp: true when they describe a sudden sharp pain. " +
      "location: only when they name the part of the body. When they give no number, ask for one first; never " +
      "guess it. The app decides what happens next; say what it decided.",
    parameters: {
      type: "OBJECT",
      properties: {
        level: { type: "INTEGER", minimum: PAIN_SCALE.min, maximum: PAIN_SCALE.max },
        sharp: { type: "BOOLEAN" },
        location: { type: "STRING", enum: [...REGION_IDS] },
      },
      required: ["level"],
    },
  },
  set_limit_cause: {
    description:
      "Call after an ask_cause event, once the person says in their own words what stopped them most: tight " +
      "(tightness or stiffness), pain, or weak (weakness or heaviness). Never call it before they answer.",
    parameters: {
      type: "OBJECT",
      properties: { cause: { type: "STRING", enum: [...CAUSES] } },
      required: ["cause"],
    },
  },
  pause: {
    description:
      "Call when the person asks to pause or to rest for a moment during a measurement, a walk, an exercise or " +
      "a rest timer. The app pauses and the person or you can continue later.",
  },
  resume: {
    description:
      "Call when the person asks to continue after a pause that you made. Never call it after a safety stop, " +
      "and never for a pause made on the screen: that one continues from the screen.",
  },
  stop: {
    description:
      "Call when the person wants to stop, or tells you about chest pain, signs of a stroke, fainting, severe " +
      "breathlessness or a fall. reason: chest, stroke_signs, faint, breath, fall, pain, tired, choice (they " +
      "simply want to stop) or other. The screen then opens the stop list with that option first, and the " +
      "person confirms it there; tell them to follow the screen.",
    parameters: {
      type: "OBJECT",
      properties: { reason: { type: "STRING", enum: [...COACH_STOP_REASONS] } },
      required: ["reason"],
    },
  },
  next_step: {
    description:
      "Call right after the person says in their own words that they are ready, want to start, go on, see " +
      "the next step or try again, for example «جاهز», «يلا», «ابدأ», «التالي», «كمّل», «مرة ثانية», " +
      "I am ready, let's go, start, next, continue, again. intent: what they said (ready, start, next, " +
      "continue or again). The app presses the matching button on the screen for them and answers what it " +
      "did; say it in a few words, for example starting now. Never call it on your own or because you " +
      "think they are ready, and never for a question, a pain score, a stop or a safety screen: those stay " +
      "theirs to answer or tap.",
    parameters: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          enum: [...COACH_INTENTS],
          description: "ready, start, next, continue or again, as the person said it.",
        },
      },
      required: ["intent"],
    },
  },
  repeat_instructions: {
    description:
      "Call when the person asks to hear the instructions again. The app shows them on the screen and returns " +
      "their text; say them briefly in your own words.",
  },
};

/** REST shaped FunctionDeclaration objects (name, description, behavior, parameters with type OBJECT, enums), built from the unions above. */
export function toolDeclarations(block: CoachBlock): object[] {
  return TOOL_SETS[block].map((name): Declaration => {
    const d = DECLARATIONS[name];
    return {
      name,
      description: d.description,
      behavior: TOOL_BEHAVIOR[name].behavior,
      ...(d.parameters ? { parameters: structuredClone(d.parameters) } : {}),
    };
  });
}

/* ------------------------------------------------------- the parser */

type Raw = Record<string, unknown>;
const isPlain = (v: unknown): v is Raw =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keysWithin = (v: Raw, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** The arguments of one call, or null. Unknown keys, wrong enums and out of range values give null. */
function parse(name: ToolName, raw: unknown): ToolArgs[ToolName] | null {
  switch (name) {
    case "keep_reaching":
    case "pause":
    case "resume":
    case "repeat_instructions":
      // A call without parameters may arrive with no args at all.
      if (raw === undefined || raw === null) return {};
      return isPlain(raw) && Object.keys(raw).length === 0 ? {} : null;
    case "next_step": {
      // A call without its intent (an older habit of the model) is read as next.
      if (raw === undefined || raw === null) return { intent: "next" };
      if (!isPlain(raw) || !keysWithin(raw, ["intent"])) return null;
      if (raw.intent === undefined) return { intent: "next" };
      return oneOf<CoachIntent>(raw.intent, COACH_INTENTS) ? { intent: raw.intent } : null;
    }
    case "confirm_max": {
      if (!isPlain(raw) || !keysWithin(raw, ["movement", "side", "answer"])) return null;
      const { movement, side, answer } = raw;
      if (!oneOf<RomMovementId>(movement, ROM_MOVEMENT_IDS) || !oneOf(side, SIDES) || !oneOf(answer, ANSWERS))
        return null;
      return { movement, side, answer };
    }
    case "answer_can_move": {
      if (!isPlain(raw) || !keysWithin(raw, ["movement", "side", "canMove"])) return null;
      const { movement, side, canMove } = raw;
      if (
        !oneOf<RomMovementId>(movement, ROM_MOVEMENT_IDS) ||
        !oneOf(side, SIDES) ||
        typeof canMove !== "boolean"
      )
        return null;
      return { movement, side, canMove };
    }
    case "mark_pain": {
      if (!isPlain(raw) || !keysWithin(raw, ["level", "sharp", "location"])) return null;
      const { level, sharp, location } = raw;
      if (
        typeof level !== "number" ||
        !Number.isInteger(level) ||
        level < PAIN_SCALE.min ||
        level > PAIN_SCALE.max
      )
        return null;
      if (sharp !== undefined && typeof sharp !== "boolean") return null;
      if (location !== undefined && !oneOf<RegionId>(location, REGION_IDS)) return null;
      return {
        level,
        ...(sharp !== undefined ? { sharp } : {}),
        ...(location !== undefined ? { location } : {}),
      };
    }
    case "set_limit_cause": {
      if (!isPlain(raw) || !keysWithin(raw, ["cause"]) || !oneOf(raw.cause, CAUSES)) return null;
      return { cause: raw.cause };
    }
    case "stop": {
      if (!isPlain(raw) || !keysWithin(raw, ["reason"]) || !oneOf(raw.reason, COACH_STOP_REASONS))
        return null;
      return { reason: raw.reason };
    }
  }
}

/** Strict: unknown keys, wrong enums, non integer pain or out of range values give { ok: false }. */
export function parseToolArgs<N extends ToolName>(
  name: N,
  raw: unknown,
): { ok: true; args: ToolArgs[N] } | { ok: false } {
  if (!isToolName(name)) return { ok: false };
  const args = parse(name, raw);
  return args === null ? { ok: false } : { ok: true, args: args as ToolArgs[N] };
}

/* ------------------------------------------------ the answer guard */

/** The answer tools of S0-2 and the question event that opens each one. */
const OPENED_BY = {
  confirm_max: "end_range_hold",
  answer_can_move: "ask_can_move",
  set_limit_cause: "ask_cause",
} as const;
type GuardedQuestion = (typeof OPENED_BY)[keyof typeof OPENED_BY] | "ask_pain";

/** S0-2: mark_pain is taken only within this long of the person's last speech. */
export const PAIN_SPEECH_WINDOW_MS = 10_000;
/** D-036 item 2: next_step presses a button only within this long of the person's speech. */
export const PRESS_SPEECH_WINDOW_MS = 10_000;
/** The copy key of a refused answer tool: ask once more and wait for the person (D-022 item 2). */
export const ANSWER_GUARD_SAY = "ask_and_wait";

/**
 * D-022 item 2 (S0-2). The model sometimes asks its question and then calls the answer tool itself,
 * before the person says anything (8 of 133 questions, live-spike.md 4). So confirm_max,
 * answer_can_move and set_limit_cause are taken only when the person's speech (an input
 * transcription with text) arrived after the question that opened them, and mark_pain only when it
 * arrived in the last 10 s; otherwise the call is refused no_answer_heard with say ask_and_wait.
 * stop is always taken (it only preselects; the person confirms), as are pause, resume and
 * repeat_instructions.
 *
 * The pain question is guarded too (wave 2 fix of D-022 item 2): mark_pain also answers the P1
 * ask_pain (the pain question after «it hurts», and the same joint re-ask), so while a pain question
 * is open with no speech after it, a mark_pain is refused, whatever was said before it (that speech
 * answered the question before). The 10 s window stays for a spontaneous report. A pain of 6 or more,
 * or a sharp pain, is always taken: it can only stop (C-15).
 *
 * next_step presses a button on the screen for the person (D-036 item 2), so it is guarded the same
 * way: with a button on the screen, it is taken only when the person spoke while that screen was
 * already showing (its id in the host's ScreenActions, `screen`), in the last 10 s; otherwise
 * no_answer_heard with ask_and_wait. Speech on an earlier screen never presses the next one's button,
 * so a second call after a press, or the model on its own, presses nothing. With no button on the
 * screen the call goes on, and the host answers that there is nothing to press.
 *
 * A call with no question of its kind open goes on to the host, which refuses it on its phase (an
 * early confirm_max is wrong_phase with hold_still, 2.11). Times are milliseconds on the clock of
 * BridgeEvent.t. One guard per Live session; the executor feeds it every P1 event it pushes
 * (whoever voices the question, the coach or the local pack) and every input transcription.
 */
export class AnswerGuard {
  private opened: Partial<Record<GuardedQuestion, number>> = {};
  private lastSpeech = -Infinity;
  /** The screen showing when the person last spoke (ScreenActions.current), or null. */
  private spokeOn: number | null = null;

  /** `screen`: the id of the screen showing now with its buttons (the host's ScreenActions.current). */
  constructor(private readonly screen: () => number | null = () => null) {}

  /** A question event was pushed: the answer tools it opens need speech after it. */
  question(e: BridgeEvent): void {
    if (
      e.type === "end_range_hold" ||
      e.type === "ask_can_move" ||
      e.type === "ask_cause" ||
      e.type === "ask_pain"
    )
      this.opened[e.type] = e.t;
  }

  /** An input transcription arrived; only text counts as speech. */
  heard(text: string, now: number): void {
    if (text.trim().length === 0) return;
    this.lastSpeech = Math.max(this.lastSpeech, now);
    this.spokeOn = this.screenNow();
  }

  private screenNow(): number | null {
    try {
      return this.screen();
    } catch {
      return null;
    }
  }

  /** Null when the call may go on to the host; else the refusal to send back. */
  check(name: ToolName, now: number, args?: ToolArgs[ToolName]): ToolResult | null {
    const refused: ToolResult = { accepted: false, reason: "no_answer_heard", say: ANSWER_GUARD_SAY };
    if (name === "next_step") {
      // No button on the screen: the host answers that there is nothing to press.
      const on = this.screenNow();
      if (on === null) return null;
      return this.spokeOn === on && now - this.lastSpeech <= PRESS_SPEECH_WINDOW_MS ? null : refused;
    }
    if (name === "mark_pain") {
      const a = args as ToolArgs["mark_pain"] | undefined;
      // A pain that stops (6 or more, or sharp) is always taken: it can only stop the movement.
      if (a && (a.level >= PAIN_STOP.atOrAbove || a.sharp === true)) return null;
      // An open pain question needs the person's speech after it.
      const asked = this.opened.ask_pain;
      if (asked !== undefined && this.lastSpeech <= asked) return refused;
      return now - this.lastSpeech <= PAIN_SPEECH_WINDOW_MS ? null : refused;
    }
    if (name !== "confirm_max" && name !== "answer_can_move" && name !== "set_limit_cause") return null;
    const openedAt = this.opened[OPENED_BY[name]];
    if (openedAt === undefined) return null;
    return this.lastSpeech > openedAt ? null : refused;
  }
}

/* ------------------------------------------------ before the host */

/**
 * The checks a tool call passes before a host sees it, in order: a known tool (unknown_tool), one of
 * the block's tools (not_in_block), strict arguments (invalid_args), then the answer guard
 * (no_answer_heard, also for next_step's press). The executor sends a refusal back at once; a call that passes goes to
 * host.handleTool, which validates it against the engine state (C-17).
 */
export function screenToolCall(
  block: CoachBlock,
  call: { name: string; args: unknown },
  guard: AnswerGuard,
  now: number,
): { ok: true; name: ToolName; args: ToolArgs[ToolName] } | { ok: false; result: ToolResult } {
  if (!isToolName(call.name)) return { ok: false, result: { accepted: false, reason: "unknown_tool" } };
  const name = call.name;
  if (!TOOL_SETS[block].includes(name))
    return { ok: false, result: { accepted: false, reason: "not_in_block" } };
  const parsed = parseToolArgs(name, call.args);
  if (!parsed.ok) return { ok: false, result: { accepted: false, reason: "invalid_args" } };
  const refused = guard.check(name, now, parsed.args);
  if (refused) return { ok: false, result: refused };
  return { ok: true, name, args: parsed.args };
}
