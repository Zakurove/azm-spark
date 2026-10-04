/**
 * Step E1 (product v7 contract 2.10, the pool rules; C-9): the pool stays the safety base in every
 * build. This file pins the v1 pools: for every intake of the corpus (tests/v7/e-corpus.ts), the
 * default pool holds exactly the exercises it held before E1, in the same order. The digest was
 * computed on azm7 0a3f776, before E1 changed pool.ts or library.json.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Intake } from "../../src/medical/plan";
import { libraryPool } from "../../src/medical/pool";
import { corpus } from "./e-corpus";

const CORPUS = corpus();
/** The ids of a pool, in order. */
const idsOf = (pool: readonly { id: string }[]) => pool.map((e) => e.id).join(",");
/** One line per intake, its key and the ids of its pool, hashed together. */
const poolDigest = (pool: (h: Intake) => readonly { id: string }[]) =>
  createHash("sha256")
    .update(CORPUS.map(({ key, h }) => `${key}: ${idsOf(pool(h))}`).join("\n"))
    .digest("hex");

describe("the v1 pools (contract 2.10 rule 3)", () => {
  it("covers every v1 combination and its v7 twin, with pools that differ", () => {
    expect(CORPUS.length).toBe(7200);
    expect(new Set(CORPUS.map((c) => c.key)).size).toBe(CORPUS.length);
    expect(new Set(CORPUS.map(({ h }) => idsOf(libraryPool(h)))).size).toBeGreaterThan(300);
  });

  it("keeps the default pool of every corpus intake as it was before E1", () => {
    expect(poolDigest((h) => libraryPool(h))).toBe(
      "0ce110ee97a20c3bb606bcf1b3635d92576f962ed6716eaa37625f2b944a0e8e",
    );
  });
});
