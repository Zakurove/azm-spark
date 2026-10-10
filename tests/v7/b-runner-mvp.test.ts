/**
 * D-035 item 1, Nasser's second real test (v7.1 on his iPhone, seated at home): every movement ended
 * «not measured», reason quality, 3 repeats and no quality issue. He heard a cue on every small
 * movement («keep your arm in front», «not to the side») and each one discarded the attempt; the dial
 * showed his angle and he held it, yet nothing was measured; the one stored attempt, the elbow bend at
 * 135 with «is this your maximum» unanswered (answer unconfirmed, source timeout), was dropped.
 *
 * The MVP runner on the generator's seated person at home (the D-034 phone: a 4:3 picture held upright,
 * a 42 degree lens, 1.2 to 1.5 m, the legs out of the picture), 30 fps with frame jitter and landmark
 * noise, the person never answering the maximum question:
 *   - his elbow case: a valid plateau at 135, no answer, the timeout: 135 is recorded;
 *   - the arm raise to the front drifting a little to the side, sitting a little turned: measured
 *     within the real model bar (10 degrees, contract 8.4), never repeated, at most one calm line;
 *   - compensations in every try never discard the value and speak at most once;
 *   - a person truly out of the picture is still not measured.
 * AZM_MVP_REPORT=<file> writes one JSON line per case for the before and after table. Clearly synthetic.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GenSpec, RomOffset } from "../fixtures/gen";
import type { RomMovementId } from "../../src/movements/rom/types";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import { ROM_DATA } from "../../src/movements/rom";
import { MATRIX_JITTER_MS, romSpec, runRom, type RomRun } from "./b-fixtures";

/** The home phone of D-034: a 4:3 picture held upright, a 42 degree lens, at `distance` and `height` m. */
const home = (distance: number, height: number) => ({ distance, height, fovShortDeg: 42 });

/** The real model bar (contract 8.4): within 10 degrees of the goniometer. */
const BAR_DEG = 10;

interface MvpCase {
  name: string;
  movement: RomMovementId;
  peak: number;
  camera: { distance: number; height: number; fovShortDeg: number };
  /** Sitting turned toward the phone (yaw), broader shoulders: reads oblique. */
  turned?: { yaw: number; shoulderScale: number };
  /** A drift of the moving arm through each repetition (rom_offset, scaled from the rise on). */
  drift?: RomOffset;
  /** How fast the drift comes, seconds from the repetition's start (default its whole rise). */
  driftRise?: number;
  noise?: number;
  /**
   * The drift is a compensation in every try (the bar for a clean movement does not apply): its check
   * reaches its invalid level, so the value is flagged approximate, or only its cue level (one calm line).
   */
  compensated?: { approximate: boolean };
  expect?: "not_measured";
}

const CASES: MvpCase[] = [
  {
    name: "elbow bend to 135, seated 1.3 m, no answer (Nasser's case)",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
  },
  {
    name: "elbow bend to 135, sitting 30 degrees turned, no answer",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
    turned: { yaw: -60, shoulderScale: 1.2 },
  },
  {
    name: "arm raise to the front to 150, drifting 20 degrees to the side, a little turned, no answer",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.4, 1.1),
    turned: { yaw: -72, shoulderScale: 1.15 },
    drift: { arms: { right: { plane: -20 } } },
  },
  {
    name: "arm raise to the front to 120, drifting 25 degrees to the side, 1.3 m, no answer",
    movement: "shoulder_flexion",
    peak: 120,
    camera: home(1.3, 1.14),
    drift: { arms: { right: { plane: -25 } } },
  },
  {
    name: "arm raise to the side to 140, 1.45 m, twice the matrix noise, no answer",
    movement: "shoulder_abduction",
    peak: 140,
    camera: home(1.45, 1.15),
    noise: 0.006,
  },
  {
    name: "elbow straightening to 5, 1.3 m, no answer",
    movement: "elbow_extension",
    peak: 5,
    camera: home(1.3, 0.95),
  },
  {
    name: "elbow bend to 135, the upper arm swinging 30 degrees forward in every try, no answer",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
    drift: { arms: { right: { elev: 30 } } },
    compensated: { approximate: true },
  },
  {
    name: "arm raise to the front to 150, half way out to the side in every try, no answer",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.4, 1.1),
    drift: { arms: { right: { plane: -55 } } },
    driftRise: 0.5,
    compensated: { approximate: false },
  },
  {
    name: "elbow bend, the hand below the picture, 0.9 m (truly out of frame)",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(0.9, 1.25),
    expect: "not_measured",
  },
];

function mvpSpec(c: MvpCase): GenSpec {
  const base = romSpec({
    name: `rom/mvp/${c.name}`,
    movement: c.movement,
    position: "seated",
    side: "right",
    aspect: "3:4",
    peak: c.peak,
    fps: 30,
    jitterMs: MATRIX_JITTER_MS,
    // Long enough for the runner before D-035 to finish its three scored attempts (the before table).
    reps: 8,
    ...(c.noise ? { noise: c.noise } : {}),
  });
  const reps = (base.subject?.motions ?? []).filter((m) => m.kind === "rom_rep");
  const drift = c.drift
    ? reps.map((m) => ({
        kind: "rom_offset" as const,
        offset: c.drift!,
        start: m.start,
        rise: c.driftRise ?? (m.kind === "rom_rep" ? (m.rise ?? 2) : 2),
        hold: (m.kind === "rom_rep" ? (m.rise ?? 2) + (m.hold ?? 4) : 6) - (c.driftRise ?? 0),
        back: 1,
      }))
    : [];
  return {
    ...base,
    camera: c.camera,
    offFrame: { noise: 0.04 },
    subject: {
      ...base.subject,
      motions: [...(base.subject?.motions ?? []), ...drift],
      ...(c.turned ? { yaw: c.turned.yaw, shoulderScale: c.turned.shoulderScale } : {}),
    },
  };
}

/** The lines the runner asked to play that are corrections (compensation cues and the view line). */
function corrections(run: RomRun): string[] {
  const cues = new Set<string>([
    ...ROM_DATA.movements.flatMap((m) => m.compensations.flatMap((c) => (c.cue ? [c.cue] : []))),
    "test_abd_still",
    "test_abd_side",
    "check_face_phone",
    "check_left_side_to_phone",
    "check_right_side_to_phone",
  ]);
  return run.events.flatMap((e) => (e.kind === "cue" && cues.has(e.cue) ? [e.cue] : []));
}

function report(c: MvpCase, run: RomRun) {
  const file = process.env.AZM_MVP_REPORT;
  if (!file) return;
  const r = run.result;
  appendFileSync(
    file,
    JSON.stringify({
      name: c.name,
      truth: c.peak,
      status: r.status,
      reason: r.reason,
      value: r.value,
      nValid: r.nValid,
      repeats: run.records
        .filter((a) => a.outcome === "retry" || a.outcome === "invalid")
        .map((a) => a.reasons.join("+")),
      answers: r.attempts.map((a) => `${a.answer}/${a.answerSource}`),
      corrections: corrections(run),
      flags: r.flags,
    }) + "\n",
  );
}

describe("D-035: the MVP runner at home, recorded with no question (D-038 item 1)", () => {
  for (const c of CASES)
    it(c.name, () => {
      const run = runRom(mvpSpec(c));
      report(c, run);
      const r = run.result;
      if (c.expect === "not_measured") {
        expect(r).toMatchObject({ status: "not_measured", reason: "quality", value: null });
        return;
      }
      expect({ status: r.status, reason: r.reason }).toEqual({ status: "measured", reason: null });
      expect(r.nValid).toBe(RUNNER_RULES.validAttempts);
      expect(r.attempts[0]).toMatchObject({ outcome: "valid", answer: null, answerSource: null });
      // A compensated value reads the compensation too: the bar is the real model's for a clean one.
      if (!c.compensated)
        expect(Math.abs(r.value! - c.peak), `${r.value} for ${c.peak}`).toBeLessThanOrEqual(BAR_DEG);
      else expect(r.flags.includes("approximate")).toBe(c.compensated.approximate);
      // Nothing repeated, at most one calm line in the whole movement.
      expect(run.records.filter((a) => a.outcome === "retry" || a.outcome === "invalid")).toEqual([]);
      expect(corrections(run).length).toBeLessThanOrEqual(1);
      expect(
        run.events.filter((e) => e.kind === "compensation" && e.level === "cue").length,
      ).toBeLessThanOrEqual(1);
    });

  it("Nasser's elbow: the held 135 is recorded as 135, with no question", () => {
    const run = runRom(mvpSpec(CASES[0]));
    expect(run.result).toMatchObject({ status: "measured", value: 135, nValid: 1 });
    const hold = run.holds[run.holds.length - 1];
    const rec = run.result.attempts[0];
    // D-038 item 1: recorded once the hold's own time is over.
    expect(rec.t1 - hold.t).toBeGreaterThanOrEqual(RUNNER_RULES.settleSec * 1000 - 50);
    expect(rec.flags).not.toContain("unconfirmed");
  });
});
