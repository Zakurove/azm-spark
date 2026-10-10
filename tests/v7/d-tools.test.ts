/**
 * Stream D, step D1: the coach's tools (product v7 contract 2.11, C-7): the tool set of each block,
 * their behaviour, the REST shaped declarations the token locks in (5.1), the strict argument parser,
 * and the checks a call passes before a host sees it, with the S0-2 guard (D-022 item 2): an answer
 * tool is accepted only after the person's own speech.
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_GUARD_SAY,
  AnswerGuard,
  PAIN_SPEECH_WINDOW_MS,
  PRESS_SPEECH_WINDOW_MS,
  TOOL_BEHAVIOR,
  TOOL_SETS,
  isToolName,
  parseToolArgs,
  screenToolCall,
  toolDeclarations,
} from "../../src/coach/tools";
import type { CoachBlock, ToolName } from "../../src/coach/types";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { REGION_IDS } from "../../src/medical/body-map";
import { STOP_OPTION_IDS } from "../../src/movements/types";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const ALL: ToolName[] = [
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
];
const BLOCKS: CoachBlock[] = ["rom", "gait", "session"];
const STOP_REASONS = ["chest", "stroke_signs", "faint", "breath", "fall", "pain", "tired", "choice", "other"];

type Decl = {
  name: string;
  description: string;
  behavior: string;
  parameters?: { type: string; properties: Record<string, any>; required?: string[] };
};
const decl = (block: CoachBlock, name: string) =>
  (toolDeclarations(block) as Decl[]).find((d) => d.name === name)!;

describe("the tool sets and their behaviour (2.11)", () => {
  it("give each block exactly the contract's tools", () => {
    expect(TOOL_SETS).toEqual({
      rom: ALL,
      gait: ["mark_pain", "pause", "resume", "stop", "next_step", "repeat_instructions"],
      session: ["mark_pain", "pause", "resume", "stop", "next_step", "repeat_instructions"],
    });
  });

  it("make the answer tools and stop BLOCKING and the control tools NON_BLOCKING with their scheduling", () => {
    expect(TOOL_BEHAVIOR).toEqual({
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
    });
  });

  it("knows its tool names", () => {
    for (const n of ALL) expect(isToolName(n)).toBe(true);
    for (const n of ["record_range", "", "toString", "__proto__"]) expect(isToolName(n)).toBe(false);
  });
});

describe("toolDeclarations", () => {
  it("declares the block's tools in order, each with its behaviour and a description", () => {
    for (const block of BLOCKS) {
      const list = toolDeclarations(block) as Decl[];
      expect(list.map((d) => d.name)).toEqual(TOOL_SETS[block]);
      for (const d of list) {
        expect(d.behavior).toBe(TOOL_BEHAVIOR[d.name as ToolName].behavior);
        expect(d.description.length, d.name).toBeGreaterThan(40);
        expect(Object.keys(d).sort()).toEqual(
          d.parameters
            ? ["behavior", "description", "name", "parameters"]
            : ["behavior", "description", "name"],
        );
      }
      // REST shaped and serialisable as is (the token body carries them, 5.1).
      expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    }
  });

  it("builds the parameters from the unions of 2.11", () => {
    expect(decl("rom", "confirm_max").parameters).toMatchObject({
      type: "OBJECT",
      properties: {
        movement: { type: "STRING", enum: [...ROM_MOVEMENT_IDS] },
        side: { type: "STRING", enum: ["left", "right", "none"] },
        answer: { type: "STRING", enum: ["yes", "not_yet", "hurts"] },
      },
      required: ["movement", "side", "answer"],
    });
    expect(decl("rom", "answer_can_move").parameters).toMatchObject({
      properties: { canMove: { type: "BOOLEAN" } },
      required: ["movement", "side", "canMove"],
    });
    for (const block of BLOCKS)
      expect(decl(block, "mark_pain").parameters).toMatchObject({
        properties: {
          level: { type: "INTEGER", minimum: 0, maximum: 10 },
          sharp: { type: "BOOLEAN" },
          location: { type: "STRING", enum: [...REGION_IDS] },
        },
        required: ["level"],
      });
    expect(decl("rom", "set_limit_cause").parameters).toMatchObject({
      properties: { cause: { type: "STRING", enum: ["tight", "pain", "weak"] } },
      required: ["cause"],
    });
    expect(decl("session", "stop").parameters).toMatchObject({
      properties: { reason: { type: "STRING", enum: STOP_REASONS } },
      required: ["reason"],
    });
    for (const n of ["keep_reaching", "pause", "resume", "repeat_instructions"])
      expect(decl("rom", n).parameters, n).toBeUndefined();
    // D-036 item 2: next_step carries the person's intent, in every block.
    for (const block of BLOCKS)
      expect(decl(block, "next_step").parameters).toMatchObject({
        type: "OBJECT",
        properties: { intent: { type: "STRING", enum: ["ready", "start", "next", "continue", "again"] } },
        required: ["intent"],
      });
  });

  it("offers only stop options that are coach reasons (C-7): never the AD option", () => {
    const reasons = decl("rom", "stop").parameters!.properties.reason.enum as string[];
    expect(reasons.every((r) => (STOP_OPTION_IDS as readonly string[]).includes(r))).toBe(true);
    expect(reasons).not.toContain("ad_signs");
  });

  it("says when to call each tool and when never to (2.11, 5.3)", () => {
    const max = decl("rom", "confirm_max").description;
    expect(max).toContain("«هل هذا أقصى ما تستطيع؟»");
    expect(max).toContain("Never call it before an end_range_hold event");
    expect(decl("rom", "keep_reaching").description).toMatch(/Never call it after/);
    const next = decl("rom", "next_step").description;
    expect(next).toMatch(/right after the person says in their own words that they are ready/);
    expect(next).toMatch(/Never call it on your own/);
    expect(next).toMatch(/never for a question, a pain score, a stop or a safety screen/);
    for (const word of ["«جاهز»", "«التالي»", "«مرة ثانية»", "let's go"]) expect(next).toContain(word);
    expect(decl("rom", "resume").description).toMatch(/Never call it after a safety stop/);
    for (const n of ["confirm_max", "answer_can_move", "set_limit_cause", "mark_pain"])
      expect(decl("rom", n).description, n).toMatch(/own words/);
  });

  it("writes descriptions that pass the wording rules (no dash, no hyphenated word)", () => {
    for (const block of BLOCKS)
      for (const d of toolDeclarations(block) as Decl[]) {
        expect(wordingProblems(d.description), d.name).toEqual([]);
        for (const p of Object.values(d.parameters?.properties ?? {}))
          if (p.description) expect(wordingProblems(p.description), d.name).toEqual([]);
      }
  });
});

describe("parseToolArgs", () => {
  const ok = (name: ToolName, raw: unknown) => {
    const r = parseToolArgs(name, raw);
    expect(r.ok, `${name} ${JSON.stringify(raw)}`).toBe(true);
    return r.ok ? r.args : null;
  };
  const bad = (name: ToolName, raw: unknown) =>
    expect(parseToolArgs(name, raw), `${name} ${JSON.stringify(raw)}`).toEqual({ ok: false });

  it("takes every tool's valid arguments", () => {
    expect(ok("confirm_max", { movement: "shoulder_flexion", side: "right", answer: "not_yet" })).toEqual({
      movement: "shoulder_flexion",
      side: "right",
      answer: "not_yet",
    });
    expect(ok("answer_can_move", { movement: "neck_flexion", side: "none", canMove: false })).toEqual({
      movement: "neck_flexion",
      side: "none",
      canMove: false,
    });
    expect(ok("mark_pain", { level: 0 })).toEqual({ level: 0 });
    expect(ok("mark_pain", { level: 10, sharp: true, location: "knee" })).toEqual({
      level: 10,
      sharp: true,
      location: "knee",
    });
    for (const cause of ["tight", "pain", "weak"])
      expect(ok("set_limit_cause", { cause })).toEqual({ cause });
    for (const reason of STOP_REASONS) expect(ok("stop", { reason })).toEqual({ reason });
    for (const n of ["keep_reaching", "pause", "resume", "repeat_instructions"] as ToolName[]) {
      expect(ok(n, {})).toEqual({});
      expect(ok(n, undefined)).toEqual({});
      expect(ok(n, null)).toEqual({});
    }
    for (const intent of ["ready", "start", "next", "continue", "again"])
      expect(ok("next_step", { intent })).toEqual({ intent });
    // An older call without its intent reads as next.
    for (const raw of [{}, undefined, null]) expect(ok("next_step", raw)).toEqual({ intent: "next" });
  });

  it("refuses unknown keys, wrong enums, missing fields and values that are not objects", () => {
    const max = { movement: "shoulder_flexion", side: "right", answer: "yes" };
    bad("confirm_max", { ...max, extra: 1 });
    bad("confirm_max", { ...max, movement: "wrist_flexion" });
    bad("confirm_max", { ...max, side: "R" });
    bad("confirm_max", { ...max, answer: "no" });
    bad("confirm_max", { movement: "shoulder_flexion", side: "right" });
    for (const raw of [null, undefined, "yes", 3, [max], true]) bad("confirm_max", raw);
    bad("answer_can_move", { movement: "neck_flexion", side: "none", canMove: "true" });
    bad("answer_can_move", { movement: "neck_flexion", side: "none" });
    bad("set_limit_cause", { cause: "stiff" });
    bad("set_limit_cause", {});
    for (const n of ["keep_reaching", "pause", "resume", "next_step", "repeat_instructions"] as ToolName[]) {
      bad(n, { now: true });
      bad(n, "go");
      bad(n, []);
    }
    bad("next_step", { intent: "stop" });
    bad("next_step", { intent: "skip" });
    bad("next_step", { intent: "ready", extra: 1 });
    bad(
      "confirm_max",
      JSON.parse('{"movement":"shoulder_flexion","side":"right","answer":"yes","__proto__":{}}'),
    );
    bad("unknown_tool" as ToolName, {});
  });

  it("takes pain only as a whole number from 0 to 10, with a known region", () => {
    for (const level of [-1, 11, 7.5, NaN, Infinity, "7", null]) bad("mark_pain", { level });
    bad("mark_pain", {});
    bad("mark_pain", { level: 3, sharp: "yes" });
    bad("mark_pain", { level: 3, location: "left_knee" });
    bad("mark_pain", { level: 3, side: "left" });
    for (const location of REGION_IDS)
      expect(ok("mark_pain", { level: 3, location })).toEqual({ level: 3, location });
  });

  it("takes stop.reason only from CoachStopReason (C-7)", () => {
    bad("stop", { reason: "ad_signs" });
    bad("stop", { reason: "dizzy" });
    bad("stop", {});
  });
});

describe("the S0-2 answer guard (D-022 item 2)", () => {
  const hold = (t: number) =>
    ({
      p: 1,
      type: "end_range_hold",
      holdId: "h",
      movement: "shoulder_flexion",
      side: "right",
      deg: 120,
      typical: 165,
      t,
    }) as const;
  const ask = (type: "ask_can_move" | "ask_cause" | "ask_pain", t: number) =>
    ({ p: 1, type, movement: "shoulder_flexion", side: "right", t }) as const;
  const refused = { accepted: false, reason: "no_answer_heard", say: ANSWER_GUARD_SAY };

  it("refuses an answer tool called after the question with no speech from the person", () => {
    const g = new AnswerGuard();
    g.question(hold(10_000));
    expect(g.check("confirm_max", 11_000)).toEqual(refused);
    expect(ANSWER_GUARD_SAY).toBe("ask_and_wait");
  });

  it("accepts it once the person's speech arrived after the question", () => {
    const g = new AnswerGuard();
    g.heard("نعم", 9_000);
    g.question(hold(10_000));
    // Speech before the question does not answer it.
    expect(g.check("confirm_max", 10_500)).toEqual(refused);
    g.heard("   ", 10_600);
    expect(g.check("confirm_max", 10_700)).toEqual(refused);
    g.heard("إيه هذا أقصى شي", 11_000);
    expect(g.check("confirm_max", 11_500)).toBeNull();
  });

  it("ties each answer tool to the question that opens it", () => {
    const g = new AnswerGuard();
    g.question(ask("ask_can_move", 1_000));
    g.heard("أقدر", 2_000);
    expect(g.check("answer_can_move", 2_100)).toBeNull();
    g.question(hold(5_000));
    g.heard("نعم", 6_000);
    g.question(ask("ask_cause", 7_000));
    // The cause question has had no answer yet; the maximum question has.
    expect(g.check("set_limit_cause", 7_500)).toEqual(refused);
    expect(g.check("confirm_max", 7_500)).toBeNull();
    g.heard("شد", 8_000);
    expect(g.check("set_limit_cause", 8_200)).toBeNull();
  });

  it("leaves an answer tool with no open question to the host (an early answer is the host's wrong_phase)", () => {
    const g = new AnswerGuard();
    expect(g.check("confirm_max", 1_000)).toBeNull();
    expect(g.check("answer_can_move", 1_000)).toBeNull();
    expect(g.check("set_limit_cause", 1_000)).toBeNull();
  });

  it("takes mark_pain only within 10 s of the person's speech", () => {
    const g = new AnswerGuard();
    expect(PAIN_SPEECH_WINDOW_MS).toBe(10_000);
    expect(g.check("mark_pain", 5_000)).toEqual(refused);
    g.question(ask("ask_pain", 1_000));
    g.heard("سبعة", 2_000);
    expect(g.check("mark_pain", 12_000)).toBeNull();
    expect(g.check("mark_pain", 12_001)).toEqual(refused);
  });

  it("answers the pain question only with speech after it: the speech before it was another answer", () => {
    const g = new AnswerGuard();
    // «أقدر أكثر بس يوجعني» answers the maximum question; the pain question follows.
    g.question(hold(1_000));
    g.heard("أقدر أكثر بس يوجعني", 2_000);
    g.question(ask("ask_pain", 3_000));
    // 2.4 s later, nobody speaking since the question: the model's own mark_pain(0) is refused.
    expect(g.check("mark_pain", 5_400, { level: 0 })).toEqual(refused);
    expect(g.check("mark_pain", 5_400, { level: 2 })).toEqual(refused);
    g.heard("تقريبًا ثلاثة", 6_000);
    expect(g.check("mark_pain", 6_200, { level: 3 })).toBeNull();
  });

  it("refuses the same joint re-ask's score with no answer to it, within 10 s of the last speech", () => {
    const g = new AnswerGuard();
    g.heard("تقريبًا ثمانية", 1_000);
    g.question(ask("ask_pain", 4_000));
    expect(g.check("mark_pain", 6_000, { level: 2 })).toEqual(refused);
  });

  it("always takes a pain of 6 or more, or a sharp pain: it can only stop", () => {
    const g = new AnswerGuard();
    g.question(ask("ask_pain", 1_000));
    expect(g.check("mark_pain", 1_500, { level: 6 })).toBeNull();
    expect(g.check("mark_pain", 1_500, { level: 1, sharp: true })).toBeNull();
  });

  it("always passes stop and the control tools", () => {
    const g = new AnswerGuard();
    g.question(hold(1_000));
    for (const n of ["stop", "keep_reaching", "pause", "resume", "repeat_instructions"] as ToolName[])
      expect(g.check(n, 2_000), n).toBeNull();
  });

  describe("next_step presses a button only on the person's words on that screen (D-036 item 2)", () => {
    let screen: number | null = null;
    const guard = () => new AnswerGuard(() => screen);

    it("passes with no button on the screen: the host answers there is nothing to press", () => {
      screen = null;
      expect(guard().check("next_step", 1_000)).toBeNull();
    });

    it("refuses with a button on the screen and no words while it showed", () => {
      screen = 1;
      const g = guard();
      expect(g.check("next_step", 1_000)).toEqual(refused);
      // Words said on the screen before this one never press this one's button.
      screen = 0;
      g.heard("جاهز", 900);
      screen = 1;
      expect(g.check("next_step", 1_000)).toEqual(refused);
      // Silence (an empty transcription) is no words.
      g.heard("  ", 1_050);
      expect(g.check("next_step", 1_100)).toEqual(refused);
    });

    it("accepts words said while the screen showed, within 10 s", () => {
      expect(PRESS_SPEECH_WINDOW_MS).toBe(10_000);
      screen = 4;
      const g = guard();
      g.heard("جاهز", 2_000);
      expect(g.check("next_step", 2_500)).toBeNull();
      expect(g.check("next_step", 12_000)).toBeNull();
      expect(g.check("next_step", 12_001)).toEqual(refused);
      // The app moved on to the next screen: those words press nothing there.
      screen = 5;
      expect(g.check("next_step", 2_600)).toEqual(refused);
    });

    it("never throws when the screen cannot be read", () => {
      const g = new AnswerGuard(() => {
        throw new Error("gone");
      });
      g.heard("يلا", 1_000);
      expect(g.check("next_step", 1_100)).toBeNull();
    });
  });
});

describe("screenToolCall", () => {
  it("answers unknown_tool, not_in_block, invalid_args and no_answer_heard before a host sees the call", () => {
    const g = new AnswerGuard();
    g.question({ p: 1, type: "ask_cause", movement: "knee_flexion", side: "left", t: 1_000 });
    expect(screenToolCall("rom", { name: "record_range", args: {} }, g, 2_000)).toEqual({
      ok: false,
      result: { accepted: false, reason: "unknown_tool" },
    });
    expect(
      screenToolCall(
        "gait",
        { name: "confirm_max", args: { movement: "knee_flexion", side: "left", answer: "yes" } },
        g,
        2_000,
      ),
    ).toEqual({ ok: false, result: { accepted: false, reason: "not_in_block" } });
    expect(screenToolCall("rom", { name: "set_limit_cause", args: { cause: "cold" } }, g, 2_000)).toEqual({
      ok: false,
      result: { accepted: false, reason: "invalid_args" },
    });
    expect(screenToolCall("rom", { name: "set_limit_cause", args: { cause: "tight" } }, g, 2_000)).toEqual({
      ok: false,
      result: { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" },
    });
    g.heard("أحس بشد", 2_500);
    expect(screenToolCall("rom", { name: "set_limit_cause", args: { cause: "tight" } }, g, 3_000)).toEqual({
      ok: true,
      name: "set_limit_cause",
      args: { cause: "tight" },
    });
    expect(screenToolCall("session", { name: "stop", args: { reason: "chest" } }, g, 3_000)).toEqual({
      ok: true,
      name: "stop",
      args: { reason: "chest" },
    });
  });
});
