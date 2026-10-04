/**
 * The picture of a range of motion movement (product v7 contract 1.2): what the person is asked to
 * move, beside the movement's instructions.
 *
 * Placeholder of step A5 (contract 1.3) until stream F draws the movement pictures: a skeleton line
 * figure from the movement's start and end angles. The joint is the dot, the fixed segment points up,
 * the start of the moving segment is dashed and its end is solid, with an arc between them. The end
 * angle is the typical value of the movement's first graded norm row (the first row's mean), so
 * the picture shows a usual movement, never the person's own result; a straightening movement (lack)
 * starts bent and ends straight. The figure is mirrored for the left side.
 */
import type { Lang } from "../../app/i18n";
import { movementDef, ROM_DATA } from "../../movements/rom";
import type { RomMovementId, RomSide } from "../../movements/rom/types";

export interface MovementPictureProps {
  movementId: RomMovementId;
  side?: RomSide;
  lang: Lang;
  /** Width and height in CSS pixels (default 120). */
  size?: number;
}

const JOINT = { x: 60, y: 60 };
const SEGMENT = 46;
const ARC = 18;
/** Where a straightening movement is drawn to start from: a bent joint (a drawing choice only). */
const BENT_START_DEG = 90;

/** The usual end angle of a movement: the mean of its first graded norm row, whole degrees. */
function typicalEndDeg(movementId: RomMovementId): number {
  const def = movementDef(movementId);
  const normId = def.positions.find((p) => p.graded && p.normId)?.normId;
  const mean = ROM_DATA.norms.find((n) => n.id === normId)?.rows[0]?.mean ?? 0;
  return Math.round(Math.abs(mean));
}

/** A point at `deg` from the downward zero line, turned toward the front (to the right). */
function at(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: JOINT.x + r * Math.sin(rad), y: JOINT.y + r * Math.cos(rad) };
}

export function MovementPicture({ movementId, side, lang, size = 120 }: MovementPictureProps) {
  const def = movementDef(movementId);
  const typical = typicalEndDeg(movementId);
  const [startDeg, endDeg] = def.kind === "lack" ? [BENT_START_DEG, typical] : [0, typical];
  const start = at(startDeg, SEGMENT);
  const end = at(endDeg, SEGMENT);
  const a0 = at(startDeg, ARC);
  const a1 = at(endDeg, ARC);
  const sweep = endDeg > startDeg ? 0 : 1;
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return (
    <svg
      className="movement-picture"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={def.name[lang]}
    >
      <g transform={side === "left" ? "matrix(-1 0 0 1 120 0)" : undefined}>
        <line
          x1={JOINT.x}
          y1={JOINT.y}
          x2={JOINT.x}
          y2={14}
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <line
          x1={JOINT.x}
          y1={JOINT.y}
          x2={start.x}
          y2={start.y}
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray="6 6"
          opacity={0.45}
        />
        <path
          d={`M ${a0.x} ${a0.y} A ${ARC} ${ARC} 0 ${large} ${sweep} ${a1.x} ${a1.y}`}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={3}
        />
        <line
          x1={JOINT.x}
          y1={JOINT.y}
          x2={end.x}
          y2={end.y}
          stroke="var(--purple)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle cx={JOINT.x} cy={JOINT.y} r={6} fill="var(--purple)" />
      </g>
    </svg>
  );
}

export default MovementPicture;
