/**
 * Browser checks of the round 3 foundation review fixes (UX spec 0.5, 3.0, 5.1, S57, WCAG 2.4.11 and
 * 1.4.10), in Arabic and English:
 *   - keyboard focus is never hidden under the sticky top bar or footer (375 x 667 and 375 x 812);
 *   - every top bar control keeps 48 x 48 px and the counter stays on one line, booth mode on (320, 375);
 *   - Today and My results never scroll sideways at 320 and 375 px (five nav tabs);
 *   - a dialog makes the page behind inert (not its live region) and returns focus (S02);
 *   - the system Back asks before leaving a signed in check (S15);
 *   - a guest exit replaces the page, so Back never returns to a visitor's screens (S57);
 *   - the S32 reload snapshot survives React StrictMode (the check reopens where it was);
 *   - the example banner (S54) stays in view and is read with the h1; back online shows a toast.
 */
import { expect, test, type Page } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import arProgress from "../src/i18n/ar/progress.json" with { type: "json" };
import enProgress from "../src/i18n/en/progress.json" with { type: "json" };
import { signUpAddress } from "./sign-up";

const COPY = { ar: { a: ar, p: arProgress }, en: { a: en, p: enProgress } } as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const rectOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  }, selector) as Promise<Rect | null>;
const overlaps = (a: Rect, b: Rect) => a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

/** A signed in account with a saved intake (the Today page and My results). */
async function signIn(page: Page, lang: Lang) {
  await page.goto(url("/", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "E2E Member",
      email: `fix-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const intake = await page.request.put("/api/intake", {
    headers,
    data: {
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
    },
  });
  expect(intake.status()).toBe(200);
}

/** A reload snapshot of the flow (useCheckFlow), as S32's Try again saves it. */
function snapshot(mode: "guest" | "signedIn", state: Record<string, unknown>, booth: boolean) {
  return JSON.stringify({
    state,
    overlay: null,
    effects: [],
    nextEffectId: 1,
    data: {
      config: { mode, booth, homeOpen: true, desktop: false },
      setting: booth ? "booth" : "home",
      device: { model: "lite", aspect: 0.5625, fps: 30, engineVersion: "e2e", appVersion: "0.1.0" },
      guestPath: "full",
      guest: {},
      signedIn: null,
      env: null,
      base: [],
      answers: {},
      soundMode: "voice",
      warnings: [],
      helperRequired: [],
      protocol: [],
      tests: [],
      checkId: null,
      checkKind: null,
      outcomes: {},
      cameraUsed: false,
      desktopPassed: true,
      run: { calibrated: false, practiced: false, saved: 0, retriesUsed: 0 },
      lock: null,
    },
  });
}

for (const lang of LANGS) {
  test.describe(`review fixes (${lang})`, () => {
    for (const height of [667, 812]) {
      test(`keyboard focus is never under the top bar or footer at 375 x ${height}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height });
        await page.goto(url("/?e2eGallery=multi", lang));
        await expect(page.locator(".check-answer").first()).toBeVisible();
        const rows = await page.locator(".check-answer, .check-footer .cta").count();
        await page.locator("h1").focus();
        let checked = 0;
        for (let i = 0; i < rows + 6; i++) {
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            if (el.closest(".check-topbar, .check-footer")) return null;
            const r = el.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
              width: r.width,
              height: r.height,
            };
          });
          if (!focused) continue;
          const bar = (await rectOf(page, ".check-topbar"))!;
          const foot = await rectOf(page, ".check-footer");
          expect(overlaps(focused, bar), `row ${i} under the top bar`).toBe(false);
          if (foot) expect(overlaps(focused, foot), `row ${i} under the footer`).toBe(false);
          checked += 1;
        }
        expect(checked).toBeGreaterThan(5);
      });
    }

    for (const width of [320, 375]) {
      test(`the booth top bar keeps 48 px controls and a one line counter at ${width} px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 740 });
        await page.goto(url("/?e2eGallery=booth", lang));
        await expect(page.locator(".check-topbar-row")).toBeVisible();
        const controls = page.locator(".check-topbar-row > button, .check-topbar-row > .check-booth-badge");
        expect(await controls.count()).toBeGreaterThanOrEqual(4);
        for (const c of await controls.all()) {
          const box = (await c.boundingBox())!;
          const name = (await c.getAttribute("class")) ?? "";
          expect(box.width, name).toBeGreaterThanOrEqual(48);
          expect(box.height, name).toBeGreaterThanOrEqual(48);
        }
        // The visible counter (above the h1 at phone width) is one line, never one word per line.
        const counter = page.locator(".check-inline-counter");
        await expect(counter).toBeVisible();
        const lines = await counter.evaluate((el) => {
          const lh = parseFloat(getComputedStyle(el).lineHeight);
          return Math.round(el.getBoundingClientRect().height / lh);
        });
        expect(lines).toBe(1);
        // The badge's words stay its accessible name.
        await expect(page.locator(".check-badge-top")).toContainText(COPY[lang].a.guest.boothBadge);
        const header = (await rectOf(page, ".check-topbar"))!;
        expect(header.height).toBeLessThan(80);
        expect(
          await page.evaluate(
            () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
          ),
        ).toBe(0);
      });
    }

    test("a short screen compacts the top bar to Back and Exit (3.0, below 400 px tall)", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 740, height: 360 });
      await page.goto(url("/?e2eGallery=booth", lang));
      await expect(page.locator(".check-topbar .check-sound-top")).toBeHidden();
      await expect(page.locator(".check-topbar .check-badge-top")).toBeHidden();
      await expect(page.locator(".check-inline-bar .check-sound-inline")).toBeVisible();
      await expect(page.locator(".check-inline-bar .check-booth-badge")).toBeVisible();
      await expect(page.locator(".check-topbar .check-back")).toBeVisible();
      await expect(page.locator(".check-topbar .check-exit")).toBeVisible();
    });

    test("Today and My results never scroll sideways at 320 and 375 px", async ({ page }) => {
      await signIn(page, lang);
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(url("/", lang));
        await expect(page.locator('[data-screen="S01"]')).toBeVisible();
        const sideways = () =>
          page.evaluate(
            () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
          );
        expect(await sideways(), `Today at ${width}`).toBe(0);
        for (const b of await page.locator(".portal-sidebar nav button").all()) {
          const box = (await b.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
        await page
          .locator(".portal-sidebar nav")
          .getByRole("button", { name: COPY[lang].p.nav.label })
          .click();
        await expect(page.locator('[data-screen="S53"]')).toBeVisible();
        expect(await sideways(), `My results at ${width}`).toBe(0);
        // My results: no "reported" kicker and no 10 px footnote; its own footer instead.
        await expect(page.locator(".page-heading .section-kicker")).toHaveCount(0);
        await expect(page.locator(".medical-footnote")).toHaveCount(0);
        await expect(page.locator(".check-results-footer")).toBeVisible();
      }
    });

    test("a dialog makes the page inert but not its live region, and returns focus (S02)", async ({
      page,
    }) => {
      await page.goto(url("/?e2eGallery=offer", lang));
      const dialog = page.getByRole("dialog", { name: COPY[lang].a.afterIntake.title });
      await expect(dialog).toBeVisible();
      const state = await page.evaluate(() => {
        const inertUp = (el: Element | null) => {
          for (let x = el; x; x = x.parentElement) if (x.hasAttribute("inert")) return true;
          return false;
        };
        return {
          host: inertUp(document.querySelector(".check-dialog-host")),
          page: inertUp(document.querySelector("main h1")),
          live: [...document.querySelectorAll("[data-keep-live]")].map(inertUp),
          heading: document.activeElement?.id,
        };
      });
      expect(state.host).toBe(false);
      expect(state.page).toBe(true);
      expect(state.live.length).toBeGreaterThan(0);
      expect(state.live.every((x) => x === false)).toBe(true);
      expect(state.heading).toBe("check-after-intake-title");
      // The title takes focus without the control ring.
      const ring = await page
        .locator("#check-after-intake-title")
        .evaluate((el) => getComputedStyle(el).boxShadow);
      expect(ring).toBe("none");
      await dialog.getByRole("button", { name: COPY[lang].a.afterIntake.later }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("main h1")).toBeFocused();
      expect(await page.evaluate(() => document.querySelectorAll("[inert]").length)).toBe(0);
    });

    test("the system Back asks before leaving a signed in check (S15)", async ({ page }) => {
      await signIn(page, lang);
      const model = snapshot("signedIn", { kind: "intro" }, false);
      await page.evaluate((m) => sessionStorage.setItem("azm.check.snapshot", m), model);
      await page.goto(url("/", lang));
      await expect(page.locator(".azm-check.check-page h1")).toHaveText(COPY[lang].a.name);
      await page.goBack();
      const leave = page.getByRole("dialog", { name: COPY[lang].a.exit.title });
      await expect(leave).toBeVisible();
      await expect(page.locator(".azm-check.check-page h1")).toHaveText(COPY[lang].a.name);
      // Stay keeps the check; a second Back asks again.
      await leave.getByRole("button", { name: COPY[lang].a.exit.stay }).click();
      await expect(leave).toBeHidden();
      await page.goBack();
      await expect(leave).toBeVisible();
      await leave.getByRole("button", { name: COPY[lang].a.exit.leave }).click();
      await expect(page.locator('[data-screen="S01"]')).toBeVisible();
    });

    test("a guest exit replaces the page: Back never returns to the visitor's screens (S57)", async ({
      page,
    }) => {
      await page.goto(url("/", lang));
      await page.addInitScript(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(url("/?check=1", lang));
      await expect(page.locator("h1")).toBeVisible();
      await page.getByRole("button", { name: COPY[lang].a.common.exit }).click();
      await page
        .getByRole("dialog", { name: COPY[lang].a.exit.title })
        .getByRole("button", { name: COPY[lang].a.exit.leave })
        .click();
      await expect(page).not.toHaveURL(/check=1/);
      const entries = await page.evaluate(() => history.length);
      await page.goBack();
      await expect(page).not.toHaveURL(/check=1/);
      expect(entries).toBeGreaterThan(0);
    });

    test("the S32 reload snapshot reopens the check where it was (StrictMode)", async ({ page }) => {
      await page.addInitScript(
        ([m]) => {
          if (!sessionStorage.getItem("azm.e2e.once")) {
            sessionStorage.setItem("azm.e2e.once", "1");
            sessionStorage.setItem("azm.booth", "e2e-booth");
            sessionStorage.setItem("azm.check.snapshot", m);
          }
        },
        [snapshot("guest", { kind: "test.primer", i: 0 }, true)],
      );
      await page.goto(url("/?check=1", lang));
      await expect(page.locator("h1")).toHaveText(COPY[lang].a.primer.title);
      // Used once: the snapshot is gone after the mount.
      expect(await page.evaluate(() => sessionStorage.getItem("azm.check.snapshot"))).toBeNull();
    });

    test("an overlay that closes onto the same screen gives focus back to its h1 (5.6)", async ({ page }) => {
      // S47 with the stop list (S41) opened over it; "Pain" routes back to S47 (same screen key).
      const model = JSON.parse(
        snapshot("guest", { kind: "between", i: 0, side: 0, scope: "test", via: "stop" }, true),
      ) as Record<string, unknown>;
      model.overlay = { kind: "stopList" };
      await page.addInitScript(
        ([m]) => {
          if (!sessionStorage.getItem("azm.e2e.once")) {
            sessionStorage.setItem("azm.e2e.once", "1");
            sessionStorage.setItem("azm.booth", "e2e-booth");
            sessionStorage.setItem("azm.check.snapshot", m);
          }
        },
        [JSON.stringify(model)],
      );
      await page.goto(url("/?check=1", lang));
      await expect(page.locator('.check-overlay [data-screen="S41"]')).toBeVisible();
      await expect(page.locator(".check-base")).toHaveAttribute("inert", "");
      await page.evaluate(() =>
        (window as unknown as { e2eDispatch(e: unknown): void }).e2eDispatch({
          type: "STOP_OPTION",
          option: "pain",
        }),
      );
      await expect(page.locator(".check-overlay")).toHaveCount(0);
      await expect(page.locator('.check-base [data-screen="S47"] h1')).toBeFocused();
      await expect(page.locator(".check-base")).not.toHaveAttribute("inert", "");
    });

    test("the example banner stays in view and is read with the h1 (S54)", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 500 });
      await page.goto(url("/?example=progress", lang));
      const h1 = page.locator("h1");
      await expect(h1).toBeFocused();
      const described = await h1.getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      await expect(page.locator(`[id="${described}"]`)).toHaveText(COPY[lang].p.example.banner);
      await page.mouse.wheel(0, 800);
      const banner = (await rectOf(page, ".check-example-banner"))!;
      expect(banner.top).toBeGreaterThanOrEqual(-1);
      expect(banner.top).toBeLessThan(10);
    });

    test("going back online shows a short visible toast (0.7)", async ({ page, context }) => {
      await page.goto(url("/?check=1", lang));
      await expect(page.locator("h1")).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(COPY[lang].a.state.offline.banner)).toBeVisible();
      await context.setOffline(false);
      await expect(page.locator(".check-online-toast")).toHaveText(COPY[lang].a.state.offline.back);
      await expect(page.locator(".check-online-toast")).toBeHidden({ timeout: 6000 });
    });
  });
}
