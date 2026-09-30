/**
 * Review screenshots of the flow screens S04 to S33 and S35 (UX spec definition of done): every
 * screen and state at 375 x 812 and 1440 x 900, in Arabic and English, booth and home variants, the
 * states a person reaches by interaction (hints, selections, the sound check's No answers, the skip
 * dialog), offline, Sound off, and the camera denied steps per browser. Runs only with AZM_SHOTS_DIR:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/flow AZM_E2E_PORT=<port> npm run e2e -- flow-shots
 *
 * Each state opens through the check's reload snapshot (e2e/flow-models.ts, built in the page by the
 * real reducer). Files are <lang>-<m|d>-<state>.png (m 375 x 812 at 2x, d 1440 x 900).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import { signUpAddress } from "./sign-up";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

const COPY = { ar, en } as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2, mobile: true },
  { tag: "d", width: 1440, height: 900, scale: 1, mobile: false },
] as const;
type Size = (typeof SIZES)[number];

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36";

const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/**
 * A whole page shot: the viewport is made as tall as the page, so the sticky bars are drawn where a
 * person sees them. Dialogs are shot at the viewport size (their scrim covers it).
 */
async function shot(page: Page, lang: Lang, size: Size, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize()!;
  if (fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > viewport.height) await page.setViewportSize({ width: viewport.width, height });
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${lang}-${size.tag}-${name}.png`), animations: "disabled" });
  await page.setViewportSize(viewport);
}

/** Opens a named state of e2e/flow-models.ts through the check's reload snapshot. */
async function openState(page: Page, name: string, lang: Lang) {
  await page.goto("/?e2eGallery=loading");
  const info = await page.evaluate(async (name) => {
    const path = "/e2e/flow-models.ts";
    const mod = await import(/* @vite-ignore */ path);
    mod.setWalkClock(Date.now());
    const s = mod.FLOW_STATES[name];
    // As a reload snapshot is saved (snapshotOf): no effects. A built state still lists the start
    // call it was waiting on; sent on mount, the E2E server's answer (home checks closed) would take
    // a signed in S17 state to Today before it is read.
    sessionStorage.setItem("azm.check.snapshot", JSON.stringify({ ...s.build(), effects: [] }));
    if (s.mode === "guest" && s.booth !== false) sessionStorage.setItem("azm.booth", "e2e-booth");
    else sessionStorage.removeItem("azm.booth");
    return { mode: s.mode as string, screen: s.screen as string };
  }, name);
  await page.goto(url(info.mode === "guest" ? "/?check=1" : "/", lang));
  await expect(page.locator(`[data-screen="${info.screen}"]`).first()).toBeVisible();
  // The entry lines start 800 ms after focus moves; the shot shows the screen with its caption.
  await page.waitForTimeout(1000);
  return info;
}

async function stateNames(page: Page): Promise<string[]> {
  await page.goto("/?e2eGallery=loading");
  return page.evaluate(async () => {
    const path = "/e2e/flow-models.ts";
    const mod = await import(/* @vite-ignore */ path);
    return Object.keys(mod.FLOW_STATES);
  });
}

/** A throwaway signed in account (signed in states render inside the app). */
async function signIn(page: Page, tag: string) {
  await page.goto("/?e2eGallery=loading");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Sara",
      email: `flow-shots-${tag}-${Date.now()}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
}

async function newPage(browser: Browser, size: Size, userAgent?: string) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.mobile,
    isMobile: size.mobile,
    ...(userAgent ? { userAgent } : {}),
  });
  return { context, page: await context.newPage() };
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    test(`flow shots ${lang} ${size.tag}: every named state`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await newPage(browser, size);
      await signIn(page, `${lang}${size.tag}`);
      for (const name of await stateNames(page)) {
        await openState(page, name, lang);
        await shot(page, lang, size, name);
      }
      await context.close();
    });

    test(`flow shots ${lang} ${size.tag}: states reached by interaction`, async ({ browser }) => {
      test.setTimeout(10 * 60_000);
      mkdirSync(OUT, { recursive: true });
      const t = COPY[lang];
      const { context, page } = await newPage(browser, size);
      await signIn(page, `${lang}${size.tag}i`);
      const footerNext = () => page.locator(".check-footer .cta").first();

      // S08: Next without a choice (the hint), and none chosen.
      await openState(page, "S08-conditions", lang);
      await footerNext().click();
      await shot(page, lang, size, "S08-conditions-hint");
      await page.locator(".check-answer").first().click();
      await shot(page, lang, size, "S08-conditions-none-chosen");

      // S12: Continue without the tick.
      await openState(page, "S12-consent", lang);
      await footerNext().click();
      await shot(page, lang, size, "S12-consent-required");
      // S12 offline: the tick, then Continue with no connection.
      await page.locator(".flow-consent-row").click();
      await context.setOffline(true);
      await footerNext().click();
      await expect(page.locator(".flow-inline-error")).toBeVisible();
      await shot(page, lang, size, "S12-consent-offline");
      await context.setOffline(false);

      // S14b: No once, then No again.
      await openState(page, "S14b-sound-check", lang);
      const no = page.locator(".check-answer").nth(1);
      await no.click();
      await shot(page, lang, size, "S14b-sound-check-no");
      await no.click();
      await shot(page, lang, size, "S14b-sound-check-still-off");

      // S19: Next without a value, then a value with its readout.
      await openState(page, "S19-pain-now", lang);
      await footerNext().click();
      await shot(page, lang, size, "S19-pain-now-hint");
      await page.locator(".flow-scale-cell").nth(7).click();
      await shot(page, lang, size, "S19-pain-now-chosen");

      // S20: an area chosen opens its own scale; Next before its score.
      await openState(page, "S20-pain-areas", lang);
      await page.locator(".flow-areas .check-answer").nth(0).click();
      await page.locator(".flow-areas .check-answer").nth(4).click();
      await page.locator(".flow-area.is-on .flow-scale-cell").nth(3).click();
      await footerNext().click();
      await shot(page, lang, size, "S20-pain-areas-scales");

      // S24: an area chosen.
      await openState(page, "S24-surgery-areas", lang);
      await page.locator(".check-answer").nth(3).click();
      await shot(page, lang, size, "S24-surgery-areas-chosen");

      // S17 offline: the banner; answering goes on.
      await openState(page, "S17-urgent", lang);
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.locator("p.check-offline").first()).toBeVisible();
      await shot(page, lang, size, "S17-urgent-offline");
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      // Sound off on a question: the alert tone line under the top bar.
      await openState(page, "S17-unwell-home-examples", lang);
      await page.getByRole("button", { name: t.common.sound }).first().click();
      await shot(page, lang, size, "S17-unwell-home-sound-off");

      // S28: the skip dialog; the chair gate answered yes.
      await openState(page, "S28-arm-raise-booth", lang);
      await page.getByRole("button", { name: t.common.skipTest }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, lang, size, "S28-skip-dialog", false);
      await openState(page, "S28-chair-stand-home-gate", lang);
      await page.locator(".flow-gate .check-answer").first().click();
      await shot(page, lang, size, "S28-chair-stand-home-gate-yes");

      // S30: the bottle sizes, and the kilogram stepper.
      await openState(page, "S30-load", lang);
      await footerNext().click();
      await shot(page, lang, size, "S30-load-hint");
      await page.locator(".flow-load-row .check-answer").nth(1).click();
      await page.getByRole("radio").nth(1).click();
      await shot(page, lang, size, "S30-load-bottle");
      await page.locator(".flow-load-row .check-answer").nth(0).click();
      await page.getByRole("button", { name: t.load.increase }).click();
      await shot(page, lang, size, "S30-load-dumbbell");

      // S31: the camera request in flight (busy).
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
      });
      await openState(page, "S31-primer-home", lang);
      await page.getByRole("button", { name: t.primer.allow }).click();
      await shot(page, lang, size, "S31-primer-busy");
      await context.close();

      // S32 denied: the steps of each browser.
      for (const [platform, ua] of [
        ["ios", IPHONE],
        ["android", ANDROID],
        ["samsung", SAMSUNG],
      ] as const) {
        const p = await newPage(browser, size, ua);
        await openState(p.page, "S32-camera-denied", lang);
        await shot(p.page, lang, size, `S32-camera-denied-${platform}`);
        await p.context.close();
      }
    });
  }
}
