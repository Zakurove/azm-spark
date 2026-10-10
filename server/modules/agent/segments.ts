/**
 * The live coach's segments and their minutes (product v7 contract C-6 and 5.1, stream D).
 *
 * One Live session per segment, so each fits Google's 10 minute connection (live-spike.md 9): one per
 * range block with measured items (rom:<block>:1; a block with more than 5 items splits after its
 * fifth into rom:<block>:2), gait when the walk is offered, and the two parts of a workout (session:1,
 * session:2; a workout longer than two parts runs the rest in local mode). A segment's minutes set its
 * token life and its reservation in the budget. Range: ceil(items x 1.5 + 1), the 1.5 minutes per
 * movement of rom-protocol sessionOrder (read from the data, C-1); gait 5; each workout part 9.
 */
import type { CoachBlock, CoachSegment } from "../../../src/coach/types";
import type { GaitPlan } from "../../../src/medical/gait-eligibility";
import {
  BLOCK_RUN_ORDER,
  type RomBlock,
  type RomProtocol,
  type RomProtocolItem,
} from "../../../src/medical/rom-protocol";
import { ROM_DATA } from "../../../src/movements/rom";

/** AZM_AGENT_SEGMENT_MINUTES (5.4). */
export interface SegmentMinutes {
  /** rom_per_item */
  romPerItem: number;
  /** rom_extra */
  romExtra: number;
  /** rom_max */
  romMax: number;
  gait: number;
  session: number;
  /** D-038 item 3: a demo exercise (one short set). */
  demo: number;
}

/** Google closes a Live connection at 10 minutes, with no goAway (S0-3, live-spike.md 9). */
export const CONNECTION_LIMIT_MINUTES = 10;
/** A segment's minutes plus the 1 minute margin stay within the connection (5.1). */
export const MAX_SEGMENT_MINUTES = CONNECTION_LIMIT_MINUTES - 1;

/**
 * The defaults of 5.4: rom_per_item:1.5,rom_extra:1,rom_max:9,gait:5,session:9, and demo:3 (D-038 item
 * 3: a demo set of 4 to 6 repetitions with its setup takes 1 to 2 minutes; its token life and its
 * reservation stay short so a few demos never use up the day's minutes).
 */
export const DEFAULT_SEGMENT_MINUTES: Readonly<SegmentMinutes> = Object.freeze({
  romPerItem: ROM_DATA.sessionOrder.minutesPerMovement,
  romExtra: 1,
  romMax: MAX_SEGMENT_MINUTES,
  gait: 5,
  session: MAX_SEGMENT_MINUTES,
  demo: 3,
});

const KEYS: Record<string, keyof SegmentMinutes> = {
  rom_per_item: "romPerItem",
  rom_extra: "romExtra",
  rom_max: "romMax",
  gait: "gait",
  session: "session",
  demo: "demo",
};

/**
 * AZM_AGENT_SEGMENT_MINUTES as "key:value" pairs. Unknown keys and values that are not positive
 * numbers are ignored (the default stays); no segment may pass MAX_SEGMENT_MINUTES.
 */
export function parseSegmentMinutes(raw: string | undefined): SegmentMinutes {
  const out: SegmentMinutes = { ...DEFAULT_SEGMENT_MINUTES };
  for (const pair of (raw ?? "").split(",")) {
    const [k, v] = pair.split(":").map((x) => x.trim());
    const key = KEYS[k];
    const n = Number(v);
    if (!key || v === undefined || v === "" || !Number.isFinite(n)) continue;
    if (key === "romExtra" ? n < 0 : n <= 0) continue;
    out[key] = n;
  }
  for (const k of ["romMax", "gait", "session", "demo"] as const)
    out[k] = Math.min(out[k], MAX_SEGMENT_MINUTES);
  return out;
}

/** C-6: a block with more than this many items splits into two segments at a movement boundary. */
export const MAX_ITEMS_PER_SEGMENT = 5;

/** A coach segment of a focus check, with its range items in run order. */
export type CheckSegment =
  | { block: "rom"; segment: `rom:${RomBlock}:${1 | 2}`; position: RomBlock; items: RomProtocolItem[] }
  | { block: "gait"; segment: "gait" };

/** The two parts of a workout. */
export const SESSION_SEGMENTS: readonly CoachSegment[] = Object.freeze(["session:1", "session:2"]);
/** D-038 item 3: a demo exercise's one segment (no workout). */
export const DEMO_SEGMENT = "demo" as const satisfies CoachSegment;

/**
 * The coach segments of a stored protocol and gait plan, in the order the check runs them (C-13:
 * seated, standing, gait, lying). Skipped and deferred items are not measured, so they are in none.
 */
export function segmentsFor(protocol: RomProtocol, gait: GaitPlan | null): CheckSegment[] {
  const measured = protocol.items.filter((i) => !i.skipped).sort((a, b) => a.order - b.order);
  const out: CheckSegment[] = [];
  for (const block of BLOCK_RUN_ORDER) {
    if (block === "lying" && gait?.offered) out.push({ block: "gait", segment: "gait" });
    const items = measured.filter((i) => i.block === block);
    if (!items.length) continue;
    out.push({
      block: "rom",
      segment: `rom:${block}:1`,
      position: block,
      items: items.slice(0, MAX_ITEMS_PER_SEGMENT),
    });
    if (items.length > MAX_ITEMS_PER_SEGMENT)
      out.push({
        block: "rom",
        segment: `rom:${block}:2`,
        position: block,
        items: items.slice(MAX_ITEMS_PER_SEGMENT),
      });
  }
  if (gait?.offered && !out.some((s) => s.block === "gait")) out.push({ block: "gait", segment: "gait" });
  return out;
}

/** A segment's minutes (5.1): its token life is these plus the margins of token.ts, and its reservation. */
export function minutesFor(
  s: { block: "rom"; items: readonly unknown[] } | { block: Exclude<CoachBlock, "rom"> },
  m: SegmentMinutes,
): number {
  if (!("items" in s)) return s.block === "gait" ? m.gait : m.session;
  return Math.min(m.romMax, Math.ceil(s.items.length * m.romPerItem + m.romExtra));
}
