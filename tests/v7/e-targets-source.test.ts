/**
 * Step E2 (C-1): the rules of src/medical/targets.ts that the runtime data does not carry, held to the
 * signed off clinical source they were written from. They run only with AZM_CLINICAL_V7 set to the
 * clinical folder (local-docs/clinical/v7 of the main checkout), as stream A's prose checks do.
 *   - the back's region default: «With osteoporosis or a spine fracture: extension only», the row's note
 *     the exporter drops.
 *   - the paths whose words name the pain friendly set, and the selection's words for the caps.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAIN_FRIENDLY_PATHS } from "../../src/medical/targets";

describe.skipIf(!process.env.AZM_CLINICAL_V7)(
  "the clinical source of the targets rules (AZM_CLINICAL_V7)",
  () => {
    const source = () =>
      JSON.parse(readFileSync(join(process.env.AZM_CLINICAL_V7!, "exercise-targets.json"), "utf8")) as {
        mapping: {
          regionDefaultRule: { rows: { region: string; note?: string; targets: string[] }[] };
          paths: { path: string; plus: string }[];
          selection: string[];
        };
      };
    it("the back's region default is extension only with osteoporosis", () => {
      const back = source().mapping.regionDefaultRule.rows.find((r) => r.region === "back_trunk")!;
      expect(back.note).toMatch(/^With osteoporosis or a spine fracture: extension only/);
      expect(back.targets).toContain("mobility:trunk_extension");
    });

    it("the paths whose items come from the pain friendly set", () => {
      for (const p of source().mapping.paths)
        expect(/pain friendly/.test(p.plus), p.path).toBe(PAIN_FRIENDLY_PATHS.includes(p.path as never));
    });

    it("the selection's words for the caps and the region filters", () => {
      const steps = source().mapping.selection.join("\n");
      expect(steps).toContain("at most 2 items per limited movement or pattern");
      expect(steps).toContain("finding items fill at most half of a session's exercise slots");
      expect(steps).toContain("Region filters run last, after the goal and sport items are added");
    });
  },
);
