/**
 * Review screenshots of the safety stream (UX spec definition of done): S36 to S49 and the S41, S43,
 * S44 and S45 overlays, with their variants and the states that apply to them (offline, sound off,
 * booth and home), at 375 x 812 and 1440 x 900, in Arabic and English. Runs only with AZM_SHOTS_DIR:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/safety npm run e2e -- safety-shots
 *
 * Files are <lang>-<m|d>-<name>.png (m 375 x 812 at 2x, d 1440 x 900). Each screen opens from a flow
 * snapshot (safety-fixtures.ts) on a fake clock, which is moved on until the first spoken line shows
 * in the caption strip, so every shot shows the caption as the person sees it.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import { MEASURE, openGuest, openSignedIn, type Lang, type ModelOptions } from "./safety-fixtures";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const COPY = { ar, en } as const;
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
const LANGS: Lang[] = ["ar", "en"];

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

interface Shot {
  name: string;
  open: ModelOptions;
  signedIn?: boolean;
  /** After the screen shows: taps, the sound toggle, going offline. */
  act?(page: Page, lang: Lang): Promise<void>;
  /** Fake clock time to run before the shot (the first caption shows after 800 ms). */
  runMs?: number;
}

const SHOTS: Shot[] = [
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
    name: "S38b-faint-question-take-your-time",
    open: {
      state: { kind: "faintAsk" },
      overlay: { kind: "checkIn", from: "faintAsk", trigger: "no_answer" },
    },
    act: async (page) => {
      await page.locator('[data-screen="S43"] [data-value="fine"]').click();
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
    },
  },
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
    open: { state: MEASURE, overlay: { kind: "stopList", takeYourTime: false }, sciT6: true },
  },
  {
    name: "S41-stop-list-home",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "stopList", takeYourTime: false } },
  },
  {
    name: "S41-stop-list-take-your-time",
    open: { state: MEASURE, overlay: { kind: "stopList", takeYourTime: true } },
  },
  {
    name: "S41-stop-list-offline",
    open: { state: MEASURE, overlay: { kind: "stopList", takeYourTime: false } },
    act: (page) => page.context().setOffline(true),
  },
  {
    name: "S42-rest-after-tired",
    open: { state: { kind: "stopDone", i: 0, restSec: 60, reason: "stopped_symptom" } },
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

  // S43 check in, S44 go on, S45 the alarm.
  {
    name: "S43-check-in-booth",
    open: {
      state: MEASURE,
      overlay: { kind: "checkIn", from: "test", trigger: "no_movement", attempt: true },
    },
  },
  {
    name: "S43-check-in-home-raise",
    signedIn: true,
    open: {
      state: MEASURE,
      overlay: { kind: "checkIn", from: "test", trigger: "no_movement", attempt: true },
      checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: "right" },
    },
  },
  {
    name: "S44-go-on",
    open: { state: MEASURE, overlay: { kind: "goOn", afterAlarm: false, canRedo: true } },
  },
  {
    name: "S44-go-on-after-alarm",
    open: { state: MEASURE, overlay: { kind: "goOn", afterAlarm: true, canRedo: true } },
  },
  {
    name: "S45-alarm-booth",
    open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true, trigger: "no_movement" } },
  },
  {
    name: "S45-alarm-help",
    open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true, help: true } },
  },
  {
    name: "S45-alarm-home-sound-off",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true, trigger: "sway" } },
    act: async (page, lang) => {
      await page
        .locator('[data-screen="S45"]')
        .getByRole("button", { name: COPY[lang].common.sound, exact: true })
        .click();
      await expect(page.locator(".safety-still")).toHaveText(COPY[lang].common.alertStillSounds);
    },
  },
  {
    name: "S45-alarm-offline",
    open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true, trigger: "sway" } },
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
      await expect(page.locator(".safety-count-field")).toBeVisible();
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

/**
 * A whole page shot: the viewport is made as tall as the content (the page, or the overlay layer
 * that scrolls itself), so the sticky parts are drawn where a person sees them.
 */
async function shot(page: Page, file: string) {
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize()!;
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".check-overlay")?.scrollTo(0, 0);
  });
  const height = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      document.querySelector(".check-overlay")?.scrollHeight ?? 0,
    ),
  );
  if (height > viewport.height) await page.setViewportSize({ width: viewport.width, height });
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, animations: "disabled" });
  await page.setViewportSize(viewport);
}

async function take(browser: Browser, s: Shot, lang: Lang, size: (typeof SIZES)[number]) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.tag !== "d",
    isMobile: size.tag !== "d",
  });
  const page = await context.newPage();
  await page.clock.install();
  if (s.signedIn) await openSignedIn(page, lang, s.open);
  else await openGuest(page, lang, s.open);
  await expect(page.locator("[data-screen]").first()).toBeVisible();
  await page.clock.runFor(1_000);
  if (s.act) await s.act(page, lang);
  if (s.runMs) await page.clock.runFor(s.runMs);
  await shot(page, join(OUT, `${lang}-${size.tag}-${s.name}.png`));
  await context.close();
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`safety shots ${lang} ${size.tag}`, async ({ browser }) => {
      test.setTimeout(600_000);
      mkdirSync(OUT, { recursive: true });
      for (const s of SHOTS) await take(browser, s, lang, size);
    });
  }
}
