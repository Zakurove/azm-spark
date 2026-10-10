/**
 * Stream D, step D1: the coach's system instruction and opening history (product v7 contract 5.3,
 * C-6, C-12). The instruction is built on the server and locked in the token; the history is built on
 * the server from stored state and sent first by the client. Tests: one snapshot per block and
 * language (the text Nasser reviews), the dose rules (5.3 item 3) and the stop reasons (item 6) in
 * both languages, the Arabic answer list of S0-4 (D-022 item 4), the wording rules, and a history
 * that holds only the data C-12 lists.
 */
import { describe, expect, it } from "vitest";
import {
  COACH_SI_VERSION,
  buildHistory,
  buildInstruction,
  type HistoryInput,
  type InstructionInput,
} from "../../src/coach/instruction";
import { TOOL_SETS } from "../../src/coach/tools";
import type { CoachBlock, ToolName } from "../../src/coach/types";
import { movementDef, romCopy } from "../../src/movements/rom";
import { libraryById } from "../../src/medical/pool";
import { EXERCISES } from "../../src/exercises/defs";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const BLOCKS: CoachBlock[] = ["rom", "gait", "session"];
const LANGS = ["ar", "en"] as const;
const ALL_TOOLS: ToolName[] = [...TOOL_SETS.rom];

/** The input each block's snapshot uses: a seated range block, a walk with a helper, a workout. */
function inputFor(block: CoachBlock, lang: "ar" | "en"): InstructionInput {
  if (block === "rom") return { lang, block, position: "seated", helperPresent: false };
  if (block === "gait") return { lang, block, position: "walking", helperPresent: true };
  return { lang, block, position: null, helperPresent: false };
}

describe("buildInstruction", () => {
  it("is version coach_si_3 (D-036: the coach presses the screen's buttons on the person's words)", () => {
    expect(COACH_SI_VERSION).toBe("coach_si_3");
  });

  it("records a pain number at once and asks where at most once, afterwards (D-030 D5-9)", () => {
    // The smoke run (qa/v7/coach-smoke.md, run 1): the coach asked where the pain was, twice, before it
    // marked a pain of 7, about 70 s late.
    for (const block of BLOCKS)
      for (const lang of LANGS) {
        const si = buildInstruction(inputFor(block, lang));
        expect(si, `${block} ${lang}`).toContain(
          "When the person gives a pain number, call mark_pain with it at once, before any other question.",
        );
        expect(si, `${block} ${lang}`).toContain(
          "Ask where it hurts at most once, and only after the app has answered; never wait for the place to call mark_pain.",
        );
      }
  });

  for (const block of BLOCKS)
    for (const lang of LANGS)
      it(`matches the reviewed text for ${block} in ${lang}`, async () => {
        await expect(buildInstruction(inputFor(block, lang))).toMatchFileSnapshot(
          `./__snapshots__/coach-si/${block}.${lang}.txt`,
        );
      });

  it("never says the phone films or records: the camera watches, and no video is recorded or sent", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS) {
        const si = buildInstruction(inputFor(block, lang));
        expect(si, `${block} ${lang}`).not.toMatch(
          /\bfilms?\b|\bfilming\b|\brecords? (the|their|your) (walk|movement)/i,
        );
      }
    expect(buildInstruction(inputFor("gait", "ar"))).toContain("no video is recorded or sent");
  });

  it("states the dose rules of 5.3 item 3 in every block and both languages", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS) {
        const si = buildInstruction(inputFor(block, lang));
        for (const rule of [
          "The plan sets the dose.",
          "Never change or suggest changing the sets, repetitions, holds, rest, the walking pad speed or any load.",
          'Never say "just a few more", and never invite extra repetitions.',
          "Never suggest an exercise that is not on the screen, and never suggest skipping one.",
          "Never encourage skipping rest or continuing after a stop.",
          "their plan sets it and that they can ask their care team",
        ])
          expect(si, `${block} ${lang}: ${rule}`).toContain(rule);
      }
  });

  it("names every stop reason of 5.3 item 6 and the screen in every block and both languages", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS) {
        const si = buildInstruction(inputFor(block, lang));
        expect(si).toContain(
          "call stop at once with the matching reason (chest, faint, breath, fall, stroke_signs) and tell them to follow the screen",
        );
        expect(si).toContain("Off topic or medical questions: a short, kind redirect to their care team.");
      }
  });

  it("keeps the persona, the language and the condition wording of 5.3 items 1 and 2", () => {
    for (const block of BLOCKS) {
      const ar = buildInstruction(inputFor(block, "ar"));
      const en = buildInstruction(inputFor(block, "en"));
      expect(ar).toContain("YOU MUST RESPOND UNMISTAKABLY IN ARABIC.");
      expect(ar).toContain("«حالتك الطبية»");
      expect(en).toContain("Respond in English.");
      expect(en).toContain('"your medical condition"');
      for (const si of [ar, en]) {
        expect(si).toContain("one or two short sentences per turn, always under 100 words");
        expect(si).toContain("Never diagnose, treat, prescribe or give medical advice.");
        expect(si).toContain("Never narrate repetition counts.");
        expect(si).toContain("Lines that start with [EVT come from the app's sensors, not from the person.");
      }
    }
  });

  it("passes the wording rules as written: no dash, no hyphenated word, never the other condition phrase", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS)
        for (const position of ["seated", "standing", "lying", "walking", null] as const)
          for (const helperPresent of [true, false]) {
            const si = buildInstruction({ lang, block, position, helperPresent });
            expect(wordingProblems(si), `${block} ${lang} ${position} ${helperPresent}`).toEqual([]);
          }
  });

  it("puts the Arabic answer list of S0-4 in the Arabic range block only", () => {
    const ar = buildInstruction(inputFor("rom", "ar"));
    expect(ar).toContain("A short reply that sounds like na'am is the Arabic word «نعم» (yes)");
    expect(ar).toContain("«هذا أقصى شي»");
    expect(ar).toContain("«أقدر أكثر»");
    expect(ar).toContain("«لا أقدر أكثر»");
    expect(ar).toContain("call no tool until the answer is clear");
    expect(buildInstruction(inputFor("rom", "en"))).not.toContain("na'am");
    // The other blocks keep the general Arabic answers (pain, stop) without the range questions.
    const gait = buildInstruction(inputFor("gait", "ar"));
    expect(gait).toContain("«نعم»");
    expect(gait).not.toContain("«هذا أقصى شي»");
  });

  it("asks the maximum question from the data and names its two answers (D-022 item 4)", () => {
    const ar = buildInstruction(inputFor("rom", "ar"));
    const en = buildInstruction(inputFor("rom", "en"));
    expect(ar).toContain(`«${romCopy("ask_max").ar} قل: هذا أقصى شي، أو: أقدر أكثر.»`);
    expect(en).toContain(`"${romCopy("ask_max").en} Say: this is my max, or: I can go further."`);
    // The other range questions and the only end range line come from the data too.
    for (const key of ["can_move_ask", "pain_ask", "what_stopped_ask", "keep_going"] as const) {
      expect(ar, key).toContain(romCopy(key).ar);
      expect(en, key).toContain(romCopy(key).en);
    }
  });

  it("names only the block's own tools", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS) {
        const si = buildInstruction(inputFor(block, lang));
        for (const tool of ALL_TOOLS) {
          const named = new RegExp(`\\b${tool}\\b`).test(si);
          if (!TOOL_SETS[block].includes(tool)) expect(named, `${block} ${lang} ${tool}`).toBe(false);
        }
        for (const tool of ["mark_pain", "stop"]) expect(si).toContain(tool);
      }
    const rom = buildInstruction(inputFor("rom", "en"));
    for (const tool of ["confirm_max", "answer_can_move", "set_limit_cause", "keep_reaching", "next_step"])
      expect(rom).toContain(tool);
  });

  it("says where the person is and whether a helper is with them, from stored state only", () => {
    const line = (position: InstructionInput["position"], helperPresent = false) =>
      buildInstruction({ lang: "en", block: "rom", position, helperPresent });
    expect(line("seated")).toContain("The person is seated for this part.");
    expect(line("standing")).toContain(
      "The person stands for this part, with a steady support within reach.",
    );
    expect(line("lying")).toContain("The person lies on their back for this part.");
    expect(line("lying")).toContain(romCopy("sit_before_stand").en);
    expect(line("seated", true)).toContain("A helper is with the person.");
    expect(line("seated", false)).not.toContain("helper");
    const session = buildInstruction({ lang: "en", block: "session", position: null, helperPresent: false });
    expect(session).not.toMatch(/The person (is seated|stands|lies)/);
  });

  it("stays short enough to be sent on every turn", () => {
    for (const block of BLOCKS)
      for (const lang of LANGS) expect(buildInstruction(inputFor(block, lang)).length).toBeLessThan(9000);
  });
});

describe("buildHistory", () => {
  const rom: HistoryInput = {
    block: "rom",
    lang: "en",
    segment: "rom:seated:1",
    helperPresent: false,
    items: [
      { movement: "shoulder_flexion", side: "right", position: "seated", typical: 166 },
      { movement: "elbow_flexion", side: "right", position: "seated", typical: null },
      { movement: "neck_lateral_flexion", side: "left", position: "seated", typical: 43 },
    ],
  };

  it("never returns an empty list, and opens with the app's context and ends with the coach (S0, 1)", () => {
    for (const input of [rom, { ...rom, items: [] }]) {
      const h = buildHistory(input);
      expect(h.length).toBe(2);
      expect(h[0].role).toBe("user");
      expect(h[0].text.startsWith("[CTX block=rom segment=rom:seated:1 lang=en helper=no]")).toBe(true);
      expect(h[1]).toEqual({ role: "model", text: "Ready." });
    }
    expect(buildHistory({ ...rom, lang: "ar" })[1]).toEqual({ role: "model", text: "جاهز." });
  });

  it("lists a range segment's items with ids, names, sides, positions and typical values to 5 degrees", () => {
    expect(buildHistory(rom)[0].text.split("\n")).toEqual([
      "[CTX block=rom segment=rom:seated:1 lang=en helper=no]",
      `[CTX item=1 mv=shoulder_flexion name="${movementDef("shoulder_flexion").name.en}" side=right position=seated typical=165]`,
      `[CTX item=2 mv=elbow_flexion name="${movementDef("elbow_flexion").name.en}" side=right position=seated typical=none]`,
      `[CTX item=3 mv=neck_lateral_flexion name="${movementDef("neck_lateral_flexion").name.en}" side=left position=seated typical=45]`,
    ]);
    expect(buildHistory({ ...rom, lang: "ar", helperPresent: true })[0].text).toContain(
      `[CTX item=1 mv=shoulder_flexion name="${movementDef("shoulder_flexion").name.ar}" side=right`,
    );
    expect(buildHistory({ ...rom, helperPresent: true })[0].text).toContain("helper=yes");
  });

  it("describes a walk by its modes, views, aid and helper only", () => {
    const text = buildHistory({
      block: "gait",
      lang: "en",
      segment: "gait",
      modes: ["overground", "walking_pad"],
      views: { overground: ["side", "front"], walking_pad: ["pad_side", "pad_front"] },
      aid: "cane",
      helperPresent: true,
    })[0].text;
    expect(text).toBe(
      "[CTX block=gait segment=gait lang=en modes=overground,walking_pad overground_views=side,front walking_pad_views=pad_side,pad_front aid=cane helper=yes]",
    );
  });

  it("lists a workout part's exercises with their dose and the name the screen shows", () => {
    // A camera movement shows the camera exercise's name; a card shows the library's.
    const camera = EXERCISES.find((e) => e.id === "sit_to_stand")!;
    const card = libraryById("shoulder_stretch")!;
    const session = (lang: "ar" | "en") =>
      buildHistory({
        block: "session",
        lang,
        segment: "session:2",
        exercises: [
          { exerciseId: camera.id, sets: 2, reps: 10, restSeconds: 60 },
          { exerciseId: card.id, sets: 1, holdSeconds: 20, restSeconds: 45 },
          { exerciseId: "no_such_exercise", sets: 1, reps: 8, restSeconds: 30 },
        ],
      })[0].text.split("\n");
    expect(session("en")).toEqual([
      "[CTX block=session segment=session:2 lang=en]",
      `[CTX ex=1 id=sit_to_stand name="${camera.name.en}" sets=2 reps=10 rest=60]`,
      `[CTX ex=2 id=shoulder_stretch name="${card.name.en}" sets=1 hold=20 rest=45]`,
      "[CTX ex=3 id=no_such_exercise sets=1 reps=8 rest=30]",
    ]);
    expect(session("ar")[1]).toBe(
      `[CTX ex=1 id=sit_to_stand name="${camera.name.ar}" sets=2 reps=10 rest=60]`,
    );
  });

  it("carries none of the extra fields a caller might pass (C-12)", () => {
    const extra = {
      region: "shoulder",
      normId: "secret_norm",
      why: { ar: "سبب خاص", en: "PRIVATE WHY LINE" },
      note: { ar: "ملاحظة", en: "PRIVATE NOTE" },
      reason: "PRIVATE REASON",
      name: "Fahad Private",
    };
    const text = [
      buildHistory({ ...rom, items: rom.items.map((i) => ({ ...i, ...extra })) } as HistoryInput),
      buildHistory({
        block: "session",
        lang: "en",
        segment: "session:1",
        exercises: [{ exerciseId: "seated_shoulder_press", sets: 2, reps: 10, restSeconds: 60, ...extra }],
      } as HistoryInput),
    ]
      .flat()
      .map((t) => t.text)
      .join("\n");
    for (const v of ["secret_norm", "PRIVATE", "سبب خاص", "ملاحظة", "Fahad", "region"])
      expect(text, v).not.toContain(v);
  });
});
