/**
 * D-035 item 4, the range test page (/?romlab=<movement>&side=right|left, VITE_V7 builds, signed in or
 * not, never saving), on the v7 flow server (e2e/v7-flow.config.ts). The page's own list of movements,
 * then one movement on the simulated person of the focus check (&e2ePerson=1, VITE_E2E builds): nobody
 * answers the maximum question, the silence counts as yes (D-035 item 1), and the page gives its verdict,
 * its live diagnostics and the JSON block. Nothing is posted.
 */
import { expect, test } from "@playwright/test";
import { ROM_MOVEMENT_IDS } from "../src/movements/rom/types";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

test("the index lists every measured movement, with its sides as links", async ({ page }) => {
  await page.goto("/?romlab=1&lang=en");
  const items = page.locator(".rl-list li[data-movement]");
  await expect(items).toHaveCount(ROM_MOVEMENT_IDS.length);
  await expect(page.locator('.rl-list a[href*="romlab=elbow_flexion&side=right"]')).toHaveCount(1);
  await expect(page.locator('.rl-list a[href*="romlab=elbow_flexion&side=left"]')).toHaveCount(1);
});

test("one movement with the real runner: nobody answers, it is measured, nothing is saved", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
  });
  await page.goto("/?romlab=elbow_flexion&side=right&lang=en&e2ePerson=1");
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
  await expect(page.locator('[data-verdict="measured"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".rl-verdict-line")).toHaveText(/^Measured: \d+°$/);
  const json = JSON.parse((await page.locator('[data-diag="json"]').textContent()) ?? "{}");
  expect(json).toMatchObject({ mv: "elbow_flexion", status: "measured", nValid: 1, engine: "rom_engine_4" });
  expect(json.tries.at(-1)).toEqual(expect.arrayContaining(["valid", "yes/timeout"]));
  await expect(page.locator('[data-diag="attempts"]')).toContainText("attempt 1: valid");
  expect(posts).toEqual([]);
});
