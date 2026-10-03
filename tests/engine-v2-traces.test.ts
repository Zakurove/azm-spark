/**
 * Booth v2, contract A9: synthetic traces through the whole workout flow, the way the camera screen
 * runs it (src/engine/workoutFlow.ts): the outline, the start position, the 2 rep calibration and
 * the counted set.
 *
 *   Nasser's case     arms resting down, then limited reps: they must count (the field test bug);
 *   full range        the reps after calibration all count;
 *   limited range     a small but steady press counts;
 *   adapting down     reps that settle lower re-anchor the top, then count;
 *   tremor            a steady hand with a tremor is never a rep;
 *   framing flicker   joints blinking at the edge never flip the caption or stop the count;
 *   start position    calibration never starts while out of it.
 */
import { describe, expect, it } from "vitest";
import { profileById } from "../src/engine/profiles";
import { seatedCurlTrace, seatedPressTrace, sitToStandTrace } from "../src/engine/traces";
import type { Frame, Landmark } from "../src/engine/types";
import { LM } from "../src/engine/types";
import { FlowView, WorkoutFlow } from "../src/engine/workoutFlow";
import { exerciseById, variantForProfile } from "../src/exercises/defs";

const PRESS = exerciseById("seated_shoulder_press");

function runFlow(frames: Frame[], o: { exerciseId?: string; profileId?: string; target?: number } = {}) {
  const def = exerciseById(o.exerciseId ?? PRESS.id);
  const profileId = o.profileId ?? (def.id === "sit_to_stand" ? "standing" : "wheelchair");
  const flow = new WorkoutFlow(
    def,
    profileById(profileId),
    variantForProfile(def, profileId).requiredLandmarks,
    o.target ?? 50,
  );
  const views: FlowView[] = [];
  for (const f of frames) views.push(flow.step(f));
  const firstAt = (stage: FlowView["stage"]) => views.find((v) => v.stage === stage)?.frame.t ?? -1;
  const captions = views.map((v) => v.caption?.id ?? null);
  return { flow, views, firstAt, captions, count: views[views.length - 1].count };
}

/** Arms resting by the thighs (straight elbows), framed: what the trial first took as a full press. */
const resting = (sec: number) =>
  seatedPressTrace({ reps: 0, restSec: sec + 5, leadInSec: 0 }).slice(0, sec * 30);

describe("A9 Nasser's case: arms resting down, then limited reps", () => {
  it("never calibrates on the resting arms, and the limited reps count", () => {
    // 4 s resting (straight elbows), raise to the shoulders, hold, then 8 reps at 45% of a full press
    const frames = seatedPressTrace({ reps: 8, effort: 0.45, restSec: 4, leadInSec: 2 });
    const { firstAt, count, flow, views } = runFlow(frames);
    expect(firstAt("start")).toBeLessThan(1000);
    expect(firstAt("calibrating")).toBeGreaterThan(4000 + 1000); // after the rest and the raise
    expect(firstAt("training")).toBeGreaterThan(firstAt("calibrating"));
    // two reps measure the range; the other six count
    expect(count).toBeGreaterThanOrEqual(5);
    expect(flow.counts.partial).toBeLessThanOrEqual(1);
    const range = flow.engine!.range;
    expect(range[1]).toBeLessThan(0.9); // the personal top is the limited press, not a full one
    // the resting posture read as the bottom of the movement, never near the top
    const restPct = views.filter((v) => v.frame.t < 3500 && v.pct !== null);
    expect(restPct).toHaveLength(0);
  });

  it("keeps counting when the arms rest in the lap between reps", () => {
    const set = seatedPressTrace({ reps: 8, effort: 0.45, leadInSec: 2.5 });
    const lap = resting(3);
    const cut = Math.round((2.5 + 4 * 2.4) * 30); // after the 4th rep
    const frames = [
      ...set.slice(0, cut),
      ...lap.map((f, i) => ({ ...f, t: set[cut].t + i * 33 })),
      ...set.slice(cut).map((f) => ({ ...f, t: f.t + lap.length * 33 })),
    ];
    const { count, flow } = runFlow(frames);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(flow.counts.partial).toBeLessThanOrEqual(1);
  });
});

describe("A9 range of movement", () => {
  it("a full range person: 2 reps calibrate, the next 6 all count as steady", () => {
    const { count, flow } = runFlow(seatedPressTrace({ reps: 8, leadInSec: 2.5 }));
    expect(count).toBe(6);
    expect(flow.counts.valid).toBe(6);
    const s = flow.summary();
    expect(s.steadyReps).toBe(6);
    expect(s.measure!.kind).toBe("elbow_extension");
    expect(s.measure!.rangeDeg).toBeGreaterThan(80);
  });

  it("a limited range person: a small steady press counts", () => {
    const { count, flow } = runFlow(seatedPressTrace({ reps: 8, effort: 0.3, leadInSec: 2.5 }));
    expect(count).toBeGreaterThanOrEqual(5);
    expect(flow.summary().measure!.rangeDeg).toBeLessThan(60);
  });

  it("adapting down: reps that settle lower re-anchor the top, then count", () => {
    const frames = seatedPressTrace({
      reps: 10,
      leadInSec: 2.5,
      efforts: [1, 1, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62],
    });
    const { views, count, flow } = runFlow(frames);
    const adapted = views
      .flatMap((v) => v.events)
      .filter((e) => e.kind === "range" && e.reason === "adapt_down");
    expect(adapted).toHaveLength(1);
    expect(flow.counts.partial).toBe(3);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("the curl and the sit to stand run the same flow", () => {
    const curl = runFlow(seatedCurlTrace({ reps: 7, leadInSec: 2.5 }), { exerciseId: "seated_biceps_curl" });
    expect(curl.count).toBe(5);
    const stand = runFlow(sitToStandTrace({ reps: 6, leadInSec: 2.5 }), { exerciseId: "sit_to_stand" });
    expect(stand.count).toBe(4);
  });

  it("finishes at the target", () => {
    const { flow, views } = runFlow(seatedPressTrace({ reps: 10, leadInSec: 2.5 }), { target: 5 });
    expect(flow.stage).toBe("finished");
    expect(views[views.length - 1].count).toBe(5);
  });
});

describe("A9 tremor", () => {
  it("a tremor in the start position is never a rep", () => {
    const frames = seatedPressTrace({ reps: 0, leadInSec: 12, tremor: { amp: 0.012, hz: 5 } });
    const { views, count } = runFlow(frames);
    expect(views[views.length - 1].stage).toBe("calibrating");
    expect(views[views.length - 1].calReps).toBe(0);
    expect(count).toBe(0);
  });

  it("a tremor over full reps does not add or lose reps", () => {
    const calm = runFlow(seatedPressTrace({ reps: 8, leadInSec: 2.5 })).count;
    const shaky = runFlow(seatedPressTrace({ reps: 8, leadInSec: 2.5, tremor: { amp: 0.01, hz: 6 } })).count;
    expect(shaky).toBe(calm);
  });
});

describe("A9 framing flicker", () => {
  /** Every 4th frame the wrists blink below the visibility the framing needs. */
  const blink = (frames: Frame[]) =>
    frames.map((f, i) =>
      i % 4 === 0
        ? {
            ...f,
            lm: f.lm.map((p: Landmark, j) =>
              j === LM.l_wrist || j === LM.r_wrist ? { ...p, visibility: 0.3 } : p,
            ),
          }
        : f,
    );

  it("never flips the caption, and the set still counts", () => {
    const { captions, count, views } = runFlow(blink(seatedPressTrace({ reps: 8, leadInSec: 2.5 })));
    const changes = captions.filter((c, i) => i > 0 && c !== captions[i - 1]);
    expect(captions).not.toContain("get_in_frame");
    expect(captions).not.toContain("move_back");
    expect(changes.length).toBeLessThanOrEqual(4); // range ready, cues: each shown once, calmly
    expect(views.some((v) => v.stage === "framing" && v.frame.t > 3000)).toBe(false);
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it("a person who really steps out hears one calm hint, not a flicker", () => {
    const set = seatedPressTrace({ reps: 8, leadInSec: 2.5 });
    const gone = set.map((f) =>
      f.t > 9000 && f.t < 15_000
        ? {
            ...f,
            lm: f.lm.map((p: Landmark, j) =>
              j === LM.l_wrist || j === LM.r_wrist ? { ...p, visibility: 0.1 } : p,
            ),
          }
        : f,
    );
    const { captions } = runFlow(gone);
    const runs = captions.filter((c, i) => c === "get_in_frame" && captions[i - 1] !== "get_in_frame");
    expect(runs).toHaveLength(1);
  });
});

describe("A9 the start position gate", () => {
  it("calibration never starts while the arms rest down", () => {
    const { views } = runFlow(resting(20));
    expect(views.every((v) => v.stage === "framing" || v.stage === "start")).toBe(true);
    expect(views[views.length - 1].stage).toBe("start");
    expect(views[views.length - 1].startHold).toBe(0);
  });

  it("calibration never starts with the arms held overhead or straight out to the sides", () => {
    const overhead = seatedPressTrace({ reps: 1, leadInSec: 0, repSec: 40 }).slice(400, 900); // near the top
    expect(
      runFlow(overhead.map((f, i) => ({ ...f, t: i * 33 }))).views.every((v) => v.stage !== "calibrating"),
    ).toBe(true);
    // T pose: wrists at shoulder height, elbows straight
    const tPose = resting(15).map((f) => {
      const lm = f.lm.map((p) => ({ ...p }));
      const ls = lm[LM.l_shoulder];
      const rs = lm[LM.r_shoulder];
      lm[LM.l_elbow] = { ...lm[LM.l_elbow], x: ls.x - 0.13, y: ls.y };
      lm[LM.l_wrist] = { ...lm[LM.l_wrist], x: ls.x - 0.25, y: ls.y };
      lm[LM.r_elbow] = { ...lm[LM.r_elbow], x: rs.x + 0.13, y: rs.y };
      lm[LM.r_wrist] = { ...lm[LM.r_wrist], x: rs.x + 0.25, y: rs.y };
      return { ...f, lm };
    });
    expect(runFlow(tPose).views.every((v) => v.stage !== "calibrating")).toBe(true);
  });

  it("a weaker arm may rest down after a stroke; both arms resting still never start", () => {
    const set = seatedPressTrace({ reps: 6, leadInSec: 2.5, asymmetry: 1 });
    // the right arm stays down by the thigh
    const lap = resting(1)[0];
    const oneArm = set.map((f) => {
      const lm = f.lm.map((p) => ({ ...p }));
      lm[LM.r_elbow] = { ...lap.lm[LM.r_elbow] };
      lm[LM.r_wrist] = { ...lap.lm[LM.r_wrist] };
      return { ...f, lm };
    });
    const hemi = runFlow(oneArm, { profileId: "hemiparesis_right" });
    expect(hemi.firstAt("calibrating")).toBeGreaterThan(0);
    expect(hemi.count).toBeGreaterThanOrEqual(3);
    expect(runFlow(resting(10), { profileId: "hemiparesis_right" }).firstAt("calibrating")).toBe(-1);
  });

  it("a posture beyond the trunk cap never starts the calibration (S0 pre-set block)", () => {
    const { views, captions } = runFlow(
      seatedPressTrace({ reps: 0, leadInSec: 8, leanDeg: 27, leanFromRep: -1, leanHold: true }),
    );
    expect(views.some((v) => v.stage === "calibrating")).toBe(false);
    expect(captions).toContain("sit_upright_first");
  });
});
