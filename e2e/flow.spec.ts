/**
 * The flow screens S04 to S33 and S35 in the browser (flow stream, round 3), in Arabic and English:
 *
 *   guest booth walk   S05, S05a, the six steps with Back and the multiple choice rules, S14, the
 *                      sound check's two No answers, S16, every pre-check question to S27 (the pain
 *                      scale's select then Next), S28 and S31 into the camera with the fixture camera
 *   guest routes       a postponing answer (S33, no Back), talk to our team (S09), under 18 (S05a),
 *                      the SCI readiness list (S22 Not yet, S33, the list again)
 *   desktop            S04 with its QR code; continue only with an orientation sensor (O10)
 *   signed in, home    S12 consent (the tick is required), S13, S14 needs, S16, the examples lists,
 *                      the start call (mocked), S25, S27, S28, S26 helper briefing, S29 grip, S30 load
 *   paused             S35 with the care team release
 *   camera             S31 refused: S32 denied, Try again reloads back to S31; busy retries in place
 *
 * The signed in tests mock GET /api/assessments/context and POST /api/assessments with answers built
 * by the real rules (e2e/flow-models.ts, imported by the page from the dev server): home checks are
 * closed on the E2E server (AZM_CHECK_HOME is empty). Named states open through the check's reload
 * snapshot, the way S32 restores a check.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import ar from "../src/i18n/ar/assessment.json" with { type: "json" };
import en from "../src/i18n/en/assessment.json" with { type: "json" };
import data from "../src/movements/check-v1.json" with { type: "json" };

const COPY = { ar, en } as const;
type Lang = keyof typeof COPY;
const LANGS: Lang[] = ["ar", "en"];
const MOBILE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true };

const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;
const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (w, k: string) => (k in vars ? String(vars[k]) : w));
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** A copy line as the page shows it: Arabic Indic digits in Arabic (Q30). */
const shown = (lang: Lang, text: string) =>
  lang === "ar" ? text.replace(/(?<![A-Za-z])\d(?![A-Za-z])/g, (d) => AR_DIGITS[Number(d)]) : text;

interface Item {
  id: string;
  options?: { value: string; label: Record<Lang, string> }[];
  examples?: { ask: Record<Lang, string>; heading: Record<Lang, string> };
}
const ITEMS = data.precheck as unknown as Item[];
const item = (id: string) => ITEMS.find((i) => i.id === id)!;
const optionLabel = (id: string, value: string, lang: Lang) =>
  item(id).options!.find((o) => o.value === value)!.label[lang];

/** Console errors, except failed loads (the missing cue recordings fall back to speech, 401 before sign in). */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().startsWith("Failed to load resource")) return;
    errors.push(`${m.text()} @ ${m.location().url}`);
  });
  return errors;
}

const screen = (page: Page, id: string) => page.locator(`[data-screen="${id}"]`).first();

async function expectScreen(page: Page, id: string, lang: Lang) {
  await expect(screen(page, id)).toBeVisible();
  await expect(page.locator(".azm-check").first()).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator(".check-main h1")).toBeFocused();
}

/** Every visible control of the check is at least 48 px high (UX spec 0.5). */
async function expectTargets(page: Page) {
  for (const b of await page.locator(".azm-check button:visible, .azm-check a:visible").all()) {
    const box = await b.boundingBox();
    if (!box) continue;
    expect(box.height, (await b.innerText()).slice(0, 40)).toBeGreaterThanOrEqual(48);
  }
}

const answer = (page: Page, label: string) =>
  page.locator(".check-answers").getByRole("button", { name: label, exact: true }).first();
const next = (page: Page) => page.locator(".check-footer .cta");

/**
 * The answer that lets the check go ahead with nothing changed (tests/precheck-fixtures.ts benign),
 * by the base id of a question.
 */
function benignValue(base: string): string {
  switch (base) {
    case "pc_change_cleared":
    case "pc_trunk_armrests":
    case "pc_helper":
    case "pc_after_last":
    case "pc_weak_lift":
    case "pc_stand_no_hands":
    case "pc_sit_unsupported":
    case "pc_pd_on":
      return "yes";
    case "pc_arm_pain_side":
    case "pc_limb_arm_side":
    case "pc_limb_leg_side":
      return "right";
    case "pc_arm_function":
      return "bend_hold";
    case "pc_ms_one_arm":
      return "both";
    case "pc_pd_dose":
      return "1to2h";
    case "pc_sci_ready":
      return "done";
    default:
      return "no";
  }
}

/**
 * Answers the pre-check on screen until it leaves the questions: benign answers, a pain score on the
 * 0 to 10 scale (select, then Next, with the readout), and "none" on the areas.
 */
async function answerQuestions(page: Page, lang: Lang, pain = 0, seen: string[] = []) {
  for (let k = 0; k < 40; k++) {
    const q = page.locator("[data-question]").first();
    if (!(await q.isVisible().catch(() => false))) {
      await page.waitForTimeout(200);
      if (!(await q.isVisible().catch(() => false))) return seen;
    }
    const id = (await q.getAttribute("data-question"))!;
    const kind = (await q.getAttribute("data-screen"))!;
    seen.push(id);
    const base = id.split(":")[0];
    await expect(page.locator(".check-main h1")).toBeFocused();
    if (kind === "S19") {
      // Select, then Next (O11b): the readout says the value; Next without one shows the hint.
      await next(page).click();
      await expect(page.getByText(COPY[lang].common.chooseToContinue)).toBeVisible();
      await page
        .getByRole("radio", {
          name: shown(lang, fill(COPY[lang].precheck.scale.cellLabel, { value: pain, max: 10 })),
        })
        .click();
      await expect(page.locator(".flow-readout")).toHaveText(
        shown(lang, fill(COPY[lang].precheck.scale.chosen, { value: pain })),
      );
      await next(page).click();
    } else if (kind === "S20") {
      await answer(page, COPY[lang].precheck.areas.none).click();
      await next(page).click();
    } else if (kind === "S24" && id.endsWith(":areas")) {
      throw new Error("areas follow up not expected in this walk");
    } else {
      await answer(page, optionLabel(base, benignValue(base), lang)).click();
    }
    await expect(page.locator("[data-question]").first())
      .not.toHaveAttribute("data-question", id, {
        timeout: 5000,
      })
      .catch(() => undefined);
  }
  return seen;
}

/** Opens a named state of e2e/flow-models.ts through the check's reload snapshot. */
async function openState(page: Page, name: string, lang: Lang, query = "") {
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
  await page.goto(url((info.mode === "guest" ? "/?check=1" : "/") + query, lang));
  await expect(screen(page, info.screen)).toBeVisible();
  return info;
}

/** A throwaway signed in account with an intake (the E2E database). */
async function signIn(page: Page) {
  await page.goto("/?e2eGallery=loading");
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Sara",
      email: `flow-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: `${crypto.randomUUID()}Aa1`,
      adultConfirmed: true,
    },
  });
  expect(reg.status()).toBe(200);
  const intake = await page.request.put("/api/intake", {
    headers,
    data: {
      age: 45,
      conditions: ["none"],
      diagnosisNotes: "",
      medications: "",
      mobility: "seated",
      support: "left",
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
    },
  });
  expect(intake.status()).toBe(200);
}

/**
 * The server answers of a signed in home check, built in the page by the real rules: the context,
 * the consent, the start call (its protocol frozen from the answers sent) and the calls queued after.
 */
async function mockHome(
  page: Page,
  ctx: Record<string, unknown>,
  over: Record<string, unknown> = {},
): Promise<{ starts: unknown[] }> {
  const starts: unknown[] = [];
  const build = (fn: string, args: unknown[]) =>
    page.evaluate(
      async ({ fn, args }) => {
        const path = "/e2e/flow-models.ts";
        const mod = await import(/* @vite-ignore */ path);
        mod.setWalkClock(Date.now());
        return mod[fn](...args);
      },
      { fn, args },
    );
  await page.route("**/api/assessments/context*", async (route: Route) =>
    route.fulfill({ json: await build("contextResponse", [ctx, over]) }),
  );
  await page.route("**/api/consents", (route) => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route("**/api/assessments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { answers: Record<string, unknown> };
    starts.push(body);
    return route.fulfill({ status: 201, json: await build("startResponse", [ctx, body.answers]) });
  });
  await page.route("**/api/assessments/*/**", (route) =>
    route.request().method() === "POST" ? route.fulfill({ json: { saved: true } }) : route.fallback(),
  );
  return { starts };
}

/** Opens the signed in check at its entry (the context is then loaded, mocked). */
async function openSignedIn(page: Page, lang: Lang, query = "") {
  await page.goto("/?e2eGallery=loading");
  await page.evaluate(async () => {
    const path = "/src/features/assessment/flowMachine.ts";
    const mod = await import(/* @vite-ignore */ path);
    const m = mod.initialModel({ mode: "signedIn", booth: false, homeOpen: false, desktop: false });
    sessionStorage.removeItem("azm.booth");
    sessionStorage.setItem("azm.check.snapshot", JSON.stringify(m));
  });
  await page.goto(url(`/${query}`, lang));
}

/* ================================================================== guest */

for (const lang of LANGS) {
  test.describe(`flow screens, guest at the booth (${lang})`, () => {
    test.use(MOBILE);

    test("the whole walk from the welcome to the camera", async ({ page }) => {
      const t = COPY[lang];
      const errors = watchConsole(page);
      await page.addInitScript(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
      await page.goto(url("/?check=1&e2eFixture=seated-raise", lang));

      // S05: two equal paths, nothing saved, the booth badge.
      await expectScreen(page, "S05", lang);
      await expect(page.getByText(t.guest.notSaved)).toBeVisible();
      await expect(page.locator(".check-footer .cta")).toHaveCount(2);
      await expectTargets(page);
      await page.locator(".check-footer .cta").nth(1).click();

      // S05a: the data text first, a tap submits.
      await expectScreen(page, "S05a", lang);
      await answer(page, shown(lang, data.boundary.adultConfirm[lang])).click();

      // S06, S07: single choice submits on tap; Back keeps the answer.
      await expectScreen(page, "S06", lang);
      await expect(page.locator(".check-topbar-counter")).toHaveText(
        shown(lang, fill(t.common.stepOf, { n: 1, total: 6 })),
      );
      await answer(page, t.options.position.chair).click();
      await expectScreen(page, "S07", lang);
      await page.getByRole("button", { name: t.common.back }).click();
      await expectScreen(page, "S06", lang);
      await expect(answer(page, t.options.position.chair)).toHaveAttribute("aria-pressed", "true");
      await answer(page, t.options.position.chair).click();
      await answer(page, t.options.support.none).click();

      // S08: Next without a choice shows the hint and moves focus to the first row; none is exclusive.
      await expectScreen(page, "S08", lang);
      await next(page).click();
      await expect(page.getByText(t.common.chooseToContinue)).toBeVisible();
      const none = answer(page, data.selection.guestBooth.conditionsStep.noneChip[lang]);
      await expect(none).toBeFocused();
      await answer(page, t.options.condition.ms).click();
      await none.click();
      await expect(none).toHaveAttribute("aria-pressed", "true");
      await expect(answer(page, t.options.condition.ms)).toHaveAttribute("aria-pressed", "false");
      await next(page).click();

      // S08b: the Q19 question word for word.
      await expectScreen(page, "S08b", lang);
      await expect(page.locator("h1")).toHaveText(data.selection.guestBooth.clearance.ask[lang]);
      await answer(page, data.selection.guestBooth.clearance.options[0].label[lang]).click();
      for (const step of ["S10", "S11"]) {
        await expectScreen(page, step, lang);
        await answer(page, step === "S10" ? t.options.pain.none : t.options.restriction.none).click();
        await next(page).click();
      }

      // S14: the computed range in boundary.intro, the booth need line.
      await expectScreen(page, "S14", lang);
      await expect(page.locator('[data-part="duration"]')).toContainText(lang === "ar" ? "دقيقة" : "minutes");
      await expect(page.getByText(t.intro.need.booth)).toBeVisible();
      await expectTargets(page);
      await next(page).click();

      // S14b: No, then No again, then continue without sound.
      await expectScreen(page, "S14b", lang);
      const no = data.engine.soundCheck.options.find((o) => o.value === "no")!.label[lang];
      await answer(page, no).click();
      await expect(page.locator('[data-note="off"]')).toBeVisible();
      await answer(page, no).click();
      await expect(page.locator('[data-note="stillOff"]')).toBeVisible();
      await page.getByRole("button", { name: t.soundCheck.continueWithout }).click();

      // S16, then every question (the pain scale at 3 opens the areas question).
      await expectScreen(page, "S16", lang);
      await expect(page.getByText(t.precheck.helperReads)).toHaveCount(0);
      await next(page).click();
      const seen = await answerQuestions(page, lang, 3);
      expect(seen[0]).toBe("pc_urgent");
      expect(seen).toContain("pc_pain_now");
      expect(seen).toContain("pc_pain_areas");

      // S27: the frozen plan, no Back.
      await expectScreen(page, "S27", lang);
      await expect(page.getByRole("button", { name: t.common.back, exact: true })).toHaveCount(0);
      await expectTargets(page);
      await page.getByRole("button", { name: t.plan.start }).click();

      // S28: the booth phone step, every safety note, skip is there.
      await expectScreen(page, "S28", lang);
      await expect(page.getByText(t.primer.placeBooth).first()).toBeVisible();
      await expect(page.getByRole("button", { name: t.common.skipTest })).toBeVisible();
      await page.getByRole("button", { name: t.test.ready }).click();

      // S31: the fixture camera needs no prompt; the camera screens follow.
      await expectScreen(page, "S31", lang);
      await page.getByRole("button", { name: t.primer.allow }).click();
      await expect(page.locator('.check-base[data-state^="cam."]')).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("a postponing answer commits on tap: S33 with no Back, and the visit stays paused (S35)", async ({
      page,
    }) => {
      const t = COPY[lang];
      const errors = watchConsole(page);
      await openState(page, "S17-unwell-booth", lang);
      await answer(page, optionLabel("pc_unwell", "yes", lang)).click();
      await expectScreen(page, "S33", lang);
      await expect(page.locator("h1")).toHaveText(t.postpone.title);
      await expect(page.getByText(data.screens.scr_postpone_unwell[lang].split(".")[0])).toBeVisible();
      await expect(page.getByRole("button", { name: t.common.back, exact: true })).toHaveCount(0);
      await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
      // The visit keeps its lock: starting again shows paused today (S35), with no care team release.
      await page.getByRole("button", { name: t.guest.staff.restart }).click();
      await expectScreen(page, "S35", lang);
      await expect(page.locator("h1")).toHaveText(t.entry.locked.title);
      await expect(page.getByRole("button", { name: t.entry.locked.cleared })).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("routes to our team (S09) and ends kindly under 18 (S05a)", async ({ page }) => {
      const t = COPY[lang];
      await openState(page, "S09-talk-to-staff", lang);
      await expect(page.locator("h1")).toHaveText(t.guest.staff.titleBooth);
      await page.getByRole("button", { name: t.guest.staff.restart }).click();
      await expect(screen(page, "S05")).toBeVisible();
      await page.locator(".check-footer .cta").first().click();
      await answer(page, shown(lang, fill(t.adult.under, { age: 18 }))).click();
      await expect(page.locator('[data-variant="end"]')).toBeVisible();
      await expect(page.getByText(shown(lang, fill(t.adult.body, { age: 18 })))).toBeVisible();
    });

    test("SCI readiness: Not yet shows the list again, and Done returns to it (S22, S33)", async ({
      page,
    }) => {
      const t = COPY[lang];
      await openState(page, "S22-sci-ready", lang);
      await expect(page.getByText(t.precheck.checklist.hint)).toBeVisible();
      await answer(page, optionLabel("pc_sci_ready", "not_yet", lang)).click();
      await expectScreen(page, "S33", lang);
      await expect(page.locator("h1")).toHaveText(t.postpone.titleSci);
      await page.getByRole("button", { name: t.postpone.sciAgain }).click();
      await expect(page.locator('[data-question="pc_sci_ready"]')).toBeVisible();
    });

    test("the pain areas: each chosen area opens its own scale, and Next needs every score (S20)", async ({
      page,
    }) => {
      const t = COPY[lang];
      await openState(page, "S20-pain-areas", lang);
      const area = data.areas[0].label[lang];
      await answer(page, area).click();
      await expect(page.locator(".flow-area.is-on .flow-scale-cell")).toHaveCount(11);
      await next(page).click();
      await expect(page.getByText(t.common.chooseToContinue)).toBeVisible();
      await page.locator(".flow-area.is-on .flow-scale-cell").nth(2).click();
      await next(page).click();
      await expect(page.locator('[data-question="pc_pain_areas"]')).toHaveCount(0);
    });

    test("the skip dialog opens on its title with the way back first; Escape keeps the test (S28)", async ({
      page,
    }) => {
      const t = COPY[lang];
      await openState(page, "S28-arm-raise-booth", lang);
      await page.getByRole("button", { name: t.common.skipTest }).click();
      const dialog = page.getByRole("dialog", { name: t.skip.title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: t.skip.title })).toBeFocused();
      await expect(dialog.getByRole("button").first()).toHaveText(t.skip.cancel);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(screen(page, "S28")).toBeVisible();
      await page.getByRole("button", { name: t.common.skipTest }).click();
      await dialog.getByRole("button", { name: t.skip.confirm }).click();
      await expect(page.locator('.check-base[data-state="skipNotice"]')).toBeVisible();
    });

    test("camera refused: S32 names the fix, Try again reloads back to the primer", async ({ page }) => {
      const t = COPY[lang];
      await page.addInitScript(() => {
        const err = sessionStorage.getItem("e2e.gum") ?? "NotAllowedError";
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("e2e", err));
      });
      await openState(page, "S31-primer-booth", lang);
      await page.getByRole("button", { name: t.primer.allow }).click();
      await expectScreen(page, "S32", lang);
      await expect(page.locator('[data-screen="S32"]')).toHaveAttribute("data-variant", "denied");
      await expect(page.getByText(t.camera.denied.title)).toBeVisible();
      await page.evaluate(() => sessionStorage.setItem("e2e.gum", "NotReadableError"));
      await page.getByRole("button", { name: t.common.retry }).click();
      await expect(screen(page, "S31")).toBeVisible();
      await page.getByRole("button", { name: t.primer.allow }).click();
      await expect(page.locator('[data-screen="S32"]')).toHaveAttribute("data-variant", "busy");
      await expect(page.getByText(t.camera.busy.title)).toBeVisible();
    });
  });
}

/* ================================================================== desktop */

for (const lang of LANGS) {
  test(`S04 on a desktop: the QR code, and continue only with an orientation sensor (${lang})`, async ({
    page,
  }) => {
    const t = COPY[lang];
    await page.addInitScript(() => sessionStorage.setItem("azm.booth", "e2e-booth"));
    await page.goto(url("/?check=1", lang));
    await expectScreen(page, "S04", lang);
    await expect(page.getByRole("img", { name: t.desktop.qrAlt })).toBeVisible();
    await expect(page.locator("[data-qr]")).toHaveAttribute("data-qr", /\/\?check=1$/);
    await expect(page.getByRole("button", { name: t.desktop.continue })).toHaveCount(0);
    await page.goto(url("/?check=1&e2eOrientation=1", lang));
    await page.getByRole("button", { name: t.desktop.continue }).click();
    await expectScreen(page, "S05", lang);
  });
}

/* ================================================================== signed in */

for (const lang of LANGS) {
  test.describe(`flow screens, signed in at home (${lang})`, () => {
    test.use(MOBILE);

    test("first check: consent, context, intro, questions, start, warnings, plan, helper, grip and load", async ({
      page,
    }) => {
      const t = COPY[lang];
      const errors = watchConsole(page);
      await signIn(page);
      const ctx = { position: "chair", support: "left", conditions: ["none"], clearance: "yes" };
      const mocks = await mockHome(page, ctx, { consent: false });
      await openSignedIn(page, lang, "?e2eFixture=seated-raise");

      // S12: Continue without the tick says why and focuses the box; with it, the consent is sent.
      await expectScreen(page, "S12", lang);
      await next(page).click();
      await expect(page.getByText(t.consent.required)).toBeVisible();
      await expect(page.locator('input[type="checkbox"]')).toBeFocused();
      await page.locator(".flow-consent-row").click();
      await next(page).click();

      // S13: the intake in the person's words, never the conditions.
      await expectScreen(page, "S13", lang);
      await expect(page.locator("dt")).toHaveCount(4);
      await expect(page.getByText(t.context.sideLeft)).toBeVisible();
      await next(page).click();

      // S14: the personal needs with the helper for the side lean.
      await expectScreen(page, "S14", lang);
      await expect(page.getByText(t.intro.need.phone)).toBeVisible();
      await expect(page.getByText(t.intro.need.chairArmrests)).toBeVisible();
      await next(page).click();
      await expectScreen(page, "S14b", lang);
      await answer(page, data.engine.soundCheck.options[0].label[lang]).click();

      // S16 at home names the helper who may read the questions.
      await expectScreen(page, "S16", lang);
      await expect(page.getByText(t.precheck.helperReads)).toBeVisible();
      await next(page).click();

      // pc_unwell at home: the question, then the examples under "For example" (O45).
      await answer(page, optionLabel("pc_urgent", "no", lang)).click();
      await expect(page.locator('[data-question="pc_unwell"]')).toBeVisible();
      await expect(page.locator("h1")).toHaveText(item("pc_unwell").examples!.ask[lang]);
      await expect(page.getByText(item("pc_unwell").examples!.heading[lang])).toBeVisible();
      const seen = await answerQuestions(page, lang, 7);
      expect(seen).toContain("pc_helper:trunk_control_seated");

      // The start call ran with the answers; S25 shows the high pain caution.
      expect(mocks.starts).toHaveLength(1);
      await expectScreen(page, "S25", lang);
      // The card is a region named by its tone; at home in voice mode it is also read and captioned.
      await expect(
        page.getByRole("region", { name: t.tone.warn }).getByText(data.screens.warn_pain_high[lang]),
      ).toBeVisible();
      await next(page).click();

      // S27: the side lean with a helper.
      await expectScreen(page, "S27", lang);
      await expect(page.getByText(t.plan.withHelper)).toBeVisible();
      await page.getByRole("button", { name: t.plan.start }).click();

      // S28 arm raise at home: skip it (the skip dialog).
      await expectScreen(page, "S28", lang);
      await page.getByRole("button", { name: t.common.skipTest }).click();
      await page.getByRole("dialog").getByRole("button", { name: t.skip.confirm }).click();
      await page.evaluate(() =>
        (window as unknown as { e2eDispatch(e: { type: string }): void }).e2eDispatch({ type: "CONTINUE" }),
      );

      // S28 side lean, then S26 the helper briefing with the weaker side.
      await expectScreen(page, "S28", lang);
      await expect(page.locator('[data-screen="S28"]')).toHaveAttribute("data-test", "trunk_control_seated");
      await page.getByRole("button", { name: t.test.ready }).click();
      await expectScreen(page, "S26", lang);
      await expect(page.getByText(fill(t.helper.weakerSide, { side: t.helper.sideLeft }))).toBeVisible();
      await expect(page.getByText(data.helperBriefing.checkInLine[lang])).toBeVisible();
      await page.getByRole("button", { name: t.common.back }).click();
      await expectScreen(page, "S28", lang);
      await page.getByRole("button", { name: t.common.skipTest }).click();
      await page.getByRole("dialog").getByRole("button", { name: t.skip.confirm }).click();
      await page.evaluate(() =>
        (window as unknown as { e2eDispatch(e: { type: string }): void }).e2eDispatch({ type: "CONTINUE" }),
      );

      // S28 arm curl, then S29 grip per arm and S30 load per arm.
      await expectScreen(page, "S28", lang);
      await expect(page.locator('[data-screen="S28"]')).toHaveAttribute("data-test", "arm_curl_30s");
      await page.getByRole("button", { name: t.test.ready }).click();
      await expectScreen(page, "S29", lang);
      await answer(page, t.common.no).click();
      await expect(screen(page, "S29")).toBeVisible();
      await answer(page, t.common.no).click();
      await expectScreen(page, "S30", lang);
      const load = data.tests.find((x) => x.id === "arm_curl_30s")!.load!;
      const labelOf = (v: string) => load.options.find((o) => o.value === v)!.label[lang];
      await next(page).click();
      await expect(page.getByText(t.common.chooseToContinue)).toBeVisible();
      await answer(page, labelOf("bottle")).click();
      await page.getByRole("radio").nth(1).click();
      await next(page).click();
      await expect(screen(page, "S30")).toBeVisible();
      await answer(page, labelOf("dumbbell")).click();
      await page.getByRole("button", { name: t.load.increase }).click();
      await expect(page.locator(".flow-kg-input")).toHaveValue(shown(lang, lang === "ar" ? "1٫5" : "1.5"));
      await next(page).click();

      // S31 home: the placement line and the phone steady cue; Back returns to the load.
      // (The camera itself is not opened here: flowMachine sends the first camera test with a
      // preparation step back to that step after the primer; see the stream's foundation requests.)
      await expectScreen(page, "S31", lang);
      await expect(page.getByText(t.primer.place)).toBeVisible();
      await page.getByRole("button", { name: t.common.back, exact: true }).click();
      await expectScreen(page, "S30", lang);
      expect(errors).toEqual([]);
    });

    test("paused today: the lock line without its reason, and the care team release (S35)", async ({
      page,
    }) => {
      const t = COPY[lang];
      await signIn(page);
      await mockHome(
        page,
        { position: "chair" },
        {
          lock: {
            until: Date.now() + 6 * 3_600_000,
            releasableByClearance: true,
            when: { token: "nextDay_midnight" },
          },
        },
      );
      await openSignedIn(page, lang);
      await expectScreen(page, "S35", lang);
      await expect(page.locator("h1")).toHaveText(t.entry.locked.title);
      await expect(
        page.getByText(
          fill(data.screens.scr_paused_today[lang], { when: data.pausedWhenTokens.nextDay_midnight[lang] }),
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: t.entry.locked.cleared }).click();
      await expect(page.locator('[data-question="pc_change_cleared"]')).toBeVisible();
    });
  });
}
