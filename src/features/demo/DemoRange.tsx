/**
 * The booth demo's range of motion (/demo): pick a movement, the common ones first, and its side;
 * then the range test page's own measuring screens (RomLab's LabRun in its demo mode: the camera, the
 * skeleton and the meter, the result; nothing saved, no diagnostics). Each movement runs in a position
 * that suits a booth (never lying down when the movement has another). The X comes back to the demo
 * home; «حركة أخرى» to this list.
 */
import { useState } from "react";
import type { Lang } from "../../app/i18n";
import { movementDef } from "../../movements/rom";
import type { RomMovementId, RomPositionId, RomSide } from "../../movements/rom/types";
import { ROM_MOVEMENT_IDS } from "../../movements/rom/types";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import CheckIcon from "../assessment/shared/CheckIcon";
import { MovementPicture } from "../focus/MovementPicture";
import { Body, Glass, Kicker, Page, Title, TopBar } from "../focus/parts";
import { movementName, positionName } from "../focus/copy";
import { LabRun, labItem, sidesOf } from "../focus/RomLab";
import { demoCopy } from "./copy";

/** The movements shown first: those a booth visitor asks for most. */
export const COMMON_MOVEMENTS: readonly RomMovementId[] = [
  "shoulder_flexion",
  "elbow_flexion",
  "knee_flexion",
  "shoulder_abduction",
  "hip_flexion",
  "knee_extension",
];

/** Every other measured movement, in the data's order. */
export const MORE_MOVEMENTS: readonly RomMovementId[] = ROM_MOVEMENT_IDS.filter(
  (id) => !COMMON_MOVEMENTS.includes(id),
);

/** The position a movement runs in at the booth: the first that is not lying on the back. */
export function boothPosition(id: RomMovementId): RomPositionId {
  const positions = movementDef(id).positions;
  return (positions.find((p) => p.id !== "lying_back") ?? positions[0]).id;
}

/** The side a movement runs on: the chosen one, or none for a movement without sides. */
export function runSide(id: RomMovementId, chosen: "right" | "left"): RomSide {
  const sides = sidesOf(id);
  return sides.includes(chosen) ? chosen : sides[0];
}

export interface DemoRangeProps {
  lang: Lang;
  onLanguage(): void;
  onClose(): void;
}

export default function DemoRange({ lang, onLanguage, onClose }: DemoRangeProps) {
  const [side, setSide] = useState<"right" | "left">("right");
  const [run, setRun] = useState<{ id: RomMovementId; n: number } | null>(null);
  if (run) {
    const s = runSide(run.id, side);
    return (
      <LabRun
        key={`${run.id}:${s}:${run.n}`}
        lang={lang}
        onLanguage={onLanguage}
        item={labItem(run.id, s, boothPosition(run.id))}
        demo={{
          onClose,
          onAgain: () => setRun({ ...run, n: run.n + 1 }),
          onAnother: () => setRun(null),
        }}
      />
    );
  }
  const c = demoCopy(lang);
  const card = (id: RomMovementId) => {
    const s = runSide(id, side);
    return (
      <li key={id}>
        <button type="button" className="dm-move" data-movement={id} onClick={() => setRun({ id, n: 0 })}>
          <MovementPicture movementId={id} side={s === "none" ? undefined : s} lang={lang} size={84} />
          <span className="dm-move-text">
            <b>{movementName(id, lang)}</b>
            <span>{positionName(boothPosition(id), lang)}</span>
          </span>
          <span className="dm-part-go" aria-hidden="true">
            <CheckIcon name="arrow-forward" size={22} />
          </span>
        </button>
      </li>
    );
  };
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page
        lang={lang}
        top={<TopBar lang={lang} onLanguage={onLanguage} onLeave={onClose} leaveLabel={c.back} />}
        screen="demo_range"
      >
        <div className="dm-home">
          <Glass className="fx-card dm-hero">
            <Kicker>{c.parts.range.title}</Kicker>
            <Title>{c.range.title}</Title>
            <Body lang={lang} text={c.range.intro} />
            <div className="dm-sides" role="radiogroup" aria-label={c.range.side}>
              {(["right", "left"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={side === s}
                  className={`fx-chip dm-side${side === s ? " is-on" : ""}`}
                  data-side={s}
                  onClick={() => setSide(s)}
                >
                  {c.range[s]}
                </button>
              ))}
            </div>
          </Glass>
          <h2 className="dm-group">{c.range.common}</h2>
          <ul className="dm-moves">{COMMON_MOVEMENTS.map(card)}</ul>
          <h2 className="dm-group">{c.range.more}</h2>
          <ul className="dm-moves">{MORE_MOVEMENTS.map(card)}</ul>
        </div>
      </Page>
    </CheckRoot>
  );
}
