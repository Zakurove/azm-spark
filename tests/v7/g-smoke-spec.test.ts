/**
 * Step G1 (product v7 contract 8.4 and A6a-5): the smoke page's run options, read from its own URL
 * (src/features/smoke/spec.ts). /?e2eSmoke=<name> names the run; everything else comes from the
 * query, checked against the runtime data so a typo never runs the wrong movement.
 */
import { describe, expect, it } from "vitest";
import { parseSmokeSpec } from "../../src/features/smoke/spec";

const ok = (name: string, query: string) => {
  const r = parseSmokeSpec(name, query);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};
const error = (query: string) => {
  const r = parseSmokeSpec("run", query);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("a range run", () => {
  it("reads the movement, side and position, Full by default", () => {
    expect(
      ok("rom-shoulder-abduction-right", "?e2eSmoke=x&kind=rom&movement=shoulder_abduction&side=right"),
    ).toEqual({
      name: "rom-shoulder-abduction-right",
      kind: "rom",
      model: "full",
      frames: false,
      preloadMs: 3000,
      movement: "shoulder_abduction",
      side: "right",
      // The movement's first position when none is named.
      position: "seated",
      mirrored: false,
      timeoutSec: 150,
      traceSec: 30,
      answer: "yes",
    });
    // D-035: answer=none leaves the maximum question unanswered (its timeout is the answer).
    expect(ok("r", "kind=rom&movement=elbow_flexion&side=right&answer=none")).toMatchObject({
      answer: "none",
    });
    const s = ok(
      "r",
      "kind=rom&movement=knee_flexion&side=left&position=lying_back&model=lite&mirrored=1&frames=1",
    );
    expect(s).toMatchObject({ model: "lite", position: "lying_back", mirrored: true, frames: true });
    expect(
      ok("r", "kind=rom&movement=trunk_flexion&side=none&model=auto&timeoutSec=60&traceSec=20"),
    ).toMatchObject({
      side: "none",
      model: "auto",
      timeoutSec: 60,
      traceSec: 20,
    });
  });

  it("refuses what the data does not have", () => {
    expect(error("kind=rom&movement=shoulder_wave&side=right")).toContain("movement");
    expect(error("kind=rom&movement=shoulder_abduction&side=up")).toContain("side");
    // A limb movement needs its side; the position must be one of the movement's.
    expect(error("kind=rom&movement=shoulder_abduction&side=none")).toContain("side");
    expect(error("kind=rom&movement=shoulder_abduction&side=right&position=lying_back")).toContain(
      "position",
    );
    expect(error("kind=rom&movement=shoulder_abduction&side=right&model=heavy")).toContain("model");
    expect(error("kind=rom&movement=shoulder_abduction&side=right&timeoutSec=0")).toContain("timeoutSec");
    expect(error("kind=rom&movement=shoulder_abduction&side=right&preloadMs=-1")).toContain("preloadMs");
    expect(ok("r", "kind=rom&movement=shoulder_abduction&side=right&preloadMs=0").preloadMs).toBe(0);
    expect(error("movement=shoulder_abduction")).toContain("kind");
  });
});

describe("a gait run", () => {
  const pad =
    "kind=gait&view=pad_side&nearSide=right&mode=walking_pad&padKmh=3&heightCm=177.6&standFrom=0.5&standTo=3.5&walkFrom=5.2&walkTo=35.2";

  it("reads the view, the setup and the windows of the video", () => {
    expect(ok("gait-pad-side", pad)).toEqual({
      name: "gait-pad-side",
      kind: "gait",
      model: "full",
      frames: false,
      preloadMs: 3000,
      view: "pad_side",
      nearSide: "right",
      mode: "walking_pad",
      padKmh: 3,
      heightCm: 177.6,
      standFrom: 0.5,
      standTo: 3.5,
      walkFrom: 5.2,
      walkTo: 35.2,
    });
    expect(
      ok("g", "kind=gait&view=side&mode=overground&standFrom=0&standTo=3&walkFrom=4&walkTo=40"),
    ).toMatchObject({ nearSide: null, padKmh: null, heightCm: null });
  });

  it("refuses windows out of order, a pad view without its speed, and unknown views", () => {
    expect(error(pad.replace("standTo=3.5", "standTo=6"))).toContain("window");
    expect(error(pad.replace("walkTo=35.2", "walkTo=5"))).toContain("window");
    expect(error(pad.replace("&padKmh=3", ""))).toContain("padKmh");
    expect(error(pad.replace("mode=walking_pad", "mode=overground"))).toContain("mode");
    expect(error(pad.replace("view=pad_side", "view=top"))).toContain("view");
    expect(error(pad.replace("nearSide=right", "nearSide=up"))).toContain("nearSide");
  });
});
