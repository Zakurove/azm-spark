/**
 * The motion capture gait fixtures (product v7 contract 6.1 and 8.3, step C2): the committed subset of
 * scripts/fixtures/mocap_to_fixture.py (tests/fixtures/gait/mocap/*.mocap, named per trial in
 * tests/fixtures/gait/README.md) and their projection through the synthetic walker's phone
 * (tests/fixtures/gait/mocap.ts). The engine's acceptance on them is c-acceptance-mocap.test.ts.
 */
import { describe, expect, it } from "vitest";
import { loadMocap, mocapIds, mocapWalk, EDGE_MS } from "../fixtures/gait/mocap";
import { cameraOf, project } from "../fixtures/gait/gen-gait";

const ids = mocapIds();
const of = (prefix: string) => ids.filter((id) => id.startsWith(prefix));

describe("the committed mocap subset", () => {
  it("holds 20 able bodied adults, 10 stroke survivors and 10 adults on the treadmill at 3 speeds", () => {
    expect(of("vc-ab-")).toHaveLength(20);
    expect(of("vc-st-")).toHaveLength(10);
    expect(of("wbds-")).toHaveLength(30);
    const treadmill = new Set(of("wbds-").map((id) => id.slice(0, 7)));
    expect(treadmill.size).toBe(10);
    for (const s of treadmill)
      expect(
        of(s).map((id) => id.slice(-3)),
        s,
      ).toEqual(["t01", "t04", "t07"]);
  });

  it("spans the ages: able bodied walkers born in seven decades, young and older treadmill walkers", () => {
    const decades = new Set(of("vc-ab-").map((id) => loadMocap(id).subject.birthDecade));
    expect(decades.size).toBeGreaterThanOrEqual(7);
    const groups = of("wbds-").map((id) => loadMocap(id).subject.ageGroup);
    expect(groups.filter((g) => g === "young")).toHaveLength(15);
    expect(groups.filter((g) => g === "older")).toHaveLength(15);
  });

  it("walks both directions overground and names every source trial, licence and citation", () => {
    for (const id of [...of("vc-ab-"), ...of("vc-st-")]) {
      const fx = loadMocap(id);
      expect(fx.mode, id).toBe("overground");
      expect(new Set(fx.passes.map((p) => p.dir)), id).toEqual(new Set([1, -1]));
      expect(fx.dataset).toBe("van_criekinge_2023");
      expect(fx.licence).toMatch(/CC0/);
    }
    for (const id of ids) {
      const fx = loadMocap(id);
      expect(fx.sourceFiles.length, id).toBe(fx.passes.length + 1);
      expect(
        fx.sourceFiles.every((f) => f.endsWith(".c3d")),
        id,
      ).toBe(true);
      expect(fx.citation).toMatch(/2023;10:852|2018;6:e4640/);
    }
    for (const id of of("wbds-")) {
      const fx = loadMocap(id);
      expect(fx.mode).toBe("treadmill");
      expect(fx.dataset).toBe("fukuchi_2018");
      expect(fx.licence).toBe("CC BY 4.0");
      // No upper body markers in this dataset: the trunk, arms and face are built (README).
      expect(fx.synthetic).toEqual([0, 2, 5, 11, 12, 13, 14, 15, 16]);
    }
  });

  it("keeps the stroke workbook's paretic label and the dataset's knee peaks beside it, for stroke only", () => {
    for (const id of of("vc-st-")) {
      const s = loadMocap(id).subject;
      expect(["left", "right"]).toContain(s.workbookPside);
      expect(s.kneeSwingPeakDeg!.left).toBeGreaterThan(0);
      expect(s.stifferKneeSide).toBe(s.kneeSwingPeakDeg!.left < s.kneeSwingPeakDeg!.right ? "left" : "right");
    }
    // The workbook's label and the stiffer knee disagree more often than not (README).
    const differ = of("vc-st-").filter((id) => {
      const s = loadMocap(id).subject;
      return s.workbookPside !== s.stifferKneeSide;
    });
    expect(differ.length).toBeGreaterThanOrEqual(5);
    for (const id of [...of("vc-ab-"), ...of("wbds-")])
      expect(loadMocap(id).subject.workbookPside).toBeUndefined();
  });
});

describe("a decoded fixture", () => {
  it("stands a person in the room: hips near hip height, heels near the floor, shoulders above the hips", () => {
    for (const id of ["vc-ab-001", "vc-st-004", "wbds-01-t04"]) {
      const fx = loadMocap(id);
      const at = (lm: number, f = fx.standing.p[0]) => f[fx.landmarks.indexOf(lm)]!;
      const h = (fx.subject.heightCm ?? 170) / 100;
      expect(at(23)[1] / h, id).toBeGreaterThan(0.45);
      expect(at(23)[1] / h, id).toBeLessThan(0.6);
      expect(at(29)[1], id).toBeLessThan(0.15);
      expect(at(11)[1], id).toBeGreaterThan(at(23)[1] + 0.3);
      expect(fx.standing.t[fx.standing.t.length - 1], id).toBeGreaterThanOrEqual(2990);
    }
  });

  it("holds 30 Hz frames and the dataset's events, each side's contacts and toe offs alternating", () => {
    for (const id of ids) {
      const fx = loadMocap(id);
      for (const ps of fx.passes) {
        const gaps = ps.t.slice(1).map((t, i) => t - ps.t[i]);
        expect(Math.min(...gaps), id).toBeGreaterThan(20);
        expect(Math.max(...gaps), id).toBeLessThan(45);
        for (const side of ["left", "right"] as const) {
          const seq = ps.events.filter((e) => e.side === side).sort((a, b) => a.t - b.t);
          for (let i = 1; i < seq.length; i++) expect(seq[i].type, `${id} ${side}`).not.toBe(seq[i - 1].type);
        }
      }
    }
  });
});

describe("a fixture seen by a phone", () => {
  it("walks across the side phone's picture in both directions, near limb by direction", () => {
    const fx = loadMocap("vc-ab-033");
    const w = mocapWalk(fx, { view: "side", seed: 2 });
    expect(w.truth.aspect).toBeCloseTo(16 / 9, 6);
    expect(w.truth.passes.map((p) => p.dir).sort()).toEqual([-1, -1, 1, 1]);
    const hipXs = w.frames.filter((f) => f.lm[23].visibility > 0.5).map((f) => f.lm[23].x);
    expect(Math.min(...hipXs)).toBeLessThan(0.25);
    expect(Math.max(...hipXs)).toBeGreaterThan(0.75);
    // Walking to the picture's right the right leg is nearest: the left hip is seen less well.
    const pass = w.truth.passes.find((p) => p.dir === 1)!;
    const mid = w.frames.find((f) => f.t > (pass.from + pass.to) / 2)!;
    expect(mid.lm[24].visibility).toBeGreaterThan(mid.lm[23].visibility);
  });

  it("is the walker's own pinhole", () => {
    const fx = loadMocap("wbds-01-t04");
    const w = mocapWalk(fx, { view: "pad_side", nearSide: "right", seed: 1, noise: 0 });
    const cam = cameraOf({ view: "pad_side" });
    // The pad side phone: 3 m from the belt's line at 1 m, as the synthetic walker's.
    expect(cam.pos).toEqual([0, 1.0, 3.0]);
    const q = project(cam, [0, 1.0, 0]);
    expect(q.x).toBeCloseTo(0.5, 9);
    expect(q.y).toBeCloseTo(0.5, 9);
    expect(w.frames.length).toBe(fx.passes[0].t.length);
  });

  it("counts as present only the cycles whose contacts sit inside their pass", () => {
    expect(EDGE_MS).toEqual({ start: 500, end: 200 });
    const fx = loadMocap("wbds-02-t04");
    const w = mocapWalk(fx, { view: "pad_side", nearSide: "left" });
    const ics = w.truth.ics.filter((e) => e.side === "left");
    // A 15 s treadmill trial at 111 steps a minute: about 13 strides a side.
    expect(ics.length).toBeGreaterThanOrEqual(13);
    expect(w.truth.cycles.left).toBeLessThanOrEqual(ics.length - 1);
    expect(w.truth.cycles.left).toBeGreaterThanOrEqual(ics.length - 3);
    expect(w.truth.cadence).toBeGreaterThan(105);
    expect(w.truth.cadence).toBeLessThan(116);
  });
});
