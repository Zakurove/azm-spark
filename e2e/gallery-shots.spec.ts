/**
 * Review screenshots of the shared shell states of the check (the foundation gallery, VITE_E2E
 * builds only): the question and multiple choice shell, loading, empty, error, offline, Sound off,
 * the booth badge, each camera problem and the leave dialogs (S15), at 375 x 812, 320 x 640 and
 * 1440 x 900, in Arabic and English. Every screen has its own shots spec (flow, camera, safety,
 * results, booth); this one takes only what they do not. Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/<folder> npm run e2e -- gallery-shots
 *
 * Files are <lang>-<m|s|d>-gallery-<name>.png (m 375 x 812 at 2x, s 320 x 640 at 2x, d 1440 x 900).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

const GALLERY = [
  "question",
  "multi",
  "multi-hint",
  "loading",
  "empty",
  "error",
  "offline",
  "soundOff",
  "booth",
  "camera-denied-ios",
  "camera-denied-android",
  "camera-denied-samsung",
  "camera-denied-other",
  "camera-none",
  "camera-busy",
  "camera-stopped",
  "leave-before",
  "leave-during",
  "leave-guest",
];
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "s", width: 320, height: 640, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
const LANGS = ["ar", "en"] as const;
const q = (path: string, lang: string) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/**
 * A whole page shot: the viewport is made as tall as the page for the shot, so the sticky top bar and
 * footer are drawn where a person sees them (a plain full page capture draws them where the viewport
 * was). A dialog is shot at the viewport size, as the person sees it (its scrim covers the viewport).
 */
async function shot(page: Page, lang: string, tag: string, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize()!;
  if (fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > viewport.height) await page.setViewportSize({ width: viewport.width, height });
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${lang}-${tag}-${name}.png`), animations: "disabled" });
  await page.setViewportSize(viewport);
}
const DIALOGS = new Set(["leave-before", "leave-during", "leave-guest"]);

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`gallery shots ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag !== "d",
        isMobile: size.tag !== "d",
      });
      const page = await context.newPage();
      for (const name of GALLERY) {
        const page_ = name === "multi-hint" ? "multi" : name;
        await page.goto(q(`/?e2eGallery=${page_}`, lang));
        await expect(page.locator(".azm-check").first()).toBeVisible();
        if (name === "multi-hint") await page.locator(".check-footer .cta").click();
        await shot(page, lang, size.tag, `gallery-${name}`, !DIALOGS.has(name));
      }
      await context.close();
    });
  }
}
