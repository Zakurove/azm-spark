/**
 * D-038 item 3 in the real app (VITE_V7=1 with VITE_E2E=1, e2e/v7-flow.config.ts), with the fake Live
 * coach (?e2eCoach=fake: no token, no Google) and a synthetic person in place of the camera
 * (?e2eTrace=full): a demo exercise runs the Live coach as a workout's camera set.
 *   - the coach goes live with no pain question and no workout (segment demo), the speaker button is
 *     its switch;
 *   - it is told the set's steps (where to sit, the start position, measuring, training) and each
 *     counted repetition as say lines, the words the recorded clips said before;
 *   - no recorded voice clip is loaded or played, and the phone's own speech is never used;
 *   - on the summary «again» repeats the exercise (next_step again);
 *   - nothing of the demo is saved: no workout, no set.
 * AZM_SHOTS_DIR=<dir>: the demo with the coach on at 390 x 844, in Arabic and English.
 * Skipped under the default config, whose server has the flags off.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const SHOTS = process.env.AZM_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** A wrist only body map and no walk: the history builds the program at once (no check to run). */
const wrist = {
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
  walking: { status: "no" },
  romFlags: { osteoporosis: false, neckCaution: false },
  regions: [{ region: "forearm_wrist", side: "right", problems: ["pain"], origin: "person" }],
};

/** A fresh account with its intake, the live_coach consent and its program built from the history. */
async function member(page: Page): Promise<void> {
  await page.goto("/?e2eGallery=loading&lang=en");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Fahd",
      email: `v7-demo-coach-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  expect((await page.request.put("/api/intake", { headers, data: wrist })).status()).toBe(200);
  expect(
    (
      await page.request.post("/api/consents", { headers, data: { kind: "live_coach", version: 1 } })
    ).status(),
  ).toBe(200);
  // Nothing the camera can measure: the check's page builds the program from the history.
  await page.goto("/?focus=1&lang=en");
  const skip = page.locator('.pb-skip[data-action="skip"]');
  await expect(skip).toBeVisible({ timeout: 60_000 });
  await skip.click();
  await expect(page.locator(".plan-card")).toBeVisible({ timeout: 30_000 });
}

type Sent = { kind: string; text?: string; responses?: { id: string; response: Record<string, unknown> }[] };

/** Every context line the app sent the fake coach. */
const contexts = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { e2eCoach?: { sent(): Sent[] } }).e2eCoach
        ?.sent()
        .flatMap((s) => (s.kind === "context" && s.text ? [s.text] : [])) ?? [],
  );

/** Opens the demo list from the Program tab, in `lang`, with the fake coach and the synthetic person. */
async function demoList(page: Page, lang: "ar" | "en") {
  await page.goto(`/?e2eTrace=full&e2eCoach=fake${lang === "en" ? "&lang=en" : ""}`);
  await page.locator(".portal-sidebar nav button").nth(1).click();
  const link = page.locator('.portal-main [data-demo-link] [data-action="demos"]');
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  const list = page.locator('[data-screen="demo_exercises"]');
  await expect(list).toBeVisible();
  return list;
}

test("a demo exercise runs the Live coach: its steps and counts, no voice clip, nothing saved (D-038 item 3)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // Every audio element made or played, and any use of the phone's own speech, are recorded.
  await page.addInitScript(() => {
    const w = window as unknown as { azmAudio: string[]; azmSpoken: string[] };
    w.azmAudio = [];
    w.azmSpoken = [];
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
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: { text?: string }) => w.azmSpoken.push(String(u?.text ?? "")),
        cancel: () => w.azmSpoken.push("cancel"),
        getVoices: () => [],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  await member(page);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/") && !r.url().includes("/api/agent/usage"))
      posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  for (const lang of ["ar", "en"] as const) {
    const list = await demoList(page, lang);
    await list.locator('[data-exercise="seated_shoulder_press"] [data-action="demo_start"]').click();
    const cam = page.locator(".cam2");
    await expect(cam).toBeVisible();
    // The coach is live with no pain question; the speaker button is its switch, on.
    await expect(page.locator("span[data-coach-mode]")).toHaveAttribute("data-coach-mode", "live", {
      timeout: 20_000,
    });
    await expect(page.locator('[data-screen="coach_pain"]')).toHaveCount(0);
    await expect(page.locator('[data-action="coach_sound"]')).toHaveAttribute("aria-pressed", "true");
    await expect(cam).toHaveAttribute("data-stage", "training", { timeout: 40_000 });
    await expect(cam).toHaveAttribute("data-count", /^[2-9]/, { timeout: 40_000 });
    await shot(page, `${lang}-demo-coach-on`);
    // The coach was told the steps and the counts, as say lines (the clips' words, said by it).
    const told = (await contexts(page)).join("\n");
    expect(told).toMatch(/type=say kind=step key=(framing|start|measure)/);
    expect(told).toMatch(/type=say kind=step key=training/);
    expect(told).toMatch(/type=say kind=progress key=count\] [1-9]/);
    // The set ends (or is stopped); the effort question, then the summary.
    if (
      !(await page
        .locator("#rpe-title")
        .isVisible({ timeout: 40_000 })
        .catch(() => false))
    )
      await page.locator(".cam2-stop button").first().click();
    await expect(page.locator("#rpe-title")).toBeVisible({ timeout: 40_000 });
    await page.locator(".modal-actions .ghost").click();
    await expect(page.locator("#sum-title")).toBeVisible();
    if (lang === "en") {
      // «Again» on the summary: the coach's next_step repeats the exercise, on the person's words
      // (said once the summary's buttons are there, as a person reads it first).
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const c = (window as unknown as { e2eCoach: { emit(e: unknown): void } }).e2eCoach;
        c.emit({ type: "inputTranscript", text: "again please", final: true });
        c.emit({ type: "toolCall", calls: [{ id: "again", name: "next_step", args: { intent: "again" } }] });
      });
      await expect(page.locator("#sum-title")).toHaveCount(0, { timeout: 10_000 });
      await expect(cam).toBeVisible();
      await page.locator(".cam2-stop button").first().click();
    } else {
      await page.locator(".modal-actions .ghost").click();
      await expect(list).toBeVisible();
    }
  }

  // No recorded voice clip was loaded or played, and the phone's speech was never used.
  const audio = await page.evaluate(() => (window as unknown as { azmAudio: string[] }).azmAudio);
  expect(audio.filter((a) => /\.mp3/.test(a))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { azmSpoken: string[] }).azmSpoken)).toEqual([]);
  // Nothing of the demo was saved: no workout, no set (the consent was posted before).
  expect(posts.filter((p) => /workouts|sessions|sets/.test(p))).toEqual([]);
  expect((await (await page.request.get("/api/sessions")).json()).records).toEqual([]);
});
