/**
 * D-038 item 2 on the walk (features/gait/controller.ts, the crowd-proof lock held through the walk):
 * the synthetic phone side walk through the capture itself (the standing calibration, 4 passes counted,
 * the end), the walker leaving the picture at each pass's end, with a crowd of 4 around them: two people
 * walking to and fro behind the path, one standing still beside it at the walker's size, where the
 * walker leaves the picture, and one crossing in front of the walker in the middle of a pass. The
 * model's order changes each frame and the looks are read 4 times a second, as the camera does. The
 * walk ends as it does alone (4 passes, a reading, the cadence), and the recording holds the walker's
 * landmarks only: nobody else is ever recorded, counted or drawn. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import type { Look } from "../../src/engine/look";
import { subjectOf } from "../../src/engine/subject";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { CAPTURE_LIMITS, GaitController } from "../../src/features/gait/controller";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { walk, withRealFarLeg, type WalkSpec } from "../fixtures/gait/gen-gait";
import { CLOTHES, pacing } from "../fixtures/crowd";
import { person } from "../fixtures/people";

const ASPECT = 720 / 1280;

/** An upright phone 3.5 m from the path (as c-phone-side-walk.test.ts). */
const phoneSide = (seed: number): WalkSpec => ({
  view: "side",
  passes: 4,
  seed,
  speed: 1.1,
  cadence: 104,
  camera: { distance: 3.5, portrait: true },
  sidePath: { pathM: 5.3, turnSec: 1.5 },
  passShiftM: 0.3,
  noise: 0.004,
  jitterMs: 8,
});

const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side"], walking_pad: [] },
};

const within = (v: number | null | undefined, truth: number, share: number) =>
  v !== null && v !== undefined && Math.abs(v / truth - 1) <= share;

const inPicture = (f: GaitFrame) => f.lm.some((q) => q.visibility > 0.5);
/** The recording's frame is the walker's own at that time (the recorder keeps the points as numbers). */
const walkers = (f: GaitFrame, own: Map<number, Landmark[]>) => {
  const lm = own.get(f.t);
  return (
    !!lm &&
    [0, 11, 23, 24, 27].every(
      (i) => Math.abs(lm[i].x - f.lm[i].x) < 1e-4 && Math.abs(lm[i].y - f.lm[i].y) < 1e-4,
    )
  );
};
/** A pose's size in the picture (nose to ankle). */
const heightOf = (lm: Landmark[]) => Math.abs(lm[27].y - lm[0].y) / 0.95;

function controller(): GaitController {
  return new GaitController({
    plan: PLAN,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 170, regions: [] },
    poseModel: () => "full",
    log: () => undefined,
  });
}

/** Runs the walk through the capture, with `crowd(t, walker)` around the walker. */
function runWalk(
  seed: number,
  crowd: ((t: number, walker: Landmark[] | null) => { lm: Landmark[]; look: Look }[]) | null,
) {
  const spec = phoneSide(seed);
  const w = walk(spec);
  const walker = withRealFarLeg(w.frames);
  const ctl = controller();
  let t = w.standing[0].t - 100;
  ctl.start(t);
  for (let i = 0; i < 8 && ctl.current.id !== "place"; i++)
    if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
    else ctl.confirm(t);
  ctl.confirm(t);
  expect(ctl.current.id).toBe("stand");
  const frames = [...w.standing, ...walker];
  const own = new Set<Landmark[]>();
  const ownAt = new Map<number, Landmark[]>();
  let lookAt = -Infinity;
  let marked = 0;
  frames.forEach((f, k) => {
    if (ctl.current.id !== "stand" && ctl.current.id !== "walk") return;
    const me = inPicture(f)
      ? [{ lm: f.lm, look: { torso: CLOTHES.navyBlack.torso, legs: CLOTHES.navyBlack.legs } }]
      : [];
    // The crowd comes once the walker is walking (the standing calibration is the walker's alone).
    const others = crowd && k >= w.standing.length ? crowd(f.t, me[0]?.lm ?? null) : [];
    const here =
      k % 3 === 0
        ? [...others, ...me]
        : k % 3 === 1
          ? [...me, ...others]
          : [others[0], ...me, ...others.slice(1)].filter(Boolean);
    if (inPicture(f)) {
      own.add(f.lm);
      ownAt.set(f.t, f.lm);
    }
    const sample = f.t - lookAt >= 250;
    if (sample) lookAt = f.t;
    const frame = {
      t: f.t,
      lm: here[0]?.lm ?? f.lm,
      poses: here.map((h) => h.lm),
      aspect: f.aspect,
      ...(sample && here.length ? { looks: here.map((h) => h.look) } : {}),
    };
    ctl.feed(frame, { rollDeg: null });
    const s = subjectOf(frame);
    if (s !== undefined && s >= 0) {
      marked++;
      // Only the walker is ever marked for the drawing.
      expect(own.has(frame.poses[s])).toBe(true);
    }
    ctl.tick(f.t);
    t = f.t;
  });
  for (let i = 0; i < 3 && ctl.current.id === "walk"; i++) {
    t += CAPTURE_LIMITS.afterLastPassMs + 100;
    ctl.tick(t);
  }
  return { ctl, w, own, ownAt, marked };
}

describe("the walk in a crowd of four (D-038 item 2)", () => {
  for (const seed of [1, 2, 3])
    it(`ends as it does alone, recording the walker only (seed ${seed})`, () => {
      const alone = runWalk(seed, null);
      expect(alone.ctl.current.id).toBe("saving");
      const size = heightOf(alone.w.standing[0].lm);
      const crowd = (t: number) => {
        const out: { lm: Landmark[]; look: Look }[] = [];
        const b = pacing(0, 3500, 0.1, 0.9, { height: 0.5 * size, y: 0.46 })(t);
        const c = pacing(0, 4300, 0.85, 0.15, { height: 0.45 * size, y: 0.45 })(t - 2000);
        if (b) out.push({ lm: person(b, ASPECT), look: CLOTHES.whiteThobe });
        if (c) out.push({ lm: person(c, ASPECT), look: CLOTHES.redJeans });
        // Beside the path at the walker's size, near the right edge where the walker leaves the picture.
        out.push({ lm: person({ x: 0.9, height: size, y: 0.5 }, ASPECT), look: CLOTHES.greyBlue });
        return out;
      };
      const t0 = alone.w.standing[alone.w.standing.length - 1].t;
      const run = runWalk(seed, (t, me) => {
        const out = crowd(t);
        // Crossing in front of the walker once, in the middle of the second pass.
        const u = t - t0 - 9000;
        if (me && u >= 0 && u < 1200)
          out.push({
            lm: person({ x: 1.2 - (1.4 * u) / 1200, height: 1.3 * size }, ASPECT),
            look: CLOTHES.greenKhaki,
          });
        return out;
      });
      expect(run.ctl.current.id).toBe("saving");
      const a = alone.ctl.diagnostics()[0];
      const d = run.ctl.diagnostics()[0];
      expect(d.passes).toBe(4);
      expect(d.tries).toBe(1);
      expect(d.level).toBe(a.level);
      expect(within(d.cadence, alone.w.truth.cadence, 0.05)).toBe(true);
      // The recording holds the walker's landmarks only (or nobody).
      const rec = run.ctl.recordedFrames()[0];
      for (const f of [...rec.standing, ...rec.frames])
        if (inPicture(f)) expect(walkers(f, run.ownAt)).toBe(true);
      expect(run.marked).toBeGreaterThan(0.8 * alone.marked);
    });

  it("the walker gone mid walk: the hint asks them back, nobody else is recorded, and they are taken back", () => {
    const seed = 4;
    const spec = phoneSide(seed);
    const w = walk(spec);
    const size = heightOf(w.standing[0].lm);
    const t0 = w.standing[w.standing.length - 1].t;
    // The walker steps away for 12 s in the first pass; another person walks in and stands in the
    // middle of the path, the walker's size and in other clothes, while they are away.
    const awayFrom = t0 + 5500;
    const awayTo = awayFrom + 12000;
    const ctl = controller();
    let t = w.standing[0].t - 100;
    ctl.start(t);
    for (let i = 0; i < 8 && ctl.current.id !== "place"; i++)
      if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
      else ctl.confirm(t);
    ctl.confirm(t);
    const stranger = person({ x: 0.5, height: size, y: 0.5 }, ASPECT);
    const hints = new Set<string | null>();
    const own = new Map<number, Landmark[]>();
    const walker = withRealFarLeg(w.frames);
    // The walker's frames after the absence are the rest of the walk, later.
    const frames = [
      ...w.standing,
      ...walker.filter((f) => f.t < awayFrom),
      ...walker.filter((f) => f.t >= awayFrom).map((f) => ({ ...f, t: f.t + 12000 })),
    ];
    let k = 0;
    for (let tt = frames[0].t; k < frames.length; tt += 33) {
      if (ctl.current.id !== "stand" && ctl.current.id !== "walk") break;
      while (k < frames.length && frames[k].t < tt) k++;
      const f = frames[Math.min(k, frames.length - 1)];
      const away = tt >= awayFrom && tt < awayTo;
      const me = !away && inPicture(f) ? [f.lm] : [];
      me.forEach((lm) => own.set(tt, lm));
      const others = tt >= awayFrom + 1500 && tt < awayTo - 1000 ? [stranger] : [];
      const poses = [...others, ...me];
      const sample = Math.floor(tt / 250) !== Math.floor((tt - 33) / 250);
      const looks = [...others.map(() => CLOTHES.whiteThobe), ...me.map(() => CLOTHES.navyBlack)];
      ctl.feed(
        {
          t: tt,
          lm: poses[0] ?? f.lm,
          poses,
          aspect: f.aspect,
          ...(sample && poses.length ? { looks } : {}),
        },
        { rollDeg: null },
      );
      ctl.tick(tt);
      if (away) hints.add(ctl.hint);
      t = tt;
    }
    for (let i = 0; i < 3 && ctl.current.id === "walk"; i++)
      ctl.tick((t += CAPTURE_LIMITS.afterLastPassMs + 100));
    expect(hints.has("no_person")).toBe(true);
    const rec = ctl.recordedFrames()[0];
    for (const f of rec.frames) if (inPicture(f)) expect(walkers(f, own)).toBe(true);
    expect(ctl.current.id).toBe("saving");
    expect(ctl.diagnostics()[0].passes).toBe(4);
  });
});
