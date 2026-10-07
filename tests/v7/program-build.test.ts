/**
 * D-032 item 4: the "building your program" animation (src/features/onboarding/ProgramBuild.tsx). It
 * plays after the health form, the range of motion check and the walk, before the program opens:
 * four beats in about six seconds, each with one caption in a polite live region, then «برنامجك جاهز»
 * with Continue. Skip ends it from the start. With reduced motion it is a calm still of the final
 * state with every caption and Continue.
 *
 * The beats, their order, the summary handling and the drawing are pure (programBuildScene.ts) and
 * tested here in node; the component is rendered on the server and its view called directly, so the
 * buttons' handlers are tested without a DOM. e2e/v7-build-anim.spec.ts clicks them in a browser.
 */
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProgramBuild, { ProgramBuildView } from "../../src/features/onboarding/ProgramBuild";
import { buildCopy } from "../../src/features/onboarding/programBuildCopy";
import {
  ARM_REST,
  ARM_TOP,
  BEAT_MS,
  BuildDirector,
  CORE,
  DEFAULT_SUMMARY,
  MAX_CARDS,
  MAX_FRAME_MS,
  MAX_JOINTS,
  MIN_CARDS,
  armAngle,
  beatAt,
  buildPlan,
  frameAt,
  slotCenter,
  type BeatId,
  type BuildPlan,
} from "../../src/features/onboarding/programBuildScene";

const ids = (plan: BuildPlan) => plan.beats.map((b) => b.id);
const beat = (plan: BuildPlan, id: BeatId) => plan.beats.find((b) => b.id === id)!;

/** Every element of a rendered tree (host elements and the components it names, not their output). */
function elements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: unknown }).children, out);
  }
  return out;
}
const action = (tree: ReactElement, name: string) =>
  elements(tree).filter((e) => (e.props as Record<string, unknown>)["data-action"] === name);

describe("the plan (D-032 item 4)", () => {
  it("plays four beats in order in about six seconds by default", () => {
    const plan = buildPlan();
    expect(ids(plan)).toEqual(["history", "camera", "walk", "engineer"]);
    expect(plan.beats[0].start).toBe(0);
    for (let i = 1; i < plan.beats.length; i++) expect(plan.beats[i].start).toBe(plan.beats[i - 1].end);
    expect(plan.end).toBe(plan.beats.at(-1)!.end);
    expect(plan.end).toBeGreaterThanOrEqual(5500);
    expect(plan.end).toBeLessThanOrEqual(6500);
    expect(plan.settle).toBeGreaterThan(plan.end);
    // A pleasing default without a summary.
    expect(plan.joints).toBe(DEFAULT_SUMMARY.joints);
    expect(plan.cards).toHaveLength(DEFAULT_SUMMARY.exercises);
    expect(new Set(plan.cards.map((c) => c.kind))).toEqual(new Set(["stretch", "strengthen", "walk"]));
  });

  it("lights about as many joints as the summary has, up to eight", () => {
    expect(buildPlan({ joints: 2, walk: true, exercises: 5 }).joints).toBe(2);
    expect(buildPlan({ joints: 5.4, walk: true, exercises: 5 }).joints).toBe(5);
    expect(buildPlan({ joints: 20, walk: true, exercises: 5 }).joints).toBe(MAX_JOINTS);
    expect(frameAt(buildPlan({ joints: 4, walk: true, exercises: 5 }), 1000).joints).toHaveLength(4);
  });

  it("shows the walk beat only with a walk, otherwise a shorter beat on the medical history", () => {
    const noWalk = buildPlan({ joints: 3, walk: false, exercises: 6 });
    expect(ids(noWalk)).toEqual(["history", "camera", "historyUsed", "engineer"]);
    expect(BEAT_MS.historyUsed).toBeLessThan(BEAT_MS.walk);
    expect(noWalk.end).toBeLessThan(buildPlan().end);
    // No walking card for someone who did not walk.
    expect(noWalk.cards.map((c) => c.kind)).not.toContain("walk");
  });

  it("leaves the camera beat out when no joint was measured", () => {
    const plan = buildPlan({ joints: 0, walk: true, exercises: 6 });
    expect(ids(plan)).toEqual(["history", "walk", "engineer"]);
    expect(plan.joints).toBe(0);
    expect(frameAt(plan, 1000).joints).toEqual([]);
    expect(ids(buildPlan({ joints: 0, walk: false, exercises: 6 }))).toEqual([
      "history",
      "historyUsed",
      "engineer",
    ]);
  });

  it("drops about as many cards as the program has exercises, across the seven days", () => {
    expect(buildPlan({ joints: 2, walk: true, exercises: 4 }).cards).toHaveLength(4);
    expect(buildPlan({ joints: 2, walk: true, exercises: 1 }).cards).toHaveLength(MIN_CARDS);
    expect(buildPlan({ joints: 2, walk: true, exercises: 40 }).cards).toHaveLength(MAX_CARDS);
    const cards = buildPlan({ joints: 2, walk: true, exercises: 10 }).cards;
    // The first seven take seven different days; no day holds more than two.
    expect(new Set(cards.slice(0, 7).map((c) => c.day)).size).toBe(7);
    for (let d = 0; d < 7; d++) expect(cards.filter((c) => c.day === d).length).toBeLessThanOrEqual(2);
    for (const c of cards) expect(c.day >= 0 && c.day <= 6 && (c.row === 0 || c.row === 1)).toBe(true);
  });

  it("uses the default for a count that is not a number", () => {
    const plan = buildPlan({ joints: Number.NaN, walk: true, exercises: Number.NaN });
    expect(plan.joints).toBe(DEFAULT_SUMMARY.joints);
    expect(plan.cards).toHaveLength(DEFAULT_SUMMARY.exercises);
  });

  it("names the beat at each moment, and none once the program is ready", () => {
    const plan = buildPlan();
    expect(beatAt(plan, 0)?.id).toBe("history");
    expect(beatAt(plan, beat(plan, "camera").start)?.id).toBe("camera");
    expect(beatAt(plan, plan.end - 1)?.id).toBe("engineer");
    expect(beatAt(plan, plan.end)).toBeNull();
  });
});

describe("the director", () => {
  it("runs the beats in order frame by frame, then is ready", () => {
    const plan = buildPlan();
    const d = new BuildDirector(plan, vi.fn());
    const seen: string[] = [d.beat!.id];
    while (d.tick(16)) {
      const id = d.beat?.id ?? "ready";
      if (seen.at(-1) !== id) seen.push(id);
    }
    expect(seen).toEqual(["history", "camera", "walk", "engineer", "ready"]);
    expect(d.finished).toBe(true);
    expect(d.t).toBe(plan.settle);
  });

  it("calls onDone on Continue once, and only when the program is ready", () => {
    const onDone = vi.fn();
    const d = new BuildDirector(buildPlan(), onDone);
    d.tick(16);
    d.continue();
    expect(onDone).not.toHaveBeenCalled();
    while (!d.finished) d.tick(16);
    d.continue();
    d.continue();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onDone on Skip at once, from the very start, and only once", () => {
    const onDone = vi.fn();
    const d = new BuildDirector(buildPlan(), onDone);
    d.skip();
    expect(onDone).toHaveBeenCalledTimes(1);
    while (d.tick(16));
    d.continue();
    d.skip();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("resumes where it was after a stalled frame (a hidden tab) instead of jumping ahead", () => {
    const d = new BuildDirector(buildPlan(), vi.fn());
    d.tick(10_000);
    expect(d.t).toBe(MAX_FRAME_MS);
    d.tick(-5);
    expect(d.t).toBe(MAX_FRAME_MS);
  });

  it("starts as the finished still with reduced motion, where Continue calls onDone", () => {
    const onDone = vi.fn();
    const plan = buildPlan();
    const d = new BuildDirector(plan, onDone, true);
    expect(d.finished).toBe(true);
    expect(d.tick(16)).toBe(false);
    d.continue();
    expect(onDone).toHaveBeenCalledTimes(1);
    // Turned on midway: straight to the still.
    const midway = new BuildDirector(plan, vi.fn());
    midway.tick(40);
    midway.toStill();
    expect(midway.t).toBe(plan.settle);
  });
});

describe("the drawing", () => {
  it("sweeps the gold angle arc with the raised arm and fills the hold ring only at the top", () => {
    const plan = buildPlan();
    const cam = beat(plan, "camera");
    let topReached = false;
    for (let u = 0; u < cam.end - cam.start; u += 25) {
      const f = frameAt(plan, cam.start + u);
      const s = f.skeleton!;
      const angle = armAngle(s.pose);
      expect(Math.abs(angle - s.arc.deg)).toBeLessThan(0.5);
      if (s.arc.deg < ARM_TOP - 0.01) expect(s.hold.progress).toBe(0);
      else topReached = true;
    }
    expect(topReached).toBe(true);
    expect(frameAt(plan, cam.start).skeleton!.arc.deg).toBeCloseTo(ARM_REST, 1);
    expect(frameAt(plan, cam.end - 1).skeleton!.hold.progress).toBe(1);
  });

  it("streams gold timing bars for the right foot and purple for the left while the skeleton walks", () => {
    const plan = buildPlan();
    const walk = beat(plan, "walk");
    const f = frameAt(plan, walk.end - 1);
    const legs = new Set(f.gait!.bars.map((b) => b.leg));
    expect(legs).toEqual(new Set(["right", "left"]));
    for (const b of f.gait!.bars) expect(b.to).toBeGreaterThan(b.from);
    // Each foot is on the ground about 60 percent of a stride, so the two lanes overlap in time.
    expect(f.gait!.bars.filter((b) => b.leg === "right").length).toBeGreaterThanOrEqual(1);
    expect(frameAt(plan, walk.start).gait!.bars).toEqual([]);
  });

  it("flows everything into the core, then lands each card in its day of the week", () => {
    const plan = buildPlan({ joints: 3, walk: true, exercises: 8 });
    const eng = beat(plan, "engineer");
    const flowing = frameAt(plan, eng.start + 300).engine!;
    expect(flowing.sparks.length).toBeGreaterThan(10);
    const ready = frameAt(plan, plan.settle).engine!;
    expect(ready.sparks).toEqual([]);
    expect(ready.cards).toHaveLength(8);
    expect(plan.rows).toBe(2);
    ready.cards.forEach((c, i) => {
      const [x, y] = slotCenter(plan.cards[i].day, plan.cards[i].row, plan.rows);
      expect(c.at[0]).toBeCloseTo(x, 5);
      expect(c.at[1]).toBeCloseTo(y, 5);
      expect(c.scale).toBeCloseTo(1, 5);
    });
    // The cards leave from the core.
    const launch = frameAt(plan, eng.start + 1).engine!.cards[0];
    expect(Math.hypot(launch.at[0] - CORE[0], launch.at[1] - CORE[1])).toBeLessThan(1);
  });

  it("is the same picture for the same moment (no randomness between renders)", () => {
    const plan = buildPlan();
    const t = beat(plan, "engineer").start + 250;
    expect(frameAt(plan, t)).toEqual(frameAt(plan, t));
  });
});

describe("the component (signature, captions, buttons)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("takes exactly the props the flow passes", () => {
    const props: Parameters<typeof ProgramBuild>[0] = {
      lang: "ar",
      onDone: () => undefined,
      summary: { joints: 2, walk: false, exercises: 5 },
    };
    expect(ProgramBuild.length).toBe(1);
    expect(renderToStaticMarkup(createElement(ProgramBuild, props))).toContain("pb-stage");
  });

  it("opens on the first caption in a polite live region, right to left, with Skip and no Continue", () => {
    const html = renderToStaticMarkup(createElement(ProgramBuild, { lang: "ar", onDone: vi.fn() }));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>(?:(?!<\/p>).)*نقرأ حالتك الطبية/s);
    expect(html).toContain("تخطَّ");
    expect(html).not.toContain("تابع");
    expect(html).not.toContain("برنامجك جاهز");
  });

  it("speaks English left to right", () => {
    const html = renderToStaticMarkup(createElement(ProgramBuild, { lang: "en", onDone: vi.fn() }));
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Reading your medical history");
    expect(html).toContain("Skip");
  });

  it("shows each beat's caption at its moment and «برنامجك جاهز» with Continue at the end", () => {
    const plan = buildPlan();
    const view = (lang: "ar" | "en", t: number) =>
      renderToStaticMarkup(
        createElement(ProgramBuildView, {
          lang,
          plan,
          t,
          still: false,
          onSkip: vi.fn(),
          onContinue: vi.fn(),
        }),
      );
    for (const lang of ["ar", "en"] as const) {
      const c = buildCopy(lang);
      for (const b of plan.beats) expect(view(lang, b.start + 10)).toContain(c.beats[b.id]);
      const end = view(lang, plan.end);
      expect(end).toContain(c.ready);
      expect(end).toContain(c.continue);
      expect(end).not.toContain(c.skip);
    }
  });

  it("calls onSkip from the Skip button and onContinue from the Continue button", () => {
    const plan = buildPlan();
    const onSkip = vi.fn();
    const onContinue = vi.fn();
    const props = { lang: "ar" as const, plan, still: false, onSkip, onContinue };
    const start = ProgramBuildView({ ...props, t: 0 });
    expect(action(start, "continue")).toEqual([]);
    const [skip] = action(start, "skip");
    (skip.props as { onClick(): void }).onClick();
    expect(onSkip).toHaveBeenCalledTimes(1);
    const end = ProgramBuildView({ ...props, t: plan.end });
    expect(action(end, "skip")).toEqual([]);
    const [cont] = action(end, "continue");
    expect((cont.props as { type?: string }).type).toBe("button");
    (cont.props as { onClick(): void }).onClick();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("is a calm still of the final state with every caption and Continue under reduced motion", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (q: string) => ({
        matches: q.includes("prefers-reduced-motion"),
        addEventListener() {},
        removeEventListener() {},
      }),
    };
    const html = renderToStaticMarkup(
      createElement(ProgramBuild, {
        lang: "ar",
        onDone: vi.fn(),
        summary: { joints: 3, walk: true, exercises: 6 },
      }),
    );
    expect(html).toContain("is-still");
    const c = buildCopy("ar");
    for (const id of ["history", "camera", "walk", "engineer"] as const) expect(html).toContain(c.beats[id]);
    expect(html).toContain(c.ready);
    expect(html).toContain(c.continue);
    expect(html).not.toContain(c.skip);
    // The final state is drawn: the cards are in the week.
    expect(html.match(/class="pb-card"/g)).toHaveLength(6);
  });

  it("draws no text inside the graphics", () => {
    const plan = buildPlan();
    for (const t of [0, 900, 2500, 3800, 5200, plan.settle]) {
      const html = renderToStaticMarkup(
        createElement(ProgramBuildView, {
          lang: "ar",
          plan,
          t,
          still: false,
          onSkip: vi.fn(),
          onContinue: vi.fn(),
        }),
      );
      const from = html.indexOf("<svg", html.indexOf('class="pb-stage"'));
      const svg = html.slice(from, html.indexOf("</svg>", from) + 6);
      expect(svg.length).toBeGreaterThan(500);
      expect(svg).not.toMatch(/<text|<foreignObject/);
      // Nothing between tags: no words or numbers drawn into the stage.
      expect(svg.replace(/<[^>]*>/g, "").trim()).toBe("");
    }
  });

  it("has every caption in Arabic and English", () => {
    for (const lang of ["ar", "en"] as const) {
      const c = buildCopy(lang);
      for (const id of ["history", "camera", "walk", "historyUsed", "engineer"] as const)
        expect(c.beats[id].length).toBeGreaterThan(5);
    }
    expect(buildCopy("ar").beats).toMatchObject({
      history: "نقرأ حالتك الطبية",
      camera: "نحلل حركتك بالكاميرا",
      walk: "نقرأ طريقة مشيك",
      engineer: "نصمم برنامجك",
    });
    expect(buildCopy("ar").ready).toBe("برنامجك جاهز");
    expect(buildCopy("en").ready).toBe("Your program is ready");
  });
});
