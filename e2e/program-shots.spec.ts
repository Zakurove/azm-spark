/**
 * Review screenshots of booth v2, contract B (program, sport and copy): the intake goal step with the
 * sport grid, the Program page with the sport path card, the report panel and the navigation (the
 * bottom tab bar on a phone, the sidebar on desktop), in Arabic and English at 390 x 844 (m) and
 * 1280 x 800 (d). Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/booth-v2/program AZM_E2E_PORT=<port> npm run e2e -- program-shots
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const SIZES = [
  { tag: "m", width: 390, height: 844, scale: 2, mobile: true },
  { tag: "d", width: 1280, height: 800, scale: 1, mobile: false },
] as const;
type Size = (typeof SIZES)[number];
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
  equipment: ["weights"],
  goal: "sport",
  sport: "wheelchair_basketball",
  days: [0, 2, 4],
  time: "17:00",
  sessionMinutes: 40,
  consent: true,
};

let address = 0;
async function newPage(browser: Browser, size: Size): Promise<Page> {
  address += 1;
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.22.${address % 250}.${1 + Math.floor(address / 250)}` },
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.mobile,
    isMobile: size.mobile,
    reducedMotion: "reduce",
  });
  return context.newPage();
}

async function account(page: Page, lang: Lang, intake?: Record<string, unknown>) {
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: lang === "ar" ? "سعد" : "Saad",
      email: `program-shots-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  if (intake) expect((await page.request.put("/api/intake", { headers, data: intake })).status()).toBe(200);
  await page.goto(url("/", lang));
}

async function shot(page: Page, lang: Lang, size: Size, name: string) {
  // No hover state left where the last tap was.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${lang}-${size.tag}-${name}.png`), animations: "disabled" });
}

/** Scrolls so the element's top sits just under the page top (or the phone header). */
async function scrollTo(page: Page, selector: string, offset = 16) {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel as string)!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (off as number));
    },
    [selector, offset] as const,
  );
}

for (const lang of LANGS)
  for (const size of SIZES)
    test(`program shots ${lang} ${size.tag}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await newPage(browser, size);

      // The intake: the report panel on step 1, then the goal step with the sport grid.
      await account(page, lang);
      await page.locator(".age-field input").fill("22");
      await page.locator(".conditions-grid button").nth(5).click();
      await page.locator(".report-open").click();
      await scrollTo(page, ".report-upload", 24);
      await shot(page, lang, size, "report-panel");
      await page.locator(".report-upload .report-foot .text-button").click();
      await page.locator(".intake-actions .cta").click();
      await page.locator(".intake-card select").first().selectOption("wheelchair");
      const answers = page.locator(".intake-question select");
      await answers.nth(0).selectOption("no");
      await answers.nth(1).selectOption("no");
      await answers.nth(2).selectOption("yes");
      await page.locator(".intake-actions .cta").click();
      await page.locator(".goal-card").nth(3).click();
      await page.locator(".sport-tile").first().click();
      await scrollTo(page, ".intake-card h2", 20);
      await shot(page, lang, size, "intake-goal");
      await scrollTo(page, ".sport-pick", 20);
      await shot(page, lang, size, "intake-sport-grid");

      // The Program page of Saad: the sport path card, then why this program.
      await page.context().clearCookies();
      await account(page, lang, SAAD);
      await page.locator(".portal-sidebar nav button").nth(1).click();
      await expect(page.locator(".weekly-block").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".sport-path-wait")).toHaveCount(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, lang, size, "program-sport-path");
      await scrollTo(page, ".plan-notes", size.mobile ? 80 : 24);
      await shot(page, lang, size, "program-why");

      // The navigation on Today: the bottom tab bar on a phone, the sidebar on desktop.
      await page.locator(".portal-sidebar nav button").nth(0).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, lang, size, "nav-today");
      await page.locator(".portal-sidebar nav button").nth(3).click();
      await shot(page, lang, size, "nav-condition");
      await page.context().close();
    });
