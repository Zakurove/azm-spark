/**
 * Flow snapshots for the safety specs (e2e/safety.spec.ts, e2e/safety-shots.spec.ts): a check model in
 * a given state, restored by the flow on load (useCheckFlow takeSnapshot), so a spec opens S36 to S49
 * and the stop list and check in overlays directly and then drives them through their own controls.
 * Guest snapshots run in booth mode (/?check=1); signed in snapshots open from the portal after a
 * throwaway account and intake are made.
 */
import { expect, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

export type Lang = "ar" | "en";
export const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

type Side = "left" | "right" | "none";
const item = (testId: string, side: Side, order: number) => ({
  testId,
  side,
  version: 1,
  order,
  band: "default",
});

/** Today's protocol of a seated visitor at the booth: arm raise, arm curl (arm only), side lean. */
export const PROTOCOL = [
  item("shoulder_abduction", "left", 1),
  item("shoulder_abduction", "right", 2),
  { ...item("arm_curl_30s", "left", 3), variant: "arm_only" },
  { ...item("arm_curl_30s", "right", 4), variant: "arm_only" },
  item("trunk_control_seated", "left", 5),
  item("trunk_control_seated", "right", 6),
];

function testsOf(protocol: typeof PROTOCOL) {
  const out: { testId: string; sides: typeof PROTOCOL }[] = [];
  for (const p of protocol) {
    const last = out[out.length - 1];
    if (last && last.testId === p.testId) last.sides.push(p);
    else out.push({ testId: p.testId, sides: [p] });
  }
  return out;
}

export interface ModelOptions {
  mode?: "guest" | "signedIn";
  booth?: boolean;
  state: Record<string, unknown>;
  overlay?: Record<string, unknown> | null;
  /** The person: position and SCI at T6 or above (the AD stop row, the SCI cards). */
  position?: "chair" | "wheelchair" | "standing";
  sciT6?: boolean;
  outcomes?: Record<string, { status: string; reason?: string; value?: number | null }>;
  lock?: { reason: string; until: number } | null;
  checkId?: string | null;
  /** The optional check in is on (D-016): a signed in check at home only. */
  checkIn?: boolean;
  /** The side's run (calibrated, practiced, attempts saved); a side past its practice by default. */
  run?: Record<string, unknown>;
  noProtocol?: boolean;
}

/** A flow model (flowMachine FlowModel) as JSON, for the snapshot key. */
export function model(o: ModelOptions): string {
  const mode = o.mode ?? "guest";
  const booth = o.booth ?? mode === "guest";
  const protocol = o.noProtocol ? [] : PROTOCOL;
  const env = {
    setting: booth ? "booth" : "home",
    ctx: {
      position: o.position ?? "chair",
      support: "none",
      pain: [],
      restrictions: [],
      conditions: o.sciT6 ? ["sci_incomplete"] : [],
      clearance: "yes",
    },
    setup: o.sciT6 ? { sciT6: true } : null,
    firstCheck: true,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: ["shoulder_abduction", "arm_curl_30s", "trunk_control_seated"],
  };
  return JSON.stringify({
    state: o.state,
    overlay: o.overlay ?? null,
    effects: [],
    nextEffectId: 1,
    data: {
      config: { mode, booth, homeOpen: true, desktop: false },
      setting: booth ? "booth" : "home",
      device: { model: "lite", aspect: 0.5625, fps: 30, engineVersion: "e2e", appVersion: "0.1.0" },
      guestPath: "full",
      guest: {},
      signedIn: null,
      env,
      base: [],
      answers: {},
      soundMode: "voice",
      warnings: [],
      helperRequired: [],
      protocol,
      tests: testsOf(protocol),
      checkId: o.checkId ?? (mode === "signedIn" ? "e2e-check" : null),
      checkKind: mode === "signedIn" ? "baseline" : null,
      outcomes: o.outcomes ?? {},
      cameraUsed: true,
      desktopPassed: true,
      run: { calibrated: true, practiced: true, saved: 1, retriesUsed: 0, calibrationRounds: 1, ...o.run },
      lock: o.lock ?? null,
      closed: false,
      checkIn: o.checkIn === true && !booth,
      helperBriefing: {},
      stopped: null,
      resuming: false,
      sameChair: {},
    },
  });
}

/**
 * Seeds the snapshot (and booth mode) once, before the page's first script. The page gets no speech
 * voices, so every caption steps at its reading time on the fake clock (a real voice would end its
 * lines in real time); the player with a voice is covered by tests/safety-speech.test.ts.
 */
export async function seed(page: Page, snapshot: string, booth: boolean) {
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
  await page.addInitScript(
    ([m, b]) => {
      if (sessionStorage.getItem("azm.e2e.once")) return;
      sessionStorage.setItem("azm.e2e.once", "1");
      if (b === "1") sessionStorage.setItem("azm.booth", "e2e-booth");
      sessionStorage.setItem("azm.check.snapshot", m);
    },
    [snapshot, booth ? "1" : "0"],
  );
}

/**
 * The camera states under the overlays (S41, S43 over S34) take their frames from the fixture
 * source (a person sitting still), never from a real camera, which a headless browser does not have.
 */
const CAMERA = "e2eFixture=seated-still";

/** Opens a guest (booth) check at the snapshot's state. */
export async function openGuest(page: Page, lang: Lang, o: ModelOptions) {
  await seed(page, model({ ...o, mode: "guest" }), true);
  await page.goto(url(`/?check=1&${CAMERA}`, lang));
  await expect(page.locator(".azm-check").first()).toBeVisible();
}

/**
 * A throwaway signed in account with a saved intake, then the check at the snapshot's state, with the
 * fixture camera `camera` (a person sitting still by default).
 */
export async function openSignedIn(page: Page, lang: Lang, o: ModelOptions, camera: string = CAMERA) {
  await page.goto(url("/", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "E2E Safety",
      email: `safety-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const intake = await page.request.put("/api/intake", {
    headers,
    data: {
      age: 45,
      conditions: ["none"],
      diagnosisNotes: "",
      medications: "",
      mobility: "seated",
      support: "none",
      pain: [],
      restrictions: [],
      symptoms: "no",
      recentChange: "no",
      clearance: "yes",
      equipment: ["chair"],
      goal: "habit",
      days: [0, 2, 4],
      time: "09:00",
      sessionMinutes: 30,
      consent: true,
    },
  });
  expect(intake.status()).toBe(200);
  await seed(page, model({ ...o, mode: "signedIn", booth: false }), false);
  await page.goto(url(`/?${camera}`, lang));
  await expect(page.locator(".azm-check").first()).toBeVisible();
}

/** A measure state of the arm raise, first side (a test running: STOP and the triggers apply). */
export const MEASURE = { kind: "cam.measure", i: 0, side: 0 };

/* ------------------------------------------------------------------ named states */

const safety = (safety: string, screen: string, extra: Record<string, unknown> = {}) => ({
  kind: "safety",
  safety,
  screen,
  alsoShow: [],
  faintAnswered: false,
  ...extra,
});
const skip = (rows: { testId: string; side: string; reason: string }[]) => ({
  kind: "skipNotice",
  rows,
  then: { to: "test", i: 1 },
});
const HOUR = 3600e3;

/** A named safety screen state for the shots and the axe pass (e2e/a11y.spec.ts). */
export interface SafetyState {
  name: string;
  open: ModelOptions;
  signedIn?: boolean;
  /** After the screen shows: taps, the sound toggle, going offline. */
  act?(page: Page, lang: Lang): Promise<void>;
  /** Fake clock time to run before the shot (the first caption shows after 800 ms). */
  runMs?: number;
}

export const SAFETY_STATES: SafetyState[] = [
  // S36 to S40b, the safety screens (guest at the booth unless named).
  { name: "S36-emergency", open: { state: safety("emergency", "scr_emergency") } },
  {
    name: "S36-emergency-sci-ad-card",
    open: { state: safety("emergency", "scr_emergency", { alsoShow: ["scr_ad"] }), sciT6: true },
  },
  {
    name: "S36-emergency-home-kept-paused",
    signedIn: true,
    open: {
      state: safety("emergency", "scr_emergency"),
      outcomes: { "shoulder_abduction:left": { status: "measured", value: 120 } },
      lock: { reason: "stop_symptom", until: Date.now() + 14 * HOUR },
    },
  },
  {
    name: "S36-emergency-offline",
    open: { state: safety("emergency", "scr_emergency") },
    act: (page) => page.context().setOffline(true),
  },
  { name: "S37-ad", open: { state: safety("ad", "scr_ad"), sciT6: true } },
  { name: "S38-faint", open: { state: safety("faint", "scr_faint") } },
  {
    name: "S38-faint-sci",
    open: { state: safety("faint", "scr_faint", { alsoShow: ["scr_faint_sci"] }), sciT6: true },
  },
  { name: "S38b-faint-question", open: { state: { kind: "faintAsk" } } },
  {
    name: "S39-fall-standing",
    open: { state: safety("fall", "scr_fall", { askFaint: true }), position: "standing" },
  },
  { name: "S39-fall-seated", open: { state: safety("fall", "scr_fall_seated", { askFaint: true }) } },
  { name: "S40a-seek-care", open: { state: safety("seekCare", "scr_stop_seek_care") } },
  { name: "S40b-pain", open: { state: safety("pain", "scr_stop_pain") } },
  {
    name: "S40b-pain-home-continue",
    signedIn: true,
    open: {
      state: safety("pain", "scr_stop_pain"),
      outcomes: { "shoulder_abduction:left": { status: "measured", value: 120 } },
      lock: { reason: "pain_after", until: Date.now() + 14 * HOUR },
    },
  },

  // S41 the stop list, S42 that is fine.
  {
    name: "S41-stop-list-booth-sci",
    open: { state: MEASURE, overlay: { kind: "stopList" }, sciT6: true },
  },
  {
    name: "S41-stop-list-home",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "stopList" } },
  },
  {
    name: "S41-stop-list-offline",
    open: { state: MEASURE, overlay: { kind: "stopList" } },
    act: (page) => page.context().setOffline(true),
  },
  {
    name: "S42-rest-after-tired",
    open: { state: { kind: "stopDone", i: 0, restSec: 60, reason: "stopped_symptom", option: "tired" } },
    runMs: 5_000,
  },
  { name: "S42-by-choice", open: { state: { kind: "stopDone", i: 0, restSec: 0, reason: "by_choice" } } },
  {
    name: "S42-last-test",
    open: {
      state: { kind: "stopDone", i: 2, restSec: 0, reason: "by_choice" },
      outcomes: {
        "shoulder_abduction:left": { status: "measured", value: 120 },
        "shoulder_abduction:right": { status: "measured", value: 118 },
        "arm_curl_30s:left": { status: "measured", value: 14 },
        "arm_curl_30s:right": { status: "measured", value: 13 },
      },
    },
  },

  // S43, the optional check in (D-016): signed in at home with the setting on.
  {
    name: "S43-check-in",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "checkIn" }, checkIn: true },
  },
  {
    name: "S43-check-in-no-answer",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "checkIn" }, checkIn: true },
    runMs: 30_500,
  },
  {
    name: "S43-check-in-offline",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "checkIn" }, checkIn: true },
    act: (page) => page.context().setOffline(true),
  },

  // S46 skip notice, S46b guest after a test.
  {
    name: "S46-skip-by-choice",
    open: { state: skip([{ testId: "shoulder_abduction", side: "left", reason: "by_choice" }]) },
  },
  {
    name: "S46-skip-pain-more",
    open: {
      state: skip([
        { testId: "arm_curl_30s", side: "left", reason: "pain_more" },
        { testId: "arm_curl_30s", side: "right", reason: "pain_more" },
        { testId: "trunk_control_seated", side: "left", reason: "pain_more" },
      ]),
    },
  },
  {
    name: "S46-skip-needed-arms",
    open: { state: skip([{ testId: "chair_stand_30s", side: "none", reason: "needed_arms" }]) },
  },
  {
    name: "S46-skip-quality",
    open: { state: skip([{ testId: "shoulder_abduction", side: "right", reason: "quality" }]) },
  },
  { name: "S46b-guest-after-test", open: { state: { kind: "guestAfterTest", next: 1 } } },

  // S47 to S49, the questions asked where the person sits.
  {
    name: "S47-pain-after-side",
    open: { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" } },
  },
  {
    name: "S47-pain-after-read-back",
    open: { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" } },
    act: async (page) => {
      await page.locator('[data-screen="S47"] [data-value="more"]').click();
    },
    runMs: 0,
  },
  {
    name: "S47-pain-after-stop",
    open: { state: { kind: "between", i: 0, side: 0, scope: "test", via: "stop" } },
  },
  {
    name: "S47-pain-after-home",
    signedIn: true,
    open: { state: { kind: "between", i: 2, side: 0, scope: "test", via: "test" } },
  },
  { name: "S48-contact-left", open: { state: { kind: "after.contact", i: 2, side: 0 } } },
  { name: "S48-pushed", open: { state: { kind: "after.pushed", i: 1, side: 0 } } },
  {
    name: "S48-count",
    open: {
      state: { kind: "after.count", i: 1, side: 0 },
      outcomes: { "arm_curl_30s:left": { status: "measured", value: 14 } },
    },
  },
  {
    name: "S48-count-input",
    open: {
      state: { kind: "after.count", i: 1, side: 0 },
      outcomes: { "arm_curl_30s:left": { status: "measured", value: 14 } },
    },
    act: async (page) => {
      await page.locator('[data-screen="S48"] [data-value="no"]').click();
      await expect(page.locator(".check-stepper-input")).toBeVisible();
    },
  },
  { name: "S49-end-question", open: { state: { kind: "endQuestion" } } },
  { name: "S49-end-question-side", open: { state: { kind: "endQuestion", side: "left" } } },
  {
    name: "S49-end-question-home",
    signedIn: true,
    open: {
      state: { kind: "endQuestion" },
      outcomes: { "shoulder_abduction:left": { status: "measured", value: 120 } },
    },
  },
];
