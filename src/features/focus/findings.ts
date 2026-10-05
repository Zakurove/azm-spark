/**
 * The findings page's view (product v7 contract B4, plan 1.7 and «4. Findings. One clear page»), pure,
 * no DOM: the profile route's answer (GET /api/focus/profile) and the person's intake turned into the
 * page's cards and lines. Every clinical word is the range data's (rom-protocol 7.4 results and the
 * copy lines); the page's own words are the rom namespace's (src/i18n/{ar,en}/rom.json, findings).
 *
 *   groups   one card per body map cell of the history, in body order (the neck and the back have one
 *            cell for every direction), with its colour, one row per camera movement, measured or
 *            not, the movements the camera never measures on one line, and the joint's finding lines
 *            once (what the limits «may suggest» is said of the joint, not repeated under each row)
 *   others   the cells counted as typical: not on the body map (4.3 rule 5)
 *   legend   the colours the body map shows, with their words
 *   walk     the walk's changes the page names: walking speed, step length, steps a minute
 *
 * Only the range data, the norms and the copy are read here, so the page's chunk carries no other data.
 */
import { fmtDate, type Lang } from "../../app/i18n";
import { interpolate } from "../../i18n";
import { tV7 } from "../../i18n/v7";
import { AXIAL_REGIONS, REGION_IDS, entryCells, type BodyMapKey } from "../../medical/body-map";
import type { Intake } from "../../medical/plan";
import { gradeBand, normFor, shownApproximate } from "../../medical/rom-norms";
import type { BodyMapColour, RomChange, RomFinding, RomProfileEntry } from "../../medical/rom-types";
import type { GaitMetricId } from "../../engine/gait/types";
import { movementDef, romCopy, romResultLine } from "../../movements/rom";
import { ROM_MOVEMENT_IDS } from "../../movements/rom/types";
import type { JointMovementId, RomMovementId, RomResultKey, RomSide } from "../../movements/rom/types";
import type { FocusProfile } from "./api";
import { scaleMax } from "./Dial";
import { jointName, regionName, sideRegion } from "./names";

/** A colour of the page: the body map's, without «none». */
export type Tone = Exclude<BodyMapColour, "none">;

/** The scale of one measured value: the value, the typical value and the within normal band on it. */
export interface BarView {
  /** The scale's end, in the movement's degrees (Dial's scaleMax). */
  max: number;
  /** Today's value on the scale (0 or more: past straight and in front of the trunk line read 0). */
  value: number;
  /** The typical value's mark, or null (a lack's typical is straight, the scale's start). */
  typical: number | null;
  /** The within normal band [from, to], or null without a matched norm. */
  band: [number, number] | null;
  /** The starting point's value on a retest, or null. */
  first: number | null;
}

export interface RowView {
  key: string;
  movementId: JointMovementId;
  side: RomSide;
  name: string;
  /** The direction of a bend to the side («نحو اليمين»), or null. */
  direction: string | null;
  /** The value as shown («٩٥°»), or null when not measured. */
  value: string | null;
  /** The words under a lack's value («عن الاستقامة»). */
  caption: string | null;
  /** The typical value as shown, or null (none for this position, or a lack). */
  typical: string | null;
  label: { text: string; tone: Tone } | null;
  /** The approximate comparison and a first reading from one valid try. */
  notes: string[];
  /**
   * The value line (rom-protocol 7.4) where it says more than the number and the typical value (a lack,
   * the leg back, a position without a typical value), or why the movement was not measured.
   */
  line: string | null;
  /** The finding's line of this movement alone: refer_measure, or a joint the person could not move. */
  finding: string | null;
  /** finding_new for a markedly limited result. */
  more: string[];
  change: { direction: RomChange["direction"]; text: string; values: string } | null;
  bar: BarView | null;
  /** The stored finding id (a test and review hook). */
  findingId: RomProfileEntry["finding"];
}

export interface GroupView {
  cell: BodyMapKey;
  title: string;
  tone: Tone | null;
  rows: RowView[];
  /** The movements the camera never measures in this joint (default only, 3.17), with their label and reason once. */
  unmeasured: { names: string[]; label: string; line: string } | null;
  /** The joint's finding lines («may suggest», «stopped because of pain»), each once, in row order. */
  findings: string[];
}

export interface WalkView {
  metric: GaitMetricId;
  label: string;
  values: string;
  /** Within the smallest real change: about the same as the starting point. */
  same: boolean;
}

export interface FindingsView {
  /** The day of the check («الأحد، ٤ أكتوبر ٢٠٢٦»). */
  date: string;
  groups: GroupView[];
  others: string[];
  legend: { tone: Tone; label: string }[];
  /** What a screen reader hears after a coloured cell's name. */
  mapNotes: Partial<Record<BodyMapKey, string>>;
  /** A retest: at least one movement compared with its starting point. */
  changes: boolean;
  walk: WalkView[];
  /** The check the answer is about, from its stored rows; null when it has none. */
  checkId: string | null;
}

/** The person's time zone: every date of the check is Riyadh's (progress/format.ts TIME_ZONE). */
const TIME_ZONE = "Asia/Riyadh";

const CAMERA_IDS: ReadonlySet<string> = new Set(ROM_MOVEMENT_IDS);
const isCamera = (id: JointMovementId): id is RomMovementId => CAMERA_IDS.has(id);
const isAxial = (region: RomProfileEntry["region"]) => AXIAL_REGIONS.includes(region);

/** Every body map cell in body order: the neck, the back, then each limb region right then left. */
const CELLS: readonly BodyMapKey[] = REGION_IDS.flatMap((r): BodyMapKey[] =>
  AXIAL_REGIONS.includes(r) ? [`${r}:axial`] : [`${r}:right`, `${r}:left`],
);
const cellOf = (e: Pick<RomProfileEntry, "region" | "side">): BodyMapKey =>
  isAxial(e.region) ? `${e.region}:axial` : (`${e.region}:${e.side}` as BodyMapKey);

/** The tones of the legend in one order: the results, then grey. */
const TONES: readonly Tone[] = ["within", "mild", "marked", "pain", "grey"];
const TONE_LABEL: Record<Exclude<Tone, "grey">, RomResultKey> = {
  within: "label_within",
  mild: "label_mild",
  marked: "label_marked",
  pain: "label_pain",
};

/** The words of a colour: the result labels of rom-protocol 7.4, and grey's own line. */
export function toneLabel(tone: Tone, lang: Lang): string {
  return tone === "grey" ? tV7(lang, "rom.findings.legendGrey") : romResultLine(TONE_LABEL[tone])[lang];
}

const degrees = (lang: Lang, n: number) => interpolate(lang, `${Math.round(n)}°`);
/**
 * Degrees inside an Arabic sentence: one left to right isolate, so the sign stays after its number
 * («١٣٢°», as the dial writes it) instead of moving to the number's other side.
 */
const isolatedDegrees = (lang: Lang, n: number) =>
  lang === "ar" ? `\u2066${degrees(lang, n)}\u2069` : degrees(lang, n);

/** A result line of the data with its tokens, the degree words in the page's language. */
const resultText = (lang: Lang, key: RomResultKey, vars: Record<string, string | number> = {}) =>
  interpolate(lang, romResultLine(key)[lang], { unit: "deg", ...vars });

/**
 * «label_uncertain replaces label_within for a lying knee lack between 5 and the within normal limit
 * when the knee has injury, surgery, OA, CP or limb loss in the history» (7.4): the knee's entries on
 * that side (osteoarthritis is the arthritis condition).
 */
const UNCERTAIN_PROBLEMS = ["injury", "after_surgery", "limb_loss"] as const;
const UNCERTAIN_CONDITIONS = ["arthritis", "cerebral_palsy"];
function uncertainLack(e: RomProfileEntry, intake: Intake | null): boolean {
  if (e.movementId !== "knee_extension" || e.finding !== "within" || e.value === null || e.z === null)
    return false;
  const from = movementDef("knee_extension").positions.find(
    (p) => p.uncertainLackFrom !== undefined,
  )?.uncertainLackFrom;
  if (from === undefined || e.value < from || !intake) return false;
  const cell = cellOf(e);
  const knee = (intake.regions ?? []).some(
    (r) =>
      r.region === "knee" &&
      entryCells(r).includes(cell) &&
      r.problems.some((p) => (UNCERTAIN_PROBLEMS as readonly string[]).includes(p)),
  );
  return knee || (intake.conditions ?? []).some((c) => UNCERTAIN_CONDITIONS.includes(c));
}

/** The label of a row: the measured grade (pain first, 5.3), or why it was not measured. */
function labelOf(e: RomProfileEntry, intake: Intake | null, lang: Lang): RowView["label"] {
  const line = (key: RomResultKey, tone: Tone) => ({ text: romResultLine(key)[lang], tone });
  if (e.source === "measured") {
    if (e.painLimited) return line("label_pain", "pain");
    if (e.finding === "within")
      return uncertainLack(e, intake) ? line("label_uncertain", "within") : line("label_within", "within");
    if (e.finding === "mild") return line("label_mild", "mild");
    if (e.finding === "marked") return line("label_marked", "marked");
    return null;
  }
  if (e.source === "not_measured_camera") return line("label_default", "grey");
  if (e.reason === "pain_stop") return line("label_pain", "pain");
  if (e.noActiveMovement) return { text: tV7(lang, "rom.findings.noActive"), tone: "grey" };
  return line("label_not_today", "grey");
}

/**
 * The value line of a measured row (rom-protocol 7.4, as the result card writes it): the leg back on
 * either side of the trunk line, the seated knee, a lack, a value with no typical value to compare. A
 * value against its typical one (value_flexion) is the row's number and typical value already, so it
 * has no line here. A knee straightening without a grade is the seated one (lying always has a norm
 * row).
 */
function valueLine(e: RomProfileEntry, lang: Lang): string | null {
  const v = e.value!;
  if (e.movementId === "hip_extension" && e.typical !== null)
    return v >= 0
      ? resultText(lang, "value_hip_ext_behind", { value: v, norm: e.typical })
      : resultText(lang, "value_hip_ext_front", { value: Math.abs(v) });
  if (e.kind === "lack") {
    const lack = Math.max(0, v);
    if (lack === 0) return resultText(lang, "value_lack_straight");
    if (e.movementId === "knee_extension" && e.z === null)
      return resultText(lang, "value_knee_seated", { value: lack });
    return resultText(lang, "value_lack", { value: lack });
  }
  if (e.typical === null) return resultText(lang, "value_no_grade", { value: Math.abs(v) });
  return null;
}

/** Why a movement was not measured: the data's lines and the shell's, past tense on this page. */
function notMeasuredLine(e: RomProfileEntry, lang: Lang): string | null {
  if (e.source === "not_measured_camera") return romCopy("default_line")[lang];
  switch (e.reason) {
    case "no_active_movement":
      return null;
    case "deferred":
      return romCopy("deferred_line")[lang];
    case "not_reached":
      return romCopy("not_reached_line")[lang];
    case "quality":
    case "no_hold":
      return tV7(lang, "rom.result.quality");
    case "by_choice":
      return tV7(lang, "rom.result.byChoice");
    case "pain_stop":
      return tV7(lang, "rom.findings.painStop");
    case "stopped_symptom":
      return tV7(lang, "rom.findings.stopped");
    case null:
      return tV7(lang, "rom.findings.notInCheck");
    default:
      // A safety reason of rom-protocol 6, or a skip carried from the pre-check.
      return tV7(lang, "rom.findings.safety");
  }
}

/** The graded position of a movement (every graded position of a movement shares one norm). */
const gradedPosition = (id: RomMovementId) => movementDef(id).positions.find((p) => p.graded)?.id ?? null;

/** The scale of a measured value: the dial's, on a line (Dial.tsx), with the starting point beside it. */
function barOf(
  e: RomProfileEntry,
  sex: "male" | "female",
  age: number,
  change: RomChange | undefined,
): BarView | null {
  if (e.value === null || !isCamera(e.movementId)) return null;
  const def = movementDef(e.movementId);
  const position = e.z === null ? null : gradedPosition(e.movementId);
  const pick =
    position === null
      ? null
      : normFor(e.movementId, position, sex, age, e.side === "none" ? undefined : e.side);
  const band = pick && pick.norm.graded && pick.row.limits ? gradeBand(def, pick) : null;
  const lack = e.kind === "lack";
  const value = Math.max(0, e.value);
  const first = change ? Math.max(0, change.first) : null;
  const typical = lack || e.typical === null ? null : Math.max(0, e.typical);
  const edge = band ? (band.kind === "lack" ? band.withinUpTo : band.withinFrom) : null;
  const max = scaleMax(e.kind, typical, edge, Math.max(value, first ?? 0));
  return {
    max,
    value,
    typical,
    band: band ? (band.kind === "lack" ? [0, band.withinUpTo] : [band.withinFrom, max]) : null,
    first,
  };
}

/** A change since the starting point, in words that name the range or the straightening, never better or worse. */
function changeOf(e: RomProfileEntry, c: RomChange, lang: Lang): NonNullable<RowView["change"]> {
  const lack = e.kind === "lack";
  const key =
    c.direction === "same"
      ? "rom.findings.change.same"
      : c.direction === "better"
        ? lack
          ? "rom.findings.change.straighter"
          : "rom.findings.change.more"
        : lack
          ? "rom.findings.change.lessStraight"
          : "rom.findings.change.less";
  const shown = (n: number) => isolatedDegrees(lang, lack ? Math.max(0, n) : Math.abs(n));
  return {
    direction: c.direction,
    text: tV7(lang, key),
    values: tV7(lang, "rom.findings.change.values", { first: shown(c.first), latest: shown(c.latest) }),
  };
}

function rowOf(
  e: RomProfileEntry,
  data: FocusProfile,
  findings: ReadonlyMap<string, RomFinding>,
  changes: ReadonlyMap<string, RomChange>,
  intake: Intake | null,
  lang: Lang,
): RowView {
  const key = `${e.movementId}:${e.side}`;
  const f = findings.get(key);
  const c = changes.get(key);
  const measured = e.source === "measured" && e.value !== null;
  const notes: string[] = [];
  const more: string[] = [];
  let line: string | null = null;
  if (measured) {
    line = valueLine(e, lang);
    if (e.provisional) notes.push(romResultLine("label_provisional")[lang]);
    if (isCamera(e.movementId)) {
      const def = movementDef(e.movementId);
      const position = e.z === null ? null : gradedPosition(e.movementId);
      const side = e.side === "none" ? undefined : e.side;
      const pick =
        position === null ? null : normFor(e.movementId, position, data.profile.sex, data.profile.age, side);
      if (shownApproximate(def, pick, e.value!, e.flags))
        notes.push(romResultLine("label_approximate")[lang]);
    }
    // «finding_new is shown with every markedly limited result» (7.4).
    if (e.finding === "marked" && !e.painLimited) more.push(romResultLine("finding_new")[lang]);
  } else {
    line = notMeasuredLine(e, lang);
  }
  // A line of this movement alone stays on its row; the joint's lines go to its card (findingsView).
  const finding =
    f && (f.noActiveMovement || f.finding === "unknown" || f.finding === "no_grade") && f.line[lang]
      ? f.line[lang]
      : null;
  const lack = e.kind === "lack";
  return {
    key,
    movementId: e.movementId,
    side: e.side,
    name: jointName(e.movementId, lang),
    direction:
      isAxial(e.region) && e.side !== "none"
        ? tV7(lang, e.side === "right" ? "rom.findings.toRight" : "rom.findings.toLeft")
        : null,
    value: measured ? degrees(lang, lack ? Math.max(0, e.value!) : Math.abs(e.value!)) : null,
    caption: measured && lack ? tV7(lang, "rom.measure.fromStraight") : null,
    typical: measured && !lack && e.typical !== null ? degrees(lang, e.typical) : null,
    label: labelOf(e, intake, lang),
    notes,
    line,
    finding,
    more,
    change: c ? changeOf(e, c, lang) : null,
    bar: measured ? barOf(e, data.profile.sex, data.profile.age, c) : null,
    findingId: e.finding,
  };
}

/**
 * The movements the camera never measures in a joint of the history: «stored as not measured (grey)
 * ... never typical» (3.17). One movement takes the data's label and line; several share the plural
 * forms of the page.
 */
function unmeasuredOf(entries: readonly RomProfileEntry[], lang: Lang): NonNullable<GroupView["unmeasured"]> {
  const names = entries.map((e) => jointName(e.movementId, lang));
  return entries.length === 1
    ? { names, label: romResultLine("label_default")[lang], line: romCopy("default_line")[lang] }
    : {
        names,
        label: tV7(lang, "rom.findings.cameraNeverLabel"),
        line: tV7(lang, "rom.findings.cameraNever"),
      };
}

/** The title of a cell: the region, with its side for a limb («الركبة اليمنى»). */
function cellTitle(cell: BodyMapKey, lang: Lang): string {
  const [region, side] = cell.split(":") as [RomProfileEntry["region"], "left" | "right" | "axial"];
  return side === "axial" ? regionName(region, lang) : sideRegion({ region, side }, lang);
}

/** The walk's changes the page names, with the units the gait copy uses (metres a second, centimetres). */
const WALK: readonly { metric: GaitMetricId; label: "speed" | "step" | "cadence" }[] = [
  { metric: "speed_mps", label: "speed" },
  { metric: "step_length_m", label: "step" },
  { metric: "cadence", label: "cadence" },
];
function walkValue(metric: GaitMetricId, v: number, lang: Lang): string {
  // Numbers, not strings: the copy writes them in the page's digits («٠٫٩٥»).
  if (metric === "speed_mps")
    return tV7(lang, "rom.findings.walk.speedValue", { n: Math.round(v * 100) / 100 });
  if (metric === "step_length_m") return tV7(lang, "rom.findings.walk.stepValue", { n: Math.round(v * 100) });
  return interpolate(lang, "{n}", { n: Math.round(v) });
}

/** The findings page's view of one answer of GET /api/focus/profile. */
export function findingsView(data: FocusProfile, intake: Intake | null, lang: Lang): FindingsView {
  const findings = new Map(data.findings.map((f) => [`${f.movementId}:${f.side}`, f]));
  const changes = new Map(data.changes.map((c) => [`${c.movementId}:${c.side}`, c]));
  const byCell = new Map<BodyMapKey, RomProfileEntry[]>();
  for (const e of data.profile.entries) {
    const cell = cellOf(e);
    byCell.set(cell, [...(byCell.get(cell) ?? []), e]);
  }
  const groups: GroupView[] = [];
  const others: string[] = [];
  for (const cell of CELLS) {
    const entries = byCell.get(cell) ?? [];
    if (entries.length > 0 && entries.every((e) => e.source === "default")) {
      others.push(cellTitle(cell, lang));
      continue;
    }
    // A typical default or an absent joint is no row («no value, no default, no finding», 2.4).
    const shown = entries.filter((e) => e.source !== "default" && e.source !== "not_applicable");
    if (shown.length === 0) continue;
    // The movements the camera never measures share one line (3.17, label_default and default_line).
    const never = shown.filter((e) => !isCamera(e.movementId) && e.source === "not_measured_camera");
    const rows = shown.filter((e) => !never.includes(e));
    const lines: string[] = [];
    for (const e of rows) {
      const f = findings.get(`${e.movementId}:${e.side}`);
      const line =
        f && !f.noActiveMovement && f.finding !== "unknown" && f.finding !== "no_grade" ? f.line[lang] : "";
      if (line && !lines.includes(line)) lines.push(line);
    }
    const tone = data.bodyMap[cell];
    groups.push({
      cell,
      title: cellTitle(cell, lang),
      tone: tone && tone !== "none" ? tone : null,
      rows: rows.map((e) => rowOf(e, data, findings, changes, intake, lang)),
      unmeasured: never.length ? unmeasuredOf(never, lang) : null,
      findings: lines,
    });
  }
  const shownTones = new Set(Object.values(data.bodyMap));
  const legend = TONES.filter((t) => shownTones.has(t)).map((tone) => ({
    tone,
    label: toneLabel(tone, lang),
  }));
  const mapNotes: Partial<Record<BodyMapKey, string>> = {};
  for (const [cell, tone] of Object.entries(data.bodyMap) as [BodyMapKey, BodyMapColour][])
    if (tone !== "none") mapNotes[cell] = toneLabel(tone, lang);
  const walk: WalkView[] = data.gaitChanges.flatMap((g) => {
    const w = WALK.find((x) => x.metric === g.metric);
    if (!w) return [];
    return [
      {
        metric: g.metric,
        label: tV7(lang, `rom.findings.walk.${w.label}`),
        values: tV7(lang, "rom.findings.walk.fromTo", {
          first: walkValue(g.metric, g.first, lang),
          latest: walkValue(g.metric, g.latest, lang),
        }),
        same: g.direction === "same",
      },
    ];
  });
  return {
    date: fmtDate(data.profile.created, lang, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: TIME_ZONE,
    }),
    groups,
    others,
    legend,
    mapNotes,
    changes: data.changes.length > 0,
    walk,
    checkId: data.profile.entries.find((e) => e.checkId !== null)?.checkId ?? null,
  };
}
