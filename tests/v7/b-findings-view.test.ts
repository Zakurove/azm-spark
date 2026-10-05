/**
 * Step B4: the findings page's view (src/features/focus/findings.ts), pure: the profile route's answer
 * and the intake turned into the page's groups, rows, legend and walk lines. The answers are built by
 * the server's own pure functions (buildRomProfile, romFindings, bodyMapSummary, compareRom), so the
 * page reads exactly what the route sends; every clinical word is checked against the range data.
 */
import { describe, expect, it } from "vitest";
import { findingsView, toneLabel, type RowView } from "../../src/features/focus/findings";
import type { FocusProfile } from "../../src/features/focus/api";
import {
  bodyMapSummary,
  buildRomProfile,
  compareRom,
  romFindings,
  type GaitChange,
} from "../../src/medical/rom-profile";
import { gradeMeasurement } from "../../src/medical/rom-norms";
import type { Intake, Sex } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";
import type { StoredRomRow } from "../../src/medical/rom-types";
import type { RomMeasureResult } from "../../src/engine/rom/types";
import { NORMS_VERSION, movementDef, romCopy, romResultLine } from "../../src/movements/rom";
import type { JointMovementId, RomMovementId, RomPositionId, RomSide } from "../../src/movements/rom/types";
import { interpolate } from "../../src/i18n";
import { tV7 } from "../../src/i18n/v7";

const intakeOf = (regions: RegionEntry[], over: Partial<Intake> = {}): Intake & { sex: Sex } =>
  ({
    age: 58,
    conditions: ["stroke"],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "right",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: ["chair"],
    goal: "habit",
    days: [0, 2, 4],
    time: "09:00",
    sessionMinutes: 30,
    consent: true,
    sex: "male",
    regions,
    walking: { status: "without_aid" },
    ...over,
  }) as Intake & { sex: Sex };

const FAHD = intakeOf([
  { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
  { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
]);

let id = 0;
function measured(
  intake: Intake & { sex: Sex },
  movementId: RomMovementId,
  side: RomSide,
  position: RomPositionId,
  value: number,
  over: Partial<RomMeasureResult> = {},
  row: Partial<StoredRomRow> = {},
): StoredRomRow {
  const result = {
    movementId,
    side,
    position,
    status: "measured",
    reason: null,
    value,
    median: value,
    nValid: 3,
    painLimited: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    attempts: [],
    practice: [],
    retries: 0,
    flags: [],
    quality: { ok: true, retries: 0, issues: [], medianFps: 28, maxPausedShare: 0 },
    poseModel: "full",
    movementVersion: movementDef(movementId).version,
    engineVersion: "rom_engine_1",
    durationSec: 40,
    ...over,
  } as RomMeasureResult;
  const g = gradeMeasurement(result, intake);
  const v = result.status === "not_measured" ? null : result.value;
  return {
    id: `r${++id}`,
    checkId: "c-latest",
    movementId,
    side,
    position,
    value: v,
    source: v === null ? "not_measured_today" : "measured",
    reason: result.reason,
    pain: result.painLimited,
    painLevel: result.painLevel,
    painBefore: result.painBefore,
    cause: result.cause,
    percentNormal: g.percentNormal,
    finding: g.finding,
    gradeIgnoringPain: g.gradeIgnoringPain,
    norm: g.norm,
    median: result.median,
    nValid: result.nValid,
    flags: g.flags,
    poseModel: "full",
    movementVersion: result.movementVersion,
    normsVersion: NORMS_VERSION,
    engineVersion: "rom_engine_1",
    created: 1000 + id,
    ...row,
  };
}

function notMeasured(
  movementId: JointMovementId,
  side: RomSide,
  source: StoredRomRow["source"],
  reason: StoredRomRow["reason"],
  finding: StoredRomRow["finding"],
): StoredRomRow {
  return {
    id: `r${++id}`,
    checkId: "c-latest",
    movementId,
    side,
    position: null,
    value: null,
    source,
    reason,
    pain: false,
    painLevel: null,
    painBefore: null,
    cause: null,
    percentNormal: null,
    finding,
    gradeIgnoringPain: null,
    norm: null,
    median: null,
    nValid: 0,
    flags: [],
    poseModel: null,
    movementVersion: null,
    normsVersion: NORMS_VERSION,
    engineVersion: null,
    created: 1000 + id,
  };
}

/** 2026-10-04 12:00 in Riyadh. */
const AT = Date.UTC(2026, 9, 4, 9, 0, 0);

/** The route's answer for these rows, built by the server's own pure functions. */
function answer(
  intake: Intake & { sex: Sex },
  rows: StoredRomRow[],
  first: StoredRomRow[] = [],
  gaitChanges: GaitChange[] = [],
): FocusProfile {
  const profile = buildRomProfile({ intake, rows, now: AT });
  return {
    profile,
    findings: romFindings(profile, intake),
    bodyMap: bodyMapSummary(profile),
    gait: null,
    changes: compareRom(first, rows, intake.conditions),
    gaitChanges,
  };
}

const row = (v: ReturnType<typeof findingsView>, movementId: string, side = "right"): RowView => {
  for (const g of v.groups) {
    const r = g.rows.find((x) => x.movementId === movementId && x.side === side);
    if (r) return r;
  }
  throw new Error(`no row ${movementId} ${side}`);
};
const deg = (lang: "ar" | "en", n: number) => interpolate(lang, `${n}°`);
const result = (
  key: Parameters<typeof romResultLine>[0],
  lang: "ar" | "en",
  vars: Record<string, number> = {},
) => interpolate(lang, romResultLine(key)[lang], { unit: "deg", ...vars });

describe("findingsView: the page's groups and rows", () => {
  const rows = [
    measured(FAHD, "knee_flexion", "right", "lying_back", 95),
    measured(FAHD, "knee_extension", "right", "lying_back", 12),
    measured(FAHD, "shoulder_flexion", "right", "seated", 150),
    notMeasured("shoulder_extension", "right", "not_measured_today", "deferred", "not_today"),
    notMeasured("shoulder_abduction", "right", "not_measured_today", "not_reached", "not_today"),
    notMeasured(
      "shoulder_internal_rotation",
      "right",
      "not_measured_camera",
      "not_measured_camera",
      "unknown",
    ),
  ];
  const ar = findingsView(answer(FAHD, rows), FAHD, "ar");
  const en = findingsView(answer(FAHD, rows), FAHD, "en");

  it("groups the rows by the body map cells of the history, in body order, with their colours", () => {
    expect(ar.groups.map((g) => [g.cell, g.title])).toEqual([
      ["shoulder:right", "الكتف الأيمن"],
      ["knee:right", "الركبة اليمنى"],
    ]);
    expect(en.groups.map((g) => g.title)).toEqual(["Right shoulder", "Right knee"]);
    const data = answer(FAHD, rows);
    for (const g of ar.groups) expect(g.tone).toBe(data.bodyMap[g.cell] ?? null);
    // Each cell's movements: the camera's first, then the ones it never measures.
    expect(ar.groups[0].rows.map((r) => r.movementId)).toEqual([
      "shoulder_flexion",
      "shoulder_abduction",
      "shoulder_extension",
      "shoulder_internal_rotation",
      "shoulder_external_rotation",
    ]);
    expect(ar.checkId).toBe("c-latest");
  });

  it("names the joints counted as typical, in body order", () => {
    expect(ar.others).toEqual([
      "الرقبة",
      "الظهر والجذع",
      "الكتف الأيسر",
      "المرفق الأيمن",
      "المرفق الأيسر",
      "الساعد والرسغ الأيمن",
      "الساعد والرسغ الأيسر",
      "الورك الأيمن",
      "الورك الأيسر",
      "الركبة اليسرى",
      "الكاحل والقدم الأيمن",
      "الكاحل والقدم الأيسر",
    ]);
    expect(en.others.slice(0, 3)).toEqual(["Neck", "Back or trunk", "Left shoulder"]);
  });

  it("shows a measured movement against the typical value it was graded with: number, label, value line, finding line", () => {
    const knee = row(ar, "knee_flexion");
    const data = answer(FAHD, rows);
    const entry = data.profile.entries.find((e) => e.movementId === "knee_flexion" && e.side === "right")!;
    expect(entry.finding).toBe("marked");
    expect(knee).toMatchObject({
      name: "ثني الركبة",
      direction: null,
      value: deg("ar", 95),
      caption: null,
      typical: deg("ar", entry.typical!),
      label: { text: romResultLine("label_marked").ar, tone: "marked" },
      line: result("value_flexion", "ar", { value: 95, norm: entry.typical! }),
      // Stroke on a limb the condition filled in: the upper motor neuron path, «may suggest weakness».
      finding: romResultLine("finding_weak").ar,
      more: [romResultLine("finding_new").ar],
      change: null,
      findingId: "marked",
    });
    expect(knee.value).toBe("٩٥°");
    expect(knee.bar).toMatchObject({ value: 95, typical: entry.typical, first: null });
    expect(knee.bar!.band![0]).toBeGreaterThan(95);
    expect(knee.bar!.band![1]).toBe(knee.bar!.max);
    expect(row(en, "knee_flexion").line).toBe(
      result("value_flexion", "en", { value: 95, norm: entry.typical! }),
    );
  });

  it("shows a lack in degrees from straight, with the band from straight and no typical number", () => {
    const ext = row(ar, "knee_extension");
    expect(ext).toMatchObject({
      name: "فرد الركبة",
      value: deg("ar", 12),
      caption: tV7("ar", "rom.measure.fromStraight"),
      typical: null,
      line: result("value_lack", "ar", { value: 12 }),
    });
    expect(ext.bar!.band![0]).toBe(0);
    expect(ext.bar!.typical).toBeNull();
  });

  it("notes the approximate comparison the person sees, and a first reading from one valid try", () => {
    expect(row(ar, "shoulder_flexion").notes).toContain(romResultLine("label_approximate").ar);
    const one = [measured(FAHD, "knee_flexion", "right", "lying_back", 95, { nValid: 1 })];
    expect(row(findingsView(answer(FAHD, one), FAHD, "ar"), "knee_flexion").notes).toEqual([
      romResultLine("label_provisional").ar,
    ]);
  });

  it("says why a movement was not measured, with its label", () => {
    expect(row(ar, "shoulder_extension")).toMatchObject({
      value: null,
      bar: null,
      label: { text: romResultLine("label_not_today").ar, tone: "grey" },
      line: romCopy("deferred_line").ar,
      finding: null,
    });
    expect(row(ar, "shoulder_abduction").line).toBe(romCopy("not_reached_line").ar);
    expect(row(ar, "shoulder_internal_rotation")).toMatchObject({
      label: { text: romResultLine("label_default").ar, tone: "grey" },
      line: romCopy("default_line").ar,
    });
    // No row here: the external rotation of an affected shoulder is grey, never typical (ROM-Q15).
    expect(row(ar, "shoulder_external_rotation").label).toEqual({
      text: romResultLine("label_default").ar,
      tone: "grey",
    });
    const reasons: [StoredRomRow["reason"], string][] = [
      ["quality", tV7("ar", "rom.result.quality")],
      ["no_hold", tV7("ar", "rom.result.quality")],
      ["by_choice", tV7("ar", "rom.result.byChoice")],
      ["stopped_symptom", tV7("ar", "rom.findings.stopped")],
      ["pain_today", tV7("ar", "rom.findings.safety")],
      ["red_flag", tV7("ar", "rom.findings.safety")],
    ];
    for (const [reason, line] of reasons) {
      const v = findingsView(
        answer(FAHD, [notMeasured("knee_flexion", "right", "not_measured_today", reason, "not_today")]),
        FAHD,
        "ar",
      );
      expect(row(v, "knee_flexion").line, String(reason)).toBe(line);
    }
    // A movement of the body map with no row at all (a region added after the check).
    expect(row(findingsView(answer(FAHD, []), FAHD, "ar"), "knee_flexion").line).toBe(
      tV7("ar", "rom.findings.notInCheck"),
    );
  });

  it("shows a pain stop, a pain limited value and a joint the person could not move", () => {
    const stop = notMeasured("knee_flexion", "right", "not_measured_today", "pain_stop", "not_today");
    expect(row(findingsView(answer(FAHD, [stop]), FAHD, "ar"), "knee_flexion")).toMatchObject({
      label: { text: romResultLine("label_pain").ar, tone: "pain" },
      line: tV7("ar", "rom.findings.painStop"),
    });
    const hurt = measured(FAHD, "knee_flexion", "right", "lying_back", 100, {
      painLimited: true,
      painLevel: 4,
    });
    expect(row(findingsView(answer(FAHD, [hurt]), FAHD, "ar"), "knee_flexion")).toMatchObject({
      label: { text: romResultLine("label_pain").ar, tone: "pain" },
      finding: romResultLine("finding_pain").ar,
      more: [],
    });
    const stuck = measured(FAHD, "knee_flexion", "right", "lying_back", 0, {
      status: "not_measured",
      reason: "no_active_movement",
      value: null,
      median: null,
      nValid: 0,
    });
    expect(row(findingsView(answer(FAHD, [stuck]), FAHD, "ar"), "knee_flexion")).toMatchObject({
      value: null,
      label: { text: tV7("ar", "rom.findings.noActive"), tone: "grey" },
      line: null,
      finding: romCopy("no_active_movement").ar,
    });
  });

  it("shows a seated knee lack with its own line and the care team line, without a typical value", () => {
    const seated = measured(FAHD, "knee_extension", "right", "seated", 60);
    expect(row(findingsView(answer(FAHD, [seated]), FAHD, "ar"), "knee_extension")).toMatchObject({
      value: deg("ar", 60),
      typical: null,
      label: null,
      line: result("value_knee_seated", "ar", { value: 60 }),
      finding: romResultLine("refer_measure").ar,
      more: [],
    });
  });

  it("reads label_uncertain for a small lying knee lack with a knee history on that side (7.4)", () => {
    const hurtKnee = intakeOf(
      [{ region: "knee", side: "right", problems: ["injury"], origin: "person", injury: { since: "gt6m" } }],
      {
        conditions: [],
      },
    );
    const lack = measured(hurtKnee, "knee_extension", "right", "lying_back", 6);
    expect(lack.finding).toBe("within");
    expect(row(findingsView(answer(hurtKnee, [lack]), hurtKnee, "ar"), "knee_extension").label).toEqual({
      text: romResultLine("label_uncertain").ar,
      tone: "within",
    });
    // Under 5 degrees, or with no knee history, it reads within.
    const small = measured(hurtKnee, "knee_extension", "right", "lying_back", 3);
    expect(row(findingsView(answer(hurtKnee, [small]), hurtKnee, "ar"), "knee_extension").label?.text).toBe(
      romResultLine("label_within").ar,
    );
    const plain = intakeOf([{ region: "knee", side: "right", problems: ["stiffness"], origin: "person" }], {
      conditions: [],
    });
    const plainLack = measured(plain, "knee_extension", "right", "lying_back", 6);
    expect(row(findingsView(answer(plain, [plainLack]), plain, "ar"), "knee_extension").label?.text).toBe(
      romResultLine("label_within").ar,
    );
  });

  it("names the direction of a bend to the side and keeps the neck in one card", () => {
    const neck = intakeOf([{ region: "neck", side: "axial", problems: ["stiffness"], origin: "person" }], {
      conditions: [],
    });
    const v = findingsView(
      answer(neck, [measured(neck, "neck_lateral_flexion", "right", "seated", 30)]),
      neck,
      "en",
    );
    expect(v.groups.map((g) => [g.cell, g.title])).toEqual([["neck:axial", "Neck"]]);
    expect(v.groups[0].rows.map((r) => [r.movementId, r.side, r.direction])).toEqual([
      ["neck_lateral_flexion", "right", "To the right"],
      ["neck_lateral_flexion", "left", "To the left"],
      ["neck_flexion", "none", null],
      ["neck_extension", "none", null],
      ["neck_rotation", "none", null],
    ]);
  });

  it("hides the joints that are absent, and keeps the map's colours in its legend", () => {
    const loss = intakeOf(
      [
        {
          region: "ankle_foot",
          side: "left",
          problems: ["limb_loss"],
          origin: "person",
          limbLoss: { level: "below_knee" },
        },
      ],
      { conditions: [] },
    );
    const rowsLoss = (
      ["ankle_dorsiflexion_lunge", "ankle_plantarflexion", "ankle_dorsiflexion_nwb"] as const
    ).map((m) => notMeasured(m, "left", "not_applicable", "limb_absent", "not_applicable"));
    const v = findingsView(answer(loss, rowsLoss), loss, "ar");
    expect(v.groups).toEqual([]);
    expect(v.others).not.toContain("الكاحل والقدم الأيسر");
    // The legend names the colours the map shows (the shoulder within, the knee marked), in one order.
    expect(ar.legend.map((l) => l.tone)).toEqual(["within", "marked"]);
    expect(ar.legend[0]).toEqual({ tone: "within", label: toneLabel("within", "ar") });
    expect(toneLabel("mild", "en")).toBe(romResultLine("label_mild").en);
    expect(toneLabel("pain", "ar")).toBe(romResultLine("label_pain").ar);
    expect(toneLabel("grey", "en")).toBe(tV7("en", "rom.findings.legendGrey"));
    expect(ar.mapNotes["knee:right"]).toBe(toneLabel("marked", "ar"));
  });

  it("dates the check in both languages, Gregorian, in Riyadh", () => {
    expect(en.date).toBe("Sunday, 4 October 2026");
    expect(ar.date).toContain("أكتوبر");
    expect(ar.date).toContain("٢٠٢٦");
  });
});

describe("findingsView: the changes since the starting point", () => {
  const first = [
    measured(
      FAHD,
      "knee_flexion",
      "right",
      "lying_back",
      90,
      { median: 88 },
      { checkId: "c-first", created: 10 },
    ),
    measured(
      FAHD,
      "knee_extension",
      "right",
      "lying_back",
      25,
      { median: 26 },
      { checkId: "c-first", created: 11 },
    ),
    measured(
      FAHD,
      "shoulder_flexion",
      "right",
      "seated",
      150,
      { median: 150 },
      { checkId: "c-first", created: 12 },
    ),
  ];
  const latest = [
    measured(FAHD, "knee_flexion", "right", "lying_back", 120, { median: 118 }),
    measured(FAHD, "knee_extension", "right", "lying_back", 8, { median: 9 }),
    measured(FAHD, "shoulder_flexion", "right", "seated", 152, { median: 151 }),
  ];
  const ar = findingsView(answer(FAHD, latest, first), FAHD, "ar");
  const en = findingsView(answer(FAHD, latest, first), FAHD, "en");

  it("words each change from the starting point, more range or closer to straight, never better or worse", () => {
    expect(ar.changes).toBe(true);
    expect(row(ar, "knee_flexion").change).toEqual({
      direction: "better",
      text: tV7("ar", "rom.findings.change.more"),
      values: tV7("ar", "rom.findings.change.values", { first: deg("ar", 90), latest: deg("ar", 120) }),
    });
    expect(row(en, "knee_extension").change).toMatchObject({
      direction: "better",
      text: tV7("en", "rom.findings.change.straighter"),
    });
    expect(row(en, "shoulder_flexion").change).toMatchObject({
      direction: "same",
      text: tV7("en", "rom.findings.change.same"),
    });
    // The bar keeps the starting point beside today.
    expect(row(ar, "knee_flexion").bar).toMatchObject({ value: 120, first: 90 });
    const worse = findingsView(answer(FAHD, first, latest), FAHD, "en");
    expect(row(worse, "knee_flexion").change?.text).toBe(tV7("en", "rom.findings.change.less"));
    expect(row(worse, "knee_extension").change?.text).toBe(tV7("en", "rom.findings.change.lessStraight"));
    expect(findingsView(answer(FAHD, latest), FAHD, "ar").changes).toBe(false);
  });

  it("names the walk's steps a minute, speed and step length, from the starting point to today", () => {
    const walk: GaitChange[] = [
      { metric: "speed_mps", first: 0.8, latest: 0.95, direction: "up" },
      { metric: "step_length_m", first: 0.52, latest: 0.53, direction: "same" },
      { metric: "cadence", first: 100, latest: 112, direction: "up" },
      { metric: "sr_stance", first: 1.2, latest: 1.1, direction: "down" },
    ];
    const v = findingsView(answer(FAHD, latest, first, walk), FAHD, "en");
    expect(v.walk).toEqual([
      {
        metric: "speed_mps",
        label: tV7("en", "rom.findings.walk.speed"),
        values: tV7("en", "rom.findings.walk.fromTo", {
          first: tV7("en", "rom.findings.walk.speedValue", { n: "0.8" }),
          latest: tV7("en", "rom.findings.walk.speedValue", { n: "0.95" }),
        }),
        same: false,
      },
      {
        metric: "step_length_m",
        label: tV7("en", "rom.findings.walk.step"),
        values: tV7("en", "rom.findings.walk.fromTo", {
          first: tV7("en", "rom.findings.walk.stepValue", { n: "52" }),
          latest: tV7("en", "rom.findings.walk.stepValue", { n: "53" }),
        }),
        same: true,
      },
      {
        metric: "cadence",
        label: tV7("en", "rom.findings.walk.cadence"),
        values: tV7("en", "rom.findings.walk.fromTo", { first: "100", latest: "112" }),
        same: false,
      },
    ]);
    const arWalk = findingsView(answer(FAHD, latest, first, walk), FAHD, "ar").walk;
    expect(arWalk[0].values).toContain("٠٫٩٥");
  });
});
