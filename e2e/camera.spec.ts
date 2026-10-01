/**
 * S34, the camera sequence of one test, in the browser (contract v3 K and L): the real screen,
 * controller, engine runners and flow, fed by fixture poses. Each test kind runs a whole side in both
 * phone shapes (9:16 on a phone, 16:9 on a desktop), in Arabic and English, then the setup check,
 * STOP, the retry and the rests are driven through their own controls.
 *
 *   ?e2eFixture=<kind>-<9x16|16x9>       the camera scripts of camera/e2e/fixtures.ts, presets of the
 *                                        foundation fixture source (a person who sits still, then
 *                                        moves, in a loop)
 *   ?e2eFixture=empty | seated-still     the foundation fixture source's own presets
 *   ?e2eCamFast=1                        short rests between attempts (E2E builds only)
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openCamera, reach, statesSeen, watchStates, type CamTestId, type Lang } from "./camera-fixtures";

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function newPage(browser: Browser, shape: "9x16" | "16x9"): Promise<Page> {
  const context = await browser.newContext(shape === "9x16" ? PHONE : DESKTOP);
  const page = await context.newPage();
  await watchStates(page);
  return page;
}

/** The kinds of the camera sequence in the order they must appear. */
function expectInOrder(seen: string[], kinds: string[]) {
  let at = -1;
  for (const k of kinds) {
    const next = seen.indexOf(k, at + 1);
    expect(
      next,
      `${k} after ${kinds.slice(0, kinds.indexOf(k)).join(", ")} in ${seen.join(" > ")}`,
    ).toBeGreaterThan(at);
    at = next;
  }
}

/** side: the protocol side index the fixture moves (the scripts raise, bend and lean the right side). */
type Run = {
  testId: CamTestId;
  fixture: string;
  end: string;
  position?: string;
  timed: boolean;
  side: number;
};
const RUNS: Run[] = [
  { testId: "shoulder_abduction", fixture: "abd", end: "between", timed: false, side: 1 },
  { testId: "arm_curl_30s", fixture: "curl", end: "between", timed: true, side: 1 },
  { testId: "trunk_control_seated", fixture: "lean", end: "after.contact", timed: false, side: 1 },
  { testId: "chair_stand_30s", fixture: "stand", end: "between", timed: true, position: "standing", side: 0 },
];

for (const run of RUNS) {
  for (const [shape, lang] of [
    ["9x16", run.testId === "shoulder_abduction" || run.testId === "arm_curl_30s" ? "ar" : "en"],
    ["16x9", run.testId === "shoulder_abduction" || run.testId === "arm_curl_30s" ? "en" : "ar"],
  ] as const) {
    test(`${run.testId}: a whole side with fixture poses, ${shape}, ${lang}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const page = await newPage(browser, shape);
      await openCamera(page, lang as Lang, run.testId, `e2eFixture=${run.fixture}-${shape}&e2eCamFast=1`, {
        side: run.side,
        ...(run.position ? { position: run.position } : {}),
      });
      // STOP is always there, 72 px, and first in the focus order (principle 6).
      const stop = page.locator(".s34-stop");
      await expect(stop).toBeFocused();
      expect((await stop.boundingBox())!.height).toBeGreaterThanOrEqual(72);

      await reach(page, "cam.measure", 90_000);
      if (run.testId === "shoulder_abduction") {
        // The attempt dots read from 2 m, with no counter text beside them (C29); no live degrees (O3)
        // and never the value of an attempt.
        await expect(page.locator(".s34-range .s34-dots")).toBeVisible();
        await expect(page.locator(".s34-try")).toHaveCount(0);
        await expect(page.locator(".s34-degrees")).toHaveCount(0);
      }
      if (run.testId === "trunk_control_seated") {
        // Direction and phase only: no number and no magnitude (spec 4.3, O4).
        await expect(page.locator(".s34-lean-panel")).toBeVisible();
        await expect(page.locator(".s34-degrees, .s34-count")).toHaveCount(0);
      }
      if (run.timed) {
        // The big count and the time left; counts are shown, never spoken (D-009).
        await expect(page.locator(".s34-count")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".s34-timed .s34-line40")).toBeVisible();
      }
      await reach(page, run.end, 150_000);
      if (run.end === "between") {
        // C14: leaving the camera clears its caption; no movement cue stays over the pain question.
        await expect(page.locator('[data-screen="S47"]')).toBeVisible();
        await page.waitForTimeout(2500);
        await expect(page.locator(".check-caption")).toHaveCount(0);
      }
      const seen = await statesSeen(page);
      const kinds = run.timed
        ? ["cam.setup", "cam.calibrate", "cam.practice", "cam.countdown", "cam.measure", "cam.saved"]
        : [
            "cam.setup",
            "cam.calibrate",
            "cam.practice",
            "cam.measure",
            "cam.saved",
            "cam.measure",
            "cam.saved",
          ];
      expectInOrder(seen, [...kinds, run.end]);
      await page.context().close();
    });
  }
}

test("setup check with nobody in the picture: one line and the offers at the phone (Arabic)", async ({
  browser,
}) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "ar", "shoulder_abduction", "e2eFixture=empty&e2eCamFast=1");
  await expect(page.locator(".s34-band.is-none")).toContainText("لا نراك بعد", { timeout: 15_000 });
  // C28: one line, the first fix; the checks that pass are not listed.
  await expect(page.locator(".s34-chip")).toHaveCount(0);
  // After a long wait: the setup tips, then skipping (the fast E2E timing: 4 s and 6 s).
  await page.getByRole("button", { name: "اعرض نصائح التجهيز" }).click();
  await expect(page.getByRole("dialog", { name: "نصائح التجهيز" })).toBeVisible();
  // The sheet opens at its top on a small phone too: the title is in view, never above the screen.
  for (const height of [812, 667]) {
    await page.setViewportSize({ width: 375, height });
    const title = (await page.getByRole("heading", { name: "نصائح التجهيز" }).boundingBox())!;
    expect(title.y, `title at ${height} px`).toBeGreaterThanOrEqual(0);
  }
  await page.getByRole("button", { name: "ارجع" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "تخطَّ هذا الاختبار" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.setup");
  await page.context().close();
});

test("a second person in the middle keeps the test from starting (English)", async ({ browser }) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "en", "shoulder_abduction", "e2eFixture=crowd-9x16&e2eCamFast=1");
  await expect(page.locator(".s34-band")).toContainText("Someone else in the middle", { timeout: 15_000 });
  // C29: one line on screen; the full sentence is said and is the caption's name.
  await expect(page.locator(".s34-caption")).toHaveAttribute(
    "aria-label",
    /Make sure no one stands between you and the phone/,
  );
  await page.waitForTimeout(4000);
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.setup");
  await page.context().close();
});

test("STOP opens the stop list over the stage during a test (Arabic)", async ({ browser }) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "ar", "shoulder_abduction", "e2eFixture=abd-9x16&e2eCamFast=1");
  await reach(page, "cam.practice", 60_000);
  await page.locator(".s34-stop").click();
  await expect(page.locator(".check-overlay[data-overlay='S41']")).toBeVisible();
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.practice");
  await page.context().close();
});

test("retry: the reason and the countdown, then the setup check on its own (English)", async ({
  browser,
}) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "en", "shoulder_abduction", "e2eFixture=seated-still&e2eCamFast=1", {
    state: { kind: "cam.retry", i: 0, side: 0, issue: "plane_flexion", exhausted: false },
    run: { calibrated: true, practiced: true, saved: 1, retriesUsed: 1 },
  });
  await expect(page.locator(".s34-retry")).toContainText("Raise it out to the side");
  // C30: no tries left line and no Try now; the countdown starts the next try.
  await expect(page.locator(".s34-retry")).not.toContainText("Two more tries");
  await expect(page.getByRole("button", { name: "Try now" })).toHaveCount(0);
  await reach(page, "cam.setup", 10_000);
  await page.context().close();
});

test("retry: Skip this test opens the skip dialog, and the restart waits for it (Arabic)", async ({
  browser,
}) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "ar", "trunk_control_seated", "e2eFixture=seated-still&e2eCamFast=1", {
    state: { kind: "cam.retry", i: 2, side: 0, issue: "touched", exhausted: false },
    run: { calibrated: true, practiced: true, saved: 1, retriesUsed: 2 },
  });
  await expect(page.locator(".s34-retry")).toContainText("لمسك شخص آخر أثناء المحاولة");
  await page.getByRole("button", { name: "تخطَّ هذا الاختبار" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(7000);
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.retry");
  await page.context().close();
});

test("the rest between the arms counts down, names the next arm, then sets up again (English)", async ({
  browser,
}) => {
  const page = await newPage(browser, "9x16");
  await openCamera(page, "en", "shoulder_abduction", "e2eFixture=seated-still&e2eCamFast=1", {
    state: { kind: "cam.rest", i: 0, side: 1, purpose: "sideChange" },
    run: { calibrated: true },
  });
  await expect(page.locator(".s34-rest")).toContainText("Rest");
  await expect(page.locator(".s34-rest")).toContainText("After the rest: Your right arm");
  await reach(page, "cam.setup", 6_000);
  await page.context().close();
});

test("a phone held sideways shows turn the phone upright and pauses (Arabic)", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 812, height: 375 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await openCamera(page, "ar", "shoulder_abduction", "e2eFixture=abd-9x16&e2eCamFast=1");
  await expect(page.locator(".s34-upright")).toContainText("أدر الهاتف ليكون واقفًا", { timeout: 15_000 });
  await page.waitForTimeout(3000);
  await expect(page.locator(".check-base")).toHaveAttribute("data-state", "cam.setup");
  await context.close();
});
