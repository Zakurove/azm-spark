/**
 * The check in rules of the UX round council (decisions-ux-round, 2026-09-28): who can signal fine
 * and the cue (O34-1 (1), O34-2, O34-4 (3), O33 (f)), the fine zone geometry and its 2 s hold with
 * the entry and rest rules (O34-1 (2), (3)), the exclusions of every camera fine (O34-1 (4)), the
 * raised hand, the rehearsal (O34-1 (7)), the fall watch (O42) and the spoken phrase guard (O5).
 *
 * Poses are built in PIXELS on real frame sizes, then normalized like MediaPipe with the aspect set.
 */
import { describe, expect, it } from "vitest";
import {
  CameraFine,
  cameraFineBlocked,
  CHECKIN_CUE_SELECTION,
  CheckInDetector,
  checkInReference,
  FALL_WATCH,
  FallWatch,
  FINE_RULES,
  FinePractice,
  fineSignalConfig,
  fineZoneRef,
  FineZoneDetector,
  fineZoneSide,
  medianPose,
  noArmSignal,
  phraseCounts,
  raiseAllowed,
  RaisedHandDetector,
  selectCheckInCue,
  type ArmAnswers,
  type CheckInTrigger,
  type FineSignalConfig,
  type Rect,
} from "../src/engine/checkin";
import { Landmark, LM } from "../src/engine/types";
import { CHECK_DATA } from "../src/movements/assessments";

type P = { x: number; y: number };
const SIZES = [
  { name: "portrait", w: 720, h: 1280 },
  { name: "landscape", w: 1280, h: 720 },
  { name: "square", w: 720, h: 720 },
] as const;

interface Body {
  w: number;
  h: number;
  u: number;
  hip: P;
  sh: P;
  nose: P;
  /** person's left shoulder (image right in a front view) and right shoulder */
  lSh: P;
  rSh: P;
  lHip: P;
  rHip: P;
  /** hands resting on the lap */
  lRest: P;
  rRest: P;
}

/** A seated person facing the camera, in pixels. The person's left is on the image right. */
function body(w: number, h: number): Body {
  const u = Math.min(w, h) * 0.22;
  const hip = { x: w / 2, y: h / 2 + 0.5 * u };
  const sh = { x: hip.x, y: hip.y - u };
  return {
    w,
    h,
    u,
    hip,
    sh,
    nose: { x: sh.x, y: sh.y - 0.45 * u },
    lSh: { x: sh.x + 0.4 * u, y: sh.y },
    rSh: { x: sh.x - 0.4 * u, y: sh.y },
    lHip: { x: hip.x + 0.3 * u, y: hip.y },
    rHip: { x: hip.x - 0.3 * u, y: hip.y },
    lRest: { x: hip.x + 0.35 * u, y: hip.y - 0.05 * u },
    rRest: { x: hip.x - 0.35 * u, y: hip.y - 0.05 * u },
  };
}

interface PoseOpts {
  lw?: P;
  rw?: P;
  /** hips and everything above them move down this many pixels (a slide or fall) */
  drop?: number;
  /** degrees the upper body turns sideways about the hips */
  lean?: number;
  /** landmark visibility overrides */
  hide?: number[];
  /** shift everything sideways (pixels) */
  dx?: number;
}

/** Normalized landmarks of the body with the given wrists. */
function pose(b: Body, o: PoseOpts = {}): Landmark[] {
  const drop = o.drop ?? 0;
  const dx = o.dx ?? 0;
  const lean = ((o.lean ?? 0) * Math.PI) / 180;
  const turn = (q: P): P => {
    const vx = q.x - b.hip.x;
    const vy = q.y - b.hip.y;
    return {
      x: b.hip.x + vx * Math.cos(lean) - vy * Math.sin(lean) + dx,
      y: b.hip.y + vx * Math.sin(lean) + vy * Math.cos(lean) + drop,
    };
  };
  const moved = (q: P): P => ({ x: q.x + dx, y: q.y + drop });
  const lw = o.lw ?? b.lRest;
  const rw = o.rw ?? b.rRest;
  const elbow = (s: P, wr: P): P => ({
    x: (s.x + wr.x) / 2 + (wr.x > s.x ? 0.1 : -0.1) * b.u,
    y: (s.y + wr.y) / 2,
  });
  const pts = new Map<number, P>([
    [LM.nose, turn(b.nose)],
    [LM.l_shoulder, turn(b.lSh)],
    [LM.r_shoulder, turn(b.rSh)],
    [LM.l_hip, moved(b.lHip)],
    [LM.r_hip, moved(b.rHip)],
    [LM.l_elbow, turn(elbow(b.lSh, lw))],
    [LM.r_elbow, turn(elbow(b.rSh, rw))],
    [LM.l_wrist, moved(lw)],
    [LM.r_wrist, moved(rw)],
    [LM.l_knee, moved({ x: b.hip.x + 0.3 * b.u, y: b.hip.y + 0.6 * b.u })],
    [LM.r_knee, moved({ x: b.hip.x - 0.3 * b.u, y: b.hip.y + 0.6 * b.u })],
  ]);
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [i, p] of pts) lm[i] = { x: p.x / b.w, y: p.y / b.h, z: 0, visibility: 0.95 };
  for (const i of o.hide ?? []) lm[i] = { ...lm[i], visibility: 0.1 };
  return lm;
}

/** Zone rect back in pixels, for readable expectations. */
const px = (r: Rect, b: Body) => ({ x0: r.x0 * b.h, x1: r.x1 * b.h, y0: r.y0 * b.h, y1: r.y1 * b.h });
/** Centre of a zone, in pixels. */
const centre = (r: Rect, b: Body): P => ({ x: ((r.x0 + r.x1) / 2) * b.h, y: ((r.y0 + r.y1) / 2) * b.h });

const HOME: Omit<FineSignalConfig, "fineZoneSide"> & { fineZoneSide: "right" } = {
  setting: "home",
  fineZone: true,
  fineZoneSide: "right",
  zoneHoldSec: 2,
  raiseAllowed: true,
  noArmSignal: false,
  speech: false,
  limbLossArm: null,
};
const CLEAR = { hipsDrop: false, swayOut: false };

describe("who can signal fine, and the cue", () => {
  it("fineZoneSide is the stronger arm; on a tie, the right", () => {
    expect(fineZoneSide({})).toBe("right");
    expect(fineZoneSide({ weaker: "right" })).toBe("left");
    expect(fineZoneSide({ weaker: "left" })).toBe("right");
    expect(fineZoneSide({ limbLossArm: "right" })).toBe("left");
    expect(fineZoneSide({ painSides: ["right"] })).toBe("left");
    expect(fineZoneSide({ painSides: ["both"] })).toBe("right");
    expect(fineZoneSide({ armFunction: { right: "no_bend", left: "bend_no_hold" } })).toBe("left");
    expect(fineZoneSide({ armFunction: { right: "bend_hold", left: "bend_hold" } })).toBe("right");
    expect(fineZoneSide({ limbLossArm: "left", weaker: "right" })).toBe("right");
    expect(fineZoneSide({ weaker: "left", painSides: ["right"] })).toBe("right");
  });

  it("raiseAllowed follows O34-4 (3)", () => {
    expect(raiseAllowed({})).toBe(true);
    expect(raiseAllowed({ noOverhead: true })).toBe(false);
    expect(raiseAllowed({ weaker: "left", weakShoulder: "yes" })).toBe(true); // the right arm is free
    expect(raiseAllowed({ weaker: "left", weakLift: "no", limbLossArm: "right" })).toBe(false);
    expect(raiseAllowed({ weaker: "left", weakShoulder: "yes", limbLossArm: "right" })).toBe(false);
    expect(raiseAllowed({ armFunction: { left: "no_bend", right: "no_bend" } })).toBe(false);
    expect(raiseAllowed({ armFunction: { left: "no_bend", right: "bend_no_hold" } })).toBe(true);
  });

  it("noArmSignal needs each arm unable (O34-2 (1)); a weak shoulder alone does not count", () => {
    expect(noArmSignal({})).toBe(false);
    expect(noArmSignal({ weaker: "left", weakLift: "no" })).toBe(false);
    expect(noArmSignal({ weaker: "left", weakLift: "no", limbLossArm: "right" })).toBe(true);
    expect(noArmSignal({ armFunction: { left: "no_bend", right: "no_bend" } })).toBe(true);
    expect(noArmSignal({ weaker: "left", weakShoulder: "yes", limbLossArm: "right" })).toBe(false);
  });

  it("the fine zone is on at home with answer zones only, never at the booth", () => {
    const a: ArmAnswers = { weaker: "left" };
    expect(fineSignalConfig(a, { setting: "home", answerZones: true, speech: false })).toMatchObject({
      fineZone: true,
      fineZoneSide: "right",
      zoneHoldSec: 2,
    });
    expect(fineSignalConfig(a, { setting: "booth", answerZones: true, speech: true })).toMatchObject({
      fineZone: false,
      speech: false,
    });
    expect(fineSignalConfig(a, { setting: "home", answerZones: false, speech: false }).fineZone).toBe(false);
    expect(
      fineSignalConfig(a, { setting: "home", answerZones: true, speech: false, rehearsalFailed: true }),
    ).toMatchObject({ fineZone: false, noArmSignal: true });
  });

  it("selects the cue by setting, raiseAllowed, noArmSignal, speech and the fall watch", () => {
    const pick = (setting: "booth" | "home", raise: boolean, noArm: boolean, speech: boolean, fall = false) =>
      selectCheckInCue({ setting, raiseAllowed: raise, noArmSignal: noArm, speech }, fall);
    expect(pick("booth", true, false, false)).toBe("check_are_you_ok");
    expect(pick("booth", false, false, false)).toBe("check_are_you_ok_noraise");
    expect(pick("booth", true, false, true)).toBe("check_are_you_ok"); // speech is off at the booth
    expect(pick("home", true, false, false)).toBe("check_are_you_ok_zone");
    expect(pick("home", false, false, true)).toBe("check_are_you_ok_zone_speech");
    expect(pick("home", true, true, true)).toBe("check_are_you_ok_helper");
    expect(pick("home", true, false, false, true)).toBe("check_are_you_ok_fall");
    expect(pick("home", true, false, true, true)).toBe("check_are_you_ok_fall_speech");
    expect(pick("home", false, false, false, true)).toBe("check_are_you_ok_fall_noraise");
    expect(pick("home", true, true, true, true)).toBe("check_are_you_ok_fall_noraise_speech");
  });

  it("never asks a person who must not raise a hand to raise one, and never names our team at home", () => {
    // Checked against the cue texts wherever the check data carries them (revision 1.1).
    const cues = new Map(CHECK_DATA.cues.map((c) => [c.id as string, c]));
    const data = (CHECK_DATA.stopRouting.checkIn as unknown as { cueSelection?: unknown }).cueSelection;
    if (data) expect(data).toMatchObject(CHECKIN_CUE_SELECTION);
    for (const setting of ["booth", "home"] as const)
      for (const raise of [true, false])
        for (const noArm of [true, false])
          for (const speech of [true, false])
            for (const fall of setting === "home" ? [true, false] : [false]) {
              const id = selectCheckInCue({ setting, raiseAllowed: raise, noArmSignal: noArm, speech }, fall);
              const c = cues.get(id);
              if (!c) continue;
              if (!raise || (setting === "home" && noArm)) {
                expect(c.ar, id).not.toMatch(/ارفع/);
                expect(c.en, id).not.toMatch(/raise/i);
              }
              if (setting === "home") {
                expect(c.ar, id).not.toMatch(/فريقنا/);
                expect(c.en, id).not.toMatch(/our team/i);
              }
            }
  });
});

describe("the fine zone geometry (O34-1 (2))", () => {
  for (const { name, w, h } of SIZES) {
    it(`${name}: chin to mid chest, lateral of the shoulder and outside the torso, 0.8 shoulder widths`, () => {
      const b = body(w, h);
      const ref = fineZoneRef(pose(b), w / h, "right")!;
      const z = px(ref.zone, b);
      const sw = 0.8 * b.u;
      expect(z.y0).toBeCloseTo((b.nose.y + b.sh.y) / 2, 6); // chin height
      expect(z.y1).toBeCloseTo(b.sh.y + (b.hip.y - b.sh.y) / 2, 6); // mid chest
      // The right shoulder is on the image left: the zone is further left.
      expect(z.x1).toBeCloseTo(b.rSh.x - 0.25 * sw, 6);
      expect(z.x1).toBeLessThan(b.rHip.x);
      expect(z.x1 - z.x0).toBeCloseTo(0.8 * sw, 6);
      expect(z.y0).toBeGreaterThan(b.nose.y); // nothing above the head
      expect(ref.shoulderWidth * h).toBeCloseTo(sw, 6);

      const left = px(fineZoneRef(pose(b), w / h, "left")!.zone, b);
      expect(left.x0).toBeCloseTo(b.lSh.x + 0.25 * sw, 6);
      expect(left.x1 - left.x0).toBeCloseTo(0.8 * sw, 6);
    });
  }

  it("the bench check may move the inner edge outward, never inward", () => {
    const b = body(720, 1280);
    const sw = 0.8 * b.u;
    const out = px(fineZoneRef(pose(b), 720 / 1280, "right", { innerSw: 0.4 })!.zone, b);
    expect(out.x1).toBeCloseTo(b.rSh.x - 0.4 * sw, 6);
    const inward = px(fineZoneRef(pose(b), 720 / 1280, "right", { innerSw: 0.1 })!.zone, b);
    expect(inward.x1).toBeCloseTo(b.rSh.x - 0.25 * sw, 6);
  });

  it("stays outside wide hips, and is clipped to the arm's calibrated reach", () => {
    const b = body(720, 1280);
    const wide = { ...b, rHip: { x: b.rSh.x - 0.3 * b.u, y: b.hip.y } };
    expect(px(fineZoneRef(pose(wide), 720 / 1280, "right")!.zone, b).x1).toBeCloseTo(wide.rHip.x, 6);
    // A short arm (wrist close to the shoulder at calibration) cuts the outer edge.
    const short = pose(b, { rw: { x: b.rSh.x - 0.1 * b.u, y: b.rSh.y + 0.3 * b.u } });
    const ref = fineZoneRef(short, 720 / 1280, "right")!;
    const arm =
      Math.hypot(
        short[LM.r_shoulder].x * 720 - short[LM.r_elbow].x * 720,
        (short[LM.r_shoulder].y - short[LM.r_elbow].y) * 1280,
      ) +
      Math.hypot(
        short[LM.r_elbow].x * 720 - short[LM.r_wrist].x * 720,
        (short[LM.r_elbow].y - short[LM.r_wrist].y) * 1280,
      );
    expect(px(ref.zone, b).x0).toBeCloseTo(b.rSh.x - arm, 4);
  });

  it("has no zone without the nose or the shoulders, or for nobody", () => {
    const b = body(720, 1280);
    expect(fineZoneRef(pose(b, { hide: [LM.nose] }), 720 / 1280, "right")).toBeNull();
    expect(fineZoneRef(pose(b, { hide: [LM.r_shoulder] }), 720 / 1280, "right")).toBeNull();
    expect(
      fineZoneRef(
        Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
        1,
        "right",
      ),
    ).toBeNull();
  });

  it("takes the median pose of the calibration window", () => {
    const b = body(720, 1280);
    const poses = [pose(b, { dx: -10 }), pose(b), pose(b, { dx: 40 })];
    const m = medianPose(poses);
    expect(m[LM.nose].x).toBeCloseTo(pose(b)[LM.nose].x, 9);
  });
});

/** Feeds a wrist path (pixels) to a zone detector at 30 fps and returns the first time it held. */
function holdTime(
  d: FineZoneDetector,
  b: Body,
  path: (t: number) => { rw?: P; lw?: P; hide?: number[] },
  fromMs: number,
  toMs: number,
): number | null {
  for (let t = fromMs; t <= toMs; t += 33) if (d.feed(t, pose(b, path(t)), b.w / b.h)) return t;
  return null;
}

describe("the fine zone hold (O34-1 (3))", () => {
  for (const { name, w, h } of SIZES) {
    it(`${name}: counts a wrist entering from outside and held 2 s`, () => {
      const b = body(w, h);
      const ref = fineZoneRef(pose(b), w / h, "right")!;
      const d = new FineZoneDetector(ref);
      d.arm();
      const c = centre(ref.zone, b);
      const at = holdTime(d, b, (t) => ({ rw: t < 1000 ? b.rRest : c }), 0, 6000)!;
      expect(at).toBeGreaterThanOrEqual(1000 + 2000);
      expect(at).toBeLessThan(1000 + 2100);
    });
  }

  it("ignores a hand held before the cue, and one already in the zone when the sheet opens", () => {
    const b = body(720, 1280);
    const ref = fineZoneRef(pose(b), 720 / 1280, "right")!;
    const c = centre(ref.zone, b);
    const d = new FineZoneDetector(ref);
    expect(holdTime(d, b, () => ({ rw: c }), 0, 3000)).toBeNull(); // not armed
    d.arm();
    expect(holdTime(d, b, () => ({ rw: c }), 3000, 9000)).toBeNull(); // in the zone from the start
    // Out, then back in: now it counts.
    expect(holdTime(d, b, (t) => ({ rw: t < 9500 ? b.rRest : c }), 9000, 14000)).toBeGreaterThanOrEqual(
      11_500,
    );
  });

  it("ignores a wrist at its calibration rest position plus 0.3 shoulder widths", () => {
    const b = body(720, 1280);
    const ref = fineZoneRef(pose(b), 720 / 1280, "right")!;
    const c = centre(ref.zone, b);
    // This person rests the hand on an armrest inside the zone.
    const restingRef = { ...ref, rest: { ...ref.rest, right: { x: c.x / b.h, y: c.y / b.h } } };
    const d = new FineZoneDetector(restingRef);
    d.arm();
    const near = { x: c.x + 0.2 * 0.8 * b.u, y: c.y };
    expect(holdTime(d, b, (t) => ({ rw: t < 500 ? b.rRest : near }), 0, 6000)).toBeNull();
  });

  it("ignores a hand drifting through the zone (jitter over 15% of shoulder width)", () => {
    const b = body(720, 1280);
    const ref = fineZoneRef(pose(b), 720 / 1280, "right")!;
    const z = px(ref.zone, b);
    const d = new FineZoneDetector(ref);
    d.arm();
    const cy = (z.y0 + z.y1) / 2;
    // Moves slowly across the zone width over 3 s.
    const drift = (t: number) => ({
      rw: t < 500 ? b.rRest : { x: z.x1 - ((z.x1 - z.x0) * (t - 500)) / 3000, y: cy },
    });
    expect(holdTime(d, b, drift, 0, 3400)).toBeNull();
    // A small tremor within 15% is still a hold.
    const d2 = new FineZoneDetector(ref);
    d2.arm();
    const c = centre(ref.zone, b);
    const tremor = (t: number) => ({
      rw: t < 500 ? b.rRest : { x: c.x + 0.05 * 0.8 * b.u * Math.sin(t / 50), y: c.y },
    });
    expect(holdTime(d2, b, tremor, 0, 4000)).not.toBeNull();
  });

  it("reads only the fine side's wrist: the other hand crossing the body does not count", () => {
    const b = body(720, 1280);
    const ref = fineZoneRef(pose(b), 720 / 1280, "right")!;
    const d = new FineZoneDetector(ref);
    d.arm();
    const c = centre(ref.zone, b);
    expect(holdTime(d, b, (t) => ({ lw: t < 500 ? b.lRest : c }), 0, 5000)).toBeNull();
  });

  it("keeps a hold through a short gap in the wrist, and needs a new entry after a long one", () => {
    const b = body(720, 1280);
    const ref = fineZoneRef(pose(b), 720 / 1280, "right")!;
    const c = centre(ref.zone, b);
    const d = new FineZoneDetector(ref);
    d.arm();
    const short = (t: number) => ({
      rw: t < 500 ? b.rRest : c,
      hide: t > 1500 && t < 1700 ? [LM.r_wrist] : [],
    });
    expect(holdTime(d, b, short, 0, 5000)).not.toBeNull();
    const d2 = new FineZoneDetector(ref);
    d2.arm();
    const long = (t: number) => ({
      rw: t < 500 ? b.rRest : c,
      hide: t > 1500 && t < 2500 ? [LM.r_wrist] : [],
    });
    expect(holdTime(d2, b, long, 0, 6000)).toBeNull();
  });
});

describe("every camera fine is refused while (O34-1 (4))", () => {
  const b = body(720, 1280);
  const a = 720 / 1280;
  const ref = fineZoneRef(pose(b), a, "right")!;
  const c = centre(ref.zone, b);
  const chest = { x: b.sh.x + 0.1 * b.u, y: b.sh.y + 0.3 * b.u };

  it("the other hand is at the chest (within 0.5 shoulder widths of the sternum)", () => {
    expect(cameraFineBlocked(pose(b, { rw: c, lw: chest }), a, "right", CLEAR)).toBe("other_hand_chest");
    expect(cameraFineBlocked(pose(b, { rw: c }), a, "right", CLEAR)).toBeNull();
    // Just beyond 0.5 shoulder widths from the sternum line.
    const beside = { x: b.sh.x + 0.5 * 0.8 * b.u + 2, y: b.sh.y + 0.2 * b.u };
    expect(cameraFineBlocked(pose(b, { rw: c, lw: beside }), a, "right", CLEAR)).toBeNull();
    // An unseen other wrist may be at the chest; not when that arm is a limb loss side.
    expect(cameraFineBlocked(pose(b, { rw: c, hide: [LM.l_wrist] }), a, "right", CLEAR)).toBe(
      "other_hand_chest",
    );
    expect(
      cameraFineBlocked(pose(b, { rw: c, hide: [LM.l_wrist] }), a, "right", {
        ...CLEAR,
        limbLossArm: "left",
      }),
    ).toBeNull();
  });

  it("both wrists are in zones, the hips drop is active, or the trunk is outside the sway limit", () => {
    const other: Rect = { x0: 0.5, y0: 0.4, x1: 0.62, y1: 0.55 };
    const lw = { x: 0.56 * b.h, y: 0.47 * b.h };
    expect(
      cameraFineBlocked(pose(b, { rw: c, lw }), a, "right", { ...CLEAR, zones: [ref.zone, other] }),
    ).toBe("both_in_zones");
    expect(cameraFineBlocked(pose(b, { rw: c }), a, "right", { hipsDrop: true, swayOut: false })).toBe(
      "hips_drop",
    );
    expect(cameraFineBlocked(pose(b, { rw: c }), a, "right", { hipsDrop: false, swayOut: true })).toBe(
      "sway",
    );
  });

  it("applies to the zone and to the raised hand alike, and the fine then counts once clear", () => {
    const cf = new CameraFine(HOME, ref);
    expect(cf.hasZone).toBe(true);
    cf.arm();
    let got: string | null = null;
    for (let t = 0; t <= 4000 && !got; t += 33) {
      got = cf.feed(t, pose(b, { rw: t < 500 ? b.rRest : c, lw: chest }), a, CLEAR);
    }
    expect(got).toBeNull();
    expect(cf.lastBlock).toBe("other_hand_chest");
    for (let t = 4033; t <= 4500 && !got; t += 33) got = cf.feed(t, pose(b, { rw: c }), a, CLEAR);
    expect(got).toBe("zone");

    // The raised hand, with the hips dropping.
    const raise = new CameraFine({ ...HOME, fineZone: false, setting: "booth" }, null);
    expect(raise.hasZone).toBe(false);
    raise.arm();
    const up = { x: b.rSh.x - 0.1 * b.u, y: b.rSh.y - 0.6 * b.u };
    let hand: string | null = null;
    for (let t = 0; t <= 3000 && !hand; t += 33)
      hand = raise.feed(t, pose(b, { rw: t < 300 ? b.rRest : up }), a, { hipsDrop: true, swayOut: false });
    expect(hand).toBeNull();
    expect(raise.lastBlock).toBe("hips_drop");
    hand = raise.feed(3033, pose(b, { rw: up }), a, CLEAR);
    expect(hand).toBe("raised_hand");
  });

  it("the check in detector reports the hips drop and sway blockers of the frame", () => {
    const d = new CheckInDetector();
    d.setReference(checkInReference(pose(b), a));
    d.feed(0, pose(b), a);
    expect(d.fineBlockers()).toEqual({ hipsDrop: false, swayOut: false });
    d.feed(33, pose(b, { drop: 0.5 * b.u }), a);
    expect(d.fineBlockers().hipsDrop).toBe(true);
    d.feed(66, pose(b, { lean: 30 }), a);
    expect(d.fineBlockers()).toEqual({ hipsDrop: false, swayOut: true });
  });
});

describe("the raised hand (the council's, from anyone)", () => {
  const b = body(720, 1280);
  const up = { x: b.rSh.x - 0.1 * b.u, y: b.rSh.y - 0.6 * b.u };

  it("needs the hand to come up after the check in opens", () => {
    const d = new RaisedHandDetector();
    let at: number | null = null;
    for (let t = 0; t <= 3000 && at === null; t += 33) if (d.feed(t, pose(b, { rw: up }))) at = t;
    expect(at).toBeNull(); // already up when the check in opened (an arm raise attempt)
    for (let t = 3033; t <= 3300; t += 33) d.feed(t, pose(b));
    for (let t = 3333; t <= 5000 && at === null; t += 33) if (d.feed(t, pose(b, { rw: up }))) at = t;
    expect(at! - 3333).toBeGreaterThanOrEqual(1000);
    expect(d.side).toBe("right");
    // The old behaviour, on request.
    const loose = new RaisedHandDetector(false);
    let any = false;
    for (let t = 0; t <= 1100; t += 33) any = loose.feed(t, pose(b, { rw: up })) || any;
    expect(any).toBe(true);
  });
});

describe("the left frame arming option", () => {
  it("does not raise left_frame when the state has it off", () => {
    const d = new CheckInDetector();
    const out: CheckInTrigger[] = [];
    for (let t = 0; t <= 2000; t += 100) out.push(...d.feed(t, null, 1, { leftFrame: false }));
    expect(out).toEqual([]);
    for (let t = 2100; t <= 3500; t += 100) out.push(...d.feed(t, null, 1));
    expect(out).toEqual(["left_frame"]);
  });
});

describe("the fine rehearsal (O34-1 (7))", () => {
  it("plays the cue, says it saw the hand, or repeats at 15 s and gives up at 30 s", () => {
    const ok = new FinePractice();
    expect(ok.start(0)).toEqual([{ kind: "cue", cue: "check_fine_practice", t: 0 }]);
    expect(ok.feed(5000, false)).toEqual([]);
    expect(ok.feed(6000, true)).toEqual([{ kind: "seen", t: 6000 }]);
    expect(ok.done).toBe(true);
    expect(ok.feed(7000, true)).toEqual([]);

    const fail = new FinePractice();
    fail.start(0);
    expect(fail.feed(14_999, false)).toEqual([]);
    expect(fail.feed(15_000, false)).toEqual([{ kind: "cue", cue: "check_fine_practice", t: 15_000 }]);
    expect(fail.feed(20_000, false)).toEqual([]);
    expect(fail.feed(30_000, false)).toEqual([{ kind: "no_signal", t: 30_000 }]);
    expect(fail.done).toBe(true);
    expect(FINE_RULES.practiceRepeatSec).toBe(15);
  });
});

describe("the fall watch at home (O42)", () => {
  const b = body(720, 1280);
  const a = 720 / 1280;
  const seated = checkInReference(pose(b), a);
  const onFloor = (t: number) => pose(b, { drop: 1.2 * b.u, dx: 3 * Math.sin(t / 3000) });
  const run = (w: FallWatch, from: number, to: number, lm: (t: number) => Landmark[] | null, step = 250) => {
    const out = [];
    for (let t = from; t <= to; t += step) out.push(...w.feed(t, lm(t), a));
    return out;
  };

  it("runs the check in after 60 s still while in view, counted from the last spoken line", () => {
    const w = new FallWatch("home", seated);
    w.start(0);
    w.spoke(10_000);
    const ev = run(w, 0, 75_000, (t) => onFloor(t));
    const still = ev.filter((e) => e.kind === "checkin" && e.trigger === "fall_still");
    expect(still).toHaveLength(1);
    expect(still[0].t).toBeGreaterThanOrEqual(70_000);
    expect(still[0].t).toBeLessThan(71_000);
    expect(FALL_WATCH.stillSec).toBe(60);
  });

  it("out of view never starts it, and moving resets it", () => {
    const away = new FallWatch("home", seated);
    away.start(0);
    expect(
      run(away, 0, 120_000, () => null).filter((e) => e.kind === "checkin" && e.trigger === "fall_still"),
    ).toEqual([]);
    const moving = new FallWatch("home", seated);
    moving.start(0);
    const wave = (t: number) =>
      pose(b, {
        drop: 1.2 * b.u,
        rw: { x: b.rRest.x - 0.4 * b.u * Math.abs(Math.sin(t / 2000)), y: b.rRest.y },
      });
    expect(
      run(moving, 0, 170_000, wave).filter((e) => e.kind === "checkin" && e.trigger === "fall_still"),
    ).toEqual([]);
  });

  it("runs the check in at 3 minutes when never seen seated or standing and no touch", () => {
    const w = new FallWatch("home", seated);
    w.start(0);
    const moving = (t: number) =>
      pose(b, {
        drop: 1.2 * b.u,
        rw: { x: b.rRest.x - 0.4 * b.u * Math.abs(Math.sin(t / 2000)), y: b.rRest.y },
      });
    const ev = run(w, 0, 200_000, moving);
    expect(ev.filter((e) => e.kind === "checkin").map((e) => (e as { trigger: string }).trigger)).toEqual([
      "fall_timer",
    ]);

    const touched = new FallWatch("home", seated);
    touched.start(0);
    touched.touched();
    expect(run(touched, 0, 200_000, moving).filter((e) => e.kind === "checkin")).toEqual([]);

    const sat = new FallWatch("home", seated);
    sat.start(0);
    const back = (t: number) =>
      t < 20_000
        ? moving(t)
        : pose(b, { rw: { x: b.rRest.x - 0.4 * b.u * Math.abs(Math.sin(t / 2000)), y: b.rRest.y } });
    expect(run(sat, 0, 200_000, back).filter((e) => e.kind === "checkin")).toEqual([]);
  });

  it("arms the hips drop only after 3 s seated again (a new collapse)", () => {
    const w = new FallWatch("home", seated);
    w.start(0);
    // On the floor from the start: no hips drop.
    expect(run(w, 0, 20_000, (t) => onFloor(t), 100).filter((e) => e.kind === "checkin")).toEqual([]);
    // Back on the chair for 3 s, then down again.
    const ev = run(w, 20_100, 40_000, (t) => (t < 30_000 ? pose(b) : onFloor(t)), 100);
    const drops = ev.filter((e) => e.kind === "checkin" && e.trigger === "hips_drop");
    expect(drops).toHaveLength(1);
    expect(drops[0].t).toBeGreaterThanOrEqual(30_000);
  });

  it("stops at 5 minutes, on 997, a moved phone, leaving S39 or a fine; never runs at the booth", () => {
    const w = new FallWatch("home", seated);
    w.start(0);
    expect(w.active).toBe(true);
    const ev = run(w, 0, 301_000, () => pose(b), 1000);
    expect(ev.at(-1)).toEqual({ kind: "end", reason: "timeout", t: 300_000 });
    expect(w.active).toBe(false);
    for (const reason of ["fine", "call", "phone_moved", "left_screen"] as const) {
      const s = new FallWatch("home", seated);
      s.start(0);
      expect(s.stop(reason, 5000)).toEqual({ kind: "end", reason, t: 5000 });
      expect(s.feed(6000, onFloor(6000), a)).toEqual([]);
    }
    const booth = new FallWatch("booth", seated);
    booth.start(0);
    expect(booth.active).toBe(false);
    expect(run(booth, 0, 200_000, (t) => onFloor(t), 1000)).toEqual([]);
  });
});

describe("the spoken fine phrase (O5)", () => {
  it("is discarded while app audio plays and for 0.5 s after it", () => {
    const audio = [{ start: 1000, end: 3000 }];
    expect(phraseCounts({ start: 500, end: 900 }, audio)).toBe(true);
    expect(phraseCounts({ start: 2500, end: 3200 }, audio)).toBe(false);
    expect(phraseCounts({ start: 3300, end: 3800 }, audio)).toBe(false);
    expect(phraseCounts({ start: 3600, end: 4000 }, audio)).toBe(true);
    expect(phraseCounts({ start: 9000, end: 9500 }, [{ start: 8000, end: null }])).toBe(false);
  });
});
