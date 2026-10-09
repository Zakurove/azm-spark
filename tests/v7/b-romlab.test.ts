/**
 * D-035 item 4, the range test page (src/features/focus/RomLab.tsx): one item per movement and side
 * with its block, the links of the index, the verdict in both languages and the JSON block. The page
 * itself runs in e2e/v7-romlab.spec.ts on the simulated person. Rendered on the server.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabIndex, labItem, labJson, labUrl, verdictOf } from "../../src/features/focus/RomLab";
import type { RomMeasureResult } from "../../src/engine/rom/types";
import { ROM_ENGINE_VERSION, movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";

const result = (over: Partial<RomMeasureResult>): RomMeasureResult =>
  ({
    movementId: "elbow_flexion",
    side: "right",
    position: "seated",
    status: "measured",
    reason: null,
    value: 132,
    median: 132,
    nValid: 1,
    painLimited: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    attempts: [],
    practice: [],
    retries: 0,
    flags: [],
    quality: { ok: true, retries: 0, issues: [], medianFps: 30, maxPausedShare: 0 },
    poseModel: "full",
    movementVersion: 1,
    engineVersion: ROM_ENGINE_VERSION,
    durationSec: 30,
    ...over,
  }) as RomMeasureResult;

describe("the range test page", () => {
  it("one item per movement: its first position by default, the block of the position", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const def = movementDef(id);
      const it0 = labItem(id, "right");
      expect(it0.position).toBe(def.positions[0].id);
      expect(it0.block).toBe(
        it0.position.startsWith("seated") ? "seated" : it0.position === "lying_back" ? "lying" : "standing",
      );
      expect(it0.askCanMove).toBe(false);
      for (const p of def.positions) expect(labItem(id, "left", p.id).position).toBe(p.id);
    }
    expect(labUrl("elbow_flexion", "right", "seated", "en")).toBe(
      "/?romlab=elbow_flexion&side=right&position=seated&lang=en",
    );
    expect(labUrl("neck_flexion", "none", "seated", "ar")).toBe("/?romlab=neck_flexion&position=seated");
  });

  it("the index lists the 16 movements with a link per position and side", () => {
    const html = renderToStaticMarkup(createElement(LabIndex, { lang: "en", onLanguage: () => {} }));
    for (const id of ROM_MOVEMENT_IDS) expect(html).toContain(`data-movement="${id}"`);
    expect(html).toContain('href="/?romlab=shoulder_flexion&amp;side=left&amp;position=seated&amp;lang=en"');
    expect(html).toContain('href="/?romlab=trunk_flexion&amp;position=standing_supported&amp;lang=en"');
  });

  it("the verdict: measured with its value, or not measured with the reason and the tries' reasons", () => {
    expect(verdictOf(result({}), true, "en")).toEqual({ kind: "measured", text: "Measured: 132°" });
    expect(verdictOf(result({}), true, "ar")).toEqual({ kind: "measured", text: "قيست: ١٣٢°" });
    const tries = [1, 1, 1].map((index) => ({ index, outcome: "retry", reasons: ["no_hold"] }));
    const not = verdictOf(
      result({ status: "not_measured", reason: "quality", value: null, attempts: tries as never }),
      true,
      "en",
    );
    expect(not?.kind).toBe("not_measured");
    expect(not?.text).toMatch(
      /^Not measured because no steady top was found.*\(no_hold, no_hold, no_hold\)$/,
    );
    expect(verdictOf(null, false, "en")).toBeNull();
    expect(verdictOf(null, true, "en")).toEqual({ kind: "stopped", text: "Stopped before the end" });
  });

  it("the JSON block holds what the runner decided and why", () => {
    const json = labJson(
      labItem("elbow_flexion", "right"),
      result({ flags: ["approximate"] }),
      {
        events: [],
        attempts: [
          {
            index: 1,
            outcome: "valid",
            value: 132,
            answer: "yes/timeout",
            reasons: ["upper_arm_moves"],
            flags: ["approximate"],
          },
        ],
        cues: ["elbow_by_side"],
        compensations: ["upper_arm_moves:cue", "upper_arm_moves:flag"],
        frames: [],
      },
      "full",
    );
    expect(json).toMatchObject({
      mv: "elbow_flexion",
      engine: ROM_ENGINE_VERSION,
      status: "measured",
      value: 132,
      flags: ["approximate"],
      tries: [[1, "valid", 132, "yes/timeout", "upper_arm_moves", "approximate"]],
      lines: ["elbow_by_side"],
    });
    expect(JSON.stringify(json).length).toBeLessThan(600);
  });
});
