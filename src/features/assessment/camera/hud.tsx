/**
 * The small parts of the camera HUD (UX spec 5.6): rings, attempt dots, the try counter, the lean
 * arrow, the framing guide, the arm marker and the top view diagram. Physical side markers (the arm
 * marker, the lean arrow, the per side dots of the side lean) are LTR boxes placed from the person's
 * own side in the mirrored picture, so RTL never flips them (4.2).
 */
import type { ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import CheckIcon from "../shared/CheckIcon";
import { DOT_KEY, type AttemptDot } from "./view";

/* ------------------------------------------------------------ rings */

export interface RingProps {
  /** 0 to 1. */
  progress: number;
  size: number;
  /** hold: green ink (a hold); time: purple (time and rest). */
  tone: "hold" | "time";
  /** Frozen (paused): the track and value in muted ink, never dimmed. */
  frozen?: boolean;
  /** Under reduced motion the ring moves in whole steps (4.1 motion). */
  steps?: number;
  children?: ReactNode;
  label?: string;
}

export function Ring({ progress, size, tone, frozen, steps, children, label }: RingProps) {
  const stroke = Math.max(6, Math.round(size / 14));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, steps ? Math.floor(progress * steps) / steps : progress));
  return (
    <span
      className={`s34-ring is-${tone}${frozen ? " is-frozen" : ""}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle
          className="s34-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="s34-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
      </svg>
      {children !== undefined && <span className="s34-ring-inner">{children}</span>}
    </span>
  );
}

/* ------------------------------------------------------------ attempts */

/** One dot per scored attempt: a check when saved, a ring with ↻ when it is repeated (P3). */
export function Dots({ dots, lang, physical }: { dots: AttemptDot[]; lang: Lang; physical?: boolean }) {
  return (
    <span className="s34-dots" dir={physical ? "ltr" : undefined}>
      {dots.map((d, i) => (
        <span key={i} className={`s34-dot is-${d}`} role="img" aria-label={t(lang, DOT_KEY[d], { n: i + 1 })}>
          {d === "saved" && <CheckIcon name="check" size={16} />}
          {d === "retry" && <CheckIcon name="refresh" size={14} />}
        </span>
      ))}
    </span>
  );
}

/** "2 of 3" at 56 px, readable from 2 m (P3, hud.tryShort). */
export function TryCounter({ n, total, lang }: { n: number; total: number; lang: Lang }) {
  return (
    // A span takes no aria-label (no role): the full words are read, the short form is shown.
    <span className="s34-try">
      <span aria-hidden="true">{bidiText(lang, t(lang, "assessment.hud.tryShort", { n, total }))}</span>
      <span className="check-visually-hidden">{t(lang, "assessment.common.tryOf", { n, total })}</span>
    </span>
  );
}

/* ------------------------------------------------------------ side lean */

/**
 * The lean guide: the direction to lean and a centre mark, never a magnitude (O4). The arrow points
 * to the person's side in the mirrored picture: their left is the screen's left.
 */
export function LeanArrow({ direction, centred }: { direction: "left" | "right"; centred: boolean }) {
  return (
    <span className="s34-lean" dir="ltr" aria-hidden="true">
      <svg
        className={`s34-lean-arrow is-${direction}${centred ? " is-idle" : ""}`}
        viewBox="0 0 120 60"
        focusable="false"
      >
        {direction === "left" ? (
          <path d="M8 30h104M8 30l26-22M8 30l26 22" />
        ) : (
          <path d="M112 30H8M112 30 86 8M112 30 86 52" />
        )}
      </svg>
      <span className={`s34-lean-centre${centred ? " is-centred" : ""}`}>
        <i />
        <i />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ framing guide (S34c) */

/**
 * The dashed outline of where the body goes: front seated, side seated, oblique standing. None: a
 * white dashed outline; adjust: gold dashed; ready: solid green ink with a check (4.4).
 */
export function FramingGuide({
  view,
  state,
}: {
  view: "front" | "side" | "oblique";
  state: "none" | "adjust" | "ready";
}) {
  const body =
    view === "side" ? (
      <path d="M52 14a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM50 38c-8 2-10 10-10 20v26h-10v34M50 38c6 2 8 10 8 20v30h20v30M44 60l-8 18" />
    ) : view === "oblique" ? (
      <path d="M50 12a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM38 38h26l6 34-8 2v44M38 38l-6 34 8 2v44M44 118h-10M66 118h10" />
    ) : (
      <path d="M50 12a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM30 38h40l8 34M30 38l-8 34M34 38v40h32V38M34 78l-6 40M66 78l6 40" />
    );
  return (
    <svg className={`s34-frame is-${state}`} viewBox="0 0 100 130" aria-hidden="true" focusable="false">
      <g className="s34-frame-outer">{body}</g>
      <g className="s34-frame-inner">{body}</g>
      {state === "ready" && (
        <g className="s34-frame-badge">
          <circle cx="82" cy="18" r="10" />
          <path d="m77 18 4 4 7-8" />
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ arm marker (S34g1) */

/** "◀━━ Your right arm" on the arm's own side of the mirrored picture. */
export function ArmMarker({ side, label }: { side: "left" | "right"; label: string }) {
  return (
    <span className={`s34-arm-marker is-${side}`} dir="ltr">
      <span className="s34-arm-marker-bar" aria-hidden="true" />
      <span className="s34-arm-marker-text" dir="auto">
        {label}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ top view diagrams */

/**
 * Where the phone goes, seen from above (S34c, S34j, Appendix B): at the side for the arm curl, at
 * 45 degrees for the chair stand, and for a wheelchair at the arm curl side change both options
 * (turn the chair, or move the phone).
 */
export function TopView({
  kind,
  label,
}: {
  kind: "side_left" | "side_right" | "oblique_left" | "oblique_right" | "side_change_wheelchair";
  label: string;
}) {
  const person = (
    <g className="s34-top-person">
      <circle cx="50" cy="60" r="12" />
      <path d="M38 60h24" />
    </g>
  );
  const phone = (x: number, y: number, rot: number) => (
    <g className="s34-top-phone" transform={`rotate(${rot} ${x} ${y})`}>
      <rect x={x - 5} y={y - 9} width="10" height="18" rx="2" />
    </g>
  );
  let content: ReactNode;
  switch (kind) {
    case "side_left":
      content = phone(12, 60, 90);
      break;
    case "side_right":
      content = phone(88, 60, 90);
      break;
    case "oblique_left":
      content = phone(22, 22, -45);
      break;
    case "oblique_right":
      content = phone(78, 22, 45);
      break;
    default:
      content = (
        <>
          {phone(12, 60, 90)}
          {phone(88, 60, 90)}
          <path className="s34-top-arrow" d="M30 88a26 26 0 0 0 40 0" />
        </>
      );
  }
  return (
    <svg
      className="s34-topview"
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      style={{ direction: "ltr" }}
    >
      {person}
      {content}
    </svg>
  );
}
