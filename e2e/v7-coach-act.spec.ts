/**
 * D-036 items 1 and 2 in the real app (VITE_V7=1 with VITE_E2E=1, e2e/v7-flow.config.ts), with the
 * fake Live coach (?e2eCoach=fake: no token, no Google) and the simulated person (?e2ePerson=1):
 *   - the person says «I'm ready» and the coach's next_step presses the block card's Ready, then «let's
 *     go» presses the movement's Ready: the check moves from the camera setup to the measurement, as
 *     with the taps, and the coach is told what was pressed;
 *   - the model calling next_step on its own (no words of the person on that screen) presses nothing;
 *   - nothing on the page ever uses the phone's own speech (a speechSynthesis stub records any use).
 * Skipped under the default config, whose server has the flags off.
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const knee = {
  age: 58,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "none",
  pain: ["knee"],
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
  regions: [{ region: "knee", side: "right", problems: ["pain"], origin: "person" }],
};

/** A fresh account with its intake saved: the check opens at once. */
async function newcomer(page: Page): Promise<void> {
  await page.goto("/?e2eGallery=loading&lang=en");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Fahd",
      email: `v7-coach-act-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const saved = await page.request.put("/api/intake", { headers, data: knee });
  expect(saved.status()).toBe(200);
}

type Sent = { kind: string; responses?: { id: string; response: Record<string, unknown> }[] };

/** The fake coach (window.e2eCoach): the person's words, then the model's call. */
async function coach(page: Page, words: string | null, id: string, intent: string) {
  await page.evaluate(
    ({ words, id, intent }) => {
      const c = (window as unknown as { e2eCoach: { emit(e: unknown): void } }).e2eCoach;
      if (words) c.emit({ type: "inputTranscript", text: words, final: true });
      c.emit({ type: "toolCall", calls: [{ id, name: "next_step", args: { intent } }] });
    },
    { words, id, intent },
  );
}

/** What the app answered the coach's call `id`. */
async function answer(page: Page, id: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((id) => {
    const c = (window as unknown as { e2eCoach: { sent(): Sent[] } }).e2eCoach;
    const r = c
      .sent()
      .flatMap((s) => s.responses ?? [])
      .find((x) => x.id === id);
    return r ? r.response : null;
  }, id);
}

test("«I'm ready» presses the camera setup's Ready, and «let's go» starts the movement (D-036 item 2)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // Any use of the phone's own speech is recorded (D-036 item 1: there must be none).
  await page.addInitScript(() => {
    const used: string[] = [];
    (window as unknown as { azmSpoken: string[] }).azmSpoken = used;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: { text?: string }) => used.push(String(u?.text ?? "")),
        cancel: () => used.push("cancel"),
        getVoices: () => {
          used.push("getVoices");
          return [];
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  await newcomer(page);
  await page.goto("/?focus=1&e2ePerson=1&e2eFast=1&e2eCoach=fake&lang=en");
  await page.locator('[data-screen="intro"] [data-action="start"]').click();

  // The camera setup of the first block, with the coach live and the camera ready.
  const block = page.locator('[data-screen^="block_"]');
  await expect(block).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("span[data-coach-mode]")).toHaveAttribute("data-coach-mode", "live", {
    timeout: 20_000,
  });
  await expect(block.locator('[data-action="ready"]:not([disabled])')).toBeVisible({ timeout: 20_000 });

  // The model on its own: nothing is pressed.
  await coach(page, null, "own", "ready");
  await expect.poll(() => answer(page, "own")).toMatchObject({ accepted: false, reason: "no_answer_heard" });
  await expect(block).toBeVisible();

  // «I'm ready»: the block card's Ready is pressed; the movement's setup card shows.
  await coach(page, "I'm ready", "ready", "ready");
  await expect
    .poll(() => answer(page, "ready"))
    .toEqual({
      accepted: true,
      say: "starting",
      data: { pressed: "ready" },
    });
  const setup = page.locator('[data-screen="setup"]');
  await expect(setup).toBeVisible();
  await expect(setup.locator('[data-action="ready"]')).toBeVisible();

  // «Let's go»: the setup's Ready starts the movement.
  await coach(page, "let's go", "start", "start");
  await expect.poll(() => answer(page, "start")).toMatchObject({ accepted: true, say: "starting" });
  await expect(page.locator('[data-screen^="measure_"]')).toBeVisible();

  // Only the Live coach speaks: the phone's speech was never touched.
  expect(await page.evaluate(() => (window as unknown as { azmSpoken: string[] }).azmSpoken)).toEqual([]);
});
