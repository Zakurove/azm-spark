/**
 * src/engine/gait/metrics.ts, kinematics.ts and spatiotemporal.ts (product v7 contract 2.8, gait-rules
 * 3.1, 3.4 and 3.5): every metric on small hand computed inputs. The series are written by hand (no
 * filtering), so each expected value follows from the definitions alone.
 */
import { describe, expect, it } from "vitest";
import type { Cycle } from "../../src/engine/gait/cycles";
import {
  distAt,
  dropAt,
  kneeAt,
  leanAt,
  leftOnRight,
  pitchAt,
  shankAt,
  thighAt,
  tlaAt,
  trunkAt,
} from "../../src/engine/gait/kinematics";
import { TIMING_METRICS, viewMetrics, type MetricInput } from "../../src/engine/gait/metrics";
import type { Motion, Pass } from "../../src/engine/gait/passes";
import type { Prepared, Series } from "../../src/engine/gait/preprocess";
import {
  doubleSupportPct,
  padLengths,
  singleSupport,
  stanceTime,
  stepTime,
  strideTime,
  swingTime,
} from "../../src/engine/gait/spatiotemporal";
import type { StandingZeros } from "../../src/engine/gait/standing";
import type { GaitFrame, GaitView } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";

const D2R = Math.PI / 180;

/** A hand written series of n samples at 30 Hz (every used landmark at the origin unless set). */
function handSeries(
  n: number,
  set: (k: number, put: (id: number, x: number, y: number) => void) => void,
): Prepared {
  const x: Float64Array[] = [];
  const y: Float64Array[] = [];
  for (const id of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    x[id] = new Float64Array(n);
    y[id] = new Float64Array(n);
  }
  for (let k = 0; k < n; k++)
    set(k, (id, px, py) => {
      x[id][k] = px;
      y[id][k] = py;
    });
  const t = Float64Array.from({ length: n }, (_, k) => k / 30);
  const series: Series = { t, n, hz: 30, x, y, relabelled: new Uint8Array(n), bouts: [[0, n]] };
  const frames: GaitFrame[] = Array.from({ length: n }, (_, k) => ({
    t: (k * 1000) / 30,
    lm: Array.from({ length: 33 }, (): Landmark => ({ x: 0, y: 0, z: 0, visibility: 0.99 })),
    aspect: 1,
  }));
  return {
    series,
    frames,
    frameMs: Float64Array.from(frames, (f) => f.t),
    aspect: 1,
    faceSeen: new Uint8Array(n),
  };
}

function cycle(
  side: "left" | "right",
  ks: [number, number | null, number | null, number | null, number],
  near: boolean,
): Cycle {
  const [k0, kOppTo, kOppIc, kTo, k1] = ks;
  return {
    side,
    icStart: Math.round((k0 * 1000) / 30),
    to: kTo === null ? null : Math.round((kTo * 1000) / 30),
    icEnd: Math.round((k1 * 1000) / 30),
    clean: true,
    pass: 0,
    k0,
    kOppTo,
    kOppIc,
    kTo,
    k1,
    near,
    trunkOk: true,
  };
}

const ZEROS: StandingZeros = {
  d: 1,
  tla: { left: -10, right: -10 },
  pitch: { left: 3, right: 3 },
  trunk: 1,
  armLength: { left: 0.4, right: 0.4 },
  leanLeft: 0,
  drop: { left: 0, right: 0 },
  heightPx: null,
};

function input(p: Prepared, view: GaitView, cycles: Cycle[], over: Partial<MetricInput> = {}): MetricInput {
  const pass: Pass = {
    start: 0,
    end: p.series.n,
    d: 1,
    facing: view === "side" || view === "pad_side" ? "side" : "toward",
    near: view === "side" || view === "pad_side" ? "right" : null,
    turnAtStart: false,
    turnAtEnd: false,
  };
  const motion: Motion = { passes: [pass], excluded: new Uint8Array(p.series.n), wrongViewShare: 0 };
  return {
    p,
    view,
    motion,
    cycles,
    zeros: ZEROS,
    pxPerM: 0.5,
    beltMps: null,
    rollKnown: true,
    medianFps: 30,
    ...over,
  };
}

describe("angle conventions (gait-rules 3.1)", () => {
  const p = handSeries(1, (_, put) => {
    put(24, 0, 0); // right hip
    put(26, 0.1, 0.4); // right knee
    put(28, 0.1, 0.8); // right ankle
    put(30, 0.08, 0.83); // right heel
    put(32, 0.08 + 0.2 * Math.cos(15 * D2R), 0.83 - 0.2 * Math.sin(15 * D2R)); // right foot index, toes up 15
    put(23, -0.02, 0); // left hip
    put(11, 0.04, -0.5); // left shoulder
    put(12, 0.02, -0.5); // right shoulder
  });
  const s = p.series;
  const deg = (v: number) => Math.atan(v) / D2R;

  it("reads thigh, shank, knee, trailing limb and foot pitch with the walking direction", () => {
    expect(thighAt(s, "right", 0, 1)).toBeCloseTo(deg(0.1 / 0.4), 10);
    expect(thighAt(s, "right", 0, -1)).toBeCloseTo(-deg(0.1 / 0.4), 10);
    expect(shankAt(s, "right", 0, 1)).toBeCloseTo(0, 10);
    expect(kneeAt(s, "right", 0, 1)).toBeCloseTo(deg(0.25), 10);
    // the ankle 0.1 ahead of the hip: trails by minus that angle
    expect(tlaAt(s, "right", 0, 1)).toBeCloseTo(-deg(0.1 / 0.8), 10);
    expect(pitchAt(s, "right", 0, 1)).toBeCloseTo(15, 10);
  });

  it("reads the trunk forward, its lean across the picture, the facing and the pelvic drop", () => {
    // mid shoulder (0.03, −0.5), mid hip (−0.01, 0): forward atan(0.04 / 0.5)
    expect(trunkAt(s, 0, 1)).toBeCloseTo(deg(0.04 / 0.5), 10);
    expect(trunkAt(s, 0, -1)).toBeCloseTo(-deg(0.04 / 0.5), 10);
    expect(leanAt(s, 0)).toBeCloseTo(deg(0.04 / 0.5), 10);
    expect(leftOnRight(s, 0)).toBe(-1);
    expect(dropAt(s, "left", 0)).toBeCloseTo(0, 10);
    expect(distAt(s, 24, 26, 0)).toBeCloseTo(Math.hypot(0.1, 0.4), 12);
  });
});

describe("spatiotemporal formulas (OpenCap port, gait-rules 3.4 and 3.5)", () => {
  const c = { ic: 0, oppTo: 0.12, oppIc: 0.55, to: 0.68, icEnd: 1.1 };
  it("gives stride, step, stance, swing, single and double support", () => {
    expect(strideTime(c)).toBeCloseTo(1.1, 12);
    expect(stepTime(c)).toBeCloseTo(0.55, 12);
    expect(stanceTime(c)).toBeCloseTo(0.68, 12);
    expect(swingTime(c)).toBeCloseTo(0.42, 12);
    expect(singleSupport(c)).toBeCloseTo(0.43, 12);
    expect(doubleSupportPct(c)).toBeCloseTo(((0.12 + 0.13) / 1.1) * 100, 10);
  });

  it("splits the pad's stride (belt speed times stride time) by the two heel separations", () => {
    expect(padLengths(1.2, 1.1, 0.2, 0.3)).toEqual({ stride: 1.32, step: (0.3 / 0.5) * 1.32 });
    expect(padLengths(1.2, 1.1, 0, 0.3)).toBeNull();
    expect(padLengths(0, 1.1, 0.2, 0.3)).toBeNull();
  });
});

/**
 * The side view scenario (d = +1, the right limb nearest the phone):
 *   right cycle: IC 0, left TO 4, left IC 16, right TO 20, next IC 30
 *   left cycle:  IC 16, right TO 20, right IC 30, left TO 34, next IC 46
 * Right knee K = 5 + |k − 10|, right thigh θT = −20 + 2k; heels set at the ICs for the step lengths.
 */
function sideScenario(): { p: Prepared; cycles: Cycle[] } {
  const L = 0.25;
  const p = handSeries(50, (k, put) => {
    const thigh = (-20 + 2 * k) * D2R;
    const knee = (5 + Math.abs(k - 10)) * D2R;
    const shank = thigh - knee;
    const hip: [number, number] = [1.0, 0.5];
    const kn: [number, number] = [hip[0] + L * Math.sin(thigh), hip[1] + L * Math.cos(thigh)];
    const an: [number, number] = [kn[0] + L * Math.sin(shank), kn[1] + L * Math.cos(shank)];
    put(24, ...hip);
    put(26, ...kn);
    put(28, ...an);
    put(23, 0.98, 0.5);
    put(25, 0.98, 0.75);
    put(27, 0.98, 1.0);
    // heels: the right foot pitched 15 degrees toes up at its IC (k = 0), flat elsewhere
    const heelR: [number, number] = [an[0] - 0.02, an[1] + 0.03];
    const p15 = k === 0 ? 15 * D2R : 0;
    put(30, ...heelR);
    put(32, heelR[0] + 0.1 * Math.cos(p15), heelR[1] - 0.1 * Math.sin(p15));
    put(29, 0.96, 1.03);
    put(31, 1.06, 1.03);
    // heel separations: 0.30 at k 30 (right ahead), 0.25 at k 16 (left ahead), 0.32 at k 46 (left ahead)
    if (k === 30) {
      put(30, 1.3, 1.03);
      put(29, 1.0, 1.03);
    }
    if (k === 16) {
      put(29, 1.25, 1.03);
      put(30, 1.0, 1.03);
    }
    if (k === 46) {
      put(29, 1.32, 1.03);
      put(30, 1.0, 1.03);
    }
    // trunk 4 degrees forward of the picture's vertical
    const mid = 0.99;
    const sx = mid + 0.5 * Math.sin(4 * D2R);
    const sy = 0.5 - 0.5 * Math.cos(4 * D2R);
    put(11, sx, sy);
    put(12, sx, sy);
    // right wrist 0.07 ahead of the shoulder at k 0 down to 0.05 behind it at k 30
    put(16, sx + 0.07 - (0.12 * Math.min(k, 30)) / 30, 0.8);
    put(15, sx, 0.8);
  });
  return {
    p,
    cycles: [cycle("right", [0, 4, 16, 20, 30], true), cycle("left", [16, 20, 30, 34, 46], false)],
  };
}

describe("side view metrics on a hand made walk", () => {
  const { p, cycles } = sideScenario();
  const m = viewMetrics(input(p, "side", cycles));

  it("gives the timing of each side and the walk", () => {
    expect(m.stride_time_s?.sides).toEqual({ left: 1, right: 1 });
    expect(m.step_time_s?.sides).toEqual({ left: 0.533, right: 0.467 });
    expect(m.cadence?.value).toBe(120);
    expect(m.cadence?.n).toBe(2);
    expect(m.stance_pct?.sides).toEqual({ left: 60, right: 66.667 });
    expect(m.swing_pct?.sides).toEqual({ left: 40, right: 33.333 });
    expect(m.single_support_s?.sides).toEqual({ left: 0.333, right: 0.4 });
    expect(m.double_support_pct?.value).toBe(26.667);
    expect(m.cadence?.unit).toBe("steps/min");
    expect(m.cadence?.grade).toBe("A");
  });

  it("gives the symmetry ratios as the larger side over the smaller, with each side's ratio to the other", () => {
    expect(m.sr_single_support?.value).toBe(1.2);
    expect(m.sr_single_support?.sides).toEqual({ left: 0.833, right: 1.2 });
    expect(m.sr_stance?.value).toBe(1.111);
    expect(m.sr_step_length?.value).toBe(1.067);
    expect(m.sr_step_length?.sides).toEqual({ left: 1.067, right: 0.938 });
  });

  it("scales step and stride length by the height factor and gives the speed", () => {
    expect(m.step_length_m?.sides).toEqual({ left: 0.64, right: 0.6 });
    expect(m.step_length_m?.value).toBe(0.62);
    expect(m.stride_length_m?.value).toBe(1.17);
    // mean step 0.62 m over mean step time 0.5 s
    expect(m.speed_mps?.value).toBe(1.24);
  });

  it("takes step and stride length from the belt on the pad, and the belt as the speed", () => {
    const pad = viewMetrics(input(p, "pad_side", cycles, { pxPerM: null, beltMps: 1 }));
    expect(pad.step_length_m?.sides).toEqual({ left: 0.516, right: 0.545 });
    expect(pad.stride_length_m?.value).toBe(1);
    expect(pad.speed_mps?.value).toBe(1);
    // no height and no belt: the ratios only
    const none = viewMetrics(input(p, "side", cycles, { pxPerM: null }));
    expect(none.step_length_m).toBeUndefined();
    expect(none.speed_mps).toBeUndefined();
    expect(none.sr_step_length?.value).toBe(1.067);
  });

  it("reads the near limb's knee, thigh, trailing limb and foot pitch only (near limb rule)", () => {
    expect(m.knee_swing_peak?.sides).toEqual({ left: null, right: 25 });
    expect(m.knee_stance_min?.sides).toEqual({ left: null, right: 5 });
    expect(m.knee_loading_peak?.sides).toEqual({ left: null, right: 15 });
    expect(m.thigh_swing_peak?.sides).toEqual({ left: null, right: 40 });
    expect(m.hip_ext_peak?.sides).toEqual({ left: null, right: 20 });
    // TLA = −θT + K/2 for equal segments, largest from k 16 to 20 at k 16: −12 + 5.5, minus −10.
    expect(m.tla_peak?.sides).toEqual({ left: null, right: 3.5 });
    expect(m.foot_pitch_ic?.sides).toEqual({ left: null, right: 12 });
    expect(m.knee_swing_peak?.n).toBe(1);
  });

  it("gives the share of the side's cycles that show each sign (confidenceModel.firing)", () => {
    // knee swing 25 < 45: shown; stance min 5 under the crouch line; loading 15 above 5; pitch 12 above 0.
    expect(m.knee_swing_peak?.share).toEqual({ left: null, right: 1 });
    expect(m.knee_stance_min?.share).toEqual({ left: null, right: 0 });
    expect(m.knee_loading_peak?.share).toEqual({ left: null, right: 0 });
    expect(m.foot_pitch_ic?.share).toEqual({ left: null, right: 0 });
    expect(m.tla_peak?.share).toBeUndefined();
  });

  it("reads the trunk forward against standing and against true vertical, and the near arm's swing", () => {
    expect(m.trunk_incl?.value).toBe(3);
    expect(m.trunk_incl_abs?.value).toBe(4);
    const noRoll = viewMetrics(input(p, "side", cycles, { rollKnown: false }));
    expect(noRoll.trunk_incl_abs).toBeUndefined();
    expect(m.arm_swing?.sides).toEqual({ left: null, right: 0.3 });
  });

  it("grades by the view: the pad's grade for the trailing limb, hyperextension's for a knee past straight", () => {
    expect(m.tla_peak?.grade).toBe("C+");
    const pad = viewMetrics(input(p, "pad_side", cycles, { pxPerM: null, beltMps: 1 }));
    expect(pad.tla_peak?.grade).toBe("C");
    expect(pad.hip_ext_peak).toBeUndefined();
    expect(pad.arm_swing).toBeUndefined();
    expect(m.knee_stance_min?.grade).toBe("A");
  });

  it("reports only timing between 20 and 24 fps, no double support under 25, and nothing under 20", () => {
    const slow = viewMetrics(input(p, "side", cycles, { medianFps: 22 }));
    expect(Object.keys(slow).sort()).toEqual([...TIMING_METRICS].sort());
    expect(slow.double_support_pct).toBeUndefined();
    expect(viewMetrics(input(p, "side", cycles, { medianFps: 19 }))).toEqual({});
    expect(
      viewMetrics(
        input(
          p,
          "side",
          cycles.map((c) => ({ ...c, clean: false })),
        ),
      ),
    ).toEqual({});
  });

  it("leaves the trunk out of cycles whose trunk landmarks failed the gate", () => {
    const noTrunk = viewMetrics(
      input(
        p,
        "side",
        cycles.map((c) => ({ ...c, trunkOk: false })),
      ),
    );
    expect(noTrunk.trunk_incl).toBeUndefined();
    expect(noTrunk.cadence?.value).toBe(120);
  });
});

/**
 * The front view scenario (facing the phone: the left hip on the picture's right), hips 0.1 apart:
 *   right cycle: IC 0, left IC 16, next right IC 30; left cycle: IC 16, right IC 30, next IC 46.
 *   Right single stance window: samples 6 to 14 (35% to 90% of 0 to 16); left: 21 to 28.
 */
function frontScenario(): { p: Prepared; cycles: Cycle[] } {
  const tan = (deg: number) => Math.tan(deg * D2R);
  const p = handSeries(50, (k, put) => {
    let yl = 0.5;
    let yr = 0.5;
    if (k === 10) yl = 0.5 + 0.1 * tan(6); // stance right: the left hip 6 degrees lower
    if (k === 25) yr = 0.5 + 0.1 * tan(3); // stance left: the right hip 3 degrees lower
    if (k === 40) yl = 0.5 - 0.005; // the left (swing) hip higher in the right's stance: a hike
    put(23, 0.55, yl);
    put(24, 0.45, yr);
    // shoulders over the hips, leaning 5 degrees toward the right (picture left) at k 12, 2 toward the left at k 24
    const lean = k === 12 ? -5 : k === 24 ? 2 : 0;
    const sx = 0.5 + 0.4 * tan(lean);
    put(11, sx, 0.1);
    put(12, sx, 0.1);
    // ankles and heels: the right ankle swings out (to the picture's left) by 0.02 at k 25
    const swing = k >= 21 && k <= 30;
    const ry = swing ? 0.9 + ((k - 21) / 9) * 0.05 : 0.9;
    put(28, k === 25 ? 0.44 : 0.46, ry);
    // the left ankle swings straight (k 36 to 46)
    put(27, 0.54, k >= 36 && k <= 46 ? 0.9 + ((k - 36) / 10) * 0.05 : 0.9);
    put(30, 0.44, 0.96);
    put(29, 0.56, 0.96);
  });
  return {
    p,
    cycles: [cycle("right", [0, null, 16, null, 30], false), cycle("left", [16, null, 30, null, 46], false)],
  };
}

describe("front view metrics on a hand made walk", () => {
  const { p, cycles } = frontScenario();
  const m = viewMetrics(input(p, "front", cycles));

  it("gives the timing from ICs only", () => {
    expect(m.cadence?.value).toBe(120);
    expect(m.stride_time_s?.sides).toEqual({ left: 1, right: 1 });
    expect(m.stance_pct).toBeUndefined();
  });

  it("gives the peak pelvic drop and trunk lean of each stance side in its single stance window", () => {
    expect(m.pelvic_drop?.sides).toEqual({ left: 3, right: 6 });
    expect(m.pelvic_drop?.share).toEqual({ left: 0, right: 0 });
    expect(m.trunk_lean_peak?.sides).toEqual({ left: 2, right: 5 });
    expect(m.trunk_lean_peak?.share).toEqual({ left: 1, right: 1 });
    expect(m.pelvic_drop?.grade).toBe("C");
  });

  it("gives the peak to peak lean of each cycle", () => {
    expect(m.trunk_sway_range?.sides).toEqual({ left: 2, right: 7 });
    expect(m.trunk_sway_range?.value).toBe(4.5);
  });

  it("gives the swing ankle's outward path, the hip hike share and the step width", () => {
    expect(m.swing_lateral_path?.sides).toEqual({ left: 0, right: 0.2 });
    expect(m.hip_hike?.sides).toEqual({ left: 1, right: 0 });
    expect(m.hip_hike?.value).toBe(0.5);
    expect(m.hip_hike?.unit).toBe("share");
    expect(m.step_width_ratio?.value).toBe(1.2);
  });

  it("keeps the back view to its metrics (no timing, no swing path)", () => {
    const back = viewMetrics(input(p, "back", cycles));
    expect(Object.keys(back).sort()).toEqual(["pelvic_drop", "trunk_lean_peak", "trunk_sway_range"]);
  });
});
