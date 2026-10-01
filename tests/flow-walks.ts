/**
 * Walks of the movement check flow for the flow screen tests and the E2E screenshots: flow models
 * taken through the real reducer (src/features/assessment/flowMachine.ts) to the state a screen
 * shows. Pure (no DOM, no React), so the E2E pages can import it from the dev server as well.
 */
import {
  flowReducer,
  initialModel,
  type FlowConfig,
  type FlowEvent,
  type FlowModel,
  type FlowState,
  type SignedInContext,
  type StartResult,
} from "../src/features/assessment/flowMachine";
import { baseSelection, finalizeProtocol, type CheckContext } from "../src/medical/assessment";
import { evaluatePrecheck, type Answers } from "../src/medical/precheck";
import { benign, envOf, fill, NOW } from "./precheck-fixtures";

export { NOW };

/** The time the walks stamp on every event: the fixed test time, or the page's clock in E2E. */
let clock = NOW;
export function setWalkClock(now: number): void {
  clock = now;
}
export const walkClock = () => clock;

export const GUEST: FlowConfig = { mode: "guest", booth: true, homeOpen: false, desktop: false };
export const SIGNED: FlowConfig = { mode: "signedIn", booth: false, homeOpen: true, desktop: false };

export function play(m: FlowModel, ...events: FlowEvent[]): FlowModel {
  return events.reduce((acc, e) => flowReducer(acc, { now: clock, ...e }), m);
}

export const withState = (m: FlowModel, state: FlowState): FlowModel => ({ ...m, state, overlay: null });

export interface GuestChoices {
  position?: "chair" | "standing" | "wheelchair" | "bed";
  support?: "none" | "left" | "right";
  conditions?: string[];
  clearance?: "yes" | "no" | "unsure";
  pain?: string[];
  restrictions?: string[];
  path?: "quick" | "full";
  /** The flow configuration (the booth staff settings, D-016 item 4); GUEST by default. */
  config?: FlowConfig;
}

/**
 * A guest at the booth through the six steps: at the first pre-check question (C04, C05, C06: no
 * intro, sound check or notice at the booth), or S09 when routed there.
 */
export function guestAtQuestions(c: GuestChoices = {}): FlowModel {
  return play(
    initialModel(c.config ?? GUEST),
    { type: "START" },
    { type: "GUEST_PATH", path: c.path ?? "full" },
    { type: "GUEST_ANSWER", step: 1, value: c.position ?? "chair" },
    { type: "GUEST_ANSWER", step: 2, value: c.support ?? "none" },
    { type: "GUEST_ANSWER", step: 3, value: c.conditions ?? ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 4, value: c.clearance ?? "yes" },
    { type: "GUEST_ANSWER", step: 5, value: c.pain ?? ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 6, value: c.restrictions ?? ["none"] },
    { type: "GUEST_NEXT" },
  );
}

/** A signed in check from the intro (S14) to the first question: the sound check on a new device. */
export function toQuestions(m: FlowModel): FlowModel {
  return play(m, { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" });
}

/**
 * Answers every question (benignly unless given) until the flow leaves the pre-check; `seen` collects
 * the question ids asked.
 */
export function answerAll(m: FlowModel, given: Answers = {}, seen: string[] = []): FlowModel {
  let x = m;
  for (let k = 0; k < 80 && x.state.kind === "question"; k++) {
    const id = x.state.id;
    seen.push(id);
    x = play(x, { type: "ANSWER", id, value: id in given ? given[id] : benign(id) });
  }
  return x;
}

/** Answers until the question `id` shows (benignly), or returns null when it never does. */
export function untilQuestion(m: FlowModel, id: string, given: Answers = {}): FlowModel | null {
  let x = m;
  for (let k = 0; k < 80 && x.state.kind === "question"; k++) {
    if (x.state.id === id) return x;
    const q = x.state.id;
    x = play(x, { type: "ANSWER", id: q, value: q in given ? given[q] : benign(q) });
  }
  return null;
}

/** A guest at the plan (S27), the warnings passed. */
export function guestAtPlan(c: GuestChoices = {}, given: Answers = {}): FlowModel {
  const m = answerAll(guestAtQuestions(c), given);
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

export function contextOf(
  ctx: Partial<CheckContext> = {},
  over: Partial<SignedInContext> = {},
): SignedInContext {
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

/** A signed in check at home with its context loaded (S12, S13 or S05a first, as the context says). */
export function signedAt(ctx?: SignedInContext, config: Partial<FlowConfig> = {}): FlowModel {
  return play(initialModel({ ...SIGNED, ...config }), {
    type: "CONTEXT_LOADED",
    context: ctx ?? contextOf(),
  });
}

/** The start call's ok answer for the answers on the phone, as the server would freeze it. */
export function okStart(m: FlowModel, kind: "baseline" | "retest" = "baseline"): StartResult {
  const env = m.data.env!;
  const outcome = evaluatePrecheck(env, fill(env, m.data.answers), clock);
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
    kind,
    protocol,
    warnings: outcome.warnings,
    helperRequired: outcome.helperRequired,
  };
}

/** A signed in check at the start call (the last question answered). */
export function signedAtStarting(ctx?: SignedInContext, given: Answers = {}): FlowModel {
  return answerAll(toQuestions(play(signedAt(ctx), { type: "CONTEXT_CONFIRM" })), given);
}

/** A signed in check just after the start call (S25 when there are warnings, else S27). */
export function signedStarted(ctx?: SignedInContext, given: Answers = {}): FlowModel {
  const m = signedAtStarting(ctx, given);
  return play(m, { type: "START_RESULT", result: okStart(m) });
}
