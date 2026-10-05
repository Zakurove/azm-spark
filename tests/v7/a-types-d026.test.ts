/**
 * The section 2 types that D-026 (items 7, 8 and 9) and D-027 (item 2) change, in their home files
 * (contract 1.3 and 1.4: a shared type changes with the tech lead's decision, in A's file). Most of
 * these checks are made by `npm run check`: each assignment below only compiles when the field is there
 * with its decided type.
 */
import { describe, expect, it } from "vitest";
import type { CoachState } from "../../src/coach/types";
import type { GaitAnalysis, GaitSetup, GaitWalkPain } from "../../src/engine/gait/types";
import type {
  GaitFindingsInput,
  GaitPatternResult,
  GaitResultFlag,
  GaitSupportFinding,
} from "../../src/medical/gait-types";
import type { StoredFocusToday } from "../../src/medical/focus-precheck";

describe("the section 2 types D-026 changes", () => {
  it("CoachState lets the app open the bridge again after a P0 (item 8, DG-4)", () => {
    // 2.11 bridge rule 1: after a P0 only the app reopens; useCoach returns CoachState itself.
    const reopen: CoachState["reopen"] = () => undefined;
    expect(reopen()).toBeUndefined();
  });

  it("GaitFindingsInput carries the walk's setup and the day's steadi and Parkinson's answers (item 7)", () => {
    // CG-7: the setup as walked (orthoses, aid, height), passed by the gait route; never optional.
    const setup: GaitFindingsInput["setup"] = {
      mode: "overground",
      aid: "cane",
      orthosis: { right: "afo" },
      prosthesis: null,
      shoes: true,
      heightCm: 172,
      padSpeedKmh: null,
      padCorrection: null,
      handrail: null,
      familiarised: null,
    } satisfies GaitSetup;
    // CG-9 and CG-18: the stored day answers the rules read.
    const today: GaitFindingsInput["today"] = {
      painByRegion: { knee: 2 },
      pdState: "unsure",
      steadi: { fell: true, worry: false },
    };
    expect([setup.aid, today.steadi?.fell]).toEqual(["cane", true]);
  });

  it("GaitAnalysis keeps the pain marked during the walk, with its side (item 7, CG-8)", () => {
    const pain: GaitWalkPain[] = [
      { side: "right", level: 4 },
      { side: null, level: 2 },
    ];
    const walkPain: GaitAnalysis["walkPain"] = pain;
    expect(walkPain).toHaveLength(2);
  });

  it("flags every norm based result and gives a support finding its status (item 7, CG-16, CG-17)", () => {
    const flag: GaitResultFlag = "norm_interim";
    const pattern: Pick<GaitPatternResult, "flags"> = { flags: [flag] };
    const findings: GaitSupportFinding[] = [
      { id: "uneven_step_length", side: "left", value: 1.2, status: "likely" },
      { id: "slow_speed", side: "none", value: 0.7, status: null, flags: ["norm_interim"] },
    ];
    expect([pattern.flags, findings.map((f) => f.status)]).toEqual([["norm_interim"], ["likely", null]]);
  });

  it("StoredFocusToday keeps the day answers a later step reads, each only when asked (items 7 and 9)", () => {
    const kept: StoredFocusToday = {
      painByRegion: { back_trunk: 3 },
      helperPresent: true,
      steadi: { fell: false, worry: true },
      pdState: "on",
      pusher: false,
      armrests: true,
      seatedLean: { fellSitting: false, pressureSore: false, sitsUnsupported: "unsure" },
      prosthesisOn: true,
    };
    // Only the pain is always there; every other answer is absent when it was not asked.
    const least: StoredFocusToday = { painByRegion: {} };
    expect(Object.keys(least)).toEqual(["painByRegion"]);
    expect(Object.keys(kept)).toHaveLength(8);
  });
});
