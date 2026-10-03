/**
 * The range of motion protocol of a focus check (product v7 contract 2.5; rom-protocol sections 2,
 * 3 and 6): which movements of the affected regions are measured today, in which position, block and
 * order, and why the others are not. Pure, no DOM: the start route builds it on the server.
 *
 * Step A1 commits the types and the cap; buildRomProtocol lands with step A4.
 */
import type { Intake } from "./plan";
import type { RegionId } from "./body-map";
import type { JointMovementId, RomData, RomMovementId, RomPositionId, RomSide } from "../movements/rom/types";
import type { ReasonId } from "../movements/types";

/** v7 reasons plus v1 reasons carried from the pre-check. */
export type RomReasonId = keyof RomData["reasonIds"] | ReasonId;
export type RomBlock = "seated" | "standing" | "lying";
export interface FocusToday {
  /** pain_ask per pain region of the body map, 0 to 10. */
  painByRegion: Partial<Record<RegionId, number>>;
  /** Regions with a red flag today (rom-protocol 6 red_flags): the answers of the rf_region item, one per affected region on the day's protocol. */
  redFlagRegions: RegionId[];
  /** pc_limb_leg_prosthesis */
  prosthesisOn?: boolean;
  /** pc_transfer_chair */
  transferChair?: boolean;
  /** pc_helper */
  helperPresent?: boolean;
  /** pc_walk_10m (gait) */
  walk10m?: boolean;
  /** pc_pd_freezing (gait) */
  pdFreezing?: boolean;
  orthosis?: Partial<Record<"left" | "right", "afo" | "kafo" | "knee_brace">>;
}
export interface RomProtocolItem {
  movementId: RomMovementId;
  side: RomSide;
  region: RegionId;
  position: RomPositionId;
  block: RomBlock;
  order: number;
  priority: "core" | "extended";
  verdict: "measure" | "caution";
  normId: string | null;
  graded: boolean;
  /** Weakness in the region: can_move_ask before the movement. */
  askCanMove: boolean;
  helperRequired: boolean;
  approximate: boolean;
  /** Set when the item does not run today (it then stays in the protocol for the record). */
  skipped?: RomReasonId;
}
export interface RomNotMeasured {
  movementId: JointMovementId;
  side: RomSide;
  region: RegionId;
  source: "not_measured_camera" | "not_applicable" | "not_measured_today";
  reason: RomReasonId;
}
export interface RomProtocol {
  rulesVersion: string;
  /** at most MAX_MEASURED_PER_CHECK without skipped */
  items: RomProtocolItem[];
  /** beyond the cap, shown as not measured today */
  deferred: RomProtocolItem[];
  /** default only movements of affected regions, absent joints, safety skips */
  notMeasured: RomNotMeasured[];
  sitBeforeStand: boolean;
}
/** C-13 and rom-protocol sessionOrder: at most 8 measured movements per check. */
export const MAX_MEASURED_PER_CHECK = 8;
export interface RomProtocolInput {
  intake: Intake & Required<Pick<Intake, "sex" | "regions" | "walking">>;
  setting: "home" | "booth";
  today: FocusToday;
  /** The baseline's protocol at a retest: same positions for movements measured before (like with like). */
  previous?: RomProtocol | null;
  /** The measured cap; MAX_MEASURED_PER_CHECK unless the start route passes the showcase cap (2, F1). */
  maxMeasured?: number;
}
