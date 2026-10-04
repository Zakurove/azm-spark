/**
 * Writes the v7 runtime clinical data (product v7 contract, decision C-1 and section 2.1).
 *
 *   node scripts/clinical/export-v7.mjs --input <folder>
 *
 * The input folder holds the three clinical sources, rom-protocol.json, gait-rules.json and
 * exercise-targets.json (in practice /Users/nasser/Development/Azm6.0/local-docs/clinical/v7, git
 * ignored). There is no default: a run without --input exits with 1 and writes nothing, so a
 * worktree without the clinical folder can never write stale data. The outputs are the committed
 * runtime files of the checkout the script lives in:
 *
 *   src/movements/rom/rom-v7.json, src/movements/gait/gait-v7.json, src/movements/targets/targets-v7.json
 *
 * Each output keeps only the runtime sections of contract 2.1 rule 3, in the shapes of the types in
 * src/movements/{rom,gait,targets}/types.ts. Review material and prose that engineers read in
 * local-docs are dropped (rule 2). Prose that the data writes where the code needs a structure
 * (landmark midpoints, optional landmark roles, engine ranges, limb loss reasons, norm flags, hip
 * end range notes) is turned into that structure through explicit tables; any prose a table does
 * not know fails the export. Every object the export reads has a known fields check (kept, or known
 * as dropped prose), so a field the source gains anywhere either reaches the output or stops the
 * export (D-024 item 4); only the sections of NUMBERS_MODE drop new prose, which
 * --report-prose-numbers lists when it holds a digit.
 *
 * Exits with 1, and writes nothing, when a kept section is missing, when a source has a top level
 * section this script does not know, when a region id is unknown after normalisation (C-11), when a
 * table meets prose it does not know, or when any kept string breaks the wording rules
 * (scripts/wording-rules.mjs, the same rules as tests/wording.test.ts). It never rewrites copy.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_FACING_KEYS, dataViolations } from "../wording-rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Input file names inside the --input folder. */
export const INPUT_FILES = {
  rom: "rom-protocol.json",
  gait: "gait-rules.json",
  targets: "exercise-targets.json",
};

/** Output paths, relative to the checkout. */
export const OUTPUT_FILES = {
  rom: "src/movements/rom/rom-v7.json",
  gait: "src/movements/gait/gait-v7.json",
  targets: "src/movements/targets/targets-v7.json",
};

/* ------------------------------------------------------------- the lists */

/** Fields dropped at any depth (rule 2). Engineers read them in local-docs. */
export const DROP_ANYWHERE = [
  "sources",
  "cites",
  "basis",
  "evidence",
  "note",
  "notes",
  "why",
  "Ebasis",
  "sigmaMBasis",
  "knownBias",
  "reviewLog",
  "openQuestions",
  "notVerified",
  "builtFrom",
  "evidenceScale",
  "twin",
  "author",
  "consumers",
  "engineering",
];

/**
 * Top level sections kept, in output order. The rule 3 lists, plus the sections contract gap 5
 * (change log, 2026-10-04) asks about, kept until the tech lead decides: rom safety (the 23 safety
 * ids with their rule text, for the painStopRule and buildRomProtocol parity tests), gait eligibility
 * and qualityGates (gaitPlanFor and the quality gates), and the targets placeholders (the hold
 * placeholder). `citations` is built from `sources`; the targets `whyLines` come from mapping.whyLines.
 */
export const KEEP = {
  rom: [
    "id",
    "specVersion",
    "status",
    "signoff",
    "conventions",
    "engine",
    "regions",
    "regionTable",
    "problemTypes",
    "conditionAutoMap",
    "limbLoss",
    "positions",
    "movements",
    "defaultMovements",
    "norms",
    "thresholds",
    "retest",
    "sessionOrder",
    "safety",
    "reasonIds",
    "copy",
    "cues",
    "results",
    "sideWords",
    "citations",
  ],
  gait: [
    "id",
    "version",
    "status",
    "signoff",
    "grades",
    "eligibility",
    "capture",
    "preprocessing",
    "events",
    "metrics",
    "scaling",
    "qualityGates",
    "norms",
    "errorMargins",
    "retest",
    "confidenceModel",
    "patterns",
    "findings",
    "copy",
    "citations",
  ],
  targets: [
    "id",
    "version",
    "status",
    "signoff",
    "placeholders",
    "taxonomy",
    "dose",
    "libraryTags",
    "newExercises",
    "contraindicationVocabulary",
    "mapping",
    "whyLines",
  ],
};

/** Output sections that are built from a differently named source section. */
const DERIVED = { citations: "sources", whyLines: "mapping" };

/**
 * Top level source sections that are known and not kept: documentation and review material.
 * Gap 5 of the change log lists them; the ROM landmark names, norm selection prose and functional
 * cross check are implemented in code from local-docs. Retest and the session order are kept since
 * the freeze step (D-024 item 4): their numbers, not their prose.
 */
export const DROP_TOP = {
  rom: [
    "date",
    "decision",
    "reviewRound",
    "builtFrom",
    "evidenceScale",
    "landmarks",
    "normSelection",
    "functionalCrossCheck",
    "openQuestions",
    "notVerified",
    "reviewLog",
  ],
  gait: [
    "date",
    "decision",
    "reviewRound",
    "author",
    "plan",
    "twin",
    "consumers",
    "citationKeys",
    "conventions",
    "notInMvp",
    "openQuestions",
    "engineering",
    "reviewLog",
  ],
  targets: [
    "date",
    "decision",
    "reviewRound",
    "twin",
    "builtFrom",
    "consumers",
    "evidenceScale",
    "wordingRules",
    "coverage",
    "openQuestions",
    "notVerified",
    "reviewLog",
  ],
};

/**
 * Sections whose prose the export drops by design (rule 3 "(numbers)" and the confidence model's
 * "(lists)"): a number added there reaches the output, and prose holding a digit is what
 * --report-prose-numbers lists. Every other object goes through a known fields check.
 */
export const NUMBERS_MODE = {
  rom: [],
  gait: ["capture", "preprocessing", "events", "scaling", "errorMargins", "confidenceModel"],
  targets: [],
};

/** The canonical region ids (C-11, rom-protocol regions). */
export const REGION_IDS = [
  "neck",
  "back_trunk",
  "shoulder",
  "elbow",
  "forearm_wrist",
  "hip",
  "knee",
  "ankle_foot",
];

/**
 * Region spellings of the other files, normalised to the canonical ids (rule 4). exercise-targets
 * writes forearm_and_wrist in regionDefaultRule (C-11), and its taxonomy writes trunk and wrist_hand
 * for the trunk and the wrist and hand muscle groups (change log, A1).
 */
export const REGION_ALIASES = {
  forearm_and_wrist: "forearm_wrist",
  trunk: "back_trunk",
  wrist_hand: "forearm_wrist",
};

/**
 * Optional landmark roles (rule 7): the movement's `optional` prose to a role id, and the standard
 * MediaPipe reference added to the movement's landmarks when the role is missing there. The plain
 * role names A, H, K, S, MS and MH are added from the same table when a movement lists one it does
 * not have (for example the hip for the elbow movements' trunk check).
 */
export const OPTIONAL_ROLES = {
  "W (wrist, for the elbow check)": "W",
  W: "W",
  "ears 7 and 8 (shrug logging)": "ears",
  "other knee": "Kother",
  "hip line": "hips",
  hips: "hips",
  heel: "heel",
  nose: "nose",
  A: "A",
  H: "H",
  K: "K",
  S: "S",
  MS: "MS",
  MH: "MH",
};
export const STANDARD_ROLE_REFS = {
  W: { left: 15, right: 16 },
  ears: [7, 8],
  Kother: { other: "knee" },
  hips: [23, 24],
  heel: { left: 29, right: 30 },
  nose: 0,
  A: { left: 27, right: 28 },
  H: { left: 23, right: 24 },
  K: { left: 25, right: 26 },
  S: { left: 11, right: 12 },
  MS: { mid: [11, 12] },
  MH: { mid: [23, 24] },
};

/** Landmark prose of movements[].angle.landmarks (the LandmarkRef doc comment of contract 2.3). */
export const LANDMARK_PROSE = [
  [/^mid\((\d+), (\d+)\)$/, (m) => ({ mid: [Number(m[1]), Number(m[2])] })],
  [/^mid\((\d+), (\d+)\) fixed at calibration$/, (m) => ({ mid: [Number(m[1]), Number(m[2])], fixed: true })],
  [/^the other hip \(23 or 24\)$/, () => ({ other: "hip" })],
  [/^other knee$/, () => ({ other: "knee" })],
];

/** The evidence grades of RomMovementDef.cameraEvidence. */
export const EVIDENCE = ["High", "Moderate", "Low", "Very low"];
/**
 * Camera evidence written as a range: the lower grade is kept (conservative), the way a range of
 * evidence is read for a decision (change log, A1).
 */
export const EVIDENCE_RANGES = {
  "Low to moderate": "Low",
  "Low to moderate (conflicting)": "Low",
  "Moderate to high": "Moderate",
};

/**
 * Engine values written as prose, to their structure (rule 3: engine value fields only). A number
 * passes as is; any other prose fails the export.
 */
export const ENGINE_PROSE = {
  restBetweenAttemptsSeconds: { "5 to 10": { min: 5, max: 10 } },
  inconsistentSpread: { "E + 5": { plusE: 5 } },
  smoothing: {
    "Live dial: existing One Euro filter. Recorded value: Hampel filter (window 7, n sigma 2), then the median of the hold window":
      { live: "one_euro", hampel: { window: 7, nSigma: 2 }, holdValue: "median" },
  },
  sigmaMFloor: { "measure 5.1 (10 ÷ 1.96); caution 7.7 (15 ÷ 1.96)": { measure: 5.1, caution: 7.7 } },
};

/** Norm limit flags, by the id before the colon. */
export const NORM_FLAGS = ["sdUnknown"];

/** Hip end range ids of exercise-targets newExercises[].hipEndRange (contract gap 3). */
export const HIP_END_RANGE_IDS = [
  "flexion_past_90",
  "adduction_past_midline",
  "extension",
  "external_rotation",
  "internal_rotation",
  "abduction",
];

/* --------------------------------------------------------------- helpers */

class ExportError extends Error {}
const fail = (message) => {
  throw new ExportError(message);
};
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Removes DROP_ANYWHERE fields at any depth. */
export function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!DROP_ANYWHERE.includes(k)) out[k] = strip(v);
    return out;
  }
  return value;
}

/** Keeps only the listed fields that are present, in the listed order. */
function pick(value, keys, where) {
  if (!isObject(value)) fail(`${where} is not an object`);
  const out = {};
  for (const k of keys) if (k in value) out[k] = strip(value[k]);
  return out;
}

/**
 * Fails on a field that is neither kept nor known as dropped (the rule 2 review fields are known as
 * dropped everywhere). Every object the export reads goes through it, so a field the clinical source
 * gains anywhere either reaches the output or stops the export (D-024 item 4).
 */
function knownFields(value, known, where) {
  if (!isObject(value)) fail(`${where} is not an object`);
  for (const k of Object.keys(value))
    if (!known.includes(k) && !DROP_ANYWHERE.includes(k))
      fail(`${where}: unknown field ${k}: add it to export-v7.mjs`);
}

/** A number the code reads: fails on text, so a number written as words never reaches the runtime data. */
function num(v, where) {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${where}: not a number: ${JSON.stringify(v)}`);
  return v;
}

/** Checks the fields of an object (kept, or known as dropped prose) and keeps the kept ones (rule 3). */
function take(value, kept, where, droppedProse = []) {
  knownFields(value, [...kept, ...droppedProse], where);
  return pick(value, kept, where);
}

/**
 * Numbers mode (rule 3 "(numbers)"): keeps number and boolean leaves, arrays of them, and the
 * objects that still hold one; drops prose. Prose that holds a number is listed by numbersInProse.
 */
export function numbersOnly(value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length && value.every((x) => typeof x === "number" || typeof x === "boolean")) return value;
    const kept = value.map(numbersOnly).filter((x) => x !== undefined);
    return kept.length && kept.every(isObject) ? kept : undefined;
  }
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROP_ANYWHERE.includes(k)) continue;
      const kept = numbersOnly(v);
      if (kept !== undefined) out[k] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Prose strings holding a digit inside a numbers mode section: what numbers mode leaves behind. */
export function numbersInProse(value, where = "") {
  const out = [];
  const visit = (v, path) => {
    if (typeof v === "string") {
      if (/\d/.test(v)) out.push(`${path} ${JSON.stringify(v)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (isObject(v))
      for (const [k, x] of Object.entries(v)) if (!DROP_ANYWHERE.includes(k)) visit(x, `${path}.${k}`);
  };
  visit(value, where);
  return out;
}

/** Normalises every `region` string at any depth (rule 4) and fails on an unknown id. */
export function normaliseRegions(value, where = "") {
  if (Array.isArray(value)) return value.map((v, i) => normaliseRegions(v, `${where}[${i}]`));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "region" && typeof v === "string") {
        const id = REGION_ALIASES[v] ?? v;
        if (!REGION_IDS.includes(id)) fail(`${where}.region: unknown region id ${v}`);
        out[k] = id;
      } else out[k] = normaliseRegions(v, `${where}.${k}`);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------ top levels */

function checkSections(name, source) {
  if (!isObject(source)) fail(`${INPUT_FILES[name]} is not an object`);
  const errors = [];
  for (const key of KEEP[name]) {
    const from = DERIVED[key] ?? key;
    if (!(from in source)) errors.push(`${INPUT_FILES[name]}: missing section ${from}`);
  }
  const known = new Set([...KEEP[name], ...DROP_TOP[name], ...Object.values(DERIVED)]);
  for (const key of Object.keys(source))
    if (!known.has(key))
      errors.push(
        `${INPUT_FILES[name]}: unknown top level section ${key}: add it to KEEP or DROP_TOP in export-v7.mjs`,
      );
  if (errors.length) throw new ExportError(errors.join("\n"));
}

function citations(sourceTable, ids, where) {
  const out = [];
  for (const id of ids) {
    const s = sourceTable[id];
    if (!isObject(s)) fail(`${where}: source ${id} is not in sources`);
    out.push({ id, cite: s.cite, url: s.url });
  }
  return out;
}

/* ------------------------------------------------------------------- ROM */

const MOVEMENT_FIELDS = [
  "id",
  "version",
  "region",
  "distanceM",
  "levelWithinDeg",
  "frameMarginArmLengths",
  "calibrationSeconds",
  "ar",
  "en",
  "plane",
  "verdict",
  "cameraEvidence",
  "kind",
  "canBeNegative",
  "priority",
  "view",
  "positions",
  "camera",
  "startPose",
  "angle",
  "gate",
  "optional",
  "compensations",
  "E",
  "Ebasis",
  "knownBias",
  "instructions",
  "cites",
  "sigmaM",
  "sigmaMBasis",
  "approximateInPersonView",
  "variantInstructions",
  "bothDirections",
  "absoluteFloor",
  "gravityAssisted",
  "resultName",
  "feeds",
];

export function landmarkRef(v, where) {
  if (Number.isInteger(v)) return v;
  if (Array.isArray(v) && v.length === 2 && v.every(Number.isInteger)) return [v[0], v[1]];
  if (isObject(v) && Object.keys(v).length === 2 && Number.isInteger(v.left) && Number.isInteger(v.right))
    return { left: v.left, right: v.right };
  if (typeof v === "string")
    for (const [re, make] of LANDMARK_PROSE) {
      const m = re.exec(v);
      if (m) return make(m);
    }
  return fail(`${where}: unknown landmark ${JSON.stringify(v)}`);
}

function cameraEvidence(v, where) {
  if (EVIDENCE.includes(v)) return v;
  if (v in EVIDENCE_RANGES) return EVIDENCE_RANGES[v];
  return fail(`${where}: unknown camera evidence ${JSON.stringify(v)}`);
}

/** Prose of movements[].angle that angles.ts quotes word for word (rule 2); the landmarks are kept. */
const ANGLE_PROSE = ["definition", "reference", "zero", "direction"];
/** The knee straightening label numbers of a position's note (review A09, B13; D-024 item 4). */
const POSITION_NUMBERS = ["uncertainLackFrom", "referMeasureLackAbove"];
/** Numbers the angle prose writes, kept on the movement (A3-4 and the side arm raise's direction). */
const ANGLE_NUMBERS = ["directionFromDeg", "earLineMinVisibility"];
/** Prose of movements[].compensations (rule 2): the code quotes it. */
const COMPENSATION_PROSE = ["check", "cue", "invalid"];
/** The units of the compensation numbers, as the prose writes them. */
export const COMPENSATION_UNITS = [
  "deg",
  "ratio",
  "percent",
  "shank_lengths",
  "thigh_lengths",
  "shoulder_widths",
  "ear_distance_share",
];
/** invalid: the attempt is not scored; flag: stored, still scored; log: logging and coaching only. */
export const COMPENSATION_EFFECTS = ["invalid", "flag", "log"];

/** The v1 check's cue lines (check-v1.json cues): the side arm raise keeps two of them (D-024 item 2). */
export const V1_CUE_IDS = JSON.parse(readFileSync(join(ROOT, "src/movements/check-v1.json"), "utf8")).cues.map(
  (c) => c.id,
);

const numOrNull = (v, where) => (v === null ? null : num(v, where));
const oneOf = (v, list, where, what) => (list.includes(v) ? v : fail(`${where}: ${what} ${v}`));

/**
 * One compensation check (D-024 items 2 and 4): the cue line the cue prose names (cueId in the source)
 * and the numbers its check, cue and invalid prose write: cueAt, invalidAt, flagAt, their unit, whether
 * the check fires above or below them, the angle window, the hold time and a second criterion. The
 * prose stays in local-docs. cueIds: the known lines (v7 cues and v1 cues), or null to skip that check.
 */
function compensation(c, cueIds, where) {
  knownFields(
    c,
    [
      "id",
      "cueId",
      "cueAt",
      "invalidAt",
      "flagAt",
      "effect",
      "unit",
      "when",
      "windowDeg",
      "forSeconds",
      "orInvalid",
      "orFlag",
      ...COMPENSATION_PROSE,
    ],
    where,
  );
  if (!("cueId" in c)) fail(`${where}: cueId is missing (null when the prose names no line)`);
  const cue = c.cueId;
  if (cue !== null && typeof cue !== "string") fail(`${where}: cueId ${JSON.stringify(cue)}`);
  if (cue !== null && cueIds && !cueIds.has(cue)) fail(`${where}: cue ${cue} is not a cue line`);
  const out = {
    id: c.id,
    cue,
    cueAt: numOrNull(c.cueAt, `${where}.cueAt`),
    invalidAt: numOrNull(c.invalidAt, `${where}.invalidAt`),
  };
  if ("flagAt" in c) out.flagAt = num(c.flagAt, `${where}.flagAt`);
  out.effect = oneOf(c.effect, COMPENSATION_EFFECTS, where, "effect");
  out.unit = c.unit === null ? null : oneOf(c.unit, COMPENSATION_UNITS, where, "unit");
  out.when = c.when === null ? null : oneOf(c.when, ["above", "below"], where, "when");
  if ("windowDeg" in c)
    out.windowDeg = [num(c.windowDeg?.[0], `${where}.windowDeg`), num(c.windowDeg?.[1], `${where}.windowDeg`)];
  if ("forSeconds" in c) out.forSeconds = num(c.forSeconds, `${where}.forSeconds`);
  for (const k of ["orInvalid", "orFlag"])
    if (k in c) {
      knownFields(c[k], ["at", "unit"], `${where} ${k}`);
      out[k] = {
        at: num(c[k].at, `${where}.${k}.at`),
        unit: oneOf(c[k].unit, COMPENSATION_UNITS, where, "unit"),
      };
    }
  return out;
}

/** The camera distance: a range [from, to] in metres, or about one value. */
function distance(v, where) {
  if (Array.isArray(v) && v.length === 2) return [num(v[0], where), num(v[1], where)];
  return num(v, where);
}

export function movementDef(m, regions, cueIds = null) {
  const where = `movements ${m.id}`;
  knownFields(m, MOVEMENT_FIELDS, where);
  knownFields(m.angle ?? {}, ["landmarks", ...ANGLE_PROSE, ...ANGLE_NUMBERS], `${where} angle`);
  const region = regions.find((r) => r.id === (REGION_ALIASES[m.region] ?? m.region));
  if (!region) fail(`${where}: unknown region ${m.region}`);
  const landmarks = {};
  for (const [role, ref] of Object.entries(m.angle?.landmarks ?? {}))
    landmarks[role] = landmarkRef(ref, `${where} landmark ${role}`);
  const optional = (m.optional ?? []).map((text) => {
    const role = OPTIONAL_ROLES[text];
    if (!role) fail(`${where}: unknown optional landmark ${JSON.stringify(text)}`);
    if (!(role in landmarks)) landmarks[role] = STANDARD_ROLE_REFS[role];
    return role;
  });
  const gate = (m.gate ?? []).map((g) => {
    const any = /^(\w+) or (\w+)$/.exec(g);
    const roles = any ? [any[1], any[2]] : [g];
    for (const r of roles) if (!(r in landmarks)) fail(`${where}: gate role ${r} is not a landmark`);
    return any ? { anyOf: roles } : g;
  });
  const def = {
    id: m.id,
    version: m.version ?? 1,
    region: region.id,
    name: { ar: m.ar, en: m.en },
    plane: m.plane,
    verdict: m.verdict,
    cameraEvidence: cameraEvidence(m.cameraEvidence, where),
    kind: m.kind,
    canBeNegative: m.canBeNegative,
    priority: m.priority,
    view: m.view,
    axial: region.axial,
    distanceM: distance(m.distanceM, `${where}.distanceM`),
  };
  // The camera numbers the camera prose writes (the level where it says so, the abduction margin) and
  // the start pose's calibration hold.
  for (const k of ["levelWithinDeg", "frameMarginArmLengths", "calibrationSeconds"])
    if (k in m) def[k] = num(m[k], `${where}.${k}`);
  Object.assign(def, {
    positions: m.positions.map((p) => {
      const at = `${where} position ${p.id}`;
      const out = take(p, ["id", "graded", "normId", ...POSITION_NUMBERS], at);
      for (const k of POSITION_NUMBERS) if (k in out) num(out[k], `${at}.${k}`);
      return out;
    }),
    landmarks,
    gate,
    optional,
    compensationIds: m.compensations.map((c) => c.id),
    compensations: m.compensations.map((c) => compensation(c, cueIds, `${where} compensation ${c.id}`)),
  });
  for (const k of ANGLE_NUMBERS) if (k in m.angle) def[k] = num(m.angle[k], `${where}.angle.${k}`);
  Object.assign(def, {
    E: m.E,
    sigmaM: m.sigmaM,
    approximateInPersonView: m.approximateInPersonView ?? false,
    instructions: take(m.instructions, ["ar", "en"], `${where} instructions`),
  });
  for (const k of ["variantInstructions", "absoluteFloor", "bothDirections", "gravityAssisted", "resultName"])
    if (k in m) def[k] = strip(m[k]);
  return def;
}

function engineValues(engine) {
  const out = {};
  for (const [k, v] of Object.entries(engine)) {
    if (isObject(v)) knownFields(v, ["value"], `engine.${k}`);
    const value = isObject(v) && "value" in v ? v.value : v;
    if (typeof value === "number") out[k] = value;
    else if (ENGINE_PROSE[k] && value in ENGINE_PROSE[k]) out[k] = ENGINE_PROSE[k][value];
    else fail(`engine.${k}: unknown value ${JSON.stringify(value)}: add it to ENGINE_PROSE in export-v7.mjs`);
  }
  return out;
}

const LIMIT_FIELDS = [
  "sigmaM",
  "sdUsed",
  "sdEff",
  "capApplied",
  "floorApplied",
  "sdObserved",
  "zWithin",
  "zMarked",
  "withinFrom",
  "markedBelow",
  "withinUpTo",
  "markedAbove",
];
const ROW_FIELDS = ["sex", "ageMin", "ageMax", "side", "mean", "sd", "sdUsed", "n", "limits", "ci95", "sdDerived"];
const NORM_FIELDS = ["id", "movement", "source", "method", "position", "strength", "graded", "rows", "notes"];

function normLimits(limits, where) {
  knownFields(limits, [...LIMIT_FIELDS, "flag"], where);
  const out = pick(limits, LIMIT_FIELDS, where);
  if ("flag" in limits) {
    const id = /^(\w+):/.exec(limits.flag)?.[1];
    if (!NORM_FLAGS.includes(id)) fail(`${where}: unknown flag ${JSON.stringify(limits.flag)}`);
    out.flag = id;
  }
  return out;
}

function normDef(n) {
  const where = `norms ${n.id}`;
  knownFields(n, NORM_FIELDS, where);
  return {
    id: n.id,
    movement: n.movement,
    // rule 8: sources as arrays ("R7, R8" -> ["R7", "R8"])
    source: Array.isArray(n.source) ? n.source : String(n.source).split(/\s*,\s*/),
    position: n.position,
    strength: n.strength,
    graded: n.graded,
    rows: n.rows.map((r, i) => {
      knownFields(r, ROW_FIELDS, `${where} row ${i}`);
      return {
        sex: r.sex,
        ageMin: r.ageMin,
        ageMax: r.ageMax ?? null,
        ...("side" in r ? { side: r.side } : {}),
        mean: r.mean,
        sd: r.sd ?? null,
        sdUsed: r.sdUsed ?? null,
        n: r.n ?? null,
        limits: r.limits ? normLimits(r.limits, `${where} row ${i} limits`) : null,
      };
    }),
  };
}

/**
 * ROM prose the export drops, by object (rule 2 and the rule 3 field lists): engineers read it in
 * local-docs and the code that implements it quotes it. Known here so that any other field stops the
 * export.
 */
export const ROM_PROSE = {
  conventions: ["angles", "ang", "imageAxes", "midpoints", "lack", "wording"],
  problemTypes: ["rule", "programHint"],
  conditionAutoMap: ["regions", "problem", "ask2"],
  limbLoss: ["rule"],
  limbLossLevel: ["openQuestion", "standing"],
  positions: ["who"],
  inAffectedRegion: ["percentOfNormal", "finding", "bodyMap"],
  thresholds: [
    "terms",
    "SDeff",
    "withinNormal",
    "mildlyLimited",
    "markedlyLimited",
    "aboveTypical",
    "valueUsed",
    "percentOfNormal",
    "painPrecedence",
    "notGraded",
    "approximate",
  ],
  terms: ["N", "SD", "sigmaM", "b", "z"],
};

/**
 * limbLoss.levels[].present in words to region ids (A4-8): «hip, knee (residual)» -> ["hip", "knee"],
 * the bracketed words dropped; a word that is not a region id fails the export.
 */
export function presentRegions(text, where) {
  if (typeof text !== "string") fail(`${where}: present is missing`);
  const ids = text.replace(/\s*\([^)]*\)/g, "").split(/\s*,\s*/);
  for (const id of ids)
    if (!REGION_IDS.includes(id)) fail(`${where}: present ${JSON.stringify(text)}: ${id} is not a region id`);
  return ids;
}

/** limbLoss.levels: the present regions, the measured movements and the reason id of each one not measured. */
function limbLossLevels(limbLoss, reasonOf) {
  knownFields(limbLoss, ["levels", ...ROM_PROSE.limbLoss], "limbLoss");
  return {
    levels: limbLoss.levels.map((l) => {
      const where = `limbLoss ${l.level}`;
      knownFields(l, ["level", "present", "measured", "notMeasured", ...ROM_PROSE.limbLossLevel], where);
      return {
        level: l.level,
        present: presentRegions(l.present, where),
        measured: l.measured,
        notMeasured: Object.fromEntries(
          Object.entries(l.notMeasured).map(([m, text]) => [m, reasonOf(text, `${where} ${m}`)]),
        ),
      };
    }),
  };
}

/**
 * A condition's own movement set (Parkinson's, review A10; D-024 item 4): { movement, position? }, the
 * rule words beside each entry dropped. Each movement must exist and the position must be one of its
 * positions.
 */
function movementSet(entries, movements, where) {
  if (!Array.isArray(entries)) fail(`${where} movementSet is not a list`);
  return entries.map((x) => {
    const movement = movements.find((m) => m.id === x?.movement);
    if (!movement) fail(`${where} movementSet: unknown movement ${x?.movement}`);
    knownFields(x, ["movement", "position", "rule"], `${where} movementSet ${x.movement}`);
    if ("position" in x && !movement.positions.some((p) => p.id === x.position))
      fail(`${where} movementSet: ${x.movement} has no position ${x.position}`);
    return pick(x, ["movement", "position"], where);
  });
}

/** The fields of a retest band (D-024 item 4): a movement's band, the neurological limb's and the wide band. */
export const RETEST_BAND_FIELDS = [
  "deg",
  "neurologicalDeg",
  "neurologicalLabDeg",
  "neurologicalHomeDeg",
  "position",
  "wideDeg",
];

/**
 * retest: the change bands compareRom reads (B4; review B15), copied from the rule in words, which
 * stays in local-docs. A band is keyed by movement, or by region where the rule names a region (elbow).
 */
function retest(r, movements) {
  knownFields(r, ["floorDeg", "defaultDeg", "bands", "rule"], "retest");
  for (const [k, band] of Object.entries(r.bands ?? fail("retest.bands is missing"))) {
    const where = `retest band ${k}`;
    const movement = movements.find((m) => m.id === k);
    if (!movement && !REGION_IDS.includes(k)) fail(`${where}: not a movement or region id`);
    knownFields(band, RETEST_BAND_FIELDS, where);
    for (const f of RETEST_BAND_FIELDS) if (f in band && f !== "position") num(band[f], `${where}.${f}`);
    if ("position" in band && !movement?.positions.some((p) => p.id === band.position))
      fail(`${where}: position ${band.position} is not a position of the movement`);
  }
  return {
    floorDeg: num(r.floorDeg, "retest.floorDeg"),
    defaultDeg: num(r.defaultDeg, "retest.defaultDeg"),
    bands: strip(r.bands),
  };
}

/** sessionOrder: the measured cap of a check (MAX_MEASURED_PER_CHECK) and the minutes per movement (C-6). */
function sessionOrder(o) {
  knownFields(o, ["maxMeasured", "minutesPerMovement", "rule"], "sessionOrder");
  return {
    maxMeasured: num(o.maxMeasured, "sessionOrder.maxMeasured"),
    minutesPerMovement: num(o.minutesPerMovement, "sessionOrder.minutesPerMovement"),
  };
}

/**
 * thresholds: the numbers of the grading rules, copied next to their words (A4-8: the SD cap, the z
 * cut points, the percent of normal rule, the arm raise over read and the phone bias of terms.b), and
 * the functional floors. The rules in words are implemented in rom-norms.ts.
 */
export const THRESHOLD_NUMBERS = [
  "sdCap",
  "zWithinMin",
  "zMarkedBelow",
  "percentOfNormalMinN",
  "elevationOverReadAbove",
];
function thresholds(t) {
  knownFields(t, [...THRESHOLD_NUMBERS, "functionalFloor", ...ROM_PROSE.thresholds], "thresholds");
  knownFields(t.terms ?? {}, [...ROM_PROSE.terms, "phoneBias"], "thresholds terms");
  knownFields(t.sdCap ?? {}, ["pctOfN", "fromMeanDeg"], "thresholds sdCap");
  return {
    sdCap: {
      pctOfN: num(t.sdCap?.pctOfN, "thresholds.sdCap.pctOfN"),
      fromMeanDeg: num(t.sdCap?.fromMeanDeg, "thresholds.sdCap.fromMeanDeg"),
    },
    zWithinMin: num(t.zWithinMin, "thresholds.zWithinMin"),
    zMarkedBelow: num(t.zMarkedBelow, "thresholds.zMarkedBelow"),
    percentOfNormalMinN: num(t.percentOfNormalMinN, "thresholds.percentOfNormalMinN"),
    elevationOverReadAbove: num(t.elevationOverReadAbove, "thresholds.elevationOverReadAbove"),
    phoneBias: num(t.terms?.phoneBias, "thresholds.terms.phoneBias"),
    functionalFloor: strip(t.functionalFloor),
  };
}

export function exportRom(source) {
  checkSections("rom", source);
  const reasonIds = source.reasonIds;
  const reasonOf = (text, where) => {
    const id = /^([a-z_]+)/.exec(text)?.[1];
    if (!id || !(id in reasonIds)) fail(`${where}: no reason id in ${JSON.stringify(text)}`);
    return id;
  };
  const regions = source.regions.map((r) => take(r, ["id", "ar", "en", "axial", "label"], `regions ${r.id}`));
  const norms = source.norms.map(normDef);
  const normSourceIds = [...new Set(norms.flatMap((n) => n.source))];
  const out = {
    id: source.id,
    specVersion: source.specVersion,
    status: source.status,
    signoff: take(source.signoff, ["status", "approved", "approvers"], "signoff"),
    conventions: take(source.conventions, ["sides"], "conventions", ROM_PROSE.conventions),
    engine: engineValues(source.engine),
    regions,
    regionTable: strip(source.regionTable),
    problemTypes: source.problemTypes.map((p) =>
      take(p, ["id", "ar", "en"], `problemTypes ${p.id}`, ROM_PROSE.problemTypes),
    ),
    conditionAutoMap: source.conditionAutoMap.map((c) => {
      const where = `conditionAutoMap ${c.condition}`;
      knownFields(c, ["condition", "ask", "answers", "movementSet", ...ROM_PROSE.conditionAutoMap], where);
      // ask2 repeats copy.arthritis_type_ask (change log, A1): dropped, its fields still checked.
      if ("ask2" in c) knownFields(c.ask2, ["ar", "en"], `${where} ask2`);
      return {
        condition: c.condition,
        ask: take(c.ask, ["ar", "en"], `${where} ask`),
        answers: c.answers.map((a) => take(a, ["ar", "en"], `${where} answer`, ["map"])),
        ...("movementSet" in c ? { movementSet: movementSet(c.movementSet, source.movements, where) } : {}),
      };
    }),
    limbLoss: limbLossLevels(source.limbLoss, reasonOf),
    positions: Object.fromEntries(
      Object.entries(source.positions).map(([id, p]) => [
        id,
        take(p, ["ar", "en"], `positions ${id}`, ROM_PROSE.positions),
      ]),
    ),
    movements: source.movements.map((m) =>
      movementDef(m, regions, new Set([...Object.keys(source.cues ?? {}), ...V1_CUE_IDS])),
    ),
    defaultMovements: source.defaultMovements.map((d) => {
      const where = `defaultMovements ${d.id}`;
      return {
        ...take(d, ["id", "region", "ar", "en", "normId"], where, ["inAffectedRegion"]),
        inAffectedRegion: take(
          d.inAffectedRegion,
          ["source"],
          `${where} inAffectedRegion`,
          ROM_PROSE.inAffectedRegion,
        ),
      };
    }),
    norms,
    thresholds: thresholds(source.thresholds),
    retest: retest(source.retest, source.movements),
    sessionOrder: sessionOrder(source.sessionOrder),
    safety: source.safety.map((s) => take(s, ["id", "rule", "action"], `safety ${s.id}`)),
    reasonIds: strip(reasonIds),
    copy: strip(source.copy),
    cues: strip(source.cues),
    results: strip(source.results),
    sideWords: strip(source.sideWords),
    citations: citations(source.sources, normSourceIds, "norms"),
  };
  return normaliseRegions(out, "rom");
}

/* ------------------------------------------------------------------ gait */

const METRIC_FIELDS = ["id", "views", "unit", "grade", "gradeFront", "gradePad", "gradeHyperextension"];
/** Numbers a metric's definition writes (flat contact at or below 0, the last 3 s of the static stance). */
const METRIC_NUMBERS = ["flatAtOrBelow", "measureLast_s"];
const METRIC_KNOWN = [
  ...METRIC_FIELDS,
  ...METRIC_NUMBERS,
  "notReportedBelowFps",
  "use",
  "definition",
  "aggregation",
  "error",
  "basis",
];
/** The gait views (GaitView): metric, pattern and finding views must be these ids (D-024 item 3). */
export const GAIT_VIEWS = ["front", "back", "side", "pad_side", "pad_front"];
/**
 * Signs a pattern reads that are not metrics of one view (D-024 item 3): the between limb differences
 * of the knee and thigh swing peaks, and the Pillar 1 hip extension of the range profile.
 */
export const GAIT_DERIVED_SIGN_IDS = [
  "knee_swing_peak_between_limb_diff",
  "thigh_swing_peak_between_limb_diff",
  "pillar1_hip_extension",
];
/** Pattern fields that are prose about the rule, read in local-docs (patterns "(structured)"). */
export const PATTERN_PROSE = ["section", "sides", "labelRule"];
const FINDING_FIELDS = ["id", "views", "grade", "gradeFront", "thresholds", "targets", "copyTargets"];
/** Finding prose, implemented by the gait rules (C): the rule text, its use and the speed notes. */
const FINDING_PROSE = ["rule", "use", "padNote", "error", "feeds"];

function gaitNormSourceIds(norms, sourceTable) {
  const ids = [];
  const visit = (v, key) => {
    if (typeof v === "string" && (key === "source" || key === "sources") && v in sourceTable) ids.push(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(norms, "");
  return [...new Set(ids)];
}

function gaitViews(views, where) {
  if (!Array.isArray(views)) fail(`${where}: views is not a list`);
  for (const v of views) if (!GAIT_VIEWS.includes(v)) fail(`${where}: view ${JSON.stringify(v)} is not a gait view`);
  return views;
}

/** Every leaf a number (a finding's thresholds): a number written as text fails. */
function numbersTree(v, where) {
  if (isObject(v)) for (const x of Object.values(v)) numbersTree(x, where);
  else num(v, where);
  return v;
}

/** A pattern (structured: its prose fields dropped), with its views and sign metrics checked. */
function pattern(p, metricIds) {
  const where = `patterns ${p.id}`;
  gaitViews(p.views, where);
  for (const sign of p.signs ?? [])
    if (!metricIds.includes(sign.metric) && !GAIT_DERIVED_SIGN_IDS.includes(sign.metric))
      fail(`${where}: sign metric ${sign.metric} is not a metric or a derived sign`);
  return strip(Object.fromEntries(Object.entries(p).filter(([k]) => !PATTERN_PROSE.includes(k))));
}

/** grades: the measurement grades (the evidence scale and the basis types are documentation). */
function grades(g) {
  knownFields(g, ["measurement", "basisTypes"], "grades");
  knownFields(g.basisTypes ?? {}, ["published", "calc", "engineering"], "grades basisTypes");
  return { measurement: strip(g.measurement) };
}

export function exportGait(source) {
  checkSections("gait", source);
  const cm = source.confidenceModel;
  const out = {
    id: source.id,
    version: source.version,
    status: source.status,
    signoff: take(source.signoff, ["approved", "approvers"], "signoff"),
    grades: grades(source.grades),
    eligibility: strip(source.eligibility),
    capture: numbersOnly(source.capture),
    preprocessing: source.preprocessing.map((p) => ({ step: p.step, ...numbersOnly(p) })),
    events: numbersOnly(source.events),
    metrics: source.metrics.map((m) => {
      const where = `metrics ${m.id}`;
      knownFields(m, METRIC_KNOWN, where);
      gaitViews(m.views, where);
      const out = {
        ...pick(m, METRIC_FIELDS, where),
        ...("notReportedBelowFps" in m ? { notReportedBelowFps: m.notReportedBelowFps } : {}),
        use: m.use,
      };
      for (const k of METRIC_NUMBERS) if (k in m) out[k] = num(m[k], `${where}.${k}`);
      return out;
    }),
    scaling: numbersOnly(source.scaling),
    qualityGates: strip(source.qualityGates),
    norms: strip(source.norms),
    errorMargins: numbersOnly(source.errorMargins),
    retest: take(source.retest, ["realChange"], "retest", ["likeWithLike"]),
    // "(lists)": the structured fields; the prose rules (firing, corroboration, ...) are code
    confidenceModel: Object.fromEntries(
      Object.entries(cm).filter(([k, v]) => typeof v !== "string" && !DROP_ANYWHERE.includes(k)),
    ),
    patterns: source.patterns.map((p) => pattern(p, source.metrics.map((m) => m.id))),
    findings: source.findings.map((f) => {
      const where = `findings ${f.id}`;
      const out = take(f, FINDING_FIELDS, where, FINDING_PROSE);
      gaitViews(out.views, where);
      if ("thresholds" in out) numbersTree(out.thresholds, `${where}.thresholds`);
      return out;
    }),
    copy: strip(source.copy),
    citations: citations(source.sources, gaitNormSourceIds(source.norms, source.sources), "gait norms"),
  };
  return normaliseRegions(out, "gait");
}


/* --------------------------------------------------------------- targets */

/** Dose profile prose: the evidence, its strength and the proposal in words (the numbers object is kept). */
const DOSE_PROSE = ["caveat", "strength", "proposal"];

/** Mapping parts that are prose lists of the algorithm (merge, selection), implemented in code. */
export const MAPPING_PROSE = ["merge", "selection", "whyLines"];

export function hipEndRange(items, where) {
  return items.map((text) => {
    const id = /^([a-z_0-9]+)/.exec(text)?.[1];
    if (!HIP_END_RANGE_IDS.includes(id)) fail(`${where}: unknown hip end range ${JSON.stringify(text)}`);
    return id;
  });
}

/** dose: the profiles (id, names and their numbers) and the session order. */
function dose(d) {
  knownFields(d, ["profiles", "sessionOrder"], "dose");
  return {
    profiles: d.profiles.map((p) => take(p, ["id", "ar", "en", "numbers"], `dose ${p.id}`, DOSE_PROSE)),
    sessionOrder: strip(d.sessionOrder),
  };
}

export function exportTargets(source) {
  checkSections("targets", source);
  const out = {
    id: source.id,
    version: source.version,
    status: source.status,
    signoff: take(source.signoff, ["approved", "approvers"], "signoff"),
    placeholders: strip(source.placeholders),
    taxonomy: strip(source.taxonomy),
    dose: dose(source.dose),
    libraryTags: strip(source.libraryTags),
    newExercises: source.newExercises.map((e) => {
      const x = strip(e);
      if ("hipEndRange" in x) x.hipEndRange = hipEndRange(x.hipEndRange, `newExercises ${e.id}`);
      return x;
    }),
    contraindicationVocabulary: strip(source.contraindicationVocabulary),
    mapping: strip(
      Object.fromEntries(Object.entries(source.mapping).filter(([k]) => !MAPPING_PROSE.includes(k))),
    ),
    whyLines: strip(source.mapping.whyLines ?? fail("mapping.whyLines is missing")),
  };
  return normaliseRegions(out, "targets");
}

/* ------------------------------------------------- --report-prose-numbers */

/**
 * Text that names something rather than counting it, masked before numberTokens reads the numbers:
 * dates and years, licence names, decision ids (D-003, C-7), section and file references (section
 * 2.4, rule 2, plan §3.2, rom.md 3.4, v1.1 4.1, Q12, 4.3, exercise-targets 5.6, contract 2.5, Pillar 1)
 * and ids written with letters and digits (R46, v1.1, Q6, T6, MDC95, fang18, Stenum24, G§5, 2D).
 */
const REFERENCES = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:19|20)\d\d\b/g,
  /\bBSD-\d+\b/g,
  /\b[A-Z]-\d+\b/g,
  /\bQ\d+,\s*\d+(?:\.\d+)+/g,
  /\b(?:rom|gait|oss|live|plan)\.md\s+\d+(?:\.\d+)*/g,
  /\b(?:rom-protocol|gait-rules|exercise-targets|contract|v1\.1|gait|council|RP|GR)\s+(?:sections?\s+)?\d+(?:\.\d+)*/g,
  /(?:\b(?:sections?|rules?|appendix|(?:open )?questions?|Pillar)\s+|§)\d+(?:\.\d+)*/gi,
  /[A-Za-z_§][A-Za-z_§]*\d+(?:\.\d+)*[A-Za-z_\d]*/g,
  /\b\d+D\b/g,
];

/** The numbers a piece of prose writes with digits (ordinals included), references left out. */
export function numberTokens(text) {
  let t = String(text);
  for (const re of REFERENCES) t = t.replace(re, (m) => " ".repeat(m.length));
  const out = [];
  for (const m of t.matchAll(/(?<![\w.])[-\u2212]?\d+(?:\.\d+)?(?=(?:st|nd|rd|th)\b|[^\w]|$)/g))
    out.push(Number(m[0].replace("\u2212", "-")));
  return out;
}

/**
 * Prose numbers that need no numeric field, each with the reason (the change log of the contract
 * lists the same). A rule names the source path (a [*] matches any index, a * any key) and,
 * when only some numbers of that prose are meant, those numbers.
 */
export const PROSE_NUMBER_EXEMPT = [
  {
    file: "rom",
    path: "norms[*].method",
    why: "how the norm source measured: evidence (study design, sample, instrument), not a rule",
  },
];

/** Prose the export turns into a structure through one of its tables (covered as a whole). */
const TABLE_PROSE = [
  ["rom", /^engine\.(\w+)\.value$/, (m, text) => text in (ENGINE_PROSE[m[1]] ?? {})],
  ["rom", /^movements\[\d+\]\.optional\[\d+\]$/, (_, text) => text in OPTIONAL_ROLES],
  [
    "rom",
    /^movements\[\d+\]\.angle\.landmarks\.\w+$/,
    (_, text) => LANDMARK_PROSE.some(([re]) => re.test(text)),
  ],
];

const globRegex = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+?^${}()|\\]/g, "\\$&")
      .replace(/\[\*\]/g, "\\[\\d+\\]")
      .replace(/\*/g, "[^.\\[]+")}$`,
  );
const EXEMPT_RULES = () => PROSE_NUMBER_EXEMPT.map((r) => ({ ...r, re: globRegex(r.path) }));

/** Numbers held by the fields of an object: numbers, arrays of numbers and nested objects (not lists of rows). */
function numericLeaves(v, acc = new Set()) {
  if (typeof v === "number") acc.add(v);
  else if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== "object")) for (const x of v) numericLeaves(x, acc);
  } else if (isObject(v))
    for (const [k, x] of Object.entries(v)) if (!DROP_ANYWHERE.includes(k)) numericLeaves(x, acc);
  return acc;
}

/** An object whose fields are all prose (a map of rules in words): its numbers sit next to it. */
const isProseMap = (o) =>
  Object.entries(o).every(([k, v]) => DROP_ANYWHERE.includes(k) || typeof v === "string" || v === null);

/**
 * --report-prose-numbers: every number that prose inside a kept section of a clinical source writes
 * with digits and that no numeric field next to the prose holds (the same object; for a map of prose,
 * the object holding the map), so the code would have to read it from words. Copy shown to a person
 * (ar, en) and review material (rule 2) are not read; prose the export structures through a table is
 * covered; PROSE_NUMBER_EXEMPT files the rest by reason. The freeze step copies every listed number
 * into a numeric field next to its prose (D-023 item 5, D-024 item 4).
 */
export function proseNumbers(name, source) {
  const rules = EXEMPT_RULES().filter((r) => r.file === name);
  const listed = [];
  const exempt = {};
  const prose = (text, path, covered) => {
    let numbers = numberTokens(text);
    if (!numbers.length) return;
    if (TABLE_PROSE.some(([file, re, ok]) => file === name && re.test(path) && ok(re.exec(path), text))) return;
    numbers = numbers.filter((n) => !covered.has(n));
    for (const r of rules) {
      if (!numbers.length || !r.re.test(path)) continue;
      const hit = numbers.filter((n) => !r.numbers || r.numbers.includes(n));
      if (hit.length) exempt[r.why] = (exempt[r.why] ?? 0) + 1;
      numbers = numbers.filter((n) => !hit.includes(n));
    }
    if (numbers.length) listed.push({ path, text, numbers: [...new Set(numbers)] });
  };
  const visit = (v, path, holder, holderParent) => {
    if (typeof v === "string") {
      const covered = numericLeaves(holder);
      if (holderParent && isProseMap(holder)) numericLeaves(holderParent, covered);
      prose(v, path, covered);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`, isObject(x) ? x : holder, isObject(x) ? null : holderParent));
    } else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (DROP_ANYWHERE.includes(k) || USER_FACING_KEYS.has(k)) continue;
        visit(x, `${path}.${k}`, isObject(x) ? x : v, isObject(x) ? v : holderParent);
      }
    }
  };
  const seen = new Set();
  for (const section of KEEP[name]) {
    const from = DERIVED[section] ?? section;
    if (from === "sources" || seen.has(from) || !(from in source)) continue;
    seen.add(from);
    // A section is its own holder: nothing outside it covers its prose.
    const v = source[from];
    if (typeof v === "string") prose(v, from, new Set());
    else visit(v, from, isObject(v) ? v : {}, null);
  }
  return { listed, exempt };
}

/* ------------------------------------------------------------------ main */

/**
 * Builds the three runtime files from the three clinical sources.
 * Returns { data: { rom, gait, targets } } or { errors }.
 */
export function exportV7(sources) {
  const errors = [];
  const data = {};
  const builders = { rom: exportRom, gait: exportGait, targets: exportTargets };
  for (const [name, build] of Object.entries(builders)) {
    try {
      data[name] = build(sources?.[name]);
    } catch (e) {
      if (!(e instanceof ExportError)) throw e;
      errors.push(...e.message.split("\n"));
      continue;
    }
    const wording = dataViolations(data[name], OUTPUT_FILES[name].split("/").pop());
    errors.push(...wording.map((w) => `wording: ${w}`));
  }
  return errors.length ? { errors } : { data };
}

/** The --input folder from the arguments, or null. */
export function inputArg(argv) {
  const i = argv.indexOf("--input");
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--input="));
  return eq ? eq.slice("--input=".length) || null : null;
}

function main() {
  const input = inputArg(process.argv.slice(2));
  if (!input) {
    console.error(
      "Usage: node scripts/clinical/export-v7.mjs --input <folder with rom-protocol.json, gait-rules.json, exercise-targets.json>",
    );
    console.error("The clinical folder is /Users/nasser/Development/Azm6.0/local-docs/clinical/v7 (C-1).");
    process.exit(1);
  }
  const sources = {};
  for (const [name, file] of Object.entries(INPUT_FILES)) {
    const path = join(resolve(input), file);
    try {
      sources[name] = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`Cannot read ${path}: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  }
  const { data, errors } = exportV7(sources);
  if (errors) {
    console.error(`Not exported (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  if (!process.argv.includes("--dry-run"))
    for (const [name, file] of Object.entries(OUTPUT_FILES)) {
      const path = join(ROOT, file);
      const text = JSON.stringify(data[name], null, 2) + "\n";
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`Wrote ${relative(ROOT, path)}: ${Buffer.byteLength(text)} bytes`);
    }
  if (process.argv.includes("--report-prose-numbers")) {
    let count = 0;
    for (const name of Object.keys(INPUT_FILES)) {
      const { listed, exempt } = proseNumbers(name, sources[name]);
      count += listed.length;
      for (const l of listed) console.log(`${name} ${l.path} [${l.numbers.join(", ")}] ${JSON.stringify(l.text)}`);
      for (const [why, n] of Object.entries(exempt)) console.log(`${name} exempt (${n}): ${why}`);
    }
    console.log(`Prose numbers without a numeric field: ${count}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
