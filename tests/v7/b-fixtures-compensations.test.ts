/**
 * The compensation fixtures (product v7 contract 8.2, stream B, step B2): one for each compensation of
 * the 16 measured movements (rom-protocol movements[].compensations), the person doing it in the first
 * scored attempt, in both phone shapes at the matrix's noise.
 *
 * D-035 item 1 (the MVP runner): a compensation never discards the attempt. A check whose effect is
 * invalid flags that attempt (its id in the reasons, flag approximate) and the movement is measured on
 * it, never repeated; a flag only check flags the valid attempt as before; the logged shrug is at most
 * the movement's one calm line. Every hit is a compensation event (one spoken cue at most per movement,
 * the rest silent flags). Where another check reads the same posture first (firesAs, change log B2-6)
 * the attempt carries that check's name.
 */
import { describe, expect, it } from "vitest";
import { compensationDef, ROM_DATA } from "../../src/movements/rom";
import type { RomAttempt, RomEvent } from "../../src/engine/rom/types";
import type { CompensationId } from "../../src/movements/rom/types";
import {
  COMPENSATION_FIXTURES,
  compensationSpec,
  endAngle,
  runRom,
  VALUE_TOLERANCE_DEG,
  type CompensationFixture,
} from "./b-fixtures";

const scored = (records: RomAttempt[]) => records.filter((a) => a.index > 0);
type CompensationEvent = Extract<RomEvent, { kind: "compensation" }>;
const compensationEvents = (events: RomEvent[], id: CompensationId, level?: "cue" | "flag") =>
  events.filter(
    (e): e is CompensationEvent =>
      e.kind === "compensation" && e.id === id && (level === undefined || e.level === level),
  );

describe("a fixture for every compensation of the data", () => {
  it("covers each movement's compensations, once each", () => {
    const want = ROM_DATA.movements.flatMap((m) => m.compensations.map((c) => `${m.id} ${c.id}`)).sort();
    const have = COMPENSATION_FIXTURES.map((c) => `${c.movement} ${c.id}`).sort();
    expect(have).toEqual(want);
  });
});

/**
 * Compensations that cancel the movement's own angle in the picture (the hip's extension read against
 * a trunk that tilts forward as far): the try may show no movement at all, a try without a value,
 * repeated as no_hold (D-035: only a try without a value is repeated), or going on to the next
 * repetition within its time; then measured clean.
 */
const HIDES_MOVEMENT = new Set(["hip_extension trunk_tilt"]);

function check(c: CompensationFixture, aspect: "16:9" | "9:16") {
  const run = runRom(compensationSpec(c, aspect));
  const def = compensationDef(c.movement, c.id);
  const truth = endAngle(c.movement, c.position, c.percent ?? 100, c.side);
  const rep = run.fx.truth.rom!.reps[1];
  const inRep = (t: number) => t / 1000 >= rep.start && t / 1000 <= rep.end;
  const first = scored(run.records)[0];
  const res = run.result;
  if (HIDES_MOVEMENT.has(`${c.movement} ${c.id}`) && (first.outcome === "retry" || !inRep(first.t1))) {
    // No movement seen in the compensated repetition: the try ends without a value (no_hold), or goes
    // on to the next repetition within its own time; either way the clean value is recorded.
    if (first.outcome === "retry") expect(first.reasons).toEqual(["no_hold"]);
    expect(compensationEvents(run.events, c.id).some((e) => inRep(e.t))).toBe(true);
    expect(res).toMatchObject({ status: "measured", nValid: 1 });
    for (const a of res.attempts) expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
    return;
  }
  // Measured on the compensated attempt itself: nothing repeated, one valid attempt (D-035).
  expect(res.status).toBe("measured");
  expect(res.nValid).toBe(1);
  expect(res.retries).toBe(0);
  expect(scored(run.records).filter((a) => a.outcome !== "valid")).toEqual([]);
  expect(first).toMatchObject({ index: 1, outcome: "valid" });
  expect(inRep(first.t1)).toBe(true);
  // At most one calm line in the whole movement.
  expect(run.events.filter((e) => e.kind === "compensation" && e.level === "cue").length).toBeLessThanOrEqual(
    1,
  );
  if (def.effect === "invalid") {
    const id = c.firesAs ?? c.id;
    expect(first.reasons).toContain(id);
    for (const r of first.reasons) expect([id, c.id, ...(c.alsoFires ?? [])]).toContain(r);
    expect(first.flags).toContain("approximate");
    expect(res.flags).toContain("approximate");
    const hit = compensationEvents(run.events, id);
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(inRep(hit[0].t)).toBe(true);
  } else if (def.effect === "flag") {
    for (const a of res.attempts) expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
    if (c.id === "bent_elbow") {
      expect(first.flags).toContain("bentElbow");
      expect(res.flags).toContain("bentElbow");
      expect(first.reasons).not.toContain("bent_elbow");
    } else expect(first.reasons).toContain(c.id);
    expect(first.flags).not.toContain("approximate");
  } else {
    // log (the side arm raise's shrug): the movement's one calm line, nothing is recorded.
    for (const a of res.attempts) expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
    const cue = compensationEvents(run.events, c.id, "cue");
    expect(cue).toHaveLength(1);
    expect(inRep(cue[0].t)).toBe(true);
    expect(first.reasons).not.toContain(c.id);
    expect(first.flags).not.toContain("approximate");
  }
}

for (const c of COMPENSATION_FIXTURES)
  describe(`${c.movement} ${c.id}`, () => {
    for (const aspect of ["16:9", "9:16"] as const) it(`${aspect}: ${c.reaches}`, () => check(c, aspect));
  });
