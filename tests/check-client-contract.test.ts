/**
 * The round 3 server contract as the check client reads it (src/features/assessment/api.ts and its
 * outbox), against the real server on a temporary database (tests/check-api-harness.ts):
 *
 *   - the context fields (homeOpen, adultConfirmed, faintReportedUnresolved, early, sideLeanRepeat,
 *     openCheck) and the lock view { until, releasableByClearance, when } with no reason;
 *   - the start: ADULT_REQUIRED, NOT_OFFERED, status, checkIn, helperBriefing, session, boothToken;
 *   - the stop naming its test side, STOPPED, qualityRetries and the new skip reasons;
 *   - the end question, the faint follow up, the alarm, the resume and the adult confirmation;
 *   - the booth verify, token and redeem routes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  conflict,
  createCheckApi,
  deviceInfo,
  lockReleasable,
  resumeCheckOf,
  toSignedInContext,
  toStartResult,
  type CheckApi,
  type ContextResponse,
} from "../src/features/assessment/api";
import { callOutcome, memoryStore, ResultQueue } from "../src/features/assessment/resultQueue";
import {
  flowReducer,
  initialModel,
  type FlowEvent,
  type ResultPayload,
} from "../src/features/assessment/flowMachine";
import { riyadhDate, type Answers } from "../src/medical/precheck";
import { benign } from "./precheck-fixtures";
import {
  answersFor,
  intakeOf,
  member,
  resultBody,
  startApi,
  WHEELCHAIR_STROKE,
  type Harness,
} from "./check-api-harness";

let h: Harness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  delete process.env.AZM_BOOTH_CODE;
  delete process.env.AZM_BOOTH_DATES;
  process.env.AZM_CHECK_HOME = "1";
});

function clientFor(cookie: string): CheckApi {
  return createCheckApi({
    transport: {
      online: () => true,
      fetch: ((url: string, init: RequestInit = {}) =>
        fetch(h.origin + url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), origin: h.origin, cookie },
        })) as typeof fetch,
    },
  });
}

let n = 0;
const email = () => `contract${++n}@example.test`;

async function started(cookie: string, given = {}) {
  const api = clientFor(cookie);
  const r = await api.startCheck({
    answers: await answersFor(h, cookie, given),
    device: deviceInfo(),
    setting: "home",
  });
  if (!r.ok) throw new Error(`start: ${JSON.stringify(r.error)}`);
  return { api, check: r.value };
}

describe("context (round 3)", () => {
  it("carries the flags the flow reads and passes faintReportedUnresolved into the pre-check", async () => {
    const cookie = await member(h, email(), intakeOf());
    const r = await clientFor(cookie).getContext();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      homeOpen: true,
      adultConfirmed: true,
      faintReportedUnresolved: false,
      early: false,
      sideLeanRepeat: null,
      openCheck: null,
    });
    const c = toSignedInContext(r.value);
    expect(c).toMatchObject({
      homeOpen: true,
      adultConfirmed: true,
      faintReportedUnresolved: false,
      early: false,
      sideLeanRepeat: null,
      openCheck: null,
    });
  });

  it("reads home checks closed from the server flag", async () => {
    const cookie = await member(h, email(), intakeOf());
    delete process.env.AZM_CHECK_HOME;
    const r = await clientFor(cookie).getContext();
    expect(r.ok && toSignedInContext(r.value).homeOpen).toBe(false);
  });

  it("names the open check while it may resume", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const r = await api.getContext();
    expect(r.ok && r.value.openCheck).toMatchObject({ id: check.id, setting: "home" });
    const c = r.ok ? toSignedInContext(r.value) : null;
    expect(c?.openCheck?.id).toBe(check.id);
    expect(c?.openCheck?.resumeUntil).toBeGreaterThan(Date.now());
  });

  it("the lock is { until, releasableByClearance, when } and the flow never sees a reason", async () => {
    const cookie = await member(h, email(), intakeOf());
    const api = clientFor(cookie);
    const postponed = await api.startCheck({
      answers: await answersFor(h, cookie, { pc_unwell: "yes" }),
      device: deviceInfo(),
      setting: "home",
    });
    expect(postponed.ok).toBe(false);
    const p = toStartResult(postponed);
    expect(p).toMatchObject({ ok: false, code: "POSTPONE", status: "postpone" });
    const lock = (p as { lock: { until: number; when: { token: string } } }).lock;
    expect(lock.until).toBeGreaterThan(Date.now());
    expect(typeof lock.when.token).toBe("string");

    const ctx = await api.getContext();
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;
    expect(Object.keys(ctx.value.lock ?? {}).sort()).toEqual(["releasableByClearance", "until", "when"]);
    const c = toSignedInContext(ctx.value);
    expect(c.lock).toMatchObject({ until: lock.until, releasable: false });
    expect(c.lock?.when?.token).toBeTruthy();

    const locked = toStartResult(
      await api.startCheck({ answers: await answersFor(h, cookie), device: deviceInfo(), setting: "home" }),
    );
    expect(locked).toMatchObject({ ok: false, code: "LOCKED", releasable: false });
    expect((locked as { when: { token: string } }).when.token).toBeTruthy();
  });

  it("a lock is releasable only when the server says so; a missing flag never releases", () => {
    expect(lockReleasable({ releasableByClearance: true })).toBe(true);
    expect(lockReleasable({ releasableByClearance: false })).toBe(false);
    // The reason is no longer sent (Q25 (c)); a stray one never makes a lock releasable.
    const stray = { reason: "recent_change" } as { releasableByClearance?: unknown };
    expect(lockReleasable(stray)).toBe(false);
    expect(lockReleasable({})).toBe(false);
  });
});

describe("start (round 3)", () => {
  it("403 ADULT_REQUIRED until the account holds the adult confirmation, then starts", async () => {
    const cookie = await member(h, email(), intakeOf(), true, false);
    const api = clientFor(cookie);
    const answers = await answersFor(h, cookie);
    const refused = await api.startCheck({ answers, device: deviceInfo(), setting: "home" });
    expect(toStartResult(refused)).toEqual({ ok: false, code: "ADULT_REQUIRED" });
    const ctx = await api.getContext();
    expect(ctx.ok && ctx.value.adultConfirmed).toBe(false);
    const adult = await api.confirmAdult();
    expect(adult.ok && adult.value.adultConfirmed).toBe(true);
    expect(adult.ok && adult.value.confirmedAt).toBeGreaterThan(0);
    const ok = await api.startCheck({ answers, device: deviceInfo(), setting: "home" });
    expect(ok.ok).toBe(true);
  });

  it("the start answers status, checkIn and helperBriefing, and the flow result keeps them", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { check } = await started(cookie);
    expect(check.status).toBe("open");
    expect(check.checkIn).toMatchObject({ raiseAllowed: expect.any(Boolean) });
    expect(check.helperBriefing).toEqual(expect.any(Object));
    const s = toStartResult({ ok: true, value: check });
    expect(s).toMatchObject({ ok: true, status: "open", checkIn: check.checkIn });
  });

  it("403 HOME_CLOSED while home checks are closed", async () => {
    const cookie = await member(h, email(), intakeOf());
    const answers = await answersFor(h, cookie);
    delete process.env.AZM_CHECK_HOME;
    const r = await clientFor(cookie).startCheck({ answers, device: deviceInfo(), setting: "home" });
    expect(toStartResult(r)).toEqual({ ok: false, code: "HOME_CLOSED" });
  });

  it("409 NOT_OFFERED for the side lean session outside its window", async () => {
    const cookie = await member(h, email(), WHEELCHAIR_STROKE);
    const r = await clientFor(cookie).startCheck({
      answers: await answersFor(h, cookie),
      device: deviceInfo(),
      setting: "home",
      session: "side_lean_only",
    });
    expect(toStartResult(r)).toEqual({ ok: false, code: "NOT_OFFERED" });
  });
});

describe("stop, results and the new skip reasons", () => {
  it("the stop names its test side; the server keeps the stopped row and refuses a later score", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const item = check.protocol.find((p) => !p.skipped)!;
    const stop = await api.postStop(check.id, "choice", { testId: item.testId, side: item.side });
    expect(stop.ok && stop.value).toMatchObject({ option: "choice", reason: "by_choice", lock: null });
    const score = await api.postResult(check.id, resultBody(item, 100) as unknown as ResultPayload);
    expect(!score.ok && conflict(score.error)).toEqual({ code: "STOPPED", reason: "by_choice" });
    // The client's own skip for it is accepted and changes nothing.
    const skip = await api.postResult(check.id, {
      ...(resultBody(item, 0) as unknown as ResultPayload),
      value: null,
      attempts: [],
      nValid: 0,
      median: null,
      skippedReason: "by_choice",
    });
    expect(skip).toEqual({ ok: true, value: { saved: true } });
    const list = await api.listChecks();
    const row = list.ok ? list.value.assessments[0].results.find((r) => r.testId === item.testId) : null;
    expect(row).toMatchObject({ skippedReason: "by_choice", flags: ["stopped"] });
  });

  it("a stop naming a test side that is not in the protocol is STOP_INVALID and drops from the outbox", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const r = await api.postStop(check.id, "choice", { testId: "chair_stand_30s", side: "left" });
    expect(!r.ok && r.error.kind === "http" && r.error.code).toBe("STOP_INVALID");
    expect(callOutcome({ type: "stop" }, r)).toBe("drop");
  });

  it("results carry qualityRetries; motion_needed, chair_needed and helper_needed skips are posted", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const runnable = check.protocol.filter((p) => !p.skipped);
    const scored = await api.postResult(check.id, {
      ...(resultBody(runnable[0], 110) as unknown as ResultPayload),
      qualityRetries: 2,
    });
    expect(scored).toEqual({ ok: true, value: { saved: true } });
    for (const reason of ["motion_needed", "chair_needed", "helper_needed"]) {
      const item = runnable[1];
      const r = await api.postResult(check.id, {
        ...(resultBody(item, 0) as unknown as ResultPayload),
        value: null,
        attempts: [],
        nValid: 0,
        median: null,
        skippedReason: reason,
      });
      expect(r).toEqual({ ok: true, value: { saved: true } });
    }
  });
});

describe("end, faint, alarm and complete", () => {
  it("GET /end gives the question form; no proceeds, then complete answers { id, completed }", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const item = check.protocol.find((p) => !p.skipped)!;
    await api.postResult(check.id, resultBody(item, 120) as unknown as ResultPayload);
    const form = await api.getEnd(check.id);
    expect(form.ok && form.value).toEqual({ question: "ec_symptoms", side: null, chronicNote: false });
    const no = await api.postEnd(check.id, "no");
    expect(no).toEqual({ ok: true, value: { status: "proceed" } });
    const done = await api.complete(check.id);
    expect(done.ok && Object.keys(done.value).sort()).toEqual(["completed", "id"]);
  });

  it("an end yes opens the emergency screen with the lock and closes the check itself", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const item = check.protocol.find((p) => !p.skipped)!;
    await api.postResult(check.id, resultBody(item, 120) as unknown as ResultPayload);
    const yes = await api.postEnd(check.id, "yes");
    expect(yes.ok && yes.value).toMatchObject({ status: "emergency", screen: "scr_emergency", alsoShow: [] });
    expect(yes.ok && yes.value.status === "emergency" && yes.value.lock?.until).toBeGreaterThan(Date.now());
    const again = await api.complete(check.id);
    expect(!again.ok && conflict(again.error)).toEqual({ code: "NOT_OPEN", status: "completed" });
  });

  it("the faint follow up after a faint stop; NOT_STOPPED on a check that was not stopped", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const early = await api.postFaint(check.id, { answer: "no" });
    expect(!early.ok && early.error.kind === "http" && early.error.code).toBe("NOT_STOPPED");
    const item = check.protocol.find((p) => !p.skipped)!;
    const stop = await api.postStop(check.id, "faint", { testId: item.testId, side: item.side });
    expect(stop.ok && stop.value).toMatchObject({ endsCheck: true, then: "sf_faint_loc" });
    const yes = await api.postFaint(check.id, { answer: "yes", testId: item.testId });
    expect(yes.ok && yes.value).toMatchObject({ status: "emergency", screen: "scr_emergency" });
    expect(yes.ok && yes.value.lock?.until).toBeGreaterThan(Date.now());
    // The alarm is still recorded on a check that ended early (the fall watch).
    expect(await api.postAlarm(check.id, { kind: "no_response" })).toEqual({
      ok: true,
      value: { recorded: true },
    });
  });

  it("the alarm records a no response or a help request on an open check", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const item = check.protocol.find((p) => !p.skipped)!;
    expect(await api.postAlarm(check.id, { kind: "help_requested", testId: item.testId })).toEqual({
      ok: true,
      value: { recorded: true },
    });
  });
});

/**
 * The O6 re-ask as the phone asks it: the flow machine resumes the open check from the server's
 * context and list (resumeCheckOf), runs the line and the sound check, answers each re-ask question
 * (benign unless given) and returns the answers of its resume call.
 */
async function reask(api: CheckApi, given: Answers = {}): Promise<Answers> {
  const c = await api.getContext();
  const list = await api.listChecks();
  if (!c.ok || !list.ok) throw new Error("context");
  const check = resumeCheckOf(c.value.openCheck, list.value.assessments);
  if (!check) throw new Error("no open check");
  let m = [
    { type: "RESUME", context: toSignedInContext(c.value), check },
    { type: "CONTINUE" },
    { type: "SOUND_RESULT", mode: "voice" },
  ].reduce(
    (acc, e) => flowReducer(acc, e as FlowEvent),
    initialModel({ mode: "signedIn", booth: false, homeOpen: true, desktop: false }),
  );
  for (let k = 0; k < 30 && m.state.kind === "question"; k++) {
    const id = m.state.id;
    m = flowReducer(m, { type: "ANSWER", id, value: id in given ? given[id] : benign(id) });
  }
  const call = m.effects.find((e) => e.type === "resume" || e.type === "resumeBackground");
  if (!call || !("answers" in call)) throw new Error(`no resume call from ${m.state.kind}`);
  return call.answers;
}

describe("resume (O6)", () => {
  it("proceeds with the re-ask answers; a postpone closes the check as ended early", async () => {
    const cookie = await member(h, email(), intakeOf());
    const { api, check } = await started(cookie);
    const item = check.protocol.find((p) => !p.skipped)!;
    await api.postResult(check.id, resultBody(item, 120) as unknown as ResultPayload);
    const ok = await api.resume(check.id, await reask(api));
    expect(ok.ok && ok.value).toMatchObject({ status: "proceed", skips: [], warnings: expect.any(Array) });
    const postponed = await api.resume(check.id, await reask(api, { pc_unwell: "yes" }));
    expect(!postponed.ok && conflict(postponed.error)).toMatchObject({
      code: "POSTPONE",
      status: "postpone",
      reason: "unwell",
    });
    const list = await api.listChecks();
    expect(list.ok && list.value.assessments[0]).toMatchObject({
      status: "ended_early",
      endedReason: "stop",
      session: "full",
    });
    const incomplete = await api.resume(check.id, {});
    expect(!incomplete.ok && conflict(incomplete.error)).toMatchObject({ code: "NOT_OPEN" });
  });

  it("the phone's re-ask is the server's for SCI in a wheelchair (the SCI and helper questions)", async () => {
    const cookie = await member(
      h,
      email(),
      intakeOf({ conditions: ["sci_complete"], mobility: "wheelchair", clearance: "yes" }),
    );
    // SCI at T6 or above: the level is kept with the check's setup, which the re-ask reads.
    const { api, check } = await started(cookie, { pc_sci_level: "yes" });
    const item = check.protocol.find((p) => !p.skipped)!;
    await api.postResult(check.id, resultBody(item, 100) as unknown as ResultPayload);
    const answers = await reask(api);
    expect(Object.keys(answers)).toContain("pc_sci_ad_now");
    const ok = await api.resume(check.id, answers);
    expect(ok.ok && ok.value.status).toBe("proceed");
  });

  it("the background resume (raw answers) never touches storage and treats POSTPONE as sent", async () => {
    const store = memoryStore();
    const calls: string[] = [];
    const q = new ResultQueue(
      {
        resume: async (id) => {
          calls.push(id);
          return {
            ok: false,
            error: { kind: "http", status: 409, code: "POSTPONE", body: { error: "POSTPONE" } },
          };
        },
      },
      store,
    );
    await q.enqueue({ type: "resumeBackground", checkId: "c1", answers: { pc_unwell: "yes" } });
    expect(await store.all()).toEqual([]);
    expect(await q.flush()).toMatchObject({ sent: 1, waiting: 0 });
    expect(calls).toEqual(["c1"]);
  });
});

describe("booth (O17)", () => {
  it("verify: closed outside the booth days, a session on a booth day, never the code", async () => {
    const api = createCheckApi({
      transport: {
        online: () => true,
        fetch: ((url: string, init: RequestInit = {}) =>
          fetch(h.origin + url, {
            ...init,
            headers: {
              ...(init.headers as Record<string, string>),
              origin: h.origin,
              "x-forwarded-for": "203.0.113.77",
            },
          })) as typeof fetch,
      },
    });
    process.env.AZM_BOOTH_CODE = "553311";
    process.env.AZM_BOOTH_DATES = "2020-01-01";
    expect(await api.boothVerify("553311")).toEqual({ ok: true, value: { ok: false, closed: true } });
    process.env.AZM_BOOTH_DATES = riyadhDate(Date.now());
    expect(await api.boothVerify("000000")).toEqual({ ok: true, value: { ok: false } });
    const ok = await api.boothVerify("553311");
    expect(ok.ok && ok.value.ok).toBe(true);
    if (!ok.ok || !ok.value.ok) return;
    expect(ok.value.session).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ok.value)).not.toContain("553311");

    const token = await api.boothToken(ok.value.session);
    expect(token.ok && token.value.token).toMatch(/^[0-9a-f]{64}$/);
    if (!token.ok) return;
    expect(token.value.expires).toBeLessThanOrEqual(Date.now() + 45 * 60 * 1000);
    expect(await api.boothRedeem(token.value.token)).toEqual({
      ok: true,
      value: { ok: true, expires: token.value.expires },
    });
    const bad = await api.boothToken("f".repeat(64));
    expect(!bad.ok && bad.error.kind === "http" && bad.error.code).toBe("BOOTH_SESSION");
    expect(await api.boothRedeem("f".repeat(64))).toEqual({ ok: true, value: { ok: false } });
  });

  it("a signed in booth start sends boothToken; a used token is BOOTH_CODE", async () => {
    process.env.AZM_BOOTH_CODE = "771144";
    process.env.AZM_BOOTH_DATES = riyadhDate(Date.now());
    const cookie = await member(h, email(), intakeOf());
    const api = clientFor(cookie);
    const verified = await api.boothVerify("771144");
    if (!verified.ok || !verified.value.ok) throw new Error("verify");
    const token = await api.boothToken(verified.value.session);
    if (!token.ok) throw new Error("token");
    const answers = await answersFor(h, cookie, {}, "booth");
    const ok = await api.startCheck({
      answers,
      device: deviceInfo(),
      setting: "booth",
      boothToken: token.value.token,
    });
    expect(ok.ok && ok.value.setting).toBe("booth");
    const again = await api.startCheck({
      answers,
      device: deviceInfo(),
      setting: "booth",
      boothToken: token.value.token,
    });
    expect(toStartResult(again)).toEqual({ ok: false, code: "BOOTH_CODE" });
  });
});

describe("the context type follows the server", () => {
  it("a context without a lock or open check reads as none", () => {
    const base: ContextResponse = {
      setting: "home",
      setup: null,
      firstCheck: true,
      completedBefore: false,
      unresolvedChangeReported: false,
      faintReportedUnresolved: true,
      lastCheckLasting: false,
      lastPdDoseBucket: null,
      lock: null,
      retestDue: null,
      earliestNext: null,
      early: true,
      sideLeanRepeat: { from: 1, to: 2, baseTests: ["trunk_control_seated"] },
      openCheck: null,
      followUpDue: false,
      consent: true,
      consentVersion: 1,
      baselineRanges: {},
      baseTests: [],
      homeOpen: false,
      adultConfirmed: false,
    };
    const c = toSignedInContext(base);
    expect(c).toMatchObject({
      faintReportedUnresolved: true,
      early: true,
      sideLeanRepeat: { from: 1, to: 2, baseTests: ["trunk_control_seated"] },
      openCheck: null,
      lock: null,
      homeOpen: false,
      adultConfirmed: false,
    });
  });
});

describe("the offer after the intake (S02) shows the computed minutes (O40)", () => {
  it("estimateMinutes of the context's base tests at home, not a fixed range", async () => {
    const { offerMinutes } = await import("../src/features/assessment/api");
    const { estimateMinutes } = await import("../src/medical/assessment");
    const cookie = await member(h, email(), WHEELCHAIR_STROKE);
    const r = await clientFor(cookie).getContext();
    if (!r.ok) throw new Error("context");
    const minutes = offerMinutes(r.value);
    expect(minutes).toEqual(estimateMinutes(r.value.baseTests as never, r.value.ctx ?? null, "home"));
    expect(minutes[0]).toBeGreaterThan(0);
    expect(minutes[1]).toBeGreaterThanOrEqual(minutes[0]);
  });
});
