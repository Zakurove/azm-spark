/**
 * What the Live coach says out loud during the walk (D-037 item 1: Nasser stands about 3 m from the
 * phone and cannot read it): each step's setup and instruction in the screen's own copy (the phone
 * sideways at hip height about 3 metres from the path, walking across the picture and back with the
 * side to the phone, never toward it), the pass count now and then, and the hints the screen shows.
 * The coach says them in its own words (bridge rule 9). Pure, no DOM.
 */
import { capture as captureData } from "../../movements/gait/gait-v7.json";
import type { GaitData } from "../../movements/gait/types";
import type { Lang } from "../../app/i18n";
import type { CoachFacing, CoachSay } from "../../coach/types";
import type { GaitController, GaitHint, GaitStep } from "./controller";
import { gt, setupLine, sideWord } from "./copy";

/** The overground walk's fixed passes (gait-rules capture.overground.side.passes, D-036 item 6). */
const SIDE_PASSES = (captureData as unknown as GaitData["capture"]).overground.side.passes;

/** The say line of a walk step (kind step), or null for a question, a safety step or the save. */
export function gaitStepSay(ctl: GaitController, step: GaitStep, lang: Lang): CoachSay | null {
  const lines = stepLines(ctl, step, lang);
  if (!lines.length) return null;
  const face = facingOf(ctl, step);
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: step.rec ? `${step.id}_${step.rec}` : step.id,
    ...(face ? { face } : {}),
    lines,
  };
}

/**
 * Which way the person faces the phone on a step: side on for the overground walk (either side), the
 * near side on the pad's side views, the front on the pad's front view and the single leg stance.
 */
function facingOf(ctl: GaitController, step: GaitStep): CoachFacing | null {
  if (step.id === "stance_place" || step.id === "stance") return "phone";
  const rec = step.rec;
  if (!rec || !(step.id === "place" || step.id === "stand" || step.id === "walk" || step.id === "pad_on"))
    return null;
  if (rec === "overground_side") return "side";
  if (rec === "pad_front") return "phone";
  return ctl.viewsOf(rec)[0]?.nearSide === "left" ? "left_side" : "right_side";
}

function stepLines(ctl: GaitController, step: GaitStep, lang: Lang): string[] {
  const rec = step.rec;
  const near = rec ? (ctl.viewsOf(rec)[0]?.nearSide ?? "right") : "right";
  switch (step.id) {
    case "intro": {
      const both = ctl.plan.modes.length > 1;
      return [
        gt(lang, both ? "intro.both" : ctl.mode === "walking_pad" ? "intro.pad" : "intro.overground", {
          n: String(SIDE_PASSES),
        }),
      ];
    }
    case "clear_path":
      return [setupLine("clear_path", lang), gt(lang, "path.length")];
    case "pad_check":
      return [
        gt(lang, "pad.checkTitle"),
        gt(lang, "pad.floor1"),
        gt(lang, "pad.floor2"),
        gt(lang, "pad.support1"),
        gt(lang, "pad.support2"),
      ];
    case "place":
      if (rec === "overground_side")
        return [gt(lang, "place.side1"), gt(lang, "place.side2"), gt(lang, "place.side3")];
      if (rec === "pad_front")
        return [gt(lang, "place.padFrontTitle"), gt(lang, "place.padFront1"), gt(lang, "place.padFront2")];
      return [
        ...(rec === "pad_side_b" ? [setupLine("pad_other_side", lang)] : []),
        gt(lang, "place.padSideTitle", { side: sideWord(near, lang) }),
        gt(lang, "place.padSide1"),
        gt(lang, "place.padSide2"),
      ];
    case "pad_on":
      return [gt(lang, "pad.onTitle"), gt(lang, "pad.on1")];
    case "stand":
      return [
        gt(lang, rec === "overground_side" ? "stand.sideTitle" : "stand.padTitle"),
        gt(lang, "stand.body"),
      ];
    case "pad_start":
      return [gt(lang, "pad.startTitle"), gt(lang, rec === "pad_side_a" ? "pad.start1" : "pad.startAgain")];
    case "pad_warm_up":
      return [gt(lang, "pad.warmTitle"), gt(lang, "pad.warm1")];
    case "walk":
      return rec === "overground_side"
        ? [gt(lang, "walk.sideSay"), gt(lang, "walk.sideBody")]
        : [gt(lang, "walk.padTitle"), gt(lang, "walk.padBody")];
    case "walk_again":
      return [gt(lang, "again.title"), gt(lang, "again.body")];
    case "retry":
      return [
        gt(lang, "retry.title"),
        gt(lang, `retry.reason.${ctl.retryReason() ?? "more_steps"}`),
        gt(lang, "retry.body"),
      ];
    case "pad_stop":
      return [gt(lang, "pad.stopTitle"), setupLine("pad_stop", lang)];
    case "stance_place":
      return [gt(lang, ctl.mode === "walking_pad" ? "stance.placePad" : "stance.placeOverground")];
    case "stance":
      return [setupLine("single_leg_static", lang)];
    case "done":
      return [gt(lang, "done.title")];
    case "nothing":
      return [gt(lang, "nothing.title"), gt(lang, "nothing.body")];
    default:
      // mode, gear, pad_details, save_error: questions on the screen; saving; pain_stop, stopped: safety.
      return [];
  }
}

/**
 * The passes the coach counts out loud (sparingly): from the second up to the one before the last,
 * never the first (the walk has just begun) nor the last (the walk ends a moment later).
 */
export function passSaid(n: number, target: number): boolean {
  return n >= 2 && n < target;
}

/** The pass count («Pass 2 of 4»), kind progress: said only if the coach is free at once. */
export function passSay(n: number, target: number, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "progress",
    key: `pass_${n}`,
    lines: [gt(lang, "walk.passOf", { n: String(n), total: String(target) })],
  };
}

/** A hint the screen shows («Walk across the picture, not toward the phone»), kind correction. */
export function hintSay(hint: GaitHint, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "correction",
    key: `hint_${hint}`,
    ...(hint === "across" ? { face: "side" as const } : {}),
    lines: [gt(lang, `hint.${hint}`)],
  };
}
