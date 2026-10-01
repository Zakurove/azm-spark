/**
 * Named flow states of the flow screens S04 to S33 and S35, for the E2E screenshots
 * (e2e/flow-shots.spec.ts) and their unit check (tests/flow-models.test.ts). Each is a flow model
 * walked through the real reducer (tests/flow-walks.ts), so a screenshot shows exactly what a person
 * reaching that state sees.
 *
 * The E2E page imports this module from the dev server (/e2e/flow-models.ts), builds the model with
 * the page's clock and puts it where the check keeps its reload snapshot (sessionStorage), then opens
 * the check: CheckApp restores it at that state (useCheckFlow takeSnapshot).
 */
import type { FlowModel, FlowState } from "../src/features/assessment/flowMachine";
import type { FlowScreenId } from "../src/features/assessment/screenTypes";
import type { ContextResponse, StartOk } from "../src/features/assessment/api";
import type { CheckContext, ProtocolItem } from "../src/medical/assessment";
import type { TestId } from "../src/movements/types";
import {
  answerAll,
  contextOf,
  GUEST,
  guestAtQuestions,
  guestAtPlan,
  okStart,
  play,
  setWalkClock,
  signedAt,
  signedAtStarting,
  toQuestions,
  untilQuestion,
  withState,
  type GuestChoices,
} from "../tests/flow-walks";
import { initialModel } from "../src/features/assessment/flowMachine";
import type { Answers } from "../src/medical/precheck";

export { setWalkClock };

export interface NamedState {
  /** Where the check opens: the guest check (/?check=1, booth mode) or the signed in app (/). */
  mode: "guest" | "signedIn";
  /** The screen the registry shows for the state. */
  screen: FlowScreenId;
  /** False: the tab is not in booth mode (S05b); guests are in booth mode otherwise. */
  booth?: false;
  build(): FlowModel;
}

/* ------------------------------------------------------------------ walks */

const welcome = () => play(initialModel(GUEST), { type: "START" });
const guestStep = (step: 1 | 2 | 3 | 4 | 5 | 6) =>
  withState(guestAtQuestions(), { kind: "guestSetup", step });

function must<T>(x: T | null, what: string): T {
  if (x === null) throw new Error(`${what} is not reached`);
  return x;
}

/** The question `id` of a guest with these choices (benign answers before it). */
function guestQuestion(id: string, c: GuestChoices = {}, given: Answers = {}): FlowModel {
  return must(untilQuestion(guestAtQuestions(c), id, given), id);
}

/** A guest answering `id` with `value` after benign answers. */
function guestAnswer(
  id: string,
  value: Answers[string],
  c: GuestChoices = {},
  given: Answers = {},
): FlowModel {
  return play(guestQuestion(id, c, given), { type: "ANSWER", id, value });
}

const signedIntro = (ctx = contextOf()) => play(signedAt(ctx), { type: "CONTEXT_CONFIRM" });

/** A signed in home check at the question `id`. */
function signedQuestion(id: string, ctx = contextOf(), given: Answers = {}): FlowModel {
  return must(untilQuestion(toQuestions(signedIntro(ctx)), id, given), id);
}

/** A signed in home check after its start call: S25 or S27. */
function signedStarted(ctx = contextOf(), given: Answers = {}): FlowModel {
  const m = signedAtStarting(ctx, given);
  return play(m, { type: "START_RESULT", result: okStart(m) });
}

function signedPlan(ctx = contextOf(), given: Answers = {}): FlowModel {
  const m = signedStarted(ctx, given);
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

/** From the plan to the instruction card of `testId`, skipping the tests before it. */
function toTest(plan: FlowModel, testId: TestId): FlowModel {
  let m = play(plan, { type: "PLAN_START" });
  for (let k = 0; k < 12; k++) {
    const s = m.state as FlowState & { i?: number };
    if (s.kind === "test.instruction" && m.data.tests[s.i!]?.testId === testId) return m;
    if (s.kind === "test.instruction") m = play(m, { type: "SKIP" }, { type: "SKIP_CONFIRM" });
    else if (s.kind === "skipNotice") m = play(m, { type: "CONTINUE" });
    else break;
  }
  throw new Error(`${testId} is not in the plan`);
}

/** From the instruction card of `testId` through its preparation to the state `kind`. */
function toPrep(plan: FlowModel, testId: TestId, kind: FlowState["kind"]): FlowModel {
  let m = play(toTest(plan, testId), { type: "READY" });
  for (let k = 0; k < 6 && m.state.kind !== kind; k++) m = play(m, { type: "PREP_NEXT" });
  if (m.state.kind !== kind) throw new Error(`${kind} of ${testId} is not reached (${m.state.kind})`);
  return m;
}

const at = (m: FlowModel, state: FlowState) => withState(m, state);

/* ------------------------------------------------------------------ contexts */

const CHAIR_LEFT = contextOf({ position: "chair", support: "left" });
const STANDING_PD = contextOf({ position: "standing", support: "right", conditions: ["parkinsons"] });
const WHEELCHAIR_SCI = contextOf({ position: "wheelchair", conditions: ["sci_incomplete"] });

/* ------------------------------------------------------------------ the named states */

export const FLOW_STATES: Record<string, NamedState> = {
  // Entry (S04, S05, S05a, S05b, S09)
  "S04-desktop-guest": {
    mode: "guest",
    screen: "S04",
    build: () => play(initialModel({ ...GUEST, desktop: true }), { type: "START" }),
  },
  "S05-guest-welcome": { mode: "guest", screen: "S05", build: welcome },
  "S05b-booth-only": {
    mode: "guest",
    screen: "S05b",
    booth: false,
    build: () => play(initialModel({ ...GUEST, booth: false }), { type: "START" }),
  },
  "S05a-adult-end": {
    mode: "guest",
    screen: "S05a",
    build: () => play(welcome(), { type: "ADULT_NO" }),
  },
  "S05a-adult-signed-in": {
    mode: "signedIn",
    screen: "S05a",
    build: () => signedAt(contextOf({}, { adultConfirmed: false })),
  },
  // Guest steps (S06 to S11) and S09
  "S06-position": { mode: "guest", screen: "S06", build: () => guestStep(1) },
  "S07-weaker-side": { mode: "guest", screen: "S07", build: () => guestStep(2) },
  "S08-conditions": { mode: "guest", screen: "S08", build: () => guestStep(3) },
  "S08b-clearance": { mode: "guest", screen: "S08b", build: () => guestStep(4) },
  "S10-pain-areas": { mode: "guest", screen: "S10", build: () => guestStep(5) },
  "S11-restrictions": { mode: "guest", screen: "S11", build: () => guestStep(6) },
  "S09-talk-to-staff": { mode: "guest", screen: "S09", build: () => guestAtQuestions({ position: "bed" }) },
  // Signed in entry (S12, S13)
  "S12-consent": {
    mode: "signedIn",
    screen: "S12",
    build: () => signedAt(contextOf({}, { consent: false })),
  },
  "S13-context": {
    mode: "signedIn",
    screen: "S13",
    build: () => signedAt(contextOf({ position: "chair", support: "left", pain: ["shoulder", "knee"] })),
  },
  // Intro and sound check at home (S14, S14b; the booth has neither, C04, C05)
  "S14-intro-home": { mode: "signedIn", screen: "S14", build: () => signedIntro(CHAIR_LEFT) },
  "S14-intro-home-standing": { mode: "signedIn", screen: "S14", build: () => signedIntro(STANDING_PD) },
  "S14-intro-retest": {
    mode: "signedIn",
    screen: "S14",
    build: () => signedIntro(contextOf({ position: "wheelchair" }, { firstCheck: false })),
  },
  "S14b-sound-check": {
    mode: "signedIn",
    screen: "S14b",
    build: () => play(signedIntro(), { type: "CONTINUE" }),
  },
  // Pre-check (S17 to S24)
  "S17-urgent": { mode: "guest", screen: "S17", build: () => guestQuestion("pc_urgent") },
  "S17-unwell-booth": { mode: "guest", screen: "S17", build: () => guestQuestion("pc_unwell") },
  "S17-unwell-home-examples": { mode: "signedIn", screen: "S17", build: () => signedQuestion("pc_unwell") },
  "S17-change-home-examples": { mode: "signedIn", screen: "S17", build: () => signedQuestion("pc_change") },
  "S17-change-cleared-direct": {
    mode: "signedIn",
    screen: "S17",
    build: () =>
      signedQuestion(
        "pc_change_cleared",
        contextOf({}, { firstCheck: false, completedBefore: true, unresolvedChangeReported: true }),
      ),
  },
  "S17-helper-side-lean": {
    mode: "signedIn",
    screen: "S17",
    build: () => signedQuestion("pc_helper:trunk_control_seated", CHAIR_LEFT),
  },
  "S17-trunk-armrests-wheelchair": {
    mode: "signedIn",
    screen: "S17",
    build: () => signedQuestion("pc_trunk_armrests:wheelchair", contextOf({ position: "wheelchair" })),
  },
  "S18-sci-level": {
    mode: "guest",
    screen: "S18",
    build: () => guestQuestion("pc_sci_level", { conditions: ["sci_complete"] }),
  },
  "S19-pain-now": { mode: "guest", screen: "S19", build: () => guestQuestion("pc_pain_now") },
  "S20-pain-areas": {
    mode: "guest",
    screen: "S20",
    build: () => guestQuestion("pc_pain_areas", {}, { pc_pain_now: 4 }),
  },
  "S21-arm-pain-side": {
    mode: "guest",
    screen: "S21",
    build: () => guestQuestion("pc_arm_pain_side:shoulder", { pain: ["shoulder"] }),
  },
  "S21-arm-function": {
    mode: "signedIn",
    screen: "S21",
    build: () => signedQuestion("pc_arm_function:left", WHEELCHAIR_SCI),
  },
  "S21-pd-dose": {
    mode: "signedIn",
    screen: "S21",
    build: () => signedQuestion("pc_pd_dose", STANDING_PD),
  },
  "S22-sci-ready": {
    mode: "guest",
    screen: "S22",
    build: () => guestQuestion("pc_sci_ready", { conditions: ["sci_complete"] }, { pc_sci_level: "yes" }),
  },
  "S22-sci-ready-home": {
    mode: "signedIn",
    screen: "S22",
    build: () =>
      signedQuestion("pc_sci_ready", contextOf({ position: "wheelchair", conditions: ["sci_complete"] }), {
        pc_sci_level: "yes",
      }),
  },
  "S23-steadi": {
    mode: "guest",
    screen: "S23",
    build: () => guestQuestion("pc_steadi:fell", { position: "standing" }),
  },
  "S24-surgery-areas": {
    mode: "guest",
    screen: "S24",
    build: () => guestQuestion("pc_surgery_recent:areas", {}, { pc_surgery_recent: "yes" }),
  },
  "S24-surgery-area-clear": {
    mode: "guest",
    screen: "S24",
    build: () => guestAnswer("pc_surgery_recent:areas", ["knee"], {}, { pc_surgery_recent: "yes" }),
  },
  "S17-start-busy": {
    mode: "signedIn",
    screen: "S17",
    build: () => {
      const m = signedAtStarting();
      return m;
    },
  },
  "S17-start-error": {
    mode: "signedIn",
    screen: "S17",
    build: () => {
      const m = signedAtStarting();
      const s = m.state as Extract<FlowState, { kind: "starting" }>;
      return at(m, { ...s, error: "network" });
    },
  },
  "S17-start-offline": {
    mode: "signedIn",
    screen: "S17",
    build: () => {
      const m = signedAtStarting();
      const s = m.state as Extract<FlowState, { kind: "starting" }>;
      return at(m, { ...s, error: "offline" });
    },
  },
  // After the pre-check (S25, S26, S27)
  "S25-warnings-booth": {
    mode: "guest",
    screen: "S25",
    build: () => answerAll(guestAtQuestions(), { pc_pain_now: 7, pc_pain_areas: {} }),
  },
  "S25-warnings-home": {
    mode: "signedIn",
    screen: "S25",
    build: () =>
      signedStarted(contextOf({ position: "chair", conditions: ["ms"] }), {
        pc_pain_now: 7,
        pc_pain_areas: {},
      }),
  },
  "S27-plan-booth": { mode: "guest", screen: "S27", build: () => guestAtPlan() },
  "S27-plan-booth-skips": {
    mode: "guest",
    screen: "S27",
    build: () => guestAtPlan({ position: "standing", pain: ["knee"] }),
  },
  "S27-plan-home": { mode: "signedIn", screen: "S27", build: () => signedPlan(CHAIR_LEFT) },
  "S27-plan-home-standing": { mode: "signedIn", screen: "S27", build: () => signedPlan(STANDING_PD) },
  "S27-plan-all-skipped": {
    mode: "guest",
    screen: "S27",
    build: () => {
      const m = guestAtPlan();
      const protocol = m.data.protocol.map((p) => ({ ...p, skipped: "pain_today" as const }));
      return { ...m, data: { ...m.data, protocol } };
    },
  },
  "S26-helper-trunk": {
    mode: "signedIn",
    screen: "S26",
    build: () => toPrep(signedPlan(CHAIR_LEFT), "trunk_control_seated", "test.helper"),
  },
  "S26-helper-stand": {
    mode: "signedIn",
    screen: "S26",
    build: () => toPrep(signedPlan(STANDING_PD), "chair_stand_30s", "test.helper"),
  },
  "S26-helper-arm": {
    mode: "signedIn",
    screen: "S26",
    build: () => {
      const m = toTest(signedPlan(CHAIR_LEFT), "shoulder_abduction");
      const i = (m.state as { i: number }).i;
      return at(m, { kind: "test.helper", i });
    },
  },
  // Test preparation (S28 to S32)
  "S28-arm-raise-booth": {
    mode: "guest",
    screen: "S28",
    build: () => play(guestAtPlan(), { type: "PLAN_START" }),
  },
  "S28-side-lean-booth": {
    mode: "guest",
    screen: "S28",
    build: () => toTest(guestAtPlan(), "trunk_control_seated"),
  },
  "S28-arm-curl-booth": {
    mode: "guest",
    screen: "S28",
    build: () => toTest(guestAtPlan(), "arm_curl_30s"),
  },
  "S28-chair-stand-booth": {
    mode: "guest",
    screen: "S28",
    build: () => toTest(guestAtPlan({ position: "standing" }), "chair_stand_30s"),
  },
  "S28-arm-curl-home": {
    mode: "signedIn",
    screen: "S28",
    build: () => toTest(signedPlan(CHAIR_LEFT), "arm_curl_30s"),
  },
  "S28-chair-stand-home-gate": {
    mode: "signedIn",
    screen: "S28",
    build: () => toTest(signedPlan(STANDING_PD), "chair_stand_30s"),
  },
  "S28-sci-t6-warning": {
    mode: "signedIn",
    screen: "S28",
    build: () => {
      const m = play(signedPlan(WHEELCHAIR_SCI), { type: "PLAN_START" });
      return {
        ...m,
        data: { ...m.data, warnings: [...new Set([...m.data.warnings, "warn_sci_t6" as const])] },
      };
    },
  },
  "S29-grip": {
    mode: "signedIn",
    screen: "S29",
    build: () => toPrep(signedPlan(CHAIR_LEFT), "arm_curl_30s", "test.grip"),
  },
  "S29-practice-check": {
    mode: "signedIn",
    screen: "S29",
    build: () => {
      const m = toPrep(signedPlan(CHAIR_LEFT), "arm_curl_30s", "test.grip");
      const i = (m.state as { i: number }).i;
      return at(m, { kind: "test.practiceCheck", i, side: 0 });
    },
  },
  "S30-load": {
    mode: "signedIn",
    screen: "S30",
    build: () => toPrep(signedPlan(CHAIR_LEFT), "arm_curl_30s", "test.load"),
  },
  "S30-load-step-down": {
    mode: "signedIn",
    screen: "S30",
    build: () => {
      const m = toPrep(signedPlan(CHAIR_LEFT), "arm_curl_30s", "test.load");
      const i = (m.state as { i: number }).i;
      return at(m, { kind: "test.load", i, stepDown: true });
    },
  },
  "S31-primer-home": {
    mode: "signedIn",
    screen: "S31",
    build: () =>
      toPrep(signedPlan(contextOf({ position: "wheelchair" })), "shoulder_abduction", "test.primer"),
  },
  ...Object.fromEntries(
    (["denied", "none", "busy", "stopped"] as const).map((problem) => [
      `S32-camera-${problem}`,
      {
        mode: "guest" as const,
        screen: "S32" as const,
        build: () => {
          const m = play(guestAtPlan(), { type: "PLAN_START" }, { type: "READY" });
          return at(m, { kind: "cam.problem", problem, returnTo: m.state });
        },
      },
    ]),
  ),
  // Postponed and paused (S33, S35)
  "S33-postponed-unwell": { mode: "guest", screen: "S33", build: () => guestAnswer("pc_unwell", "yes") },
  "S33-postponed-care": {
    mode: "signedIn",
    screen: "S33",
    build: () => {
      // A change, not yet cleared by the care team (Q33 (2)): recent_change.
      const m = signedQuestion("pc_change");
      return play(
        m,
        { type: "ANSWER", id: "pc_change", value: "yes" },
        { type: "ANSWER", id: "pc_change_cleared", value: "no" },
      );
    },
  },
  "S33-postponed-cool": {
    mode: "guest",
    screen: "S33",
    build: () => guestAnswer("pc_ms_heat", "yes", { conditions: ["ms"] }),
  },
  "S33-postponed-sci-ready": {
    mode: "guest",
    screen: "S33",
    build: () =>
      guestAnswer("pc_sci_ready", "not_yet", { conditions: ["sci_complete"] }, { pc_sci_level: "yes" }),
  },
  "S35-paused-releasable": {
    mode: "signedIn",
    screen: "S35",
    build: () =>
      at(signedIntro(), {
        kind: "paused",
        until: null,
        releasable: true,
        when: { token: "nextDay_midnight" },
      }),
  },
  "S35-paused": {
    mode: "signedIn",
    screen: "S35",
    build: () =>
      at(signedIntro(), {
        kind: "paused",
        until: null,
        releasable: false,
        when: { token: "sameDay_clock", time: { hour: 3, minute: 15, suffix: "pm" } },
      }),
  },
};

/* ------------------------------------------------------------------ server answers for the E2E mocks */

/** GET /api/assessments/context for a signed in person at home (the E2E route mock). */
export function contextResponse(
  ctx: Partial<CheckContext> = {},
  over: Partial<ContextResponse> = {},
): ContextResponse {
  const c = contextOf(ctx);
  return {
    ctx: c.ctx ?? undefined,
    setting: "home",
    setup: null,
    firstCheck: true,
    completedBefore: false,
    unresolvedChangeReported: false,
    faintReportedUnresolved: false,
    lastCheckLasting: false,
    lastPdDoseBucket: null,
    lock: null,
    retestDue: null,
    earliestNext: null,
    early: false,
    sideLeanRepeat: null,
    openCheck: null,
    followUpDue: false,
    consent: true,
    consentVersion: 1,
    baselineRanges: {},
    baseTests: c.baseTests,
    homeOpen: true,
    adultConfirmed: true,
    ...over,
  };
}

/** POST /api/assessments 201 for these answers, frozen as the server would (the E2E route mock). */
export function startResponse(ctx: Partial<CheckContext>, answers: Answers): StartOk {
  const m = signedAt(contextOf(ctx));
  const r = okStart({ ...m, data: { ...m.data, answers } });
  if (!r.ok) throw new Error("not ok");
  return {
    id: r.id,
    kind: r.kind,
    setting: "home",
    status: "open",
    protocol: r.protocol as ProtocolItem[],
    warnings: r.warnings,
    helperRequired: r.helperRequired,
    helperBriefing: {},
  };
}
