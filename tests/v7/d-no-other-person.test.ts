/**
 * Nasser (D-038 item 2, the crowded booth): «Don't let the voice agent say there is another person in
 * the frame.» When the lock pauses because the person is covered or lost, the coach and the screen
 * speak only about the person: «لحظة، نكمل حين نراك بوضوح» / "One moment, we’ll go on when we can see
 * you clearly", or «step back into the picture». Nothing that reaches the coach mentions anyone else:
 *   - the walk's hints and its try once more reasons (every one, in both languages), and their coach
 *     lines (hintSay, the retry step's say line);
 *   - the range's setup issues the controller can raise, its «unclear» and «step back» lines;
 *   - the events of a range block and of a walk with someone stepping over the person: every say line
 *     and every setup_issue token the coach is sent.
 * Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import type { BridgeEvent } from "../../src/coach/types";
import { RomController, type RomSetupIssue } from "../../src/features/focus/romController";
import { setupIssueSay } from "../../src/features/focus/coachSay";
import {
  CAPTURE_LIMITS,
  GaitController,
  type GaitHint,
  type RetryReason,
} from "../../src/features/gait/controller";
import { gt } from "../../src/features/gait/copy";
import { hintSay } from "../../src/features/gait/say";
import { tV7 } from "../../src/i18n/v7";
import type { Landmark } from "../../src/engine/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { walk, withRealFarLeg, type WalkSpec } from "../fixtures/gait/gen-gait";
import { entry, intake, today } from "./a-fixtures";
import { bridges, runBlock } from "./b-shell-driver";

/** Words about another person in the picture, in English and Arabic. */
const OTHER_EN =
  /\b(someone|somebody|anyone|anybody|another person|other person|other people|second person|helper|companion|only you|people)\b/i;
const OTHER_AR = /(شخص(ًا|ا)? آخر|أحد(ًا|ا)? آخر|غيرك|وحدك|مرافق|أشخاص|شخصين)/;
const mentionsOthers = (text: string) => OTHER_EN.test(text) || OTHER_AR.test(text);
/**
 * Another person in the picture, for every line (a step line may name the helper who taps for someone
 * lying down, never anyone in the picture).
 */
const IN_PICTURE_EN =
  /(someone|somebody|anyone|another person|other person|second person|only you)\b.{0,40}\b(picture|frame|middle|in front|between|close to you|behind you)/i;
const IN_PICTURE_AR = /(شخص(ًا|ا)? آخر|أحد(ًا|ا)? آخر|غيرك|وحدك)/;
const inPicture = (text: string) => IN_PICTURE_EN.test(text) || IN_PICTURE_AR.test(text);
/** setup_issue tokens that name another person. */
const OTHER_TOKEN = /second_person|one_person|other|someone|crowd/;

const HINTS: GaitHint[] = [
  "no_person",
  "unclear",
  "feet",
  "legs",
  "light",
  "level",
  "across",
  "further",
  "turn",
];
const REASONS: RetryReason[] = ["side_on", "no_person", "light", "whole_body", "more_steps", "one_person"];
const ROM_ISSUES: RomSetupIssue[] = [
  "no_person",
  "unclear",
  "tilt",
  "too_close",
  "too_far",
  "framing",
  "arm_room",
  "wrong_view",
  "light",
];

describe("no line the coach says mentions another person (D-038 item 2)", () => {
  for (const lang of ["en", "ar"] as const) {
    it(`the walk's hints and try once more reasons, on screen and to the coach (${lang})`, () => {
      for (const h of HINTS) {
        expect(mentionsOthers(gt(lang, `hint.${h}`)), h).toBe(false);
        for (const line of hintSay(h, lang).lines) expect(mentionsOthers(line), h).toBe(false);
      }
      // The try once more step's say line: its title, the reason and the body (say.ts gaitStepSay).
      for (const key of ["retry.title", "retry.body", ...REASONS.map((r) => `retry.reason.${r}`)])
        expect(mentionsOthers(gt(lang, key as never)), key).toBe(false);
      // The neutral line, about the person only.
      expect(gt(lang, "hint.unclear")).toBe(
        lang === "en" ? "One moment, we’ll go on when we can see you clearly" : "لحظة، نكمل حين نراك بوضوح",
      );
    });

    it(`the range's setup issues, «unclear» and «step back» (${lang})`, () => {
      for (const issue of ROM_ISSUES) {
        const text =
          issue === "unclear" ? tV7(lang, "rom.measure.unclear") : setupIssueSay(issue, lang).lines[0];
        expect(mentionsOthers(text), issue).toBe(false);
      }
      expect(mentionsOthers(tV7(lang, "rom.measure.back"))).toBe(false);
      expect(tV7(lang, "rom.measure.unclear")).toBe(
        lang === "en" ? "One moment, we’ll go on when we can see you clearly" : "لحظة، نكمل حين نراك بوضوح",
      );
    });
  }

  /**
   * Every say line's words, the corrections among them (what the camera saw), and every setup_issue
   * token the coach was sent.
   */
  function heard(events: readonly BridgeEvent[]) {
    const lines = events.flatMap((e) => (e.type === "say" ? e.lines : []));
    const corrections = events.flatMap((e) => (e.type === "say" && e.kind === "correction" ? e.lines : []));
    const tokens = events.flatMap((e) => (e.type === "setup_issue" ? [e.issue] : []));
    return { lines, corrections, tokens };
  }

  it("a range block with someone right beside the person, then over them in a try, then the person gone", () => {
    const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
    for (const lang of ["en", "ar"] as const) {
      const ctl = new RomController({
        protocol: buildRomProtocol({ intake: KNEE, setting: "booth", today: today() }),
        painByRegion: {},
        intake: KNEE,
        lang,
        restSec: 1,
      });
      ctl.startBlock("lying", 0);
      let tryAt = Infinity;
      const run = runBlock(
        ctl,
        {
          at: (t, c) => {
            if (tryAt === Infinity && (c.phase === "practice" || c.phase === "attempt")) tryAt = t;
          },
          people: (lm, t, c) => {
            const over = lm.map((p) => ({ ...p, x: p.x + 0.03, y: p.y - 0.01 }));
            // Beside the person while the start pose is taken; over them for 3 s in the first try;
            // the person gone for 4 s after that.
            if (c.phase === "calibrating") return [lm, over];
            if (t >= tryAt + 500 && t < tryAt + 3500) return [over, lm];
            if (t >= tryAt + 3500 && t < tryAt + 7500) return [];
            return [lm];
          },
        },
        200,
      );
      const { lines, corrections, tokens } = heard(bridges(run.events));
      // The neutral lines were said: the person was covered and then gone.
      expect(corrections).toContain(tV7(lang, "rom.measure.unclear"));
      expect(corrections).toContain(tV7(lang, "rom.measure.back"));
      for (const line of corrections) expect(mentionsOthers(line), line).toBe(false);
      for (const line of lines) expect(inPicture(line), line).toBe(false);
      for (const token of tokens) expect(OTHER_TOKEN.test(token), token).toBe(false);
    }
  });

  it("a walk with someone stepping over the walker", () => {
    const spec: WalkSpec = {
      view: "side",
      passes: 4,
      seed: 2,
      speed: 1.1,
      cadence: 104,
      camera: { distance: 3.5, portrait: true },
      sidePath: { pathM: 5.3, turnSec: 1.5 },
      passShiftM: 0.3,
      noise: 0.004,
      jitterMs: 8,
    };
    const plan: GaitPlan = {
      offered: true,
      modes: ["overground"],
      defaultMode: "overground",
      padAllowed: false,
      helperRequired: false,
      antalgicOnly: false,
      staticStance: false,
      views: { overground: ["side"], walking_pad: [] },
    };
    for (const lang of ["en", "ar"] as const) {
      const w = walk(spec);
      const ctl = new GaitController({
        plan,
        painBefore: null,
        intake: { walking: { status: "without_aid" }, heightCm: 170, regions: [] },
        poseModel: () => "full",
        log: () => undefined,
        lang,
      });
      const events: BridgeEvent[] = [];
      ctl.onBridge((e) => events.push(e));
      let t = w.standing[0].t - 100;
      ctl.start(t);
      for (let i = 0; i < 8 && ctl.current.id !== "place"; i++)
        if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
        else ctl.confirm(t);
      ctl.confirm(t);
      const t0 = w.standing[w.standing.length - 1].t;
      const hints = new Set<string | null>();
      for (const f of [...w.standing, ...withRealFarLeg(w.frames)]) {
        if (ctl.current.id !== "stand" && ctl.current.id !== "walk") break;
        const seen = f.lm.some((q) => q.visibility > 0.5);
        const poses: Landmark[][] = seen ? [f.lm] : [];
        // Someone stands right over the walker for 2 s in the middle of the walk.
        if (seen && f.t - t0 > 6000 && f.t - t0 < 8000)
          poses.push(f.lm.map((q) => ({ ...q, x: q.x + 0.01 })));
        ctl.feed({ t: f.t, lm: poses[0] ?? f.lm, poses, aspect: f.aspect }, { rollDeg: null });
        ctl.tick(f.t);
        hints.add(ctl.hint);
        t = f.t;
      }
      for (let i = 0; i < 3 && ctl.current.id === "walk"; i++)
        ctl.tick((t += CAPTURE_LIMITS.afterLastPassMs + 100));
      expect(hints.has("unclear")).toBe(true);
      const { lines, corrections, tokens } = heard(events);
      expect(corrections).toContain(gt(lang, "hint.unclear"));
      for (const line of corrections) expect(mentionsOthers(line), line).toBe(false);
      for (const line of lines) expect(inPicture(line), line).toBe(false);
      for (const token of tokens) expect(OTHER_TOKEN.test(token), token).toBe(false);
    }
  });
});
