/**
 * The coach's captions (product v7 contract 2.11 CoachState.captions, stream D, step D3) with the
 * S0-6 filter of D-022 item 6. In 6 of 25 English spike sessions the output transcription ended with a
 * long text that was never spoken (a Japanese article, Chinese exam items, code), and after a cut
 * sentence the next caption began with its leftover (live-spike.md 6). So:
 *   1. the transport passes only output transcription that arrives in a message carrying audio;
 *   2. a piece in a script other than the session language is dropped (a Latin word inside an Arabic
 *      sentence is kept);
 *   3. a turn's caption is capped at its audio length times 25 characters a second, cut at a word end;
 *   4. interrupted removes the cut turn, and pieces that arrive before the next audio are dropped.
 * Captions are for display only (live.md 10); nothing here is stored or sent. Pure, no DOM.
 */
import type { Lang } from "../../movements/types";

/** S0-6: a turn shows at most this many characters per second of its audio. */
export const CAPTION_CHARS_PER_SECOND = 25;
/** The coach's audio: 24 kHz, 16 bit, mono. */
export const PCM24K_BYTES_PER_SECOND = 24_000 * 2;
/** The lines the screen can show (the last exchange or two). */
export const CAPTION_LINES = 4;

export interface Caption {
  who: "coach" | "person";
  text: string;
}

const LETTER = /\p{L}/gu;
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * True when a piece is in the session's script: every letter Latin in English; in Arabic every
 * letter Arabic or Latin, with the Arabic letters at least half of them. A piece without letters
 * (a number, punctuation) is kept.
 */
export function inSessionScript(text: string, lang: Lang): boolean {
  const letters = text.match(LETTER) ?? [];
  if (letters.length === 0) return true;
  if (lang === "en") return letters.every((c) => LATIN.test(c));
  let arabic = 0;
  for (const c of letters) {
    if (ARABIC.test(c)) arabic++;
    else if (!LATIN.test(c)) return false;
  }
  return arabic * 2 >= letters.length;
}

/** At most `max` characters, cut back to the last word end when the cut falls inside a word. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text.trim();
  const head = text.slice(0, Math.max(0, max));
  if (/\s/.test(text.charAt(max))) return head.trim();
  const space = head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : head).trim();
}

interface Entry {
  who: "coach" | "person";
  text: string;
  /** The coach turn's audio so far, in seconds. */
  audioSec: number;
}

export class CaptionFilter {
  private entries: Entry[] = [];
  private coach: Entry | null = null;
  private person: Entry | null = null;
  /** After interrupted: the cut sentence's leftovers are dropped until new audio arrives. */
  private skip = false;

  constructor(private readonly lang: Lang) {}

  /** Coach audio of the current turn (it opens the turn). */
  audio(bytes: number): void {
    this.skip = false;
    if (!this.coach) {
      this.person = null;
      this.coach = this.add({ who: "coach", text: "", audioSec: 0 });
    }
    this.coach.audioSec += bytes / PCM24K_BYTES_PER_SECOND;
  }

  /** A piece of the coach's output transcription (the transport passes only pieces with audio). */
  coachText(text: string): void {
    if (this.skip || !this.coach || !text || !inSessionScript(text, this.lang)) return;
    this.coach.text += text;
  }

  /** A piece of the person's transcription; final closes their line. */
  personText(text: string, final: boolean): void {
    if (!this.person) this.person = this.add({ who: "person", text: "", audioSec: 0 });
    this.person.text += text;
    if (final) this.person = null;
  }

  /** The person cut in: the cut turn goes, and its leftovers are dropped until new audio. */
  interrupted(): void {
    if (this.coach) this.entries = this.entries.filter((e) => e !== this.coach);
    this.coach = null;
    this.skip = true;
  }

  /** The coach's turn ended. */
  turnComplete(): void {
    this.coach = null;
  }

  /** The lines to show, oldest first. */
  list(): Caption[] {
    return this.entries
      .map((e) => ({
        who: e.who,
        text:
          e.who === "coach" ? cut(e.text, Math.floor(e.audioSec * CAPTION_CHARS_PER_SECOND)) : e.text.trim(),
      }))
      .filter((c) => c.text.length > 0)
      .slice(-CAPTION_LINES);
  }

  private add(e: Entry): Entry {
    this.entries.push(e);
    // Older lines are never shown again.
    if (this.entries.length > 2 * CAPTION_LINES) {
      const keep = this.entries.slice(-2 * CAPTION_LINES);
      this.entries = keep;
    }
    return e;
  }
}
