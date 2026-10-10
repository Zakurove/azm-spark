/**
 * The camera stage of the focus check (product v7 contract B3): the check's one video element, fitted
 * whole (contain) and mirrored as a selfie view, with the body's lines drawn over it, the joint being
 * measured in gold. Without a picture (the E2E person, a camera that has not started) the lines are
 * drawn on the page's light. The box is forced LTR, so the mirrored picture never flips with RTL.
 * Video never leaves the phone: the element is only drawn here.
 *
 * D-036 item 5: the lines are the steady skeleton (src/app/skeleton.ts), smoothed with the v1
 * camera exercise's filter, one person followed, joints fading rather than jumping. They are drawn on
 * a canvas from a requestAnimationFrame loop; each camera frame is fed to the skeleton once, and the
 * box's size is read only when it changes (a ResizeObserver), so no frame forces a layout.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { containBox } from "../assessment/camera/CameraVideo";
import { drawSkeleton, SteadySkeleton } from "../../app/skeleton";
import type { Frame } from "../../engine/types";

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
  const lit = useRef<ReadonlySet<number>>(new Set(highlight));
  const key = highlight.join(",");
  const litKey = useRef(key);
  if (litKey.current !== key) {
    litKey.current = key;
    lit.current = new Set(highlight);
  }
  const small = useRef(!!compact);
  small.current = !!compact;

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
    const b = box.current;
    const size = { w: b?.clientWidth ?? 0, h: b?.clientHeight ?? 0 };
    const observer =
      b && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (r) {
              size.w = r.width;
              size.h = r.height;
            }
          })
        : null;
    if (b) observer?.observe(b);
    const skeleton = new SteadySkeleton();
    let raf = 0;
    let painted = false;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c || !b) return;
      // Without a ResizeObserver (old browsers) the size is read each frame, as before.
      if (!observer) {
        size.w = b.clientWidth;
        size.h = b.clientHeight;
      }
      const { w, h } = size;
      const f = frame.current;
      if (f) skeleton.push(f);
      const pose = skeleton.pose(now);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      const resized = c.width !== cw || c.height !== ch;
      if (resized) {
        c.width = cw;
        c.height = ch;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      if (!pose) {
        // Nothing to show: clear once, then leave the canvas alone.
        if (painted || resized) ctx.clearRect(0, 0, cw, ch);
        painted = false;
        return;
      }
      const a = f?.aspect ?? (video?.videoWidth ?? 9) / (video?.videoHeight || 16);
      const fit = containBox(w, h, a && Number.isFinite(a) ? a : 9 / 16);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawSkeleton(ctx, pose, (x, y) => ({ x: fit.x + x * fit.w, y: fit.y + y * fit.h }), {
        highlight: lit.current,
        compact: small.current,
      });
      painted = true;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
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
