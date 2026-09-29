/**
 * The check flow (src/features/assessment/flowMachine.ts) on the round 3 server contract:
 *
 *   - the context: faintReportedUnresolved in the pre-check, the lock's {when}, the adult
 *     confirmation posted from S05a, the side lean only session (Q12 (2));
 *   - the start answer: ADULT_REQUIRED, NOT_OFFERED, status ended_early (O21), checkIn;
 *   - the stop naming its test side (resultOnStop), the server's own skip row, scr_ad on the
 *     emergency screen for SCI (O12 (1)), and a check the server closed is never completed;
 *   - the faint follow up, the alarm, the end question and its form, the new skip reasons and the
 *     quality retries;
 *   - the O6 resume: the line, the sound check, the re-ask and the resume call.
 */
import { describe, expect, it } from "vitest";
import {
  flowReducer,
  initialModel,
  RETRIES,
  sameChairAsked,
  type FlowConfig,
  type FlowEvent,
  type FlowModel,
  type FlowState,
  type ResumeCheck,
  type SignedInContext,
  type StartResult,
} from "../src/features/assessment/flowMachine";
import { screenFor } from "../src/features/assessment/screens";
import { t } from "../src/i18n";
import { finalizeProtocol, baseSelection, type CheckContext } from "../src/medical/assessment";
import {
  evaluatePrecheck,
  parseQuestionId,
  RESUME_QUESTION_IDS,
  visibleQuestions,
  type Answers,
} from "../src/medical/precheck";
import { benign, envOf, fill, NOW } from "./precheck-fixtures";

const GUEST: FlowConfig = { mode: "guest", booth: true, homeOpen: false, desktop: false };
const SIGNED: FlowConfig = { mode: "signedIn", booth: false, homeOpen: true, desktop: false };
const HOUR = 60 * 60 * 1000;
const CHECK_ID = "11111111-2222-3333-4444-555555555555";

function play(m: FlowModel, ...events: FlowEvent[]): FlowModel {
  return events.reduce((acc, e) => flowReducer(acc, { now: NOW, ...e }), m);
}
const kind = (m: FlowModel) => m.state.kind;
const types = (m: FlowModel) => m.effects.map((e) => e.type);
const withState = (m: FlowModel, state: FlowState): FlowModel => ({ ...m, state, overlay: null });
const cam = (k: FlowState["kind"], i = 0, side = 0, extra: Record<string, unknown> = {}) =>
  ({ kind: k, i, side, ...extra }) as FlowState;

function contextOf(ctx: Partial<CheckContext> = {}, over: Partial<SignedInContext> = {}): SignedInContext {
  const env = envOf(ctx);
  return {
    ctx: env.ctx,
    blocked: null,
    setting: "home",
    setup: null,
    firstCheck: true,
    completedBefore: false,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: env.baseTests,
    lock: null,
    consent: true,
    homeOpen: true,
    adultConfirmed: true,
    ...over,
  };
}

function signedAt(config: Partial<FlowConfig> = {}, ctx?: SignedInContext): FlowModel {
  return play(initialModel({ ...SIGNED, ...config }), {
    type: "CONTEXT_LOADED",
    context: ctx ?? contextOf(),
  });
}

function answerAll(m: FlowModel, given: Answers = {}): FlowModel {
  let x = m;
  for (let k = 0; k < 60 && x.state.kind === "question"; k++) {
    const id = x.state.id;
    x = play(x, { type: "ANSWER", id, value: id in given ? given[id] : benign(id) });
  }
  return x;
}

function signedAtStarting(ctx?: SignedInContext, config: Partial<FlowConfig> = {}): FlowModel {
  return answerAll(
    play(
      signedAt(config, ctx),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    ),
  );
}

function okStart(m: FlowModel): Extract<StartResult, { ok: true }> {
  const env = m.data.env!;
  const outcome = evaluatePrecheck(env, fill(env, m.data.answers), NOW);
  const protocol = finalizeProtocol(
    baseSelection(env.ctx, env.setting, env.setup),
    outcome,
    env.ctx,
    env.setting,
    env.setup,
  );
  return {
    ok: true,
    id: CHECK_ID,
    kind: "baseline",
    protocol,
    warnings: outcome.warnings,
    helperRequired: outcome.helperRequired,
  };
}

function signedAtPlan(ctx?: SignedInContext): FlowModel {
  const m = signedAtStarting(ctx);
  const started = play(m, { type: "START_RESULT", result: okStart(m) });
  return kind(started) === "warnings" ? play(started, { type: "CONTINUE" }) : started;
}

/** Signed in, on test 0 with the camera measuring, and no effects waiting. */
function measuring(ctx?: SignedInContext): FlowModel {
  const m = play(signedAtPlan(ctx), { type: "PLAN_START" });
  return withState({ ...m, effects: [] }, cam("cam.measure"));
}

/* ------------------------------------------------------------------ context and entry */

describe("the context (round 3)", () => {
  it("faintReportedUnresolved reaches the pre-check, so pc_faint_since is asked (Q33 (3))", () => {
    const m = signedAt({}, contextOf({}, { faintReportedUnresolved: true }));
    expect(m.data.env?.faintReportedUnresolved).toBe(true);
    expect(visibleQuestions(m.data.env!, {})).toContain("pc_faint_since");
    const plain = signedAt({}, contextOf());
    expect(visibleQuestions(plain.data.env!, {})).not.toContain("pc_faint_since");
  });

  it("the lock's {when} reaches the paused screen (S35)", () => {
    const when = { token: "sameDay_clock" as const, time: { hour: 1, minute: 0, suffix: "pm" as const } };
    const lock = { until: NOW + HOUR, releasable: false, when };
    const m = signedAt({}, contextOf({}, { lock }));
    expect(m.state).toEqual({ kind: "paused", until: NOW + HOUR, releasable: false, when });
  });

  it("S05a posts the adult confirmation once the person says yes; a guest posts nothing", () => {
    const m = signedAt({}, contextOf({}, { adultConfirmed: false }));
    expect(kind(m)).toBe("adultGate");
    const yes = play(m, { type: "ADULT_YES" });
    expect(kind(yes)).toBe("context");
    expect(types(yes)).toEqual(["adult"]);
    const guest = play(
      initialModel(GUEST),
      { type: "START" },
      { type: "GUEST_PATH", path: "full" },
      { type: "ADULT_YES" },
    );
    expect(guest.effects).toEqual([]);
  });

  it("the side lean only session asks the side lean's questions and sends the session", () => {
    const offer = { from: NOW - HOUR, to: NOW + 100 * HOUR, baseTests: ["trunk_control_seated" as const] };
    const ctx = contextOf({}, { sideLeanRepeat: offer });
    const m = signedAt({ session: "side_lean_only" }, ctx);
    expect(m.data.env?.baseTests).toEqual(["trunk_control_seated"]);
    expect(m.data.base.every((b) => b.testId === "trunk_control_seated")).toBe(true);
    const starting = signedAtStarting(ctx, { session: "side_lean_only" });
    expect(kind(starting)).toBe("starting");
    expect(starting.effects).toEqual([
      expect.objectContaining({ type: "start", session: "side_lean_only", setting: "home" }),
    ]);
    // Not offered today: the flow never starts it.
    expect(signedAt({ session: "side_lean_only" }, contextOf()).state).toEqual({ kind: "exit", to: "today" });
  });
});

/* ------------------------------------------------------------------ the start answer */

describe("the start answer (round 3)", () => {
  it("ADULT_REQUIRED goes back to S05a; NOT_OFFERED leaves for Today", () => {
    const m = signedAtStarting();
    expect(kind(play(m, { type: "START_RESULT", result: { ok: false, code: "ADULT_REQUIRED" } }))).toBe(
      "adultGate",
    );
    expect(play(m, { type: "START_RESULT", result: { ok: false, code: "NOT_OFFERED" } }).state).toEqual({
      kind: "exit",
      to: "today",
    });
  });

  it("status ended_early (O21): no test runs and the flow never completes the closed check", () => {
    const m = signedAtStarting();
    const r = okStart(m);
    const allSkipped = r.protocol.map((p) => ({ ...p, skipped: p.skipped ?? "pain_today" }));
    let x = play(m, { type: "START_RESULT", result: { ...r, protocol: allSkipped, status: "ended_early" } });
    if (kind(x) === "warnings") x = play(x, { type: "CONTINUE" });
    expect(kind(x)).toBe("plan");
    expect(x.data.tests).toEqual([]);
    const left = play(x, { type: "PLAN_START" });
    expect(left.state).toEqual({ kind: "exit", to: "today" });
    expect(types(left)).not.toContain("complete");
  });

  it("keeps the check in inputs and the helper briefing of the start answer", () => {
    const m = signedAtStarting();
    const checkIn = { raiseAllowed: true, noArmSignal: false, fineZoneSide: "right" as const };
    const x = play(m, {
      type: "START_RESULT",
      result: { ...okStart(m), status: "open", checkIn, helperBriefing: { chair_stand_30s: "x" } },
    });
    expect(x.data.checkIn).toEqual(checkIn);
    expect(x.data.helperBriefing).toEqual({ chair_stand_30s: "x" });
  });

  it("409 LOCKED keeps its {when} on the paused screen", () => {
    const m = signedAtStarting();
    const when = { token: "nextDay_midnight" as const };
    const x = play(m, {
      type: "START_RESULT",
      result: { ok: false, code: "LOCKED", until: NOW + HOUR, releasable: true, when },
    });
    expect(x.state).toEqual({ kind: "paused", until: NOW + HOUR, releasable: true, when });
  });
});

/* ------------------------------------------------------------------ stops */

describe("the stop names its test side (resultOnStop)", () => {
  it("the running side is the server's skip row; the rest of the test goes before the stop", () => {
    const m = measuring();
    const run = m.data.tests[0];
    const stopped = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    const rest = run.sides.slice(1);
    expect(types(stopped)).toEqual([...rest.map(() => "result"), "stop"]);
    rest.forEach((item, k) =>
      expect(stopped.effects[k]).toMatchObject({
        type: "result",
        body: { testId: item.testId, side: item.side, skippedReason: "by_choice" },
      }),
    );
    expect(stopped.effects.at(-1)).toMatchObject({
      type: "stop",
      option: "choice",
      ref: { testId: run.testId, side: run.sides[0].side },
    });
    // On the phone the running side is recorded too, so it is never measured again today.
    expect(stopped.data.outcomes[`${run.testId}:${run.sides[0].side}`]).toMatchObject({
      status: "skipped",
      reason: "by_choice",
    });
  });

  it("during a rest the stop names the next side to run", () => {
    const m = measuring();
    const run = m.data.tests[0];
    expect(run.sides.length).toBe(2);
    const first = `${run.testId}:${run.sides[0].side}`;
    const resting = withState(
      { ...m, data: { ...m.data, outcomes: { [first]: { status: "measured", value: 100 } } } },
      cam("cam.rest", 0, 1, { purpose: "sideChange" }),
    );
    const stopped = play(resting, { type: "STOP" }, { type: "STOP_OPTION", option: "tired" });
    expect(types(stopped)).toEqual(["stop"]);
    expect(stopped.effects[0]).toMatchObject({ ref: { testId: run.testId, side: run.sides[1].side } });
  });

  it("after the last side of a test (S47) the stop names no side", () => {
    const m = measuring();
    const run = m.data.tests[0];
    const outcomes = Object.fromEntries(
      run.sides.map((s) => [`${s.testId}:${s.side}`, { status: "measured" as const, value: 100 }]),
    );
    const at = withState(
      { ...m, data: { ...m.data, outcomes } },
      cam("between", 0, run.sides.length - 1, { scope: "side", via: "test" }),
    );
    const stopped = play(at, { type: "STOP" }, { type: "STOP_OPTION", option: "tired" });
    expect(types(stopped)).toEqual(["stop"]);
    expect((stopped.effects[0] as { ref?: unknown }).ref ?? null).toBeNull();
  });

  it("a chest stop shows scr_ad with scr_emergency for every SCI condition (O12 (1))", () => {
    for (const conditions of [["sci_complete"], ["sci_incomplete"]]) {
      const m = withState(signedAt({}, contextOf({ conditions })), cam("cam.measure"));
      const x = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "chest" });
      expect(x.state).toMatchObject({ kind: "safety", screen: "scr_emergency", alsoShow: ["scr_ad"] });
    }
    const plain = withState(signedAt({}, contextOf()), cam("cam.measure"));
    const y = play(plain, { type: "STOP" }, { type: "STOP_OPTION", option: "chest" });
    expect(y.state).toMatchObject({ kind: "safety", screen: "scr_emergency", alsoShow: [] });
  });

  it("a check a stop ended is never completed afterwards (the server closed it)", () => {
    const m = measuring();
    const x = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "breath" });
    expect(x.data.closed).toBe(true);
    const ended = play(withState(x, { kind: "endQuestion" }), { type: "END_ANSWER", yes: false });
    expect(types(ended)).not.toContain("complete");
    expect(types(ended)).toContain("end");
  });
});

/* ------------------------------------------------------------------ faint, alarm, end */

describe("the faint follow up, the alarm and the end question", () => {
  function afterFaintStop(ctx?: SignedInContext): FlowModel {
    const m = measuring(ctx);
    const x = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "faint" }, { type: "FAINT_ASK" });
    expect(kind(x)).toBe("faintAsk");
    return { ...x, effects: [] };
  }

  it("yes opens the emergency screen, with scr_ad for SCI, and is posted with the stopped test", () => {
    const m = afterFaintStop();
    const run = m.data.tests[0];
    const yes = play(m, { type: "FAINT_ANSWER", value: "yes" });
    expect(yes.state).toMatchObject({ kind: "safety", screen: "scr_emergency", alsoShow: [] });
    expect(yes.effects).toEqual([
      expect.objectContaining({
        type: "faint",
        checkId: CHECK_ID,
        body: { answer: "yes", testId: run.testId },
      }),
    ]);
    const sci = play(afterFaintStop(contextOf({ conditions: ["sci_incomplete"] })), {
      type: "FAINT_ANSWER",
      value: "unsure",
    });
    expect(sci.state).toMatchObject({ kind: "safety", screen: "scr_emergency", alsoShow: ["scr_ad"] });
  });

  it("no returns to the faint screen and is posted; after a no response alarm it is an emergency", () => {
    const m = afterFaintStop();
    const no = play(m, { type: "FAINT_ANSWER", value: "no" });
    expect(no.state).toMatchObject({ kind: "safety", safety: "faint", faintAnswered: true });
    expect(no.effects[0]).toMatchObject({ type: "faint", body: { answer: "no" } });

    // A no response alarm earlier in the check (Q33 (3)).
    const alarmed = play(
      measuring(),
      { type: "TRIGGER", trigger: "no_movement" },
      { type: "CHECKIN_TIMEOUT" },
      { type: "FINE", via: "button" },
      { type: "WANT_STOP" },
      { type: "STOP_OPTION", option: "faint" },
      { type: "FAINT_ASK" },
    );
    expect(kind(alarmed)).toBe("faintAsk");
    const after = play({ ...alarmed, effects: [] }, { type: "FAINT_ANSWER", value: "no" });
    expect(after.state).toMatchObject({ kind: "safety", screen: "scr_emergency" });
    expect(after.effects[0]).toMatchObject({ type: "faint", body: { answer: "no", afterNoResponse: true } });
  });

  it("the alarm is posted: no response on the check in timeout, help requested on the button", () => {
    const m = measuring();
    const run = m.data.tests[0];
    const timeout = play(m, { type: "TRIGGER", trigger: "no_movement" }, { type: "CHECKIN_TIMEOUT" });
    expect(timeout.overlay?.kind).toBe("alarm");
    expect(timeout.effects).toEqual([
      expect.objectContaining({ type: "alarm", body: { kind: "no_response", testId: run.testId } }),
    ]);
    expect(timeout.data.noResponseAlarm).toBe(true);
    const help = play(m, { type: "TRIGGER", trigger: "raised_hand" }, { type: "NEED_HELP" });
    expect(help.effects).toEqual([
      expect.objectContaining({ type: "alarm", body: { kind: "help_requested", testId: run.testId } }),
    ]);
    const guest = play(
      withState(initialModel(GUEST), cam("cam.measure")),
      { type: "TRIGGER", trigger: "no_movement" },
      { type: "CHECKIN_TIMEOUT" },
    );
    expect(guest.effects).toEqual([]);
  });

  it("the end question: no posts no, then completes; yes posts yes, locks and never completes", () => {
    const m = measuring();
    const at = withState(
      {
        ...m,
        data: { ...m.data, outcomes: { "shoulder_abduction:left": { status: "measured", value: 90 } } },
      },
      { kind: "endQuestion" },
    );
    const no = play(at, { type: "END_ANSWER", yes: false });
    expect(no.state).toEqual({ kind: "results" });
    expect(types(no)).toEqual(["end", "complete"]);
    expect(no.effects[0]).toMatchObject({ type: "end", answer: "no" });
    const yes = play(at, { type: "END_ANSWER", yes: true });
    expect(yes.state).toMatchObject({ kind: "safety", screen: "scr_emergency", alsoShow: [] });
    expect(types(yes)).toEqual(["end"]);
    expect(yes.effects[0]).toMatchObject({ type: "end", answer: "yes" });
    expect(yes.data.lock?.until).toBeGreaterThan(NOW);
    const sci = withState(
      { ...at, data: { ...at.data, env: { ...at.data.env!, setup: { sciT6: true } } } },
      { kind: "endQuestion" },
    );
    expect(play(sci, { type: "END_ANSWER", yes: true }).state).toMatchObject({ alsoShow: ["scr_ad"] });
  });

  it("the end question asks the server for its form; END_FORM names the side (Q23 (7))", () => {
    const m = measuring();
    const done = Object.fromEntries(
      m.data.tests.flatMap((t) =>
        t.sides.map((s) => [`${s.testId}:${s.side}`, { status: "measured" as const, value: 90 }]),
      ),
    );
    const last = m.data.tests.length - 1;
    const at = withState(
      { ...m, data: { ...m.data, outcomes: done } },
      cam("between", last, m.data.tests[last].sides.length - 1, { scope: "test", via: "test" }),
    );
    const x = play(at, { type: "BETWEEN_ANSWER", value: "same" });
    expect(kind(x)).toBe("endQuestion");
    expect(types(x)).toContain("endForm");
    const formed = play(x, { type: "END_FORM", side: "left", chronicNote: true });
    expect(formed.state).toEqual({ kind: "endQuestion", side: "left", chronicNote: true });
  });
});

/* ------------------------------------------------------------------ skips and retries */

describe("skip reasons and quality retries", () => {
  it("chair_needed and motion_needed skips are posted (the server knows them now)", () => {
    const m = measuring();
    const chair = play(withState(m, { kind: "test.instruction", i: 0 }), { type: "CHAIR_GATE_NO" });
    expect(chair.effects.length).toBeGreaterThan(0);
    expect(chair.effects[0]).toMatchObject({ type: "result", body: { skippedReason: "chair_needed" } });
    const motion = play(withState(m, cam("cam.setup")), { type: "MOTION_REFUSED" });
    expect(motion.effects[0]).toMatchObject({ type: "result", body: { skippedReason: "motion_needed" } });
  });

  it("a result carries the quality retries used on its side; a side not measured carries them all", () => {
    let m = measuring();
    m = play(m, { type: "QUALITY_FAIL", issue: "too_far" }, { type: "RETRY" }, { type: "SETUP_OK" });
    const run = m.data.tests[0];
    const item = run.sides[0];
    const body = {
      testId: item.testId,
      side: item.side,
      value: 100,
      unit: "deg",
      attempts: [{ value: 100, valid: true }],
      quality: { ok: true },
      detail: {},
      flags: [],
      nValid: 1,
      median: 100,
      skippedReason: null,
      variant: null,
      poseModel: "lite" as const,
      movementVersion: 1,
      engineVersion: "e",
    };
    const saved = play(m, {
      type: "SIDE_RESULT",
      testId: item.testId,
      side: item.side,
      outcome: { status: "measured", value: 100 },
      body,
    });
    expect(saved.effects.at(-1)).toMatchObject({ type: "result", body: { qualityRetries: 1 } });

    let x = measuring();
    for (let k = 0; k <= RETRIES[run.testId]; k++) {
      x = play(x, { type: "QUALITY_FAIL", issue: "too_far" });
      // A retry sets up again; the next attempt measures (calibration and practice are not the point).
      if (x.state.kind === "cam.retry" && !x.state.exhausted)
        x = withState(play(x, { type: "RETRY" }), cam("cam.measure"));
    }
    expect(x.state).toMatchObject({ kind: "cam.retry", exhausted: true });
    const given = play({ ...x, effects: [] }, { type: "CONTINUE" });
    expect(given.effects[0]).toMatchObject({
      type: "result",
      body: { skippedReason: "quality", qualityRetries: RETRIES[run.testId] },
    });
  });
});

/* ------------------------------------------------------------------ resume (O6) */

describe("resume after an interruption (O6)", () => {
  function openCheck(): { ctx: SignedInContext; check: ResumeCheck } {
    const ctx = contextOf();
    const m = signedAtStarting(ctx);
    const protocol = okStart(m).protocol;
    const first = protocol.find((p) => !p.skipped)!;
    return {
      ctx,
      check: {
        id: CHECK_ID,
        kind: "baseline",
        protocol,
        outcomes: { [`${first.testId}:${first.side}`]: { status: "measured", value: 100 } },
      },
    };
  }

  function resumed(): FlowModel {
    const { ctx, check } = openCheck();
    return play(initialModel(SIGNED), { type: "RESUME", context: ctx, check });
  }

  it("re-asks with the running check's environment, exactly as the server builds it (runningEnv)", () => {
    const { check } = openCheck();
    const ctx = contextOf(
      {},
      {
        completedBefore: true,
        faintReportedUnresolved: true,
        neededArmsLastStand: true,
        sideLeanDoneAtHome: true,
        unresolvedChangeReported: true,
        lastCheckLasting: true,
        firstCheck: true,
      },
    );
    const m = play(initialModel(SIGNED), {
      type: "RESUME",
      context: ctx,
      check: { ...check, setup: { sciT6: false } },
    });
    expect(m.data.env).toEqual({
      setting: "home",
      ctx: ctx.ctx,
      setup: { sciT6: false },
      firstCheck: false,
      unresolvedChangeReported: false,
      lastCheckLasting: false,
      baseTests: [...new Set(check.protocol.map((i) => i.testId))],
    });
  });

  it("shows the O6 line, runs the sound check, then asks only the re-ask questions", () => {
    let m = resumed();
    expect(kind(m)).toBe("resumeNotice");
    expect(screenFor(m)).toBe("S16");
    // The council's line, word for word (O6 (2)).
    expect(t("ar", "assessment.resume.notice")).toBe("قبل أن نكمل، سنعيد بعض الأسئلة القصيرة عن حالك الآن.");
    expect(t("en", "assessment.resume.notice")).toBe(
      "Before we continue, we will ask a few short questions again about how you are now.",
    );
    m = play(m, { type: "CONTINUE" });
    expect(kind(m)).toBe("soundCheck");
    m = play(m, { type: "SOUND_RESULT", mode: "voice" });
    expect(m.state).toEqual({ kind: "question", id: "pc_urgent" });
    const asked: string[] = [];
    for (let k = 0; k < 20 && m.state.kind === "question"; k++) {
      asked.push(m.state.id);
      m = play(m, { type: "ANSWER", id: m.state.id, value: benign(m.state.id) });
    }
    expect(asked.every((id) => RESUME_QUESTION_IDS.includes(parseQuestionId(id)!.base))).toBe(true);
    expect(asked).toContain("pc_unwell");
    expect(kind(m)).toBe("starting");
    expect(m.effects).toEqual([
      expect.objectContaining({ type: "resume", checkId: CHECK_ID, answers: expect.any(Object) }),
    ]);
  });

  it("proceeds at the next unfinished test from its first attempt (S28), with the new skips", () => {
    let m = play(resumed(), { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" });
    m = answerAll(m);
    const tests = m.data.tests;
    const skip = tests[tests.length - 1].sides[0];
    const x = play(m, {
      type: "RESUME_RESULT",
      result: {
        ok: true,
        skips: [{ testId: skip.testId, side: skip.side, reason: "pain_today" }],
        warnings: [],
        helperRequired: [],
        checkIn: null,
      },
    });
    expect(x.state).toEqual({ kind: "test.instruction", i: 0 });
    expect(x.data.answers).toEqual({});
    expect(x.data.outcomes[`${skip.testId}:${skip.side}`]).toMatchObject({ status: "skipped" });
    // The server stored those skips itself: nothing is posted for them.
    expect(types(x)).toEqual(["resume"]);
  });

  it("a re-ask emergency shows the safety screen at once and tells the server in the background", () => {
    let m = play(resumed(), { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" });
    m = play(m, { type: "ANSWER", id: "pc_urgent", value: "yes" });
    expect(m.state).toMatchObject({ kind: "safety", screen: "scr_emergency" });
    expect(types(m)).toEqual(["resumeBackground"]);
    expect(m.data.closed).toBe(true);
  });

  it("the check closed meanwhile (NOT_OPEN): back to Today; a lock pauses", () => {
    const m = answerAll(play(resumed(), { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" }));
    expect(play(m, { type: "RESUME_RESULT", result: { ok: false, code: "NOT_OPEN" } }).state).toEqual({
      kind: "exit",
      to: "today",
    });
    const locked = play(m, {
      type: "RESUME_RESULT",
      result: { ok: false, code: "LOCKED", until: NOW + HOUR, releasable: false, when: null },
    });
    expect(kind(locked)).toBe("paused");
    const retry = play(m, { type: "RESUME_RESULT", result: { ok: false, code: "network" } });
    expect(retry.state).toMatchObject({ kind: "starting", error: "network" });
    expect(types(play(retry, { type: "RETRY" }))).toEqual(["resume", "resume"]);
  });
});

/* ------------------------------------------------------------------ the shared O12 rule */

describe("scr_ad joins scr_emergency for SCI on the phone and the server alike (O12 (1))", () => {
  it("every SCI condition or an SCI level at T6 or above; nobody else; nothing without an environment", async () => {
    const { emergencyAlsoShow } = await import("../src/medical/precheck");
    const server = await import("../server/modules/assessments/common");
    expect(emergencyAlsoShow(envOf({ conditions: ["sci_complete"] }))).toEqual(["scr_ad"]);
    expect(emergencyAlsoShow(envOf({ conditions: ["sci_incomplete"] }))).toEqual(["scr_ad"]);
    expect(emergencyAlsoShow(envOf({ conditions: ["stroke"] }, { setup: { sciT6: true } }))).toEqual([
      "scr_ad",
    ]);
    expect(emergencyAlsoShow(envOf({ conditions: ["stroke"] }))).toEqual([]);
    expect(emergencyAlsoShow(null)).toEqual([]);
    expect(server.emergencyAlsoShow).toBe(emergencyAlsoShow);
  });
});

/* ------------------------------------------------------------------ guest steps and the counter */

describe("the guest steps follow Q19 (2) and O20; the counter follows O9", () => {
  function guestThrough(conditions: string[], clearance: "yes" | "no" | "unsure"): FlowModel {
    return play(
      initialModel(GUEST),
      { type: "START" },
      { type: "GUEST_PATH", path: "full" },
      { type: "ADULT_YES" },
      { type: "GUEST_ANSWER", step: 1, value: "chair" },
      { type: "GUEST_ANSWER", step: 2, value: "left" },
      { type: "GUEST_ANSWER", step: 3, value: conditions },
      { type: "GUEST_NEXT" },
      { type: "GUEST_ANSWER", step: 4, value: clearance },
      { type: "GUEST_ANSWER", step: 5, value: ["none"] },
      { type: "GUEST_NEXT" },
      { type: "GUEST_ANSWER", step: 6, value: ["none"] },
      { type: "GUEST_NEXT" },
    );
  }

  it("the guest's clearance answer counts (Q19 (2)): cleared after a stroke, more than the arm raise", () => {
    const cleared = guestThrough(["stroke"], "yes");
    expect(kind(cleared)).toBe("intro");
    expect(cleared.data.env?.ctx.clearance).toBe("yes");
    expect(new Set(cleared.data.base.filter((b) => !b.excluded).map((b) => b.testId)).size).toBeGreaterThan(
      1,
    );
    const uncleared = guestThrough(["stroke"], "no");
    expect(kind(uncleared)).toBe("intro");
    expect(uncleared.data.env?.ctx.clearance).toBe("no");
    expect(uncleared.data.env?.baseTests).toEqual(["shoulder_abduction"]);
  });

  it("the SCI type unknown chip takes the sci_complete rules (O20)", () => {
    const m = guestThrough(["sci_unsure"], "yes");
    expect(kind(m)).toBe("intro");
    expect(m.data.env?.ctx.conditions).toEqual(["sci_complete"]);
  });

  it("the question total counts every question that can still appear and never grows (O9)", async () => {
    const { possibleQuestions } = await import("../src/medical/precheck");
    const { questionCounter } = await import("../src/features/assessment/flowMachine");
    let m = play(
      signedAt({}, contextOf({ conditions: ["sci_incomplete"] })),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    let last = Infinity;
    for (let k = 0; k < 40 && m.state.kind === "question"; k++) {
      const c = questionCounter(m)!;
      expect(c.total).toBe(possibleQuestions(m.data.env!, m.data.answers).length);
      expect(c.total).toBeLessThanOrEqual(last);
      last = c.total;
      m = play(m, { type: "ANSWER", id: m.state.id, value: benign(m.state.id) });
    }
  });
});

describe("CheckApp's flow configuration", () => {
  it("opens the side lean only session from S01 leanRepeat; a full check carries no session", async () => {
    const { checkConfig } = await import("../src/features/assessment/CheckApp");
    expect(
      checkConfig({ mode: "signedIn", booth: false, desktop: false, session: "side_lean_only" }),
    ).toEqual({
      mode: "signedIn",
      booth: false,
      homeOpen: false,
      desktop: false,
      session: "side_lean_only",
    });
    expect(checkConfig({ mode: "guest", booth: true, desktop: true, session: "full" })).toEqual({
      mode: "guest",
      booth: true,
      homeOpen: false,
      desktop: true,
    });
  });
});

/* ------------------------------------------------------------------ the same chair (Q9 (3), Q12 (2)) */

describe("the same chair answer of the chair stand and the side lean (Q9 (3), note 19 (b))", () => {
  const bodyFor = (m: FlowModel, i: number) => {
    const item = m.data.tests[i].sides[0];
    return {
      testId: item.testId,
      side: item.side,
      value: 12,
      unit: "count",
      attempts: [{ value: 12, valid: true }],
      quality: { ok: true },
      detail: { footwear: "shoes" } as Record<string, number | boolean | string>,
      flags: [],
      nValid: 1,
      median: 12,
      skippedReason: null,
      variant: null,
      poseModel: "lite" as const,
      movementVersion: 1,
      engineVersion: "e",
    };
  };
  const at = (position: "chair" | "standing" | "wheelchair", firstCheck: boolean, testId: string) => {
    const m = signedAtPlan(contextOf({ position }, { firstCheck }));
    const i = m.data.tests.findIndex((r) => r.testId === testId);
    expect(i, `${testId} runs for ${position}`).toBeGreaterThanOrEqual(0);
    return { m: withState({ ...m, effects: [] }, { kind: "test.instruction", i }), i };
  };
  const post = (m: FlowModel, i: number) => {
    const item = m.data.tests[i].sides[0];
    const measured = withState(m, cam("cam.saved", i, 0));
    let x = play(measured, {
      type: "SIDE_RESULT",
      testId: item.testId,
      side: item.side,
      outcome: { status: "measured", value: 12 },
      body: bodyFor(m, i),
    });
    // The side lean's result waits for its contact answer (S48), then is posted with it.
    if (!x.effects.some((e) => e.type === "result"))
      x = play(withState(x, cam("after.contact", i, 0)), { type: "AFTER_ANSWER", value: false });
    return x.effects.find((e) => e.type === "result") as { body: { detail: Record<string, unknown> } };
  };

  it("from the second check the chair stand setup asks it before READY, and the result carries it", () => {
    const { m, i } = at("standing", false, "chair_stand_30s");
    expect(sameChairAsked(m.data, i)).toBe(true);
    expect(play(m, { type: "READY" }).state).toEqual(m.state);
    const yes = play(m, { type: "SAME_CHAIR", value: "yes" });
    expect(kind(play(yes, { type: "READY" }))).not.toBe("test.instruction");
    expect(post(yes, i).body.detail.sameChair).toBe(true);
    // Not sure is kept as no (Q9 (3)).
    expect(post(play(m, { type: "SAME_CHAIR", value: "unsure" }), i).body.detail.sameChair).toBe(false);
  });

  it("the side lean asks it of chair users; a wheelchair is the same chair", () => {
    const chair = at("chair", false, "trunk_control_seated");
    expect(sameChairAsked(chair.m.data, chair.i)).toBe(true);
    expect(post(play(chair.m, { type: "SAME_CHAIR", value: "yes" }), chair.i).body.detail.sameChair).toBe(
      true,
    );
    const wheel = at("wheelchair", false, "trunk_control_seated");
    expect(sameChairAsked(wheel.m.data, wheel.i)).toBe(false);
    expect(post(wheel.m, wheel.i).body.detail.sameChair).toBe(true);
  });

  it("is not asked at the first check, at the booth, or for the other tests", () => {
    const first = at("standing", true, "chair_stand_30s");
    expect(sameChairAsked(first.m.data, first.i)).toBe(false);
    expect(post(first.m, first.i).body.detail.sameChair).toBeUndefined();
    const other = at("chair", false, "shoulder_abduction");
    expect(sameChairAsked(other.m.data, other.i)).toBe(false);
  });
});
