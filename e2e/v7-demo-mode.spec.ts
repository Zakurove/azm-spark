/**
 * The booth demo (/demo, Nasser at KSCDR) in the real app on the v7 flow server (e2e/v7-flow.config.ts):
 *   - /demo signs a demo person in with no form (the reserved demo domain, the program waiting for the
 *     check), shows the demo home with its four cards, and a reload keeps the same person;
 *   - each card opens its first screen and its X comes back home: the full journey's filled health
 *     form, the range picker and a movement's start card (no diagnostics), the walk's first card, the
 *     demo exercises; «زائر جديد» signs a new person in;
 *   - the range measures a movement on the simulated person and «another movement» is the picker again;
 *   - the walk runs both parts on the recorded walks to its result card, posting nothing;
 *   - the full journey runs from the health form through the range, the walk and the build to the
 *     program, then home;
 *   - the landing shows «جرّب العرض التجريبي» beside its main action, linking to /demo.
 * AZM_DEMO_SHOTS=<dir>: the review screenshots at 390 x 844 in Arabic and English. Skipped under the
 * default config, whose server has the flags off.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const SHOTS = process.env.AZM_DEMO_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

type Lang = "ar" | "en";
const DEMO_EMAIL = /^demo-[0-9a-f-]{36}@demo\.azm-spark\.invalid$/;

/**
 * Each demo start comes from its own client address (the server allows 30 per address in 15 minutes,
 * and every spec shares 127.0.0.1), as e2e/sign-up.ts does for sign ups.
 */
async function ownAddress(page: Page) {
  await page.route("**/api/demo/start", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...signUpAddress() } }),
  );
}

const me = async (page: Page) => (await page.request.get("/api/auth/me")).json();

async function openDemo(page: Page, lang: Lang, query = "") {
  await page.setViewportSize({ width: 390, height: 844 });
  await ownAddress(page);
  const qs = [lang === "en" ? "lang=en" : "", query].filter(Boolean).join("&");
  await page.goto(`/demo${qs ? `?${qs}` : ""}`);
  const home = page.locator('[data-screen="demo_home"]');
  await expect(home).toBeVisible({ timeout: 30_000 });
  return home;
}

for (const lang of ["ar", "en"] as const)
  test(`the demo home: no form, four cards to their first screens, and a new visitor (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const home = await openDemo(page, lang);
    await expect(home).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    const cards = home.locator("[data-demo-part]");
    await expect(cards).toHaveCount(4);
    expect(await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.demoPart))).toEqual([
      "journey",
      "range",
      "walk",
      "exercises",
    ]);
    for (const box of await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(56);
    await expect(home).toContainText(lang === "ar" ? "الرحلة كاملة" : "Full journey");
    await expect(home.locator('[data-action="new_visitor"]')).toContainText(
      lang === "ar" ? "زائر جديد" : "New visitor",
    );
    const first = await me(page);
    expect(first.user.email).toMatch(DEMO_EMAIL);
    expect(first.awaitingCheck).toBe(true);
    expect(first.intake.walking).toEqual({ status: "without_aid" });
    await shot(page, `${lang}-01-demo-home`);
    // A reload keeps the same demo person.
    await page.reload();
    await expect(home).toBeVisible({ timeout: 30_000 });
    expect((await me(page)).user.id).toBe(first.user.id);

    // The full journey: the health form, filled with the demo person's answers and editable.
    await home.locator('[data-demo-part="journey"]').click();
    const form = page.locator('[data-screen="demo_journey_form"]');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(form.locator(".intake-actions .cta")).toBeVisible();
    await expect(form.locator('input[type="number"]').first()).toHaveValue("45");
    await shot(page, `${lang}-02-journey-form`);
    await form.locator('[data-action="leave"]').click();
    await expect(home).toBeVisible();

    // Range of motion: the picker (common movements first), then a movement's start card.
    await home.locator('[data-demo-part="range"]').click();
    const picker = page.locator('[data-screen="demo_range"]');
    await expect(picker).toBeVisible({ timeout: 30_000 });
    const moves = picker.locator("[data-movement]");
    await expect(moves).toHaveCount(16);
    await expect(moves.first()).toHaveAttribute("data-movement", "shoulder_flexion");
    await shot(page, `${lang}-03-range-picker`);
    await moves.first().click();
    await expect(page.locator('[data-romlab="shoulder_flexion"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-action="ready"]')).toBeVisible();
    await expect(page.locator(".rl-diag, .rl-json")).toHaveCount(0);
    await expect(page.locator(".rl-note")).toHaveText(
      lang === "ar" ? "عرض تجريبي: لا يُحفظ شيء." : "A demo: nothing is saved.",
    );
    await shot(page, `${lang}-04-range-start`);
    await page.locator('.fx-top [data-action="leave"]').click();
    await expect(home).toBeVisible();

    // The walk: its own first card, straight away.
    await home.locator('[data-demo-part="walk"]').click();
    await expect(page.locator('[data-screen="demo_walk"] .gx-root')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".gx-root")).toHaveAttribute("data-step", "intro");
    await expect(page.locator('[data-action="skip_walk"]')).toHaveCount(0);
    await shot(page, `${lang}-05-walk-start`);
    await page.locator('.fx-top [data-action="leave"]').click();
    await expect(home).toBeVisible();

    // The exercises: the demo exercises, the shoulder press first.
    await home.locator('[data-demo-part="exercises"]').click();
    const list = page.locator('[data-screen="demo_exercises"]');
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list.locator("[data-exercise]").first()).toHaveAttribute(
      "data-exercise",
      "seated_shoulder_press",
    );
    await shot(page, `${lang}-06-exercises`);
    await list.locator('.fx-top [data-action="leave"]').click();
    await expect(home).toBeVisible();

    // «زائر جديد»: the demo person before is signed out, a new one signed in.
    await home.locator('[data-action="new_visitor"]').click();
    await expect(home).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await me(page)).user.id, { timeout: 10_000 }).not.toBe(first.user.id);
    const next = await me(page);
    expect(next.user.email).toMatch(DEMO_EMAIL);
    expect(next.awaitingCheck).toBe(true);
  });

test("the range measures a movement on the simulated person; «another movement» is the picker", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = await openDemo(page, "en", "e2ePerson=1");
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
  });
  await home.locator('[data-demo-part="range"]').click();
  await page.locator('[data-screen="demo_range"] [data-movement="elbow_flexion"]').click();
  const start = page.locator('[data-action="ready"]:not([disabled])');
  await expect(start).toBeVisible({ timeout: 20_000 });
  await start.click();
  await expect(page.locator(".fx-measure .fx-meter")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".fx-measure[data-holding]")).toBeVisible({ timeout: 40_000 });
  await shot(page, "en-07-range-measuring");
  const next = page.locator('[data-action="next"]');
  await expect(next).toBeVisible({ timeout: 60_000 });
  await shot(page, "en-08-range-result");
  await next.click();
  await expect(page.locator('[data-screen="demo_range"]')).toBeVisible();
  expect(posts).toEqual([]);
});

/** The walk's step now (the gait screen's root), or null outside the walk. */
const walkStep = (page: Page) =>
  page.evaluate(() => document.querySelector(".gx-root")?.getAttribute("data-step") ?? null);

/** Drives the walk's screens on the recorded walks until its result card (the steps of v7-gait.spec). */
async function runWalk(page: Page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 200_000) {
    const step = await walkStep(page);
    if (step === "done") return;
    if (step === "intro") await page.locator('.gx-root [data-action="start"]').click();
    else if (step === "gear") {
      await page.locator('[data-field="shoes"] [data-value="yes"]').click();
      await page.locator('[data-field="brace"] [data-value="none"]').click();
      await page.locator('.gx-root [data-action="next"]').click();
    } else if (step === "clear_path" || step === "place" || step === "stance_place")
      await page.locator('.gx-root [data-action="ready"]').click();
    else if (step === "retry") await page.locator('.gx-root [data-action="skip_part"]').click();
    await page.waitForTimeout(250);
  }
  throw new Error("the walk did not end");
}

test("the walk runs both parts to its result card and posts nothing", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as unknown as { azmGaitFixtures?: Record<string, string> }).azmGaitFixtures = {
      "gait/overground-side": "gait/home-side",
    };
  });
  const home = await openDemo(page, "ar", "e2eGait=1&e2eFast=1");
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
  });
  await home.locator('[data-demo-part="walk"]').click();
  await expect(page.locator(".gx-root")).toBeVisible({ timeout: 30_000 });
  await runWalk(page);
  const card = page.locator(".gx-card");
  await expect(card.locator('[data-metric="cadence"]')).toBeVisible({ timeout: 20_000 });
  await shot(page, "ar-09-walk-result");
  expect(posts).toEqual([]);
  await page.locator('.gx-root [data-action="continue"]').click();
  await expect(home).toBeVisible();
});

/** The focus shell's state (window.azmFocus, VITE_E2E builds). */
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { azmFocus?: { model: { state: { kind: string } }; ctl: unknown } })
      .azmFocus;
    if (!s) return { kind: "none", step: null as string | null };
    const c = s.ctl as { current?: { kind: string } } | null;
    return { kind: s.model.state.kind, step: c?.current?.kind ?? null };
  });

test("the full journey: the health form, the range, the walk, the build and the program, then home", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    (window as unknown as { azmGaitFixtures?: Record<string, string> }).azmGaitFixtures = {
      "gait/overground-side": "gait/home-side",
    };
  });
  const home = await openDemo(page, "ar", "e2ePerson=1&e2eFast=1&e2eGait=1");
  await home.locator('[data-demo-part="journey"]').click();
  const form = page.locator('[data-screen="demo_journey_form"]');
  await expect(form).toBeVisible({ timeout: 30_000 });
  const cta = form.locator(".intake-actions .cta");
  for (let i = 0; i < 8 && !((await cta.textContent()) ?? "").includes("التالي: قياس حركتك"); i++) {
    await cta.click();
    await page.waitForTimeout(250);
  }
  await expect(cta).toContainText("التالي: قياس حركتك");
  await cta.click();
  await expect(page.locator('[data-screen="intro"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-screen="intro"] [data-action="start"]').click();
  await expect.poll(async () => (await state(page)).kind, { timeout: 20_000 }).toBe("part");
  // The range blocks and the walk, until the build.
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    const s = await state(page);
    if (s.kind === "build" || (await page.locator(".pb-skip").count())) break;
    const walk = await walkStep(page);
    if (walk) {
      if (walk === "done") await page.locator('.gx-root [data-action="continue"]').click();
      else if (walk === "intro") await page.locator('.gx-root [data-action="start"]').click();
      else if (walk === "gear") {
        await page.locator('[data-field="shoes"] [data-value="yes"]').click();
        await page.locator('[data-field="brace"] [data-value="none"]').click();
        await page.locator('.gx-root [data-action="next"]').click();
      } else if (walk === "clear_path" || walk === "place" || walk === "stance_place")
        await page.locator('.gx-root [data-action="ready"]').click();
    } else if (s.step === "block" || s.step === "setup") {
      const ready = page.locator('[data-action="ready"]:not([disabled])');
      if (await ready.count()) await ready.first().click();
    } else if (s.step === "result" || s.step === "sit" || s.step === "rest") {
      const next = page.locator('[data-action="next"]:not([disabled])');
      if (await next.count()) await next.first().click();
    }
    await page.waitForTimeout(250);
  }
  const skip = page.locator('.pb-skip[data-action="skip"]');
  await expect(skip).toBeVisible({ timeout: 60_000 });
  await skip.click();
  const program = page.locator('[data-screen="program"]');
  await expect(program).toBeVisible({ timeout: 60_000 });
  expect((await me(page)).awaitingCheck).toBe(false);
  await program.locator('.fx-top [data-action="leave"]').first().click();
  await expect(home).toBeVisible();
  // The journey again: the finished person is replaced by a new one, whose program waits again.
  const done = (await me(page)).user.id;
  await home.locator('[data-demo-part="journey"]').click();
  await expect(form).toBeVisible({ timeout: 30_000 });
  const again = await me(page);
  expect(again.user.id).not.toBe(done);
  expect(again.awaitingCheck).toBe(true);
});

for (const lang of ["ar", "en"] as const)
  test(`the landing shows the demo button beside its main action, linking to /demo (${lang})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(lang === "en" ? "/?lang=en" : "/");
    const button = page.locator('.ld-hero [data-action="try_demo"]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveText(lang === "ar" ? "جرّب العرض التجريبي" : "Try the demo");
    await expect(button).toHaveAttribute("href", lang === "en" ? "/demo?lang=en" : "/demo");
    await expect(page.locator('.ld-close [data-action="try_demo"]')).toHaveCount(1);
    await shot(page, `${lang}-00-landing`);
    await ownAddress(page);
    await button.click();
    await expect(page).toHaveURL(/\/demo/);
    await expect(page.locator('[data-screen="demo_home"]')).toBeVisible({ timeout: 30_000 });
  });
