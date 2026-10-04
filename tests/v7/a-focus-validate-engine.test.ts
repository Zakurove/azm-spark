/**
 * The range result validator reads its attempt bounds from the runtime data (product v7 contract C-1:
 * structured numbers are read from the data; 2.6: the runner takes its practice and scored attempts
 * from ROM_DATA.engine). A sign off that changes engine.scoredAttemptsMax or engine.practice
 * regenerates rom-v7.json, and the server then takes the results the runner records under the new
 * numbers (Gate A review: the validator held 3 and 1 as its own constants).
 *
 * The ROM data module is replaced here by one whose engine allows 4 scored attempts and 2 practice
 * attempts, as a regenerated file would.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/movements/rom", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/movements/rom")>();
  return {
    ...real,
    ROM_DATA: {
      ...real.ROM_DATA,
      engine: { ...real.ROM_DATA.engine, scoredAttemptsMax: 4, practice: 2 },
    },
  };
});

import { CHECK_DATA } from "../../src/movements/assessments";
import { ROM_DATA } from "../../src/movements/rom";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import {
  MAX_PRACTICE,
  MAX_RETRIES,
  MAX_SCORED_ATTEMPTS,
  checkRomResult,
} from "../../server/modules/focus/validate";
import { romBody } from "./a-focus-bodies";

const ITEM = {
  movementId: "knee_flexion",
  side: "right",
  region: "knee",
  position: "lying_back",
  block: "lying",
  order: 1,
  priority: "core",
  verdict: "measure",
  normId: null,
  graded: true,
  askCanMove: false,
  helperRequired: false,
  approximate: false,
} as RomProtocolItem;

/** A valid result with `n` valid scored attempts and `p` practice attempts. */
function result(n: number, p: number) {
  const body = romBody(ITEM, 130) as Record<string, unknown> & {
    attempts: { index: number; value: number }[];
    practice: unknown[];
  };
  const first = body.attempts[0];
  const attempts = Array.from({ length: n }, (_, i) => ({ ...first, index: i + 1, value: 130 - i }));
  return {
    ...body,
    value: 130,
    median: attempts.length > 1 ? 129 : 130,
    nValid: n,
    attempts,
    practice: Array.from({ length: p }, () => body.practice[0]),
  };
}

describe("the range result bounds follow ROM_DATA.engine", () => {
  it("reads the scored and practice attempt bounds from the data", () => {
    expect(ROM_DATA.engine.scoredAttemptsMax).toBe(4);
    expect(MAX_SCORED_ATTEMPTS).toBe(ROM_DATA.engine.scoredAttemptsMax);
    expect(MAX_PRACTICE).toBe(ROM_DATA.engine.practice);
  });

  it("takes as many scored attempts as the data allows, and no more", () => {
    expect(checkRomResult(result(4, 1), ITEM)).toMatchObject({ ok: true });
    expect(checkRomResult(result(5, 1), ITEM)).toEqual({ ok: false, field: "nValid" });
    // Five attempts, four of them valid: the list itself is too long.
    const five = result(5, 1);
    five.attempts[4] = { ...five.attempts[4], outcome: "invalid", value: null } as never;
    expect(checkRomResult({ ...five, nValid: 4 }, ITEM)).toEqual({ ok: false, field: "attempts" });
  });

  it("takes as many practice attempts as the data allows, and no more", () => {
    expect(checkRomResult(result(3, 2), ITEM)).toMatchObject({ ok: true });
    expect(checkRomResult(result(3, 3), ITEM)).toEqual({ ok: false, field: "practice" });
  });

  it("bounds the quality retries by the retries and the scored attempts", () => {
    const body = result(4, 1);
    const quality = (body as Record<string, unknown>).quality as Record<string, unknown>;
    expect(
      checkRomResult({ ...body, quality: { ...quality, retries: MAX_RETRIES + 4 } }, ITEM),
    ).toMatchObject({ ok: true });
    expect(checkRomResult({ ...body, quality: { ...quality, retries: MAX_RETRIES + 5 } }, ITEM)).toEqual({
      ok: false,
      field: "quality.retries",
    });
  });

  it("keeps the v1.1 retry cap of the range tests (contract 2.6, at most 2)", () => {
    const caps = CHECK_DATA.tests.flatMap((t) => ("maxRetries" in t ? [t.maxRetries] : []));
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) expect(MAX_RETRIES).toBe(cap);
  });
});
