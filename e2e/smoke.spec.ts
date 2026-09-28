/**
 * Round 3 foundation smoke (contract v3 K, J): the landing, the closed check (/?check=1 without booth
 * mode), the example stub (/?example=progress), the booth staff stub (/?booth=1) and the new results
 * page in the portal nav render in Arabic and English with the right lang and dir, and no console
 * error. The account is a throwaway on the run's temporary database.
 */
import { expect, test, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import arProgress from "../src/i18n/ar/progress.json" with { type: "json" };
import enProgress from "../src/i18n/en/progress.json" with { type: "json" };
import arLanding from "../src/i18n/ar/landing.json" with { type: "json" };
import enLanding from "../src/i18n/en/landing.json" with { type: "json" };

const COPY = {
  ar: { a: ar, p: arProgress, l: arLanding },
  en: { a: en, p: enProgress, l: enLanding },
} as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/** Console errors, except the expected 401 of /api/auth/me for a visitor who is not signed in. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("401") && m.location().url.includes("/api/auth/me")) return;
    errors.push(`${m.text()} @ ${m.location().url}`);
  });
  return errors;
}

async function expectDocument(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

for (const lang of LANGS) {
  test.describe(`foundation smoke (${lang})`, () => {
    test("landing", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url("/", lang));
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByRole("link", { name: COPY[lang].l.actions.tryCheck }).first()).toBeVisible();
      await expectDocument(page, lang);
      expect(errors).toEqual([]);
    });

    test("/?check=1 without booth mode shows the closed screen (S05b)", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?check=1", lang));
      const h1 = page.locator("h1");
      await expect(h1).toHaveText(COPY[lang].a.guest.boothOnly.title);
      await expect(h1).toBeFocused();
      await expect(page.locator(".azm-check")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.getByRole("button", { name: COPY[lang].a.guest.boothOnly.example })).toBeVisible();
      // "Watch a demo" names where it goes (UX spec S05b, WCAG 2.4.4).
      await expect(page.getByRole("button", { name: COPY[lang].a.camera.demo })).toBeVisible();
      // Targets are at least 48 px.
      for (const b of await page.locator(".azm-check button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(48);
      }
      await page.getByRole("button", { name: COPY[lang].a.guest.boothOnly.example }).click();
      await expect(page).toHaveURL(/example=progress/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY[lang].p.example.title);
      expect(errors).toEqual([]);
    });

    test("/?check=1 in booth mode opens the guest check; Exit asks first (S15)", async ({ page }) => {
      const errors = watchConsole(page);
      await page.addInitScript(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(url("/?check=1", lang));
      // A desktop without touch gets the phone interstitial first (S04), with the booth badge.
      await expect(page.locator("h1")).toHaveText(COPY[lang].a.desktop.title);
      await expect(page.locator(".check-topbar .check-booth-badge")).toContainText(
        COPY[lang].a.guest.boothBadge,
      );
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      await page.getByRole("button", { name: COPY[lang].a.common.exit }).click();
      const dialog = page.getByRole("dialog", { name: COPY[lang].a.exit.title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(COPY[lang].a.exit.bodyGuest)).toBeVisible();
      await expect(dialog.getByRole("button", { name: COPY[lang].a.exit.stay })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.locator("h1")).toHaveText(COPY[lang].a.desktop.title);
      expect(errors).toEqual([]);
    });

    test("/?example=progress stub is labelled as an example", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?example=progress", lang));
      await expect(page.getByText(COPY[lang].p.example.banner)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY[lang].p.example.title);
      await expect(page.getByRole("img", { name: "عزم Azm" })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("/?booth=1 staff stub: the booth badge only once booth mode is on (S55, S57)", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?booth=1", lang));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY[lang].a.booth.title);
      // Before a code is verified the device is not in booth mode, so no badge and no Sound.
      await expect(page.locator(".check-booth-badge")).toHaveCount(0);
      await expect(page.getByRole("button", { name: COPY[lang].a.common.sound })).toHaveCount(0);
      await page.evaluate(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.reload();
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the results page is in the portal nav, and Today holds the check slot", async ({ page }) => {
      const errors = watchConsole(page);
      const headers = {
        Origin: new URL(page.url() === "about:blank" ? "http://127.0.0.1" : page.url()).origin,
      };
      await page.goto(url("/", lang));
      headers.Origin = new URL(page.url()).origin;
      const email = `e2e-${lang}-${Date.now()}@example.test`;
      const secret = `${crypto.randomUUID()}Aa1`;
      const reg = await page.request.post("/api/auth/register", {
        headers: { ...headers, "X-Azm-Request": "1" },
        data: { name: "E2E Member", email, password: secret },
      });
      expect(reg.status()).toBe(200);
      const intake = await page.request.put("/api/intake", {
        headers: { ...headers, "X-Azm-Request": "1" },
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
      await page.goto(url("/", lang));
      // Today: the movement check slot (S01) after the next session card.
      await expect(page.locator('[data-screen="S01"]')).toBeVisible();
      await expect(page.locator('[data-screen="S01"] h2')).toHaveText(COPY[lang].a.name);
      const nav = page.locator(".portal-sidebar nav");
      await nav.getByRole("button", { name: COPY[lang].p.nav.label }).click();
      await expect(page.locator(".portal-topbar")).toContainText(COPY[lang].p.nav.label);
      await expect(page.locator('[data-screen="S53"] h2')).toHaveText(COPY[lang].p.checks.heading);
      // The other portal pages still work.
      await nav.locator("button").nth(1).click();
      await expect(page.locator(".plan-card")).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

test("the fixture pose source plays frames on the E2E build (contract v3 K)", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/?e2eGallery=fixture&e2eFixture=seated-raise&lang=en");
  const meter = page.locator("[data-frames]");
  await expect(meter).toHaveAttribute("data-source", "FixturePoseSource");
  await expect
    .poll(async () => Number(await meter.getAttribute("data-frames")), { timeout: 5000 })
    .toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
