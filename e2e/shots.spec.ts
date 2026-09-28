/**
 * Review screenshots of the round 3 foundation (UX spec definition of done): every foundation screen
 * and state at 375 x 812 and 1440 x 900, in Arabic and English. Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3-foundation npm run e2e -- shots
 *
 * Files are <lang>-<m|d>-<name>.png (m 375 x 812 at 2x, d 1440 x 900).
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
  "offer",
];
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
const LANGS = ["ar", "en"] as const;
const q = (path: string, lang: string) => (lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path);

async function shot(page: Page, lang: string, tag: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${lang}-${tag}-${name}.png`), fullPage: true, animations: "disabled" });
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`shots ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag === "m",
        isMobile: size.tag === "m",
      });
      const page = await context.newPage();

      for (const name of GALLERY) {
        const page_ = name === "multi-hint" ? "multi" : name;
        await page.goto(q(`/?e2eGallery=${page_}`, lang));
        await expect(page.locator(".azm-check").first()).toBeVisible();
        if (name === "multi-hint") await page.locator(".check-footer .cta").click();
        await shot(page, lang, size.tag, `gallery-${name}`);
      }

      await page.goto(q("/?check=1", lang));
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, lang, size.tag, "S05b-check-closed");

      await page.goto(q("/?example=progress", lang));
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, lang, size.tag, "S54-example-stub");

      await page.goto(q("/?booth=1", lang));
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, lang, size.tag, "S55-booth-stub");

      // Booth mode on this tab: the guest check opens (S04 on a desktop, else S05).
      await page.evaluate(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(q("/?check=1", lang));
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, lang, size.tag, size.tag === "d" ? "S04-desktop-stub" : "S05-guest-welcome-stub");
      await page.evaluate(() => sessionStorage.removeItem("azm.booth"));

      // Signed in: Today with the check slot (S01) and the results page (S53).
      const origin = new URL(page.url()).origin;
      const headers = { Origin: origin, "X-Azm-Request": "1" };
      const reg = await page.request.post("/api/auth/register", {
        headers,
        data: { name: "Sara", email: `shots-${lang}-${size.tag}-${Date.now()}@example.test`, password: `${crypto.randomUUID()}Aa1` },
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
      await page.goto(q("/", lang));
      await expect(page.locator('[data-screen="S01"]')).toBeVisible();
      await page.locator('[data-screen="S01"]').scrollIntoViewIfNeeded();
      await shot(page, lang, size.tag, "S01-today-slot");
      await page.locator(".portal-sidebar nav button").nth(2).click();
      await expect(page.locator('[data-screen="S53"]')).toBeVisible();
      await shot(page, lang, size.tag, "S53-results-page-stub");
      await context.close();
    });
  }
}
