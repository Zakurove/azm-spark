/**
 * The v7 part of the intake (product v7 contract 1.2 and 2.2): the "Your body" step. Sex, walking and
 * its aid, height for walkers, the condition questions that fill the body map (rom-protocol 2.3, the
 * person confirms), the body map with each region's problem types and follow up questions
 * (rom-protocol 2.2 and 6), the report's region suggestions (applied only by a tap), and the safety
 * questions of RomIntakeFlags.
 *
 * IntakeForm loads this module only in a VITE_V7 build (`import.meta.env.VITE_V7 === "1" ?
 * lazy(...) : null`), so a default build has none of it. The step keeps its working state (V7Ui) in IntakeForm, so it survives moving
 * between steps, and writes the intake's v7 fields (V7Answers) on every change: a field stays
 * undefined until its answers are complete, which keeps Continue closed. Clinical lines come from
 * the range data (romCopy, regions, problem types, movement names); the step's own lines are in the
 * intake7 namespace (tV7).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { labels } from "./platform-copy";
import Icon from "./Icon";
import { interpolate } from "../i18n";
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
  type HipAvoidId,
  type LimbLossLevel,
  type ProblemType,
  type RegionDraft,
  type RegionEntry,
  type RegionId,
  type RegionQuestionId,
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
export type V7Answers = Pick<Intake, "sex" | "regions" | "walking" | "heightCm" | "romFlags">;

type Side = "right" | "left";
type MsLimb = "right_arm" | "left_arm" | "right_leg" | "left_leg";
/** The condition answers while the person gives them (AutoFillAnswer once complete). */
export interface FillDraft {
  stroke?: Side;
  cerebral_palsy?: { pattern?: "one_side" | "both_legs" | "all_limbs"; side?: Side };
  ms?: MsLimb[];
  parkinsons?: boolean;
  sci_complete?: "neck" | "back";
  sci_incomplete?: "neck" | "back";
  lower_limb_unilateral?: { side?: Side; level?: "below_knee" | "above_knee" };
  upper_limb_unilateral?: { side?: Side; level?: "below_elbow" | "above_elbow" };
}

/** The step's working state, kept by IntakeForm. */
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
  fill: FillDraft;
  /** ask: the condition questions show; confirm: the fill is on the map, waiting for the person's yes. */
  fillStage: "ask" | "confirm" | "done";
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

/** The condition questions with answers to tap (arthritis has none: its question titles the map). */
export function fillQuestions(conditions: readonly string[]) {
  return autoFillQuestions(conditions).filter(
    (q): q is typeof q & { condition: FillCondition } => q.answers.length > 0 && q.condition in FILL_ANSWERS,
  );
}

/** The condition answers, or null while a question has none. */
export function fillAnswers(fill: FillDraft, conditions: readonly string[]): AutoFillAnswer[] | null {
  const out: AutoFillAnswer[] = [];
  for (const { condition } of fillQuestions(conditions)) {
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
      if (fill.parkinsons === undefined) return null;
      out.push({ condition, confirmed: fill.parkinsons });
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

/** The step's state for an intake: its saved v7 answers, or a fresh start. */
export function initialUi(value: V7Answers, conditions: readonly string[]): V7Ui {
  const regions = value.regions;
  const saved = regions !== undefined && regions.length > 0;
  return {
    sex: value.sex,
    walking: value.walking?.status,
    aid: value.walking?.status === "with_aid" ? value.walking.aid : undefined,
    height: value.heightCm !== undefined ? String(value.heightCm) : "",
    drafts: regions ? [...regions] : [],
    none: regions !== undefined && regions.length === 0,
    flags: value.romFlags ? { ...value.romFlags } : {},
    fill: {},
    fillStage: fillQuestions(conditions).length && !saved ? "ask" : "done",
    sciNeck: false,
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
 * The intake's v7 fields from the step's state. A field is undefined until complete: the regions
 * while a card misses an answer or the condition fill waits for the person's yes, the flags while a
 * safety question is open. Mobility bed walks no (contract 2.2 rule 1). Height only for walkers; a
 * typed height that is out of range stays as typed, so validation keeps Continue closed.
 */
export function stepAnswers(ui: V7Ui, ctx: IntakeV7Context): V7Answers {
  let regions: RegionEntry[] | undefined;
  if (ui.none) regions = [];
  else if (ui.drafts.length && ui.fillStage !== "confirm") {
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
    ? items.join("، و")
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

/** One region on the map: its problem types and their questions. */
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
  const oneSide = draft.side === "left" || draft.side === "right";
  // Limb loss on one side of a limb only; a chosen one stays visible so it can be unticked.
  const problems = PROBLEM_TYPES.filter(
    (p) => p !== "limb_loss" || (oneSide && limbOf(draft.region)) || draft.problems.includes(p),
  );
  const title = entryLabel(lang, draft.region, draft.side);
  const complete = finalizeRegion(draft) !== null;
  // A complete card (a fill, a saved answer) starts folded to one line; an open one has its questions.
  const [open, setOpen] = useState(!complete);
  const folded = complete && !open;
  return (
    <article
      className="intake7-card"
      data-origin={draft.origin}
      data-region={`${draft.region}:${draft.side}`}
      data-folded={folded}
    >
      <header>
        <h4>{title}</h4>
        <span className="intake7-card-actions">
          {complete && (
            <button
              type="button"
              className="text-button"
              aria-expanded={!folded}
              onClick={() => setOpen(folded)}
            >
              {tV7(lang, folded ? "intake7.map.change" : "intake7.map.done")}
            </button>
          )}
          <button type="button" className="text-button" onClick={onRemove}>
            {tV7(lang, "intake7.map.remove")}
          </button>
        </span>
      </header>
      {folded ? (
        <p className="intake7-summary">
          {draft.problems.map((p) => problemName(lang, p)).join(lang === "ar" ? "، " : ", ")}
        </p>
      ) : (
        <>
          {showMissing && !complete && (
            <p className="intake7-missing" role="alert">
              {tV7(lang, "intake7.needsAnswers")}
            </p>
          )}
          <Checks
            legend={copy(lang, "problem_ask")}
            options={problems.map((p) => ({ value: p, label: problemName(lang, p) }))}
            values={draft.problems}
            onToggle={(p) =>
              onChange({
                ...draft,
                problems: PROBLEM_TYPES.filter((x) => toggle(draft.problems, p).includes(x)),
              })
            }
          />
          {regionQuestions(draft).map((q) => (
            <RegionQuestion key={q} lang={lang} q={q} draft={draft} onChange={onChange} />
          ))}
        </>
      )}
    </article>
  );
}

/** The condition questions that fill the map. */
function FillBlock({
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
  const setFill = (patch: FillDraft) => onUi({ ...ui, fill: { ...fill, ...patch } });
  const sides = (): Option<Side>[] => [
    { value: "right", label: copy(lang, "side_right") },
    { value: "left", label: copy(lang, "side_left") },
  ];
  const answers = fillAnswers(fill, conditions);
  const apply = () => {
    if (!answers) return;
    const filled = autoFillRegions(answers);
    const pdOnly = answers.every((a) => a.condition === "parkinsons");
    onUi({
      ...ui,
      drafts: mergeRegionDrafts(ui.drafts, filled),
      none: false,
      sciNeck: answers.some(
        (a) => (a.condition === "sci_complete" || a.condition === "sci_incomplete") && a.level === "neck",
      ),
      fillStage: pdOnly ? "done" : "confirm",
    });
    if (pdOnly && answers.some((a) => a.condition === "parkinsons" && !a.confirmed)) focusMap();
  };
  return (
    <section className="intake7-block" aria-labelledby="intake7-fill-title">
      <h3 id="intake7-fill-title">{tV7(lang, "intake7.conditions.title")}</h3>
      {fillQuestions(conditions).map((q) => {
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
          case "parkinsons":
            return (
              <Choices
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS.parkinsons.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.parkinsons}
                onPick={(v) => setFill({ parkinsons: v })}
              />
            );
          case "sci_complete":
            return (
              <Choices
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS.sci_complete.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.sci_complete}
                onPick={(v) => setFill({ sci_complete: v })}
              />
            );
          case "sci_incomplete":
            return (
              <Choices
                key={q.condition}
                legend={ask}
                options={FILL_ANSWERS.sci_incomplete.map((v, i) => ({ value: v, label: answer(i) }))}
                value={fill.sci_incomplete}
                onPick={(v) => setFill({ sci_incomplete: v })}
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
      <button type="button" className="cta" disabled={!answers} onClick={apply}>
        {tV7(lang, "intake7.conditions.apply")}
        <Icon name="arrow" size={18} />
      </button>
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

function focusMap() {
  if (typeof document === "undefined") return;
  const map = document.getElementById("intake7-map");
  map?.scrollIntoView({ behavior: "smooth", block: "start" });
  map?.focus({ preventScroll: true });
}

/** The line that asks the person to confirm the filled map (confirm_regions, rom-protocol 2.3). */
export function confirmLine(lang: Lang, drafts: readonly RegionDraft[]): string {
  const filled = drafts.filter((d) => d.origin === "condition");
  const sides = new Set(filled.map((d) => d.side));
  const side = sides.size === 1 ? [...sides][0] : null;
  if (filled.length === 0 || (side !== "right" && side !== "left"))
    return tV7(lang, "intake7.conditions.confirmMany");
  const names = inBodyOrder(filled).map((d) => {
    const name = regionName(lang, d.region);
    return lang === "en" ? name.toLowerCase() : name;
  });
  return interpolate(lang, copy(lang, "confirm_regions"), {
    regions: listOf(lang, names),
    sideF: ROM_DATA.sideWords.sideF[side],
    side: ROM_DATA.sideWords.side[side],
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

/* ------------------------------------------------------------------ the step */

export interface IntakeV7Props {
  lang: Lang;
  /** The answers of the steps before: conditions and mobility. */
  context: IntakeV7Context;
  /** The intake's v7 fields (the saved answers when editing). */
  value: V7Answers;
  /** The step's working state, kept by IntakeForm; null on the first visit. */
  ui: V7Ui | null;
  /** The report reading's suggestions (AZM_V7 servers) and its v1 pain areas. */
  report?: { regions: ReportRegion[]; pain: string[] } | null;
  /** The v1 pain areas of an intake saved before v7, offered on the map. */
  earlierPain?: readonly string[];
  /** After a Continue that could not go on: name the cards that still need answers. */
  showMissing?: boolean;
  onUi(ui: V7Ui): void;
  onChange(v: V7Answers): void;
}

/** The "Your body" step of the intake (v7). */
export default function IntakeV7({
  lang,
  context,
  value,
  ui: kept,
  report = null,
  earlierPain = [],
  showMissing = false,
  onUi,
  onChange,
}: IntakeV7Props) {
  const c = labels(lang);
  const ui = kept ?? initialUi(value, context.conditions);
  const answers = stepAnswers(ui, context);
  const answersKey = JSON.stringify(answers);
  // The intake's v7 fields follow the step's state, also after an earlier step changed the context.
  useEffect(() => {
    onChange(answers);
  }, [answersKey]);

  const set = (patch: Partial<V7Ui>) => onUi({ ...ui, ...patch });
  const walks = ui.walking === "with_aid" || ui.walking === "without_aid";
  const heightTyped = ui.height.trim() !== "";
  const heightValid =
    !heightTyped ||
    (Number.isInteger(Number(ui.height)) &&
      Number(ui.height) >= HEIGHT_CM.min &&
      Number(ui.height) <= HEIGHT_CM.max);
  const drafts = inBodyOrder(ui.drafts);
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
  const questions = fillQuestions(context.conditions);
  const flagQuestions = romFlagQuestions(flagContext(ui, context));

  return (
    <div className="intake7">
      <p className="intake7-intro">{copy(lang, "intro")}</p>
      <Choices
        legend={tV7(lang, "intake7.sex.legend")}
        options={[
          { value: "male" as const, label: tV7(lang, "intake7.sex.male") },
          { value: "female" as const, label: tV7(lang, "intake7.sex.female") },
        ]}
        value={ui.sex}
        onPick={(sex) => set({ sex })}
      />
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
      {questions.length > 0 && ui.fillStage === "ask" && (
        <FillBlock lang={lang} ui={ui} conditions={context.conditions} onUi={onUi} />
      )}
      {ui.fillStage === "confirm" && (
        <section className="intake7-block intake7-confirm" aria-live="polite">
          <p>{confirmLine(lang, ui.drafts)}</p>
          <div className="intake-choices">
            <button type="button" onClick={() => set({ fillStage: "done" })}>
              {copy(lang, "ans_yes")}
            </button>
            <button
              type="button"
              onClick={() => {
                set({ fillStage: "done" });
                focusMap();
              }}
            >
              {copy(lang, "change_it")}
            </button>
          </div>
        </section>
      )}
      <section
        className="intake7-mapsection"
        id="intake7-map"
        tabIndex={-1}
        aria-labelledby="intake7-map-title"
      >
        <h3 id="intake7-map-title">{mapTitle}</h3>
        <p className="field-help">{tV7(lang, "intake7.map.help")}</p>
        {questions.length > 0 && ui.fillStage === "done" && (
          <button type="button" className="text-button" onClick={() => set({ fillStage: "ask" })}>
            {tV7(lang, "intake7.conditions.fillAgain")}
          </button>
        )}
        <div className="intake7-map">
          <div>
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
              </div>
            )}
          </div>
          <div className="intake7-cards">
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
            {drafts.map((d) => (
              <RegionCard
                key={`${d.region}:${d.side}`}
                lang={lang}
                draft={d}
                showMissing={showMissing}
                onChange={(next) => updateDraft(d, next)}
                onRemove={() => removeDraft(d)}
              />
            ))}
          </div>
        </div>
      </section>
      <section className="intake7-safety" aria-labelledby="intake7-safety-title">
        <h3 id="intake7-safety-title">{tV7(lang, "intake7.safety.title")}</h3>
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

/** The step's name, for the intake's step list. */
export function IntakeV7StepName({ lang }: { lang: Lang }) {
  return <>{tV7(lang, "intake7.step")}</>;
}

/** The step's rows on the review step. */
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
