/**
 * D-035 items 2 and 4 and D-036 item 6 in the real app (VITE_V7=1 with VITE_E2E=1,
 * e2e/v7-flow.config.ts):
 *   - the walk in the check at home: a person who walks, with nothing else the camera measures, does
 *     the walk only. It is one walk, the side view: its placement is one instruction and one picture
 *     (a shelf or a wall, across the picture and back, side on to the phone, never toward it), the
 *     recorded walk across the picture and back turns inside it (gait fixture home-side), the counter
 *     says «pass N of 4» and never more, the walk ends by itself after its 4 passes with no front view
 *     offered, and the result card shows the steps a minute and each side's step time for timing
 *     only, saved;
 *   - the walk lab, /?gaitlab=side (any other view opens the same side walk), runs the walk's capture
 *     alone on a recorded walk at home, with no one signed in, shows its live diagnostics, ends with
 *     the verdict line and the JSON block, and sends nothing to the server.
 * AZM_GAIT_SHOTS=<dir> keeps a screenshot of each walk screen (and the walk at its second pass).
 * Skipped under the default config.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const SHOTS = process.env.AZM_GAIT_SHOTS ?? null;
async function shot(page: Page, name: string, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
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
  test(`the walk in the check at home: one side walk of 4 passes, a timing only result (${lang})`, async ({
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
    const counters = new Set<string>();
    while (Date.now() - t0 < 150_000) {
      const step = await walkStep(page);
      if (!step) break;
      if (!seen.has(step)) {
        seen.add(step);
        await shot(page, `${lang}-walk-${String(seen.size).padStart(2, "0")}-${step}`);
      }
      if (step === "walk") {
        const counter = await page
          .locator(".gx-counter")
          .getAttribute("data-counter", { timeout: 1000 })
          .catch(() => null);
        if (counter && !counters.has(counter)) {
          counters.add(counter);
          if (counters.size === 2)
            await shot(page, `${lang}-walk-${String(seen.size).padStart(2, "0")}-walk-pass2`);
        }
      }
      if (step === "intro") await page.locator('.gx-root [data-action="start"]').click();
      else if (step === "gear") {
        await page.locator('[data-field="shoes"] [data-value="yes"]').click();
        await page.locator('[data-field="brace"] [data-value="none"]').click();
        await page.locator('.gx-root [data-action="next"]').click();
      } else if (step === "clear_path") await page.locator('.gx-root [data-action="ready"]').click();
      else if (step === "place") {
        // One walk: the side view, with the home setup in plain words and the picture's caption.
        await expect(page.locator('.gx-root[data-rec="overground_side"]')).toBeVisible();
        await expect(page.locator('[data-caption="overground_side"] .gx-across')).toBeVisible();
        await expect(page.locator('.gx-root [data-action="no_room"]')).toHaveCount(0);
        await expect(page.locator(".gx-root")).toContainText(
          lang === "en" ? "on a shelf or against a wall" : "على رف أو جدار",
        );
        await expect(page.locator(".gx-root")).toContainText(
          lang === "en" ? "Do not walk toward it." : "ولا تمشِ نحوه",
        );
        if (SHOTS) {
          // The phone's screen as the person sees it, the instruction lines in view.
          await page.locator(".gx-root .fx-steps").evaluate((el) => el.scrollIntoView({ block: "center" }));
          await shot(page, `${lang}-walk-04b-place-lines`, false);
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        await page.locator('.gx-root [data-action="ready"]').click();
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
    // One walk: no front view, never a second recording; the counter never went past 4.
    expect([...seen]).not.toContain("front_offer");
    expect(seen.has("walk")).toBe(true);
    const shown = [...counters];
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const c of shown)
      expect(c).toMatch(lang === "en" ? /^Pass [1-4] of 4$/ : /^المرة [١-٤1-4] من [٤4]$/);
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

for (const lang of ["en", "ar"] as const)
  test(`a walk toward the phone in the side walk: «walk across», then one calm try once more and go on (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await newcomer(page, lang);
    // Nasser's third test: toward the phone and back, where the walk is across the picture.
    await page.addInitScript(() => {
      (window as unknown as { azmGaitFixture?: string }).azmGaitFixture = "gait/home-wall";
    });
    await page.goto(`/?focus=1&e2ePerson=1&e2eFast=1&e2eGait=1${lang === "en" ? "&lang=en" : ""}`);
    await page.locator('[data-screen="intro"] [data-action="start"]').click();
    await expect(page.locator(".gx-root")).toBeVisible({ timeout: 30_000 });
    const t0 = Date.now();
    const seen = new Set<string>();
    while (Date.now() - t0 < 150_000) {
      const step = await walkStep(page);
      if (!step) break;
      const first = !seen.has(step);
      seen.add(step);
      if (step === "intro") await page.locator('.gx-root [data-action="start"]').click();
      else if (step === "gear") {
        await page.locator('[data-field="shoes"] [data-value="yes"]').click();
        await page.locator('[data-field="brace"] [data-value="none"]').click();
        await page.locator('.gx-root [data-action="next"]').click();
      } else if (step === "clear_path" || step === "place")
        await page.locator('.gx-root [data-action="ready"]').click();
      else if (step === "walk" && first) {
        // No walk across: the counter stays at the first pass, and the screen says why, calmly.
        await expect(page.locator('.gx-hint[data-hint="across"]')).toBeVisible({ timeout: 40_000 });
        await expect(page.locator(".gx-counter")).toHaveAttribute(
          "data-counter",
          lang === "en" ? "Pass 1 of 4" : /^المرة [١1] من [٤4]$/,
        );
        await shot(page, `${lang}-toward-01-walk-hint`);
        // «I have finished», always there: the walk is read with what it holds.
        await page.locator('.gx-root [data-action="finish_walk"]').click();
      } else if (step === "retry") {
        await expect(page.locator(".gx-root")).toContainText(
          lang === "en" ? "with your side to the phone, not toward it" : "وجانبك للهاتف، لا نحوه",
        );
        await expect(page.locator('.gx-root [data-action="try_again"]')).toBeVisible();
        await shot(page, `${lang}-toward-02-try-once-more`);
        await page.locator('.gx-root [data-action="skip_part"]').click();
      } else if (step === "stance_place") {
        await page.evaluate(() => {
          (window as unknown as { azmGaitFixture?: string }).azmGaitFixture = "";
        });
        await page.locator('.gx-root [data-action="ready"]').click();
      } else if (step === "done") break;
      await page.waitForTimeout(250);
    }
    expect(seen.has("retry")).toBe(true);
    // Stored on failure: the card says the walk was not clear and what to change, calmly.
    await expect(page.locator('.gx-root[data-step="done"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".gx-card .gx-reason")).toContainText(
      lang === "en" ? "not toward it" : "لا نحوه",
    );
    await shot(page, `${lang}-toward-03-done`);
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

async function runLab(page: Page, view: string, fixture: string, lang: "ar" | "en") {
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
  // D-036 item 6: the fixed target, reached and never passed on the screen.
  expect(r.diagnostics[0].passes).toBe(4);
});

test("the lab's front view opens the same side walk (D-036 item 6, Arabic)", async ({ page }) => {
  test.setTimeout(150_000);
  const r = await runLab(page, "front", "gait/home-side", "ar");
  await expect(page.locator(".gx-lab")).toHaveAttribute("data-lab-view", "side");
  expect(r.level).not.toBe("none");
  expect(Math.abs(r.cadence! / 108 - 1)).toBeLessThan(0.05);
  expect(r.diagnostics[0].passes).toBe(4);
  await expect(page.locator(".gx-lab-verdict")).toContainText("الإيقاع");
});
