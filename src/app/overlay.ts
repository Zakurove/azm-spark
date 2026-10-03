import { Frame, LM } from "../engine/types";
export interface OverlayState {
  contextLandmarks: Set<number>;
  flashJoints: Set<number>;
  mirrored: boolean;
  demo?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  /**
   * How the video fills the screen (booth v2 A7): "cover" is full bleed, "contain" shows the whole
   * frame. The overlay uses the same mapping as the video's object-fit. Default contain.
   */
  fit?: "cover" | "contain";
}

/** The part of a synthetic trace's square frame the figure lives in (head to wheels). */
const DEMO_BOX = { x0: 0.18, y0: 0.06, x1: 0.82, y1: 0.9 };

/**
 * A single projection shared by every joint and connection. Real landmarks follow the video's
 * object-fit (cover or contain). Synthetic traces (demo) fit their figure's box into the screen,
 * anchored toward the top, so the figure stays clear of the bottom panel.
 */
export function projection(
  width: number,
  height: number,
  st: Pick<OverlayState, "demo" | "sourceWidth" | "sourceHeight" | "mirrored" | "fit">,
) {
  if (st.demo) {
    const bw = DEMO_BOX.x1 - DEMO_BOX.x0,
      bh = DEMO_BOX.y1 - DEMO_BOX.y0;
    const scale = Math.min(width / bw, (height * 0.92) / bh);
    const ox = (width - bw * scale) / 2,
      oy = Math.max(0, (height * 0.92 - bh * scale) * 0.25);
    return (x: number, y: number) => ({
      x: ox + ((st.mirrored ? 1 - x : x) - DEMO_BOX.x0) * scale,
      y: oy + (y - DEMO_BOX.y0) * scale,
    });
  }
  const sourceW = st.sourceWidth || width,
    sourceH = st.sourceHeight || height;
  const scale =
    st.fit === "cover"
      ? Math.max(width / sourceW, height / sourceH)
      : Math.min(width / sourceW, height / sourceH);
  const w = sourceW * scale,
    h = sourceH * scale;
  return (x: number, y: number) => ({
    x: (width - w) / 2 + (st.mirrored ? 1 - x : x) * w,
    y: (height - h) / 2 + y * h,
  });
}

const BONES = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const PURPLE = "#8065ad";
const GOLD = "#e8b931";

/**
 * Live video: a light skeleton (soft white bones, white joints ringed in purple; a joint a cue is
 * about glows gold). Demo: a calm mannequin (rounded lavender limbs and a head) on the light stage.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, frame: Frame, st: OverlayState) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  if (!W || !H) return;
  const project = projection(W, H, st),
    p = (i: number) => project(frame.lm[i].x, frame.lm[i].y);
  const seen = (i: number) => frame.lm[i].visibility >= 0.35;
  const u = Math.min(W, H);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (st.demo) {
    drawMannequin(ctx, frame, p, seen, u, st);
    ctx.restore();
    return;
  }
  ctx.shadowColor = "rgba(28, 32, 41, 0.28)";
  ctx.shadowBlur = u * 0.012;
  for (const [a, b] of BONES) {
    if (!seen(a) || !seen(b)) continue;
    const A = p(a),
      B = p(b);
    const dim = st.contextLandmarks.has(a) || st.contextLandmarks.has(b);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = dim ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.78)";
    ctx.lineWidth = Math.max(2, u * 0.008);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const i of JOINTS) {
    if (!seen(i)) continue;
    const q = p(i),
      flag = st.flashJoints.has(i),
      dim = st.contextLandmarks.has(i) || frame.lm[i].visibility < 0.5;
    const radius = Math.max(4, u * 0.0105);
    if (flag) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, radius * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(232, 185, 49, 0.32)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = dim ? "rgba(255, 255, 255, 0.55)" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(2, u * 0.0045);
    ctx.strokeStyle = flag ? GOLD : dim ? "rgba(128, 101, 173, 0.4)" : PURPLE;
    ctx.stroke();
  }
  ctx.restore();
}

function drawMannequin(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  p: (i: number) => { x: number; y: number },
  seen: (i: number) => boolean,
  u: number,
  st: OverlayState,
) {
  const sh = [p(LM.l_shoulder), p(LM.r_shoulder)];
  const hp = [p(LM.l_hip), p(LM.r_hip)];
  const unit = Math.hypot(sh[0].x - sh[1].x, sh[0].y - sh[1].y) || u * 0.15;
  const limb = unit * 0.2;
  const hipMid = { x: (hp[0].x + hp[1].x) / 2, y: (hp[0].y + hp[1].y) / 2 };
  const shMid = { x: (sh[0].x + sh[1].x) / 2, y: (sh[0].y + sh[1].y) / 2 };
  // the seat: a soft shadow on the floor and a simple chair under the hips
  ctx.fillStyle = "rgba(128, 101, 173, 0.1)";
  ctx.beginPath();
  ctx.ellipse(hipMid.x, hipMid.y + unit * 1.55, unit * 1.25, unit * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e4dcef";
  ctx.lineWidth = unit * 0.1;
  ctx.beginPath();
  ctx.moveTo(hipMid.x - unit * 0.75, hipMid.y + unit * 0.12);
  ctx.lineTo(hipMid.x + unit * 0.75, hipMid.y + unit * 0.12);
  ctx.moveTo(hipMid.x - unit * 0.62, hipMid.y + unit * 0.12);
  ctx.lineTo(hipMid.x - unit * 0.62, hipMid.y + unit * 1.5);
  ctx.moveTo(hipMid.x + unit * 0.62, hipMid.y + unit * 0.12);
  ctx.lineTo(hipMid.x + unit * 0.62, hipMid.y + unit * 1.5);
  ctx.stroke();
  // torso and neck: one soft shape, its shadow drawn once
  ctx.shadowColor = "rgba(76, 60, 110, 0.16)";
  ctx.shadowBlur = unit * 0.3;
  ctx.shadowOffsetY = unit * 0.06;
  ctx.beginPath();
  ctx.moveTo(sh[0].x, sh[0].y);
  ctx.lineTo(sh[1].x, sh[1].y);
  ctx.lineTo(hp[1].x, hp[1].y);
  ctx.lineTo(hp[0].x, hp[0].y);
  ctx.closePath();
  ctx.strokeStyle = "#ebe5f4";
  ctx.lineWidth = limb * 1.5;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#ebe5f4";
  ctx.fill();
  const l = p(LM.l_ear),
    r = p(LM.r_ear),
    n = p(LM.nose);
  const head = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(shMid.x, shMid.y);
  ctx.lineTo(head.x, head.y);
  ctx.strokeStyle = "#e6def2";
  ctx.lineWidth = limb * 1.1;
  ctx.stroke();
  // arms and legs
  ctx.shadowColor = "rgba(76, 60, 110, 0.16)";
  for (const [a, b] of BONES) {
    if (a === 11 && b === 12) continue;
    if ((a === 23 && b === 24) || (a === 11 && b === 23) || (a === 12 && b === 24)) continue;
    if (!seen(a) || !seen(b)) continue;
    const A = p(a),
      B = p(b);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = st.contextLandmarks.has(a) || st.contextLandmarks.has(b) ? "#ece8f2" : "#d8cdea";
    ctx.lineWidth = limb;
    ctx.stroke();
  }
  // head
  ctx.beginPath();
  ctx.arc(
    head.x,
    head.y,
    Math.max(unit * 0.32, Math.hypot(n.x - head.x, n.y - head.y) * 1.4),
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "#e9e2f4";
  ctx.fill();
  ctx.shadowColor = "transparent";
  // the hands, gold when a cue is about them
  for (const i of [LM.l_wrist, LM.r_wrist]) {
    if (!seen(i)) continue;
    const q = p(i);
    ctx.beginPath();
    ctx.arc(q.x, q.y, limb * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = st.flashJoints.has(i) ? GOLD : "#b8a5da";
    ctx.fill();
  }
  void frame;
}
