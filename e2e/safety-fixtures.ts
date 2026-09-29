/**
 * Flow snapshots for the safety specs (e2e/safety.spec.ts, e2e/safety-shots.spec.ts): a check model in
 * a given state, restored by the flow on load (useCheckFlow takeSnapshot), so a spec opens S36 to S49
 * and the stop, check in and alarm overlays directly and then drives them through their own controls.
 * Guest snapshots run in booth mode (/?check=1); signed in snapshots open from the portal after a
 * throwaway account and intake are made.
 */
import { expect, type Page } from "@playwright/test";

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
  checkIn?: { raiseAllowed: boolean; noArmSignal: boolean; fineZoneSide: "left" | "right" | null } | null;
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
      run: { calibrated: true, practiced: true, saved: 1, retriesUsed: 0, calibrationRounds: 1 },
      lock: o.lock ?? null,
      closed: false,
      checkIn: o.checkIn ?? null,
      helperBriefing: {},
      stopped: null,
      noResponseAlarm: false,
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

/** Opens a guest (booth) check at the snapshot's state. */
export async function openGuest(page: Page, lang: Lang, o: ModelOptions) {
  await seed(page, model({ ...o, mode: "guest" }), true);
  await page.goto(url("/?check=1", lang));
  await expect(page.locator(".azm-check").first()).toBeVisible();
}

/** A throwaway signed in account with a saved intake, then the check at the snapshot's state. */
export async function openSignedIn(page: Page, lang: Lang, o: ModelOptions) {
  await page.goto(url("/", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
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
  await page.goto(url("/", lang));
  await expect(page.locator(".azm-check").first()).toBeVisible();
}

/** A measure state of the arm raise, first side (a test running: STOP and the triggers apply). */
export const MEASURE = { kind: "cam.measure", i: 0, side: 0 };
