/**
 * S57 booth tools (UX spec S57, council O15, Q19 (4)): where the idle reset may run, its timer, the
 * staff shortcut, the staff count, and starting for the next visitor (the flow clears the visit, booth
 * mode stays, no stop is logged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNT_RANGE,
  IDLE_COUNTDOWN_MS,
  IDLE_OTHER_MS,
  IDLE_RESULTS_MS,
  idleStep,
  idleWaitMs,
  isStaffShortcut,
  parseStaffCount,
  reloadWaits,
  secondsLeft,
  type IdlePhase,
} from "../src/features/assessment/booth/tools";
import {
  initialModel,
  type FlowEvent,
  type FlowModel,
  type FlowState,
  type Overlay,
} from "../src/features/assessment/flowMachine";
import { guestAfterSteps, memoryStorage, precheckUntil, step } from "./booth-helpers";

const guest = (state: FlowState, overlay: Overlay | null = null): FlowModel => ({
  ...initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false }),
  state,
  overlay,
});

describe("where the idle reset may run (S57, O15)", () => {
  it("asks after 3 minutes on the guest results (S50) and 5 minutes on the screens before the camera", () => {
    expect(idleWaitMs(guest({ kind: "results" }))).toBe(IDLE_RESULTS_MS);
    expect(IDLE_RESULTS_MS).toBe(180_000);
    expect(IDLE_OTHER_MS).toBe(300_000);
    for (const s of [
      { kind: "guestWelcome" },
      { kind: "adultGate" },
      { kind: "guestSetup", step: 3 },
      { kind: "guestStaff" },
      { kind: "intro" },
      { kind: "soundCheck" },
      { kind: "precheckNotice" },
      { kind: "question", id: "pc_urgent" },
      { kind: "warnings" },
      { kind: "plan" },
      { kind: "test.instruction", i: 0 },
      { kind: "test.primer", i: 0 },
      { kind: "skipNotice", rows: [], then: { to: "endQuestion" } },
      { kind: "guestAfterTest", next: 1 },
    ] as FlowState[])
      expect(idleWaitMs(guest(s)), s.kind).toBe(IDLE_OTHER_MS);
  });

  it("never runs on camera, check in, alarm, stop list, safety, postponed, paused or end question", () => {
    const never: FlowState[] = [
      { kind: "cam.setup", i: 0, side: 0 },
      { kind: "cam.measure", i: 0, side: 0 },
      { kind: "cam.rest", i: 0, side: 0, purpose: "attempt" },
      { kind: "test.practiceCheck", i: 0, side: 0 },
      { kind: "after.count", i: 0, side: 0 },
      { kind: "between", i: 0, side: 0, scope: "test", via: "test" },
      { kind: "safety", safety: "emergency", screen: "scr_emergency", alsoShow: [], faintAnswered: false },
      { kind: "faintAsk" },
      { kind: "postponed", reason: "unwell", screen: null, alsoShow: [] },
      { kind: "paused", until: null, releasable: false },
      { kind: "stopDone", i: 0, restSec: 60, reason: "tired" },
      { kind: "endQuestion" },
      { kind: "cam.problem", problem: "denied", returnTo: { kind: "test.primer", i: 0 } },
      { kind: "desktopGate" },
    ];
    for (const s of never) expect(idleWaitMs(guest(s)), s.kind).toBeNull();
    for (const o of [
      { kind: "stopList", takeYourTime: false },
      { kind: "checkIn", from: "test", trigger: "no_movement" },
      { kind: "goOn", afterAlarm: false, canRedo: true },
      { kind: "alarm", from: "test" },
    ] as Overlay[])
      expect(idleWaitMs(guest({ kind: "test.instruction", i: 0 }, o)), o.kind).toBeNull();
  });

  it("only for the guest check in booth mode (never at home, never on a visitor's own signed in phone)", () => {
    const home = { ...guest({ kind: "results" }) };
    home.data = { ...home.data, config: { ...home.data.config, booth: false } };
    expect(idleWaitMs(home)).toBeNull();
    const signedIn = { ...guest({ kind: "results" }) };
    signedIn.data = { ...signedIn.data, config: { ...signedIn.data.config, mode: "signedIn" } };
    expect(idleWaitMs(signedIn)).toBeNull();
  });
});

describe("the idle timer", () => {
  const watching: IdlePhase = { kind: "watching", since: 0 };

  it("asks when the wait has passed with no activity, then resets when the 30 s run out", () => {
    let p = idleStep(watching, { now: IDLE_OTHER_MS - 1000, last: 0, waitMs: IDLE_OTHER_MS });
    expect(p.kind).toBe("watching");
    p = idleStep(p, { now: IDLE_OTHER_MS, last: 0, waitMs: IDLE_OTHER_MS });
    expect(p).toEqual({ kind: "asking", deadline: IDLE_OTHER_MS + IDLE_COUNTDOWN_MS });
    expect(secondsLeft((p as { deadline: number }).deadline, IDLE_OTHER_MS)).toBe(30);
    expect(secondsLeft((p as { deadline: number }).deadline, IDLE_OTHER_MS + 29_001)).toBe(1);
    p = idleStep(p, { now: IDLE_OTHER_MS + 29_999, last: 0, waitMs: IDLE_OTHER_MS });
    expect(p.kind).toBe("asking");
    p = idleStep(p, { now: IDLE_OTHER_MS + 30_000, last: 0, waitMs: IDLE_OTHER_MS });
    expect(p).toEqual({ kind: "reset" });
    expect(secondsLeft(0, 5000)).toBe(0);
  });

  it("counts from the last touch, and a person seen by the camera keeps it awake", () => {
    expect(idleStep(watching, { now: 200_000, last: 100_000, waitMs: IDLE_RESULTS_MS }).kind).toBe(
      "watching",
    );
    expect(idleStep(watching, { now: 280_000, last: 100_000, waitMs: IDLE_RESULTS_MS }).kind).toBe("asking");
    expect(
      idleStep(watching, { now: 900_000, last: 0, waitMs: IDLE_RESULTS_MS, personSeen: true }).kind,
    ).toBe("watching");
  });

  it("stops on a screen where it never runs", () => {
    const asking: IdlePhase = { kind: "asking", deadline: 10 };
    expect(idleStep(asking, { now: 20, last: 0, waitMs: null })).toEqual({ kind: "watching", since: 20 });
  });
});

describe("staff controls", () => {
  it("opens the staff reset with Alt Shift N on any keyboard layout, and nothing else", () => {
    const k = (o: Partial<KeyboardEvent>) =>
      isStaffShortcut({ code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, ...o });
    expect(k({})).toBe(true);
    expect(k({ altKey: false })).toBe(false);
    expect(k({ shiftKey: false })).toBe(false);
    expect(k({ ctrlKey: true })).toBe(false);
    expect(k({ metaKey: true })).toBe(false);
    expect(k({ code: "KeyM" })).toBe(false);
  });

  it("takes a whole staff count from 0 to 60 in any digits (0.2)", () => {
    expect(COUNT_RANGE).toEqual([0, 60]);
    expect(parseStaffCount("15")).toBe(15);
    expect(parseStaffCount("١٥")).toBe(15);
    expect(parseStaffCount("۱۵")).toBe(15);
    expect(parseStaffCount("0")).toBe(0);
    expect(parseStaffCount("٦٠")).toBe(60);
    expect(parseStaffCount("61")).toBeNull();
    expect(parseStaffCount("1.5")).toBeNull();
    expect(parseStaffCount("١٫٥")).toBeNull();
    expect(parseStaffCount("")).toBeNull();
  });
});

/* ------------------------------------------------------------------ the next visitor */

describe("starting for the next visitor (S57, Q19 (4))", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clears the visit in the flow, keeps booth mode, and reloads the page only when online", async () => {
    const { startNextVisitor } = await import("../src/features/assessment/booth/BoothLayer");
    storage.setItem("azm.booth", "e2e-booth");
    storage.setItem("azm.check.snapshot", "{}");
    storage.setItem("azm.check.other", "1");
    const events: FlowEvent[] = [];
    const reload = vi.fn();
    startNextVisitor((e) => events.push(e), { guest: true, online: true, reload });
    expect(events).toEqual([{ type: "STAFF_RESET" }]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem("azm.booth")).toBe("e2e-booth");
    expect(storage.getItem("azm.check.snapshot")).toBeNull();
    expect(storage.getItem("azm.check.other")).toBeNull();

    const offline = vi.fn();
    startNextVisitor(() => undefined, { guest: true, online: false, reload: offline });
    expect(offline).not.toHaveBeenCalled();
    const signedIn = vi.fn();
    startNextVisitor(() => undefined, { guest: false, online: true, reload: signedIn });
    expect(signedIn).not.toHaveBeenCalled();
  });

  it("the flow's staff reset starts the guest check again with nothing of the last visitor", () => {
    let asked = 0;
    const answered = precheckUntil(
      guestAfterSteps({ position: "standing", clearance: "unsure" }),
      () => ++asked > 3,
    ).model;
    expect(Object.keys(answered.data.answers).length).toBeGreaterThan(0);
    const m = step(answered, { type: "STAFF_RESET" });
    expect(m.state).toEqual({ kind: "guestWelcome" });
    expect(m.data.answers).toEqual({});
    expect(m.data.guest).toEqual({});
    expect(m.data.lock).toBeNull();
    expect(m.data.config.booth).toBe(true);
    expect(m.effects).toEqual([]);
  });

  it("works from a camera state and a safety screen too, and logs no stop", () => {
    for (const s of [
      { kind: "cam.measure", i: 0, side: 0 },
      { kind: "safety", safety: "fall", screen: "scr_fall", alsoShow: [], faintAnswered: false },
      { kind: "results" },
    ] as FlowState[]) {
      const m = step(guest(s), { type: "STAFF_RESET" });
      expect(m.state.kind, s.kind).toBe("guestWelcome");
      expect(m.effects.some((e) => e.type === "stop")).toBe(false);
    }
  });

  it("never applies at home (no booth mode)", () => {
    const home = initialModel({ mode: "signedIn", booth: false, homeOpen: true, desktop: false });
    const m = step({ ...home, state: { kind: "plan" } }, { type: "STAFF_RESET" });
    expect(m.state).toEqual({ kind: "plan" });
  });
});

describe("a visitor pass ending over a safety screen (R3C-35)", () => {
  it("waits on S36 to S40, S38b, S33 and the check in, alarm and stop list overlays", () => {
    const safety = (safety: string, screen: string): FlowState =>
      ({ kind: "safety", safety, screen, alsoShow: [], faintAnswered: false }) as FlowState;
    for (const s of [
      safety("emergency", "scr_emergency"),
      safety("ad", "scr_ad"),
      safety("faint", "scr_faint"),
      safety("fall", "scr_fall"),
      safety("seekCare", "scr_stop_seek_care"),
      safety("pain", "scr_stop_pain"),
      { kind: "faintAsk" } as FlowState,
      { kind: "postponed", reason: "unwell", screen: null, alsoShow: [] } as FlowState,
    ])
      expect(reloadWaits(guest(s)), JSON.stringify(s)).toBe(true);
    const measuring = { kind: "cam.measure", i: 0, side: 0 } as FlowState;
    for (const o of [
      { kind: "stopList", takeYourTime: false },
      { kind: "checkIn", from: "test", trigger: "sway" },
      { kind: "alarm", from: "test" },
    ] as Overlay[])
      expect(reloadWaits(guest(measuring, o)), o.kind).toBe(true);
  });

  it("reloads at once anywhere else", () => {
    expect(reloadWaits(guest({ kind: "results" }))).toBe(false);
    expect(reloadWaits(guest({ kind: "cam.measure", i: 0, side: 0 }))).toBe(false);
    expect(reloadWaits(guest({ kind: "guestWelcome" }))).toBe(false);
  });
});
