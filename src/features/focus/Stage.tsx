/**
 * The camera stage of the focus check (product v7 contract B3): the check's one video element, fitted
 * whole (contain) and mirrored as a selfie view, with the body's lines drawn over it, the joint being
 * measured in gold. Without a picture (the E2E person, a camera that has not started) the lines are
 * drawn on the page's light. The box is forced LTR, so the mirrored picture never flips with RTL.
 * Video never leaves the phone: the element is only drawn here.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { containBox } from "../assessment/camera/CameraVideo";
import type { Frame } from "../../engine/types";

const BONES: readonly [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
  [27, 29],
  [28, 30],
];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface StageProps {
  video: HTMLVideoElement | null;
  frame: { current: Frame | null };
  /** The landmarks of the movement being measured: drawn in gold. */
  highlight: readonly number[];
  /** Over the picture (the dial, the question). */
  children?: ReactNode;
  /** A smaller stage (the block card's preview). */
  compact?: boolean;
}

export function Stage({ video, frame, highlight, children, compact }: StageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const lit = useRef(new Set(highlight));
  lit.current = new Set(highlight);

  useEffect(() => {
    const v = video;
    const h = holder.current;
    if (!v || !h) return;
    h.appendChild(v);
    void v.play?.().catch(() => undefined);
    return () => {
      if (v.parentElement === h) h.removeChild(v);
    };
  }, [video]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const b = box.current;
      if (!c || !b) return;
      const w = b.clientWidth;
      const h = b.clientHeight;
      const f = frame.current;
      const a = f?.aspect ?? (video?.videoWidth ?? 9) / (video?.videoHeight || 16);
      const fit = containBox(w, h, a && Number.isFinite(a) ? a : 9 / 16);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lm = f?.lm;
      if (!lm) return;
      const pt = (k: number) => ({ x: fit.x + lm[k].x * fit.w, y: fit.y + lm[k].y * fit.h });
      const seen = (k: number) => (lm[k]?.visibility ?? 0) >= 0.5;
      const on = lit.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const [line, width, gold] of [
        ["rgba(255, 255, 255, 0.92)", 11, false],
        ["rgba(128, 101, 173, 0.82)", 6, false],
        ["#e9b52c", 7, true],
      ] as const) {
        ctx.strokeStyle = line;
        ctx.lineWidth = width;
        for (const [i, j] of BONES) {
          if (!seen(i) || !seen(j)) continue;
          if (gold && !(on.has(i) && on.has(j))) continue;
          const A = pt(i);
          const B = pt(j);
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
      }
      for (const k of JOINTS) {
        if (!seen(k)) continue;
        const P = pt(k);
        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.arc(P.x, P.y, on.has(k) ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = on.has(k) ? "#e3ab1f" : "#6c56a5";
        ctx.arc(P.x, P.y, on.has(k) ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, frame]);

  return (
    <div className={`fx-stage${compact ? " is-compact" : ""}`}>
      <div className="fx-stage-box" dir="ltr" ref={box}>
        <div className="fx-stage-mirror">
          <div className="fx-stage-video" ref={holder} />
          <canvas className="fx-stage-lines" ref={canvas} aria-hidden="true" />
        </div>
      </div>
      {children}
    </div>
  );
}
