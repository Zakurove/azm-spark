/**
 * Builders for the flow screen tests (tests/flow-*.test.ts): flow models walked through the real
 * reducer (src/features/assessment/flowMachine.ts) to the state a screen shows, and a static render
 * of a screen inside its .azm-check root (no DOM: react-dom/server).
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lang } from "../src/app/i18n";
import type { CheckApi } from "../src/features/assessment/api";
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
import type { ScreenProps } from "../src/features/assessment/screenTypes";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import type { CheckUi } from "../src/features/assessment/shared/CheckUi";
import { baseSelection, finalizeProtocol, type CheckContext } from "../src/medical/assessment";
import { evaluatePrecheck, type Answers } from "../src/medical/precheck";
import { benign, envOf, fill, NOW } from "./precheck-fixtures";

export { NOW };

export const GUEST: FlowConfig = { mode: "guest", booth: true, homeOpen: false, desktop: false };
export const SIGNED: FlowConfig = { mode: "signedIn", booth: false, homeOpen: true, desktop: false };

export function play(m: FlowModel, ...events: FlowEvent[]): FlowModel {
  return events.reduce((acc, e) => flowReducer(acc, { now: NOW, ...e }), m);
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
}

/** A guest at the booth through the six steps to the intro (or S09 when routed there). */
export function guestAtIntro(c: GuestChoices = {}): FlowModel {
  return play(
    initialModel(GUEST),
    { type: "START" },
    { type: "GUEST_PATH", path: c.path ?? "full" },
    { type: "ADULT_YES" },
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

/** From the intro to the first pre-check question. */
export function toQuestions(m: FlowModel): FlowModel {
  return play(m, { type: "CONTINUE" }, { type: "SOUND_RESULT", mode: "voice" }, { type: "PRECHECK_START" });
}

/** Answers every question (benignly unless given) until the flow leaves the pre-check. */
export function answerAll(m: FlowModel, given: Answers = {}): FlowModel {
  let x = m;
  for (let k = 0; k < 80 && x.state.kind === "question"; k++) {
    const id = x.state.id;
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
  const m = answerAll(toQuestions(guestAtIntro(c)), given);
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
    kind,
    protocol,
    warnings: outcome.warnings,
    helperRequired: outcome.helperRequired,
  };
}

/** A signed in check at the start call (the last question answered). */
export function signedAtStarting(ctx?: SignedInContext, given: Answers = {}): FlowModel {
  return answerAll(
    play(
      signedAt(ctx),
      { type: "CONTEXT_CONFIRM" },
      { type: "CONTINUE" },
      { type: "SOUND_RESULT", mode: "voice" },
      { type: "PRECHECK_START" },
    ),
    given,
  );
}

/** A signed in check just after the start call (S25 when there are warnings, else S27). */
export function signedStarted(ctx?: SignedInContext, given: Answers = {}): FlowModel {
  const m = signedAtStarting(ctx, given);
  return play(m, { type: "START_RESULT", result: okStart(m) });
}

/** A check API that never answers (static renders never call it). */
export const NO_API = new Proxy({} as CheckApi, {
  get: () => () => new Promise(() => undefined),
});

/** The static markup of a screen for a model, inside its .azm-check root. */
export function render(
  Screen: ComponentType<ScreenProps>,
  model: FlowModel,
  lang: Lang = "en",
  ui: Partial<CheckUi> = {},
): string {
  const guest = model.data.config.mode === "guest";
  // The shell measures its bars in a layout effect, which a static render skips on purpose.
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    error(...args);
  };
  try {
    return renderMarkup(Screen, model, lang, { guest, ...ui });
  } finally {
    console.error = error;
  }
}

function renderMarkup(
  Screen: ComponentType<ScreenProps>,
  model: FlowModel,
  lang: Lang,
  ui: Partial<CheckUi> & { guest: boolean },
): string {
  const screen = createElement(Screen, {
    model,
    dispatch: () => undefined,
    api: NO_API,
    retryCamera: () => undefined,
  });
  return renderToStaticMarkup(
    createElement(CheckRoot, {
      ui: {
        lang,
        booth: model.data.config.booth,
        requestLeave: () => undefined,
        screenKey: model.state.kind,
        ...ui,
      },
      children: screen,
    }),
  );
}

/** The visible text of markup: tags removed, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<\/?(strong|bdi|b|em|span)(\s[^>]*)?>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The copy rules every rendered screen keeps (UX spec 0.2): no dash characters (a hyphen between
 * letters, an en dash, an em dash, a minus sign), no unfilled {token}, no copy key shown as text.
 */
export function copyProblems(html: string): string[] {
  const text = textOf(html);
  const out: string[] = [];
  if (/[–—−]/.test(text)) out.push("en dash, em dash or minus sign");
  if (/\p{L}-\p{L}/u.test(text)) out.push("hyphen between letters");
  if (/\{\w+\}/.test(text)) out.push(`unfilled token in: ${text.match(/.{0,30}\{\w+\}.{0,30}/)?.[0]}`);
  if (/\bassessment\.[a-z]/.test(text)) out.push(`copy key shown: ${text.match(/assessment\.[\w.]+/)?.[0]}`);
  return out;
}
