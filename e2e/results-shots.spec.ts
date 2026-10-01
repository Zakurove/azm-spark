/**
 * Review screenshots of the results and My results stream (UX spec definition of done): S50 to S52,
 * S53, S54, the Today cards S01 and S03 and the offer S02, in every applicable state, at 375 x 812
 * and 1440 x 900, in Arabic and English. Runs only with AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/results AZM_E2E_PORT=5483 npm run e2e -- results-shots
 *
 * Files are <lang>-<m|d>-<screen>-<state>.png (m 375 x 812 at 2x, d 1440 x 900).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  buildStored,
  context,
  CURL,
  DAY,
  HISTORY,
  LANGS,
  LEAN,
  mockApi,
  openCheck,
  openSnapshot,
  progress,
  queueCompletion,
  RAISE,
  resultsSnapshot,
  SEATED,
  signIn,
  url,
  type Outcome,
} from "./results-data";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");
test.describe.configure({ timeout: 120_000 });

const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2 },
  { tag: "d", width: 1440, height: 900, scale: 1 },
] as const;

/** A whole page shot (the viewport as tall as the page), or the viewport for a dialog. */
async function shot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize()!;
  if (fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > viewport.height) await page.setViewportSize({ width: viewport.width, height });
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled" });
  await page.setViewportSize(viewport);
}

/** A card or section shot (the Today slot inside the portal page). */
async function part(page: Page, selector: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await el.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled" });
}

const measured = (value: number, detail: Record<string, unknown> = {}): Outcome => ({
  status: "measured",
  value,
  detail,
});

/** A guest's check at the booth: two tests measured, one side not measured, one test skipped. */
const GUEST_OUTCOMES: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(121, RAISE),
  "shoulder_abduction:left": { status: "notMeasured", reason: "quality" },
  "trunk_control_seated:right": { status: "skipped", reason: "pain_today" },
  "trunk_control_seated:left": { status: "skipped", reason: "pain_today" },
  "arm_curl_30s:right": measured(14, CURL),
  "arm_curl_30s:left": measured(2, CURL),
};

const FIRST_OUTCOMES: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(122, RAISE),
  "shoulder_abduction:left": measured(115, RAISE),
  "trunk_control_seated:right": measured(18, { ...LEAN, censored: true }),
  "trunk_control_seated:left": measured(16, LEAN),
  "arm_curl_30s:right": measured(13, CURL),
  "arm_curl_30s:left": measured(9, CURL),
};

const NONE_OUTCOMES: Record<string, Outcome> = Object.fromEntries(
  SEATED.map((i) => [`${i.testId}:${i.side}`, { status: "notMeasured", reason: "quality" } as Outcome]),
);

for (const size of SIZES) {
  for (const lang of LANGS) {
    const name = (screen: string) => `${lang}-${size.tag}-${screen}`;

    test(`results shots ${lang} ${size.tag}: S50 to S52`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag !== "d",
        isMobile: size.tag !== "d",
      });
      const page = await ctx.newPage();

      // S50, the guest at the booth.
      await page.goto(url("/?e2eGallery=empty", lang));
      const guest = (outcomes: Record<string, Outcome>) =>
        resultsSnapshot({ mode: "guest", booth: true, homeOpen: false, items: SEATED, outcomes });
      await openSnapshot(page, lang, guest(GUEST_OUTCOMES), true);
      await expect(page.locator('[data-screen="S50"]')).toBeVisible();
      await shot(page, name("S50-default"));
      await openSnapshot(page, lang, guest(NONE_OUTCOMES), true);
      await expect(page.locator('[data-screen="S50"]')).toBeVisible();
      await shot(page, name("S50-empty"));
      await openSnapshot(page, lang, guest(GUEST_OUTCOMES), true);
      await expect(page.locator('[data-screen="S50"]')).toBeVisible();
      await ctx.setOffline(true);
      await expect(page.locator(".check-offline")).toBeVisible();
      await shot(page, name("S50-offline"));
      await ctx.setOffline(false);
      await page.evaluate(() => sessionStorage.clear());

      // S51, the first check at home.
      const owner = await signIn(page, lang, `shots-${size.tag}`);
      await mockApi(page, { context: context({ firstCheck: false, completedBefore: true }) });
      const first = (outcomes: Record<string, Outcome>, items = SEATED) =>
        resultsSnapshot({
          mode: "signedIn",
          booth: false,
          checkId: "e2e-first",
          checkKind: "baseline",
          items,
          outcomes,
        });
      await openSnapshot(page, lang, first(FIRST_OUTCOMES), false);
      await expect(page.locator('[data-screen="S51"]')).toBeVisible();
      await shot(page, name("S51-default"));
      const early = { ...FIRST_OUTCOMES };
      delete early["arm_curl_30s:right"];
      delete early["arm_curl_30s:left"];
      await openSnapshot(page, lang, first(early), false);
      await expect(page.locator('[data-screen="S51"]')).toBeVisible();
      await shot(page, name("S51-endedEarly"));
      await openSnapshot(page, lang, first(NONE_OUTCOMES), false);
      await expect(page.locator('[data-screen="S51"]')).toBeVisible();
      await shot(page, name("S51-empty"));

      // A save that waits: offline ("Not saved yet"), then refused while online (the save error).
      await page.route("**/api/assessments/e2e-first/complete", (r) =>
        r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"UNAVAILABLE"}' }),
      );
      await queueCompletion(page, owner, "e2e-first");
      await openSnapshot(page, lang, first(FIRST_OUTCOMES), false);
      await expect(page.locator('[data-screen="S51"]')).toBeVisible();
      await expect(page.locator('[data-save="error"]')).toBeVisible();
      await shot(page, name("S51-error"));
      await ctx.setOffline(true);
      await expect(page.locator('[data-save="pending"]')).toBeVisible();
      await shot(page, name("S51-offline"));
      await ctx.setOffline(false);
      await page.unroute("**/api/assessments/e2e-first/complete");
      await page.evaluate(() => indexedDB.deleteDatabase("azm-check"));

      // S52, a re-test: today's check compared with the saved series by the rules.
      const built = await buildStored(page, HISTORY);
      const tests = (
        built.tests as { testId: string; side: string; setting: string; current: boolean }[]
      ).map((v) =>
        v.testId === "arm_curl_30s" && v.side === "right" && v.setting === "home" && v.current
          ? { ...v, loadStep: { from: { kind: "dumbbell", kg: 2 }, to: { kind: "dumbbell", kg: 3 } } }
          : v,
      );
      const retest = resultsSnapshot({
        mode: "signedIn",
        booth: false,
        checkId: "e2e-retest",
        checkKind: "retest",
        items: SEATED.filter((i) => i.testId !== "trunk_control_seated").concat([
          { testId: "trunk_control_seated", side: "right", skipped: "restriction_balance" },
          { testId: "trunk_control_seated", side: "left", skipped: "restriction_balance" },
        ]),
        outcomes: {
          "shoulder_abduction:right": measured(122, RAISE),
          "shoulder_abduction:left": measured(115, RAISE),
          "arm_curl_30s:right": measured(13, CURL),
          "arm_curl_30s:left": measured(9, CURL),
        },
      });
      await mockApi(page, {
        context: context({ firstCheck: false, completedBefore: true }),
        progress: progress(tests),
        checks: { assessments: built.checks },
        delay: 2500,
      });
      await openSnapshot(page, lang, retest, false);
      await expect(page.locator('[data-screen="S52"]')).toBeVisible();
      await shot(page, name("S52-loading"));
      await expect(page.locator(".pg-pill").first()).toBeVisible({ timeout: 10_000 });
      await shot(page, name("S52-default"));
      await ctx.close();
    });

    test(`results shots ${lang} ${size.tag}: Today, S02 and S54`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag !== "d",
        isMobile: size.tag !== "d",
      });
      const page = await ctx.newPage();
      await signIn(page, lang, `today-${size.tag}`);
      const now = Date.now();
      const slot = ".check-slot";
      // C43: Today shows the check card when a check is due or open; My results shows every variant.
      const ON_TODAY = ["first", "due", "resume", "leanRepeat", "repeatOffer"];
      const today = async (label: string, over: Record<string, unknown>, extra = {}) => {
        await mockApi(page, {
          context: context(over),
          progress: progress([]),
          checks: { assessments: [] },
          ...extra,
        });
        await page.goto(url("/", lang));
        const region = ON_TODAY.includes(label) ? slot : ".check-results-page";
        if (region !== slot)
          await page
            .locator(".portal-sidebar nav")
            .getByRole("button", { name: lang === "ar" ? "نتائجي" : "My results" })
            .click();
        await expect(page.locator(`${region} [data-screen="S01"]`).first()).toBeVisible();
        await expect(page.locator(`${region} .pg-entry-skeleton`)).toHaveCount(0);
        await part(page, region, name(`S01-${label}`));
      };
      await today("first", {});
      await today("homeSoon", { homeOpen: false });
      await today("blocked", { blocked: "clinical_review" });
      await today("locked", {
        lock: {
          until: now + DAY,
          releasableByClearance: true,
          when: { token: "nextDay_clock", time: { hour: 7, minute: 50, suffix: "am" } },
        },
      });
      await today("due", { firstCheck: false, completedBefore: true, retestDue: now - DAY });
      const open = openCheck(now);
      await today("resume", open.context, { checks: { assessments: [open.check] } });
      await today("leanRepeat", {
        firstCheck: false,
        completedBefore: true,
        sideLeanRepeat: { from: now - DAY, to: now + 4 * DAY, baseTests: ["trunk_control_seated"] },
        retestDue: now + 20 * DAY,
      });
      await today("tooSoon", {
        firstCheck: false,
        completedBefore: true,
        earliestNext: now + DAY,
        retestDue: now + 27 * DAY,
      });
      await today("upcoming", { firstCheck: false, completedBefore: true, retestDue: now + 20 * DAY });
      await page.locator(".check-results-page .pg-entry .check-text-button").first().click();
      await expect(page.locator(".check-dialog")).toBeVisible();
      await shot(page, name("S01-upcoming-earlyDialog"), false);
      await page.keyboard.press("Escape");

      // The repeat offer after a lower result, from a saved history.
      const built = await buildStored(page, HISTORY);
      await today(
        "repeatOffer",
        { firstCheck: false, completedBefore: true, retestDue: now + 26 * DAY, earliestNext: now - DAY },
        { progress: progress(built.tests), checks: { assessments: built.checks } },
      );
      // Today's check ended early: the extra line with its results link.
      const ended = await buildStored(
        page,
        [...HISTORY, { testId: "shoulder_abduction", side: "right", daysAgo: 0, value: 123, detail: RAISE }],
        { ended: [0] },
      );
      await today(
        "tooSoon-endedEarly",
        { firstCheck: false, completedBefore: true, retestDue: now + 28 * DAY, earliestNext: now + 2 * DAY },
        { progress: progress(ended.tests), checks: { assessments: ended.checks } },
      );

      // The loading skeleton, the error and offline.
      await mockApi(page, {
        context: context(),
        progress: progress([]),
        checks: { assessments: [] },
        delay: 4000,
      });
      // While loading, Today shows nothing of the check (C43); My results shows the skeleton.
      await page.goto(url("/", lang));
      await page
        .locator(".portal-sidebar nav")
        .getByRole("button", { name: lang === "ar" ? "نتائجي" : "My results" })
        .click();
      await expect(page.locator(".check-results-page .pg-entry-skeleton")).toBeVisible();
      await part(page, ".check-results-page", name("S01-loading"));
      await mockApi(page, { context: { status: 500, body: { error: "SERVER" } }, progress: progress([]) });
      await page.goto(url("/", lang));
      await expect(page.locator(`${slot} [data-variant="error"]`)).toBeVisible();
      await part(page, slot, name("S01-error"));
      await mockApi(page, { context: context(), progress: progress([]), checks: { assessments: [] } });
      await page.goto(url("/", lang));
      await expect(page.locator(`${slot} [data-variant="first"]`)).toBeVisible();
      await ctx.setOffline(true);
      await expect(page.locator(`${slot} [data-variant="first"] .check-meta`)).toBeVisible();
      await part(page, slot, name("S01-offline"));
      await ctx.setOffline(false);

      // S03, the next day question above the card.
      await mockApi(page, {
        context: context({
          firstCheck: false,
          completedBefore: true,
          retestDue: now + 26 * DAY,
          followUpDue: true,
        }),
        progress: progress([]),
        checks: { assessments: [] },
        after: { recorded: true, screen: null, lastingUnresolved: false },
      });
      await page.goto(url("/", lang));
      const s03 = page.locator('[data-screen="S03"]');
      await expect(s03).toBeVisible();
      await part(page, slot, name("S03-default"));
      await s03.locator(".cta").click();
      await expect(s03.locator(".check-field-error")).toBeVisible();
      await part(page, slot, name("S03-hint"));
      await s03.locator(".check-answer").nth(2).click();
      await part(page, slot, name("S03-selected"));
      await s03.locator(".cta").click();
      await expect(page.locator('[data-screen="S03"][data-sent="lasting"]')).toBeVisible();
      await part(page, slot, name("S03-lasting"));
      await page.evaluate(() => location.reload());
      await expect(page.locator(".next-workout")).toBeVisible();
      await mockApi(page, {
        context: context({
          firstCheck: false,
          completedBefore: true,
          retestDue: now + 26 * DAY,
          followUpDue: true,
        }),
        progress: progress([]),
        checks: { assessments: [] },
        after: { status: 500, body: { error: "SERVER" } },
      });
      await page.goto(url("/", lang));
      await s03.locator(".check-answer").first().click();
      await s03.locator(".cta").click();
      await expect(s03.locator('[role="alert"]')).toBeVisible();
      await part(page, slot, name("S03-error"));
      await mockApi(page, {
        context: context({
          firstCheck: false,
          completedBefore: true,
          retestDue: now + 26 * DAY,
          followUpDue: true,
        }),
        progress: progress([]),
        checks: { assessments: [] },
        after: { recorded: true, screen: null, lastingUnresolved: false },
      });
      await page.goto(url("/", lang));
      await s03.locator(".check-answer").first().click();
      await s03.locator(".cta").click();
      await expect(page.locator('[data-screen="S03"][data-sent="usual"]')).toBeVisible();
      await part(page, slot, name("S03-thanks"));
      await page.goto(url("/", lang));
      await expect(s03).toBeVisible();
      await ctx.setOffline(true);
      await s03.locator(".check-answer").first().click();
      await s03.locator(".cta").click();
      await expect(page.locator('[data-screen="S03"][data-sent="usual"] .check-chip')).toBeVisible();
      await part(page, slot, name("S03-offline"));
      await ctx.setOffline(false);

      // S02, the offer after the intake (the foundation gallery shows it over a page).
      await page.goto(url("/?e2eGallery=offer", lang));
      await expect(page.locator('[data-screen="S02"]')).toBeVisible();
      await shot(page, name("S02-default"), false);
      await ctx.setOffline(true);
      await expect(page.locator('[data-screen="S02"] .check-field-error')).toBeVisible();
      await shot(page, name("S02-offline"), false);
      await ctx.setOffline(false);

      // S54, the example, with and without the booth.
      await page.goto(url("/?example=progress", lang));
      await expect(page.locator('[data-screen="S54"]')).toBeVisible();
      // C37: one example card (start and now, the verdict) and the sign up QR; no chart or table.
      await shot(page, name("S54-default"));
      await page.evaluate(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(url("/?example=progress", lang));
      await expect(page.locator('[data-screen="S54"]')).toBeVisible();
      await shot(page, name("S54-booth"));
      await page.evaluate(() => sessionStorage.removeItem("azm.booth"));
      await ctx.close();
    });

    test(`results shots ${lang} ${size.tag}: S53 My results`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        hasTouch: size.tag !== "d",
        isMobile: size.tag !== "d",
      });
      const page = await ctx.newPage();
      await signIn(page, lang, `mine-${size.tag}`);
      const openResults = async () => {
        await page.goto(url("/", lang));
        const nav = page.locator(".portal-sidebar nav, .portal-tabs, nav").first();
        await nav
          .getByRole("button", { name: lang === "ar" ? "نتائجي" : "My results" })
          .first()
          .click();
        await expect(page.locator('[data-screen="S53"]')).toBeVisible();
      };
      // Empty (the real server: nothing done yet).
      await openResults();
      await expect(page.locator('[data-screen="S53"] h3')).toBeVisible();
      await shot(page, name("S53-empty"));

      const now = Date.now();
      const built = await buildStored(page, HISTORY);
      const full = {
        context: context({ firstCheck: false, completedBefore: true, retestDue: now + 26 * DAY }),
        progress: progress(built.tests, { retestDue: now + 26 * DAY }),
        checks: { assessments: built.checks },
      };
      await mockApi(page, full);
      await openResults();
      await expect(page.locator(".pg-series").first()).toBeVisible();
      await shot(page, name("S53-default"));
      await page.locator(".pg-trend .check-text-button").first().click();
      await part(page, ".pg-series", name("S53-table"));
      await page.locator(".pg-history-row").last().click();
      await expect(page.locator("[data-detail]")).toBeVisible();
      await shot(page, name("S53-checkDetail"));

      await mockApi(page, { ...full, delay: 4000 });
      await openResults();
      await shot(page, name("S53-loading"));
      await mockApi(page, { ...full, progress: { status: 500, body: { error: "SERVER" } } });
      await openResults();
      await expect(page.locator('[data-screen="S53"] [role="alert"]')).toBeVisible();
      await shot(page, name("S53-error"));
      await mockApi(page, full);
      await openResults();
      await expect(page.locator(".pg-series").first()).toBeVisible();
      await ctx.setOffline(true);
      await expect(page.locator("[data-last-loaded]")).toBeVisible();
      await shot(page, name("S53-offline"));
      await ctx.setOffline(false);
      await ctx.close();
    });
  }
}
