/**
 * D-032 item 3 (the tests come before the program), on the phone: a person whose program waits for the
 * movement check goes from the health form to the check; the end plays the program's build and opens
 * the program; nothing measurable (a bed user, a wrist only map) or «لا أستطيع استخدام الكاميرا» builds
 * it from the history at once. The reducer, the session's build calls, the build animation's stub, the
 * waiting card and the history card of the Program tab.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initialModel,
  reduce,
  type FocusContext,
  type FocusEvent,
  type FocusModel,
  type StartResponse,
} from "../../src/features/focus/flow";
import { FocusSession } from "../../src/features/focus/session";
import type { FocusApi } from "../../src/features/focus/api";
import ProgramBuild from "../../src/features/onboarding/ProgramBuild";
import ProgramWaiting from "../../src/features/program-v7/ProgramWaiting";
import { ProgramLinkCard } from "../../src/features/program-v7/ProgramLink";
import type { Lang } from "../../src/app/i18n";
import { tV7 } from "../../src/i18n/v7";
import type { RomProtocol } from "../../src/medical/rom-protocol";

const EMPTY: RomProtocol = {
  rulesVersion: "x",
  items: [],
  deferred: [],
  notMeasured: [],
  sitBeforeStand: false,
};
const KNEE = {
  movementId: "knee_flexion",
  side: "right",
  region: "knee",
  position: "lying_back",
  block: "lying",
  order: 1,
  priority: "core",
  verdict: "measure",
  normId: null,
  graded: true,
  askCanMove: false,
  helperRequired: false,
  approximate: false,
} as RomProtocol["items"][number];

function context(protocol: RomProtocol, over: Partial<FocusContext> = {}): FocusContext {
  return {
    intakeReady: true,
    setting: "home",
    homeOpen: true,
    adultConfirmed: true,
    consent: { focus_check: true, live_coach: false },
    env: { ctx: { conditions: [] }, setup: null } as never,
    protocol,
    gait: null,
    lock: null,
    open: null,
    lastCompleted: null,
    earliestNext: null,
    ...over,
  };
}
const run = (m: FocusModel, ...events: FocusEvent[]) => events.reduce(reduce, m);
const loaded = (onboarding: boolean, protocol: RomProtocol) =>
  reduce(initialModel(onboarding), { type: "LOADED", context: context(protocol), intake: null, now: 0 });

describe("the focus check of a person whose program waits for it (flow.ts)", () => {
  it("builds from the history at once when nothing can be measured and no walk is planned", () => {
    expect(loaded(true, EMPTY).state).toEqual({ kind: "build", from: "history" });
    // Without the wait it stays the closed screen it was.
    expect(loaded(false, EMPTY).state).toEqual({ kind: "closed", why: "no_camera" });
  });

  it("builds from the history at once when the check cannot measure the person (a ready plan, REVIEW)", () => {
    expect(reduce(initialModel(true), { type: "LOAD_FAILED", code: "REVIEW" }).state).toEqual({
      kind: "build",
      from: "history",
    });
    expect(reduce(initialModel(false), { type: "LOAD_FAILED", code: "REVIEW" }).state).toEqual({
      kind: "closed",
      why: "review",
    });
  });

  it("«لا أستطيع استخدام الكاميرا» builds from the history from the intro or a part", () => {
    const intro = loaded(true, { ...EMPTY, items: [KNEE] });
    expect(intro.state).toEqual({ kind: "intro" });
    expect(reduce(intro, { type: "BUILD", from: "history" }).state).toEqual({
      kind: "build",
      from: "history",
    });
    // D-034 item 4: the intro's start starts the check at once (no day screen).
    const starting = reduce(intro, { type: "BEGIN" });
    expect(starting.state).toEqual({ kind: "starting", error: null });
    expect(reduce(starting, { type: "BUILD", from: "history" })).toBe(starting);
    const part: FocusModel = { ...intro, state: { kind: "part", index: 0 } };
    expect(reduce(part, { type: "BUILD", from: "history" }).state).toEqual({
      kind: "build",
      from: "history",
    });
    // Only while the program waits, and never from a safety screen.
    const other = loaded(false, { ...EMPTY, items: [KNEE] });
    expect(reduce(other, { type: "BUILD", from: "history" })).toBe(other);
    const safety: FocusModel = {
      ...intro,
      state: { kind: "postponed", status: "postpone", screen: null, alsoShow: [], lock: null },
    };
    expect(reduce(safety, { type: "BUILD", from: "history" })).toBe(safety);
  });

  it("after the check completes: the build, then the program page with its why lines", () => {
    const completing: FocusModel = {
      ...loaded(true, { ...EMPTY, items: [KNEE] }),
      state: { kind: "completing", error: false },
    };
    const built = reduce(completing, { type: "COMPLETED" });
    expect(built.state).toEqual({ kind: "build", from: "check" });
    expect(reduce(built, { type: "BUILT" }).state).toEqual({ kind: "exit", to: "program" });
    // The history's program opens on the Program tab.
    const history = loaded(true, EMPTY);
    expect(reduce(history, { type: "BUILT" }).state).toEqual({ kind: "exit", to: "program_tab" });
    // Without the wait, the check ends on its done screen as before.
    const plain: FocusModel = {
      ...loaded(false, { ...EMPTY, items: [KNEE] }),
      state: { kind: "completing", error: false },
    };
    expect(reduce(plain, { type: "COMPLETED" }).state).toEqual({ kind: "done" });
  });

  it("has no consent page (D-034 item 4): without the consent yet, the intro; leaving goes to Today, no build", () => {
    const m = run(initialModel(true), {
      type: "LOADED",
      context: context({ ...EMPTY, items: [KNEE] }, { consent: { focus_check: false, live_coach: false } }),
      intake: null,
      now: 0,
    });
    expect(m.state.kind).toBe("intro");
    expect(reduce(m, { type: "EXIT", to: "today" }).state).toEqual({ kind: "exit", to: "today" });
  });
});

describe("the session's build calls (session.ts)", () => {
  const week = {
    days: [{ warmup: [{ id: "a", why: { ar: "س", en: "w" } }], extra: [], cooldown: [] }],
  };

  function session(onboarding: boolean, calls: string[], walked = true) {
    const api = {
      saveRom: async () => ({ ok: true, value: { saved: true, grade: {}, typical: null } }),
      complete: async () => {
        calls.push("complete");
        return {
          ok: true,
          value: { status: "completed", profile: {}, findings: [], gait: walked ? { id: "g1" } : null },
        };
      },
      programTargets: async () => {
        calls.push("targets");
        return { ok: true, value: { weekly: week } };
      },
      programHistory: async () => {
        calls.push("history");
        return { ok: true, value: { ok: true } };
      },
    } as unknown as FocusApi;
    return new FocusSession(api, { lang: "en", onboarding });
  }
  const settle = async (s: FocusSession) => {
    for (let i = 0; i < 100 && !s.build?.done; i++) await new Promise((r) => setTimeout(r, 2));
  };
  /** Every summary the build animation was given while the build ran (the session's changes). */
  function summaries(s: FocusSession): unknown[] {
    const seen: unknown[] = [];
    s.subscribe(() => {
      if (s.build) seen.push(s.build.summary);
    });
    return seen;
  }
  /** A session at the end of a check with one knee movement waiting to be posted. */
  function ending(s: FocusSession, value: number | null) {
    s.model = {
      state: { kind: "completing", error: true },
      data: {
        ...s.model.data,
        check: {
          id: "c1",
          protocol: { ...EMPTY, items: [KNEE] },
          gait: { offered: true },
        } as unknown as StartResponse,
      },
    };
    (s as unknown as { outbox: unknown[] }).outbox.push({ item: KNEE, result: { value } });
    // Retry from the complete call's error: the movement is posted, the check completes, the build runs.
    s.dispatch({ type: "RETRY" });
  }

  it("builds the targeted week after the check, with the build animation's summary", async () => {
    const calls: string[] = [];
    const s = session(true, calls);
    expect(s.model.data.onboarding).toBe(true);
    const seen = summaries(s);
    ending(s, 120);
    await settle(s);
    expect(s.model.state).toEqual({ kind: "build", from: "check" });
    expect(calls).toEqual(["complete", "targets"]);
    // The summary is set once, as the build starts: the animation would start again on a new one, and
    // the week's exercises come only with the build's answer, so none are counted.
    const summary = { joints: 1, walk: true, exercises: 0 };
    expect(s.build).toEqual({ done: true, summary });
    expect(seen).toEqual(seen.map(() => summary));
    expect(seen.length).toBeGreaterThan(1);
  });

  it("counts only the joints measured with a value, and the walk only when the check kept one", async () => {
    const calls: string[] = [];
    const s = session(true, calls, false);
    ending(s, null);
    await settle(s);
    expect(s.build).toEqual({ done: true, summary: { joints: 0, walk: false, exercises: 0 } });
  });

  it("builds from the history when nothing can be measured", async () => {
    const calls: string[] = [];
    const s = session(true, calls);
    const seen = summaries(s);
    s.dispatch({ type: "LOADED", context: context(EMPTY), intake: null, now: 0 });
    expect(s.model.state).toEqual({ kind: "build", from: "history" });
    await settle(s);
    expect(calls).toEqual(["history"]);
    // Nothing measured and no walk: the animation builds on the history, with one summary throughout.
    const summary = { joints: 0, walk: false, exercises: 0 };
    expect(s.build).toEqual({ done: true, summary });
    expect(seen).toEqual(seen.map(() => summary));
  });
});

describe("the build animation's slot (src/features/onboarding/ProgramBuild.tsx)", () => {
  it("keeps the agreed signature (the animation itself is tested in program-build.test.ts)", () => {
    const typed: (props: {
      lang: Lang;
      onDone(): void;
      summary?: { joints: number; walk: boolean; exercises: number };
    }) => JSX.Element | null = ProgramBuild;
    expect(typeof typed).toBe("function");
  });

  it("is imported lazily, VITE_V7=1 builds only, and played at the two points", () => {
    const app = readFileSync(join(__dirname, "../../src/features/focus/FocusApp.tsx"), "utf8");
    expect(app).toMatch(
      /const ProgramBuild =\s*import\.meta\.env\.VITE_V7 === "1" \? lazy\(\(\) => import\("\.\.\/onboarding\/ProgramBuild"\)\) : null;/,
    );
    expect(app).toMatch(/case "build":/);
    // The animation is a whole screen of its own (its wordmark and Skip): it plays outside the shell's
    // page and top bar, which come back for the quiet line if the build still runs when it ends.
    expect(app).toMatch(
      /if \(ProgramBuild && !buildPlayed\)\s*return \{\s*screen: `build_\$\{s\.from\}`,\s*bare: true,/,
    );
    expect(app).toMatch(
      /"bare" in content \? \(\s*<div className="fx-bare" data-screen=\{content\.screen\}>/,
    );
    expect(app).toMatch(/onDone=\{\(\) => setBuildPlayed\(true\)\}/);
  });
});

describe("the waiting card and the history card (D-032 item 3)", () => {
  it("says the program waits for the movement check, with one Start button", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(createElement(ProgramWaiting, { lang, onStart: () => {} }));
      expect(html).toContain(tV7(lang, "targets.waiting.title"));
      expect(html).toContain(tV7(lang, "targets.waiting.body"));
      expect(html.match(/<button/g)).toHaveLength(1);
      expect(html).toContain('data-action="start_check"');
    }
    expect(tV7("ar", "targets.waiting.title")).toBe("برنامجك ينتظر قياس حركتك");
    expect(tV7("en", "targets.waiting.title")).toBe("Your program is waiting for your movement check");
  });

  it("says a program of the history can be refined by the check", () => {
    const html = renderToStaticMarkup(
      createElement(ProgramLinkCard, {
        lang: "ar",
        kind: "history",
        onOpenProgram: () => {},
        onOpenFindings: () => {},
      }),
    );
    expect(html).toContain(tV7("ar", "targets.link.historyBody"));
    expect(html).toContain('data-action="start_check"');
    expect(html).not.toContain('data-action="findings"');
  });

  it("the health form's last button says the check comes next", () => {
    expect(tV7("ar", "intake7.nextCheck")).toBe("التالي: قياس حركتك");
    expect(tV7("en", "intake7.nextCheck")).toBe("Next: your movement check");
    const form = readFileSync(join(__dirname, "../../src/app/IntakeForm.tsx"), "utf8");
    expect(form).toMatch(/nextCheck && IntakeV7NextCheck/);
    const app = readFileSync(join(__dirname, "../../src/app/App.tsx"), "utf8");
    expect(app).toMatch(/nextCheck=\{V7_UI && \(!h \|\| account\.awaitingCheck === true\)\}/);
    // After the form, a program that waits goes straight to the check, not to the program.
    expect(app).toMatch(/if \(V7_UI && s\.awaitingCheck === true && s\.plan\.status !== "review"\) \{/);
  });
});
