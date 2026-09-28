/**
 * The orientation sensor gate of the camera tests and the motion_needed skip (O10, O33 (j), (l),
 * (6); revision 1.1 reasons.motion_needed; UX S34c and map 2.9).
 */
import { describe, expect, it } from "vitest";
import { MOTION_NEEDED, MOTION_RULES, MotionGateTracker } from "../src/engine/motion";
import { setupCheck } from "../src/engine/quality";

describe("motion gate", () => {
  it("passes a phone that sends readings, with its tilt for the 5 degree level gate", () => {
    const g = new MotionGateTracker();
    g.permission("not_needed", 0);
    expect(g.status(100).status).toBe("waiting");
    g.reading({ t: 120, beta: 90, gamma: 0 });
    const s = g.status(150);
    expect(s.status).toBe("ok");
    if (s.status === "ok") {
      expect(Math.abs(s.tilt.rollDeg)).toBeLessThan(1e-6);
      expect(Math.abs(s.tilt.pitchDeg)).toBeLessThan(1e-6);
    }
  });

  it("never starts camera tests on a device without an orientation reading (O10)", () => {
    const laptop = new MotionGateTracker();
    laptop.permission("not_needed", 0);
    laptop.reading({ t: 10, beta: null, gamma: null }); // desktop browsers send nulls
    expect(laptop.status(MOTION_RULES.firstReadingMs - 1).status).toBe("waiting");
    expect(laptop.status(MOTION_RULES.firstReadingMs).status).toBe("no_sensor");
    const nan = new MotionGateTracker();
    nan.permission("granted", 0);
    nan.reading({ t: 10, beta: Number.NaN, gamma: 3 });
    expect(nan.status(5000).status).toBe("no_sensor");
  });

  it("asks again at the phone when motion was refused, then skips with motion_needed, never quality", () => {
    const g = new MotionGateTracker();
    expect(g.status(0).status).toBe("ask"); // not asked yet
    g.permission("denied", 100);
    expect(g.status(200).status).toBe("ask");
    g.askedAgain(5000);
    expect(g.status(5100).status).toBe("waiting"); // the system prompt is open
    g.permission("denied", 7000);
    expect(g.status(7100).status).toBe(MOTION_NEEDED);
    expect(MOTION_NEEDED).toBe("motion_needed");
  });

  it("accepts motion allowed on the second ask, and skips when still no reading comes", () => {
    const allowed = new MotionGateTracker();
    allowed.permission("denied", 0);
    allowed.askedAgain(1000);
    allowed.permission("granted", 2000);
    expect(allowed.status(2500).status).toBe("waiting");
    allowed.reading({ t: 2600, beta: 88, gamma: 2 });
    expect(allowed.status(2700).status).toBe("ok");

    const silent = new MotionGateTracker();
    silent.permission("denied", 0);
    silent.askedAgain(1000);
    silent.permission("granted", 2000);
    expect(silent.status(2000 + MOTION_RULES.firstReadingMs).status).toBe("motion_needed");
  });

  it("feeds the setup check's level gate", () => {
    const g = new MotionGateTracker();
    g.permission("not_needed", 0);
    g.reading({ t: 5, beta: 80, gamma: 0 }); // tipped back 10 degrees
    const s = g.status(10);
    expect(s.status).toBe("ok");
    const tilt = s.status === "ok" ? s.tilt : null;
    const res = setupCheck(
      [],
      {
        testId: "shoulder_abduction",
        side: "right",
        framing: [],
        views: ["front"],
        distanceM: [2, 3],
        margin: 0.03,
        tiltMaxDeg: 5,
        tiltWarnDeg: null,
        armRoom: false,
      },
      { tilt },
    );
    expect(res.issues).toContain("tilt");
  });
});
