/**
 * Stream D, step D2: the coach segments of a focus check and a workout and their minutes (product v7
 * contract C-6 and 5.1, server/modules/agent/segments.ts). One Live session per segment: one per range
 * block with measured items (a block of more than 5 splits after its fifth item), one for the walk and
 * two parts of a workout; each segment's minutes plus 1 stay under Google's 10 minute connection.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_MINUTES,
  MAX_ITEMS_PER_SEGMENT,
  MAX_SEGMENT_MINUTES,
  SESSION_SEGMENTS,
  minutesFor,
  parseSegmentMinutes,
  segmentsFor,
} from "../../server/modules/agent/segments";
import {
  MAX_MEASURED_PER_CHECK,
  type RomProtocol,
  type RomProtocolItem,
} from "../../src/medical/rom-protocol";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { RomBlock } from "../../src/medical/rom-protocol";
import { ROM_DATA } from "../../src/movements/rom";

const POSITION = { seated: "seated", standing: "standing", lying: "lying_back" } as const;

function item(order: number, block: RomBlock, skipped?: RomProtocolItem["skipped"]): RomProtocolItem {
  return {
    movementId: "shoulder_flexion",
    side: order % 2 ? "right" : "left",
    region: "shoulder",
    position: POSITION[block],
    block,
    order,
    priority: "core",
    verdict: "measure",
    normId: null,
    graded: true,
    askCanMove: false,
    helperRequired: false,
    approximate: false,
    ...(skipped ? { skipped } : {}),
  };
}
function protocol(blocks: RomBlock[], skipped: number[] = []): RomProtocol {
  return {
    rulesVersion: "rom_protocol_test",
    items: blocks.map((b, n) => item(n + 1, b, skipped.includes(n + 1) ? "pain_today" : undefined)),
    deferred: [item(99, "seated")],
    notMeasured: [],
    sitBeforeStand: blocks.includes("lying"),
  };
}
const GAIT: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front"], walking_pad: [] },
};
const M = DEFAULT_SEGMENT_MINUTES;

describe("segmentsFor", () => {
  it("gives one segment per range block with measured items, in the check's order, and gait between", () => {
    const segs = segmentsFor(protocol(["seated", "seated", "standing", "lying"]), GAIT);
    expect(segs.map((s) => s.segment)).toEqual(["rom:seated:1", "rom:standing:1", "gait", "rom:lying:1"]);
    const seated = segs[0];
    expect(seated.block === "rom" && seated.items.map((i) => i.order)).toEqual([1, 2]);
    expect(seated.block === "rom" && seated.position).toBe("seated");
  });

  it("splits a block of more than 5 items after its fifth", () => {
    expect(MAX_ITEMS_PER_SEGMENT).toBe(5);
    const segs = segmentsFor(protocol(Array(7).fill("seated")), null);
    expect(segs.map((s) => s.segment)).toEqual(["rom:seated:1", "rom:seated:2"]);
    expect(segs.map((s) => (s.block === "rom" ? s.items.length : 0))).toEqual([5, 2]);
    expect(segmentsFor(protocol(Array(5).fill("lying")), null).map((s) => s.segment)).toEqual([
      "rom:lying:1",
    ]);
  });

  it("leaves out skipped and deferred items, a block with none to measure, and a walk not offered", () => {
    const segs = segmentsFor(protocol(["seated", "standing", "standing"], [1]), { ...GAIT, offered: false });
    expect(segs.map((s) => s.segment)).toEqual(["rom:standing:1"]);
    expect(segmentsFor(protocol([]), null)).toEqual([]);
    expect(segmentsFor(protocol([]), GAIT).map((s) => s.segment)).toEqual(["gait"]);
  });

  it("names the two workout parts", () => {
    expect(SESSION_SEGMENTS).toEqual(["session:1", "session:2"]);
  });
});

describe("segment minutes (5.1)", () => {
  it("are ceil(items x 1.5 + 1) for a range segment, 5 for the walk and 9 for a workout part", () => {
    // D-038 item 3: a demo exercise's segment is 3 minutes (one short set, no workout).
    expect(M).toEqual({ romPerItem: 1.5, romExtra: 1, romMax: 9, gait: 5, session: 9, demo: 3 });
    // rom-protocol sessionOrder: about 1.5 minutes per movement (read from the data, C-1).
    expect(M.romPerItem).toBe(ROM_DATA.sessionOrder.minutesPerMovement);
    const rom = (n: number) => minutesFor({ block: "rom", items: Array(n).fill(item(1, "seated")) }, M);
    expect([1, 2, 3, 4, 5].map(rom)).toEqual([3, 4, 6, 7, 9]);
    expect(minutesFor({ block: "gait" }, M)).toBe(5);
    expect(minutesFor({ block: "session" }, M)).toBe(9);
  });

  it("keep every segment of an 8 movement protocol within its token life, under the 10 minute connection", () => {
    expect(MAX_MEASURED_PER_CHECK).toBe(8);
    expect(MAX_SEGMENT_MINUTES).toBe(9);
    const shapes: RomBlock[][] = [
      Array(8).fill("seated"),
      [...Array(6).fill("seated"), "standing", "lying"],
      [...Array(4).fill("standing"), ...Array(4).fill("lying")],
      ["seated", "seated", "seated", "standing", "standing", "standing", "lying", "lying"],
    ];
    for (const shape of shapes)
      for (const s of segmentsFor(protocol(shape), GAIT)) {
        const minutes = minutesFor(s, M);
        expect(minutes, s.segment).toBeLessThanOrEqual(9);
        expect(minutes + 1, s.segment).toBeLessThanOrEqual(10);
      }
  });

  it("fit a full A to Z at the cap in the default user budget of 45 (41 minutes)", () => {
    // The worst split of 5.1: 6 seated items as 5 and 1, then 1 standing and 1 lying.
    const segs = segmentsFor(protocol([...Array(6).fill("seated"), "standing", "lying"]), GAIT);
    const range = segs.filter((s) => s.block === "rom").map((s) => minutesFor(s, M));
    expect(range).toEqual([9, 3, 3, 3]);
    const total =
      range.reduce((a, b) => a + b, 0) +
      minutesFor({ block: "gait" }, M) +
      2 * minutesFor({ block: "session" }, M);
    expect(total).toBe(41);
    expect(total + 2 * 2).toBeLessThanOrEqual(45);
  });
});

describe("parseSegmentMinutes (AZM_AGENT_SEGMENT_MINUTES)", () => {
  it("reads the contract's default text and falls back to the defaults", () => {
    expect(parseSegmentMinutes("rom_per_item:1.5,rom_extra:1,rom_max:9,gait:5,session:9")).toEqual(M);
    expect(parseSegmentMinutes(undefined)).toEqual(M);
    expect(parseSegmentMinutes("")).toEqual(M);
  });

  it("takes valid overrides and ignores unknown keys and bad values", () => {
    expect(parseSegmentMinutes("gait:4, session:8,unknown:3")).toEqual({ ...M, gait: 4, session: 8 });
    expect(parseSegmentMinutes("gait:abc,session:-1,rom_per_item:0")).toEqual(M);
  });

  it("never lets a segment pass the connection limit", () => {
    expect(parseSegmentMinutes("rom_max:12,gait:15,session:10")).toEqual({
      ...M,
      romMax: 9,
      gait: 9,
      session: 9,
    });
  });
});
