/**
 * The coach's connection test (D-035 item 4, /?coachlab=1): what POST /api/agent/lab-token mints. A
 * one minute Live session with no tools and no person's data, whose only job is to say «هل تسمعني؟»
 * when the page asks and to answer in one short sentence, so the page can time each stage of the
 * connection on a real phone. It is budgeted like any segment (a row in agent_sessions, block session,
 * segment lab, a ref of its own per run), and its usage report and failure land on that row; it is
 * never counted as a coach fallback of the product.
 */
import type { HistoryTurn } from "../../../src/coach/instruction";
import type { Lang } from "../../../src/movements/types";

/** The lab's segment name on its agent_sessions row. */
export const LAB_SEGMENT = "lab";
/** The lab's instruction version on its row. */
export const LAB_SI_VERSION = "lab_1";
/** A lab run's minutes: its token's life is these plus the window and the margin (token.ts). */
export const LAB_MINUTES = 1;
/** What the page sends to have the coach ask its question (a context line, turnComplete true). */
export const LAB_ASK = "[LAB ask]";
/** The question, as the instruction asks the model to say it. */
export const LAB_QUESTION: Record<Lang, string> = { ar: "هل تسمعني؟", en: "Can you hear me?" };

/** The lab's ref: one per run, so every run is its own row. */
export const labRef = (id: string) => `lab:${id}`;
export const isLabRef = (ref: string) => ref.startsWith("lab:");

/** The lab's system instruction: the question on the page's cue, one short answer, nothing else. */
export function labInstruction(lang: Lang): string {
  const language = lang === "ar" ? "simple Saudi Arabic" : "simple English";
  const reply = lang === "ar" ? "نعم، أسمعك بوضوح." : "Yes, I can hear you clearly.";
  return [
    "You are the voice of the Azm app's connection test. This is not a coaching session.",
    `Speak only ${language}, in a calm and warm voice.`,
    `When you receive ${LAB_ASK}, say exactly «${LAB_QUESTION[lang]}» and nothing else, then wait.`,
    `When the person answers, reply with one short sentence that you heard them, such as «${reply}», then stay silent.`,
    "Never give advice of any kind, never ask anything else, and never talk about health.",
  ].join("\n");
}

/** The opening history: the client sends it first (initialHistoryInClientContent). */
export function labHistory(lang: Lang): HistoryTurn[] {
  return [
    { role: "user", text: `[CTX lab lang=${lang}]` },
    { role: "model", text: lang === "ar" ? "جاهز." : "Ready." },
  ];
}
