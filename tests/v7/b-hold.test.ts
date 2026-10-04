/**
 * The end range hold of the v7 range of motion runner (src/engine/rom/hold.ts, product v7 contract
 * 2.6, rom-protocol 1.1 step 4): the filtered angle within engine.holdBandDeg for engine.holdSeconds
 * after engine.minExcursionDeg toward the end range, the value the Hampel filter then the median of the
 * window's raw angles; a smaller hold (the person moved, but less than the minimum) is reported with
 * smallExcursion for the person to confirm; the wide band after two tries without a hold; the plateau
 * hint for the coach.
 */
import { describe, expect, it } from "vitest";
import {
  HOLD_RULES,
  HoldDetector,
  PLATEAU_RULES,
  PlateauDetector,
  holdOptions,
  type HoldFound,
} from "../../src/engine/rom/hold";
import { ROM_DATA } from "../../src/movements/rom";
import { RANGE_RULES } from "../../src/engine/modes/rangeTest";

const E = ROM_DATA.engine;

/** Feeds an angle curve (degrees over seconds) at `fps`; returns every hold found with its frame time. */
function feed(
  det: HoldDetector,
  curve: (s: number) => number,
  seconds: number,
  fps = 30,
  raw: (s: number, i: number) => number = curve,
  from = 0,
): HoldFound[] {
  const out: HoldFound[] = [];
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) {
    const s = from + i / fps;
    const h = det.push(s * 1000, curve(s), raw(s, i));
    if (h) out.push(h);
  }
  return out;
}

/** 0 for `start` s, a linear rise to `peak` over `rise` s, held `hold` s, then back to 0 over `rise` s. */
const raise =
  (peak: number, start = 1, rise = 2, hold = 2, base = 0) =>
  (s: number) => {
    if (s < start) return base;
    if (s < start + rise) return base + ((peak - base) * (s - start)) / rise;
    if (s < start + rise + hold) return peak;
    if (s < start + 2 * rise + hold) return peak - ((peak - base) * (s - start - rise - hold)) / rise;
    return base;
  };

describe("the hold rule reads the data", () => {
  it("band, seconds, wide band and excursion are the engine's numbers", () => {
    const o = holdOptions("flexion");
    expect(o.bandDeg).toBe(E.holdBandDeg);
    expect(o.holdMs).toBe(E.holdSeconds * 1000);
    expect(o.minExcursionDeg).toBe(E.minExcursionDeg);
    expect(o.direction).toBe(1);
    expect(holdOptions("signed").direction).toBe(1);
    expect(holdOptions("lack").direction).toBe(-1);
    // The RomHold type writes the two bands as literals (3 | 5): a data change must change the type too.
    expect(E.holdBandDeg).toBe(3);
    expect(E.wideHoldBandDeg).toBe(5);
    // A gap between readings longer than v1's sustained window gap breaks the window (RANGE_RULES).
    expect(HOLD_RULES.maxGapMs).toBe(RANGE_RULES.maxGapMs);
  });
});

describe("HoldDetector: band and duration", () => {
  it("finds the hold one hold second into a plateau, with the median of the window", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    const holds = feed(det, raise(120), 8);
    expect(holds).toHaveLength(1);
    const h = holds[0];
    // The plateau starts at 3 s: the window fills 1 s later (the last rise frames are outside the band).
    expect(h.to / 1000).toBeGreaterThanOrEqual(3.9);
    expect(h.to / 1000).toBeLessThanOrEqual(4.1);
    expect(h.to - h.from).toBeGreaterThanOrEqual(E.holdSeconds * 1000);
    expect(h.deg).toBeCloseTo(120, 6);
    expect(h.excursionDeg).toBeCloseTo(120, 0);
    expect(h.smallExcursion).toBe(false);
    expect(h.bandDeg).toBe(3);
  });

  it("a plateau shorter than the hold second is no hold", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    expect(feed(det, raise(120, 1, 2, 0.8), 8)).toHaveLength(0);
  });

  it("a slow drift wider than the band over the second is no hold; within the band it is", () => {
    // 4 degrees per second: the window spans 4 degrees, more than the band.
    expect(feed(new HoldDetector(holdOptions("flexion")), (s) => (s < 1 ? 0 : 20 + 4 * s), 5)).toHaveLength(
      0,
    );
    // 2 degrees per second after 20 degrees of movement: a hold (a slow mover is asked, and can say not yet).
    const holds = feed(new HoldDetector(holdOptions("flexion")), (s) => (s < 1 ? 0 : 20 + 2 * (s - 1)), 3);
    expect(holds).toHaveLength(1);
  });

  it("fires once per hold and again only after rearm, with a full window after it", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    const first = feed(det, raise(90, 1, 2, 6), 6);
    expect(first).toHaveLength(1);
    // Still on the same plateau: no second hold until rearm.
    expect(
      feed(
        det,
        () => 90,
        2,
        30,
        () => 90,
        6.1,
      ),
    ).toHaveLength(0);
    det.rearm(8200);
    const again = feed(
      det,
      () => 90,
      2,
      30,
      () => 90,
      8.2,
    );
    expect(again).toHaveLength(1);
    expect(again[0].from).toBeGreaterThanOrEqual(8200);
    expect(again[0].to - again[0].from).toBeGreaterThanOrEqual(1000);
  });

  it("frames further apart than the gap limit break the window", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    // Moved to 60, then held with a 300 ms hole in the readings at 3.5 s.
    let found = 0;
    for (let i = 0; i <= 6 * 30; i++) {
      const s = i / 30;
      if (s > 3.4 && s < 3.7) continue;
      const v = s < 1 ? 0 : s < 3 ? 30 * (s - 1) : 60;
      if (det.push(s * 1000, v, v)) {
        found++;
        // The window restarted after the hole, so it ends a second after 3.7 s at the earliest.
        expect(s).toBeGreaterThanOrEqual(4.7 - 1e-9);
      }
    }
    expect(found).toBe(1);
  });

  it("the value is the median of the Hampel filtered raw angles of the window, not the filtered angle", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    // The filtered angle sits at 100 (a lagging filter); the raw angles read 101, with one wild frame.
    const holds = feed(det, raise(100), 8, 30, (s, i) => {
      const base = raise(100)(s);
      if (base !== 100) return base;
      return i === 100 ? 170 : 101;
    });
    expect(holds).toHaveLength(1);
    expect(holds[0].deg).toBe(101);
  });
});

describe("HoldDetector: excursion toward the end range", () => {
  it("never fires before the movement starts (a still start pose)", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    expect(feed(det, () => 12, 5)).toHaveLength(0);
    // Jitter within the band at the start pose: still nothing.
    expect(
      feed(
        det,
        (s) => 12 + Math.sin(s * 9),
        5,
        30,
        (s) => 12 + Math.sin(s * 9),
        5,
      ),
    ).toHaveLength(0);
  });

  it("measures from the point furthest from the end range: the lowest angle of a flexion", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    // Starts at 30, dips to 5, then rises to 40: the excursion is 35, not 10.
    const curve = (s: number) => (s < 1 ? 30 : s < 2 ? 30 - 25 * (s - 1) : s < 3 ? 5 + 35 * (s - 2) : 40);
    const holds = feed(det, curve, 6);
    expect(holds).toHaveLength(1);
    expect(holds[0].excursionDeg).toBeCloseTo(35, 0);
  });

  it("a lack movement goes toward straight: its end range is the lowest lack", () => {
    const det = new HoldDetector(holdOptions("lack"));
    // Elbow straightening: from a lack of 90 to a lack of 8, held.
    const holds = feed(det, raise(8, 1, 2, 3, 90), 7);
    expect(holds).toHaveLength(1);
    expect(holds[0].deg).toBeCloseTo(8, 6);
    expect(holds[0].excursionDeg).toBeCloseTo(82, 0);
    // A lack that grows (bending further) is away from the end range: no hold at the bent end.
    const away = new HoldDetector(holdOptions("lack"));
    expect(feed(away, raise(120, 1, 2, 3, 90), 4.5)).toHaveLength(0);
  });

  it("a signed movement (hip extension) goes up from below zero", () => {
    const det = new HoldDetector(holdOptions("signed"));
    const holds = feed(det, raise(12, 1, 2, 3, -8), 7);
    expect(holds).toHaveLength(1);
    expect(holds[0].deg).toBeCloseTo(12, 6);
    expect(holds[0].excursionDeg).toBeCloseTo(20, 0);
  });

  it("a hold after less than the minimum excursion, but beyond the band, is a small excursion hold", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    // Moves 7 degrees (more than the 3 degree band, less than 10) and holds.
    const holds = feed(det, raise(7), 6);
    expect(holds).toHaveLength(1);
    expect(holds[0].smallExcursion).toBe(true);
    expect(holds[0].excursionDeg).toBeGreaterThan(E.holdBandDeg);
    expect(holds[0].excursionDeg).toBeLessThan(E.minExcursionDeg);
    // At the minimum it is a full hold.
    const full = feed(new HoldDetector(holdOptions("flexion")), raise(E.minExcursionDeg + 1), 6);
    expect(full[0].smallExcursion).toBe(false);
  });
});

describe("HoldDetector: a small hold needs the angle beyond the start pose", () => {
  it("a dip under the start pose at rest does not make the start level a small hold", () => {
    // The start pose reads 6; the resting angle dips to 2 for a moment (jitter), then sits at 6 again.
    const rest = (s: number) => (s > 1 && s < 1.3 ? 2 : 6);
    expect(feed(new HoldDetector(holdOptions("flexion")), rest, 4)).toHaveLength(1);
    expect(feed(new HoldDetector({ ...holdOptions("flexion"), startDeg: 6 }), rest, 4)).toHaveLength(0);
  });

  it("a small movement beyond the start pose is a small hold; a full one needs no start check", () => {
    const small = feed(
      new HoldDetector({ ...holdOptions("flexion"), startDeg: 6 }),
      raise(13, 1, 1, 3, 6),
      6,
    );
    expect(small).toHaveLength(1);
    expect(small[0].smallExcursion).toBe(true);
    // A lack movement: beyond the start is a smaller lack.
    const lack = feed(new HoldDetector({ ...holdOptions("lack"), startDeg: 40 }), raise(33, 1, 1, 3, 40), 6);
    expect(lack).toHaveLength(1);
    expect(lack[0].smallExcursion).toBe(true);
    // Full holds keep the clinical rule alone.
    expect(feed(new HoldDetector({ ...holdOptions("flexion"), startDeg: 90 }), raise(60), 8)).toHaveLength(1);
  });
});

describe("HoldDetector: the wide band", () => {
  /** A tremor of 4 degrees peak to peak on a plateau: never inside 3 degrees, always inside 5. */
  const tremor = (s: number) => (s < 1 ? 0 : s < 3 ? 30 * (s - 1) : 60 + 2 * Math.sin(2 * Math.PI * 4 * s));

  it("a tremor never settles in the 3 degree band", () => {
    expect(feed(new HoldDetector(holdOptions("flexion")), tremor, 8)).toHaveLength(0);
  });

  it("the 5 degree band finds it, and says so", () => {
    const det = new HoldDetector(holdOptions("flexion"));
    det.setBand(E.wideHoldBandDeg);
    const holds = feed(det, tremor, 8);
    expect(holds).toHaveLength(1);
    expect(holds[0].bandDeg).toBe(5);
    expect(Math.abs(holds[0].deg - 60)).toBeLessThan(1.5);
  });
});

describe("PlateauDetector: the coach may get ready", () => {
  it("the contract's numbers: under 8 degrees per second for 0.4 s inside the hold band", () => {
    expect(PLATEAU_RULES.maxDegPerSec).toBe(8);
    expect(PLATEAU_RULES.seconds).toBe(0.4);
  });

  it("fires on the plateau before the hold, once, after the movement started", () => {
    const opts = holdOptions("flexion");
    const plateau = new PlateauDetector(opts);
    const hold = new HoldDetector(opts);
    let plateauAt: number | null = null;
    let holdAt: number | null = null;
    let plateaus = 0;
    for (let i = 0; i <= 8 * 30; i++) {
      const s = i / 30;
      const v = raise(120)(s);
      if (plateau.push(s * 1000, v)) {
        plateaus++;
        plateauAt ??= s;
      }
      if (hold.push(s * 1000, v, v)) holdAt ??= s;
    }
    expect(plateaus).toBe(1);
    expect(plateauAt).not.toBeNull();
    expect(holdAt).not.toBeNull();
    expect(plateauAt!).toBeLessThan(holdAt!);
    expect(plateauAt!).toBeGreaterThanOrEqual(3.3);
    // Never at the start pose.
    const still = new PlateauDetector(opts);
    for (let i = 0; i < 90; i++) expect(still.push((i / 30) * 1000, 4)).toBeNull();
  });
});
