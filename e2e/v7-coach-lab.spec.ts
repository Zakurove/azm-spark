/**
 * D-035 item 4 in the real app (VITE_V7=1, e2e/v7-flow.config.ts): the coach's connection test page,
 * /?coachlab=1, in Chromium and in Playwright's WebKit, the closest proxy to iPhone Safari. WebKit has
 * navigator.audioSession, and it refuses a microphone asked for while the session is "playback" with
 * the error iOS gave Nasser's phone («AudioSession category is not compatible with audio capture»):
 *
 *   - on the fake coach (?e2eCoach=fake: no token, no Google) every stage passes with the real
 *     microphone, worklet and speaker of the browser, with and without the camera running, and the
 *     camera keeps running once the microphone starts;
 *   - «كما قبل إصلاح iOS» asks for the microphone without play-and-record, as v7.1 did: WebKit fails
 *     the microphone step with InvalidStateError and skips the rest (Chromium has no audio session);
 *   - on the real route, signed out the token step names 401 and the page links to sign in; signed in
 *     on this server (no Gemini key) it names 503 AGENT_UNAVAILABLE.
 *
 * Skipped under the default config, whose server has the flags off.
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpAddress } from "./sign-up";

test.skip(process.env.AZM_E2E_V7 !== "1", "runs with e2e/v7-flow.config.ts (the v7 flags on)");

const STEPS = ["token", "socket", "setup", "mic", "audio", "first_audio", "answer"];

async function runLab(page: Page, opts: { camera?: boolean; asBefore?: boolean } = {}) {
  await page.getByRole("button", { name: "ابدأ الاختبار" }).waitFor();
  if (opts.camera) await page.getByRole("button", { name: /مع تشغيل الكاميرا/ }).click();
  if (opts.asBefore) await page.locator("[data-option=as-before]").click();
  await page.getByRole("button", { name: "ابدأ الاختبار" }).click();
  await expect(page.locator(".coach-lab[data-verdict=pass], .coach-lab[data-verdict=fail]")).toBeVisible({
    timeout: 60_000,
  });
  const statuses = Object.fromEntries(
    await page
      .locator("[data-step]")
      .evaluateAll((els) => els.map((e) => [e.getAttribute("data-step"), e.getAttribute("data-status")])),
  );
  const report = JSON.parse((await page.locator("[data-report]").textContent()) ?? "{}");
  return { statuses, report };
}

test("every stage passes on the fake coach, with the browser's real microphone, worklet and speaker", async ({
  page,
}) => {
  await page.goto("/?coachlab=1&e2eCoach=fake");
  await expect(page.locator("h1")).toHaveText("اختبار اتصال المدرّب");
  const { statuses, report } = await runLab(page);
  expect(statuses).toEqual(Object.fromEntries(STEPS.map((s) => [s, "ok"])));
  await expect(page.locator(".coach-lab-verdict h2")).toHaveText("المدرّب يعمل على هذا الجهاز.");
  await expect(page.locator("[data-heard]")).toHaveText("نعم أسمعك");
  expect(report.ok).toBe(true);
  expect(report.diagnostics.after_mic.worklet).toMatch(/^(blob|data)$/);
  expect(report.diagnostics.after_mic.mic.readyState).toBe("live");
  // WebKit: the tap left the session on playback, the coach set play-and-record before the microphone.
  if (report.diagnostics.before_mic.audioSession !== null) {
    expect(report.diagnostics.before_mic.audioSession).toBe("playback");
    expect(report.diagnostics.after_mic.audioSession).toBe("play-and-record");
  }
});

test("with the camera running, the microphone starts and the camera keeps running", async ({ page }) => {
  await page.goto("/?coachlab=1&e2eCoach=fake&lang=en");
  await page.getByRole("button", { name: "Run the test" }).waitFor();
  await page.getByRole("button", { name: /With the camera on/ }).click();
  await page.getByRole("button", { name: "Run the test" }).click();
  await expect(page.locator(".coach-lab[data-verdict]")).not.toHaveAttribute("data-verdict", "", {
    timeout: 60_000,
  });
  await expect(page.locator(".coach-lab")).toHaveAttribute("data-verdict", "pass");
  const report = JSON.parse((await page.locator("[data-report]").textContent()) ?? "{}");
  expect(report.diagnostics.after_mic.camera).toMatchObject({ readyState: "live", running: true });
  await expect(page.locator(".coach-lab-verdict h2")).toHaveText("The coach works on this device.");
});

test("as before the iOS fix: WebKit refuses the microphone in a playback session, as on Nasser's iPhone", async ({
  page,
  browserName,
}) => {
  await page.goto("/?coachlab=1&e2eCoach=fake");
  const { statuses, report } = await runLab(page, { camera: true, asBefore: true });
  if (browserName !== "webkit") {
    // No audio session API: nothing to prove here.
    expect(report.ok).toBe(true);
    return;
  }
  expect(statuses).toMatchObject({ token: "ok", socket: "ok", setup: "ok", mic: "failed", audio: "skipped" });
  expect(report.reasons).toEqual([
    "mic: mic: InvalidStateError (AudioSession category is not compatible with audio capture.)",
  ]);
  await expect(page.locator(".coach-lab-verdict h2")).toHaveText("المدرّب لا يعمل على هذا الجهاز بعد.");
});

test("on the real route: 401 signed out with a sign in link, 503 signed in on a server without the coach", async ({
  page,
}) => {
  await page.goto("/?coachlab=1");
  let r = await runLab(page);
  expect(r.statuses).toMatchObject({ token: "failed", socket: "skipped" });
  expect(r.report.reasons[0]).toContain("HTTP_401");
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute("href", "/?app=1");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers: { ...headers, ...signUpAddress() },
    data: {
      name: "Lab",
      email: `v7-lab-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  await page.reload();
  r = await runLab(page);
  expect(r.report.reasons).toEqual(["token: token: HTTP_503 (AGENT_UNAVAILABLE)"]);
});
