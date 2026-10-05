/**
 * The metrics of one gait view (product v7 contract 2.8; gait-rules 3.4), from its clean cycles.
 * Pure, no DOM.
 *
 * Per cycle (a cycle of side X runs from X's IC to X's next IC; side views hold the other side's TO
 * and IC and X's TO between):
 *   stride_time_s      X's IC to X's next IC
 *   step_time_s        the step ending the cycle: the other side's IC to X's next IC
 *   stance_pct         IC to TO over the stride; swing_pct TO to the next IC over the stride
 *   single_support_s   the other side's TO to its IC (its swing)
 *   double_support_pct IC to the other side's TO plus the other side's IC to TO, over the stride
 *   step_length_m      d·(X heel − other heel) at X's next IC, scaled (gait-rules 3.5); stride_length_m
 *                      the cycle's two steps (the pad: belt speed times the stride time)
 *   knee_swing_peak    max knee flexion from TO to the next IC
 *   knee_stance_min    min knee flexion from the other side's TO to its IC (single support)
 *   knee_loading_peak  max knee flexion from IC to the other side's TO
 *   tla_peak           max trailing limb angle from the other side's IC to TO, minus standing
 *   hip_ext_peak       minus the min thigh angle in stance (IC to TO)
 *   thigh_swing_peak   max thigh angle from TO to the next IC
 *   foot_pitch_ic      foot pitch at IC, minus standing
 *   trunk_incl         mean trunk inclination over the cycle, minus standing; trunk_incl_abs the same
 *                      against true vertical (the phone roll known), not zeroed
 *   arm_swing          fore and aft range of the wrist relative to the shoulder over the cycle, over
 *                      the standing arm length (side view, near arm)
 * Front views (IC only), with X's single stance window at 35% to 90% of X's IC to the other side's IC,
 * and X's swing in the other side's window:
 *   pelvic_drop        peak drop of the swing side's hip in X's window, minus standing
 *   trunk_lean_peak    peak lean toward X in X's window, minus standing
 *   trunk_sway_range   peak to peak lateral lean over the cycle
 *   swing_lateral_path max outward ankle path in X's swing from the line between its window start
 *                      (standing in for TO) and its next IC, over the hip width
 *   hip_hike           X's hip higher than the stance side's at mid swing (obliquity reversed)
 *   step_width_ratio   heel to heel distance across the picture at X's next IC, over the hip width
 * Aggregation: a side's median ("sides"), and the median over both sides' cycles ("value"); the trunk
 * inclinations are means; cadence, speed and double support are whole walk values; symmetry ratios
 * are the larger side's median over the smaller's ("value") with each side's median over the other's
 * ("sides", so the larger side reads above 1). Near limb rule: the knee, thigh, trailing limb, foot
 * pitch and arm metrics of a side view come only from cycles whose side was nearest the phone.
 */
import {
  DOUBLE_SUPPORT_MIN_FPS,
  GAIT_ENGINE,
  SHARE_SIGNS,
  UNIT_BOUNDS,
  metricDef,
  metricInView,
} from "./params";
import type { Cycle } from "./cycles";
import { dropAt, kneeAt, leanAt, leftOnRight, pitchAt, thighAt, tlaAt, trunkAt } from "./kinematics";
import type { Motion } from "./passes";
import { LEG, type Prepared } from "./preprocess";
import { padLengths, singleSupport, stanceTime, type CycleTimes } from "./spatiotemporal";
import type { StandingZeros } from "./standing";
import type { GaitMetricId, GaitMetricValue, GaitView } from "./types";
import { mean, median, other, r3, type LimbSide } from "./util";

/** The metrics a 20 to 24 fps view reports: «timing and cadence only». */
export const TIMING_METRICS: readonly GaitMetricId[] = [
  "cadence",
  "step_time_s",
  "stride_time_s",
  "stance_pct",
  "swing_pct",
  "single_support_s",
  "sr_single_support",
  "sr_stance",
];

export interface MetricInput {
  p: Prepared;
  view: GaitView;
  motion: Motion;
  cycles: readonly Cycle[];
  zeros: StandingZeros;
  /** Overground side: pixels (units of the picture height) per metre, from the height; else null. */
  pxPerM: number | null;
  /** Walking pad: belt speed in m/s; else null. */
  beltMps: number | null;
  /** The phone roll is known (trunk_incl_abs). */
  rollKnown: boolean;
  /** The view's processed frame rate, the mean over its frames (GaitQuality.medianFps, D-026 item 6). */
  fps: number;
}

type Sided = Record<LimbSide, number[]>;
const sided = (): Sided => ({ left: [], right: [] });

/** A value that is a finite number, or nothing. */
function push(xs: number[], v: number | null | undefined): void {
  if (v !== null && v !== undefined && Number.isFinite(v)) xs.push(v);
}

function over(a: number, b: number, f: (k: number) => number, pick: "max" | "min" | "mean"): number | null {
  const xs: number[] = [];
  for (let k = Math.max(0, a); k <= b; k++) push(xs, f(k));
  if (!xs.length) return null;
  if (pick === "mean") return mean(xs);
  return pick === "max" ? Math.max(...xs) : Math.min(...xs);
}

function gradeOf(id: GaitMetricId, view: GaitView, sideMedians: (number | null)[]): GaitMetricValue["grade"] {
  const def = metricDef(id);
  if (id === "knee_stance_min" && def.gradeHyperextension && sideMedians.some((m) => m !== null && m < 0))
    return def.gradeHyperextension;
  if ((view === "pad_side" || view === "pad_front") && def.gradePad) return def.gradePad;
  if ((view === "front" || view === "back" || view === "pad_front") && def.gradeFront) return def.gradeFront;
  return def.grade;
}

/** Whether a per cycle value shows the metric's sign (SHARE_SIGNS), given its side's median. */
function signShown(id: GaitMetricId, v: number, sideMedian: number): boolean | null {
  switch (id) {
    case "knee_swing_peak":
      return v < SHARE_SIGNS.knee_swing_peak.below;
    case "knee_stance_min":
      return sideMedian >= 0
        ? v >= SHARE_SIGNS.knee_stance_min.atOrAbove
        : -v >= SHARE_SIGNS.knee_stance_min.hyperextensionAtOrAbove;
    case "knee_loading_peak":
      return v <= SHARE_SIGNS.knee_loading_peak.atOrBelow;
    case "pelvic_drop":
      return v >= SHARE_SIGNS.pelvic_drop.atOrAbove;
    case "trunk_sway_range":
      return v >= SHARE_SIGNS.trunk_sway_range.atOrAbove;
    case "trunk_lean_peak":
      return v > 0;
    case "foot_pitch_ic":
      return v <= SHARE_SIGNS.foot_pitch_ic.atOrBelow;
    default:
      return null;
  }
}

/** The values a metric's unit allows (section 4 bounds); anything else came from broken tracking. */
function bounded(id: GaitMetricId, xs: number[]): number[] {
  const b = UNIT_BOUNDS[metricDef(id).unit ?? ""];
  return b ? xs.filter((x) => x >= b[0] && x <= b[1]) : xs;
}

function perSide(id: GaitMetricId, view: GaitView, raw: Sided): GaitMetricValue | null {
  const v: Sided = { left: bounded(id, raw.left), right: bounded(id, raw.right) };
  const all = [...v.left, ...v.right];
  if (!all.length) return null;
  const mL = median(v.left);
  const mR = median(v.right);
  const out: GaitMetricValue = {
    id,
    value: r3(median(all)!),
    sides: { left: mL === null ? null : r3(mL), right: mR === null ? null : r3(mR) },
    n: all.length,
    unit: metricDef(id).unit ?? "",
    grade: gradeOf(id, view, [mL, mR]),
  };
  const shareOf = (xs: number[], m: number | null): number | null => {
    if (m === null || !xs.length) return null;
    const shown = xs.map((x) => signShown(id, x, m));
    if (shown.some((s) => s === null)) return null;
    return r3(shown.filter(Boolean).length / xs.length);
  };
  const sL = shareOf(v.left, mL);
  const sR = shareOf(v.right, mR);
  if (sL !== null || sR !== null) out.share = { left: sL, right: sR };
  return out;
}

function whole(
  id: GaitMetricId,
  view: GaitView,
  value: number | null,
  n: number,
  sides?: Sided,
): GaitMetricValue | null {
  if (value === null || !Number.isFinite(value) || n <= 0 || !bounded(id, [value]).length) return null;
  const out: GaitMetricValue = {
    id,
    value: r3(value),
    n,
    unit: metricDef(id).unit ?? "",
    grade: gradeOf(id, view, []),
  };
  if (sides) {
    const mL = median(bounded(id, sides.left));
    const mR = median(bounded(id, sides.right));
    out.sides = { left: mL === null ? null : r3(mL), right: mR === null ? null : r3(mR) };
  }
  return out;
}

/** larger ÷ smaller of the two sides' medians, with each side's median over the other's. */
function symmetry(id: GaitMetricId, view: GaitView, v: Sided): GaitMetricValue | null {
  const mL = median(v.left);
  const mR = median(v.right);
  if (mL === null || mR === null || !(mL > 0) || !(mR > 0)) return null;
  if (bounded(id, [mL / mR, mR / mL]).length < 2) return null;
  return {
    id,
    value: r3(Math.max(mL / mR, mR / mL)),
    sides: { left: r3(mL / mR), right: r3(mR / mL) },
    n: v.left.length + v.right.length,
    unit: metricDef(id).unit ?? "",
    grade: gradeOf(id, view, []),
  };
}

/** A cycle's event times in seconds, sub-frame (CG-21), or null without the other side's events or its TO. */
const times = (c: Cycle): CycleTimes | null => {
  const { ic, oppTo, oppIc, to, icEnd } = c.times;
  return oppTo === null || oppIc === null || to === null ? null : { ic, oppTo, oppIc, to, icEnd };
};

/** Every metric of the view that its cycles, calibration and scale give (contract 2.8 GaitViewResult.metrics). */
export function viewMetrics(m: MetricInput): Partial<Record<GaitMetricId, GaitMetricValue>> {
  const { view, cycles } = m;
  const clean = cycles.filter((c) => c.clean);
  const out: Partial<Record<GaitMetricId, GaitMetricValue>> = {};
  if (m.fps < GAIT_ENGINE.recordAgainBelowFps || !clean.length) return out;
  const timingOnly = m.fps < GAIT_ENGINE.fullFps;
  const put = (id: GaitMetricId, v: GaitMetricValue | null) => {
    if (!v || !metricInView(id, view)) return;
    if (timingOnly && !TIMING_METRICS.includes(id)) return;
    if (id === "double_support_pct" && m.fps < DOUBLE_SUPPORT_MIN_FPS) return;
    out[id] = v;
  };

  const stride = sided();
  const step = sided();
  for (const c of clean) {
    push(stride[c.side], c.times.icEnd - c.times.ic);
    if (c.times.oppIc !== null) push(step[c.side], c.times.icEnd - c.times.oppIc);
  }
  const stepTimes = [...step.left, ...step.right];
  const stepSum = stepTimes.reduce((a, b) => a + b, 0);
  put(
    "cadence",
    whole("cadence", view, stepSum > 0 ? (60 * stepTimes.length) / stepSum : null, stepTimes.length),
  );
  put("step_time_s", perSide("step_time_s", view, step));
  put("stride_time_s", perSide("stride_time_s", view, stride));

  const side = view === "side" || view === "pad_side";
  if (side) sideMetrics(m, clean, put);
  else frontMetrics(m, clean, put);
  return out;
}

type Put = (id: GaitMetricId, v: GaitMetricValue | null) => void;

function sideMetrics(m: MetricInput, clean: readonly Cycle[], put: Put): void {
  const { p, view, zeros, motion } = m;
  const s = p.series;
  const stancePct = sided();
  const swingPct = sided();
  const single = sided();
  const stanceSec = sided();
  const double: number[] = [];
  const stepPx = sided();
  const stepM = sided();
  const strideM: number[] = [];
  const knSwing = sided();
  const knStance = sided();
  const knLoad = sided();
  const tla = sided();
  const hipExt = sided();
  const thigh = sided();
  const pitch = sided();
  const arm = sided();
  const trunk: number[] = [];
  const trunkAbs: number[] = [];

  for (const c of clean) {
    const T = times(c);
    if (!T || c.kOppIc === null || c.kOppTo === null || c.kTo === null) continue;
    const d = motion.passes[c.pass].d;
    const X = c.side;
    const O = other(X);
    const strideSec = T.icEnd - T.ic;
    push(stancePct[X], (stanceTime(T) / strideSec) * 100);
    push(swingPct[X], ((T.icEnd - T.to) / strideSec) * 100);
    push(single[X], singleSupport(T));
    push(stanceSec[X], stanceTime(T));
    push(double, ((stanceTime(T) - singleSupport(T)) / strideSec) * 100);

    // Step and stride length: the heel separations at the cycle's two ICs.
    const sep = d * (s.x[LEG[X].heel][c.k1] - s.x[LEG[O].heel][c.k1]);
    const sepOpp = d * (s.x[LEG[O].heel][c.kOppIc] - s.x[LEG[X].heel][c.kOppIc]);
    if (sep > 0) push(stepPx[X], sep);
    if (m.beltMps !== null) {
      const L = padLengths(m.beltMps, strideSec, sepOpp, sep);
      if (L) {
        push(stepM[X], L.step);
        push(strideM, L.stride);
      }
    } else if (m.pxPerM !== null && sep > 0) {
      push(stepM[X], sep / m.pxPerM);
      if (sepOpp > 0) push(strideM, (sep + sepOpp) / m.pxPerM);
    }

    if (c.near) {
      const K = (k: number) => kneeAt(s, X, k, d);
      push(knSwing[X], over(c.kTo, c.k1, K, "max"));
      push(knStance[X], over(c.kOppTo, c.kOppIc, K, "min"));
      push(knLoad[X], over(c.k0, c.kOppTo, K, "max"));
      const tla0 = zeros.tla[X];
      if (tla0 !== null) {
        const peak = over(c.kOppIc, c.kTo, (k) => tlaAt(s, X, k, d), "max");
        push(tla[X], peak === null ? null : peak - tla0);
      }
      const minThigh = over(c.k0, c.kTo, (k) => thighAt(s, X, k, d), "min");
      push(hipExt[X], minThigh === null ? null : -minThigh);
      push(
        thigh[X],
        over(c.kTo, c.k1, (k) => thighAt(s, X, k, d), "max"),
      );
      const p0 = zeros.pitch[X];
      if (p0 !== null) push(pitch[X], pitchAt(s, X, c.k0, d) - p0);
      const armLen = zeros.armLength[X];
      if (armLen !== null && armLen > 0) {
        const fore = (k: number) => d * (s.x[LEG[X].wrist][k] - s.x[LEG[X].shoulder][k]);
        const hi = over(c.k0, c.k1, fore, "max");
        const lo = over(c.k0, c.k1, fore, "min");
        if (hi !== null && lo !== null) push(arm[X], (hi - lo) / armLen);
      }
    }
    if (c.trunkOk) {
      const meanIncl = over(c.k0, c.k1, (k) => trunkAt(s, k, d), "mean");
      if (meanIncl !== null) {
        if (zeros.trunk !== null) push(trunk, meanIncl - zeros.trunk);
        if (m.rollKnown) push(trunkAbs, meanIncl);
      }
    }
  }

  put("stance_pct", perSide("stance_pct", view, stancePct));
  put("swing_pct", perSide("swing_pct", view, swingPct));
  put("single_support_s", perSide("single_support_s", view, single));
  put("double_support_pct", whole("double_support_pct", view, median(double), double.length));
  put("sr_single_support", symmetry("sr_single_support", view, single));
  put("sr_stance", symmetry("sr_stance", view, stanceSec));
  put("sr_step_length", symmetry("sr_step_length", view, stepPx));
  put("step_length_m", perSide("step_length_m", view, stepM));
  put("stride_length_m", whole("stride_length_m", view, median(strideM), strideM.length));
  // speed: the belt on the pad; overground, the mean step length over the mean step time.
  const steps = [...stepM.left, ...stepM.right];
  if (m.beltMps !== null) put("speed_mps", whole("speed_mps", view, m.beltMps, steps.length || clean.length));
  else if (steps.length) {
    const stepSec: number[] = [];
    for (const c of clean)
      if (c.kOppIc !== null) {
        const d = motion.passes[c.pass].d;
        const sep = d * (s.x[LEG[c.side].heel][c.k1] - s.x[LEG[other(c.side)].heel][c.k1]);
        if (sep > 0 && c.times.oppIc !== null) stepSec.push(c.times.icEnd - c.times.oppIc);
      }
    const ms = mean(steps);
    const mt = mean(stepSec);
    put("speed_mps", whole("speed_mps", view, ms !== null && mt ? ms / mt : null, steps.length));
  }
  put("knee_swing_peak", perSide("knee_swing_peak", view, knSwing));
  put("knee_stance_min", perSide("knee_stance_min", view, knStance));
  put("knee_loading_peak", perSide("knee_loading_peak", view, knLoad));
  put("tla_peak", perSide("tla_peak", view, tla));
  put("hip_ext_peak", perSide("hip_ext_peak", view, hipExt));
  put("thigh_swing_peak", perSide("thigh_swing_peak", view, thigh));
  put("foot_pitch_ic", perSide("foot_pitch_ic", view, pitch));
  put("trunk_incl", whole("trunk_incl", view, mean(trunk), trunk.length));
  put("trunk_incl_abs", whole("trunk_incl_abs", view, mean(trunkAbs), trunkAbs.length));
  put("arm_swing", perSide("arm_swing", view, arm));
}

function frontMetrics(m: MetricInput, clean: readonly Cycle[], put: Put): void {
  const { p, view, zeros } = m;
  const s = p.series;
  const [w0, w1] = GAIT_ENGINE.singleStanceWindow;
  const drop = sided();
  const lean = sided();
  const sway = sided();
  const lateral = sided();
  const hike = sided();
  const width: number[] = [];
  const widthSides = sided();
  for (const c of clean) {
    if (c.kOppIc === null) continue;
    const X = c.side;
    const O = other(X);
    const a = c.k0 + w0 * (c.kOppIc - c.k0);
    const b = c.k0 + w1 * (c.kOppIc - c.k0);
    const sa = c.kOppIc + w0 * (c.k1 - c.kOppIc);
    const sb = c.kOppIc + w1 * (c.k1 - c.kOppIc);
    const d0 = zeros.drop[X];
    if (d0 !== null) {
      const peak = over(Math.ceil(a), Math.floor(b), (k) => dropAt(s, X, k), "max");
      push(drop[X], peak === null ? null : peak - d0);
    }
    if (c.trunkOk) {
      const toward = X === "left" ? 1 : -1;
      const leanLeft = (k: number) => leanAt(s, k) * leftOnRight(s, k);
      if (zeros.leanLeft !== null) {
        const z = zeros.leanLeft;
        push(
          lean[X],
          over(Math.ceil(a), Math.floor(b), (k) => toward * (leanLeft(k) - z), "max"),
        );
      }
      const hi = over(c.k0, c.k1, leanLeft, "max");
      const lo = over(c.k0, c.k1, leanLeft, "min");
      if (hi !== null && lo !== null) push(sway[X], hi - lo);
    }
    const hipWidth = median(rangeOf(c.k0, c.k1).map((k) => Math.abs(s.x[23][k] - s.x[24][k])));
    if (hipWidth !== null && hipWidth > 0) {
      // X's swing, from the start of the other side's window (standing in for X's TO) to X's next IC:
      // the ankle's largest outward distance from the straight line between those two positions (a
      // straight path on the floor stays a straight line in the picture, whatever its depth).
      const k0 = Math.ceil(sa);
      const ax = LEG[X].ankle;
      const ox = s.x[ax][k0];
      const oy = s.y[ax][k0];
      const ux = s.x[ax][c.k1] - ox;
      const uy = s.y[ax][c.k1] - oy;
      const span = Math.hypot(ux, uy);
      if (span > 0 && c.k1 > k0) {
        // The normal of the line that points to X's own side of the picture.
        const sideX = (X === "left" ? 1 : -1) * leftOnRight(s, c.k1);
        let nx = -uy / span;
        let ny = ux / span;
        if (Math.sign(nx) !== sideX) {
          nx = -nx;
          ny = -ny;
        }
        const dev = over(k0, c.k1, (k) => (s.x[ax][k] - ox) * nx + (s.y[ax][k] - oy) * ny, "max");
        if (dev !== null) push(lateral[X], Math.max(0, dev) / hipWidth);
      }
      // Step width at the other side's IC: its heel's distance across the picture from X's contact
      // line (X's heel at the cycle's two ICs) at the same picture row, so at the same depth on the
      // floor; on the pad, where X lands at one place, from the mean of X's two contacts.
      const hx = LEG[X].heel;
      const ho = LEG[O].heel;
      const [x0, y0, x2, y2] = [s.x[hx][c.k0], s.y[hx][c.k0], s.x[hx][c.k1], s.y[hx][c.k1]];
      const [x1, y1] = [s.x[ho][c.kOppIc], s.y[ho][c.kOppIc]];
      const between = (y1 - y0) * (y1 - y2) < 0;
      const lineX = between ? x0 + ((y1 - y0) / (y2 - y0)) * (x2 - x0) : (x0 + x2) / 2;
      const ratio = Math.abs(x1 - lineX) / Math.abs(s.x[23][c.kOppIc] - s.x[24][c.kOppIc]);
      if (Number.isFinite(ratio)) {
        width.push(ratio);
        widthSides[O].push(ratio);
      }
    }
    const dO = zeros.drop[O];
    if (dO !== null) {
      const mid = Math.round((sa + sb) / 2);
      const v = dropAt(s, O, mid);
      if (Number.isFinite(v)) hike[X].push(v - dO < 0 ? 1 : 0);
    }
  }
  put("pelvic_drop", perSide("pelvic_drop", view, drop));
  put("trunk_lean_peak", perSide("trunk_lean_peak", view, lean));
  put("trunk_sway_range", perSide("trunk_sway_range", view, sway));
  put("swing_lateral_path", perSide("swing_lateral_path", view, lateral));
  const hikeAll = [...hike.left, ...hike.right];
  put(
    "hip_hike",
    whole("hip_hike", view, mean(hikeAll), hikeAll.length, {
      left: hike.left.length ? [mean(hike.left)!] : [],
      right: hike.right.length ? [mean(hike.right)!] : [],
    }),
  );
  put("step_width_ratio", whole("step_width_ratio", view, median(width), width.length, widthSides));
}

function rangeOf(a: number, b: number): number[] {
  const out: number[] = [];
  for (let k = a; k <= b; k++) out.push(k);
  return out;
}
