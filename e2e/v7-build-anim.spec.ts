/**
 * The program build animation (D-032 item 4, slowed by D-037 item 5) at /?programBuild=preview on a
 * VITE_V7=1 build, where the preview plays it alone and counts its onDone calls in data-done
 * (src/app/App.tsx):
 *
 *   npx playwright test -c e2e/v7-build-anim.config.ts
 *
 * The five beats come in order, each caption in the polite live region with its quieter line, and
 * «برنامجك جاهز» with Continue comes at about eleven seconds; Continue and Skip call onDone; English
 * reads left to right and, without a walk, the medical history beat takes the walk's place; a late
 * program (&late=) holds it at the check with «نضع اللمسات الأخيرة» until it is ready; reduced motion
 * is a still of the final week whose list is ticked in a couple of seconds; focus stays visible and
 * moves from Skip to Continue; axe finds no WCAG violation. Playwright's clock drives the animation's
 * frames, so every moment is exact.
 *
 *   AZM_SHOTS_DIR=<dir>        also the review screenshots: 390 x 844 and 1440 x 900, Arabic and
 *                              English, each beat and the end, the still and the beat without a walk
 *   AZM_SHOTS_VIDEO=1          and the videos: a Playwright screen recording (webm) and, when ffmpeg is
 *                              on the PATH, a smooth mp4 rendered frame by frame at 30 fps
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skip(
  !process.env.AZM_BUILD_ANIM_E2E,
  "runs on a VITE_V7=1 build: npx playwright test -c e2e/v7-build-anim.config.ts",
);

const SHOTS = process.env.AZM_SHOTS_DIR;
const VIDEO = !!SHOTS && process.env.AZM_SHOTS_VIDEO === "1";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const AR = {
  beats: ["نقرأ حالتك الطبية", "نحلل مدى حركتك", "نقرأ طريقة مشيك", "نختار تمارينك", "نرتّب أسبوعك"],
  details: [
    "حالتك، ومناطق جسمك، وهدفك",
    "3 مفاصل قسناها بالكاميرا",
    "خطواتك وإيقاع مشيك",
    "لكل تمرين سبب واضح",
    "أيام التمرين وأيام الراحة",
  ],
  finishing: "نضع اللمسات الأخيرة",
  ready: "برنامجك جاهز",
  skip: "تخطَّ",
  continue: "تابع",
};
const EN_NO_WALK = [
  "Reading your medical history",
  "Analysing your range of motion",
  "Building on your medical history",
  "Choosing your exercises",
  "Setting your week",
];

/** Opens the preview with the animation's clock held: it moves only by `advance`. */
async function open(page: Page, query = "") {
  await page.clock.install({ time: new Date("2026-10-07T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-07T10:00:01Z"));
  await page.goto(`/?programBuild=preview${query}`);
  // The lazy chunk arrives over the network; the held clock only stops the frames.
  for (let i = 0; i < 200 && !(await page.locator(".pb").count()); i++) await page.clock.runFor(50);
  await expect(page.locator(".pb")).toBeVisible();
}
/** Moves the animation on by `ms` and lets React draw the frame. */
async function advance(page: Page, ms: number) {
  if (ms > 0) await page.clock.runFor(ms);
  await page.waitForTimeout(60);
}
const caption = (page: Page) => page.getByRole("status");
const done = (page: Page) => page.locator("[data-done]");

/** Every caption the live region shows until the program is ready, and when that was. */
async function captions(
  page: Page,
  ready: string,
): Promise<{ seen: string[]; details: string[]; readyAt: number }> {
  const seen: string[] = [];
  const details: string[] = [];
  for (let t = 0; t <= 20_000; t += 100) {
    const text = ((await caption(page).textContent()) ?? "").trim();
    if (seen.at(-1) !== text) seen.push(text);
    const detail = ((await page.locator(".pb-detail").textContent()) ?? "").trim();
    if (detail && details.at(-1) !== detail) details.push(detail);
    if (text === ready) return { seen, details, readyAt: t };
    await advance(page, 100);
  }
  return { seen, details, readyAt: -1 };
}

async function audit(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  const r = await new AxeBuilder({ page }).withTags(TAGS).include(".pb").analyze();
  return r.violations.map(
    (v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

test("plays the five beats in order, then «برنامجك جاهز» with Continue, which calls onDone", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page);
  await expect(page.locator(".pb")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: AR.skip })).toBeVisible();
  const { seen, details, readyAt } = await captions(page, AR.ready);
  expect(seen).toEqual([...AR.beats, AR.ready]);
  expect(details).toEqual(AR.details);
  // About eleven seconds (D-037 item 5).
  expect(readyAt).toBeGreaterThanOrEqual(10_500);
  expect(readyAt).toBeLessThanOrEqual(11_600);
  await expect(caption(page)).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("button", { name: AR.skip })).toHaveCount(0);
  const cont = page.getByRole("button", { name: AR.continue });
  await expect(cont).toBeVisible();
  expect((await cont.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  // The default summary: six cards in the week.
  await advance(page, 1700);
  await expect(page.locator(".pb-card")).toHaveCount(6);
  await expect(done(page)).toHaveAttribute("data-done", "0");
  await cont.click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("Skip ends it at once, from the start", async ({ page }) => {
  await open(page);
  const skip = page.getByRole("button", { name: AR.skip });
  expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await skip.click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("speaks English left to right and, without a walk, reads the medical history again", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, "&lang=en&walk=0&joints=2&exercises=4");
  await expect(page.locator(".pb")).toHaveAttribute("dir", "ltr");
  const { seen, details, readyAt } = await captions(page, "Your program is ready");
  expect(seen).toEqual([...EN_NO_WALK, "Your program is ready"]);
  expect(details[1]).toBe("2 joints measured with the camera");
  expect(readyAt).toBeGreaterThanOrEqual(10_000);
  expect(readyAt).toBeLessThanOrEqual(10_800);
  await advance(page, 1700);
  await expect(page.locator(".pb-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("a late program holds it at the check, «نضع اللمسات الأخيرة», until the program is ready", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, "&late=15000");
  const { seen, readyAt } = await captions(page, AR.ready);
  expect(seen).toEqual([...AR.beats, AR.finishing, AR.ready]);
  // It waited for the program (ready about 15 s after the page opened), well past its own end.
  expect(readyAt).toBeGreaterThanOrEqual(13_000);
  await expect(page.getByRole("button", { name: AR.continue })).toBeVisible();
  await expect(page.locator(".pb-card")).toHaveCount(6);
  await page.getByRole("button", { name: AR.continue }).click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("Skip still leaves while it waits for a late program", async ({ page }) => {
  await open(page, "&late=60000");
  await advance(page, 12_500);
  await expect(page.locator('.pb[data-beat="waiting"]')).toBeVisible();
  await expect(caption(page)).toHaveText(AR.finishing);
  await expect(page.getByRole("button", { name: AR.continue })).toHaveCount(0);
  // The rings keep turning and a soft ring goes out of the core.
  const before = await page
    .locator(".pb-ring")
    .first()
    .evaluate((el) => el.parentElement!.getAttribute("transform"));
  await advance(page, 500);
  const after = await page
    .locator(".pb-ring")
    .first()
    .evaluate((el) => el.parentElement!.getAttribute("transform"));
  expect(after).not.toBe(before);
  await expect(page.locator(".pb-wait")).toHaveCount(1);
  await page.getByRole("button", { name: AR.skip }).click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("with reduced motion it is a calm still of the final week, its list ticked, then Continue", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?programBuild=preview");
  await expect(page.locator(".pb.is-still")).toBeVisible();
  for (const words of AR.beats) await expect(page.locator(".pb-list")).toContainText(words);
  // Shorter: ready in about two and a half seconds.
  await expect(caption(page)).toHaveText(AR.ready, { timeout: 4000 });
  await expect(page.getByRole("button", { name: AR.skip })).toHaveCount(0);
  await expect(page.locator(".pb-card")).toHaveCount(6);
  // Nothing moves.
  const before = await page.locator(".pb-scene").innerHTML();
  await page.waitForTimeout(600);
  expect(await page.locator(".pb-scene").innerHTML()).toBe(before);
  await page.getByRole("button", { name: AR.continue }).click();
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("keeps the focus visible and moves it from Skip to Continue when the program is ready", async ({
  page,
}) => {
  await page.goto("/?programBuild=preview");
  await expect(page.locator(".pb")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("button", { name: AR.skip });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  const cont = page.getByRole("button", { name: AR.continue });
  await expect(cont).toBeFocused({ timeout: 20_000 });
  expect(await cont.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(done(page)).toHaveAttribute("data-done", "1");
});

test("has no accessibility violations as it plays, when ready, and as the still", async ({ page }) => {
  await page.goto("/?programBuild=preview");
  await expect(page.locator(".pb")).toBeVisible();
  await page.waitForTimeout(700);
  expect(await audit(page)).toEqual([]);
  await expect(page.getByRole("button", { name: AR.continue })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  expect(await audit(page)).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?programBuild=preview&lang=en");
  await expect(page.locator(".pb.is-still")).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

/* ------------------------------------------------------------- review screenshots and videos */

const VIEWS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
} as const;
/** Each beat at its most telling moment, then the end (ms from the start, the default summary). */
const MOMENTS: [string, number][] = [
  ["1-history", 1500],
  ["2-camera", 3900],
  ["3-walk", 5900],
  ["4-choose-flow", 7500],
  ["4-choose-cards", 8700],
  ["5-week", 9900],
  ["6-ready", 12_800],
];

for (const [view, options] of Object.entries(VIEWS))
  test.describe(`screenshots, ${view}`, () => {
    test.skip(!SHOTS, "set AZM_SHOTS_DIR to write the review screenshots");
    test.use(options);
    for (const lang of ["ar", "en"] as const) {
      const q = lang === "en" ? "&lang=en" : "";
      test(`${lang}: each beat and the end`, async ({ page }) => {
        mkdirSync(SHOTS!, { recursive: true });
        await open(page, q);
        let now = 0;
        for (const [name, at] of MOMENTS) {
          await advance(page, at - now);
          now = at;
          await page.screenshot({
            path: join(SHOTS!, `${lang}-${view}-${name}.png`),
            animations: "disabled",
          });
        }
      });
      test(`${lang}: without a walk, and the still`, async ({ page }) => {
        mkdirSync(SHOTS!, { recursive: true });
        await open(page, `${q}&walk=0&joints=2&exercises=9`);
        await advance(page, 5300);
        await page.screenshot({
          path: join(SHOTS!, `${lang}-${view}-3-no-walk.png`),
          animations: "disabled",
        });
        await advance(page, 6800);
        await page.screenshot({
          path: join(SHOTS!, `${lang}-${view}-5-ready-nine.png`),
          animations: "disabled",
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/?programBuild=preview${q}`);
        await expect(page.locator(".pb.is-still")).toBeVisible();
        await page.screenshot({ path: join(SHOTS!, `${lang}-${view}-6-still.png`), animations: "disabled" });
        // The page's clock is still held (open above): the still's list moves only by advance.
        await advance(page, 3000);
        await expect(page.locator(".pb-continue")).toBeVisible();
        await page.screenshot({
          path: join(SHOTS!, `${lang}-${view}-6-still-ready.png`),
          animations: "disabled",
        });
      });
      test(`${lang}: waiting for a late program`, async ({ page }) => {
        mkdirSync(SHOTS!, { recursive: true });
        await open(page, `${q}&late=60000`);
        await advance(page, 12_800);
        await page.screenshot({
          path: join(SHOTS!, `${lang}-${view}-7-waiting.png`),
          animations: "disabled",
        });
      });
    }
  });

test.describe("videos", () => {
  test.skip(!VIDEO, "set AZM_SHOTS_DIR and AZM_SHOTS_VIDEO=1 to record the videos");
  for (const [lang, view] of [
    ["ar", "phone"],
    ["en", "desktop"],
  ] as const) {
    const q = lang === "en" ? "&lang=en" : "";
    const { viewport, deviceScaleFactor } = VIEWS[view];
    test(`${lang} ${view}: a screen recording`, async ({ browser }) => {
      const dir = mkdtempSync(join(tmpdir(), "azm-build-anim-video-"));
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor,
        // The screencast's frames are in CSS pixels: a larger size would only pad them.
        recordVideo: { dir, size: viewport },
      });
      const page = await context.newPage();
      await page.goto(`/?programBuild=preview${q}`);
      await expect(page.locator(".pb-continue")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      await page.close();
      await page.video()!.saveAs(join(SHOTS!, `build-animation-${lang}-${view}.webm`));
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    });
    test(`${lang} ${view}: a smooth mp4, frame by frame`, async ({ browser }) => {
      test.skip(spawnSync("ffmpeg", ["-version"]).status !== 0, "needs ffmpeg on the PATH");
      const dir = mkdtempSync(join(tmpdir(), "azm-build-anim-frames-"));
      const context = await browser.newContext({ viewport, deviceScaleFactor });
      const page = await context.newPage();
      await open(page, q);
      const fps = 30;
      for (let i = 0; i < fps * 13.5; i++) {
        await page.screenshot({
          path: join(dir, `${String(i).padStart(4, "0")}.png`),
          animations: "disabled",
        });
        await advance(page, 1000 / fps);
      }
      await context.close();
      const out = join(SHOTS!, `build-animation-${lang}-${view}.mp4`);
      const r = spawnSync(
        "ffmpeg",
        [
          ...["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(dir, "%04d.png")],
          ...["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
          ...["-crf", "18", "-movflags", "+faststart", out],
        ],
        { encoding: "utf8" },
      );
      rmSync(dir, { recursive: true, force: true });
      expect(r.status, r.stderr).toBe(0);
    });
  }
});
