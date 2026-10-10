/**
 * D-038 item 2 on the range block (features/focus/romController.ts): the crowd-proof lock, held from
 * the block's first movement. The person measured steps out of the picture in a try while two people
 * walk behind them: the measurement pauses (the runner's clock stops) with a calm «step back into the
 * picture» on the screen and from the coach, nobody else is measured, and the same person back, the try
 * starts again and the block ends measured, its lock never handed to anyone. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import { itemKey, LOST_PAUSE_MS, RomController } from "../../src/features/focus/romController";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import type { Landmark } from "../../src/engine/types";
import { entry, intake, today } from "./a-fixtures";
import { bridges, runBlock, saves } from "./b-shell-driver";
import { MOVEMENT_CASES } from "./b-person";
import { pacing } from "../fixtures/crowd";
import { person } from "../fixtures/people";

const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });

/** Two people walking to and fro behind the person (smaller in the picture). */
const behind = (t: number): Landmark[][] =>
  [
    pacing(0, 3000, 0.05, 0.95, { height: 0.3, y: 0.35 })(t),
    pacing(700, 4100, 0.95, 0.05, { height: 0.26, y: 0.33 })(t),
  ].flatMap((p) => (p ? [person(p, 1)] : []));

describe("the range block in a crowd (D-038 item 2)", () => {
  it("the person out of the picture mid try: paused, «step back», nobody measured; back, measured", () => {
    const ctl = new RomController({
      protocol: buildRomProtocol({ intake: KNEE, setting: "booth", today: today() }),
      painByRegion: {},
      intake: KNEE,
      lang: "en",
      restSec: 1,
    });
    ctl.startBlock("lying", 0);
    let awayFrom = Infinity;
    const away = (t: number) => t >= awayFrom && t < awayFrom + 6000;
    const seen: { t: number; kind: string; phase: string | null; lost: boolean; held: boolean }[] = [];
    const lock = (ctl as unknown as { lock: { held: boolean; generation: number } }).lock;
    const run = runBlock(
      ctl,
      {
        at: (t, c) => {
          if (awayFrom === Infinity && (c.phase === "practice" || c.phase === "attempt")) awayFrom = t + 300;
          seen.push({ t, kind: c.current.kind, phase: c.phase, lost: c.lost, held: lock.held });
        },
        people: (lm, t) => {
          const crowd = behind(t);
          const poses = away(t) ? crowd : [...crowd, lm];
          return Math.floor(t / 33) % 2 ? poses.reverse() : poses;
        },
      },
      400,
    );
    // Paused while away (after the moment the lock gives), and only then.
    const during = seen.filter((s) => away(s.t) && s.t >= awayFrom + LOST_PAUSE_MS + 100);
    expect(during.length).toBeGreaterThan(50);
    expect(during.every((s) => s.phase === "paused" && s.lost)).toBe(true);
    expect(seen.filter((s) => !away(s.t) && s.t > awayFrom + 6000 + 500).every((s) => !s.lost)).toBe(true);
    // The coach says it once, calmly.
    const said = bridges(run.events).filter(
      (e) => e.type === "say" && (e as { key?: string }).key === "subject_lost",
    );
    expect(said).toHaveLength(1);
    // The block ends with both movements measured on the person.
    const saved = saves(run.events);
    expect(saved.map((e) => itemKey(e.item))).toEqual(["knee_flexion:right", "knee_extension:right"]);
    for (const e of saved) {
      expect(e.result.status).toBe("measured");
      expect(Math.abs(e.result.value! - MOVEMENT_CASES[e.item.movementId].target)).toBeLessThanOrEqual(2);
    }
    expect(lock.generation).toBe(1);
    // Held from the block's first start pose taken (a try under way) to the block's end; free at the
    // block's card and while that first start pose is taken.
    const firstTry = seen.findIndex((s) => s.phase === "practice" || s.phase === "attempt");
    expect(seen.slice(0, firstTry).every((s) => !s.held)).toBe(true);
    expect(seen.slice(firstTry + 1).every((s) => s.held)).toBe(true);
  });
});
