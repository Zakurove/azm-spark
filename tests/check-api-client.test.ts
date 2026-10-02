/**
 * The movement check API client (src/features/assessment/api.ts), its result queue and the small
 * helpers of the shared UI, run against the real server on a temporary database (the same harness as
 * tests/assessments-api.test.ts): every endpoint of contract v2 E and v3 I, the 409 and 403 answers
 * the flow acts on, offline and network failures, and the flow adapters.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  conflict,
  createCheckApi,
  deviceInfo,
  lockReleasable,
  toSignedInContext,
  toStartResult,
  type CheckApi,
} from "../src/features/assessment/api";
import {
  DEFAULT_DEVICE,
  POSTABLE_SKIP_REASONS,
  initialModel,
  type ResultPayload,
} from "../src/features/assessment/flowMachine";
import { callOutcome, memoryStore, ResultQueue, retryDelaySec } from "../src/features/assessment/resultQueue";
import { queuedCallOf, snapshotOf } from "../src/features/assessment/useCheckFlow";
import { screenKeyOf } from "../src/features/assessment/CheckApp";
import { isBoothMode, readBoothPass } from "../src/features/assessment/boothMode";
import { announcementFor } from "../src/features/assessment/shared/CheckUi";
import { toggleMulti } from "../src/features/assessment/shared/answers";
import { minutesUnit, parseNumberInput } from "../src/features/assessment/shared/format";
import { detectPlatform } from "../src/features/assessment/shared/states";
import { onlineState } from "../src/features/assessment/shared/useOnline";
import { CLIENT_SKIP_REASONS } from "../server/modules/assessments/validate";
import { t } from "../src/i18n";
import { answersFor, intakeOf, member, resultBody, startApi, type Harness } from "./check-api-harness";

let h: Harness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => {
  await h.close();
});

/** A client whose requests go to the harness server as this person (cookie and origin set). */
function clientFor(cookie: string, online = true): CheckApi {
  return createCheckApi({
    transport: {
      online: () => online,
      fetch: ((url: string, init: RequestInit = {}) =>
        fetch(h.origin + url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), origin: h.origin, cookie },
        })) as typeof fetch,
    },
  });
}

let n = 0;
const email = () => `client${++n}@example.test`;

describe("check API client against the server", () => {
  it("context: the signed in context, normalised for the flow", async () => {
    const cookie = await member(h, email(), intakeOf());
    const r = await clientFor(cookie).getContext();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ctx?.position).toBe("chair");
    expect(r.value.consent).toBe(true);
    const c = toSignedInContext(r.value);
    expect(c.ctx).toEqual(r.value.ctx);
    expect(c.lock).toBeNull();
    // The harness opens home checks (AZM_CHECK_HOME=1).
    expect(c.homeOpen).toBe(true);
    expect(r.value.setting).toBe("home");
  });

  it("consent: accept and revoke; a start without consent is CONSENT_REQUIRED", async () => {
    const cookie = await member(h, email(), intakeOf(), false);
    const api = clientFor(cookie);
    const answers = await answersFor(h, cookie);
    const refused = await api.startCheck({ answers, device: deviceInfo(), setting: "home" });
    expect(refused.ok).toBe(false);
    expect(toStartResult(refused)).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    const wrong = await api.acceptConsent(999);
    expect(!wrong.ok && conflict(wrong.error)).toEqual({ code: "CONSENT_VERSION", version: 1 });
    const ok = await api.acceptConsent(1);
    expect(ok.ok && ok.value.version).toBe(1);
    const revoked = await api.revokeConsent();
    expect(revoked.ok).toBe(true);
  });

  it("start, results, between, stop, complete, list and progress", async () => {
    const cookie = await member(h, email(), intakeOf());
    const api = clientFor(cookie);
    const answers = await answersFor(h, cookie);
    const started = await api.startCheck({
      answers,
      device: deviceInfo({ coarse: false, fps: 28 }),
      setting: "home",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const s = toStartResult(started);
    expect(s.ok && s.protocol.length).toBeGreaterThan(0);
    const id = started.value.id;
    const item = started.value.protocol.find((p) => !p.skipped)!;
    const body = { ...resultBody(item, 120), poseModel: "full" } as unknown as ResultPayload;
    const saved = await api.postResult(id, body);
    expect(saved).toEqual({ ok: true, value: { saved: true } });
    const between = await api.postBetween(id, item.testId, item.side, "same");
    expect(between.ok && between.value.status).toBe("continue");
    const stop = await api.postStop(id, "choice");
    expect(stop.ok && stop.value).toMatchObject({ option: "choice", endsCheck: false, reason: "by_choice" });
    const done = await api.complete(id);
    expect(done.ok && done.value.id).toBe(id);
    const again = await api.complete(id);
    expect(!again.ok && conflict(again.error)).toEqual({ code: "NOT_OPEN", status: "completed" });
    const list = await api.listChecks();
    expect(list.ok && list.value.assessments[0].results.length).toBe(1);
    const progress = await api.getProgress();
    expect(progress.ok && progress.value.tests.length).toBeGreaterThan(0);
    // The next day question is not due yet.
    const after = await api.postAfter("usual");
    expect(!after.ok && conflict(after.error)).toEqual({ code: "NOT_DUE" });
  });

  it("409 POSTPONE with the lock, then 409 LOCKED on the next start", async () => {
    const cookie = await member(h, email(), intakeOf());
    const api = clientFor(cookie);
    const answers = await answersFor(h, cookie, { pc_unwell: "yes" });
    const postponed = await api.startCheck({ answers, device: deviceInfo(), setting: "home" });
    expect(postponed.ok).toBe(false);
    const p = toStartResult(postponed);
    expect(p).toMatchObject({ ok: false, code: "POSTPONE", status: "postpone", reason: "unwell" });
    const locked = toStartResult(
      await api.startCheck({ answers: await answersFor(h, cookie), device: deviceInfo(), setting: "home" }),
    );
    expect(locked).toMatchObject({ ok: false, code: "LOCKED", releasable: false });
    expect((locked as { until: number }).until).toBeGreaterThan(Date.now());
  });

  it("409 POSTPONE with status emergency for pc_urgent", async () => {
    const cookie = await member(h, email(), intakeOf());
    const r = toStartResult(
      await clientFor(cookie).startCheck({
        answers: await answersFor(h, cookie, { pc_urgent: "yes" }),
        device: deviceInfo(),
        setting: "home",
      }),
    );
    expect(r).toMatchObject({ ok: false, code: "POSTPONE", status: "emergency", screen: "scr_emergency" });
  });

  it("offline sends nothing; a network failure is reported", async () => {
    const fetchSpy = vi.fn();
    const offline = createCheckApi({ transport: { online: () => false, fetch: fetchSpy as never } });
    expect(await offline.getProgress()).toEqual({ ok: false, error: { kind: "offline" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    const onNetworkError = vi.fn();
    const broken = createCheckApi({
      onNetworkError,
      transport: {
        online: () => true,
        fetch: (() => Promise.reject(new TypeError("Failed to fetch"))) as never,
      },
    });
    expect(await broken.startCheck({ answers: {}, device: deviceInfo(), setting: "home" })).toEqual({
      ok: false,
      error: { kind: "network" },
    });
    expect(onNetworkError).toHaveBeenCalledOnce();
    expect(toStartResult({ ok: false, error: { kind: "offline" } })).toEqual({ ok: false, code: "offline" });
    expect(toStartResult({ ok: false, error: { kind: "network" } })).toEqual({ ok: false, code: "network" });
  });

  it("booth verify posts the code to /api/booth/verify (contract v3 I) with the request header", async () => {
    const calls: [string, RequestInit][] = [];
    const api = createCheckApi({
      transport: {
        online: () => true,
        fetch: (async (url: string, init: RequestInit) => {
          calls.push([url, init]);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as never,
      },
    });
    expect(await api.boothVerify("123456")).toEqual({ ok: true, value: { ok: true } });
    expect(calls[0][0]).toBe("/api/booth/verify");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ code: "123456" });
    expect((calls[0][1].headers as Record<string, string>)["X-Azm-Request"]).toBe("1");
  });
});

describe("conflicts and adapters", () => {
  const http = (status: number, body: Record<string, unknown>) =>
    ({ kind: "http", status, code: String(body.error), body }) as const;

  it("reads HOME_CLOSED, TOO_SOON, SKIPPED, NO_RESULTS and an unknown code", () => {
    expect(conflict(http(403, { error: "HOME_CLOSED" }))).toEqual({ code: "HOME_CLOSED" });
    expect(conflict(http(409, { error: "TOO_SOON", until: 5 }))).toEqual({ code: "TOO_SOON", until: 5 });
    expect(conflict(http(409, { error: "SKIPPED", reason: "pain_today" }))).toEqual({
      code: "SKIPPED",
      reason: "pain_today",
    });
    expect(conflict(http(409, { error: "NO_RESULTS" }))).toEqual({ code: "NO_RESULTS" });
    expect(conflict(http(500, { error: "SERVER" }))).toBeNull();
    expect(conflict({ kind: "offline" })).toBeNull();
    expect(toStartResult({ ok: false, error: http(403, { error: "HOME_CLOSED" }) })).toEqual({
      ok: false,
      code: "HOME_CLOSED",
    });
    expect(toStartResult({ ok: false, error: http(500, { error: "BOOM" }) })).toEqual({
      ok: false,
      code: "server",
    });
  });

  it("the lock reaches the flow as when it ends, whether the care team can release it and its {when}", () => {
    expect(lockReleasable({ releasableByClearance: true })).toBe(true);
    expect(lockReleasable({ releasableByClearance: false })).toBe(false);
    expect(lockReleasable({})).toBe(false);
    const c = toSignedInContext({
      setting: "home",
      setup: null,
      firstCheck: true,
      completedBefore: false,
      unresolvedChangeReported: false,
      faintReportedUnresolved: false,
      lastCheckLasting: false,
      lastPdDoseBucket: null,
      lock: { until: 10, releasableByClearance: false, when: { token: "nextDay_midnight" } },
      retestDue: null,
      earliestNext: null,
      early: false,
      sideLeanRepeat: null,
      openCheck: null,
      followUpDue: false,
      consent: true,
      consentVersion: 1,
      baselineRanges: {},
      baseTests: [],
      homeOpen: true,
      adultConfirmed: true,
    });
    expect(c.lock).toEqual({ until: 10, releasable: false, when: { token: "nextDay_midnight" } });
    const locked = conflict(
      http(409, {
        error: "LOCKED",
        until: 7,
        releasableByClearance: true,
        when: { token: "sameDay_clock", time: { hour: 3, minute: 5, suffix: "pm" } },
      }),
    );
    expect(locked).toEqual({
      code: "LOCKED",
      until: 7,
      releasable: true,
      when: { token: "sameDay_clock", time: { hour: 3, minute: 5, suffix: "pm" } },
    });
    // A {when} that does not fit is left out, never guessed.
    expect(conflict(http(409, { error: "LOCKED", until: 7, when: { time: 1 } }))).toEqual({
      code: "LOCKED",
      until: 7,
      releasable: false,
      when: null,
    });
    expect(conflict(http(403, { error: "ADULT_REQUIRED" }))).toEqual({ code: "ADULT_REQUIRED" });
    expect(conflict(http(409, { error: "STOPPED", reason: "by_choice" }))).toEqual({
      code: "STOPPED",
      reason: "by_choice",
    });
  });

  it("device facts stay inside the server's bounds", () => {
    expect(deviceInfo({ coarse: true, aspect: 99, fps: 0 })).toMatchObject({
      model: "lite",
      aspect: 0.5625,
      fps: 30,
    });
    expect(deviceInfo({ coarse: false, aspect: 1.78, fps: 24 })).toMatchObject({
      model: "full",
      aspect: 1.78,
      fps: 24,
    });
  });

  it("the postable skip reasons are the server's client skip reasons", () => {
    expect([...POSTABLE_SKIP_REASONS].sort()).toEqual([...CLIENT_SKIP_REASONS].sort());
  });
});

describe("result queue", () => {
  const body = { testId: "shoulder_abduction", side: "right" } as ResultPayload;

  it("sends in order, stops at a failure that may pass, drops one that never will", async () => {
    const sent: string[] = [];
    let offline = true;
    const api = {
      postResult: async (id: string) => {
        if (offline) return { ok: false as const, error: { kind: "network" as const } };
        sent.push(`result ${id}`);
        return id === "bad"
          ? {
              ok: false as const,
              error: { kind: "http" as const, status: 400, code: "RESULT_INVALID", body: {} },
            }
          : { ok: true as const, value: { saved: true as const } };
      },
      complete: async (id: string) => {
        sent.push(`complete ${id}`);
        return { ok: true as const, value: { id, completed: 1, symptomAsk: [] } };
      },
    };
    const q = new ResultQueue(api, memoryStore());
    const seen: number[] = [];
    q.onChange((st) => seen.push(st.waiting));
    await q.enqueue({ type: "result", checkId: "bad", body });
    await q.enqueue({ type: "result", checkId: "a", body });
    await q.enqueue({ type: "complete", checkId: "a" });
    expect(await q.flush()).toEqual({ sent: 0, dropped: 0, waiting: 3, auth: false });
    offline = false;
    expect(await q.flush()).toEqual({ sent: 2, dropped: 1, waiting: 0, auth: false });
    expect(sent).toEqual(["result bad", "result a", "complete a"]);
    expect(seen.at(-1)).toBe(0);
  });

  it("sends a call enqueued while a flush is running (no stranded completion)", async () => {
    const sent: string[] = [];
    let release: () => void = () => undefined;
    const first = new Promise<void>((r) => (release = r));
    const api = {
      postResult: async (id: string) => {
        if (id === "slow") await first;
        sent.push(`result ${id}`);
        return { ok: true as const, value: { saved: true as const } };
      },
      complete: async (id: string) => {
        sent.push(`complete ${id}`);
        return { ok: true as const, value: { id, completed: 1, symptomAsk: [] } };
      },
    };
    const q = new ResultQueue(api, memoryStore());
    await q.enqueue({ type: "result", checkId: "slow", body });
    const running = q.flush();
    // Two calls arrive while the first result is still pending, each with its own flush.
    await q.enqueue({ type: "result", checkId: "next", body });
    const second = q.flush();
    await q.enqueue({ type: "complete", checkId: "c" });
    const third = q.flush();
    release();
    await Promise.all([running, second, third]);
    expect(sent).toEqual(["result slow", "result next", "complete c"]);
    expect(await q.waiting()).toBe(0);
  });

  it("keeps stops, pain answers and the background start in order with the results", async () => {
    const sent: string[] = [];
    const ok = <T>(value: T) => ({ ok: true as const, value });
    const api = {
      postResult: async (_id: string, b: ResultPayload) => {
        sent.push(`result ${b.side}`);
        return ok({ saved: true as const });
      },
      postStop: async (_id: string, option: string) => {
        sent.push(`stop ${option}`);
        return ok({} as never);
      },
      postBetween: async (_id: string, _test: string, _side: string, answer: string) => {
        sent.push(`between ${answer}`);
        return ok({} as never);
      },
      startCheck: async () => {
        sent.push("start");
        return {
          ok: false as const,
          error: { kind: "http" as const, status: 409, code: "POSTPONE", body: { status: "postpone" } },
        };
      },
    };
    const q = new ResultQueue(api, memoryStore());
    const answers: string[] = [];
    q.onSent((call) => answers.push(call.type));
    await q.enqueue({ type: "result", checkId: "a", body: { ...body, side: "right" } });
    await q.enqueue({
      type: "between",
      checkId: "a",
      testId: "shoulder_abduction",
      side: "right",
      answer: "same",
    });
    await q.enqueue({ type: "result", checkId: "a", body: { ...body, side: "left" } });
    await q.enqueue({ type: "stop", checkId: "a", option: "chest" });
    await q.enqueue({
      type: "startBackground",
      answers: { pc_unwell: "yes" },
      device: DEFAULT_DEVICE,
    });
    expect(await q.flush()).toMatchObject({ sent: 5, dropped: 0, waiting: 0 });
    expect(sent).toEqual(["result right", "between same", "result left", "stop chest", "start"]);
    // 409 POSTPONE is the background start's expected answer: it leaves the outbox as sent.
    expect(answers).toEqual(["result", "between", "result", "stop", "startBackground"]);
  });

  it("never writes the background start (raw answers) to storage", async () => {
    const store = memoryStore();
    const q = new ResultQueue({}, store);
    await q.enqueue({
      type: "startBackground",
      answers: { pc_urgent: "yes" },
      device: DEFAULT_DEVICE,
    });
    await q.enqueue({ type: "stop", checkId: "a", option: "chest" });
    expect((await store.all()).map((c) => c.type)).toEqual(["stop"]);
    expect(await q.waiting()).toBe(2);
  });

  it("an ended session (401) keeps every call and reports sign in; stops only on network errors", async () => {
    let auth = true;
    const api = {
      postResult: async () =>
        auth
          ? {
              ok: false as const,
              error: { kind: "http" as const, status: 401, code: "AUTH_REQUIRED", body: {} },
            }
          : { ok: true as const, value: { saved: true as const } },
    };
    const q = new ResultQueue(api, memoryStore());
    await q.enqueue({ type: "result", checkId: "a", body });
    expect(await q.flush()).toEqual({ sent: 0, dropped: 0, waiting: 1, auth: true });
    auth = false;
    expect(await q.flush()).toEqual({ sent: 1, dropped: 0, waiting: 0, auth: false });
  });

  it("never sends one account's calls under another account signed in on the same phone", async () => {
    const store = memoryStore();
    const sent: string[] = [];
    const api = (who: string) => ({
      postStop: async (id: string) => {
        sent.push(`${who} stop ${id}`);
        return { ok: true as const, value: {} as never };
      },
      confirmAdult: async () => {
        sent.push(`${who} adult`);
        return { ok: true as const, value: { adultConfirmed: true as const, confirmedAt: 1 } };
      },
    });
    // Visitor A's calls wait (the network failed): A signs out.
    const a = new ResultQueue(
      { postStop: async () => ({ ok: false as const, error: { kind: "network" as const } }) },
      store,
      "user-a",
    );
    await a.enqueue({ type: "stop", checkId: "check-a", option: "chest" });
    await a.enqueue({ type: "adult" });
    expect((await a.flush()).waiting).toBe(2);
    // Visitor B signs in on the same phone: nothing of A's is sent with B's session.
    const b = new ResultQueue(api("b"), store, "user-b");
    expect(await b.waiting()).toBe(0);
    expect(await b.flush()).toEqual({ sent: 0, dropped: 0, waiting: 0, auth: false });
    expect(sent).toEqual([]);
    // A queue that knows no account sends nothing.
    expect((await new ResultQueue(api("x"), store).flush()).sent).toBe(0);
    expect(sent).toEqual([]);
    // A signs in again: A's calls go out under A.
    expect((await new ResultQueue(api("a"), store, "user-a").flush()).sent).toBe(2);
    expect(sent).toEqual(["a stop check-a", "a adult"]);
  });

  it("never queues the adult confirmation: it goes out at once with the session that gave it", () => {
    expect(queuedCallOf({ id: 1, type: "adult" })).toBeNull();
    expect(queuedCallOf({ id: 2, type: "stop", checkId: "c", option: "chest", ref: null })).toEqual({
      type: "stop",
      checkId: "c",
      option: "chest",
      ref: null,
    });
    expect(queuedCallOf({ id: 3, type: "complete", checkId: "c" })).toEqual({
      type: "complete",
      checkId: "c",
    });
  });

  it("drops calls older than two days, which the server could no longer take", async () => {
    const store = memoryStore();
    await store.put({ seq: 1, type: "stop", checkId: "old", option: "chest", owner: "u", at: 1 } as never);
    const q = new ResultQueue({}, store, "u");
    expect(await q.waiting()).toBe(0);
    expect(await store.all()).toEqual([]);
  });

  it("drops what the server refuses for good, and waits on busy or slow answers", () => {
    const http = (status: number, code: string) =>
      ({ ok: false, error: { kind: "http", status, code, body: {} } }) as const;
    const result = { type: "result" as const };
    expect(callOutcome(result, http(400, "RESULT_INVALID"))).toBe("drop");
    expect(callOutcome(result, http(404, "NOT_FOUND"))).toBe("drop");
    expect(callOutcome(result, http(409, "NOT_OPEN"))).toBe("drop");
    expect(callOutcome(result, http(401, "AUTH_REQUIRED"))).toBe("auth");
    expect(callOutcome(result, http(403, "AUTH_ORIGIN"))).toBe("auth");
    expect(callOutcome(result, http(429, "RATE_LIMIT"))).toBe("wait");
    expect(callOutcome(result, http(503, "SERVER"))).toBe("wait");
    expect(callOutcome(result, { ok: false, error: { kind: "network" } })).toBe("wait");
    expect(callOutcome({ type: "startBackground" }, http(409, "LOCKED"))).toBe("sent");
    expect(retryDelaySec(0)).toBe(5);
    expect(retryDelaySec(1)).toBe(15);
    expect(retryDelaySec(9)).toBe(60);
  });
});

describe("shared UI helpers", () => {
  it("the hidden announcer stays silent while the voice speaks the caption", () => {
    const c = { text: "Stay still", severity: "info" as const, speaking: true };
    expect(announcementFor(c, true)).toBeNull();
    expect(announcementFor(c, false)).toBe("Stay still");
    expect(announcementFor({ ...c, speaking: false }, true)).toBe("Stay still");
    expect(announcementFor(null, true)).toBeNull();
  });

  it("the exclusive none clears the other choices and the others clear none", () => {
    expect(toggleMulti(["back", "hip"], "none", "none")).toEqual(["none"]);
    expect(toggleMulti(["none"], "hip", "none")).toEqual(["hip"]);
    expect(toggleMulti(["hip"], "hip", "none")).toEqual([]);
    expect(toggleMulti(["hip"], "back")).toEqual(["hip", "back"]);
  });

  it("typed numbers accept ASCII, Arabic Indic and Persian digits and each decimal mark", () => {
    expect(parseNumberInput("2.5")).toBe(2.5);
    expect(parseNumberInput("٢٫٥")).toBe(2.5);
    expect(parseNumberInput("۲٫۵")).toBe(2.5);
    expect(parseNumberInput("2,5")).toBe(2.5);
    expect(parseNumberInput("٢،٥")).toBe(2.5);
    expect(parseNumberInput(" ١٢٠ ")).toBe(120);
    expect(parseNumberInput("12a")).toBeNull();
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("−5")).toBeNull();
  });

  it("the minute word follows the Arabic plural of the last number; one and two stand for the number", () => {
    expect(minutesUnit("ar", 1)).toBe("دقيقة واحدة");
    expect(minutesUnit("ar", 2)).toBe("دقيقتين");
    expect(minutesUnit("ar", 10)).toBe("دقائق");
    expect(minutesUnit("ar", 21)).toBe("دقيقة");
    expect(minutesUnit("en", 1)).toBe("minute");
    expect(minutesUnit("en", 21)).toBe("minutes");
    // Durations pass unit "min": the oblique dual after a preposition, never a numeral with it.
    expect(t("ar", "assessment.afterIntake.body", { minutesFrom: 16, minutesTo: 21, unit: "min" })).toContain(
      "نحو ١٦ إلى ٢١ دقيقة",
    );
    expect(t("ar", "assessment.afterIntake.body", { minutesFrom: 8, minutesTo: 10, unit: "min" })).toContain(
      "نحو ٨ إلى ١٠ دقائق",
    );
    // A range that starts at one or two minutes writes the word, not ١ or ٢, in Arabic.
    expect(t("ar", "assessment.plan.meta", { minutesFrom: 1, minutesTo: 2, unit: "min" })).toContain(
      "نحو دقيقة واحدة إلى دقيقتين",
    );
    expect(t("ar", "assessment.plan.meta", { minutesFrom: 2, minutesTo: 3, unit: "min" })).toContain(
      "نحو دقيقتين إلى ٣ دقائق",
    );
    expect(t("en", "assessment.plan.meta", { minutesFrom: 1, minutesTo: 2, unit: "min" })).toContain(
      "1 to 2 minutes",
    );
  });

  it("browser families for the camera permission steps", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari",
      ),
    ).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (iPhone) CriOS/120 Mobile Safari")).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Macintosh) Safari", 5)).toBe("ios");
    expect(
      detectPlatform("Mozilla/5.0 (Linux; Android 14) SamsungBrowser/24.0 Chrome/117 Mobile Safari"),
    ).toBe("samsung");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari")).toBe("other");
  });

  it("the offline banner rule and booth mode without storage", () => {
    expect(onlineState(true, false)).toBe(true);
    expect(onlineState(false, false)).toBe(false);
    expect(onlineState(true, true)).toBe(false);
    expect(readBoothPass()).toBeNull();
    expect(isBoothMode()).toBe(false);
  });

  it("the screen key changes with the screen, not with an overlay over it", () => {
    const m = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
    const q = { ...m, state: { kind: "question" as const, id: "pc_urgent" } };
    expect(screenKeyOf(q)).toBe("question:pc_urgent");
    expect(screenKeyOf({ ...q, overlay: { kind: "leave" } })).toBe(screenKeyOf(q));
    expect(screenKeyOf({ ...q, state: { kind: "question", id: "pc_unwell" } })).not.toBe(screenKeyOf(q));
  });

  it("the reload snapshot keeps no raw answers once the protocol is frozen", () => {
    const m = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
    const withAnswers = { ...m, data: { ...m.data, answers: { pc_urgent: "no" } } };
    expect(snapshotOf(withAnswers).data.answers).toEqual({ pc_urgent: "no" });
    const frozen = {
      ...withAnswers,
      data: {
        ...withAnswers.data,
        protocol: [{ testId: "shoulder_abduction", side: "right", version: 1, order: 1, band: "default" }],
      },
    } as typeof m;
    expect(snapshotOf(frozen).data.answers).toEqual({});
    expect(snapshotOf({ ...m, effects: [{ id: 1, type: "complete", checkId: "x" }] }).effects).toEqual([]);
  });
});
