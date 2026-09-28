/**
 * The booth code compare is timing safe (contract v3 I): every code, right or wrong, long or short,
 * and even a missing AZM_BOOTH_CODE, goes through one crypto.timingSafeEqual on two SHA-256 digests
 * of equal length, and POST /api/booth/verify uses that compare.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";
import { boothCodeMatches } from "../server/modules/booth/config";
import { startApi, type Harness } from "./check-api-harness";

const CODE = "482913";
/** 2026-10-11 10:00 in Riyadh, a booth day. */
const BOOTH_DAY = Date.UTC(2026, 9, 11, 7, 0, 0);
const spy = vi.mocked(timingSafeEqual);

beforeEach(() => {
  spy.mockClear();
  process.env.AZM_BOOTH_CODE = CODE;
});
afterEach(() => {
  delete process.env.AZM_BOOTH_CODE;
});

/** Every call compared two buffers of 32 bytes (SHA-256 digests), never the raw strings. */
function comparedDigests(calls: number) {
  expect(spy).toHaveBeenCalledTimes(calls);
  for (const [a, b] of spy.mock.calls) {
    expect(Buffer.isBuffer(a) && Buffer.isBuffer(b)).toBe(true);
    expect((a as Buffer).length).toBe(32);
    expect((b as Buffer).length).toBe(32);
    expect((a as Buffer).toString("utf8")).not.toContain(CODE);
  }
}

describe("boothCodeMatches", () => {
  it("compares the right code in constant time on digests", () => {
    expect(boothCodeMatches(CODE, BOOTH_DAY)).toBe(true);
    comparedDigests(1);
  });

  it("takes the same path for a wrong code of any length, an early or a late difference", () => {
    for (const wrong of ["582913", "482914", "4829", "4829130000", "x".repeat(64)])
      expect(boothCodeMatches(wrong, BOOTH_DAY)).toBe(false);
    comparedDigests(5);
  });

  it("still compares when there is no code today, and never matches an empty code", () => {
    delete process.env.AZM_BOOTH_CODE;
    expect(boothCodeMatches(CODE, BOOTH_DAY)).toBe(false);
    expect(boothCodeMatches("", BOOTH_DAY)).toBe(false);
    expect(boothCodeMatches(undefined, BOOTH_DAY)).toBe(false);
    comparedDigests(3);
  });
});

describe("POST /api/booth/verify", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("runs the constant time compare for every code it is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BOOTH_DAY);
    try {
      expect((await h.call("/booth/verify", { code: "000" })).data).toEqual({ ok: false });
      expect((await h.call("/booth/verify", { code: CODE })).data.ok).toBe(true);
      comparedDigests(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
