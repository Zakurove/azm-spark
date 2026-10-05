/**
 * The live coach's instruction and history inputs from stored state only (product v7 contract 5.1,
 * C-12): the focus check's frozen protocol, gait plan and kept day answers with the intake's sex, age
 * and walking aid, or the workout's stored plan. Nothing a client sends reaches the coach. What leaves
 * the server is exactly C-12's list: the range items (movement ids and names, sides, positions and
 * typical values rounded to 5 degrees, which depend on sex and age, as the live_coach consent says),
 * the walk's modes, views, aid type and helper, or the workout's exercise names and dose; never a why
 * line, a note, a reason or any free text.
 */
import type { CoachSegment } from "../../../src/coach/types";
import type { HistoryInput, InstructionInput, SessionHistoryItem } from "../../../src/coach/instruction";
import type { Intake } from "../../../src/medical/plan";
import { positionTypical } from "../../../src/medical/rom-norms";
import type { SessionStep } from "../../../src/medical/session";
import type { Lang } from "../../../src/movements/types";
import { runSteps, type RunPlan } from "../../guided";
import type { FocusCheck } from "../focus/store";
import type { CheckSegment } from "./segments";

export interface CoachContext {
  instruction: InstructionInput;
  history: HistoryInput;
}

/**
 * Whether a helper is with the person: the day's pc_helper answer, and at the booth the staff (gait
 * rules eligibility, «staff count as helper at the booth», as gaitPlanFor reads it).
 */
export function helperPresent(check: Pick<FocusCheck, "setting" | "today">): boolean {
  return check.setting === "booth" || check.today.helperPresent === true;
}

/** A range or gait segment of a focus check. */
export function checkContext(check: FocusCheck, intake: Intake, seg: CheckSegment, lang: Lang): CoachContext {
  const helper = helperPresent(check);
  if (seg.block === "rom") {
    const sex = intake.sex;
    return {
      instruction: { lang, block: "rom", position: seg.position, helperPresent: helper },
      history: {
        block: "rom",
        lang,
        segment: seg.segment,
        helperPresent: helper,
        items: seg.items.map((i) => ({
          movement: i.movementId,
          side: i.side,
          position: i.position,
          // The typical of the item's own position, none without a graded norm there (4.3 rule 7).
          typical: sex
            ? positionTypical(
                i.movementId,
                i.position,
                sex,
                intake.age,
                i.side === "none" ? undefined : i.side,
              )
            : null,
        })),
      },
    };
  }
  const plan = check.gaitPlan!;
  const walking = intake.walking;
  return {
    instruction: { lang, block: "gait", position: "walking", helperPresent: helper },
    history: {
      block: "gait",
      lang,
      segment: "gait",
      modes: plan.modes,
      // The views only: a pad view's near side would name the affected side (C-12 sends the views).
      views: { overground: plan.views.overground, walking_pad: plan.views.walking_pad.map((v) => v.view) },
      aid: walking?.status === "with_aid" ? walking.aid : "none",
      helperPresent: helper,
    },
  };
}

/** The exercises of the steps from `position` on, each once, with its dose as the screen shows it. */
export function remainingExercises(
  steps: readonly SessionStep[],
  position: number,
  restSeconds: number,
): SessionHistoryItem[] {
  const out: SessionHistoryItem[] = [];
  const seen = new Set<string>();
  for (const step of steps.slice(Math.max(0, position))) {
    if (step.kind === "camera") {
      const p = step.prescription;
      const key = `camera:${p.exerciseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ exerciseId: p.exerciseId, sets: p.sets, reps: p.reps, restSeconds: p.restSeconds });
    } else {
      const i = step.item;
      const key = `${step.slot}:${i.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        exerciseId: i.id,
        sets: i.sets,
        ...(i.holdSeconds ? { holdSeconds: i.holdSeconds } : { reps: i.reps ?? 8 }),
        restSeconds,
      });
    }
  }
  return out;
}

/**
 * A workout part (session:1 or session:2): the exercises from the workout's current step on. The
 * client starts session:2 at an exercise boundary, so its history holds the rest of the workout.
 */
export function workoutContext(
  run: RunPlan,
  position: number,
  segment: CoachSegment,
  lang: Lang,
): CoachContext {
  const steps = runSteps(run);
  const rest = run.today?.restSeconds ?? run.restSeconds ?? run.exercises[0]?.restSeconds ?? 60;
  return {
    instruction: { lang, block: "session", position: null, helperPresent: false },
    history: { block: "session", lang, segment, exercises: remainingExercises(steps, position, rest) },
  };
}
