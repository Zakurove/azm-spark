/**
 * The video of the camera stage (UX spec 4.2): the one camera element of the check, fitted with
 * object-fit contain so framing feedback is truthful, mirrored as a selfie view, with the skeleton
 * (only during setup and calibration, O27), the framing guide (S34c) and the arm marker (S34g1) on
 * top. The box is forced LTR: physical side markers follow the person's own side in the mirrored
 * picture and never flip with RTL. Video never leaves the phone: the element is only drawn here.
 *
 * Tapping anywhere on the video replays the current cue (a target that covers the video).
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { Frame, Landmark } from "../../../engine/types";
import { ArmMarker, FramingGuide } from "./hud";

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
];

export interface CameraVideoProps {
  video: HTMLVideoElement | null;
  /** The last frame and the tracked person's landmarks (null when nobody is locked yet). */
  frame: { current: Frame | null };
  subject: () => Landmark[] | null;
  skeleton: boolean;
  /** A stand in for the camera picture (E2E previews only). */
  picture?: ReactNode;
  guide: { view: "front" | "side" | "oblique"; state: "none" | "adjust" | "ready" } | null;
  armMarker: { side: "left" | "right"; label: string } | null;
  replayLabel: string;
  onReplay(): void;
}

/** The content box of a picture of aspect `a` fitted (contain) into a w × h box. */
export function containBox(w: number, h: number, a: number): { x: number; y: number; w: number; h: number } {
  if (!(a > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w, h };
  if (w / h > a) {
    const cw = h * a;
    return { x: (w - cw) / 2, y: 0, w: cw, h };
  }
  const ch = w / a;
  return { x: 0, y: (h - ch) / 2, w, h: ch };
}

export function CameraVideo(p: CameraVideoProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const opts = useRef(p);
  opts.current = p;

  // The session's one video element is shown here while this screen is up.
  useEffect(() => {
    const v = p.video;
    const h = holder.current;
    if (!v || !h) return;
    h.appendChild(v);
    void v.play?.().catch(() => undefined);
    return () => {
      if (v.parentElement === h) h.removeChild(v);
    };
  }, [p.video]);

  // The skeleton and the guide box follow the picture's content box, redrawn each animation frame.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const b = box.current;
      if (!c || !b) return;
      const w = b.clientWidth;
      const h = b.clientHeight;
      const f = opts.current.frame.current;
      const a = f?.aspect ?? opts.current.video?.videoWidth! / (opts.current.video?.videoHeight || 1);
      const fit = containBox(w, h, a && Number.isFinite(a) ? a : 9 / 16);
      const g = guideRef.current;
      if (g) {
        g.style.left = `${fit.x}px`;
        g.style.top = `${fit.y}px`;
        g.style.width = `${fit.w}px`;
        g.style.height = `${fit.h}px`;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lm = opts.current.skeleton ? opts.current.subject() : null;
      if (!lm) return;
      const style = getComputedStyle(c);
      const ink = style.getPropertyValue("--purple").trim() || "#6c56a5";
      const edge = style.getPropertyValue("--card").trim() || "#ffffff";
      const pt = (k: number) => ({ x: fit.x + lm[k].x * fit.w, y: fit.y + lm[k].y * fit.h });
      const seen = (k: number) => (lm[k]?.visibility ?? 0) >= 0.5;
      ctx.lineCap = "round";
      for (const [line, width] of [
        [edge, 9],
        [ink, 5],
      ] as const) {
        ctx.strokeStyle = line;
        ctx.lineWidth = width;
        for (const [i, j] of BONES) {
          if (!seen(i) || !seen(j)) continue;
          const A = pt(i);
          const B = pt(j);
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = ink;
      for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        if (!seen(k)) continue;
        const P = pt(k);
        ctx.beginPath();
        ctx.arc(P.x, P.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="s34-video" dir="ltr" ref={box}>
      <div className="s34-mirror">
        {p.picture && <div className="s34-picture">{p.picture}</div>}
        <div className="s34-video-holder" ref={holder} />
        <canvas className="s34-skeleton" ref={canvas} aria-hidden="true" />
      </div>
      {p.guide && (
        <div className="s34-guide" ref={guideRef}>
          <FramingGuide view={p.guide.view} state={p.guide.state} />
        </div>
      )}
      {p.armMarker && <ArmMarker side={p.armMarker.side} label={p.armMarker.label} />}
      <button type="button" className="s34-replay" aria-label={p.replayLabel} onClick={p.onReplay} />
    </div>
  );
}
