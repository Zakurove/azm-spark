/**
 * Step B4, row B4 of contract section 10: «findings page with body map summary, the gait card slot and
 * the targets slot». The page's states rendered on the server (FindingsScreen is pure; the page itself
 * only loads), and loadFindings reading the profile route's answers.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FindingsPage, {
  FindingsScreen,
  loadFindings,
  type FindingsLoad,
} from "../../src/features/focus/FindingsPage";
import type { FocusApi, FocusProfile } from "../../src/features/focus/api";
import { findingsView } from "../../src/features/focus/findings";
import { bodyMapSummary, buildRomProfile, romFindings } from "../../src/medical/rom-profile";
import { gradeMeasurement } from "../../src/medical/rom-norms";
import type { Intake, Sex } from "../../src/medical/plan";
import type { StoredRomRow } from "../../src/medical/rom-types";
import type { GaitStoredView } from "../../src/medical/gait-types";
import type { RomMeasureResult } from "../../src/engine/rom/types";
import { NORMS_VERSION, movementDef, romResultLine } from "../../src/movements/rom";
import { tV7 } from "../../src/i18n/v7";
import { t } from "../../src/i18n";

const FAHD = {
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
  regions: [
    { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
    { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
  ],
  walking: { status: "without_aid" },
} as Intake & { sex: Sex };

function measured(
  movementId: "knee_flexion" | "shoulder_flexion",
  position: "lying_back" | "seated",
  value: number,
): StoredRomRow {
  const result = {
    movementId,
    side: "right",
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
    flags: [],
  } as unknown as RomMeasureResult;
  const g = gradeMeasurement(result, FAHD);
  return {
    id: `r-${movementId}`,
    checkId: "6b3f0c2e-1d2a-4c8e-9f00-0a1b2c3d4e5f",
    movementId,
    side: "right",
    position,
    value,
    source: "measured",
    reason: null,
    pain: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    percentNormal: g.percentNormal,
    finding: g.finding,
    gradeIgnoringPain: g.gradeIgnoringPain,
    norm: g.norm,
    median: value,
    nValid: 3,
    flags: g.flags,
    poseModel: "full",
    movementVersion: movementDef(movementId).version,
    normsVersion: NORMS_VERSION,
    engineVersion: "rom_engine_1",
    created: 1000,
  };
}

const AT = Date.UTC(2026, 9, 4, 9, 0, 0);
function answer(gait: GaitStoredView | null = null): FocusProfile {
  const rows = [measured("knee_flexion", "lying_back", 95), measured("shoulder_flexion", "seated", 150)];
  const profile = buildRomProfile({ intake: FAHD, rows, now: AT });
  return {
    profile,
    findings: romFindings(profile, FAHD),
    bodyMap: bodyMapSummary(profile),
    gait,
    changes: [],
    gaitChanges: [],
  };
}

const render = (load: FindingsLoad, lang: "ar" | "en" = "en") =>
  renderToStaticMarkup(
    createElement(FindingsScreen, { lang, load, onLanguage: vi.fn(), onExit: vi.fn(), onRetry: vi.fn() }),
  );

describe("the findings page", () => {
  it("shows the results: the check, its body map summary, a card per joint with its movements, the other joints", () => {
    const html = render({ kind: "ready", data: answer(), intake: FAHD });
    const view = findingsView(answer(), FAHD, "en");
    expect(html).toContain('data-screen="findings"');
    expect(html).toContain(tV7("en", "rom.findings.title"));
    expect(html).toContain(tV7("en", "rom.findings.when", { date: view.date }));
    // The body map in summary mode, its marks on the joints of the history and its legend.
    expect(html).toContain("bm-summary");
    expect(html).toMatch(/class="bm-cell bm-mark bm-marked" data-cell="knee:right"/);
    expect(html).toMatch(/class="bm-cell bm-mark bm-within" data-cell="shoulder:right"/);
    expect(html).not.toContain('data-cell="knee:left"');
    expect(html).toContain('data-tone="marked"');
    // One card per joint of the history, its movements measured or not, in body order.
    expect(html.indexOf('data-cell="shoulder:right"><i')).toBeLessThan(
      html.indexOf('data-cell="knee:right"><i'),
    );
    expect(html).toMatch(/data-movement="knee_flexion" data-side="right" data-finding="marked"/);
    // The movements the camera never measures: one line in their joint's card.
    expect(html).toContain('class="fx-row fx-unmeasured"');
    expect(html).toContain("Shoulder turn inward");
    expect(html).toContain(tV7("en", "rom.findings.cameraNeverLabel"));
    expect(html).toContain(romResultLine("label_marked").en);
    expect(html).toContain(romResultLine("finding_new").en);
    expect(html).toContain(romResultLine("finding_weak").en);
    // The joints off the body map, counted as typical.
    expect(html).toContain(tV7("en", "rom.findings.othersTitle"));
    expect(html).toContain("Left knee");
    // No walk in this check: no gait slot; the targets slot carries the check.
    expect(html).not.toContain('data-slot="gait"');
    expect(html).toContain('data-slot="targets"');
    expect(html).toContain('data-action="results"');
    expect(html).toContain('data-action="today"');
  });

  it("keeps a slot for the walk's card when the check has a walk", () => {
    const gait: GaitStoredView = {
      id: "g1",
      mode: "overground",
      views: [],
      metrics: {},
      patterns: [],
      findings: [],
      quality: { gatePassed: true, timingOnly: false, flags: [] },
      replay: null,
      provisional: false,
      rulesVersion: "gait_rules_test",
      created: AT,
    };
    expect(render({ kind: "ready", data: answer(gait), intake: FAHD })).toContain('data-slot="gait"');
  });

  it("reads right to left in Arabic, with Western digits (D-036 item 3)", () => {
    const html = render({ kind: "ready", data: answer(), intake: FAHD }, "ar");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(tV7("ar", "rom.findings.title"));
    expect(html).toContain("95°");
    expect(html).toContain("الركبة اليمنى");
  });

  it("shows the loading, none, intake and error states, each with its way forward", () => {
    expect(render({ kind: "loading" })).toContain('data-screen="findings_loading"');
    const none = render({ kind: "none" });
    expect(none).toContain('data-screen="findings_none"');
    expect(none).toContain(tV7("en", "rom.findings.noneTitle"));
    expect(none).toContain('data-action="start"');
    const intake = render({ kind: "intake" });
    expect(intake).toContain('data-screen="findings_intake"');
    expect(intake).toContain(tV7("en", "rom.closed.intakeTitle"));
    const error = render({ kind: "error" });
    expect(error).toContain('data-screen="findings_error"');
    expect(error).toContain('data-action="retry"');
    expect(error).toContain(t("en", "assessment.state.error.title"));
  });

  it("renders nothing but its loading line on the server, before its data arrives", () => {
    const html = renderToStaticMarkup(
      createElement(FindingsPage, { lang: "en", onLanguage: vi.fn(), checkId: null, onExit: vi.fn() }),
    );
    expect(html).toContain('data-screen="findings_loading"');
  });
});

describe("loadFindings", () => {
  const api = (
    profile: Awaited<ReturnType<FocusApi["profile"]>>,
    me: Awaited<ReturnType<FocusApi["me"]>>,
  ) => ({
    profile: vi.fn(async () => profile),
    me: vi.fn(async () => me),
  });

  it("asks for the named check or the latest, and reads the intake beside it", async () => {
    const a = api({ ok: true, value: answer() }, { ok: true, value: { intake: FAHD } });
    expect(await loadFindings(a, "c1")).toEqual({ kind: "ready", data: answer(), intake: FAHD });
    expect(a.profile).toHaveBeenCalledWith("c1");
    const b = api({ ok: true, value: answer() }, { ok: false, error: { kind: "network" } });
    expect(await loadFindings(b, null)).toEqual({ kind: "ready", data: answer(), intake: null });
    expect(b.profile).toHaveBeenCalledWith(null);
  });

  it("reads 404 NONE as no results yet, 409 as the body questions to answer, anything else as an error", async () => {
    const me = { ok: true as const, value: { intake: FAHD } };
    const http = (status: number, code: string) =>
      ({ ok: false, error: { kind: "http", status, code, body: {} } }) as const;
    expect(await loadFindings(api(http(404, "NONE"), me), null)).toEqual({ kind: "none" });
    expect(await loadFindings(api(http(409, "INTAKE_UPDATE_REQUIRED"), me), null)).toEqual({
      kind: "intake",
    });
    expect(await loadFindings(api(http(409, "PLAN_REQUIRED"), me), null)).toEqual({ kind: "intake" });
    expect(await loadFindings(api(http(404, "NOT_FOUND"), me), null)).toEqual({ kind: "error" });
    expect(await loadFindings(api(http(500, "SERVER"), me), null)).toEqual({ kind: "error" });
    expect(await loadFindings(api({ ok: false, error: { kind: "offline" } }, me), null)).toEqual({
      kind: "error",
    });
  });
});
