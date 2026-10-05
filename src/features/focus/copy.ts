/**
 * The words of the range screens (product v7 contract B3): the clinical copy of the range data (the
 * movement names and instructions, the questions, the answers, the result lines and labels, rom-v7.json
 * copy, cues and results) with its tokens filled, and the screens' own interface lines of the rom
 * namespace (src/i18n/{ar,en}/rom.json). Pure, no DOM.
 *
 * Side words follow the data (sideWords): {sideM} takes the masculine form («الأيمن»), {sideF} the
 * feminine («اليمنى»), {side} the English word; a movement without a side drops the token's phrase.
 */
import type { Lang } from "../../app/i18n";
import { interpolate } from "../../i18n";
import { tV7 } from "../../i18n/v7";
import type { Intake } from "../../medical/plan";
import type { RomProtocolItem } from "../../medical/rom-protocol";
import { shownApproximate, normFor } from "../../medical/rom-norms";
import type { RomFindingId } from "../../medical/rom-types";
import type { RomMeasureResult } from "../../engine/rom/types";
import { cueLine } from "../../movements/assessments";
import { movementDef, romCopy, romCue, romResultLine, ROM_DATA } from "../../movements/rom";
import type {
  RomCopyKey,
  RomCueId,
  RomMovementId,
  RomPositionId,
  RomResultKey,
  RomSide,
} from "../../movements/rom/types";
import type { CheckCueId } from "../../movements/types";

/** Fills the side tokens of a data line ({sideM}, {sideF}, {side}). */
export function fillSide(text: string, side: RomSide, lang: Lang): string {
  if (side === "none") return text.replace(/\s?\{side[MF]?\}/g, "");
  const w = ROM_DATA.sideWords;
  return text
    .replace(/\{sideM\}/g, lang === "ar" ? w.sideM[side] : w.side[side])
    .replace(/\{sideF\}/g, lang === "ar" ? w.sideF[side] : w.side[side])
    .replace(/\{side\}/g, lang === "ar" ? w.sideM[side] : w.side[side]);
}

/** The movement's name («ثني الركبة» · "Knee bend"). */
export function movementName(id: RomMovementId, lang: Lang): string {
  return movementDef(id).name[lang];
}

/** A region's name; lower case in English inside a sentence («الركبة» · "knee"). */
export { regionName } from "./names";

/** A position's name («استلقاء على الظهر» · "Lying on the back on a bed or firm mat"). */
export function positionName(position: RomPositionId, lang: Lang): string {
  return ROM_DATA.positions[position][lang];
}

/**
 * The instructions of a movement in its position, side tokens filled: the data's steps, or for a
 * position with its own line (variantInstructions) that line and the plain hold line (the data's last
 * step is written for its own position: hip flexion's keeps the head and back on the bed). Seated, a
 * movement whose lift a hand near the knee voids (the assisted check) first says where the hands
 * rest (D-027 item 3, W2-7).
 */
export function instructionLines(
  id: RomMovementId,
  side: RomSide,
  position: RomPositionId,
  lang: Lang,
): string[] {
  const def = movementDef(id);
  const variant = (
    def.variantInstructions as Partial<Record<RomPositionId, { ar: string; en: string }>> | undefined
  )?.[position];
  if (!variant) return def.instructions[lang].map((l) => fillSide(l, side, lang));
  const hands = position === "seated" && def.compensationIds.includes("assisted");
  return [
    ...(hands ? [tV7(lang, "rom.instruction.seatedHands")] : []),
    fillSide(variant[lang], side, lang),
    tV7(lang, "rom.instruction.hold"),
  ];
}

/** A copy line of the range data. */
export function copyText(key: RomCopyKey, lang: Lang): string {
  return romCopy(key)[lang];
}

/** The words of a local line the runner plays: a range cue, a range copy line, or a v1 check cue. */
export function lineText(line: RomCueId | RomCopyKey | CheckCueId, lang: Lang): string {
  if (line in ROM_DATA.cues) return romCue(line as RomCueId)[lang];
  if (line in ROM_DATA.copy) return romCopy(line as RomCopyKey)[lang];
  return cueLine(line as CheckCueId)[lang];
}

/** The voice pack line of a local line (src/app/voice-script.json): rom_<key> for the range lines. */
export function voiceLineOf(line: RomCueId | RomCopyKey | CheckCueId): string {
  return line in ROM_DATA.cues || line in ROM_DATA.copy ? `rom_${line}` : line;
}

/** The label of a finding on a result card (rom-protocol 7.4). */
export const FINDING_LABEL: Partial<Record<RomFindingId, RomResultKey>> = {
  within: "label_within",
  mild: "label_mild",
  marked: "label_marked",
  pain_limited: "label_pain",
  not_today: "label_not_today",
  not_applicable: "label_not_applicable",
  default: "label_default",
};

export interface ResultView {
  /** The headline value, whole degrees and never negative (copy cannot show a minus sign), or null. */
  value: number | null;
  /** The typical value for the person, or null. */
  typical: number | null;
  /** The value line of rom-protocol 7.4, tokens filled. */
  line: string;
  /** The finding's label, or null (no grade). */
  label: string | null;
  /** The finding id the label shows. */
  finding: RomFindingId;
  /** Extra labels: approximate, provisional, uncertain. */
  notes: string[];
  /** Lines under the value: finding_new for a marked limit, refer_measure, the not measured line. */
  more: string[];
}

/** Knee straightening lying: «label_uncertain replaces label_within» for these histories (7.4). */
const UNCERTAIN_PROBLEMS = ["injury", "after_surgery", "limb_loss"] as const;
const UNCERTAIN_CONDITIONS = ["arthritis", "cerebral_palsy"];

/**
 * The result card of one movement (rom-protocol 7.4): the value line, the label of the finding and the
 * notes. `finding` and `typical` come from the grade (the same pure grade the server stores, C-3).
 */
export function resultView(
  item: RomProtocolItem,
  result: RomMeasureResult,
  finding: RomFindingId,
  typical: number | null,
  intake: (Intake & { sex: "male" | "female" }) | null,
  lang: Lang,
  ui: (key: string) => string,
): ResultView {
  const def = movementDef(item.movementId);
  const r = (key: RomResultKey, vars: Record<string, string | number> = {}) =>
    interpolate(lang, romResultLine(key)[lang], { unit: "deg", ...vars });
  const notes: string[] = [];
  const more: string[] = [];
  const v = result.value;
  if (v === null) {
    const line =
      result.reason === "no_active_movement"
        ? copyText("no_active_movement", lang)
        : result.reason === "pain_stop"
          ? copyText("pain_stop", lang)
          : result.reason === "quality" || result.reason === "no_hold"
            ? ui("result.quality")
            : result.reason === "by_choice"
              ? ui("result.byChoice")
              : copyText("not_today_safety", lang);
    const shown: RomFindingId = result.reason === "pain_stop" ? "pain_limited" : finding;
    const labelKey = FINDING_LABEL[shown];
    return {
      value: null,
      typical,
      line,
      label: labelKey ? romResultLine(labelKey)[lang] : null,
      finding: shown,
      notes,
      more,
    };
  }
  let line: string;
  let value = Math.abs(v);
  const posDef = def.positions.find((p) => p.id === item.position);
  if (item.movementId === "hip_extension") {
    line =
      v >= 0 ? r("value_hip_ext_behind", { value, norm: typical ?? 0 }) : r("value_hip_ext_front", { value });
  } else if (item.movementId === "knee_extension" && item.position === "seated") {
    value = Math.max(0, v);
    line = value > 0 ? r("value_knee_seated", { value }) : r("value_lack_straight");
    const refer = (posDef as { referMeasureLackAbove?: number } | undefined)?.referMeasureLackAbove;
    if (refer !== undefined && v > refer) more.push(romResultLine("refer_measure")[lang]);
  } else if (def.kind === "lack") {
    value = Math.max(0, v);
    line = value > 0 ? r("value_lack", { value }) : r("value_lack_straight");
  } else if (finding === "no_grade" || typical === null) {
    line = r("value_no_grade", { value });
  } else {
    line = r("value_flexion", { value, norm: typical });
  }
  let label: string | null = FINDING_LABEL[finding] ? romResultLine(FINDING_LABEL[finding]!)[lang] : null;
  // 7.4: label_uncertain replaces label_within for a lying knee lack from 5 within normal, with these
  // histories of that knee (its own side: the findings page reads the same, findings.ts).
  const from = (posDef as { uncertainLackFrom?: number } | undefined)?.uncertainLackFrom;
  if (finding === "within" && from !== undefined && v >= from && intake) {
    const knee = intake.regions?.some(
      (e) =>
        e.region === "knee" &&
        (e.side === item.side || e.side === "both") &&
        e.problems.some((p) => (UNCERTAIN_PROBLEMS as readonly string[]).includes(p)),
    );
    if (knee || intake.conditions.some((c) => UNCERTAIN_CONDITIONS.includes(c)))
      label = romResultLine("label_uncertain")[lang];
  }
  if (finding === "marked") more.push(romResultLine("finding_new")[lang]);
  if (result.nValid === 1) notes.push(romResultLine("label_provisional")[lang]);
  const pick = intake
    ? normFor(
        item.movementId,
        item.position,
        intake.sex,
        intake.age,
        item.side === "none" ? undefined : item.side,
      )
    : null;
  if (shownApproximate(def, pick, v, result.flags)) notes.push(romResultLine("label_approximate")[lang]);
  return { value, typical, line, label, finding, notes, more };
}
