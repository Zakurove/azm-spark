/**
 * D-027 item 3 (change log W2-7): the seated instruction says where the hands rest. In the seated
 * side view a hand resting on the thigh or the knee reads as an assisted lift, so seated hip flexion
 * tells the person first to rest the hands at the sides of the chair («ضع يديك على جانبي الكرسي.»
 * · "Rest your hands at the sides of the chair."), and a position with its own line closes with the
 * plain hold line, never the lying one («... على السرير» · "... on the bed").
 */
import { describe, expect, it } from "vitest";
import { instructionLines } from "../../src/features/focus/copy";
import { movementDef } from "../../src/movements/rom";
import type { RomMovementId, RomPositionId } from "../../src/movements/rom/types";

const HANDS = { ar: "ضع يديك على جانبي الكرسي.", en: "Rest your hands at the sides of the chair." };
const HOLD = { ar: "اثبت لحظة.", en: "Hold for a moment." };

describe("seated hip flexion (W2-7)", () => {
  it("says where the hands rest before the lift, Arabic first, and holds without the bed", () => {
    expect(instructionLines("hip_flexion", "right", "seated", "ar")).toEqual([
      HANDS.ar,
      "اجلس مستقيمًا وظهرك مستند، ثم ارفع ركبتك اليمنى نحو صدرك إلى أقصى ما تستطيع دون ألم، دون أن تميل إلى الخلف.",
      HOLD.ar,
    ]);
    expect(instructionLines("hip_flexion", "left", "seated", "en")).toEqual([
      HANDS.en,
      "Sit tall with your back supported, then lift your left knee toward your chest as far as you can without pain, without leaning back.",
      HOLD.en,
    ]);
  });

  it("keeps the lying instructions of the data as they are", () => {
    for (const lang of ["ar", "en"] as const) {
      const lines = instructionLines("hip_flexion", "right", "lying_back", lang);
      expect(lines).toHaveLength(movementDef("hip_flexion").instructions[lang].length);
      expect(lines).not.toContain(HANDS[lang]);
    }
  });
});

describe("every position with its own line", () => {
  const variants = (["hip_flexion", "knee_flexion", "knee_extension"] as RomMovementId[]).flatMap((id) =>
    Object.keys(movementDef(id).variantInstructions ?? {}).map((p) => [id, p as RomPositionId] as const),
  );

  it("covers the three movements the data gives a second position", () => {
    expect(variants).toEqual([
      ["hip_flexion", "seated"],
      ["knee_flexion", "standing_supported"],
      ["knee_extension", "seated"],
    ]);
  });

  it.each(variants)("%s %s closes with the plain hold line and never speaks of the bed", (id, position) => {
    for (const lang of ["ar", "en"] as const) {
      const lines = instructionLines(id, "right", position, lang);
      expect(lines.at(-1)).toBe(HOLD[lang]);
      expect(lines.join(" ")).not.toMatch(lang === "ar" ? /السرير/ : /\bbed\b/);
    }
  });

  it("names the hands only where a hand near the knee voids the lift (the assisted check), seated", () => {
    for (const [id, position] of variants) {
      const assisted = movementDef(id).compensationIds.includes("assisted");
      const lines = instructionLines(id, "left", position, "ar");
      expect(lines.includes(HANDS.ar), `${id} ${position}`).toBe(assisted && position === "seated");
    }
  });

  it("keeps the knee lines the data already closes with the hold", () => {
    for (const [id, position] of variants.filter(([id]) => id !== "hip_flexion"))
      for (const lang of ["ar", "en"] as const)
        expect(movementDef(id).instructions[lang].at(-1), `${id} ${position}`).toBe(HOLD[lang]);
  });
});
