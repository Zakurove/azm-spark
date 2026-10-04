/**
 * The live dial of a range movement (product v7 plan 1.5 and 1.7, rom-protocol 1.1 step 3): the angle
 * on a half circle against the typical band for the person, with the hold ring around the large
 * number. The person's own angle is purple; the typical band and the typical mark are gold. The arc
 * starts at the reading side (mirrored in Arabic); the number is never mirrored.
 *
 * The band is the grade's within normal band (rom-norms gradeBand): from withinFrom up for flexion and
 * signed movements, from 0 to withinUpTo for the lack movements (the degrees short of straight). The
 * scale ends at a round number above the typical value, so a small movement still fills the dial.
 */
import type { Lang } from "../../app/i18n";
import { localizeDigits, unitWord } from "../../i18n";
import type { RomKind } from "../../movements/rom/types";

/** Round steps of the scale's end. */
const STEPS = [30, 45, 60, 90, 120, 150, 180];

/** The scale's end: a round number above the typical value and the band (and the angle seen so far). */
export function scaleMax(kind: RomKind, typical: number | null, band: number | null, seen = 0): number {
  const want = Math.max(kind === "lack" ? 60 : 30, (typical ?? 0) * 1.15, (band ?? 0) * 1.1, seen * 1.05);
  return STEPS.find((s) => s >= want) ?? Math.ceil(want / 30) * 30;
}

const R = 132;
const CX = 160;
const CY = 168;

/** A point of the half circle at a share of the scale (0 the start, 1 the end), at radius r. */
function at(share: number, r: number): { x: number; y: number } {
  const a = Math.PI * (1 - Math.max(0, Math.min(1, share)));
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/** The arc from one share to another at radius r (always the upper half circle). */
function arc(from: number, to: number, r: number): string {
  const a = at(from, r);
  const b = at(to, r);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export interface DialProps {
  lang: Lang;
  kind: RomKind;
  /** The angle now (the movement's convention), or null before the joint is seen. */
  value: number | null;
  typical: number | null;
  withinFrom: number | null;
  withinUpTo: number | null;
  /** The hold ring, 0 to 1; null hides it. */
  hold?: number | null;
  /** The scale's end (keep it fixed for a movement so the dial never jumps). */
  max: number;
  /** A smaller dial for the result card. */
  compact?: boolean;
  /** Words under the number (the unit by default). */
  caption?: string;
  /** The typical mark's label («المعتاد»). */
  typicalLabel: string;
  /** The value is final (the result): the arc settles, no live glow. */
  final?: boolean;
}

export function Dial(p: DialProps) {
  const shown = p.value === null ? null : Math.round(Math.abs(p.value));
  const share = p.value === null ? 0 : Math.max(0, p.value) / p.max;
  const lack = p.kind === "lack";
  const bandFrom = lack ? 0 : p.withinFrom !== null ? p.withinFrom / p.max : null;
  const bandTo = lack ? (p.withinUpTo !== null ? p.withinUpTo / p.max : null) : 1;
  const typicalShare = p.typical === null ? null : Math.max(0, p.typical) / p.max;
  const tick = typicalShare === null ? null : { a: at(typicalShare, R + 22), b: at(typicalShare, R + 36) };
  // The typical value's label sits outside the arc, kept inside the picture at the ends of the scale.
  const labelAt = typicalShare === null ? null : at(typicalShare, R + 50);
  const label = labelAt && { x: Math.max(26, Math.min(294, labelAt.x)), y: Math.min(labelAt.y, CY - 26) };
  const end = at(share, R);
  // The hold ring sits around the knob, where the person holds: it fills over the hold second.
  const ringR = 24;
  const ringC = 2 * Math.PI * ringR;
  const hold = p.hold ?? null;
  const rtl = p.lang === "ar";
  // The arc fills from the reading side: a mirror for Arabic around the dial's middle.
  const flip = rtl ? `translate(${2 * CX} 0) scale(-1 1)` : undefined;
  const mirrorX = (x: number) => (rtl ? 2 * CX - x : x);
  return (
    <div
      className={`fx-dial${p.compact ? " is-compact" : ""}${p.final ? " is-final" : ""}`}
      data-value={shown ?? ""}
      data-hold={hold === null ? "" : hold.toFixed(2)}
    >
      <svg viewBox="0 0 320 196" aria-hidden="true">
        <defs>
          <linearGradient id="fx-dial-live" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b9a6d8" />
            <stop offset="1" stopColor="#6c56a5" />
          </linearGradient>
          <linearGradient id="fx-dial-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f6d36b" />
            <stop offset="1" stopColor="#e3ab1f" />
          </linearGradient>
        </defs>
        <g transform={flip}>
          <path d={arc(0, 1, R)} className="fx-dial-track" />
          {bandFrom !== null && bandTo !== null && bandTo > bandFrom && (
            <path d={arc(bandFrom, Math.min(1, bandTo), R + 18)} className="fx-dial-band" />
          )}
          {p.value !== null && share > 0.001 && (
            <path d={arc(0, Math.min(1, share), R)} className="fx-dial-live" />
          )}
          {tick && <line x1={tick.a.x} y1={tick.a.y} x2={tick.b.x} y2={tick.b.y} className="fx-dial-tick" />}
          {p.value !== null && hold !== null && (
            <g className="fx-dial-ring" data-full={hold >= 1 ? "" : undefined}>
              <circle cx={end.x} cy={end.y} r={ringR} className="fx-dial-ring-track" />
              <circle
                cx={end.x}
                cy={end.y}
                r={ringR}
                className="fx-dial-ring-fill"
                strokeDasharray={ringC}
                strokeDashoffset={ringC * (1 - Math.max(0, Math.min(1, hold)))}
                transform={`rotate(-90 ${end.x.toFixed(2)} ${end.y.toFixed(2)})`}
              />
            </g>
          )}
          {p.value !== null && <circle cx={end.x} cy={end.y} r={13} className="fx-dial-knob" />}
        </g>
        {label && p.typical !== null && (
          <text x={mirrorX(label.x)} y={label.y} className="fx-dial-typical" textAnchor="middle">
            {localizeDigits(p.lang, String(Math.round(Math.abs(p.typical))))}°
          </text>
        )}
      </svg>
      <div className="fx-dial-readout">
        {shown === null ? (
          <i className="fx-dial-wait" aria-hidden="true" />
        ) : (
          <b dir="ltr">
            {localizeDigits(p.lang, String(shown))}
            <sup>°</sup>
          </b>
        )}
        <span>{p.caption ?? unitWord(p.lang, "deg", shown ?? 0)}</span>
      </div>
      {p.typical !== null && (
        <p className="fx-dial-legend">
          <i aria-hidden="true" />
          <span>{p.typicalLabel}</span>
        </p>
      )}
    </div>
  );
}
