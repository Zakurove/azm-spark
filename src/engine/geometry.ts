import { Frame, Landmark, LM, MetricFrame, MetricId } from "./types";

const DEG = 180 / Math.PI;
export const VIS_MIN = 0.5;

function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  // angle ABC in degrees, 2D image plane
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return Math.acos(cos) * DEG;
}

function mid(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(a.visibility, b.visibility) };
}

export function trunkLength(lm: Landmark[]): number {
  const sh = mid(lm[LM.l_shoulder], lm[LM.r_shoulder]);
  const hp = mid(lm[LM.l_hip], lm[LM.r_hip]);
  const d = Math.hypot(sh.x - hp.x, sh.y - hp.y);
  return d > 1e-3 ? d : shoulderWidth(lm); // fallback for occluded hips
}

export function shoulderWidth(lm: Landmark[]): number {
  return Math.max(Math.hypot(lm[LM.l_shoulder].x - lm[LM.r_shoulder].x, lm[LM.l_shoulder].y - lm[LM.r_shoulder].y), 1e-3);
}

const vis = (lm: Landmark[], i: number) => lm[i].visibility >= VIS_MIN;

/** Compute the metric set for one smoothed frame. */
export function computeMetrics(frame: Frame, wanted: MetricId[], required: number[]): MetricFrame {
  const lm = frame.lm;
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
        if (!(vis(lm, LM.l_shoulder) && vis(lm, LM.r_shoulder) && vis(lm, LM.l_hip) && vis(lm, LM.r_hip))) break;
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
    }
  }

  const framingOk = required.every((i) => usable[i]);
  return { t: frame.t, values, usable, framingOk };
}
