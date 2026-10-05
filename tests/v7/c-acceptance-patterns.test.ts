/**
 * Acceptance of the gait rules on the engine's own analysis (product v7 contract 8.3, step C2): every
 * rule of gait-rules 5.1 to 5.11 fires on its pattern walk (tests/fixtures/gait/catalog.ts), possible
 * at the mild severity and likely at the strong one where the rule can say likely, and nothing else
 * fires but the companions the rules as written give that walk; and every typical synthetic walk stays
 * quiet, overground and on the walking pad, at every speed from 0.4 to 1.6 m/s (stiff knee and
 * steppage included at 0.4 to 0.6 m/s).
 */
import { describe, expect, it } from "vitest";
import { gaitPattern } from "../../src/movements/gait";
import { GAIT_PATTERN_FIXTURES, SPEED_CADENCE } from "../fixtures/gait/catalog";
import { firedOf, rulesOn, synthAnalysis } from "./c-acceptance-helpers";

describe("every gait rule on its pattern walk", () => {
  it("covers the 11 patterns, each at a mild and a strong severity", () => {
    const ids = new Set(GAIT_PATTERN_FIXTURES.map((f) => f.pattern));
    expect(ids.size).toBe(11);
    for (const id of ids)
      expect(
        GAIT_PATTERN_FIXTURES.filter((f) => f.pattern === id)
          .map((f) => f.severity)
          .sort(),
      ).toEqual(["mild", "strong"]);
  });

  it("expects likely at the strong severity unless the rule data stop the pattern at possible", () => {
    for (const f of GAIT_PATTERN_FIXTURES) {
      const def = gaitPattern(f.pattern);
      const canBeLikely = def.statusMax !== "possible" && def.thresholds.likely !== null;
      if (f.severity === "mild") expect(f.expect, f.pattern).toBe("possible");
      else if (canBeLikely && f.expect !== "likely") expect(f.why, f.pattern).toBeDefined();
    }
  });

  for (const f of GAIT_PATTERN_FIXTURES)
    it(`${f.pattern}, ${f.severity}, ${f.side} (${f.mode}): ${f.expect}`, () => {
      const out = rulesOn(synthAnalysis(f.mode, f.walk));
      const target = out.patterns.find((p) => p.pattern === f.pattern && p.side === f.side);
      expect(target?.status, JSON.stringify(firedOf(out.patterns))).toBe(f.expect);
      const allowed = new Set([
        `${f.pattern}:${f.side}:${f.expect}`,
        ...(f.companions ?? []).map((c) => c.result),
      ]);
      expect(firedOf(out.patterns).filter((r) => !allowed.has(r))).toEqual([]);
    });
});

describe("the rules on typical synthetic walks", () => {
  for (const mode of ["overground", "walking_pad"] as const)
    for (const [speed, cadence] of SPEED_CADENCE)
      it(`stay quiet ${mode === "overground" ? "overground" : "on the walking pad"} at ${speed} m/s`, () => {
        const out = rulesOn(synthAnalysis(mode, { speed, cadence, noise: 0.002, jitterMs: 4 }));
        expect(firedOf(out.patterns)).toEqual([]);
        if (speed <= 0.6)
          for (const id of ["stiff_knee", "steppage"] as const)
            expect(out.patterns.filter((p) => p.pattern === id).map((p) => p.status)).toEqual(["not_seen"]);
      });
});
