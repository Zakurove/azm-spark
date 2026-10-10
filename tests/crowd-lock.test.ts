/**
 * D-038 item 2, the crowd-proof lock (the booth is crowded: «ensure that in the gait and ROM analysis
 * other people in the background don't take the focus»). The shared lock (src/engine/subject.ts,
 * CROWD_LOCK) on synthetic crowds of 4 or 5 people (tests/fixtures/crowd.ts): people walking behind,
 * one crossing in front, one standing very close beside, the model's order shuffled every frame and
 * the looks sampled 4 times a second as the camera source does:
 *   - the locked person is never replaced during a test (held), whatever the crowd does;
 *   - someone crossing in front without covering what the step needs pauses nothing;
 *   - covering it pauses, and the same person is taken back after;
 *   - the locked person gone mid test: nobody else is measured, drawn or counted, and they are taken
 *     back when they return (also without looks, when the newcomer is elsewhere);
 *   - between steps (not held) the lock moves only after 20 s, and only to someone standing ready;
 *   - the walk: the walker leaves at each pass's end, and walks toward and away from the phone, while
 *     others move behind and one stands where the walker leaves the picture.
 * The range runner, the walk's controller, the workouts and the demos: tests/v7/b-runner-lock.test.ts,
 * tests/v7/c-walk-crowd.test.ts and tests/workout-lock.test.ts. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import { lookDistance, lookOf } from "../src/engine/look";
import {
  CROWD_LOCK,
  posesOf,
  SUBJECT_RULES,
  SubjectLock,
  subjectOf,
  type SubjectLockOptions,
  type SubjectPick,
} from "../src/engine/subject";
import type { Landmark } from "../src/engine/types";
import { across, CLOTHES, crowdFrames, pacing, type Crowd, type Member } from "./fixtures/crowd";
import { person } from "./fixtures/people";

const PORTRAIT = 9 / 16;
const LANDSCAPE = 16 / 9;

/** Runs a lock over a crowd, locked on the first frame and held from `holdAt` (ms). */
function run(
  crowd: Crowd,
  opts: SubjectLockOptions = CROWD_LOCK,
  holdAt: number | null = 0,
  needs: readonly number[] | null = null,
): { lock: SubjectLock; picks: SubjectPick[]; names: (string | null)[] } {
  const lock = new SubjectLock(SUBJECT_RULES, opts);
  lock.setNeeds(needs);
  const first = crowd.frames[0];
  expect(lock.lock(posesOf(first), first.aspect, first.t, first.looks)).toBe(true);
  const picks = crowd.frames.map((f) => {
    if (holdAt !== null && f.t >= holdAt) lock.hold(true);
    return lock.pickFrame(f);
  });
  const names = picks.map((p, k) => (p.lm ? crowd.who[k][p.index] : null));
  return { lock, picks, names };
}

/** The range: A seated in the middle; the crowd of the booth around them. */
const A: Member = {
  name: "A",
  at: (t) => ({ x: 0.45 + 0.01 * Math.sin(t / 500), height: 0.6 }),
  clothes: CLOTHES.navyBlack,
};
const BEHIND: Member[] = [
  { name: "B", at: pacing(0, 4000, -0.05, 1.05, { height: 0.3, y: 0.42 }), clothes: CLOTHES.redJeans },
  { name: "C", at: pacing(0, 5000, 1.05, -0.05, { height: 0.26, y: 0.4 }), clothes: CLOTHES.greenKhaki },
];
/** Standing very close beside A, at A's size. */
const BESIDE: Member = { name: "E", at: () => ({ x: 0.82, height: 0.62 }), clothes: CLOTHES.greyBlue };
/** A's arm on the side the movement uses (the right of the figure: 12, 14, 16). */
const RIGHT_ARM = [12, 14, 16];

describe("the range: the locked person is never replaced, whatever the crowd does", () => {
  const D: Member = {
    name: "D",
    at: across(3000, 3000, 1.2, -0.2, { height: 0.9 }),
    clothes: CLOTHES.whiteThobe,
  };
  // The model loses A for a moment while D is right in front of them.
  const crowd = crowdFrames(9000, [A, ...BEHIND, D, BESIDE], {
    aspect: PORTRAIT,
    seed: 3,
    missing: { A: [[4400, 4750]] },
  });

  it("follows A alone (never B, C, D or E), pausing only while D covers A, and takes A back after", () => {
    const { lock, picks, names } = run(crowd);
    names.forEach((n) => n === null || expect(n).toBe("A"));
    expect(lock.generation).toBe(1);
    crowd.frames.forEach((f, k) => {
      const p = picks[k];
      const d = D.at(f.t);
      // Paused (or lost) only while D is over A's body in the picture; never otherwise.
      const overA = d !== null && Math.abs(d.x - A.at(f.t)!.x) < 0.45;
      if (!overA) expect(p).toMatchObject({ paused: false, reason: null });
      if (p.lm) expect(subjectOf(f)).toBe(p.index);
    });
    // D right over A pauses.
    const over = crowd.frames.findIndex((f) => {
      const d = D.at(f.t);
      return d !== null && Math.abs(d.x - 0.45) < 0.05;
    });
    expect(picks[over].paused).toBe(true);
    // A is taken back once D has passed.
    const after = crowd.frames.findIndex((f) => f.t >= 6200);
    expect(picks.slice(after).every((p, k) => p.lm !== null && names[after + k] === "A")).toBe(true);
  });

  it("without looks too (a source that reads none): A alone, generation 1", () => {
    const plain = crowdFrames(9000, [A, ...BEHIND, D, BESIDE], {
      aspect: PORTRAIT,
      seed: 3,
      lookEveryMs: 0,
      missing: { A: [[4400, 4750]] },
    });
    const { lock, names } = run(plain);
    names.forEach((n) => n === null || expect(n).toBe("A"));
    expect(lock.generation).toBe(1);
    expect(names.slice(-30).every((n) => n === "A")).toBe(true);
  });
});

describe("people in front don't pause unless they cover what the step needs", () => {
  // D2 crosses in front over A's left side and goes back: the movement is the right arm.
  const D2: Member = {
    name: "D",
    at: (t) =>
      t < 1500 || t > 5500
        ? null
        : { x: 0.2 - 0.25 * Math.abs(Math.cos(((t - 1500) / 4000) * Math.PI)), height: 0.9 },
    clothes: CLOTHES.whiteThobe,
  };
  const crowd = crowdFrames(7000, [A, ...BEHIND, D2, BESIDE], { aspect: PORTRAIT, seed: 11 });

  it("someone in front over the side the movement does not use: no pause at all", () => {
    const { picks, names } = run(crowd, CROWD_LOCK, 0, RIGHT_ARM);
    expect(picks.every((p) => !p.paused && p.lm !== null)).toBe(true);
    names.forEach((n) => expect(n).toBe("A"));
  });

  it("the v1 box rule (D-037) would have paused it, and the crowd lock with every key point too", () => {
    const box = run(crowd, { ignoreBehind: true }, null);
    expect(box.picks.some((p) => p.paused && p.reason === "overlap")).toBe(true);
    const all = run(crowd, CROWD_LOCK, 0, null);
    expect(all.picks.some((p) => p.paused && p.reason === "overlap")).toBe(true);
    all.names.forEach((n) => n === null || expect(n).toBe("A"));
  });

  it("people behind A, over A in the picture, never pause", () => {
    const behind: Member = {
      name: "F",
      at: pacing(0, 3000, 0.3, 0.6, { height: 0.35, y: 0.45 }),
      clothes: CLOTHES.whiteThobe,
    };
    const c = crowdFrames(6000, [A, ...BEHIND, behind, BESIDE], { aspect: PORTRAIT, seed: 5 });
    const { picks, names } = run(c);
    expect(picks.every((p) => !p.paused)).toBe(true);
    names.forEach((n) => expect(n).toBe("A"));
  });
});

describe("A gone mid test: nobody else is measured, drawn or counted", () => {
  const away = (t: number) => t >= 4000 && t < 12000;
  const Agone: Member = { ...A, at: (t) => (away(t) ? null : A.at(t)) };

  for (const [name, newcomer] of [
    // F sits where A was, A's size, other clothes.
    ["F takes A's place, A's size", { x: 0.45, height: 0.6 }],
    // F stands in the middle, larger (nearer the phone).
    ["F stands nearer the phone in the middle", { x: 0.55, height: 0.75 }],
  ] as const) {
    it(`${name}: never F (nor B, C, E); A taken back on return`, () => {
      const F: Member = {
        name: "F",
        at: (t) => (t >= 6000 && t < 10500 ? newcomer : null),
        clothes: CLOTHES.whiteThobe,
      };
      const crowd = crowdFrames(15000, [Agone, ...BEHIND, BESIDE, F], { aspect: PORTRAIT, seed: 9 });
      const { lock, picks, names } = run(crowd);
      crowd.frames.forEach((f, k) => {
        if (away(f.t)) {
          expect(picks[k]).toMatchObject({ lm: null, index: -1, paused: true });
          expect(subjectOf(f)).toBe(-1);
        }
        if (names[k] !== null) expect(names[k]).toBe("A");
      });
      // Back within a second of returning (a look is read 4 times a second).
      const back = crowd.frames.findIndex((f) => f.t >= 13000);
      expect(names.slice(back).every((n) => n === "A")).toBe(true);
      expect(lock.generation).toBe(1);
    });
  }

  it("without looks: a newcomer elsewhere in the picture is never taken, A is on return", () => {
    const F: Member = {
      name: "F",
      at: (t) => (t >= 6000 && t < 10500 ? { x: 0.82, height: 0.6 } : null),
      clothes: CLOTHES.whiteThobe,
    };
    const crowd = crowdFrames(15000, [Agone, ...BEHIND, F], { aspect: PORTRAIT, seed: 13, lookEveryMs: 0 });
    const { lock, names } = run(crowd);
    crowd.frames.forEach((f, k) => {
      if (away(f.t)) expect(names[k]).toBeNull();
      if (names[k] !== null) expect(names[k]).toBe("A");
    });
    expect(names[names.length - 1]).toBe("A");
    expect(lock.generation).toBe(1);
  });

  it("held, A gone for a minute while E stands ready: still nobody", () => {
    const crowd = crowdFrames(70000, [{ ...A, at: (t) => (t < 3000 ? A.at(t) : null) }, BESIDE, ...BEHIND], {
      aspect: PORTRAIT,
      seed: 2,
      dt: 66,
    });
    const { lock, picks } = run(crowd);
    expect(picks.slice(crowd.frames.findIndex((f) => f.t >= 3100)).every((p) => p.lm === null)).toBe(true);
    expect(lock.generation).toBe(1);
  });
});

describe("between steps (not held): a new person only after 20 s, and only one standing ready", () => {
  it("A leaves; E stands ready beside, B walks behind: E after 20 s, never B", () => {
    const crowd = crowdFrames(30000, [{ ...A, at: (t) => (t < 2000 ? A.at(t) : null) }, BESIDE, ...BEHIND], {
      aspect: PORTRAIT,
      seed: 4,
      dt: 50,
    });
    const { lock, names } = run(crowd, CROWD_LOCK, null);
    crowd.frames.forEach((f, k) => {
      const lastSeen = 2000 - 50;
      if (f.t >= 2000 && f.t < lastSeen + SUBJECT_RULES.switchAfterMs) expect(names[k]).toBeNull();
      if (f.t >= lastSeen + SUBJECT_RULES.switchAfterMs + 100) expect(names[k]).toBe("E");
    });
    expect(lock.generation).toBe(2);
  });

  it("with only people walking past, nobody is taken", () => {
    const crowd = crowdFrames(30000, [{ ...A, at: (t) => (t < 2000 ? A.at(t) : null) }, ...BEHIND], {
      aspect: PORTRAIT,
      seed: 4,
      dt: 50,
    });
    const { lock, names } = run(crowd, CROWD_LOCK, null);
    expect(names.slice(crowd.frames.findIndex((f) => f.t >= 2100)).every((n) => n === null)).toBe(true);
    expect(lock.generation).toBe(1);
  });

  it("a new lock (a clear start: a new set, a demo, the person tapping start again) takes the person there", () => {
    const crowd = crowdFrames(1000, [BESIDE, ...BEHIND], { aspect: PORTRAIT, seed: 1 });
    const lock = new SubjectLock(SUBJECT_RULES, CROWD_LOCK);
    lock.hold(true);
    const f = crowd.frames[0];
    expect(lock.lock(posesOf(f), f.aspect, f.t, f.looks)).toBe(true);
    expect(crowd.who[0][lock.pickFrame(f).index]).toBe("E");
  });
});

describe("the walk: the walker leaves at each pass's end while others move in the background", () => {
  /** A walks across and out of the picture, turns out of it, and back, 4 passes (side on). */
  const passMs = 3000;
  const turnMs = 2500;
  const walkerAt = (t: number) => {
    const pass = Math.floor(t / (passMs + turnMs));
    if (pass >= 4) return null;
    const into = t - pass * (passMs + turnMs);
    const dir = pass % 2 === 0 ? 1 : -1;
    const x = dir > 0 ? -0.15 + (1.3 * into) / passMs : 1.15 - (1.3 * into) / passMs;
    return into < passMs && x > -0.1 && x < 1.1 ? { x, height: 0.55, side: true } : null;
  };
  const W: Member = { name: "A", at: walkerAt, clothes: CLOTHES.redJeans };
  const crowd: Member[] = [
    W,
    { name: "B", at: pacing(0, 3500, 0.05, 0.95, { height: 0.3, y: 0.45 }), clothes: CLOTHES.whiteThobe },
    { name: "C", at: pacing(500, 4200, 0.9, 0.1, { height: 0.26, y: 0.43 }), clothes: CLOTHES.greenKhaki },
    // Standing where the walker leaves the picture on the right, the walker's size.
    { name: "D", at: () => ({ x: 0.88, height: 0.52 }), clothes: CLOTHES.greyBlue },
    { name: "E", at: pacing(1000, 6000, 0.2, 0.7, { height: 0.32, y: 0.44 }), clothes: CLOTHES.blackAbaya },
  ];

  for (const looks of [250, 0])
    it(`never anyone else, the walker followed through every pass (${looks ? "with" : "without"} looks)`, () => {
      const c = crowdFrames(4 * (passMs + turnMs), crowd, {
        aspect: LANDSCAPE,
        seed: 21,
        lookEveryMs: looks,
      });
      const lock = new SubjectLock(SUBJECT_RULES, { ...CROWD_LOCK, mode: "walk" });
      // Taken at the standing calibration, A standing in the middle of the picture, C and D there too.
      const stand = crowdFrames(
        1000,
        [{ ...W, at: () => ({ x: 0.45, height: 0.55, side: true }) }, crowd[2], crowd[3]],
        {
          aspect: LANDSCAPE,
          seed: 1,
          lookEveryMs: looks,
        },
      );
      for (const f of stand.frames) if (!lock.locked) lock.lock(posesOf(f), f.aspect, f.t - 2000, f.looks);
      for (const f of stand.frames) lock.pickFrame({ ...f, t: f.t - 2000 });
      lock.hold(true);
      const picks = c.frames.map((f) => lock.pickFrame(f));
      let seen = 0;
      let followed = 0;
      picks.forEach((p, k) => {
        if (p.lm) expect(c.who[k][p.index]).toBe("A");
        if (c.who[k].includes("A")) {
          seen++;
          if (p.lm) followed++;
        }
      });
      expect(followed).toBeGreaterThan(0.8 * seen);
      expect(lock.generation).toBe(1);
    });

  it("the front and back part: toward the phone (lost when too close) and away, people behind at the walker's far size", () => {
    // Toward the phone 3.5 s (0.3 to 1.0 of the height), lost 0.8 s at the near end, away 3.5 s, a turn 1.2 s at the far end.
    const leg = 3500;
    const near = 800;
    const turn = 1200;
    const cycle = 2 * leg + near + turn;
    const at = (t: number) => {
      const c = Math.floor(t / cycle);
      if (c >= 2) return null;
      const u = t - c * cycle;
      const sway = 0.5 + 0.02 * Math.sin(t / 300);
      if (u < leg) return { x: sway, height: 0.3 + (0.7 * u) / leg, y: 0.45 + (0.1 * u) / leg };
      if (u < leg + near) return null;
      if (u < 2 * leg + near) {
        const v = (u - leg - near) / leg;
        return { x: sway, height: 1.0 - 0.7 * v, y: 0.55 - 0.1 * v };
      }
      return { x: sway, height: 0.3, y: 0.45 };
    };
    const members: Member[] = [
      { name: "A", at, clothes: CLOTHES.navyBlack },
      { name: "B", at: pacing(0, 3000, 0.2, 0.8, { height: 0.27, y: 0.44 }), clothes: CLOTHES.whiteThobe },
      { name: "C", at: () => ({ x: 0.18, height: 0.34, y: 0.45 }), clothes: CLOTHES.redJeans },
      { name: "D", at: pacing(400, 5000, 0.65, 0.92, { height: 0.3, y: 0.44 }), clothes: CLOTHES.greenKhaki },
    ];
    const c = crowdFrames(2 * cycle, members, { aspect: LANDSCAPE, seed: 8 });
    const lock = new SubjectLock(SUBJECT_RULES, { ...CROWD_LOCK, mode: "walk" });
    const f0 = c.frames[0];
    expect(lock.lock(posesOf(f0), f0.aspect, f0.t, f0.looks)).toBe(true);
    expect(c.who[0][lock.pickFrame(f0).index]).toBe("A");
    lock.hold(true);
    const picks = c.frames.slice(1).map((f) => lock.pickFrame(f));
    let seen = 0;
    let followed = 0;
    picks.forEach((p, k) => {
      const who = c.who[k + 1];
      if (p.lm) expect(who[p.index]).toBe("A");
      if (who.includes("A")) {
        seen++;
        if (p.lm) followed++;
      }
    });
    expect(followed).toBeGreaterThan(0.85 * seen);
    expect(lock.generation).toBe(1);
  });
});

describe("the look (engine/look.ts)", () => {
  /** A picture with two people's clothes painted where their torso and thighs are. */
  function picture(w: number, h: number, people: { lm: Landmark[]; torso: number[]; legs: number[] }[]) {
    const px = new Uint8ClampedArray(w * h * 4).fill(128);
    const paint = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
      for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++)
        for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
        }
    };
    for (const p of people) {
      const { lm } = p;
      const xs = [lm[11].x, lm[12].x, lm[23].x, lm[24].x];
      paint(Math.min(...xs), lm[11].y, Math.max(...xs), lm[23].y, p.torso);
      paint(
        Math.min(lm[23].x, lm[25].x) - 0.01,
        lm[23].y,
        Math.max(lm[24].x, lm[26].x) + 0.01,
        lm[25].y,
        p.legs,
      );
    }
    return px;
  }

  it("reads each person's clothes from the picture, tells two apart and the same one again", () => {
    const a = person({ x: 0.3, height: 0.6 }, LANDSCAPE);
    const b = person({ x: 0.7, height: 0.6 }, LANDSCAPE);
    const img = picture(96, 54, [
      { lm: a, torso: [30, 40, 90], legs: [25, 25, 28] },
      { lm: b, torso: [235, 235, 230], legs: [228, 228, 224] },
    ]);
    const la = lookOf(img, 96, 54, a)!;
    const lb = lookOf(img, 96, 54, b)!;
    expect(la.torso).not.toBeNull();
    expect(la.legs).not.toBeNull();
    expect(lookDistance(la, lb)!.min).toBeGreaterThanOrEqual(SUBJECT_RULES.lookDifferent);
    // The same person a moment later, a little brighter (the camera's exposure): the same look.
    const img2 = picture(96, 54, [{ lm: a, torso: [40, 52, 104], legs: [32, 32, 36] }]);
    expect(lookDistance(la, lookOf(img2, 96, 54, a))!.mean).toBeLessThanOrEqual(SUBJECT_RULES.lookSame);
  });

  it("a region out of the picture is not read; a pose with nothing in it has no look", () => {
    const img = new Uint8ClampedArray(96 * 54 * 4).fill(100);
    const off = person({ x: 1.6, height: 0.6 }, LANDSCAPE);
    expect(lookOf(img, 96, 54, off)).toBeNull();
    const seatedClose = person({ x: 0.5, y: 0.9, height: 0.9 }, LANDSCAPE);
    const look = lookOf(img, 96, 54, seatedClose);
    expect(look?.legs ?? null).toBeNull();
  });

  it("a jacket dark at the back and light in front is still the same person (the legs match)", () => {
    const front = { torso: [235, 235, 230] as const, legs: [40, 60, 110] as const };
    const back = { torso: [24, 24, 26] as const, legs: [42, 62, 112] as const };
    const d = lookDistance(front, back)!;
    expect(d.min).toBeLessThan(SUBJECT_RULES.lookDifferent);
  });
});
