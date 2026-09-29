/**
 * Data of the results and My results specs (e2e/results.spec.ts, e2e/results-shots.spec.ts):
 *   - a signed in account with a saved intake (the real server, a throwaway database);
 *   - reload snapshots of the check flow at its results state (useCheckFlow restores them), for the
 *     guest at the booth (S50) and the signed in first check and re-test (S51, S52);
 *   - stored results turned into GET /api/progress and GET /api/assessments answers by the real rules
 *     (seriesViews, which runs compareSeries) inside the page, so every verdict is one the rules give;
 *   - route mocks of the check API for the states the e2e server cannot reach (home checks are closed
 *     there, contract v3 I): each S01 variant, a populated My results, errors, delays.
 */
import { expect, type Page, type Route } from "@playwright/test";

export type Lang = "ar" | "en";
export const LANGS: Lang[] = ["ar", "en"];
export const DAY = 24 * 60 * 60 * 1000;

export const url = (path: string, lang: Lang) =>
  lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;

/** A signed in account with a saved intake (seated, chair), as the foundation specs make it. */
export async function signIn(page: Page, lang: Lang, tag: string): Promise<string> {
  await page.goto(url("/?e2eGallery=empty", lang));
  const headers = { Origin: new URL(page.url()).origin, "X-Azm-Request": "1" };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "E2E Results",
      email: `results-${tag}-${lang}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`,
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
    },
  });
  expect(intake.status()).toBe(200);
  return ((await reg.json()) as { user: { id: string } }).user.id;
}

/**
 * Puts a completion call in this account's outbox (IndexedDB, resultQueue.ts), so the results screen
 * shows a save that waits: "Not saved yet" offline, the save error online when the server refuses.
 */
export async function queueCompletion(page: Page, owner: string, checkId: string) {
  await page.evaluate(
    ({ owner, checkId }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("azm-check", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("queue", { keyPath: "seq" });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("queue", "readwrite");
          tx.objectStore("queue").put({ seq: 1, type: "complete", checkId, owner, at: Date.now() });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { owner, checkId },
  );
}

/* ------------------------------------------------------------ flow snapshots */

export interface Item {
  testId: string;
  side: "left" | "right" | "none";
  skipped?: string;
  variant?: string;
}

export type Outcome =
  | { status: "measured"; value: number; detail?: Record<string, unknown>; variant?: string | null }
  | { status: "notMeasured"; reason: string }
  | { status: "skipped"; reason: string };

/** The seated base check of a chair user, in run order (shoulder, side lean, arm curl). */
export const SEATED: Item[] = [
  { testId: "shoulder_abduction", side: "right" },
  { testId: "shoulder_abduction", side: "left" },
  { testId: "trunk_control_seated", side: "right" },
  { testId: "trunk_control_seated", side: "left" },
  { testId: "arm_curl_30s", side: "right" },
  { testId: "arm_curl_30s", side: "left" },
];

export const CURL = { loadObject: "dumbbell", loadKg: 2, view: "side", armrest: "removed", compensated: 0 };
export const LEAN = { chair: "e2e", armrests: true, armMode: "crossed", pivot: "hip", contact: false };
export const RAISE = { reference: "trunk", bentElbowAccepted: false };

/**
 * A reload snapshot of the flow at its results state (useCheckFlow restores it on the next mount):
 * the frozen protocol and what happened to each side.
 */
export function resultsSnapshot(o: {
  mode: "guest" | "signedIn";
  booth: boolean;
  homeOpen?: boolean;
  checkId?: string | null;
  checkKind?: "baseline" | "retest" | null;
  items: Item[];
  outcomes: Record<string, Outcome>;
  session?: "side_lean_only";
}): string {
  const protocol = o.items.map((it, i) => ({
    testId: it.testId,
    side: it.side,
    version: 1,
    order: i + 1,
    band: "default",
    ...(it.variant ? { variant: it.variant } : {}),
    ...(it.skipped ? { skipped: it.skipped } : {}),
  }));
  const outcomes: Record<string, unknown> = {};
  for (const [key, out] of Object.entries(o.outcomes)) {
    outcomes[key] =
      out.status === "measured"
        ? {
            status: "measured",
            value: out.value,
            payload: { value: out.value, detail: out.detail ?? {}, variant: out.variant ?? null },
          }
        : { status: out.status, reason: out.reason };
  }
  return JSON.stringify({
    state: { kind: "results" },
    overlay: null,
    effects: [],
    nextEffectId: 1,
    data: {
      config: {
        mode: o.mode,
        booth: o.booth,
        homeOpen: o.homeOpen ?? !o.booth,
        desktop: false,
        ...(o.session ? { session: o.session } : {}),
      },
      setting: o.booth ? "booth" : "home",
      device: { model: "lite", aspect: 0.5625, fps: 30, engineVersion: "e2e", appVersion: "0.1.0" },
      guestPath: o.mode === "guest" ? "full" : null,
      guest: o.mode === "guest" ? { position: "chair", support: "none" } : {},
      signedIn: null,
      env: null,
      base: [],
      answers: {},
      soundMode: "voice",
      warnings: [],
      helperRequired: [],
      protocol,
      tests: [],
      checkId: o.checkId ?? null,
      checkKind: o.checkKind ?? null,
      outcomes,
      cameraUsed: true,
      desktopPassed: true,
      run: { calibrated: false, practiced: false, saved: 0, retriesUsed: 0, calibrationRounds: 1 },
      lock: null,
      closed: false,
      checkIn: null,
      helperBriefing: {},
      stopped: null,
      noResponseAlarm: false,
      resuming: false,
      sameChair: {},
    },
  });
}

/** Opens a snapshot: the guest check at the booth, or the signed in check on Today. */
export async function openSnapshot(page: Page, lang: Lang, snapshot: string, guest: boolean) {
  await page.evaluate(
    ({ s, booth }) => {
      if (booth) sessionStorage.setItem("azm.booth", "e2e-booth");
      sessionStorage.setItem("azm.check.snapshot", s);
    },
    { s: snapshot, booth: guest },
  );
  await page.goto(url(guest ? "/?check=1" : "/", lang));
}

/* ------------------------------------------------------------ stored results and the rules */

export interface StoredSpec {
  testId: string;
  side: "left" | "right" | "none";
  setting?: "home" | "booth";
  daysAgo: number;
  value: number | null;
  skipped?: string;
  detail?: Record<string, number | boolean | string>;
  variant?: string | null;
}

export interface Built {
  tests: unknown[];
  checks: { id: string; setting: string; completed: number | null; status: string }[];
}

/**
 * GET /api/progress `tests` and GET /api/assessments `assessments` for these stored results, built in
 * the page by the real modules (seriesKey, seriesViews with compareSeries), grouped into one check per
 * day and setting. `now` is the page clock.
 */
export async function buildStored(
  page: Page,
  specs: StoredSpec[],
  opts: { ended?: number[] } = {},
): Promise<Built> {
  return page.evaluate(
    async ({ specs, ended }) => {
      const day = 24 * 60 * 60 * 1000;
      const series = await import("/server/modules/progress/series.ts" as string);
      const rules = await import("/src/medical/progress-rules.ts" as string);
      const data = await import("/src/movements/assessments.ts" as string);
      const now = Date.now();
      const stored = specs.map((s, i) => {
        const def = data.testDef(s.testId);
        const setting = s.setting ?? "home";
        const base = {
          testId: s.testId,
          side: s.side,
          setting,
          poseModel: "lite",
          movementVersion: def.version,
          detail: s.detail ?? {},
          position: "chair",
          variant: s.variant ?? null,
        };
        return {
          ...base,
          value: s.value,
          unit: def.unit,
          created: now - s.daysAgo * day + i,
          seriesKey: rules.seriesKey(base),
          flags: [],
          nValid: s.value === null ? 0 : 3,
          median: s.value,
          band: "default",
          skippedReason: s.skipped ?? (s.value === null ? "quality" : null),
          daysAgo: s.daysAgo,
        };
      });
      const ctxFor = (position: string) => ({
        position,
        support: "none",
        conditions: [],
        pain: [],
        setup: null,
      });
      const tests = series.seriesViews(
        stored.filter((r) => r.skippedReason === null),
        ctxFor,
        { lastCheckLasting: false },
      );
      const groups = new Map<string, typeof stored>();
      for (const r of stored) {
        const key = `${r.setting}:${r.daysAgo}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      const keys = [...groups.keys()].sort((a, b) => Number(b.split(":")[1]) - Number(a.split(":")[1]));
      const checks = keys.map((key, n) => {
        const rs = groups.get(key)!;
        const daysAgo = rs[0].daysAgo;
        const at = now - daysAgo * day;
        return {
          id: `e2e-${key.replace(":", "-")}`,
          kind: n === 0 ? "baseline" : "retest",
          setting: rs[0].setting,
          session: "full",
          status: ended.includes(daysAgo) ? "ended_early" : "completed",
          started: at - 20 * 60 * 1000,
          completed: at,
          endedReason: ended.includes(daysAgo) ? "stop" : null,
          setup: null,
          protocol: rs.map((r, i) => ({
            testId: r.testId,
            side: r.side,
            version: r.movementVersion,
            order: i + 1,
            band: "default",
            ...(r.skippedReason && r.skippedReason !== "quality" ? { skipped: r.skippedReason } : {}),
          })),
          results: rs.map((r) => ({
            testId: r.testId,
            side: r.side,
            value: r.value,
            unit: r.unit,
            attempts: [],
            quality: {},
            detail: r.detail,
            flags: [],
            nValid: r.nValid,
            median: r.median,
            skippedReason: r.skippedReason,
            variant: r.variant,
            poseModel: "lite",
            movementVersion: r.movementVersion,
            engineVersion: "e2e",
            band: "default",
            seriesKey: r.seriesKey,
            created: r.created,
          })),
        };
      });
      return { tests, checks };
    },
    { specs, ended: opts.ended ?? [] },
  );
}

/**
 * The series of a person with a history (S53): an arm raise right with four checks (higher, trend)
 * and a booth point, an arm raise left about the same, a side lean with its second starting check,
 * an arm curl left lower (the repeat offer) and right about the same.
 */
export const HISTORY: StoredSpec[] = [
  { testId: "shoulder_abduction", side: "right", setting: "booth", daysAgo: 100, value: 98, detail: RAISE },
  { testId: "shoulder_abduction", side: "right", daysAgo: 85, value: 100, detail: RAISE },
  { testId: "shoulder_abduction", side: "left", daysAgo: 85, value: 117, detail: RAISE },
  { testId: "trunk_control_seated", side: "right", daysAgo: 85, value: 16, detail: LEAN },
  { testId: "arm_curl_30s", side: "right", daysAgo: 85, value: 12, detail: CURL },
  { testId: "arm_curl_30s", side: "left", daysAgo: 85, value: 14, detail: CURL },
  { testId: "trunk_control_seated", side: "right", daysAgo: 82, value: 18, detail: LEAN },
  { testId: "shoulder_abduction", side: "right", daysAgo: 57, value: 106, detail: RAISE },
  { testId: "shoulder_abduction", side: "right", daysAgo: 29, value: 111, detail: RAISE },
  { testId: "shoulder_abduction", side: "right", daysAgo: 2, value: 122, detail: RAISE },
  { testId: "shoulder_abduction", side: "left", daysAgo: 2, value: 115, detail: RAISE },
  { testId: "arm_curl_30s", side: "right", daysAgo: 2, value: 13, detail: CURL },
  { testId: "arm_curl_30s", side: "left", daysAgo: 2, value: 7, detail: CURL },
];

/**
 * An open check that may still resume (O6): the arm raise done, stopped before the side lean, with
 * the context's openCheck naming it for the next 20 minutes.
 */
export function openCheck(now: number) {
  const result = (side: "left" | "right", value: number) => ({
    testId: "shoulder_abduction",
    side,
    value,
    unit: "deg",
    attempts: [],
    quality: {},
    detail: RAISE,
    flags: [],
    nValid: 3,
    median: value,
    skippedReason: null,
    variant: null,
    poseModel: "lite",
    movementVersion: 1,
    engineVersion: "e2e",
    band: "default",
    seriesKey: "e2e",
    created: now - 5 * 60 * 1000,
  });
  return {
    context: { openCheck: { id: "e2e-open", setting: "home", resumeUntil: now + 20 * 60 * 1000 } },
    check: {
      id: "e2e-open",
      kind: "baseline",
      setting: "home",
      session: "full",
      status: "open",
      started: now - 10 * 60 * 1000,
      completed: null,
      endedReason: null,
      setup: null,
      protocol: SEATED.map((it, i) => ({ ...it, version: 1, order: i + 1, band: "default" })),
      results: [result("right", 120), result("left", 112)],
    },
  };
}

/* ------------------------------------------------------------ the check API, mocked */

/** GET /api/assessments/context of a chair user with home checks open and nothing done yet. */
export function context(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ctx: {
      position: "chair",
      support: "none",
      pain: [],
      restrictions: [],
      conditions: ["none"],
      clearance: "yes",
    },
    setting: "home",
    homeOpen: true,
    adultConfirmed: true,
    setup: null,
    firstCheck: true,
    completedBefore: false,
    unresolvedChangeReported: false,
    faintReportedUnresolved: false,
    lastCheckLasting: false,
    sideLeanDoneAtHome: false,
    neededArmsLastStand: false,
    lastPdDoseBucket: null,
    lock: null,
    openCheck: null,
    retestDue: null,
    earliestNext: null,
    early: false,
    sideLeanRepeat: null,
    followUpDue: false,
    consent: true,
    consentVersion: 1,
    baselineRanges: {},
    baseTests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
    ...over,
  };
}

/** The sessions part of GET /api/progress: 8 weeks, the latest last. */
export function sessions(now: number, withData = true) {
  const done = [2, 3, 1, 3, 3, 2, 3, 2];
  const weeks = done.map((d, i) => ({
    start: new Date(now - (7 - i) * 7 * DAY).toISOString().slice(0, 10),
    done: withData ? d : 0,
    planned: 3,
    activeMinutes: withData ? d * 15 : 0,
  }));
  return {
    sessions: { weeks },
    validShare: withData ? 0.8 : null,
    avgEffort: withData ? 5 : null,
    activeMinutesPerWeek: withData ? 45 : null,
  };
}

export function progress(tests: unknown[], over: Record<string, unknown> = {}, now = Date.now()) {
  return {
    tests,
    retestDue: null,
    earliestNext: null,
    early: false,
    ...sessions(now, tests.length > 0),
    ...over,
  };
}

type Answer = unknown | { status: number; body?: unknown } | "offline";

export interface MockApi {
  context?: Answer;
  progress?: Answer;
  checks?: Answer;
  after?: Answer;
  /** Milliseconds before each answer (the loading states). */
  delay?: number;
}

const isStatus = (a: unknown): a is { status: number; body?: unknown } =>
  typeof a === "object" &&
  a !== null &&
  "status" in a &&
  typeof (a as { status: unknown }).status === "number";

async function answer(route: Route, a: Answer, delay = 0) {
  if (delay) await new Promise((r) => setTimeout(r, delay));
  try {
    if (a === "offline") return await route.abort("internetdisconnected");
    const status = isStatus(a) ? a.status : 200;
    const body = JSON.stringify(isStatus(a) ? (a.body ?? {}) : a);
    await route.fulfill({ status, contentType: "application/json", body });
  } catch {
    // The page moved on while the answer was delayed: the request is gone.
  }
}

/** Mocks the check API reads (and the next day answer); unset parts go to the real server. */
export async function mockApi(page: Page, m: MockApi) {
  await page.unroute("**/api/**");
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path === "/api/assessments/context" && m.context !== undefined)
      return answer(route, m.context, m.delay);
    if (req.method() === "GET" && path === "/api/progress" && m.progress !== undefined)
      return answer(route, m.progress, m.delay);
    if (req.method() === "GET" && path === "/api/assessments" && m.checks !== undefined)
      return answer(route, m.checks, m.delay);
    if (req.method() === "POST" && path === "/api/assessments/after" && m.after !== undefined)
      return answer(route, m.after, m.delay);
    return route.fallback();
  });
}

/** Console errors of a page, without the expected 401 of the signed out session check. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/status of (401|404|500|503)|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

/**
 * The smallest text on screen inside the check root, in CSS pixels (UX spec 0.4: nothing under 16 px):
 * HTML text at its computed size, SVG text at its size times the drawing's scale. The development
 * screen id chip and visually hidden text are left out.
 */
export async function smallestText(page: Page): Promise<{ px: number; text: string }> {
  return page.evaluate(() => {
    let min = { px: Infinity, text: "" };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && !el.closest(".check-visually-hidden, .check-stub-id");
    };
    for (const root of document.querySelectorAll(".azm-check")) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !n.textContent?.trim() || !visible(el)) continue;
        let px = parseFloat(getComputedStyle(el).fontSize);
        const svg = el.closest("svg");
        if (svg) {
          const box = svg.viewBox.baseVal;
          if (box && box.width > 0) px *= svg.getBoundingClientRect().width / box.width;
        }
        if (px < min.px) min = { px, text: n.textContent.trim().slice(0, 40) };
      }
    }
    return min;
  });
}
