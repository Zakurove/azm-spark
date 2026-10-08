import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import { Illustration } from "../visuals/Illustration";

export type PlacementKind = "overground_front" | "overground_side" | "pad_side" | "pad_front" | "stance";

const t = (lang: Lang, key: string) => tV7(lang, `gait.diagram.${key}` as never);

/** A phone seen from above: portrait or landscape, with its view as a soft cone toward `to`. */
function Phone({
  x,
  y,
  landscape,
  to,
  label,
  labelAt,
}: {
  x: number;
  y: number;
  landscape: boolean;
  to: [number, number];
  label: string;
  /** Where the label goes (default: on the side away from the view). */
  labelAt?: { x: number; y: number; anchor: "start" | "middle" | "end" };
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
      <text
        x={labelAt?.x ?? x}
        y={labelAt?.y ?? ly}
        className={`gx-label is-phone${labelAt && labelAt.anchor !== "middle" ? ` is-${labelAt.anchor}` : ""}`}
      >
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
  below = false,
}: {
  from: [number, number];
  to: [number, number];
  label: string;
  side?: 1 | -1;
  /** A level span's label under its line (above by default). */
  below?: boolean;
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
        y={vertical ? my + 4 : below ? my + 16 : my - 8}
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
  if (kind !== "stance") {
    const names = {
      pad_side: "v7_walk_pad_side",
      pad_front: "v7_walk_pad_front",
      overground_side: "v7_walk_side_path",
      overground_front: "v7_walk_front_path",
    };
    return (
      <Illustration
        group="walk"
        name={names[kind]}
        alt={label}
        lang={lang}
        className={`gx-placement is-${kind}`}
        mirror={side === "left" && kind.endsWith("side")}
      />
    );
  }
  return (
    <svg
      className={`gx-placement is-${kind}`}
      viewBox="0 0 320 240"
      role="img"
      aria-label={label}
      direction="ltr"
      lang={lang}
    >
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
