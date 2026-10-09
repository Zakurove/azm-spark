/**
 * D-034 item 5 in the real app (VITE_V7=1 and AZM_V7=1, e2e/v7-flow.config.ts): the shorter health
 * form. Three steps; the body map fills itself from the condition and never asks the problem type of
 * a filled part; a part added by hand asks one quick choice, and the surgery questions only after
 * «بعد عملية»; editing a saved form asks nothing again.
 *
 * With AZM_SHOTS_DIR set it also writes the review screenshots at 390 x 844, in Arabic and English:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/v7/fix-form AZM_E2E_PORT=<port> npm run e2e:v7 -- v7-form
 *
 * Skipped under the default config, whose server has the flags off.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

type Lang = "ar" | "en";
const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
if (OUT) mkdirSync(OUT, { recursive: true });

const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/** A fresh account with no health form yet: the form opens on its first step. */
async function newcomer(page: Page, lang: Lang): Promise<Record<string, string>> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Fahd",
      email: `v7-form-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  return headers;
}

/** A review screenshot (AZM_SHOTS_DIR only): the whole page, without the phone's fixed tab bar. */
async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  await page.addStyleTag({ content: ".portal-sidebar nav { visibility: hidden !important; }" });
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, animations: "disabled" });
}
/** A screenshot of what the phone shows with this element at the top. */
async function view(page: Page, selector: string, name: string): Promise<void> {
  if (!OUT) return;
  await page
    .locator(selector)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled" });
}

const cta = (page: Page) => page.locator(".intake-actions .cta");
const fieldset = (page: Page, legend: string) =>
  page
    .locator("fieldset")
    .filter({ has: page.locator("legend", { hasText: legend }) })
    .last();

for (const lang of ["ar", "en"] as const) {
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);

  test(`${lang}: a right sided stroke fills the map by itself, in three short steps`, async ({ page }) => {
    await newcomer(page, lang);
    await page.goto(url("/", lang));
    const card = page.locator(".intake-card");
    await expect(page.locator(".intake-progress li")).toHaveCount(3);
    await expect(card.locator(".intake7-who")).toBeVisible();
    // Nothing the rules do not read.
    for (const gone of [
      L("تفاصيل التشخيص أو تعليمات الطبيب", "Diagnosis details or clinician instructions"),
      L("الأدوية الحالية", "Current medications"),
      L("هل يحتاج أحد جانبي جسمك إلى مراعاة خاصة؟", "Should we account for one side?"),
    ])
      await expect(card).not.toContainText(gone);
    // D-035 item 5: the medical report is a standout card, before the questions.
    const report = card.locator(".report-card");
    await expect(report).toContainText(L("عندك تقرير طبي؟", "Have a medical report?"));
    await expect(report).toContainText(
      L(
        "ارفع تقريرك الطبي، ونقرأه لك ونملأ حالتك",
        "Upload your medical report, we read it and fill in your condition",
      ),
    );
    const above = await report.evaluate(
      (el) =>
        el.getBoundingClientRect().top < document.querySelector(".age-field")!.getBoundingClientRect().top,
    );
    expect(above).toBe(true);
    await expect(card.locator(".intake-mobility legend")).toContainText(
      L("ما الوضعية الأنسب لك في التمرين؟", "Which position suits you best for exercise?"),
    );
    await shot(page, `${lang}-1-condition-empty`);

    // Step 1: age and sex, a stroke with its side, how the person exercises, walking.
    await card.locator(".age-field input").fill("58");
    await card.locator(".intake7-who button").first().click();
    await card.locator(".conditions-grid button").nth(1).click();
    const side = card.locator(".intake7-fill-ask");
    await expect(side).toContainText(L("أي جهة هي الأضعف؟", "Which side is weaker?"));
    await side.locator("button").first().click();
    await card.locator('.intake-mobility button[data-value="standing"]').click();
    await fieldset(page, L("هل تستطيع المشي؟", "Can you walk?")).locator("button").nth(2).click();
    await card.locator(".intake7-height input").fill("172");
    await shot(page, `${lang}-1-condition`);
    await cta(page).click();

    // Step 2: the six parts of the right side are on the map, and their problem type is never asked.
    await expect(card.locator(".intake7-mapsection")).toBeVisible();
    await expect(card.locator('.bm-cell[aria-pressed="true"]')).toHaveCount(6);
    for (const region of ["shoulder", "elbow", "forearm_wrist", "hip", "knee", "ankle_foot"])
      await expect(card.locator(`.bm-cell[data-cell="${region}:right"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    await expect(card.locator(".intake7-fill li")).toHaveText([
      L(
        "ضعف في الجهة اليمنى: الكتف، والمرفق، والساعد والرسغ، والورك، والركبة، والكاحل والقدم",
        "Weakness on the right side: shoulder, elbow, forearm and wrist, hip, knee, and ankle and foot",
      ),
    ]);
    await expect(card.locator(".intake7-card")).toHaveCount(0);
    // D-035 item 5: the neck and the back or trunk are named on the figure.
    await expect(card.locator('.bm-tag[data-tag="neck"]')).toHaveText(L("الرقبة", "Neck"));
    await expect(card.locator('.bm-tag[data-tag="back_trunk"]')).toHaveText(
      L("الظهر والجذع", "Back or trunk"),
    );
    await view(page, ".intake7-mapsection", `${lang}-2-map-filled`);
    // D-035 item 5: the answer that lets the person go ahead is each safety question's first button.
    for (const [field, first] of [
      ["symptoms", "no"],
      ["recentChange", "no"],
      ["restrictions", "no"],
      ["clearance", "yes"],
    ])
      await expect(card.locator(`[data-field="${field}"] button`).first()).toHaveAttribute(
        "data-value",
        first,
      );
    const yes = L("نعم", "Yes");
    const no = L("لا", "No");
    for (const [q, first] of [
      [L("هشاشة في العظام", "weak bones"), no],
      [L("رقبتك غير مستقرة", "neck is unstable"), no],
      [L("ترفع مقدمة قدمك", "lift the front of your foot"), yes],
      [L("الجلوس نحو 30 ثانية", "sit for about 30 seconds"), yes],
    ])
      await expect(fieldset(page, q).locator("button").first()).toHaveText(first);
    await view(page, ".intake7-safety", `${lang}-2-safety-order`);
    // The safety questions come after the map.
    await card.locator('[data-field="symptoms"] button[data-value="no"]').click();
    await card.locator('[data-field="clearance"] button[data-value="yes"]').click();
    await card.locator('[data-field="recentChange"] button[data-value="no"]').click();
    // The restrictions are one no, already chosen; a yes shows the list.
    const restrictions = card.locator('[data-field="restrictions"]');
    await expect(restrictions.locator('button[data-value="no"]')).toHaveAttribute("aria-pressed", "true");
    await expect(restrictions.locator(".intake-restrictions")).toHaveCount(0);
    await restrictions.locator('button[data-value="yes"]').click();
    await expect(restrictions.locator(".intake-restrictions button")).toHaveCount(5);
    await restrictions.locator('button[data-value="no"]').click();
    await expect(restrictions.locator(".intake-restrictions")).toHaveCount(0);
    // No for weak bones and the neck, yes for the foot: each the first button now.
    for (const q of [
      L("هشاشة في العظام", "weak bones"),
      L("رقبتك غير مستقرة", "neck is unstable"),
      L("ترفع مقدمة قدمك", "lift the front of your foot"),
    ])
      await fieldset(page, q).locator("button").first().click();
    await fieldset(page, L("الجلوس نحو 30 ثانية", "sit for about 30 seconds"))
      .locator("button")
      .first()
      .click();
    // Continue before the confirmation: the map asks for it.
    await cta(page).click();
    await expect(card.locator(".intake7-fill .intake7-missing")).toBeVisible();
    await expect(card.locator(".form-error")).toBeVisible();
    await card.locator(".intake7-confirm").click();
    await expect(card.locator(".intake7-confirm")).toHaveAttribute("aria-pressed", "true");
    // Complete now: the note leaves.
    await expect(card.locator(".form-error")).toHaveCount(0);
    // A part added by hand: one quick choice.
    await card.locator('.bm-cell[data-cell="knee:left"]').click();
    const knee = card.locator('.intake7-card[data-region="knee:left"]');
    await expect(knee).toBeVisible();
    await expect(knee.locator("[data-problem]")).toHaveCount(5);
    await knee.locator('[data-problem="pain"]').click();
    await expect(knee.locator("fieldset")).toHaveCount(1);
    await view(page, ".intake7-map .bm", `${lang}-2-map-added`);
    await view(page, ".intake7-fill", `${lang}-2-parts`);
    await view(page, ".intake7-safety", `${lang}-2-safety`);
    await shot(page, `${lang}-2-body`);
    await cta(page).click();

    // Step 3: the goal and schedule, and the consent that covers the check.
    await expect(card.locator(".goal-grid")).toBeVisible();
    // The health answers, the movement and walk results (the video never leaves the phone), and the Live coach.
    await expect(card.locator(".consent .intake7-consent-line")).toHaveCount(3);
    await expect(card.locator(".consent")).toContainText(
      L("والفيديو لا يغادر هاتفي", "the video never leaves my phone"),
    );
    await expect(card.locator(".consent")).toContainText(L("«المدرّب المباشر»", "the Live coach"));
    await card.locator(".consent input").check();
    await shot(page, `${lang}-3-goal`);
    await expect(cta(page)).toContainText(L("التالي: قياس حركتك", "Next: your movement check"));
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/intake") && r.request().method() === "PUT"),
      cta(page).click(),
    ]);
    expect(saved.status()).toBe(200);
    const intake = (await saved.json()).intake;
    expect(intake.support).toBe("right");
    expect(intake.pain).toEqual(["knee"]);
    expect(intake.heightCm).toBe(172);
    expect(intake.diagnosisNotes).toBe("");
    expect(intake.medications).toBe("");
    expect(
      intake.regions.map((e: { region: string; side: string; problems: string[]; origin: string }) =>
        [e.region, e.side, e.problems.join("+"), e.origin].join(":"),
      ),
    ).toEqual([
      "shoulder:right:weakness:condition",
      "elbow:right:weakness:condition",
      "forearm_wrist:right:weakness:condition",
      "hip:right:weakness:condition",
      "knee:right:weakness:condition",
      "knee:left:pain:person",
      "ankle_foot:right:weakness:condition",
    ]);
    expect(intake.romFlags).toEqual({
      osteoporosis: false,
      neckCaution: false,
      sitUnsupported: "yes",
      footLift: { right: true },
    });
    await expect(page).toHaveURL(/[?&]focus=1/);

    // Editing the saved form asks nothing again: the side, the map and its confirmation are kept.
    await page.goto(url("/", lang));
    await page.locator(".page-heading .ghost").click();
    await expect(card.locator(".intake7-fill-ask button.selected")).toHaveCount(1);
    await cta(page).click();
    await expect(card.locator(".intake7-confirm")).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator('.bm-cell[aria-pressed="true"]')).toHaveCount(7);
    await cta(page).click();
    await expect(card.locator(".goal-grid")).toBeVisible();
  });
}

test("en: a part added by hand asks the surgery questions only after «after surgery»", async ({ page }) => {
  await newcomer(page, "en");
  await page.goto(url("/", "en"));
  const card = page.locator(".intake-card");
  await card.locator(".age-field input").fill("64");
  await card.locator(".intake7-who button").nth(1).click();
  await card.locator(".conditions-grid button", { hasText: "Arthritis" }).click();
  await card.locator('.intake-mobility button[data-value="seated"]').click();
  await fieldset(page, "Can you walk?").locator("button").nth(1).click();
  await fieldset(page, "Which aid do you use?").locator("button").first().click();
  await cta(page).click();
  await expect(card.locator("#intake7-map-title")).toHaveText(
    "Which of your joints does your medical condition affect?",
  );
  await expect(card.locator(".intake7-fill")).toHaveCount(0);
  await card.locator('.bm-cell[data-cell="knee:right"]').click();
  const knee = card.locator('.intake7-card[data-region="knee:right"]');
  await expect(knee.locator("legend")).toHaveText(["What is the problem in this part?"]);
  await knee.locator('[data-problem="after_surgery"]').click();
  await expect(knee).toContainText("When was the surgery?");
  await fieldset(page, "When was the surgery?").locator("button").first().click();
  await expect(knee).toContainText("allowed you to move this joint on your own");
  await view(page, '.intake7-card[data-region="knee:right"]', "en-2-surgery");
  // Taking the part off the map takes its card away.
  await knee.locator(".intake7-remove").click();
  await expect(card.locator(".intake7-card")).toHaveCount(0);
  await expect(card.locator(".intake7-none")).toBeVisible();
});
