/**
 * D-035 item 4, the range test page (/?romlab=<movement>&side=right|left, VITE_V7 builds, signed in or
 * not, never saving), on the v7 flow server (e2e/v7-flow.config.ts). The page's own list of movements,
 * then one movement on the simulated person of the focus check (&e2ePerson=1, VITE_E2E builds): D-038
 * item 1, no question at all: the hold shows «Hold there» and is recorded on its own a few seconds later,
 * and the page gives its verdict, its live diagnostics and the JSON block. Nothing is posted.
 * AZM_SHOTS_DIR=<dir>: the hold and the recorded result at 390 x 844, in Arabic and English.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROM_MOVEMENT_IDS } from "../src/movements/rom/types";

const SHOTS = process.env.AZM_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

test("the index lists every measured movement, with its sides as links", async ({ page }) => {
  await page.goto("/?romlab=1&lang=en");
  const items = page.locator(".rl-list li[data-movement]");
  await expect(items).toHaveCount(ROM_MOVEMENT_IDS.length);
  await expect(page.locator('.rl-list a[href*="romlab=elbow_flexion&side=right"]')).toHaveCount(1);
  await expect(page.locator('.rl-list a[href*="romlab=elbow_flexion&side=left"]')).toHaveCount(1);
});

for (const lang of ["en", "ar"] as const)
  test(`one movement with the real runner: no question, recorded at its hold, nothing is saved (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
    });
    await page.goto(`/?romlab=elbow_flexion&side=right&lang=${lang}&e2ePerson=1`);
    const start = page.locator('[data-action="ready"]:not([disabled])');
    await expect(start).toBeVisible({ timeout: 20_000 });
    await start.click();
    // Live diagnostics while it runs: the angle, the phase, the movement's own landmarks.
    await expect(page.locator('[data-diag="phase"]')).toContainText(/calibrating|practice|rest|attempt/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-diag="seen"]')).toContainText("R elbow seen");
    // D-036 item 4: the live meter moves with the person (drawn from requestAnimationFrame) and the
    // measuring screen shows no number of the angle and no degree sign.
    const meter = page.locator('.fx-measure .fx-meter[data-mode="live"]');
    await expect(meter).toHaveAttribute("data-state", /move|hold|done/, { timeout: 20_000 });
    const marker = meter.locator(".fx-meter-marker");
    const before = await marker.getAttribute("transform");
    await expect.poll(() => marker.getAttribute("transform"), { timeout: 10_000 }).not.toBe(before);
    expect(await meter.innerText()).not.toMatch(/[0-9٠-٩°]/);
    expect(await page.locator(".fx-measure").innerText()).not.toContain("°");
    // D-038 item 1: the hold in hand shows «Hold there», with no question and no answer buttons.
    const holding = page.locator(".fx-measure[data-holding]");
    await expect(holding).toBeVisible({ timeout: 40_000 });
    await expect(holding.locator(".fx-prompt-main")).toHaveText(lang === "ar" ? "اثبت هنا" : "Hold there");
    await expect(page.locator(".fx-measure [data-question], .fx-measure .safety-zone")).toHaveCount(0);
    await shot(page, `${lang}-rom-holding`);
    await expect(page.locator('[data-verdict="measured"]')).toBeVisible({ timeout: 60_000 });
    if (lang === "en") await expect(page.locator(".rl-verdict-line")).toHaveText(/^Measured: \d+°$/);
    await shot(page, `${lang}-rom-recorded`);
    const json = JSON.parse((await page.locator('[data-diag="json"]').textContent()) ?? "{}");
    expect(json).toMatchObject({
      mv: "elbow_flexion",
      status: "measured",
      nValid: 1,
      engine: "rom_engine_5",
    });
    // Recorded with no answer at all.
    expect(json.tries.at(-1)).toContain("valid");
    expect(JSON.stringify(json.tries)).not.toMatch(/yes|timeout|not_yet|hurts/);
    await expect(page.locator('[data-diag="attempts"]')).toContainText("attempt 1: valid");
    expect(posts).toEqual([]);
  });
