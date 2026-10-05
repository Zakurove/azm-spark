/**
 * The motion capture walkers through the gait engine and rules (product v7 contract 8.3, step C2),
 * shared by the acceptance (c-acceptance-mocap.test.ts) and the stroke report
 * (c-mocap-report.test.ts): every committed walker in the views its capture plans, combined as the
 * capture combines them.
 */
import { analyseGaitView, combineViews } from "../../src/engine/gait/analyse";
import type { GaitAnalysis, GaitSetup, GaitView, GaitViewResult } from "../../src/engine/gait/types";
import { loadMocap, mocapIds, mocapWalk, type MocapFixture, type MocapWalk } from "../fixtures/gait/mocap";
import { rulesOn } from "./c-acceptance-helpers";

/** The setup a capture of this walk would record. */
export function mocapSetup(fx: MocapFixture): GaitSetup {
  const pad = fx.mode === "treadmill";
  return {
    mode: pad ? "walking_pad" : "overground",
    aid: "none",
    orthosis: {},
    prosthesis: null,
    shoes: false,
    heightCm: fx.subject.heightCm,
    padSpeedKmh: pad ? Math.round(fx.passes[0].speedMps * 36) / 10 : null,
    padCorrection: null,
    handrail: pad ? "none" : null,
    familiarised: pad ? true : null,
  };
}

/** The planned views of a walk's mode (gait-eligibility's view lists). */
export function mocapViews(fx: MocapFixture): { view: GaitView; nearSide?: "left" | "right" }[] {
  return fx.mode === "treadmill"
    ? [{ view: "pad_side", nearSide: "right" }, { view: "pad_side", nearSide: "left" }, { view: "pad_front" }]
    : [{ view: "front" }, { view: "back" }, { view: "side" }];
}

/**
 * Age for the norms: the Fukuchi walkers' own; a Van Criekinge walker's from the decade of birth, at
 * the dataset's measurement year (2019, the year its dated files carry) and the decade's middle.
 */
export function mocapAge(fx: MocapFixture): number | null {
  if (fx.subject.ageYears !== undefined) return fx.subject.ageYears;
  return fx.subject.birthDecade ? 2019 - (Number(fx.subject.birthDecade.slice(0, 4)) + 5) : null;
}

export interface MocapRun {
  fx: MocapFixture;
  views: { view: GaitView; nearSide?: "left" | "right"; walk: MocapWalk; result: GaitViewResult }[];
  analysis: GaitAnalysis;
}

/** Every committed walker through every planned view, once. */
export function runAll(seed = 7): Map<string, MocapRun> {
  const out = new Map<string, MocapRun>();
  for (const id of mocapIds()) {
    const fx = loadMocap(id);
    const views = mocapViews(fx).map((v) => {
      const walk = mocapWalk(fx, { view: v.view, nearSide: v.nearSide, seed });
      const result = analyseGaitView({
        view: v.view,
        nearSide: v.nearSide,
        setup: mocapSetup(fx),
        standing: walk.standing,
        frames: walk.frames,
        poseModel: "full",
        rollDeg: 0,
      });
      return { ...v, walk, result };
    });
    out.set(id, {
      fx,
      views,
      analysis: combineViews(
        views.map((v) => v.result),
        [],
        mocapSetup(fx),
      ),
    });
  }
  return out;
}

/** The rules for an able bodied walker: no condition, no region, the dataset's sex, height and age. */
export function rulesForWalker(
  run: MocapRun,
  intake: NonNullable<Parameters<typeof rulesOn>[1]>["intake"] = {},
) {
  const s = run.fx.subject;
  return rulesOn(run.analysis, {
    intake: {
      age: intake.age ?? mocapAge(run.fx) ?? undefined,
      sex: s.sex ?? "male",
      heightCm: s.heightCm ?? 170,
      regions: [],
      conditions: ["none"],
      ...intake,
    },
    plan: run.fx.mode === "treadmill" ? { defaultMode: "walking_pad" } : {},
  });
}

/**
 * Able bodied walkers whose own dataset angles carry a pattern's sign, so the rule fires on them as
 * written (the C2 gap CG-19, with the datasets' own numbers). Five fired before the interim gait
 * thresholds of D-027 item 6 (CG-19); these keep them quiet:
 *   - vc-ab-005: the left knee bends 41 to 48 degrees in swing (Plug-in Gait, 15 strides), the right
 *     52 to 56; a woman born in the 1930s, 145 cm, at 0.8 m/s: the absolute peak alone counts only
 *     from 1.0 m/s;
 *   - wbds-25-t01: the left knee does not bend at landing (-1.4 degrees, the right 14.2) at 0.47 m/s:
 *     quadriceps avoidance is not assessed under 0.5 m/s;
 *   - wbds-41-t01 and wbds-41-t07: the left knee passes straight by 10.5 and 11.4 degrees in stance:
 *     recurvatum is possible from 12.
 * One still fires:
 *   - wbds-35-t04: the knees bend 77 and 62 degrees in swing (Visual3D mean curves), 15 apart, at 1.1
 *     m/s; the engine reads 59.3 and 74.5, a between limb difference of 15.2, at the rule's own 15.
 */
export const HEALTHY_HITS: Readonly<Record<string, string[]>> = {
  "wbds-35-t04": ["stiff_knee:left:possible"],
};
/** The able bodied walkers the interim thresholds of D-027 item 6 (CG-19) keep quiet, with what fired before. */
export const HEALTHY_HITS_BEFORE_CG19: Readonly<Record<string, string[]>> = {
  "vc-ab-005": ["stiff_knee:left:possible"],
  "wbds-25-t01": ["quad_avoidance:left:possible"],
  "wbds-41-t01": ["recurvatum:left:possible"],
  "wbds-41-t07": ["recurvatum:left:possible"],
};
