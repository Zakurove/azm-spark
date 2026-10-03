/**
 * Round 3 review fixes (UX spec 0.5, 4.1, 4.2, 4.7, 4.8, S34, S41, S43 to S49, definition of done), in
 * Arabic and English, driven from flow snapshots with the fixture camera:
 *   - a double tap on STOP, or on «أريد التوقف» of the check in, never picks a stop list reason;
 *   - the answers and STOP of S38b, S47, S48 and S49 end above the fold at 375 x 812 and 375 x 667 (a
 *     person 2 m away cannot scroll), and the whole of S43 fits the compact phones;
 *   - the S48 count field takes focus;
 *   - with the check in on at home, a person sitting still through the practice is asked (D-016).
 * Timers run on Playwright's fake clock where they matter.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import data from "../src/movements/check-v1.json" with { type: "json" };
import { PREVIEW_NAMES, PREVIEWS } from "../src/features/assessment/camera/e2e/previews";
import { camModel } from "./camera-fixtures";
import { MEASURE, openGuest, openSignedIn, type Lang, type ModelOptions } from "./safety-fixtures";

const COPY = { ar, en } as const;
const LANGS: Lang[] = ["ar", "en"];

// The chime plays without a tap in these runs.
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

/**
 * Each context comes from its own address (X-Forwarded-For, read from the server's one trusted hop),
 * so the accounts this spec makes never use up the sign up limit of the other specs' address.
 */
let address = 0;
async function phone(browser: Browser, width: number, height: number): Promise<Page> {
  address += 1;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    extraHTTPHeaders: { "x-forwarded-for": `198.19.${address % 250}.${1 + Math.floor(address / 250)}` },
  });
  return context.newPage();
}

/** The centre of an element, in viewport pixels. */
async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** S43 over a measuring test at home, with the check in on (D-016). */
const CHECK_IN: ModelOptions = { state: MEASURE, overlay: { kind: "checkIn" }, checkIn: true };

/** Two taps at the same point, 120 ms apart: a double tap, as a tremor or an anxious press gives. */
async function doubleTap(page: Page, p: { x: number; y: number }) {
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(p.x, p.y);
}

/**
 * Every data-fold element (the answers) ends above the fold: the top of the sticky
 * STOP zone or footer, or the bottom of the viewport; STOP itself is inside the viewport.
 */
async function expectAboveFold(page: Page, what: string) {
  const r = await page.evaluate(() => {
    const layer = document.querySelector(".check-overlay") ?? document;
    const zones = [...layer.querySelectorAll<HTMLElement>(".safety-stop-zone, .check-footer")].map((z) =>
      z.getBoundingClientRect(),
    );
    const fold = Math.min(innerHeight, ...zones.map((z) => z.top));
    const folds = [...layer.querySelectorAll<HTMLElement>("[data-fold]")].map(
      (el) => el.getBoundingClientRect().bottom,
    );
    const stop = [...layer.querySelectorAll<HTMLElement>(".safety-stop")].map((s) =>
      s.getBoundingClientRect(),
    );
    return { fold, folds, stop: stop.map((s) => [s.top, s.bottom]), ih: innerHeight };
  });
  expect(r.folds.length, `${what}: answers`).toBeGreaterThan(0);
  for (const b of r.folds)
    expect(b, `${what}: an answer ends below the fold`).toBeLessThanOrEqual(r.fold + 1);
  for (const [top, bottom] of r.stop) {
    expect(top, `${what}: STOP`).toBeGreaterThanOrEqual(0);
    expect(bottom, `${what}: STOP`).toBeLessThanOrEqual(r.ih + 1);
  }
}

for (const lang of LANGS) {
  const a = COPY[lang];

  test.describe(`review fixes, safety (${lang})`, () => {
    test("a double tap on STOP opens the stop list and answers nothing (S41)", async ({ browser }) => {
      const page = await phone(browser, 375, 812);
      await openGuest(page, lang, { state: MEASURE });
      const stop = page.locator(".s34-stop");
      await expect(stop).toBeVisible();
      await doubleTap(page, await centre(page, ".s34-stop"));
      const list = page.locator('.check-overlay [data-screen="S41"]');
      await expect(list).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(list).toBeVisible();
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.measure");
      await expect(page.locator('[data-screen="S38"], [data-screen="S36"], [data-screen="S42"]')).toHaveCount(
        0,
      );
      // A deliberate tap afterwards still answers.
      const label = data.stopRouting.options.find((o) => o.id === "choice")!.label[lang];
      await list.getByRole("button", { name: label }).click();
      await expect(page.locator('[data-screen="S42"]')).toBeVisible();
      await page.context().close();
    });

    test("a double tap on «أريد التوقف» of the check in opens the stop list and answers nothing", async ({
      browser,
    }) => {
      const page = await phone(browser, 375, 812);
      await openSignedIn(page, lang, CHECK_IN);
      const want = '[data-screen="S43"] .safety-want-stop';
      await expect(page.locator(want)).toBeVisible();
      await doubleTap(page, await centre(page, want));
      const list = page.locator('.check-overlay [data-screen="S41"]');
      await expect(list).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(list).toBeVisible();
      await expect(page.locator('[data-screen="S38"], [data-screen="S36"], [data-screen="S42"]')).toHaveCount(
        0,
      );
      await page.context().close();
    });

    const FOLD: { name: string; open: ModelOptions; screen: string }[] = [
      { name: "S38b", open: { state: { kind: "faintAsk" } }, screen: "S38b" },
      {
        name: "S47",
        open: { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" } },
        screen: "S47",
      },
      {
        name: "S47 after STOP",
        open: { state: { kind: "between", i: 0, side: 0, scope: "side", via: "stop" } },
        screen: "S47",
      },
      { name: "S48 contact", open: { state: { kind: "after.contact", i: 2, side: 0 } }, screen: "S48" },
      { name: "S48 count", open: { state: { kind: "after.count", i: 1, side: 0 } }, screen: "S48" },
      { name: "S49", open: { state: { kind: "endQuestion" } }, screen: "S49" },
    ];
    for (const [w, h] of [
      [375, 812],
      [375, 667],
    ] as const) {
      test(`answers and STOP are on screen without scrolling at ${w} x ${h}`, async ({ browser }) => {
        test.setTimeout(120_000);
        for (const f of FOLD) {
          const page = await phone(browser, w, h);
          await openGuest(page, lang, f.open);
          await expect(page.locator(`[data-screen="${f.screen}"]`), f.name).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(200);
          await expectAboveFold(page, `${f.name} ${w}x${h}`);
          await page.context().close();
        }
      });
    }

    // On the compact phones the whole of S43 is in view, the help line after 30 s included, with and
    // without the offline banner: a person coming back to the phone never scrolls.
    for (const [w, h] of [
      [375, 667],
      [320, 568],
    ] as const) {
      test(`S43 keeps its question and both answers in view at ${w} x ${h}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.clock.install();
        await openSignedIn(page, lang, CHECK_IN);
        const s43 = page.locator('[data-screen="S43"]');
        await expect(s43).toBeVisible();
        for (const offline of [false, true]) {
          if (offline) {
            await page.clock.runFor(30_500);
            await expect(s43.locator(".safety-checkin-line")).toHaveAttribute("data-help", "true");
            await page.context().setOffline(true);
          }
          await page.evaluate(() => document.fonts.ready);
          const what = `S43${offline ? " unanswered offline" : ""} ${w}x${h}`;
          for (const sel of ["h1", ".safety-checkin-line", ".safety-fine", ".safety-want-stop"]) {
            const box = await s43.locator(sel).boundingBox();
            if (!box) continue;
            expect(box.y, `${what}: ${sel} top`).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height, `${what}: ${sel} bottom`).toBeLessThanOrEqual(h + 1);
          }
          expect((await s43.locator(".safety-fine").boundingBox())!.height).toBeGreaterThanOrEqual(120);
        }
        await page.context().setOffline(false);
      });
    }

    test("S48: No, my count is different moves focus to the count field", async ({ browser }) => {
      const page = await phone(browser, 375, 812);
      await openGuest(page, lang, { state: { kind: "after.count", i: 1, side: 0 } });
      await page.locator('[data-screen="S48"] [data-value="no"]').click();
      await page.waitForTimeout(3200);
      const field = page.getByLabel(a.count.howMany);
      await expect(field).toBeFocused();
      await page.context().close();
    });
  });
}

/** The values read from 2 m on the camera stage  });
}

/**
 * The values read from 2 m on the camera stage, the view diagram with its line (the wheelchair side
 * change on S34j, a view problem on S34c) and the controls at the phone (4.1, 4.2, S34).
 */
const KEY_VALUES = [
  ".s34-count",
  ".s34-degrees",
  ".s34-countdown",
  ".s34-go",
  ".s34-rest-num",
  ".s34-phase",
  ".s34-word",
  ".s34-line40",
  ".s34-caption-short",
  ".s34-restart",
  ".s34-at-phone button",
  ".s34-topview",
  ".s34-meta",
];

/** The cues whose sentence always stays, whatever the fit level (R3C-16 (2) (e)). */
const ALWAYS_SENTENCE = [
  "check_stop_any_time",
  "check_sit_minute",
  "test_trunk_lean_left",
  "test_trunk_lean_right",
  "test_curl_grip",
  "test_stand_dizzy",
];

/**
 * C29 and R3C-16: every preview keeps its 2 m values inside the stage, and its caption is one line:
 * the short form, or the sentence where it carries a safety limit (ALWAYS_SENTENCE). On the compact
 * phones a sentence that must stay is kept in full; where that pushes a value out, the cue is listed
 * for the Arabic seat to shorten (C10: every sentence must fit 3 lines at 34 px), since the fit level
 * is a safety net, not the layout.
 */
for (const lang of LANGS) {
  for (const [w, h] of [
    [375, 812],
    [375, 667],
  ] as const) {
    test(`S34: every preview keeps its 2 m values inside the stage at ${w} x ${h} (${lang})`, async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.addInitScript(
        ([m]) => {
          if (typeof speechSynthesis !== "undefined")
            Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
          sessionStorage.setItem("azm.booth", "e2e-booth");
          sessionStorage.setItem("azm.check.snapshot", m);
        },
        [camModel({ kind: "cam.setup", i: 0, side: 0 })],
      );
      const problems: string[] = [];
      const shorten: string[] = [];
      const compact = h < 700;
      for (const name of PREVIEW_NAMES) {
        const cue = (PREVIEWS[name].caption as { cue?: string } | undefined)?.cue;
        await page.goto(`/?check=1&e2eCamPreview=${name}${lang === "en" ? "&lang=en" : ""}`);
        await expect(page.locator(".s34-stage")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);
        const r = await page.evaluate((keys) => {
          const main = document.querySelector(".s34-main")!.getBoundingClientRect();
          const top = document.querySelector(".s34-top")!.getBoundingClientRect();
          const bad: string[] = [];
          // The title row keeps to one line; a pill row under it is allowed (C29).
          const limit = document.querySelector(".s34-top-note") ? 120 : 64;
          if (top.height > limit) bad.push(`top bar ${Math.round(top.height)} px`);
          for (const k of keys)
            for (const el of document.querySelectorAll(k)) {
              const b = el.getBoundingClientRect();
              if (b.height === 0) continue;
              if (b.top < main.top - 1 || b.bottom > main.bottom + 1) bad.push(k);
            }
          const caption = document.querySelector(".s34-caption");
          return {
            bad,
            fit: Number((document.querySelector(".s34-stage") as HTMLElement).dataset.fit ?? 0),
            sentence: !!caption?.querySelector(".s34-caption-text"),
            short: !!caption?.querySelector(".s34-caption-short"),
          };
        }, KEY_VALUES);
        // One line on screen; a sentence that carries a safety limit is never cut to its short form.
        if (r.short && r.sentence) problems.push(`${name}: the caption shows two lines`);
        if (cue && ALWAYS_SENTENCE.includes(cue) && !r.sentence)
          problems.push(`${name}: the sentence is hidden`);
        if (r.bad.length && compact && r.sentence) shorten.push(`${name} (${cue ?? "copy"})`);
        else if (r.bad.length) problems.push(`${name}: ${r.bad.join(", ")}`);
        // C10: the cues that need level 3 at 375 x 812 go to the Arabic seat too.
        if (!compact && r.fit >= 3 && cue) shorten.push(`${name} level 3 (${cue})`);
      }
      if (shorten.length) {
        test
          .info()
          .annotations.push({ type: "C10 cues to shorten (R3C-16 (6))", description: shorten.join("; ") });
        console.log(`C10 ${lang} ${w}x${h}: ${shorten.join("; ")}`);
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}

/* ------------------------------------------------------------------ flow */

const INTAKE = {
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
};

/**
 * Opens a named state of e2e/flow-models.ts. Signed in states get a throwaway account whose intake
 * is done, so the app opens the check rather than the intake page.
 */
async function openFlowNamed(page: Page, lang: Lang, name: string, signedIn: boolean) {
  await page.goto("/?e2eGallery=loading");
  if (signedIn) {
    const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
    const reg = await page.request.post("/api/auth/register", {
      headers,
      data: {
        name: "Sara",
        email: `fixes-flow-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
        password: `${crypto.randomUUID()}Aa1`,
        adultConfirmed: true,
      },
    });
    expect(reg.status()).toBe(200);
    expect((await page.request.put("/api/intake", { headers, data: INTAKE })).status()).toBe(200);
  }
  await page.evaluate(
    async ({ n, guest }) => {
      const mod = await import(/* @vite-ignore */ String("/e2e/flow-models.ts"));
      mod.setWalkClock(Date.now());
      sessionStorage.setItem("azm.check.snapshot", JSON.stringify(mod.FLOW_STATES[n].build()));
      if (guest) sessionStorage.setItem("azm.booth", "e2e-booth");
      else sessionStorage.removeItem("azm.booth");
    },
    { n: name, guest: !signedIn },
  );
  const path = signedIn ? "/" : "/?check=1";
  await page.goto(lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path);
}

for (const lang of LANGS) {
  test.describe(`review fixes, flow (${lang})`, () => {
    test("S19: the pain scale reflows at 320 x 256 with 52 x 64 targets (WCAG 1.4.10)", async ({
      browser,
    }) => {
      const page = await phone(browser, 320, 256);
      await openFlowNamed(page, lang, "S19-pain-now", false);
      await expect(page.locator('[data-screen="S19"]')).toBeVisible();
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: innerWidth,
        cells: [...document.querySelectorAll(".flow-scale-cell")].map((c) => {
          const b = c.getBoundingClientRect();
          return [b.left, b.right, b.width, b.height];
        }),
      }));
      expect(r.sw).toBeLessThanOrEqual(r.iw);
      expect(r.cells).toHaveLength(11);
      for (const [left, right, width, height] of r.cells) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(r.iw);
        expect(width).toBeGreaterThanOrEqual(48);
        expect(height).toBeGreaterThanOrEqual(56);
      }
      await page.context().close();
    });

    test("S29: STOP has focus, one main landmark, Sound and the camera line; axe moderate too", async ({
      browser,
    }) => {
      const page = await phone(browser, 375, 812);
      await openFlowNamed(page, lang, "S29-practice-check", true);
      const s29 = page.locator('main[data-screen="S29"]');
      await expect(s29).toBeVisible();
      await expect(page.locator(".flow-practice-stop")).toBeFocused();
      await expect(s29.getByRole("button", { name: COPY[lang].common.sound })).toBeVisible();
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"])
        .analyze();
      const found = r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical" || v.impact === "moderate")
        .map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(found).toEqual([]);
      await page.context().close();
    });

    for (const name of ["busy", "error", "offline"] as const)
      test(`S17 start ${name}: the state stays on screen (never the portal)`, async ({ browser }) => {
        const page = await phone(browser, 375, 812);
        await page.route("**/api/assessments", (route) => {
          if (route.request().method() !== "POST") return route.continue();
          if (name === "busy") return;
          return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        });
        await openFlowNamed(page, lang, `S17-start-${name}`, true);
        await expect(page.locator('[data-screen="S17"]')).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-screen="S17"]')).toBeVisible();
        await page.context().close();
      });
  });
}

/* ------------------------------------------------------------------ the check in at home */

test("with the check in on at home, a person sitting still through a test is asked (English)", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const page = await phone(browser, 375, 812);
  await openSignedIn(
    page,
    "en",
    {
      state: { kind: "cam.setup", i: 0, side: 0 },
      checkIn: true,
      run: { calibrated: false, practiced: false, saved: 0 },
    },
    "e2eFixture=seated-still&e2eCamFast=1",
  );
  const checkIn = page.locator('[data-screen="S43"]');
  await expect(checkIn).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", /^cam\.(practice|measure)$/);
  // «أنا بخير»: the paused practice or attempt runs again after its rest.
  await checkIn.getByRole("button", { name: COPY.en.checkin.fine, exact: true }).click();
  await expect(checkIn).toHaveCount(0);
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.rest");
  await page.context().close();
});
