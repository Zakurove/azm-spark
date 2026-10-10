/**
 * The results and My results stream in the browser, in Arabic and English (UX spec S01 to S03, S50
 * to S54; contract v3 L):
 *   - S50 the guest at the booth: values, not measured and skipped tests with reasons, the register
 *     block whose QR the browser's own reader decodes to the public sign up, a new visitor;
 *   - S51 the first check: the next step, Return to Today and See your checks over time (to S53);
 *     a save that waits: the save error with Try again, which clears once the outbox is done;
 *   - S52 a re-test: then and now from the rules, verdicts in words, the number line, the heavier
 *     weight offer, the repeat offer after a lower result;
 *   - S53 My results: empty from the real server, series cards with the trend and its table, the
 *     history and the read only view of a check, the error with Try again, offline with the date;
 *   - S01 the Today card in its variants, the H9 early start dialog, S03 the next day question;
 *   - S02 the offer after the intake; S54 the example, read only and labelled;
 *   - no page scrolls sideways at 320 and 375 px.
 * The flow reaches its results through the reload snapshot (useCheckFlow), because the screens before
 * them belong to other streams; the camera fixture (?e2eFixture=) plays no part after the camera.
 * Home checks are closed on the E2E server (contract v3 I), so the check API is mocked where a state
 * needs data the server cannot hold yet (e2e/results-data.ts).
 */
import { expect, test, type Page } from "@playwright/test";
import { DISCLAIMERS } from "../tests/no-disclaimers";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import arProgress from "../src/i18n/ar/progress.json" with { type: "json" };
import enProgress from "../src/i18n/en/progress.json" with { type: "json" };
import check from "../src/movements/check-v1.json" with { type: "json" };
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
  smallestText,
  url,
  watchConsole,
  type Lang,
  type Outcome,
} from "./results-data";

const COPY = { ar: { a: ar, p: arProgress }, en: { a: en, p: enProgress } } as const;
const DATA = check as unknown as {
  progress: {
    verdicts: Record<"higher" | "same" | "lower", Record<Lang, string>>;
    labels: Record<string, Record<Lang, string>>;
    lowerExtra: Record<Lang, string>;
  };
  boundary: Record<string, Record<Lang, string>>;
  tests: { id: string; name: Record<Lang, string> }[];
};
/** A test's name as the page shows it: as written, Western digits in both languages (D-036 item 3). */
const testName = (id: string, lang: Lang) => DATA.tests.find((x) => x.id === id)!.name[lang];

const measured = (value: number, detail: Record<string, unknown> = {}): Outcome => ({
  status: "measured",
  value,
  detail,
});

const GUEST: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(121, RAISE),
  "shoulder_abduction:left": { status: "notMeasured", reason: "quality" },
  "trunk_control_seated:right": { status: "skipped", reason: "pain_today" },
  "trunk_control_seated:left": { status: "skipped", reason: "pain_today" },
  "arm_curl_30s:right": measured(14, CURL),
  "arm_curl_30s:left": measured(12, CURL),
};

const FIRST: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(122, RAISE),
  "shoulder_abduction:left": measured(115, RAISE),
  "trunk_control_seated:right": measured(18, LEAN),
  "trunk_control_seated:left": measured(16, LEAN),
  "arm_curl_30s:right": measured(13, CURL),
  "arm_curl_30s:left": measured(7, CURL),
};

/** The QR codes the browser's own reader finds in an SVG, drawn on a canvas. */
async function readQr(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(async (sel) => {
    const svg = document.querySelector(sel)!.cloneNode(true) as SVGSVGElement;
    svg.querySelector("rect")!.setAttribute("fill", "#fff");
    svg.querySelector("path")!.setAttribute("fill", "#000");
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "400");
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    canvas.getContext("2d")!.drawImage(img, 0, 0, 400, 400);
    type Reader = { detect(c: HTMLCanvasElement): Promise<{ rawValue: string }[]> };
    const Detector = (window as unknown as { BarcodeDetector: new (o: object) => Reader }).BarcodeDetector;
    const codes = await new Detector({ formats: ["qr_code"] }).detect(canvas);
    return codes.map((c) => c.rawValue);
  }, selector);
}

/** Nothing on the screen is under 16 px at 375 px wide (UX spec 0.4), charts included. */
async function expectReadable(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  const small = await smallestText(page);
  expect(small.px, `«${small.text}»`).toBeGreaterThanOrEqual(15.9);
}

async function noSideScroll(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, `page width at ${width}`).toBeLessThanOrEqual(width);
}

test("the S50 QR encoder writes codes the browser reads, for every length up to version 10", async ({
  page,
}) => {
  await page.goto("/?e2eGallery=empty");
  const texts = [
    "a",
    "https://azm-spark.gymwise.ai/?register=1",
    "قياس الحركة · Movement check",
    `https://example.test/${"x".repeat(80)}`,
    "0123456789".repeat(21),
  ];
  const read = await page.evaluate(async (all) => {
    const { encodeQr } = await import("/src/features/assessment/shared/qr.ts" as string);
    type Reader = { detect(c: HTMLCanvasElement): Promise<{ rawValue: string }[]> };
    const Detector = (window as unknown as { BarcodeDetector: new (o: object) => Reader }).BarcodeDetector;
    const out: string[] = [];
    for (const text of all) {
      const qr = encodeQr(text);
      const n = qr.size + 8;
      const scale = 6;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = n * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      qr.modules.forEach((row: boolean[], y: number) =>
        row.forEach((dark, x) => dark && ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale)),
      );
      const codes = await new Detector({ formats: ["qr_code"] }).detect(canvas);
      out.push(codes[0]?.rawValue ?? "");
    }
    return out;
  }, texts);
  expect(read).toEqual(texts);
});

for (const lang of LANGS) {
  const a = COPY[lang].a;
  const p = COPY[lang].p;

  test.describe(`results and My results (${lang})`, () => {
    test("S50: the guest's results at the booth, the QR to the sign up and a new visitor", async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url("/?e2eGallery=empty", lang));
      await openSnapshot(
        page,
        lang,
        resultsSnapshot({ mode: "guest", booth: true, homeOpen: false, items: SEATED, outcomes: GUEST }),
        true,
      );
      const s50 = page.locator('[data-screen="S50"]');
      await expect(s50).toBeVisible();
      await expect(page.locator("h1")).toHaveText(a.guest.resultsTitle);
      // C31: no booth "not saved" line under the title.
      await expect(page.locator(".pg-lead")).toHaveCount(0);
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      // One card per test tried, in run order; the skipped test under "Not today".
      await expect(page.locator(".rs-card .rs-test")).toHaveText([
        testName("shoulder_abduction", lang),
        testName("arm_curl_30s", lang),
      ]);
      await expect(page.locator('.rs-row[data-status="notMeasured"] .rs-not')).toHaveText(
        DATA.progress.labels.notMeasured[lang],
      );
      // C32: one muted line names the skipped test, then its reason once.
      await expect(page.locator("[data-skipped] p").first()).toContainText(
        testName("trunk_control_seated", lang),
      );
      await expect(page.locator(".rs-skips")).toHaveCount(0);
      await expect(page.locator(".rs-card").first()).toContainText(
        lang === "ar" ? "121 درجة" : "121 degrees",
      );
      // No comparison and no verdict for a guest.
      await expect(page.locator(".pg-pill")).toHaveCount(0);
      // The register block: the QR opens the public sign up, never this visit.
      await expect(page.locator(".rs-keep h2")).toHaveText(a.guest.register);
      const origin = new URL(page.url()).origin;
      expect(await readQr(page, "svg[data-qr]")).toEqual([`${origin}/?app=1&register=1`]);
      await expect(page.locator("svg[data-qr]")).toHaveAttribute("aria-label", a.guest.qrAlt);
      // D-017 item 2: no footer disclaimer at the booth.
      await expect(page.locator(".check-results-footer")).toHaveCount(0);
      for (const d of DISCLAIMERS[lang]) await expect(page.locator("body")).not.toContainText(d);
      await expectReadable(page);
      await noSideScroll(page, 320);
      await page.setViewportSize({ width: 375, height: 812 });
      // A new visitor leaves this visitor's results, after the S57 confirm.
      await page.locator(".check-footer").getByRole("button", { name: a.guest.newVisitor }).click();
      // The next visitor starts on a fresh page (location.replace while online, S57).
      const reloaded = page.waitForEvent("load");
      await page
        .getByRole("dialog", { name: a.booth.resetConfirm })
        .getByRole("button", { name: a.booth.resetYes })
        .click();
      await reloaded;
      await expect(s50).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("S51: the starting point, the next step, and the way to My results and Today", async ({ page }) => {
      const errors = watchConsole(page);
      await signIn(page, lang, "s51");
      const now = Date.now();
      await mockApi(page, {
        context: context({ firstCheck: false, completedBefore: true, retestDue: now + 28 * DAY }),
        progress: progress([]),
        checks: { assessments: [] },
      });
      const snap = resultsSnapshot({
        mode: "signedIn",
        booth: false,
        checkId: "e2e-first",
        checkKind: "baseline",
        items: SEATED,
        outcomes: FIRST,
      });
      await openSnapshot(page, lang, snap, false);
      await expect(page.locator('[data-screen="S51"]')).toBeVisible();
      await expect(page.locator("h1")).toHaveText(a.results.startTitle);
      await expect(page.locator("h1")).toBeFocused();
      await expect(page.locator(".pg-lead")).toHaveText(DATA.boundary.firstResult[lang]);
      await expect(page.locator(".rs-card")).toHaveCount(3);
      await expect(page.locator(".rs-next h2")).toHaveText(a.results.nextHeading);
      await expect(page.locator(".rs-next")).toContainText(a.results.keepProgram);
      // The one gold action, and See your checks over time opens My results.
      await expect(page.locator(".cta")).toHaveCount(1);
      await page.getByRole("button", { name: a.results.seeOverTime }).click();
      await expect(page.locator('[data-screen="S53"]')).toBeVisible();
      await expect(page.locator(".portal-sidebar nav button.active")).toContainText(p.nav.label);
      // Return to Today from a fresh copy of the results: the top bar ✕ and the footer both say it.
      await openSnapshot(page, lang, snap, false);
      await expect(
        page.locator(".check-topbar").getByRole("button", { name: a.common.backToToday }),
      ).toBeVisible();
      await page.locator(".check-footer").getByRole("button", { name: a.common.backToToday }).click();
      // Today: the next session; the upcoming check card lives on My results (C43).
      await expect(page.locator(".next-workout")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("S51: a save that waits shows the error with Try again, and clears once saved", async ({
      page,
      context: browser,
    }) => {
      const owner = await signIn(page, lang, "save");
      await mockApi(page, { context: context({ firstCheck: false, completedBefore: true }) });
      let refuse = true;
      let calls = 0;
      await page.route("**/api/assessments/e2e-save/complete", (r) => {
        calls += 1;
        return refuse
          ? r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"UNAVAILABLE"}' })
          : r.fulfill({
              status: 200,
              contentType: "application/json",
              body: '{"id":"e2e-save","completed":1}',
            });
      });
      await queueCompletion(page, owner, "e2e-save");
      const snap = resultsSnapshot({
        mode: "signedIn",
        booth: false,
        checkId: "e2e-save",
        checkKind: "baseline",
        items: SEATED,
        outcomes: FIRST,
      });
      await openSnapshot(page, lang, snap, false);
      await expect(page.locator('[data-save="error"]')).toBeVisible();
      await expect(page.locator('[data-chip="notSaved"]')).toHaveText(a.common.notSavedYet);
      await expect(page.locator(".rs-head")).toContainText(a.state.error.title);
      // Offline: the chip stays and the banner says the results are saved later.
      await browser.setOffline(true);
      await expect(page.locator('[data-save="pending"]')).toBeVisible();
      await expect(page.locator(".check-offline")).toContainText(a.state.offline.savedLater);
      // Back online the outbox sends again, and the server still refuses.
      const before = calls;
      await browser.setOffline(false);
      await expect.poll(() => calls).toBeGreaterThan(before);
      await expect(page.locator('[data-save="error"]')).toBeVisible();
      // Try again once the server takes it: saved, no chip.
      refuse = false;
      await page.locator(".rs-head").getByRole("button", { name: a.common.retry }).click();
      await expect(page.locator('[data-save="saved"]')).toBeVisible();
      await expect(page.locator('[data-chip="notSaved"]')).toHaveCount(0);
      // Values never left the screen.
      await expect(page.locator(".rs-card")).toHaveCount(3);
    });

    test("S52: then and now from the rules, the verdicts in words, the offers", async ({ page }) => {
      const errors = watchConsole(page);
      await signIn(page, lang, "s52");
      const built = await buildStored(page, HISTORY);
      const tests = (
        built.tests as { testId: string; side: string; setting: string; current: boolean }[]
      ).map((v) =>
        v.testId === "arm_curl_30s" && v.side === "right" && v.current
          ? { ...v, loadStep: { from: { kind: "dumbbell", kg: 2 }, to: { kind: "dumbbell", kg: 3 } } }
          : v,
      );
      await mockApi(page, {
        context: context({ firstCheck: false, completedBefore: true }),
        progress: progress(tests),
        checks: { assessments: built.checks },
      });
      await openSnapshot(
        page,
        lang,
        resultsSnapshot({
          mode: "signedIn",
          booth: false,
          checkId: "e2e-retest",
          checkKind: "retest",
          items: SEATED,
          outcomes: { ...FIRST, "trunk_control_seated:right": { status: "skipped", reason: "pain_today" } },
        }),
        false,
      );
      await expect(page.locator("h1")).toHaveText(a.results.nowTitle);
      const raiseRight = page.locator('.rs-card[data-test="shoulder_abduction"] .rs-row[data-side="right"]');
      await expect(raiseRight.locator(".pg-pill")).toHaveText(DATA.progress.verdicts.higher[lang]);
      // C42: start and now in one line, no change line and no range bar; how to read, once above.
      await expect(raiseRight.locator(".pg-startnow")).toContainText(DATA.progress.labels.start[lang]);
      await expect(raiseRight.locator(".pg-change, .pg-line")).toHaveCount(0);
      await expect(page.locator("[data-how-to-read]")).toHaveCount(1);
      const raiseLeft = page.locator('.rs-card[data-test="shoulder_abduction"] .rs-row[data-side="left"]');
      await expect(raiseLeft.locator(".pg-pill")).toHaveText(DATA.progress.verdicts.same[lang]);
      const curlLeft = page.locator('.rs-card[data-test="arm_curl_30s"] .rs-row[data-side="left"]');
      await expect(curlLeft.locator(".pg-pill")).toHaveText(DATA.progress.verdicts.lower[lang]);
      await expect(curlLeft).toContainText(DATA.progress.lowerExtra[lang]);
      // The repeat offer after a lower result, in the next step.
      await expect(page.locator(".rs-next")).toContainText(
        a.entry.repeatOffer.body.split("{from}")[0].trim().slice(0, 12),
      );
      // Q26: two equal buttons, none selected; a choice is pressed and kept for the next check.
      const offer = page.locator('.rs-card[data-test="arm_curl_30s"] .pg-offer');
      await expect(offer.locator('button[aria-pressed="false"]')).toHaveCount(2);
      await page.route("**/api/progress/load-step", (r) =>
        r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ side: "right", choice: "heavier", next: { kind: "dumbbell", kg: 3 } }),
        }),
      );
      const chosen = page.waitForRequest("**/api/progress/load-step");
      await offer.locator("button").first().click();
      await expect(offer.locator('button[aria-pressed="true"]')).toHaveCount(1);
      expect((await chosen).postDataJSON()).toEqual({ side: "right", choice: "heavier" });
      // The side lean side skipped today stays named in its card.
      await expect(
        page.locator('.rs-card[data-test="trunk_control_seated"] .rs-row[data-side="right"]'),
      ).toContainText(DATA.progress.labels.notMeasured[lang]);
      await expectReadable(page);
      await noSideScroll(page, 320);
      expect(errors).toEqual([]);
    });

    test("S53: empty, then series cards with trends, the history, errors and offline", async ({
      page,
      context: browser,
    }) => {
      const errors = watchConsole(page);
      await signIn(page, lang, "s53");
      const nav = () => page.locator(".portal-sidebar nav").getByRole("button", { name: p.nav.label });
      await page.goto(url("/", lang));
      await nav().click();
      // The real server: no check yet, home checks closed (no start offered).
      await expect(page.locator('[data-screen="S53"] h3')).toHaveText(p.empty.title);
      await expect(page.locator('[data-screen="S53"] .cta')).toHaveCount(0);
      await expect(page.locator('[data-variant="homeSoon"]')).toBeVisible();
      await expect(page.locator('[data-block="sessions"]')).toContainText(p.sessions.none);

      const now = Date.now();
      const built = await buildStored(page, HISTORY);
      const full = {
        context: context({ firstCheck: false, completedBefore: true, retestDue: now + 26 * DAY }),
        progress: progress(built.tests, { retestDue: now + 26 * DAY }),
        checks: { assessments: built.checks },
      };
      await mockApi(page, full);
      await page.goto(url("/", lang));
      await nav().click();
      // Arm raise right and left, side lean right, arm curl right and left; no booth card (C34).
      const cards = page.locator(".pg-series");
      await expect(cards).toHaveCount(5);
      await expect(page.locator(".pg-series .pg-chip")).toHaveCount(0);
      // C42: one How to read note above the cards, with the band sentence once.
      await expect(page.locator("[data-how-to-read]")).toHaveCount(1);
      await expect(page.locator(".pg-band-note")).toHaveCount(0);
      // Trends from the third check only: the arm raise right with its booth point.
      await expect(page.locator(".pg-trend")).toHaveCount(1);
      await expect(page.locator(".pg-trend > svg .pg-mark-booth")).toHaveCount(1);
      await page.locator(".pg-trend").getByRole("button", { name: p.trend.table }).click();
      const table = page.locator(".pg-table");
      await expect(table.locator("caption")).toBeVisible();
      await expect(table.locator('th[scope="col"]')).toHaveCount(3);
      await expect(table.locator("tbody tr")).toHaveCount(5);
      await expect(table).toContainText(DATA.progress.labels.boothPoint[lang]);
      await page.locator(".pg-trend").getByRole("button", { name: p.trend.chart }).click();
      await expect(page.locator(".pg-trend svg[role='img']")).toBeVisible();
      // Sessions as n of every 10.
      await expect(page.locator('[data-block="sessions"]')).toContainText(
        lang === "ar" ? "8 من كل 10" : "8 of every 10",
      );
      // The history opens the read only view of a check; Back returns to its row.
      const rows = page.locator(".pg-history-row");
      await expect(rows).toHaveCount(built.checks.length);
      const last = rows.last();
      const id = await last.getAttribute("data-check");
      await last.click();
      await expect(page.locator(`[data-detail="${id}"]`)).toBeVisible();
      await expect(page.locator(`[data-detail="${id}"] h2`)).toBeFocused();
      await expect(page.locator(`[data-detail="${id}"] .pg-pill`).first()).toBeVisible();
      await page.getByRole("button", { name: a.common.back }).click();
      await expect(page.locator(`[data-check="${id}"]`)).toBeFocused();
      await expectReadable(page);
      await noSideScroll(page, 320);
      await page.setViewportSize({ width: 375, height: 812 });

      // The error, then Try again once the server answers.
      await mockApi(page, { ...full, progress: { status: 500, body: { error: "SERVER" } } });
      await page.goto(url("/", lang));
      await nav().click();
      const alert = page.locator('[data-screen="S53"] [role="alert"]');
      await expect(alert).toContainText(p.error.title);
      // The next check still renders from the context.
      await expect(page.locator('.check-results-page [data-screen="S01"]')).toBeVisible();
      await mockApi(page, full);
      await alert.getByRole("button", { name: a.common.retry }).click();
      await expect(cards).toHaveCount(5);

      // Offline: the last loaded copy stays with its date.
      await browser.setOffline(true);
      await expect(page.locator(".check-offline")).toBeVisible();
      await expect(page.locator("[data-last-loaded]")).toBeVisible();
      await expect(cards).toHaveCount(5);
      await browser.setOffline(false);
      expect(errors).toEqual([]);
    });

    test("S01 and S03: the check card on Today when due or open, the rest on My results, the next day question", async ({
      page,
      context: browser,
    }) => {
      const errors = watchConsole(page);
      await signIn(page, lang, "s01");
      const now = Date.now();
      const slot = page.locator(".check-slot");
      const hero = page.locator(".next-workout");
      /** Today with this context: the S01 card shows only when a check is due or open (C43). */
      const today = async (over: Record<string, unknown>, extra = {}, shown = true) => {
        await mockApi(page, {
          context: context(over),
          progress: progress([]),
          checks: { assessments: [] },
          ...extra,
        });
        await page.goto(url("/", lang));
        await expect(hero).toBeVisible();
        if (shown) await expect(slot.locator('[data-screen="S01"][data-variant]')).toBeVisible();
      };
      /** My results with this context: every S01 variant, the ones without a start too. */
      const results = page.locator(".check-results-page");
      const onResults = async (over: Record<string, unknown>) => {
        await today(over, {}, false);
        await page.locator(".portal-sidebar nav").getByRole("button", { name: p.nav.label }).click();
        await expect(results.locator('[data-screen="S01"][data-variant]')).toBeVisible();
      };
      // The real server first: home checks are closed on the E2E server. No dead end on Today.
      await page.goto(url("/", lang));
      await expect(hero).toBeVisible();
      await expect(slot.locator('[data-screen="S01"]')).toHaveCount(0);

      // Due or open: on Today, with the session start the one gold action (C43).
      await today({});
      const first = slot.locator('[data-variant="first"]');
      await expect(first.locator("h2")).toHaveText(a.name);
      await expect(first.locator(".ghost")).toHaveText(a.entry.first.cta);
      await expect(slot.locator(".cta")).toHaveCount(0);
      // C52: every button and link of the portal is 48 px tall or more, as in the check.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".portal-shell button, .portal-shell a")]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => ({ name: el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
          .filter((x) => x.h < 48),
      );
      expect(small).toEqual([]);
      await today({ firstCheck: false, completedBefore: true, retestDue: now - DAY });
      await expect(slot.locator('[data-variant="due"] h2')).toHaveText(a.entry.due.title);
      await today({
        firstCheck: false,
        completedBefore: true,
        sideLeanRepeat: { from: now - DAY, to: now + 4 * DAY, baseTests: ["trunk_control_seated"] },
      });
      await expect(slot.locator('[data-variant="leanRepeat"] .ghost')).toHaveText(a.entry.leanRepeat.cta);
      // An open check within its 30 minutes: where it stopped, and Continue (O6).
      const open = openCheck(now);
      await today(open.context, { checks: { assessments: [open.check] } });
      const resume = slot.locator('[data-variant="resume"]');
      await expect(resume.locator("h2")).toHaveText(a.entry.resume.title);
      await expect(resume).toContainText(lang === "ar" ? "الاختبار 2 من 3" : "test 2 of 3");
      await expect(resume.locator(".ghost")).toHaveText(a.entry.resume.cta);

      // Paused, blocked, too soon: never on Today; My results says so.
      for (const over of [
        { lock: { until: now + DAY, releasableByClearance: true, when: { token: "nextDay_midnight" } } },
        { blocked: "clinical_review" },
        { firstCheck: false, completedBefore: true, earliestNext: now + DAY },
      ]) {
        await today(over, {}, false);
        await expect(slot.locator('[data-screen="S01"]')).toHaveCount(0);
      }
      await onResults({
        lock: { until: now + DAY, releasableByClearance: true, when: { token: "nextDay_midnight" } },
      });
      await expect(results.locator('[data-variant="locked"][role="status"] h2')).toHaveText(
        a.entry.locked.title,
      );
      await expect(results.getByRole("button", { name: a.entry.locked.cleared })).toBeVisible();
      await onResults({ firstCheck: false, completedBefore: true, earliestNext: now + DAY });
      await expect(results.locator('[data-variant="tooSoon"] button')).toHaveCount(0);

      // Upcoming, on My results: the early start asks first (H9), Later closes, Start now opens the check.
      await onResults({ firstCheck: false, completedBefore: true, retestDue: now + 20 * DAY });
      await results.getByRole("button", { name: a.entry.upcoming.early }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("h2")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(results.getByRole("button", { name: a.entry.upcoming.early })).toBeFocused();
      await results.getByRole("button", { name: a.entry.upcoming.early }).click();
      await dialog.locator(".cta").click();
      await expect(page.locator(".check-base")).toBeVisible();

      // S03 above the card: select, then Send; lasting shows the 937 call.
      const due = { firstCheck: false, completedBefore: true, retestDue: now + 26 * DAY, followUpDue: true };
      await today(due, { after: { recorded: true, screen: null, lastingUnresolved: true } }, false);
      const s03 = slot.locator('[data-screen="S03"]');
      await expect(s03.locator("legend")).toBeVisible();
      await s03.getByRole("button", { name: a.after.send }).click();
      await expect(s03.locator(".check-field-error")).toHaveText(a.common.chooseToContinue);
      const answers = s03.locator(".check-answer");
      await expect(answers).toHaveCount(3);
      await answers.nth(2).click();
      await expect(answers.nth(2)).toHaveAttribute("aria-pressed", "true");
      await s03.getByRole("button", { name: a.after.send }).click();
      await expect(slot.locator('[data-screen="S03"][data-sent="lasting"] [role="status"]')).toBeVisible();
      await expect(slot.locator('a[href="tel:937"]')).toBeVisible();
      // I will answer later hides it until the next app open.
      await today(due, {}, false);
      await slot.getByRole("button", { name: a.after.notNow }).click();
      await expect(slot.locator('[data-screen="S03"]')).toHaveCount(0);
      // Offline: the answer waits for the connection and the thanks says it is not saved yet.
      await today(due, {}, false);
      await expect(s03).toBeVisible();
      await browser.setOffline(true);
      await answers.first().click();
      await s03.getByRole("button", { name: a.after.send }).click();
      const sent = slot.locator('[data-screen="S03"][data-sent="usual"]');
      await expect(sent).toContainText(a.after.thanks);
      await expect(sent).toContainText(a.common.notSavedYet);
      await browser.setOffline(false);
      expect(errors).toEqual([]);
    });

    test("S02 and S54: the offer after the intake, and the labelled example", async ({
      page,
      context: browser,
    }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?e2eGallery=offer", lang));
      const offer = page.locator('[data-screen="S02"]');
      await expect(offer.locator("h2")).toHaveText(a.afterIntake.title);
      await expect(offer.locator("h2")).toBeFocused();
      await expect(offer.getByRole("button", { name: a.afterIntake.start })).toBeVisible();
      await browser.setOffline(true);
      await expect(offer).toContainText(a.state.offline.startBlocked);
      await expect(offer.locator(".cta")).toHaveCount(0);
      await browser.setOffline(false);

      await page.goto(url("/?example=progress", lang));
      const banner = page.getByRole("region", { name: p.example.tag });
      await expect(banner).toContainText(p.example.banner);
      await expect(page.locator("h1")).toHaveText(p.example.title);
      // C37: one labelled card, start and now with the verdict in words.
      const cards = page.locator(".pg-series");
      await expect(cards).toHaveCount(1);
      await expect(cards.locator(".pg-chip").last()).toHaveText(p.example.tag);
      await expect(page.locator(".pg-pill")).toHaveText(DATA.progress.verdicts.higher[lang]);
      // Away from the booth the page is already on the person's phone: no QR to scan (R-13).
      await expect(page.locator("svg[data-qr]")).toHaveCount(0);
      // Closed home checks, no booth: Create a free account leads, and the check is not offered.
      await expect(page.locator(".check-footer .cta")).toHaveText(p.example.register);
      await expect(page.getByRole("button", { name: p.example.tryCheck })).toHaveCount(0);
      // The banner stays in view while the page scrolls.
      await page.mouse.wheel(0, 2000);
      await expect(banner).toBeInViewport();
      await expectReadable(page);
      await noSideScroll(page, 320);
      // At the booth: Try the movement check opens the guest check.
      await page.evaluate(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(url("/?example=progress", lang));
      // The sign up QR is for the visitor's own phone, at the booth only.
      await expect(page.locator("svg[data-qr]")).toBeVisible();
      await page.locator(".check-footer .cta").click();
      await expect(page).toHaveURL(/check=1/);
      expect(errors).toEqual([]);
    });
  });
}
