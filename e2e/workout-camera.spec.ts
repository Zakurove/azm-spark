/**
 * The camera screen of the trial, the workouts and the booth (booth v2, contract A), walked with the
 * synthetic trace source of E2E builds (?e2eTrace=) in place of the camera:
 *   - Nasser's field test: arms resting down first, then limited reps; the set calibrates only from
 *     the start position, counts every rep after the 2 measuring reps, and ends on the effort
 *     question, with the elbow range in the summary;
 *   - the voice is off by default and the large speaker button is remembered on the device;
 *   - nobody in the picture: the calm outline and its line; Stop goes back.
 */
import { expect, test, type Page } from "@playwright/test";
import { sessionCopy } from "../src/app/session-copy";

type Lang = "ar" | "en";
const url = (path: string, lang: Lang) => (lang === "en" ? `${path}&lang=en` : path);

/** Opens the trial at the camera screen, from your wheelchair, with a trace in place of the camera. */
export async function openTrial(page: Page, lang: Lang, trace: string) {
  await page.goto(url(`/?try=1&e2eTrace=${trace}`, lang));
  await page.locator(".try-pose").nth(1).click();
  await page.locator(".try-actions .cta").click();
  await page.locator(".try-start").click();
  await expect(page.locator(".cam2")).toBeVisible();
}

const stage = (page: Page) => page.locator(".cam2").getAttribute("data-stage");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
});

test("Nasser's case: resting arms are never the range, and the limited reps count (ar)", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTrial(page, "ar", "nasser");
  const s = sessionCopy("ar");
  // the voice is off by default
  await expect(page.locator(".cam2-sound")).toHaveAttribute("aria-pressed", "false");
  // arms resting down: the start position is asked for, the calibration has not started
  await expect(page.locator(".cam2")).toHaveAttribute("data-stage", "start", { timeout: 10_000 });
  await expect(page.locator(".cam2-start h2")).toHaveText(s.startTitle);
  await page.waitForTimeout(1500);
  expect(await stage(page)).toBe("start");
  // the hands come up to the shoulders: measuring, then the set
  await expect(page.locator(".cam2")).toHaveAttribute("data-stage", "calibrating", { timeout: 15_000 });
  await expect(page.locator(".cam2-measure-text h2")).toHaveText(s.measureTitle);
  await expect(page.locator(".cam2")).toHaveAttribute("data-stage", "training", { timeout: 20_000 });
  await expect(page.locator(".cam2-caption")).toHaveText(s.messages.range_ready);
  await expect(page.locator(".cam2-top-mark")).toBeVisible();
  // every limited rep counts: the trial's 6, then the effort question
  await expect(page.locator(".cam2")).toHaveAttribute("data-count", "3", { timeout: 20_000 });
  await expect(page.locator("#rpe-title")).toBeVisible({ timeout: 30_000 });
  await page.locator(".rpe-btn").nth(3).click();
  await page.locator(".modal-actions .cta").click();
  await expect(page.locator("#sum-title")).toBeVisible();
  await expect(page.locator(".sum-grid")).toContainText(s.rangeMeasure);
  await expect(page.locator(".sum-grid > div").first().locator("b")).toHaveText("6");
  expect(errors).toEqual([]);
});

test("the speaker button turns the voice on and is remembered on this device (en)", async ({ page }) => {
  await openTrial(page, "en", "full");
  const sound = page.locator(".cam2-sound");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect(sound).toHaveAttribute("aria-label", sessionCopy("en").soundOff);
  const box = await sound.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(56);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound).toHaveClass(/\bon\b/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("azm.coach") ?? "{}"));
  expect(stored.voice).toBe("full");
  await openTrial(page, "en", "full");
  await expect(page.locator(".cam2-sound")).toHaveAttribute("aria-pressed", "true");
});

test("nobody in the picture: the calm outline and one line; Stop goes back (en)", async ({ page }) => {
  await openTrial(page, "en", "nobody");
  await expect(page.locator(".cam2")).toHaveAttribute("data-stage", "framing", { timeout: 10_000 });
  await expect(page.locator(".cam2-outline")).toBeVisible();
  await expect(page.locator(".cam2-instruct h2")).toHaveText(sessionCopy("en").framingTitle);
  await page.waitForTimeout(2500);
  // nothing flips while nobody is there: no caption at all
  await expect(page.locator(".cam2-caption")).toHaveCount(0);
  await page.locator(".cam2-stop .safety-stop").click();
  await expect(page.locator(".try-shell")).toBeVisible();
});
