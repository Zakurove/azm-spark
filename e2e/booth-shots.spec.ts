/**
 * Review screenshots of the booth stream (UX spec definition of done): S55, S55b, S56, S57 and S58
 * in every state that applies, at 375 x 812 and 1440 x 900, in Arabic and English. Runs only with
 * AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/booth npm run e2e -- booth-shots
 *
 * Files are <lang>-<m|d>-<name>.png (m 375 x 812 at 2x, d 1440 x 900). The booth server answers are
 * routed, as in e2e/booth.spec.ts.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

const COPY = { ar, en } as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;
type Size = (typeof SIZES)[number];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;
const digits = (lang: Lang, n: number) =>
  lang === "ar" ? String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : String(n);

const SESSION = "a".repeat(64);
const QR_TOKEN = "d".repeat(64);
const VISITOR = "c".repeat(64);
const HOUR = 60 * 60 * 1000;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A whole page shot (the viewport grows to the page), or the viewport as the person sees a dialog. */
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

async function fresh(browser: Browser, size: Size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.tag === "m",
    isMobile: size.tag === "m",
  });
  return { context, page: await context.newPage() };
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const c = COPY[lang];

    test(`booth shots S55 ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await fresh(browser, size);
      let verify: unknown = { ok: false };
      let hold: Promise<void> | null = null;
      await page.route("**/api/booth/verify", async (r) => {
        if (hold) await hold;
        await json(r, verify);
      });
      await page.route("**/api/booth/token", (r) => json(r, { token: QR_TOKEN, expires: Date.now() + HOUR }));
      await page.goto(url("/?booth=1", lang));
      const code = page.getByLabel(c.booth.codeLabel);
      const turnOn = page.getByRole("button", { name: c.booth.turnOn });
      await expect(code).toBeVisible();
      await shot(page, lang, size, "s55-code");

      await code.fill("123456");
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.wrong);
      await shot(page, lang, size, "s55-error-wrong");

      verify = { ok: false, closed: true };
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.state.error.title);
      await shot(page, lang, size, "s55-error-closed");

      let release: () => void = () => undefined;
      hold = new Promise<void>((r) => (release = r));
      verify = { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR };
      // The first booth file is held, so the preparation line shows.
      let releaseFiles: () => void = () => undefined;
      const files = new Promise<void>((r) => (releaseFiles = r));
      await page.route("**/models/**", async (r) => {
        await files;
        await r.continue();
      });
      await turnOn.click();
      await expect(turnOn).toHaveAttribute("aria-busy", "true");
      await shot(page, lang, size, "s55-loading");
      release();
      hold = null;
      await expect(page.locator("[data-offline=preparing]")).toBeVisible();
      await shot(page, lang, size, "s55-on-preparing");
      releaseFiles();
      await expect(page.locator("[data-offline]")).toHaveCount(0, { timeout: 30_000 });
      await shot(page, lang, size, "s55-on");

      await page.getByRole("button", { name: c.booth.showVisitorQr }).click();
      await expect(page.locator("[data-visitor-qr] svg")).toBeVisible();
      await shot(page, lang, size, "s55-visitor-qr");

      await page.getByRole("button", { name: c.booth.turnOff }).click();
      await expect(code).toBeVisible();
      // Offline last, so the back online note of the other shots never covers a control.
      await code.fill("123456");
      await context.setOffline(true);
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.state.offline.startBlocked);
      await shot(page, lang, size, "s55-offline");
      await context.setOffline(false);

      await page.evaluate(() => sessionStorage.setItem("azm.booth.visitor", "1"));
      await page.reload();
      await expect(page.locator("[data-token-ended]")).toBeVisible();
      await shot(page, lang, size, "s55-visitor-phone-ended");
      await context.close();
    });

    test(`booth shots S55b ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await fresh(browser, size);
      let answer: "held" | "on" | "ended" | "abort" = "held";
      await page.route("**/api/booth/redeem", async (r) => {
        if (answer === "held") return; // never answered: the loading state stays
        if (answer === "abort") return r.abort("internetdisconnected");
        await json(
          r,
          answer === "on" ? { ok: true, token: VISITOR, expires: Date.now() + HOUR } : { ok: false },
        );
      });
      const tokenPage = url(`/?booth=1&e2eBooth=token&t=${QR_TOKEN}`, lang);
      await page.goto(tokenPage);
      await expect(page.locator('[data-phase="redeeming"]')).toBeVisible();
      await shot(page, lang, size, "s55b-loading");
      answer = "on";
      await page.goto(tokenPage);
      await expect(page.locator('[data-phase="on"]')).toBeVisible();
      await shot(page, lang, size, "s55b-on");
      answer = "ended";
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(tokenPage);
      await expect(page.locator('[data-phase="ended"]')).toBeVisible();
      await shot(page, lang, size, "s55b-ended");
      answer = "abort";
      await page.goto(tokenPage);
      await expect(page.locator('[data-phase="error"]')).toBeVisible();
      await shot(page, lang, size, "s55b-error");
      await page.goto(url(`/?booth=1&e2eBooth=token&phase=offline&t=${QR_TOKEN}`, lang));
      await expect(page.locator('[data-phase="offline"]')).toBeVisible();
      await shot(page, lang, size, "s55b-offline");
      await context.close();
    });

    test(`booth shots S56 ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await fresh(browser, size);
      let verify: unknown = { ok: false };
      await page.route("**/api/booth/verify", (r) => json(r, verify));
      await page.route("**/api/booth/check", (r) => json(r, { ok: true, expires: Date.now() + HOUR }));
      const open = async (visitor = false) => {
        await page.goto(url(`/?booth=1&e2eBooth=vitals-flow${visitor ? "&pass=visitor" : ""}`, lang));
        await expect(page.locator('[data-screen="S56"]')).toBeVisible();
      };
      await open();
      await shot(page, lang, size, "s56-locked");
      await page.getByLabel(c.booth.codeLabel).fill("000000");
      await page.getByRole("button", { name: c.common.continue }).click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.wrong);
      await shot(page, lang, size, "s56-error-code");

      verify = { ok: true, session: SESSION, expires: Date.now() + HOUR };
      await page.getByRole("button", { name: c.common.continue }).click();
      await expect(page.locator('[data-unlocked="yes"]')).toBeVisible();
      await page.locator("h1").focus();
      await shot(page, lang, size, "s56-open");

      await page.getByRole("button", { name: c.common.continue }).click();
      await page.locator('[data-field="hr1"]').fill(digits(lang, 300));
      await page.locator('[data-field="sys1"]').fill(digits(lang, 128));
      await page.locator('[data-field="dia1"]').fill(digits(lang, 82));
      await page.locator('[data-field="dia1"]').blur();
      await shot(page, lang, size, "s56-error-validation");

      const values: Record<string, number> = { hr1: 72, sys1: 128, dia1: 82, hr2: 68, sys2: 124, dia2: 78 };
      for (const [f, v] of Object.entries(values))
        await page.locator(`[data-field="${f}"]`).fill(digits(lang, v));
      await page.locator('[data-field="dia2"]').blur();
      await page.getByRole("button", { name: c.common.no, exact: true }).click();
      await expect(page.locator('[data-mean="sys"]')).toHaveText(digits(lang, 126));
      await shot(page, lang, size, "s56-filled");

      await open(true);
      await shot(page, lang, size, "s56-visitor-phone");

      await page.goto(url("/?booth=1&e2eBooth=vitals-starting", lang));
      await expect(page.getByText(c.state.loading.check)).toBeVisible();
      await shot(page, lang, size, "s56-loading");
      await page.goto(url("/?booth=1&e2eBooth=vitals-starting&error=offline", lang));
      await expect(page.getByRole("alert")).toBeVisible();
      await shot(page, lang, size, "s56-offline");
      await page.goto(url("/?booth=1&e2eBooth=vitals-starting&error=network", lang));
      await expect(page.getByRole("alert")).toBeVisible();
      await shot(page, lang, size, "s56-error-start");
      await context.close();
    });

    test(`booth shots S57 ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await fresh(browser, size);
      const layer = (state: string) => url(`/?booth=1&e2eBooth=layer-${state}`, lang);
      const dialog = page.getByRole("dialog", { name: c.booth.resetConfirm });

      await page.goto(layer("question"));
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      await shot(page, lang, size, "s57-badge");
      await page.keyboard.press("Alt+Shift+KeyN");
      await expect(dialog).toBeVisible();
      await shot(page, lang, size, "s57-staff-reset", false);

      await page.goto(layer("camera"));
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      await page.keyboard.press("Alt+Shift+KeyN");
      await expect(dialog).toBeVisible();
      await shot(page, lang, size, "s57-staff-reset-camera", false);

      await page.goto(layer("results"));
      await expect(page.getByRole("button", { name: c.guest.newVisitor })).toBeVisible();
      await shot(page, lang, size, "s57-new-visitor");
      await page.getByRole("button", { name: c.guest.newVisitor }).click();
      await expect(dialog).toBeVisible();
      await shot(page, lang, size, "s57-new-visitor-confirm", false);

      await page.goto(url("/?booth=1&e2eBooth=count", lang));
      await shot(page, lang, size, "s57-count");
      await page.getByRole("button", { name: c.booth.correct }).click();
      const count = page.getByRole("dialog", { name: c.booth.staffCount });
      await expect(count).toBeVisible();
      await shot(page, lang, size, "s57-count-dialog", false);
      await count.getByLabel(c.booth.staffCount).fill(digits(lang, 99));
      await count.getByRole("button", { name: c.common.continue }).click();
      await expect(count.getByRole("alert")).toBeVisible();
      await shot(page, lang, size, "s57-count-error", false);
      await context.close();

      // The idle question, on S50 (3 minutes) and before the camera (5 minutes).
      for (const [state, wait] of [
        ["results", 3],
        ["question", 5],
      ] as const) {
        const { context: idle, page: p } = await fresh(browser, size);
        await p.clock.install();
        await p.goto(layer(state));
        await expect(p.locator(".check-base")).toBeVisible();
        await p.clock.runFor(wait * 60 * 1000 + 2000);
        await expect(p.locator("[data-idle-sheet]")).toBeVisible();
        await shot(p, lang, size, `s57-idle-${state}`, false);
        await idle.close();
      }
    });

    test(`booth shots S58 ${lang} ${size.tag}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const { context, page } = await fresh(browser, size);
      await page.goto(url("/?booth=1&e2eBooth=tips", lang));
      await expect(page.locator("[data-tip]")).toHaveCount(7);
      await shot(page, lang, size, "s58-tips");
      await page.goto(url("/?booth=1&e2eBooth=tips-wheelchair", lang));
      await expect(page.locator("[data-tip]").first()).toHaveAttribute("data-tip", "wheelchair");
      await shot(page, lang, size, "s58-tips-wheelchair");
      await context.close();
    });
  }
}
