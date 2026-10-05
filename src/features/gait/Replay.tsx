/**
 * The skeleton replay of one step cycle (product v7 plan 2.5 «a short skeleton replay of one step
 * cycle (no video is stored)»; contract 2.8 ReplayCycle): the one cycle the analysis keeps, 15 frames
 * a second, drawn as the body's lines on the page's light, the cycle's side in gold. It loops softly;
 * with reduced motion it shows the cycle's middle frame, still. Nothing but the stored points is drawn.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayCycle } from "../../engine/gait/types";

/** The bones the replay draws (MediaPipe ids), each with the side it belongs to, if any. */
const BONES: readonly [number, number, "left" | "right" | null][] = [
  [11, 12, null],
  [11, 23, "left"],
  [12, 24, "right"],
  [23, 24, null],
  [11, 13, "left"],
  [13, 15, "left"],
  [12, 14, "right"],
  [14, 16, "right"],
  [23, 25, "left"],
  [25, 27, "left"],
  [27, 29, "left"],
  [29, 31, "left"],
  [27, 31, "left"],
  [24, 26, "right"],
  [26, 28, "right"],
  [28, 30, "right"],
  [30, 32, "right"],
  [28, 32, "right"],
];

function reducedMotion(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The drawing box of a cycle: every frame's points, with a margin. */
export function replayBox(cycle: ReplayCycle): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of cycle.frames)
    for (const [x, y] of f) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!(x1 > x0 && y1 > y0)) return null;
  const m = 0.08 * (y1 - y0);
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

export function Replay({ cycle, label }: { cycle: ReplayCycle; label: string }) {
  const box = useMemo(() => replayBox(cycle), [cycle]);
  const index = useMemo(() => new Map(cycle.landmarks.map((id, i) => [id, i])), [cycle]);
  const still = Math.floor(cycle.frames.length / 2);
  const [frame, setFrame] = useState(still);
  const raf = useRef(0);
  useEffect(() => {
    if (reducedMotion() || cycle.frames.length < 2) return;
    const start = performance.now();
    const step = 1000 / cycle.fps;
    const tick = (now: number) => {
      // The cycle, then a breath of stillness, then again.
      const n = cycle.frames.length;
      const k = Math.floor((now - start) / step) % (n + 8);
      setFrame(Math.min(k, n - 1));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [cycle]);
  if (!box) return null;
  const pts = cycle.frames[frame] ?? cycle.frames[still];
  const at = (id: number): [number, number] | null => {
    const i = index.get(id);
    const p = i === undefined ? undefined : pts[i];
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
  };
  const stroke = box.h / 60;
  return (
    <svg
      className="gx-replay"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        x1={box.x}
        x2={box.x + box.w}
        y1={box.y + box.h * 0.94}
        y2={box.y + box.h * 0.94}
        className="gx-replay-floor"
        strokeWidth={stroke * 0.6}
      />
      {BONES.map(([a, b, side]) => {
        const p = at(a);
        const q = at(b);
        if (!p || !q) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={p[0]}
            y1={p[1]}
            x2={q[0]}
            y2={q[1]}
            className={side === cycle.side ? "gx-bone is-side" : "gx-bone"}
            strokeWidth={side === cycle.side ? stroke * 1.25 : stroke}
          />
        );
      })}
      {(() => {
        const head = at(0);
        return head ? <circle cx={head[0]} cy={head[1]} r={stroke * 2.2} className="gx-head" /> : null;
      })()}
    </svg>
  );
}
