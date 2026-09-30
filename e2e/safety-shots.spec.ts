/**
 * Review screenshots of the safety stream (UX spec definition of done): S36 to S49 and the S41 and S43
 * overlays, with their variants and the states that apply to them (offline, booth and home), at
 * 375 x 812 and 1440 x 900, in Arabic and English. Runs only with AZM_SHOTS_DIR:
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
import { openGuest, openSignedIn, SAFETY_STATES, type Lang, type SafetyState } from "./safety-fixtures";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
const LANGS: Lang[] = ["ar", "en"];

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

async function take(browser: Browser, s: SafetyState, lang: Lang, size: (typeof SIZES)[number]) {
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
      for (const s of SAFETY_STATES) await take(browser, s, lang, size);
    });
  }
}
