import { Frame, LM } from "../engine/types";

/**
 * Skeleton overlay renderer — light theme.
 * Draws a human-looking figure: filled torso, neck + head anchored to the ears,
 * tapered limbs with a dark edge for crispness on light backgrounds, and (in
 * demo mode) the furniture that explains the pose — a wheelchair or a chair —
 * so a seated figure reads as a seated person, never as dangling limbs.
 */

export interface OverlayState {
  contextLandmarks: Set<number>;
  flashJoints: Set<number>;
  mirrored: boolean;
  /** demo-mode furniture behind the figure */
  scene?: "wheelchair" | "chair" | null;
}

const BONE = "#E5A917";
const BONE_EDGE = "rgba(92, 74, 12, 0.45)";
const TORSO_FILL = "rgba(232, 183, 56, 0.16)";
const JOINT_OK = "#1F8A50";
const JOINT_FLAG = "#D97B1F";
const DIM = "#C9C2B0";
const FURNITURE = "#A79F8C";

const ARM_BONES: [number, number][] = [
  [LM.l_shoulder, LM.l_elbow],
  [LM.l_elbow, LM.l_wrist],
  [LM.r_shoulder, LM.r_elbow],
  [LM.r_elbow, LM.r_wrist],
];
const LEG_BONES: [number, number][] = [
  [LM.l_hip, LM.l_knee],
  [LM.l_knee, LM.l_ankle],
  [LM.r_hip, LM.r_knee],
  [LM.r_knee, LM.r_ankle],
];

const DRAW_VIS = 0.35; // below this a landmark is not drawn at all

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: Frame, st: OverlayState): void {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  const lm = frame.lm;
  const px = (x: number) => (st.mirrored ? (1 - x) * W : x * W);
  const py = (y: number) => y * H;
  const P = (i: number) => ({ x: px(lm[i].x), y: py(lm[i].y) });
  const seen = (i: number) => lm[i].visibility >= DRAW_VIS;
  const isCtx = (i: number) => st.contextLandmarks.has(i) || lm[i].visibility < 0.5;

  const shMid = { x: (px(lm[LM.l_shoulder].x) + px(lm[LM.r_shoulder].x)) / 2, y: (py(lm[LM.l_shoulder].y) + py(lm[LM.r_shoulder].y)) / 2 };
  const hipMid = { x: (px(lm[LM.l_hip].x) + px(lm[LM.r_hip].x)) / 2, y: (py(lm[LM.l_hip].y) + py(lm[LM.r_hip].y)) / 2 };
  const trunkPx = Math.max(Math.hypot(shMid.x - hipMid.x, shMid.y - hipMid.y), H * 0.1);

  // ---------- furniture (behind everything) ----------
  if (st.scene) drawFurniture(ctx, st.scene, lm, px, py, trunkPx);

  // ---------- torso ----------
  const SL = P(LM.l_shoulder), SR = P(LM.r_shoulder), HR = P(LM.r_hip), HL = P(LM.l_hip);
  if (seen(LM.l_shoulder) && seen(LM.r_shoulder) && lm[LM.l_hip].visibility >= 0.2 && lm[LM.r_hip].visibility >= 0.2) {
    // slight waist taper so the trunk reads as a body, not a box
    const waistL = { x: HL.x + (SL.x - HL.x) * 0.12, y: HL.y };
    const waistR = { x: HR.x + (SR.x - HR.x) * 0.12, y: HR.y };
    ctx.beginPath();
    ctx.moveTo(SL.x, SL.y);
    ctx.lineTo(SR.x, SR.y);
    ctx.quadraticCurveTo(SR.x + (waistR.x - SR.x) * 0.4, (SR.y + waistR.y) / 2, waistR.x, waistR.y);
    ctx.lineTo(waistL.x, waistL.y);
    ctx.quadraticCurveTo(SL.x + (waistL.x - SL.x) * 0.4, (SL.y + waistL.y) / 2, SL.x, SL.y);
    ctx.closePath();
    ctx.fillStyle = TORSO_FILL;
    ctx.fill();
    stroke(ctx, [SL, SR], trunkPx * 0.085, false); // shoulder girdle
    stroke(ctx, [SL, waistL], trunkPx * 0.075, false);
    stroke(ctx, [SR, waistR], trunkPx * 0.075, false);
    stroke(ctx, [waistL, waistR], trunkPx * 0.075, false);
  }

  // ---------- neck + head (anchored to ears, connected to shoulders) ----------
  if (lm[LM.l_ear].visibility >= 0.2 && lm[LM.r_ear].visibility >= 0.2) {
    const earL = P(LM.l_ear), earR = P(LM.r_ear);
    const headC = { x: (earL.x + earR.x) / 2, y: (earL.y + earR.y) / 2 };
    const r = Math.max(Math.hypot(earL.x - earR.x, earL.y - earR.y) * 0.8, trunkPx * 0.2);
    // neck first — the opaque head fill covers its top end
    stroke(ctx, [{ x: headC.x, y: headC.y + r * 0.55 }, { x: shMid.x, y: shMid.y - trunkPx * 0.02 }], trunkPx * 0.06, false);
    // head (opaque fill so nothing shows through the face)
    ctx.beginPath();
    ctx.arc(headC.x, headC.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#F8EFD8";
    ctx.fill();
    ctx.lineWidth = trunkPx * 0.05;
    ctx.strokeStyle = BONE_EDGE;
    ctx.stroke();
    ctx.lineWidth = trunkPx * 0.038;
    ctx.strokeStyle = BONE;
    ctx.stroke();
  }

  // ---------- limbs ----------
  for (const [a, b] of ARM_BONES) {
    if (!seen(a) || !seen(b)) continue;
    stroke(ctx, [P(a), P(b)], trunkPx * (a === LM.l_shoulder || a === LM.r_shoulder ? 0.072 : 0.06), isCtx(a) || isCtx(b));
  }
  for (const [a, b] of LEG_BONES) {
    if (!seen(a) || !seen(b)) continue;
    stroke(ctx, [P(a), P(b)], trunkPx * 0.075, isCtx(a) || isCtx(b));
  }

  // ---------- joints ----------
  const JOINTS = [LM.l_shoulder, LM.r_shoulder, LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist, LM.l_hip, LM.r_hip, LM.l_knee, LM.r_knee, LM.l_ankle, LM.r_ankle];
  for (const i of JOINTS) {
    if (!seen(i)) continue;
    const dim = isCtx(i);
    const flash = st.flashJoints.has(i);
    const { x, y } = P(i);
    const r = dim ? trunkPx * 0.045 : trunkPx * 0.062;
    if (flash) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217, 123, 31, 0.25)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = dim ? DIM : flash ? JOINT_FLAG : JOINT_OK;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, trunkPx * 0.014);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
  }
}

function stroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], w: number, dim: boolean): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  if (dim) {
    ctx.lineWidth = w * 0.8;
    ctx.strokeStyle = DIM;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  ctx.lineWidth = w * 1.35;
  ctx.strokeStyle = BONE_EDGE;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = BONE;
  ctx.stroke();
}

/** Demo-mode furniture, drawn behind the figure so the pose explains itself. */
function drawFurniture(
  ctx: CanvasRenderingContext2D,
  kind: "wheelchair" | "chair",
  lm: Frame["lm"],
  px: (x: number) => number,
  py: (y: number) => number,
  trunkPx: number,
): void {
  const hipL = { x: px(lm[LM.l_hip].x), y: py(lm[LM.l_hip].y) };
  const hipR = { x: px(lm[LM.r_hip].x), y: py(lm[LM.r_hip].y) };
  const hip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const sideView = Math.abs(hipL.x - hipR.x) < trunkPx * 0.3;

  ctx.save();
  ctx.strokeStyle = FURNITURE;
  ctx.fillStyle = FURNITURE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "wheelchair") {
    const R = trunkPx * 0.55; // rear wheel radius
    const seatY = hip.y + trunkPx * 0.1;
    if (sideView) {
      // one large side-view wheel + frame
      const cxw = hip.x - trunkPx * 0.12;
      const cyw = seatY + R * 0.55;
      wheel(ctx, cxw, cyw, R, trunkPx);
      // backrest + seat + front frame + caster + footrest
      ctx.lineWidth = trunkPx * 0.07;
      line(ctx, hip.x - trunkPx * 0.28, seatY - trunkPx * 0.75, hip.x - trunkPx * 0.24, seatY); // backrest
      line(ctx, hip.x - trunkPx * 0.24, seatY, hip.x + trunkPx * 0.55, seatY); // seat
      line(ctx, hip.x + trunkPx * 0.55, seatY, hip.x + trunkPx * 0.62, seatY + R * 0.9); // front drop
      wheel(ctx, hip.x + trunkPx * 0.62, seatY + R * 1.02, R * 0.3, trunkPx);
      line(ctx, hip.x + trunkPx * 0.62, seatY + R * 1.28, hip.x + trunkPx * 0.85, seatY + R * 1.28); // footrest
      // seated legs (stylized): thigh forward, shin down to footrest
      ctx.lineWidth = trunkPx * 0.085;
      ctx.globalAlpha = 0.85;
      line(ctx, hip.x, hip.y, hip.x + trunkPx * 0.5, hip.y + trunkPx * 0.06);
      line(ctx, hip.x + trunkPx * 0.5, hip.y + trunkPx * 0.06, hip.x + trunkPx * 0.58, seatY + R * 1.22);
      ctx.globalAlpha = 1;
    } else {
      // front view: wheels tucked beside the body, seat below the hips, tidy shins
      const wy = seatY + R * 0.42;
      const off = Math.abs(hipR.x - hipL.x) / 2 + trunkPx * 0.3;
      wheel(ctx, hip.x - off, wy, R, trunkPx);
      wheel(ctx, hip.x + off, wy, R, trunkPx);
      ctx.lineWidth = trunkPx * 0.07;
      line(ctx, hipL.x - trunkPx * 0.14, seatY, hipR.x + trunkPx * 0.14, seatY); // seat edge
      // seated shins: short, slightly splayed, resting on the footplate
      ctx.lineWidth = trunkPx * 0.08;
      ctx.globalAlpha = 0.8;
      const footY = seatY + trunkPx * 0.62;
      for (const s of [-1, 1] as const) {
        const kx = hip.x + s * Math.abs(hipR.x - hipL.x) * 0.42;
        line(ctx, kx, seatY + trunkPx * 0.04, kx + s * trunkPx * 0.05, footY);
      }
      ctx.lineWidth = trunkPx * 0.055;
      line(ctx, hip.x - trunkPx * 0.42, footY + trunkPx * 0.04, hip.x + trunkPx * 0.42, footY + trunkPx * 0.04); // footplate
      ctx.globalAlpha = 1;
    }
  } else {
    // simple chair, anchored to the ankles so it stays put while the person rises
    const ankL = { x: px(lm[LM.l_ankle].x), y: py(lm[LM.l_ankle].y) };
    const ankR = { x: px(lm[LM.r_ankle].x), y: py(lm[LM.r_ankle].y) };
    const ank = { x: (ankL.x + ankR.x) / 2, y: (ankL.y + ankR.y) / 2 };
    const seatY = ank.y - trunkPx * 1.0;
    const backX = ank.x - trunkPx * 1.05;
    ctx.lineWidth = trunkPx * 0.09;
    ctx.globalAlpha = 0.95;
    line(ctx, backX, seatY - trunkPx * 0.85, backX, seatY); // backrest
    line(ctx, backX, seatY, backX + trunkPx * 0.85, seatY); // seat
    line(ctx, backX + trunkPx * 0.06, seatY, backX + trunkPx * 0.06, ank.y); // rear leg
    line(ctx, backX + trunkPx * 0.8, seatY, backX + trunkPx * 0.8, ank.y); // front leg
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, trunkPx: number): void {
  ctx.lineWidth = trunkPx * 0.07;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = trunkPx * 0.03;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); // handrim
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = trunkPx * 0.028;
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 7;
    line(ctx, x - Math.cos(a) * r * 0.74, y - Math.sin(a) * r * 0.74, x + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.74);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
