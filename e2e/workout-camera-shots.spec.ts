/**
 * Review screenshots of the camera screen (booth v2, contract A7) at 390 x 844 (2x) and 1280 x 800, in
 * Arabic and English, walked with the synthetic trace source (?e2eTrace=): the outline, the start
 * position and its hold, measuring the range, the range ready, the count, a
 * coaching cue, the effort question and the summary. Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/booth-v2/engine npm run e2e -- workout-camera-shots
 *
 * Files are <lang>-<m|d>-<nn>-<name>.png.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

type Lang = "ar" | "en";
const SIZES = [
  { tag: "m", width: 390, height: 844, scale: 2, mobile: true },
  { tag: "d", width: 1280, height: 800, scale: 1, mobile: false },
] as const;
const LANGS: Lang[] = ["ar", "en"];

async function openTrial(page: Page, lang: Lang, trace: string) {
  await page.goto(`/?try=1&e2eTrace=${trace}${lang === "en" ? "&lang=en" : ""}`);
  await page.locator(".try-pose").nth(1).click();
  await page.locator(".try-actions .cta").click();
  await page.locator(".try-start").click();
  await expect(page.locator(".cam2")).toBeVisible();
}

const atStage = (page: Page, stage: string, timeout = 30_000) =>
  expect(page.locator(".cam2")).toHaveAttribute("data-stage", stage, { timeout });

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`camera screen shots ${lang} ${size.tag}`, async ({ browser }) => {
      test.setTimeout(240_000);
      mkdirSync(OUT, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.mobile,
        isMobile: size.mobile,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (typeof speechSynthesis !== "undefined")
          Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
      });
      let n = 0;
      const shot = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        n += 1;
        await page.screenshot({
          path: join(OUT, `${lang}-${size.tag}-${String(n).padStart(2, "0")}-${name}.png`),
          animations: "disabled",
        });
      };

      await openTrial(page, lang, "nobody");
      await atStage(page, "framing");
      await page.waitForTimeout(600);
      await shot("outline");

      await openTrial(page, lang, "nasser");
      await atStage(page, "start");
      await page.waitForTimeout(800);
      await shot("start-position");
      await expect(page.locator(".cam2-start.holding")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(450);
      await shot("start-hold");
      await atStage(page, "calibrating");
      await expect(page.locator(".cam2-dots i.on")).toHaveCount(1, { timeout: 15_000 });
      await page.waitForTimeout(700);
      await shot("measuring");
      // D-038 item 3: no recorded voice and no speaker button in the trial.
      await atStage(page, "training");
      await page.waitForTimeout(900);
      await shot("range-ready");
      await expect(page.locator(".cam2")).toHaveAttribute("data-count", "3", { timeout: 20_000 });
      await expect(page.locator(".cam2-caption")).toHaveCount(0, { timeout: 10_000 });
      await shot("count");
      await expect(page.locator("#rpe-title")).toBeVisible({ timeout: 30_000 });
      await page.locator(".rpe-btn").nth(4).click();
      await shot("effort");
      await page.locator(".modal-actions .cta").click();
      await expect(page.locator("#sum-title")).toBeVisible();
      await shot("summary");

      await openTrial(page, lang, "lean");
      await atStage(page, "training");
      await expect(page.locator(".cam2-caption.warn")).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(500);
      await shot("coaching-cue");
      await context.close();
    });
  }
}
