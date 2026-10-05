/**
 * Where the phone goes for each part of the walk (product v7 plan 2.5 «Setup: phone placement for
 * side and front, or the walking pad»; gait-rules capture): a calm top down drawing with the
 * distances of the gait data, the person's own side for the pad's side views. Light, gold for the
 * marks, purple for the phone and its view, no hard dark lines. Pure SVG, no animation beyond the
 * walker's soft pulse, which reduced motion turns off (gait.css).
 */
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";

export type PlacementKind = "overground_front" | "overground_side" | "pad_side" | "pad_front" | "stance";

const t = (lang: Lang, key: string) => tV7(lang, `gait.diagram.${key}` as never);

/** A phone seen from above: portrait or landscape, with its view as a soft cone toward `to`. */
function Phone({
  x,
  y,
  landscape,
  to,
  label,
}: {
  x: number;
  y: number;
  landscape: boolean;
  to: [number, number];
  label: string;
}) {
  const w = landscape ? 30 : 18;
  const h = landscape ? 18 : 30;
  const ang = Math.atan2(to[1] - y, to[0] - x);
  const spread = 0.42;
  const reach = Math.hypot(to[0] - x, to[1] - y);
  const a = [x + Math.cos(ang - spread) * reach, y + Math.sin(ang - spread) * reach];
  const b = [x + Math.cos(ang + spread) * reach, y + Math.sin(ang + spread) * reach];
  const ly = y + (to[1] < y ? h / 2 + 18 : -h / 2 - 10);
  return (
    <g className="gx-phone">
      <path className="gx-cone" d={`M${x} ${y} L${a[0]} ${a[1]} L${b[0]} ${b[1]} Z`} />
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={5} className="gx-phone-body" />
      <circle cx={x} cy={y} r={2.6} className="gx-phone-lens" />
      <text x={x} y={ly} className="gx-label is-phone">
        {label}
      </text>
    </g>
  );
}

/** A distance between two points, with its label on a soft line. */
function Span({
  from,
  to,
  label,
  side = 1,
}: {
  from: [number, number];
  to: [number, number];
  label: string;
  side?: 1 | -1;
}) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const vertical = Math.abs(to[1] - from[1]) > Math.abs(to[0] - from[0]);
  return (
    <g className="gx-span">
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
      <circle cx={from[0]} cy={from[1]} r={2.2} />
      <circle cx={to[0]} cy={to[1]} r={2.2} />
      <text
        x={vertical ? mx + side * 10 : mx}
        y={vertical ? my + 4 : my - 8}
        className={`gx-label is-span${vertical ? (side > 0 ? " is-start" : " is-end") : ""}`}
      >
        {label}
      </text>
    </g>
  );
}

function Walker({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g className="gx-walker">
      <circle cx={x} cy={y} r={11} className="gx-walker-halo" />
      <circle cx={x} cy={y} r={6.5} className="gx-walker-dot" />
      {label && (
        <text x={x} y={y - 16} className="gx-label">
          {label}
        </text>
      )}
    </g>
  );
}

function Pad({ x, y, w, h, lang }: { x: number; y: number; w: number; h: number; lang: Lang }) {
  const stripes = [];
  for (let sy = y + 16; sy < y + h - 8; sy += 12)
    stripes.push(<line key={sy} x1={x + 8} y1={sy} x2={x + w - 8} y2={sy} className="gx-belt" />);
  return (
    <g className="gx-pad">
      <rect x={x} y={y} width={w} height={h} rx={12} className="gx-pad-body" />
      {stripes}
      <rect x={x - 6} y={y - 8} width={w + 12} height={7} rx={3.5} className="gx-bar" />
      <text x={x + w / 2} y={y - 14} className="gx-label is-muted">
        {t(lang, "support")}
      </text>
    </g>
  );
}

/** One placement drawing, with a summary for screen readers. */
export function Placement({
  kind,
  lang,
  side = "right",
  label,
}: {
  kind: PlacementKind;
  lang: Lang;
  /** The pad's side views: the person's side the phone is on. */
  side?: "left" | "right";
  /** The drawing's name for screen readers (the step's title). */
  label: string;
}) {
  return (
    <svg
      className={`gx-placement is-${kind}`}
      viewBox="0 0 320 230"
      role="img"
      aria-label={label}
      direction="ltr"
      lang={lang}
    >
      {kind === "overground_front" && (
        <g>
          <rect x={112} y={22} width={64} height={168} rx={10} className="gx-path" />
          <line x1={112} y1={30} x2={176} y2={30} className="gx-mark" />
          <text x={92} y={34} className="gx-label is-end">
            {t(lang, "start")}
          </text>
          <line x1={112} y1={212} x2={176} y2={212} className="gx-mark is-stop" />
          <text x={92} y={216} className="gx-label is-end">
            {t(lang, "stop")}
          </text>
          <Walker x={144} y={52} />
          <path d="M144 70 L144 150" className="gx-arrow" markerEnd="url(#gx-head)" />
          <Span from={[100, 30]} to={[100, 180]} label={t(lang, "path")} side={-1} />
          <Phone x={214} y={180} landscape={false} to={[150, 40]} label={t(lang, "phone")} />
          <Span from={[176, 196]} to={[205, 196]} label={t(lang, "offset")} />
          <Span from={[240, 180]} to={[240, 212]} label={t(lang, "behind")} />
        </g>
      )}
      {kind === "overground_side" && (
        <g>
          <rect x={22} y={34} width={276} height={50} rx={10} className="gx-path" />
          <Walker x={84} y={59} />
          <path d="M104 52 L236 52" className="gx-arrow" markerEnd="url(#gx-head)" />
          <path d="M236 68 L104 68" className="gx-arrow is-back" markerEnd="url(#gx-head)" />
          <Phone x={160} y={192} landscape to={[160, 70]} label={t(lang, "phone")} />
          <Span from={[214, 86]} to={[214, 184]} label={t(lang, "far")} />
        </g>
      )}
      {kind === "pad_side" && (
        <g>
          <Pad x={128} y={44} w={64} h={130} lang={lang} />
          <Walker x={160} y={104} label={t(lang, "you")} />
          {side === "right" ? (
            <>
              <Phone x={282} y={112} landscape to={[160, 112]} label={t(lang, "phone")} />
              <Span from={[196, 150]} to={[270, 150]} label={t(lang, "padSide")} />
              <Walker x={214} y={196} label={t(lang, "helper")} />
            </>
          ) : (
            <>
              <Phone x={38} y={112} landscape to={[160, 112]} label={t(lang, "phone")} />
              <Span from={[50, 150]} to={[124, 150]} label={t(lang, "padSide")} />
              <Walker x={106} y={196} label={t(lang, "helper")} />
            </>
          )}
        </g>
      )}
      {kind === "pad_front" && (
        <g>
          <Pad x={128} y={92} w={64} h={120} lang={lang} />
          <Walker x={160} y={140} label={t(lang, "you")} />
          <Phone x={160} y={26} landscape={false} to={[160, 150]} label={t(lang, "phone")} />
          <Span from={[214, 30]} to={[214, 92]} label={t(lang, "padFront")} />
        </g>
      )}
      {kind === "stance" && (
        <g>
          <Walker x={160} y={150} label={t(lang, "you")} />
          <rect x={196} y={140} width={34} height={22} rx={6} className="gx-support" />
          <text x={213} y={182} className="gx-label is-muted">
            {t(lang, "support")}
          </text>
          <Phone x={160} y={30} landscape={false} to={[160, 150]} label={t(lang, "phone")} />
          <Span from={[110, 40]} to={[110, 146]} label={t(lang, "padFront")} side={-1} />
        </g>
      )}
      <defs>
        <marker
          id="gx-head"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" className="gx-arrow-head" />
        </marker>
      </defs>
    </svg>
  );
}
