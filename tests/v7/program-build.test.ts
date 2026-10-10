/**
 * D-032 item 4 and D-037 item 5: the "building your program" animation
 * (src/features/onboarding/ProgramBuild.tsx). It plays after the health form, the range of motion check
 * and the walk, before the program opens: five calm beats in about eleven seconds (the health form, the
 * range of motion, the walk, the exercises chosen, the week set), each with one caption in a polite
 * live region and a quieter line of what it reads, then «برنامجك جاهز» with Continue. Skip ends it at
 * any time. A program that is ready early lets it play out; a late one holds it at the check until it
 * is ready. With reduced motion it is a calm still of the final week whose list is ticked line by line
 * in a couple of seconds, with no motion, then Continue.
 *
 * The beats, their order, the summary handling and the drawing are pure (programBuildScene.ts) and
 * tested here in node; the component is rendered on the server and its view called directly, so the
 * buttons' handlers are tested without a DOM. e2e/v7-build-anim.spec.ts clicks them in a browser.
 */
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import ProgramBuild, { ProgramBuildView } from "../../src/features/onboarding/ProgramBuild";
import { buildCopy } from "../../src/features/onboarding/programBuildCopy";
import {
  ARM_REST,
  ARM_TOP,
  BEAT_MS,
  BuildDirector,
  CHECK_LEAD_MS,
  CORE,
  DEFAULT_SUMMARY,
  MAX_CARDS,
  MAX_FRAME_MS,
  MAX_JOINTS,
  MIN_CARDS,
  PICK_SCALE,
  STILL_STEP_MS,
  WAIT_LINE_MS,
  armAngle,
  beatAt,
  buildPlan,
  frameAt,
  cardSpot,
  CARD_FROM,
  pickSpot,
  RINGS,
  stillEnd,
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
  it("plays five calm beats in order in about eleven seconds by default (D-037 item 5)", () => {
    const plan = buildPlan();
    expect(ids(plan)).toEqual(["history", "camera", "walk", "choose", "week"]);
    expect(plan.beats[0].start).toBe(0);
    for (let i = 1; i < plan.beats.length; i++) expect(plan.beats[i].start).toBe(plan.beats[i - 1].end);
    expect(plan.end).toBe(plan.beats.at(-1)!.end);
    expect(plan.end).toBeGreaterThanOrEqual(10_000);
    expect(plan.end).toBeLessThanOrEqual(12_000);
    // Each beat is calm: long enough to be seen.
    for (const b of plan.beats) expect(b.end - b.start).toBeGreaterThanOrEqual(1500);
    expect(plan.settle).toBeGreaterThan(plan.end);
    // A late program waits at the check, just before «برنامجك جاهز».
    expect(plan.hold).toBe(plan.end - CHECK_LEAD_MS);
    expect(plan.hold).toBeGreaterThan(beat(plan, "week").start);
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
    expect(ids(noWalk)).toEqual(["history", "camera", "historyUsed", "choose", "week"]);
    expect(noWalk.end).toBeGreaterThanOrEqual(10_000);
    expect(BEAT_MS.historyUsed).toBeLessThan(BEAT_MS.walk);
    expect(noWalk.end).toBeLessThan(buildPlan().end);
    // No walking card for someone who did not walk.
    expect(noWalk.cards.map((c) => c.kind)).not.toContain("walk");
  });

  it("leaves the camera beat out when no joint was measured", () => {
    const plan = buildPlan({ joints: 0, walk: true, exercises: 6 });
    expect(ids(plan)).toEqual(["history", "walk", "choose", "week"]);
    expect(plan.joints).toBe(0);
    expect(frameAt(plan, 1000).joints).toEqual([]);
    expect(ids(buildPlan({ joints: 0, walk: false, exercises: 6 }))).toEqual([
      "history",
      "historyUsed",
      "choose",
      "week",
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

  it("keeps the person's own count of measured joints for the camera's line, beyond the eight drawn", () => {
    expect(buildPlan({ joints: 11, walk: true, exercises: 5 })).toMatchObject({ joints: 8, measured: 11 });
    expect(buildPlan({ joints: 2, walk: true, exercises: 5 }).measured).toBe(2);
    expect(buildPlan().measured).toBe(DEFAULT_SUMMARY.joints);
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
    expect(beatAt(plan, beat(plan, "choose").start)?.id).toBe("choose");
    expect(beatAt(plan, plan.end - 1)?.id).toBe("week");
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
    expect(seen).toEqual(["history", "camera", "walk", "choose", "week", "ready"]);
    expect(d.finished).toBe(true);
    expect(d.t).toBe(plan.settle);
    expect(d.idle).toBe(0);
  });

  it("plays out in full when the program is ready early", () => {
    const plan = buildPlan();
    const d = new BuildDirector(plan, vi.fn(), false, true);
    d.tick(16);
    expect(d.finished).toBe(false);
    while (d.tick(16));
    expect(d.t).toBe(plan.settle);
    expect(d.waiting).toBe(false);
  });

  it("waits at the check for a late program, counting the wait, and goes on once it is ready", () => {
    const plan = buildPlan();
    const onDone = vi.fn();
    const d = new BuildDirector(plan, onDone, false, false);
    for (let i = 0; i < 2000; i++) expect(d.tick(16)).toBe(true);
    expect(d.t).toBe(plan.hold);
    expect(d.waiting).toBe(true);
    expect(d.finished).toBe(false);
    expect(d.idle).toBeCloseTo(2000 * 16 - plan.hold, 6);
    // Continue is not there yet; Skip still leaves.
    d.continue();
    expect(onDone).not.toHaveBeenCalled();
    d.setReady(true);
    d.setReady(false);
    expect(d.waiting).toBe(false);
    while (d.tick(16));
    expect(d.finished).toBe(true);
    expect(d.t).toBe(plan.settle);
    d.continue();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is never held when the program is ready before the check", () => {
    const plan = buildPlan();
    const d = new BuildDirector(plan, vi.fn(), false, false);
    while (d.t < plan.hold - 100) d.tick(16);
    d.setReady(true);
    while (d.tick(16));
    expect(d.idle).toBe(0);
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

  it("ticks the still's list line by line with reduced motion, shorter, then Continue calls onDone", () => {
    const onDone = vi.fn();
    const plan = buildPlan();
    const d = new BuildDirector(plan, onDone, true);
    expect(d.finished).toBe(false);
    expect(stillEnd(plan)).toBe(plan.beats.length * STILL_STEP_MS);
    expect(stillEnd(plan)).toBeLessThanOrEqual(3000);
    expect(d.beat).toBeNull();
    while (d.tick(16));
    expect(d.finished).toBe(true);
    expect(d.t).toBe(stillEnd(plan));
    d.continue();
    expect(onDone).toHaveBeenCalledTimes(1);
    // A late program: the still waits on its last line.
    const late = new BuildDirector(plan, vi.fn(), true, false);
    for (let i = 0; i < 400; i++) late.tick(16);
    expect(late.finished).toBe(false);
    expect(late.waiting).toBe(true);
    expect(late.t).toBe(stillEnd(plan) - 1);
    late.setReady(true);
    while (late.tick(16));
    expect(late.finished).toBe(true);
    // Turned on midway: the list, ticked as far as the drawing had come.
    const midway = new BuildDirector(plan, vi.fn());
    while (midway.t < beat(plan, "walk").start + 10) midway.tick(16);
    midway.toStill();
    expect(midway.isStill).toBe(true);
    expect(midway.t).toBe(2 * STILL_STEP_MS);
    const ended = new BuildDirector(plan, vi.fn());
    while (ended.tick(16));
    ended.toStill();
    expect(ended.finished).toBe(true);
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

  it("flows everything into the core, chooses the cards out of it, then lands each in its day", () => {
    const plan = buildPlan({ joints: 3, walk: true, exercises: 8 });
    const choose = beat(plan, "choose");
    const week = beat(plan, "week");
    const flowing = frameAt(plan, choose.start + 300).engine!;
    expect(flowing.sparks.length).toBeGreaterThan(10);
    // The cards come out of the core, inside its inner ring, one by one.
    const first = frameAt(plan, choose.start + 1).engine!.cards[0];
    expect(first.at).toEqual(CARD_FROM);
    expect(Math.hypot(first.at[0] - CORE[0], first.at[1] - CORE[1])).toBeLessThan(RINGS[0]);
    const mid = frameAt(plan, choose.start + 1100).engine!.cards;
    expect(mid.filter((c) => c.opacity > 0).length).toBeGreaterThan(0);
    expect(mid.filter((c) => c.opacity > 0).length).toBeLessThan(8);
    // Chosen: every card waits on the arc over the core, clear of the rings and the badges.
    const chosen = frameAt(plan, week.start).engine!;
    chosen.cards.forEach((c, i) => {
      const [x, y] = pickSpot(plan, i);
      expect(Math.hypot(c.at[0] - x, c.at[1] - y)).toBeLessThan(2);
      expect(c.scale).toBeCloseTo(PICK_SCALE, 2);
      expect(Math.hypot(x - CORE[0], y - CORE[1])).toBeGreaterThan(RINGS[2] + 30);
      expect(y).toBeLessThan(CORE[1] + 1);
    });
    // Set in the week: every card has landed in its day, its glow faded, before the check.
    for (const n of [MIN_CARDS, 6, 8, MAX_CARDS]) {
      const p = buildPlan({ joints: 3, walk: true, exercises: n });
      const checked = frameAt(p, p.hold).engine!;
      expect(checked.core.check).toBe(0);
      checked.cards.forEach((c, i) => {
        const [x, y] = cardSpot(p, i);
        expect(c.at[0]).toBeCloseTo(x, 5);
        expect(c.at[1]).toBeCloseTo(y, 5);
        expect(c.landed).toBe(1);
      });
    }
    const ready = frameAt(plan, plan.settle).engine!;
    expect(ready.sparks).toEqual([]);
    expect(ready.cards).toHaveLength(8);
    expect(ready.core.check).toBe(1);
    expect(plan.rows).toBe(2);
    ready.cards.forEach((c, i) => {
      const [x, y] = cardSpot(plan, i);
      expect(c.at[0]).toBeCloseTo(x, 5);
      expect(c.at[1]).toBeCloseTo(y, 5);
      expect(c.scale).toBeCloseTo(1, 5);
    });
  });

  it("keeps the rings turning and a soft pulse going out of the core while it waits", () => {
    const plan = buildPlan();
    const still = frameAt(plan, plan.hold, 0).engine!;
    const later = frameAt(plan, plan.hold, 900).engine!;
    expect(still.core.wait).toBe(0);
    expect(later.core.wait).toBeGreaterThan(0);
    expect(later.core.wait).toBeLessThan(1);
    expect(later.core.rings[0].angle).not.toBeCloseTo(still.core.rings[0].angle, 3);
    expect(later.core.check).toBe(0);
    // The cards stay in their days.
    expect(later.cards.map((c) => c.at)).toEqual(still.cards.map((c) => c.at));
  });

  it("is the same picture for the same moment (no randomness between renders)", () => {
    const plan = buildPlan();
    const t = beat(plan, "choose").start + 250;
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
    // The quieter line of what it reads, outside the live region.
    expect(html).toMatch(/<p class="pb-detail">(?:(?!<\/p>).)*حالتك، ومناطق جسمك، وهدفك/s);
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
      for (const b of plan.beats) {
        const html = view(lang, b.start + 10);
        expect(html).toContain(c.beats[b.id]);
        expect(html).toContain(c.detail(b.id, plan.measured));
        expect(html).toContain(c.skip);
      }
      const end = view(lang, plan.end);
      expect(end).toContain(c.ready);
      expect(end).toContain(c.continue);
      expect(end).not.toContain(c.skip);
    }
  });

  it("says the program is being finished when it waits for it, with Skip and no Continue", () => {
    const plan = buildPlan();
    const view = (idle: number) =>
      renderToStaticMarkup(
        createElement(ProgramBuildView, {
          lang: "ar",
          plan,
          t: plan.hold,
          idle,
          still: false,
          onSkip: vi.fn(),
          onContinue: vi.fn(),
        }),
      );
    const c = buildCopy("ar");
    // A short wait keeps the week's line.
    expect(view(WAIT_LINE_MS / 2)).toContain(c.beats.week);
    const waiting = view(WAIT_LINE_MS + 100);
    expect(waiting).toContain(c.finishing);
    expect(waiting).toContain('data-beat="waiting"');
    expect(waiting).toContain(c.skip);
    expect(waiting).not.toContain(c.continue);
    expect(waiting).not.toContain(c.ready);
    expect(waiting).toContain('class="pb-wait"');
  });

  it("says how many joints the camera measured, in the right Arabic form", () => {
    const ar = buildCopy("ar");
    const en = buildCopy("en");
    expect(ar.detail("camera", 1)).toBe("مفصل واحد قسناه بالكاميرا");
    expect(ar.detail("camera", 2)).toBe("مفصلان قسناهما بالكاميرا");
    expect(ar.detail("camera", 3)).toBe("3 مفاصل قسناها بالكاميرا");
    expect(ar.detail("camera", 10)).toBe("10 مفاصل قسناها بالكاميرا");
    expect(ar.detail("camera", 12)).toBe("12 مفصلًا قسناها بالكاميرا");
    expect(en.detail("camera", 1)).toBe("1 joint measured with the camera");
    expect(en.detail("camera", 4)).toBe("4 joints measured with the camera");
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

  it("is a calm still of the final week under reduced motion, its list ticked, then Continue", () => {
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
    for (const id of ["history", "camera", "walk", "choose", "week"] as const)
      expect(html).toContain(c.beats[id]);
    // It starts on the list's first line, with Skip; nothing spins or slides.
    expect(html).toContain(c.building);
    expect(html.match(/class="is-now"/g)).toHaveLength(1);
    expect(html).toContain(c.skip);
    expect(html).not.toContain(c.continue);
    expect(html).not.toContain("pb-meter");
    // The final week is drawn: the cards are in their days.
    expect(html.match(/class="pb-card"/g)).toHaveLength(6);
    const plan = buildPlan({ joints: 3, walk: true, exercises: 6 });
    const at = (t: number) =>
      renderToStaticMarkup(
        createElement(ProgramBuildView, {
          lang: "ar",
          plan,
          t,
          still: true,
          onSkip: vi.fn(),
          onContinue: vi.fn(),
        }),
      );
    const two = at(2 * STILL_STEP_MS + 10);
    expect(two.match(/class="is-done"/g)).toHaveLength(2);
    expect(two.match(/class="pb-tick"/g)).toHaveLength(2);
    const end = at(stillEnd(plan));
    expect(end.match(/class="is-done"/g)).toHaveLength(5);
    // Nothing moves: the picture is the same final week, its check drawn once ready.
    const svg = (html: string) => html.slice(html.indexOf("<svg"), html.indexOf("</svg>") + 6);
    expect(svg(at(0))).not.toContain("pb-check");
    expect(svg(two)).toBe(svg(at(0)));
    expect(svg(end)).toContain('class="pb-check"');
    expect(svg(end).replace(/<path class="pb-check"[^>]*><\/path>/, "")).toBe(svg(at(0)));
    expect(end).toContain(c.ready);
    expect(end).toContain(c.continue);
    expect(end).not.toContain(c.skip);
  });

  it("draws no text inside the graphics", () => {
    const plan = buildPlan();
    for (const t of [0, 1500, 3400, 5600, 7400, 8400, 9800, plan.hold, plan.settle]) {
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
      for (const id of ["history", "camera", "walk", "historyUsed", "choose", "week"] as const) {
        expect(c.beats[id].length).toBeGreaterThan(5);
        expect(c.detail(id, 3).length).toBeGreaterThan(5);
        expect(wordingProblems(c.beats[id])).toEqual([]);
        expect(wordingProblems(c.detail(id, 3))).toEqual([]);
      }
      for (const line of [c.building, c.finishing, c.ready]) expect(wordingProblems(line)).toEqual([]);
    }
    expect(buildCopy("ar").beats).toMatchObject({
      history: "نقرأ حالتك الطبية",
      camera: "نحلل مدى حركتك",
      walk: "نقرأ طريقة مشيك",
      choose: "نختار تمارينك",
      week: "نرتّب أسبوعك",
    });
    expect(buildCopy("en").beats).toMatchObject({
      choose: "Choosing your exercises",
      week: "Setting your week",
    });
    expect(buildCopy("ar").ready).toBe("برنامجك جاهز");
    expect(buildCopy("en").ready).toBe("Your program is ready");
  });
});
