import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MovementPicture } from "../../src/features/focus/MovementPicture";
import { Placement } from "../../src/features/gait/Placement";
import LandingV7 from "../../src/app/LandingV7";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { DICTIONARIES } from "../../src/i18n";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { disclaimersIn } from "../no-disclaimers";

const render = renderToStaticMarkup;

describe("v7 still illustrations", () => {
  it("maps every movement to a public still, with lazy loading and a smaller source", () => {
    for (const movementId of ROM_MOVEMENT_IDS) {
      for (const lang of ["ar", "en"] as const) {
        const html = render(createElement(MovementPicture, { movementId, lang }));
        expect(html).toContain(`v7_rom_${movementId}.webp`);
        expect(html).toContain(`v7_rom_${movementId}_600.webp 600w`);
        expect(html).toContain('loading="lazy"');
        expect(html).not.toContain("<svg");
        expect(html).not.toContain("<video");
        expect(statSync(`public/illustrations/v7/rom/v7_rom_${movementId}.webp`).size).toBeLessThanOrEqual(
          80_000,
        );
      }
    }
  });

  it("mirrors the left side and selects the wheelchair scene from the person's mobility", () => {
    const props = { movementId: "trunk_lateral_flexion", lang: "ar" } as const;
    const seated = render(createElement(MovementPicture, { ...props, wheelchair: true, side: "left" }));
    expect(seated).toContain("v7_rom_trunk_lateral_flexion_wheelchair.webp");
    expect(seated).toContain("is-mirrored");
    expect(seated).toContain("الجهة اليسرى");
    const standing = render(createElement(MovementPicture, { ...props, side: "right" }));
    expect(standing).not.toContain("wheelchair");
    expect(standing).not.toContain("is-mirrored");
  });

  it("mirrors both walking side views but leaves front views unmirrored", () => {
    for (const kind of ["pad_side", "pad_front", "overground_side", "overground_front"] as const) {
      const html = render(
        createElement(Placement, { kind, lang: "en", side: "left", label: "Phone placement" }),
      );
      expect(html.includes("is-mirrored")).toBe(kind.endsWith("side"));
      expect(html).toContain('alt="Phone placement"');
      expect(html).toContain('loading="lazy"');
    }
  });

  it("keeps all 56 public files under the byte limit", () => {
    const files = JSON.parse(readFileSync("docs/v7-visuals/asset-checks.json", "utf8")) as {
      file: string;
      width: number;
      height: number;
      bytes: number;
    }[];
    expect(files).toHaveLength(56);
    for (const entry of files) {
      const data = readFileSync(entry.file);
      expect(data.length, entry.file).toBe(entry.bytes);
      expect(data.length).toBeLessThanOrEqual(80_000);
      expect(data.subarray(8, 12).toString()).toBe("WEBP");
      expect([600, 1200]).toContain(entry.width);
    }
  });
});

describe("the lazy landing sections", () => {
  it("renders the approved copy in order with portrait sources and no extra action", () => {
    for (const lang of ["ar", "en"] as const) {
      const copy = JSON.parse(readFileSync(`src/i18n/${lang}/landing.json`, "utf8")).v7;
      const html = render(createElement(LandingV7, { lang }));
      expect(html.match(/<section /g)).toHaveLength(3);
      expect(html.indexOf('id="ld-v7-range"')).toBeLessThan(html.indexOf('id="ld-v7-walk"'));
      expect(html.indexOf('id="ld-v7-walk"')).toBeLessThan(html.indexOf('id="ld-v7-coach"'));
      for (const name of ["range", "walk", "coach"]) {
        expect(html).toContain(copy[name].title);
        expect(html).toContain(`v7_landing_${name}_phone_600.webp`);
      }
      expect(html).not.toMatch(/<button|<a\s|<video/);
      expect(html.match(/loading="lazy"/g)).toHaveLength(3);
      expect((DICTIONARIES[lang].landing as Record<string, unknown>).v7).toBeUndefined();
      const text = Object.values(copy)
        .flatMap((v: any) => [v.title, v.body, ...Object.values(v.points), v.alt])
        .join(" ");
      expect(wordingProblems(text)).toEqual([]);
      expect(disclaimersIn(lang, text)).toEqual([]);
    }
  });
});
