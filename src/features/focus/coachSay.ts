/**
 * What the Live coach says out loud on the range screens (D-037 item 1: Nasser stands 2 to 3 m from the
 * phone and cannot read it). Each say line carries the screen's own copy in the person's language: the
 * block's card, a movement's setup (the position, where the phone goes and how far, which way to face
 * it), the movement when the measurement starts, the rest and the next try, and the corrections the
 * camera's caption shows, and since D-038 item 1 the hold in hand («hold there») and the value recorded
 * («done»). The coach says them in its own words (bridge rule 9). Never a number of degrees: the live
 * meter has none (D-036 item 4). Pure, no DOM.
 */
import type { Lang } from "../../app/i18n";
import type { CoachFacing, CoachSay } from "../../coach/types";
import type { SetupIssue } from "../../engine/quality";
import { t } from "../../i18n";
import { tV7 } from "../../i18n/v7";
import type { RomBlock, RomProtocolItem } from "../../medical/rom-protocol";
import { cueLine } from "../../movements/assessments";
import { movementDef } from "../../movements/rom";
import type { RomMovementDef, RomPositionId, RomSide } from "../../movements/rom/types";
import type { CheckCueId } from "../../movements/types";
import { copyText, fillSide, instructionLines, lineText, positionName } from "./copy";

/** The lines of a movement's own instructions that set it up (the position and facing, the phone). */
const SETUP_LINES = 2;

/** Which way the person faces the phone: the movement's view, and the side tested in a side view. */
export function romFacing(def: Pick<RomMovementDef, "view">, side: RomSide): CoachFacing {
  if (def.view === "front") return "phone";
  return side === "left" ? "left_side" : side === "right" ? "right_side" : "side";
}

/** The v1 line of a facing, when there is one («واجه الهاتف.», «اجعل جانبك الأيمن نحو الهاتف.»). */
function facingLine(face: CoachFacing, lang: Lang): string | null {
  const id: CheckCueId | null =
    face === "phone"
      ? "check_face_phone"
      : face === "right_side"
        ? "check_right_side_to_phone"
        : face === "left_side"
          ? "check_left_side_to_phone"
          : null;
  return id ? cueLine(id)[lang] : null;
}

/** The phone's distance for a movement in a position without its own setup lines. */
function distanceLine(def: Pick<RomMovementDef, "distanceM">, lang: Lang): string {
  const d = def.distanceM;
  return Array.isArray(d)
    ? tV7(lang, "rom.say.distanceRange", { from: d[0], to: d[1] })
    : tV7(lang, "rom.say.distanceAbout", { m: d });
}

/** The position's own instruction line of a movement, when the data writes one (variantInstructions). */
function hasVariant(def: RomMovementDef, position: RomPositionId): boolean {
  return !!(def.variantInstructions as Partial<Record<RomPositionId, unknown>> | undefined)?.[position];
}

/**
 * The setup of a movement: its own first lines (the position, the side or the front to the phone, the
 * phone's place, distance and height), or for a position with its own line the position, the facing
 * and the distance.
 */
export function setupLines(item: RomProtocolItem, lang: Lang): string[] {
  const def = movementDef(item.movementId);
  if (!hasVariant(def, item.position))
    return def.instructions[lang].slice(0, SETUP_LINES).map((l) => fillSide(l, item.side, lang));
  const face = facingLine(romFacing(def, item.side), lang);
  return [positionName(item.position, lang), ...(face ? [face] : []), distanceLine(def, lang)];
}

/** The movement itself: the screen's instruction lines after the setup (the movement and the hold). */
export function movementLines(item: RomProtocolItem, lang: Lang): string[] {
  const def = movementDef(item.movementId);
  const lines = instructionLines(item.movementId, item.side, item.position, lang);
  return hasVariant(def, item.position) ? lines : lines.slice(SETUP_LINES);
}

const BLOCK_TITLE = {
  seated: "rom.block.seatedTitle",
  standing: "rom.block.standingTitle",
  lying: "rom.block.lyingTitle",
} as const;

/** A block's card: where the person is for it, the phone, the support and the helper. */
export function blockSay(block: RomBlock, items: readonly RomProtocolItem[], lang: Lang): CoachSay {
  const helper = items.some((i) => i.helperRequired);
  const neck = items.some((i) => i.region === "neck");
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: `block_${block}`,
    lines: [
      tV7(lang, BLOCK_TITLE[block]),
      tV7(lang, "rom.block.camera"),
      ...(block === "standing" ? [copyText("support_line", lang)] : []),
      ...(helper ? [copyText("helper_line", lang)] : []),
      ...(block === "lying" ? [tV7(lang, "rom.block.lyingHelper")] : []),
      ...(neck ? [copyText("neck_stop_line", lang)] : []),
    ],
  };
}

/** A movement's setup card: turn the other side first when asked, then its setup. */
export function setupSay(item: RomProtocolItem, turnSide: boolean, lang: Lang): CoachSay {
  const def = movementDef(item.movementId);
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: "setup",
    movement: item.movementId,
    side: item.side,
    face: romFacing(def, item.side),
    lines: [
      ...(turnSide ? [copyText("turn_side", lang)] : []),
      ...setupLines(item, lang),
      ...(item.helperRequired ? [copyText("helper_line", lang)] : []),
    ],
  };
}

/**
 * The measurement starts: the start position held still, then the movement and its hold (the first
 * try is a practice, unless this is the second try the person asked for).
 */
export function moveSay(item: RomProtocolItem, practice: boolean, lang: Lang): CoachSay {
  const def = movementDef(item.movementId);
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: "move",
    movement: item.movementId,
    side: item.side,
    face: romFacing(def, item.side),
    lines: [
      tV7(lang, "rom.measure.start"),
      ...movementLines(item, lang),
      tV7(lang, "rom.measure.move"),
      ...(practice ? [copyText("practice", lang)] : []),
    ],
  };
}

/** A scored try after the practice or a repeat: once more, the same way. */
export function againSay(item: RomProtocolItem, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: "again",
    movement: item.movementId,
    side: item.side,
    lines: [copyText("again", lang), tV7(lang, "rom.measure.move")],
  };
}

/** The rest between tries. */
export function restSay(item: RomProtocolItem, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: "rest",
    movement: item.movementId,
    side: item.side,
    lines: [tV7(lang, "rom.measure.rest")],
  };
}

/**
 * D-039 item 2 (Nasser at the booth: «the voice agent is talking too much … don't let it give things
 * like the phone is tilted»): the coach says the corrections about the person's own body (which way
 * to face, which arm, the elbow by the side, back to the middle, back into the picture). The phone's
 * angle, level and steadiness, the light, the distance and the sleeves stay on the screen only.
 */
const SCREEN_ONLY_CORRECTIONS: ReadonlySet<string> = new Set([
  "check_phone_still",
  "check_phone_level",
  "check_phone_angle_left",
  "check_phone_angle_right",
  "check_light",
  "check_move_back",
  "check_move_closer",
  "check_sleeves",
  "check_one_person",
  "check_clear_view",
]);
const SCREEN_ONLY_SETUP: ReadonlySet<string> = new Set([
  "tilt",
  "too_close",
  "too_far",
  "framing",
  "arm_room",
  "light",
  "second_person",
]);

/** True when the coach says this correction (a caption id or a setup issue); the rest stay on screen. */
export function correctionSpoken(id: string): boolean {
  return !SCREEN_ONLY_CORRECTIONS.has(id) && !SCREEN_ONLY_SETUP.has(id);
}

/** A correction the camera's caption shows (a runner line: the view, the still phone, the arm, the middle). */
export function correctionSay(id: string, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "correction",
    key: id,
    lines: [lineText(id as Parameters<typeof lineText>[0], lang)],
  };
}

/** A setup issue the start pose's caption shows (too close, someone else in the picture ...). */
export function setupIssueSay(issue: SetupIssue, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "correction",
    key: `setup_${issue}`,
    lines: [t(lang, `assessment.setup.issue.${issue}` as never)],
  };
}

/**
 * D-038 item 1: a hold in hand, the coach's short «hold there» (a count like line: said only when the
 * coach is free at once, never late). No number of degrees.
 */
export function holdSay(item: RomProtocolItem, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "progress",
    key: "hold",
    movement: item.movementId,
    side: item.side,
    lines: [tV7(lang, "rom.say.hold")],
  };
}

/** D-038 item 1: the value is recorded (no question): the coach's short «done». */
export function doneSay(item: RomProtocolItem, lang: Lang): CoachSay {
  return {
    p: 2,
    type: "say",
    kind: "step",
    key: "done",
    movement: item.movementId,
    side: item.side,
    lines: [tV7(lang, "rom.say.done")],
  };
}
