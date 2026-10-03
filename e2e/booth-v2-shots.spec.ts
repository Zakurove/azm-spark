/**
 * Review screenshots of the booth v2 journey (contract C): every step of both doors, the camera in
 * variant booth, the rules saying no, the staff menu, the idle note and the staff code, at 1024 x 768
 * (a tablet in landscape, the likely booth device), 390 x 844 (a phone, at 2x) and 1440 x 900, in
 * Arabic and English. Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/booth-v2/journey npm run e2e -- booth-v2-shots
 *
 * Files are <lang>-<tablet|phone|desktop>-<nn>-<name>.png. The screen as the person sees it (the
 * action bar is docked); long phone steps also as the whole page (-page). The reading engine and the
 * AI week are routed (the live answers), the camera is the synthetic person of E2E builds.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Route } from "@playwright/test";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const SIZES = [
  { tag: "tablet", width: 1024, height: 768, scale: 1, touch: true },
  { tag: "phone", width: 390, height: 844, scale: 2, touch: true },
  { tag: "desktop", width: 1440, height: 900, scale: 1, touch: false },
] as const;
type Size = (typeof SIZES)[number];

const SESSION = "a".repeat(64);
const HOUR = 60 * 60 * 1000;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

const LIVE = {
  document: "medical_report",
  extracted: {
    age: 22,
    conditions: ["sci_incomplete"],
    diagnosisNotes: "Incomplete spinal cord injury at T10 (AIS C)",
    medications: "Baclofen 10 mg",
    mobility: "wheelchair",
    support: "unknown",
    pain: [],
    restrictions: [],
    symptoms: "unknown",
    recentChange: "unknown",
  },
  missing: ["support"],
  questions: [],
  summary: "",
  confidence: "high",
};

/** The week as the AI engine arranges it for Saad (ids from library.json, all allowed by the rules). */
const AI_WEEK = {
  source: "ai",
  summary: { ar: "أسبوع نحو كرة السلة.", en: "A week toward basketball." },
  why: [],
  tips: [],
  days: [
    {
      day: 0,
      focus: { ar: "قوة الدفع", en: "Pushing power" },
      warmup: [],
      extra: [
        { id: "chest_press", sets: 2, reps: 8 },
        { id: "seated_tricep_extensions", sets: 2, reps: 8 },
      ],
      cooldown: [],
    },
    {
      day: 2,
      focus: { ar: "تحمّل الكتفين", en: "Shoulder endurance" },
      warmup: [],
      extra: [{ id: "overhead_tricep_extension", sets: 2, reps: 8 }],
      cooldown: [],
    },
    {
      day: 4,
      focus: { ar: "ثبات الجذع", en: "Trunk control" },
      warmup: [],
      extra: [{ id: "chest_press", sets: 2, reps: 8 }],
      cooldown: [],
    },
  ],
};

async function fresh(browser: Browser, size: Size, lang: Lang) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.touch,
    isMobile: size.tag === "phone",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
  await page.route("**/api/booth/verify", (r) =>
    json(r, { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR }),
  );
  await page.route("**/api/booth/report", async (r) => {
    await new Promise((done) => setTimeout(done, 2500));
    await json(r, LIVE);
  });
  await page.route("**/api/booth/plan", (r) => json(r, { plan: { status: "ready" }, weekly: AI_WEEK }));
  return { context, page, lang, size };
}

type Ctx = Awaited<ReturnType<typeof fresh>>;

/** The screen as the person sees it; with page, also the whole page (phones, long steps). */
async function shot(
  c: Ctx,
  name: string,
  opts: { page?: boolean; settle?: number; animations?: boolean } = {},
) {
  const { page, lang, size } = c;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(opts.settle ?? 1400);
  const file = (suffix = "") => join(OUT, `${lang}-${size.tag}-${name}${suffix}.png`);
  await page.screenshot({ path: file(), animations: opts.animations ? "allow" : "disabled" });
  if (opts.page && size.tag === "phone") {
    const viewport = page.viewportSize()!;
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > viewport.height + 40) {
      await page.setViewportSize({ width: viewport.width, height });
      await page.waitForTimeout(200);
      await page.screenshot({ path: file("-page"), animations: "disabled" });
      await page.setViewportSize(viewport);
    }
  }
}

async function enter(c: Ctx, trace = "full") {
  await c.page.goto(url(`/?booth=1&e2eTrace=${trace}`, c.lang));
  await c.page.locator("input").first().fill("482913");
  await c.page.locator("form .cta").click();
  await expect(c.page.locator('[data-screen="home"]')).toBeVisible();
}
const next = (c: Ctx) => c.page.locator('.bx-actions [data-action="next"]').click();

test.beforeAll(() => {
  if (OUT) mkdirSync(OUT, { recursive: true });
});

for (const size of SIZES)
  for (const lang of LANGS) {
    test(`Saad's story, every step (${lang}, ${size.tag})`, async ({ browser }) => {
      test.setTimeout(240_000);
      const c = await fresh(browser, size, lang);
      const { page } = c;

      // The staff code.
      await page.goto(url("/?booth=1", lang));
      await expect(page.locator("input").first()).toBeVisible();
      await shot(c, "00-code");
      await page.locator("input").first().fill("482913");
      await page.locator("form .cta").click();
      await expect(page.locator('[data-screen="home"]')).toBeVisible();
      await page.goto(url("/?booth=1&e2eTrace=full", lang));
      await expect(page.locator('[data-screen="home"]')).toBeVisible();
      await shot(c, "01-home", { page: true });

      await page.locator('[data-door="story"]').click();
      await shot(c, "02-report", { page: true });
      await page.locator('[data-action="read"]').click();
      await page.waitForTimeout(900);
      await shot(c, "03-report-reading", { settle: 0, animations: true });
      await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-reading", "read");
      await shot(c, "04-report-read", { page: true, settle: 2600 });

      await next(c);
      await shot(c, "05-engine", { page: true, settle: 2600 });
      await page.locator('[data-action="staff"]').click();
      await shot(c, "06-staff-menu", { settle: 500 });
      await page.keyboard.press("Escape");

      await next(c);
      await shot(c, "07-goal", { page: true });
      await next(c);
      await shot(c, "08-safety");

      await page.locator('[data-answer="no"]').click();
      const cam = page.locator(".cam2");
      await expect(cam).toHaveAttribute("data-stage", "calibrating", { timeout: 30_000 });
      await shot(c, "09-camera-measuring", { settle: 1200, animations: true });
      await expect(cam).toHaveAttribute("data-count", "2", { timeout: 40_000 });
      await shot(c, "10-camera-count", { settle: 300, animations: true });
      await expect(page.locator("[data-done]")).toBeVisible({ timeout: 40_000 });
      await shot(c, "11-well-done", { settle: 500, animations: true });

      await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: 10_000 });
      await shot(c, "12-results", { page: true, settle: 2600 });
      await page.locator('[data-action="program"]').click();
      await expect(page.locator('[data-screen="program"]')).toHaveAttribute("data-source", "ai");
      await shot(c, "13-program", { page: true, settle: 2200 });
      await c.context.close();
    });

    test(`try it as yourself, the taps and the rules saying no (${lang}, ${size.tag})`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const c = await fresh(browser, size, lang);
      const { page } = c;
      await enter(c);
      await page.locator('[data-door="self"]').click();
      await shot(c, "20-about-condition", { page: true });
      await page.locator('[data-condition="stroke"]').click();
      await page.locator('[data-clearance="yes"]').click();
      await shot(c, "21-about-clearance", { page: true });
      await next(c);
      await page.locator('[data-pick="seated"]').click();
      await shot(c, "22-about-position", { page: true });
      await next(c);
      await page.locator('[data-pick="left"]').click();
      await shot(c, "23-about-side", { page: true });
      await next(c);
      await shot(c, "24-engine", { page: true, settle: 2600 });
      await next(c);
      await page.locator('[data-pick="sport"]').click();
      await page.locator('[data-sport="para_table_tennis"]').click();
      await shot(c, "25-goal-sport", { page: true });
      await next(c);
      await page.locator('[data-answer="yes"]').click();
      await shot(c, "26-stop");

      // A heart condition: the rules hold the plan for review, and the camera is skipped.
      await page.locator('[data-action="start-again"]').click();
      await page.locator('[data-door="self"]').click();
      await page.locator('[data-condition="cardiac"]').click();
      await next(c);
      await page.locator('[data-pick="seated"]').click();
      await next(c);
      await page.locator('[data-pick="none"]').click();
      await next(c);
      await shot(c, "27-engine-review", { page: true });
      await next(c);
      await shot(c, "28-program-review", { page: true });
      await c.context.close();
    });
  }

test("the idle note before the doors (tablet, both languages)", async ({ browser }) => {
  for (const lang of LANGS) {
    const c = await fresh(browser, SIZES[0], lang);
    await c.page.clock.install();
    await enter(c);
    await c.page.locator('[data-door="self"]').click();
    await c.page.locator('[data-condition="cardiac"]').click();
    await next(c);
    await c.page.locator('[data-pick="seated"]').click();
    await next(c);
    await c.page.locator('[data-pick="none"]').click();
    await next(c);
    await next(c);
    await c.page.clock.fastForward(80_000);
    await expect(c.page.locator("[data-idle]")).toBeVisible();
    await shot(c, "29-idle-note", { settle: 600 });
    await c.context.close();
  }
});
