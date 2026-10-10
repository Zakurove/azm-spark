/**
 * D-037 item 4: one person locked on every camera screen (the booth: many people in the picture).
 * Nasser: «Person A comes into the camera and now he's the main guy we're focusing on, then person B
 * comes. We will not see person B until person A is out of the picture, and then we will reconsider.»
 * The shared lock (src/engine/subject.ts SubjectLock) on synthetic two person sequences, the model's
 * pose order shuffled every frame:
 *   - B enters and stands closer or more central: the lock stays on A;
 *   - A leaves for longer than the release time: the lock moves to B;
 *   - A leaves briefly: the lock stays (A again when back, never B meanwhile);
 *   - the walk: A leaves at each pass's end and comes back while B stands still: the lock stays on A;
 * and the lock is taken on the person the step is for, and marks its person for the drawing.
 */
import { describe, expect, it } from "vitest";
import {
  acquireIndex,
  posesOf,
  SubjectLock,
  SUBJECT_RULES,
  subjectOf,
  type SubjectPick,
} from "../src/engine/subject";
import { setupCheck, type SetupConfig } from "../src/engine/quality";
import type { Frame, Landmark } from "../src/engine/types";
import { frameOf, person, type PersonSpec } from "./fixtures/people";

const ASPECT = 9 / 16;
const DT = 33;

/** A seeded shuffle of a frame's people (the model's order is not stable from frame to frame). */
function shuffled<T>(xs: T[], k: number): { list: T[]; order: number[] } {
  const order = xs.map((_, i) => i);
  if ((k * 7919) % 3 === 1) order.reverse();
  return { list: order.map((i) => xs[i]), order };
}

/**
 * Frames from a script of who is where at each time: `at(t)` gives A and B (null when out of the
 * picture). Returns the frames and, per frame, the index of A in the frame's poses (-1 when absent).
 */
function scene(ms: number, at: (t: number) => { a: PersonSpec | null; b: PersonSpec | null }) {
  const frames: Frame[] = [];
  const aIndex: number[] = [];
  const bIndex: number[] = [];
  for (let t = 0, k = 0; t <= ms; t += DT, k++) {
    const { a, b } = at(t);
    const people: { who: "a" | "b"; lm: Landmark[] }[] = [];
    if (a) people.push({ who: "a", lm: person(a, ASPECT) });
    if (b) people.push({ who: "b", lm: person(b, ASPECT) });
    const { list } = shuffled(people, k);
    frames.push(
      frameOf(
        t,
        list.map((p) => p.lm),
        ASPECT,
      ),
    );
    aIndex.push(list.findIndex((p) => p.who === "a"));
    bIndex.push(list.findIndex((p) => p.who === "b"));
  }
  return { frames, aIndex, bIndex };
}

/** Runs a lock over the frames, locked at the first frame with someone. */
function run(lock: SubjectLock, frames: Frame[]): SubjectPick[] {
  const first = frames.find((f) => posesOf(f).length)!;
  expect(lock.lock(posesOf(first), first.aspect, first.t)).toBe(true);
  return frames.map((f) => lock.pickFrame(f));
}

const A: PersonSpec = { x: 0.45, height: 0.62 };

describe("the person a step is for, when the lock is taken", () => {
  it("is the one in the picture, not a background figure or a passer-by cut by the edge", () => {
    const subject = person({ x: 0.62, height: 0.6 }, ASPECT);
    const background = person({ x: 0.5, y: 0.45, height: 0.22 }, ASPECT);
    const passing = person({ x: 0.97, height: 0.7 }, ASPECT);
    expect(acquireIndex([background, passing, subject], ASPECT)).toBe(2);
    expect(acquireIndex([passing, subject, background], ASPECT)).toBe(1);
  });

  it("is the one nearest the centre among people of a size", () => {
    const left = person({ x: 0.3, height: 0.6 }, ASPECT);
    const centre = person({ x: 0.52, height: 0.55 }, ASPECT);
    expect(acquireIndex([left, centre], ASPECT)).toBe(1);
  });
});

describe("one person locked: B never takes A's place while A is there", () => {
  it("B enters and stands closer to the phone, in the middle of the picture: the lock stays on A", () => {
    const { frames, aIndex } = scene(6000, (t) => ({
      a: { ...A, x: 0.4 + 0.03 * Math.sin(t / 400) },
      // B walks in from the right and stands in the middle, nearer the phone (larger).
      b: t < 1000 ? null : { x: Math.max(0.5, 1.1 - (t - 1000) / 2000), height: 0.8 },
    }));
    const lock = new SubjectLock();
    const picks = run(lock, frames);
    picks.forEach((p, i) => {
      expect(p.lm).not.toBeNull();
      expect(p.index).toBe(aIndex[i]);
    });
    expect(lock.generation).toBe(1);
    // The drawing reads the same person.
    frames.forEach((f, i) => expect(subjectOf(f)).toBe(aIndex[i]));
  });

  it("follows A, not B, when B passes behind A in the picture", () => {
    const { frames, aIndex } = scene(5000, (t) => ({
      a: { ...A, x: 0.45 },
      b: { x: 1.05 - t / 4000, height: 0.5, y: 0.47 },
    }));
    const picks = run(new SubjectLock(), frames);
    picks.forEach((p, i) => {
      if (p.lm) expect(p.index).toBe(aIndex[i]);
    });
    // Paused only while B overlaps A (the overlap rule), never on B.
    expect(picks.filter((p) => p.lm).length).toBeGreaterThan(picks.length * 0.5);
    expect(picks[picks.length - 1].index).toBe(aIndex[picks.length - 1]);
  });
});

describe("A leaves", () => {
  it("for longer than the release time: the lock moves to B", () => {
    const leaveAt = 2000;
    const { frames, aIndex, bIndex } = scene(7000, (t) => ({
      a: t < leaveAt ? A : null,
      b: { x: 0.75, height: 0.55 },
    }));
    const lock = new SubjectLock();
    const picks = run(lock, frames);
    frames.forEach((f, i) => {
      const p = picks[i];
      if (f.t < leaveAt) expect(p.index).toBe(aIndex[i]);
      else if (f.t - leaveAt < SUBJECT_RULES.releaseMs - DT)
        // A unseen: paused, nothing measured, B ignored.
        expect(p).toMatchObject({ paused: true, lm: null, index: -1 });
      else if (f.t - leaveAt > SUBJECT_RULES.releaseMs + DT) {
        expect(p.paused).toBe(false);
        expect(p.index).toBe(bIndex[i]);
      }
    });
    expect(lock.generation).toBe(2);
  });

  it("briefly (under the release time): the lock stays, and A is followed again when back", () => {
    const { frames, aIndex } = scene(6000, (t) => ({
      a: t >= 2000 && t < 3200 ? null : { ...A, x: t < 2000 ? 0.45 : 0.5 },
      b: { x: 0.78, height: 0.58 },
    }));
    const lock = new SubjectLock();
    const picks = run(lock, frames);
    frames.forEach((f, i) => {
      const p = picks[i];
      if (aIndex[i] < 0) expect(p).toMatchObject({ paused: true, lm: null });
      else if (f.t > 3300) expect(p.index).toBe(aIndex[i]);
      if (p.lm) expect(p.index).toBe(aIndex[i]);
    });
    expect(lock.generation).toBe(1);
  });

  it("the lock taken again at the next step keeps A while A is there", () => {
    // A first, then B comes, nearer the centre and larger.
    const { frames, aIndex } = scene(3000, (t) => ({
      a: { ...A, x: 0.36 },
      b: t < 500 ? null : { x: 0.52, height: 0.66 },
    }));
    const lock = new SubjectLock();
    run(lock, frames.slice(0, 30));
    // The next movement's calibration: B is nearer the centre and larger, A is kept.
    const f = frames[40];
    expect(lock.lock(posesOf(f), f.aspect, f.t)).toBe(true);
    expect(lock.pickFrame(f).index).toBe(aIndex[40]);
    expect(lock.generation).toBe(1);
  });

  it("with nobody left: the next person to come is locked", () => {
    const { frames, bIndex } = scene(8000, (t) => ({
      a: t < 1000 ? A : null,
      b: t < 5000 ? null : { x: 0.5, height: 0.6 },
    }));
    const lock = new SubjectLock();
    const picks = run(lock, frames);
    const last = picks.length - 1;
    expect(picks[last].index).toBe(bIndex[last]);
    expect(lock.generation).toBe(2);
  });
});

describe("the walk: the walker leaves the picture at each pass's end", () => {
  /** A walks across and out of the picture, turns out of it, and back, 4 passes; B stands still. */
  function walkScene(bAt: number) {
    const passMs = 3000;
    const turnMs = 2500;
    return scene(4 * (passMs + turnMs), (t) => {
      const pass = Math.floor(t / (passMs + turnMs));
      const into = t - pass * (passMs + turnMs);
      const dir = pass % 2 === 0 ? 1 : -1;
      const x = dir > 0 ? -0.15 + (1.3 * into) / passMs : 1.15 - (1.3 * into) / passMs;
      const a = into < passMs && x > -0.1 && x < 1.1 ? { x, height: 0.55, side: true } : null;
      // B comes into the picture during the first pass and stands still.
      return { a, b: t < 1500 ? null : { x: bAt, height: 0.5 } };
    });
  }

  for (const bAt of [0.5, 0.8])
    it(`keeps A when A comes back from the side it left by, while B stands at ${bAt}`, () => {
      const { frames, aIndex } = walkScene(bAt);
      const lock = new SubjectLock(SUBJECT_RULES, { mode: "walk" });
      // The lock is taken at the standing calibration, A standing in the middle of the picture.
      const stand = frameOf(-1000, [person({ x: 0.1, height: 0.55, side: true }, ASPECT)], ASPECT);
      expect(lock.lock(posesOf(stand), ASPECT, stand.t)).toBe(true);
      expect(lock.pickFrame(stand).index).toBe(0);
      const picks = frames.map((f) => lock.pickFrame(f));
      let followed = 0;
      picks.forEach((p, i) => {
        // Never B.
        if (p.lm) expect(p.index).toBe(aIndex[i]);
        if (aIndex[i] >= 0 && p.lm) followed++;
      });
      // A is followed in nearly all of A's frames (the first frames at each entry may wait).
      expect(followed).toBeGreaterThan(0.85 * aIndex.filter((i) => i >= 0).length);
      expect(lock.generation).toBe(1);
    });

  it("a range or workout lock (2 s) would move to B at the first turn; the walk's waits", () => {
    const { frames, bIndex } = walkScene(0.5);
    const stay = new SubjectLock();
    const stand = frameOf(-1000, [person({ x: 0.1, height: 0.55, side: true }, ASPECT)], ASPECT);
    stay.lock(posesOf(stand), ASPECT, stand.t);
    const picks = frames.map((f) => stay.pickFrame(f));
    expect(picks.some((p, i) => p.lm && p.index === bIndex[i])).toBe(true);
  });
});

describe("the setup check reads the locked person only", () => {
  const cfg: SetupConfig = {
    testId: null,
    side: "right",
    framing: [0, 11, 12, 23, 24, 27, 28],
    views: ["front", "side", "oblique", "unknown"],
    distanceM: [0.3, 8],
    margin: 0.02,
    tiltMaxDeg: 30,
    tiltWarnDeg: null,
    armRoom: false,
    distanceRule: "trackable",
    viewBlocks: false,
  };
  const frames = (subject: number | undefined, b: Landmark[]) =>
    Array.from({ length: 10 }, (_, k) => ({
      t: k * 33,
      poses: [b, person({ x: 0.3, height: 0.6 }, ASPECT)],
      aspect: ASPECT,
      ...(subject !== undefined ? { subject } : {}),
    }));

  it("never reads B's framing: B in the middle with the feet cut off, A framed", () => {
    const b = person({ x: 0.5, y: 0.75, height: 0.75 }, ASPECT);
    // Before any lock, the person nearest the centre (B) is read; with the lock, A.
    expect(setupCheck(frames(undefined, b), cfg).issues).toContain("framing");
    expect(setupCheck(frames(1, b), cfg).issues).not.toContain("framing");
  });

  it("v7: someone behind A over them in the picture is not a second person in the way", () => {
    const behind = person({ x: 0.32, y: 0.45, height: 0.3 }, ASPECT);
    expect(setupCheck(frames(1, behind), cfg).issues).toContain("second_person");
    expect(setupCheck(frames(1, behind), { ...cfg, ignoreBehind: true }).issues).not.toContain(
      "second_person",
    );
  });
});
