/**
 * D-038 item 4: the walk's second part, toward the phone and back, twice, right after the side passes
 * with the phone left where it stood (sideways, at hip height, about 3 m from the side path), and the
 * gait patterns by name.
 *
 * Why the front and back rows were empty (Nasser's v7.2 rows: the front view 0 clean cycles and 22.7%
 * gaps, the back view 0). In a landscape picture (50 degrees high) the feet leave its bottom about 2 m
 * from a lens at hip height: the heels and foot index fail the data's cycle gate (landmarks 23 to 32)
 * and count as gaps near the turn, and between there and the data's 4 m window the data's 1 s turn
 * margins and two steps dropped at each turn leave about nothing; the group failed its 6 a side and the
 * timing reading kept no frontal metric. gait_engine_5 reads the toward and away walk's MVP reading on
 * the hips, knees and ankles, 1.5 to 5 m away, with the frontal metrics; the rules read Trendelenburg,
 * the Duchenne lean and waddling from it on 2 clean cycles a side, and the antalgic walk from the side
 * walk's timing reading, possible at low confidence at most with the provisional label.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitGroup, analyseGaitView, combineViews, groupPassed } from "../../src/engine/gait/analyse";
import { FrontLapCounter, FRONT_LAP } from "../../src/engine/gait/frontLaps";
import { LiveStepCounter } from "../../src/engine/gait/live";
import { ENGINE_VERSION, GAIT_ENGINE, GAIT_MVP, STEADY_TIMING } from "../../src/engine/gait/params";
import { passesOf } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import { gapShare } from "../../src/engine/gait/quality";
import { walkVerdict } from "../../src/engine/gait/verdict";
import type { GaitAnalysis, GaitFrame, GaitViewResult } from "../../src/engine/gait/types";
import type { Frame } from "../../src/engine/types";
import type { BridgeEvent } from "../../src/coach/types";
import { CAPTURE_LIMITS, GaitController, type GaitStepId } from "../../src/features/gait/controller";
import { gaitStepSay } from "../../src/features/gait/say";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { evaluateGait, gaitPatternName } from "../../src/medical/gait-rules";
import type { GaitPatternResult } from "../../src/medical/gait-types";
import { collectTargets, whyLine } from "../../src/medical/targets";
import { GAIT_DATA } from "../../src/movements/gait";
import { GAIT_COPY_PATTERN_NAME_KEYS } from "../../src/movements/gait/types";
import { checkGaitBody } from "../../server/modules/focus/validate";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { setupOf, walk, withRealFarLeg, type WalkSpec } from "../fixtures/gait/gen-gait";
import { GAIT_CATALOG } from "../fixtures/gait/catalog";
import { loadHomeSmoke, shorterPicture } from "../fixtures/gait/smoke";
import { loadMocap, mocapIds, mocapWalk } from "../fixtures/gait/mocap";
import { input, intake } from "./c-gait-rules-fixtures";

/* ------------------------------------------------------------- the walks */

/** Part 2 at home: the phone sideways at hip height, from `farM` toward it to `nearM`, and back, twice. */
const towardBack = (seed: number, over: Partial<WalkSpec> = {}): WalkSpec => ({
  view: "front",
  passes: 2,
  seed,
  home: { farM: 5, nearM: 2 },
  passShiftM: 0.3,
  camera: { lateral: 0, height: 0.95, landscape: true },
  noise: 0.002,
  jitterMs: 8,
  ...over,
});

/** Part 1 at home: four passes across a landscape picture 3 m away, the real model's far leg. */
const sidePasses = (seed: number, over: Partial<WalkSpec> = {}): WalkSpec => ({
  view: "side",
  passes: 4,
  seed,
  speed: 1,
  cadence: 100,
  camera: { distance: 3 },
  sidePath: { pathM: 6, turnSec: 1.5 },
  passShiftM: 0.3,
  noise: 0.003,
  jitterMs: 8,
  ...over,
});

function frontViews(frames: GaitFrame[], standing: GaitFrame[], spec: WalkSpec): GaitViewResult[] {
  return analyseGaitGroup(
    (["front", "back"] as const).map((view) => ({
      view,
      setup: setupOf(spec),
      standing,
      frames,
      poseModel: "full" as const,
      rollDeg: 0,
    })),
  );
}

function sideViews(spec: WalkSpec): GaitViewResult[] {
  const w = walk(spec);
  return analyseGaitGroup([
    {
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: withRealFarLeg(w.frames),
      poseModel: "full",
      rollDeg: null,
    },
  ]);
}

const sum = (vs: readonly GaitViewResult[], s: "left" | "right") =>
  vs.reduce((n, v) => n + v.quality.cleanCycles[s], 0);
const within = (v: number | null | undefined, truth: number, share: number) =>
  v !== null && v !== undefined && Math.abs(v / truth - 1) <= share;

/** The rules on views for a person with a hip on the right and knees on both sides in the body map. */
function rules(views: GaitViewResult[], over: Parameters<typeof input>[0] = {}) {
  const analysis: GaitAnalysis = combineViews(views, [], setupOf({ view: "front" }));
  return evaluateGait(
    input({
      analysis,
      intake: {
        regions: [
          { region: "hip", side: "right", problems: ["pain"], origin: "person" },
          { region: "knee", side: "both", problems: ["stiffness"], origin: "person" },
        ],
      },
      ...over,
    }),
  );
}
const shownOf = (patterns: readonly GaitPatternResult[]) =>
  patterns.filter((p) => (p.status === "possible" || p.status === "likely") && p.confidence !== null);

/* ------------------------------------------------------- the root cause */

describe("why the front and back rows were empty, and the fix (gait_engine_5)", () => {
  it("is the engine version 5", () => {
    expect(ENGINE_VERSION).toBe("gait_engine_5");
  });

  for (const seed of [3, 5, 9])
    it(`the data's reading leaves the walk toward a landscape phone without its gate, the feet leave the picture near the turn (seed ${seed})`, () => {
      const spec = towardBack(seed);
      const w = walk(spec);
      const full = (["front", "back"] as const).map((view) =>
        analyseGaitView({
          view,
          setup: setupOf(spec),
          standing: w.standing,
          frames: w.frames,
          poseModel: "full",
          rollDeg: 0,
        }),
      );
      // Two laps never reach 6 clean cycles a side, and the data's reading keeps at most a couple.
      expect(groupPassed(full)).toBe(false);
      expect(sum(full, "left") + sum(full, "right")).toBeLessThanOrEqual(3);
      // In the analysed passes, the foot points are lost where the ankles are not: the data's gate
      // counts those frames as gaps, the MVP's gate (hips, knees, ankles) does not.
      const p = prepare(w.frames, { rollDeg: 0, labels: "facing" });
      const motion = passesOf(p, "front", undefined, STEADY_TIMING);
      expect(gapShare(p, motion, GAIT_ENGINE.gateLandmarks)).toBeGreaterThan(
        gapShare(p, motion, GAIT_MVP.frontGateLandmarks),
      );
    });

  const walks: [number, Partial<WalkSpec>][] = [
    [1, {}],
    [2, {}],
    [5, {}],
    [11, {}],
    [7, { speed: 0.9, cadence: 98 }],
    [8, { camera: { lateral: 0, height: 1.15, landscape: true }, home: { farM: 5, nearM: 2.5 } }],
    [9, { camera: { lateral: 0.2, height: 0.85, landscape: true } }],
  ];
  for (const [seed, over] of walks)
    it(`the MVP's reading gives 2 clean cycles a side or more over the two laps, the frontal metrics and the cadence (seed ${seed}${over.speed ? ", slower" : ""}${over.camera ? `, lens ${over.camera.height} m` : ""})`, () => {
      const spec = towardBack(seed, over);
      const w = walk(spec);
      const views = frontViews(w.frames, w.standing, spec);
      expect(views.map((v) => v.view)).toEqual(["front", "back"]);
      expect(sum(views, "left")).toBeGreaterThanOrEqual(GAIT_MVP.patternCyclesPerSide);
      expect(sum(views, "right")).toBeGreaterThanOrEqual(GAIT_MVP.patternCyclesPerSide);
      for (const v of views) {
        expect(v.quality.gapShare).toBeLessThanOrEqual(GAIT_ENGINE.gapShareMax);
        expect(v.quality.timingOnly).toBe(true);
      }
      expect(views.some((v) => v.metrics.pelvic_drop)).toBe(true);
      expect(views.some((v) => v.metrics.trunk_sway_range)).toBe(true);
      const verdict = walkVerdict(views);
      expect(verdict.level).toBe("timing");
      expect(within(verdict.cadence, w.truth.cadence, 0.05)).toBe(true);
      // No hip dip in the walk: the hips read within a few degrees of level.
      for (const v of views)
        for (const s of ["left", "right"] as const) {
          const d = v.metrics.pelvic_drop?.sides?.[s];
          if (d !== null && d !== undefined) expect(Math.abs(d), `${v.view} ${s}`).toBeLessThan(8);
        }
    });

  for (const name of ["gait-home-wall-full", "gait-home-wall-lite"] as const)
    it(`the real model's walk toward a phone, cut to a landscape picture's height, reads the hips level and no frontal pattern (${name})`, () => {
      const s = loadHomeSmoke(name);
      const cut = (f: GaitFrame[]) => shorterPicture(f, 1 / 6, 5 / 6);
      const views = frontViews(cut(s.frames), cut(s.standing), { view: "front", heightM: s.heightCm / 100 });
      expect(sum(views, "left") + sum(views, "right")).toBeGreaterThanOrEqual(5);
      for (const v of views)
        for (const side of ["left", "right"] as const) {
          const d = v.metrics.pelvic_drop?.sides?.[side];
          if (d !== null && d !== undefined) expect(Math.abs(d)).toBeLessThan(5);
        }
      const out = rules(views);
      for (const id of ["trendelenburg", "duchenne_lean", "waddling"] as const)
        expect(
          out.patterns.filter((p) => p.pattern === id && (p.status === "possible" || p.status === "likely")),
          id,
        ).toEqual([]);
    });
});

describe("real walkers' kinematics through a landscape phone at hip height (motion capture, D-038 item 4)", () => {
  // The Van Criekinge walkers (20 able bodied, 10 after a stroke) walk their walkway toward a phone
  // laid sideways 0.95 m up, stopping 2 m before it, and away: their own pelvis and trunk, projected.
  const ids = mocapIds().filter((id) => id.startsWith("vc-"));
  it("reads every walker's walk toward the phone and away with the MVP's reading, and fires no frontal pattern", () => {
    let read = 0;
    for (const id of ids) {
      const fx = loadMocap(id);
      const w = mocapWalk(fx, {
        view: "front",
        seed: 7,
        camera: { distance: 2, height: 0.95, lateral: 0, landscape: true },
      });
      const views = frontViews(w.frames, w.standing, { view: "front" });
      if (sum(views, "left") + sum(views, "right") >= 4) read++;
      const out = rules(views);
      const frontal = out.patterns.filter(
        (p) =>
          ["trendelenburg", "duchenne_lean", "waddling"].includes(p.pattern) &&
          (p.status === "possible" || p.status === "likely"),
      );
      expect(frontal, id).toEqual([]);
      // An able bodied walker's hips read within a few degrees of level.
      if (id.startsWith("vc-ab"))
        for (const v of views)
          for (const s of ["left", "right"] as const) {
            const d = v.metrics.pelvic_drop?.sides?.[s];
            if (d !== null && d !== undefined) expect(d, `${id} ${v.view} ${s}`).toBeLessThan(8);
          }
    }
    // Most walkers give 4 clean cycles or more in their 3 or 4 walks (a lab walkway, not two laps).
    expect(read).toBeGreaterThanOrEqual(Math.round(ids.length * 0.6));
  });
});

/* ---------------------------------------------------- the lap counter */

describe("the laps toward the phone and back, and the turn cue (frontLaps.ts)", () => {
  const cases: [number, number, number, number][] = [
    // seed, lens height (m), start (m), turn (m)
    [1, 0.95, 5, 2],
    [2, 1.2, 4.5, 2.6],
    [3, 0.8, 4, 1.8],
    [4, 0.95, 4.5, 2.2],
  ];
  for (const [seed, height, farM, nearM] of cases)
    it(`counts 2 laps and says turn once on each walk toward the phone, before the turn (lens ${height} m, from ${farM} m, turning at ${nearM} m)`, () => {
      const w = walk(
        towardBack(seed, {
          home: { farM, nearM },
          camera: { lateral: 0, height, landscape: true },
        }),
      );
      const live = new LiveStepCounter("front");
      const closes: number[] = [];
      let close = false;
      let r = live.feed(w.frames[0]);
      for (const f of w.frames) {
        r = live.feed(f);
        if (r.close && !close) closes.push(f.t);
        close = r.close;
      }
      expect(r.laps).toBe(2);
      const toward = w.truth.passes.filter((p) => p.kind === "toward");
      expect(closes).toHaveLength(2);
      closes.forEach((t, i) => {
        // Within the walk toward, before its turn, at most 2.5 s before it.
        expect(t).toBeGreaterThan(toward[i].from);
        expect(t).toBeLessThanOrEqual(toward[i].to);
        expect(toward[i].to - t).toBeLessThan(2500);
      });
    });

  it("counts no lap from standing still, or from a walk across the picture", () => {
    const still = walk(towardBack(5));
    const c = new FrontLapCounter();
    for (const f of still.standing) expect(c.feed(f.t, f.lm, f.aspect).laps).toBe(0);
    const across = walk({ view: "side", passes: 4, seed: 6, home: { pathM: 3 }, camera: { distance: 3 } });
    const d = new FrontLapCounter();
    let laps = 0;
    for (const f of across.frames) laps = d.feed(f.t, f.lm, f.aspect).laps;
    expect(laps).toBe(0);
  });

  it("counts the real model's laps toward a phone (G1's rendered wall walk, cut to a landscape picture's height)", () => {
    const s = loadHomeSmoke("gait-home-wall-lite");
    const c = new LiveStepCounter("front");
    let r = c.feed(s.frames[0]);
    for (const f of shorterPicture(s.frames, 1 / 6, 5 / 6)) r = c.feed(f);
    expect(r.laps).toBe(4);
  });

  it("holds its engineering numbers", () => {
    expect(FRONT_LAP).toMatchObject({ towardRatio: 1.25, awayRatio: 1.25, closeShare: 0.85 });
  });
});

/* ------------------------------------------------------- the rules */

describe("the gait patterns from the MVP's readings (gait-rules.ts, D-038 item 4)", () => {
  for (const seed of [1, 2, 3])
    it(`names a Trendelenburg gait on the right from the walk toward the phone and back, provisional (seed ${seed})`, () => {
      const spec = towardBack(seed, { pelvicDrop: { right: 14 } });
      const w = walk(spec);
      const out = rules(frontViews(w.frames, w.standing, spec));
      const shown = shownOf(out.patterns);
      expect(shown.map((p) => `${p.pattern}:${p.side}:${p.status}`)).toEqual([
        "trendelenburg:right:possible",
      ]);
      const [t] = shown;
      expect(t.confidence).toBe("low");
      expect(t.flags).toEqual(["mvp_reading"]);
      expect(t.lines.name).toEqual({
        ar: "قد يشير مشيك إلى مشية ترندلنبرغ (عند الوقوف على ساقك اليمنى).",
        en: "Your walk may suggest a Trendelenburg gait (when you stand on your right leg).",
      });
      // «We will check this again at your next check»: possible at low confidence.
      expect(t.lines.pattern.en).toContain(GAIT_DATA.copy.patterns.possible_suffix.en);
      // The side patterns were not walked here: not assessed, never shown.
      expect(out.patterns.find((p) => p.pattern === "stiff_knee")).toMatchObject({ status: "not_assessed" });
    });

  it("shows no frontal pattern for a walk without a hip dip or a lean", () => {
    for (const seed of [1, 2, 3]) {
      const spec = towardBack(seed);
      const w = walk(spec);
      expect(shownOf(rules(frontViews(w.frames, w.standing, spec)).patterns)).toEqual([]);
    }
  });

  for (const seed of [1, 2, 3])
    it(`names an antalgic gait from the side walk's timing reading, sparing the painful right leg (seed ${seed})`, () => {
      // The right leg stands shorter (its single support, the left swing, is shorter): pain on the right.
      const views = sideViews(sidePasses(seed, { stanceBy: { left: 0.66, right: 0.58 } }));
      expect(views[0].quality.timingOnly && !views[0].quality.gatePassed).toBe(true);
      const out = rules(views, { pain: { hip: 3 } });
      const shown = shownOf(out.patterns);
      expect(shown.map((p) => `${p.pattern}:${p.label}:${p.side}:${p.status}`)).toEqual([
        "shorter_stance:antalgic:right:possible",
      ]);
      expect(shown[0]).toMatchObject({ confidence: "low", flags: ["mvp_reading"] });
      expect(shown[0].lines.name).toEqual({
        ar: "قد يشير مشيك إلى مشية الألم (تخفيف الحمل عن ساقك اليمنى).",
        en: "Your walk may suggest an antalgic gait (sparing your right leg).",
      });
      // The frontal patterns were not walked here: not assessed.
      expect(out.patterns.find((p) => p.pattern === "trendelenburg")).toMatchObject({
        status: "not_assessed",
      });
    });

  it("reads both parts: the antalgic walk from the side, the Trendelenburg gait from the front and back", () => {
    const side = sideViews(sidePasses(2, { stanceBy: { left: 0.66, right: 0.58 } }));
    const spec = towardBack(2, { pelvicDrop: { right: 14 } });
    const w = walk(spec);
    const out = rules([...side, ...frontViews(w.frames, w.standing, spec)], { pain: { hip: 3 } });
    expect(shownOf(out.patterns).map((p) => `${p.pattern}:${p.side}`)).toEqual([
      "shorter_stance:right",
      "trendelenburg:right",
    ]);
  });

  it("names every pattern label in Arabic and English, with may suggest, the side and the wording rules", () => {
    expect(Object.keys(GAIT_DATA.copy.patternNames)).toEqual([...GAIT_COPY_PATTERN_NAME_KEYS]);
    for (const [key, t] of Object.entries(GAIT_DATA.copy.patternNames)) {
      expect(t.ar.startsWith("قد يشير مشيك إلى "), key).toBe(true);
      expect(t.en.startsWith("Your walk may suggest "), key).toBe(true);
      expect([...wordingProblems(t.ar), ...wordingProblems(t.en)], key).toEqual([]);
      // A one sided name says its side; the bilateral forms say none.
      const sided = !["waddling", "stiff_knee_both", "crouch", "short_steps"].includes(key);
      expect(t.ar.includes("{side_ar}"), key).toBe(sided);
      expect(t.en.includes("{side_en}"), key).toBe(sided);
    }
    expect(gaitPatternName({ pattern: "steppage", label: "steppage", side: "left" }).en).toBe(
      "Your walk may suggest a foot drop gait, known as steppage (your left foot).",
    );
    expect(gaitPatternName({ pattern: "duchenne_lean", label: "duchenne_lean", side: "left" }).ar).toBe(
      "قد يشير مشيك إلى ميلان دوشين (ميل جذعك نحو ساقك اليسرى).",
    );
    expect(gaitPatternName({ pattern: "waddling", label: "waddling", side: "both" }).en).toBe(
      "Your walk may suggest a waddling gait (a sway from side to side).",
    );
  });
});

/* ------------------------------------------------ the program's why lines */

describe("the patterns of the MVP's readings feed the program (targets and why lines)", () => {
  it("gives each shown pattern its first target, with the pattern's own why line", () => {
    const side = sideViews(sidePasses(2, { stanceBy: { left: 0.66, right: 0.58 } }));
    const spec = towardBack(2, { pelvicDrop: { right: 14 } });
    const w = walk(spec);
    const out = rules([...side, ...frontViews(w.frames, w.standing, spec)], { pain: { hip: 3 } });
    const shown = shownOf(out.patterns);
    const { targets } = collectTargets({
      intake: intake({ regions: [{ region: "hip", side: "right", problems: ["pain"], origin: "person" }] }),
      rom: [],
      gait: out.patterns,
    });
    for (const p of shown) {
      const own = targets.filter((t) => t.reasons.some((r) => r.kind === "gait" && r.pattern === p.pattern));
      // Possible at low confidence: its first target only (gaitStatusRules).
      expect(own.length, p.pattern).toBeGreaterThan(0);
      const line = whyLine(own[0].reasons);
      expect(line.en, p.pattern).toContain("So we added this exercise.");
      expect([...wordingProblems(line.ar), ...wordingProblems(line.en)]).toEqual([]);
    }
    expect(
      targets.some((t) => t.id === "strengthen:hip_abductors" && t.reasons.some((r) => r.kind === "gait")),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------ the capture */

const HOME: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front", "back"], walking_pad: [] },
};

interface Run {
  ctl: GaitController;
  t: number;
  events: BridgeEvent[];
}

function controller(plan: GaitPlan = HOME): Run {
  const ctl = new GaitController({
    plan,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    lang: "en",
    log: () => {},
  });
  const run: Run = { ctl, t: 1000, events: [] };
  ctl.onBridge((e) => run.events.push(e));
  ctl.start(run.t);
  return run;
}

function camera(frames: readonly GaitFrame[], base: number): Frame[] {
  const t0 = frames[0].t;
  return frames.map((f) => ({ t: base + (f.t - t0), lm: f.lm, poses: [f.lm], aspect: f.aspect }));
}

function play(run: Run, frames: Frame[], each?: () => void): void {
  for (const f of frames) {
    run.ctl.feed(f, { rollDeg: 0 });
    run.ctl.tick(f.t);
    run.t = f.t;
    each?.();
  }
}

function tapTo(run: Run, until: GaitStepId): void {
  for (let i = 0; i < 40 && run.ctl.current.id !== until; i++) {
    if (run.ctl.current.id === "gear") run.ctl.setGear({ shoes: true, brace: null }, run.t);
    else if (!run.ctl.confirm(run.t)) break;
  }
  expect(run.ctl.current.id).toBe(until);
}

/** Its standing, its walk, then the clock until the end of the recording has run. */
function record(run: Run, w: { standing: GaitFrame[]; frames: GaitFrame[] }, each?: () => void): void {
  expect(run.ctl.current.id).toBe("stand");
  play(run, camera(w.standing, run.t + 40));
  expect(run.ctl.current.id).toBe("walk");
  play(run, camera(w.frames, run.t + 40), each);
  for (let i = 0; i < 4 && run.ctl.current.id === "walk"; i++) {
    run.t += CAPTURE_LIMITS.afterLastLapMs + 100;
    run.ctl.tick(run.t);
  }
}

const says = (run: Run) =>
  run.events.filter((e): e is Extract<BridgeEvent, { type: "say" }> => e.type === "say");

describe("the capture: part 1 across the picture, then part 2 toward the phone and back (controller.ts)", () => {
  it("walks the side passes, then right after them the walk toward the phone and back, twice, and posts both", () => {
    const run = controller();
    tapTo(run, "place");
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_side" });
    run.ctl.confirm(run.t);
    record(run, walk(sidePasses(4)));
    // Part 2: its own screen with the phone where it is, the coach told where to start and turn.
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_front" });
    const place = says(run).at(-1)!;
    expect(place).toMatchObject({ kind: "step", key: "place_overground_front", face: "phone" });
    expect(place.lines.join(" ")).toContain("Leave the phone where it is.");
    expect(place.lines.join(" ")).toContain("about 4 to 5 metres away");
    expect(place.lines.join(" ")).toContain("Turn when you are about 2 metres away");
    run.ctl.confirm(run.t);
    expect(run.ctl.current).toEqual({ id: "stand", rec: "overground_front" });
    const w = walk(GAIT_CATALOG.find((e) => e.name === "home-toward-back")!.spec);
    const seen: { passes: number; target: number }[] = [];
    const hints = new Set<string | null>();
    record(run, w, () => {
      const live = run.ctl.live();
      if (live && run.ctl.current.id === "walk") seen.push({ passes: live.passes, target: live.target });
      hints.add(run.ctl.hint);
    });
    // «Toward and back N of 2», never more; the turn cue at each lap.
    expect(seen.every((x) => x.target === CAPTURE_LIMITS.frontLaps && x.passes <= 2)).toBe(true);
    expect(seen.at(-1)?.passes).toBe(2);
    expect(hints.has("turn")).toBe(true);
    const keys = says(run).map((e) => e.key);
    expect(keys).toContain("walk_overground_front");
    expect(keys).toContain("hint_turn_1");
    expect(keys).toContain("hint_turn_2");
    expect(keys).toContain("lap_1");
    expect(keys).not.toContain("lap_2");
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.analysis.views.map((v) => v.view)).toEqual(["side", "front", "back"]);
    expect(body.analysis.engineVersion).toBe("gait_engine_5");
    const front = body.analysis.views.filter((v) => v.view !== "side");
    expect(sum(front, "left")).toBeGreaterThanOrEqual(2);
    expect(sum(front, "right")).toBeGreaterThanOrEqual(2);
    expect(front.some((v) => v.metrics.pelvic_drop)).toBe(true);
    expect(front[0].quality.capture).toMatchObject({ passes: 2, tries: 1 });
    expect(checkGaitBody(body as never, HOME).ok).toBe(true);
    const d = run.ctl.diagnostics().find((x) => x.rec === "overground_front")!;
    expect(d).toMatchObject({ target: 2, passes: 2, level: "timing" });
  });

  it("asks one calm «try once more» for part 2 with what to change, then goes on with what it holds", () => {
    const run = controller({ ...HOME, views: { overground: ["front", "back"], walking_pad: [] } });
    tapTo(run, "place");
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_front" });
    run.ctl.confirm(run.t);
    // A walk from only 3 m that turns at 2.2 m: too few steps in view.
    const short = walk(towardBack(6, { home: { farM: 3, nearM: 2.2 }, passes: 1 }));
    play(run, camera(short.standing, run.t + 40));
    play(run, camera(short.frames, run.t + 40));
    expect(run.ctl.finishWalk(run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "retry", rec: "overground_front" });
    expect(["front_start", "front_turn"]).toContain(run.ctl.retryReason());
    const retry = gaitStepSay(run.ctl, run.ctl.current, "en")!;
    expect(retry.lines.join(" ")).toMatch(/4 to 5 metres|2 metres before the phone/);
    expect(run.ctl.retry(true, run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_front" });
    run.ctl.confirm(run.t);
    play(run, camera(short.standing, run.t + 40));
    play(run, camera(short.frames, run.t + 40));
    expect(run.ctl.finishWalk(run.t)).toBe(true);
    // The second try goes on by itself, kept with its reasons.
    expect(run.ctl.current.id).toBe("saving");
    expect(run.ctl.diagnostics()[0]).toMatchObject({ rec: "overground_front", tries: 2 });
  });

  it("introduces the two parts and keeps the floor clear for part 2", () => {
    const run = controller();
    const intro = gaitStepSay(run.ctl, run.ctl.current, "en")!;
    expect(intro.lines).toContain(
      "Then, with the phone where it is, you will walk toward it and back, twice.",
    );
    const ar = gaitStepSay(run.ctl, run.ctl.current, "ar")!;
    expect(ar.lines).toContain("ثم، والهاتف في مكانه، ستمشي نحوه وترجع، مرتين.");
  });
});
