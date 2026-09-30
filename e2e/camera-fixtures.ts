/**
 * Helpers of the camera specs (e2e/camera.spec.ts, e2e/camera-shots.spec.ts): a guest check at the
 * booth restored at a camera state of one test (useCheckFlow takes the reload snapshot), with the
 * foundation fixture source (?e2eFixture=, whose presets include the camera scripts of
 * src/features/assessment/camera/e2e/fixtures.ts) or the static previews (?e2eCamPreview=).
 */
import { expect, type Page } from "@playwright/test";

export type Lang = "ar" | "en";
export const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

type Side = "left" | "right" | "none";
const item = (testId: string, side: Side, order: number, variant?: string) => ({
  testId,
  side,
  version: 1,
  order,
  band: "default",
  ...(variant ? { variant } : {}),
});

/** Every test of the check, both sides: the arm raise, the arm curl (arm only), the side lean, the chair stand. */
export const PROTOCOL = [
  item("shoulder_abduction", "left", 1),
  item("shoulder_abduction", "right", 2),
  item("arm_curl_30s", "left", 3, "arm_only"),
  item("arm_curl_30s", "right", 4, "arm_only"),
  item("trunk_control_seated", "left", 5),
  item("trunk_control_seated", "right", 6),
  item("chair_stand_30s", "none", 7, "standard"),
];
export const TEST_INDEX = {
  shoulder_abduction: 0,
  arm_curl_30s: 1,
  trunk_control_seated: 2,
  chair_stand_30s: 3,
} as const;
export type CamTestId = keyof typeof TEST_INDEX;

function testsOf(protocol: typeof PROTOCOL) {
  const out: { testId: string; sides: typeof PROTOCOL }[] = [];
  for (const p of protocol) {
    const last = out[out.length - 1];
    if (last && last.testId === p.testId) last.sides.push(p);
    else out.push({ testId: p.testId, sides: [p] });
  }
  return out;
}

/** A guest flow model (flowMachine FlowModel) at `state`, as JSON for the reload snapshot. */
export function camModel(
  state: Record<string, unknown>,
  o: { position?: string; soundMode?: string; run?: Record<string, unknown> } = {},
): string {
  return JSON.stringify({
    state,
    overlay: null,
    effects: [],
    nextEffectId: 1,
    data: {
      config: { mode: "guest", booth: true, homeOpen: false, desktop: false },
      setting: "booth",
      device: { model: "lite", aspect: 0.5625, fps: 30, engineVersion: "e2e", appVersion: "0.1.0" },
      guestPath: "full",
      guest: {},
      signedIn: null,
      env: {
        setting: "booth",
        ctx: {
          position: o.position ?? "chair",
          support: "none",
          pain: [],
          restrictions: [],
          conditions: [],
          clearance: "unsure",
        },
        setup: null,
        firstCheck: true,
        unresolvedChangeReported: false,
        lastCheckLasting: false,
        baseTests: ["shoulder_abduction", "arm_curl_30s", "trunk_control_seated"],
      },
      base: [],
      answers: {},
      soundMode: o.soundMode ?? "voice",
      warnings: [],
      helperRequired: [],
      protocol: PROTOCOL,
      tests: testsOf(PROTOCOL),
      checkId: null,
      checkKind: null,
      outcomes: {},
      cameraUsed: true,
      desktopPassed: true,
      run: { calibrated: false, practiced: false, saved: 0, retriesUsed: 0, calibrationRounds: 1, ...o.run },
      lock: null,
      closed: false,
      checkIn: false,
      helperBriefing: {},
      stopped: null,
      resuming: false,
      sameChair: {},
    },
  });
}

/**
 * Seeds the snapshot and booth mode once, before the page's first script. The page has no speech
 * voices, so captions carry every line (the voice path is covered by the unit tests).
 */
export async function seed(page: Page, snapshot: string) {
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
  await page.addInitScript((m) => {
    if (sessionStorage.getItem("azm.e2e.once")) return;
    sessionStorage.setItem("azm.e2e.once", "1");
    sessionStorage.setItem("azm.booth", "e2e-booth");
    sessionStorage.setItem("azm.check.snapshot", m);
  }, snapshot);
}

/** Opens the guest check at the setup check of `testId` (side index `side`), with query `extra`. */
export async function openCamera(
  page: Page,
  lang: Lang,
  testId: CamTestId,
  extra: string,
  o: {
    side?: number;
    state?: Record<string, unknown>;
    position?: string;
    soundMode?: string;
    run?: Record<string, unknown>;
  } = {},
) {
  const i = TEST_INDEX[testId];
  await seed(page, camModel(o.state ?? { kind: "cam.setup", i, side: o.side ?? 0 }, o));
  await page.goto(url(`/?check=1&${extra}`, lang));
  await expect(page.locator(".s34-stage")).toBeVisible();
}

/** The flow state kind CheckApp renders now. */
export const stateOf = (page: Page) => page.locator(".check-base").getAttribute("data-state");

/** Records every flow state the page shows (CheckApp's data-state), so short states are not missed. */
export async function watchStates(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __states: string[] };
    w.__states = [];
    const note = () => {
      const s = document.querySelector(".check-base")?.getAttribute("data-state");
      if (s && w.__states[w.__states.length - 1] !== s) w.__states.push(s);
    };
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
  });
}

export const statesSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __states: string[] }).__states);

/** Waits for the flow to reach `state` (the camera sequence of a whole side can take a while). */
export async function reach(page: Page, state: string, timeout = 120_000) {
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", state, { timeout });
}
