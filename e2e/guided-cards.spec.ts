/**
 * Booth v2, contract D (guided cards), in the real app on the e2e server (the rules' week; no model):
 *   - a session runs the day's warm up cards, then one screen opens the camera part; a hold is timed
 *     and ends on the effort; a card done is kept and counts toward the sessions done, a skipped one
 *     keeps nothing;
 *   - a program with no camera movement is not empty: the Program page shows each item as its card,
 *     and the session is cards alone, with no phone placement; the tap counter counts each rep, rests
 *     between sets with the rules' rest, and a high effort ends the session.
 * The page clock is installed, so the hold and the rest pass at once.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";
import { labels } from "../src/app/platform-copy";
import { guidedCopy } from "../src/app/guided-copy";

type Lang = "ar" | "en";
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

const SEATED = {
  age: 40,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "seated",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "habit",
  days: [0, 1, 2, 3],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

async function account(page: Page, lang: Lang, intake: Record<string, unknown>) {
  await page.goto(url("/?e2eGallery=loading", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Saad",
      email: `cards-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  expect((await page.request.put("/api/intake", { headers, data: intake })).status()).toBe(200);
  await page.goto(url("/", lang));
}

/**
 * Waits for every finite animation on the page to end (D-027 item 7): a card's panels rise in with
 * opacity, and a scan mid fade reads their text against a half transparent card, so it fails only
 * when the machine is slow. Infinite animations (none on these screens) are not waited for.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) =>
          a.finished.then(
            () => undefined,
            () => undefined,
          ),
        ),
    ),
  );
}

/** Serious or critical WCAG 2.2 AA problems on the page (as e2e/a11y.spec.ts reads them), once settled. */
async function axe(page: Page): Promise<string[]> {
  await settled(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("a session: the warm up cards, then the camera part; a card done counts (ar)", async ({ page }) => {
  const errors = watch(page);
  const c = labels("ar"),
    g = guidedCopy("ar");
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await account(page, "ar", SEATED);
  await page.getByRole("button", { name: c.start }).first().click();
  // The session list in its parts, then «أنا جاهز».
  await expect(page.locator(".workout-queue-group")).toHaveText([
    g.slot.warmup,
    g.cameraKicker,
    g.slot.extra,
    g.slot.cooldown,
  ]);
  await page.getByRole("button", { name: c.ready }).click();
  // The first warm up card: a hold, its numbered steps, timed.
  const card = page.locator(".gcard");
  await expect(card).toHaveAttribute("data-slot", "warmup");
  await expect(card).toHaveAttribute("data-kind", "timer");
  await expect(page.locator(".gcard-slot")).toContainText(g.slot.warmup);
  await expect(page.locator(".gcard-num").first()).toHaveText("١");
  await expect(page.locator(".gcard [role=timer]")).toBeVisible();
  await page.getByRole("button", { name: g.start }).click();
  await expect(card).toHaveAttribute("data-phase", "running");
  await page.clock.fastForward(40_000);
  // The effort, then Done.
  await expect(card).toHaveAttribute("data-phase", "effort");
  const done = page.getByRole("button", { name: g.done });
  await expect(done).toBeDisabled();
  await page.locator(".gcard-rpe button").nth(3).click();
  await done.click();
  // The second warm up card, skipped.
  await expect(page.locator(".gcard-slot b")).toContainText("٢");
  await page.getByRole("button", { name: g.skipExercise }).click();
  // The camera part opens with one screen.
  await expect(page.locator(".workout-camera-kicker")).toHaveText(g.cameraKicker);
  await expect(page.locator(".interval-main h1")).toHaveText("ضغط الكتف جالسًا");
  await expect(page.getByRole("button", { name: c.startTraining })).toBeVisible();
  // One card kept, and it counts toward this week's sessions.
  const records = (await (await page.request.get("/api/sessions")).json()).records;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ mode: "guided", slot: "warmup", rpe: 3 });
  const progress = await (await page.request.get("/api/progress")).json();
  expect(progress.sessions.weeks.at(-1).done).toBe(1);
  expect(errors).toEqual([]);
});

test("no camera movement: the program is guided cards; the counter, the rest and a high effort (en)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  const c = labels("en"),
    g = guidedCopy("en");
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await account(page, "en", { ...SEATED, conditions: ["upper_limb_unilateral"] });
  // Program: ready, each item as its card, no camera block.
  await page.locator(".portal-sidebar nav button").nth(1).click();
  await expect(page.locator(".medical-review")).toHaveCount(0);
  await expect(page.locator(".weekly-block").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".weekly-item.camera")).toHaveCount(0);
  const item = page.locator(".weekly-item").first();
  await item.locator("summary").click();
  await expect(item.locator(".weekly-steps li").first()).toBeVisible();
  await expect(item.locator(".weekly-guided")).toContainText(g.guided);
  // Today: the session's exercises are counted; Start; no phone placement before cards alone.
  await page.locator(".portal-sidebar nav button").nth(0).click();
  await expect(page.locator(".next-workout .hero-dose")).toContainText("exercises");
  await page.locator(".next-workout .cta").click();
  await expect(page.locator(".workout-attest")).toHaveText(c.attest);
  await expect(page.locator(".place-tips, .workout-place-line")).toHaveCount(0);
  await expect(page.locator(".workout-queue-group")).toHaveText([
    g.slot.warmup,
    g.slot.extra,
    g.slot.cooldown,
  ]);
  await page.getByRole("button", { name: c.ready }).click();
  // Skip to the first counted card.
  const card = page.locator(".gcard");
  for (let i = 0; i < 6 && (await card.getAttribute("data-kind")) !== "counter"; i++) {
    const before = await page.locator(".gcard-slot b").textContent();
    await page.getByRole("button", { name: g.skipExercise }).click();
    await expect(page.locator(".gcard-slot b")).not.toHaveText(before!);
  }
  await expect(card).toHaveAttribute("data-kind", "counter");
  const sets = Number(await card.getAttribute("data-sets"));
  const reps = Number(await card.getAttribute("data-reps"));
  const tap = page.locator(".gcard-tap");
  await expect(tap).toHaveAttribute("aria-label", g.tapLabel("0", String(reps)));
  expect(await axe(page)).toEqual([]);
  for (let set = 1; set <= sets; set++) {
    await expect(page.locator(".gcard-set")).toHaveText(g.setOf(String(set), String(sets)));
    for (let r = 1; r <= reps; r++) {
      await tap.click();
      if (r < reps) await expect(page.locator(".gcard-ring-face b")).toHaveText(String(r));
    }
    if (set < sets) {
      // The rules' rest between counted sets, then the next set.
      await expect(card).toHaveAttribute("data-phase", "rest");
      await expect(page.locator(".gcard-status")).toHaveText(g.setDone(String(set)));
      await page.clock.fastForward(300_000);
      await expect(card).toHaveAttribute("data-phase", "ready");
    }
  }
  await expect(card).toHaveAttribute("data-phase", "effort");
  // Scanned as it rises in: axe waits for the rise to end (a scan mid fade failed on slow runs).
  expect(await axe(page)).toEqual([]);
  await page.locator(".gcard-rpe button").nth(8).click();
  await expect(page.locator(".gcard-warn")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: g.done }).click();
  // A high effort ends the session for today.
  await expect(page.locator(".interval-main h1")).toHaveText(c.done);
  await expect(page.locator(".interval-main .form-error")).toHaveText(c.highEffort);
  const records = (await (await page.request.get("/api/sessions")).json()).records;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    mode: "guided",
    slot: "extra",
    rpe: 8,
    done: { sets, reps: sets * reps },
  });
  expect(errors).toEqual([]);
});
