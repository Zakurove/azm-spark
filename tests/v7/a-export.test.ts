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
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { join } from "node:path";
import {
  DROP_ANYWHERE,
  DROP_TOP,
  ENGINE_PROSE,
  HIP_END_RANGE_IDS,
  KEEP,
  NUMBERS_MODE,
  OPTIONAL_ROLES,
  OUTPUT_FILES,
  PROSE_NUMBER_EXEMPT,
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
  numberTokens,
  numbersOnly,
  presentRegions,
  proseNumbers,
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
    const {
      name,
      axial: _axial,
      version,
      landmarks,
      gate,
      optional,
      compensationIds: _ids,
      compensations,
      directionFromDeg,
      earLineMinVisibility,
      positions,
      ...rest
    } = m;
    return {
      ...rest,
      ...(version === 1 ? {} : { version }),
      ar: name.ar,
      en: name.en,
      camera: "Side view, phone level within 5 degrees",
      startPose: "Seated",
      positions: positions.map((p: Obj) => ({ ...p, note: "Seated for everyone (P5)" })),
      angle: {
        definition: "theta = ang(E − S, H − S)",
        landmarks: Object.fromEntries(Object.entries(landmarks).map(([k, v]) => [k, LANDMARK_TEXT(v)])),
        reference: "Trunk line",
        zero: "0 = arm along the trunk",
        direction: "Flexion only",
        ...(directionFromDeg === undefined ? {} : { directionFromDeg }),
        ...(earLineMinVisibility === undefined ? {} : { earLineMinVisibility }),
      },
      gate: gate.map((g: unknown) => (typeof g === "string" ? g : (g as Obj).anyOf.join(" or "))),
      optional: optional.map((r: string) => OPTIONAL_TEXT[r] ?? r),
      // The structured fields beside the prose; the source names the cue line cueId.
      compensations: compensations.map(({ cue, ...c }: Obj) => ({
        id: c.id,
        check: "Trunk tilt",
        cue: "> 5 degrees: keep_back",
        invalid: "> 10 degrees",
        cueId: cue,
        ...c,
        basis: "v1.1 A.1 (R46)",
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
        // The present parts in words, the residual note in brackets (rom-protocol 2.4).
        present: (l.present ?? []).map((r: string, i: number) => (i ? `${r} (residual)` : r)).join(", "),
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
    thresholds: (() => {
      const { phoneBias, functionalFloor, ...numbers } = rom.thresholds;
      return {
        terms: { b: "phone bias: 0 until the bench check", phoneBias },
        SDeff: "SD, capped at 12.5% of N for movements with N of 90 degrees or more",
        ...numbers,
        functionalFloor: withReviewFields(functionalFloor),
      };
    })(),
    functionalCrossCheck: [{ movement: "shoulder_flexion", text: "Daily tasks" }],
    retest: { rule: "Proposal: band = MDC95, never below 10", ...rom.retest },
    sessionOrder: { rule: "At most 8 measured movements", ...rom.sessionOrder },
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
    events: { ...g.events, front: { ...g.events.front, method: "Stenum 2024", gives: "IC only" } },
    metrics: g.metrics.map((m: Obj) => ({
      ...m,
      definition: "IC to IC",
      aggregation: "median",
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
      // The source words of each profile's evidence (D-029 item 1, E2-1): the grade the export keeps.
      profiles: t.dose.profiles.map(({ evidenceGrade, ...p }: Obj) => ({
        ...p,
        basis: [["ACSM11", "60 s"]],
        caveat: "c",
        strength: `${evidenceGrade} for the dose (source like)`,
      })),
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

  it.skipIf(!process.env.AZM_CLINICAL_V7)(
    "the real gait source marks the CG-19 thresholds interim, with their decision and dataset evidence (D-027 item 6)",
    () => {
      const gait = JSON.parse(readFileSync(join(process.env.AZM_CLINICAL_V7!, "gait-rules.json"), "utf8"));
      const interim = (id: string) =>
        gait.patterns.find((p: { id: string }) => p.id === id).thresholds.interim;
      const walkers = {
        stiff_knee: ["vc-ab-005"],
        recurvatum: ["wbds-41-t01", "wbds-41-t07"],
        quad_avoidance: ["wbds-25-t01"],
      };
      for (const [id, ids] of Object.entries(walkers)) {
        const i = interim(id);
        expect(i.until, id).toBe("GAIT-Q3");
        expect(i.basis, id).toContain("D-027 item 6");
        expect(i.basis, id).toContain("CG-19");
        for (const w of ids) expect(i.evidence, id).toContain(w);
        // The runtime keeps the mark and drops the basis and evidence (rule 2).
        const runtime = (
          committed("gait") as { patterns: { id: string; thresholds: { interim?: object } }[] }
        ).patterns.find((p) => p.id === id)!.thresholds.interim;
        expect(Object.keys(runtime!).sort(), id).toEqual(
          Object.keys(i)
            .filter((k) => k !== "basis" && k !== "evidence")
            .sort(),
        );
      }
    },
  );

  it.skipIf(!process.env.AZM_CLINICAL_V7)(
    "the real sources' sign off record: only Nasser approved (D-025, 4 Oct 2026), Chaker has not reviewed yet",
    () => {
      const dir = process.env.AZM_CLINICAL_V7!;
      for (const file of ["rom-protocol.json", "gait-rules.json", "exercise-targets.json"]) {
        const { signoff } = JSON.parse(readFileSync(join(dir, file), "utf8"));
        expect(signoff.approvers, file).toEqual(["Dr. Nasser Alharbi (PM&R), medical"]);
        expect(signoff.signedOffBy, file).toBe("Dr. Nasser Alharbi (PM&R), medical");
        expect(signoff.date, file).toBe("2026-10-04");
        expect(signoff.note, file).toContain("Only Dr. Nasser Alharbi approved (D-025, 4 Oct 2026)");
        expect(signoff.note, file).toContain("Chaker Belhaj has not reviewed yet");
      }
      for (const file of ["rom-protocol.md", "gait-rules.md", "exercise-targets.md"]) {
        const status = readFileSync(join(dir, file), "utf8").split("\n")[2];
        expect(status, file).toContain("Only Dr. Nasser Alharbi approved (D-025, 4 Oct 2026)");
        expect(status, file).toContain("Chaker Belhaj has not reviewed yet");
      }
    },
  );
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
    expect(Object.keys(data!.rom)).not.toContain("normSelection");
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

/* ------------------------------------- every picked object (D-024 item 4) */

type Name = "rom" | "gait" | "targets";
/** Source sections the export never keeps a field of (rule 2 review material, DROP_TOP, the source table). */
const NOT_EXPORTED = (name: Name, key: string) =>
  DROP_ANYWHERE.includes(key) || DROP_TOP[name].includes(key) || key === "sources";

/**
 * One path per object shape of a source (array indices folded to the first element): every object the
 * export reads, as [path, object] pairs. Objects under review material are left out.
 */
function objectShapes(name: Name, source: Obj): [string, Obj][] {
  const seen = new Map<string, [string, Obj]>();
  const visit = (v: unknown, path: string, shape: string) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`, `${shape}[]`));
      return;
    }
    if (!v || typeof v !== "object") return;
    if (path && !seen.has(shape)) seen.set(shape, [path, v as Obj]);
    for (const [k, x] of Object.entries(v)) {
      if (!path && NOT_EXPORTED(name, k)) continue;
      if (path && DROP_ANYWHERE.includes(k)) continue;
      visit(x, path ? `${path}.${k}` : k, shape ? `${shape}.${k}` : k);
    }
  };
  visit(source, "", "");
  return [...seen.values()];
}

const EXPORTERS = { rom: exportRom, gait: exportGait, targets: exportTargets } as const;
/** The export of one source after `change`: its error, or its output as text. */
const SOURCES = { rom: romSource, gait: gaitSource, targets: targetsSource } as const;
function exportWith(name: Name, change: (s: Obj) => void): { error?: string; text?: string } {
  const s = SOURCES[name]();
  change(s);
  try {
    return { text: JSON.stringify(EXPORTERS[name](s)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
/** The object at a path such as movements[0].positions[1] inside a source. */
function at(source: Obj, path: string): Obj {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((o: Obj, k) => o[k], source);
}

describe("v7 clinical export: a new field anywhere reaches the output or fails (D-024 item 4)", () => {
  for (const name of ["rom", "gait", "targets"] as const)
    // One export per object shape and value: about a second each, longer on a busy runner.
    it(
      `${name}: a number or a prose field added to any object is exported or stops the export`,
      { timeout: 60_000 },
      () => {
        const shapes = objectShapes(name, SOURCES[name]());
        expect(shapes.length).toBeGreaterThan(40);
        const silent: string[] = [];
        for (const [path] of shapes)
          for (const value of [7, "new rule text"]) {
            const r = exportWith(name, (s) => {
              at(s, path).zzFreeze = value;
            });
            const kept = r.text?.includes('"zzFreeze"');
            // Numbers mode keeps a number and drops prose; prose there is what --report-prose-numbers lists.
            if (
              !r.error &&
              !kept &&
              !(typeof value === "string" && NUMBERS_MODE[name].some((p) => path.startsWith(p)))
            )
              silent.push(`${path} ${JSON.stringify(value)}`);
          }
        expect(silent).toEqual([]);
      },
    );

  it("names the object and the field when a picked object gets an unknown field", () => {
    const cases: [Name, string, string][] = [
      ["rom", "signoff", "signoff: unknown field zzFreeze"],
      ["rom", "conventions", "conventions: unknown field zzFreeze"],
      ["rom", "engine.holdBandDeg", "engine.holdBandDeg: unknown field zzFreeze"],
      ["rom", "regions[0]", "regions neck: unknown field zzFreeze"],
      ["rom", "problemTypes[0]", "problemTypes weakness: unknown field zzFreeze"],
      ["rom", "conditionAutoMap[3]", "conditionAutoMap parkinsons: unknown field zzFreeze"],
      ["rom", "conditionAutoMap[3].answers[0]", "conditionAutoMap parkinsons answer: unknown field zzFreeze"],
      ["rom", "limbLoss", "limbLoss: unknown field zzFreeze"],
      ["rom", "limbLoss.levels[0]", "limbLoss below_knee: unknown field zzFreeze"],
      ["rom", "positions.seated", "positions seated: unknown field zzFreeze"],
      [
        "rom",
        "movements[0].positions[0]",
        "movements shoulder_flexion position seated: unknown field zzFreeze",
      ],
      ["rom", "movements[0].angle", "movements shoulder_flexion angle: unknown field zzFreeze"],
      [
        "rom",
        "movements[0].compensations[0]",
        "movements shoulder_flexion compensation trunk_back: unknown field zzFreeze",
      ],
      ["rom", "movements[0].instructions", "movements shoulder_flexion instructions: unknown field zzFreeze"],
      ["rom", "defaultMovements[0]", "defaultMovements shoulder_internal_rotation: unknown field zzFreeze"],
      [
        "rom",
        "defaultMovements[0].inAffectedRegion",
        "defaultMovements shoulder_internal_rotation inAffectedRegion: unknown field zzFreeze",
      ],
      ["rom", "thresholds", "thresholds: unknown field zzFreeze"],
      ["rom", "safety[0]", "safety global_gate: unknown field zzFreeze"],
      ["gait", "signoff", "signoff: unknown field zzFreeze"],
      ["gait", "grades", "grades: unknown field zzFreeze"],
      ["gait", "retest", "retest: unknown field zzFreeze"],
      ["gait", "findings[0]", "findings flat_or_forefoot_contact: unknown field zzFreeze"],
      ["targets", "signoff", "signoff: unknown field zzFreeze"],
      ["targets", "dose", "dose: unknown field zzFreeze"],
      ["targets", "dose.profiles[0]", "dose stretch_hold: unknown field zzFreeze"],
    ];
    for (const [name, path, message] of cases) {
      const r = exportWith(name, (s) => {
        at(s, path).zzFreeze = "x";
      });
      expect(r.error, `${name} ${path}`).toContain(message);
    }
  });

  it("keeps who signed off, when and the decision in local-docs (the sign off record, D-025)", () => {
    for (const name of ["rom", "gait", "targets"] as const) {
      const r = exportWith(name, (s) => {
        Object.assign(s.signoff, {
          signedOffBy: "Dr. Nasser Alharbi (PM&R), medical",
          date: "2026-10-04",
          decision: "D-025",
        });
      });
      expect(r.error, name).toBeUndefined();
      const signoff = JSON.parse(r.text!).signoff;
      expect(Object.keys(signoff), name).toEqual(
        name === "rom" ? ["status", "approved", "approvers"] : ["approved", "approvers"],
      );
    }
  });

  it("keeps a limb loss level's sign off resolution in local-docs beside its question (ROM-Q7)", () => {
    const r = exportWith("rom", (s) => {
      s.limbLoss.levels[0].resolution = "ROM-Q7, signed off: not measured with the prosthesis on.";
    });
    expect(r.error).toBeUndefined();
    expect(r.text).not.toContain("ROM-Q7");
  });
});

/* ---------------------------------- --report-prose-numbers (D-024 item 4) */

describe("v7 clinical export: --report-prose-numbers over every kept section", () => {
  const listedPaths = (name: Name, s: Obj) => proseNumbers(name, s).listed.map((l) => l.path);

  it("reads numbers, not references, dates, versions, names or licences", () => {
    expect(numberTokens("visibility >= 0.5 in 90% of frames; > 2 frames on > 20% of events")).toEqual([
      0.5, 90, 2, 20,
    ]);
    expect(numberTokens("zero lag 4th order Butterworth low pass 5 Hz (2nd order filtfilt)")).toEqual([
      4, 5, 2,
    ]);
    expect(numberTokens("z ≥ −1.96; −3 ≤ z; front -0.07 to 0.10")).toEqual([-1.96, -3, -0.07, 0.1]);
    expect(
      numberTokens(
        "(R46, v1.1 4.1, Q12, 4.3, H6 rule 2, section 2.4, rom.md 3.4, plan §3.2, G§5, D-003, contract C-7, 2026-10-04, Stenum 2024, BSD-3, MDC95, 2D, Pillar 1, exercise-targets 5.6, gait-rules section 1, rom-protocol 5.3, contract 2.5, T6, fang18)",
      ),
    ).toEqual([]);
  });

  it("lists a number written in prose in any kept section, ROM included", () => {
    const s = sources();
    s.rom.safety[0].rule = "Pain 7 or more";
    s.rom.thresholds.SDeff = "SD capped at 11.5% of N";
    s.gait.findings[0].rule = "foot pitch <= 0 on >= 70% of cycles";
    s.targets.mapping.paths[1].plus = "stretch only at priority 3";
    expect(listedPaths("rom", s.rom)).toEqual(expect.arrayContaining(["safety[0].rule", "thresholds.SDeff"]));
    expect(proseNumbers("rom", s.rom).listed.find((l) => l.path === "safety[0].rule")).toEqual({
      path: "safety[0].rule",
      text: "Pain 7 or more",
      numbers: [7],
    });
    expect(listedPaths("gait", s.gait)).toContain("findings[0].rule");
    expect(listedPaths("targets", s.targets)).toContain("mapping.paths[1].plus");
  });

  it("does not list a number that a numeric field next to the prose holds", () => {
    const s = sources();
    s.rom.safety[0].rule = "Pain 7 or more";
    s.rom.safety[0].atOrAbove = 7;
    s.rom.thresholds.SDeff = "SD capped at 12.5% of N for N of 90 degrees or more";
    s.rom.thresholds.sdCap = { pctOfN: 12.5, fromMeanDeg: 90 };
    s.gait.eligibility.stops = ["pain 6 or more, a rise of 2 or more"];
    s.gait.eligibility.painStop = { atOrAbove: 6, riseAtOrAbove: 2 };
    const rom = listedPaths("rom", s.rom);
    expect(rom).not.toContain("safety[0].rule");
    expect(rom).not.toContain("thresholds.SDeff");
    expect(listedPaths("gait", s.gait)).not.toContain("eligibility.stops[0]");
    // A number the field does not hold is still listed.
    s.rom.safety[0].rule = "Pain 8 or more";
    expect(proseNumbers("rom", s.rom).listed.find((l) => l.path === "safety[0].rule")?.numbers).toEqual([8]);
  });

  it("reads a prose map's numbers next to the map", () => {
    const s = sources();
    const p = s.gait.patterns[0];
    p.thresholds.speedRules = { below: "needs a difference >= 15" };
    expect(listedPaths("gait", s.gait)).toContain("patterns[0].thresholds.speedRules.below");
    p.thresholds.speed = { diffGte: 15 };
    expect(listedPaths("gait", s.gait)).not.toContain("patterns[0].thresholds.speedRules.below");
  });

  it("leaves out copy, review fields and the prose the export structures through a table", () => {
    const s = sources();
    s.rom.copy.intro = { ar: "مدة 30 ثانية", en: "For 30 seconds" };
    s.rom.safety[0].evidence = "R33: NRS 6 to 7";
    s.rom.safety[0].note = "about 25 strides";
    const listed = listedPaths("rom", s.rom);
    expect(listed.some((p) => p.startsWith("copy."))).toBe(false);
    expect(listed.some((p) => p.includes("evidence") || p.endsWith(".note"))).toBe(false);
    // engine.smoothing "Hampel filter (window 7, n sigma 2)" is structured by ENGINE_PROSE.
    expect(listed.some((p) => p.startsWith("engine."))).toBe(false);
  });

  it("files a number of an exempt kind under its reason", () => {
    const s = sources();
    s.rom.norms[0].method = "Active, standing; 24.3% of those screened excluded";
    const r = proseNumbers("rom", s.rom);
    expect(r.listed.map((l) => l.path)).not.toContain("norms[0].method");
    const rule = PROSE_NUMBER_EXEMPT.find((x) => x.file === "rom" && x.path === "norms[*].method")!;
    expect(rule.why).toMatch(/\w/);
    expect(r.exempt[rule.why]).toBeGreaterThan(0);
  });

  it("gives every exemption a file, a path and a reason", () => {
    expect(PROSE_NUMBER_EXEMPT.length).toBeGreaterThan(20);
    for (const r of PROSE_NUMBER_EXEMPT) {
      expect(["rom", "gait", "targets"]).toContain(r.file);
      expect(r.path).toMatch(/^[a-zA-Z]/);
      expect(r.why.length, r.path).toBeGreaterThan(10);
      expect(wordingProblems(r.why), r.path).toEqual([]);
    }
  });

  it.skipIf(!process.env.AZM_CLINICAL_V7)(
    "the real sources: every prose number has a numeric field next to it or a reason, and every reason is used",
    () => {
      const dir = process.env.AZM_CLINICAL_V7!;
      const used = new Set<number>();
      for (const [name, file] of [
        ["rom", "rom-protocol.json"],
        ["gait", "gait-rules.json"],
        ["targets", "exercise-targets.json"],
      ] as const) {
        const r = proseNumbers(name, JSON.parse(readFileSync(join(dir, file), "utf8")));
        expect(r.listed, name).toEqual([]);
        for (const i of r.rulesUsed) used.add(i);
      }
      const unused = PROSE_NUMBER_EXEMPT.filter((_, i) => !used.has(i)).map((r) => `${r.file} ${r.path}`);
      expect(unused).toEqual([]);
    },
  );

  it("prints the list, and with --dry-run writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "azm-v7-export-"));
    const s = sources();
    s.rom.safety[0].rule = "Pain 7 or more";
    writeFileSync(join(dir, "rom-protocol.json"), JSON.stringify(s.rom));
    writeFileSync(join(dir, "gait-rules.json"), JSON.stringify(s.gait));
    writeFileSync(join(dir, "exercise-targets.json"), JSON.stringify(s.targets));
    const before = (["rom", "gait", "targets"] as const).map(committedText);
    const run = spawnSync(process.execPath, [SCRIPT, "--input", dir, "--report-prose-numbers", "--dry-run"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('rom safety[0].rule [7] "Pain 7 or more"');
    expect(run.stdout).not.toContain("Wrote");
    // --dry-run writes nothing.
    expect((["rom", "gait", "targets"] as const).map(committedText)).toEqual(before);
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
    distanceM: [2, 3],
    compensations: [
      {
        id: "trunk_back",
        check: "x",
        cue: "> 5 degrees: cue keep_back",
        invalid: "> 10 degrees",
        cueId: "keep_back",
        cueAt: 5,
        invalidAt: 10,
        effect: "invalid",
        unit: "deg",
        when: "above",
      },
    ],
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

describe("v7 clinical export: the freeze step's numbers (D-023 item 5, D-024 item 4)", () => {
  it("exports retest (floor, default and the bands) and sessionOrder (the cap), without their prose", () => {
    const rom = exportRom(romSource()) as Obj;
    expect(rom.retest).toEqual({
      floorDeg: 10,
      defaultDeg: 10,
      bands: {
        shoulder_flexion: { neurologicalDeg: 18 },
        elbow: { neurologicalDeg: 36 },
        ankle_dorsiflexion_lunge: { deg: 10 },
        knee_extension: { deg: 11, position: "lying_back" },
        shoulder_abduction: { deg: 16, wideDeg: 20 },
      },
    });
    expect(rom.sessionOrder).toEqual({
      maxMeasured: 8,
      minutesPerMovement: 1.5,
      blocks: ["seated", "standing", "lying"],
    });
    const lists = rom.safety.find((s: Obj) => s.id === "after_surgery_precaution").hipPrecautions;
    expect(lists.anterior).toEqual({ extensionPastDeg: 20, externalRotationPastDeg: 50 });
    // FZ-1 (D-026 item 4): one elbow band; the lab and home pair of the draft no longer exports.
    const twice = romSource();
    twice.retest.bands.elbow = { neurologicalLabDeg: 33, neurologicalHomeDeg: 36 };
    expect(() => exportRom(twice)).toThrow("retest band elbow: unknown field neurologicalLabDeg");
    const b = romSource();
    b.sessionOrder.blocks = ["seated", "lying", "standing", "pool"];
    expect(() => exportRom(b)).toThrow("sessionOrder.blocks: pool is not a block");
    expect(KEEP.rom).toEqual(expect.arrayContaining(["retest", "sessionOrder"]));
    expect(DROP_TOP.rom).not.toContain("retest");
    expect(DROP_TOP.rom).not.toContain("sessionOrder");
  });

  it("exports the numbers of the grading rules next to the functional floors (A4-8)", () => {
    const t = (exportRom(romSource()) as Obj).thresholds;
    expect(Object.keys(t)).toEqual([
      "sdCap",
      "zWithinMin",
      "zMarkedBelow",
      "percentOfNormalMinN",
      "elevationOverReadAbove",
      "phoneBias",
      "functionalFloor",
    ]);
    expect(t).toMatchObject({
      sdCap: { pctOfN: 12.5, fromMeanDeg: 90 },
      zWithinMin: -1.96,
      zMarkedBelow: -3,
      percentOfNormalMinN: 20,
      elevationOverReadAbove: 120,
      phoneBias: 0,
    });
    const s = romSource();
    s.thresholds.sdCap = { pctOfN: "12.5", fromMeanDeg: 90 };
    expect(() => exportRom(s)).toThrow("thresholds.sdCap.pctOfN: not a number");
    const u = romSource();
    u.thresholds.sdCap.fraction = 0.125;
    expect(() => exportRom(u)).toThrow("thresholds sdCap: unknown field fraction");
  });

  it("exports the Parkinson's movement set as { movement, position? } and checks each entry", () => {
    const rom = exportRom(romSource()) as Obj;
    const row = rom.conditionAutoMap.find((c: Obj) => c.condition === "parkinsons");
    expect(row.movementSet).toEqual([
      { movement: "shoulder_flexion" },
      { movement: "neck_extension" },
      { movement: "trunk_lateral_flexion", position: "seated_armrests" },
      { movement: "hip_extension" },
      { movement: "hip_flexion", position: "seated" },
    ]);
    expect(Object.keys(row)).toEqual(["condition", "ask", "answers", "movementSet"]);
    const pdIndex = (s: Obj) => s.conditionAutoMap.findIndex((c: Obj) => c.condition === "parkinsons");
    const bad = romSource();
    bad.conditionAutoMap[pdIndex(bad)].movementSet[0] = { movement: "shoulder_raise" };
    expect(() => exportRom(bad)).toThrow(
      "conditionAutoMap parkinsons movementSet: unknown movement shoulder_raise",
    );
    const pos = romSource();
    pos.conditionAutoMap[pdIndex(pos)].movementSet[1] = { movement: "neck_extension", position: "standing" };
    expect(() => exportRom(pos)).toThrow(
      "conditionAutoMap parkinsons movementSet: neck_extension has no position standing",
    );
    const extra = romSource();
    extra.conditionAutoMap[pdIndex(extra)].movementSet[2].helper = true;
    expect(() => exportRom(extra)).toThrow(
      "conditionAutoMap parkinsons movementSet trunk_lateral_flexion: unknown field helper",
    );
  });

  it("exports each compensation's cue line and numbers, the camera numbers and the angle numbers", () => {
    const rom = exportRom(romSource()) as Obj;
    const def = (id: string) => rom.movements.find((m: Obj) => m.id === id);
    const comp = (m: string, c: string) => def(m).compensations.find((x: Obj) => x.id === c);
    expect(comp("shoulder_flexion", "trunk_back")).toEqual({
      id: "trunk_back",
      cue: "keep_back",
      cueAt: 5,
      invalidAt: 10,
      effect: "invalid",
      unit: "deg",
      when: "above",
    });
    expect(comp("shoulder_abduction", "trunk_lean").cue).toBe("test_abd_still");
    expect(comp("shoulder_abduction", "plane")).toEqual({
      id: "plane",
      cue: "test_abd_side",
      cueAt: null,
      invalidAt: 0.85,
      effect: "invalid",
      unit: "ratio",
      when: "below",
      windowDeg: [70, 110],
      forSeconds: 0.3,
    });
    expect(comp("ankle_dorsiflexion_lunge", "heel_lift")).toMatchObject({
      invalidAt: 0.06,
      unit: "shank_lengths",
      forSeconds: 0.3,
      orInvalid: { at: 5, unit: "deg" },
    });
    expect(comp("trunk_lateral_flexion", "pelvis_shift")).toMatchObject({
      effect: "flag",
      flagAt: 5,
      orFlag: { at: 0.25, unit: "shoulder_widths" },
    });
    for (const m of rom.movements) {
      expect(
        m.compensations.map((c: Obj) => c.id),
        m.id,
      ).toEqual(m.compensationIds);
      expect(m.distanceM, m.id).toBeDefined();
    }
    expect(def("shoulder_abduction")).toMatchObject({
      distanceM: [2, 3],
      levelWithinDeg: 5,
      frameMarginArmLengths: 1.3,
      calibrationSeconds: 1,
      directionFromDeg: 20,
    });
    expect(def("neck_lateral_flexion")).toMatchObject({ distanceM: 1.5, earLineMinVisibility: 0.5 });
    expect(def("knee_extension").positions).toEqual([
      { id: "lying_back", graded: true, normId: "mckay_knee_extension", uncertainLackFrom: 5 },
      { id: "seated", graded: false, normId: null, referMeasureLackAbove: 52 },
    ]);
  });

  it("fails on a compensation cue that is not a line, an unknown effect or a missing number", () => {
    const s = romSource();
    s.movements[0].compensations[0].cueId = "keep_still";
    expect(() => exportRom(s)).toThrow(
      "movements shoulder_flexion compensation trunk_back: cue keep_still is not a cue line",
    );
    const e = romSource();
    e.movements[0].compensations[0].effect = "warn";
    expect(() => exportRom(e)).toThrow("movements shoulder_flexion compensation trunk_back: effect warn");
    const n = romSource();
    delete n.movements[0].compensations[0].cueAt;
    expect(() => exportRom(n)).toThrow(
      "movements shoulder_flexion compensation trunk_back.cueAt: not a number",
    );
    const d = romSource();
    d.movements[0].distanceM = "2 to 3";
    expect(() => exportRom(d)).toThrow("movements shoulder_flexion.distanceM: not a number");
  });

  it("exports the gait numbers copied next to their prose (gap 12, D-024 items 3 and 4)", () => {
    const g = exportGait(gaitSource()) as Obj;
    const step = (id: string) => g.preprocessing.find((p: Obj) => p.step === id);
    expect(step("timestamps")).toEqual({ step: "timestamps", hz: 30 });
    expect(step("visibility")).toEqual({ step: "visibility", visibilityMin: 0.5 });
    expect(step("outliers")).toEqual({ step: "outliers", hampel: { window: 7, nSigma: 2 } });
    expect(step("gaps")).toEqual({ step: "gaps", maxGap_s: 0.12 });
    expect(step("smoothing")).toEqual({
      step: "smoothing",
      butterworth: { order: 4, cutoffHz: 5, filtfiltOrder: 2 },
    });
    expect(step("turns and steady state")).toEqual({
      step: "turns and steady state",
      turnMargin_s: 1,
      dropSteps: { first: 2, last: 2 },
    });
    expect(g.events.side.peaks).toEqual({ distance_s: 0.4, prominencePctOfRange: 10 });
    expect(g.events.side.fallback).toEqual({
      ankleLandmarks: [27, 28],
      disagreeFrames: 2,
      disagreeEventsPct: 20,
    });
    expect(g.events.front.singleStanceWindowPct).toEqual([35, 90]);
    expect(g.events.checks.strideTimePlausibleX).toEqual([0.5, 1.5]);
    expect(g.capture.walking_pad.setupGate).toEqual({ visibilityMin: 0.5, warmUpFramesPct: 90 });
    expect(g.capture.staticSingleLegStance).toEqual({ holdMax_s: 10, measureLast_s: 3 });
    expect(g.confidenceModel).toMatchObject({
      firingSharePct: 60,
      downgradeCleanCyclesBelow: 10,
      downgradeProcessedFps: [20, 24],
      painDayAntalgic: [4, 5],
      unilateralAbsoluteFrom_mps: 0.8,
    });
    expect(g.errorMargins.thresholdRuleE).toEqual({ possible: 1, likely: 2 });
    const finding = (id: string) => g.findings.find((f: Obj) => f.id === id);
    expect(finding("flat_or_forefoot_contact").thresholds).toEqual({
      foot_pitch_ic_lte: 0,
      cleanCyclesPctGte: 60,
    });
    expect(finding("slow_speed").thresholds).toEqual({ sdBelowMean: 2 });
    expect(finding("uneven_step_length").thresholds).toEqual({
      possible: { sr_step_length_gte: 1.13 },
      likely: { sr_step_length_gte: 1.18 },
    });
    const pattern = (id: string) => g.patterns.find((p: Obj) => p.id === id);
    expect(pattern("stiff_knee").thresholds.speed).toEqual({
      bilateralNotAssessedBelow_mps: 0.6,
      unilateralCappedBelow_mps: 0.5,
      cappedNeedsDiffGte: 15,
      absoluteAloneFrom_mps: 0.8,
      // Interim since the sign off apply step (D-027 item 6, CG-19).
      interimAbsoluteAloneFrom_mps: 1,
    });
    expect(pattern("quad_avoidance").thresholds.speed).toEqual({ interimNotAssessedBelow_mps: 0.5 });
    expect(pattern("recurvatum").thresholds.possible).toEqual({ hyperextension_gte: 12 });
    expect(pattern("steppage").thresholds.likely).toMatchObject({
      possibleCyclesPctGte: 60,
      speed_mps_gte: 0.6,
    });
    expect(pattern("trendelenburg").views).toEqual(["front", "back", "pad_front"]);
    for (const id of ["pelvic_drop", "trunk_sway_range", "trunk_lean_peak"])
      expect(g.metrics.find((m: Obj) => m.id === id).views).toEqual(["front", "back", "pad_front"]);
  });

  it("fails on a view that is not a gait view and on a sign metric that is neither a metric nor a derived sign", () => {
    const v = gaitSource();
    v.patterns[1].views = ["front", "back (away passes)"];
    expect(() => exportGait(v)).toThrow(
      'patterns trendelenburg: view "back (away passes)" is not a gait view',
    );
    const m = gaitSource();
    m.metrics[0].views = ["side", "far"];
    expect(() => exportGait(m)).toThrow('metrics cadence: view "far" is not a gait view');
    const s = gaitSource();
    s.patterns[4].signs[1].metric = "knee_diff";
    expect(() => exportGait(s)).toThrow(
      "patterns stiff_knee: sign metric knee_diff is not a metric or a derived sign",
    );
    const t = gaitSource();
    t.findings[2].thresholds.likely.sr_step_length_gte = "1.18";
    expect(() => exportGait(t)).toThrow("findings uneven_step_length.thresholds: not a number");
  });

  it("exports causeResolution as one cause path id plus alternatives, and dose.text with its numbers", () => {
    const t = exportTargets(targetsSource()) as Obj;
    const row = (order: number) => t.mapping.causeResolution.find((r: Obj) => r.order === order);
    expect(row(4)).toMatchObject({
      path: "tight",
      alternatives: [
        {
          path: "rehab",
          when: "an injury over 6 weeks or surgery from 12 weeks is in the history",
          injuryOverWeeks: 6,
          surgeryFromWeeks: 12,
        },
      ],
    });
    expect(row(6)).toMatchObject({
      path: "pain_stable",
      alternatives: [
        { path: "pain_irritable", painRiseGte: 2, painToday: [4, 5], injuryOrSurgeryUnderMonths: 3 },
      ],
    });
    expect(row(11)).toMatchObject({
      path: "pain_stable",
      alternatives: [{ path: "pain_irritable", when: "as order 6", asOrder: 6 }],
    });
    const ex = (id: string) => t.newExercises.find((e: Obj) => e.id === id);
    expect(ex("wall_hand_walk").dose).toEqual({
      profile: "stretch_hold",
      painProfile: "mobility_pain",
      text: "NIA: hold 10 to 30 s, 3 to 5 times. With pain: no hold, walk up only within comfort.",
      holdSeconds: [10, 30],
      repetitions: [3, 5],
    });
    expect(JSON.stringify(t.newExercises)).not.toContain('"note"');
    const bad = targetsSource();
    bad.mapping.causeResolution[3].path = "tight, or rehab when an injury over 6 weeks";
    expect(() => exportTargets(bad)).toThrow(
      'mapping causeResolution 4: path "tight, or rehab when an injury over 6 weeks" is not a cause path',
    );
    const alt = targetsSource();
    alt.mapping.causeResolution[3].alternatives[0].path = "rest";
    expect(() => exportTargets(alt)).toThrow('mapping causeResolution 4: path "rest" is not a cause path');
  });

  it("fails on a retest band of an unknown movement or field, and on a number written as text", () => {
    const s = romSource();
    s.retest.bands.wrist = { deg: 10 };
    expect(() => exportRom(s)).toThrow("retest band wrist: not a movement or region id");
    const f = romSource();
    f.retest.bands.elbow.homeDeg = 36;
    expect(() => exportRom(f)).toThrow("retest band elbow: unknown field homeDeg");
    const t = romSource();
    t.sessionOrder.maxMeasured = "8";
    expect(() => exportRom(t)).toThrow("sessionOrder.maxMeasured: not a number");
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

  it("maps the present parts of each limb loss level to region ids, failing on another word", () => {
    const rom = exportRom(romSource()) as Obj;
    expect(rom.limbLoss.levels.map((l: Obj) => [l.level, l.present])).toEqual([
      ["below_knee", ["hip", "knee"]],
      ["above_knee", ["hip"]],
      ["below_elbow", ["shoulder", "elbow"]],
      ["above_elbow", ["shoulder"]],
    ]);
    expect(presentRegions("shoulder (residual upper arm)", "x")).toEqual(["shoulder"]);
    expect(presentRegions("hip, knee (residual)", "x")).toEqual(["hip", "knee"]);
    const s = romSource();
    s.limbLoss.levels[0].present = "hip, thigh";
    expect(() => exportRom(s)).toThrow('limbLoss below_knee: present "hip, thigh": thigh is not a region id');
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
    // Numbers mode: the step and the numbers copied next to each rule, never the rule in words.
    expect(g.preprocessing.every((p: Obj) => typeof p.step === "string" && !("rule" in p))).toBe(true);
    expect(g.capture.common).not.toHaveProperty("model");
    expect(Object.keys(g.events.front)).toEqual(["singleStanceWindowPct"]);
    expect(g.confidenceModel).not.toHaveProperty("firing");
    expect(g.confidenceModel.capFromGrade.A).toBe("high");
    expect(g.patterns.every((p: Obj) => !("section" in p) && !("sides" in p) && !("labelRule" in p))).toBe(
      true,
    );
    expect(g.findings.every((f: Obj) => !("rule" in f) && !("use" in f))).toBe(true);
    expect(g.errorMargins).not.toHaveProperty("thresholdRule");
    expect(g.retest).toEqual({ realChange: committed("gait").retest.realChange });
  });

  it("moves the why lines to the top level and drops the merge and selection prose", () => {
    const t = exportTargets(targetsSource()) as Obj;
    expect(t.whyLines.length).toBeGreaterThan(0);
    expect(t.mapping).not.toHaveProperty("whyLines");
    expect(t.mapping).not.toHaveProperty("merge");
    expect(t.mapping).not.toHaveProperty("selection");
    // D-029 item 1, E2-1: the evidence grade is kept beside the numbers; the strength words are not.
    expect(
      t.dose.profiles.every((p: Obj) => Object.keys(p).join() === "id,ar,en,numbers,evidenceGrade"),
    ).toBe(true);
  });

  it("strip removes the dropped fields at any depth and leaves the rest", () => {
    expect(strip({ a: 1, note: "x", b: [{ basis: "y", c: 2, why: "z" }], whyLine: "kept" })).toEqual({
      a: 1,
      b: [{ c: 2 }],
      whyLine: "kept",
    });
  });
});
