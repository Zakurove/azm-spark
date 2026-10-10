/**
 * D-038 items 2 and 4: the walk's two parts in a crowd, through the capture itself (controller.ts):
 * part 1 across the picture (4 side passes), then right after it part 2, toward the phone and back
 * twice with the phone left where it stood. The walker comes close enough for the legs to leave the
 * picture's bottom and walks away smaller. Around them:
 *   - D comes a second into part 1's walk (the walker locked at its standing calibration) and stands
 *     still in the picture through part 1 and part 2, nearer the picture's centre than the walker at
 *     part 2's start, at the walker's size there: never taken at part 2's start, nor ever;
 *   - two people walk to and fro behind;
 *   - in part 2 someone crosses in front, over the side of the picture away from the walker: no pause.
 * The model's order changes each frame and the looks are read 4 times a second, as the camera does
 * (and once without looks, a camera that reads none). Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import type { Look } from "../../src/engine/look";
import { subjectOf } from "../../src/engine/subject";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Frame, Landmark } from "../../src/engine/types";
import { CAPTURE_LIMITS, GaitController, type GaitStepId } from "../../src/features/gait/controller";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { walk, withRealFarLeg, type WalkSpec } from "../fixtures/gait/gen-gait";
import { CLOTHES, pacing } from "../fixtures/crowd";
import { person } from "../fixtures/people";

const HOME: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front", "back"], walking_pad: [] },
};

/** Part 1 (as c-gait-front-walk.test.ts): four passes across a landscape picture 3 m away. */
const sidePasses = (seed: number): WalkSpec => ({
  view: "side",
  passes: 4,
  seed,
  speed: 1,
  cadence: 100,
  camera: { distance: 3 },
  sidePath: { pathM: 6, turnSec: 1.5 },
  passShiftM: 0.3,
  noise: 0.003,
  jitterMs: 8,
});

/**
 * Part 2 (the front walk generator of c-gait-front-walk.test.ts): twice toward the phone from 5 m,
 * turning 1.4 m before it (the legs below the picture's bottom), and back; 0.4 m to the side of the
 * lens, so the walker is a little off the picture's centre.
 */
const towardBack = (seed: number): WalkSpec => ({
  view: "front",
  passes: 2,
  seed,
  home: { farM: 5, nearM: 1.4 },
  passShiftM: 0.3,
  camera: { lateral: 0.4, height: 0.95, landscape: true },
  noise: 0.002,
  jitterMs: 8,
});

const WALKER = CLOTHES.navyBlack;
const seenAt = (lm: Landmark[]) => lm.some((q) => q.visibility > 0.5);
const hipX = (lm: Landmark[]) => (lm[23].x + lm[24].x) / 2;
/** A pose's height in the picture (the nose to the lower ankle), in the picture's height. */
const heightOf = (lm: Landmark[]) => Math.max(lm[27].y, lm[28].y) - lm[0].y;

interface Other {
  name: string;
  lm: Landmark[];
  look: Look;
}

interface Scene {
  ctl: GaitController;
  /** The walker's own poses by frame time (the recording must hold these only). */
  own: Map<number, Landmark[]>;
  /** The frames of part 2's walk while E crosses in front, and the hint then. */
  crossing: { t: number; hint: string | null }[];
  /** Every pose the walk's lock marked for the drawing, by who it was. */
  marked: Map<string, number>;
  steps: Set<GaitStepId>;
}

interface Options {
  /** The walker out of the picture this long between part 1 and part 2 (ms), walking to its start. */
  awayMs?: number;
  /**
   * F, in other clothes, comes into the picture this long (ms) into the walker's time away and stands
   * nearer its centre than the walker, the walker's size at part 2's start, through part 2.
   */
  newcomerAt?: number;
  /** The walker's clothes as part 2 sees them (front and back), when not as part 1 (the side). */
  part2Look?: Look;
}

function run(seed: number, looks: boolean, opts: Options = {}): Scene {
  const ctl = new GaitController({
    plan: HOME,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    lang: "en",
    log: () => {},
  });
  let t = 1000;
  ctl.start(t);
  for (let i = 0; i < 40 && ctl.current.id !== "place"; i++)
    if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
    else if (!ctl.confirm(t)) break;
  expect(ctl.current).toEqual({ id: "place", rec: "overground_side" });
  ctl.confirm(t);

  const p1 = walk(sidePasses(seed));
  const p2 = walk(towardBack(seed + 10));
  const aspect = p2.frames[0].aspect;
  const far = heightOf(p2.standing[0].lm);
  const p2x = p2.frames.filter((f) => seenAt(f.lm)).map((f) => hipX(f.lm));
  const walkerLeft = Math.min(...p2x);
  // D: still, nearer the centre than the walker at part 2's start, the walker's size there.
  // (The walker walks part 2 left of the centre: 0.45 of the width far away, 0.33 near the phone.)
  const D: Other = { name: "D", lm: person({ x: 0.515, height: far }, aspect), look: CLOTHES.greyBlue };
  // F: new between the parts, still, nearer the centre too, the walker's size, other clothes.
  const F: Other = { name: "F", lm: person({ x: 0.545, height: far }, aspect), look: CLOTHES.blackAbaya };
  let fFrom = Infinity;
  let part2 = false;
  // Two people behind, smaller (further back).
  const behind = (tt: number): Other[] =>
    [
      { spec: pacing(0, 3200, 0.05, 0.95, { height: 0.75 * far, y: 0.45 })(tt), look: CLOTHES.whiteThobe },
      { spec: pacing(600, 4100, 0.92, 0.08, { height: 0.7 * far, y: 0.44 })(tt), look: CLOTHES.redJeans },
    ].flatMap((b, k) => (b.spec ? [{ name: `B${k}`, lm: person(b.spec, aspect), look: b.look }] : []));

  const own = new Map<number, Landmark[]>();
  const marked = new Map<string, number>();
  const crossing: Scene["crossing"] = [];
  const steps = new Set<GaitStepId>();
  let lookAt = -Infinity;
  /** D comes once part 1's standing calibration has taken the walker (the first lock is the person's). */
  let dFrom = Infinity;
  /** Plays a walk's frames with the crowd; `cross(tt)` adds who crosses in front. */
  const play = (frames: readonly GaitFrame[], cross?: (tt: number) => Other | null) => {
    const t0 = frames[0].t;
    const base = t + 40;
    for (const f of frames) {
      const tt = base + (f.t - t0);
      const look = part2 && opts.part2Look ? opts.part2Look : WALKER;
      const me: Other[] = seenAt(f.lm) ? [{ name: "A", lm: f.lm, look }] : [];
      if (me.length) own.set(tt, f.lm);
      const c = cross?.(tt) ?? null;
      // A second into part 1's walk (the walker is off along the path by then).
      if (dFrom === Infinity && ctl.current.id === "walk") dFrom = tt + 1000;
      const here = [
        ...(tt >= dFrom ? [D] : []),
        ...(tt >= fFrom ? [F] : []),
        ...behind(tt),
        ...me,
        ...(c ? [c] : []),
      ];
      // The model's order changes every frame.
      const k = Math.floor(tt / 33) % here.length;
      const order = [...here.slice(k), ...here.slice(0, k)];
      const sample = looks && tt - lookAt >= 250;
      if (sample) lookAt = tt;
      const frame: Frame = {
        t: tt,
        lm: order[0].lm,
        poses: order.map((o) => o.lm),
        aspect: f.aspect,
        ...(sample ? { looks: order.map((o) => o.look) } : {}),
      };
      ctl.feed(frame, { rollDeg: 0 });
      ctl.tick(tt);
      steps.add(ctl.current.id);
      const s = subjectOf(frame);
      if (s !== undefined && s >= 0) marked.set(order[s].name, (marked.get(order[s].name) ?? 0) + 1);
      if (c && me.length && ctl.current.id === "walk") crossing.push({ t: tt, hint: ctl.hint });
      t = tt;
    }
    for (let i = 0; i < 4 && ctl.current.id === "walk"; i++) {
      t += CAPTURE_LIMITS.afterLastLapMs + 100;
      ctl.tick(t);
    }
  };

  // Part 1, with D and the people behind all along.
  expect(ctl.current.id).toBe("stand");
  play([...p1.standing, ...withRealFarLeg(p1.frames)]);
  expect(ctl.current).toEqual({ id: "place", rec: "overground_front" });
  if (opts.awayMs) {
    // The walker out of the picture on the way to part 2's start (the coach explains part 2 meanwhile).
    if (opts.newcomerAt !== undefined) fFrom = t + opts.newcomerAt;
    const nobody = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    play(Array.from({ length: Math.round(opts.awayMs / 33) }, (_, k) => ({ t: k * 33, lm: nobody, aspect })));
    expect(ctl.current).toEqual({ id: "place", rec: "overground_front" });
  }
  ctl.confirm(t);
  expect(ctl.current).toEqual({ id: "stand", rec: "overground_front" });
  part2 = true;
  // Part 2: E crosses in front once, over the left of the picture, never over the walker.
  const t2 = t + 40 + (p2.frames[0].t - p2.standing[0].t);
  const E = (tt: number): Other | null => {
    const u = tt - t2 - 2500;
    if (u < 0 || u > 3000) return null;
    const reach = walkerLeft - 0.18;
    const x = -0.15 + (reach + 0.15) * (u < 1500 ? u / 1500 : (3000 - u) / 1500);
    return { name: "E", lm: person({ x, height: 1.6 * far }, aspect), look: CLOTHES.greenKhaki };
  };
  play([...p2.standing, ...p2.frames], E);
  return { ctl, own, crossing, marked, steps };
}

describe("the walk's two parts in a crowd (D-038 items 2 and 4)", () => {
  for (const looks of [true, false])
    it(`keeps the walker from part 1 through part 2, never D who stood there, ${looks ? "with" : "without"} looks`, () => {
      const scene = run(3, looks);
      const { ctl, own, marked } = scene;
      expect(ctl.current.id).toBe("saving");
      // Only the walker was ever marked for the drawing, through both parts.
      expect([...marked.keys()]).toEqual(["A"]);
      // Every recording holds the walker's landmarks only.
      for (const rec of ctl.recordedFrames())
        for (const f of [...rec.standing, ...rec.frames]) {
          if (!seenAt(f.lm)) continue;
          const lm = own.get(f.t);
          expect(lm, `${rec.rec} at ${f.t}`).toBeDefined();
          expect(Math.abs(hipX(lm!) - hipX(f.lm))).toBeLessThan(1e-4);
        }
      // Part 2 counted both laps and was read.
      const d = ctl.diagnostics().find((x) => x.rec === "overground_front")!;
      expect(d).toMatchObject({ target: 2, passes: 2, tries: 1 });
      expect(d.level).not.toBe("none");
    });

  for (const looks of [true, false])
    it(`the walker 25 s out of view between the parts while D stands ready: never D (${looks ? "with" : "without"} looks)`, () => {
      // A lock free between the parts would take D (still, of a size, nearer the centre) after 20 s
      // without the walker; held, part 2 starts with the walker, whoever stood there all along.
      const scene = run(7, looks, { awayMs: 25_000 });
      expect(scene.ctl.current.id).toBe("saving");
      expect([...scene.marked.keys()]).toEqual(["A"]);
      const d = scene.ctl.diagnostics().find((x) => x.rec === "overground_front")!;
      expect(d).toMatchObject({ target: 2, passes: 2, tries: 1 });
    });

  it("F new in the picture just before part 2, nearer its centre and of a size: the walker's look first, never F", () => {
    const scene = run(3, true, { awayMs: 3000, newcomerAt: 1000 });
    expect(scene.ctl.current.id).toBe("saving");
    expect([...scene.marked.keys()]).toEqual(["A"]);
    const d = scene.ctl.diagnostics().find((x) => x.rec === "overground_front")!;
    expect(d).toMatchObject({ target: 2, passes: 2, tries: 1 });
  });

  it("open clothes another colour from the front than from the side: part 2 still finds and keeps the walker", () => {
    // Every region of the look changes with the view (an open abaya over a light dress): the walker is
    // taken again after movedWaitMs, and their look starts again from the front.
    const scene = run(11, true, {
      awayMs: 2000,
      part2Look: { torso: [225, 205, 170], legs: [200, 180, 150] },
    });
    expect(scene.ctl.current.id).toBe("saving");
    expect([...scene.marked.keys()]).toEqual(["A"]);
    const d = scene.ctl.diagnostics().find((x) => x.rec === "overground_front")!;
    expect(d).toMatchObject({ target: 2, passes: 2, tries: 1 });
  });

  it("someone crossing in front over the side away from the walker pauses nothing", () => {
    const scene = run(5, true);
    expect(scene.crossing.length).toBeGreaterThan(30);
    expect(scene.crossing.some((c) => c.hint === "unclear")).toBe(false);
    // The walker recorded in every frame of the crossing (the lock trusted them, no pause).
    const rec = scene.ctl.recordedFrames().find((r) => r.rec === "overground_front")!;
    const at = new Map(rec.frames.map((f) => [f.t, f]));
    for (const c of scene.crossing) expect(seenAt(at.get(c.t)!.lm), `at ${c.t}`).toBe(true);
  });
});
