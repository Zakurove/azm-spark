/**
 * D-035 items 2 and 4, D-036 item 6 and D-038 item 4 in the real app (VITE_V7=1 with VITE_E2E=1,
 * e2e/v7-flow.config.ts):
 *   - the walk in the check at home: a person who walks, with nothing else the camera measures, does
 *     the walk only. It is one walk in two parts. Part 1, the side view: its placement is one
 *     instruction and one picture (a shelf or a wall, across the picture and back, side on to the
 *     phone, never toward it), the recorded walk across the picture and back turns inside it (gait
 *     fixture home-side), the counter says «pass N of 4» and never more, and the walk goes on by
 *     itself after its 4 passes. Part 2, right after it with the phone where it is: its own screen and
 *     drawing (start 4 to 5 m away, turn about 2 m before the phone, twice), the recorded walk toward
 *     the phone and back (home-toward-back), «toward and back N of 2» and the «turn» cue, ending by
 *     itself after the second lap. The result card shows the steps a minute and each side's step time,
 *     the side walk's timing line, saved once;
 *   - a walk toward the phone in part 1 hints, asks one calm «try once more» and goes on; part 2 then
 *     gives its reading and the card says the side walk was not seen clearly, calmly;
 *   - the walk's patterns by name on the results page: an antalgic gait from the side walk's timing
 *     reading and a Trendelenburg gait from the walk toward the phone and back, each «may suggest» on
 *     its side with the provisional label (the walks made by the gait generator and read by the real
 *     engine and rules inside the page; the profile answer is the page's own route);
 *   - the walk lab, /?gaitlab=side runs part 1 and /?gaitlab=front part 2 alone on a recorded walk at
 *     home, with no one signed in, shows its live diagnostics, ends with the verdict line and the JSON
 *     block, and sends nothing to the server.
 * AZM_GAIT_SHOTS=<dir> keeps a screenshot of each walk screen (the walks at their second pass and lap,
 * part 2's instruction and its turn cue, the result pages). Skipped under the default config.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const SHOTS = process.env.AZM_GAIT_SHOTS ?? null;
async function shot(page: Page, name: string, fullPage = true, settleMs = 300) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (settleMs) await page.waitForTimeout(settleMs);
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
  test(`the walk in the check at home: 4 side passes, then toward the phone and back twice, a timing only result (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await newcomer(page, lang);
    // Part 1 plays the side walk at home; part 2 its own walk toward the phone and back.
    await page.addInitScript(() => {
      (window as unknown as { azmGaitFixtures?: Record<string, string> }).azmGaitFixtures = {
        "gait/overground-side": "gait/home-side",
      };
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
    const laps = new Set<string>();
    let turned = false;
    while (Date.now() - t0 < 200_000) {
      const step = await walkStep(page);
      if (!step) break;
      const rec = await page.evaluate(
        () => document.querySelector(".gx-root")?.getAttribute("data-rec") ?? "",
      );
      const key = rec === "overground_front" ? `${step}-part2` : step;
      if (!seen.has(key)) {
        seen.add(key);
        await shot(page, `${lang}-walk-${String(seen.size).padStart(2, "0")}-${key}`);
      }
      if (step === "walk" && rec === "overground_front") {
        // Part 2: «toward and back N of 2», and «turn» as the feet near the picture's bottom.
        const counter = await page
          .locator(".gx-counter")
          .getAttribute("data-counter", { timeout: 1000 })
          .catch(() => null);
        if (counter) laps.add(counter);
        if (!turned) {
          // The first lap's «turn», as the walker's feet near the picture's bottom (the screen and the
          // coach say it; the clock runs twice as fast here, so it shows for about half a second).
          await page.locator('.gx-hint[data-hint="turn"]').waitFor({ state: "visible", timeout: 40_000 });
          turned = true;
          await shot(page, `${lang}-part2-live-turn`, false, 0);
          const now = await page.locator(".gx-counter").getAttribute("data-counter");
          if (now) laps.add(now);
        }
      } else if (step === "walk") {
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
      else if (step === "place" && rec === "overground_front") {
        // Part 2, right after the side passes: its own screen and drawing, the phone where it is.
        await expect(page.locator('.gx-root [data-part="2"]')).toBeVisible();
        await expect(page.locator(".gx-root svg.is-overground_front")).toBeVisible();
        await expect(page.locator('[data-caption="overground_front"] .gx-toward')).toBeVisible();
        for (const line of lang === "en"
          ? [
              "Now walk toward the phone and back, twice",
              "Leave the phone where it is.",
              "about 4 to 5 metres away",
              "Turn when you are about 2 metres away, before your feet leave the picture.",
            ]
          : [
              "الآن امشِ نحو الهاتف وارجع، مرتين",
              "اترك الهاتف في مكانه.",
              "على بعد 4 إلى 5 أمتار تقريبًا",
              "قبل أن تخرج قدماك من الصورة",
            ])
          await expect(page.locator(".gx-root")).toContainText(line);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `${lang}-part2-instruction`, false);
        await page.locator('.gx-root [data-action="ready"]').click();
      } else if (step === "place") {
        // Part 1: the side view, with the home setup in plain words and the picture's caption.
        await expect(page.locator('.gx-root[data-rec="overground_side"]')).toBeVisible();
        await expect(page.locator('.gx-root [data-part="1"]')).toBeVisible();
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
    // One walk in two parts, no offer between them; the counters never went past 4 passes and 2 laps.
    expect([...seen]).not.toContain("front_offer");
    expect(seen.has("walk")).toBe(true);
    expect(seen.has("place-part2")).toBe(true);
    expect(seen.has("walk-part2")).toBe(true);
    const shown = [...counters];
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const c of shown)
      expect(c).toMatch(lang === "en" ? /^Pass [1-4] of 4$/ : /^المرة [١-٤1-4] من [٤4]$/);
    expect(laps.size).toBeGreaterThanOrEqual(1);
    for (const c of laps)
      expect(c).toMatch(lang === "en" ? /^Toward and back [12] of 2$/ : /^ذهابًا وإيابًا [12] من 2$/);
    expect(turned).toBe(true);
    await expect(page.locator('.gx-root[data-step="done"]')).toBeVisible({ timeout: 20_000 });
    // The card: steps a minute and each side's step time, the side walk's timing line, no pattern.
    const card = page.locator(".gx-card");
    await expect(card.locator('[data-metric="cadence"]')).toBeVisible();
    await expect(card.locator('[data-metric="step_time_right"]')).toBeVisible();
    await expect(card.locator('[data-metric="step_time_left"]')).toBeVisible();
    // Western digits in both languages (D-036 item 3).
    const shownCadence = (await card.locator('[data-metric="cadence"] b').textContent()) ?? "";
    expect(shownCadence).not.toMatch(/[٠-٩]/);
    const cadence = Number(shownCadence);
    expect(Math.abs(cadence / 108 - 1)).toBeLessThan(0.05);
    // Part 2 was read (no hip dip in the recorded walk): the timing line is the side walk's alone.
    await expect(card).toContainText(
      lang === "en"
        ? "From the side we saw the timing of your steps clearly"
        : "من الجانب رأينا توقيت خطواتك بوضوح",
    );
    await expect(card.locator("[data-pattern]")).toHaveCount(0);
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
    // Nasser's third test: toward the phone and back, where the walk is across the picture (part 1);
    // part 2 then plays its own walk toward the phone and back.
    await page.addInitScript(() => {
      (window as unknown as { azmGaitFixtures?: Record<string, string> }).azmGaitFixtures = {
        "gait/overground-side": "gait/home-wall",
      };
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
    // Stored on failure (D-035 item 4); part 2 gave its reading, so the card says, calmly, that the
    // side walk was not seen clearly, in one line.
    await expect(page.locator('.gx-root[data-step="done"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".gx-card")).toContainText(
      lang === "en"
        ? "This time we could not see your walk from the side clearly enough"
        : "لم نتمكن هذه المرة من رؤية مشيك من الجانب بوضوح كافٍ",
    );
    await shot(page, `${lang}-toward-03-done`);
  });

/**
 * The walk's patterns by name on the results page (D-038 item 4). The e2e person has no leg in the
 * body map (a check with one would measure the leg first), so the page's own profile answer carries a
 * walk the gait generator made and the real engine and rules read inside the page: part 1 with the
 * right leg's stance shorter and the right hip in pain today (antalgic, from the side walk's timing
 * reading), or part 2 with the left hip dipping 14 degrees as the person stands on the right leg
 * (Trendelenburg, from the walk toward the phone and back).
 */
async function walkProfile(page: Page, kind: "antalgic" | "trendelenburg") {
  return page.evaluate(async (kind) => {
    const gen = await import("/tests/fixtures/gait/gen-gait.ts" as string);
    const engine = await import("/src/engine/gait/analyse.ts" as string);
    const rules = await import("/src/medical/gait-rules.ts" as string);
    const sideSpec = {
      view: "side",
      passes: 4,
      seed: 2,
      speed: 1,
      cadence: 100,
      camera: { distance: 3 },
      sidePath: { pathM: 6, turnSec: 1.5 },
      passShiftM: 0.3,
      noise: 0.003,
      jitterMs: 8,
      ...(kind === "antalgic" ? { stanceBy: { left: 0.66, right: 0.58 } } : {}),
    };
    const frontSpec = {
      view: "front",
      passes: 2,
      seed: 2,
      home: { farM: 5, nearM: 2 },
      passShiftM: 0.3,
      camera: { lateral: 0, height: 0.95, landscape: true },
      noise: 0.002,
      jitterMs: 8,
      ...(kind === "trendelenburg" ? { pelvicDrop: { right: 14 } } : {}),
    };
    const sw = gen.walk(sideSpec);
    const fw = gen.walk(frontSpec);
    const setup = gen.setupOf(sideSpec);
    const side = engine.analyseGaitGroup([
      {
        view: "side",
        setup,
        standing: sw.standing,
        frames: gen.withRealFarLeg(sw.frames),
        poseModel: "full",
        rollDeg: null,
      },
    ]);
    const front = engine.analyseGaitGroup(
      ["front", "back"].map((view) => ({
        view,
        setup,
        standing: fw.standing,
        frames: fw.frames,
        poseModel: "full",
        rollDeg: 0,
      })),
    );
    const analysis = engine.combineViews([...side, ...front], [], setup);
    const intake = {
      age: 58,
      conditions: ["none"],
      diagnosisNotes: "",
      medications: "",
      mobility: "standing",
      support: "none",
      pain: ["hip"],
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
      regions: [{ region: "hip", side: "right", problems: ["pain"], origin: "person" }],
    };
    const plan = {
      offered: true,
      modes: ["overground"],
      defaultMode: "overground",
      padAllowed: false,
      helperRequired: false,
      antalgicOnly: false,
      staticStance: false,
      views: { overground: ["side", "front", "back"], walking_pad: [] },
    };
    const out = rules.evaluateGait({
      analysis,
      intake,
      romProfile: null,
      today: { painByRegion: kind === "antalgic" ? { hip: 3 } : {} },
      plan,
      setup,
    });
    const gait = {
      id: "g1",
      mode: "overground",
      views: analysis.views.map((v: { view: string; metrics: object; quality: { cleanCycles: object } }) => ({
        view: v.view,
        metrics: v.metrics,
        cleanCycles: v.quality.cleanCycles,
      })),
      metrics: analysis.combined,
      patterns: out.patterns,
      findings: out.findings,
      quality: {
        gatePassed: analysis.views.some((v: { quality: { gatePassed: boolean } }) => v.quality.gatePassed),
        timingOnly: analysis.views.some((v: { quality: { timingOnly: boolean } }) => v.quality.timingOnly),
        flags: analysis.flags,
      },
      replay: analysis.replay,
      provisional: false,
      rulesVersion: out.rulesVersion,
      created: Date.now(),
    };
    return {
      profile: { sex: "male", age: 58, normsVersion: "e2e", created: Date.now(), entries: [] },
      findings: [],
      bodyMap: {},
      gait,
      changes: [],
      gaitChanges: [],
    };
  }, kind);
}

for (const lang of ["en", "ar"] as const)
  for (const kind of ["antalgic", "trendelenburg"] as const)
    test(`the results page names ${kind === "antalgic" ? "an antalgic gait" : "a Trendelenburg gait"} with «may suggest», its side and the provisional label (${lang})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await newcomer(page, lang);
      const profile = await walkProfile(page, kind);
      await page.route("**/api/focus/profile**", (route) => route.fulfill({ json: profile }));
      await page.goto(`/?findings=1&check=e2e-walk${lang === "en" ? "&lang=en" : ""}`);
      const card = page.locator(".gx-card");
      await expect(card).toBeVisible({ timeout: 30_000 });
      const item =
        kind === "antalgic"
          ? card.locator('[data-pattern="shorter_stance"][data-label="antalgic"][data-side="right"]')
          : card.locator('[data-pattern="trendelenburg"][data-side="right"]');
      await expect(item).toHaveCount(1);
      await expect(card.locator("[data-pattern]")).toHaveCount(1);
      await expect(item).toHaveAttribute("data-provisional", "true");
      const name = {
        antalgic: {
          en: "Your walk may suggest an antalgic gait (sparing your right leg).",
          ar: "قد يشير مشيك إلى مشية الألم (تخفيف الحمل عن ساقك اليمنى).",
        },
        trendelenburg: {
          en: "Your walk may suggest a Trendelenburg gait (when you stand on your right leg).",
          ar: "قد يشير مشيك إلى مشية ترندلنبرغ (عند الوقوف على ساقك اليمنى).",
        },
      }[kind][lang];
      await expect(item.locator(".gx-pattern-name")).toHaveText(name);
      await expect(item.locator(".gx-provisional")).toHaveText(lang === "en" ? "Provisional" : "نتيجة أولية");
      await expect(item).toContainText(lang === "en" ? "How sure we are" : "مدى تأكدنا");
      // The possible reasons and the program's line, as the page shows them once final.
      await expect(item.locator(".gx-target")).toHaveCount(1);
      // The card's top under the page's bar.
      await card.evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        window.scrollBy(0, -76);
      });
      await shot(page, `${lang}-result-${kind}`, false);
      await shot(page, `${lang}-result-${kind}-page`);
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

test("the lab's front view runs part 2, toward the phone and back, twice (D-038 item 4, Arabic)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const r = await runLab(page, "front", "gait/home-toward-back", "ar");
  await expect(page.locator(".gx-lab")).toHaveAttribute("data-lab-view", "front");
  expect(r.level).toBe("timing");
  expect(Math.abs(r.cadence! / 108 - 1)).toBeLessThan(0.05);
  expect(r.cleanCycles.left).toBeGreaterThanOrEqual(2);
  expect(r.cleanCycles.right).toBeGreaterThanOrEqual(2);
  expect(r.diagnostics[0]).toMatchObject({ rec: "overground_front", passes: 2 });
  await expect(page.locator(".gx-lab-verdict")).toContainText("الإيقاع");
});
