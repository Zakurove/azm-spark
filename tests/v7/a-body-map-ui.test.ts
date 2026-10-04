/**
 * The body map component (product v7 contract 2.2): a front and a back outline with one 44 px target
 * per region and side, in edit mode (the intake) and summary mode (the findings page). Left and right
 * are the person's own, so each view names its sides and the figure never mirrors with the page
 * direction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BodyMap, {
  BODY_MAP_CELLS,
  cellLabel,
  cellPoint,
  entryLabel,
  toggleBodyMapCell,
} from "../../src/features/body-map/BodyMap";
import type { RegionEntry } from "../../src/medical/body-map";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const shoulderRight: RegionEntry = {
  region: "shoulder",
  side: "right",
  problems: ["pain"],
  origin: "person",
};
const kneesBoth: RegionEntry = { region: "knee", side: "both", problems: ["weakness"], origin: "condition" };

describe("the cells", () => {
  it("has one cell per region and side: two axial and twelve limb cells", () => {
    expect(BODY_MAP_CELLS).toHaveLength(14);
    expect(BODY_MAP_CELLS.slice(0, 4)).toEqual([
      "neck:axial",
      "back_trunk:axial",
      "shoulder:right",
      "shoulder:left",
    ]);
  });

  it("puts the person's right on your left from the front, and on your right from the back", () => {
    for (const region of ["shoulder", "elbow", "forearm_wrist", "hip", "knee", "ankle_foot"] as const) {
      const front = cellPoint(`${region}:right`, "front");
      const back = cellPoint(`${region}:right`, "back");
      expect(front.x).toBeLessThan(120);
      expect(back.x).toBeGreaterThan(120);
      expect(cellPoint(`${region}:left`, "front")).toEqual(back);
      expect(back.y).toBe(front.y);
    }
    expect(cellPoint("neck:axial", "front")).toEqual(cellPoint("neck:axial", "back"));
    expect(cellPoint("back_trunk:axial", "front").x).toBe(120);
  });

  it("keeps every two targets apart at the 240 px figure (no overlapping 44 px targets)", () => {
    for (const view of ["front", "back"] as const)
      for (const a of BODY_MAP_CELLS)
        for (const b of BODY_MAP_CELLS) {
          if (a >= b) continue;
          const p = cellPoint(a, view),
            q = cellPoint(b, view);
          expect(Math.hypot(p.x - q.x, p.y - q.y), `${a} ${b} ${view}`).toBeGreaterThanOrEqual(44);
        }
  });

  it("sizes each target 44 px in the stylesheet", () => {
    const css = readFileSync(join(__dirname, "../../src/features/body-map/body-map.css"), "utf8");
    const rule = css.match(/\.bm-cell \{[^}]*\}/)![0];
    expect(rule).toContain("width: 44px");
    expect(rule).toContain("height: 44px");
    expect(css).toMatch(/\.bm-figure \{[^}]*direction: ltr/);
  });

  it("names a cell and an entry by region and side, in both languages", () => {
    expect(cellLabel("ar", "shoulder:right")).toBe("الكتف، الجهة اليمنى");
    expect(cellLabel("en", "shoulder:right")).toBe("Shoulder, right side");
    expect(cellLabel("ar", "neck:axial")).toBe("الرقبة");
    expect(entryLabel("ar", "knee", "both")).toBe("الركبة، الجهتان");
    expect(entryLabel("en", "ankle_foot", "left")).toBe("Ankle and foot, left side");
  });
});

describe("toggleBodyMapCell", () => {
  it("adds an empty cell as the person's own region with no problem type yet", () => {
    expect(toggleBodyMapCell([], "hip:left")).toEqual([
      { region: "hip", side: "left", problems: [], origin: "person" },
    ]);
    expect(toggleBodyMapCell([shoulderRight], "shoulder:left")).toEqual([
      shoulderRight,
      { region: "shoulder", side: "left", problems: [], origin: "person" },
    ]);
  });

  it("takes a one sided or axial entry off the map", () => {
    expect(toggleBodyMapCell([shoulderRight, kneesBoth], "shoulder:right")).toEqual([kneesBoth]);
    expect(
      toggleBodyMapCell(
        [{ region: "neck", side: "axial", problems: ["pain"], origin: "person" }],
        "neck:axial",
      ),
    ).toEqual([]);
  });

  it("leaves a both entry on the other side, with its answers", () => {
    expect(toggleBodyMapCell([kneesBoth], "knee:left")).toEqual([{ ...kneesBoth, side: "right" }]);
    expect(toggleBodyMapCell([kneesBoth], "knee:right")).toEqual([{ ...kneesBoth, side: "left" }]);
  });
});

describe("edit mode", () => {
  const render = (lang: "ar" | "en", value: RegionEntry[]) =>
    renderToStaticMarkup(createElement(BodyMap, { lang, mode: "edit", value, onChange: () => {} }));

  it("shows the front view first with its sides named, and a button for each cell", () => {
    const html = render("ar", []);
    expect(html.match(/<button[^>]*class="bm-cell"/g)).toHaveLength(14);
    expect(html).toMatch(/aria-pressed="true"[^>]*>من الأمام/);
    const sides = [...html.matchAll(/class="bm-side bm-side-(start|end)"[^>]*>([^<]+)</g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(sides).toEqual([
      ["start", "يمينك"],
      ["end", "يسارك"],
    ]);
    expect(html).toContain('aria-label="الكتف، الجهة اليمنى"');
    expect(html).toContain('aria-hidden="true"');
    expect(plain(render("en", []))).toContain("Your right");
  });

  it("presses the cells on the map, both cells for a both entry", () => {
    const html = render("en", [shoulderRight, kneesBoth]);
    const pressed = [...html.matchAll(/data-cell="([^"]+)"[^>]*aria-pressed="true"/g)].map((m) => m[1]);
    expect(pressed.sort()).toEqual(["knee:left", "knee:right", "shoulder:right"]);
  });
});

describe("summary mode", () => {
  it("colours the cells it is given, with no buttons, and reads the notes", () => {
    const html = renderToStaticMarkup(
      createElement(BodyMap, {
        lang: "en",
        mode: "summary",
        colours: { "knee:right": "marked", "neck:axial": "grey", "hip:left": "none" },
        notes: { "knee:right": "markedly limited" },
      }),
    );
    expect(html).not.toMatch(/<button[^>]*bm-cell/);
    expect(html.match(/class="bm-cell bm-mark/g)).toHaveLength(2);
    expect(html).toContain('class="bm-cell bm-mark bm-marked"');
    expect(html).toContain('aria-label="Knee, right side: markedly limited"');
    expect(html).toContain('aria-label="Neck"');
    expect(html).not.toContain("hip:left");
  });
});
