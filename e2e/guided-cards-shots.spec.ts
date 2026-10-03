/**
 * Review screenshots of booth v2, contract D (guided cards), for Saad (D-018): the Program week with
 * an item open as its card, the session list in its parts, a warm up hold (ready, running), its
 * effort, the camera part's opening screen, a counted card (taps, then the rest between sets), and a
 * card done in My results; Arabic and English at 390 x 844 (m), with the hold card at 1280 x 800 (d).
 * Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/booth-v2/cards AZM_E2E_PORT=<port> npm run e2e -- guided-cards-shots
 *
 * The page clock is installed so a hold and a rest pass at once; the camera sets are saved through
 * the API (the camera screen has its own shots), and the session resumes on the day's exercises.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { guidedCopy } from "../src/app/guided-copy";
import { sessionSteps, type SessionDay } from "../src/medical/session";
import type { Plan } from "../src/medical/plan";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const PHONE = { tag: "m", width: 390, height: 844, scale: 2, mobile: true } as const;
const DESK = { tag: "d", width: 1280, height: 800, scale: 1, mobile: false } as const;
type Size = typeof PHONE | typeof DESK;
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/** Saad (D-018): 22, incomplete spinal cord injury, a wheelchair user, back to wheelchair basketball. */
const SAAD = {
  age: 22,
  conditions: ["sci_incomplete"],
  diagnosisNotes: "",
  medications: "",
  mobility: "wheelchair",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["weights", "bands"],
  goal: "sport",
  sport: "wheelchair_basketball",
  days: [0, 1, 2, 3],
  time: "17:00",
  sessionMinutes: 40,
  consent: true,
};

let address = 0;
async function newPage(browser: Browser, size: Size): Promise<Page> {
  address += 1;
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.23.${address % 250}.${1 + Math.floor(address / 250)}` },
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.mobile,
    isMobile: size.mobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.clock.install();
  return page;
}

async function account(page: Page, lang: Lang) {
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: lang === "ar" ? "سعد" : "Saad",
      email: `cards-shots-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  expect((await page.request.put("/api/intake", { headers, data: SAAD })).status()).toBe(200);
  await page.goto(url("/", lang));
}

async function shot(page: Page, lang: Lang, size: Size, name: string) {
  // No hover state left where the last tap was.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${lang}-${size.tag}-${name}.png`), animations: "disabled" });
}

/** Saves the camera sets of the active run through the API, so the session resumes after them. */
async function passCameraPart(page: Page) {
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const me = await (await page.request.get("/api/auth/me")).json();
  const run = await (
    await page.request.post("/api/workouts", {
      headers,
      data: { version: me.plan.version, demo: false, guided: true, weekday: new Date().getDay() },
    })
  ).json();
  const steps = sessionSteps(run.plan as Plan, run.today as SessionDay);
  for (let i = run.nextIndex; steps[i]?.kind === "camera"; i++) {
    const step = steps[i];
    if (step.kind !== "camera") break;
    const r = await page.request.post(`/api/workouts/${run.id}/sets`, {
      headers,
      data: {
        index: i,
        summary: {
          exerciseId: step.prescription.exerciseId,
          reps: { valid: step.prescription.reps, compensated: 0, partial: 0 },
          rpe: 4,
          romPct: 90,
        },
        moments: Array.from({ length: step.prescription.reps }, () => ({
          cls: "valid",
          durSec: 2.4,
          peakPct: 0.9,
        })),
      },
    });
    expect(r.status()).toBe(200);
  }
}

for (const lang of LANGS)
  test(`guided card shots ${lang} m`, async ({ browser }) => {
    test.setTimeout(150_000);
    const g = guidedCopy(lang);
    const size = PHONE;
    const page = await newPage(browser, size);
    await account(page, lang);
    const nav = page.locator(".portal-sidebar nav button");

    // The Program week: an item of the day's exercises open as its card.
    await nav.nth(1).click();
    await expect(page.locator(".weekly-block").first()).toBeVisible({ timeout: 20_000 });
    const extra = page.locator(".weekly-block").nth(2).locator(".weekly-item").first();
    await extra.locator("summary").click();
    await extra.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await shot(page, lang, size, "01-program-week-card");

    // Today: Start; the session list in its parts.
    await nav.nth(0).click();
    await page.locator(".next-workout .cta").click();
    await expect(page.locator(".workout-queue-group")).toHaveCount(4);
    await page.locator(".workout-queue").scrollIntoViewIfNeeded();
    await shot(page, lang, size, "02-session-list");

    // The first warm up card: a hold, ready, then running, then its effort.
    await page.locator(".interval-page .cta").click();
    const card = page.locator(".gcard");
    await expect(card).toHaveAttribute("data-kind", "timer");
    await shot(page, lang, size, "03-card-hold");
    await page.getByRole("button", { name: g.start }).click();
    await page.clock.fastForward(5_000);
    await expect(card).toHaveAttribute("data-phase", "running");
    await shot(page, lang, size, "04-card-hold-running");
    await page.clock.fastForward(60_000);
    await expect(card).toHaveAttribute("data-phase", "effort");
    await page.locator(".gcard-rpe button").nth(4).click();
    await shot(page, lang, size, "05-card-effort");
    await page.getByRole("button", { name: g.done }).click();

    // The second warm up card skipped: the camera part's opening screen.
    await page.getByRole("button", { name: g.skipExercise }).click();
    await expect(page.locator(".workout-camera-kicker")).toBeVisible();
    await shot(page, lang, size, "06-camera-part");

    // The camera sets saved; the session resumes on the day's exercises: a counted card.
    await passCameraPart(page);
    await page.goto(url("/", lang));
    await page.locator(".next-workout .cta").click();
    await expect(card).toHaveAttribute("data-slot", "extra");
    for (let i = 0; i < 4 && (await card.getAttribute("data-kind")) !== "counter"; i++) {
      const before = await page.locator(".gcard-slot b").textContent();
      await page.getByRole("button", { name: g.skipExercise }).click();
      await expect(page.locator(".gcard-slot b")).not.toHaveText(before!);
    }
    await expect(card).toHaveAttribute("data-kind", "counter");
    const reps = Number(await card.getAttribute("data-reps"));
    const tap = page.locator(".gcard-tap");
    for (let r = 0; r < 3; r++) await tap.click();
    await shot(page, lang, size, "07-card-counter");
    for (let r = 3; r < reps; r++) await tap.click();
    await expect(card).toHaveAttribute("data-phase", "rest");
    await page.clock.fastForward(4_000);
    await shot(page, lang, size, "08-card-rest");

    // My results: the card done, with its seconds held.
    await page.goto(url("/", lang));
    await nav.nth(2).click();
    const history = page.locator('.history-record[data-mode="guided"]').first();
    await expect(history).toBeVisible({ timeout: 20_000 });
    await history.locator("button").click();
    await history.scrollIntoViewIfNeeded();
    await shot(page, lang, size, "09-results-card-done");
    await page.context().close();
  });

for (const lang of LANGS)
  test(`guided card shots ${lang} d`, async ({ browser }) => {
    test.setTimeout(90_000);
    const page = await newPage(browser, DESK);
    await account(page, lang);
    await page.locator(".next-workout .cta").click();
    await page.locator(".interval-page .cta").click();
    await expect(page.locator(".gcard")).toBeVisible();
    await shot(page, lang, DESK, "03-card-hold");
    await page.context().close();
  });
