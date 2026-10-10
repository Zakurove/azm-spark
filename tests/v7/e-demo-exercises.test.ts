/**
 * D-037 item 6: «عرض تمارين تجريبية» after the program is made. The list holds exactly the exercises a
 * person can do with the camera now (the camera workout's own, run by WorkoutFlow on src/app/Session.tsx),
 * each a card with its picture, name, body area and Start, under «نبني مكتبة التمارين، وهذه مجموعة
 * منها». Start runs the camera workout's screen with the real camera, and a demo run records nothing:
 * no workout is started, no set saved, no Live coach opened, so nothing counts toward the program, the
 * weekly dose or the workouts. The way to the list is on the program page and on the Program tab.
 *
 * Rendered on the server; the camera screen is replaced by a stand-in that keeps the props it is given
 * (it reads the page address when it loads), so what a demo run may do is read from them, and every
 * way out of a run is called with the network watched. e2e/v7-flow.spec.ts runs one in the browser.
 */
import { createElement } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { defaults } from "../../src/app/experience";
import { EXERCISES } from "../../src/exercises/defs";
import { TRACES } from "../../src/engine/traces";
import { WorkoutFlow } from "../../src/engine/workoutFlow";
import { sessionProfile } from "../../src/app/product";
import { variantForProfile } from "../../src/exercises/defs";
import { tV7 } from "../../src/i18n/v7";
import { sessionCopy } from "../../src/app/session-copy";
import { DEMO_EXERCISES, demoName, demoSessionProps } from "../../src/features/program-v7/demoCatalog";
import { DemoLink } from "../../src/features/program-v7/DemoLink";
import { ProgramScreen, type ProgramExit } from "../../src/features/program-v7/ProgramPage";
import type { ProgramTargets } from "../../src/features/program-v7/api";
import { createPlan } from "../../src/medical/plan";
import { targetedWeekly } from "../../src/medical/targets";
import { FAHD, finding } from "./e-fixtures";

/** The props the camera screen was given, newest last. */
const seen = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("../../src/app/Session", () => ({
  default: (props: Record<string, unknown>) => {
    seen.push(props);
    return null;
  },
}));
const { DemoList, DemoRunScreen } = await import("../../src/features/program-v7/DemoExercises");

const ROOT = join(__dirname, "../..");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const list = (lang: "ar" | "en", on: { start?: (id: string) => void; back?: () => void } = {}) =>
  DemoList({
    lang,
    onLanguage: () => undefined,
    onBack: on.back ?? (() => undefined),
    onStart: on.start ?? (() => undefined),
  });

afterEach(() => {
  vi.unstubAllGlobals();
  seen.length = 0;
});

describe("the demo list (D-037 item 6)", () => {
  it("lists exactly the exercises the camera workout counts now, each playable with a trace", () => {
    expect(DEMO_EXERCISES.map((d) => d.id)).toEqual([
      "seated_shoulder_press",
      "seated_biceps_curl",
      "sit_to_stand",
    ]);
    expect(DEMO_EXERCISES.map((d) => d.id)).toEqual(EXERCISES.map((e) => e.id));
    for (const d of DEMO_EXERCISES) {
      // The camera screen runs it: a WorkoutFlow with its profile, and a synthetic person for the tests.
      const def = EXERCISES.find((e) => e.id === d.id)!;
      const profile = sessionProfile(d.setup);
      expect(
        () => new WorkoutFlow(def, profile, variantForProfile(def, profile.id).requiredLandmarks, d.reps),
      ).not.toThrow();
      expect(TRACES[d.id]).toBeTypeOf("function");
      expect(d.reps).toBeGreaterThan(0);
      expect(d.reps).toBeLessThanOrEqual(def.targetReps);
      // Its picture is one of the app's own illustrations, light enough for a phone.
      const file = join(ROOT, "public", d.picture);
      expect(existsSync(file), d.picture).toBe(true);
      expect(readFileSync(file).length).toBeLessThan(80_000);
    }
    // The sit to stand rises from the chair; the arm exercises are seated.
    expect(DEMO_EXERCISES.map((d) => d.setup.position)).toEqual(["chair", "chair", "rise"]);
  });

  it("says the library is growing and shows each exercise's picture, name, body area and Start", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(list(lang));
      expect(html).toContain('data-screen="demo_exercises"');
      expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
      expect(text(html)).toContain(tV7(lang, "targets.demo.intro"));
      expect(text(html)).toContain(tV7(lang, "targets.demo.note"));
      expect(html.match(/data-action="demo_start"/g)).toHaveLength(3);
      for (const d of DEMO_EXERCISES) {
        const card = html.slice(html.indexOf(`data-exercise="${d.id}"`));
        const one = card.slice(0, card.indexOf("</li>"));
        expect(one).toContain(`src="${d.picture}"`);
        expect(one).toContain(demoName(d, lang));
        expect(one).toContain(tV7(lang, `targets.demo.area.${d.area}`));
        expect(one).toContain(tV7(lang, `targets.demo.view.${d.view}`));
        expect(one).toContain(
          `aria-label="${tV7(lang, "targets.demo.startName", { name: demoName(d, lang) })}"`,
        );
      }
      expect(html).toContain('data-action="program"');
    }
    expect(tV7("ar", "targets.demo.intro")).toBe("نبني مكتبة التمارين، وهذه مجموعة منها.");
    expect(tV7("ar", "targets.demo.button")).toBe("عرض تمارين تجريبية");
    expect(tV7("en", "targets.demo.button")).toBe("Show demo exercises");
    expect(tV7("en", "targets.demo.intro")).toBe(
      "We’re building the exercise library; here is a set of them.",
    );
    expect(demoName(DEMO_EXERCISES[0], "ar")).toBe("ضغط الكتف جالسًا");
  });

  it("starts the exercise a card names, and goes back from the close and the back button", () => {
    const start = vi.fn();
    const back = vi.fn();
    const tree = list("ar", { start, back });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-action="leave"');
    // Each Start names its exercise; the handlers are the list's own. The tree is walked without a
    // renderer: a part with hooks (the page, the title) is read through its children.
    const buttons: { action: string; onClick: () => void; exercise?: string }[] = [];
    const walk = (node: unknown, exercise?: string): void => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, exercise));
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const el = node as { type: unknown; props: Record<string, unknown> };
      const ex = (el.props["data-exercise"] as string | undefined) ?? exercise;
      if (typeof el.props["data-action"] === "string")
        buttons.push({
          action: el.props["data-action"] as string,
          onClick: el.props.onClick as () => void,
          exercise: ex,
        });
      if (typeof el.type === "function") {
        let out: unknown;
        try {
          out = (el.type as (p: unknown) => unknown)(el.props);
        } catch {
          walk(el.props.top, ex);
          return walk(el.props.children, ex);
        }
        return walk(out, ex);
      }
      walk(el.props.children, ex);
    };
    walk(tree);
    const starts = buttons.filter((b) => b.action === "demo_start");
    expect(starts.map((b) => b.exercise)).toEqual(DEMO_EXERCISES.map((d) => d.id));
    starts[0].onClick();
    expect(start).toHaveBeenCalledWith("seated_shoulder_press");
    buttons.find((b) => b.action === "program")!.onClick();
    expect(back).toHaveBeenCalledTimes(1);
    buttons.find((b) => b.action === "leave")!.onClick();
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("passes the wording rules in both languages", () => {
    for (const lang of ["ar", "en"] as const) {
      const lines = [
        "button",
        "kicker",
        "title",
        "intro",
        "note",
        "listLabel",
        "start",
        "linkTitle",
        "linkBody",
      ].map((k) => tV7(lang, `targets.demo.${k}` as never));
      for (const d of DEMO_EXERCISES)
        lines.push(tV7(lang, `targets.demo.area.${d.area}`), tV7(lang, `targets.demo.view.${d.view}`));
      lines.push(sessionCopy(lang).demoRun, sessionCopy(lang).demoRunNote);
      for (const line of lines) expect(wordingProblems(line), line).toEqual([]);
    }
  });
});

describe("a demo run records nothing (D-037 item 6)", () => {
  const RECORDING = ["onSave", "onContinue", "onComplete", "coach", "onCoachButton", "setNumber"];

  it("is the camera workout's screen with the real camera, tagged as a demo, with nothing that records", () => {
    for (const d of DEMO_EXERCISES) {
      const props = demoSessionProps(d, { simulated: false }, { back() {}, again() {}, simulate() {} });
      expect(props).toMatchObject({
        exerciseId: d.id,
        setup: d.setup,
        demo: false,
        unsaved: true,
        variant: "workout",
        targetReps: d.reps,
      });
      for (const key of RECORDING) expect(props, key).not.toHaveProperty(key);
    }
    // The camera could not open and the person chose to watch: the screen's mannequin, still unsaved.
    const watched = demoSessionProps(
      DEMO_EXERCISES[0],
      { simulated: true },
      { back() {}, again() {}, simulate() {} },
    );
    expect(watched).toMatchObject({ demo: true, unsaved: true });
  });

  it("posts nothing: rendering a run and every way out of it make no network call", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLHttpRequest", xhr);
    vi.stubGlobal("navigator", { sendBeacon: xhr });
    for (const d of DEMO_EXERCISES) {
      const run = { id: d.id, simulated: false, n: 0 };
      const runs: unknown[] = [];
      renderToStaticMarkup(
        createElement(DemoRunScreen, {
          lang: "ar",
          run,
          preferences: defaults,
          onPreferences: () => undefined,
          onRun: (next) => runs.push(next),
        }),
      );
      const props = seen.at(-1)!;
      expect(props.exerciseId).toBe(d.id);
      expect(props.demo).toBe(false);
      expect(props.unsaved).toBe(true);
      // D-038 item 3: the Live coach's wiring (its events, its buttons, the set's end, the sound
      // switch) is no recording: nothing that saves reaches the screen.
      for (const key of ["onSave", "onContinue", "setNumber"]) expect(props[key], key).toBeUndefined();
      // Every function the screen was given: back to the list, again, the mannequin, and the coach's.
      const fns = Object.entries(props).filter(([, v]) => typeof v === "function");
      expect(fns.map(([k]) => k).sort()).toEqual([
        "coach",
        "onCoachButton",
        "onComplete",
        "onDemo",
        "onExit",
        "onPreferences",
        "onRestart",
      ]);
      for (const [k, fn] of fns)
        if (k !== "coach" && k !== "onCoachButton" && k !== "onComplete")
          await (fn as (...a: unknown[]) => unknown)(defaults);
      (props.coach as (e: unknown) => void)({
        p: 3,
        type: "reps",
        exercise: d.id,
        count: 1,
        target: 6,
        t: 1,
      });
      expect(runs).toEqual([null, { id: d.id, simulated: false, n: 1 }, { id: d.id, simulated: true, n: 1 }]);
      expect(props.sound).toMatchObject({ on: expect.any(Boolean) });
    }
    // The list too.
    renderToStaticMarkup(list("en"));
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it("never reaches the recording calls: no API client in the demo's code or the camera screen", () => {
    // The code only: the comments name the calls a demo never makes.
    const source = (f: string) =>
      readFileSync(join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    for (const f of [
      "src/features/program-v7/DemoExercises.tsx",
      "src/features/program-v7/demoCatalog.ts",
      "src/features/program-v7/DemoLink.tsx",
    ]) {
      const s = source(f);
      expect(s, f).not.toMatch(/from "(\.\.\/\.\.\/app\/api|\.\/api|\.\.\/assessment\/api)"/);
      expect(s, f).not.toMatch(/\bfetch\(|\/workouts|\/sessions|useCoach|workoutId/);
    }
    // D-038 item 3: the demo's Live coach is a workout's, on a demo ref with no workout id.
    const demo = source("src/features/program-v7/DemoExercises.tsx");
    expect(demo).toMatch(/import\("\.\.\/coach-agent\/CoachedWorkout"\)/);
    expect(demo).toMatch(/of=\{\{ demo: d\.id, run: runId \}\}/);
    // The camera screen saves only through the onSave it is given.
    const session = source("src/app/Session.tsx");
    expect(session).not.toMatch(/from "\.\/api"/);
    expect(session).not.toMatch(/\bfetch\(/);
    expect(session).toMatch(/if \(props\.onSave\) \{\s*try \{\s*await props\.onSave\(/);
  });
});

describe("the way to the demo exercises", () => {
  const CHECK = "0f0e0d0c-0b0a-4908-8706-050403020100";
  const REF = { checkId: CHECK, romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 5 };
  const weekly = targetedWeekly(
    FAHD,
    createPlan(FAHD),
    [finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" })],
    [],
    REF,
  )!;
  const data: ProgramTargets = { weekly, version: 3, targets: [], referrals: [], unmet: [] };

  it("is a clear secondary button on the program page, which leaves for the list", () => {
    const exits: ProgramExit[] = [];
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(ProgramScreen, {
          lang,
          load: { kind: "ready", data },
          onLanguage: () => undefined,
          onExit: (to) => exits.push(to),
          onRetry: () => undefined,
        }),
      );
      expect(html).toContain('data-screen="program"');
      expect(html).toContain("data-demo-link");
      expect(text(html)).toContain(tV7(lang, "targets.demo.button"));
      // Right under the heading, before the exercises and the page's own actions (easy to find in the booth).
      expect(html.indexOf("data-demo-link")).toBeGreaterThan(html.indexOf("pv7-hero"));
      expect(html.indexOf("data-demo-link")).toBeLessThan(html.indexOf("pv7-item"));
      expect(html.indexOf("data-demo-link")).toBeLessThan(html.indexOf('data-action="findings"'));
    }
    const card = DemoLink({ lang: "ar", onOpen: () => exits.push("demos") });
    const html = renderToStaticMarkup(card);
    // Its one button opens the list.
    const find = (node: unknown): { onClick(): void } | null => {
      if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
      if (!node || typeof node !== "object" || !("props" in node)) return null;
      const props = (node as { props: Record<string, unknown> }).props;
      return props["data-action"] === "demos" ? (props as never) : find(props.children);
    };
    find(card)!.onClick();
    expect(exits).toEqual(["demos"]);
    expect(html).toContain('data-action="demos"');
    expect(html).toContain('class="is-secondary"');
    expect(html).toContain('dir="rtl"');
    expect(text(html)).toContain("عرض تمارين تجريبية");
    expect(text(html)).toContain(tV7("ar", "targets.demo.linkBody"));
  });

  it("opens the list from the Program tab and the program page in App.tsx, VITE_V7=1 builds only", () => {
    const app = readFileSync(join(ROOT, "src/app/App.tsx"), "utf8");
    expect(app).toMatch(
      /const DemoExercises =\s*import\.meta\.env\.VITE_V7 === "1" \? lazy\(\(\) => import\("\.\.\/features\/program-v7\/DemoExercises"\)\) : null;/,
    );
    expect(app).toMatch(
      /const DemoLink =\s*import\.meta\.env\.VITE_V7 === "1" \? lazy\(\(\) => import\("\.\.\/features\/program-v7\/DemoLink"\)\) : null;/,
    );
    expect(app).toMatch(/to === "demos"\s*\?\s*setDemos\(true\)/);
    expect(app).toMatch(/<DemoLink lang=\{lang\} onOpen=\{\(\) => setDemos\(true\)\} \/>/);
    expect(app).toMatch(/onBack=\{\(\) => setDemos\(false\)\}/);
  });
});
