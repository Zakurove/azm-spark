/**
 * The camera screen of the trial, the workouts and the booth (booth v2, contract A), walked with the
 * synthetic trace source of E2E builds (?e2eTrace=) in place of the camera:
 *   - Nasser's field test: arms resting down first, then limited reps; the set calibrates only from
 *     the start position, counts every rep after the 2 measuring reps, and ends on the effort
 *     question, with the elbow range in the summary;
 *   - D-038 item 3: no recorded voice clip in any exercise: the trial has no speaker button (no Live
 *     coach can run there) and loads or plays no clip;
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
  // no voice clip and no speaker button: no Live coach can run in the trial (D-038 item 3)
  await expect(page.locator(".cam2-sound")).toHaveCount(0);
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

test("no recorded voice clip is loaded or played in a whole set (D-038 item 3, en)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const w = window as unknown as { azmAudio: string[] };
    w.azmAudio = [];
    const Real = window.Audio;
    window.Audio = function (src?: string) {
      w.azmAudio.push(`new ${src ?? ""}`);
      return new Real(src);
    } as unknown as typeof Audio;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      w.azmAudio.push(`play ${this.currentSrc || this.src}`);
      return play.call(this);
    };
  });
  await openTrial(page, "en", "full");
  await expect(page.locator(".cam2-sound")).toHaveCount(0);
  await expect(page.locator(".cam2")).toHaveAttribute("data-count", /^[2-9]/, { timeout: 40_000 });
  await expect(page.locator("#rpe-title")).toBeVisible({ timeout: 40_000 });
  const audio = await page.evaluate(() => (window as unknown as { azmAudio: string[] }).azmAudio);
  expect(audio.filter((a) => /\.mp3|cues\//.test(a))).toEqual([]);
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
