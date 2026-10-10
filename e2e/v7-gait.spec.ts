/**
 * D-035 items 2 and 4 in the real app (VITE_V7=1 with VITE_E2E=1, e2e/v7-flow.config.ts):
 *   - the walk in the check at home: a person who walks, with nothing else the camera measures, does
 *     the walk only; the side view comes first (its placement says a shelf or a wall, side on about
 *     3 m away, and its picture's caption), the recorded walk across the picture and back turns
 *     inside it (gait fixture home-side), the front view is offered after it and can be left out, and
 *     the result card shows the steps a minute and each side's step time for timing only, saved;
 *   - the walk lab, /?gaitlab=side|front, runs the walk's capture alone on a recorded walk at home
 *     (home-side and home-wall: every turn inside the picture), with no one signed in, shows its live
 *     diagnostics, ends with the verdict line and the JSON block, and sends nothing to the server.
 * AZM_GAIT_SHOTS=<dir> keeps a screenshot of each walk screen. Skipped under the default config.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const SHOTS = process.env.AZM_GAIT_SHOTS ?? null;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** A person who walks without an aid, whose only body map part (the wrist) the camera does not measure. */
const walkOnly = {
  age: 58,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "none",
  pain: ["wrist"],
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
  sex: "male",
  heightCm: 175,
  walking: { status: "without_aid" },
  romFlags: { osteoporosis: false, neckCaution: false },
  regions: [{ region: "forearm_wrist", side: "right", problems: ["pain"], origin: "person" }],
};

async function newcomer(page: Page, lang: "ar" | "en"): Promise<void> {
  await page.goto(`/?e2eGallery=loading${lang === "en" ? "&lang=en" : ""}`);
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Fahd",
      email: `v7-gait-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const saved = await page.request.put("/api/intake", { headers, data: walkOnly });
  expect(saved.status()).toBe(200);
}

/** The walk's step now (the gait screen's root), or null outside the walk. */
const walkStep = (page: Page) =>
  page.evaluate(() => document.querySelector(".gx-root")?.getAttribute("data-step") ?? null);

for (const lang of ["en", "ar"] as const)
  test(`the walk in the check at home: the side view first, the front offered, a timing only result (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await newcomer(page, lang);
    await page.addInitScript(() => {
      (window as unknown as { azmGaitFixture?: string }).azmGaitFixture = "gait/home-side";
    });
    await page.goto(`/?focus=1&e2ePerson=1&e2eFast=1&e2eGait=1${lang === "en" ? "&lang=en" : ""}`);
    await page.locator('[data-screen="intro"] [data-action="start"]').click();
    // The walk is the check's only part: its own screens follow.
    await expect(page.locator(".gx-root")).toBeVisible({ timeout: 30_000 });
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/gait")) posts.push(r.url());
    });
    const t0 = Date.now();
    const seen = new Set<string>();
    while (Date.now() - t0 < 150_000) {
      const step = await walkStep(page);
      if (!step) break;
      if (!seen.has(step)) {
        seen.add(step);
        await shot(page, `${lang}-walk-${String(seen.size).padStart(2, "0")}-${step}`);
      }
      if (step === "intro") await page.locator('.gx-root [data-action="start"]').click();
      else if (step === "gear") {
        await page.locator('[data-field="shoes"] [data-value="yes"]').click();
        await page.locator('[data-field="brace"] [data-value="none"]').click();
        await page.locator('.gx-root [data-action="next"]').click();
      } else if (step === "clear_path") await page.locator('.gx-root [data-action="ready"]').click();
      else if (step === "place") {
        // The side view first, with the home setup in plain words and the picture's caption.
        await expect(page.locator('.gx-root[data-rec="overground_side"]')).toBeVisible();
        await expect(page.locator('[data-caption="overground_side"]')).toBeVisible();
        if (lang === "en")
          await expect(page.locator(".gx-root")).toContainText("against a wall or on a shelf");
        await page.locator('.gx-root [data-action="ready"]').click();
      } else if (step === "front_offer") {
        // Offered after the side view, and optional.
        expect(seen.has("walk")).toBe(true);
        await page.locator('.gx-root [data-action="finish_walk"]').click();
      } else if (step === "stance_place") {
        // The static stance after the walk plays its own recording (the stance fixture).
        await page.evaluate(() => {
          (window as unknown as { azmGaitFixture?: string }).azmGaitFixture = "";
        });
        await page.locator('.gx-root [data-action="ready"]').click();
      } else if (step === "done") break;
      else if (step === "retry") throw new Error("the walk asked to record again");
      await page.waitForTimeout(250);
    }
    expect(seen.has("front_offer")).toBe(true);
    await expect(page.locator('.gx-root[data-step="done"]')).toBeVisible({ timeout: 20_000 });
    // The card: steps a minute and each side's step time, timing only, no pattern line.
    const card = page.locator(".gx-card");
    await expect(card.locator('[data-metric="cadence"]')).toBeVisible();
    await expect(card.locator('[data-metric="step_time_right"]')).toBeVisible();
    await expect(card.locator('[data-metric="step_time_left"]')).toBeVisible();
    // Western digits in both languages (D-036 item 3).
    const shownCadence = (await card.locator('[data-metric="cadence"] b').textContent()) ?? "";
    expect(shownCadence).not.toMatch(/[٠-٩]/);
    const cadence = Number(shownCadence);
    expect(Math.abs(cadence / 108 - 1)).toBeLessThan(0.05);
    await expect(card).toContainText(
      lang === "en" ? "We saw the timing of your steps clearly" : "رأينا توقيت خطواتك بوضوح",
    );
    expect(posts.length).toBe(1);
    await shot(page, `${lang}-walk-99-done-card`);
  });

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
