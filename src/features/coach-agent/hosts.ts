/**
 * The live coach on the app's hosts (product v7 contract 2.11, C-5, C-6; stream D, step D5): the coach
 * segment of a range part, whether the coach runs, and the lines a host leaves to it. Pure, no DOM.
 *
 *   - One Live session per coach segment (C-6): a range block is rom:<block>:1, split after its fifth
 *     measured movement into rom:<block>:2, as the token route's segmentsFor builds them; the walk is
 *     gait (C4's GaitStep owns it); a workout is session:1 then session:2 (Workout.tsx owns it).
 *   - The coach is an enhancement, never a dependency, and off by default (C-5): it runs only with the
 *     person's switch on, the live_coach consent and a network.
 *   - While it runs, the host never asks a range question aloud (bridge rule 2, D-12): the coach asks
 *     it, or the bridge's local voice when the coach is late.
 */
import type { CoachSegment } from "../../coach/types";
import type { RomBlock, RomProtocol, RomProtocolItem } from "../../medical/rom-protocol";
import { LOCAL_ASK } from "./bridge";

/** C-6: a block with more than this many measured movements splits into two segments (segments.ts). */
export const ITEMS_PER_ROM_SEGMENT = 5;

/**
 * The coach segment of a range block at `item` (null before the block's first movement): its first
 * five measured movements, in run order, are segment 1, the rest segment 2.
 */
export function romSegment(
  protocol: RomProtocol,
  block: RomBlock,
  item: Pick<RomProtocolItem, "movementId" | "side"> | null,
): CoachSegment {
  if (!item) return `rom:${block}:1`;
  const measured = protocol.items
    .filter((i) => !i.skipped && i.block === block)
    .sort((a, b) => a.order - b.order);
  const at = measured.findIndex((i) => i.movementId === item.movementId && i.side === item.side);
  return at >= ITEMS_PER_ROM_SEGMENT ? `rom:${block}:2` : `rom:${block}:1`;
}

/**
 * C-5: the person's switch, the live_coach consent, a network, and the server able to run the coach now
 * (GET /api/agent/status, D-030 D5-12: never a mint that can only fail).
 */
export function liveCoachOn(s: {
  preference: boolean;
  consent: boolean;
  online: boolean;
  available: boolean;
}): boolean {
  return s.preference && s.consent && s.online && s.available;
}

/** The range questions' voice lines (bridge rule 2): a host leaves them to the coach while it runs. */
export const COACH_ASK_LINES: ReadonlySet<string> = new Set(Object.values(LOCAL_ASK).map((a) => a.line));
