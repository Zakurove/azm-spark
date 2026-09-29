/**
 * Review screenshots of S34, the camera sequence (UX spec definition of done): every part and state
 * at 375 x 812, 375 x 667 (compact) and 1440 x 900, in Arabic and English, plus the live screen with
 * the fixture camera, offline, sound off and the stop list over the stage. Runs only with
 * AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/camera npm run e2e -- camera-shots
 *
 * Files are <lang>-<m|c|d>-<name>.png (m 375 x 812 at 2x, c 375 x 667 at 2x, d 1440 x 900).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_NAMES } from "../src/features/assessment/camera/e2e/previews";
import { camModel, url, type Lang } from "./camera-fixtures";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "c", width: 375, height: 667, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
const LANGS: Lang[] = ["ar", "en"];

/** The camera stage is fixed to the viewport: a viewport shot is what the person sees. */
async function shot(page: Page, lang: Lang, tag: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${lang}-${tag}-${name}.png`), animations: "disabled" });
}

/** Seeds a guest check at the arm raise setup check on every load of this page. */
async function seedEveryLoad(
  page: Page,
  state: Record<string, unknown> = { kind: "cam.setup", i: 0, side: 0 },
) {
  await page.addInitScript(
    ([m]) => {
      if (typeof speechSynthesis !== "undefined")
        Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
      sessionStorage.setItem("azm.booth", "e2e-booth");
      sessionStorage.setItem("azm.check.snapshot", m);
    },
    [camModel(state)],
  );
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`camera shots ${lang} ${size.tag}`, async ({ browser }) => {
      test.setTimeout(300_000);
      mkdirSync(OUT, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag !== "d",
        isMobile: size.tag !== "d",
      });
      const page = await context.newPage();
      await seedEveryLoad(page);

      for (const name of PREVIEW_NAMES) {
        await page.goto(url(`/?check=1&e2eCamPreview=${name}`, lang));
        await expect(page.locator(".s34-stage")).toBeVisible();
        await shot(page, lang, size.tag, `S34-${name}`);
      }

      // Sound off: Large captions turn on by default and the alert line shows (4.3).
      await page.goto(url(`/?check=1&e2eCamPreview=timed-curl`, lang));
      await page.locator(".s34-top button[aria-pressed]").first().click();
      await expect(page.locator(".s34-sound-note")).toBeVisible();
      await shot(page, lang, size.tag, "S34-state-sound-off");

      // Offline: the check keeps running; a small pill in the top bar (S34 Off).
      await page.goto(url(`/?check=1&e2eCamPreview=range-raise`, lang));
      await expect(page.locator(".s34-stage")).toBeVisible();
      await context.setOffline(true);
      await expect(page.locator(".s34-pill.is-offline")).toBeVisible();
      await shot(page, lang, size.tag, "S34-state-offline");
      await context.setOffline(false);

      // The live screen with the fixture camera: nobody in the picture, then a person at setup.
      await page.goto(url(`/?check=1&e2eFixture=empty&e2eCamFast=1`, lang));
      await expect(page.locator(".s34-band.is-none")).toBeVisible({ timeout: 15_000 });
      await shot(page, lang, size.tag, "S34-live-setup-empty");
      const shape = size.tag === "d" ? "16x9" : "9x16";
      await page.goto(url(`/?check=1&e2eCamFixture=abd-${shape}&e2eCamFast=1`, lang));
      await expect(
        page.locator(".check-base[data-state='cam.practice'], .check-base[data-state='cam.measure']"),
      ).toBeVisible({
        timeout: 30_000,
      });
      await shot(page, lang, size.tag, "S34-live-practice");
      // STOP opens the stop list over the stage (S41, the safety stream's overlay).
      await page.locator(".s34-stop").click();
      await expect(page.locator(".check-overlay[data-overlay='S41']")).toBeVisible();
      await shot(page, lang, size.tag, "S34-live-stop");
      await context.close();
    });
  }
}
