/**
 * Stream D, step D3: the coach's captions (product v7 contract 2.11 CoachState.captions) with the
 * S0-6 filter of D-022 item 6 (live-spike.md 6): the transport passes only output transcription that
 * came with audio (d-transport.test.ts); here a piece in a script other than the session language is
 * dropped, a turn's caption is capped at its audio length times 25 characters a second, and the
 * caption resets on interrupted (the next caption once began with a leftover of the cut sentence).
 */
import { describe, expect, it } from "vitest";
import {
  CAPTION_CHARS_PER_SECOND,
  CaptionFilter,
  PCM24K_BYTES_PER_SECOND,
  inSessionScript,
} from "../../src/features/coach-agent/captions";

const SECOND = PCM24K_BYTES_PER_SECOND;

describe("the script of a caption piece", () => {
  it("keeps Latin text in English and drops any other script", () => {
    expect(inSessionScript("Is this as far as you can go?", "en")).toBe(true);
    expect(inSessionScript("About 120 degrees.", "en")).toBe(true);
    expect(inSessionScript("プロジェクターの選び方", "en")).toBe(false);
    expect(inSessionScript("以下哪项是正确的", "en")).toBe(false);
    expect(inSessionScript("Привет", "en")).toBe(false);
    expect(inSessionScript("안녕하세요", "en")).toBe(false);
    expect(inSessionScript("Rest, then نعم", "en")).toBe(false);
  });

  it("keeps Arabic text in Arabic, with a Latin word inside it, and drops the rest", () => {
    expect(inSessionScript("هل هذا أقصى ما تستطيع؟", "ar")).toBe(true);
    expect(inSessionScript("حوالي 120 درجة", "ar")).toBe(true);
    expect(inSessionScript("سجلنا القيمة في تطبيق Azm الآن", "ar")).toBe(true);
    expect(inSessionScript("def main(): return value", "ar")).toBe(false);
    expect(inSessionScript("以下哪项", "ar")).toBe(false);
    expect(inSessionScript("نعم 以下", "ar")).toBe(false);
  });

  it("keeps a piece without letters", () => {
    expect(inSessionScript("120.", "en")).toBe(true);
    expect(inSessionScript("، ", "ar")).toBe(true);
  });
});

describe("CaptionFilter", () => {
  it("builds the coach's line from the pieces that came with audio, within 25 characters a second", () => {
    const f = new CaptionFilter("en");
    f.audio(SECOND);
    f.coachText("Is this as far ");
    f.coachText("as you can go? Take your time and answer when ready.");
    // One second of audio holds at most 25 characters, cut at a word end.
    expect(CAPTION_CHARS_PER_SECOND).toBe(25);
    expect(f.list()).toEqual([{ who: "coach", text: "Is this as far as you can" }]);
    // More audio shows more of the held words.
    f.audio(SECOND);
    expect(f.list()).toEqual([{ who: "coach", text: "Is this as far as you can go? Take your time and" }]);
    f.audio(SECOND);
    expect(f.list()).toEqual([
      { who: "coach", text: "Is this as far as you can go? Take your time and answer when ready." },
    ]);
  });

  it("never shows a long piece beyond its audio, however it is cut", () => {
    const f = new CaptionFilter("en");
    f.audio(SECOND / 10);
    f.coachText("Supercalifragilistic");
    expect(f.list()).toEqual([{ who: "coach", text: "Su" }]);
  });

  it("drops a piece in another script and keeps the line it was added to", () => {
    const f = new CaptionFilter("en");
    f.audio(2 * SECOND);
    f.coachText("That's recorded.");
    f.coachText("プロジェクターの選び方について説明します");
    expect(f.list()).toEqual([{ who: "coach", text: "That's recorded." }]);
  });

  it("resets on interrupted and drops the leftovers of the cut sentence until new audio", () => {
    const f = new CaptionFilter("ar");
    f.audio(SECOND);
    f.coachText("ارفع ذراعك ببطء");
    f.interrupted();
    expect(f.list()).toEqual([]);
    f.coachText("بلطف والتحكم");
    expect(f.list()).toEqual([]);
    f.audio(SECOND);
    f.coachText("توقف الآن");
    expect(f.list()).toEqual([{ who: "coach", text: "توقف الآن" }]);
  });

  it("keeps the person's words beside the coach's, a finished turn as its own line", () => {
    const f = new CaptionFilter("ar");
    f.audio(SECOND);
    f.coachText("هل هذا أقصى ما تستطيع؟");
    f.turnComplete();
    f.personText("نعم", false);
    f.personText(" هذا أقصى شي", true);
    expect(f.list()).toEqual([
      { who: "coach", text: "هل هذا أقصى ما تستطيع؟" },
      { who: "person", text: "نعم هذا أقصى شي" },
    ]);
    f.audio(SECOND);
    f.coachText("سجلنا ذلك");
    expect(f.list().at(-1)).toEqual({ who: "coach", text: "سجلنا ذلك" });
  });

  it("holds the last four lines only, and never an empty one", () => {
    const f = new CaptionFilter("en");
    for (let i = 0; i < 6; i++) {
      f.audio(SECOND);
      f.coachText(`line ${i}`);
      f.turnComplete();
    }
    f.turnComplete();
    expect(f.list().map((c) => c.text)).toEqual(["line 2", "line 3", "line 4", "line 5"]);
    f.personText("   ", false);
    expect(f.list()).toHaveLength(4);
  });
});
