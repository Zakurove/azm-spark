/**
 * D-035 item 4 in the real app (VITE_V7=1 with VITE_E2E=1, e2e/v7-flow.config.ts): the walk lab,
 * /?gaitlab=side|front, runs the walk's capture alone on a recorded walk at home (the gait fixtures
 * home-side and home-wall: every turn inside the picture, the phone on a shelf or against a wall), with
 * no one signed in, shows its live diagnostics, ends with the verdict line and the JSON block, and
 * sends nothing to the server. Skipped under the default config, whose build has no lab.
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

interface LabState {
  status: "running" | "done";
  result: {
    level: "full" | "timing" | "none";
    verdict: string;
    cadence: number | null;
    cleanCycles: { left: number; right: number };
    diagnostics: { rec: string; passes: number }[];
  } | null;
}

async function runLab(page: Page, view: "side" | "front", fixture: string, lang: "ar" | "en") {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(`/?gaitlab=${view}&fixture=${fixture}&auto=1&lang=${lang}`);
  await expect(page.locator(".gx-lab")).toBeVisible();
  // The live panel while the recorded walk plays.
  await expect(page.locator('[data-live="passes"]')).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __azmGaitLab?: LabState }).__azmGaitLab?.status === "done",
    undefined,
    { timeout: 90_000, polling: 500 },
  );
  const state = await page.evaluate(() => (window as unknown as { __azmGaitLab: LabState }).__azmGaitLab);
  await expect(page.locator(".gx-lab-verdict")).toBeVisible();
  await expect(page.locator('[data-result="json"]')).toContainText('"level"');
  expect(posts).toEqual([]);
  return state.result!;
}

test("the side view at home: across the picture and back, turning in it, gives the cadence (English)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const r = await runLab(page, "side", "gait/home-side", "en");
  expect(r.level).not.toBe("none");
  // The catalog walk: 108 steps a minute.
  expect(Math.abs(r.cadence! / 108 - 1)).toBeLessThan(0.05);
  expect(r.cleanCycles.left).toBeGreaterThanOrEqual(3);
  expect(r.cleanCycles.right).toBeGreaterThanOrEqual(3);
  expect(r.verdict).toMatch(/^Cadence \d+ steps a minute, right step [\d.]+ s, left [\d.]+ s, /);
  expect(r.diagnostics[0].passes).toBeGreaterThanOrEqual(4);
});

test("the front view at home: toward a phone against a wall, turning before it (Arabic)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const r = await runLab(page, "front", "gait/home-wall", "ar");
  expect(r.level).not.toBe("none");
  expect(Math.abs(r.cadence! / 108 - 1)).toBeLessThan(0.05);
  // Toward and away passes, counted by the change of direction (nobody left the picture).
  expect(r.diagnostics[0].passes).toBeGreaterThanOrEqual(6);
  await expect(page.locator(".gx-lab-verdict")).toContainText("الإيقاع");
});
