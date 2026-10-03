import { Frame, Landmark, LM, MetricFrame, MetricId } from "./types";

const DEG = 180 / Math.PI;
export const VIS_MIN = 0.5;

/**
 * Aspect ratio to use for a frame: videoWidth ÷ videoHeight. Anything missing
 * or not a positive finite number means 1 (square), which is what synthetic
 * traces and fixtures assume.
 */
export function effectiveAspect(aspect?: number): number {
  return aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/**
 * Normalized landmarks → pixel proportional space (D-003).
 *
 * MediaPipe normalizes x by the image width and y by the image height, so on a
 * non square video one unit of x is not the same physical length as one unit of
 * y. Scaling x by the aspect ratio puts both axes in units of image height,
 * where angles and length ratios equal those in the real pixels.
 *
 * Never mutates the input: returns a scaled copy, or the input array itself when
 * aspect is 1 or undefined. Only x changes: y is already in units of height, and
 * z is not used by any 2D metric. Drawing code must keep using the normalized
 * landmarks, never this output.
 */
export function toPixelSpace(lm: Landmark[], aspect?: number): Landmark[] {
  const a = effectiveAspect(aspect);
  if (a === 1) return lm;
  return lm.map((p) => ({ ...p, x: p.x * a }));
}

function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  // angle ABC in degrees, 2D image plane
  const v1x = a.x - b.x,
    v1y = a.y - b.y;
  const v2x = c.x - b.x,
    v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y),
    m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return Math.acos(cos) * DEG;
}

function mid(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/**
 * Shoulder midpoint to hip midpoint distance, in units of image height.
 * `lm` is normalized; pass the frame's `aspect` so x is scaled first. Code that
 * already holds pixel space landmarks (from `toPixelSpace`) omits `aspect`.
 */
export function trunkLength(lm: Landmark[], aspect?: number): number {
  const px = toPixelSpace(lm, aspect);
  const sh = mid(px[LM.l_shoulder], px[LM.r_shoulder]);
  const hp = mid(px[LM.l_hip], px[LM.r_hip]);
  const d = Math.hypot(sh.x - hp.x, sh.y - hp.y);
  return d > 1e-3 ? d : shoulderWidth(px); // fallback for occluded hips
}

/** Shoulder to shoulder distance, in units of image height. Same `aspect` rule as `trunkLength`. */
export function shoulderWidth(lm: Landmark[], aspect?: number): number {
  const px = toPixelSpace(lm, aspect);
  return Math.max(
    Math.hypot(px[LM.l_shoulder].x - px[LM.r_shoulder].x, px[LM.l_shoulder].y - px[LM.r_shoulder].y),
    1e-3,
  );
}

const vis = (lm: Landmark[], i: number) => lm[i].visibility >= VIS_MIN;

/**
 * Compute the metric set for one smoothed frame.
 * Every angle and length is measured in pixel space: x is scaled by
 * `frame.aspect` on a local copy first (D-003). `frame.lm` is not modified.
 */
export function computeMetrics(frame: Frame, wanted: MetricId[], required: number[]): MetricFrame {
  const lm = toPixelSpace(frame.lm, frame.aspect);
  const usable = lm.map((p) => p.visibility >= VIS_MIN);
  const values: Partial<Record<MetricId, number>> = {};
  const tl = trunkLength(lm);

  const elbowL = () => angleAt(lm[LM.l_shoulder], lm[LM.l_elbow], lm[LM.l_wrist]);
  const elbowR = () => angleAt(lm[LM.r_shoulder], lm[LM.r_elbow], lm[LM.r_wrist]);
  const kneeL = () => angleAt(lm[LM.l_hip], lm[LM.l_knee], lm[LM.l_ankle]);
  const kneeR = () => angleAt(lm[LM.r_hip], lm[LM.r_knee], lm[LM.r_ankle]);

  for (const m of wanted) {
    switch (m) {
      case "elbow_flex_l":
        if (vis(lm, LM.l_elbow) && vis(lm, LM.l_wrist)) values[m] = elbowL();
        break;
      case "elbow_flex_r":
        if (vis(lm, LM.r_elbow) && vis(lm, LM.r_wrist)) values[m] = elbowR();
        break;
      case "elbow_flex_mean": {
        const parts: number[] = [];
        if (vis(lm, LM.l_elbow) && vis(lm, LM.l_wrist)) parts.push(elbowL());
        if (vis(lm, LM.r_elbow) && vis(lm, LM.r_wrist)) parts.push(elbowR());
        if (parts.length) values[m] = parts.reduce((a, b) => a + b) / parts.length;
        break;
      }
      case "knee_flex_l":
        if (vis(lm, LM.l_knee) && vis(lm, LM.l_ankle)) values[m] = kneeL();
        break;
      case "knee_flex_r":
        if (vis(lm, LM.r_knee) && vis(lm, LM.r_ankle)) values[m] = kneeR();
        break;
      case "knee_flex_mean": {
        const parts: number[] = [];
        if (vis(lm, LM.l_knee) && vis(lm, LM.l_ankle)) parts.push(kneeL());
        if (vis(lm, LM.r_knee) && vis(lm, LM.r_ankle)) parts.push(kneeR());
        if (parts.length) values[m] = parts.reduce((a, b) => a + b) / parts.length;
        break;
      }
      case "shoulder_abd_l":
        if (vis(lm, LM.l_elbow)) values[m] = angleAt(lm[LM.l_hip], lm[LM.l_shoulder], lm[LM.l_elbow]);
        break;
      case "shoulder_abd_r":
        if (vis(lm, LM.r_elbow)) values[m] = angleAt(lm[LM.r_hip], lm[LM.r_shoulder], lm[LM.r_elbow]);
        break;
      case "trunk_lean": {
        if (!(vis(lm, LM.l_shoulder) && vis(lm, LM.r_shoulder) && vis(lm, LM.l_hip) && vis(lm, LM.r_hip)))
          break;
        const sh = mid(lm[LM.l_shoulder], lm[LM.r_shoulder]);
        const hp = mid(lm[LM.l_hip], lm[LM.r_hip]);
        // angle of trunk axis vs vertical; y grows downward in image space
        values[m] = Math.atan2(sh.x - hp.x, hp.y - sh.y) * DEG;
        break;
      }
      case "shoulder_hike": {
        if (!(vis(lm, LM.l_shoulder) && vis(lm, LM.r_shoulder))) break;
        values[m] = (lm[LM.r_shoulder].y - lm[LM.l_shoulder].y) / tl;
        break;
      }
      case "arm_asym": {
        if (vis(lm, LM.l_elbow) && vis(lm, LM.r_elbow) && vis(lm, LM.l_wrist) && vis(lm, LM.r_wrist))
          values[m] = Math.abs(elbowL() - elbowR());
        break;
      }
      case "hip_height": {
        if (!(vis(lm, LM.l_hip) && vis(lm, LM.r_hip) && vis(lm, LM.l_ankle) && vis(lm, LM.r_ankle))) break;
        const hp = mid(lm[LM.l_hip], lm[LM.r_hip]);
        const an = mid(lm[LM.l_ankle], lm[LM.r_ankle]);
        values[m] = (an.y - hp.y) / tl; // larger = hips higher above ankles
        break;
      }
      case "wrist_height": {
        // Booth v2 A1: how high the wrists are above the shoulders, in trunk lengths, averaged over
        // the arms whose shoulder and wrist are seen. Resting arms (hands down) read strongly
        // negative, the racked press near zero, arms overhead about one trunk length up.
        const parts: number[] = [];
        if (vis(lm, LM.l_shoulder) && vis(lm, LM.l_wrist)) parts.push(lm[LM.l_shoulder].y - lm[LM.l_wrist].y);
        if (vis(lm, LM.r_shoulder) && vis(lm, LM.r_wrist)) parts.push(lm[LM.r_shoulder].y - lm[LM.r_wrist].y);
        if (parts.length) values[m] = parts.reduce((a, b) => a + b) / parts.length / tl;
        break;
      }
      case "shoulder_span": {
        // Booth v2 A2: the view of the start position (side view for the curl).
        if (!(vis(lm, LM.l_shoulder) && vis(lm, LM.r_shoulder))) break;
        values[m] = shoulderWidth(lm) / tl;
        break;
      }
      case "nose_offset": {
        // S0: the side of the mid shoulder the face is on, which gives the forward direction of a
        // side view at calibration. Horizontal only, as the council wrote it.
        if (!(vis(lm, LM.nose) && vis(lm, LM.l_shoulder) && vis(lm, LM.r_shoulder))) break;
        const sh = mid(lm[LM.l_shoulder], lm[LM.r_shoulder]);
        values[m] = (lm[LM.nose].x - sh.x) / tl;
        break;
      }
    }
  }

  const framingOk = required.every((i) => usable[i]);
  return { t: frame.t, values, usable, framingOk };
}
