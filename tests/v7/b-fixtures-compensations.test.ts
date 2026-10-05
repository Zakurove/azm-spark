/**
 * The compensation fixtures (product v7 contract 8.2, stream B, step B2): one for each compensation of
 * the 16 measured movements (rom-protocol movements[].compensations), the person doing it in the first
 * scored attempt, in both phone shapes at the matrix's noise. «Compensation fixtures invalid as
 * specified»: a check whose effect is invalid makes that attempt invalid with its own reason (coached,
 * not stored, repeated once), a flag only check flags the valid attempt, the logged shrug plays its
 * line; the movement is then measured on the clean attempts, within 5 degrees of the truth. Where
 * another check reads the same posture first (firesAs, change log B2-6) the attempt is invalid under
 * that check's name.
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
const compensationEvents = (events: RomEvent[], id: CompensationId, level: "cue" | "invalid") =>
  events.filter((e): e is CompensationEvent => e.kind === "compensation" && e.id === id && e.level === level);

describe("a fixture for every compensation of the data", () => {
  it("covers each movement's compensations, once each", () => {
    const want = ROM_DATA.movements.flatMap((m) => m.compensations.map((c) => `${m.id} ${c.id}`)).sort();
    const have = COMPENSATION_FIXTURES.map((c) => `${c.movement} ${c.id}`).sort();
    expect(have).toEqual(want);
  });
});

function check(c: CompensationFixture, aspect: "16:9" | "9:16") {
  const run = runRom(compensationSpec(c, aspect));
  const def = compensationDef(c.movement, c.id);
  const truth = endAngle(c.movement, c.position, c.percent ?? 100, c.side);
  const rep = run.fx.truth.rom!.reps[1];
  const inRep = (t: number) => t / 1000 >= rep.start && t / 1000 <= rep.end;
  const first = scored(run.records)[0];
  const res = run.result;
  // The movement is measured on clean attempts, within the value tolerance.
  expect(res.status).toBe("measured");
  expect(res.nValid).toBe(3);
  for (const a of res.attempts) expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
  if (def.effect === "invalid") {
    const id = c.firesAs ?? c.id;
    expect(first).toMatchObject({ index: 1, outcome: "invalid", value: null });
    expect(first.reasons).toContain(id);
    for (const r of first.reasons) expect([id, ...(c.alsoFires ?? [])]).toContain(r);
    expect(inRep(first.t1)).toBe(true);
    const hit = compensationEvents(run.events, id, "invalid");
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(inRep(hit[0].t)).toBe(true);
    expect(res.retries).toBe(1);
    expect(scored(run.records).filter((a) => a.outcome === "invalid")).toHaveLength(1);
  } else if (def.effect === "flag") {
    expect(first).toMatchObject({ index: 1, outcome: "valid" });
    if (c.id === "bent_elbow") {
      expect(first.flags).toContain("bentElbow");
      expect(res.flags).toContain("bentElbow");
      expect(first.reasons).not.toContain("bent_elbow");
    } else expect(first.reasons).toContain(c.id);
    expect(res.retries).toBe(0);
  } else {
    // log (the side arm raise's shrug): the line plays, nothing is recorded.
    const cue = compensationEvents(run.events, c.id, "cue");
    expect(cue.length).toBeGreaterThanOrEqual(1);
    expect(inRep(cue[0].t)).toBe(true);
    expect(first).toMatchObject({ index: 1, outcome: "valid" });
    expect(first.reasons).not.toContain(c.id);
    expect(res.retries).toBe(0);
  }
}

for (const c of COMPENSATION_FIXTURES)
  describe(`${c.movement} ${c.id}`, () => {
    for (const aspect of ["16:9", "9:16"] as const) it(`${aspect}: ${c.reaches}`, () => check(c, aspect));
  });
