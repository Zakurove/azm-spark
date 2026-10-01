/**
 * Safety stream (UX spec S36 to S49, maps 2.6 and 2.7; council O12, O42; D-016), in Arabic and English,
 * driven through the screens' own controls from a flow snapshot (safety-fixtures.ts):
 *   - every stop list option reaches its screen with one tap, and the list waits for its answer;
 *   - the optional check in (D-016), on at home only: a trigger pauses the test with a calm S43;
 *     after 30 s with no answer one chime and the line to call someone nearby; «أنا بخير» redoes the
 *     attempt after its rest, «أريد التوقف» opens the stop list; at the booth a trigger does nothing;
 *   - 997 is on the emergency screens only (D-016): S36 puts the call first as a tel: link, shows the
 *     number at 64 px or more, and captions every sentence in turn; S39 has no call;
 *   - the faint question follows S38 and a touch on S39, and waits for its answer; S47 reads an
 *     answer back.
 * Timers run on Playwright's fake clock (page.clock), never on shortened values.
 */
import { expect, test, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import data from "../src/movements/check-v1.json" with { type: "json" };
import { MEASURE, model, openGuest, openSignedIn, seed, type Lang } from "./safety-fixtures";

const COPY = { ar, en } as const;
const LANGS: Lang[] = ["ar", "en"];
const toArabic = (s: string) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
const shown = (lang: Lang, s: string) => (lang === "ar" ? toArabic(s) : s);
const sentences = (s: string) => s.split(/(?<=[.!?؟])\s+/u);

// The chime plays without a tap in these runs.
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("401")) return;
    errors.push(m.text());
  });
  return errors;
}

async function dispatch(page: Page, event: Record<string, unknown>) {
  await page.evaluate((e) => (window as unknown as { e2eDispatch(e: unknown): void }).e2eDispatch(e), event);
}

/** Every button and link on the page is at least 48 px tall (0.5). */
async function expectTargets(page: Page) {
  for (const el of await page.locator(".azm-check button:visible, .azm-check a:visible").all()) {
    const box = await el.boundingBox();
    if (box) expect(box.height, await el.innerText()).toBeGreaterThanOrEqual(48);
  }
}

const OPTION_SCREEN: Record<string, string> = {
  chest: "S36",
  stroke_signs: "S36",
  ad_signs: "S37",
  faint: "S38",
  breath: "S40a",
  fall: "S39",
  pain: "S47",
  tired: "S42",
  choice: "S42",
  other: "S42",
};

for (const lang of LANGS) {
  const a = COPY[lang];
  test.describe(`safety screens (${lang})`, () => {
    test("every stop list option reaches its screen with one tap (S41)", async ({ browser }) => {
      for (const [option, screen] of Object.entries(OPTION_SCREEN)) {
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const page = await context.newPage();
        const errors = watchErrors(page);
        await openGuest(page, lang, {
          state: MEASURE,
          overlay: { kind: "stopList" },
          sciT6: true,
        });
        const list = page.locator('.check-overlay [data-screen="S41"]');
        await expect(list).toBeVisible();
        await expect(list.getByRole("heading", { level: 1 })).toBeFocused();
        await expect(list.getByRole("heading", { level: 1 })).toHaveText(data.stopRouting.ask[lang]);
        if (option === "chest") await expectTargets(page);
        const label = data.stopRouting.options.find((o) => o.id === option)!.label[lang];
        await list.getByRole("button", { name: label }).click();
        await expect(page.locator(`[data-screen="${screen}"]`), option).toBeVisible();
        await expect(page.locator(".check-overlay")).toHaveCount(0);
        if (screen.startsWith("S3") || screen.startsWith("S40")) {
          // Safety screens: no Back, no Exit; the heading takes focus.
          await expect(page.getByRole("button", { name: a.common.exit, exact: true })).toHaveCount(0);
          await expect(page.getByRole("button", { name: a.common.back, exact: true })).toHaveCount(0);
          await expect(page.locator("h1")).toBeFocused();
        }
        expect(errors, option).toEqual([]);
        await context.close();
      }
    });

    test("the stop list waits for its answer: nothing opens over it (D-016)", async ({ page }) => {
      // The fixture camera runs on the fake clock too: a minute of frames takes a while.
      test.setTimeout(150_000);
      const errors = watchErrors(page);
      await page.clock.install();
      await openGuest(page, lang, { state: MEASURE, overlay: { kind: "stopList" } });
      await expect(page.locator('[data-screen="S41"]')).toBeVisible();
      await page.clock.runFor(45_000);
      await expect(page.locator('[data-screen="S41"]')).toBeVisible();
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("the check in at home: a calm S43, one chime and the help line after 30 s, then the redo", async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const errors = watchErrors(page);
      await page.clock.install();
      await openSignedIn(page, lang, { state: MEASURE, checkIn: true });
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.measure");
      await dispatch(page, { type: "TRIGGER", trigger: "no_movement" });
      const checkIn = page.locator('[data-screen="S43"]');
      await expect(checkIn).toBeVisible();
      await expect(checkIn).toHaveAttribute("role", "alertdialog");
      await expect(checkIn.locator("h1")).toBeFocused();
      const [question, instruction] = sentences(data.cues.find((c) => c.id === "check_are_you_ok")![lang]);
      await expect(checkIn.locator("h1")).toHaveText(question);
      const line = checkIn.locator(".safety-checkin-line");
      await expect(line).toHaveText(instruction);
      await expect(checkIn.locator('a[href^="tel:"]')).toHaveCount(0);
      await expectTargets(page);
      const fine = checkIn.getByRole("button", { name: a.checkin.fine, exact: true });
      expect((await fine.boundingBox())!.height).toBeGreaterThanOrEqual(120);
      // Nobody answers: at 30 s one chime and the line to call someone nearby; nothing else happens.
      await page.clock.runFor(29_000);
      await expect(line).toHaveText(instruction);
      await page.clock.runFor(1_500);
      await expect(checkIn).toHaveAttribute("data-unanswered", "true");
      await expect(line).toHaveText(data.screens.scr_no_response[lang]);
      await expect(line).toHaveAttribute("data-help", "true");
      await page.clock.runFor(15_000);
      await expect(checkIn).toBeVisible();
      await expect(page.locator('[data-screen="S45"], [data-screen="S44"]')).toHaveCount(0);
      // «أنا بخير»: the paused attempt runs again after its rest.
      await fine.click();
      await expect(checkIn).toHaveCount(0);
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.rest");
      expect(errors).toEqual([]);
    });

    test("the check in: «أريد التوقف» opens the stop list", async ({ page }) => {
      await page.clock.install();
      await openSignedIn(page, lang, { state: MEASURE, checkIn: true });
      await dispatch(page, { type: "TRIGGER", trigger: "left_frame" });
      await page
        .locator('[data-screen="S43"]')
        .getByRole("button", { name: a.checkin.wantStop, exact: true })
        .click();
      const list = page.locator('[data-screen="S41"]');
      await expect(list).toBeVisible();
      await expect(list.getByRole("heading", { level: 1 })).toHaveText(data.stopRouting.ask[lang]);
    });

    test("at the booth the check in is off: a trigger does nothing", async ({ page }) => {
      await page.clock.install();
      await openGuest(page, lang, { state: MEASURE });
      await dispatch(page, { type: "TRIGGER", trigger: "no_movement" });
      await page.clock.runFor(1_000);
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.measure");
    });

    test("a visitor pass ending over S37 clears the pass and keeps the screen until it is left (R3C-35)", async ({
      page,
    }) => {
      await page.clock.install();
      // A visitor's own phone in booth mode: the pass the server gave it (never checked for real here).
      await page.route("**/api/booth/check", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
      );
      const pass = JSON.stringify({ kind: "visitor", token: "c".repeat(64), expires: Date.now() + 3600e3 });
      await page.addInitScript((p) => {
        if (!sessionStorage.getItem("azm.e2e.visitor")) {
          sessionStorage.setItem("azm.e2e.visitor", "1");
          sessionStorage.setItem("azm.booth", p);
        }
      }, pass);
      await seed(
        page,
        model({
          state: { kind: "safety", safety: "ad", screen: "scr_ad", alsoShow: [], faintAnswered: false },
        }),
        false,
      );
      await page.goto(lang === "en" ? "/?check=1&lang=en" : "/?check=1");
      const s37 = page.locator('[data-screen="S37"]');
      await expect(s37).toBeVisible();
      // Eleven minutes with the tab hidden, then back.
      const visibility = (state: "hidden" | "visible") =>
        page.evaluate((v) => {
          Object.defineProperty(document, "visibilityState", { get: () => v, configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }, state);
      await visibility("hidden");
      await page.clock.runFor(11 * 60 * 1000);
      await visibility("visible");
      await page.clock.runFor(1_000);
      // The AD steps stay on the phone; the pass is gone.
      await expect(s37).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem("azm.booth"))).toBeNull();
    });

    test("S36: 997 first as a tel: link, the number at 64 px, every sentence captioned in turn", async ({
      page,
    }) => {
      await page.clock.install();
      await openGuest(page, lang, {
        state: {
          kind: "safety",
          safety: "emergency",
          screen: "scr_emergency",
          alsoShow: [],
          faintAnswered: false,
        },
      });
      const screen = page.locator('[data-screen="S36"]');
      await expect(screen).toBeVisible();
      await expect(page.locator("h1")).toBeFocused();
      await expect(page.locator("h1")).toHaveText(a.safety.emergency.title);
      const number = screen.locator(".safety-number-value");
      await expect(number).toHaveText(shown(lang, "997"));
      const size = await number.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(64);
      const call = page.locator(".check-footer a.check-call").first();
      await expect(call).toHaveAttribute("href", "tel:997");
      expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(64);
      await expect(call).toHaveAttribute("aria-label", lang === "ar" ? "اتصل بالرقم ٩ ٩ ٧" : "Call 9 9 7");
      await expectTargets(page);
      // The caption strip shows every sentence in turn (the voice when it may speak, else the reading
      // time), and the sentence stack highlights it.
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        await page.clock.runFor(500);
        const text = await page.locator(".check-caption .check-caption-text").allInnerTexts();
        for (const t of text) seen.add(t.trim());
      }
      // C14: a sentence that is the heading itself is not captioned again above it.
      const bare = (x: string) => x.replace(/[.!?؟]/gu, "").trim();
      for (const s of sentences(data.screens.scr_emergency[lang]))
        if (bare(s) !== bare(a.safety.emergency.title)) expect([...seen]).toContain(shown(lang, s));
      await expect(page.locator(".safety-sentences p[aria-current]")).toHaveCount(0);
      await page.getByRole("button", { name: a.common.listen }).click();
      await page.clock.runFor(100);
      await expect(page.locator(".safety-sentences p[aria-current='true']")).toHaveCount(1);
    });

    test("S38 asks the faint question after its speech and 20 s; No keeps S38, Yes opens S36 (O42)", async ({
      page,
    }) => {
      await page.clock.install();
      await openGuest(page, lang, {
        state: { kind: "safety", safety: "faint", screen: "scr_faint", alsoShow: [], faintAnswered: false },
      });
      await expect(page.locator('[data-screen="S38"]')).toBeVisible();
      await page.clock.runFor(10_000);
      await expect(page.locator('[data-screen="S38"]')).toBeVisible();
      await page.clock.runFor(15_000);
      const ask = page.locator('[data-screen="S38b"]');
      await expect(ask).toBeVisible();
      await expect(ask.locator("h1")).toHaveText(data.stopFollowUps[0].ask[lang]);
      await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
      // No is read back for 3 s, then S38 again with the question answered.
      await ask.locator('[data-value="no"]').click();
      await expect(ask.locator('[data-value="no"]')).toHaveAttribute("aria-pressed", "true");
      await page.clock.runFor(3_100);
      await expect(page.locator('[data-screen="S38"]')).toBeVisible();
      await page.clock.runFor(30_000);
      await expect(page.locator('[data-screen="S38"]')).toBeVisible();
      await expect(
        page.getByRole("button", { name: lang === "ar" ? "ارجع إلى البداية" : "Go back to the start" }),
      ).toBeVisible();
    });

    test("S38: a touch opens the faint question only once the speech has ended (R3C-07)", async ({
      page,
    }) => {
      await page.clock.install();
      await openGuest(page, lang, {
        state: { kind: "safety", safety: "faint", screen: "scr_faint", alsoShow: [], faintAnswered: false },
      });
      const s38 = page.locator('[data-screen="S38"]');
      await expect(s38).toBeVisible();
      // While the positioning sentences are being read, a touch never cuts them.
      await page.clock.runFor(2_000);
      await s38.locator(".safety-sentences p").first().click();
      await expect(s38).toBeVisible();
      await expect(page.locator('[data-screen="S38b"]')).toHaveCount(0);
      // Once the speech has ended (before 20 s), a touch outside the controls opens S38b.
      await page.clock.runFor(14_000);
      await expect(page.locator(".safety-sentences p[aria-current]")).toHaveCount(0);
      await s38.locator(".safety-sentences p").first().click();
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
    });

    test("S38b waits for its answer with no timer (D-016); Not sure opens S36", async ({ page }) => {
      await page.clock.install();
      await openGuest(page, lang, { state: { kind: "faintAsk" } });
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
      await page.clock.runFor(60_000);
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
      await page.locator('[data-screen="S38b"] [data-value="unsure"]').click();
      await expect(page.locator('[data-screen="S36"]')).toBeVisible();
    });

    test("S39 at the booth: no 997 (D-016); a touch opens the faint question, with no timer (O42)", async ({
      page,
    }) => {
      await page.clock.install();
      await openGuest(page, lang, {
        state: {
          kind: "safety",
          safety: "fall",
          screen: "scr_fall_seated",
          alsoShow: [],
          faintAnswered: false,
          askFaint: true,
        },
      });
      const fall = page.locator('[data-screen="S39"]');
      await expect(fall).toBeVisible();
      await expect(fall.locator(".safety-number-value")).toHaveCount(0);
      await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
      await page.clock.runFor(60_000);
      await expect(fall).toBeVisible();
      await fall.locator(".safety-card").click();
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
      await page.clock.runFor(60_000);
      await expect(page.locator('[data-screen="S38b"]')).toBeVisible();
      await expect(page.locator('[data-screen="S43"]')).toHaveCount(0);
    });

    test("S47 reads an answer back for 3 s; much more commits at once to S40b", async ({ page }) => {
      await page.clock.install();
      await openGuest(page, lang, { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" } });
      const q = page.locator('[data-screen="S47"]');
      await expect(q.locator("h1")).toHaveText(data.betweenTests[0].ask[lang]);
      await expect(page.locator(".safety-stop")).toBeVisible();
      expect((await page.locator(".safety-stop").boundingBox())!.height).toBeGreaterThanOrEqual(72);
      await q.locator('[data-value="more"]').click();
      await expect(page.locator(".check-caption")).toContainText(
        a.zones.confirm.replace("{answer}", data.betweenTests[0].options[1].label[lang]),
      );
      await q.locator('[data-value="much"]').click();
      await expect(page.locator('[data-screen="S40b"]')).toBeVisible();
      await page.clock.runFor(4_000);
      await expect(page.locator('[data-screen="S40b"]')).toBeVisible();
    });

    test("S42 after tired: a one minute rest, the next test can start now; change the reason", async ({
      page,
    }) => {
      await page.clock.install();
      await openGuest(page, lang, { state: MEASURE, overlay: { kind: "stopList" } });
      const label = data.stopRouting.options.find((o) => o.id === "tired")!.label[lang];
      await page.getByRole("button", { name: label }).click();
      const done = page.locator('[data-screen="S42"]');
      // C26: the headline says the rest; no banner and no "not saved" line, never the safety stop line.
      await expect(done.locator("h1")).toHaveText(a.stopDone.restTitle);
      await expect(page.locator(".check-caption")).toHaveCount(0);
      await expect(done.locator("p.check-body")).toHaveCount(0);
      await expect(page.getByRole("button", { name: a.rest.nextNow })).toBeVisible();
      await page.clock.runFor(61_000);
      await expect(page.getByRole("button", { name: a.stopDone.next })).toBeVisible();
      await page.getByRole("button", { name: a.stopDone.changeReason }).click();
      await expect(page.locator('[data-screen="S41"]')).toBeVisible();
    });

    test("S49: Yes opens S36 at once; S36 signed in keeps results and shows when to try again", async ({
      page,
    }) => {
      const until = Date.now() + 10 * 3600e3;
      await openSignedIn(page, lang, {
        state: { kind: "endQuestion" },
        outcomes: { "shoulder_abduction:left": { status: "measured", value: 120 } },
        lock: { reason: "stop_symptom", until },
      });
      const q = page.locator('[data-screen="S49"]');
      await expect(q).toBeVisible();
      await expect(q.locator("strong").first()).toBeVisible();
      await q.locator('[data-value="yes"]').click();
      const s36 = page.locator('[data-screen="S36"]');
      await expect(s36).toBeVisible();
      await expect(s36.getByText(a.safety.kept)).toBeVisible();
      await expect(s36.locator(".safety-paused")).toContainText(
        lang === "ar"
          ? "أُجِّل قياس اليوم حرصًا على سلامتك."
          : "Today’s check has been postponed for your safety.",
      );
      if (lang === "ar") expect(await s36.locator(".safety-paused").innerText()).not.toMatch(/[0-9]/);
      await expect(page.getByRole("button", { name: a.common.backToToday })).toBeVisible();
    });

    test("every other safety screen keeps its targets at 48 px or more, STOP at 72 and zones at 120", async ({
      browser,
    }) => {
      const states: { state: Record<string, unknown>; overlay?: Record<string, unknown>; screen: string }[] =
        [
          { state: { kind: "faintAsk" }, screen: "S38b" },
          { state: { kind: "stopDone", i: 0, restSec: 60, reason: "stopped_symptom" }, screen: "S42" },
          {
            state: {
              kind: "skipNotice",
              rows: [{ testId: "shoulder_abduction", side: "left", reason: "quality" }],
              then: { to: "test", i: 1 },
            },
            screen: "S46",
          },
          { state: { kind: "guestAfterTest", next: 1 }, screen: "S46b" },
          { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" }, screen: "S47" },
          { state: { kind: "after.contact", i: 2, side: 0 }, screen: "S48" },
          { state: { kind: "endQuestion" }, screen: "S49" },
        ];
      for (const o of states) {
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const page = await context.newPage();
        await openGuest(page, lang, { state: o.state, overlay: o.overlay ?? null });
        await expect(page.locator(`[data-screen="${o.screen}"]`), o.screen).toBeVisible();
        await expectTargets(page);
        for (const zone of await page.locator(".safety-zone:visible").all())
          expect((await zone.boundingBox())!.height, o.screen).toBeGreaterThanOrEqual(120);
        for (const stop of await page.locator(".safety-stop:visible").all())
          expect((await stop.boundingBox())!.height, o.screen).toBeGreaterThanOrEqual(72);
        await context.close();
      }
    });
  });
}
