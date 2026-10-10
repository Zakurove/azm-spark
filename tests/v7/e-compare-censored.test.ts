/**
 * D-029 item 1, E3-4: compareRom reads `censored` (W2-6: a seated side bend the runner capped is a
 * lower bound). As v1.1 reads a censored side lean (progress-rules: «A baseline censored ... gives
 * "censored" ... the start value is shown as "more than {value}" and no verdict»): a censored starting
 * point gives no verdict, and the findings page shows the values alone, each capped one as
 * «أكثر من {value}» / "more than {value}". A capped retest value is the earlier best plus 15 at least, so
 * the change it shows beyond the band keeps its verdict.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RomFlag } from "../../src/engine/rom/types";
import type { FocusProfile } from "../../src/features/focus/api";
import { findingsView } from "../../src/features/focus/findings";
import { compareRom } from "../../src/medical/rom-profile";
import type { RomChange, RomProfileEntry, StoredRomRow } from "../../src/medical/rom-types";
import { retestState, type CheckResults } from "../../src/medical/targets";
import { movementDef, NORMS_VERSION } from "../../src/movements/rom";
import { entry as mapEntry, finding, intake } from "./e-fixtures";

let n = 0;
const row = (value: number, median: number, flags: RomFlag[] = []): StoredRomRow => ({
  id: `r${++n}`,
  checkId: `c${n}`,
  movementId: "trunk_lateral_flexion",
  side: "right",
  position: "seated_armrests",
  value,
  source: "measured",
  reason: null,
  pain: false,
  painLevel: null,
  painBefore: null,
  cause: null,
  percentNormal: null,
  finding: "within",
  gradeIgnoringPain: null,
  norm: null,
  median,
  nValid: 3,
  flags,
  poseModel: "full",
  movementVersion: movementDef("trunk_lateral_flexion").version,
  normsVersion: NORMS_VERSION,
  engineVersion: "rom_engine_1",
  created: n,
});

describe("compareRom reads a capped side bend (E3-4)", () => {
  it("a capped starting point gives no verdict, whatever the new value", () => {
    for (const [value, median] of [
      [45, 44],
      [30, 30],
      [12, 12],
    ])
      expect(compareRom([row(30, 30, ["censored"])], [row(value, median)], [])[0]).toMatchObject({
        first: 30,
        latest: value,
        direction: "none",
        firstCensored: true,
      });
  });

  it("a capped retest value keeps the verdict its change gives", () => {
    expect(compareRom([row(20, 20)], [row(35, 35, ["censored"])], [])[0]).toMatchObject({
      direction: "better",
      latestCensored: true,
    });
  });

  it("values the runner did not cap read as before", () => {
    expect(compareRom([row(20, 20)], [row(35, 35)], [])[0]).toEqual({
      movementId: "trunk_lateral_flexion",
      side: "right",
      first: 20,
      latest: 35,
      bandDeg: 10,
      direction: "better",
    });
  });
});

describe("the findings page shows a no verdict change as its values (E3-4)", () => {
  const e: RomProfileEntry = {
    movementId: "trunk_lateral_flexion",
    side: "right",
    region: "back_trunk",
    source: "measured",
    kind: "flexion",
    value: 40,
    typical: 32,
    percentOfNormal: 100,
    z: 0.5,
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
    checkId: "c2",
  };
  const change: RomChange = {
    movementId: "trunk_lateral_flexion",
    side: "right",
    first: 30,
    latest: 40,
    bandDeg: 10,
    direction: "none",
    firstCensored: true,
  };
  const data: FocusProfile = {
    profile: { sex: "male", age: 58, normsVersion: "n", created: 5, entries: [e] },
    findings: [],
    bodyMap: { "back_trunk:axial": "within" },
    gait: null,
    changes: [change],
    gaitChanges: [],
  };
  const h = intake({ regions: [mapEntry("back_trunk", "axial", ["weakness"])] });
  const strip = (s: string) => s.replace(/[⁦-⁩]/g, "");
  const rowOf = (lang: "ar" | "en") =>
    findingsView(data, h, lang).groups[0].rows.find((r) => r.movementId === "trunk_lateral_flexion")!;

  it("no verdict words, and the capped start as «أكثر من»", () => {
    const en = rowOf("en").change!;
    expect(en.direction).toBe("none");
    expect(en.text).toBe("");
    expect(strip(en.values)).toBe("At your starting point more than 30°, in this check 40°");
    expect(strip(rowOf("ar").change!.values)).toBe("عند نقطة بدايتك أكثر من 30°، وفي هذا القياس 40°");
  });

  it("the re-test rule never reads it as better", () => {
    const f = finding("trunk_lateral_flexion", "right", { region: "back_trunk" });
    const now: CheckResults = {
      rom: [],
      profile: data.profile,
      changes: [change],
      gait: null,
      support: [],
      walkViews: [],
    };
    const s = retestState([{ ...now, rom: [f], changes: [] }, now]);
    expect(s.rom).toEqual([f]);
    expect(s.maintenance.rom).toEqual([]);
  });

  it("renders no empty verdict", () => {
    const html = renderToStaticMarkup(createElement("p", null, rowOf("en").change!.text || null));
    expect(html).toBe("<p></p>");
  });
});
