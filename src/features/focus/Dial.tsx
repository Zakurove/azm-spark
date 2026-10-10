/**
 * The range meter of a movement (D-036 item 4, replacing the numbered dial of product v7 plan 1.5): a
 * picture to take in at a glance from 2 m, with no number at all on the live screen. A half circle is
 * the movement's range; the typical band for the person's age and sex is softly shaded in gold on it;
 * a marker shows where the person is now, the purple line filling behind it; while the person holds,
 * a ring around the marker fills and the word «اثبت» shows in the middle, and a full ring turns gold
 * with a check; in the typical band the band brightens and the marker turns gold. The arc starts at
 * the reading side (mirrored in Arabic).
 *
 *   - live: the angle and the hold are read each animation frame (`read`), and the marker, the line
 *     and the ring move by attributes written from requestAnimationFrame, eased, never by React state
 *     at frame rate (smooth at 30 fps on a phone);
 *   - held: the question's held position, still, the ring full;
 *   - final: the result: the marker settles at the value; the degrees may show, small, under it.
 *
 * The band is the grade's within normal band (rom-norms gradeBand): from withinFrom up for flexion and
 * signed movements, from 0 to withinUpTo for the lack movements (the degrees short of straight, where
 * the marker moving toward the start is the person straightening). The scale ends at a round number
 * above the typical value and the band (scaleMax), and grows smoothly if the person goes past it.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import type { RomKind } from "../../movements/rom/types";

/** Round steps of the scale's end. */
const STEPS = [30, 45, 60, 90, 120, 150, 180];

/** The scale's end: a round number above the typical value and the band (and the angle seen so far). */
export function scaleMax(kind: RomKind, typical: number | null, band: number | null, seen = 0): number {
  const want = Math.max(kind === "lack" ? 60 : 30, (typical ?? 0) * 1.15, (band ?? 0) * 1.1, seen * 1.05);
  return STEPS.find((s) => s >= want) ?? Math.ceil(want / 30) * 30;
}

const W = 320;
const CX = 160;
const CY = 164;
const R = 134;
/** The arc's length (a half circle). */
const L = Math.PI * R;
/** The hold ring around the marker. */
const RING_R = 27;
const RING_C = 2 * Math.PI * RING_R;
/** The half circle from the start (the reading side) to the end. */
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

/** A point of the half circle at a share of the scale (0 the start, 1 the end). */
export function meterPoint(share: number): { x: number; y: number } {
  const a = Math.PI * (1 - Math.max(0, Math.min(1, share)));
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

/** The band on the scale, as shares (null without one). */
export function bandShares(
  kind: RomKind,
  withinFrom: number | null,
  withinUpTo: number | null,
  max: number,
): { from: number; to: number } | null {
  if (kind === "lack") return withinUpTo === null ? null : { from: 0, to: Math.min(1, withinUpTo / max) };
  return withinFrom === null ? null : { from: Math.min(1, withinFrom / max), to: 1 };
}

/** The value is in the typical band (the gentle reached state). */
export function inBand(
  kind: RomKind,
  value: number | null,
  withinFrom: number | null,
  withinUpTo: number | null,
): boolean {
  if (value === null) return false;
  if (kind === "lack") return withinUpTo !== null && Math.abs(value) <= withinUpTo;
  return withinFrom !== null && value >= withinFrom;
}

export interface MeterReading {
  /** The angle now (the movement's convention), or null before the joint is seen. */
  value: number | null;
  /** The hold, 0 to 1; null when the person is not in a try (no ring). */
  hold: number | null;
}

export interface RangeMeterProps {
  lang: Lang;
  kind: RomKind;
  typical: number | null;
  withinFrom: number | null;
  withinUpTo: number | null;
  /** live: read each frame; held: the question's held position; final: the result. */
  mode: "live" | "held" | "final";
  /** live: the reading now, called once per animation frame. */
  read?: () => MeterReading;
  /** held and final: the value. */
  value?: number | null;
  /** The words of the meter (no number): the band, the marker, the hold. */
  labels: { band: string; you: string; hold: string };
  /** final: the measured degrees, shown small under the meter (D-036 item 4). */
  degrees?: ReactNode;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Easing of the live marker and ring (ms): calm, still close to the movement. */
const FOLLOW_MS = 110;
const RING_MS = 90;
const SCALE_MS = 320;
/** The result's settle (ease out), as the count up it replaces. */
const SETTLE_MS = 1100;

export function RangeMeter(p: RangeMeterProps) {
  const root = useRef<HTMLDivElement>(null);
  const knob = useRef<SVGGElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const band = useRef<SVGPathElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const props = useRef(p);
  props.current = p;
  const lack = p.kind === "lack";
  const rtl = p.lang === "ar";
  const fixed = p.mode === "live" ? null : (p.value ?? null);
  const max0 = scaleMax(p.kind, p.typical, lack ? p.withinUpTo : p.withinFrom, Math.abs(fixed ?? 0));
  const share0 = p.mode === "held" && fixed !== null ? Math.max(0, Math.min(1, fixed / max0)) : 0;
  const band0 = bandShares(p.kind, p.withinFrom, p.withinUpTo, max0);
  const at0 = meterPoint(share0);
  const state0 = p.mode === "held" ? "done" : p.mode === "final" ? "final" : "wait";
  const in0 = p.mode === "held" && inBand(p.kind, fixed, p.withinFrom, p.withinUpTo);

  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    let share = share0;
    let hold = p.mode === "held" ? 1 : 0;
    let max = max0;
    let seen = Math.abs(fixed ?? 0);
    const t0 = performance.now();
    const still = reducedMotion();
    // What is on screen now (-1: nothing written yet, so the first frame writes everything).
    const shown = { share: -1, hold: -1, from: -1, to: -1, state: "", band: "" };
    const tick = (now: number) => {
      const q = props.current;
      const dt = last === null ? 16 : Math.max(0, Math.min(200, now - last));
      last = now;
      const reading: MeterReading =
        q.mode === "live"
          ? (q.read?.() ?? { value: null, hold: null })
          : { value: q.value ?? null, hold: q.mode === "held" ? 1 : null };
      const v = reading.value;
      const isLack = q.kind === "lack";
      if (v !== null) seen = Math.max(seen, Math.abs(v));
      const maxGoal = scaleMax(q.kind, q.typical, isLack ? q.withinUpTo : q.withinFrom, seen);
      max = still ? maxGoal : max + (maxGoal - max) * (1 - Math.exp(-dt / SCALE_MS));
      const goal = v === null ? 0 : Math.max(0, Math.min(1, v / max));
      if (q.mode === "final") {
        const k = still ? 1 : Math.min(1, (now - t0) / SETTLE_MS);
        share = goal * (1 - Math.pow(1 - k, 3));
      } else if (q.mode === "held" || still) share = goal;
      else share += (goal - share) * (1 - Math.exp(-dt / FOLLOW_MS));
      const holdGoal = reading.hold === null ? 0 : Math.max(0, Math.min(1, reading.hold));
      hold = still || holdGoal < hold ? holdGoal : hold + (holdGoal - hold) * (1 - Math.exp(-dt / RING_MS));

      // Attributes are written only when they change.
      if (Math.abs(share - shown.share) > 0.0004) {
        shown.share = share;
        const pt = meterPoint(share);
        knob.current?.setAttribute("transform", `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
        const f = fill.current;
        if (f) {
          f.setAttribute("stroke-dasharray", `${(share * L).toFixed(2)} ${(2 * L).toFixed(0)}`);
          f.style.opacity = share > 0.012 && v !== null ? "1" : "0";
        }
      }
      if (Math.abs(hold - shown.hold) > 0.002) {
        shown.hold = hold;
        ring.current?.setAttribute("stroke-dashoffset", (RING_C * (1 - hold)).toFixed(2));
      }
      const b = bandShares(q.kind, q.withinFrom, q.withinUpTo, max);
      const bel = band.current;
      if (b && bel && (Math.abs(b.from - shown.from) > 0.0005 || Math.abs(b.to - shown.to) > 0.0005)) {
        shown.from = b.from;
        shown.to = b.to;
        bel.setAttribute("stroke-dasharray", `${((b.to - b.from) * L).toFixed(2)} ${(2 * L).toFixed(0)}`);
        bel.setAttribute("stroke-dashoffset", (-b.from * L).toFixed(2));
      }
      const state =
        q.mode === "final"
          ? "final"
          : v === null
            ? "wait"
            : hold >= 0.995 && reading.hold !== null
              ? "done"
              : reading.hold !== null && holdGoal > 0.02
                ? "hold"
                : "move";
      const reached = inBand(q.kind, v, q.withinFrom, q.withinUpTo) ? "in" : "out";
      const r = root.current;
      if (r && state !== shown.state) {
        shown.state = state;
        r.dataset.state = state;
      }
      if (r && reached !== shown.band) {
        shown.band = reached;
        r.dataset.band = reached;
      }
      const settled = q.mode !== "live" && Math.abs(share - goal) < 0.0005 && Math.abs(maxGoal - max) < 0.05;
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The loop reads the latest props itself; it restarts only when the mode or the fixed value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mode, fixed]);

  const flip = rtl ? `translate(${W} 0) scale(-1 1)` : undefined;
  const hasBand = band0 !== null;
  return (
    <div
      ref={root}
      className={`fx-meter is-${p.mode}`}
      data-mode={p.mode}
      data-state={state0}
      data-band={in0 ? "in" : "out"}
      data-kind={p.kind}
    >
      <div className="fx-meter-arc">
        <svg viewBox={`0 0 ${W} 178`} aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="fx-meter-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c9b9e4" />
              <stop offset="1" stopColor="#6c56a5" />
            </linearGradient>
            <linearGradient id="fx-meter-band" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fde49a" />
              <stop offset="1" stopColor="#f8cb44" />
            </linearGradient>
          </defs>
          <g transform={flip}>
            <path d={ARC} className="fx-meter-track" />
            {hasBand && (
              <path
                ref={band}
                d={ARC}
                className="fx-meter-band"
                strokeDasharray={`${((band0.to - band0.from) * L).toFixed(2)} ${(2 * L).toFixed(0)}`}
                strokeDashoffset={(-band0.from * L).toFixed(2)}
              />
            )}
            {!lack && (
              <path
                ref={fill}
                d={ARC}
                className="fx-meter-fill"
                strokeDasharray={`${(share0 * L).toFixed(2)} ${(2 * L).toFixed(0)}`}
                style={{ opacity: share0 > 0.012 ? 1 : 0 }}
              />
            )}
            <g
              ref={knob}
              className="fx-meter-marker"
              transform={`translate(${at0.x.toFixed(2)} ${at0.y.toFixed(2)})`}
            >
              <circle r={RING_R + 9} className="fx-meter-glow" />
              <circle r={RING_R} className="fx-meter-ring-track" />
              <circle
                ref={ring}
                r={RING_R}
                className="fx-meter-ring"
                strokeDasharray={RING_C.toFixed(2)}
                strokeDashoffset={(p.mode === "held" ? 0 : RING_C).toFixed(2)}
                transform="rotate(-90)"
              />
              <circle r={16} className="fx-meter-knob" />
              <circle r={6.5} className="fx-meter-core" />
              <path
                d="M -6.5 0.5 L -2 5 L 7 -5"
                className="fx-meter-check"
                transform={rtl ? "scale(-1 1)" : undefined}
              />
            </g>
          </g>
        </svg>
        <div className="fx-meter-centre">
          {p.mode === "live" && (
            <span className="fx-meter-hold" aria-hidden="true">
              {p.labels.hold}
            </span>
          )}
          {p.mode !== "held" && hasBand && (
            <p className="fx-meter-legend">
              <span>
                <i className="is-you" aria-hidden="true" />
                {p.labels.you}
              </span>
              <span>
                <i className="is-band" aria-hidden="true" />
                {p.labels.band}
              </span>
            </p>
          )}
        </div>
      </div>
      {p.mode === "final" && p.degrees && <p className="fx-meter-degrees">{p.degrees}</p>}
    </div>
  );
}
