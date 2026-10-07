/**
 * The joints of a focus check's movements (plan 1.7: which joints we will measure), pure: the intro
 * lists them and the program's build counts them (D-032 item 3).
 */
import { REGION_IDS, type BodyMapKey, type RegionId } from "../../medical/body-map";
import type { RomProtocolItem } from "../../medical/rom-protocol";
import type { RomSide } from "../../movements/rom/types";

/** A joint of the day: a region and a side, with its movements in protocol order. */
export interface JointGroup {
  key: string;
  region: RegionId;
  side: RomSide;
  items: RomProtocolItem[];
}

/** The joints of the day's movements in body order (the region list, the right side first). */
export function jointsOf(items: readonly RomProtocolItem[]): JointGroup[] {
  const groups = new Map<string, JointGroup>();
  for (const i of items) {
    const key = `${i.region}:${i.side}`;
    const g = groups.get(key) ?? { key, region: i.region, side: i.side, items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const rank = { right: 0, left: 1, none: 2 } as const;
  return [...groups.values()].sort(
    (a, b) => REGION_IDS.indexOf(a.region) - REGION_IDS.indexOf(b.region) || rank[a.side] - rank[b.side],
  );
}

/** The body map cell of a joint (the neck and the back have one, axial). */
export const cellOf = (g: Pick<JointGroup, "region" | "side">): BodyMapKey =>
  (g.side === "none" ? `${g.region}:axial` : `${g.region}:${g.side}`) as BodyMapKey;
