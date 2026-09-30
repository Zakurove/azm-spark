/**
 * Booth staff settings (D-016 item 4, council F-1 D and the F-1 test sessions), kept on this device
 * (localStorage `azm.boothSettings`) and read only while the tab is in booth mode, so they never touch
 * a home check:
 *
 *   testsOff       tests turned off at this booth. A test that is off is taken out of the base
 *                  selection before anything else reads it, so it never appears in the visitor's
 *                  tests today, the pre-check asks nothing for it and the results do not list it.
 *                  Staff see which tests are off on the staff page (S55); visitors see no reason.
 *   planeFallback  the arm raise plane check uses the approved fallback ratio of F-1 (outcome W, the
 *                  data's validity.upperArmLengthMinRatioBoothFallback) in place of the standard one;
 *                  the ratio that measured is stored with each arm raise result (detail.planeRatio).
 *   readout        the staff readout over the arm raise for the team's real phone sessions (F-1 B):
 *                  the live upper arm ratio, the plane check, the quality gate issues and the frame
 *                  rate. It is drawn on the screen only; nothing extra is stored or sent.
 *
 * A visitor's own phone (S55b) takes the test and plane settings from the staff QR link, so it runs
 * the same tests as the booth phones; the readout stays on the staff phone.
 */
import { CHECK_DATA, testDef } from "../../../movements/assessments";
import type { TestId } from "../../../movements/types";

export interface BoothSettings {
  testsOff: TestId[];
  planeFallback: boolean;
  readout: boolean;
}

export const DEFAULT_BOOTH_SETTINGS: BoothSettings = { testsOff: [], planeFallback: false, readout: false };

const KEY = "azm.boothSettings";

/** Every test of the check, in the order staff see the switches (spec 3.2). */
export const SWITCHABLE_TESTS: readonly TestId[] = [
  "shoulder_abduction",
  "arm_curl_30s",
  "trunk_control_seated",
  "chair_stand_30s",
];

/**
 * The tests the one test path may run, in order (F-1 D): the tests every position runs (chair,
 * wheelchair, standing), in the order of the check. The first one still on is the one test.
 */
export const ONE_TEST_ORDER: readonly TestId[] = (() => {
  const lists = (["chair", "wheelchair", "standing"] as const).map(
    (p) => CHECK_DATA.selection.basePerPosition[p] as readonly TestId[],
  );
  return lists[0].filter((t) => lists.every((l) => l.includes(t)));
})();

/** The test of the one test path with these tests off, or null when none of them is on. */
export function oneTest(testsOff: readonly TestId[]): TestId | null {
  return ONE_TEST_ORDER.find((t) => !testsOff.includes(t)) ?? null;
}

/** The arm raise plane check ratios F-1 approved: the standard rule and the booth fallback. */
export const PLANE_RATIOS = (() => {
  const v = testDef("shoulder_abduction").validity;
  return { standard: v.upperArmLengthMinRatio, fallback: v.upperArmLengthMinRatioBoothFallback };
})();

/** Settings from anything stored or sent: unknown tests and fields are dropped. */
export function cleanSettings(v: unknown): BoothSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const off = Array.isArray(o.testsOff) ? o.testsOff : [];
  return {
    testsOff: SWITCHABLE_TESTS.filter((t) => off.includes(t)),
    planeFallback: o.planeFallback === true,
    readout: o.readout === true,
  };
}

export function isDefault(s: BoothSettings): boolean {
  return s.testsOff.length === 0 && !s.planeFallback && !s.readout;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The settings kept on this device (the defaults when none are kept or storage is blocked). */
export function readBoothSettings(): BoothSettings {
  try {
    const raw = storage()?.getItem(KEY);
    return raw ? cleanSettings(JSON.parse(raw)) : { ...DEFAULT_BOOTH_SETTINGS };
  } catch {
    return { ...DEFAULT_BOOTH_SETTINGS };
  }
}

export function saveBoothSettings(s: BoothSettings): void {
  try {
    const clean = cleanSettings(s);
    if (isDefault(clean)) storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode: the settings last for this page only */
  }
}

/**
 * The query the staff QR adds for a visitor's phone (S55b): the tests that are off and the plane
 * fallback, never the readout. Empty at the defaults, so the link stays as short as before.
 */
export function visitorQuery(s: BoothSettings): string {
  const parts: string[] = [];
  if (s.testsOff.length) parts.push(`off=${s.testsOff.join(",")}`);
  if (s.planeFallback) parts.push("plane=fallback");
  return parts.map((p) => `&${p}`).join("");
}

/** The settings a visitor's phone takes from the staff QR link (the readout is always off). */
export function settingsFromQuery(q: URLSearchParams): BoothSettings {
  return cleanSettings({
    testsOff: (q.get("off") ?? "").split(","),
    planeFallback: q.get("plane") === "fallback",
  });
}
