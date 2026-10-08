/**
 * The body map (product v7 contract 2.2): a front and a back view of a person with one 48 px touch
 * target per region and side (a body map cell, BodyMapKey).
 *
 *   edit     the intake: a tap on a cell adds that region and side, or takes it off the map
 *            (toggleBodyMapCell); the questions of each region are the intake form's.
 *   summary  the findings page (stream B): each cell coloured by its BodyMapColour.
 *
 * Left and right are always the person's own (rom-protocol conventions.sides): in the front view the
 * person faces you, so their right side is on your left, and each view names its sides. The figure
 * never mirrors with the page direction (it is drawn left to right in both languages); its labels
 * are in the page language.
 *
 * The figure (D-034 item 5): a soft rounded silhouette drawn as one smooth outline (a Catmull-Rom
 * curve through the points of the person's right half, mirrored), a light lavender fill with a soft
 * rim and floor shadow, and no hard lines. An affected area glows with a soft halo in its colour
 * (purple in the intake), which fades and grows in when tapped. Original Azm art.
 *
 * Beside the contract's mode props, `lang` gives the labels' language and summary mode takes optional
 * `notes`, read after a cell's name (A2-5, accepted in D-024).
 */
import { useId, useState } from "react";
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import {
  AXIAL_REGIONS,
  REGION_IDS,
  entryCells,
  type BodyMapKey,
  type RegionEntry,
  type RegionId,
  type RegionSide,
} from "../../medical/body-map";
import type { BodyMapColour } from "../../medical/rom-types";
import { ROM_DATA } from "../../movements/rom";
import "./body-map.css";

export type BodyMapView = "front" | "back";
export type BodyMapProps = { lang: Lang } & (
  | { mode: "edit"; value: RegionEntry[]; onChange(v: RegionEntry[]): void }
  | {
      mode: "summary";
      colours: Partial<Record<BodyMapKey, BodyMapColour>>;
      /** Optional words read after a cell's name by a screen reader, for example its finding. */
      notes?: Partial<Record<BodyMapKey, string>>;
    }
);

/** The figure's drawing box (viewBox units). */
const W = 240;
const H = 440;
type LimbRegion = Exclude<RegionId, "neck" | "back_trunk">;
/** Each limb region's cell on the person's right side, in the front view (on your left). */
const RIGHT_FRONT: Record<LimbRegion, readonly [number, number]> = {
  shoulder: [80, 104],
  elbow: [58, 168],
  forearm_wrist: [45, 232],
  hip: [95, 262],
  knee: [93, 338],
  ankle_foot: [91, 410],
};
const AXIAL_POINT: Record<"neck" | "back_trunk", readonly [number, number]> = {
  neck: [120, 70],
  back_trunk: [120, 170],
};

/**
 * The glow of each region on the person's right side, front view: its centre, radii and turn (degrees,
 * clockwise), so the halo covers the part of the body and not only the dot.
 */
const GLOW: Record<RegionId, { c: readonly [number, number]; r: readonly [number, number]; turn?: number }> =
  {
    neck: { c: [120, 68], r: [18, 16] },
    back_trunk: { c: [120, 170], r: [36, 58] },
    shoulder: { c: [75, 104], r: [26, 24] },
    elbow: { c: [58, 168], r: [19, 21] },
    forearm_wrist: { c: [47, 214], r: [16, 34], turn: 17 },
    hip: { c: [98, 258], r: [25, 23] },
    knee: { c: [95, 336], r: [18, 23] },
    ankle_foot: { c: [94, 412], r: [18, 21] },
  };

/** Every cell in reading order: the neck, the back or trunk, then each limb region right then left. */
export const BODY_MAP_CELLS: readonly BodyMapKey[] = REGION_IDS.flatMap((region): BodyMapKey[] =>
  AXIAL_REGIONS.includes(region) ? [`${region}:axial`] : [`${region}:right`, `${region}:left`],
);

const parse = (key: BodyMapKey) => key.split(":") as [RegionId, "left" | "right" | "axial"];
/** A limb cell is on your left in the front view for the person's right side, and the other way round from the back. */
const onYourLeft = (side: "left" | "right", view: BodyMapView) => (side === "right") === (view === "front");

/** Where a cell sits in a view, in viewBox units. */
export function cellPoint(key: BodyMapKey, view: BodyMapView): { x: number; y: number } {
  const [region, side] = parse(key);
  if (side === "axial") {
    const [x, y] = AXIAL_POINT[region as "neck" | "back_trunk"];
    return { x, y };
  }
  const [x, y] = RIGHT_FRONT[region as LimbRegion];
  return { x: onYourLeft(side, view) ? x : W - x, y };
}

/**
 * A tap on a cell. An empty cell gets a new entry for that region and side (no problem type yet, the
 * person's own); a cell of a one sided or axial entry takes that entry off the map; a cell of a both
 * entry leaves the entry on the other side only.
 */
export function toggleBodyMapCell(value: readonly RegionEntry[], key: BodyMapKey): RegionEntry[] {
  const [region, side] = parse(key);
  const i = value.findIndex((e) => entryCells(e).includes(key));
  if (i < 0) return [...value, { region, side, problems: [], origin: "person" }];
  const e = value[i];
  if (e.side === "both") {
    const other = side === "left" ? "right" : "left";
    return value.map((x, j) => (j === i ? { ...x, side: other } : x));
  }
  return value.filter((_, j) => j !== i);
}

/** A region's name (rom-protocol regions). */
export function regionName(lang: Lang, region: RegionId): string {
  return ROM_DATA.regions.find((r) => r.id === region)?.[lang] ?? region;
}

/** A region and side as words, for example «الكتف، الجهة اليمنى» or "Knee, both sides". */
export function entryLabel(lang: Lang, region: RegionId, side: RegionSide): string {
  const name = regionName(lang, region);
  if (side === "axial") return name;
  return tV7(lang, "intake7.map.cell", { region: name, side: tV7(lang, `intake7.map.${side}`) });
}

/** A cell's name. */
export function cellLabel(lang: Lang, key: BodyMapKey): string {
  const [region, side] = parse(key);
  return entryLabel(lang, region, side);
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/* ------------------------------------------------------------------ the figure */

type Point = readonly [number, number];
/** The outline of the person's right half (on your left in the front view), from the neck down the arm and the leg to the middle. */
const RIGHT_HALF: readonly Point[] = [
  [111, 56],
  [110, 74],
  [96, 82],
  [80, 88],
  [68, 96],
  [62, 112],
  [58, 136],
  [52, 166],
  [44, 198],
  [38, 230],
  [33, 246],
  [34, 262],
  [42, 268],
  [48, 256],
  [52, 234],
  [60, 200],
  [66, 170],
  [72, 142],
  [77, 124],
  [80, 150],
  [85, 190],
  [80, 226],
  [78, 254],
  [80, 292],
  [84, 330],
  [82, 360],
  [86, 398],
  [83, 414],
  [80, 425],
  [89, 431],
  [101, 431],
  [106, 423],
  [104, 409],
  [103, 396],
  [106, 360],
  [106, 332],
  [112, 292],
  [118, 270],
];
/** The whole outline: the right half, the middle, then the left half mirrored back up. */
const OUTLINE: readonly Point[] = [
  ...RIGHT_HALF,
  [120, 266],
  ...[...RIGHT_HALF].reverse().map(([x, y]): Point => [W - x, y]),
];

/** A closed smooth path through the points (uniform Catmull-Rom as cubic Béziers). */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  const r = (v: number) => Math.round(v * 10) / 10;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => points[(i + k + n) % n]);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${p2[0]} ${p2[1]}`;
  }
  return `${d}Z`;
}
const BODY_PATH = smoothPath(OUTLINE);

/** The glow tones: purple in the intake, the finding colours in summary mode. */
const TONES = ["purple", "within", "mild", "marked", "grey"] as const;
type Tone = (typeof TONES)[number];
const TONE_COLOUR: Record<Tone, string> = {
  purple: "#8065ad",
  within: "#24775e",
  mild: "#e3a81b",
  marked: "#aa3e35",
  grey: "#a7aea6",
};
const toneOf = (c: BodyMapColour): Tone | null =>
  c === "none" ? null : c === "pain" ? "purple" : (c as Exclude<Tone, "purple">);

/** The halo of one cell, in viewBox units (mirrored for a left cell). */
function glowOf(key: BodyMapKey, view: BodyMapView) {
  const [region, side] = parse(key);
  const g = GLOW[region];
  const mirror = side !== "axial" && !onYourLeft(side, view);
  const cx = mirror ? W - g.c[0] : g.c[0];
  const turn = (g.turn ?? 0) * (mirror ? -1 : 1);
  return { cx, cy: g.c[1], rx: g.r[0], ry: g.r[1], turn };
}

function Figure({
  view,
  lit,
  all,
}: {
  view: BodyMapView;
  lit: Partial<Record<BodyMapKey, Tone>>;
  /** Draw every halo (edit mode), not only the lit ones. */
  all: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const ref = (name: string) => `url(#${id}${name})`;
  return (
    <svg className="bm-art" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#f7f4fb" />
          <stop offset="1" stopColor="#ece6f5" />
        </linearGradient>
        <radialGradient id={`${id}floor`}>
          <stop offset="0" stopColor="#6f5aa0" stopOpacity="0.2" />
          <stop offset="1" stopColor="#6f5aa0" stopOpacity="0" />
        </radialGradient>
        {TONES.map((t) => (
          <radialGradient id={`${id}${t}`} key={t}>
            <stop offset="0" stopColor={TONE_COLOUR[t]} stopOpacity="0.7" />
            <stop offset="0.55" stopColor={TONE_COLOUR[t]} stopOpacity="0.3" />
            <stop offset="1" stopColor={TONE_COLOUR[t]} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <ellipse className="bm-floor" cx="120" cy="433" rx="74" ry="9" fill={ref("floor")} />
      <g className="bm-skin" fill={ref("skin")}>
        <path d={BODY_PATH} />
        <ellipse cx="120" cy="34" rx="21" ry="25" />
      </g>
      {view === "front" ? (
        <g className="bm-detail">
          <path d="M100 93Q120 101 140 93" />
          <path d="M106 214Q120 221 134 214" />
        </g>
      ) : (
        <g className="bm-detail">
          <path d="M120 88L120 232" />
          <path d="M97 112Q104 131 112 121" />
          <path d="M143 112Q136 131 128 121" />
        </g>
      )}
      {/* The intake keeps every halo, so a tap fades one in; a summary draws only its coloured ones. */}
      {BODY_MAP_CELLS.filter((key) => all || lit[key]).map((key) => {
        const tone = lit[key];
        const g = glowOf(key, view);
        // The turn sits on a group, so the halo's own scale stays centred on its box.
        return (
          <g key={key} transform={g.turn ? `rotate(${g.turn} ${g.cx} ${g.cy})` : undefined}>
            <ellipse
              className="bm-glow"
              data-glow={key}
              data-lit={tone ? "true" : "false"}
              cx={g.cx}
              cy={g.cy}
              rx={g.rx}
              ry={g.ry}
              fill={ref(tone ?? "purple")}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** The body map: a front and a back view, edit or summary (contract 2.2). */
export function BodyMap(props: BodyMapProps) {
  const { lang } = props;
  const [view, setView] = useState<BodyMapView>("front");
  const on = props.mode === "edit" ? new Set(props.value.flatMap(entryCells)) : null;
  const lit: Partial<Record<BodyMapKey, Tone>> = {};
  for (const key of BODY_MAP_CELLS) {
    const tone = on
      ? on.has(key)
        ? "purple"
        : null
      : props.mode === "summary"
        ? toneOf(props.colours[key] ?? "none")
        : null;
    if (tone) lit[key] = tone;
  }
  const yours = (side: "right" | "left") =>
    tV7(lang, side === "right" ? "intake7.map.yourRight" : "intake7.map.yourLeft");
  return (
    <div className={`bm bm-${props.mode}`}>
      <div className="bm-views" role="group" aria-label={tV7(lang, "intake7.map.views")}>
        {(["front", "back"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            {tV7(lang, v === "front" ? "intake7.map.front" : "intake7.map.back")}
          </button>
        ))}
      </div>
      <div className="bm-figure" data-view={view} role="group" aria-label={tV7(lang, "intake7.map.label")}>
        <Figure view={view} lit={lit} all={props.mode === "edit"} />
        <span className="bm-side bm-side-start" aria-hidden="true">
          {yours(view === "front" ? "right" : "left")}
        </span>
        <span className="bm-side bm-side-end" aria-hidden="true">
          {yours(view === "front" ? "left" : "right")}
        </span>
        {BODY_MAP_CELLS.map((key) => {
          const p = cellPoint(key, view);
          const at = { left: pct(p.x / W), top: pct(p.y / H) };
          if (props.mode === "edit")
            return (
              <button
                key={key}
                type="button"
                className="bm-cell"
                data-cell={key}
                style={at}
                aria-pressed={on!.has(key)}
                aria-label={cellLabel(lang, key)}
                onClick={() => props.onChange(toggleBodyMapCell(props.value, key))}
              >
                <span className="bm-dot" />
              </button>
            );
          const colour = props.colours[key];
          if (!colour || colour === "none") return null;
          const note = props.notes?.[key];
          return (
            <span
              key={key}
              className={`bm-cell bm-mark bm-${colour}`}
              data-cell={key}
              style={at}
              role="img"
              aria-label={note ? `${cellLabel(lang, key)}: ${note}` : cellLabel(lang, key)}
            >
              <span className="bm-dot" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default BodyMap;
