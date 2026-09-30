/**
 * Review screenshots of the round 3 review fixes (definition of done): the states the fixes changed,
 * in Arabic and English, at 375 x 812 (m), 375 x 667 (c) and 1440 x 900 (d), into
 * local-docs/screens/round3/fixes, plus an axe pass on the real S17 start states. Runs only with
 * AZM_SHOTS_DIR set:
 *
 *   AZM_SHOTS_DIR=../Azm6.0/local-docs/screens/round3/fixes AZM_E2E_PORT=<port> npm run e2e -- fixes-shots
 *
 * With AZM_FLOW_SHOTS_DIR set as well, the three S17 start states are also written there under the
 * flow stream's names (they replace the flow shots that showed the intake page instead).
 *
 *   safety   S43 (the optional check in at home, D-016), S41 with STOP inert, S38b, S47, S48
 *            (contact, count, count field), S49
 *   camera   the S34e practice fix, and the landscape screen in a landscape viewport (812 x 375)
 *   flow     S17 start busy, error and offline on a signed in check with an intake (the start call
 *            held or failed), the unanswered guest steps S06 to S11, and the pain scale at 320 px
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { camModel } from "./camera-fixtures";
import { MEASURE, openGuest, openSignedIn, type Lang, type ModelOptions } from "./safety-fixtures";

const OUT = process.env.AZM_SHOTS_DIR ? resolve(process.env.AZM_SHOTS_DIR) : "";
const FLOW_OUT = process.env.AZM_FLOW_SHOTS_DIR ? resolve(process.env.AZM_FLOW_SHOTS_DIR) : "";
test.skip(!OUT, "set AZM_SHOTS_DIR to write the review screenshots");

const LANGS: Lang[] = ["ar", "en"];
const SIZES = [
  { tag: "m", width: 375, height: 812, scale: 2, mobile: true },
  { tag: "c", width: 375, height: 667, scale: 2, mobile: true },
  { tag: "d", width: 1440, height: 900, scale: 1, mobile: false },
] as const;
type Size = (typeof SIZES)[number];

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

/** Each context from its own address, so the accounts made here keep within the sign up limit. */
let address = 0;
async function newPage(browser: Browser, size: Size | { width: number; height: number; tag: string }) {
  const mobile = "mobile" in size ? size.mobile : true;
  address += 1;
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.20.${address % 250}.${1 + Math.floor(address / 250)}` },
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: "scale" in size ? size.scale : 2,
    hasTouch: mobile,
    isMobile: mobile,
    reducedMotion: "reduce",
  });
  return context.newPage();
}

/** A viewport shot: what the person sees, the sticky STOP and bars in place. */
async function shot(page: Page, dir: string, lang: Lang, tag: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${lang}-${tag}-${name}.png`), animations: "disabled" });
}

/* ------------------------------------------------------------------ safety */

const SAFETY: { name: string; open: ModelOptions; screen: string; signedIn?: boolean }[] = [
  {
    name: "S43-check-in-home",
    signedIn: true,
    open: { state: MEASURE, overlay: { kind: "checkIn" }, checkIn: true },
    screen: "S43",
  },
  {
    name: "S41-stop-list-stop-inert",
    open: { state: MEASURE, overlay: { kind: "stopList" } },
    screen: "S41",
  },
  { name: "S38b-faint-question", open: { state: { kind: "faintAsk" } }, screen: "S38b" },
  {
    name: "S47-pain-after",
    open: { state: { kind: "between", i: 0, side: 0, scope: "side", via: "test" } },
    screen: "S47",
  },
  { name: "S48-contact", open: { state: { kind: "after.contact", i: 2, side: 0 } }, screen: "S48" },
  { name: "S48-count", open: { state: { kind: "after.count", i: 1, side: 0 } }, screen: "S48" },
  { name: "S49-end-question", open: { state: { kind: "endQuestion" } }, screen: "S49" },
];

for (const size of SIZES)
  for (const lang of LANGS)
    test(`fixes shots: safety ${lang} ${size.tag}`, async ({ browser }) => {
      test.setTimeout(10 * 60_000);
      const dir = OUT;
      for (const s of SAFETY) {
        const page = await newPage(browser, size);
        if (s.signedIn) await openSignedIn(page, lang, s.open);
        else await openGuest(page, lang, s.open);
        await expect(page.locator(`[data-screen="${s.screen}"]`).first()).toBeVisible();
        await shot(page, dir, lang, size.tag, s.name);
        if (s.name === "S48-count") {
          await page.locator('[data-screen="S48"] [data-value="no"]').click();
          await page.waitForTimeout(3200);
          await shot(page, dir, lang, size.tag, "S48-count-input");
        }
        await page.context().close();
      }
    });

/* ------------------------------------------------------------------ camera */

async function seedCamera(page: Page) {
  await page.addInitScript(
    ([m]) => {
      if (typeof speechSynthesis !== "undefined")
        Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
      sessionStorage.setItem("azm.booth", "e2e-booth");
      sessionStorage.setItem("azm.check.snapshot", m);
    },
    [camModel({ kind: "cam.setup", i: 0, side: 0 })],
  );
}

for (const lang of LANGS)
  test(`fixes shots: camera ${lang}`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    for (const size of SIZES) {
      const page = await newPage(browser, size);
      await seedCamera(page);
      for (const name of ["practice-fix", "retry-exhausted", "retry-timed", "lean-return", "setup-none"]) {
        await page.goto(`/?check=1&e2eCamPreview=${name}${lang === "en" ? "&lang=en" : ""}`);
        await expect(page.locator(".s34-stage")).toBeVisible();
        await shot(page, OUT, lang, size.tag, `S34-${name}`);
      }
      await page.context().close();
    }
    // The phone held sideways, in a landscape viewport (812 x 375).
    const wide = await newPage(browser, { width: 812, height: 375, tag: "l" });
    await seedCamera(wide);
    await wide.goto(`/?check=1&e2eCamPreview=landscape${lang === "en" ? "&lang=en" : ""}`);
    await expect(wide.locator(".s34-stage")).toBeVisible();
    await shot(wide, OUT, lang, "l", "S34-landscape");
    await wide.context().close();
  });

/* ------------------------------------------------------------------ flow */

const INTAKE = {
  age: 45,
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
  equipment: ["chair"],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

/**
 * A signed in account with its intake done, so the app opens the check and not the intake page, and
 * the start call answered as the state needs: held (busy), failed (error) or never sent (offline).
 */
async function openStart(page: Page, lang: Lang, name: "busy" | "error" | "offline") {
  await page.goto("/?e2eGallery=loading");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Sara",
      email: `fixes-${name}-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  expect((await page.request.put("/api/intake", { headers, data: INTAKE })).status()).toBe(200);
  await page.route("**/api/assessments", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (name === "busy") return; // never answered: the call is still running
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await page.evaluate(async (n) => {
    const mod = await import(/* @vite-ignore */ String("/e2e/flow-models.ts"));
    mod.setWalkClock(Date.now());
    sessionStorage.setItem("azm.check.snapshot", JSON.stringify(mod.FLOW_STATES[n].build()));
    sessionStorage.removeItem("azm.booth");
  }, `S17-start-${name}`);
  await page.goto(lang === "en" ? "/?lang=en" : "/");
  const s17 = page.locator('[data-screen="S17"]');
  await expect(s17).toBeVisible();
  // Still S17 a second later (the portal never takes over).
  await page.waitForTimeout(1200);
  await expect(s17).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

for (const lang of LANGS)
  test(`fixes shots: S17 start states ${lang}, with axe`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const problems: string[] = [];
    for (const size of [SIZES[0], SIZES[2]])
      for (const name of ["busy", "error", "offline"] as const) {
        const page = await newPage(browser, size);
        await openStart(page, lang, name);
        if (name === "offline") await page.context().setOffline(true);
        await page.waitForTimeout(500);
        await shot(page, OUT, lang, size.tag, `S17-start-${name}`);
        if (FLOW_OUT) await shot(page, FLOW_OUT, lang, size.tag, `S17-start-${name}`);
        if (size.tag === "m") {
          const r = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
            .analyze();
          for (const v of r.violations)
            if (v.impact === "serious" || v.impact === "critical")
              problems.push(
                `S17-start-${name}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
              );
        }
        await page.context().close();
      }
    expect(problems).toEqual([]);
  });

/** A guest at a setup step with nothing chosen yet on it (the untouched state). */
async function openGuestStep(page: Page, lang: Lang, step: number) {
  await page.goto("/?e2eGallery=loading");
  await page.evaluate(async (step) => {
    const fm = await import(/* @vite-ignore */ String("/src/features/assessment/flowMachine.ts"));
    const now = Date.now();
    const play = (m: unknown, ...events: Record<string, unknown>[]) =>
      events.reduce((acc, e) => fm.flowReducer(acc, { now, ...e }), m);
    let m = play(
      fm.initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false }),
      { type: "START" },
      { type: "GUEST_PATH", path: "full" },
      { type: "ADULT_YES" },
    );
    const answers: Record<string, unknown>[] = [
      { type: "GUEST_ANSWER", step: 1, value: "chair" },
      { type: "GUEST_ANSWER", step: 2, value: "none" },
      { type: "GUEST_ANSWER", step: 3, value: ["none"] },
      { type: "GUEST_NEXT" },
      { type: "GUEST_ANSWER", step: 4, value: "yes" },
      { type: "GUEST_ANSWER", step: 5, value: ["none"] },
      { type: "GUEST_NEXT" },
    ];
    // Answer the steps before this one (3 and 5 are multi choice: answered, then Next).
    const upTo: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 5, 6: 7 };
    m = play(m, ...answers.slice(0, upTo[step]));
    sessionStorage.setItem("azm.check.snapshot", JSON.stringify(m));
    sessionStorage.setItem("azm.booth", "e2e-booth");
  }, step);
  await page.goto(lang === "en" ? "/?check=1&lang=en" : "/?check=1");
  await expect(page.locator(".azm-check").first()).toBeVisible();
}

for (const lang of LANGS)
  test(`fixes shots: unanswered guest steps and the 320 px pain scale ${lang}`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    for (const size of [SIZES[0], SIZES[2]])
      for (const step of [1, 2, 3, 4, 5, 6]) {
        const page = await newPage(browser, size);
        await openGuestStep(page, lang, step);
        await page.waitForTimeout(400);
        await shot(page, OUT, lang, size.tag, `guest-step-${step}-unanswered`);
        await page.context().close();
      }
    // S19 at 320 x 480: the scale takes three rows and nothing scrolls sideways (WCAG 1.4.10).
    const page = await newPage(browser, { width: 320, height: 480, tag: "n" });
    await page.goto("/?e2eGallery=loading");
    await page.evaluate(async () => {
      const mod = await import(/* @vite-ignore */ String("/e2e/flow-models.ts"));
      mod.setWalkClock(Date.now());
      sessionStorage.setItem("azm.check.snapshot", JSON.stringify(mod.FLOW_STATES["S19-pain-now"].build()));
      sessionStorage.setItem("azm.booth", "e2e-booth");
    });
    await page.goto(lang === "en" ? "/?check=1&lang=en" : "/?check=1");
    await expect(page.locator('[data-screen="S19"]')).toBeVisible();
    await shot(page, OUT, lang, "n", "S19-pain-scale-320");
    await page.context().close();
  });
