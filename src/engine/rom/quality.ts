/**
 * The quality gate and the live setup check of the v7 range of motion movements (product v7 contract
 * 2.6 and 7, stream B, step B1): the v1 QualityMonitor and setupCheck (src/engine/quality.ts, unchanged)
 * with a configuration built from the movement's data. Pure, no DOM.
 *
 * rom-protocol 1 reuses from movement check v1.1 4.0 «the live setup check (phone level within 5 degrees,
 * distance, framing, one person, light) ... the quality gate». The numbers are the data's
 * (ROM_DATA.engine visibilityMin and fpsMin, each movement's view, distanceM and levelWithinDeg,
 * engine.phoneLevelToleranceDeg where the camera text gives no level) and the v1 rules' own
 * (QUALITY_RULES: 90 percent of frames, the 3 percent margin, 10 percent paused frames). testId is null:
 * the reports carry their issues with no v1 cue, and the runner reports issues[0] (contract 7).
 *
 * Which landmarks gate an attempt: the movement's gate roles (rom-protocol movements[].gate) for the
 * side it reads, except
 *   - a role fixed at calibration (shoulder_abduction MHf, «mid(23, 24) fixed at calibration»): it is
 *     read once, so it gates the calibration, not the attempt (v1 4.1: the hips gate only the
 *     calibration in trunk reference mode, gateCalibrationTrunkMode);
 *   - the hip of shoulder_flexion in gravity mode («the hip is hidden by a wheelchair», review B16), as
 *     the angle reads it (angles.ts);
 *   - an { anyOf } entry (neck_lateral_flexion «ears or eyes»): the angle needs one of them per frame and
 *     returns null otherwise; their landmarks are reported as optional.
 * Optional roles never fail an attempt (v1: their visible share is reported).
 *
 * D-034 item 1 (Nasser's first real test: seated at home 1.2 to 1.5 m away, the legs out of the
 * picture, every movement «not measured» with too_close): a movement needs only the landmarks it
 * measures, the gate above, inside the picture with the gate's 3 percent margin.
 *   - The distance (DistanceRule "trackable"): never too close while those landmarks are in the
 *     picture (out_of_frame says when they are not); too far only beyond the pose model's 4 m limit
 *     (research rom.md [S31]). The setup copy keeps the movement's suggested distance (distanceM).
 *   - The view (viewBlocks false): never a block, but advice for one calm cue (the runner's
 *     viewCue); if the view really is wrong, the movement's plane check and its compensation rules
 *     decide.
 *   - The setup check frames only what the start pose needs (the calibration's gate), never a
 *     knee, an ankle or an optional landmark, and the arm room is a warning.
 *   - The hip of the arm raises to the front and to the back never fails an attempt: a frame whose
 *     hip is hidden or at the picture's edge reads the start trunk line (HIDDEN_HIP_ROLE).
 */
import { QUALITY_RULES, SETUP_RULES, type QualityConfig, type SetupConfig, type ViewClass } from "../quality";
import { LM } from "../types";
import { ROM_DATA } from "../../movements/rom";
import type { LandmarkRef, RomMovementDef, RomMovementId, RomSide } from "../../movements/rom/types";

type Side = "left" | "right";

const otherSide = (s: Side): Side => (s === "left" ? "right" : "left");

/** MediaPipe ids of the sided landmarks the "other" roles name. */
const OTHER_IDS = {
  hip: { left: LM.l_hip, right: LM.r_hip },
  knee: { left: LM.l_knee, right: LM.r_knee },
} as const;

/** The movements whose hip gives way to gravity mode when hidden at calibration (v1.1 4.1, review B16). */
const GRAVITY_HIP_ROLE: Partial<Record<RomMovementId, string>> = { shoulder_flexion: "H" };

/**
 * The arm raises whose hip a frame may lack (D-034 item 1): their angle reads the start trunk line in a
 * frame whose hip is hidden (angles.ts hipInPicture), so the hip never fails an attempt. The start pose
 * still needs it for the arm raise to the back (its trunk line).
 */
const HIDDEN_HIP_ROLE: Partial<Record<RomMovementId, string>> = {
  shoulder_flexion: "H",
  shoulder_extension: "H",
};

/**
 * The model side whose landmarks a movement reads, as the angles read it (angles.ts): a limb movement's
 * tested side, swapped in a mirrored picture (the model labels the person's left as right there); an
 * axial side view's camera side (rom-protocol conventions.sides); none for an axial front view.
 */
export function readSide(
  def: RomMovementDef,
  side: RomSide,
  mirrored: boolean,
  cameraSide: Side | null = null,
): Side | null {
  if (def.axial) return def.view === "side" ? cameraSide : null;
  if (side === "none") return null;
  return mirrored ? otherSide(side) : side;
}

/**
 * The MediaPipe ids of one landmark reference for a model side. Without a side (an axial front view) a
 * sided reference names both sides (trunk_lateral_flexion K: «either knee») and an "other" reference none.
 */
export function refIds(ref: LandmarkRef, side: Side | null): number[] {
  if (typeof ref === "number") return [ref];
  if (Array.isArray(ref)) return [ref[0], ref[1]];
  if ("mid" in ref) return [ref.mid[0], ref.mid[1]];
  if ("other" in ref) return side === null ? [] : [OTHER_IDS[ref.other][otherSide(side)]];
  return side === null ? [ref.left, ref.right] : [ref[side]];
}

/** The ids of one of the movement's roles for a model side. */
export function roleIds(def: RomMovementDef, role: string, side: Side | null): number[] {
  const ref = def.landmarks[role];
  if (ref === undefined) throw new Error(`rom quality: ${def.id} has no landmark role ${role}`);
  return refIds(ref, side);
}

const unique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

export interface RomQualityOptions {
  /** The picture is mirrored (some front cameras): the model's left and right labels swap. */
  mirrored?: boolean;
  /** The model side facing the camera, for an axial side view (trunk_flexion, neck_flexion, neck_extension). */
  cameraSide?: Side | null;
  /** The arm raise is measured against gravity (the hip hidden at calibration). */
  gravityMode?: boolean;
}

/** The gate, optional and every role landmark of a movement for one person's side. */
export function movementLandmarks(
  def: RomMovementDef,
  side: RomSide,
  opts: RomQualityOptions = {},
): { gate: number[]; optional: number[]; all: number[] } {
  const s = readSide(def, side, !!opts.mirrored, opts.cameraSide ?? null);
  const gate: number[] = [];
  const optional: number[] = [];
  for (const g of def.gate) {
    if (typeof g !== "string") {
      for (const r of g.anyOf) optional.push(...roleIds(def, r, s));
      continue;
    }
    const ref = def.landmarks[g];
    const fixed = typeof ref === "object" && ref !== null && "mid" in ref && ref.fixed === true;
    const gravityHip = !!opts.gravityMode && GRAVITY_HIP_ROLE[def.id] === g;
    (fixed || gravityHip ? optional : gate).push(...roleIds(def, g, s));
  }
  for (const r of def.optional) optional.push(...roleIds(def, r, s));
  const gateIds = unique(gate);
  const all = unique(Object.keys(def.landmarks).flatMap((r) => roleIds(def, r, s)));
  return { gate: gateIds, optional: unique(optional).filter((i) => !gateIds.includes(i)), all };
}

/** The movement's camera distance as a band: a range, or about one value as [d, d] (change log FZ-7). */
export function distanceBand(def: RomMovementDef): [number, number] {
  return typeof def.distanceM === "number"
    ? [def.distanceM, def.distanceM]
    : [def.distanceM[0], def.distanceM[1]];
}

/** The views a movement is filmed in (rom-protocol movements[].view). */
export function movementViews(def: RomMovementDef): readonly ViewClass[] {
  return [def.view];
}

/** The attempt gate of a v7 movement for one side (QualityMonitor), with no v1 test (cue null). */
export function romQualityConfig(
  def: RomMovementDef,
  side: RomSide,
  opts: RomQualityOptions = {},
): QualityConfig {
  const lm = movementLandmarks(def, side, opts);
  const hip = HIDDEN_HIP_ROLE[def.id];
  const hipIds =
    hip === undefined ? [] : roleIds(def, hip, readSide(def, side, !!opts.mirrored, opts.cameraSide ?? null));
  const gate = lm.gate.filter((i) => !hipIds.includes(i));
  const optional = unique([...lm.optional, ...lm.gate.filter((i) => hipIds.includes(i))]);
  return {
    testId: null,
    side,
    gate,
    windowGate: [],
    optional,
    minVisibility: ROM_DATA.engine.visibilityMin,
    views: movementViews(def),
    minFps: ROM_DATA.engine.fpsMin,
    distanceM: distanceBand(def),
    minVisibleShare: QUALITY_RULES.minVisibleShare,
    minInFrameShare: QUALITY_RULES.minInFrameShare,
    margin: QUALITY_RULES.margin,
    maxPausedShare: QUALITY_RULES.maxPausedShare,
    distanceRule: "trackable",
    viewBlocks: false,
  };
}

/**
 * The live setup check of a v7 movement for one side (setupCheck): the landmarks the start pose needs
 * (the calibration's gate: the hip of the arm raise to the front may be out of the picture, gravity
 * mode) inside the frame margin; the movement's view and the distance as warnings only, too far beyond
 * the model's limit (D-034 item 1); the phone level within the movement's levelWithinDeg, else
 * engine.phoneLevelToleranceDeg; the room for both arms of the side arm raise («frame margin 1.3 arm
 * lengths each side (v1.1 4.1)», the v1 check, SETUP_RULES.armRoomFactor) as a warning.
 */
export function romSetupConfig(
  def: RomMovementDef,
  side: RomSide,
  opts: RomQualityOptions = {},
): SetupConfig {
  return {
    testId: null,
    side,
    framing: movementLandmarks(def, side, { ...opts, gravityMode: true }).gate,
    views: movementViews(def),
    distanceM: distanceBand(def),
    margin: QUALITY_RULES.margin,
    tiltMaxDeg: def.levelWithinDeg ?? ROM_DATA.engine.phoneLevelToleranceDeg,
    tiltWarnDeg: null,
    armRoom: def.frameMarginArmLengths !== undefined,
    distanceRule: "trackable",
    viewBlocks: false,
    ignoreBehind: true,
    // D-038 item 2: someone in front is in the way only over the movement's own landmarks.
    cover: true,
  };
}

/** The v1 arm room factor the side arm raise's frame margin equals (parity tested). */
export const ARM_ROOM_FACTOR = SETUP_RULES.armRoomFactor;
