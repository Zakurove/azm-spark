/**
 * The v7 parts of the intake (product v7 contract 1.2 and 2.2; shortened by D-034 item 5). A v7 form
 * has three steps:
 *   1. «حالتك وحركتك» (IntakeV7About): age and sex, the conditions with their side or pattern
 *      (rom-protocol 2.3), how the person exercises, walking with its aid and an optional height.
 *   2. «جسمك وسلامتك» (IntakeV7): the body map, filled from the condition answers at once (the person
 *      confirms it, or taps a part to add or take it off; only a part added by hand asks one quick
 *      choice of its problem, and the injury or surgery questions only with that problem), then the
 *      safety questions: IntakeForm's warning signs, clearance, recent change and restrictions, and
 *      the questions of RomIntakeFlags that decide which tests are offered.
 *   3. the goal and schedule, with the consent (IntakeForm).
 *
 * IntakeForm loads this module only in a VITE_V7 build (`import.meta.env.VITE_V7 === "1" ?
 * lazy(...) : null`), so a default build has none of it. The working state (V7Ui) lives in
 * IntakeForm, so it survives moving between steps, and each part writes the intake's v7 fields
 * (V7Answers) on every change: a field stays undefined until its answers are complete, which keeps
 * Continue closed. Clinical lines come from the range data (romCopy, regions, problem types,
 * movement names); the parts' own lines are in the intake7 namespace (tV7).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { labels } from "./platform-copy";
import Icon from "./Icon";
import { tV7 } from "../i18n/v7";
import BodyMap, { entryLabel, regionName } from "../features/body-map/BodyMap";
import {
  AXIAL_REGIONS,
  HIP_AVOID_IDS,
  LIMB_LOSS_LEVELS,
  PROBLEM_TYPES,
  REGION_IDS,
  REGION_MOVEMENTS,
  REGION_PAIN_IDS,
  SINCE_BUCKETS,
  autoFillQuestions,
  autoFillRegions,
  entryCells,
  finalizeRegion,
  finalizeRomFlags,
  limbOf,
  mergeRegionDrafts,
  regionQuestions,
  romFlagQuestions,
  type AutoFillAnswer,
  type BodyMapKey,
  type HipAvoidId,
  type LimbLossLevel,
  type ProblemType,
  type RegionDraft,
  type RegionEntry,
  type RegionId,
  type RegionQuestionId,
  type RegionSide,
  type ReportRegion,
  type RomFlagContext,
  type RomFlagQuestionId,
  type RomIntakeFlags,
  type SinceBucket,
  type YesNoUnsure,
} from "../medical/body-map";
import {
  HEIGHT_CM,
  walkingAids,
  type Intake,
  type Sex,
  type Walking,
  type WalkingAid,
} from "../medical/plan";
import { ROM_DATA, movementDef, romCopy } from "../movements/rom";
import type { RomCopyKey, RomMovementId } from "../movements/rom/types";

/** The v7 fields of the intake this step writes. */
export type V7Answers = Pick<Intake, "sex" | "regions" | "walking" | "heightCm" | "romFlags"> &
  Partial<Pick<Intake, "support">>;

type Side = "right" | "left";
type MsLimb = "right_arm" | "left_arm" | "right_leg" | "left_leg";
/** The condition answers while the person gives them (AutoFillAnswer once complete). */
export interface FillDraft {
  stroke?: Side;
  cerebral_palsy?: { pattern?: "one_side" | "both_legs" | "all_limbs"; side?: Side };
  ms?: MsLimb[];
  sci_complete?: "neck" | "back";
  sci_incomplete?: "neck" | "back";
  lower_limb_unilateral?: { side?: Side; level?: "below_knee" | "above_knee" };
  upper_limb_unilateral?: { side?: Side; level?: "below_elbow" | "above_elbow" };
}

/** The step's working state, kept by IntakeForm across its steps. */
export interface V7Ui {
  sex?: Sex;
  walking?: Walking["status"];
  aid?: WalkingAid;
  /** The height field as typed. */
  height: string;
  drafts: RegionDraft[];
  /** «لا يتأثر أي جزء من جسمي»: regions []. */
  none: boolean;
  flags: Partial<RomIntakeFlags>;
  /** The answers of the condition questions (the first step). */
  fill: FillDraft;
  /** The condition answers now on the map (JSON of AutoFillAnswer[]), null before any. */
  filled: string | null;
  /** Every condition question has its answer (the first step can go on). */
  fillReady: boolean;
  /** The person confirmed the parts filled from the condition («هذه المناطق صحيحة»). */
  confirmed: boolean;
  /** The spinal cord injury is at neck level (sitting balance is then no without asking). */
  sciNeck: boolean;
  /** Suggestions the person added. */
  used: string[];
}

export interface IntakeV7Context {
  conditions: readonly string[];
  mobility: string;
}

/**
 * What each answer of a condition question means, in the order of the data's answers (parity
 * tested against ROM_DATA.conditionAutoMap).
 */
export const FILL_ANSWERS = {
  stroke: ["right", "left"],
  cerebral_palsy: ["one_side", "both_legs", "all_limbs"],
  ms: ["right_arm", "left_arm", "right_leg", "left_leg"],
  parkinsons: [true, false],
  sci_complete: ["neck", "back"],
  sci_incomplete: ["neck", "back"],
  lower_limb_unilateral: ["below_knee", "above_knee"],
  upper_limb_unilateral: ["below_elbow", "above_elbow"],
} as const;
type FillCondition = keyof typeof FILL_ANSWERS;
const isFillCondition = (c: string): c is FillCondition => c in FILL_ANSWERS;

/**
 * The condition questions with answers to tap. Arthritis has none (its question titles the map), and
 * Parkinson's is not asked (D-034 item 5): both of its answers fill the same map, which the person
 * then confirms on the map itself.
 */
export function fillQuestions(conditions: readonly string[]) {
  return autoFillQuestions(conditions).filter(
    (q): q is typeof q & { condition: Exclude<FillCondition, "parkinsons"> } =>
      q.answers.length > 0 && isFillCondition(q.condition) && q.condition !== "parkinsons",
  );
}

/** The condition answers, or null while a question has none. Parkinson's fills its map without asking. */
export function fillAnswers(fill: FillDraft, conditions: readonly string[]): AutoFillAnswer[] | null {
  const out: AutoFillAnswer[] = [];
  for (const { condition } of autoFillQuestions(conditions)) {
    if (!isFillCondition(condition)) continue;
    if (condition === "stroke") {
      if (!fill.stroke) return null;
      out.push({ condition, weakerSide: fill.stroke });
    } else if (condition === "cerebral_palsy") {
      const c = fill.cerebral_palsy;
      if (!c?.pattern) return null;
      if (c.pattern === "one_side") {
        if (!c.side) return null;
        out.push({ condition, pattern: "one_side", side: c.side });
      } else out.push({ condition, pattern: c.pattern });
    } else if (condition === "ms") {
      if (!fill.ms?.length) return null;
      out.push({ condition, limbs: [...fill.ms] });
    } else if (condition === "parkinsons") {
      out.push({ condition, confirmed: true });
    } else if (condition === "sci_complete" || condition === "sci_incomplete") {
      const level = fill[condition];
      if (!level) return null;
      out.push({ condition, level });
    } else if (condition === "lower_limb_unilateral") {
      const l = fill.lower_limb_unilateral;
      if (!l?.side || !l.level) return null;
      out.push({ condition, side: l.side, level: l.level });
    } else {
      const u = fill.upper_limb_unilateral;
      if (!u?.side || !u.level) return null;
      out.push({ condition, side: u.side, level: u.level });
    }
  }
  return out;
}

const SIDES = ["right", "left"] as const;
const MS_LIMBS = FILL_ANSWERS.ms;
/** Every answer a condition question can have, for reading the answers back from a saved map. */
function candidates(condition: Exclude<FillCondition, "parkinsons">): FillDraft[] {
  switch (condition) {
    case "stroke":
      return SIDES.map((stroke) => ({ stroke }));
    case "cerebral_palsy":
      return [
        { cerebral_palsy: { pattern: "all_limbs" } },
        ...SIDES.map((side) => ({ cerebral_palsy: { pattern: "one_side" as const, side } })),
        { cerebral_palsy: { pattern: "both_legs" } },
      ];
    case "ms":
      // Every non empty set of limbs.
      return Array.from({ length: 15 }, (_, i) => ({
        ms: MS_LIMBS.filter((_, b) => ((i + 1) >> b) & 1),
      }));
    case "sci_complete":
    case "sci_incomplete":
      return (["neck", "back"] as const).map((level) => ({ [condition]: level }));
    case "lower_limb_unilateral":
    case "upper_limb_unilateral":
      return SIDES.flatMap((side) =>
        FILL_ANSWERS[condition].map((level) => ({ [condition]: { side, level } })),
      );
  }
}

/**
 * The condition answers a saved map was filled from (editing a saved intake). For each question, the
 * answer that fits the map best: the most of its parts on the map with their problem types, less those
 * missing (a part the person took off still fits). A question no answer fits stays open, and is asked
 * again.
 */
export function inferFill(saved: readonly RegionEntry[], conditions: readonly string[]): FillDraft {
  const onMap = (e: RegionEntry, cell: BodyMapKey) =>
    saved.some(
      (s) =>
        entryCells(s).includes(cell) &&
        e.problems.every((p) => s.problems.includes(p)) &&
        (!e.limbLoss || s.limbLoss?.level === e.limbLoss.level),
    );
  let fill: FillDraft = {};
  for (const { condition } of fillQuestions(conditions)) {
    let best: { draft: FillDraft; score: number } | null = null;
    for (const draft of candidates(condition)) {
      const answers = fillAnswers(draft, [condition]);
      if (!answers) continue;
      const cells = autoFillRegions(answers).flatMap((e) => entryCells(e).map((cell) => onMap(e, cell)));
      const score = cells.filter(Boolean).length * 2 - cells.length;
      if (score > (best?.score ?? 0)) best = { draft, score };
    }
    if (best) fill = { ...fill, ...best.draft };
  }
  return fill;
}

const sciAtNeck = (answers: readonly AutoFillAnswer[]) =>
  answers.some(
    (a) => (a.condition === "sci_complete" || a.condition === "sci_incomplete") && a.level === "neck",
  );

/**
 * The map after the condition answers (D-034 item 5): once every question has its answer, the parts
 * they fill go on the map at once, origin "condition", beside the parts the person added; a changed
 * answer replaces the filled parts and asks for the confirmation again. The same state when nothing
 * changed.
 */
export function applyFill(ui: V7Ui, conditions: readonly string[]): V7Ui {
  const answers = fillAnswers(ui.fill, conditions);
  const key = answers === null ? null : JSON.stringify(answers);
  if (answers === null || key === ui.filled)
    return ui.fillReady === (answers !== null) ? ui : { ...ui, fillReady: answers !== null };
  const filled = autoFillRegions(answers);
  return {
    ...ui,
    drafts: mergeRegionDrafts(
      ui.drafts.filter((d) => d.origin !== "condition"),
      filled,
    ),
    none: filled.length ? false : ui.none,
    filled: key,
    fillReady: true,
    confirmed: false,
    sciNeck: sciAtNeck(answers),
  };
}

/** The step's state for an intake: its saved v7 answers, or a fresh start. */
export function initialUi(value: V7Answers, conditions: readonly string[]): V7Ui {
  const regions = value.regions;
  const fill = regions ? inferFill(regions, conditions) : {};
  const answers = fillAnswers(fill, conditions);
  return {
    sex: value.sex,
    walking: value.walking?.status,
    aid: value.walking?.status === "with_aid" ? value.walking.aid : undefined,
    height: value.heightCm !== undefined ? String(value.heightCm) : "",
    drafts: regions ? [...regions] : [],
    none: regions !== undefined && regions.length === 0,
    flags: value.romFlags ? { ...value.romFlags } : {},
    fill,
    // A saved map stays as it was saved: its answers count as already on the map, and confirmed.
    filled: regions && answers ? JSON.stringify(answers) : null,
    fillReady: answers !== null,
    confirmed: regions !== undefined,
    sciNeck: answers ? sciAtNeck(answers) : false,
    used: [],
  };
}

const SIDE_ORDER = ["axial", "both", "right", "left"];
/** Body order, right before left. */
function inBodyOrder<T extends Pick<RegionEntry, "region" | "side">>(list: readonly T[]): T[] {
  const rank = (e: T) => REGION_IDS.indexOf(e.region) * 4 + SIDE_ORDER.indexOf(e.side);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function flagContext(ui: V7Ui, ctx: IntakeV7Context): RomFlagContext {
  return {
    conditions: ctx.conditions,
    mobility: ctx.mobility,
    regions: ui.none ? [] : ui.drafts,
    sciNeck: ui.sciNeck,
    inflammatoryArthritis: ui.flags.inflammatoryArthritis,
  };
}

/**
 * The v1 support answer from the map (D-034 item 5, the question is no longer asked): the side of
 * the weakness when only one side has it, as a stroke on the right gives; otherwise none.
 */
export function supportOf(
  drafts: readonly Pick<RegionEntry, "region" | "side" | "problems">[],
): Intake["support"] {
  const sides = new Set<Side>();
  for (const d of drafts) {
    if (!limbOf(d.region) || !d.problems.includes("weakness")) continue;
    if (d.side === "right" || d.side === "both") sides.add("right");
    if (d.side === "left" || d.side === "both") sides.add("left");
  }
  return sides.size === 1 ? [...sides][0] : "none";
}

/** Whether the map waits for the person's confirmation of the parts filled from the condition. */
const awaitsConfirm = (ui: V7Ui) =>
  !ui.none && !ui.confirmed && ui.drafts.some((d) => d.origin === "condition");

/**
 * The intake's v7 fields from the step's state. A field is undefined until complete: the regions
 * while a part misses an answer or the filled parts wait for the person's confirmation, the flags while
 * a safety question is open. Mobility bed walks no (contract 2.2 rule 1). Height only for walkers; a
 * typed height that is out of range stays as typed, so validation keeps Continue closed. Support
 * follows the map (supportOf).
 */
export function stepAnswers(ui: V7Ui, ctx: IntakeV7Context): V7Answers {
  let regions: RegionEntry[] | undefined;
  if (ui.none) regions = [];
  else if (ui.drafts.length && !awaitsConfirm(ui)) {
    const finals = ui.drafts.map(finalizeRegion);
    if (finals.every((f): f is RegionEntry => f !== null)) regions = inBodyOrder(finals);
  }
  const walking: Walking | undefined =
    ctx.mobility === "bed"
      ? { status: "no" }
      : ui.walking === "with_aid"
        ? ui.aid
          ? { status: "with_aid", aid: ui.aid }
          : undefined
        : ui.walking
          ? { status: ui.walking }
          : undefined;
  const walks = walking !== undefined && walking.status !== "no";
  const heightCm = walks && ui.height.trim() !== "" ? Number(ui.height) : undefined;
  return {
    sex: ui.sex,
    regions,
    walking,
    heightCm,
    romFlags: finalizeRomFlags(ui.flags, flagContext(ui, ctx)) ?? undefined,
    support: supportOf(ui.none ? [] : ui.drafts),
  };
}

/** A suggestion shown beside the map. */
export interface Suggestion {
  key: string;
  region: RegionId;
  side: ReportRegion["side"];
  problems: ProblemType[];
  origin: "report" | "person";
}

const PAIN_REGION = Object.fromEntries(
  Object.entries(REGION_PAIN_IDS).map(([region, id]) => [id, region]),
) as Record<string, RegionId>;

/**
 * The report's regions, plus its v1 pain areas no region covers (report), and the v1 pain areas of
 * an intake saved before v7 (person). The person adds each with a tap.
 */
export function suggestionsFor(
  report: { regions: ReportRegion[]; pain: string[] } | null,
  earlierPain: readonly string[],
) {
  const fromPain = (ids: readonly string[], origin: Suggestion["origin"], skip: readonly RegionId[]) =>
    ids
      .filter((id) => PAIN_REGION[id] && !skip.includes(PAIN_REGION[id]))
      .map((id): Suggestion => {
        const region = PAIN_REGION[id];
        const side = AXIAL_REGIONS.includes(region) ? "axial" : "unknown";
        return { key: `${origin}:${region}:${side}`, region, side, problems: ["pain"], origin };
      });
  const reported: Suggestion[] = report
    ? [
        ...report.regions.map((r): Suggestion => ({
          key: `report:${r.region}:${r.side}`,
          ...r,
          origin: "report",
        })),
        ...fromPain(
          report.pain,
          "report",
          report.regions.map((r) => r.region),
        ),
      ]
    : [];
  return { report: reported, earlier: fromPain(earlierPain, "person", []) };
}

/* ------------------------------------------------------------------ parts */

const copy = (lang: Lang, key: RomCopyKey) => romCopy(key)[lang];
const problemName = (lang: Lang, id: ProblemType) =>
  ROM_DATA.problemTypes.find((p) => p.id === id)?.[lang] ?? id;
/** A limb loss level as the condition question words it (conditionAutoMap). */
export function levelName(lang: Lang, level: LimbLossLevel): string {
  const row = ROM_DATA.conditionAutoMap.find(
    (r) => r.condition === (level.endsWith("knee") ? "lower_limb_unilateral" : "upper_limb_unilateral"),
  );
  return row?.answers[level.startsWith("below") ? 0 : 1]?.[lang] ?? level;
}
const sinceName = (lang: Lang, since: SinceBucket) => tV7(lang, `intake7.since.${since}`);
const listOf = (lang: Lang, items: string[]) =>
  lang === "ar"
    ? items.join(items.length < 3 ? " و" : "، و")
    : items.length < 3
      ? items.join(" and ")
      : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;

interface Option<T> {
  value: T;
  label: string;
}
const yesNo = (lang: Lang): Option<boolean>[] => [
  { value: true, label: copy(lang, "ans_yes") },
  { value: false, label: copy(lang, "ans_no") },
];
const yesNoUnsure = (lang: Lang): Option<YesNoUnsure>[] => [
  { value: "yes", label: copy(lang, "ans_yes") },
  { value: "no", label: copy(lang, "ans_no") },
  { value: "unsure", label: copy(lang, "ans_unsure") },
];

/** One answer of a few, as pressable buttons. */
function Choices<T extends string | boolean>({
  legend,
  note,
  options,
  value,
  onPick,
}: {
  legend: ReactNode;
  note?: ReactNode;
  options: Option<T>[];
  value: T | undefined;
  onPick(v: T): void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {note}
      <div className="intake-choices">
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            aria-pressed={value === o.value}
            className={value === o.value ? "selected" : ""}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Several answers, as tick buttons. */
function Checks<T extends string>({
  legend,
  options,
  values,
  onToggle,
}: {
  legend: ReactNode;
  options: Option<T>[];
  values: readonly T[];
  onToggle(v: T): void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="intake-choices">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              aria-pressed={on}
              className={on ? "selected" : ""}
              onClick={() => onToggle(o.value)}
            >
              <span className="choice-check">{on && <Icon name="check" size={12} />}</span>
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const toggle = <T,>(list: readonly T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/**
 * The Achilles answer of an ankle surgery without the injury type: a yes adds the injury type with
 * injury.achilles (a torn tendon is an injury, and RegionEntry keeps the answer there; its when starts
 * at the surgery's), a no stays in the form (contract change log, A2 and A4-6).
 */
export function answerAchilles(draft: RegionDraft, yes: boolean): RegionDraft {
  if (!yes) return { ...draft, achillesAnswer: false };
  return {
    ...draft,
    achillesAnswer: undefined,
    problems: PROBLEM_TYPES.filter((p) => p === "injury" || draft.problems.includes(p)),
    injury: { since: draft.injury?.since ?? draft.surgery?.since, achilles: true },
  };
}

/** The follow up question of one region. */
function RegionQuestion({
  lang,
  q,
  draft,
  onChange,
}: {
  lang: Lang;
  q: RegionQuestionId;
  draft: RegionDraft;
  onChange(d: RegionDraft): void;
}) {
  const injury = draft.injury ?? {};
  const surgery = draft.surgery ?? {};
  const setInjury = (patch: Partial<NonNullable<RegionDraft["injury"]>>) =>
    onChange({ ...draft, injury: { ...injury, ...patch } });
  const setSurgery = (patch: Partial<NonNullable<RegionDraft["surgery"]>>) =>
    onChange({ ...draft, surgery: { ...surgery, ...patch } });
  const since = SINCE_BUCKETS.map((s) => ({ value: s, label: sinceName(lang, s) }));
  switch (q) {
    case "injury_when":
      return (
        <Choices
          legend={copy(lang, "injury_when")}
          options={since}
          value={injury.since}
          onPick={(s) => setInjury({ since: s })}
        />
      );
    case "achilles_ask":
      // After an ankle surgery without the injury type, a yes adds the injury type with the Achilles
      // answer (a torn tendon is an injury; RegionEntry keeps the answer there), a no stays in the form.
      if (!draft.problems.includes("injury"))
        return (
          <Choices
            legend={copy(lang, "achilles_ask")}
            options={yesNo(lang)}
            value={draft.achillesAnswer}
            onPick={(v) => onChange(answerAchilles(draft, v))}
          />
        );
      return (
        <Choices
          legend={copy(lang, "achilles_ask")}
          options={yesNo(lang)}
          value={injury.achilles}
          onPick={(v) => setInjury({ achilles: v })}
        />
      );
    case "surgery_when":
      return (
        <Choices
          legend={copy(lang, "surgery_when")}
          options={since}
          value={surgery.since}
          onPick={(s) => setSurgery({ since: s })}
        />
      );
    case "surgery_cleared":
      return (
        <Choices
          legend={copy(lang, "surgery_cleared")}
          options={yesNoUnsure(lang)}
          value={surgery.cleared}
          onPick={(v) => setSurgery({ cleared: v })}
        />
      );
    case "surgery_avoid": {
      const avoid = surgery.avoid;
      return (
        <fieldset>
          <legend>{copy(lang, "surgery_avoid")}</legend>
          <div className="intake-choices">
            <button
              type="button"
              aria-pressed={avoid !== undefined && avoid.length === 0}
              className={avoid !== undefined && avoid.length === 0 ? "selected" : ""}
              onClick={() => setSurgery({ avoid: [] })}
            >
              {copy(lang, "ans_no")}
            </button>
            {REGION_MOVEMENTS[draft.region].map((id: RomMovementId) => {
              const on = avoid?.includes(id) ?? false;
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={on}
                  className={on ? "selected" : ""}
                  onClick={() => {
                    const next = toggle(avoid ?? [], id);
                    setSurgery({ avoid: next.length ? next : undefined });
                  }}
                >
                  <span className="choice-check">{on && <Icon name="check" size={12} />}</span>
                  {movementDef(id).name[lang]}
                </button>
              );
            })}
          </div>
        </fieldset>
      );
    }
    case "hip_replacement":
      return (
        <Choices
          legend={tV7(lang, "intake7.hipReplacement")}
          options={yesNo(lang)}
          value={surgery.hipReplacement}
          onPick={(v) => setSurgery({ hipReplacement: v })}
        />
      );
    case "hip_avoid_ask":
      return (
        <Checks
          legend={copy(lang, "hip_avoid_ask")}
          options={HIP_AVOID_IDS.map((id) => ({ value: id, label: copy(lang, `hip_avoid_${id}`) }))}
          values={surgery.hipAvoid ?? []}
          onToggle={(id: HipAvoidId) => {
            const list = surgery.hipAvoid ?? [];
            const next =
              id === "none"
                ? list.includes("none")
                  ? []
                  : ["none" as const]
                : toggle(
                    list.filter((x) => x !== "none"),
                    id,
                  );
            setSurgery({ hipAvoid: next });
          }}
        />
      );
    case "surgery_stretch_ask":
      return (
        <Choices
          legend={copy(lang, "surgery_stretch_ask")}
          options={yesNoUnsure(lang)}
          value={surgery.stretchAllowed}
          onPick={(v) => setSurgery({ stretchAllowed: v })}
        />
      );
    case "surgery_load_ask":
      return (
        <Choices
          legend={copy(lang, "surgery_load_ask")}
          options={yesNoUnsure(lang)}
          value={surgery.loadAllowed}
          onPick={(v) => setSurgery({ loadAllowed: v })}
        />
      );
    case "limb_loss_level": {
      const limb = limbOf(draft.region);
      if (!limb) return null;
      return (
        <Choices
          legend={tV7(lang, "intake7.limbLossLevel")}
          options={LIMB_LOSS_LEVELS[limb].map((level) => ({ value: level, label: levelName(lang, level) }))}
          value={draft.limbLoss?.level}
          onPick={(level) => onChange({ ...draft, limbLoss: { level } })}
        />
      );
    }
  }
}

/** The quick choice of a part the person adds: the most common first (D-034 item 5). */
const QUICK_PROBLEMS: readonly ProblemType[] = ["pain", "stiffness", "weakness", "injury", "after_surgery"];
const quickName = (lang: Lang, p: ProblemType) => tV7(lang, `intake7.problem.${p}`);

/**
 * A part the person added (or a report suggestion): one quick choice of the problem, and the injury
 * or surgery questions only when that problem is chosen. Parts filled from the condition have no card.
 */
function RegionCard({
  lang,
  draft,
  showMissing,
  onChange,
  onRemove,
}: {
  lang: Lang;
  draft: RegionDraft;
  showMissing: boolean;
  onChange(d: RegionDraft): void;
  onRemove(): void;
}) {
  // Limb loss comes from the condition; a chosen one stays visible so it can be unticked.
  const problems: ProblemType[] = [
    ...QUICK_PROBLEMS,
    ...(draft.problems.includes("limb_loss") ? (["limb_loss"] as const) : []),
  ];
  const title = entryLabel(lang, draft.region, draft.side);
  const complete = finalizeRegion(draft) !== null;
  return (
    <article
      className="intake7-card"
      data-origin={draft.origin}
      data-region={`${draft.region}:${draft.side}`}
      data-complete={complete}
    >
      <header>
        <h4>{title}</h4>
        <button
          type="button"
          className="intake7-remove"
          aria-label={`${tV7(lang, "intake7.map.remove")}: ${title}`}
          onClick={onRemove}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      {showMissing && !complete && (
        <p className="intake7-missing" role="alert">
          {tV7(lang, "intake7.needsAnswers")}
        </p>
      )}
      <fieldset className="intake7-quick">
        <legend>{tV7(lang, "intake7.map.added")}</legend>
        <div className="intake7-chips">
          {problems.map((p) => {
            const on = draft.problems.includes(p);
            return (
              <button
                type="button"
                key={p}
                data-problem={p}
                aria-pressed={on}
                className={on ? "selected" : ""}
                onClick={() =>
                  onChange({
                    ...draft,
                    problems: PROBLEM_TYPES.filter((x) => toggle(draft.problems, p).includes(x)),
                  })
                }
              >
                {quickName(lang, p)}
              </button>
            );
          })}
        </div>
      </fieldset>
      {regionQuestions(draft).map((q) => (
        <RegionQuestion key={q} lang={lang} q={q} draft={draft} onChange={onChange} />
      ))}
    </article>
  );
}

/** The condition questions (the first step): the side or the pattern, which fill the map at once. */
function FillQuestions({
  lang,
  ui,
  conditions,
  onUi,
}: {
  lang: Lang;
  ui: V7Ui;
  conditions: readonly string[];
  onUi(ui: V7Ui): void;
}) {
  const fill = ui.fill;
  const setFill = (patch: FillDraft) => onUi(applyFill({ ...ui, fill: { ...fill, ...patch } }, conditions));
  const sides = (): Option<Side>[] => [
    { value: "right", label: copy(lang, "side_right") },
    { value: "left", label: copy(lang, "side_left") },
  ];
  const questions = fillQuestions(conditions);
  if (!questions.length) return null;
  return (
    <section className="intake7-block intake7-fill-ask" aria-label={tV7(lang, "intake7.conditions.title")}>
      {questions.map((q) => {
        const ask = q.ask[lang];
        const answer = (i: number) => q.answers[i][lang];
        switch (q.condition) {
          case "stroke":
            return (
              <Choices
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS.stroke.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.stroke}
                onPick={(v) => setFill({ stroke: v })}
              />
            );
          case "cerebral_palsy": {
            const c = fill.cerebral_palsy ?? {};
            return (
              <div key={q.condition}>
                <Choices
                  legend={ask}
                  options={FILL_ANSWERS.cerebral_palsy.map((v, i) => ({ value: v, label: answer(i) }))}
                  value={c.pattern}
                  onPick={(v) => setFill({ cerebral_palsy: { ...c, pattern: v } })}
                />
                {c.pattern === "one_side" && (
                  <Choices
                    legend={copy(lang, "side_ask")}
                    options={sides()}
                    value={c.side}
                    onPick={(v) => setFill({ cerebral_palsy: { ...c, side: v } })}
                  />
                )}
              </div>
            );
          }
          case "ms":
            return (
              <Checks
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS.ms.map((v, i) => ({ value: v, label: answer(i) }))}
                values={fill.ms ?? []}
                onToggle={(v) => setFill({ ms: toggle(fill.ms ?? [], v) })}
              />
            );
          case "sci_complete":
          case "sci_incomplete":
            return (
              <Choices
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS[q.condition].map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill[q.condition]}
                onPick={(v) => setFill({ [q.condition]: v })}
              />
            );
          case "lower_limb_unilateral":
            return (
              <LimbFill
                key={q.condition}
                lang={lang}
                ask={ask}
                levels={FILL_ANSWERS.lower_limb_unilateral.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.lower_limb_unilateral ?? {}}
                onChange={(v) => setFill({ lower_limb_unilateral: v })}
              />
            );
          case "upper_limb_unilateral":
            return (
              <LimbFill
                key={q.condition}
                lang={lang}
                ask={ask}
                levels={FILL_ANSWERS.upper_limb_unilateral.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.upper_limb_unilateral ?? {}}
                onChange={(v) => setFill({ upper_limb_unilateral: v })}
              />
            );
        }
      })}
    </section>
  );
}

/** The limb loss question of a condition: which side, then the level. */
function LimbFill<L extends string>({
  lang,
  ask,
  levels,
  value,
  onChange,
}: {
  lang: Lang;
  ask: string;
  levels: Option<L>[];
  value: { side?: Side; level?: L };
  onChange(v: { side?: Side; level?: L }): void;
}) {
  return (
    <div>
      <Choices
        legend={ask}
        note={<p className="field-help">{copy(lang, "side_ask")}</p>}
        options={[
          { value: "right" as const, label: copy(lang, "side_right") },
          { value: "left" as const, label: copy(lang, "side_left") },
        ]}
        value={value.side}
        onPick={(side) => onChange({ ...value, side })}
      />
      <Choices
        legend={tV7(lang, "intake7.limbLossLevel")}
        options={levels}
        value={value.level}
        onPick={(level) => onChange({ ...value, level })}
      />
    </div>
  );
}

/**
 * The parts filled from the condition, in a few lines: each problem and side with its parts, for
 * example «ضعف في الجهة اليمنى: الكتف، والمرفق، ...» or "Stiffness: neck, and back or trunk".
 */
export function fillSummary(lang: Lang, drafts: readonly RegionDraft[]): string[] {
  const groups = new Map<string, { side: RegionSide; problems: ProblemType[]; regions: RegionId[] }>();
  for (const d of inBodyOrder(drafts.filter((x) => x.origin === "condition"))) {
    const key = `${d.side}|${d.problems.join("+")}`;
    const g = groups.get(key) ?? { side: d.side, problems: d.problems, regions: [] };
    g.regions.push(d.region);
    groups.set(key, g);
  }
  const lower = (text: string, i = 1) => (lang === "en" && i > 0 ? text.toLowerCase() : text);
  return [...groups.values()].map((g) => {
    const problems = listOf(
      lang,
      g.problems.map((p, i) => lower(quickName(lang, p), i)),
    );
    const regions = listOf(
      lang,
      g.regions.map((r) => lower(regionName(lang, r))),
    );
    return g.side === "axial"
      ? tV7(lang, "intake7.map.groupAxial", { problems, regions })
      : tV7(lang, "intake7.map.groupSide", {
          problems,
          side: tV7(lang, `intake7.map.onSide.${g.side as Exclude<RegionSide, "axial">}`),
          regions,
        });
  });
}

/** One suggestion: added at once with its side, or after the person picks the side. */
function SuggestionRow({
  lang,
  s,
  onAdd,
}: {
  lang: Lang;
  s: Suggestion;
  onAdd(side: RegionDraft["side"]): void;
}) {
  const [picking, setPicking] = useState(false);
  const name = s.side === "unknown" ? regionName(lang, s.region) : entryLabel(lang, s.region, s.side);
  const what = s.problems.map((p) => problemName(lang, p)).join(lang === "ar" ? "، " : ", ");
  const sides: { value: "right" | "left" | "both"; label: string }[] = [
    { value: "right", label: copy(lang, "side_right") },
    { value: "left", label: copy(lang, "side_left") },
    { value: "both", label: copy(lang, "side_both") },
  ];
  return (
    <li>
      <span>
        <b>{name}</b>
        {what && <> · {what}</>}
      </span>
      {picking ? (
        <span className="intake-choices" role="group" aria-label={copy(lang, "side_ask")}>
          {sides.map((o) => (
            <button type="button" key={o.value} onClick={() => onAdd(o.value)}>
              {o.label}
            </button>
          ))}
        </span>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={() => (s.side === "unknown" ? setPicking(true) : onAdd(s.side))}
        >
          {tV7(lang, "intake7.suggest.add")}
        </button>
      )}
    </li>
  );
}

/** The safety questions (RomIntakeFlags). */
function FlagQuestion({
  lang,
  id,
  side,
  flags,
  onFlags,
}: {
  lang: Lang;
  id: RomFlagQuestionId;
  side?: Side;
  flags: Partial<RomIntakeFlags>;
  onFlags(f: Partial<RomIntakeFlags>): void;
}) {
  const legend = copy(lang, id);
  const set = (patch: Partial<RomIntakeFlags>) => onFlags({ ...flags, ...patch });
  switch (id) {
    case "bones_ask":
      return (
        <Choices
          legend={legend}
          options={yesNo(lang)}
          value={flags.osteoporosis}
          onPick={(v) => set({ osteoporosis: v })}
        />
      );
    case "neck_ask":
      return (
        <Choices
          legend={legend}
          options={yesNo(lang)}
          value={flags.neckCaution}
          onPick={(v) => set({ neckCaution: v })}
        />
      );
    case "arthritis_type_ask":
      return (
        <Choices
          legend={legend}
          options={yesNoUnsure(lang)}
          value={flags.inflammatoryArthritis}
          onPick={(v) => set({ inflammatoryArthritis: v })}
        />
      );
    case "neck_cleared_ask":
      return (
        <Choices
          legend={legend}
          options={yesNo(lang)}
          value={flags.neckCleared}
          onPick={(v) => set({ neckCleared: v })}
        />
      );
    case "transfer_chair_ask":
      return (
        <Choices
          legend={legend}
          options={yesNo(lang)}
          value={flags.transferChair}
          onPick={(v) => set({ transferChair: v })}
        />
      );
    case "sit_unsupported_ask":
      return (
        <Choices
          legend={legend}
          options={yesNoUnsure(lang)}
          value={flags.sitUnsupported}
          onPick={(v) => set({ sitUnsupported: v })}
        />
      );
    case "foot_lift_ask":
      if (!side) return null;
      return (
        <Choices
          legend={legend}
          note={
            <p className="intake7-foot">
              {tV7(lang, side === "right" ? "intake7.foot.right" : "intake7.foot.left")}
            </p>
          }
          options={yesNo(lang)}
          value={flags.footLift?.[side]}
          onPick={(v) => set({ footLift: { ...flags.footLift, [side]: v } })}
        />
      );
  }
}

/* ------------------------------------------------------------------ the steps */

/** What both v7 parts of the form share: the working state and the intake's v7 fields. */
interface PartProps {
  lang: Lang;
  /** The answers of the form so far that the v7 parts read: conditions and mobility. */
  context: IntakeV7Context;
  /** The intake's v7 fields (the saved answers when editing). */
  value: V7Answers;
  /** The working state, kept by IntakeForm; null before the first part ran. */
  ui: V7Ui | null;
  onUi(ui: V7Ui): void;
  onChange(v: V7Answers): void;
}

/**
 * The working state of a part: the kept one (or a fresh one) with the condition answers applied. It
 * is stored back when it differs (the first visit, a condition ticked or unticked), and the intake's
 * v7 fields follow it on every change.
 */
function usePart({ context, value, ui: kept, onUi, onChange }: PartProps): V7Ui {
  const ui = applyFill(kept ?? initialUi(value, context.conditions), context.conditions);
  useEffect(() => {
    if (ui !== kept) onUi(ui);
  });
  const answers = stepAnswers(ui, context);
  const answersKey = JSON.stringify(answers);
  useEffect(() => {
    onChange(answers);
  }, [answersKey]);
  return ui;
}

export interface IntakeV7AboutProps extends PartProps {
  /** IntakeForm's own fields, placed by this part: the age, the conditions and mobility. */
  age: ReactNode;
  conditionField: ReactNode;
  mobilityField: ReactNode;
}

/**
 * The first step of a v7 form (D-034 item 5), «حالتك وحركتك»: the age with sex, the conditions with
 * their side or pattern (which fill the body map), how the person exercises, and walking with its aid
 * and an optional height.
 */
export function IntakeV7About(props: IntakeV7AboutProps) {
  const { lang, context, onUi, age, conditionField, mobilityField } = props;
  const c = labels(lang);
  const ui = usePart(props);
  const set = (patch: Partial<V7Ui>) => onUi({ ...ui, ...patch });
  const walks = ui.walking === "with_aid" || ui.walking === "without_aid";
  const heightValid =
    ui.height.trim() === "" ||
    (Number.isInteger(Number(ui.height)) &&
      Number(ui.height) >= HEIGHT_CM.min &&
      Number(ui.height) <= HEIGHT_CM.max);
  return (
    <div className="intake7 intake7-about">
      <div className="intake7-who">
        {age}
        <Choices
          legend={tV7(lang, "intake7.sex.legend")}
          options={[
            { value: "male" as const, label: tV7(lang, "intake7.sex.male") },
            { value: "female" as const, label: tV7(lang, "intake7.sex.female") },
          ]}
          value={ui.sex}
          onPick={(sex) => set({ sex })}
        />
      </div>
      {conditionField}
      <FillQuestions lang={lang} ui={ui} conditions={context.conditions} onUi={onUi} />
      {mobilityField}
      {context.mobility !== "bed" && (
        <Choices
          legend={tV7(lang, "intake7.walking.legend")}
          options={(["no", "with_aid", "without_aid"] as const).map((s) => ({
            value: s,
            label: tV7(lang, `intake7.walking.${s}`),
          }))}
          value={ui.walking}
          onPick={(walking) => set({ walking })}
        />
      )}
      {context.mobility !== "bed" && ui.walking === "with_aid" && (
        <Choices
          legend={tV7(lang, "intake7.walking.aidLegend")}
          options={walkingAids.map((aid) => ({ value: aid, label: tV7(lang, `intake7.walking.${aid}`) }))}
          value={ui.aid}
          onPick={(aid) => set({ aid })}
        />
      )}
      {context.mobility !== "bed" && walks && (
        <div className="intake7-height">
          <label className="field">
            <span>
              {tV7(lang, "intake7.height.label")} <small>{c.optional}</small>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={HEIGHT_CM.min}
              max={HEIGHT_CM.max}
              value={ui.height}
              aria-invalid={!heightValid}
              onChange={(e) => set({ height: e.target.value })}
            />
          </label>
          <p className="field-help">{tV7(lang, "intake7.height.help")}</p>
          {!heightValid && (
            <p className="form-error" role="alert">
              {tV7(lang, "intake7.height.invalid")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export interface IntakeV7Props extends PartProps {
  /** The report reading's suggestions (AZM_V7 servers) and its v1 pain areas. */
  report?: { regions: ReportRegion[]; pain: string[] } | null;
  /** The v1 pain areas of an intake saved before v7, offered on the map. */
  earlierPain?: readonly string[];
  /** After a Continue that could not go on: name what still needs an answer. */
  showMissing?: boolean;
  /** IntakeForm's own safety questions, first in the safety part: warning signs, clearance, recent change, restrictions. */
  safety?: ReactNode;
}

/**
 * The second step of a v7 form, «جسمك وسلامتك»: the body map, filled from the condition (the person
 * confirms it, or taps a part to add or take it off; a part added by hand gets one quick choice of
 * its problem), then the safety questions.
 */
export default function IntakeV7(props: IntakeV7Props) {
  const { lang, context, onUi, report = null, earlierPain = [], showMissing = false, safety } = props;
  const ui = usePart(props);
  const set = (patch: Partial<V7Ui>) => onUi({ ...ui, ...patch });
  const cells = new Set(ui.drafts.flatMap(entryCells));
  const covered = (s: Suggestion) =>
    s.side === "unknown"
      ? ui.drafts.some((d) => d.region === s.region)
      : entryCells({ region: s.region, side: s.side }).every((k) => cells.has(k));
  const offers = suggestionsFor(report, earlierPain);
  const open = (list: Suggestion[]) => list.filter((s) => !ui.used.includes(s.key) && !covered(s));
  const add = (s: Suggestion, side: RegionDraft["side"]) =>
    set({
      drafts: mergeRegionDrafts(ui.drafts, [
        { region: s.region, side, problems: [...s.problems], origin: s.origin },
      ]),
      none: false,
      used: [...ui.used, s.key],
    });
  const updateDraft = (at: RegionDraft, next: RegionDraft) =>
    set({ drafts: ui.drafts.map((d) => (d.region === at.region && d.side === at.side ? next : d)) });
  const removeDraft = (at: RegionDraft) =>
    set({ drafts: ui.drafts.filter((d) => !(d.region === at.region && d.side === at.side)) });
  const mapTitle = context.conditions.includes("arthritis")
    ? (ROM_DATA.conditionAutoMap.find((r) => r.condition === "arthritis")?.ask[lang] ??
      copy(lang, "region_ask"))
    : copy(lang, "region_ask");
  const summary = fillSummary(lang, ui.drafts);
  // Each part the person added (or took from the report) has its card; a filled part only when it misses an answer.
  const cards = inBodyOrder(ui.drafts).filter((d) => d.origin !== "condition" || finalizeRegion(d) === null);
  const flagQuestions = romFlagQuestions(flagContext(ui, context));
  return (
    <div className="intake7">
      <p className="intake7-intro">{copy(lang, "intro")}</p>
      <section className="intake7-mapsection" aria-labelledby="intake7-map-title">
        <h3 id="intake7-map-title">{mapTitle}</h3>
        <p className="field-help">{tV7(lang, "intake7.map.help")}</p>
        <div className="intake7-map">
          <BodyMap
            mode="edit"
            lang={lang}
            value={ui.drafts.map((d) => ({
              region: d.region,
              side: d.side,
              problems: d.problems,
              origin: d.origin,
            }))}
            onChange={(next) => set({ drafts: syncDrafts(ui.drafts, next), none: false })}
          />
          <div className="intake7-cards">
            {summary.length > 0 && (
              <section className="intake7-fill" data-confirmed={ui.confirmed} aria-live="polite">
                <p className="intake7-fill-kicker">{tV7(lang, "intake7.map.fromCondition")}</p>
                <ul>
                  {summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="intake7-confirm"
                  aria-pressed={ui.confirmed}
                  onClick={() => set({ confirmed: !ui.confirmed })}
                >
                  <span className="choice-check">{ui.confirmed && <Icon name="check" size={12} />}</span>
                  {tV7(lang, "intake7.map.confirm")}
                </button>
                {showMissing && awaitsConfirm(ui) && (
                  <p className="intake7-missing" role="alert">
                    {tV7(lang, "intake7.map.confirmNeeded")}
                  </p>
                )}
              </section>
            )}
            {(
              [
                ["report", open(offers.report)],
                ["earlier", open(offers.earlier)],
              ] as const
            ).map(([kind, list]) =>
              list.length ? (
                <div className="intake7-suggest" key={kind}>
                  <h4>
                    {tV7(lang, kind === "report" ? "intake7.suggest.report" : "intake7.suggest.earlier")}
                  </h4>
                  <ul>
                    {list.map((s) => (
                      <SuggestionRow key={s.key} lang={lang} s={s} onAdd={(side) => add(s, side)} />
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            {cards.map((d) => (
              <RegionCard
                key={`${d.region}:${d.side}`}
                lang={lang}
                draft={d}
                showMissing={showMissing}
                onChange={(next) => updateDraft(d, next)}
                onRemove={() => removeDraft(d)}
              />
            ))}
            {ui.drafts.length === 0 && (
              <div className="intake-choices intake7-none">
                <button
                  type="button"
                  aria-pressed={ui.none}
                  className={ui.none ? "selected" : ""}
                  onClick={() => set({ none: !ui.none })}
                >
                  <span className="choice-check">{ui.none && <Icon name="check" size={12} />}</span>
                  {tV7(lang, "intake7.map.none")}
                </button>
                {showMissing && !ui.none && (
                  <p className="intake7-missing" role="alert">
                    {tV7(lang, "intake7.map.emptyNeeded")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="intake7-safety" aria-labelledby="intake7-safety-title">
        <h3 id="intake7-safety-title">{tV7(lang, "intake7.safety.title")}</h3>
        {safety}
        {flagQuestions.map((q) => (
          <FlagQuestion
            key={q.side ? `${q.id}:${q.side}` : q.id}
            lang={lang}
            id={q.id}
            side={q.side}
            flags={ui.flags}
            onFlags={(flags) => set({ flags })}
          />
        ))}
      </section>
    </div>
  );
}

/**
 * The map's next cells, keeping each region's answers: a cell still on the map keeps its draft, a
 * both entry the person narrowed keeps its answers on the side left, a new cell starts empty.
 */
export function syncDrafts(drafts: readonly RegionDraft[], next: readonly RegionEntry[]): RegionDraft[] {
  return next.map((e) => {
    const same = drafts.find((d) => d.region === e.region && d.side === e.side);
    if (same) return same;
    const narrowed = drafts.find((d) => d.region === e.region && d.side === "both" && e.side !== "both");
    if (narrowed) return { ...narrowed, side: e.side };
    return { region: e.region, side: e.side, problems: [], origin: "person" };
  });
}

/** The name of a step of a v7 form, for the intake's step list. */
export function IntakeV7StepName({ lang, kind }: { lang: Lang; kind: "about" | "body" | "goal" }) {
  return <>{tV7(lang, `intake7.steps.${kind}`)}</>;
}

/**
 * The consent line of a v7 form (D-034 item 4): the health answers, and the movement and walk results
 * the check keeps; the video never leaves the phone. It covers the check, which no longer has its own
 * consent page.
 */
export function IntakeV7Consent({ lang }: { lang: Lang }) {
  return <>{tV7(lang, "intake7.consent")}</>;
}

/**
 * D-032 item 3: the health form's last button when the movement check comes next (a new profile, or a
 * person whose program still waits for the check): «التالي: قياس حركتك».
 */
export function IntakeV7NextCheck({ lang }: { lang: Lang }) {
  return <>{tV7(lang, "intake7.nextCheck")}</>;
}

/** The v7 rows of an intake's answers (the My condition page). */
export function IntakeV7Review({ lang, value }: { lang: Lang; value: V7Answers }) {
  const walking = value.walking;
  const walkingText = !walking
    ? ""
    : walking.status === "with_aid"
      ? `${tV7(lang, "intake7.walking.with_aid")}${lang === "ar" ? "، " : ", "}${tV7(lang, `intake7.walking.${walking.aid}`)}`
      : tV7(lang, `intake7.walking.${walking.status}`);
  const regions = value.regions ?? [];
  const regionText = regions.length
    ? regions
        .map(
          (e) =>
            `${entryLabel(lang, e.region, e.side)}: ${e.problems
              .map((p) => problemName(lang, p))
              .join(lang === "ar" ? "، " : ", ")}`,
        )
        .join("\n")
    : tV7(lang, "intake7.review.none");
  const rows: [string, string][] = [
    [tV7(lang, "intake7.review.sex"), value.sex ? tV7(lang, `intake7.sex.${value.sex}`) : ""],
    [tV7(lang, "intake7.review.walking"), walkingText],
    ...(value.heightCm !== undefined
      ? [
          [
            tV7(lang, "intake7.review.height"),
            tV7(lang, "intake7.review.heightValue", { cm: value.heightCm }),
          ] as [string, string],
        ]
      : []),
    [tV7(lang, "intake7.review.regions"), regionText],
  ];
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </>
  );
}
