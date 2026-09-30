/**
 * Round 3 review fixes (UX spec 0.5, 4.1, 4.2, 4.7, 4.8, S34, S41, S43 to S49, definition of done), in
 * Arabic and English, driven from flow snapshots with the fixture camera:
 *   - a double tap on STOP never picks a stop list reason (S41 stays, nothing answered);
 *   - a double tap on «أحتاج مساعدة» never counts as fine on S45, at six phone and tablet sizes;
 *   - the answers and STOP of S43, S44, S45, S38b, S47, S48 and S49 end above the fold at 375 x 812
 *     and 375 x 667 (a person 2 m away cannot scroll);
 *   - the S48 count field takes focus; S38 and S38b say the camera is on; a camera fine on S43 gives
 *     S44 one extra 30 s timer, and S44 after the alarm runs one;
 *   - the home check in names no answer box while the zones are not drawn.
 * Timers run on Playwright's fake clock where they matter.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import data from "../src/movements/check-v1.json" with { type: "json" };
import { PREVIEW_NAMES } from "../src/features/assessment/camera/e2e/previews";
import { camModel, openCamera } from "./camera-fixtures";
import {
  MEASURE,
  model,
  openGuest,
  openSignedIn,
  seed,
  type Lang,
  type ModelOptions,
} from "./safety-fixtures";

const COPY = { ar, en } as const;
const LANGS: Lang[] = ["ar", "en"];

// The alarm tone plays without a tap in these runs (a real phone primes it on the first tap, 4.6).
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

/** S43 raised over a measuring test, for a person with these check in inputs. */
const checkInOver = (checkIn: { raiseAllowed: boolean; noArmSignal: boolean }): ModelOptions => ({
  state: MEASURE,
  overlay: { kind: "checkIn", from: "test", trigger: "no_movement", attempt: true },
  checkIn: { ...checkIn, fineZoneSide: checkIn.noArmSignal ? null : "right" },
});

/** A point as the arguments of touchscreen.tap. */
const xy = (p: { x: number; y: number }) => [p.x, p.y] as const;

async function dispatch(page: Page, event: Record<string, unknown>) {
  await page.evaluate((e) => (window as unknown as { e2eDispatch(e: unknown): void }).e2eDispatch(e), event);
}

/** Two taps at the same point, 120 ms apart: a double tap, as a tremor or an anxious press gives. */
async function doubleTap(page: Page, p: { x: number; y: number }) {
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(p.x, p.y);
}

/**
 * Every data-fold element (the answers, the fine button) ends above the fold: the top of the sticky
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

    for (const [w, h] of [
      [360, 780],
      [375, 812],
      [390, 844],
      [430, 932],
      [375, 1200],
      [768, 1024],
    ] as const) {
      test(`a double tap on I need help never counts as fine on S45 (${w} x ${h})`, async ({ browser }) => {
        const page = await phone(browser, w, h);
        await openGuest(page, lang, {
          state: MEASURE,
          overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
        });
        await expect(page.locator('[data-screen="S43"]')).toBeVisible();
        await doubleTap(page, await centre(page, '[data-screen="S43"] [data-value="help"]'));
        const alarm = page.locator('[data-screen="S45"]');
        await expect(alarm).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(alarm).toBeVisible();
        await expect(alarm).toHaveAttribute("data-alarm", "sounding");
        await expect(page.locator('[data-screen="S41"]')).toHaveCount(0);
        // «أنا بخير» pressed on purpose still ends it (to the stop list after a help alarm, O34-5).
        await alarm.getByRole("button", { name: a.alarm.fine }).click();
        await expect(page.locator('[data-screen="S41"]')).toBeVisible();
        await page.context().close();
      });
    }

    test("a second tap 150 ms later and 60 px away never counts as fine on S45 or S43 (R3C-03)", async ({
      browser,
    }) => {
      const page = await phone(browser, 375, 812);
      await openGuest(page, lang, {
        state: MEASURE,
        overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
      });
      // S45: «أحتاج مساعدة», then 150 ms later a tap 60 px from the centre of «أنا بخير».
      await page.touchscreen.tap(...xy(await centre(page, '[data-screen="S43"] [data-value="help"]')));
      const alarm = page.locator('[data-screen="S45"]');
      await expect(alarm).toBeVisible();
      await page.waitForTimeout(150);
      const fine = await centre(page, '[data-screen="S45"] .safety-fine');
      await page.touchscreen.tap(fine.x + 60, fine.y);
      await page.waitForTimeout(1200);
      await expect(alarm).toHaveAttribute("data-alarm", "sounding");
      await expect(page.locator('[data-screen="S41"]')).toHaveCount(0);
      await page.context().close();

      // S43: raised by the camera; a tap 150 ms after it appeared, 60 px from the centre of fine.
      const second = await phone(browser, 375, 812);
      await openGuest(second, lang, { state: MEASURE });
      await dispatch(second, { type: "TRIGGER", trigger: "no_movement" });
      const checkIn = second.locator('[data-screen="S43"]');
      await expect(checkIn).toBeVisible();
      await second.waitForTimeout(150);
      const zone = await centre(second, '[data-screen="S43"] [data-value="fine"]');
      await second.touchscreen.tap(zone.x + 60, zone.y);
      await second.waitForTimeout(1000);
      await expect(checkIn).toBeVisible();
      await expect(second.locator('[data-screen="S44"]')).toHaveCount(0);
      // Pressed on purpose afterwards, it answers.
      await second.touchscreen.tap(zone.x, zone.y);
      await expect(second.locator('[data-screen="S44"]')).toBeVisible();
      await second.context().close();
    });

    test("a tap that lands as S43 or S45 appears over S34 never counts as fine (R3C-03)", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.clock.install();
      await openGuest(page, lang, { state: MEASURE });
      // The clock stands still: every tap below lands the moment the screen appeared.
      await page.clock.pauseAt(Date.now() + 2_000);
      await dispatch(page, { type: "TRIGGER", trigger: "left_frame" });
      const checkIn = page.locator('[data-screen="S43"]');
      await expect(checkIn).toBeVisible();
      await checkIn.locator('[data-value="fine"]').click();
      await expect(checkIn).toBeVisible();
      await expect(page.locator('[data-screen="S44"]')).toHaveCount(0);
      await page.clock.runFor(15_100);
      const alarm = page.locator('[data-screen="S45"]');
      await expect(alarm).toBeVisible();
      await alarm.getByRole("button", { name: a.alarm.fine }).click();
      await expect(alarm).toHaveAttribute("data-alarm", /sounding|blocked/);
      await page.clock.runFor(800);
      await alarm.getByRole("button", { name: a.alarm.fine }).click();
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
    });

    const FOLD: { name: string; open: ModelOptions; screen: string }[] = [
      {
        name: "S43 booth",
        open: {
          state: MEASURE,
          overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
          checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: null },
        },
        screen: "S43",
      },
      {
        name: "S43 no raise",
        open: { state: MEASURE, overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true } },
        screen: "S43",
      },
      {
        name: "S44",
        open: { state: MEASURE, overlay: { kind: "goOn", afterAlarm: false, canRedo: true } },
        screen: "S44",
      },
      {
        name: "S44 after the alarm",
        open: { state: MEASURE, overlay: { kind: "goOn", afterAlarm: true, canRedo: false, timer: true } },
        screen: "S44",
      },
      {
        name: "S45",
        open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true } },
        screen: "S45",
      },
      {
        name: "S45 help",
        open: { state: MEASURE, overlay: { kind: "alarm", from: "test", attempt: true, help: true } },
        screen: "S45",
      },
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

    // R3C-15 (6): on the compact phones the short form, the question, every answer and STOP of S43 are
    // inside the viewport for every cue form this build can show (the zone and spoken forms come with
    // home gate 2), with and without the offline banner.
    const FORMS: { name: string; open: ModelOptions; home: boolean }[] = [
      { name: "booth raise", home: false, open: checkInOver({ raiseAllowed: true, noArmSignal: false }) },
      { name: "booth noraise", home: false, open: checkInOver({ raiseAllowed: false, noArmSignal: false }) },
      { name: "home helper", home: true, open: checkInOver({ raiseAllowed: false, noArmSignal: true }) },
      { name: "home fall raise", home: true, open: checkInOver({ raiseAllowed: true, noArmSignal: false }) },
      {
        name: "home fall noraise",
        home: true,
        open: checkInOver({ raiseAllowed: false, noArmSignal: false }),
      },
    ];
    for (const [w, h] of [
      [375, 667],
      [320, 568],
    ] as const) {
      test(`S43 keeps its short form, question, answers and STOP in view at ${w} x ${h} (R3C-15)`, async ({
        browser,
      }) => {
        test.setTimeout(240_000);
        let home: Page | null = null;
        for (const f of FORMS) {
          for (const offline of [false, true]) {
            let page: Page;
            if (!f.home) {
              page = await phone(browser, w, h);
              await openGuest(page, lang, f.open);
            } else if (!home) {
              page = home = await phone(browser, w, h);
              await openSignedIn(page, lang, { ...f.open, booth: false });
            } else {
              // The same signed in account in a new tab: its own snapshot.
              page = await home.context().newPage();
              await seed(page, model({ ...f.open, mode: "signedIn", booth: false }), false);
              await page.goto(
                lang === "en" ? "/?e2eFixture=seated-still&lang=en" : "/?e2eFixture=seated-still",
              );
            }
            const s43 = page.locator('[data-screen="S43"]');
            await expect(s43, f.name).toBeVisible();
            if (offline) await page.context().setOffline(true);
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(300);
            const what = `${f.name}${offline ? " offline" : ""} ${w}x${h}`;
            await expectAboveFold(page, what);
            for (const sel of [".safety-short", "h1"]) {
              const box = await s43.locator(sel).first().boundingBox();
              expect(box, `${what}: ${sel}`).not.toBeNull();
              expect(box!.y, `${what}: ${sel} top`).toBeGreaterThanOrEqual(0);
              expect(box!.y + box!.height, `${what}: ${sel} bottom`).toBeLessThanOrEqual(h + 1);
            }
            // «أنا بخير» stays the largest, never under 120 px.
            expect((await s43.locator('[data-value="fine"]').boundingBox())!.height).toBeGreaterThanOrEqual(
              120,
            );
            if (offline) await page.context().setOffline(false);
            if (!f.home) await page.context().close();
            else if (page !== home) await page.close();
          }
        }
        await home?.context().close();
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

    test("S38 and S38b say the camera is on while it runs", async ({ browser }) => {
      const page = await phone(browser, 375, 812);
      // A faint stop in the running test: the stopped test's camera stays on (O30).
      await openGuest(page, lang, { state: MEASURE });
      await expect(page.locator(".s34-stop")).toBeVisible();
      await page.locator(".s34-stop").click();
      const label = data.stopRouting.options.find((o) => o.id === "faint")!.label[lang];
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: label }).click();
      await expect(page.locator('[data-screen="S38"]')).toBeVisible();
      await expect(page.locator('[data-screen="S38"] [data-camera-on]')).toHaveText(a.hud.cameraOn);
      await page.evaluate(() =>
        (window as unknown as { e2eDispatch(e: unknown): void }).e2eDispatch({ type: "FAINT_ASK" }),
      );
      await expect(page.locator('[data-screen="S38b"] [data-camera-on]')).toHaveText(a.hud.cameraOn);
      await page.context().close();
    });

    test("S44 after the alarm runs one 30 s timer, then the check in again (O34-1 (6))", async ({ page }) => {
      // The fixture camera runs on the fake clock too: a minute of frames takes a while.
      test.setTimeout(150_000);
      await page.clock.install();
      await openGuest(page, lang, {
        state: MEASURE,
        overlay: { kind: "alarm", from: "test", attempt: true },
      });
      await page.clock.runFor(1_000);
      await page.locator('[data-screen="S45"]').getByRole("button", { name: a.alarm.fine }).click();
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await page.clock.runFor(29_000);
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await page.clock.runFor(1_500);
      await expect(page.locator('[data-screen="S43"]')).toBeVisible();
      // Fine by tap gives S44 back, with no further timer in that episode (O14, R3C-01).
      await page.clock.runFor(800);
      await page.locator('[data-screen="S43"] [data-value="fine"]').click();
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await page.clock.runFor(45_000);
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
    });

    test("S44 after a tapped fine runs no timer (O14)", async ({ page }) => {
      test.setTimeout(150_000);
      await page.clock.install();
      await openGuest(page, lang, {
        state: MEASURE,
        overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
      });
      await page.clock.runFor(800);
      await page.locator('[data-screen="S43"] [data-value="fine"]').click();
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await page.clock.runFor(45_000);
      await expect(page.locator('[data-screen="S44"]')).toBeVisible();
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
    });

    test("the home check in names no answer box while the zones are not drawn", async ({ browser }) => {
      const page = await phone(browser, 1280, 720);
      await openSignedIn(page, lang, {
        state: MEASURE,
        overlay: { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
        checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: null },
      });
      const checkIn = page.locator('[data-screen="S43"]');
      await expect(checkIn).toBeVisible();
      const zone = data.cues.find((c) => c.id === "check_are_you_ok_zone")!;
      await expect(checkIn).not.toContainText(zone.short[lang]);
      await expect(checkIn).not.toContainText(lang === "ar" ? "مربع" : "box");
      // The caption card holds the instruction after the question, never the question again.
      await expect(checkIn.locator(".safety-checkin-cue")).not.toContainText(
        lang === "ar" ? "هل أنت بخير؟" : "Are you all right?",
      );
      await page.context().close();
    });
  });
}

/** The values read from 2 m on the camera stage, and the controls at the phone (4.1, 4.2, S34). */
const KEY_VALUES = [
  ".s34-count",
  ".s34-degrees",
  ".s34-countdown",
  ".s34-go",
  ".s34-rest-num",
  ".s34-try",
  ".s34-phase",
  ".s34-word",
  ".s34-line40",
  ".s34-caption-short",
  ".s34-restart",
  ".s34-chips",
  ".s34-at-phone button",
];

for (const lang of LANGS) {
  for (const [w, h] of [
    [375, 812],
    [375, 667],
  ] as const) {
    test(`S34: every preview keeps its 2 m values inside the stage at ${w} x ${h} (${lang})`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
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
      for (const name of PREVIEW_NAMES) {
        await page.goto(`/?check=1&e2eCamPreview=${name}${lang === "en" ? "&lang=en" : ""}`);
        await expect(page.locator(".s34-stage")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);
        const out = await page.evaluate((keys) => {
          const main = document.querySelector(".s34-main")!.getBoundingClientRect();
          const top = document.querySelector(".s34-top")!.getBoundingClientRect();
          const bad: string[] = [];
          if (top.height > 64) bad.push(`top bar ${Math.round(top.height)} px`);
          for (const k of keys)
            for (const el of document.querySelectorAll(k)) {
              const b = el.getBoundingClientRect();
              if (b.height === 0) continue;
              if (b.top < main.top - 1 || b.bottom > main.bottom + 1) bad.push(k);
            }
          return bad;
        }, KEY_VALUES);
        if (out.length) problems.push(`${name}: ${out.join(", ")}`);
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

/* ------------------------------------------------------------------ left frame */

test("a person who walks out of the picture during the practice gets the check in, then the alarm (English)", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const page = await phone(browser, 375, 812);
  // Seated still for 7 s, then out of the picture (the fixture loops every 12 s).
  await openCamera(page, "en", "shoulder_abduction", "e2eFixture=leave-9x16&e2eCamFast=1");
  const checkIn = page.locator('[data-screen="S43"]');
  await expect(checkIn).toBeVisible({ timeout: 90_000 });
  // No answer within 15 s: the alarm.
  await expect(page.locator('[data-screen="S45"]')).toBeVisible({ timeout: 20_000 });
  await page.context().close();
});
