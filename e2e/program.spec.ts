/**
 * Booth v2, contract B (program, sport and copy), in the real app on the e2e server:
 *   - the intake's goal step: «العودة إلى الرياضة», the 13 para sports, then the Program page opens on
 *     «طريقك إلى <الرياضة>» with the week's exercises under each demand (B3, B4, B5);
 *   - no chair tick: a seated person without equipment still gets a ready program (B6);
 *   - «لماذا هذا البرنامج؟» in two short lines (B7);
 *   - the report panel: one plain line, and the Read my report press sends the consent (B8);
 *   - the bottom tab bar under 768 px, the sidebar on desktop (B9).
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

const T = {
  ar: {
    sport: "العودة إلى الرياضة",
    basketball: "كرة السلة على الكراسي المتحركة",
    path: "طريقك إلى كرة السلة على الكراسي المتحركة",
    tabs: ["اليوم", "برنامجي", "نتائجي", "حالتي"],
    notice: "يقرأ عزم تقريرك مرة واحدة ليملأ إجاباتك، ولا يحتفظ به.",
    read: "اقرأ تقريري",
    why: "لماذا هذا البرنامج؟",
  },
  en: {
    sport: "Back to sport",
    basketball: "Wheelchair basketball",
    path: "Your path to wheelchair basketball",
    tabs: ["Today", "Program", "My results", "My condition"],
    notice: "Azm reads your report once to fill in your answers, and does not keep it.",
    read: "Read my report",
    why: "Why this program?",
  },
};

const seated = {
  age: 40,
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
  equipment: [],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

/** A fresh account, optionally with a saved intake. */
async function account(page: Page, lang: Lang, intake?: Record<string, unknown>): Promise<void> {
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Saad",
      email: `program-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  if (intake) {
    const r = await page.request.put("/api/intake", { headers, data: intake });
    expect(r.status()).toBe(200);
  }
  await page.goto(url("/", lang));
}

for (const lang of LANGS) {
  test.describe(`program ${lang}`, () => {
    test("Back to sport: the sport grid, then the Program page opens on the sport path", async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await account(page, lang);
      // Step 1: age and condition.
      await page.locator(".age-field input").fill("22");
      await page.locator(".conditions-grid button").nth(5).click();
      await page.locator(".intake-actions .cta").click();
      // Step 2: a wheelchair user, no warning signs, cleared.
      await page.locator(".intake-card select").first().selectOption("wheelchair");
      const answers = page.locator(".intake-question select");
      await answers.nth(0).selectOption("no");
      await answers.nth(1).selectOption("no");
      await answers.nth(2).selectOption("yes");
      await page.locator(".intake-actions .cta").click();
      // Step 3: no chair tick any more, and the sport grid behind Back to sport.
      await expect(page.locator(".intake-choices button", { hasText: /كرسي ثابت|Stable chair/ })).toHaveCount(
        0,
      );
      await expect(page.locator(".sport-grid")).toHaveCount(0);
      await page.locator(".goal-card", { hasText: T[lang].sport }).click();
      const tiles = page.locator(".sport-tile");
      await expect(tiles).toHaveCount(13);
      await expect(tiles.first()).toContainText(T[lang].basketball);
      // Continue without a sport stays on the step.
      await page.locator(".intake-actions .cta").click();
      await expect(page.locator(".form-error")).toBeVisible();
      await tiles.first().click();
      await expect(tiles.first()).toHaveAttribute("aria-pressed", "true");
      await page.locator(".intake-actions .cta").click();
      // Review: the sport is named; create the program.
      await expect(page.locator(".intake-review")).toContainText(T[lang].basketball);
      await page.locator(".consent input").check();
      await page.locator(".intake-actions .cta").click();
      // Program: the sport path first, filled once the week arrives.
      const path = page.locator(".sport-path");
      await expect(path.locator("h2")).toHaveText(T[lang].path);
      await expect(page.locator(".weekly-block").first()).toBeVisible({ timeout: 20_000 });
      await expect(path.locator(".sport-path-wait")).toHaveCount(0);
      await expect(path.locator("li")).toHaveCount(5);
      await expect(path.locator(".sport-path-chips span").first()).toBeVisible();
      // Why this program: two short lines.
      const why = page.locator(".plan-notes");
      await expect(why.locator("h2")).toHaveText(T[lang].why);
      await expect(why.locator(":scope > p")).toHaveCount(2);
    });

    test("a seated person with no equipment gets a ready program (no chair tick)", async ({ page }) => {
      await account(page, lang, seated);
      await page.locator(".portal-sidebar nav button").nth(1).click();
      await expect(page.locator(".plan-card")).toBeVisible();
      await expect(page.locator(".medical-review")).toHaveCount(0);
      await expect(page.locator(".sport-path")).toHaveCount(0);
    });

    test("the report panel: one plain line, and Read my report sends the consent", async ({ page }) => {
      await account(page, lang);
      await page.locator(".report-open").click();
      const panel = page.locator(".report-upload");
      await expect(panel.locator(".report-notice")).toHaveText(T[lang].notice);
      await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);
      await expect(panel).not.toContainText(/خارج المملكة|outside Saudi/);
      let sent: Record<string, unknown> | null = null;
      await page.route("**/api/medical-report", async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            document: "medical_report",
            extracted: {
              age: 22,
              conditions: ["sci_incomplete"],
              diagnosisNotes: "",
              medications: "",
              mobility: "wheelchair",
              support: "unknown",
              pain: [],
              restrictions: [],
              symptoms: "unknown",
              recentChange: "unknown",
            },
            missing: [],
            questions: [],
            summary: "",
            confidence: "high",
          }),
        });
      });
      await expect(panel.getByRole("button", { name: T[lang].read })).toBeVisible();
      // The press opens the photo picker; choosing a photo reads it.
      const chooser = page.waitForEvent("filechooser");
      await panel.getByRole("button", { name: T[lang].read }).click();
      // A 1 x 1 PNG.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      await (await chooser).setFiles({ name: "report.png", mimeType: "image/png", buffer: png });
      await expect(page.locator(".report-banner")).toBeVisible();
      expect(sent).toMatchObject({ kind: "image", reportConsent: true, lang });
    });

    test("under 768 px a fixed bottom tab bar; on desktop the sidebar", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await account(page, lang, seated);
      const nav = page.locator(".portal-sidebar nav");
      const tabs = nav.locator("button");
      await expect(tabs).toHaveText(T[lang].tabs);
      const bar = (await nav.boundingBox())!;
      expect(Math.round(bar.y + bar.height)).toBe(844);
      expect(Math.round(bar.height)).toBe(64);
      expect(Math.round(bar.width)).toBe(390);
      for (const b of await tabs.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await expect(tabs.nth(0)).toHaveAttribute("aria-current", "page");
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
      // The page title keeps the full name.
      await tabs.nth(3).click();
      await expect(page.locator(".page-heading h1")).toHaveText(
        lang === "ar" ? "حالتي الطبية" : "My medical condition",
      );
      // The bar stays put while the page scrolls, and the page clears it at the end.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(Math.round((await nav.boundingBox())!.y)).toBe(844 - 64);
      const sideways = await page.evaluate(
        () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
      );
      expect(sideways).toBe(0);
      // Desktop: the sidebar column, not a bar.
      await page.setViewportSize({ width: 1280, height: 800 });
      const side = (await nav.boundingBox())!;
      expect(side.width).toBeLessThan(260);
      expect(side.y).toBeLessThan(300);
    });
  });
}
