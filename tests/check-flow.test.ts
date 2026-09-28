/**
 * The movement check flow machine (UX spec v1.1 Appendix A; src/features/assessment/flowMachine.ts).
 *
 *   1. every transition of Appendix A, state by state;
 *   2. every safety event from every state reaches its safety screen (server SAFETY, the stop list,
 *      the check in and the alarm, the pre-check, the pain question, the end question, the faint
 *      follow up), and the alarm can only be left with "I am fine";
 *   3. the guest flow never produces a network effect; the signed in flow sends the start, the safety
 *      answers directly and results and completion (queued by the hook);
 *   4. whole walks: guest booth, signed in first check, re-test, postponed, locked, stop and check in,
 *      emergency, camera denied, quality retry.
 */
import { describe, expect, it } from "vitest";
import {
  backTarget,
  canLeave,
  cameraRunning,
  isAttemptState,
  flowReducer,
  initialModel,
  prepSteps,
  questionCounter,
  safetyKindOf,
  testCounter,
  testsOf,
  type FlowConfig,
  type FlowEvent,
  type FlowModel,
  type FlowState,
  type FlowStateKind,
  type SafetyKind,
  type SignedInContext,
  type StartResult,
} from "../src/features/assessment/flowMachine";
import { overlayFor, screenFor, SCREENS, OVERLAYS } from "../src/features/assessment/screens";
import { finalizeProtocol, baseSelection, type CheckContext } from "../src/medical/assessment";
import { evaluatePrecheck, type Answers } from "../src/medical/precheck";
import { benign, envOf, fill, NOW } from "./precheck-fixtures";
import type { StopOptionId } from "../src/movements/types";

/* ------------------------------------------------------------------ builders */

const GUEST: FlowConfig = { mode: "guest", booth: true, homeOpen: false, desktop: false };
const SIGNED: FlowConfig = { mode: "signedIn", booth: false, homeOpen: true, desktop: false };

function play(m: FlowModel, ...events: FlowEvent[]): FlowModel {
  return events.reduce((acc, e) => flowReducer(acc, { now: NOW, ...e }), m);
}
const kind = (m: FlowModel) => m.state.kind;
const withState = (m: FlowModel, state: FlowState): FlowModel => ({ ...m, state, overlay: null });

/** A guest at the booth through the six steps (chair, no weaker side, nothing else) to the intro. */
function guestAtIntro(
  position: "chair" | "standing" | "wheelchair" = "chair",
  path: "quick" | "full" = "full",
) {
  return play(
    initialModel(GUEST),
    { type: "START" },
    { type: "GUEST_PATH", path },
    { type: "ADULT_YES" },
    { type: "GUEST_ANSWER", step: 1, value: position },
    { type: "GUEST_ANSWER", step: 2, value: "none" },
    { type: "GUEST_ANSWER", step: 3, value: ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 4, value: "yes" },
    { type: "GUEST_ANSWER", step: 5, value: ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 6, value: ["none"] },
    { type: "GUEST_NEXT" },
  );
}

/** Answers every question benignly until the flow leaves the pre-check. */
function answerAll(m: FlowModel, given: Answers = {}): FlowModel {
  let x = m;
  for (let k = 0; k < 60 && x.state.kind === "question"; k++) {
    const id = x.state.id;
    x = play(x, { type: "ANSWER", id, value: id in given ? given[id] : benign(id) });
  }
  return x;
}

function guestAtPlan(position: "chair" | "standing" | "wheelchair" = "chair"): FlowModel {
  const m = answerAll(
    play(
      guestAtIntro(position),
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    ),
  );
  return kind(m) === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

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

/** The start call's ok answer for the answers on the phone, as the server would freeze it. */
function okStart(m: FlowModel, kindOf: "baseline" | "retest" = "baseline"): StartResult {
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
    id: "11111111-2222-3333-4444-555555555555",
    kind: kindOf,
    protocol,
    warnings: outcome.warnings,
    helperRequired: outcome.helperRequired,
  };
}

function signedAtStarting(ctx?: SignedInContext): FlowModel {
  return answerAll(
    play(
      signedAt({}, ctx),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    ),
  );
}

function signedAtPlan(ctx?: SignedInContext): FlowModel {
  const m = signedAtStarting(ctx);
  const started = play(m, { type: "START_RESULT", result: okStart(m) });
  return kind(started) === "warnings" ? play(started, { type: "CONTINUE" }) : started;
}

const cam = (k: FlowState["kind"], i = 0, side = 0, extra: Record<string, unknown> = {}) =>
  ({ kind: k, i, side, ...extra }) as FlowState;

/* ------------------------------------------------------------------ 1. Appendix A */

describe("Appendix A: entry, booth only and the guest steps", () => {
  it("entry: a guest without booth mode sees S05b, with booth mode the welcome, on a desktop S04 first", () => {
    expect(kind(play(initialModel({ ...GUEST, booth: false }), { type: "START" }))).toBe("boothOnly");
    expect(kind(play(initialModel(GUEST), { type: "START" }))).toBe("guestWelcome");
    const desk = play(initialModel({ ...GUEST, desktop: true }), { type: "START" });
    expect(kind(desk)).toBe("desktopGate");
    expect(kind(play(desk, { type: "CONTINUE" }))).toBe("guestWelcome");
  });

  it("entry: a guest with open home checks but no booth mode still sees S05b (contract v3 I)", () => {
    expect(kind(play(initialModel({ ...GUEST, booth: false, homeOpen: true }), { type: "START" }))).toBe(
      "boothOnly",
    );
  });

  it("boothOnly: example and try a workout leave the flow", () => {
    const m = play(initialModel({ ...GUEST, booth: false }), { type: "START" });
    expect(play(m, { type: "EXAMPLE" }).state).toEqual({ kind: "exit", to: "example" });
    expect(play(m, { type: "TRY_WORKOUT" }).state).toEqual({ kind: "exit", to: "try" });
  });

  it("guestWelcome: quick or full opens the adult gate; the example leaves", () => {
    const m = play(initialModel(GUEST), { type: "START" });
    for (const path of ["quick", "full"] as const) {
      const n = play(m, { type: "GUEST_PATH", path });
      expect(kind(n)).toBe("adultGate");
      expect(n.data.guestPath).toBe(path);
    }
    expect(play(m, { type: "EXAMPLE" }).state).toEqual({ kind: "exit", to: "example" });
  });

  it("adultGate: yes starts the guest steps, no shows the adult card, which restarts the visit", () => {
    const m = play(initialModel(GUEST), { type: "START" }, { type: "GUEST_PATH", path: "full" });
    expect(play(m, { type: "ADULT_YES" }).state).toEqual({ kind: "guestSetup", step: 1 });
    const under = play(m, { type: "ADULT_NO" });
    expect(kind(under)).toBe("adultEnd");
    expect(kind(play(under, { type: "RESTART" }))).toBe("guestWelcome");
    expect(play(under, { type: "EXIT" }).state).toEqual({ kind: "exit", to: "landing" });
  });

  it("guestSetup: single steps submit on tap, multiple steps wait for Next, Back keeps the answer", () => {
    let m = play(
      initialModel(GUEST),
      { type: "START" },
      { type: "GUEST_PATH", path: "full" },
      { type: "ADULT_YES" },
    );
    m = play(m, { type: "GUEST_ANSWER", step: 1, value: "chair" });
    expect(m.state).toEqual({ kind: "guestSetup", step: 2 });
    m = play(m, { type: "GUEST_ANSWER", step: 2, value: "left" });
    expect(m.state).toEqual({ kind: "guestSetup", step: 3 });
    // Next without an answer stays (the screen shows "Choose an answer to continue").
    expect(play(m, { type: "GUEST_NEXT" }).state).toEqual({ kind: "guestSetup", step: 3 });
    m = play(m, { type: "GUEST_ANSWER", step: 3, value: ["stroke"] });
    expect(m.state).toEqual({ kind: "guestSetup", step: 3 });
    // None is exclusive and clears the others.
    expect(
      play(m, { type: "GUEST_ANSWER", step: 3, value: ["stroke", "none"] }).data.guest.conditions,
    ).toEqual(["none"]);
    const back = play(m, { type: "BACK" });
    expect(back.state).toEqual({ kind: "guestSetup", step: 2 });
    expect(back.data.guest.support).toBe("left");
    expect(
      play(
        play(
          initialModel(GUEST),
          { type: "START" },
          { type: "GUEST_PATH", path: "full" },
          { type: "ADULT_YES" },
        ),
        { type: "BACK" },
      ).state,
    ).toEqual({ kind: "guestWelcome" });
  });

  it("guestSetup: the last step goes to the intro, or to the team (S09) when the rules give no check", () => {
    expect(kind(guestAtIntro())).toBe("intro");
    const bed = play(
      initialModel(GUEST),
      { type: "START" },
      { type: "GUEST_PATH", path: "full" },
      { type: "ADULT_YES" },
      { type: "GUEST_ANSWER", step: 1, value: "bed" },
      { type: "GUEST_ANSWER", step: 2, value: "none" },
      { type: "GUEST_ANSWER", step: 3, value: ["cardiac"] },
      { type: "GUEST_NEXT" },
      { type: "GUEST_ANSWER", step: 4, value: "no" },
      { type: "GUEST_ANSWER", step: 5, value: ["none"] },
      { type: "GUEST_NEXT" },
      { type: "GUEST_ANSWER", step: 6, value: ["none"] },
      { type: "GUEST_NEXT" },
    );
    expect(kind(bed)).toBe("guestStaff");
    expect(kind(play(bed, { type: "RESTART" }))).toBe("guestWelcome");
    expect(play(bed, { type: "RESTART" }).data.guest).toEqual({});
  });

  it("the quick path keeps the arm raise only", () => {
    const m = guestAtIntro("chair", "quick");
    expect(m.data.env!.baseTests).toEqual(["shoulder_abduction"]);
  });
});

describe("Appendix A: signed in entry, consent, context, intro, sound check", () => {
  it("entry routes by the context: blocked and closed leave, desktop, lock, consent, adult, context", () => {
    expect(signedAt({}, contextOf({}, { blocked: "cardiac", ctx: null })).state).toEqual({
      kind: "exit",
      to: "today",
    });
    expect(
      play(initialModel({ ...SIGNED }), {
        type: "CONTEXT_LOADED",
        context: contextOf({}, { homeOpen: false }),
      }).state,
    ).toEqual({ kind: "exit", to: "today" });
    // A booth tab runs even while home checks are closed.
    expect(
      kind(
        play(initialModel({ ...SIGNED, booth: true }), {
          type: "CONTEXT_LOADED",
          context: contextOf({}, { homeOpen: false }),
        }),
      ),
    ).toBe("context");
    expect(kind(signedAt({ desktop: true }))).toBe("desktopGate");
    expect(kind(play(signedAt({ desktop: true }), { type: "CONTINUE" }))).toBe("context");
    expect(signedAt({}, contextOf({}, { lock: { until: NOW + 3600_000, releasable: true } })).state).toEqual({
      kind: "paused",
      until: NOW + 3600_000,
      releasable: true,
    });
    // An expired lock does not stop the check.
    expect(kind(signedAt({}, contextOf({}, { lock: { until: NOW - 1, releasable: false } })))).toBe(
      "context",
    );
    expect(kind(signedAt({}, contextOf({}, { consent: false })))).toBe("consent");
    expect(kind(signedAt({}, contextOf({}, { adultConfirmed: undefined })))).toBe("adultGate");
    expect(kind(signedAt())).toBe("context");
  });

  it("entry: a failed context shows the error with Try again", () => {
    const failed = play(initialModel(SIGNED), { type: "CONTEXT_FAILED" });
    expect(failed.state).toEqual({ kind: "entry", error: "context" });
    expect(play(failed, { type: "RETRY" }).state).toEqual({ kind: "entry", error: null });
  });

  it("consent: accepted opens the adult gate if needed, else the context; not now leaves", () => {
    const needsAdult = signedAt({}, contextOf({}, { consent: false, adultConfirmed: undefined }));
    expect(kind(play(needsAdult, { type: "CONSENT_ACCEPTED" }))).toBe("adultGate");
    expect(kind(play(play(needsAdult, { type: "CONSENT_ACCEPTED" }), { type: "ADULT_YES" }))).toBe("context");
    const adult = signedAt({}, contextOf({}, { consent: false }));
    expect(kind(play(adult, { type: "CONSENT_ACCEPTED" }))).toBe("context");
    expect(play(adult, { type: "NOT_NOW" }).state).toEqual({ kind: "exit", to: "today" });
  });

  it("context: confirm opens the intro; edit leaves for the health profile", () => {
    expect(kind(play(signedAt(), { type: "CONTEXT_CONFIRM" }))).toBe("intro");
    expect(play(signedAt(), { type: "CONTEXT_EDIT" }).state).toEqual({ kind: "exit", to: "healthEdit" });
  });

  it("intro, sound check and the pre-check notice lead to the first question", () => {
    let m = play(signedAt(), { type: "CONTEXT_CONFIRM" }, { type: "CONTINUE" });
    expect(kind(m)).toBe("soundCheck");
    m = play(m, { type: "SOUND_RESULT", mode: "captionsOnly" });
    expect(kind(m)).toBe("precheckNotice");
    expect(m.data.soundMode).toBe("captionsOnly");
    m = play(m, { type: "PRECHECK_START" });
    expect(m.state).toEqual({ kind: "question", id: "pc_urgent" });
  });

  it("an unresolved reported change asks pc_change_cleared among the first questions", () => {
    const m = play(
      signedAt(
        {},
        contextOf({}, { unresolvedChangeReported: true, firstCheck: false, completedBefore: true }),
      ),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    const ids: string[] = [];
    let x = m;
    for (let k = 0; k < 3 && x.state.kind === "question"; k++) {
      ids.push(x.state.id);
      x = play(x, { type: "ANSWER", id: x.state.id, value: benign(x.state.id) });
    }
    expect(ids).toContain("pc_change_cleared");
  });

  it("Back walks the intro chain and the questions, and never leaves a safety screen", () => {
    const q2 = play(
      signedAt(),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
      { type: "ANSWER", id: "pc_urgent", value: "no" },
    );
    expect(q2.state).toEqual({ kind: "question", id: "pc_unwell" });
    const back = play(q2, { type: "BACK" });
    expect(back.state).toEqual({ kind: "question", id: "pc_urgent" });
    expect(back.data.answers.pc_urgent).toBe("no");
    expect(play(back, { type: "BACK" }).state).toEqual({ kind: "precheckNotice" });
    expect(play(back, { type: "BACK" }, { type: "BACK" }).state).toEqual({ kind: "soundCheck" });
    expect(play(back, { type: "BACK" }, { type: "BACK" }, { type: "BACK" }).state).toEqual({ kind: "intro" });
    expect(play(back, { type: "BACK" }, { type: "BACK" }, { type: "BACK" }, { type: "BACK" }).state).toEqual({
      kind: "context",
    });
    const safety = play(back, { type: "ANSWER", id: "pc_urgent", value: "yes" });
    expect(backTarget(safety)).toBeNull();
    expect(play(safety, { type: "BACK" }).state).toEqual(safety.state);
  });
});

describe("Appendix A: pre-check questions, confirm in place, the start call", () => {
  const atQuestions = () =>
    play(
      signedAt(),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );

  it("an answer that postpones expands the confirm; yes shows S33 and change clears the answer", () => {
    const m = play(
      atQuestions(),
      { type: "ANSWER", id: "pc_urgent", value: "no" },
      { type: "ANSWER", id: "pc_unwell", value: "yes" },
    );
    expect(m.state).toEqual({ kind: "confirmPostpone", id: "pc_unwell", value: "yes" });
    expect(m.effects).toEqual([]);
    const yes = play(m, { type: "CONFIRM_YES" });
    expect(kind(yes)).toBe("postponed");
    expect(yes.state).toMatchObject({ reason: "unwell" });
    expect(yes.data.lock?.until).toBeGreaterThan(NOW);
    const change = play(m, { type: "CONFIRM_CHANGE" });
    expect(change.state).toEqual({ kind: "question", id: "pc_unwell" });
    expect(change.data.answers.pc_unwell).toBeUndefined();
  });

  it("emergency and AD answers route at once, with no confirm", () => {
    expect(play(atQuestions(), { type: "ANSWER", id: "pc_urgent", value: "yes" }).state).toMatchObject({
      kind: "safety",
      safety: "emergency",
      screen: "scr_emergency",
    });
    const sci = play(
      signedAt({}, contextOf({ conditions: ["sci_complete"], position: "wheelchair" })),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    const ad = answerAll(sci, { pc_sci_level: "yes", pc_sci_ad_now: "yes" });
    expect(ad.state).toMatchObject({ kind: "safety", safety: "ad", screen: "scr_ad" });
  });

  it("the last answer starts the check (signed in) with the start effect", () => {
    const m = signedAtStarting();
    expect(m.state).toMatchObject({ kind: "starting", error: null, attempt: 1 });
    expect(m.effects.map((e) => e.type)).toEqual(["start"]);
  });

  it("starting: ok freezes the protocol and drops the raw answers; warnings first when any apply", () => {
    const m = signedAtStarting();
    const ok = play(m, { type: "START_RESULT", result: okStart(m) });
    expect(kind(ok)).toBe("plan");
    expect(ok.data.answers).toEqual({});
    expect(ok.data.checkId).toBe("11111111-2222-3333-4444-555555555555");
    const warned = play(m, {
      type: "START_RESULT",
      result: { ...(okStart(m) as Extract<StartResult, { ok: true }>), warnings: ["warn_pain_high"] },
    });
    expect(kind(warned)).toBe("warnings");
    expect(kind(play(warned, { type: "CONTINUE" }))).toBe("plan");
    // Warnings that belong to a test (S28) or to the helper briefing (S26) do not open S25.
    const atTest = play(m, {
      type: "START_RESULT",
      result: { ...(okStart(m) as Extract<StartResult, { ok: true }>), warnings: ["warn_sci_t6"] },
    });
    expect(kind(atTest)).toBe("plan");
  });

  it("starting: 409 POSTPONE, 409 LOCKED, 403 CONSENT_REQUIRED, errors with Try again", () => {
    const m = signedAtStarting();
    const postponed = play(m, {
      type: "START_RESULT",
      result: {
        ok: false,
        code: "POSTPONE",
        status: "postpone",
        reason: "pain",
        screen: "scr_postpone_pain",
        alsoShow: [],
        lock: { until: NOW + 1 },
      },
    });
    expect(postponed.state).toMatchObject({ kind: "postponed", reason: "pain" });
    const stricter = play(m, {
      type: "START_RESULT",
      result: {
        ok: false,
        code: "POSTPONE",
        status: "emergency",
        reason: "urgent",
        screen: "scr_emergency",
        alsoShow: [],
        lock: null,
      },
    });
    expect(stricter.state).toMatchObject({ kind: "safety", safety: "emergency" });
    expect(
      play(m, {
        type: "START_RESULT",
        result: { ok: false, code: "LOCKED", until: NOW + 5, releasable: false },
      }).state,
    ).toEqual({
      kind: "paused",
      until: NOW + 5,
      releasable: false,
    });
    expect(kind(play(m, { type: "START_RESULT", result: { ok: false, code: "CONSENT_REQUIRED" } }))).toBe(
      "consent",
    );
    for (const code of ["offline", "network", "server", "RATE_LIMIT"] as const) {
      const failed = play(m, { type: "START_RESULT", result: { ok: false, code } });
      expect(failed.state).toMatchObject({ kind: "starting", error: code });
      // The answers are kept for Try again.
      expect(Object.keys(failed.data.answers).length).toBeGreaterThan(0);
      const retried = play(failed, { type: "RETRY" });
      expect(retried.state).toMatchObject({ kind: "starting", error: null, attempt: 2 });
      expect(retried.effects.filter((e) => e.type === "start")).toHaveLength(2);
      expect(play(failed, { type: "EXIT" }).state).toEqual({ kind: "exit", to: "today" });
    }
    // Answers a retry cannot change route instead of Try again (L20).
    for (const code of ["HOME_CLOSED", "TOO_SOON", "REVIEW", "PLAN_REQUIRED", "START_INVALID"] as const)
      expect(play(m, { type: "START_RESULT", result: { ok: false, code } }).state, code).toEqual({
        kind: "exit",
        to: "today",
      });
    const auth = play(m, { type: "START_RESULT", result: { ok: false, code: "AUTH" } });
    expect(auth.state).toEqual({ kind: "exit", to: "signIn" });
    const booth = play(m, { type: "START_RESULT", result: { ok: false, code: "BOOTH_CODE" } });
    expect(booth.state).toEqual({ kind: "exit", to: "boothStaff" });
    expect(booth.effects.some((x) => x.type === "clearBoothCode")).toBe(true);
  });

  it("the guest proceeds on the phone: no start call, the protocol frozen locally", () => {
    const m = guestAtPlan();
    expect(kind(m)).toBe("plan");
    expect(m.effects).toEqual([]);
    expect(m.data.tests.map((t) => t.testId)).toEqual([
      "shoulder_abduction",
      "trunk_control_seated",
      "arm_curl_30s",
    ]);
    expect(m.data.checkId).toBeNull();
  });
});

describe("Appendix A: plan, instruction and preparation", () => {
  it("plan: start opens the first instruction; with nothing to run the flow leaves", () => {
    const m = guestAtPlan();
    expect(play(m, { type: "PLAN_START" }).state).toEqual({ kind: "test.instruction", i: 0 });
    const empty = { ...m, data: { ...m.data, tests: [] } };
    expect(play(empty, { type: "PLAN_START" }).state).toEqual({ kind: "exit", to: "landing" });
  });

  it("test.instruction: ready runs the preparation screens in map 2.3 order, then the setup check", () => {
    const m = play(signedAtPlan(), { type: "PLAN_START" });
    // First camera use in the check: the primer first.
    expect(play(m, { type: "READY" }).state).toEqual({ kind: "test.primer", i: 0 });
    expect(play(m, { type: "READY" }, { type: "PREP_NEXT" }).state).toEqual({
      kind: "cam.setup",
      i: 0,
      side: 0,
    });
    // The arm curl at home, first check, with a load: grip, load, (primer only if the camera is new).
    const curl = signedAtPlan().data.tests.findIndex((t) => t.testId === "arm_curl_30s");
    const used = {
      ...m,
      data: { ...m.data, cameraUsed: true },
      state: { kind: "test.instruction", i: curl } as FlowState,
    };
    expect(prepSteps(used.data, curl)).toEqual(["grip", "load"]);
    const g = play(used, { type: "READY" });
    expect(g.state).toEqual({ kind: "test.grip", i: curl });
    expect(play(g, { type: "PREP_NEXT" }).state).toEqual({ kind: "test.load", i: curl });
    expect(play(g, { type: "PREP_NEXT" }, { type: "PREP_NEXT" }).state).toEqual({
      kind: "cam.setup",
      i: curl,
      side: 0,
    });
    expect(play(g, { type: "PREP_NEXT" }, { type: "BACK" }).state).toEqual({ kind: "test.grip", i: curl });
  });

  it("test.instruction: the chair gate no skips the chair stand; skip opens the skip dialog", () => {
    const m = play(signedAtPlan(), { type: "PLAN_START" });
    const skipped = play(m, { type: "CHAIR_GATE_NO" });
    expect(kind(skipped)).toBe("skipNotice");
    const dialog = play(m, { type: "SKIP" });
    expect(dialog.overlay).toEqual({ kind: "skipDialog" });
    expect(play(dialog, { type: "SKIP_CANCEL" }).state).toEqual(m.state);
    expect(play(dialog, { type: "SKIP_CANCEL" }).overlay).toBeNull();
    const confirmed = play(dialog, { type: "SKIP_CONFIRM" });
    expect(kind(confirmed)).toBe("skipNotice");
    expect(confirmed.state).toMatchObject({ rows: [{ reason: "by_choice" }, { reason: "by_choice" }] });
    expect(play(confirmed, { type: "CONTINUE" }).state).toEqual({ kind: "test.instruction", i: 1 });
  });

  it("a camera error on the primer opens S32; Try again returns to the primer, later leaves", () => {
    const m = play(signedAtPlan(), { type: "PLAN_START" }, { type: "READY" });
    const denied = play(m, { type: "CAMERA_ERROR", problem: "denied" });
    expect(denied.state).toEqual({
      kind: "cam.problem",
      problem: "denied",
      returnTo: { kind: "test.primer", i: 0 },
    });
    expect(play(denied, { type: "RETRY" }).state).toEqual({ kind: "test.primer", i: 0 });
    expect(play(denied, { type: "LATER" }).state).toEqual({ kind: "exit", to: "today" });
  });
});

describe("Appendix A: the camera states", () => {
  const planned = guestAtPlan();
  const at = (s: FlowState, run: Partial<FlowModel["data"]["run"]> = {}) =>
    ({
      ...withState(planned, s),
      data: { ...planned.data, cameraUsed: true, run: { ...planned.data.run, ...run } },
    }) as FlowModel;
  const curl = planned.data.tests.findIndex((t) => t.testId === "arm_curl_30s");
  const trunk = planned.data.tests.findIndex((t) => t.testId === "trunk_control_seated");
  const standing = guestAtPlan("standing");
  const stand = standing.data.tests.findIndex((t) => t.testId === "chair_stand_30s");

  it("cam.setup: ok leads to calibrate, practice, the countdown (timed) or the measure", () => {
    expect(kind(play(at(cam("cam.setup")), { type: "SETUP_OK" }))).toBe("cam.calibrate");
    expect(kind(play(at(cam("cam.setup"), { calibrated: true }), { type: "SETUP_OK" }))).toBe("cam.practice");
    expect(
      kind(play(at(cam("cam.setup"), { calibrated: true, practiced: true }), { type: "SETUP_OK" })),
    ).toBe("cam.measure");
    expect(
      kind(play(at(cam("cam.setup", curl), { calibrated: true, practiced: true }), { type: "SETUP_OK" })),
    ).toBe("cam.countdown");
    expect(play(at(cam("cam.setup")), { type: "SKIP" }).overlay).toEqual({ kind: "skipDialog" });
    const motion = play(at(cam("cam.setup")), { type: "MOTION_REFUSED" });
    expect(motion.state).toMatchObject({
      kind: "skipNotice",
      rows: [{ reason: "motion_needed" }, { reason: "motion_needed" }],
    });
  });

  it("cam.calibrate: done goes to practice, stillness offers a retry or a skip", () => {
    expect(kind(play(at(cam("cam.calibrate", 0, 0, { offer: false })), { type: "CALIBRATED" }))).toBe(
      "cam.practice",
    );
    const still = play(at(cam("cam.calibrate", 0, 0, { offer: false })), { type: "CALIBRATION_STILL" });
    expect(still.state).toMatchObject({ kind: "cam.calibrate", offer: true });
    expect(play(still, { type: "RETRY" }).state).toMatchObject({ kind: "cam.calibrate", offer: false });
    expect(play(still, { type: "SKIP" }).overlay).toEqual({ kind: "skipDialog" });
  });

  it("cam.practice: arm raise measures, the arm curl counts down (no load) or asks the practice check, the chair stand rests", () => {
    expect(kind(play(at(cam("cam.practice")), { type: "PRACTICE_DONE" }))).toBe("cam.measure");
    expect(kind(play(at(cam("cam.practice", curl)), { type: "PRACTICE_DONE" }))).toBe("cam.countdown");
    expect(kind(play(at(cam("cam.practice", curl)), { type: "PRACTICE_DONE", withLoad: true }))).toBe(
      "test.practiceCheck",
    );
    const standAt = { ...withState(standing, cam("cam.practice", stand)) };
    expect(play(standAt, { type: "PRACTICE_DONE" }).state).toMatchObject({
      kind: "cam.rest",
      purpose: "practice",
    });
  });

  it("test.practiceCheck: yes returns through the setup check to the countdown, no steps the load down", () => {
    const ok = play(at(cam("test.practiceCheck", curl), { calibrated: true }), { type: "PRACTICE_OK" });
    expect(ok.state).toEqual({ kind: "cam.setup", i: curl, side: 0 });
    expect(kind(play(ok, { type: "SETUP_OK" }))).toBe("cam.countdown");
    const heavy = play(at(cam("test.practiceCheck", curl), { calibrated: true }), { type: "PRACTICE_HEAVY" });
    expect(heavy.state).toEqual({ kind: "test.load", i: curl, stepDown: true });
    const back = play(heavy, { type: "PREP_NEXT" });
    expect(back.state).toEqual({ kind: "cam.setup", i: curl, side: 0 });
    expect(kind(play(back, { type: "SETUP_OK" }))).toBe("cam.practice");
  });

  it("cam.countdown: go measures", () => {
    expect(kind(play(at(cam("cam.countdown", curl)), { type: "GO" }))).toBe("cam.measure");
  });

  it("cam.measure: ok saves, a quality failure retries, used arms ask, an armed trigger opens the check in", () => {
    expect(kind(play(at(cam("cam.measure")), { type: "ATTEMPT_OK" }))).toBe("cam.saved");
    expect(play(at(cam("cam.measure")), { type: "QUALITY_FAIL", issue: "out_of_frame" }).state).toMatchObject(
      {
        kind: "cam.retry",
        issue: "out_of_frame",
        exhausted: false,
      },
    );
    expect(kind(play(at(cam("cam.measure")), { type: "ARMS_USED" }))).toBe("after.pushed");
    expect(play(at(cam("cam.measure")), { type: "TRIGGER", trigger: "no_movement" }).overlay).toEqual({
      kind: "checkIn",
      from: "test",
      trigger: "no_movement",
      attempt: true,
    });
    // A moved phone discards the attempt without a retry; in a timed trial it is a quality failure.
    expect(play(at(cam("cam.measure")), { type: "PHONE_MOVED" }).state).toEqual(cam("cam.setup"));
    expect(play(at(cam("cam.measure", curl)), { type: "PHONE_MOVED" }).state).toMatchObject({
      kind: "cam.retry",
      issue: "phone_moved",
    });
  });

  it("cam.saved: rest while attempts remain, then the side's question", () => {
    expect(play(at(cam("cam.saved"), { saved: 1 }), { type: "SAVED_NEXT" }).state).toMatchObject({
      kind: "cam.rest",
      purpose: "attempt",
    });
    expect(play(at(cam("cam.saved"), { saved: 3 }), { type: "SAVED_NEXT" }).state).toMatchObject({
      kind: "between",
      scope: "side",
    });
    expect(kind(play(at(cam("cam.saved", trunk), { saved: 3 }), { type: "SAVED_NEXT" }))).toBe(
      "after.contact",
    );
    expect(kind(play(at(cam("cam.saved", curl), { saved: 1 }), { type: "SAVED_NEXT", after: "count" }))).toBe(
      "after.count",
    );
    const standAt = {
      ...withState(standing, cam("cam.saved", stand)),
      data: { ...standing.data, run: { ...standing.data.run, saved: 1 } },
    };
    expect(play(standAt, { type: "SAVED_NEXT" }).state).toMatchObject({
      kind: "cam.rest",
      purpose: "seated",
    });
  });

  it("cam.retry: retry or its timeout returns to the setup check; exhausted continues; skip asks", () => {
    const r = at(cam("cam.retry", 0, 0, { issue: "too_far", exhausted: false }));
    expect(play(r, { type: "RETRY" }).state).toEqual(cam("cam.setup"));
    expect(play(r, { type: "SKIP" }).overlay).toEqual({ kind: "skipDialog" });
    const done = play(at(cam("cam.retry", 0, 0, { issue: "too_far", exhausted: true })), {
      type: "CONTINUE",
    });
    expect(done.state).toMatchObject({ kind: "between", scope: "side" });
    expect(done.data.outcomes["shoulder_abduction:right"]).toEqual({
      status: "notMeasured",
      reason: "quality",
    });
  });

  it("quality retries: 2 per side for the arm raise, 1 for the timed tests, then exhausted", () => {
    let m = at(cam("cam.measure"), { calibrated: true, practiced: true });
    m = play(m, { type: "QUALITY_FAIL", issue: "low_fps" }, { type: "RETRY" }, { type: "SETUP_OK" });
    expect(kind(m)).toBe("cam.measure");
    m = play(m, { type: "QUALITY_FAIL", issue: "low_fps" }, { type: "RETRY" }, { type: "SETUP_OK" });
    expect(kind(m)).toBe("cam.measure");
    expect(play(m, { type: "QUALITY_FAIL", issue: "low_fps" }).state).toMatchObject({ exhausted: true });
    const t = play(at(cam("cam.measure", curl)), { type: "QUALITY_FAIL", issue: "low_fps" });
    expect(t.state).toMatchObject({ exhausted: false });
    expect(
      play(withState(t, cam("cam.measure", curl)), { type: "QUALITY_FAIL", issue: "low_fps" }).state,
    ).toMatchObject({ exhausted: true });
  });

  it("cam.rest: ends in the measure, the setup check or the pain question by its purpose", () => {
    expect(kind(play(at(cam("cam.rest", 0, 0, { purpose: "attempt" })), { type: "REST_DONE" }))).toBe(
      "cam.measure",
    );
    for (const purpose of ["practice", "redo", "sideChange"])
      expect(kind(play(at(cam("cam.rest", 0, 0, { purpose })), { type: "REST_DONE" }))).toBe("cam.setup");
    expect(play(at(cam("cam.rest", 0, 0, { purpose: "seated" })), { type: "REST_DONE" }).state).toMatchObject(
      { kind: "between", scope: "test" },
    );
  });

  it("after.*: contact goes to the next side, then the pain question; pushed yes skips; count asks the pain question", () => {
    const c0 = play(at(cam("after.contact", trunk, 0)), { type: "AFTER_ANSWER", value: false });
    expect(c0.state).toEqual({ kind: "cam.setup", i: trunk, side: 1 });
    const c1 = play(at(cam("after.contact", trunk, 1)), { type: "AFTER_ANSWER", value: false });
    expect(c1.state).toMatchObject({ kind: "between", scope: "test" });
    const standAt = withState(standing, cam("after.pushed", stand));
    expect(play(standAt, { type: "AFTER_ANSWER", value: true }).state).toMatchObject({
      kind: "skipNotice",
      rows: [{ reason: "needed_arms" }],
    });
    expect(play(standAt, { type: "AFTER_ANSWER", value: false }).state).toMatchObject({
      kind: "cam.rest",
      purpose: "seated",
    });
    expect(play(at(cam("after.count", curl)), { type: "AFTER_ANSWER", value: 12 }).state).toMatchObject({
      kind: "between",
      scope: "side",
    });
  });

  it("between: same goes to the next side, the next test, the guest choice or the end question", () => {
    const side0 = at(cam("between", 0, 0, { scope: "side", via: "test" }));
    // The arm raise rests between its sides (S34j side change), then sets up the next side (S34k).
    expect(play(side0, { type: "BETWEEN_ANSWER", value: "same" }).state).toEqual(
      cam("cam.rest", 0, 1, { purpose: "sideChange" }),
    );
    const measured = {
      ...side0,
      data: { ...side0.data, outcomes: { "shoulder_abduction:right": { status: "measured" as const } } },
    };
    const side1 = withState(measured, cam("between", 0, 1, { scope: "side", via: "test" }));
    // The guest chooses between the next test and the results after a finished test (S46b).
    expect(play(side1, { type: "BETWEEN_ANSWER", value: "same" }).state).toEqual({
      kind: "guestAfterTest",
      next: 1,
    });
    const signed = signedAtPlan();
    const s1 = {
      ...withState(signed, cam("between", 0, 1, { scope: "side", via: "test" })),
      data: { ...signed.data, outcomes: measured.data.outcomes },
    };
    expect(play(s1, { type: "BETWEEN_ANSWER", value: "same" }).state).toEqual({
      kind: "test.instruction",
      i: 1,
    });
    const last = signed.data.tests.length - 1;
    const sLast = {
      ...withState(signed, cam("between", last, 1, { scope: "side", via: "test" })),
      data: { ...signed.data, outcomes: measured.data.outcomes },
    };
    expect(kind(play(sLast, { type: "BETWEEN_ANSWER", value: "same" }))).toBe("endQuestion");
  });

  it("between: a little more pain skips the tests that load the area (S46), much more ends the check (S40b)", () => {
    const side0 = at(cam("between", 0, 0, { scope: "side", via: "test" }));
    const more = play(side0, { type: "BETWEEN_ANSWER", value: "more" });
    expect(kind(more)).toBe("skipNotice");
    const much = play(side0, { type: "BETWEEN_ANSWER", value: "much" });
    expect(much.state).toMatchObject({ kind: "safety", safety: "pain", screen: "scr_stop_pain" });
    expect(much.data.lock?.until).toBeGreaterThan(NOW);
  });

  it("skipNotice: continue follows the continuation computed at the skip", () => {
    const n = play(at(cam("cam.setup")), { type: "SKIP" }, { type: "SKIP_CONFIRM" });
    expect(n.state).toMatchObject({ kind: "skipNotice", then: { to: "test", i: 1 } });
    expect(play(n, { type: "CONTINUE" }).state).toEqual({ kind: "test.instruction", i: 1 });
  });

  it("guestAfterTest: next test or the results via the end question", () => {
    const g = withState(planned, { kind: "guestAfterTest", next: 1 });
    expect(play(g, { type: "GUEST_NEXT_TEST" }).state).toEqual({ kind: "test.instruction", i: 1 });
    expect(kind(play(g, { type: "GUEST_RESULTS" }))).toBe("endQuestion");
  });
});

describe("Appendix A: stop list, stop done, check in, go on, alarm, faint, end", () => {
  const planned = guestAtPlan();
  const measuring = withState(planned, cam("cam.measure"));

  it("STOP is an event on every camera state, after.* and between, and always opens the stop list", () => {
    const kinds: FlowState[] = [
      cam("cam.setup"),
      cam("cam.calibrate", 0, 0, { offer: false }),
      cam("cam.practice"),
      cam("cam.countdown"),
      cam("cam.measure"),
      cam("cam.saved"),
      cam("cam.retry", 0, 0, { issue: "x", exhausted: false }),
      cam("cam.rest", 0, 0, { purpose: "attempt" }),
      cam("after.contact", 1),
      cam("after.pushed"),
      cam("after.count"),
      cam("between", 0, 0, { scope: "side", via: "test" }),
      cam("test.practiceCheck"),
    ];
    for (const s of kinds) {
      expect(cameraRunning(s)).toBe(true);
      expect(play(withState(planned, s), { type: "STOP" }).overlay, s.kind).toEqual({
        kind: "stopList",
        takeYourTime: false,
      });
    }
    // Not on the other states.
    expect(play(withState(planned, { kind: "plan" }), { type: "STOP" }).overlay).toBeNull();
  });

  it("stop list: pain asks S47, tired and other rest a minute (S42), choice goes on, mistake back to setup", () => {
    const open = play(measuring, { type: "STOP" });
    const pain = play(open, { type: "STOP_OPTION", option: "pain" });
    expect(pain.state).toMatchObject({ kind: "between", scope: "test", via: "stop" });
    expect(pain.data.outcomes["shoulder_abduction:right"]).toMatchObject({
      status: "skipped",
      reason: "stopped_symptom",
    });
    expect(play(open, { type: "STOP_OPTION", option: "tired" }).state).toMatchObject({
      kind: "stopDone",
      restSec: 60,
    });
    expect(play(open, { type: "STOP_OPTION", option: "other" }).state).toMatchObject({
      kind: "stopDone",
      restSec: 60,
    });
    expect(play(open, { type: "STOP_OPTION", option: "choice" }).state).toMatchObject({
      kind: "stopDone",
      restSec: 0,
      reason: "by_choice",
    });
    const mistake = play(open, { type: "STOP_OPTION", option: "mistake" });
    expect(mistake.state).toEqual(cam("cam.setup"));
    expect(mistake.data.outcomes).toEqual({});
    expect(play(open, { type: "STOP_NO_INPUT" }).overlay).toEqual({
      kind: "checkIn",
      from: "stopList",
      trigger: "no_answer",
    });
  });

  it("stopDone: next test, end, or change the reason", () => {
    const done = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    expect(play(done, { type: "STOP_NEXT" }).state).toEqual({ kind: "test.instruction", i: 1 });
    expect(kind(play(done, { type: "STOP_END" }))).toBe("results");
    expect(play(done, { type: "CHANGE_REASON" }).overlay).toEqual({ kind: "stopList", takeYourTime: false });
  });

  it("check in: fine returns by origin; want to stop opens the list; help and 15 s sound the alarm", () => {
    const fromTest = play(measuring, { type: "TRIGGER", trigger: "left_frame" });
    expect(play(fromTest, { type: "FINE", via: "raisedHand" }).overlay).toEqual({
      kind: "goOn",
      afterAlarm: false,
      canRedo: true,
    });
    expect(play(fromTest, { type: "WANT_STOP" }).overlay).toEqual({ kind: "stopList", takeYourTime: false });
    expect(play(fromTest, { type: "NEED_HELP" }).overlay).toEqual({
      kind: "alarm",
      from: "test",
      attempt: true,
    });
    expect(play(fromTest, { type: "CHECKIN_TIMEOUT" }).overlay).toEqual({
      kind: "alarm",
      from: "test",
      attempt: true,
    });
    const fromList = play(measuring, { type: "STOP" }, { type: "STOP_NO_INPUT" });
    expect(play(fromList, { type: "FINE", via: "zone" }).overlay).toEqual({
      kind: "stopList",
      takeYourTime: true,
    });
  });

  it("go on: redo rests then sets up, skip notices, help alarms, stop lists", () => {
    const goOn = play(
      measuring,
      { type: "TRIGGER", trigger: "no_movement" },
      { type: "FINE", via: "button" },
    );
    const redo = play(goOn, { type: "REDO" });
    expect(redo.state).toMatchObject({ kind: "cam.rest", purpose: "redo" });
    expect(kind(play(redo, { type: "REST_DONE" }))).toBe("cam.setup");
    expect(kind(play(goOn, { type: "SKIP_TEST" }))).toBe("skipNotice");
    expect(play(goOn, { type: "NEED_HELP" }).overlay).toEqual({ kind: "alarm", from: "test", attempt: true });
    expect(play(goOn, { type: "STOP" }).overlay).toEqual({ kind: "stopList", takeYourTime: false });
  });

  it("alarm: only I am fine leaves it (to go on, after alarm); a call, a stray tap or STOP keeps it", () => {
    const alarm = play(measuring, { type: "TRIGGER", trigger: "hips_drop" }, { type: "CHECKIN_TIMEOUT" });
    expect(alarm.overlay).toEqual({ kind: "alarm", from: "test", attempt: true });
    for (const e of [
      { type: "CALL" },
      { type: "STOP" },
      { type: "SKIP_CANCEL" },
      { type: "LEAVE" },
      { type: "BACK" },
      { type: "WANT_STOP" },
    ] as FlowEvent[])
      expect(play(alarm, e).overlay, e.type).toEqual({ kind: "alarm", from: "test", attempt: true });
    expect(play(alarm, { type: "FINE", via: "button" }).overlay).toEqual({
      kind: "goOn",
      afterAlarm: true,
      canRedo: true,
    });
  });

  it("faint: S38 then S38b; yes or not sure is an emergency, no keeps S38; 30 s opens the check in", () => {
    const faint = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "faint" });
    expect(faint.state).toMatchObject({
      kind: "safety",
      safety: "faint",
      faintAnswered: false,
      askFaint: true,
    });
    // Leaving S38 asks the faint question first.
    expect(kind(play(faint, { type: "EXIT" }))).toBe("faintAsk");
    const ask = play(faint, { type: "FAINT_ASK" });
    expect(kind(ask)).toBe("faintAsk");
    expect(play(ask, { type: "FAINT_ANSWER", value: "yes" }).state).toMatchObject({
      kind: "safety",
      safety: "emergency",
    });
    expect(play(ask, { type: "FAINT_ANSWER", value: "unsure" }).state).toMatchObject({
      kind: "safety",
      safety: "emergency",
    });
    const no = play(ask, { type: "FAINT_ANSWER", value: "no" });
    expect(no.state).toMatchObject({ kind: "safety", safety: "faint", faintAnswered: true });
    expect(kind(play(no, { type: "EXIT" }))).toBe("guestWelcome");
    const quiet = play(ask, { type: "FAINT_TIMEOUT" });
    expect(quiet.overlay).toEqual({ kind: "checkIn", from: "faintAsk", trigger: "no_answer" });
    expect(play(quiet, { type: "FINE", via: "button" }).state).toMatchObject({ kind: "faintAsk" });
    // After a faint, "fine" at the alarm returns to the faint question, not to "go on".
    const alarm = play(quiet, { type: "NEED_HELP" });
    expect(play(alarm, { type: "FINE", via: "button" }).overlay).toBeNull();
    expect(kind(play(alarm, { type: "FINE", via: "button" }))).toBe("faintAsk");
  });

  it("endQuestion: yes is an emergency with a next day lock, no shows the results", () => {
    const end = withState(planned, { kind: "endQuestion" });
    const yes = play(end, { type: "END_ANSWER", yes: true });
    expect(yes.state).toMatchObject({ kind: "safety", safety: "emergency" });
    expect(yes.data.lock?.until).toBeGreaterThan(NOW);
    expect(kind(play(end, { type: "END_ANSWER", yes: false }))).toBe("results");
  });

  it("safety, postponed, paused and results: their ways out", () => {
    const signed = signedAtPlan();
    expect(
      play(
        withState(signed, {
          kind: "safety",
          safety: "fall",
          screen: "scr_fall",
          alsoShow: [],
          faintAnswered: false,
        }),
        { type: "EXIT" },
      ).state,
    ).toEqual({ kind: "exit", to: "today" });
    expect(
      play(withState(signed, { kind: "postponed", reason: "unwell", screen: null, alsoShow: [] }), {
        type: "EXIT",
      }).state,
    ).toEqual({ kind: "exit", to: "today" });
    const sci = withState(signed, {
      kind: "postponed",
      reason: "sci_ready",
      screen: "scr_postpone_sci",
      alsoShow: [],
    });
    expect(play(sci, { type: "RECHECK" }).state).toEqual({ kind: "question", id: "pc_sci_ready" });
    const paused = withState(signedAt(), { kind: "paused", until: NOW + 1, releasable: true });
    expect(play(paused, { type: "RELEASE" }).state).toEqual({ kind: "question", id: "pc_change_cleared" });
    expect(
      play({ ...paused, state: { kind: "paused", until: NOW + 1, releasable: false } }, { type: "RELEASE" })
        .state.kind,
    ).toBe("paused");
    expect(play(paused, { type: "EXIT" }).state).toEqual({ kind: "exit", to: "today" });
    expect(play(withState(signed, { kind: "results" }), { type: "PROGRESS" }).state).toEqual({
      kind: "exit",
      to: "results",
    });
    expect(play(withState(signed, { kind: "results" }), { type: "EXIT" }).state).toEqual({
      kind: "exit",
      to: "today",
    });
    expect(kind(play(withState(planned, { kind: "results" }), { type: "NEW_VISITOR" }))).toBe("guestWelcome");
    expect(play(withState(planned, { kind: "results" }), { type: "NEW_VISITOR" }).data.outcomes).toEqual({});
  });

  it("leave (S15): offered on non camera, non safety states; stay closes, leave exits", () => {
    const plan = withState(planned, { kind: "plan" });
    expect(canLeave(plan)).toBe(true);
    const asked = play(plan, { type: "LEAVE" });
    expect(asked.overlay).toEqual({ kind: "leave" });
    expect(play(asked, { type: "LEAVE_STAY" }).overlay).toBeNull();
    expect(play(asked, { type: "LEAVE_CONFIRM" }).state).toEqual({ kind: "exit", to: "landing" });
    for (const s of [
      cam("cam.measure"),
      { kind: "safety", safety: "fall", screen: "scr_fall", alsoShow: [], faintAnswered: false } as FlowState,
      { kind: "faintAsk" } as FlowState,
    ])
      expect(play(withState(planned, s), { type: "LEAVE" }).overlay, s.kind).toBeNull();
  });

  it("staff reset (booth) returns every state to a fresh welcome; outside booth mode it does nothing", () => {
    for (const s of Object.values(samples()))
      expect(kind(play(s, { type: "STAFF_RESET" })), s.state.kind).toBe(
        s.state.kind === "exit" ? "exit" : "guestWelcome",
      );
    const home = signedAtPlan();
    expect(play(home, { type: "STAFF_RESET" }).state).toEqual(home.state);
  });

  it("resume continues an open check at the first test with a side left", () => {
    const m = signedAtPlan();
    const resumed = play(initialModel(SIGNED), {
      type: "RESUME",
      context: contextOf(),
      check: {
        id: "c1",
        kind: "baseline",
        protocol: m.data.protocol,
        outcomes: {
          "shoulder_abduction:right": { status: "measured" },
          "shoulder_abduction:left": { status: "measured" },
        },
      },
    });
    expect(resumed.state).toEqual({ kind: "test.instruction", i: 1 });
    expect(resumed.data.checkId).toBe("c1");
  });
});

/* ------------------------------------------------------------------ 2. safety from every state */

/** One model in every state kind (guest at the booth, chair). */
function samples(): Record<FlowStateKind, FlowModel> {
  const p = guestAtPlan();
  const q = play(
    guestAtIntro(),
    { type: "CONTINUE" },
    { type: "SOUND_RESULT", mode: "voice" },
    { type: "PRECHECK_START" },
  );
  const states: Record<FlowStateKind, FlowState> = {
    entry: { kind: "entry", error: null },
    boothOnly: { kind: "boothOnly" },
    desktopGate: { kind: "desktopGate" },
    guestWelcome: { kind: "guestWelcome" },
    adultGate: { kind: "adultGate" },
    adultEnd: { kind: "adultEnd" },
    guestSetup: { kind: "guestSetup", step: 3 },
    guestStaff: { kind: "guestStaff" },
    consent: { kind: "consent" },
    context: { kind: "context" },
    intro: { kind: "intro" },
    soundCheck: { kind: "soundCheck" },
    precheckNotice: { kind: "precheckNotice" },
    question: { kind: "question", id: "pc_urgent" },
    confirmPostpone: { kind: "confirmPostpone", id: "pc_unwell", value: "yes" },
    starting: { kind: "starting", lastQuestion: null, error: "network", attempt: 1 },
    warnings: { kind: "warnings" },
    plan: { kind: "plan" },
    "test.instruction": { kind: "test.instruction", i: 0 },
    "test.grip": { kind: "test.grip", i: 2 },
    "test.load": { kind: "test.load", i: 2 },
    "test.helper": { kind: "test.helper", i: 1 },
    "test.primer": { kind: "test.primer", i: 0 },
    "test.practiceCheck": cam("test.practiceCheck", 2),
    "cam.setup": cam("cam.setup"),
    "cam.calibrate": cam("cam.calibrate", 0, 0, { offer: false }),
    "cam.practice": cam("cam.practice"),
    "cam.countdown": cam("cam.countdown", 2),
    "cam.measure": cam("cam.measure"),
    "cam.saved": cam("cam.saved"),
    "cam.retry": cam("cam.retry", 0, 0, { issue: "too_far", exhausted: false }),
    "cam.rest": cam("cam.rest", 0, 0, { purpose: "attempt" }),
    "after.contact": cam("after.contact", 1),
    "after.pushed": cam("after.pushed", 2),
    "after.count": cam("after.count", 2),
    between: cam("between", 0, 0, { scope: "side", via: "test" }),
    skipNotice: { kind: "skipNotice", rows: [], then: { to: "test", i: 1 } },
    guestAfterTest: { kind: "guestAfterTest", next: 1 },
    stopDone: { kind: "stopDone", i: 0, restSec: 0, reason: "by_choice" },
    faintAsk: { kind: "faintAsk" },
    endQuestion: { kind: "endQuestion" },
    safety: { kind: "safety", safety: "fall", screen: "scr_fall", alsoShow: [], faintAnswered: false },
    postponed: { kind: "postponed", reason: "unwell", screen: "scr_postpone_unwell", alsoShow: [] },
    paused: { kind: "paused", until: NOW + 1, releasable: false },
    "cam.problem": { kind: "cam.problem", problem: "denied", returnTo: { kind: "test.primer", i: 0 } },
    results: { kind: "results" },
    exit: { kind: "exit", to: "landing" },
  };
  const out = {} as Record<FlowStateKind, FlowModel>;
  for (const [k, s] of Object.entries(states) as [FlowStateKind, FlowState][]) {
    const base = k === "question" || k === "confirmPostpone" ? q : p;
    out[k] = withState(base, s);
  }
  return out;
}

const SAFETY_SCREENS: [string, SafetyKind][] = [
  ["scr_emergency", "emergency"],
  ["scr_ad", "ad"],
  ["scr_faint", "faint"],
  ["scr_fall", "fall"],
  ["scr_fall_seated", "fall"],
  ["scr_stop_seek_care", "seekCare"],
  ["scr_stop_pain", "pain"],
];

describe("every safety event from every state reaches its safety screen", () => {
  const all = samples();

  it("covers every state kind", () => {
    expect(Object.keys(all).sort()).toEqual(Object.keys(all).sort());
    expect(Object.keys(all)).toHaveLength(47);
  });

  it.each(Object.keys(all))("a safety screen from the server or a stricter answer, from %s", (k) => {
    const m = all[k as FlowStateKind];
    for (const [screen, safety] of SAFETY_SCREENS) {
      const n = play(m, { type: "SAFETY", screen: screen as never, lock: "next_day" });
      if (k === "exit") {
        expect(n.state.kind).toBe("exit");
        continue;
      }
      expect(n.state, `${k} -> ${screen}`).toMatchObject({ kind: "safety", safety, screen });
      expect(n.overlay).toBeNull();
      expect(screenFor(n)).toMatch(/^S3[6-9]|^S40/);
    }
  });

  it.each(Object.keys(all))("a safety screen also wins over any overlay, from %s", (k) => {
    const m = all[k as FlowStateKind];
    if (k === "exit") return;
    for (const overlay of [
      { kind: "alarm", from: "test" },
      { kind: "stopList", takeYourTime: false },
      { kind: "leave" },
    ] as FlowModel["overlay"][]) {
      const n = play({ ...m, overlay }, { type: "SAFETY", screen: "scr_emergency" });
      expect(n.state).toMatchObject({ kind: "safety", safety: "emergency" });
      expect(n.overlay).toBeNull();
    }
  });

  const running = (Object.keys(all) as FlowStateKind[]).filter((k) => cameraRunning(all[k].state));
  const STOPS: [StopOptionId, SafetyKind][] = [
    ["chest", "emergency"],
    ["stroke_signs", "emergency"],
    ["ad_signs", "ad"],
    ["faint", "faint"],
    ["breath", "seekCare"],
    ["fall", "fall"],
  ];

  it("the camera running states are the 13 of Appendix A", () => {
    expect(running.sort()).toEqual(
      [
        "after.contact",
        "after.count",
        "after.pushed",
        "between",
        "cam.calibrate",
        "cam.countdown",
        "cam.measure",
        "cam.practice",
        "cam.rest",
        "cam.retry",
        "cam.saved",
        "cam.setup",
        "test.practiceCheck",
      ].sort(),
    );
  });

  it.each(running)("every safety option of the stop list, from %s", (k) => {
    for (const [option, safety] of STOPS) {
      const n = play(all[k], { type: "STOP" }, { type: "STOP_OPTION", option });
      expect(n.state, `${k} ${option}`).toMatchObject({ kind: "safety", safety });
      expect(n.data.lock?.until, `${k} ${option}`).toBeGreaterThan(NOW);
    }
  });

  it.each(running)("the check in reaches the alarm, and help from go on too, from %s", (k) => {
    const checkIn = play(all[k], { type: "TRIGGER", trigger: "no_movement" });
    expect(overlayFor(checkIn)).toBe("S43");
    expect(overlayFor(play(checkIn, { type: "NEED_HELP" }))).toBe("S45");
    expect(overlayFor(play(checkIn, { type: "CHECKIN_TIMEOUT" }))).toBe("S45");
    // After an attempt "I am fine" asks whether to go on (S44), whose help sounds the alarm; after a
    // finished side, a rest or a question it simply returns to the state (nothing is measured again).
    const fine = play(checkIn, { type: "FINE", via: "zone" });
    if (isAttemptState(all[k].state)) {
      expect(overlayFor(fine)).toBe("S44");
      expect(overlayFor(play(fine, { type: "NEED_HELP" }))).toBe("S45");
    } else {
      expect(fine.overlay).toBeNull();
      expect(fine.state).toEqual(all[k].state);
    }
    // From the stop list too: no answer in 30 s opens the check in, which alarms after 15 s.
    expect(
      overlayFor(play(all[k], { type: "STOP" }, { type: "STOP_NO_INPUT" }, { type: "CHECKIN_TIMEOUT" })),
    ).toBe("S45");
  });

  it("pc_urgent yes is an emergency whenever it is answered, also after going back", () => {
    const q = all.question;
    expect(play(q, { type: "ANSWER", id: "pc_urgent", value: "yes" }).state).toMatchObject({
      kind: "safety",
      safety: "emergency",
    });
    const later = play(
      q,
      { type: "ANSWER", id: "pc_urgent", value: "no" },
      { type: "ANSWER", id: "pc_unwell", value: "no" },
      { type: "BACK" },
      { type: "BACK" },
    );
    expect(later.state).toEqual({ kind: "question", id: "pc_urgent" });
    expect(play(later, { type: "ANSWER", id: "pc_urgent", value: "yes" }).state).toMatchObject({
      kind: "safety",
      safety: "emergency",
    });
  });

  it("much more pain between tests ends the check from every kind of pain question", () => {
    for (const s of [
      cam("between", 0, 0, { scope: "side", via: "test" }),
      cam("between", 1, 1, { scope: "test", via: "test" }),
      cam("between", 0, 0, { scope: "test", via: "stop" }),
    ]) {
      expect(
        play(all.plan.state.kind === "plan" ? withState(all.plan, s) : all.plan, {
          type: "BETWEEN_ANSWER",
          value: "much",
        }).state,
      ).toMatchObject({ kind: "safety", safety: "pain" });
    }
  });

  it("safety kinds of the data screens", () => {
    expect(safetyKindOf("scr_faint_sci")).toBe("faint");
    expect(safetyKindOf("scr_postpone_pain")).toBeNull();
  });
});

/* ------------------------------------------------------------------ 3. effects */

describe("network effects", () => {
  it("the guest flow never produces one, through a whole check with stops and skips", () => {
    let m = play(guestAtPlan(), { type: "PLAN_START" });
    const seen: string[] = [];
    const step = (e: FlowEvent) => {
      m = play(m, e);
      seen.push(...m.effects.map((x) => x.type));
    };
    for (let k = 0; k < 300 && !["results", "exit"].includes(kind(m)); k++) {
      const s = m.state;
      if (s.kind === "cam.measure" && k % 7 === 0) step({ type: "QUALITY_FAIL", issue: "too_far" });
      else if (s.kind === "cam.setup" && k === 40) {
        step({ type: "STOP" });
        step({ type: "STOP_OPTION", option: "choice" });
      } else step(autopilot(m));
    }
    expect(seen).toEqual([]);
    expect(kind(m)).toBe("results");
  });

  it("the signed in flow: start, background safety posts, stop and between directly, results and completion", () => {
    const starting = signedAtStarting();
    expect(starting.effects.map((e) => e.type)).toEqual(["start"]);
    // A postpone is posted in the background (the server sets the lock); never a queued call.
    const q = play(
      signedAt(),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    const postponed = play(
      q,
      { type: "ANSWER", id: "pc_urgent", value: "no" },
      { type: "ANSWER", id: "pc_unwell", value: "yes" },
      { type: "CONFIRM_YES" },
    );
    expect(postponed.effects.map((e) => e.type)).toEqual(["startBackground"]);
    const emergency = play(q, { type: "ANSWER", id: "pc_urgent", value: "yes" });
    expect(emergency.effects.map((e) => e.type)).toEqual(["startBackground"]);

    let m = play(signedAtPlan(), { type: "PLAN_START" });
    m = { ...m, effects: [] };
    const measuring = withState(m, cam("cam.measure"));
    const stopped = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    // The stopped test's skips go before the stop, so an ended check has them (the outbox keeps order).
    expect(stopped.effects.map((e) => e.type)).toEqual(["result", "result", "stop"]);
    expect(stopped.effects[0]).toMatchObject({
      type: "result",
      body: { skippedReason: "by_choice", value: null, attempts: [] },
    });
    const between = play(withState(m, cam("between", 0, 0, { scope: "side", via: "test" })), {
      type: "BETWEEN_ANSWER",
      value: "same",
    });
    expect(between.effects.map((e) => e.type)).toEqual(["between"]);
    const withResult = play(measuring, {
      type: "SIDE_RESULT",
      testId: "shoulder_abduction",
      side: "right",
      outcome: { status: "measured", value: 120 },
      body: {
        testId: "shoulder_abduction",
        side: "right",
        value: 120,
        unit: "deg",
        attempts: [{ value: 120, valid: true }],
        quality: { ok: true },
        detail: {},
        flags: [],
        nValid: 1,
        median: 120,
        skippedReason: null,
        variant: null,
        poseModel: "lite",
        movementVersion: 1,
        engineVersion: "e",
      },
    });
    expect(withResult.effects.map((e) => e.type)).toEqual(["result"]);
    const ended = play(withState(withResult, { kind: "endQuestion" }), { type: "END_ANSWER", yes: false });
    expect(ended.effects.map((e) => e.type)).toEqual(["result", "complete"]);
    // Completion is sent once.
    expect(
      play(withState(ended, { kind: "endQuestion" }), { type: "END_ANSWER", yes: false }).effects.filter(
        (e) => e.type === "complete",
      ),
    ).toHaveLength(1);
    // A skip the server does not know (chair_needed) stays on the phone.
    const chair = play(withState(m, { kind: "test.instruction", i: 0 }), { type: "CHAIR_GATE_NO" });
    expect(chair.effects).toEqual([]);
    // EFFECT_DONE removes an effect.
    expect(play(between, { type: "EFFECT_DONE", id: between.effects[0].id }).effects).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 4. whole walks */

/** The happy answer for any state, as the camera and screens would send it. */
function autopilot(m: FlowModel): FlowEvent {
  const s = m.state;
  switch (s.kind) {
    case "test.instruction":
      return { type: "READY" };
    case "test.grip":
    case "test.load":
    case "test.helper":
    case "test.primer":
      return { type: "PREP_NEXT" };
    case "test.practiceCheck":
      return { type: "PRACTICE_OK" };
    case "cam.setup":
      return { type: "SETUP_OK" };
    case "cam.calibrate":
      return { type: "CALIBRATED" };
    case "cam.practice":
      return { type: "PRACTICE_DONE" };
    case "cam.countdown":
      return { type: "GO" };
    case "cam.measure":
      return { type: "ATTEMPT_OK" };
    case "cam.saved":
      return { type: "SAVED_NEXT" };
    case "cam.retry":
      return s.exhausted ? { type: "CONTINUE" } : { type: "RETRY" };
    case "cam.rest":
      return { type: "REST_DONE" };
    case "after.contact":
    case "after.pushed":
      return { type: "AFTER_ANSWER", value: false };
    case "after.count":
      return { type: "AFTER_ANSWER", value: 10 };
    case "between":
      return { type: "BETWEEN_ANSWER", value: "same" };
    case "skipNotice":
      return { type: "CONTINUE" };
    case "guestAfterTest":
      return { type: "GUEST_NEXT_TEST" };
    case "stopDone":
      return { type: "STOP_NEXT" };
    case "endQuestion":
      return { type: "END_ANSWER", yes: false };
    case "warnings":
      return { type: "CONTINUE" };
    case "plan":
      return { type: "PLAN_START" };
    default:
      return { type: "EXIT" };
  }
}

function runTests(m: FlowModel, max = 400): FlowModel {
  let x = m;
  for (let k = 0; k < max && !["results", "exit"].includes(kind(x)); k++) {
    if (x.state.kind === "cam.saved") {
      const run = x.data.tests[x.state.i];
      const item = run.sides[x.state.side];
      x = play(x, {
        type: "SIDE_RESULT",
        testId: item.testId,
        side: item.side,
        outcome: { status: "measured", value: 90 },
      });
    }
    x = play(x, autopilot(x));
  }
  return x;
}

describe("whole flows (the Playwright flows of contract v3 L, on the pure machine)", () => {
  it("guest booth: welcome to results, every test measured, nothing stored", () => {
    const m = runTests(guestAtPlan());
    expect(kind(m)).toBe("results");
    expect(screenFor(m)).toBe("S50");
    expect(Object.values(m.data.outcomes).every((o) => o.status === "measured")).toBe(true);
    expect(Object.keys(m.data.outcomes)).toHaveLength(6);
    expect(m.effects).toEqual([]);
  });

  it("guest booth standing: the chair stand with the staff vitals question (S56)", () => {
    const q = play(
      guestAtIntro("standing"),
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    let x = q;
    const screens: string[] = [];
    for (let k = 0; k < 40 && x.state.kind === "question"; k++) {
      screens.push(screenFor(x)!);
      x = play(x, { type: "ANSWER", id: x.state.id, value: benign(x.state.id) });
    }
    expect(screens).toContain("S56");
    const done = runTests(x);
    expect(kind(done)).toBe("results");
    expect(done.data.outcomes["chair_stand_30s:none"]).toMatchObject({ status: "measured" });
  });

  it("signed in first check: consent, context, questions, start, tests, end question, S51", () => {
    let m = signedAt({}, contextOf({}, { consent: false }));
    m = play(
      m,
      { type: "CONSENT_ACCEPTED" },
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );
    m = answerAll(m);
    expect(kind(m)).toBe("starting");
    m = play(m, { type: "START_RESULT", result: okStart(m) });
    m = runTests(m);
    expect(kind(m)).toBe("results");
    expect(screenFor(m)).toBe("S51");
    expect(m.effects.map((e) => e.type).at(-1)).toBe("complete");
  });

  it("re-test: the results are S52", () => {
    let m = signedAtStarting(contextOf({}, { firstCheck: false, completedBefore: true }));
    m = play(m, { type: "START_RESULT", result: okStart(m, "retest") });
    expect(screenFor(runTests(m))).toBe("S52");
  });

  it("camera denied at the primer, retried after the reload, then measured", () => {
    let m = play(
      guestAtPlan(),
      { type: "PLAN_START" },
      { type: "READY" },
      { type: "CAMERA_ERROR", problem: "denied" },
    );
    expect(screenFor(m)).toBe("S32");
    m = play(m, { type: "RETRY" });
    expect(m.state).toEqual({ kind: "test.primer", i: 0 });
    expect(kind(runTests(m))).toBe("results");
  });

  it("quality retry: two failures, then a valid attempt, the side still counts", () => {
    let m = play(
      guestAtPlan(),
      { type: "PLAN_START" },
      { type: "READY" },
      { type: "PREP_NEXT" },
      { type: "SETUP_OK" },
      { type: "CALIBRATED" },
      { type: "PRACTICE_DONE" },
    );
    expect(kind(m)).toBe("cam.measure");
    m = play(m, { type: "QUALITY_FAIL", issue: "too_close" });
    expect(screenFor(m)).toBe("S34");
    m = play(m, { type: "RETRY" }, { type: "SETUP_OK" });
    expect(kind(m)).toBe("cam.measure");
    m = play(m, { type: "ATTEMPT_OK" });
    expect(kind(m)).toBe("cam.saved");
  });
});

/* ------------------------------------------------------------------ registry */

describe("screen registry", () => {
  const all = samples();

  it("every state but entry and exit has a screen, and every overlay a component", () => {
    for (const [k, m] of Object.entries(all)) {
      const id = screenFor(m);
      if (k === "entry" || k === "exit") expect(id).toBeNull();
      else expect(SCREENS[id!], k).toBeTypeOf("function");
    }
    for (const id of ["skipDialog", "S41", "S43", "S44", "S45"] as const) expect(OVERLAYS[id]).toBeDefined();
  });

  it("maps the pre-check types to S17 to S24 and the staff vitals to S56", () => {
    const q = (id: string) => screenFor({ ...all.question, state: { kind: "question", id } });
    expect(q("pc_urgent")).toBe("S17");
    expect(q("pc_sci_level")).toBe("S18");
    expect(q("pc_pain_now")).toBe("S19");
    expect(q("pc_pain_areas")).toBe("S20");
    expect(q("pc_limb_arm_side")).toBe("S21");
    expect(q("pc_sci_ready")).toBe("S22");
    expect(q("pc_steadi:fell")).toBe("S23");
    expect(q("pc_surgery_recent")).toBe("S24");
    expect(q("pc_booth_vitals")).toBe("S56");
  });

  it("counters: question n of the visible questions, test n of total", () => {
    const qc = questionCounter(all.question);
    expect(qc!.n).toBe(1);
    expect(qc!.total).toBeGreaterThan(3);
    expect(testCounter(all["cam.measure"])).toEqual({ n: 1, total: 3 });
    expect(testsOf([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ review fixes (round 3) */

describe("the check in is armed on every camera state, S38b and S49 (section 4.8)", () => {
  const planned = guestAtPlan();
  const measuring = withState(planned, cam("cam.measure"));

  it("a trigger under S44 or the skip dialog replaces it, and I am fine gives it back", () => {
    const goOn = play(
      measuring,
      { type: "TRIGGER", trigger: "no_movement" },
      { type: "FINE", via: "button" },
    );
    expect(goOn.overlay).toEqual({ kind: "goOn", afterAlarm: false, canRedo: true });
    const again = play(goOn, { type: "TRIGGER", trigger: "hips_drop" });
    expect(again.overlay).toMatchObject({ kind: "checkIn", trigger: "hips_drop", resume: goOn.overlay });
    expect(play(again, { type: "FINE", via: "button" }).overlay).toEqual(goOn.overlay);
    // S44 has no timer of its own: silence after the second trigger still ends in the alarm.
    expect(overlayFor(play(again, { type: "CHECKIN_TIMEOUT" }))).toBe("S45");

    const skip = play(withState(planned, cam("cam.setup")), { type: "SKIP" });
    expect(skip.overlay).toEqual({ kind: "skipDialog" });
    const overSkip = play(skip, { type: "TRIGGER", trigger: "left_frame" });
    expect(overSkip.overlay).toMatchObject({ kind: "checkIn", resume: { kind: "skipDialog" } });
    expect(play(overSkip, { type: "FINE", via: "zone" }).overlay).toEqual({ kind: "skipDialog" });
  });

  it("a trigger on S38b (faint follow up) or S49 (end question) opens the check in over the question", () => {
    const faint = play(
      measuring,
      { type: "STOP" },
      { type: "STOP_OPTION", option: "faint" },
      { type: "EXIT" },
    );
    expect(kind(faint)).toBe("faintAsk");
    const onFaint = play(faint, { type: "TRIGGER", trigger: "hips_drop" });
    expect(onFaint.overlay).toEqual({ kind: "checkIn", from: "faintAsk", trigger: "hips_drop" });
    expect(play(onFaint, { type: "FINE", via: "button" }).state).toEqual(faint.state);
    expect(overlayFor(play(onFaint, { type: "CHECKIN_TIMEOUT" }))).toBe("S45");

    const end = withState(planned, { kind: "endQuestion" });
    const onEnd = play(end, { type: "TRIGGER", trigger: "big_sway" });
    expect(onEnd.overlay).toEqual({ kind: "checkIn", from: "endQuestion", trigger: "big_sway" });
    const fine = play(onEnd, { type: "FINE", via: "button" });
    expect(fine.overlay).toBeNull();
    expect(kind(fine)).toBe("endQuestion");
    // After the alarm, fine also returns to the question, never to "go on".
    expect(play(onEnd, { type: "NEED_HELP" }, { type: "FINE", via: "button" }).overlay).toBeNull();
  });

  it("is ignored only while the check in or the alarm is open; over the stop list fine returns to it", () => {
    const checkIn = play(measuring, { type: "TRIGGER", trigger: "no_movement" });
    expect(play(checkIn, { type: "TRIGGER", trigger: "hips_drop" }).overlay).toEqual(checkIn.overlay);
    const alarm = play(checkIn, { type: "NEED_HELP" });
    expect(play(alarm, { type: "TRIGGER", trigger: "hips_drop" }).overlay).toEqual(alarm.overlay);
    const list = play(measuring, { type: "STOP" }, { type: "TRIGGER", trigger: "hips_drop" });
    expect(list.overlay).toMatchObject({ kind: "checkIn", from: "stopList" });
    expect(play(list, { type: "FINE", via: "button" }).overlay).toEqual({
      kind: "stopList",
      takeYourTime: true,
    });
  });

  it("after a finished side, a rest or S47, fine returns to the state and never re-measures", () => {
    const between = withState(planned, cam("between", 0, 0, { scope: "side", via: "test" }));
    const onBetween = play(between, { type: "TRIGGER", trigger: "no_movement" });
    expect(onBetween.overlay).toMatchObject({ kind: "checkIn", from: "test", attempt: false });
    const fine = play(onBetween, { type: "FINE", via: "button" });
    expect(fine.overlay).toBeNull();
    expect(fine.state).toEqual(between.state);
    // After the alarm S44 opens without a redo; redo just returns to the state.
    const goOn = play(onBetween, { type: "CHECKIN_TIMEOUT" }, { type: "FINE", via: "button" });
    expect(goOn.overlay).toEqual({ kind: "goOn", afterAlarm: true, canRedo: false });
    const redo = play(goOn, { type: "REDO" });
    expect(redo.overlay).toBeNull();
    expect(redo.state).toEqual(between.state);
    for (const k of ["cam.saved", "cam.rest", "after.contact"] as const) {
      const s = k === "cam.rest" ? cam(k, 0, 0, { purpose: "attempt" }) : cam(k);
      const done = play(
        withState(planned, s),
        { type: "TRIGGER", trigger: "left_frame" },
        { type: "FINE", via: "zone" },
      );
      expect(done.overlay, k).toBeNull();
      expect(done.state, k).toEqual(s);
    }
  });
});

describe("stops never fail open", () => {
  const planned = signedAtPlan();
  const noEnv = (s: FlowState): FlowModel => ({
    ...withState(planned, s),
    data: { ...planned.data, env: null },
  });

  it("without a context every symptom stop still routes, with the conservative screens", () => {
    const m = noEnv(cam("cam.measure"));
    const chest = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "chest" });
    expect(chest.state).toMatchObject({ kind: "safety", safety: "emergency", screen: "scr_emergency" });
    expect(screenFor(chest)).toBe("S36");
    expect(chest.data.lock?.until).toBeGreaterThan(NOW);
    const faint = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "faint" });
    expect(faint.state).toMatchObject({ safety: "faint", screen: "scr_faint", alsoShow: ["scr_faint_sci"] });
    const fall = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "fall" });
    expect(fall.state).toMatchObject({ safety: "fall", screen: "scr_fall_seated", askFaint: true });
    for (const option of ["stroke_signs", "breath", "ad_signs"] as const)
      expect(kind(play(m, { type: "STOP" }, { type: "STOP_OPTION", option })), option).toBe("safety");
  });

  it("a fall stop asks the faint follow up (O42) and no returns to the fall screen", () => {
    const m = withState(planned, cam("cam.measure"));
    const fall = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "fall" });
    const ask = play(fall, { type: "EXIT" });
    expect(ask.state).toMatchObject({ kind: "faintAsk", back: { safety: "fall" } });
    const no = play(ask, { type: "FAINT_ANSWER", value: "no" });
    expect(no.state).toMatchObject({ kind: "safety", safety: "fall", faintAnswered: true });
    expect(play(no, { type: "EXIT" }).state).toEqual({ kind: "exit", to: "today" });
    expect(play(ask, { type: "FAINT_ANSWER", value: "unsure" }).state).toMatchObject({ safety: "emergency" });
  });

  it("resume passes the start gates: blocked or closed leaves, a lock pauses, no consent asks", () => {
    const check = { id: "c1", kind: "baseline" as const, protocol: planned.data.protocol, outcomes: {} };
    const resume = (over: Partial<SignedInContext>, config: Partial<FlowConfig> = {}) =>
      play(initialModel({ ...SIGNED, ...config }), { type: "RESUME", context: contextOf({}, over), check });
    expect(resume({ ctx: null, blocked: "cardiac" }).state).toEqual({ kind: "exit", to: "today" });
    expect(resume({ homeOpen: false }).state).toEqual({ kind: "exit", to: "today" });
    expect(resume({ lock: { until: NOW + 1000, releasable: false } }).state).toMatchObject({
      kind: "paused",
    });
    expect(resume({ consent: false }).state).toEqual({ kind: "consent" });
    expect(resume({}).state).toEqual({ kind: "test.instruction", i: 0 });
  });

  it("the 48 hour minimum is checked at entry (earliestNext)", () => {
    const soon = play(initialModel(SIGNED), {
      type: "CONTEXT_LOADED",
      context: contextOf({}, { earliestNext: NOW + 60_000 }),
    });
    expect(soon.state).toEqual({ kind: "exit", to: "today" });
  });
});

describe("the camera sequence follows map 2.10, 2.12 and S34j, S34k", () => {
  const planned = guestAtPlan();
  const at = (s: FlowState, run: Partial<FlowModel["data"]["run"]> = {}) =>
    ({
      ...withState(planned, s),
      data: { ...planned.data, cameraUsed: true, run: { ...planned.data.run, ...run } },
    }) as FlowModel;
  const curl = planned.data.tests.findIndex((t) => t.testId === "arm_curl_30s");

  it("a moved phone calibrates again before the same attempt (map 2.12)", () => {
    const moved = play(at(cam("cam.measure"), { calibrated: true, practiced: true, saved: 1 }), {
      type: "PHONE_MOVED",
    });
    expect(moved.state).toEqual(cam("cam.setup"));
    expect(moved.data.run).toMatchObject({ calibrated: false, saved: 1, retriesUsed: 0 });
    expect(kind(play(moved, { type: "SETUP_OK" }))).toBe("cam.calibrate");
    const timed = play(at(cam("cam.measure", curl), { calibrated: true, practiced: true }), {
      type: "PHONE_MOVED",
    });
    expect(timed.data.run.calibrated).toBe(false);
  });

  it("the arm raise keeps its calibration for the second side and rests between the sides", () => {
    const side0 = at(cam("between", 0, 0, { scope: "side", via: "test" }), {
      calibrated: true,
      practiced: true,
      saved: 3,
      retriesUsed: 1,
    });
    const rest = play(side0, { type: "BETWEEN_ANSWER", value: "same" });
    expect(rest.state).toEqual(cam("cam.rest", 0, 1, { purpose: "sideChange" }));
    expect(rest.data.run).toEqual({ calibrated: true, practiced: false, saved: 0, retriesUsed: 0 });
    const setup = play(rest, { type: "REST_DONE" });
    expect(setup.state).toEqual(cam("cam.setup", 0, 1));
    // Straight to the practice lift (S34k: no new calibration).
    expect(kind(play(setup, { type: "SETUP_OK" }))).toBe("cam.practice");
  });

  it("the arm curl rests between its sides and calibrates each side", () => {
    const side0 = at(cam("between", curl, 0, { scope: "side", via: "test" }), {
      calibrated: true,
      practiced: true,
    });
    const rest = play(side0, { type: "BETWEEN_ANSWER", value: "same" });
    expect(rest.state).toEqual(cam("cam.rest", curl, 1, { purpose: "sideChange" }));
    expect(rest.data.run.calibrated).toBe(false);
  });

  it("a timed test repeats after a 2 minute rest (S34i, retryRest)", () => {
    const retry = play(at(cam("cam.measure", curl), { calibrated: true, practiced: true }), {
      type: "QUALITY_FAIL",
      issue: "out_of_frame",
    });
    const rest = play(retry, { type: "RETRY" });
    expect(rest.state).toEqual(cam("cam.rest", curl, 0, { purpose: "retryRest" }));
    expect(kind(play(rest, { type: "REST_DONE" }))).toBe("cam.setup");
    // The arm raise sets up again at once.
    const abd = play(
      at(cam("cam.measure")),
      { type: "QUALITY_FAIL", issue: "out_of_frame" },
      { type: "RETRY" },
    );
    expect(kind(abd)).toBe("cam.setup");
  });

  it("a side not measured for quality is posted with its reason (signed in)", () => {
    const signed = signedAtPlan();
    const exhausted = {
      ...withState(signed, cam("cam.retry", 0, 0, { issue: "out_of_frame", exhausted: true })),
      effects: [],
    };
    const next = play(exhausted, { type: "CONTINUE" });
    expect(next.effects).toEqual([
      expect.objectContaining({
        type: "result",
        body: expect.objectContaining({ skippedReason: "quality", value: null }),
      }),
    ]);
  });

  it("after S40b (much more pain) the end question when any result exists (map 2.3)", () => {
    const measured = {
      ...planned,
      data: { ...planned.data, outcomes: { "shoulder_abduction:right": { status: "measured" as const } } },
    };
    const pain = play(withState(measured, cam("between", 0, 0, { scope: "side", via: "test" })), {
      type: "BETWEEN_ANSWER",
      value: "much",
    });
    expect(pain.state).toMatchObject({ kind: "safety", safety: "pain" });
    expect(kind(play(pain, { type: "EXIT" }))).toBe("endQuestion");
    // Nothing measured: the flow leaves.
    const none = play(withState(planned, cam("between", 0, 0, { scope: "side", via: "test" })), {
      type: "BETWEEN_ANSWER",
      value: "much",
    });
    expect(kind(play(none, { type: "EXIT" }))).toBe("guestWelcome");
  });
});

describe("the confirm in place never traps (S17)", () => {
  const atQuestions = () =>
    play(
      signedAt(),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    );

  it("Back from the confirm clears the answer that postpones, so an earlier answer goes on", () => {
    const confirm = play(
      atQuestions(),
      { type: "ANSWER", id: "pc_urgent", value: "no" },
      { type: "ANSWER", id: "pc_unwell", value: "yes" },
    );
    expect(confirm.state).toMatchObject({ kind: "confirmPostpone", id: "pc_unwell" });
    const back = play(confirm, { type: "BACK" });
    expect(back.state).toEqual({ kind: "question", id: "pc_unwell" });
    expect(back.data.answers.pc_unwell).toBeUndefined();
    const urgent = play(back, { type: "BACK" }, { type: "ANSWER", id: "pc_urgent", value: "no" });
    expect(urgent.state).toEqual({ kind: "question", id: "pc_unwell" });
  });

  it("an answer that does not postpone never opens the confirm on its own question", () => {
    const m = play(atQuestions(), { type: "ANSWER", id: "pc_urgent", value: "no" });
    // An earlier postponing answer left in place (for example from a restored draft).
    const withUnwell = { ...m, data: { ...m.data, answers: { ...m.data.answers, pc_unwell: "yes" } } };
    const at = withState(withUnwell, { kind: "question", id: "pc_urgent" });
    const next = play(at, { type: "ANSWER", id: "pc_urgent", value: "no" });
    expect(next.state).toMatchObject({ kind: "confirmPostpone", id: "pc_unwell", value: "yes" });
    const change = play(next, { type: "CONFIRM_CHANGE" });
    expect(change.state).toEqual({ kind: "question", id: "pc_unwell" });
    expect(kind(play(change, { type: "ANSWER", id: "pc_unwell", value: "no" }))).toBe("question");
  });
});

describe("an overlay that closes onto the same screen (5.6, 5.7)", () => {
  it("S47, the stop list, pain: back on S47 with the same screen key, so CheckApp returns focus to it", async () => {
    const { screenKeyOf } = await import("../src/features/assessment/CheckApp");
    const planned = guestAtPlan();
    const s47 = withState(planned, cam("between", 0, 0, { scope: "side", via: "test" }));
    const list = play(s47, { type: "STOP" });
    expect(overlayFor(list)).toBe("S41");
    const pain = play(list, { type: "STOP_OPTION", option: "pain" });
    expect(pain.overlay).toBeNull();
    expect(screenFor(pain)).toBe("S47");
    expect(screenKeyOf(pain)).toBe(screenKeyOf(s47));
  });
});
