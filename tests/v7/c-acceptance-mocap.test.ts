/**
 * Acceptance of the gait engine and rules on projected motion capture (product v7 contract 8.3, step
 * C2): the 60 walkers of tests/fixtures/gait/mocap (20 able bodied adults and 10 stroke survivors
 * overground, Van Criekinge 2023; 10 adults on a treadmill at 3 speeds, Fukuchi 2018), each seen in
 * the views its capture plans (overground front, back and side; the pad from both sides and the
 * front), against the datasets' own events:
 *   - cadence within 5% on 95% or more of the trial views that report one, and on every walker's
 *     analysis (its views combined);
 *   - events within 2 frames on 90% or more in the side views (the front views' contacts lag the
 *     truth, CG-2: measured below, not judged);
 *   - at least 6 clean cycles a side wherever the walk holds 6 the camera can see whole;
 *   - the rules quiet on every able bodied walker but the one whose own dataset angles carry the
 *     sign (HEALTHY_HITS); the interim thresholds of D-027 item 6 (CG-19) keep four more quiet
 *     (HEALTHY_HITS_BEFORE_CG19).
 * Stroke survivors have no pass bar: c-mocap-report.test.ts writes their rule hits for the review.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { GaitView } from "../../src/engine/gait/types";
import type { MocapWalk } from "../fixtures/gait/mocap";
import { eventErrors, firedOf, median, withinFrames } from "./c-acceptance-helpers";
import { HEALTHY_HITS, runAll, rulesForWalker, type MocapRun } from "./c-mocap-run";

let runs: Map<string, MocapRun>;
beforeAll(() => {
  runs = runAll();
});

const sideKind = (v: GaitView) => v === "side" || v === "pad_side";

describe("the engine on projected motion capture", () => {
  it("keeps the cadence within 5% of the dataset's events on 95% or more of the trial views", () => {
    const errors: { at: string; err: number }[] = [];
    for (const [id, run] of runs)
      for (const v of run.views) {
        const c = v.result.metrics.cadence?.value;
        if (c !== undefined && c !== null)
          errors.push({ at: `${id} ${v.view}`, err: c / v.walk.truth.cadence - 1 });
      }
    // Every side and pad view reports one; the back view reports none (gait-rules metrics).
    expect(errors.length).toBeGreaterThanOrEqual(140);
    const ok = errors.filter((e) => Math.abs(e.err) < 0.05).length / errors.length;
    expect(ok, JSON.stringify(errors.filter((e) => Math.abs(e.err) >= 0.05))).toBeGreaterThanOrEqual(0.95);
    // The side views on their own: every one.
    for (const e of errors.filter((x) => / (side|pad_side)$/.test(x.at)))
      expect(Math.abs(e.err), e.at).toBeLessThan(0.05);
  });

  it("gives each walker's analysis (its views combined) a cadence within 5% of the dataset's", () => {
    for (const [id, run] of runs) {
      const c = run.analysis.combined.cadence?.value;
      const truth = run.views.find((v) => sideKind(v.view))!.walk.truth.cadence;
      expect(c, id).toBeDefined();
      expect(Math.abs(c! / truth - 1), id).toBeLessThan(0.05);
    }
  });

  it("finds the side views' events within 2 frames of the dataset's on 90% or more", () => {
    const all: number[] = [];
    const ableBodied: number[] = [];
    for (const [id, run] of runs)
      for (const v of run.views)
        if (sideKind(v.view)) {
          const e = eventErrors(v.walk.truth, v.result.events);
          all.push(...e);
          if (!id.startsWith("vc-st-")) ableBodied.push(...e);
        }
    expect(all.length).toBeGreaterThan(4000);
    expect(withinFrames(all)).toBeGreaterThanOrEqual(0.9);
    expect(withinFrames(ableBodied)).toBeGreaterThanOrEqual(0.95);
  });

  it("finds 6 clean cycles a side wherever the walk holds 6 the camera sees whole", () => {
    for (const [id, run] of runs)
      for (const v of run.views) {
        if (v.view === "front" || v.view === "back") continue;
        const truth = v.walk.truth;
        // A pad front contact comes up to a fifth of a stride late (CG-2): its last cycle needs that room.
        const present =
          v.view === "pad_front" ? padFrontPresent(v.walk) : (s: "left" | "right") => truth.cycles[s];
        for (const s of ["left", "right"] as const)
          if (present(s) >= 6)
            expect(
              v.result.quality.cleanCycles[s],
              `${id} ${v.view} ${v.nearSide ?? ""} ${s}`,
            ).toBeGreaterThanOrEqual(6);
      }
  });

  it("passes the gate of both pad side views and the pad front view at every treadmill speed", () => {
    for (const [id, run] of runs) {
      if (run.fx.mode !== "treadmill") continue;
      for (const v of run.views)
        if (
          v.view === "pad_side" ||
          Math.min(padFrontPresent(v.walk)("left"), padFrontPresent(v.walk)("right")) >= 6
        )
          expect(v.result.quality.gatePassed, `${id} ${v.view} ${v.nearSide ?? ""}`).toBe(true);
    }
  });

  it("measures the front views' contacts later than the dataset's toward the phone and earlier away (CG-2)", () => {
    const lag: Record<"front" | "back" | "pad_front", number[]> = { front: [], back: [], pad_front: [] };
    for (const run of runs.values())
      for (const v of run.views) {
        if (sideKind(v.view)) continue;
        const stride = (120 / v.walk.truth.cadence) * 1000;
        const ics = v.result.events.filter((e) => e.type === "ic");
        const e = eventErrors(v.walk.truth, ics).filter(Number.isFinite);
        lag[v.view as keyof typeof lag].push(...e.map((x) => x / stride));
      }
    // A share of the stride: toward the phone the contact is read about one double support late.
    expect(median(lag.front)!).toBeGreaterThan(0.1);
    expect(median(lag.front)!).toBeLessThan(0.2);
    expect(median(lag.pad_front)!).toBeGreaterThan(0.08);
    expect(median(lag.back)!).toBeLessThan(0);
    expect(median(lag.back)!).toBeGreaterThan(-0.1);
  });
});

describe("the gait rules on able bodied motion capture", () => {
  it("stay quiet on every able bodied walker but the listed ones, which fire as listed", () => {
    for (const [id, run] of runs) {
      if (id.startsWith("vc-st-")) continue;
      const out = rulesForWalker(run);
      expect(firedOf(out.patterns), id).toEqual(HEALTHY_HITS[id] ?? []);
    }
  });

  it("stay quiet on every slow treadmill walk (0.4 to 0.6 m/s) for stiff knee and steppage", () => {
    for (const [id, run] of runs) {
      if (run.fx.mode !== "treadmill" || run.fx.passes[0].speedMps > 0.6) continue;
      const out = rulesForWalker(run);
      for (const p of out.patterns.filter((x) => x.pattern === "stiff_knee" || x.pattern === "steppage"))
        expect(p.status, `${id} ${p.pattern}`).not.toMatch(/possible|likely/);
    }
  });
});

/** Visible pad front cycles whose last contact leaves a quarter stride before the walk's end. */
function padFrontPresent(w: MocapWalk): (s: "left" | "right") => number {
  return (s) => {
    const stride = (120 / w.truth.cadence) * 1000;
    const end = w.truth.passes[w.truth.passes.length - 1].to;
    const start = w.truth.passes[0].from;
    const ics = w.truth.ics;
    const own = ics.filter((e) => e.side === s);
    let n = 0;
    for (let i = 1; i < own.length; i++)
      if (
        own[i - 1].t >= start + 500 &&
        own[i].t <= end - 0.25 * stride &&
        ics.some((e) => e.side !== s && e.t > own[i - 1].t && e.t < own[i].t)
      )
        n++;
    return n;
  };
}
