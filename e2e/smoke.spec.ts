/**
 * Round 3 foundation smoke (contract v3 K, J): the landing, the closed check (/?check=1 without booth
 * mode), the example stub (/?example=progress), the booth staff stub (/?booth=1) and the new results
 * page in the portal nav render in Arabic and English with the right lang and dir, and no console
 * error; Start session opens the workout's one setup screen (C48). The account is a throwaway on the
 * run's temporary database.
 */
import { expect, test, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import arProgress from "../src/i18n/ar/progress.json" with { type: "json" };
import enProgress from "../src/i18n/en/progress.json" with { type: "json" };
import arLanding from "../src/i18n/ar/landing.json" with { type: "json" };
import enLanding from "../src/i18n/en/landing.json" with { type: "json" };
import { signUpAddress } from "./sign-up";
import { labels } from "../src/app/platform-copy";
import { camCopy } from "../src/app/camera-copy";
import { guidedCopy } from "../src/app/guided-copy";

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

/** A throwaway signed in account with a saved intake (seated, chair), on Today. */
async function signIn(page: Page, lang: Lang) {
  await page.goto(url("/", lang));
  const headers = { Origin: new URL(page.url()).origin };
  const email = `e2e-${lang}-${Date.now()}@example.test`;
  const secret = `${crypto.randomUUID()}Aa1`;
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, "X-Azm-Request": "1", ...signUpAddress() },
    data: { name: "E2E Member", email, password: secret, adultConfirmed: true },
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
}

for (const lang of LANGS) {
  test.describe(`foundation smoke (${lang})`, () => {
    test("landing", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url("/", lang));
      await expect(page.locator("h1").first()).toBeVisible();
      // C36: one gold action, Start free; the movement check action waits until the check can start.
      await expect(page.locator(".ld-hero-copy .cta")).toHaveText(COPY[lang].l.actions.startFree);
      await expect(page.getByRole("link", { name: COPY[lang].l.actions.tryCheck })).toHaveCount(0);
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
      // D-017 item 2: no "nothing is saved in this trial" note, the question and its two answers only.
      await expect(dialog.locator("p")).toHaveCount(0);
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

    test("/?booth=check staff stub (the parked check, booth v2): the booth badge only once booth mode is on (S55, S57)", async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?booth=check", lang));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY[lang].a.booth.title);
      // Before a code is verified the device is not in booth mode, so no badge and no Sound.
      await expect(page.locator(".check-booth-badge")).toHaveCount(0);
      await expect(page.getByRole("button", { name: COPY[lang].a.common.sound })).toHaveCount(0);
      await page.evaluate(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.reload();
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the results page is in the portal nav; Today shows no check card while home checks are closed", async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await signIn(page, lang);
      // Today keeps the check slot, but only the cards that start or resume a check show there (C43);
      // home checks are closed on the e2e server, so it stays empty.
      await expect(page.locator(".check-slot")).toBeAttached();
      await expect(page.locator('[data-screen="S01"]')).toHaveCount(0);
      const nav = page.locator(".portal-sidebar nav");
      await nav.getByRole("button", { name: COPY[lang].p.nav.label }).click();
      await expect(page.locator('[data-screen="S53"] h2')).toHaveText(COPY[lang].p.checks.heading);
      // The other portal pages still work.
      await nav.locator("button").nth(1).click();
      await expect(page.locator(".plan-card")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("Start session opens one setup screen, then the warm up (C48, booth v2 D)", async ({ page }) => {
      const errors = watchConsole(page);
      const c = labels(lang);
      await signIn(page, lang);
      await page.getByRole("button", { name: c.start }).first().click();
      // Setup: the full placement guide on the first session, the attestation line, no checkbox, no timer.
      await expect(page.locator(".interval-main h1")).toHaveText(camCopy(lang).placeReminder);
      await expect(page.locator(".place-tips li")).toHaveCount(camCopy(lang).tips.length);
      await expect(page.locator(".workout-attest")).toHaveText(c.attest);
      await expect(page.locator('input[type="checkbox"], [role="timer"], .section-kicker')).toHaveCount(0);
      // The program lists each exercise once.
      const rows = page.locator(".workout-queue > div");
      // Booth v2 (D): the Arabic row takes the Arabic comma (a middle dot reads as the zero «٠»).
      const sep = lang === "ar" ? "، " : " · ";
      await expect(rows.first()).toContainText(sep);
      const names = await rows.locator("strong").allTextContents();
      expect(new Set(names.map((n) => n.split(sep)[0])).size).toBe(names.length);
      const ready = page.getByRole("button", { name: c.ready });
      await expect(ready).toHaveAttribute("aria-describedby", "workout-attest");
      expect((await ready.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await ready.click();
      // Booth v2 (D): the warm up is the day's warm up cards, each a guided card with its own timer
      // and no set label of the camera part.
      const card = page.locator(".gcard");
      await expect(card).toHaveAttribute("data-slot", "warmup");
      await expect(page.locator(".gcard-slot")).toContainText(guidedCopy(lang).slot.warmup);
      await expect(page.locator('.gcard [role="timer"]')).toBeVisible();
      await expect(page.locator(".section-kicker")).toHaveCount(0);
      await expect(page.getByRole("button", { name: guidedCopy(lang).start })).toBeVisible();
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
