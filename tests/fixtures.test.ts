/**
 * Landmark fixture infrastructure (contract v2 section F): the file format, the files kept on disk
 * and the generator's physics. Run with AZM_WRITE_FIXTURES=1 to write the catalog files again.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./fixtures/catalog";
import {
  FIXTURE_ROOT,
  fixtureFrames,
  listCheckFixtures,
  listFixtures,
  loadFixture,
  parseFixture,
  roundTrip,
  serializeFixture,
  stringifyFixture,
  type Fixture,
} from "./fixtures/format";
import {
  ADULT,
  aspectOf,
  expectedViewOf,
  framesIn,
  generate,
  PROFILES,
  type GenSpec,
  type GenTruth,
  type MotionSpec,
} from "./fixtures/gen";
import { toPixelSpace } from "../src/engine/geometry";
import { LM, type Landmark } from "../src/engine/types";
import { TEST_IDS } from "../src/movements/assessments";

const WRITE = process.env.AZM_WRITE_FIXTURES === "1";
const DEG = 180 / Math.PI;

/** Angle at the shoulder between the upper arm and the downward trunk line (mid shoulder to mid hip). */
function armTrunkAngle(p: Landmark[], side: "left" | "right"): number {
  const s = side === "left" ? p[LM.l_shoulder] : p[LM.r_shoulder];
  const e = side === "left" ? p[LM.l_elbow] : p[LM.r_elbow];
  const ms = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const mh = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const a = Math.atan2(e.y - s.y, e.x - s.x);
  const b = Math.atan2(mh.y - ms.y, mh.x - ms.x);
  let d = Math.abs(a - b) * DEG;
  if (d > 180) d = 360 - d;
  return d;
}

function expectSameFrames(a: Fixture<unknown>, b: Fixture<unknown>) {
  expect(a.frames.length).toBe(b.frames.length);
  a.frames.forEach((f, i) => {
    const g = b.frames[i];
    expect(f.t).toBe(g.t);
    expect(f.poses.length).toBe(g.poses.length);
    f.poses.forEach((p, j) =>
      p.forEach((q, k) => {
        const r = g.poses[j][k];
        // One rounding step of tolerance, so a last digit flip on another machine is not a failure.
        const ok =
          Math.abs(q.x - r.x) <= 2e-4 &&
          Math.abs(q.y - r.y) <= 2e-4 &&
          Math.abs(q.z - r.z) <= 2e-3 &&
          Math.abs(q.visibility - r.visibility) <= 0.011;
        if (!ok) throw new Error(`frame ${i} pose ${j} landmark ${k} differs`);
      }),
    );
  });
}

describe("fixture files on disk", () => {
  for (const entry of CATALOG) {
    it(`${entry.file} matches its generator spec`, () => {
      const fx = generate(entry.spec);
      const path = join(FIXTURE_ROOT, entry.file);
      if (WRITE) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, stringifyFixture(fx));
      }
      const disk = loadFixture(path);
      const expected = roundTrip(fx);
      expect(disk.meta).toEqual(expected.meta);
      expect(disk.truth).toEqual(expected.truth);
      expectSameFrames(disk, expected);
    });
  }

  it("lists only the movement check folders, so the v7 fixtures may be JSON too (CG-23, D-027 item 5)", () => {
    const root = mkdtempSync(join(tmpdir(), "azm-fixtures-"));
    for (const dir of ["chair_stand_30s/adult", "gait/mocap", "rom/shoulder_flexion/adult"])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "chair_stand_30s/adult/a.json"), "{}");
    writeFileSync(join(root, "gait/mocap/walker.json"), "{}");
    writeFileSync(join(root, "rom/shoulder_flexion/adult/b.json"), "{}");
    expect(listCheckFixtures(root).map((f) => relative(root, f).split(sep).join("/"))).toEqual([
      "chair_stand_30s/adult/a.json",
    ]);
    // On disk: every movement check fixture, and nothing of the v7 folders.
    const inCheckFolder = (f: string) =>
      TEST_IDS.some((t) => relative(FIXTURE_ROOT, f).startsWith(`${t}${sep}`));
    expect([...listCheckFixtures()].sort()).toEqual(listFixtures().filter(inCheckFolder).sort());
  });

  it("every file is a valid fixture at tests/fixtures/<test>/<profile>/<case>.json", () => {
    const files = listCheckFixtures();
    expect(files.length).toBeGreaterThanOrEqual(CATALOG.length);
    const catalogued = new Set(CATALOG.map((c) => c.file));
    for (const path of files) {
      const rel = relative(FIXTURE_ROOT, path).split(sep).join("/");
      const fx = loadFixture(path);
      const [test, profile] = rel.split("/");
      expect(rel.split("/")).toHaveLength(3);
      expect(fx.meta.test).toBe(test);
      expect(fx.meta.profile).toBe(profile);
      expect(TEST_IDS).toContain(fx.meta.test);
      expect(PROFILES).toContain(fx.meta.profile);
      if (fx.meta.source === "generated") expect(catalogued.has(rel)).toBe(true);
    }
  });

  it("the catalog covers every profile, both phone shapes and the special cases", () => {
    expect(new Set(CATALOG.map((c) => c.spec.profile))).toEqual(new Set(PROFILES));
    expect(new Set(CATALOG.map((c) => c.spec.aspect))).toEqual(new Set(["9:16", "16:9"]));
    expect(new Set(CATALOG.map((c) => c.spec.test))).toEqual(new Set(TEST_IDS));
    const has = (pred: (s: GenSpec) => boolean) => CATALOG.some((c) => pred(c.spec));
    expect(has((s) => !!s.helper && !s.helper.walk && !s.helper.touch)).toBe(true);
    expect(has((s) => !!s.helper?.walk)).toBe(true);
    expect(has((s) => !!s.helper?.touch)).toBe(true);
    expect(has((s) => !!s.occlusions?.length)).toBe(true);
    expect(has((s) => !!s.shake)).toBe(true);
    expect(has((s) => !!s.subject?.motions?.some((m) => m.kind === "fall"))).toBe(true);
  });
});

describe("fixture format", () => {
  const small = generate({
    test: "shoulder_abduction",
    profile: "chair",
    aspect: "9:16",
    fps: 10,
    durationSec: 0.5,
    seed: 1,
  });

  it("round trips through the file text with rounding only", () => {
    const back = parseFixture(JSON.parse(stringifyFixture(small)));
    expectSameFrames(back, small);
    expect(back.meta).toEqual(small.meta);
    expect(stringifyFixture(small).split("\n")).toHaveLength(5 + small.frames.length + 2);
  });

  it("stores landmarks as short tuples and never writes -0", () => {
    const file = serializeFixture(small);
    expect(file.frames[0].poses[0][0]).toHaveLength(4);
    expect(stringifyFixture(small)).not.toMatch(/[[,]-0[,\]]/);
  });

  it("gives engine frames: poses, lm the first pose, the aspect of the recording", () => {
    const frames = fixtureFrames(small);
    expect(frames[0].poses).toHaveLength(1);
    expect(frames[0].lm).toBe(frames[0].poses![0]);
    expect(frames[0].aspect).toBeCloseTo(720 / 1280, 6);
  });

  it("rejects malformed fixtures", () => {
    const good = () => JSON.parse(stringifyFixture(small));
    const bad = (mutate: (o: any) => void) => {
      const o = good();
      mutate(o);
      return () => parseFixture(o);
    };
    expect(() => parseFixture(good())).not.toThrow();
    expect(bad((o) => delete o.meta)).toThrow(/meta/);
    expect(bad((o) => (o.meta.aspect = 0))).toThrow(/aspect/);
    expect(bad((o) => (o.meta.source = "made up"))).toThrow(/source/);
    expect(bad((o) => (o.frames = []))).toThrow(/frames/);
    expect(bad((o) => (o.frames[1].t = -5))).toThrow(/never goes back/);
    expect(bad((o) => o.frames[0].poses[0].pop())).toThrow(/33 landmarks/);
    expect(bad((o) => (o.frames[0].poses[0][3] = [0.1, 0.2, 0]))).toThrow(/\[x, y, z, visibility\]/);
    expect(bad((o) => (o.frames[0].poses[0][3][3] = 1.5))).toThrow(/visibility 0 to 1/);
    expect(bad((o) => delete o.truth)).toThrow(/truth/);
  });
});

describe("fixture generator", () => {
  const base: GenSpec = {
    test: "shoulder_abduction",
    profile: "chair",
    aspect: "9:16",
    fps: 15,
    durationSec: 3,
    seed: 7,
  };

  it("is deterministic for a spec and varies with the seed", () => {
    expect(generate(base)).toEqual(generate(base));
    const x = (seed: number) => generate({ ...base, seed }).frames[0].poses[0][LM.nose].x;
    expect(x(8)).not.toBe(x(7));
  });

  for (const aspect of ["9:16", "16:9"] as const) {
    it(`at ${aspect} a known arm angle reads true within 1 degree only in pixel space (D-003)`, () => {
      const fx = generate({
        ...base,
        aspect,
        noise: 0,
        subject: { motions: [{ kind: "arm_raise", side: "right", peak: 60, start: 0, rise: 0.5, hold: 5 }] },
      });
      const f = fixtureFrames(fx)[20];
      expect(Math.abs(armTrunkAngle(toPixelSpace(f.lm, f.aspect), "right") - 60)).toBeLessThan(1);
      // The same landmarks without the aspect correction read far off (about 72 or 44 degrees).
      expect(Math.abs(armTrunkAngle(f.lm, "right") - 60)).toBeGreaterThan(10);
    });
  }

  it("at 1:1 a known arm angle reads true within 1 degree (the square picture needs no correction)", () => {
    const fx = generate({
      ...base,
      aspect: "1:1",
      noise: 0,
      subject: { motions: [{ kind: "arm_raise", side: "left", peak: 110, start: 0, rise: 0.5, hold: 5 }] },
    });
    const f = fixtureFrames(fx)[20];
    expect(f.aspect).toBe(1);
    expect(Math.abs(armTrunkAngle(toPixelSpace(f.lm, f.aspect), "left") - 110)).toBeLessThan(1);
  });

  it("shows a wheelchair user's hips in a front view when asked", () => {
    const visible = fixtureFrames(generate({ ...base, profile: "wheelchair", wheelchairHips: "visible" }));
    expect(visible.every((f) => f.lm[LM.l_hip].visibility > 0.9 && f.lm[LM.r_hip].visibility > 0.9)).toBe(
      true,
    );
    const hidden = fixtureFrames(generate({ ...base, profile: "wheelchair", wheelchairHips: "hidden" }));
    expect(hidden.every((f) => f.lm[LM.l_hip].visibility < 0.5)).toBe(true);
  });

  it("rests the arms in a given pose (hands on the thighs)", () => {
    const f = fixtureFrames(
      generate({ ...base, noise: 0, subject: { arms: { right: { elev: 20, plane: 60, elbow: 70 } } } }),
    )[0];
    const p = toPixelSpace(f.lm, f.aspect);
    // The right wrist comes forward and up to the thigh, above the hanging left wrist.
    expect(p[LM.r_wrist].y).toBeLessThan(p[LM.l_wrist].y);
    expect(f.lm[LM.r_wrist].z).toBeLessThan(f.lm[LM.l_wrist].z);
  });

  it("scripts an assisted lift, a turn, a forward bend and a pelvis slide", () => {
    const at = (motions: MotionSpec[], t: number) => {
      const fx = generate({ ...base, noise: 0, durationSec: 4, subject: { motions } });
      const f = fixtureFrames(fx).find((x) => x.t >= t * 1000)!;
      return toPixelSpace(f.lm, f.aspect);
    };
    const still = at([], 2);
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const assisted = at([{ kind: "assist", hand: "left", from: 1, to: 3 }], 2);
    expect(dist(assisted[LM.l_wrist], assisted[LM.r_elbow])).toBeLessThan(0.005);
    const width = (p: typeof still) => dist(p[LM.l_shoulder], p[LM.r_shoulder]);
    const turned = at([{ kind: "turn", deg: 40, start: 0.5, rise: 0.5, hold: 3 }], 2);
    expect(width(turned) / width(still)).toBeCloseTo(Math.cos((40 * Math.PI) / 180), 1);
    const trunk = (p: typeof still) =>
      dist(
        { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 },
        { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 },
      );
    const bent = at([{ kind: "bend", deg: 30, start: 0.5, rise: 0.5, hold: 3 }], 2);
    expect(trunk(bent) / trunk(still)).toBeLessThan(0.9);
    const slid = at([{ kind: "slide", dx: 0.1, start: 0.5, rise: 0.5, hold: 3 }], 2);
    expect(slid[LM.l_hip].x - still[LM.l_hip].x).toBeGreaterThan(0.02);
  });

  it("projects body lengths through the phone camera: nearer is bigger, the same in both shapes", () => {
    const trunkPx = (spec: GenSpec) => {
      const f = fixtureFrames(generate({ ...spec, noise: 0 }))[0];
      const p = toPixelSpace(f.lm, f.aspect);
      const px = Math.hypot(
        (p[11].x + p[12].x - p[23].x - p[24].x) / 2,
        (p[11].y + p[12].y - p[23].y - p[24].y) / 2,
      );
      return px * (spec.aspect === "9:16" ? 1280 : 720);
    };
    const f = 720 / 2 / Math.tan((25 * Math.PI) / 180);
    const at = (d: number, aspect: "9:16" | "16:9") => trunkPx({ ...base, aspect, camera: { distance: d } });
    expect(at(2.5, "9:16")).toBeCloseTo((ADULT.trunk * f) / 2.5, -1);
    expect(at(2.5, "16:9")).toBeCloseTo(at(2.5, "9:16"), 0);
    expect(at(2, "9:16") / at(3, "9:16")).toBeCloseTo(1.5, 1);
  });

  it("keeps the weaker arm to 60 percent of the asked range", () => {
    const raise = { motions: [{ kind: "arm_raise" as const, side: "left" as const, peak: 150 }] };
    const weak = generate({ ...base, profile: "weaker_left", durationSec: 5, subject: raise }).truth;
    const strong = generate({ ...base, profile: "chair", durationSec: 5, subject: raise }).truth;
    expect(strong.armPeakDeg.left).toBeCloseTo(150, 0);
    expect(weak.armPeakDeg.left).toBeCloseTo(3 + 0.6 * (150 - 3), 0);
    expect(weak.weakerSide).toBe("left");
  });

  it("hides the hips of a wheelchair user and the far side of a turned body", () => {
    const wc = fixtureFrames(generate({ ...base, profile: "wheelchair" }));
    expect(wc.every((f) => f.lm[LM.l_hip].visibility < 0.5 && f.lm[LM.r_hip].visibility < 0.5)).toBe(true);
    expect(wc.every((f) => f.lm[LM.l_shoulder].visibility > 0.9)).toBe(true);
    const side = fixtureFrames(
      generate({
        ...base,
        test: "arm_curl_30s",
        subject: { motions: [{ kind: "curl", side: "right", reps: 1 }] },
      }),
    );
    expect(side[0].lm[LM.r_elbow].visibility).toBeGreaterThan(0.9);
    expect(side[0].lm[LM.l_elbow].visibility).toBeLessThan(0.7);
  });

  it("places the arm curl side on, the chair stand at 45 degrees from the stronger side", () => {
    const curl = (side: "left" | "right") =>
      generate({ ...base, test: "arm_curl_30s", subject: { motions: [{ kind: "curl", side, reps: 1 }] } })
        .truth;
    expect(curl("right").yawDeg).toBe(-90);
    expect(curl("left").yawDeg).toBe(90);
    expect(curl("left").expectedView).toBe("side");
    const stand = (profile: GenSpec["profile"]) =>
      generate({ ...base, test: "chair_stand_30s", profile }).truth;
    expect(stand("standing").yawDeg).toBe(-45);
    expect(stand("weaker_right").yawDeg).toBe(45);
    expect(stand("standing").expectedView).toBe("oblique");
  });

  it("names the view a nominal adult shows at each turn, with unsure bands", () => {
    expect(expectedViewOf(0)).toBe("front");
    expect(expectedViewOf(20)).toBe("front");
    expect(expectedViewOf(30)).toBeNull();
    expect(expectedViewOf(-45)).toBe("oblique");
    expect(expectedViewOf(60)).toBeNull();
    expect(expectedViewOf(70)).toBe("side");
    expect(expectedViewOf(-90)).toBe("side");
    expect(expectedViewOf(180)).toBe("front");
  });

  it("adds a helper as a second pose, in a shuffled order when asked", () => {
    const fx = generate({ ...base, helper: { x: 0.8, z: -0.3 }, shuffle: true });
    const t: GenTruth = fx.truth;
    expect(fx.frames.every((f) => f.poses.length === 2)).toBe(true);
    expect(t.subjectIndex.every((i, k) => i >= 0 && t.helperIndex[k] === 1 - i)).toBe(true);
    expect(t.subjectIndex.some((i) => i === 1)).toBe(true);
    expect(t.subjectIndex.some((i) => i === 0)).toBe(true);
  });

  it("drops the subject hidden behind a helper crossing in front, and records the crossing", () => {
    const fx = generate({
      ...base,
      durationSec: 4,
      helper: { x: -1.3, z: 0.6, walk: { toX: 1.3, start: 0.5, speed: 1 } },
    });
    const crossing = framesIn(fx, "crossing");
    expect(crossing.size).toBeGreaterThan(5);
    expect(fx.truth.subjectIndex.some((i) => i === -1)).toBe(true);
    fx.truth.subjectIndex.forEach((i, k) => {
      if (i === -1) expect(crossing.has(k)).toBe(true);
    });
  });

  it("moves every landmark of the picture together when the phone moves", () => {
    const still = generate({ ...base, noise: 0 });
    const shaken = generate({
      ...base,
      noise: 0,
      shake: { amp: 0.01, hz: 2 },
      jolts: [{ at: 2, dx: 0.05, dy: 0 }],
    });
    const shifts = shaken.frames.map((f, i) => {
      const dx = f.poses[0].map((q, k) => q.x - still.frames[i].poses[0][k].x);
      const dy = f.poses[0].map((q, k) => q.y - still.frames[i].poses[0][k].y);
      expect(Math.max(...dx) - Math.min(...dx)).toBeLessThan(1e-9);
      expect(Math.max(...dy) - Math.min(...dy)).toBeLessThan(1e-9);
      return { dx: dx[0], dy: dy[0] };
    });
    expect(Math.max(...shifts.map((s) => Math.abs(s.dy)))).toBeGreaterThan(0.005);
    const after = shifts[shaken.frames.findIndex((f) => f.t >= 2000)];
    expect(Math.abs(after.dx * aspectOf("9:16") - 0.05)).toBeLessThan(0.03);
    expect(framesIn(shaken, "jolt").size).toBe(1);
  });

  it("dims every visibility in low light and hides scripted occlusions", () => {
    const dim = generate({ ...base, light: 0.6 });
    const bright = generate(base);
    expect(dim.frames[0].poses[0][LM.nose].visibility).toBeCloseTo(
      0.6 * bright.frames[0].poses[0][LM.nose].visibility,
      6,
    );
    const occ = fixtureFrames(
      generate({ ...base, occlusions: [{ landmarks: [LM.l_elbow], from: 1, to: 2 }] }),
    );
    for (const f of occ) {
      const inside = f.t >= 1000 && f.t <= 2000;
      expect(f.lm[LM.l_elbow].visibility < 0.5).toBe(inside);
    }
  });

  it("records the scripted events as ground truth", () => {
    const fx = generate({
      ...base,
      durationSec: 6,
      subject: {
        motions: [
          { kind: "fall", at: 1, dur: 0.5 },
          { kind: "sway", at: 2, dur: 1 },
          { kind: "raise_hand", side: "left", from: 3, to: 4.5 },
          { kind: "leave", at: 5 },
        ],
      },
      helper: { x: 0.45, z: -0.2, hover: { from: 0.2, to: 0.8 } },
    });
    expect(fx.truth.events.map((e) => e.kind)).toEqual(["hover", "fall", "sway", "raise_hand", "leave"]);
    expect(fx.truth.events.find((e) => e.kind === "fall")).toEqual({ kind: "fall", from: 1, to: 1.5 });
  });
});

describe("camera timing (GenSpec.timing)", () => {
  const base: GenSpec = {
    test: "shoulder_abduction",
    profile: "chair",
    aspect: "9:16",
    fps: 20,
    durationSec: 10,
    seed: 90,
    subject: { motions: [{ kind: "arm_raise", side: "right", peak: 150, start: 1 }] },
  };
  const gaps = (fx: ReturnType<typeof generate>) => fx.frames.slice(1).map((f, i) => f.t - fx.frames[i].t);

  it("keeps frames every 1000 ÷ fps ms by default", () => {
    expect(new Set(gaps(generate(base)))).toEqual(new Set([50]));
  });

  it("jitters frame times within the bound, in order, and draws the body at each frame's own time", () => {
    const fx = generate({ ...base, timing: { jitterMs: 12 } });
    const plain = generate(base);
    expect(fx.frames).toHaveLength(plain.frames.length);
    fx.frames.forEach((f, i) => expect(Math.abs(f.t - i * 50)).toBeLessThanOrEqual(12));
    expect(gaps(fx).every((g) => g >= 1)).toBe(true);
    expect(new Set(gaps(fx)).size).toBeGreaterThan(5);
    // The raise is drawn at the jittered time: a frame that came later shows the arm higher.
    const k = fx.frames.findIndex((f, i) => i > 30 && f.t > i * 50 + 5 && i * 50 < 2000);
    expect(fx.frames[k].poses[0][LM.r_wrist].y).toBeLessThan(plain.frames[k].poses[0][LM.r_wrist].y);
  });

  it("drops a share of frames and leaves the kept ones as they were", () => {
    const fx = generate({ ...base, noise: 0, timing: { dropShare: 0.2 } });
    const plain = generate({ ...base, noise: 0 });
    const share = 1 - fx.frames.length / plain.frames.length;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
    for (const f of fx.frames) {
      const same = plain.frames.find((p) => p.t === f.t)!;
      expect(f.poses[0][LM.nose].x).toBeCloseTo(same.poses[0][LM.nose].x, 12);
    }
  });

  it("leaves a gap of the given length at a steady rhythm, and removes every frame in a stall", () => {
    const g = generate({ ...base, timing: { gaps: { everySec: 3, ms: 200 } } });
    expect(gaps(g).filter((x) => x === 200)).toHaveLength(3);
    expect(gaps(g).filter((x) => x !== 50 && x !== 200)).toEqual([]);
    const s = generate({ ...base, timing: { stalls: [{ from: 4, to: 6 }] } });
    expect(s.frames.some((f) => f.t >= 4000 && f.t < 6000)).toBe(false);
    expect(Math.max(...gaps(s))).toBe(2050);
    expect(s.truth.subjectIndex).toHaveLength(s.frames.length);
  });
});
