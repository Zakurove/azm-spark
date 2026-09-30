/**
 * The axe pass of the definition of done (UX spec, contract v3 L): axe-core runs on every check and
 * progress screen the fixture flows reach, in Arabic and English at 375 x 812, and the run fails on
 * any serious or critical violation (WCAG 2.0 to 2.2 A and AA rules).
 *
 *   flow     every named state of e2e/flow-models.ts (S04 to S33, S35), opened by the reload snapshot
 *   camera   every static preview of S34 (camera/e2e/previews.ts) and the live screen with the
 *            fixture camera and the stop list over it
 *   safety   every named state of e2e/safety-fixtures.ts (S36 to S49 and the S41, S43, S44, S45
 *            overlays), guest and signed in
 *   results  S50 to S52, the Today cards S01 and S03, the offer S02, My results S53 and the example
 *            S54, with the answers of e2e/results-data.ts
 *   booth    S55 (code, errors, on, the visitor QR), S55b (every phase), S56, S57 and S58
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { PREVIEW_NAMES } from "../src/features/assessment/camera/e2e/previews";
import { camModel } from "./camera-fixtures";
import {
  buildStored,
  context as contextOf,
  CURL,
  DAY,
  HISTORY,
  LEAN,
  mockApi,
  openCheck,
  openSnapshot,
  progress,
  RAISE,
  resultsSnapshot,
  SEATED,
  signIn,
  type Outcome,
} from "./results-data";
import { model, openGuest, openSignedIn, SAFETY_STATES, seed } from "./safety-fixtures";

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
/**
 * Reduced motion: the screen entry fade (0.5 check-enter) would be measured half way, which lowers
 * every contrast axe reads; the rules are about the screen at rest. Each context comes from its own
 * address (X-Forwarded-For, which the server reads from its one trusted hop), so the accounts this
 * pass makes never use up the sign up limit of the other specs' address.
 */
let address = 0;
function phoneOptions() {
  address += 1;
  return {
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce" as const,
    extraHTTPHeaders: { "x-forwarded-for": `198.18.${address % 250}.${1 + Math.floor(address / 250)}` },
  };
}

/**
 * Runs axe on the page as it is now and keeps every serious or critical violation. `within` limits it
 * to the check's own root on the portal pages (Today, My results), whose other parts are not screens
 * of the check.
 */
async function audit(page: Page, where: string, problems: string[], within?: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (within ? builder.include(within) : builder).analyze();
  for (const v of r.violations) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    const nodes = v.nodes
      .slice(0, 3)
      .map((n) => `${n.target.join(" ")}${n.any[0]?.message ? ` [${n.any[0].message}]` : ""}`)
      .join(" | ");
    problems.push(`${where}: ${v.id} (${v.impact}) ${nodes}`);
  }
}

async function phone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(phoneOptions());
  const page = await context.newPage();
  // No voices: every caption steps at its reading time (as in the shots specs).
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
  return { context, page };
}

/* ------------------------------------------------------------------ flow */

/** A throwaway signed in account (the signed in flow states render inside the app). */
async function register(page: Page, tag: string): Promise<void> {
  await page.goto("/?e2eGallery=loading");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Sara",
      email: `a11y-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
}

async function flowStates(page: Page): Promise<string[]> {
  await page.goto("/?e2eGallery=loading");
  return page.evaluate(async () => {
    const path = "/e2e/flow-models.ts";
    const mod = await import(/* @vite-ignore */ path);
    return Object.keys(mod.FLOW_STATES);
  });
}

/** Opens a named state of e2e/flow-models.ts through the check's reload snapshot. */
async function openFlowState(page: Page, name: string, lang: Lang, attempt = 1): Promise<string> {
  await page.goto("/?e2eGallery=loading");
  const info = await page.evaluate(async (name) => {
    const path = "/e2e/flow-models.ts";
    const mod = await import(/* @vite-ignore */ path);
    mod.setWalkClock(Date.now());
    const s = mod.FLOW_STATES[name];
    sessionStorage.setItem("azm.check.snapshot", JSON.stringify(s.build()));
    if (s.mode === "guest" && s.booth !== false) sessionStorage.setItem("azm.booth", "e2e-booth");
    else sessionStorage.removeItem("azm.booth");
    return { mode: s.mode as string, screen: s.screen as string };
  }, name);
  await page.goto(url(info.mode === "guest" ? "/?check=1" : "/", lang));
  // The dev server may compile or optimise modules on first use and reload the page, which drops the
  // snapshot: the state is opened once more before it counts as missing.
  const screen = page.locator(`[data-screen="${info.screen}"]`).first();
  try {
    await expect(screen).toBeVisible({ timeout: attempt === 1 ? 10_000 : 20_000 });
  } catch (e) {
    if (attempt > 1) throw e;
    return openFlowState(page, name, lang, attempt + 1);
  }
  await page.waitForTimeout(300);
  return info.screen;
}

/* ------------------------------------------------------------------ results */

const measured = (value: number, detail: Record<string, unknown> = {}): Outcome => ({
  status: "measured",
  value,
  detail,
});
const GUEST_OUTCOMES: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(121, RAISE),
  "shoulder_abduction:left": { status: "notMeasured", reason: "quality" },
  "trunk_control_seated:right": { status: "skipped", reason: "pain_today" },
  "trunk_control_seated:left": { status: "skipped", reason: "pain_today" },
  "arm_curl_30s:right": measured(14, CURL),
  "arm_curl_30s:left": measured(2, CURL),
};
const FIRST_OUTCOMES: Record<string, Outcome> = {
  "shoulder_abduction:right": measured(122, RAISE),
  "shoulder_abduction:left": measured(115, RAISE),
  "trunk_control_seated:right": measured(18, { ...LEAN, censored: true }),
  "trunk_control_seated:left": measured(16, LEAN),
  "arm_curl_30s:right": measured(13, CURL),
  "arm_curl_30s:left": measured(9, CURL),
};

/* ------------------------------------------------------------------ booth */

const SESSION = "a".repeat(64);
const QR_TOKEN = "d".repeat(64);
const VISITOR = "c".repeat(64);
const HOUR = 60 * 60 * 1000;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/* ------------------------------------------------------------------ the runs */

for (const lang of LANGS) {
  test(`axe ${lang}: flow screens S04 to S35`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const problems: string[] = [];
    const { context, page } = await phone(browser);
    await register(page, `flow-${lang}`);
    for (const name of await flowStates(page)) {
      const screen = await openFlowState(page, name, lang);
      await audit(page, `${screen} ${name}`, problems);
    }
    await context.close();
    expect(problems).toEqual([]);
  });

  test(`axe ${lang}: camera screen S34`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const problems: string[] = [];
    const { context, page } = await phone(browser);
    await page.addInitScript(
      ([m]) => {
        sessionStorage.setItem("azm.booth", "e2e-booth");
        sessionStorage.setItem("azm.check.snapshot", m);
      },
      [camModel({ kind: "cam.setup", i: 0, side: 0 })],
    );
    for (const name of PREVIEW_NAMES) {
      await page.goto(url(`/?check=1&e2eCamPreview=${name}`, lang));
      await expect(page.locator(".s34-stage")).toBeVisible();
      await audit(page, `S34 ${name}`, problems);
    }
    // The live screen with the fixture camera, then STOP and the stop list over the stage.
    await page.goto(url(`/?check=1&e2eFixture=abd-9x16&e2eCamFast=1`, lang));
    await expect(
      page.locator(".check-base[data-state='cam.practice'], .check-base[data-state='cam.measure']"),
    ).toBeVisible({ timeout: 45_000 });
    await audit(page, "S34 live", problems);
    await page.locator(".s34-stop").click();
    await expect(page.locator(".check-overlay[data-overlay='S41']")).toBeVisible();
    await audit(page, "S41 over S34", problems);
    await context.close();
    expect(problems).toEqual([]);
  });

  test(`axe ${lang}: safety screens S36 to S49`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const problems: string[] = [];
    // One account for every signed in state (a new tab each), so the run stays within the server's
    // sign up limit of 30 an hour per address.
    let signed: BrowserContext | null = null;
    for (const s of SAFETY_STATES) {
      const own = s.signedIn ? null : await browser.newContext(phoneOptions());
      const first = s.signedIn && !signed;
      if (s.signedIn && !signed) signed = await browser.newContext(phoneOptions());
      const page = await (own ?? signed!).newPage();
      await page.clock.install();
      if (!s.signedIn) await openGuest(page, lang, s.open);
      else if (first) await openSignedIn(page, lang, s.open);
      else {
        await seed(page, model({ ...s.open, mode: "signedIn", booth: false }), false);
        // The camera under the overlays plays the fixture person (no camera in a headless browser).
        await page.goto(url("/?e2eFixture=seated-still", lang));
        await expect(page.locator(".azm-check").first()).toBeVisible();
      }
      await expect(page.locator("[data-screen]").first()).toBeVisible();
      await page.clock.runFor(1_000);
      if (s.act) await s.act(page, lang);
      if (s.runMs) await page.clock.runFor(s.runMs);
      await audit(page, s.name, problems);
      // An act may have taken the shared tab set offline.
      await page.context().setOffline(false);
      await page.close();
      await own?.close();
    }
    await signed?.close();
    expect(problems).toEqual([]);
  });

  test(`axe ${lang}: results S50 to S52, Today S01 to S03, S53 and S54`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const problems: string[] = [];
    const { context, page } = await phone(browser);

    // S50, the guest at the booth.
    await page.goto(url("/?e2eGallery=empty", lang));
    const guest = resultsSnapshot({
      mode: "guest",
      booth: true,
      homeOpen: false,
      items: SEATED,
      outcomes: GUEST_OUTCOMES,
    });
    await openSnapshot(page, lang, guest, true);
    await expect(page.locator('[data-screen="S50"]')).toBeVisible();
    await audit(page, "S50", problems);
    await page.evaluate(() => sessionStorage.clear());

    // S51, the first check at home; S52, the re-test with its comparisons.
    await signIn(page, lang, "a11y");
    await mockApi(page, { context: contextOf({ firstCheck: false, completedBefore: true }) });
    await openSnapshot(
      page,
      lang,
      resultsSnapshot({
        mode: "signedIn",
        booth: false,
        checkId: "e2e-first",
        checkKind: "baseline",
        items: SEATED,
        outcomes: FIRST_OUTCOMES,
      }),
      false,
    );
    await expect(page.locator('[data-screen="S51"]')).toBeVisible();
    await audit(page, "S51", problems);

    const now = Date.now();
    const built = await buildStored(page, HISTORY);
    await mockApi(page, {
      context: contextOf({ firstCheck: false, completedBefore: true }),
      progress: progress(built.tests),
      checks: { assessments: built.checks },
    });
    await openSnapshot(
      page,
      lang,
      resultsSnapshot({
        mode: "signedIn",
        booth: false,
        checkId: "e2e-retest",
        checkKind: "retest",
        items: SEATED,
        outcomes: FIRST_OUTCOMES,
      }),
      false,
    );
    await expect(page.locator('[data-screen="S52"]')).toBeVisible();
    await audit(page, "S52", problems);

    // Today: S01 in its variants, S03 above it.
    const slot = ".check-slot";
    const today = async (label: string, over: Record<string, unknown>, extra = {}) => {
      await mockApi(page, {
        context: contextOf(over),
        progress: progress([]),
        checks: { assessments: [] },
        ...extra,
      });
      await page.goto(url("/", lang));
      await expect(
        page.locator(`${slot} [data-screen="S01"], ${slot} [data-screen="S03"]`).first(),
      ).toBeVisible();
      await expect(page.locator(`${slot} .pg-entry-skeleton`)).toHaveCount(0);
      await audit(page, `S01 ${label}`, problems, slot);
    };
    await today("first", {});
    // The Today page outside the check as well (the week strip, the weekly card, the footnote), once.
    await audit(page, "Today page", problems);
    await today("homeSoon", { homeOpen: false });
    await today("blocked", { blocked: "clinical_review" });
    await today("locked", {
      lock: {
        until: now + DAY,
        releasableByClearance: true,
        when: { token: "nextDay_clock", time: { hour: 7, minute: 50, suffix: "am" } },
      },
    });
    const open = openCheck(now);
    await today("resume", open.context, { checks: { assessments: [open.check] } });
    await today("upcoming", { firstCheck: false, completedBefore: true, retestDue: now + 20 * DAY });
    await today("S03 followUp", { firstCheck: false, completedBefore: true, followUpDue: true });

    // S02, the offer after the intake.
    await page.goto(url("/?e2eGallery=offer", lang));
    await expect(page.locator('[data-screen="S02"]')).toBeVisible();
    await audit(page, "S02", problems);

    // S54, the example.
    await page.goto(url("/?example=progress", lang));
    await expect(page.locator('[data-screen="S54"]')).toBeVisible();
    await audit(page, "S54", problems);

    // S53 My results: with its series and the read only view of a check.
    await mockApi(page, {
      context: contextOf({ firstCheck: false, completedBefore: true, retestDue: now + 26 * DAY }),
      progress: progress(built.tests, { retestDue: now + 26 * DAY }),
      checks: { assessments: built.checks },
    });
    await page.goto(url("/", lang));
    await page
      .locator("nav")
      .first()
      .getByRole("button", { name: lang === "ar" ? "نتائجي" : "My results" })
      .first()
      .click();
    await expect(page.locator(".pg-series").first()).toBeVisible();
    await audit(page, "S53", problems, ".azm-check");
    await page.locator(".pg-history-row").last().click();
    await expect(page.locator("[data-detail]")).toBeVisible();
    await audit(page, "S53 check detail", problems, ".azm-check");
    await context.close();
    expect(problems).toEqual([]);
  });

  test(`axe ${lang}: booth screens S55 to S58`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const problems: string[] = [];
    const { context, page } = await phone(browser);
    let verify: unknown = { ok: false };
    await page.route("**/api/booth/verify", (r) => json(r, verify));
    await page.route("**/api/booth/token", (r) => json(r, { token: QR_TOKEN, expires: Date.now() + HOUR }));

    // S55: the code, a wrong code, booth mode on, the visitor QR.
    await page.goto(url("/?booth=1", lang));
    await expect(page.locator("input").first()).toBeVisible();
    await audit(page, "S55 code", problems);
    await page.locator("input").first().fill("123456");
    await page.locator("form .cta").first().click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page, "S55 wrong", problems);
    verify = { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR };
    await page.locator("form .cta").first().click();
    await expect(
      page.locator("[data-booth-on], [data-visitor-qr], .booth-qr-panel, button").first(),
    ).toBeVisible();
    await audit(page, "S55 on", problems);

    // S55b in every phase.
    let answer: "on" | "ended" | "abort" = "on";
    await page.route("**/api/booth/redeem", async (r) => {
      if (answer === "abort") return r.abort("internetdisconnected");
      await json(
        r,
        answer === "on" ? { ok: true, token: VISITOR, expires: Date.now() + HOUR } : { ok: false },
      );
    });
    for (const phase of ["on", "ended", "abort"] as const) {
      answer = phase;
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(url(`/?booth=1&e2eBooth=token&t=${QR_TOKEN}`, lang));
      await expect(page.locator(`[data-phase="${phase === "abort" ? "error" : phase}"]`)).toBeVisible();
      await audit(page, `S55b ${phase}`, problems);
    }
    await page.goto(url(`/?booth=1&e2eBooth=token&phase=offline&t=${QR_TOKEN}`, lang));
    await expect(page.locator('[data-phase="offline"]')).toBeVisible();
    await audit(page, "S55b offline", problems);

    // S56, the staff vitals; S57, the layer and the staff count; S58, the tips.
    for (const name of [
      "vitals-flow",
      "vitals-starting",
      "count",
      "tips",
      "tips-wheelchair",
      "layer-results",
    ]) {
      await page.goto(url(`/?booth=1&e2eBooth=${name}`, lang));
      await expect(page.locator(".azm-check").first()).toBeVisible();
      await page.waitForTimeout(300);
      await audit(page, `booth ${name}`, problems);
    }
    await context.close();
    expect(problems).toEqual([]);
  });
}
