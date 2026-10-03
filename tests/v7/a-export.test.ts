/**
 * scripts/clinical/export-v7.mjs (product v7 contract, C-1 and 2.1). The clinical sources live in the
 * git ignored local-docs of the main checkout, so these tests rebuild source like inputs from the
 * committed runtime files: every dropped section and field is added back, every structure the
 * exporter makes from prose is written back as that prose, and the export must return exactly the
 * committed files. Targeted cases then cover each exporter rule.
 *
 * With AZM_CLINICAL_V7 set to the clinical folder, the real sources are exported too and must match
 * the committed files byte for byte.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DROP_ANYWHERE,
  DROP_TOP,
  ENGINE_PROSE,
  HIP_END_RANGE_IDS,
  KEEP,
  OPTIONAL_ROLES,
  OUTPUT_FILES,
  STANDARD_ROLE_REFS,
  exportGait,
  exportRom,
  exportTargets,
  exportV7,
  hipEndRange,
  inputArg,
  landmarkRef,
  movementDef,
  normaliseRegions,
  numbersOnly,
  strip,
} from "../../scripts/clinical/export-v7.mjs";

type Obj = Record<string, any>;
const ROOT = join(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/clinical/export-v7.mjs");
const committedText = (name: "rom" | "gait" | "targets") =>
  readFileSync(join(ROOT, OUTPUT_FILES[name]), "utf8");
const committed = (name: "rom" | "gait" | "targets"): Obj => JSON.parse(committedText(name));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Review material on every object, at any depth: dropped by the export. */
function withReviewFields(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withReviewFields);
  if (v && typeof v === "object") {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) out[k] = withReviewFields(x);
    return { ...out, note: "Review note — dropped", basis: "R1 − dropped", cites: ["R1"] };
  }
  return v;
}

/* ------------------------------------------------- source like inputs */

const LANDMARK_TEXT = (ref: unknown): unknown => {
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    const r = ref as Obj;
    if ("mid" in r) return `mid(${r.mid[0]}, ${r.mid[1]})${r.fixed ? " fixed at calibration" : ""}`;
    if (r.other === "hip") return "the other hip (23 or 24)";
    if (r.other === "knee") return "other knee";
  }
  return ref;
};
const OPTIONAL_TEXT: Record<string, string> = {
  W: "W (wrist, for the elbow check)",
  ears: "ears 7 and 8 (shrug logging)",
  Kother: "other knee",
  hips: "hip line",
};
const ENGINE_TEXT = (key: string, value: unknown): unknown => {
  for (const [text, v] of Object.entries(ENGINE_PROSE[key] ?? {}))
    if (JSON.stringify(v) === JSON.stringify(value)) return text;
  return value;
};

function romSource(): Obj {
  const rom = committed("rom");
  const movements = rom.movements.map((m: Obj) => {
    const { name, axial: _axial, version, landmarks, gate, optional, compensationIds, ...rest } = m;
    return {
      ...rest,
      ...(version === 1 ? {} : { version }),
      ar: name.ar,
      en: name.en,
      camera: "Side view, phone level within 5 degrees",
      startPose: "Seated",
      angle: {
        definition: "theta = ang(E − S, H − S)",
        landmarks: Object.fromEntries(Object.entries(landmarks).map(([k, v]) => [k, LANDMARK_TEXT(v)])),
        reference: "Trunk line",
        zero: "0 = arm along the trunk",
        direction: "Flexion only",
      },
      gate: gate.map((g: unknown) => (typeof g === "string" ? g : (g as Obj).anyOf.join(" or "))),
      optional: optional.map((r: string) => OPTIONAL_TEXT[r] ?? r),
      compensations: compensationIds.map((id: string) => ({
        id,
        check: "Trunk tilt",
        cue: "> 5 degrees",
        invalid: "> 10 degrees",
      })),
      Ebasis: "LoA −6.2 to 12.9",
      knownBias: "Phone reads higher",
      sigmaMBasis: "class floor",
      ...(m.id === "hip_extension" ? { feeds: "Only possible flexion contracture" } : {}),
    };
  });
  const sources: Obj = Object.fromEntries(
    rom.citations.map((c: Obj) => [c.id, { cite: c.cite, url: c.url, opened: "today", rom: "rom.md" }]),
  );
  sources.R99 = { cite: "Not a norm source — dropped", url: "https://example.org", opened: "today" };
  const source: Obj = {
    id: rom.id,
    specVersion: rom.specVersion,
    reviewRound: "1",
    status: rom.status,
    date: "2026-10-04",
    signoff: { ...rom.signoff, note: "Draft" },
    decision: "D-019",
    builtFrom: ["plan"],
    evidenceScale: { High: "x" },
    conventions: { ...rom.conventions, angles: "pixel space", lack: "short of straight" },
    sources,
    landmarks: { "0": "nose" },
    engine: Object.fromEntries(
      Object.entries(rom.engine).map(([k, v]) => [k, { value: ENGINE_TEXT(k, v), basis: "proposal" }]),
    ),
    regions: rom.regions,
    regionTable: withReviewFields(rom.regionTable),
    problemTypes: rom.problemTypes.map((p: Obj) => ({ ...p, rule: "Measure", programHint: "Range" })),
    conditionAutoMap: rom.conditionAutoMap.map((c: Obj) => ({
      ...c,
      answers: c.answers.map((a: Obj) => ({ ...a, map: "that side's arm and leg" })),
      regions: "That side",
      problem: "weakness",
      notes: "Existing rules stay — dropped",
    })),
    limbLoss: {
      rule: "A movement is measured only when every landmark is present",
      levels: rom.limbLoss.levels.map((l: Obj) => ({
        ...l,
        present: "hip",
        notMeasured: Object.fromEntries(
          Object.entries(l.notMeasured).map(([m, r]) => [
            m,
            r === "not_measured_camera" ? `${r} (residual joint present): refer_measure` : r,
          ]),
        ),
        openQuestion: "Confirm",
      })),
    },
    positions: Object.fromEntries(
      Object.entries(rom.positions).map(([k, p]) => [k, { ...(p as Obj), who: "everyone", basis: "R46" }]),
    ),
    movements,
    defaultMovements: rom.defaultMovements.map((d: Obj) => ({
      ...d,
      why: "Out of plane",
      cites: ["R1"],
      inAffectedRegion: { ...d.inAffectedRegion, percentOfNormal: null, finding: "unknown", bodyMap: "grey" },
    })),
    norms: rom.norms.map((n: Obj) => ({
      ...n,
      source: n.source.length === 2 ? n.source.join(", ") : n.source,
      method: "Active, standing",
      notes: "Read from the table image",
      rows: n.rows.map((r: Obj) => {
        const row: Obj = { ...r };
        if (row.sdUsed === null) delete row.sdUsed;
        if (row.limits?.flag)
          row.limits = { ...row.limits, flag: `${row.limits.flag}: only sigma_m is used` };
        if (row.limits === null) delete row.limits;
        return row;
      }),
    })),
    normSelection: ["Take the norm id of the position"],
    thresholds: {
      terms: { b: "phone bias" },
      functionalFloor: withReviewFields(rom.thresholds.functionalFloor),
    },
    functionalCrossCheck: [{ movement: "shoulder_flexion", text: "Daily tasks" }],
    retest: "Proposal",
    sessionOrder: "Proposal",
    safety: rom.safety.map((s: Obj) => ({ ...s, evidence: "Proposal" })),
    reasonIds: rom.reasonIds,
    copy: rom.copy,
    cues: rom.cues,
    results: rom.results,
    sideWords: rom.sideWords,
    openQuestions: ["Q1"],
    notVerified: ["V1"],
    reviewLog: { issues: [] },
  };
  return source;
}

function gaitSource(): Obj {
  const g = committed("gait");
  const sources: Obj = Object.fromEntries(
    g.citations.map((c: Obj) => [c.id, { cite: c.cite, url: c.url, access: "full text", openedBy: "x" }]),
  );
  sources.Zeni08 = { cite: "Zeni — not a norm source", url: "https://example.org" };
  return {
    id: g.id,
    version: g.version,
    reviewRound: "1",
    status: g.status,
    date: "2026-10-04",
    author: "tech lead",
    decision: "D-019 item 2",
    plan: "plan",
    twin: "gait-rules.md",
    signoff: { ...g.signoff, note: "Draft" },
    consumers: ["src/medical/gait-rules.ts"],
    citationKeys: "Keys",
    grades: { measurement: g.grades.measurement, evidence: ["High"], basisTypes: { calc: "calc" } },
    conventions: { landmarks: "MediaPipe" },
    eligibility: withReviewFields(g.eligibility),
    capture: { ...g.capture, common: { ...g.capture.common, model: "Full when >= 25 fps" } },
    preprocessing: g.preprocessing.map((p: Obj) => ({
      ...p,
      rule: "Hampel filter window 7",
      sources: ["x"],
    })),
    events: { ...g.events, front: { method: "Stenum 2024", gives: "IC only" } },
    metrics: g.metrics.map((m: Obj) => ({
      ...m,
      definition: "IC to IC",
      aggregation: "median",
      ...(m.id === "pelvic_drop" ? { views2: ["back (away passes)"] } : {}),
    })),
    scaling: { ...g.scaling, overgroundFront: "no metres in the MVP" },
    qualityGates: withReviewFields(g.qualityGates),
    // The per entry source lists of norms.kinematics are dropped; one list brings their ids back.
    norms: { ...g.norms, sources: g.citations.map((c: Obj) => c.id) },
    errorMargins: { ...g.errorMargins, thresholdRule: "possible = upper normal limit + 1 E" },
    retest: { likeWithLike: ["same mode"], basis: "Puh09", realChange: g.retest.realChange },
    confidenceModel: { ...g.confidenceModel, firing: "per side", painDayRule: "leg pain 4 or 5" },
    patterns: g.patterns.map((p: Obj) => ({
      ...p,
      section: "5.1",
      sides: "per side",
      labelRule: "prosthetic_side when",
      evidence: { pattern: "Moderate" },
      sources: ["Pirker"],
    })),
    findings: g.findings.map((f: Obj) => ({ ...f, rule: "foot_pitch_ic <= 0", use: "support finding" })),
    notInMvp: ["ankle angles"],
    copy: g.copy,
    openQuestions: ["Q1"],
    engineering: { ports: [] },
    sources,
    reviewLog: { issues: [] },
  };
}

function targetsSource(): Obj {
  const t = committed("targets");
  const regionDefaultRule = clone(t.mapping.regionDefaultRule);
  for (const row of regionDefaultRule.rows ?? [])
    if (row.region === "forearm_wrist") row.region = "forearm_and_wrist";
  return {
    id: t.id,
    version: t.version,
    status: t.status,
    reviewRound: "1",
    date: "2026-10-04",
    decision: "D-019",
    twin: "exercise-targets.md",
    builtFrom: ["plan"],
    signoff: { ...t.signoff, note: "Waits for both reviewers" },
    consumers: ["src/medical/targets.ts"],
    evidenceScale: { levels: [] },
    placeholders: t.placeholders,
    wordingRules: "Arabic first",
    taxonomy: t.taxonomy,
    dose: {
      profiles: t.dose.profiles.map((p: Obj) => ({ ...p, basis: [["ACSM11", "60 s"]], caveat: "c" })),
      sessionOrder: withReviewFields(t.dose.sessionOrder),
    },
    libraryTags: t.libraryTags.map((x: Obj) => ({ ...x, note: "Overhead" })),
    newExercises: t.newExercises.map((e: Obj) => ({
      ...e,
      evidence: { strength: "Very low", refs: ["Winstein16"] },
      ...(e.hipEndRange
        ? { hipEndRange: e.hipEndRange.map((h: string, i: number) => (i ? `${h} (lying on the side)` : h)) }
        : {}),
    })),
    contraindicationVocabulary: t.contraindicationVocabulary,
    mapping: {
      ...t.mapping,
      regionDefaultRule,
      merge: ["The same target on the same side is one target"],
      selection: ["Start from the eligible pool"],
      whyLines: t.whyLines,
    },
    coverage: { criteria: "x" },
    openQuestions: ["Q1"],
    notVerified: ["V1"],
    sources: { ACSM11: { cite: "ACSM" } },
    reviewLog: { issues: [] },
  };
}

const sources = () => ({ rom: romSource(), gait: gaitSource(), targets: targetsSource() });

/* ------------------------------------------------------------------ tests */

describe("v7 clinical export: round trip to the committed files", () => {
  it("returns exactly the committed files from source like inputs", () => {
    const { data, errors } = exportV7(sources());
    expect(errors).toBeUndefined();
    for (const name of ["rom", "gait", "targets"] as const) {
      expect(data![name]).toEqual(committed(name));
      expect(JSON.stringify(data![name], null, 2) + "\n").toBe(committedText(name));
    }
  });

  it("keeps exactly the kept sections, in order", () => {
    for (const name of ["rom", "gait", "targets"] as const)
      expect(Object.keys(committed(name))).toEqual([...KEEP[name]]);
    expect(DROP_ANYWHERE).toEqual(
      expect.arrayContaining(["sources", "cites", "basis", "evidence", "note", "notes", "why", "knownBias"]),
    );
  });

  it("holds no dropped field at any depth", () => {
    const keys = new Set<string>();
    const visit = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          visit(x);
        }
    };
    for (const name of ["rom", "gait", "targets"] as const) visit(committed(name));
    for (const k of DROP_ANYWHERE) expect(keys.has(k), k).toBe(false);
  });

  it.skipIf(!process.env.AZM_CLINICAL_V7)("exports the real clinical sources to the committed files", () => {
    const dir = process.env.AZM_CLINICAL_V7!;
    const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
    const { data, errors } = exportV7({
      rom: read("rom-protocol.json"),
      gait: read("gait-rules.json"),
      targets: read("exercise-targets.json"),
    });
    expect(errors).toBeUndefined();
    for (const name of ["rom", "gait", "targets"] as const)
      expect(JSON.stringify(data![name], null, 2) + "\n").toBe(committedText(name));
  });
});

describe("v7 clinical export: the required --input", () => {
  it("reads the folder from --input <dir> or --input=<dir>, and nothing else", () => {
    expect(inputArg(["--input", "/x/clinical"])).toBe("/x/clinical");
    expect(inputArg(["--input=/x/clinical"])).toBe("/x/clinical");
    expect(inputArg([])).toBeNull();
    expect(inputArg(["--input"])).toBeNull();
    expect(inputArg(["--input", "--other"])).toBeNull();
    expect(inputArg(["/x/clinical"])).toBeNull();
  });

  it("exits with 1 and writes nothing without --input or with a folder that has no sources", () => {
    const before = (["rom", "gait", "targets"] as const).map(committedText);
    const none = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("--input");
    const empty = mkdtempSync(join(tmpdir(), "azm-v7-export-"));
    const missing = spawnSync(process.execPath, [SCRIPT, "--input", empty], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Cannot read");
    expect((["rom", "gait", "targets"] as const).map(committedText)).toEqual(before);
  });

  it("exits with 1 and writes nothing when a source breaks a rule", () => {
    const before = (["rom", "gait", "targets"] as const).map(committedText);
    const dir = mkdtempSync(join(tmpdir(), "azm-v7-export-"));
    const s = sources();
    s.rom.copy.intro = { ar: "مقدمة", en: "Intro — with a dash" };
    writeFileSync(join(dir, "rom-protocol.json"), JSON.stringify(s.rom));
    writeFileSync(join(dir, "gait-rules.json"), JSON.stringify(s.gait));
    writeFileSync(join(dir, "exercise-targets.json"), JSON.stringify(s.targets));
    const run = spawnSync(process.execPath, [SCRIPT, "--input", dir], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("copy.intro.en");
    expect((["rom", "gait", "targets"] as const).map(committedText)).toEqual(before);
  });
});

describe("v7 clinical export: sections", () => {
  it("fails on an unknown top level section, in each file", () => {
    const s = sources();
    s.rom.newTable = [];
    s.gait.newRules = {};
    s.targets.newMap = {};
    const { errors } = exportV7(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rom-protocol.json: unknown top level section newTable"),
        expect.stringContaining("gait-rules.json: unknown top level section newRules"),
        expect.stringContaining("exercise-targets.json: unknown top level section newMap"),
      ]),
    );
  });

  it("fails on a missing kept section, in each file", () => {
    const s = sources();
    delete s.rom.norms;
    delete s.rom.sources;
    delete s.gait.patterns;
    delete s.targets.newExercises;
    const { errors } = exportV7(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        "rom-protocol.json: missing section norms",
        "rom-protocol.json: missing section sources",
        "gait-rules.json: missing section patterns",
        "exercise-targets.json: missing section newExercises",
      ]),
    );
  });

  it("knows every dropped top level section and keeps none of them", () => {
    for (const name of ["rom", "gait", "targets"] as const)
      for (const key of DROP_TOP[name]) expect(KEEP[name]).not.toContain(key);
    const { data } = exportV7(sources());
    expect(Object.keys(data!.rom)).not.toContain("sessionOrder");
    expect(Object.keys(data!.gait)).not.toContain("notInMvp");
    expect(Object.keys(data!.targets)).not.toContain("coverage");
  });

  it("fails when a kept string breaks the wording rules, and ignores dropped fields", () => {
    const dash = sources();
    dash.gait.copy.patterns.waddling.en = "Your walk may suggest a side–to–side sway.";
    expect(exportV7(dash).errors).toEqual([expect.stringContaining("wording: gait-v7.json.copy.patterns")]);
    const phrase = sources();
    phrase.targets.mapping.whyLines[0].ar = "بسبب حالتك الصحية أضفنا هذا التمرين.";
    expect(exportV7(phrase).errors).toEqual([expect.stringContaining("حالتك الصحية")]);
    const hyphen = sources();
    hyphen.rom.cues.keep_back.en = "Keep your back well-supported.";
    expect(exportV7(hyphen).errors).toEqual([expect.stringContaining("hyphen between letters")]);
    // The round trip sources carry dashes in note, basis, Ebasis and dropped sections: they pass.
    expect(exportV7(sources()).errors).toBeUndefined();
  });

  it("builds the citations from the norm sources only, as id, cite and url", () => {
    const { data } = exportV7(sources());
    const rom = data!.rom as Obj;
    const normIds = new Set(rom.norms.flatMap((n: Obj) => n.source));
    expect(rom.citations.map((c: Obj) => c.id).sort()).toEqual([...normIds].sort());
    expect(rom.citations.map((c: Obj) => c.id)).not.toContain("R99");
    for (const c of [...rom.citations, ...(data!.gait as Obj).citations])
      expect(Object.keys(c)).toEqual(["id", "cite", "url"]);
    expect((data!.gait as Obj).citations.map((c: Obj) => c.id)).not.toContain("Zeni08");
    const bad = sources();
    delete bad.rom.sources.R2;
    expect(exportV7(bad).errors).toEqual(["norms: source R2 is not in sources"]);
  });
});

describe("v7 clinical export: region ids (C-11, rule 4)", () => {
  it("normalises forearm_and_wrist, trunk and wrist_hand at any depth", () => {
    expect(
      normaliseRegions({
        a: { region: "forearm_and_wrist" },
        b: [{ region: "trunk" }, { region: "wrist_hand" }, { region: "knee" }],
      }),
    ).toEqual({
      a: { region: "forearm_wrist" },
      b: [{ region: "back_trunk" }, { region: "forearm_wrist" }, { region: "knee" }],
    });
    const { data } = exportV7(sources());
    const rows = (data!.targets as Obj).mapping.regionDefaultRule.rows as Obj[];
    expect(rows.some((r) => r.region === "forearm_wrist")).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/"region":"(forearm_and_wrist|trunk|wrist_hand)"/);
  });

  it("fails on any other region id, in any file", () => {
    expect(() => normaliseRegions({ x: [{ region: "wrist" }] }, "t")).toThrow(
      "t.x[0].region: unknown region id wrist",
    );
    const s = sources();
    s.targets.taxonomy.muscleGroups[0].region = "head";
    expect(exportV7(s).errors).toEqual([expect.stringContaining("unknown region id head")]);
    const m = sources();
    m.rom.movements[0].region = "arm";
    expect(exportV7(m).errors).toEqual(["movements shoulder_flexion: unknown region arm"]);
  });
});

describe("v7 clinical export: movements (rules 6 and 7)", () => {
  const regions = [
    { id: "shoulder", axial: false },
    { id: "neck", axial: true },
  ];
  const base = (extra: Obj = {}): Obj => ({
    id: "shoulder_flexion",
    region: "shoulder",
    ar: "رفع الذراع أمامًا",
    en: "Arm raise to the front",
    plane: "sagittal",
    verdict: "measure",
    cameraEvidence: "Moderate",
    kind: "flexion",
    canBeNegative: false,
    priority: "core",
    view: "side",
    positions: [{ id: "seated", graded: true, normId: "gill_shoulder_flexion", note: "Seated" }],
    angle: {
      definition: "theta",
      landmarks: { S: { left: 11, right: 12 }, E: { left: 13, right: 14 }, H: { left: 23, right: 24 } },
    },
    gate: ["S", "E", "H"],
    optional: [],
    compensations: [{ id: "trunk_back", check: "x" }],
    E: 10,
    sigmaM: 5.1,
    instructions: { ar: ["اجلس"], en: ["Sit"] },
    ...extra,
  });

  it("defaults version to 1 and approximateInPersonView to false, and keeps given values", () => {
    const d: Obj = movementDef(base(), regions);
    expect(d.version).toBe(1);
    expect(d.approximateInPersonView).toBe(false);
    const given: Obj = movementDef(base({ version: 3, approximateInPersonView: true }), regions);
    expect(given.version).toBe(3);
    expect(given.approximateInPersonView).toBe(true);
    const rom = committed("rom");
    expect(rom.movements.every((m: Obj) => typeof m.approximateInPersonView === "boolean")).toBe(true);
    expect(rom.movements.filter((m: Obj) => m.approximateInPersonView).length).toBe(3);
    expect(rom.movements.every((m: Obj) => Number.isInteger(m.version) && m.version >= 1)).toBe(true);
  });

  it("resolves every optional prose through the role table and adds missing roles from the standard indices", () => {
    expect(Object.keys(OPTIONAL_ROLES).sort()).toEqual(
      [
        "W (wrist, for the elbow check)",
        "W",
        "ears 7 and 8 (shrug logging)",
        "other knee",
        "hip line",
        "hips",
        "heel",
        "nose",
        "A",
        "H",
        "K",
        "S",
        "MS",
        "MH",
      ].sort(),
    );
    const d: Obj = movementDef(
      base({
        optional: [
          "W (wrist, for the elbow check)",
          "ears 7 and 8 (shrug logging)",
          "other knee",
          "hip line",
          "heel",
          "nose",
          "H",
          "A",
          "MS",
        ],
      }),
      regions,
    );
    expect(d.optional).toEqual(["W", "ears", "Kother", "hips", "heel", "nose", "H", "A", "MS"]);
    expect(d.landmarks).toEqual({
      S: { left: 11, right: 12 },
      E: { left: 13, right: 14 },
      H: { left: 23, right: 24 },
      W: { left: 15, right: 16 },
      ears: [7, 8],
      Kother: { other: "knee" },
      hips: [23, 24],
      heel: { left: 29, right: 30 },
      nose: 0,
      A: { left: 27, right: 28 },
      MS: { mid: [11, 12] },
    });
    // Every role of the table resolves to its standard reference (H is already on the base movement).
    for (const [text, role] of Object.entries(OPTIONAL_ROLES)) {
      const d: Obj = movementDef(base({ optional: [text] }), regions);
      expect(d.optional).toEqual([role]);
      expect(d.landmarks[role]).toEqual(STANDARD_ROLE_REFS[role]);
    }
  });

  it("keeps a role the movement already has", () => {
    const d: Obj = movementDef(
      base({
        angle: { landmarks: { S: 11, E: 13, H: 23, W: { left: 99, right: 98 } } },
        gate: ["S"],
        optional: ["W"],
      }),
      regions,
    );
    expect(d.landmarks.W).toEqual({ left: 99, right: 98 });
  });

  it("fails on optional prose the table does not know", () => {
    expect(() => movementDef(base({ optional: ["wrist"] }), regions)).toThrow(
      'movements shoulder_flexion: unknown optional landmark "wrist"',
    );
  });

  it("turns landmark prose into refs and fails on unknown prose", () => {
    expect(landmarkRef("mid(11, 12)", "x")).toEqual({ mid: [11, 12] });
    expect(landmarkRef("mid(23, 24) fixed at calibration", "x")).toEqual({ mid: [23, 24], fixed: true });
    expect(landmarkRef("the other hip (23 or 24)", "x")).toEqual({ other: "hip" });
    expect(landmarkRef("other knee", "x")).toEqual({ other: "knee" });
    expect(landmarkRef([7, 8], "x")).toEqual([7, 8]);
    expect(landmarkRef({ left: 1, right: 2 }, "x")).toEqual({ left: 1, right: 2 });
    expect(landmarkRef(0, "x")).toBe(0);
    expect(() => landmarkRef("midpoint of the hips", "x")).toThrow("x: unknown landmark");
    expect(() => landmarkRef({ left: 1 }, "x")).toThrow("x: unknown landmark");
  });

  it("turns 'a or b' gates into anyOf and fails on a gate role that is not a landmark", () => {
    const d: Obj = movementDef(
      base({
        region: "neck",
        angle: { landmarks: { ears: [7, 8], eyes: [2, 5], shoulders: [11, 12] } },
        gate: ["ears or eyes", "shoulders"],
      }),
      regions,
    );
    expect(d.gate).toEqual([{ anyOf: ["ears", "eyes"] }, "shoulders"]);
    expect(d.axial).toBe(true);
    expect(() => movementDef(base({ gate: ["S", "K"] }), regions)).toThrow("gate role K is not a landmark");
  });

  it("keeps the lower grade of a camera evidence range and fails on unknown evidence", () => {
    expect(movementDef(base({ cameraEvidence: "Moderate to high" }), regions).cameraEvidence).toBe(
      "Moderate",
    );
    expect(
      movementDef(base({ cameraEvidence: "Low to moderate (conflicting)" }), regions).cameraEvidence,
    ).toBe("Low");
    expect(() => movementDef(base({ cameraEvidence: "Strong" }), regions)).toThrow("unknown camera evidence");
  });

  it("fails on a movement field it does not know", () => {
    expect(() => movementDef(base({ tempo: "slow" }), regions)).toThrow("unknown field tempo");
  });

  it("drops prose fields and keeps the typed extras", () => {
    const d: Obj = movementDef(
      base({
        camera: "Side view",
        startPose: "Seated",
        feeds: "x",
        absoluteFloor: { mildBelow: 0, markedAtOrBelow: -10, basis: "proposal" },
        resultName: { ar: "وصول الفخذ", en: "Thigh behind" },
      }),
      regions,
    );
    expect(d).not.toHaveProperty("camera");
    expect(d).not.toHaveProperty("feeds");
    expect(d.absoluteFloor).toEqual({ mildBelow: 0, markedAtOrBelow: -10 });
    expect(d.resultName).toEqual({ ar: "وصول الفخذ", en: "Thigh behind" });
    expect(d.compensationIds).toEqual(["trunk_back"]);
    expect(d.name).toEqual({ ar: "رفع الذراع أمامًا", en: "Arm raise to the front" });
  });
});

describe("v7 clinical export: structured prose (engine, norms, limb loss, hip end range)", () => {
  it("writes norm sources as arrays (rule 8)", () => {
    const s = romSource();
    s.norms[0].source = "R7, R8";
    s.sources.R7 ??= { cite: "R7", url: "u" };
    s.sources.R8 ??= { cite: "R8", url: "u" };
    expect((exportRom(s).norms as Obj[])[0].source).toEqual(["R7", "R8"]);
  });

  it("normalises norm rows and maps the limit flag to its id", () => {
    const rom = committed("rom");
    for (const n of rom.norms)
      for (const r of n.rows) {
        expect(r).toHaveProperty("ageMax");
        expect(r).toHaveProperty("sdUsed");
        expect(r).toHaveProperty("limits");
        if (r.limits?.flag) expect(r.limits.flag).toBe("sdUnknown");
      }
    const s = romSource();
    s.norms[0].rows[0].limits = { ...s.norms[0].rows[0].limits, flag: "newFlag: something" };
    expect(() => exportRom(s)).toThrow("unknown flag");
  });

  it("reads engine values and turns the known prose into structures, failing on new prose", () => {
    const rom = exportRom(romSource()) as Obj;
    expect(rom.engine.holdBandDeg).toBe(3);
    expect(rom.engine.restBetweenAttemptsSeconds).toEqual({ min: 5, max: 10 });
    expect(rom.engine.sigmaMFloor).toEqual({ measure: 5.1, caution: 7.7 });
    const s = romSource();
    s.engine.holdSeconds = { value: "about 1", basis: "plan" };
    expect(() => exportRom(s)).toThrow('engine.holdSeconds: unknown value "about 1"');
  });

  it("maps limb loss prose to reason ids and fails on prose without one", () => {
    const rom = exportRom(romSource()) as Obj;
    const below = rom.limbLoss.levels.find((l: Obj) => l.level === "below_knee");
    expect(below.notMeasured).toEqual({
      knee_flexion: "not_measured_camera",
      knee_extension: "not_measured_camera",
      ankle_dorsiflexion_lunge: "limb_absent",
    });
    const s = romSource();
    s.limbLoss.levels[0].notMeasured.knee_flexion = "measure it with the prosthesis";
    expect(() => exportRom(s)).toThrow("no reason id");
  });

  it("normalises hip end range notes to ids and fails on an unknown id", () => {
    expect(
      hipEndRange(
        [
          "flexion_past_90 at the end of the slide",
          "adduction_past_midline (lying on the side)",
          "flexion_past_90 (ordinary seat)",
          "extension",
        ],
        "x",
      ),
    ).toEqual(["flexion_past_90", "adduction_past_midline", "flexion_past_90", "extension"]);
    expect(() => hipEndRange(["deep squat"], "x")).toThrow('x: unknown hip end range "deep squat"');
    const t = committed("targets");
    for (const e of t.newExercises)
      for (const h of e.hipEndRange ?? []) expect(HIP_END_RANGE_IDS).toContain(h);
  });

  it("keeps engine, norm and region structures typed in the committed file", () => {
    const rom = committed("rom");
    for (const v of Object.values(rom.engine))
      expect(typeof v === "number" || typeof v === "object").toBe(true);
    expect(rom.regions.map((r: Obj) => r.id)).toEqual([
      "neck",
      "back_trunk",
      "shoulder",
      "elbow",
      "forearm_wrist",
      "hip",
      "knee",
      "ankle_foot",
    ]);
  });
});

describe("v7 clinical export: gait and targets sections", () => {
  it("numbers mode keeps numbers, booleans and their arrays, and drops prose", () => {
    expect(
      numbersOnly({
        fps: 30,
        list: [2.5, 3.5],
        text: "30 per side view",
        on: true,
        nested: { only: "prose" },
        rows: [{ a: 1, b: "x" }, { c: "y" }],
        sources: [1],
      }),
    ).toEqual({ fps: 30, list: [2.5, 3.5], on: true, rows: [{ a: 1 }] });
    expect(numbersOnly("prose")).toBeUndefined();
  });

  it("keeps the structured gait fields and drops the prose ones", () => {
    const g = exportGait(gaitSource()) as Obj;
    expect(g.preprocessing.every((p: Obj) => Object.keys(p).join() === "step")).toBe(true);
    expect(g.capture.common).not.toHaveProperty("model");
    expect(g.events).not.toHaveProperty("front");
    expect(g.confidenceModel).not.toHaveProperty("firing");
    expect(g.confidenceModel.capFromGrade.A).toBe("high");
    expect(g.patterns.every((p: Obj) => !("section" in p) && !("sides" in p) && !("labelRule" in p))).toBe(
      true,
    );
    expect(g.findings.every((f: Obj) => !("rule" in f) && !("use" in f))).toBe(true);
    expect(g.metrics.find((m: Obj) => m.id === "pelvic_drop")).not.toHaveProperty("views2");
    expect(g.errorMargins).not.toHaveProperty("thresholdRule");
    expect(g.retest).toEqual({ realChange: committed("gait").retest.realChange });
  });

  it("moves the why lines to the top level and drops the merge and selection prose", () => {
    const t = exportTargets(targetsSource()) as Obj;
    expect(t.whyLines.length).toBeGreaterThan(0);
    expect(t.mapping).not.toHaveProperty("whyLines");
    expect(t.mapping).not.toHaveProperty("merge");
    expect(t.mapping).not.toHaveProperty("selection");
    expect(t.dose.profiles.every((p: Obj) => Object.keys(p).join() === "id,ar,en,numbers")).toBe(true);
  });

  it("strip removes the dropped fields at any depth and leaves the rest", () => {
    expect(strip({ a: 1, note: "x", b: [{ basis: "y", c: 2, why: "z" }], whyLine: "kept" })).toEqual({
      a: 1,
      b: [{ c: 2 }],
      whyLine: "kept",
    });
  });
});
