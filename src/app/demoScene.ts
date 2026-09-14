import { Frame, LM } from "../engine/types";

type Point = { x: number; y: number };
/** Procedural illustration. Every limb endpoint is the scored frame's joint,
 * including low-visibility seated legs. No separate animation clock or assets. */
export function drawDemoScene(ctx: CanvasRenderingContext2D, frame: Frame, kind: "wheelchair" | "chair", mirrored: boolean): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const p = (i: number): Point => ({ x: (mirrored ? 1 - frame.lm[i].x : frame.lm[i].x) * W, y: frame.lm[i].y * H });
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const sh = mid(p(LM.l_shoulder), p(LM.r_shoulder)), hip = mid(p(LM.l_hip), p(LM.r_hip));
  const u = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  const side = Math.abs(p(LM.l_shoulder).x - p(LM.r_shoulder).x) < u * .35;
  const dir = mirrored ? -1 : 1;
  const ink = '#2A2416', skin = '#B97D55';
  function ellipse(x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }
  function grad(x: number, y: number, w: number, a: string, b: string) {
    const g = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y + w * .2); g.addColorStop(0, a); g.addColorStop(1, b); return g;
  }
  function line(a: Point, b: Point, width: number, color: string | CanvasGradient) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.stroke();
  }
  function limb(a: Point, b: Point, width: number, light: string, dark: string) {
    line(a, b, width + u * .012, dark); line(a, b, width, grad(a.x, a.y, width, light, dark));
  }
  function ring(x: number, y: number, rx: number, ry: number, color: string, width: number) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  ctx.save();
  // Quiet architectural backdrop and a soft floor grounding the athlete.
  const floor = kind === 'chair' ? .925 * H : .885 * H;
  const glow = ctx.createRadialGradient(W * .5, H * .45, 0, W * .5, H * .45, H * .7);
  glow.addColorStop(0, '#FFFDF6'); glow.addColorStop(1, '#EDE6D5');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#F7F2E6';
  ctx.beginPath(); ctx.roundRect(W * .5 - H * .37, H * .055, H * .74, H * 1.1, [H * .37, H * .37, 0, 0]); ctx.fill();
  line({ x: 0, y: floor }, { x: W, y: floor }, Math.max(1, H * .001), '#DCD3BF');
  ctx.fillStyle = '#E9E0CB'; ctx.fillRect(0, floor, W, H - floor);
  const shadow = ctx.createRadialGradient(hip.x, floor, 0, hip.x, floor, u * 1.3);
  shadow.addColorStop(0, '#77654438'); shadow.addColorStop(1, '#77654400');
  ellipse(hip.x, floor, u * 1.6, u * .2, shadow);

  const seatY = kind === 'chair' ? H * .67 : hip.y + u * .08;
  const chairX = kind === 'chair' ? W * .43 : hip.x;
  // Lightweight graphite sports chair, warm upholstery, brushed-gold frame.
  const chairWidth = side ? u * .86 : Math.abs(p(LM.r_hip).x - p(LM.l_hip).x) + u * .35;
  if (kind === 'chair') {
    for (const s of [-1, 1]) line({ x: chairX + s * u * .42, y: seatY }, { x: chairX + s * u * .48, y: floor }, u * .055, '#827255');
    ctx.fillStyle = '#B69D68'; ctx.beginPath(); ctx.roundRect(chairX - u * .5, seatY - u * .7, u, u * .5, u * .09); ctx.fill();
  } else {
    const wx = side ? hip.x - dir * u * .15 : hip.x;
    const wy = seatY + u * .48;
    for (const s of (side ? [0] : [-1, 1])) {
      const x = wx + s * (chairWidth / 2 + u * .12), rx = side ? u * .54 : u * .115, ry = u * .57;
      ellipse(x, wy, rx, ry, '#38352C');
      ellipse(x, wy, rx * .79, ry * .88, '#E5DDCB');
      for (let j = 0; j < 10; j++) {
        const a = j / 10 * Math.PI * 2;
        line({ x, y: wy }, { x: x + Math.cos(a) * rx * .76, y: wy + Math.sin(a) * ry * .86 }, u * .009, '#9C927D');
      }
      ring(x, wy, rx * .87, ry * .93, '#C4AA65', u * .022);
      ellipse(x, wy, u * .05, u * .05, ink);
    }
    const backX = side ? hip.x - dir * u * .3 : hip.x - chairWidth / 2;
    ctx.fillStyle = '#575144'; ctx.beginPath(); ctx.roundRect(backX, seatY - u * .68, side ? u * .14 : chairWidth, u * .68, u * .06); ctx.fill();
    const castX = side ? hip.x + dir * u * .67 : hip.x;
    for (const s of (side ? [0] : [-1, 1])) {
      const x = castX + s * chairWidth * .4;
      line({ x, y: seatY }, { x, y: floor - u * .1 }, u * .042, '#8A6D14');
      ellipse(x, floor - u * .08, u * .07, u * .085, ink);
    }
  }
  line({ x: chairX - chairWidth / 2, y: seatY }, { x: chairX + chairWidth / 2, y: seatY }, u * .12, '#454034');

  // Tailored charcoal trousers. Seated legs use the occluded trace joints too.
  for (const ids of [[LM.l_hip, LM.l_knee, LM.l_ankle], [LM.r_hip, LM.r_knee, LM.r_ankle]]) {
    const a = p(ids[0]), b = p(ids[1]), c = p(ids[2]);
    limb(a, b, u * .24, '#58564C', '#302F28');
    limb(b, c, u * .19, '#4C4A40', '#292920');
    line({ x: c.x - u * .07, y: c.y + u * .045 }, { x: c.x + dir * u * .16, y: c.y + u * .045 }, u * .12, '#FDF9EE');
    line({ x: c.x - u * .07, y: c.y + u * .105 }, { x: c.x + dir * u * .17, y: c.y + u * .105 }, u * .035, '#BBA66D');
  }
  // Neck and sculpted jersey, widening the profile silhouette around its joint.
  const head = mid(p(LM.l_ear), p(LM.r_ear));
  limb({ x: head.x, y: head.y + u * .17 }, { x: sh.x, y: sh.y + u * .07 }, u * .18, '#D49B6B', skin);
  const half = side ? u * .24 : Math.abs(p(LM.r_shoulder).x - p(LM.l_shoulder).x) / 2 + u * .08;
  const waist = side ? u * .23 : Math.abs(p(LM.r_hip).x - p(LM.l_hip).x) / 2 + u * .08;
  ctx.beginPath(); ctx.moveTo(sh.x - half, sh.y + u * .03);
  ctx.quadraticCurveTo(sh.x, sh.y - u * .16, sh.x + half, sh.y + u * .03);
  ctx.bezierCurveTo(sh.x + half * .92, sh.y + u * .45, hip.x + waist * .85, hip.y - u * .2, hip.x + waist, hip.y);
  ctx.quadraticCurveTo(hip.x, hip.y + u * .12, hip.x - waist, hip.y);
  ctx.bezierCurveTo(hip.x - waist * .85, hip.y - u * .2, sh.x - half * .92, sh.y + u * .45, sh.x - half, sh.y + u * .03);
  ctx.fillStyle = grad(sh.x, sh.y, half * 2, '#FFE583', '#D9AA2E'); ctx.fill();
  line({ x: hip.x - waist * .82, y: hip.y - u * .03 }, { x: hip.x + waist * .82, y: hip.y - u * .03 }, u * .035, '#BC9021');
  // Collar and a minimal embroidered spark, no additional on-screen wording.
  ctx.beginPath(); ctx.ellipse(sh.x, sh.y - u * .025, u * .13, u * .07, 0, 0, Math.PI); ctx.strokeStyle = '#8A6D14'; ctx.lineWidth = u * .032; ctx.stroke();
  line({ x: sh.x + half * .46, y: sh.y + u * .19 }, { x: sh.x + half * .46 - u * .04, y: sh.y + u * .27 }, u * .018, '#8A6D14');
  // Arms are articulated at the exact shoulder, elbow and wrist landmarks.
  for (const ids of [[LM.l_shoulder, LM.l_elbow, LM.l_wrist], [LM.r_shoulder, LM.r_elbow, LM.r_wrist]]) {
    const a = p(ids[0]), b = p(ids[1]), c = p(ids[2]);
    limb(a, b, u * .17, '#D7A177', '#AE704B');
    const cuff = { x: a.x + (b.x - a.x) * .34, y: a.y + (b.y - a.y) * .34 };
    limb(a, cuff, u * .23, '#FFE482', '#D5A329');
    limb(b, c, u * .135, '#DDA980', '#B97D55');
    ellipse(c.x, c.y, u * .082, u * .095, '#D39A70');
  }
  // Clearly illustrated face, short sculpted hair, subtle features.
  const hr = u * .245;
  ellipse(head.x, head.y, hr * .83, hr * 1.12, grad(head.x, head.y, hr * 2, '#E2AE80', '#B97D55'));
  ellipse(head.x - (side ? dir : 1) * hr * .78, head.y + hr * .07, hr * .2, hr * .29, '#CB9269');
  ctx.beginPath(); ctx.moveTo(head.x - hr * .86, head.y);
  ctx.bezierCurveTo(head.x - hr * 1.04, head.y - hr * 1.54, head.x + hr * .98, head.y - hr * 1.5, head.x + hr * .84, head.y - hr * .05);
  ctx.lineTo(head.x + hr * .55, head.y - hr * .58);
  ctx.quadraticCurveTo(head.x - hr * .05, head.y - hr * .39, head.x - hr * .56, head.y - hr * .6);
  ctx.closePath(); ctx.fillStyle = '#332D24'; ctx.fill();
  if (side) {
    ellipse(head.x + dir * hr * .79, head.y + hr * .19, hr * .25, hr * .2, '#C68B60');
    ellipse(head.x + dir * hr * .47, head.y - hr * .02, hr * .055, hr * .065, ink);
  } else {
    for (const s of [-1, 1]) ellipse(head.x + s * hr * .32, head.y - hr * .04, hr * .052, hr * .065, ink);
  }
  ctx.beginPath(); ctx.moveTo(head.x + (side ? dir * hr * .35 : -hr * .2), head.y + hr * .51); ctx.quadraticCurveTo(head.x + (side ? dir * hr * .5 : 0), head.y + hr * .62, head.x + (side ? dir * hr * .65 : hr * .2), head.y + hr * .5); ctx.strokeStyle = '#89583D'; ctx.lineWidth = u * .011; ctx.stroke();
  ctx.restore();
}
