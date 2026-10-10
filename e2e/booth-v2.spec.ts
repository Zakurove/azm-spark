/**
 * The booth v2 journey in the browser (contract C), /?booth=1, with the synthetic camera of E2E
 * builds (?e2eTrace=) in place of a person:
 *
 *   code      the staff code (the existing form and POST /api/booth/verify): the real server outside
 *             the booth days, then a routed pass; the code is never kept
 *   story     Saad's story end to end in Arabic and English: the live reading (routed) and its chips,
 *             the engine's three groups, wheelchair basketball, the safety question, the camera in
 *             variant booth (5 presses), the starting point and the labelled example, the program
 *             with the AI week (routed), the sport path and the register code
 *   cached    the reading engine never answers: Saad's cached reading after 8 s
 *   self      "Try it as yourself" end to end in both languages: the taps (clearance when it is
 *             needed), the position and side, a sport, the camera, the program from the real server's
 *             refusal (the rules' week on the phone)
 *   rules     a heart condition holds the plan for review and skips the camera; yes to the safety
 *             question stops calmly with 997
 *   staff     the staff menu (new visitor, language, the coach voice), Alt Shift N, the idle reset
 *   design    56 px targets, nothing linked to the parked check, no console errors
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];
const SESSION = "a".repeat(64);
const HOUR = 60 * 60 * 1000;

const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The words the spec reads (the copy lives in src/features/booth/copy.ts). */
const T = {
  ar: {
    title: "وضع فريق الجناح",
    codeLabel: "رمز الفريق",
    turnOn: "فعّل وضع الجناح",
    closed: "يعمل وضع الجناح في أيام الجناح وساعاته فقط.",
    home: "رياضة على مقاس حالتك الطبية",
    reportTitle: "يقرأ عزم تقرير سعد",
    engineStory: "ما الآمن لسعد",
    notForWheelchair: "ليس لمستخدمي الكرسي المتحرك",
    safety: "هل تشعر الآن بألم في الصدر أو دوخة أو توعك؟",
    example: "مثال",
    programStory: "برنامج سعد الأسبوعي",
    sourceAi: "رتّبه محرك عزم بالذكاء الاصطناعي على قواعد حالتك الطبية",
    sourceEngine: "مبني على قواعد حالتك الطبية",
    path: "طريقك إلى كرة السلة على الكراسي المتحركة",
    stop: "لنتوقف هنا",
    review: "يحتاج البرنامج مراجعة قبل البدء",
    staff: "قائمة الفريق",
    wellDone: "أحسنت",
  },
  en: {
    title: "Booth staff mode",
    codeLabel: "Staff code",
    turnOn: "Turn on booth mode",
    closed: "Booth mode works only on booth days and during booth hours.",
    home: "Sport that fits your medical condition",
    reportTitle: "Azm reads Saad's report",
    engineStory: "What is safe for Saad",
    notForWheelchair: "Not for wheelchair users",
    safety: "Do you feel chest pain, dizziness or unwell right now?",
    example: "Example",
    programStory: "Saad's weekly program",
    sourceAi: "Arranged by the Azm AI engine on the rules for your medical condition",
    sourceEngine: "Built on the rules for your medical condition",
    path: "Your path to wheelchair basketball",
    stop: "Let's stop here",
    review: "The program needs a review before starting",
    staff: "Staff menu",
    wellDone: "Well done",
  },
} as const;

/** Saad's report as the reading engine answers it (server/report.ts, sanitized). */
const LIVE = {
  document: "medical_report",
  extracted: {
    age: 22,
    conditions: ["sci_incomplete"],
    diagnosisNotes: "Incomplete spinal cord injury at T10 (AIS C)",
    medications: "Baclofen 10 mg three times daily",
    mobility: "wheelchair",
    support: "unknown",
    pain: [],
    restrictions: [],
    symptoms: "unknown",
    recentChange: "unknown",
  },
  missing: ["support"],
  questions: [],
  summary: "",
  confidence: "high",
};

/** A week as the AI engine arranges it (only exercises the rules allow; ids from library.json). */
const AI_WEEK = {
  source: "ai",
  summary: { ar: "أسبوع نحو كرة السلة.", en: "A week toward basketball." },
  why: [],
  tips: [],
  days: [0, 2, 4].map((day, i) => ({
    day,
    focus: [
      { ar: "قوة الدفع", en: "Pushing power" },
      { ar: "تحمّل الكتفين", en: "Shoulder endurance" },
      { ar: "ثبات الجذع", en: "Trunk control" },
    ][i],
    warmup: [],
    extra: [{ id: "chest_press", sets: 2, reps: 8 }],
    cooldown: [],
  })),
};

/** Console errors, except the expected refusals: /api/auth/me (no account) and the booth routes. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const at = m.location().url;
    if (m.text().includes("401") && at.includes("/api/auth/me")) return;
    if (/status of (4\d\d|5\d\d)/.test(m.text()) && at.includes("/api/booth/")) return;
    errors.push(`${m.text()} @ ${at}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (typeof speechSynthesis !== "undefined")
      Object.defineProperty(speechSynthesis, "getVoices", { value: () => [], configurable: true });
  });
});

/** The staff code with a routed pass, then the booth home. */
async function staffIn(page: Page, lang: Lang, trace = "full") {
  await page.route("**/api/booth/verify", (r) =>
    json(r, { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR }),
  );
  await page.goto(url(`/?booth=1&e2eTrace=${trace}`, lang));
  await page.getByLabel(T[lang].codeLabel).fill("482913");
  await page.getByRole("button", { name: T[lang].turnOn }).click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
}

const next = (page: Page) => page.locator('.bx-actions [data-action="next"]').click();

/** From the safety question through the camera's 5 presses to the starting point. */
async function cameraToResults(page: Page, lang: Lang) {
  await expect(page.locator("h1")).toHaveText(T[lang].safety);
  await page.locator('[data-answer="no"]').click();
  const cam = page.locator(".cam2");
  await expect(cam).toBeVisible();
  await expect(cam).toHaveAttribute("data-variant", "booth");
  // Voice off by default, with the speaker button.
  await expect(page.locator(".cam2-sound")).toHaveAttribute("aria-pressed", "false");
  await expect(cam).toHaveAttribute("data-stage", "training", { timeout: 30_000 });
  await expect(page.locator("[data-done]")).toContainText(T[lang].wellDone, { timeout: 40_000 });
  await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: 10_000 });
}

/* ------------------------------------------------------------------ the staff code */

test("the staff code: the real server outside the booth days, then a pass; the code is never kept", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/?booth=1");
  await expect(page.locator("h1")).toHaveText(T.ar.title);
  await expect(page.locator('[data-screen="home"]')).toHaveCount(0);
  const code = page.getByLabel(T.ar.codeLabel);
  await expect(code).toHaveAttribute("type", "password");
  await code.fill("٤٨٢٩١٣");
  const verify = page.waitForRequest("**/api/booth/verify");
  await page.getByRole("button", { name: T.ar.turnOn }).click();
  expect((await verify).postDataJSON()).toEqual({ code: "482913" });
  // Today is not a booth day: no code works (O17).
  await expect(page.getByRole("alert")).toHaveText(T.ar.closed);
  await page.route("**/api/booth/verify", (r) =>
    json(r, { ok: true, session: SESSION, expires: Date.now() + HOUR }),
  );
  await page.getByRole("button", { name: T.ar.turnOn }).click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator("h1")).toHaveText(T.ar.home);
  const kept = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(kept).not.toContain("482913");
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem("azm.booth")))!)).toMatchObject({
    kind: "staff",
    session: SESSION,
  });
  // The parked movement check is linked from nowhere at the booth.
  expect(await page.locator('a[href*="check=1"], a[href*="booth=check"]').count()).toBe(0);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ Saad's story */

for (const lang of LANGS) {
  test(`Saad's story end to end (${lang})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    const reads: { body: any; booth: string | undefined }[] = [];
    await page.route("**/api/booth/report", async (r) => {
      reads.push({ body: r.request().postDataJSON(), booth: r.request().headers()["x-azm-booth"] });
      await json(r, LIVE);
    });
    const plans: any[] = [];
    await page.route("**/api/booth/plan", async (r) => {
      plans.push(r.request().postDataJSON());
      await json(r, { plan: { status: "ready" }, weekly: AI_WEEK });
    });
    await staffIn(page, lang);
    await expect(page.locator(".bx-dots")).toHaveCount(0);

    // Step 1: the sample report, read live.
    await page.locator('[data-door="story"]').click();
    await expect(page.locator("h1")).toHaveText(T[lang].reportTitle);
    await expect(page.locator(".bx-dots i.now")).toHaveCount(1);
    await expect(page.locator(".bx-doc img")).toHaveAttribute("src", "/booth/saad-report.png");
    await expect(page.locator('.bx-actions [data-action="next"]')).toHaveCount(0);
    await page.locator('[data-action="read"]').click();
    await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-reading", "read", {
      timeout: 10_000,
    });
    await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-source", "live");
    expect(reads).toHaveLength(1);
    expect(reads[0].body).toMatchObject({ session: SESSION, kind: "image", lang });
    expect(reads[0].body.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(reads[0].booth).toBe(SESSION);
    await expect(page.locator(".bx-chip")).toHaveCount(5);
    await expect(page.locator('.bx-chip[data-chip="medications"]')).toContainText("Baclofen");

    // Step 2: the medical engine on the phone.
    await next(page);
    await expect(page.locator("h1")).toHaveText(T[lang].engineStory);
    await expect(page.locator('[data-group="in"] [data-item]')).toHaveCount(2);
    await expect(page.locator('[data-group="adapt"] [data-item="rest"]')).toBeVisible();
    await expect(page.locator('[data-group="adapt"] [data-item="recovery"]')).toBeVisible();
    await expect(page.locator('[data-group="out"] [data-item="sit_to_stand"]')).toContainText(
      T[lang].notForWheelchair,
    );

    // Step 3: back to sport, wheelchair basketball chosen in the story.
    await next(page);
    await expect(page.locator('[data-pick="sport"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-sport="wheelchair_basketball"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The sports that suit a wheelchair come first.
    await expect(page.locator("[data-sport]").first()).toHaveAttribute("data-sport", "wheelchair_basketball");
    await next(page);

    // Step 4: the one question, then the camera; step 5: the starting point.
    await cameraToResults(page, lang);
    const range = Number(await page.locator('[data-screen="results"]').getAttribute("data-range"));
    expect(range).toBeGreaterThan(20);
    expect(range).toBeLessThan(180);
    await expect(page.locator(".bx-stats > div").first().locator("b")).toHaveText(lang === "ar" ? "5" : "5");
    await expect(page.locator("[data-example] .bx-tag")).toHaveText(T[lang].example);
    await expect(page.locator(".bx-dots i.done")).toHaveCount(4);

    // Step 6: the program, the AI week, the sport path, the register code.
    await page.locator('[data-action="program"]').click();
    await expect(page.locator("h1")).toHaveText(T[lang].programStory);
    await expect(page.locator(".bx-source")).toHaveText(T[lang].sourceAi);
    await expect(page.locator('[data-screen="program"]')).toHaveAttribute("data-source", "ai");
    // One request (development's StrictMode sends it twice and drops the first answer).
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans.every((p) => JSON.stringify(p) === JSON.stringify(plans[0]))).toBe(true);
    expect(plans[0]).toMatchObject({
      session: SESSION,
      intake: {
        conditions: ["sci_incomplete"],
        mobility: "wheelchair",
        goal: "sport",
        sport: "wheelchair_basketball",
      },
    });
    await expect(page.locator(".bx-day")).toHaveCount(3);
    await expect(page.locator(".bx-day").first()).toContainText(
      lang === "ar" ? "قوة الدفع" : "Pushing power",
    );
    await expect(page.locator("#sport-path-title")).toHaveText(T[lang].path);
    const qr = page.locator('[data-register="dock"] [data-qr]');
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute("data-qr")).toMatch(
      new RegExp(`/\\?app=1&register=1${lang === "en" ? "&lang=en" : ""}$`),
    );

    // Start again: the doors, and nothing of Saad's journey is left.
    await page.locator('[data-action="start-again"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("the reading engine never answers: Saad's cached reading after 8 s", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchConsole(page);
  await page.route("**/api/booth/report", () => new Promise(() => undefined));
  await staffIn(page, "en");
  await page.locator('[data-door="story"]').click();
  await page.locator('[data-action="read"]').click();
  const report = page.locator('[data-screen="report"]');
  await expect(report).toHaveAttribute("data-reading", "reading");
  await page.waitForTimeout(6000);
  await expect(report).toHaveAttribute("data-reading", "reading");
  await expect(report).toHaveAttribute("data-reading", "read", { timeout: 6000 });
  await expect(report).toHaveAttribute("data-source", "cached");
  await expect(page.locator('.bx-chip[data-chip="condition"]')).toHaveText(/Incomplete spinal cord injury/);
  expect(errors).toEqual([]);
});

test("without a reading engine (503) the cached reading shows at once, with no wait", async ({ page }) => {
  await page.route("**/api/booth/report", (r) => json(r, { error: "EXTRACTION_UNAVAILABLE" }, 503));
  await staffIn(page, "ar");
  await page.locator('[data-door="story"]').click();
  const t0 = Date.now();
  await page.locator('[data-action="read"]').click();
  await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-source", "cached", {
    timeout: 5000,
  });
  expect(Date.now() - t0).toBeLessThan(5000);
});

/* ------------------------------------------------------------------ try it as yourself */

for (const lang of LANGS) {
  test(`try it as yourself end to end (${lang})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    // The real server refuses the routed pass: the program falls back to the rules' week on the phone.
    const plans: any[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/booth/plan")) plans.push(r.postDataJSON());
    });
    await staffIn(page, lang);
    await page.locator('[data-door="self"]').click();

    // Tap 1: a condition that asks clearance first.
    const nextButton = page.locator('.bx-actions [data-action="next"]');
    await expect(nextButton).toBeDisabled();
    await page.locator('[data-condition="stroke"]').click();
    await expect(page.locator("[data-clearance]")).toHaveCount(3);
    await expect(nextButton).toBeDisabled();
    await page.locator('[data-clearance="yes"]').click();
    await next(page);
    // Tap 2 and 3: the position and the weaker side.
    await expect(page.locator('[data-screen="about"]')).toHaveAttribute("data-tap", "1");
    await page.locator('[data-pick="wheelchair"]').click();
    await next(page);
    await page.locator('[data-pick="left"]').click();
    await expect(page.locator('[data-pick="left"]')).toHaveAttribute("aria-checked", "true");
    await next(page);

    // The engine for this visitor: no weights at the booth, so the curl is left out.
    await expect(page.locator('[data-screen="engine"]')).toHaveAttribute("data-status", "ready");
    await expect(page.locator('[data-group="out"] [data-item="seated_biceps_curl"]')).toBeVisible();
    await next(page);

    // The goal: back to sport needs a sport.
    await page.locator('[data-pick="sport"]').click();
    await expect(nextButton).toBeDisabled();
    await page.locator('[data-sport="boccia"]').click();
    await next(page);

    await cameraToResults(page, lang);
    await page.locator('[data-action="program"]').click();
    await expect(page.locator('[data-screen="program"]')).toHaveAttribute("data-source", "engine");
    await expect(page.locator(".bx-source")).toHaveText(T[lang].sourceEngine);
    await expect(page.locator(".bx-day").first()).toBeVisible();
    await expect(page.locator(".sport-path")).toBeVisible();
    expect(plans[0]).toMatchObject({
      intake: {
        conditions: ["stroke"],
        clearance: "yes",
        mobility: "wheelchair",
        support: "left",
        sport: "boccia",
      },
    });
    expect(errors).toEqual([]);
  });
}

test("a visitor's report photo fills the taps; the plain notice line is under the button", async ({
  page,
}) => {
  const errors = watchConsole(page);
  const reads: any[] = [];
  await page.route("**/api/booth/report", async (r) => {
    reads.push(r.request().postDataJSON());
    await json(r, LIVE);
  });
  await staffIn(page, "en");
  await page.locator('[data-door="self"]').click();
  await expect(page.locator(".bx-photo-note")).toHaveText(
    "Azm reads your report once to fill in your answers, and does not keep it.",
  );
  await page.locator(".bx-photo input[type=file]").setInputFiles("public/booth/saad-report.png");
  await expect(page.locator('[data-photo="read"]')).toBeVisible();
  expect(reads[0]).toMatchObject({ session: SESSION, kind: "image", lang: "en" });
  // The reading filled the condition and the position; clearance stays the visitor's own answer.
  await expect(page.locator('[data-condition="sci_incomplete"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-clearance]")).toHaveCount(3);
  await page.locator('[data-clearance="yes"]').click();
  await next(page);
  await expect(page.locator('[data-pick="wheelchair"]')).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("a report photo the engine cannot read leaves the taps to the visitor", async ({ page }) => {
  await page.route("**/api/booth/report", (r) => json(r, { error: "ENGINE_FAILED" }, 502));
  await staffIn(page, "ar");
  await page.locator('[data-door="self"]').click();
  await page.locator(".bx-photo input[type=file]").setInputFiles("public/booth/saad-report.png");
  await expect(page.locator('[data-photo="failed"]')).toBeVisible();
  await expect(page.locator('[data-condition][aria-pressed="true"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ the rules say no, calmly */

test("a heart condition holds the plan for review: no camera, the reasons and the register code", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await staffIn(page, "en");
  await page.locator('[data-door="self"]').click();
  await page.locator('[data-condition="cardiac"]').click();
  await next(page);
  await page.locator('[data-pick="seated"]').click();
  await next(page);
  await page.locator('[data-pick="none"]').click();
  await next(page);
  await expect(page.locator('[data-screen="engine"]')).toHaveAttribute("data-status", "review");
  await expect(page.locator(".bx-review h2")).toHaveText(T.en.review);
  await next(page);
  await expect(page.locator('[data-screen="program"]')).toHaveAttribute("data-status", "review");
  await expect(page.locator(".cam2")).toHaveCount(0);
  await expect(page.locator(".bx-review li").first()).toContainText("Cardiac");
  await expect(page.locator('[data-register="dock"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("one arm: the rules leave the press out, so the goal leads to a week of guided cards, no camera", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await staffIn(page, "en");
  await page.locator('[data-door="self"]').click();
  await page.locator('[data-condition="upper_limb_unilateral"]').click();
  await expect(page.locator("[data-clearance]")).toHaveCount(0);
  await next(page);
  await page.locator('[data-pick="seated"]').click();
  await next(page);
  await page.locator('[data-pick="none"]').click();
  await next(page);
  // The engine: a ready plan, every camera movement left out, the library on its own line.
  const engine = page.locator('[data-screen="engine"]');
  await expect(engine).toHaveAttribute("data-status", "ready");
  await expect(page.locator('[data-group="out"] [data-item="seated_shoulder_press"]')).toBeVisible();
  await expect(page.locator('[data-group="in"] [data-item]')).toHaveCount(0);
  await expect(page.locator('[data-group="in"] .bx-item.lib')).toHaveText(
    /^\d+ safe exercises? from the Azm library$/,
  );
  await next(page);
  await page.locator('[data-pick="strength"]').click();
  await next(page);
  // No safety question and no camera: the week straight away, with no empty camera line.
  const program = page.locator('[data-screen="program"]');
  await expect(program).toHaveAttribute("data-status", "ready");
  await expect(page.locator(".cam2")).toHaveCount(0);
  await expect(page.locator(".bx-day").first()).toBeVisible();
  await expect(page.locator(".bx-every")).toHaveCount(0);
  await expect(page.locator('[data-register="dock"]')).toBeVisible();
  // Back returns to the goal, not to a camera result that never was.
  await page.locator('.bx-actions [data-action="back"]').click();
  await expect(page.locator('[data-screen="goal"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("yes to the safety question: a calm stop with the emergency line, then the doors", async ({ page }) => {
  await staffIn(page, "ar");
  await page.locator('[data-door="story"]').click();
  await page.locator('[data-action="read"]').click();
  await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-reading", "read");
  await next(page);
  await next(page);
  await next(page);
  await page.locator('[data-answer="yes"]').click();
  await expect(page.locator("h1")).toHaveText(T.ar.stop);
  await expect(page.locator('[data-call="997"]')).toHaveAttribute("href", "tel:997");
  await expect(page.locator(".cam2")).toHaveCount(0);
  await page.locator('[data-action="start-again"]').click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
});

/* ------------------------------------------------------------------ staff tools */

test("the staff menu: new visitor, the language, the coach voice; the shortcut resets anywhere", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await staffIn(page, "ar");
  await page.locator('[data-door="self"]').click();
  await page.locator('[data-condition="none"]').click();
  await next(page);
  await page.locator('[data-action="staff"]').click();
  const menu = page.getByRole("dialog", { name: T.ar.staff });
  await expect(menu).toBeVisible();
  // The voice is off by default; the switch is remembered on this device.
  const voice = menu.locator('[data-action="voice"]');
  await expect(voice).toHaveAttribute("aria-checked", "false");
  await voice.click();
  await expect(voice).toHaveAttribute("aria-checked", "true");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("azm.coach") ?? "{}"));
  expect(stored.voice).toBe("full");
  // The language: the same step, now in English.
  await menu.locator('[data-action="language"]').click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator('[data-screen="about"]')).toHaveAttribute("data-tap", "1");
  // New visitor: back to the doors, the answers gone.
  await page.locator('[data-action="staff"]').click();
  await page.locator('[data-staff-menu] [data-action="reset"]').click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await page.locator('[data-door="self"]').click();
  await expect(page.locator('[data-condition="none"]')).toHaveAttribute("aria-pressed", "false");
  // Alt Shift N, the staff shortcut, from any step.
  await page.locator('[data-condition="arthritis"]').click();
  await page.keyboard.press("Alt+Shift+KeyN");
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("the idle reset: 90 s without a touch on the program step goes back to the doors", async ({ page }) => {
  await page.clock.install();
  await staffIn(page, "en");
  await page.locator('[data-door="self"]').click();
  await page.locator('[data-condition="cardiac"]').click();
  await next(page);
  await page.locator('[data-pick="seated"]').click();
  await next(page);
  await page.locator('[data-pick="none"]').click();
  await next(page);
  await next(page);
  await expect(page.locator('[data-screen="program"]')).toBeVisible();
  // A touch keeps it.
  await page.clock.fastForward(60_000);
  await page.mouse.click(5, 300);
  await page.clock.fastForward(60_000);
  await expect(page.locator('[data-screen="program"]')).toBeVisible();
  // The calm note first, then the doors.
  await page.clock.fastForward(20_000);
  await expect(page.locator("[data-idle]")).toBeVisible();
  await page.clock.fastForward(12_000);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
});

test("the earlier steps never reset by themselves", async ({ page }) => {
  await page.clock.install();
  await staffIn(page, "ar");
  await page.locator('[data-door="story"]').click();
  await page.clock.fastForward(5 * 60_000);
  await expect(page.locator('[data-screen="report"]')).toBeVisible();
});

/* ------------------------------------------------------------------ design */

for (const lang of LANGS) {
  test(`every booth control is 56 px or more (${lang})`, async ({ page }) => {
    const small = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".bx button, .bx a[href]")]
          .filter((el) => el.getClientRects().length > 0 && !el.classList.contains("bx-scrim"))
          // The layout size, never a transform's: an entrance animation scales for a moment.
          .filter((el) => el.offsetHeight < 56 || el.offsetWidth < 56)
          .map(
            (el) =>
              `${el.className} ${el.textContent?.trim().slice(0, 24)} ${el.offsetWidth}x${el.offsetHeight}`,
          ),
      );
    await page.setViewportSize({ width: 1024, height: 768 });
    await staffIn(page, lang);
    expect(await small()).toEqual([]);
    await page.locator('[data-door="self"]').click();
    await page.locator('[data-condition="stroke"]').click();
    expect(await small()).toEqual([]);
    await page.locator('[data-clearance="yes"]').click();
    await next(page);
    expect(await small()).toEqual([]);
    await page.locator('[data-pick="seated"]').click();
    await next(page);
    await page.locator('[data-pick="none"]').click();
    await next(page);
    expect(await small()).toEqual([]);
    await next(page);
    await page.locator('[data-pick="sport"]').click();
    expect(await small()).toEqual([]);
    await page.locator('[data-action="staff"]').click();
    expect(await small()).toEqual([]);
  });
}

/* ------------------------------------------------------------------ axe */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Every serious or critical axe violation on the screen as it is now (at rest: reduced motion). */
async function audit(page: Page, where: string, problems: string[]) {
  await page.evaluate(() => document.fonts.ready);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of r.violations) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    problems.push(
      `${where}: ${v.id} (${v.impact}) ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
    );
  }
}

for (const lang of LANGS) {
  test(`axe ${lang}: every booth step at rest, on a tablet`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const problems: string[] = [];
    await page.route("**/api/booth/report", (r) => json(r, LIVE));
    await page.route("**/api/booth/plan", (r) => json(r, { plan: { status: "ready" }, weekly: AI_WEEK }));
    await page.route("**/api/booth/verify", (r) =>
      json(r, { ok: true, session: SESSION, expires: Date.now() + 3 * HOUR }),
    );
    await page.goto(url("/?booth=1&e2eTrace=full", lang));
    await audit(page, "code", problems);
    await page.getByLabel(T[lang].codeLabel).fill("482913");
    await page.getByRole("button", { name: T[lang].turnOn }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await audit(page, "home", problems);

    // Saad's story through the camera to the program.
    await page.locator('[data-door="story"]').click();
    await audit(page, "report", problems);
    await page.locator('[data-action="read"]').click();
    await expect(page.locator('[data-screen="report"]')).toHaveAttribute("data-reading", "read");
    await audit(page, "report read", problems);
    await next(page);
    await audit(page, "engine", problems);
    await page.locator('[data-action="staff"]').click();
    await audit(page, "staff menu", problems);
    await page.keyboard.press("Escape");
    await next(page);
    await audit(page, "goal", problems);
    await next(page);
    await audit(page, "safety", problems);
    await cameraToResults(page, lang);
    await audit(page, "results", problems);
    await page.locator('[data-action="program"]').click();
    await expect(page.locator('[data-screen="program"]')).toHaveAttribute("data-source", "ai");
    await audit(page, "program", problems);

    // Try it as yourself, the stop, and a plan held for review.
    await page.locator('[data-action="start-again"]').click();
    await page.locator('[data-door="self"]').click();
    await page.locator('[data-condition="stroke"]').click();
    await audit(page, "about condition", problems);
    await page.locator('[data-clearance="yes"]').click();
    await next(page);
    await page.locator('[data-pick="seated"]').click();
    await audit(page, "about position", problems);
    await next(page);
    await page.locator('[data-pick="left"]').click();
    await audit(page, "about side", problems);
    await next(page);
    await next(page);
    await page.locator('[data-pick="sport"]').click();
    await audit(page, "goal sport", problems);
    await page.locator('[data-sport="boccia"]').click();
    await next(page);
    await page.locator('[data-answer="yes"]').click();
    await audit(page, "stop", problems);
    await page.locator('[data-action="start-again"]').click();
    await page.locator('[data-door="self"]').click();
    await page.locator('[data-condition="cardiac"]').click();
    await next(page);
    await page.locator('[data-pick="seated"]').click();
    await next(page);
    await page.locator('[data-pick="none"]').click();
    await next(page);
    await audit(page, "engine review", problems);
    await next(page);
    await audit(page, "program review", problems);
    await context.close();
    expect(problems).toEqual([]);
  });
}
