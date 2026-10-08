/**
 * The body map component (product v7 contract 2.2): a front and a back figure with one 48 px target
 * per region and side, in edit mode (the intake) and summary mode (the findings page). Left and right
 * are the person's own, so each view names its sides and the figure never mirrors with the page
 * direction. D-034 item 5: a soft rounded figure, and each affected area glows with a halo.
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
  smoothPath,
  toggleBodyMapCell,
  type BodyMapProps,
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

  it("keeps every two targets apart (44 units: 48 px at the intake's 264 px figure, so no 48 px targets overlap)", () => {
    for (const view of ["front", "back"] as const)
      for (const a of BODY_MAP_CELLS)
        for (const b of BODY_MAP_CELLS) {
          if (a >= b) continue;
          const p = cellPoint(a, view),
            q = cellPoint(b, view);
          expect(Math.hypot(p.x - q.x, p.y - q.y), `${a} ${b} ${view}`).toBeGreaterThanOrEqual(44);
        }
  });

  it("sizes each target 48 px in the stylesheet, at least the contract's 44 px", () => {
    const css = readFileSync(join(__dirname, "../../src/features/body-map/body-map.css"), "utf8");
    const rule = css.match(/\.bm-cell \{[^}]*\}/)![0];
    expect(rule).toContain("width: 48px");
    expect(rule).toContain("height: 48px");
    expect(css).toMatch(/\.bm-figure \{[^}]*direction: ltr/);
    expect(css).toMatch(/\.bm-figure \{[^}]*width: 264px/);
  });

  it("draws the figure as one smooth closed outline with no hard lines", () => {
    const d = smoothPath([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(d.startsWith("M0 0C")).toBe(true);
    expect(d.endsWith("0 0Z")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
    const css = readFileSync(join(__dirname, "../../src/features/body-map/body-map.css"), "utf8");
    // No black or dark outline on the figure: its rim is a soft lavender.
    expect(css).toMatch(/\.bm-skin > \* \{[^}]*stroke: #e2d9ef/);
    expect(css).not.toMatch(/stroke: (#000|black)/);
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

  it("lights the halo of each affected area in purple, and keeps the others ready to fade in", () => {
    const html = render("en", [shoulderRight, kneesBoth]);
    const glows = [
      ...html.matchAll(
        /data-glow="([^"]+)" data-lit="(true|false)"[^>]*fill="url\(#\w+?(purple|within|mild|marked|grey)\)"/g,
      ),
    ];
    expect(glows).toHaveLength(14);
    expect(
      glows
        .filter((m) => m[2] === "true")
        .map((m) => m[1])
        .sort(),
    ).toEqual(["knee:left", "knee:right", "shoulder:right"]);
    expect(new Set(glows.map((m) => m[3]))).toEqual(new Set(["purple"]));
    // The forearm's halo follows the arm: turned one way on the right, the other way on the left.
    expect(html).toContain('<g transform="rotate(17 47 214)">');
    expect(html).toContain('<g transform="rotate(-17 193 214)">');
  });
});

describe("the props (contract 2.2 with D-024, A2-5)", () => {
  it("takes the page language in both modes, and the notes in summary mode only", () => {
    const props: BodyMapProps[] = [
      { lang: "ar", mode: "edit", value: [], onChange: () => {} },
      { lang: "en", mode: "summary", colours: {} },
      { lang: "en", mode: "summary", colours: {}, notes: { "knee:left": "within the usual range" } },
    ];
    // @ts-expect-error lang is required: the cell, view and side names are in the page language.
    const noLang: BodyMapProps = { mode: "summary", colours: {} };
    // @ts-expect-error the notes are read after a cell's name in summary mode only.
    const editNotes: BodyMapProps = { lang: "en", mode: "edit", value: [], onChange: () => {}, notes: {} };
    expect([...props, noLang, editNotes]).toHaveLength(5);
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
    // Each coloured cell glows in its own colour; the others have no halo.
    expect(html).toMatch(/data-glow="knee:right" data-lit="true"[^>]*fill="url\(#\w+marked\)"/);
    expect(html).toMatch(/data-glow="neck:axial" data-lit="true"[^>]*fill="url\(#\w+grey\)"/);
    expect(html.match(/data-glow=/g)).toHaveLength(2);
  });
});
