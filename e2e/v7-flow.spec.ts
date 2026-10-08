/**
 * D-032 and D-034 in the real app (VITE_V7=1 and AZM_V7=1, e2e/v7-flow.config.ts): the tests come
 * before the program, and the focus check is open at home with no extra step before it starts.
 *   - A new profile waits for the check: Today and the Program tab show one card in place of the
 *     program; the health form's last button reads «التالي: قياس حركتك» and opens the check; the check
 *     runs with the simulated person (?e2ePerson=1&e2eFast=1) from the intro straight to the parts
 *     (D-034 item 4: no consent page, the start records the consents; no day screen) to the end; the
 *     build animation plays; the program page opens with each exercise's why line; the program is then
 *     on Today and the Program tab.
 *   - Nothing the camera can measure (a wrist only body map, no walk): the history builds the program
 *     at once, and the Program tab says the check can refine it later.
 *   - «لا أستطيع استخدام الكاميرا» on the intro builds the program from the history.
 *   - The camera setup says nothing has started, Ready on screen; the X opens the stop and leave
 *     options (no red STOP, D-034 items 4 and 5); the sound is on by default (item 3).
 *   - Back during the build: Today shows the program, since the completed check ended the wait.
 * Skipped under the default config, whose server has the flags off.
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

type Lang = "ar" | "en";

const base = {
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
/** A wrist only body map and no walk: nothing the camera can measure. */
const wrist = {
  ...base,
  pain: ["wrist"],
  regions: [{ region: "forearm_wrist", side: "right", problems: ["pain"], origin: "person" }],
};

const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/**
 * A fresh account with its intake saved (the server marks the program as waiting). No consent is
 * posted: the check's start records it from the health form's (D-034 item 4).
 */
async function newcomer(page: Page, lang: Lang, intake: Record<string, unknown>): Promise<void> {
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Fahd",
      email: `v7-flow-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const saved = await page.request.put("/api/intake", { headers, data: intake });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).awaitingCheck).toBe(true);
}

/** The focus shell's state (window.azmFocus, VITE_E2E builds). */
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { azmFocus?: { model: { state: { kind: string } }; ctl: unknown } })
      .azmFocus;
    if (!s) return { kind: "none", step: null as string | null, phase: null as string | null };
    const c = s.ctl as { current?: { kind: string }; phase?: string | null } | null;
    return { kind: s.model.state.kind, step: c?.current?.kind ?? null, phase: c?.phase ?? null };
  });

/** The range blocks with every hold answered yes, until the check leaves its parts. */
async function runRange(page: Page): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const w = await state(page);
    if (w.kind !== "part") return;
    if (w.step === "block" || w.step === "setup") {
      const ready = page.locator('[data-action="ready"]:not([disabled])');
      if (await ready.count()) await ready.first().click();
    } else if (w.step === "result" || w.step === "sit" || w.step === "rest") {
      const next = page.locator('[data-action="next"]:not([disabled])');
      if (await next.count()) await next.first().click();
    } else if (w.phase === "ask_max") await page.locator('.safety-zone[data-value="yes"]').first().click();
    else if (w.phase === "ask_pain") {
      await page.locator('.fx-scale-cell[data-value="1"]').first().click();
      await page.locator('[data-action="next"]').first().click();
    } else if (w.phase === "ask_cause") await page.locator('.fx-choice[data-value="tight"]').first().click();
    await page.waitForTimeout(150);
  }
  throw new Error("the range blocks did not end");
}

/** The build animation (D-032 item 4) plays before the program opens: skip it, as a person may. */
async function passBuild(page: Page) {
  const skip = page.locator('.pb-skip[data-action="skip"]');
  await expect(skip).toBeVisible({ timeout: 60_000 });
  await skip.click();
}

test("the health form leads to the check, whose end plays the build and opens the program", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await newcomer(page, "ar", base);
  await page.goto("/");
  // Today and the Program tab: one card in place of the program.
  await expect(page.locator("[data-program-waiting]")).toContainText("برنامجك ينتظر قياس حركتك");
  await expect(page.locator(".next-workout")).toHaveCount(0);
  await page.locator(".portal-sidebar nav button").nth(1).click();
  await expect(page.locator("[data-program-waiting]")).toBeVisible();
  await expect(page.locator(".plan-card")).toHaveCount(0);
  // The workout cannot start on the server either.
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(me.awaitingCheck).toBe(true);
  // The health form: its last button says the check comes next, and opens it.
  await page.locator(".page-heading .ghost").click();
  const cta = page.locator(".intake-actions .cta");
  for (let i = 0; i < 8 && !((await cta.textContent()) ?? "").includes("التالي: قياس حركتك"); i++) {
    await cta.click();
    await page.waitForTimeout(250);
  }
  await expect(cta).toContainText("التالي: قياس حركتك");
  await cta.click();
  await expect(page).toHaveURL(/[?&]focus=1/);
  await expect(page.locator('[data-screen="intro"]')).toBeVisible();
  await expect(page.locator('[data-action="no_camera"]')).toBeVisible();
  // The check itself with the simulated person (the e2e options are read when the check opens).
  await page.goto("/?focus=1&e2ePerson=1&e2eFast=1");
  await expect(page.locator('[data-screen="intro"]')).toBeVisible();
  await page.locator('[data-screen="intro"] [data-action="start"]').click();
  // D-034 item 4: straight to the check: no consent page, no day screen.
  await expect.poll(async () => (await state(page)).kind, { timeout: 20_000 }).toBe("part");
  await expect(page.locator('[data-screen="consent"], [data-screen="today"]')).toHaveCount(0);
  await runRange(page);
  // The build animation, then the program page with its why lines.
  await passBuild(page);
  await expect(page.locator('[data-screen="program"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".pv7-why").first()).toBeVisible();
  expect((await (await page.request.get("/api/auth/me")).json()).awaitingCheck).toBe(false);
  // The program is now on the Program tab and on Today.
  await page.locator('[data-action="program"]').last().click();
  await expect(page.locator(".plan-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-program-waiting]")).toHaveCount(0);
  await expect(page.locator('[data-program-link="built"]')).toBeVisible();
  await page.locator(".portal-sidebar nav button").nth(0).click();
  await expect(page.locator(".next-workout")).toBeVisible();
});

test("nothing the camera can measure: the history builds the program at once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newcomer(page, "en", wrist);
  await page.goto(url("/?focus=1", "en"));
  await passBuild(page);
  await expect(page.locator('[data-program-link="history"]')).toContainText(
    "Your movement check can refine it later.",
    {
      timeout: 30_000,
    },
  );
  await expect(page.locator(".plan-card")).toBeVisible();
  expect((await (await page.request.get("/api/auth/me")).json()).awaitingCheck).toBe(false);
});

test("«لا أستطيع استخدام الكاميرا» builds the program from the history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newcomer(page, "ar", base);
  await page.goto("/?focus=1&e2ePerson=1");
  await page.locator('[data-action="no_camera"]').click();
  await passBuild(page);
  await expect(page.locator('[data-program-link="history"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".plan-card")).toBeVisible();
});

test("the intro starts the check at once; the setup says nothing has started; the X stops or leaves (D-034)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newcomer(page, "en", base);
  await page.goto(url("/?focus=1&e2ePerson=1", "en"));
  // The intro leaves at once: nothing has started, so no leave question.
  await page.locator('[data-action="leave"]').first().click();
  await expect(page.locator('[data-screen="leave"]')).toHaveCount(0);
  await expect(page.locator("[data-program-waiting]")).toBeVisible();
  await page.goto(url("/?focus=1&e2ePerson=1", "en"));
  // The sound is on by default (item 3).
  await expect(page.locator('.fx-top [aria-pressed="true"]')).toHaveCount(1);
  await page.locator('[data-screen="intro"] [data-action="start"]').click();
  // The camera setup: «not started yet», no red STOP, Ready on screen without scrolling (item 5).
  const block = page.locator('[data-screen^="block_"]');
  await expect(block).toContainText("we haven’t started yet");
  await expect(page.locator(".safety-stop")).toHaveCount(0);
  const ready = block.locator('[data-action="ready"]');
  await expect(ready).toBeInViewport();
  // The consents were recorded by the start (item 4).
  const ctx = await (await page.request.get("/api/focus/context")).json();
  expect(ctx.consent).toEqual({ focus_check: true, live_coach: true });
  // The X mid check: the stop and leave options; «Stop now» opens the stop list.
  await page.locator('[data-action="leave"]').first().click();
  const dialog = page.locator('[data-screen="leave"]');
  await expect(dialog).toContainText("Do you want to stop?");
  await expect(dialog.locator('[data-action="stop_now"]')).toBeVisible();
  await dialog.locator('[data-action="stay"]').click();
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-action="leave"]').first().click();
  await page.locator('[data-screen="leave"] [data-action="stop_now"]').click();
  await expect(page.locator('[data-screen="stop_list"]')).toBeVisible();
});

test("Back during the build: Today shows the program, since the completed check ended the wait", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await newcomer(page, "en", base);
  // The build runs long enough on the server to go Back during it.
  await page.route("**/api/program/targets", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });
  await page.goto(url("/?focus=1&e2ePerson=1&e2eFast=1", "en"));
  await page.locator('[data-screen="intro"] [data-action="start"]').click();
  await expect.poll(async () => (await state(page)).kind, { timeout: 20_000 }).toBe("part");
  await runRange(page);
  await expect.poll(async () => (await state(page)).kind, { timeout: 60_000 }).toBe("build");
  await page.goBack();
  await expect(page.locator(".next-workout")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-program-waiting]")).toHaveCount(0);
});
