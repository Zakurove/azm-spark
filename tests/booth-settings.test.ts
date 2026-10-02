/**
 * Booth staff settings (D-016 item 4, council F-1 D, F-2): the switch that turns a single test off at
 * the booth, the arm raise plane check fallback and the staff readout toggle. Kept on the device, read
 * only in booth mode, never at home; a switched off test never appears in the visitor's tests today;
 * the one test path runs the first test still on, and S05 offers only the paths that can run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkConfig } from "../src/features/assessment/CheckApp";
import type { FlowEffect, FlowModel } from "../src/features/assessment/flowMachine";
import { guestPaths } from "../src/features/assessment/flow/copy";
import {
  cleanSettings,
  DEFAULT_BOOTH_SETTINGS,
  oneTest,
  ONE_TEST_ORDER,
  PLANE_RATIOS,
  readBoothSettings,
  saveBoothSettings,
  SWITCHABLE_TESTS,
  type BoothSettings,
} from "../src/features/assessment/booth/settings";
import { CHECK_DATA } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffReadoutPanel } from "../src/features/assessment/camera/StaffReadout";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import { memoryStorage } from "./booth-helpers";
import { atSetup, runFixture } from "./s34-harness";
import type { CameraController } from "../src/features/assessment/camera/controller";
import {
  answerAll,
  contextOf,
  GUEST,
  guestAtQuestions,
  guestAtPlan,
  play,
  signedAt,
  type GuestChoices,
} from "./flow-walks";

const off = (...testsOff: TestId[]): BoothSettings => ({ ...DEFAULT_BOOTH_SETTINGS, testsOff });
const testsOf = (m: FlowModel) => [...new Set(m.data.protocol.map((i) => i.testId))];
const baseTestsOf = (m: FlowModel) => [...new Set(m.data.base.map((i) => i.testId))];

/** A guest at the booth with these staff settings, through the steps to the plan (S27). */
function guestPlanWith(settings: BoothSettings, c: GuestChoices = {}): FlowModel {
  return guestAtPlan({ ...c, config: { ...GUEST, boothSettings: settings } });
}

describe("settings kept on the device", () => {
  let local: Storage;
  beforeEach(() => {
    local = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("start at the defaults: every test on, the standard plane check, no readout", () => {
    expect(readBoothSettings()).toEqual({ testsOff: [], planeFallback: false, readout: false });
  });

  it("keep what staff chose, and drop what is not a test or not a setting", () => {
    saveBoothSettings({
      testsOff: ["arm_curl_30s", "shoulder_abduction"],
      planeFallback: true,
      readout: true,
    });
    // Always in the order of the check, whatever the order of the taps.
    expect(readBoothSettings()).toEqual({
      testsOff: ["shoulder_abduction", "arm_curl_30s"],
      planeFallback: true,
      readout: true,
    });
    local.setItem("azm.boothSettings", JSON.stringify({ testsOff: ["walk_6min", 3], planeFallback: "yes" }));
    expect(readBoothSettings()).toEqual(DEFAULT_BOOTH_SETTINGS);
    local.setItem("azm.boothSettings", "{not json");
    expect(readBoothSettings()).toEqual(DEFAULT_BOOTH_SETTINGS);
    // Back to the defaults: nothing is kept.
    saveBoothSettings(DEFAULT_BOOTH_SETTINGS);
    expect(local.getItem("azm.boothSettings")).toBeNull();
  });

  it("offer a switch for every test of the check", () => {
    expect([...SWITCHABLE_TESTS].sort()).toEqual(CHECK_DATA.tests.map((t) => t.id).sort());
  });

  it("apply to a check in booth mode only, never at home", () => {
    const settings = { ...off("shoulder_abduction"), planeFallback: true, readout: true };
    const base = { desktop: false, boothSettings: settings };
    expect(checkConfig({ ...base, mode: "guest", booth: true }).boothSettings).toEqual(settings);
    expect(checkConfig({ ...base, mode: "signedIn", booth: true }).boothSettings).toEqual(settings);
    expect(checkConfig({ ...base, mode: "signedIn", booth: false })).not.toHaveProperty("boothSettings");
    expect(checkConfig({ ...base, mode: "guest", booth: false })).not.toHaveProperty("boothSettings");
    // A home model built with settings by mistake still runs every test.
    const home = signedAt(contextOf({ position: "chair" }), { boothSettings: off("shoulder_abduction") });
    expect(baseTestsOf(home)).toContain("shoulder_abduction");
    // At the defaults the configuration stays as before.
    const plain = checkConfig({ ...base, boothSettings: DEFAULT_BOOTH_SETTINGS, mode: "guest", booth: true });
    expect(plain).not.toHaveProperty("boothSettings");
  });

  it("clean anything sent", () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_BOOTH_SETTINGS);
    expect(cleanSettings({ testsOff: "shoulder_abduction" })).toEqual(DEFAULT_BOOTH_SETTINGS);
  });
});

describe("a switched off test never appears in the visitor's tests today", () => {
  for (const position of ["chair", "wheelchair", "standing"] as const)
    it(`the full check of a ${position} visitor runs without the arm raise`, () => {
      const on = guestPlanWith(DEFAULT_BOOTH_SETTINGS, { position });
      expect(testsOf(on)).toContain("shoulder_abduction");
      const m = guestPlanWith(off("shoulder_abduction"), { position });
      expect(m.state.kind).toBe("plan");
      expect(baseTestsOf(m)).not.toContain("shoulder_abduction");
      expect(testsOf(m)).not.toContain("shoulder_abduction");
      // Every other test runs as before, in the same order.
      expect(testsOf(m)).toEqual(testsOf(on).filter((t) => t !== "shoulder_abduction"));
    });

  it("no line, no reason: a test that is off is not listed as skipped either", () => {
    // A chair user sees the chair stand listed as not offered (position_seated) while it is on.
    const on = guestPlanWith(DEFAULT_BOOTH_SETTINGS, { position: "chair" });
    expect(on.data.protocol.find((i) => i.testId === "chair_stand_30s")?.skipped).toBe("position_seated");
    const m = guestPlanWith(off("chair_stand_30s", "trunk_control_seated"), { position: "chair" });
    expect(testsOf(m)).toEqual(["shoulder_abduction", "arm_curl_30s"]);
    expect(m.data.protocol.every((i) => !i.skipped)).toBe(true);
  });

  it("the pre-check asks nothing for a test that is off", () => {
    const asked = (settings: BoothSettings) => {
      const seen: string[] = [];
      answerAll(
        guestAtQuestions({ position: "standing", config: { ...GUEST, boothSettings: settings } }),
        {},
        seen,
      );
      return seen;
    };
    expect(asked(DEFAULT_BOOTH_SETTINGS).some((id) => id.startsWith("pc_stand"))).toBe(true);
    expect(asked(off("chair_stand_30s")).some((id) => id.startsWith("pc_stand"))).toBe(false);
  });

  it("a guest whose only test is off talks to our team (S09), with no new copy", () => {
    // Stroke without clearance: the booth arm raise only (Q19 (5b)); with it off, no test runs.
    const choices: GuestChoices = { conditions: ["stroke"], clearance: "unsure" };
    const on = guestAtQuestions({ ...choices, config: { ...GUEST, boothSettings: DEFAULT_BOOTH_SETTINGS } });
    expect(on.state.kind).toBe("question");
    const m = guestAtQuestions({
      ...choices,
      config: { ...GUEST, boothSettings: off("shoulder_abduction") },
    });
    expect(m.state.kind).toBe("guestStaff");
  });

  it("a signed in check runs at home whatever the booth settings, and its start carries none (C34)", () => {
    const settings = off("shoulder_abduction");
    let m = signedAt(contextOf({ position: "chair" }), { booth: true, boothSettings: settings });
    expect(m.data.setting).toBe("home");
    expect(baseTestsOf(m)).toContain("shoulder_abduction");
    m = answerAll(
      play(m, { type: "CONTEXT_CONFIRM" }, { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" }),
    );
    const start = m.effects.find((e): e is Extract<FlowEffect, { type: "start" }> => e.type === "start");
    expect(start).toBeDefined();
    expect(start).not.toHaveProperty("testsOff");
    expect(start).not.toHaveProperty("setting");
  });
});

describe("the one test path (F-1 D, F-2)", () => {
  it("runs the first test every position has that is still on", () => {
    expect(ONE_TEST_ORDER).toEqual(["shoulder_abduction", "arm_curl_30s"]);
    expect(oneTest([])).toBe("shoulder_abduction");
    expect(oneTest(["shoulder_abduction"])).toBe("arm_curl_30s");
    expect(oneTest(["shoulder_abduction", "arm_curl_30s"])).toBeNull();
    expect(oneTest(["trunk_control_seated", "chair_stand_30s"])).toBe("shoulder_abduction");
  });

  it("is the arm raise by default, and the arm curl without a load when the arm raise is off", () => {
    const quick = (settings: BoothSettings, position: GuestChoices["position"]) =>
      testsOf(guestPlanWith(settings, { position, path: "quick" }));
    for (const position of ["chair", "wheelchair", "standing"] as const) {
      expect(quick(DEFAULT_BOOTH_SETTINGS, position)).toEqual(["shoulder_abduction"]);
      expect(quick(off("shoulder_abduction"), position)).toEqual(["arm_curl_30s"]);
    }
    const curl = guestPlanWith(off("shoulder_abduction"), { path: "quick" });
    for (const i of curl.data.protocol) expect(i.variant).toBe("arm_only");
  });

  it("F-2: S05 offers the one test first and the full check after it, by what runs (D-017: no minutes)", () => {
    expect(guestPaths([])).toEqual({ quick: true, full: true });
    // The arm curl is the one test when the arm raise is off; no one test when neither is on.
    expect(guestPaths(["shoulder_abduction"])).toEqual({ quick: true, full: true });
    expect(guestPaths(["shoulder_abduction", "arm_curl_30s"])).toEqual({ quick: false, full: true });
    // The full check is never offered with no test at all.
    expect(guestPaths([...SWITCHABLE_TESTS]).full).toBe(false);
  });
});

describe("the staff readout over the arm raise (F-1 test sessions)", () => {
  const withSettings = (settings: BoothSettings) => {
    const m = atSetup("shoulder_abduction");
    return { ...m, data: { ...m.data, config: { ...m.data.config, boothSettings: settings } } };
  };

  it("reads the live plane check and the last lift while it is on, and nothing is added to the result", () => {
    const readouts: NonNullable<ReturnType<CameraController["readout"]>>[] = [];
    const on = runFixture(withSettings({ ...DEFAULT_BOOTH_SETTINGS, readout: true }), "abd-9x16", 150, {
      stopWhen: (x) => !x.state.kind.startsWith("cam."),
      after: (ctrl) => {
        const r = ctrl.readout();
        if (r) readouts.push(r);
      },
    });
    const live = readouts.flatMap((r) => (r.live ? [r.live] : []));
    expect(live.length).toBeGreaterThan(0);
    expect(live.some((x) => x.plane === "pass" && x.ratio !== null && x.fps > 0)).toBe(true);
    expect(readouts.some((r) => r.last?.outcome === "valid" && r.last.value !== null)).toBe(true);
    // The stored result is the same with the readout off.
    const off = runFixture(withSettings(DEFAULT_BOOTH_SETTINGS), "abd-9x16", 150, {
      stopWhen: (x) => !x.state.kind.startsWith("cam."),
      after: (ctrl) => expect(ctrl.readout()).toBeNull(),
    });
    const bodies = (run: typeof on) =>
      run.events.filter((e) => e.type === "SIDE_RESULT").map((e) => (e as { body: unknown }).body);
    expect(bodies(on)).toEqual(bodies(off));
  });
});

describe("the staff readout panel", () => {
  const readout = {
    live: {
      ratio: 0.81,
      min: 0.85,
      plane: "fail" as const,
      okSec: 0.1,
      needSec: 0.3,
      issues: ["not_visible", "low_fps"],
      fps: 23.6,
    },
    last: { outcome: "invalid", value: 131, reasons: ["plane_unconfirmed"] },
    setup: ["too_close", "no_tilt"],
  };
  const html = (lang: "ar" | "en", r = readout) =>
    renderToStaticMarkup(
      createElement(CheckRoot, {
        ui: { lang, booth: true, guest: true },
        children: createElement(StaffReadoutPanel, { readout: r, lang }),
      }),
    );

  it("shows every reading in both languages, engine ids left to right, Arabic digits in Arabic", () => {
    const en = html("en");
    for (const x of ["Upper arm ratio", "0.81", "0.85", "Fails now", "0.1 of 0.3", "24", "Last lift"])
      expect(en).toContain(x);
    expect(en).toContain('<bdi dir="ltr">not_visible, low_fps</bdi>');
    expect(en).toContain('<bdi dir="ltr">invalid 131 plane_unconfirmed</bdi>');
    // C28: every failing setup check is listed for the team; the person sees only the first.
    expect(en).toContain("Setup checks");
    expect(en).toContain('<bdi dir="ltr">too_close, no_tilt</bdi>');
    const ar = html("ar");
    for (const x of ["نسبة العضد", "٠٫٨١", "٠٫٨٥", "غير مقبول الآن", "٠٫١ من ٠٫٣", "٢٤"])
      expect(ar).toContain(x);
    expect(ar).toContain('data-plane="fail"');
    expect(html("en", { live: null, last: null, setup: [] } as never)).toContain("Not started yet");
  });
});

describe("the plane check fallback (F-1 outcome W)", () => {
  it("has the two ratios F-1 approved, from the check data, never below the 0.75 floor", () => {
    expect(PLANE_RATIOS).toEqual({ standard: 0.85, fallback: 0.75 });
  });

  it("reaches the arm raise at the booth only", async () => {
    const { camTestOf } = await import("../src/features/assessment/camera/controller");
    const at = (m: FlowModel) => {
      const i = m.data.tests.findIndex((t) => t.testId === "shoulder_abduction");
      return camTestOf({ ...m, state: { kind: "cam.setup", i, side: 0 } as FlowModel["state"] });
    };
    const fallback = guestPlanWith({ ...DEFAULT_BOOTH_SETTINGS, planeFallback: true, readout: true });
    expect(at(fallback)).toMatchObject({ planeRatio: 0.75, readout: true });
    expect(at(guestPlanWith(DEFAULT_BOOTH_SETTINGS))).toMatchObject({ planeRatio: 0.85, readout: false });
    // A model that is not in booth mode ignores the setting.
    const home = {
      ...fallback,
      data: { ...fallback.data, config: { ...fallback.data.config, booth: false } },
    };
    expect(at(home)).toMatchObject({ planeRatio: 0.85, readout: false });
  });

  it("measures the side with the fallback and stores the ratio with the result", () => {
    const withSettings = (settings: BoothSettings) => {
      const m = atSetup("shoulder_abduction");
      return { ...m, data: { ...m.data, config: { ...m.data.config, boothSettings: settings } } };
    };
    const ratioOf = (m: FlowModel) => {
      const run = runFixture(m, "abd-9x16", 150, { stopWhen: (x) => !x.state.kind.startsWith("cam.") });
      const results = run.events.filter((e) => e.type === "SIDE_RESULT");
      expect(results.length).toBeGreaterThan(0);
      return results.map((e) => (e as { body: { detail: Record<string, unknown> } }).body.detail.planeRatio);
    };
    expect(ratioOf(withSettings({ ...DEFAULT_BOOTH_SETTINGS, planeFallback: true }))).toEqual([0.75]);
    expect(ratioOf(withSettings(DEFAULT_BOOTH_SETTINGS))).toEqual([0.85]);
  });
});
