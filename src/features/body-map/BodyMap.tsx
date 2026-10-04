/**
 * The body map (product v7 contract 2.2): a front and a back outline of a person with one 44 px
 * touch target per region and side (a body map cell, BodyMapKey).
 *
 *   edit     the intake: a tap on a cell adds that region and side, or takes it off the map
 *            (toggleBodyMapCell); the questions of each region are the intake form's.
 *   summary  the findings page (stream B): each cell coloured by its BodyMapColour.
 *
 * Left and right are always the person's own (rom-protocol conventions.sides): in the front view the
 * person faces you, so their right side is on your left, and each view names its sides. The figure
 * never mirrors with the page direction (it is drawn left to right in both languages); its labels
 * are in the page language. The art is original Azm line art.
 *
 * `lang` is a prop beside the contract's mode props, for the labels (contract change log, A2).
 */
import { useState } from "react";
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

/** Every cell in reading order: the neck, the back or trunk, then each limb region right then left. */
export const BODY_MAP_CELLS: readonly BodyMapKey[] = REGION_IDS.flatMap((region): BodyMapKey[] =>
  AXIAL_REGIONS.includes(region) ? [`${region}:axial`] : [`${region}:right`, `${region}:left`],
);

const parse = (key: BodyMapKey) => key.split(":") as [RegionId, "left" | "right" | "axial"];

/** Where a cell sits in a view, in viewBox units. */
export function cellPoint(key: BodyMapKey, view: BodyMapView): { x: number; y: number } {
  const [region, side] = parse(key);
  if (side === "axial") {
    const [x, y] = AXIAL_POINT[region as "neck" | "back_trunk"];
    return { x, y };
  }
  const [x, y] = RIGHT_FRONT[region as LimbRegion];
  // Front: the person's right is on your left. Back: it is on your right.
  const onYourLeft = (side === "right") === (view === "front");
  return { x: onYourLeft ? x : W - x, y };
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

function Figure({ view }: { view: BodyMapView }) {
  const shapes = (
    <>
      <circle cx="120" cy="38" r="23" />
      <rect x="108" y="54" width="24" height="30" rx="9" />
      <path d="M84 84C100 78 140 78 156 84L170 94C176 98 177 106 175 114L163 196C161 214 160 232 158 256L82 256C80 232 79 214 77 196L65 114C63 106 64 98 70 94Z" />
      <path className="bm-arm" d="M72 104L56 168L44 230" />
      <path className="bm-arm" d="M168 104L184 168L196 230" />
      <circle cx="41" cy="250" r="11" />
      <circle cx="199" cy="250" r="11" />
      <path className="bm-leg" d="M100 250L95 336L92 404" />
      <path className="bm-leg" d="M140 250L145 336L148 404" />
      <ellipse cx="87" cy="421" rx="16" ry="9" />
      <ellipse cx="153" cy="421" rx="16" ry="9" />
    </>
  );
  return (
    <svg className="bm-art" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <g className="bm-outline">{shapes}</g>
      <g className="bm-body">{shapes}</g>
      {view === "front" ? (
        <path className="bm-detail" d="M98 94Q120 102 142 94" />
      ) : (
        <path className="bm-detail" d="M120 92L120 238" />
      )}
    </svg>
  );
}

/** The body map: a front and a back view, edit or summary (contract 2.2). */
export function BodyMap(props: BodyMapProps) {
  const { lang } = props;
  const [view, setView] = useState<BodyMapView>("front");
  const on = props.mode === "edit" ? new Set(props.value.flatMap(entryCells)) : null;
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
        <Figure view={view} />
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
