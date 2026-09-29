/**
 * The booth stream in the browser (UX spec S55 to S58, contract v3 I, council O15, O17, O18, O47, Q21),
 * in Arabic and English:
 *
 *   S55   /?booth=1: the staff code against the real server (the booth days rule: no code works
 *         outside the booth days), then the verify answers (wrong, too many tries, offline, on), the
 *         visitor QR, the end of the staff session, and turning booth mode off (it never leaks home).
 *   S55b  the visitor token page: redeem, used or ended, offline then Try again, and the phone that
 *         keeps only its own pass.
 *   S56   inside the real check (/?check=1, reached by the real reducer): the staff code, two
 *         readings in any digits, the means, the ranges, Continue, "unavailable", and a visitor's own
 *         phone where the staff code is never asked. The usual systolic is never shown (O47 (2)).
 *   S57   the staff reset (a press and hold on the badge, the shortcut key) from a question, a camera
 *         and a safety screen; the idle reset on S50 (3 minutes, then 30 s) and before the camera
 *         (5 minutes), never on camera, safety or S56 screens; the staff count; New visitor.
 *   S58   the setup tips, the wheelchair tip first for a wheelchair user.
 *
 * The booth server answers are routed (page.route) where the real server cannot give them before the
 * booth days; the S55 closed answer comes from the real server. Booth parts that other screens host
 * are opened on the booth harness (/?booth=1&e2eBooth=<page>, VITE_E2E builds only).
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };

const COPY = { ar, en } as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

const SESSION = "a".repeat(64);
const VISITOR = "c".repeat(64);
const QR_TOKEN = "d".repeat(64);
const HOUR = 60 * 60 * 1000;

/** Console errors, except the expected 401 of /api/auth/me and the answers a spec routes on purpose. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const at = m.location().url;
    if (m.text().includes("401") && at.includes("/api/auth/me")) return;
    if (/status of (4\d\d)/.test(m.text()) && at.includes("/api/booth/")) return;
    errors.push(`${m.text()} @ ${at}`);
  });
  return errors;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Digits as a person types them on this page (Arabic Indic in Arabic, 0.2). */
const digits = (lang: Lang, n: number | string) =>
  lang === "ar" ? String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : String(n);

async function boothPass(page: Page) {
  return page.evaluate(() => sessionStorage.getItem("azm.booth"));
}

for (const lang of LANGS) {
  const c = COPY[lang];

  test.describe(`booth S55 staff mode (${lang})`, () => {
    test("the staff code: empty, the real server outside the booth days, wrong, too many tries, offline", async ({
      page,
      context,
    }) => {
      const errors = watchConsole(page);
      await page.goto(url("/?booth=1", lang));
      await expect(page.locator("h1")).toHaveText(c.booth.title);
      const code = page.getByLabel(c.booth.codeLabel);
      await expect(code).toHaveAttribute("type", "password");
      await expect(code).toHaveAttribute("inputmode", "numeric");
      await expect(code).toHaveAttribute("autocomplete", "off");
      await expect(page.locator(".check-booth-badge")).toHaveCount(0);
      const turnOn = page.getByRole("button", { name: c.booth.turnOn });

      // Empty: the code is not right, nothing is sent.
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.wrong);
      await expect(code).toHaveAttribute("aria-invalid", "true");
      await expect(code).toBeFocused();

      // The real server: today is not a booth day (O17), so no code turns booth mode on.
      await code.fill(digits(lang, "482913"));
      const verify = page.waitForRequest("**/api/booth/verify");
      await turnOn.click();
      expect((await verify).postDataJSON()).toEqual({ code: "482913" });
      await expect(page.getByRole("alert")).toHaveText(c.booth.closed);
      expect(await boothPass(page)).toBeNull();

      await page.route("**/api/booth/verify", (r) => json(r, { ok: false }));
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.wrong);

      await page.unroute("**/api/booth/verify");
      await page.route("**/api/booth/verify", (r) => json(r, { error: "RATE_LIMIT" }, 429));
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.limited);

      await context.setOffline(true);
      await turnOn.click();
      await expect(page.getByRole("alert")).toHaveText(c.state.offline.startBlocked);
      await context.setOffline(false);
      expect(await boothPass(page)).toBeNull();
      expect(errors).toEqual([]);
    });

    test("booth mode on: the pass is kept and never the code, the visitor QR, then off", async ({ page }) => {
      const errors = watchConsole(page);
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/api/booth/verify", async (r) => {
        await held;
        await json(r, { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR });
      });
      await page.route("**/api/booth/token", (r) =>
        json(r, { token: QR_TOKEN, expires: Date.now() + 45 * 60 * 1000 }),
      );
      await page.goto(url("/?booth=1", lang));
      await page.getByLabel(c.booth.codeLabel).fill("777111");
      const turnOn = page.getByRole("button", { name: c.booth.turnOn });
      await turnOn.click();
      // Loading: the primary is busy and keeps its label.
      await expect(turnOn).toHaveAttribute("aria-busy", "true");
      release();

      await expect(page.getByRole("status").filter({ hasText: c.booth.on })).toBeVisible();
      await expect(page.locator(".check-topbar .check-booth-badge")).toContainText(c.guest.boothBadge);
      const pass = JSON.parse((await boothPass(page))!);
      expect(pass).toMatchObject({ kind: "staff", session: SESSION });
      const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
      expect(stored).not.toContain("777111");

      // The one check QR for a visitor's own phone: a picture only, never the link as text.
      const token = page.waitForRequest("**/api/booth/token");
      await page.getByRole("button", { name: c.booth.showVisitorQr }).click();
      expect((await token).postDataJSON()).toEqual({ session: SESSION });
      const panel = page.locator("[data-visitor-qr]");
      await expect(panel.getByRole("heading", { name: c.booth.visitorQrTitle })).toBeFocused();
      await expect(panel).toContainText(c.booth.visitorQrBody);
      await expect(panel.getByRole("img", { name: c.booth.visitorQrTitle })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain(QR_TOKEN);
      const decoded = await decodeQr(page);
      if (decoded !== "unsupported") expect(decoded).toMatch(new RegExp(`/\\?boothToken=${QR_TOKEN}$`));
      await panel.getByRole("button", { name: c.common.close }).click();
      await expect(page.getByRole("button", { name: c.booth.showVisitorQr })).toBeFocused();

      // Turning booth mode off leaves nothing: the guest check is closed again (never leaks home).
      await page.getByRole("button", { name: c.booth.turnOff }).click();
      await expect(page.getByLabel(c.booth.codeLabel)).toBeVisible();
      await expect(page.locator(".check-booth-badge")).toHaveCount(0);
      expect(await boothPass(page)).toBeNull();
      await page.goto(url("/?check=1", lang));
      await expect(page.locator("h1")).toHaveText(c.guest.boothOnly.title);
      expect(errors).toEqual([]);
    });

    test("the staff session ends at closing time: a refused token turns booth mode off", async ({ page }) => {
      await page.route("**/api/booth/verify", (r) =>
        json(r, { ok: true, session: SESSION, expires: Date.now() + HOUR }),
      );
      await page.route("**/api/booth/token", (r) => json(r, { error: "BOOTH_SESSION" }, 403));
      await page.goto(url("/?booth=1", lang));
      await page.getByLabel(c.booth.codeLabel).fill("777111");
      await page.getByRole("button", { name: c.booth.turnOn }).click();
      await page.getByRole("button", { name: c.booth.showVisitorQr }).click();
      await expect(page.getByLabel(c.booth.codeLabel)).toBeVisible();
      expect(await boothPass(page)).toBeNull();
    });

    test("Open the visitor check starts the guest check in booth mode", async ({ page }) => {
      await page.route("**/api/booth/verify", (r) =>
        json(r, { ok: true, session: SESSION, expires: Date.now() + HOUR }),
      );
      await page.route("**/api/booth/token", (r) => json(r, { token: QR_TOKEN, expires: Date.now() + HOUR }));
      await page.goto(url("/?booth=1", lang));
      await page.getByLabel(c.booth.codeLabel).fill("777111");
      await page.getByRole("button", { name: c.booth.turnOn }).click();
      await page.getByRole("button", { name: c.booth.openGuest }).click();
      await expect(page).toHaveURL(/check=1/);
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      await expect(page.locator("h1")).not.toHaveText(c.guest.boothOnly.title);
    });
  });

  test.describe(`booth S55b visitor token (${lang})`, () => {
    const tokenPage = (t: string) => url(`/?booth=1&e2eBooth=token&t=${t}`, lang);

    test("redeems once and keeps this phone's own pass, never the QR token", async ({ page }) => {
      const errors = watchConsole(page);
      const calls: unknown[] = [];
      await page.route("**/api/booth/redeem", (r) => {
        calls.push(r.request().postDataJSON());
        return json(r, { ok: true, token: VISITOR, expires: Date.now() + 45 * 60 * 1000 });
      });
      await page.goto(tokenPage(QR_TOKEN));
      await expect(page.getByRole("status").filter({ hasText: c.booth.tokenOn })).toBeVisible();
      await expect(page.locator(".check-topbar .check-booth-badge")).toBeVisible();
      expect(calls).toEqual([{ token: QR_TOKEN }]);
      const pass = JSON.parse((await boothPass(page))!);
      expect(pass).toMatchObject({ kind: "visitor", token: VISITOR });
      await page.getByRole("button", { name: c.common.continue }).click();
      await expect(page.locator("body")).toHaveAttribute("data-continued", "on");
      expect(errors).toEqual([]);
    });

    test("a used or ended token shows tokenEnded; later the staff page shows it too, never the code", async ({
      page,
    }) => {
      await page.route("**/api/booth/redeem", (r) => json(r, { ok: false }));
      await page.goto(tokenPage(QR_TOKEN));
      await expect(page.locator("[data-token-ended]")).toContainText(c.booth.tokenEnded);
      await expect(page.locator(".check-booth-badge")).toHaveCount(0);
      expect(await boothPass(page)).toBeNull();

      // This phone redeemed a token before, and it has ended since.
      await page.evaluate(() => sessionStorage.setItem("azm.booth.visitor", "1"));
      await page.goto(url("/?booth=1", lang));
      await expect(page.locator("[data-token-ended]")).toContainText(c.booth.tokenEnded);
      await expect(page.getByLabel(c.booth.codeLabel)).toHaveCount(0);
    });

    test("a link of the wrong form ends without a call; a network error, then Try again", async ({
      page,
    }) => {
      let calls = 0;
      await page.route("**/api/booth/redeem", (r) => {
        calls += 1;
        return calls === 1
          ? r.abort("internetdisconnected")
          : json(r, { ok: true, token: VISITOR, expires: Date.now() + HOUR });
      });
      await page.goto(tokenPage("not-a-token"));
      await expect(page.locator("[data-token-ended]")).toBeVisible();
      expect(calls).toBe(0);

      await page.goto(tokenPage(QR_TOKEN));
      await expect(page.getByRole("alert")).toContainText(c.state.error.body);
      await page.getByRole("button", { name: c.common.retry }).click();
      await expect(page.getByRole("status").filter({ hasText: c.booth.tokenOn })).toBeVisible();
      expect(calls).toBe(2);
    });

    test("offline: starting needs a connection", async ({ page }) => {
      await page.goto(url(`/?booth=1&e2eBooth=token&phase=offline&t=${QR_TOKEN}`, lang));
      await expect(page.getByRole("alert")).toContainText(c.state.offline.startBlocked);
      await expect(page.getByRole("button", { name: c.common.retry })).toBeVisible();
    });
  });

  test.describe(`booth S56 staff vitals in the check (${lang})`, () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    async function openVitals(page: Page, pass: "staff" | "visitor" = "staff") {
      await page.goto(
        url(`/?booth=1&e2eBooth=vitals-flow${pass === "visitor" ? "&pass=visitor" : ""}`, lang),
      );
      await expect(page).toHaveURL(/check=1/);
      await expect(page.locator('[data-screen="S56"]')).toBeVisible();
    }

    test("the staff code opens the staff part; two readings in any digits, their means, Continue", async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await page.route("**/api/booth/verify", (r) =>
        json(r, { ok: true, session: SESSION, expires: Date.now() + HOUR }),
      );
      await openVitals(page);
      await expect(page.locator(".booth-handoff")).toHaveText(c.vitals.handoff);
      await expect(page.locator("h1")).toHaveText(c.vitals.staffOnly);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(c.vitals.title);
      // Locked: the readings are not on the page before the staff code.
      await expect(page.getByLabel(c.vitals.sys)).toHaveCount(0);
      await expect(page.getByRole("button", { name: c.vitals.unavailable })).toBeVisible();
      await page.getByLabel(c.booth.codeLabel).fill("777111");
      await page.getByRole("button", { name: c.common.continue }).click();

      await expect(page.locator("[data-staff-line]")).toBeVisible();
      await expect(page.getByText(c.vitals.method)).toBeVisible();
      await expect(page.getByText(c.vitals.arm)).toBeVisible();
      await expect(page.getByText(c.vitals.notStored)).toBeVisible();
      // O47 (2): the usual systolic is never rendered at the booth.
      await expect(page.getByText(c.vitals.usualSys)).toHaveCount(0);

      // Continue with nothing typed: every field says its range, focus on the first.
      await page.getByRole("button", { name: c.common.continue }).click();
      const first = page.locator('[data-field="hr1"]');
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText(c.common.chooseToContinue)).toBeVisible();

      const type = async (field: string, v: number | string) =>
        page.locator(`[data-field="${field}"]`).fill(digits(lang, v));
      await type("hr1", 300);
      await page.locator('[data-field="sys1"]').focus();
      await expect(page.locator('[data-field="hr1"]')).toHaveAttribute("aria-invalid", "true");
      const hrError = await page.locator('[data-field="hr1"]').getAttribute("aria-describedby");
      await expect(page.locator(`[id="${hrError}"]`)).toHaveText(
        fill(c.vitals.range, { min: digits(lang, 30), max: digits(lang, 250) }),
      );
      await type("hr1", 72);
      await type("sys1", 128);
      await type("dia1", 82);
      await type("hr2", 68);
      await type("sys2", 124);
      await type("dia2", 78);
      await page.locator('[data-field="dia2"]').blur();
      const means = page.locator("[data-means]");
      await expect(means.locator('[data-mean="sys"]')).toHaveText(digits(lang, 126));
      await expect(means.locator('[data-mean="dia"]')).toHaveText(digits(lang, 80));
      await expect(means.locator('[data-mean="hr"]')).toHaveText(digits(lang, 70));

      await page.getByRole("button", { name: c.common.no, exact: true }).click();
      await page.getByRole("button", { name: c.common.continue }).click();
      // The flow takes the answer: the check goes on to the warnings or the protocol (S25, S27).
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", /^(warnings|plan)$/);
      expect(errors).toEqual([]);
    });

    test("no validated cuff or licensed practitioner: the check goes on without the staff part", async ({
      page,
    }) => {
      await openVitals(page);
      await page.getByRole("button", { name: c.vitals.unavailable }).click();
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", /^(warnings|plan)$/);
    });

    test("a wrong staff code keeps the staff part closed", async ({ page }) => {
      await page.route("**/api/booth/verify", (r) => json(r, { ok: false }));
      await openVitals(page);
      await page.getByLabel(c.booth.codeLabel).fill("000000");
      await page.getByRole("button", { name: c.common.continue }).click();
      await expect(page.getByRole("alert")).toHaveText(c.booth.wrong);
      await expect(page.getByLabel(c.vitals.sys)).toHaveCount(0);
    });

    test("a visitor's own phone never asks for the staff code", async ({ page }) => {
      await page.route("**/api/booth/check", (r) => json(r, { ok: true, expires: Date.now() + HOUR }));
      await openVitals(page, "visitor");
      await expect(page.getByLabel(c.booth.codeLabel)).toHaveCount(0);
      await expect(page.getByRole("button", { name: c.common.continue })).toHaveCount(0);
      await page.getByRole("button", { name: c.vitals.unavailable }).click();
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", /^(warnings|plan)$/);
    });

    test("while a signed in booth check starts: busy, then the start error with Try again", async ({
      page,
    }) => {
      await page.goto(url("/?booth=1&e2eBooth=vitals-starting", lang));
      await expect(page.getByText(c.state.loading.check)).toBeVisible();
      await page.goto(url("/?booth=1&e2eBooth=vitals-starting&error=offline", lang));
      await expect(page.getByRole("alert")).toContainText(c.state.offline.startBlocked);
      await page.getByRole("button", { name: c.common.retry }).click();
      await expect(page.locator(".check-base")).toHaveAttribute("data-events", "RETRY");
    });
  });

  test.describe(`booth S57 tools (${lang})`, () => {
    const layer = (state: string) => url(`/?booth=1&e2eBooth=layer-${state}`, lang);
    const events = (page: Page) => page.locator(".check-base").getAttribute("data-events");

    test("staff reset: a press and hold on the badge, the shortcut key, Stay, Clear and start", async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await page.goto(layer("question"));
      const badge = page.locator(".check-topbar .check-booth-badge");
      await expect(badge).toContainText(c.guest.boothBadge);
      await expect(badge).toContainText(c.booth.badgeHint);
      const box = (await badge.boundingBox())!;
      const dialog = page.getByRole("dialog", { name: c.booth.resetConfirm });

      // A short press does nothing.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(500);
      await page.mouse.up();
      await page.waitForTimeout(1200);
      await expect(dialog).toHaveCount(0);

      await page.mouse.down();
      await page.waitForTimeout(1700);
      await expect(dialog).toBeVisible();
      await page.mouse.up();
      await dialog.getByRole("button", { name: c.exit.stay }).click();
      await expect(dialog).toHaveCount(0);
      expect(await events(page)).toBe("");

      await page.keyboard.press("Alt+Shift+KeyN");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: c.booth.resetYes }).click();
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "guestWelcome");
      expect(await events(page)).toBe("STAFF_RESET reload");
      expect(errors).toEqual([]);
    });

    for (const state of ["camera", "safety"]) {
      test(`staff reset from a ${state} screen, and no idle reset there`, async ({ page }) => {
        await page.clock.install();
        await page.goto(layer(state));
        await expect(page.locator(".check-base")).toBeVisible();
        await page.clock.runFor(10 * 60 * 1000);
        await expect(page.locator("[data-idle-sheet]")).toHaveCount(0);
        await page.keyboard.press("Alt+Shift+KeyN");
        const dialog = page.getByRole("dialog", { name: c.booth.resetConfirm });
        await dialog.getByRole("button", { name: c.booth.resetYes }).click();
        await expect(page.locator(".check-base")).toHaveAttribute("data-state", "guestWelcome");
        // A reset logs no stop.
        expect(await events(page)).toBe("STAFF_RESET reload");
      });
    }

    test("no idle reset on the staff vitals (S56)", async ({ page }) => {
      await page.clock.install();
      await page.goto(layer("vitals"));
      await expect(page.locator(".check-base")).toBeVisible();
      await page.clock.runFor(10 * 60 * 1000);
      await expect(page.locator("[data-idle-sheet]")).toHaveCount(0);
    });

    test("idle on S50: asked after 3 minutes, I am still here, then cleared after 30 s", async ({ page }) => {
      await page.clock.install();
      await page.goto(layer("results"));
      await expect(page.locator(".check-base")).toBeVisible();
      const sheet = page.locator("[data-idle-sheet]");
      await page.clock.runFor(2 * 60 * 1000 + 50_000);
      await expect(sheet).toHaveCount(0);
      await page.clock.runFor(12_000);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("heading")).toHaveText(c.booth.idleTitle);
      await expect(sheet.getByRole("button", { name: c.booth.stillHere })).toBeFocused();
      // The sheet leaves the page above it visible: no scrim, not modal.
      await expect(sheet).toHaveAttribute("aria-modal", "false");
      await sheet.getByRole("button", { name: c.booth.stillHere }).click();
      await expect(sheet).toHaveCount(0);
      expect(await events(page)).toBe("");

      await page.clock.runFor(3 * 60 * 1000 + 2000);
      await expect(sheet).toBeVisible();
      await page.clock.runFor(10_000);
      await expect(sheet.locator("[data-seconds]")).toHaveAttribute("data-seconds", /^(19|20|21)$/);
      await page.clock.runFor(22_000);
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "guestWelcome");
      expect(await events(page)).toBe("STAFF_RESET reload");
    });

    test("idle before the camera: asked after 5 minutes", async ({ page }) => {
      await page.clock.install();
      await page.goto(layer("question"));
      await expect(page.locator(".check-base")).toBeVisible();
      const sheet = page.locator("[data-idle-sheet]");
      await page.clock.runFor(4 * 60 * 1000 + 50_000);
      await expect(sheet).toHaveCount(0);
      await page.clock.runFor(12_000);
      await expect(sheet).toBeVisible();
      // A touch anywhere is activity: the question goes away.
      await page.mouse.click(10, 400);
      await expect(sheet).toHaveCount(0);
    });

    test("New visitor on S50 asks first, then clears the visit", async ({ page }) => {
      await page.goto(layer("results"));
      await page.getByRole("button", { name: c.guest.newVisitor }).click();
      const dialog = page.getByRole("dialog", { name: c.booth.resetConfirm });
      await expect(dialog.getByRole("button", { name: c.exit.stay })).toBeFocused();
      await dialog.getByRole("button", { name: c.booth.resetYes }).click();
      await expect(page.locator(".check-base")).toHaveAttribute("data-state", "guestWelcome");
      expect(await events(page)).toContain("STAFF_RESET");
    });

    test("the staff count: typed in any digits, a whole count from 0 to 60", async ({ page }) => {
      await page.goto(url("/?booth=1&e2eBooth=count", lang));
      await page.getByRole("button", { name: c.booth.correct }).click();
      const dialog = page.getByRole("dialog", { name: c.booth.staffCount });
      const input = dialog.getByLabel(c.booth.staffCount);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(digits(lang, 12));
      await input.fill(digits(lang, 99));
      await dialog.getByRole("button", { name: c.common.continue }).click();
      await expect(dialog.getByRole("alert")).toHaveText(
        fill(c.count.range, { min: digits(lang, 0), max: digits(lang, 60) }),
      );
      // The S48 stepper: one fewer and one more, in the page's digits.
      await input.fill(digits(lang, 13));
      await dialog.getByRole("button", { name: c.count.increase }).click();
      await expect(input).toHaveValue(digits(lang, 14));
      await dialog.getByRole("button", { name: c.count.decrease }).click();
      await expect(input).toHaveValue(digits(lang, 13));
      await input.fill(digits(lang, 14));
      await dialog.getByRole("button", { name: c.common.continue }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-saved]")).toHaveAttribute("data-saved", "14");
    });
  });

  test.describe(`booth S58 setup tips (${lang})`, () => {
    test("seven tips; the wheelchair tip first for a wheelchair user, last otherwise; Go back", async ({
      page,
    }) => {
      await page.goto(url("/?booth=1&e2eBooth=tips", lang));
      await expect(page.locator("h1")).toHaveText(c.tips.title);
      const tips = page.locator("[data-tip]");
      await expect(tips).toHaveCount(7);
      await expect(tips.first()).toHaveAttribute("data-tip", "light");
      await expect(tips.last()).toHaveAttribute("data-tip", "wheelchair");
      await expect(page.locator('[data-tip="distance"]')).toContainText(digits(lang, 2));
      await page.locator(".check-footer").getByRole("button", { name: c.tips.back }).click();
      await expect(page.locator("[data-back]")).toHaveAttribute("data-back", "1");
      await page.goto(url("/?booth=1&e2eBooth=tips-wheelchair", lang));
      await expect(page.locator("[data-tip]").first()).toHaveAttribute("data-tip", "wheelchair");
    });
  });
}

test.describe("booth targets", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  /** Every visible control of the page is 48 px or more each way (0.5). */
  async function smallControls(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, input, a[href], [role=button]")]
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < 48 || r.width < 48))
        .map(({ el, r }) => `${el.tagName} ${el.textContent?.trim().slice(0, 30)} ${r.width}x${r.height}`),
    );
  }

  for (const lang of LANGS) {
    test(`every booth control is 48 px or more (${lang})`, async ({ page }) => {
      await page.route("**/api/booth/verify", (r) =>
        json(r, { ok: true, session: SESSION, expires: Date.now() + HOUR }),
      );
      await page.route("**/api/booth/token", (r) => json(r, { token: QR_TOKEN, expires: Date.now() + HOUR }));
      const c = COPY[lang];
      await page.goto(url("/?booth=1", lang));
      expect(await smallControls(page)).toEqual([]);
      await page.getByLabel(c.booth.codeLabel).fill("1");
      await page.getByRole("button", { name: c.booth.turnOn }).click();
      await page.getByRole("button", { name: c.booth.showVisitorQr }).click();
      await expect(page.locator("[data-visitor-qr]")).toBeVisible();
      expect(await smallControls(page)).toEqual([]);

      await page.goto(url("/?booth=1&e2eBooth=vitals-flow", lang));
      await expect(page.locator('[data-screen="S56"]')).toBeVisible();
      await page.getByLabel(c.booth.codeLabel).fill("1");
      await page.getByRole("button", { name: c.common.continue }).click();
      await expect(page.locator('[data-unlocked="yes"]')).toBeVisible();
      expect(await smallControls(page)).toEqual([]);

      for (const part of ["tips", "count", "layer-results", "token&phase=on", "token&phase=ended"]) {
        await page.goto(url(`/?booth=1&e2eBooth=${part}`, lang));
        await expect(page.locator("h1")).toBeVisible();
        expect(await smallControls(page), part).toEqual([]);
      }
      await page.goto(url("/?booth=1&e2eBooth=count", lang));
      await page.getByRole("button", { name: c.booth.correct }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await smallControls(page)).toEqual([]);
    });
  }
});

test.describe("booth mode never leaks home", () => {
  test("no pass: the landing and the check have no booth badge, and /?check=1 stays closed", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".check-booth-badge")).toHaveCount(0);
    await page.goto("/?check=1");
    await expect(page.locator("h1")).toHaveText(ar.guest.boothOnly.title);
    await expect(page.locator(".check-booth-badge")).toHaveCount(0);
  });

  test("an ended visitor pass is removed, and the staff page shows tokenEnded", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "azm.booth",
        JSON.stringify({ kind: "visitor", token: "e".repeat(64), expires: Date.now() - 1000 }),
      );
      sessionStorage.setItem("azm.booth.visitor", "1");
    });
    await page.goto("/?check=1");
    await expect(page.locator("h1")).toHaveText(ar.guest.boothOnly.title);
    expect(await boothPass(page)).toBeNull();
  });
});

/**
 * Reads the visitor QR back with the browser's own barcode reader where it has one (Chrome on macOS,
 * Android). "unsupported" where it has none; the unit tests read every code back too.
 */
async function decodeQr(page: Page): Promise<string | "unsupported"> {
  return page.evaluate(async () => {
    const BD = (
      window as unknown as {
        BarcodeDetector?: new (o: object) => { detect(s: unknown): Promise<{ rawValue: string }[]> };
      }
    ).BarcodeDetector;
    if (!BD) return "unsupported";
    const svg = document.querySelector<SVGSVGElement>("[data-visitor-qr] svg");
    if (!svg) return "no svg";
    const xml = new XMLSerializer().serializeToString(svg);
    // Inline the fills (the stylesheet colours do not travel with the serialised picture).
    const src = xml
      .replace('class="check-qr-light"', 'fill="#ffffff"')
      .replace('class="check-qr-dark"', 'fill="#000000"');
    const img = new Image(400, 400);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 400, 400);
    g.drawImage(img, 0, 0, 400, 400);
    try {
      const found = await new BD({ formats: ["qr_code"] }).detect(canvas);
      return found[0]?.rawValue ?? "none";
    } catch {
      return "unsupported";
    }
  });
}
