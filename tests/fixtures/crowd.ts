/**
 * Synthetic crowds for the crowd-proof lock (D-038 item 2: the booth is crowded; people move behind,
 * cross in front and stand close beside). Each member of the crowd has a place in the picture at each
 * time (or is out of it), a pose (the standing figure of people.ts, or their own) and clothes (their
 * look, as the camera source reads it from the picture a few times a second). The frames hold everyone
 * in the picture in a seeded shuffled order (the model's order is not stable), with the looks on the
 * frames the camera would sample. Clearly synthetic.
 */
import type { Look, Rgb } from "../../src/engine/look";
import type { Frame, Landmark } from "../../src/engine/types";
import { person, type PersonSpec } from "./people";

export interface Member {
  name: string;
  /** Where they are at `t` (ms), or null when out of the picture. */
  at(t: number): PersonSpec | null;
  /** Their own pose at `t` instead of the standing figure at `at(t)` (null: out of the picture). */
  pose?(t: number): Landmark[] | null;
  /** Their clothes: the colour of the torso and of the legs. */
  clothes: { torso: Rgb; legs: Rgb };
}

export interface CrowdOptions {
  aspect: number;
  /** Frame step (ms), default 33. */
  dt?: number;
  /** The camera reads the looks this often (ms); 0: never (a source without looks). Default 250. */
  lookEveryMs?: number;
  seed?: number;
  /** Drop a member's pose at these times (the model losing them, behind someone): name → [from, to) ms. */
  missing?: Record<string, [number, number][]>;
}

export interface Crowd {
  frames: Frame[];
  /** The member of each pose of each frame, in the frame's order. */
  who: string[][];
}

/** A small seeded random (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The frames of `ms` of a crowd, from t = 0. */
export function crowdFrames(ms: number, members: Member[], opts: CrowdOptions): Crowd {
  const dt = opts.dt ?? 33;
  const every = opts.lookEveryMs ?? 250;
  const rnd = seeded(opts.seed ?? 7);
  const frames: Frame[] = [];
  const who: string[][] = [];
  let lastLook = -Infinity;
  for (let t = 0; t <= ms; t += dt) {
    const here: { name: string; lm: Landmark[]; look: Look }[] = [];
    for (const m of members) {
      if ((opts.missing?.[m.name] ?? []).some(([a, b]) => t >= a && t < b)) continue;
      const lm = m.pose
        ? m.pose(t)
        : (() => {
            const at = m.at(t);
            return at ? person(at, opts.aspect) : null;
          })();
      if (!lm) continue;
      // A little light jitter on the clothes, as a camera's picture has.
      const j = (c: Rgb): Rgb => [
        c[0] + 6 * (rnd() - 0.5),
        c[1] + 6 * (rnd() - 0.5),
        c[2] + 6 * (rnd() - 0.5),
      ];
      here.push({ name: m.name, lm, look: { torso: j(m.clothes.torso), legs: j(m.clothes.legs) } });
    }
    // The model's order: shuffled.
    for (let i = here.length - 1; i > 0; i--) {
      const k = Math.floor(rnd() * (i + 1));
      [here[i], here[k]] = [here[k], here[i]];
    }
    const sample = every > 0 && t - lastLook >= every;
    if (sample) lastLook = t;
    const poses = here.map((h) => h.lm);
    frames.push({
      t,
      lm: poses[0] ?? Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
      poses,
      aspect: opts.aspect,
      ...(sample && poses.length ? { looks: here.map((h) => h.look) } : {}),
    });
    who.push(here.map((h) => h.name));
  }
  return { frames, who };
}

/** Clothes of a few colours (torso, legs). */
export const CLOTHES = {
  whiteThobe: { torso: [236, 236, 232] as Rgb, legs: [230, 230, 226] as Rgb },
  navyBlack: { torso: [32, 42, 92] as Rgb, legs: [28, 28, 30] as Rgb },
  redJeans: { torso: [190, 40, 44] as Rgb, legs: [50, 70, 120] as Rgb },
  greenKhaki: { torso: [40, 130, 70] as Rgb, legs: [170, 150, 110] as Rgb },
  blackAbaya: { torso: [24, 24, 26] as Rgb, legs: [22, 22, 24] as Rgb },
  greyBlue: { torso: [120, 124, 130] as Rgb, legs: [40, 60, 110] as Rgb },
} as const;

/** A walk across: from `from` to `to` (share of the width) over `ms`, starting at `t0`, else out of the picture. */
export const across =
  (t0: number, ms: number, from: number, to: number, spec: Omit<PersonSpec, "x">) =>
  (t: number): PersonSpec | null => {
    if (t < t0 || t > t0 + ms) return null;
    return { ...spec, x: from + ((to - from) * (t - t0)) / ms };
  };

/** Back and forth across the picture forever (period `ms` each way), from `t0`. */
export const pacing =
  (t0: number, ms: number, from: number, to: number, spec: Omit<PersonSpec, "x">) =>
  (t: number): PersonSpec | null => {
    if (t < t0) return null;
    const k = (t - t0) / ms;
    const leg = Math.floor(k);
    const s = k - leg;
    const u = leg % 2 === 0 ? s : 1 - s;
    return { ...spec, x: from + (to - from) * u };
  };
