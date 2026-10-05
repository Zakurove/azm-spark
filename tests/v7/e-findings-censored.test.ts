/**
 * D-028 item 3 (AP-11; built with E3): on the findings page, a seated side bend the runner capped (flag
 * "censored", W2-6: the lean held so far, at most the limit, as a lower bound) shows «أكثر من {value}» /
 * "more than {value}", v1's own words (check data progress.noVerdict.censored), with its degrees.
 */
import { describe, expect, it } from "vitest";
import { findingsView } from "../../src/features/focus/findings";
import type { FocusProfile } from "../../src/features/focus/api";
import type { Intake } from "../../src/medical/plan";
import type { RomProfileEntry } from "../../src/medical/rom-types";
import { CHECK_DATA } from "../../src/movements/assessments";
import { V7_DICTIONARIES } from "../../src/i18n/v7";
import { intake } from "./e-fixtures";

const entry = (over: Partial<RomProfileEntry>): RomProfileEntry => ({
  movementId: "trunk_lateral_flexion",
  side: "right",
  region: "back_trunk",
  source: "measured",
  kind: "flexion",
  value: 30,
  typical: 32,
  percentOfNormal: 94,
  z: -0.4,
  finding: "within",
  gradeIgnoringPain: "within",
  painLimited: false,
  painLevel: null,
  cause: null,
  provisional: false,
  approximate: false,
  noActiveMovement: false,
  flags: [],
  reason: null,
  measuredAt: 5,
  checkId: "c1",
  ...over,
});
const data = (entries: RomProfileEntry[]): FocusProfile => ({
  profile: { sex: "male", age: 58, normsVersion: "n", created: 5, entries },
  findings: [],
  bodyMap: { "back_trunk:axial": "within" },
  gait: null,
  changes: [],
  gaitChanges: [],
});
const h: Intake = intake({
  regions: [{ region: "back_trunk", side: "axial", problems: ["weakness"], origin: "person" }],
});
const row = (lang: "ar" | "en", e: RomProfileEntry) =>
  findingsView(data([e]), h, lang).groups[0].rows.find(
    (r) => r.movementId === e.movementId && r.side === e.side,
  )!;
const strip = (s: string) => s.replace(/[⁦-⁩]/g, "");

describe("a capped seated side bend on the findings page", () => {
  it("reuses v1's words for a censored value", () => {
    const v1 = CHECK_DATA.progress.noVerdict.censored;
    const findings = (lang: "ar" | "en") =>
      (V7_DICTIONARIES[lang].rom as { findings: { moreThan: string } }).findings.moreThan;
    expect(findings("ar")).toBe(v1.ar);
    expect(findings("en")).toBe(v1.en);
  });

  it("shows «أكثر من» and the degrees of the capped value", () => {
    const capped = entry({ flags: ["censored"] });
    expect(strip(row("ar", capped).value!)).toBe("أكثر من ٣٠°");
    expect(strip(row("en", capped).value!)).toBe("more than 30°");
  });

  it("an uncapped value shows its degrees alone", () => {
    expect(row("en", entry({})).value).toBe("30°");
    expect(row("ar", entry({})).value).toBe("٣٠°");
  });
});
