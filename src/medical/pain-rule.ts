/**
 * The one shared pain stop rule of v7 (product v7 contract C-15 and 2.6; review A08). The range of
 * motion runner, the GaitController and the coached session host all call it, so a pain answer stops
 * a movement, a walk or an exercise the same way everywhere. Pure, no DOM.
 *
 * The rule is written in words in the three clinical files, and tests/v7/a-pain-rule.test.ts reads the
 * numbers back from each of them:
 *   rom-protocol safety pain_during   «pain 6 or more out of 10, or 2 or more above that region's score
 *                                      before the test, or a sudden sharp pain»
 *   gait-rules eligibility.stops      «pain 6 or more, a rise of 2 or more over the score before the walk,
 *                                      or a sudden sharp pain ends the test»
 *   exercise-targets mobility_pain    «stop at 6 or more, a rise of 2 or more, or any sharp pain»
 * It holds in any location (C-15). An unknown score before (a region that is not a body map pain
 * region, or a workout that asks no score first) counts as 0, so any rise of 2 stops.
 */

/** Stop at this pain score or more (0 to 10), or at a rise of this many points over the score before. */
export const PAIN_STOP: { atOrAbove: 6; riseOf: 2 } = Object.freeze({ atOrAbove: 6, riseOf: 2 });

export interface PainStop {
  stop: boolean;
  why: "level" | "rise" | "sharp" | null;
}

/**
 * Stop at level 6 or more, at a rise of 2 or more over `before`, or at a sharp pain. `before` null
 * counts as 0. The reasons are checked in the order the clinical text lists them. A level that is not
 * a finite number stops (the safe side); a score before that is not a finite number counts as 0.
 */
export function painStopRule(level: number, sharp: boolean, before: number | null): PainStop {
  if (!Number.isFinite(level) || level >= PAIN_STOP.atOrAbove) return { stop: true, why: "level" };
  const base = before !== null && Number.isFinite(before) ? before : 0;
  if (level - base >= PAIN_STOP.riseOf) return { stop: true, why: "rise" };
  if (sharp) return { stop: true, why: "sharp" };
  return { stop: false, why: null };
}
