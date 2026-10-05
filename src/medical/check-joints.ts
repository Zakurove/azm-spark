/**
 * The joints of a check, for the 48 hour minimum between checks (product v7 contract section 4; CT-3,
 * D-025 item 5): «the 48 hour rule applies only between checks that share a joint; a different joint can
 * be checked at any time, in both directions between v1 and v7 checks». A joint is a body map cell (a
 * region on its side; the neck and the back or trunk are one cell each), and the rule compares the
 * regions each check measures:
 *   - a focus check about to start measures the cells of its range items that run today (not skipped,
 *     not deferred) and, when it walks, the regions a walk measures (GAIT_JOINT_REGIONS);
 *   - a completed focus check measured the cells of its rows with a value or attempts (the person moved
 *     the joint, measured or not), and the walk's regions when it holds a gait analysis;
 *   - a v1 check loads the areas of its tests (check-v1 areas[].loads, the v1 data's own map of which
 *     joint each test loads), each area one or two body map cells. A v1 check about to start counts
 *     every joint its tests can load (V1_CHECK_JOINTS), the safe side, since its tests are chosen after
 *     the pre-check.
 * v1 checks keep their own 48 hour rule between themselves (checkSchedule), unchanged. Pure, no DOM.
 */
import { AXIAL_REGIONS, type BodyMapKey, type RegionId } from "./body-map";
import { earliestNextCheck } from "./assessment";
import type { RomProtocol } from "./rom-protocol";
import { CHECK_DATA } from "../movements/assessments";
import { ROM_DATA } from "../movements/rom";
import type { JointMovementId, RomSide } from "../movements/rom/types";
import type { AreaId, TestId } from "../movements/types";

/** The joint of a region on a side: the cell of the body map. */
export function jointOf(region: RegionId, side: RomSide): BodyMapKey {
  if (AXIAL_REGIONS.includes(region)) return `${region}:axial`;
  if (side === "none") throw new RangeError(`A joint of the ${region} needs a side`);
  return `${region}:${side}`;
}

/**
 * The regions a walk measures: the gait metrics read the hips, knees and ankles of both legs (thigh,
 * knee and foot angles, gait-rules metrics) and the pelvis and trunk (pelvic drop, trunk lean and sway).
 */
export const GAIT_JOINT_REGIONS: readonly RegionId[] = Object.freeze([
  "back_trunk",
  "hip",
  "knee",
  "ankle_foot",
]);
const GAIT_JOINTS: readonly BodyMapKey[] = GAIT_JOINT_REGIONS.flatMap((r) =>
  AXIAL_REGIONS.includes(r) ? [jointOf(r, "none")] : [jointOf(r, "right"), jointOf(r, "left")],
);

/**
 * Each v1 area as body map cells (check-v1 areas: «shoulder_right» is the right shoulder, «wrist_left»
 * the left forearm and wrist, «back» the back or trunk; the hip, knee and ankle and foot areas have no
 * side, so they are both legs).
 */
export const V1_AREA_JOINTS: Readonly<Record<AreaId, readonly BodyMapKey[]>> = Object.freeze({
  shoulder_right: ["shoulder:right"],
  shoulder_left: ["shoulder:left"],
  elbow_right: ["elbow:right"],
  elbow_left: ["elbow:left"],
  wrist_right: ["forearm_wrist:right"],
  wrist_left: ["forearm_wrist:left"],
  back: ["back_trunk:axial"],
  hip: ["hip:right", "hip:left"],
  knee: ["knee:right", "knee:left"],
  ankle_foot: ["ankle_foot:right", "ankle_foot:left"],
});

/** One v1 result: its test, side and the variant it ran in. */
export interface V1Result {
  testId: TestId;
  side: "left" | "right" | "none";
  variant: string | null;
}

/**
 * The joints a v1 result loads: every area with a load of its test on its side («each»: either side of a
 * two sided test; «none»: a test without sides), a load of a variant only in that variant.
 */
export function v1ResultJoints(r: V1Result): Set<BodyMapKey> {
  const out = new Set<BodyMapKey>();
  for (const area of CHECK_DATA.areas)
    for (const load of area.loads) {
      if (load.test !== r.testId) continue;
      if (load.side !== "each" && load.side !== "none" && load.side !== r.side) continue;
      if (load.variant !== undefined && load.variant !== r.variant) continue;
      for (const j of V1_AREA_JOINTS[area.id]) out.add(j);
    }
  return out;
}

/** Every joint a v1 check can load: every area its tests list, the variants included (never the neck). */
export const V1_CHECK_JOINTS: ReadonlySet<BodyMapKey> = new Set(
  CHECK_DATA.areas.filter((a) => a.loads.length > 0).flatMap((a) => [...V1_AREA_JOINTS[a.id]]),
);

/** The region of a joint movement: its region table row (camera and default only movements). */
const REGION_OF: ReadonlyMap<string, RegionId> = new Map(
  ROM_DATA.regionTable.flatMap((row) =>
    [...row.measure, ...row.caution, ...row.default].map((m): [string, RegionId] => [m, row.region]),
  ),
);
function regionOf(m: JointMovementId): RegionId {
  const r = REGION_OF.get(m);
  if (!r) throw new RangeError(`Unknown joint movement ${m}`);
  return r;
}

/** The joints a focus check measures when it starts: its range items that run, and the walk's regions. */
export function focusPlanJoints(protocol: Pick<RomProtocol, "items">, walks: boolean): Set<BodyMapKey> {
  const out = new Set<BodyMapKey>();
  for (const i of protocol.items) if (!i.skipped) out.add(jointOf(i.region, i.side));
  if (walks) for (const j of GAIT_JOINTS) out.add(j);
  return out;
}

/** A stored range row as the joints read it. */
export interface StoredJointRow {
  movementId: JointMovementId;
  side: RomSide;
  value: number | null;
  /** How many scored attempts it kept. */
  attempts: number;
}

/** The joints a completed focus check measured: rows with a value or attempts, and the walk's regions. */
export function focusStoredJoints(rows: readonly StoredJointRow[], walked: boolean): Set<BodyMapKey> {
  const out = new Set<BodyMapKey>();
  for (const r of rows)
    if (r.value !== null || r.attempts > 0) out.add(jointOf(regionOf(r.movementId), r.side));
  if (walked) for (const j of GAIT_JOINTS) out.add(j);
  return out;
}

/** A completed check with the joints it measured. */
export interface CheckJoints {
  completed: number;
  joints: ReadonlySet<BodyMapKey>;
}

/**
 * The 48 hour minimum for a check measuring `joints`: 48 hours after the latest completed check that
 * shares one of them (earliestNextCheck), or null when none does.
 */
export function sharedUntil(checks: readonly CheckJoints[], joints: ReadonlySet<BodyMapKey>): number | null {
  let latest: number | null = null;
  for (const c of checks) {
    if (!Number.isFinite(c.completed) || ![...c.joints].some((j) => joints.has(j))) continue;
    if (latest === null || c.completed > latest) latest = c.completed;
  }
  return earliestNextCheck(latest);
}
